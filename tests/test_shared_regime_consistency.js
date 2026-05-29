// tests/test_shared_regime_consistency.js
// Smoke tests for shared/mgl_regime_consistency.js.

import {
  perBandDosageMean,
  heterozygoteBandPresent,
  dosageTierCounts,
  majorBandPattern,
  longRangeSupportWindows,
  meanCramersVAcrossWindows,
  perWindowSeedAgreement,
  sampleRegimeCalls,
  persistenceBucket,
  regimeClass,
  confidenceScore,
  summarizeLocus,
  buildRegimeTables,
  rowsToTsv,
  supportScore,
  REGIME_CLASSES,
  SAMPLE_REGIME_CALLS,
  PERSISTENCE_BUCKETS,
} from '../atlases/inversion/shared/mgl_regime_consistency.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else      { console.log('  ✗ ' + name); fail++; }
}
function close(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

// ---------------------------------------------------------------------
// Fixture: 12 samples, K=3, 4 windows.
//   ref assignment (per_band_samples):
//     band 0 (homA): samples 0..3   (dosage ~ 0.05)
//     band 1 (het):  samples 4..7   (dosage ~ 1.0)
//     band 2 (homB): samples 8..11  (dosage ~ 1.95)
//   labels by window:
//     w=0..2: identical to ref (perfect persistence)
//     w=3:    sample 0 jumps to band 1 (one defector)
// ---------------------------------------------------------------------

const nS = 12;
const refLabels = Int32Array.from([0,0,0,0, 1,1,1,1, 2,2,2,2]);
const w3Labels  = Int32Array.from([1,0,0,0, 1,1,1,1, 2,2,2,2]); // sample 0 moves

const labelsByWindow = {
  0: refLabels, 1: refLabels, 2: refLabels, 3: w3Labels,
};
const ctx = {
  n_samples: nS,
  n_windows: 4,
  getLabels: (w) => labelsByWindow[w] || null,
  getK: () => 3,
};

const dosage = new Float64Array([
  0.02, 0.05, 0.10, 0.00,
  0.95, 1.00, 1.05, 0.98,
  1.94, 2.00, 1.90, 1.97,
]);

const perBandSamples = [
  new Set([0,1,2,3]),
  new Set([4,5,6,7]),
  new Set([8,9,10,11]),
];

const locus = {
  K: 3,
  s_window: 0,
  e_window: 3,
  per_band_samples: perBandSamples,
  chromosome_idx: 0,
  seed_id: 'seed_LG12_01',
};

console.log('\n=== mgl_regime_consistency ===');

// 1. Per-band dosage mean
console.log('\n[perBandDosageMean]');
const pbDos = perBandDosageMean(locus, dosage);
ok(close(pbDos[0], 0.0425, 1e-6),    'homA band mean ≈ 0.04');
ok(close(pbDos[1], 0.995,  1e-6),    'het  band mean ≈ 1.00');
ok(close(pbDos[2], 1.9525, 1e-6),    'homB band mean ≈ 1.95');

// 2. heterozygoteBandPresent
console.log('\n[heterozygoteBandPresent]');
ok(heterozygoteBandPresent(pbDos) === true,    'het band detected');
ok(heterozygoteBandPresent(Float64Array.from([0.1, 2.0])) === false,
   'no het band when none in [0.6, 1.4]');

// 3. dosageTierCounts
console.log('\n[dosageTierCounts]');
const tier = dosageTierCounts(dosage, [0,1,2,3,4,5,6,7,8,9,10,11]);
ok(tier.homA === 4, 'homA = 4');
ok(tier.het  === 4, 'het  = 4');
ok(tier.homB === 4, 'homB = 4');

// 4. majorBandPattern
console.log('\n[majorBandPattern]');
const mp = majorBandPattern(locus);
ok(mp.total === 12,           'pattern total = 12');
ok(mp.pattern.split('|').length === 3, 'pattern has 3 segments');
ok(mp.sorted[0].n === 4,      'top band has 4 samples');

// 5. perWindowSeedAgreement
console.log('\n[perWindowSeedAgreement]');
const winRows = perWindowSeedAgreement(locus, ctx);
ok(winRows.length === 4,              'one row per window');
ok(close(winRows[0].agreement, 1, 1e-9),'seed window has agreement = 1');
ok(close(winRows[1].agreement, 1, 1e-9),'w=1 still agreement = 1');
ok(close(winRows[3].agreement, 11/12, 1e-9),
   'w=3 agreement = 11/12 (one defector)');
ok(winRows[3].is_supported === true,  'w=3 still supported at default thresholds');
ok(winRows[0].cramers_v >= 0.99,      'seed window cramers_v ≈ 1');

// 6. longRangeSupportWindows (kept for compat)
console.log('\n[longRangeSupportWindows]');
const sup = longRangeSupportWindows(locus, ctx);
ok(sup.n_windows === 4,               'span = 4 windows');
ok(sup.support_windows >= 3,          'most windows support the locus');

// 7. meanCramersVAcrossWindows
console.log('\n[meanCramersVAcrossWindows]');
const vSt = meanCramersVAcrossWindows(locus, ctx);
ok(vSt.n_pairs === 3,                 '3 adjacent pairs');
ok(vSt.mean_cramers_v >= 0.85,        'high mean V');

// 8. sampleRegimeCalls
console.log('\n[sampleRegimeCalls]');
const calls = sampleRegimeCalls({ locus, ctx, dosage_per_sample: dosage });
ok(calls.length === 12,               'one call per assigned sample');
const byIdx = Object.fromEntries(calls.map(c => [c.sample_idx, c]));
ok(byIdx[1].regime_call === 'homA_like', 'sample 1 → homA_like');
ok(byIdx[5].regime_call === 'het_like',  'sample 5 → het_like');
ok(byIdx[9].regime_call === 'homB_like', 'sample 9 → homB_like');
// Sample 0 is the defector at w=3 → 3/4 support fraction → not uncertain (≥ 0.5)
ok(byIdx[0].regime_call === 'homA_like', 'defector at one window stays homA_like');
ok(close(byIdx[0].fraction_windows_supporting_call, 3/4, 1e-9),
   'defector support fraction = 0.75');
ok(SAMPLE_REGIME_CALLS.includes(byIdx[0].regime_call), 'call vocab valid');

// Force an uncertain via a low-support defector.
const locusUnc = Object.assign({}, locus, { e_window: 3 });
const labelsAllOff = {
  0: refLabels,
  1: w3Labels,   // sample 0 off
  2: w3Labels,   // sample 0 off
  3: w3Labels,   // sample 0 off
};
const ctxUnc = { n_samples: nS, n_windows: 4, getLabels: (w) => labelsAllOff[w] };
const callsUnc = sampleRegimeCalls({ locus: locusUnc, ctx: ctxUnc,
                                     dosage_per_sample: dosage });
const sample0Unc = callsUnc.find(c => c.sample_idx === 0);
ok(sample0Unc.regime_call === 'uncertain',
   'sample 0 → uncertain when support fraction < 0.5');

// 9. persistenceBucket
console.log('\n[persistenceBucket]');
ok(persistenceBucket(   500_000) === 'local',            '500kb → local');
ok(persistenceBucket( 5_000_000) === 'regional',         '5Mb  → regional');
ok(persistenceBucket(20_000_000) === 'long_range',       '20Mb → long_range');
ok(persistenceBucket(80_000_000) === 'chromosome_scale', '80Mb → chromosome_scale');
ok(persistenceBucket(NaN) === null,                      'NaN → null');
ok(PERSISTENCE_BUCKETS.length === 4, 'four persistence buckets defined');

// 10. regimeClass
console.log('\n[regimeClass]');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.9, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 3, active_band_count: 3,
                 heterozygote_band_present: true })
   === 'stable_three_band_regime',  'K=3 + V high + sup high + het → stable_three');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.9, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 2, active_band_count: 2 })
   === 'stable_two_band_regime',    'K=2 high V + sup → stable_two');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.9, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 5, active_band_count: 4 })
   === 'nested_multiband_regime',   'K=5 high V + sup → nested');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.2, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 3 })
   === 'split_regime',              'high V low support → split');
