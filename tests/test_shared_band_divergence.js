// tests/test_shared_band_divergence.js
//
// Unit coverage for shared/band_divergence.js — per-band heterozygosity
// classification (legacy lines 37448-37650).

import * as BD from '../atlases/inversion/shared/band_divergence.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('Constants');
check('DBD_LOW_HET_THRESHOLD = 0.40',     BD.DBD_LOW_HET_THRESHOLD === 0.40);
check('DBD_HIGH_HET_THRESHOLD = 0.50',    BD.DBD_HIGH_HET_THRESHOLD === 0.50);
check('DBD_MULTIMODAL_GAP_Z = 2.0',       BD.DBD_MULTIMODAL_GAP_Z === 2.0);
check('DBD_MULTIMODAL_GAP_MIN = 0.15',    BD.DBD_MULTIMODAL_GAP_MIN === 0.15);
check('DBD_MIN_MODE_SAMPLES = 3',         BD.DBD_MIN_MODE_SAMPLES === 3);

// -----------------------------------------------------------------------------
group('dbdDivergenceClass + dbdPossibleState');
check('0.2 → low',                         BD.dbdDivergenceClass(0.2) === 'low');
check('0.45 → mid',                        BD.dbdDivergenceClass(0.45) === 'mid');
check('0.6 → high',                        BD.dbdDivergenceClass(0.6) === 'high');
check('NaN → mid',                         BD.dbdDivergenceClass(NaN) === 'mid');

check('low → hom-like',                    BD.dbdPossibleState('low') === 'hom-like');
check('mid → ambiguous',                   BD.dbdPossibleState('mid') === 'ambiguous');
check('high → het-like',                   BD.dbdPossibleState('high') === 'het-like');

// -----------------------------------------------------------------------------
group('dbdDetectModes: unimodal');
const tight = new Float64Array([0.10, 0.11, 0.12, 0.10, 0.13, 0.11, 0.09, 0.12]);
const modesUnimodal = BD.dbdDetectModes(tight);
check('tight cluster → 1 mode',            modesUnimodal.n_modes === 1);
check('mode center ≈ 0.11',                Math.abs(modesUnimodal.mode_centers[0] - 0.11) < 0.02);

// Too few samples → 1 mode
const tooFew = new Float64Array([0.1, 0.5]);
check('< 2×MIN_MODE_SAMPLES → 1 mode',     BD.dbdDetectModes(tooFew).n_modes === 1);

