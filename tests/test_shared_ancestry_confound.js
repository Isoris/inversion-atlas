// tests/test_shared_ancestry_confound.js

import {
  ANCESTRY_SAMPLE_VERDICT_DEFAULTS,
  ANCESTRY_SNP_VERDICT_DEFAULTS,
  ANCESTRY_MIN_OVERLAP,
  ANCESTRY_MIN_SNPS,
  ANCESTRY_SAMPLE_VERDICTS,
  ANCESTRY_SNP_VERDICTS,
  ANCESTRY_COMBINED_VERDICTS,
  ancCramersV,
  ancPearson,
  ancMaxAbsBandQCorr,
  ancVerdictSampleLevel,
  ancSnpCoherence,
  ancVerdictSnpLevel,
  ancCombinedVerdict,
  ancGetGlobalQ,
  ancGetChromQ,
  ancGetSnpSupport,
  ancAlignLabels,
  ancRunSampleTest,
} from '../atlases/inversion/shared/ancestry_confound.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

// =====================================================================
group('constants');
check('SAMPLE_VERDICT_DEFAULTS frozen',        Object.isFrozen(ANCESTRY_SAMPLE_VERDICT_DEFAULTS));
check('suspect_v = 0.6',                       ANCESTRY_SAMPLE_VERDICT_DEFAULTS.suspect_v === 0.6);
check('suspect_corr = 0.7',                    ANCESTRY_SAMPLE_VERDICT_DEFAULTS.suspect_corr === 0.7);
check('indep_v = 0.3',                         ANCESTRY_SAMPLE_VERDICT_DEFAULTS.indep_v === 0.3);
check('indep_corr = 0.4',                      ANCESTRY_SAMPLE_VERDICT_DEFAULTS.indep_corr === 0.4);
check('SNP_VERDICT_DEFAULTS frozen',           Object.isFrozen(ANCESTRY_SNP_VERDICT_DEFAULTS));
check('snp coherent = 0.65',                   ANCESTRY_SNP_VERDICT_DEFAULTS.coherent === 0.65);
check('snp mixed = 0.40',                      ANCESTRY_SNP_VERDICT_DEFAULTS.mixed === 0.40);
check('MIN_OVERLAP = 10',                      ANCESTRY_MIN_OVERLAP === 10);
check('MIN_SNPS = 5',                          ANCESTRY_MIN_SNPS === 5);
check('SAMPLE_VERDICTS frozen + 3',            Object.isFrozen(ANCESTRY_SAMPLE_VERDICTS) && ANCESTRY_SAMPLE_VERDICTS.length === 3);
check('SNP_VERDICTS frozen + 4',               Object.isFrozen(ANCESTRY_SNP_VERDICTS) && ANCESTRY_SNP_VERDICTS.length === 4);
check('COMBINED_VERDICTS frozen + 6',          Object.isFrozen(ANCESTRY_COMBINED_VERDICTS) && ANCESTRY_COMBINED_VERDICTS.length === 6);

// =====================================================================
group('ancCramersV');
{
  // Perfect dependence: identical labels
  const r = ancCramersV([0, 0, 1, 1, 2, 2], [0, 0, 1, 1, 2, 2]);
  check('identical: ok',                       r.ok === true);
  check('identical: v = 1',                    approx(r.v, 1));
}
{
  // Permuted (still perfect): renamed clusters
  const r = ancCramersV([0, 0, 1, 1, 2, 2], [2, 2, 0, 0, 1, 1]);
  check('permuted: v = 1',                     approx(r.v, 1));
}
{
  // Independence: shuffled labels
  const r = ancCramersV([0, 1, 0, 1, 0, 1, 0, 1], [0, 0, 1, 1, 0, 0, 1, 1]);
  check('independent: v < 0.5',                r.v < 0.5);
}
check('null A → ok=false',                    ancCramersV(null, [0]).ok === false);
check('length mismatch → ok=false',           ancCramersV([0], [0, 1]).ok === false);
check('n<2 → ok=false',                       ancCramersV([0], [0]).ok === false);
check('one-class → ok=false, v=0',
      (() => { const r = ancCramersV([0, 0, 0], [1, 2, 3]); return r.ok === false && r.v === 0; })());

