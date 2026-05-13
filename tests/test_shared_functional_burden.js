// tests/test_shared_functional_burden.js
//
// Unit coverage for shared/functional_burden.js + the kruskalWallis /
// median / iqr additions in shared/stats_helpers.js
// (SPEC_functional_burden_per_candidate_v1.md).

import {
  kruskalWallis, median, iqr,
} from '../atlases/inversion/shared/stats_helpers.js';
import {
  FUNCTIONAL_BURDEN_VERDICTS,
  FUNCTIONAL_BURDEN_TAGS,
  FUNCTIONAL_BURDEN_METRICS,
  FUNCTIONAL_BURDEN_TAG_METRICS,
  FUNCTIONAL_BURDEN_DEFAULTS,
  KARYOTYPE_GROUPS,
  FUNCTIONAL_BURDEN_MODULE_VERSION,
  aggregatePerSampleWithinCandidate,
  summarizeByKaryotype,
  pairwiseWilcoxonByKaryotype,
  classifyMetricVerdict,
  compositeSummaryTag,
  summarizeCandidateFunctionalBurden,
} from '../atlases/inversion/shared/functional_burden.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('stats_helpers — median, iqr');

check('median(1..5) = 3',                median([1,2,3,4,5]) === 3);
check('median NaN-tolerant',             median([1, NaN, 2, -1, 3, 4, 5]) === 3);
check('iqr([1..7]) = [2.5, 5.5]',
      iqr([1,2,3,4,5,6,7])[0] === 2.5 && iqr([1,2,3,4,5,6,7])[1] === 5.5);

// =====================================================================
group('stats_helpers — kruskalWallis');

// 3 identical groups → H ~ 0, p ~ 1
const kw1 = kruskalWallis([[1,2,3,4,5],[1,2,3,4,5],[1,2,3,4,5]]);
check('identical: H ≈ 0',              Math.abs(kw1.H) < 1e-6);
check('identical: p = 1',              Math.abs(kw1.p - 1) < 1e-6);
check('identical: df = 2',             kw1.df === 2);
check('identical: n_groups = 3',       kw1.n_groups === 3);

// Separated groups → small p
const kw2 = kruskalWallis([[1,2,3],[10,11,12],[20,21,22]]);
check('separated: p tiny',             kw2.p < 0.05);
check('separated: H positive',         kw2.H > 0);

// Known scipy case: H = 0.7714, p = 0.6799
const kw3 = kruskalWallis([
  [2.9, 3.0, 2.5, 2.6, 3.2],
  [3.8, 2.7, 4.0, 2.4],
  [2.8, 3.4, 3.7, 2.2, 2.0],
]);
check('scipy-matched H = 0.7714',      Math.abs(kw3.H - 0.7714) < 1e-3);
check('scipy-matched p ≈ 0.680',       Math.abs(kw3.p - 0.6799) < 5e-3);

// Edge cases
check('null → null',                   kruskalWallis(null) === null);
check('single group → null',           kruskalWallis([[1,2,3]]) === null);
check('two empty groups → null',       kruskalWallis([[], []]) === null);
check('N < 3 → null',                  kruskalWallis([[1],[2]]) === null);

// Tie correction smoke: lots of ties
const kw_ties = kruskalWallis([[1,1,1],[1,1,2],[1,1,2,2]]);
check('tie-heavy returns valid p',     kw_ties && Number.isFinite(kw_ties.p));

// =====================================================================
group('functional_burden — vocab');

check('verdicts frozen',               Object.isFrozen(FUNCTIONAL_BURDEN_VERDICTS));
check('tags frozen',                   Object.isFrozen(FUNCTIONAL_BURDEN_TAGS));
check('metrics frozen',                Object.isFrozen(FUNCTIONAL_BURDEN_METRICS));
check('6 metrics defined',             FUNCTIONAL_BURDEN_METRICS.length === 6);
check('4 tag-contributing metrics',    FUNCTIONAL_BURDEN_TAG_METRICS.length === 4);
check('KW threshold = 0.05',
      FUNCTIONAL_BURDEN_DEFAULTS.kw_p_threshold === 0.05);
check('min_group_n = 5',
      FUNCTIONAL_BURDEN_DEFAULTS.min_group_n === 5);
check('module_version v1.0',
      FUNCTIONAL_BURDEN_MODULE_VERSION === 'functional_burden_per_candidate_v1.0');

// =====================================================================
group('aggregatePerSampleWithinCandidate');