ok(regimeClass({ mean_cramers_v: 0.10, support_fraction: 0.2, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 3 })
   === 'diffuse_regime',            'low V → diffuse');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.9, n_windows: 1,
                 n_pairs: 50, n_samples: 200, n_bands: 3 })
   === 'low_confidence_regime',     'too few windows → low_confidence');
ok(regimeClass({ mean_cramers_v: 0.9, support_fraction: 0.9, n_windows: 100,
                 n_pairs: 50, n_samples: 200, n_bands: 3,
                 possible_ancestry_confounding: true })
   === 'ancestry_confounded_regime','ancestry flag dominates');
ok(REGIME_CLASSES.length === 7,    'seven regime classes defined');

// 11. confidenceScore
console.log('\n[confidenceScore]');
const c1 = confidenceScore({ mean_cramers_v: 1, support_fraction: 1,
                              n_windows: 100, n_samples: 200 });
ok(c1 > 0.8 && c1 <= 1,            'high inputs → high confidence');
const c0 = confidenceScore({ mean_cramers_v: 0, support_fraction: 0,
                              n_windows: 1, n_samples: 1 });
ok(c0 >= 0 && c0 < 0.2,            'low inputs → low confidence');

// 12. summarizeLocus
console.log('\n[summarizeLocus]');
const row = summarizeLocus({
  locus, ctx, dosage_per_sample: dosage,
  candidate: { id: 'cand_A', chrom: 'LG12', start_bp: 12_000_000, end_bp: 28_000_000 },
});
ok(row.candidate_id === 'cand_A',          'candidate_id set');
ok(row.chrom === 'LG12',                   'chrom set');
ok(row.n_samples === 12,                   'n_samples = 12');
ok(row.n_bands === 3,                      'n_bands = 3');
ok(row.homA_count === 4 && row.het_count === 4 && row.homB_count === 4,
   'sample tier counts correct');