// =====================================================================
group('ancPearson');
check('identical → r = 1',                     approx(ancPearson([1, 2, 3], [1, 2, 3]), 1));
check('inverse → r = -1',                      approx(ancPearson([1, 2, 3], [3, 2, 1]), -1));
check('orthogonal → r = 0 (-1, 1, -1, 1)',
      approx(ancPearson([-1, 1, -1, 1], [1, 1, -1, -1]), 0, 1e-6));
check('n<2 → NaN',                            Number.isNaN(ancPearson([1], [1])));
check('zero variance → 0',                    ancPearson([5, 5, 5], [1, 2, 3]) === 0);

// =====================================================================
group('ancMaxAbsBandQCorr');
{
  // Bands {0, 1, 2}. Q columns perfectly track each band as a column.
  const labels = [0, 0, 1, 1, 2, 2];
  const Q = [
    [1, 0, 0], [1, 0, 0],
    [0, 1, 0], [0, 1, 0],
    [0, 0, 1], [0, 0, 1],
  ];
  const r = ancMaxAbsBandQCorr(labels, Q);
  check('perfect: ok',                          r.ok === true);
  check('perfect: maxAbs = 1',                  approx(r.maxAbs, 1));
  check('band 0 → Qk=0',                        r.byBand[0].Qk === 0);
  check('band 1 → Qk=1',                        r.byBand[1].Qk === 1);
  check('band 2 → Qk=2',                        r.byBand[2].Qk === 2);
}
check('null labels → ok=false',               ancMaxAbsBandQCorr(null, [[1]]).ok === false);
check('null Q → ok=false',                    ancMaxAbsBandQCorr([0], null).ok === false);
check('length mismatch → ok=false',           ancMaxAbsBandQCorr([0], [[1], [2]]).ok === false);
check('no Q columns → ok=false',
      ancMaxAbsBandQCorr([0, 0], [[], []]).ok === false);

// =====================================================================
group('ancVerdictSampleLevel');
check('high v → BAND_TRACKS_ANCESTRY',         ancVerdictSampleLevel(0.7, 0.1) === 'BAND_TRACKS_ANCESTRY');
check('high corr → BAND_TRACKS_ANCESTRY',      ancVerdictSampleLevel(0.1, 0.8) === 'BAND_TRACKS_ANCESTRY');
check('both low → BAND_INDEPENDENT',           ancVerdictSampleLevel(0.1, 0.1) === 'BAND_INDEPENDENT_OF_ANCESTRY');
check('mid: INCONCLUSIVE',                     ancVerdictSampleLevel(0.5, 0.5) === 'INCONCLUSIVE');
check('NaN v → INCONCLUSIVE',                  ancVerdictSampleLevel(NaN, 0.1) === 'INCONCLUSIVE');
check('NaN maxAbs → INCONCLUSIVE',             ancVerdictSampleLevel(0.5, NaN) === 'INCONCLUSIVE');
// Custom thresholds
check('custom thresholds: lower suspect bar',
      ancVerdictSampleLevel(0.4, 0.4, { suspect_v: 0.3, suspect_corr: 0.3 }) === 'BAND_TRACKS_ANCESTRY');

// =====================================================================
group('ancSnpCoherence');
{
  // All 6 SNPs have best_Q=1 → coherence 1.0
  const snps = [
    { pos: 1, best_Q: 1 }, { pos: 2, best_Q: 1 }, { pos: 3, best_Q: 1 },
    { pos: 4, best_Q: 1 }, { pos: 5, best_Q: 1 }, { pos: 6, best_Q: 1 },
  ];
  const r = ancSnpCoherence(snps);
  check('all-same: ok',                         r.ok === true);
  check('coherence = 1',                        approx(r.coherence, 1));
  check('dominantQ = 1',                        r.dominantQ === 1);
  check('entropy = 0',                          approx(r.entropy, 0));
}
{
  // Split 4-2: coherence 4/6 ≈ 0.667
  const snps = [
    { pos: 1, best_Q: 0 }, { pos: 2, best_Q: 0 }, { pos: 3, best_Q: 0 }, { pos: 4, best_Q: 0 },
    { pos: 5, best_Q: 1 }, { pos: 6, best_Q: 1 },
  ];
  const r = ancSnpCoherence(snps);
  check('split: coherence ≈ 4/6',               approx(r.coherence, 2 / 3));
  check('split: dominantQ = 0',                 r.dominantQ === 0);
  check('split: entropy > 0',                   r.entropy > 0);
}
check('n<5 → ok=false',                       ancSnpCoherence([{ pos: 1, best_Q: 0 }]).ok === false);
check('null → ok=false',                      ancSnpCoherence(null).ok === false);
check('all-missing best_Q → ok=false',
      ancSnpCoherence([{ pos: 1 }, { pos: 2 }, { pos: 3 }, { pos: 4 }, { pos: 5 }]).ok === false);