// 5 windows, 3 samples. Candidate covers windows 1..3 (overlap test).
const layer1 = [
  { start_bp:  0,        end_bp:  500_000,  per_sample_values: [0.1, 0.2, 0.3] },
  { start_bp:  500_000,  end_bp: 1_000_000, per_sample_values: [0.4, 0.5, 0.6] },
  { start_bp: 1_000_000, end_bp: 1_500_000, per_sample_values: [0.7, 0.8, 0.9] },
  { start_bp: 1_500_000, end_bp: 2_000_000, per_sample_values: [1.0, 1.1, 1.2] },
  { start_bp: 2_000_000, end_bp: 2_500_000, per_sample_values: [1.3, 1.4, 1.5] },
];
const agg = aggregatePerSampleWithinCandidate(
  layer1, { start_bp: 500_000, end_bp: 1_800_000 },
);
check('3 windows overlap the candidate',  agg.n_windows === 3);
// sample 0 mean over windows 1,2,3 = (0.4+0.7+1.0)/3 = 0.7
check('sample 0 mean = 0.7',  Math.abs(agg.per_sample_means[0] - 0.7) < 1e-9);
check('sample 1 mean = 0.8',  Math.abs(agg.per_sample_means[1] - 0.8) < 1e-9);
check('sample 2 mean = 0.9',  Math.abs(agg.per_sample_means[2] - 0.9) < 1e-9);

// Missing values inside windows
const layer_miss = [
  { start_bp: 0, end_bp: 1_000_000, per_sample_values: [0.5, NaN, -1] },
  { start_bp: 1_000_000, end_bp: 2_000_000, per_sample_values: [0.7, 0.9, 1.0] },
];
const agg_miss = aggregatePerSampleWithinCandidate(
  layer_miss, { start_bp: 0, end_bp: 2_000_000 },
);
check('sample 0 mean both windows = 0.6',  Math.abs(agg_miss.per_sample_means[0] - 0.6) < 1e-9);
check('sample 1 mean only window 2 = 0.9', Math.abs(agg_miss.per_sample_means[1] - 0.9) < 1e-9);
check('sample 2 mean only window 2 = 1.0', Math.abs(agg_miss.per_sample_means[2] - 1.0) < 1e-9);

// Empty layer / bad candidate
check('empty layer → 0 windows',
      aggregatePerSampleWithinCandidate([], { start_bp: 0, end_bp: 1 }).n_windows === 0);
check('null candidate → 0 windows',
      aggregatePerSampleWithinCandidate(layer1, null).n_windows === 0);

// =====================================================================
group('summarizeByKaryotype');

const vals = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const kary = ['STD/STD','STD/STD','STD/STD','HET','HET','HET','INV/INV','INV/INV','INV/INV'];
const sum = summarizeByKaryotype(vals, kary);
check('STD/STD: n=3',                sum['STD/STD'].n === 3);
check('STD/STD: median = 0.2',       Math.abs(sum['STD/STD'].median - 0.2) < 1e-9);
check('HET:    median = 0.5',        Math.abs(sum['HET'].median     - 0.5) < 1e-9);
check('INV/INV: median = 0.8',       Math.abs(sum['INV/INV'].median - 0.8) < 1e-9);
check('IQR returned as 2-tuple',     Array.isArray(sum['STD/STD'].iqr) && sum['STD/STD'].iqr.length === 2);

// Sample with no karyotype is excluded
const sum_drop = summarizeByKaryotype(
  [0.1, 0.2, 0.3, 0.4],
  ['STD/STD', null, 'STD/STD', 'STD/STD'],
);
check('null karyotype dropped',      sum_drop['STD/STD'].n === 3);

// =====================================================================
group('pairwiseWilcoxonByKaryotype');

// std/std < het < inv/inv with clear separation → pairs significant
const pw = pairwiseWilcoxonByKaryotype(
  [0.1, 0.11, 0.12, 0.13, 0.14, 0.5, 0.51, 0.52, 0.53, 0.54, 1.0, 1.01, 1.02, 1.03, 1.04],
  ['STD/STD','STD/STD','STD/STD','STD/STD','STD/STD',
   'HET','HET','HET','HET','HET',
   'INV/INV','INV/INV','INV/INV','INV/INV','INV/INV'],
);
check('std_vs_inv p tiny',             pw.std_vs_inv.wilcoxon_p < 0.05);
check('std_vs_inv delta > 0',          pw.std_vs_inv.delta_median > 0);
check('het_vs_inv delta > 0',          pw.het_vs_inv.delta_median > 0);

