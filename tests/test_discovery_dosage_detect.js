// tests/test_discovery_dosage_detect.js
//
// Unit coverage for pages/discovery/dosage_heatmap/dosage_detect.js —
// in-page band/cluster detection + dosage-only confidence.

import {
  DOSAGE_TIERS,
  computeSampleDosageFeatures,
  regimeCallFromMean,
  regimeCallsFromDosage,
  marginConfidence,
  silhouettePerSample1D,
  summariseGroups,
  detectGroups,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/dosage_detect.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------
// Build a synthetic canonical heatmap: 30 samples, 20 markers, three
// clean dosage bands of 10 each — homA (≈0), het (≈1), homB (≈2).
// ---------------------------------------------------------------------
function makeCanonical() {
  const nS = 30, nM = 20;
  const meanForSample = (s) => (s < 10 ? 0.05 : (s < 20 ? 1.0 : 1.95));
  return {
    n_samples: nS,
    n_markers: nM,
    cellValue: (m, s) => {
      // a couple of NA cells to exercise skipping
      if (m === 0 && s === 0) return null;
      return meanForSample(s);
    },
  };
}

// =====================================================================
group('tiers + calls');

check('HOM_A_MAX/HET/HOM_B_MIN constants', DOSAGE_TIERS.HOM_A_MAX === 0.4
  && DOSAGE_TIERS.HET_LO === 0.6 && DOSAGE_TIERS.HET_HI === 1.4
  && DOSAGE_TIERS.HOM_B_MIN === 1.6);
check('regimeCallFromMean homA', regimeCallFromMean(0.1) === 'homA_like');
check('regimeCallFromMean het',  regimeCallFromMean(1.0) === 'het_like');
check('regimeCallFromMean homB', regimeCallFromMean(1.9) === 'homB_like');
check('regimeCallFromMean uncertain (gap)', regimeCallFromMean(0.5) === 'uncertain');
check('regimeCallFromMean uncertain (NaN)', regimeCallFromMean(NaN) === 'uncertain');
check('regimeCallsFromDosage maps array', (() => {
  const c = regimeCallsFromDosage([0.1, 1.0, 1.9]);
  return c.length === 3 && c[0] === 'homA_like' && c[1] === 'het_like' && c[2] === 'homB_like';
})());

// =====================================================================
group('per-sample features');

const can = makeCanonical();
const feats = computeSampleDosageFeatures(can);
check('mean length = n_samples', feats.mean.length === 30);
check('homA mean ≈ 0.05', approx(feats.mean[0], 0.05, 1e-9));
check('het mean ≈ 1.0', approx(feats.mean[15], 1.0, 1e-9));
check('homB mean ≈ 1.95', approx(feats.mean[25], 1.95, 1e-9));
check('het fraction = 1 for het band', approx(feats.het[15], 1.0, 1e-9));
check('het fraction = 0 for homA band', approx(feats.het[0], 0.0, 1e-9));
check('NA cell skipped (s0 used 19 markers)', feats.n[0] === 19);
check('markerOrder subset restricts markers', (() => {
  const sub = Int32Array.from([1, 2, 3]);
  const f = computeSampleDosageFeatures(can, sub);
  return f.n[0] === 3;
})());
check('empty canonical → NaN means', (() => {
  const f = computeSampleDosageFeatures({ n_samples: 2, n_markers: 0, cellValue: () => null });
  return Number.isNaN(f.mean[0]);
})());

// =====================================================================
group('margin confidence');

const margin = marginConfidence(feats.mean);
check('homA margin high (≈0.9)', approx(margin[0], 0.9, 1e-6));
check('het margin = 1 (dead centre)', approx(margin[15], 1.0, 1e-6));
check('boundary sample margin = 0', approx(marginConfidence([0.5])[0], 0, 1e-9));
check('margin clamped to [0,1]', marginConfidence([2.0])[0] <= 1 && marginConfidence([0])[0] <= 1);
check('NaN mean → NaN margin', Number.isNaN(marginConfidence([NaN])[0]));

// =====================================================================
group('per-sample silhouette');

const labels3 = new Int32Array(30);
for (let s = 0; s < 30; s++) labels3[s] = s < 10 ? 0 : (s < 20 ? 1 : 2);
const sil = silhouettePerSample1D(feats.mean, labels3, 3);
check('clean bands → high silhouette', sil[0] > 0.5 && sil[15] > 0.5);
check('silhouette in [-1,1]', sil.every(v => Number.isNaN(v) || (v >= -1.0001 && v <= 1.0001)));
check('k<2 → all NaN', silhouettePerSample1D(feats.mean, labels3, 1).every(Number.isNaN));

// =====================================================================
group('summariseGroups');

const recs = summariseGroups({ labels: labels3, mean: feats.mean, centers: [0.05, 1.0, 1.95], margin, sil, k: 3 });
check('one record per group', recs.length === 3);
check('group sizes 10/10/10', recs[0].n === 10 && recs[1].n === 10 && recs[2].n === 10);
check('group calls homA/het/homB', recs[0].call === 'homA_like'
  && recs[1].call === 'het_like' && recs[2].call === 'homB_like');
check('separation > 0 for separated bands', recs[1].separation > 1);
check('confidence in [0,1]', recs.every(r => r.confidence >= 0 && r.confidence <= 1));
check('het group high confidence', recs[1].confidence > 0.4);

// =====================================================================
group('detectGroups — bands mode');

const dB = detectGroups(can, { mode: 'bands', k: 'auto', kMin: 2, kMax: 4, minNGroup: 4 });
check('returns a result', !!dB);
check('auto-K finds 3 bands', dB.k === 3, 'k=' + (dB && dB.k));
check('labels length = n_samples', dB.labels.length === 30);
check('three labels present', new Set(Array.from(dB.labels)).size === 3);
check('sample_group readable + tier-named', /band 0/.test(dB.sample_group[0]) && /homA|hom/.test(dB.sample_group[0]));
check('regime_call homA/het/homB', dB.regime_call[0] === 'homA_like'
  && dB.regime_call[15] === 'het_like' && dB.regime_call[25] === 'homB_like');
check('overall silhouette high', dB.overall_silhouette > 0.5);
check('groups summary present', Array.isArray(dB.groups) && dB.groups.length === 3);

// =====================================================================
group('detectGroups — fixed K + clusters mode');

const dFixed = detectGroups(can, { mode: 'bands', k: 2 });
check('fixed K=2 honoured', dFixed.k === 2);
const dC = detectGroups(can, { mode: 'clusters', k: 'auto', kMin: 2, kMax: 4 });
check('clusters mode returns result', !!dC && dC.mode === 'clusters');
check('clusters labelled ascending by dosage', dC.labels[0] <= dC.labels[25]);
check('clusters sample_group named "cluster N"', /cluster \d/.test(dC.sample_group[0]));

// =====================================================================
group('detectGroups — degenerate inputs');

check('null canonical → null', detectGroups(null) === null);
check('too few samples → null', detectGroups({ n_samples: 1, n_markers: 3, cellValue: () => 1 }, { kMin: 2 }) === null);

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