// =====================================================================
group('ancVerdictSnpLevel');
check('coherence ≥ 0.65 → Q_COHERENT',         ancVerdictSnpLevel({ ok: true, coherence: 0.8 }) === 'Q_COHERENT');
check('coherence < 0.40 → Q_MIXED',            ancVerdictSnpLevel({ ok: true, coherence: 0.35 }) === 'Q_MIXED');
check('0.40 ≤ coherence < 0.65 → Q_PARTIAL',   ancVerdictSnpLevel({ ok: true, coherence: 0.5 }) === 'Q_PARTIAL');
check('ok=false → INCONCLUSIVE',               ancVerdictSnpLevel({ ok: false }) === 'INCONCLUSIVE');
check('null → INCONCLUSIVE',                   ancVerdictSnpLevel(null) === 'INCONCLUSIVE');

// =====================================================================
group('ancCombinedVerdict');
function t(verdict, ok) { return { ok: ok !== false, verdict }; }

check('all-empty → EMPTY',                     ancCombinedVerdict(null, null, null) === 'EMPTY');
check('t1+t2 SUSPECT + t3 COHERENT → ALL_THREE_SUSPECT',
      ancCombinedVerdict(t('BAND_TRACKS_ANCESTRY'), t('BAND_TRACKS_ANCESTRY'), t('Q_COHERENT'))
      === 'ALL_THREE_SUSPECT');
check('t1 SUSPECT, t2 not → GENOME_ONLY',
      ancCombinedVerdict(t('BAND_TRACKS_ANCESTRY'), t('INCONCLUSIVE'), null)
      === 'GENOME_ONLY');
check('t1 not, t2 SUSPECT → FOCAL_ONLY',
      ancCombinedVerdict(t('INCONCLUSIVE'), t('BAND_TRACKS_ANCESTRY'), null)
      === 'FOCAL_ONLY');
check('both INDEPENDENT → SAMPLE_INDEPENDENT',
      ancCombinedVerdict(t('BAND_INDEPENDENT_OF_ANCESTRY'), t('BAND_INDEPENDENT_OF_ANCESTRY'), null)
      === 'SAMPLE_INDEPENDENT');
check('suspect + t3 not coherent → PARTIAL',
      ancCombinedVerdict(t('BAND_TRACKS_ANCESTRY'), null, t('Q_MIXED'))
      === 'PARTIAL');
// Test "missing t1" path (have2 only)
check('only t2 ok → PARTIAL fallback',
      ancCombinedVerdict({ ok: false }, t('BAND_TRACKS_ANCESTRY'), null) === 'PARTIAL');

// =====================================================================
group('layer accessors');
{
  const sd = {
    ancestry_q_global: { K: 3, samples: ['s1', 's2'], q: [[0.5, 0.3, 0.2], [0.1, 0.7, 0.2]] },
  };
  const r = ancGetGlobalQ(sd);
  check('global: returns layer',                !!r);
  check('global: K = 3',                        r.K === 3);
  check('global: source includes q_global',     r.source.includes('q_global'));
}
{
  const sd = {
    ancestry_q_chrom: { K: 3, samples: ['s1'], q: [[0.5, 0.3, 0.2]], chrom: 'LG28' },
  };
  const r = ancGetChromQ(sd);
  check('chrom: returns layer',                 !!r);
  check('chrom: chrom preserved',               r.chrom === 'LG28');
  check('chrom: source mentions LG28',          r.source.includes('LG28'));
}
{
  const sd = {
    snp_q_support: {
      K: 3,
      snps: [
        { pos: 100, best_Q: 0 },
        { pos: 500, best_Q: 1 },
        { pos: 900, best_Q: 0 },
      ],
    },
  };
  const r = ancGetSnpSupport(sd, 200, 800);
  check('snp: 1 SNP in span',                   r.snps.length === 1);
  check('snp: total_in_layer = 3',              r.total_in_layer === 3);
  check('snp: source has SNP count',            r.source.includes('n=1'));
}
check('null stateData → null (global)',       ancGetGlobalQ(null) === null);
check('null stateData → null (chrom)',        ancGetChromQ(null) === null);
check('null stateData → null (snp)',          ancGetSnpSupport(null, 0, 100) === null);
check('malformed global → null',
      ancGetGlobalQ({ ancestry_q_global: { samples: 'oops' } }) === null);