// =====================================================================
group('classifyMetricVerdict');

// neutral via high KW p
const v_neutral = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 10, median: 0.5, iqr: [0.4, 0.6] },
            'HET':     { n: 10, median: 0.5, iqr: [0.4, 0.6] },
            'INV/INV': { n: 10, median: 0.5, iqr: [0.4, 0.6] } },
  kw_p: 0.50,
  pairwise: { std_vs_inv: { wilcoxon_p: 0.5, delta_median: 0 },
              std_vs_het: { wilcoxon_p: 0.5, delta_median: 0 },
              het_vs_inv: { wilcoxon_p: 0.5, delta_median: 0 } },
});
check('high KW p → neutral',           v_neutral === FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL);

// neutral via ±10% medians (KW happened to fire but medians are close)
const v_close = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 50, median: 1.00, iqr: [0.9, 1.1] },
            'HET':     { n: 50, median: 1.05, iqr: [0.95, 1.15] },
            'INV/INV': { n: 50, median: 1.02, iqr: [0.92, 1.12] } },
  kw_p: 0.01,
  pairwise: { std_vs_inv: { wilcoxon_p: 0.01, delta_median: 0.02 },
              std_vs_het: { wilcoxon_p: 0.01, delta_median: 0.05 },
              het_vs_inv: { wilcoxon_p: 0.01, delta_median: -0.03 } },
});
check('medians within ±10% → neutral', v_close === FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL);

// underpowered (n < 5)
const v_under = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 4, median: 0.5, iqr: [0.4, 0.6] },
            'HET':     { n: 10, median: 0.5, iqr: [0.4, 0.6] },
            'INV/INV': { n: 10, median: 0.5, iqr: [0.4, 0.6] } },
  kw_p: 0.01,
  pairwise: {},
});
check('n < 5 → underpowered',          v_under === FUNCTIONAL_BURDEN_VERDICTS.UNDERPOWERED);

// inv_elevated
const v_elev = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 10, median: 0.10, iqr: [0.05, 0.15] },
            'HET':     { n: 10, median: 0.40, iqr: [0.30, 0.50] },
            'INV/INV': { n: 10, median: 0.80, iqr: [0.70, 0.90] } },
  kw_p: 0.001,
  pairwise: { std_vs_inv: { wilcoxon_p: 0.001, delta_median: +0.70 },
              std_vs_het: { wilcoxon_p: 0.01,  delta_median: +0.30 },
              het_vs_inv: { wilcoxon_p: 0.01,  delta_median: +0.40 } },
});
check('INV>STD significantly → inv_elevated',  v_elev === FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED);

// inv_depleted
const v_depl = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 10, median: 0.80, iqr: [0.70, 0.90] },
            'HET':     { n: 10, median: 0.40, iqr: [0.30, 0.50] },
            'INV/INV': { n: 10, median: 0.10, iqr: [0.05, 0.15] } },
  kw_p: 0.001,
  pairwise: { std_vs_inv: { wilcoxon_p: 0.001, delta_median: -0.70 },
              std_vs_het: { wilcoxon_p: 0.01,  delta_median: -0.40 },
              het_vs_inv: { wilcoxon_p: 0.01,  delta_median: -0.30 } },
});
check('INV<STD significantly → inv_depleted',  v_depl === FUNCTIONAL_BURDEN_VERDICTS.INV_DEPLETED);

// heterosis_like — HET lowest
const v_het = classifyMetricVerdict({
  groups: { 'STD/STD': { n: 10, median: 0.50, iqr: [0.40, 0.60] },
            'HET':     { n: 10, median: 0.10, iqr: [0.05, 0.15] },
            'INV/INV': { n: 10, median: 0.45, iqr: [0.35, 0.55] } },
  kw_p: 0.001,
  pairwise: { std_vs_inv: { wilcoxon_p: 0.50, delta_median: -0.05 },
              std_vs_het: { wilcoxon_p: 0.01, delta_median: -0.40 },
              het_vs_inv: { wilcoxon_p: 0.01, delta_median: +0.35 } },
});
check('HET lowest → heterosis_like',   v_het === FUNCTIONAL_BURDEN_VERDICTS.HETEROSIS_LIKE);

// =====================================================================
group('compositeSummaryTag');