ok(row.heterozygote_band_present === true, 'het band present');
ok(row.regime_class === 'stable_three_band_regime',
   'regime class = stable_three_band_regime');
ok(row.persistence_bucket === 'long_range','16Mb → long_range');
ok(row.confidence > 0 && row.confidence <= 1, 'confidence in (0, 1]');

// 13. supportScore
console.log('\n[supportScore]');
const ss = supportScore(row);
ok(ss >= 0 && ss <= 1, 'support score in [0, 1]');

// 14. buildRegimeTables
console.log('\n[buildRegimeTables]');
const result = { stage3: { loci: [locus] } };
const sample_ids = Array.from({length:12}, (_,i) => `S${i}`);
const tables = buildRegimeTables({
  result, ctx, dosage_per_sample: dosage, sample_ids,
  candidates: [{ id: 'cand_A', chrom: 'LG12',
                  start_bp: 12_000_000, end_bp: 28_000_000 }],
});
ok(tables.candidate_regime_summary.length === 1, 'one candidate row');
ok(tables.sample_regime_calls.length === 12,     '12 sample-call rows');
ok(tables.window_regime_support.length === 4,    '4 window rows');
ok(tables.regime_qc_summary.length === 1,        'one QC row');
ok(tables.sample_regime_calls[0].sample_id === 'S0', 'sample_id mapped from sample_ids');

// 15. regime_assignment override (groups, not raw K-bands)
console.log('\n[regime_assignment override]');
// Merge K=3 bands {0,1} into one regime group, leave band 2 as second.
// Net regime grouping: {0..7} -> group 0, {8..11} -> group 1
const mergedAssign = Int32Array.from([0,0,0,0, 0,0,0,0, 1,1,1,1]);
const rowMerged = summarizeLocus({
  locus, ctx, dosage_per_sample: dosage,
  candidate: { id: 'cand_merge', chrom: 'LG12',
                start_bp: 12_000_000, end_bp: 28_000_000 },
  opts: { regime_assignment: mergedAssign, n_groups: 2 },
});
ok(rowMerged.n_samples === 12, 'merged: still 12 samples');
ok(rowMerged.regime_class !== 'stable_three_band_regime',
   'merged: regime class differs from K=3 version');
// Sample calls reflect the merged grouping
const mergedCalls = sampleRegimeCalls({
  locus, ctx, dosage_per_sample: dosage,
  opts: { regime_assignment: mergedAssign, n_groups: 2 },
});
const mergedBandIds = new Set(mergedCalls.map(c => c.band_id));
ok(mergedBandIds.size === 2 && mergedBandIds.has(0) && mergedBandIds.has(1),
   'merged: only 2 distinct group ids in sample calls');
// Same effect via regime_merger
const rowMerger = summarizeLocus({
  locus, ctx, dosage_per_sample: dosage,
  candidate: { id: 'cand_merger', chrom: 'LG12',
                start_bp: 12_000_000, end_bp: 28_000_000 },
  opts: { regime_merger: [0, 0, 1] },
});
ok(rowMerger.regime_class !== 'stable_three_band_regime',
   'regime_merger: collapses K=3 to 2 groups');

// 16. rowsToTsv
console.log('\n[rowsToTsv]');
const tsv = rowsToTsv(tables.candidate_regime_summary);
ok(tsv.indexOf('candidate_id\t') === 0,    'header starts with candidate_id');
ok(tsv.indexOf('cand_A') > 0,              'row contains cand_A');
ok(tsv.endsWith('\n'),                     'trailing newline');
const tsvEmpty = rowsToTsv([]);
ok(tsvEmpty === '',                        'empty input → empty string');

// Final
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
if (fail > 0) process.exit(1);