// =====================================================================
group('ancAlignLabels');
{
  const state = {
    data: {
      samples: [
        { cga: 'CGA001' },
        { cga: 'CGA002' },
        { cga: 'CGA003' },
        { cga: 'CGA004' },
      ],
    },
  };
  const c = { locked_labels: [0, 1, 0, -1] };   // CGA004 is unlabeled
  const qLayer = {
    samples: ['CGA001', 'CGA002', 'CGA_NEW', 'CGA003', 'CGA004'],
    q: [[0.5, 0.5], [0.3, 0.7], [0.1, 0.9], [0.6, 0.4], [0.2, 0.8]],
  };
  const r = ancAlignLabels(state, c, qLayer);
  // CGA001 → label 0, CGA002 → label 1, CGA_NEW missing,
  // CGA003 → label 0, CGA004 → skip (-1)
  check('returns object',                       !!r);
  check('n = 3 (CGA001/2/3 only)',              r.n === 3);
  check('n_missing = 1 (CGA_NEW)',              r.n_missing === 1);
  check('labels = [0, 1, 0]',                   JSON.stringify(r.labels) === '[0,1,0]');
  check('Q rows aligned with labels',           r.Q[0][0] === 0.5 && r.Q[2][0] === 0.6);
}
{
  // ind fallback
  const state = {
    data: { samples: [{ ind: 'IND_A' }, { ind: 'IND_B' }] },
  };
  const c = { locked_labels: [0, 1] };
  const qLayer = { samples: ['IND_A', 'IND_B'], q: [[0.5], [0.5]] };
  const r = ancAlignLabels(state, c, qLayer);
  check('ind fallback works',                   r.n === 2);
}
check('null c → null',                        ancAlignLabels({ data: { samples: [] } }, null, {}) === null);
check('null state.data → null',
      ancAlignLabels({}, { locked_labels: [0] }, { samples: ['x'], q: [[0]] }) === null);
check('null qLayer → null',
      ancAlignLabels({ data: { samples: [] } }, { locked_labels: [0] }, null) === null);
check('no qLayer.samples → null',
      ancAlignLabels({ data: { samples: [] } }, { locked_labels: [0] }, {}) === null);

// =====================================================================
group('ancRunSampleTest');
{
  // Build a clean band-tracks-ancestry signal: 12 samples, 2 bands,
  // each band's argmax-Q lines up with its label.
  const samples = [];
  const lockedLabels = [];
  for (let i = 0; i < 12; i++) samples.push({ cga: 'S' + i });
  const qSamples = [];
  const Q = [];
  for (let i = 0; i < 12; i++) {
    qSamples.push('S' + i);
    const isBand1 = i >= 6;
    lockedLabels.push(isBand1 ? 1 : 0);
    Q.push(isBand1 ? [0.1, 0.9] : [0.9, 0.1]);
  }
  const state = { data: { samples } };
  const c = { locked_labels: lockedLabels };
  const qLayer = { K: 2, samples: qSamples, q: Q, source: 'mock' };
  const r = ancRunSampleTest(state, c, qLayer);
  check('clean signal: ok=true',                r.ok === true);
  check('clean signal: n = 12',                 r.n === 12);
  check('clean signal: cramersV = 1',           approx(r.cramersV, 1));
  check('clean signal: maxAbsCorr = 1',         approx(r.maxAbsCorr, 1));
  check('clean signal: verdict = BAND_TRACKS_ANCESTRY',
        r.verdict === 'BAND_TRACKS_ANCESTRY');
  check('clean signal: source pass-through',    r.source === 'mock');
}
{
  // Insufficient overlap (only 4 matching samples)
  const state = {
    data: { samples: [{ cga: 'A' }, { cga: 'B' }, { cga: 'C' }, { cga: 'D' }] },
  };
  const c = { locked_labels: [0, 0, 1, 1] };
  const qLayer = {
    K: 2, samples: ['A', 'B', 'C', 'D'],
    q: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]],
    source: 'mock',
  };
  const r = ancRunSampleTest(state, c, qLayer);
  check('n<10: ok=false',                       r.ok === false);
  check('why mentions overlap',                 r.why.includes('overlap'));
}
check('null qLayer → ok=false',
      ancRunSampleTest({}, { locked_labels: [] }, null).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