const allElev = {
  pi_n_pi_s:   { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED },
  vesm_burden: { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED },
  lof_burden:  { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED },
  roh_overlap: { verdict: FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL },
};
check('3 of 4 elevated → load_rich',  compositeSummaryTag(allElev) === FUNCTIONAL_BURDEN_TAGS.LOAD_RICH);

const allNeut = {
  pi_n_pi_s:   { verdict: FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL },
  vesm_burden: { verdict: FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL },
  lof_burden:  { verdict: FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL },
  roh_overlap: { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED },
};
check('3 of 4 neutral → clean',       compositeSummaryTag(allNeut) === FUNCTIONAL_BURDEN_TAGS.CLEAN);

const split = {
  pi_n_pi_s:   { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED },
  vesm_burden: { verdict: FUNCTIONAL_BURDEN_VERDICTS.INV_DEPLETED },
  lof_burden:  { verdict: FUNCTIONAL_BURDEN_VERDICTS.NEUTRAL },
  roh_overlap: { verdict: FUNCTIONAL_BURDEN_VERDICTS.MIXED },
};
check('split signals → mixed tag',    compositeSummaryTag(split) === FUNCTIONAL_BURDEN_TAGS.MIXED);

check('empty per_metric → mixed tag', compositeSummaryTag({}) === FUNCTIONAL_BURDEN_TAGS.MIXED);

// =====================================================================
group('summarizeCandidateFunctionalBurden — integration');

// Build a 6-sample cohort, 2 windows per candidate, two metrics
// (pi and vesm_burden). std (s0,s1) < het (s2,s3) < inv (s4,s5).
function mkLayer(rows) {
  return rows.map((vals, i) => ({
    start_bp: i * 500_000,
    end_bp:   (i + 1) * 500_000,
    per_sample_values: vals,
  }));
}
// Fewer samples than min_group_n = 5 → underpowered verdicts.
// Build a 30-sample cohort: 10 STD, 10 HET, 10 INV with clear separation
const N = 30;
const std_v = (i) => 0.10 + 0.005 * i;   // 0.10 .. 0.145
const het_v = (i) => 0.30 + 0.005 * i;   // 0.30 .. 0.345
const inv_v = (i) => 0.60 + 0.005 * i;   // 0.60 .. 0.645
const window1 = new Array(N), window2 = new Array(N);
const karyo = new Array(N);
for (let i = 0; i < 10; i++) { window1[i] = std_v(i);     window2[i] = std_v(i) + 0.01; karyo[i] = 'STD/STD'; }
for (let i = 0; i < 10; i++) { window1[10+i] = het_v(i);  window2[10+i] = het_v(i) + 0.01; karyo[10+i] = 'HET'; }
for (let i = 0; i < 10; i++) { window1[20+i] = inv_v(i);  window2[20+i] = inv_v(i) + 0.01; karyo[20+i] = 'INV/INV'; }
const layers = {
  pi:          mkLayer([window1, window2]),
  vesm_burden: mkLayer([window1, window2]),
};
const candidate = {
  candidate_id: 'INV_LG14_002',
  chrom: 'LG14',
  start_bp: 0, end_bp: 1_000_000,
  inversion_type: 'pericentric',
};
const result = summarizeCandidateFunctionalBurden(candidate, layers, karyo);
check('output candidate_id preserved',   result.candidate_id === 'INV_LG14_002');
check('output inversion_type preserved', result.inversion_type === 'pericentric');
check('output module_version present',   result.module_version === FUNCTIONAL_BURDEN_MODULE_VERSION);
check('per_metric.pi present',           !!result.per_metric.pi);
check('per_metric.pi has groups',        !!result.per_metric.pi.groups);
check('per_metric.pi.n_windows = 2',     result.per_metric.pi.n_windows === 2);
check('per_metric.pi.kw_p tiny',         result.per_metric.pi.kw_p < 0.001);
check('per_metric.pi.verdict = inv_elevated',
      result.per_metric.pi.verdict === FUNCTIONAL_BURDEN_VERDICTS.INV_ELEVATED);
check('warning emitted for missing pi_n_pi_s layer',
      result.warnings.some(w => w.includes('pi_n_pi_s')));
check('warning emitted for missing lof_burden layer',
      result.warnings.some(w => w.includes('lof_burden')));
check('missing-layer per_metric row = underpowered',
      result.per_metric.lof_burden.verdict === FUNCTIONAL_BURDEN_VERDICTS.UNDERPOWERED);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