// Zero spread → 1 mode
const zero = new Float64Array([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
check('zero spread → 1 mode',              BD.dbdDetectModes(zero).n_modes === 1);

// -----------------------------------------------------------------------------
group('dbdDetectModes: bimodal');
// Clear bimodal: cluster at 0.1 and cluster at 0.7, both with ≥3 samples
const bimodal = new Float64Array([
  0.08, 0.10, 0.12, 0.09, 0.11,
  0.70, 0.72, 0.68, 0.71, 0.69,
]);
const modesBi = BD.dbdDetectModes(bimodal);
check('bimodal: 2 modes',                  modesBi.n_modes === 2);
check('bimodal: mode 0 ≈ 0.10',            Math.abs(modesBi.mode_centers[0] - 0.10) < 0.02);
check('bimodal: mode 1 ≈ 0.70',            Math.abs(modesBi.mode_centers[1] - 0.70) < 0.02);
check('bimodal: modes ordered low→high',   modesBi.mode_centers[0] < modesBi.mode_centers[1]);
// Half assigned to each
const n0 = Array.from(modesBi.mode_assignments).filter(v => v === 0).length;
const n1 = Array.from(modesBi.mode_assignments).filter(v => v === 1).length;
check('bimodal: 5 samples per mode',       n0 === 5 && n1 === 5);

// Tight gap (within absolute threshold) → 1 mode
const narrowGap = new Float64Array([
  0.30, 0.31, 0.32, 0.33,
  0.40, 0.41, 0.42, 0.43,
]);
check('narrow gap (<0.15) → 1 mode',
      BD.dbdDetectModes(narrowGap).n_modes === 1);

// -----------------------------------------------------------------------------
group('dbdBandInterpretation');
check('2+ modes → mixed',                  BD.dbdBandInterpretation(0.5, 0.0, 0.5, 2) === 'mixed');
check('lowFrac ≥ 0.7 → hom-like',          BD.dbdBandInterpretation(0.8, 0.1, 0.1, 1) === 'hom-like');
check('highFrac ≥ 0.7 → het-like',         BD.dbdBandInterpretation(0.1, 0.1, 0.8, 1) === 'het-like');
check('midFrac ≥ 0.5 → ambiguous',         BD.dbdBandInterpretation(0.2, 0.6, 0.2, 1) === 'ambiguous');
check('split low/high → ambiguous',        BD.dbdBandInterpretation(0.4, 0.2, 0.4, 1) === 'ambiguous');

// -----------------------------------------------------------------------------
group('classifyDetailedCandidate: explicit per_sample_het');
const cand = {
  K: 2,
  locked_labels: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
};
// Band 0: all low het → hom-like
// Band 1: all high het → het-like
const explicit = BD.classifyDetailedCandidate(cand, {
  per_sample_het: [0.1, 0.1, 0.1, 0.1, 0.1, 0.7, 0.7, 0.7, 0.7, 0.7],
});
check('explicit het: het_source = precomp_het',  explicit.het_source === 'precomp_het');
check('explicit het: 10 per_sample entries',     explicit.per_sample.length === 10);
check('explicit het: 2 per_band entries',        explicit.per_band.length === 2);
check('band 0: interpretation = hom-like',
      explicit.per_band[0].interpretation === 'hom-like');
check('band 1: interpretation = het-like',
      explicit.per_band[1].interpretation === 'het-like');
check('band 0: lowhet_fraction = 1.0',            explicit.per_band[0].lowhet_fraction === 1.0);
check('band 1: highhet_fraction = 1.0',           explicit.per_band[1].highhet_fraction === 1.0);

// per_sample_het from candidate.per_sample_het
const candWithHet = Object.assign({}, cand, {
  per_sample_het: [0.7, 0.7, 0.7, 0.7, 0.7, 0.1, 0.1, 0.1, 0.1, 0.1],
});
const fromCand = BD.classifyDetailedCandidate(candWithHet);
check('candidate.per_sample_het picked up',       fromCand.het_source === 'precomp_het');
check('band 0 now het-like (using cand het)',     fromCand.per_band[0].interpretation === 'het-like');

// hetProxy fallback
const fromProxy = BD.classifyDetailedCandidate(cand, {
  hetProxy: () => new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.7, 0.7, 0.7, 0.7, 0.7]),
});
check('hetProxy: het_source = atlas_proxy',       fromProxy.het_source === 'atlas_proxy');
check('hetProxy: band 0 hom-like',                fromProxy.per_band[0].interpretation === 'hom-like');

// No het info → null
check('no het info → null',                       BD.classifyDetailedCandidate(cand) === null);

// -----------------------------------------------------------------------------
group('classifyDetailedCandidate: mixed band');
// Band 0: 4 hom-like (low het) + 4 het-like (high het) — bimodal → 'mixed'
const candMixed = {
  K: 1, locked_labels: new Array(10).fill(0),
};
const mixed = BD.classifyDetailedCandidate(candMixed, {
  per_sample_het: [0.1, 0.1, 0.1, 0.1, 0.1, 0.7, 0.7, 0.7, 0.7, 0.7],
});
check('mixed: band 0 interpretation = mixed',
      mixed.per_band[0].interpretation === 'mixed');
check('mixed: band 0 is_mixed = true',
      mixed.per_band[0].is_mixed === true);
check('mixed: band 0 n_modes = 2',
      mixed.per_band[0].n_modes === 2);
check('mixed: sub_band propagated to per_sample',
      mixed.per_sample.every(s => s.sub_band === 0 || s.sub_band === 1));

// -----------------------------------------------------------------------------
group('classifyDetailedCandidate: edge cases');
check('null candidate → null',
      BD.classifyDetailedCandidate(null, { per_sample_het: [0.1] }) === null);
check('candidate without locked_labels → null',
      BD.classifyDetailedCandidate({ K: 2 }, { per_sample_het: [0.1] }) === null);

// K derived from labels when missing
const candNoK = { locked_labels: [0, 0, 1, 1, 2, 2] };
const derived = BD.classifyDetailedCandidate(candNoK, {
  per_sample_het: [0.1, 0.1, 0.4, 0.4, 0.7, 0.7],
});
check('K derived: 3 per_band entries',  derived.per_band.length === 3);

// Empty band yields zero counts
const candEmpty = { K: 3, locked_labels: [0, 0, 0, 1, 1, 1] };
const emptyBand = BD.classifyDetailedCandidate(candEmpty, {
  per_sample_het: [0.1, 0.1, 0.1, 0.7, 0.7, 0.7],
});
check('empty band: n = 0',                emptyBand.per_band[2].n === 0);
check('empty band: interpretation ambiguous',
      emptyBand.per_band[2].interpretation === 'ambiguous');

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
