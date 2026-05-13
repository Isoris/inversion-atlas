// tests/test_shared_band_tracking_calibration.js
//
// Unit coverage for the three calibration functions added across
// regime_dyad_mendelian.js + regime_linkage.js + regime_pedigree.js.
// Also covers shared/stats_helpers.js#percentile.

import { percentile } from '../atlases/inversion/shared/stats_helpers.js';
import {
  calibrateMeioticDriveBands,
} from '../atlases/inversion/shared/band_tracking/regime_dyad_mendelian.js';
import {
  calibrateLinkageThresholdsFromCrossChrom,
} from '../atlases/inversion/shared/band_tracking/regime_linkage.js';
import {
  calibratePedigreeThresholdsFromKnownPairs,
  REGIME_PEDIGREE_DEFAULTS,
} from '../atlases/inversion/shared/band_tracking/regime_pedigree.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('percentile');

check('median of [1..9] = 5',         percentile([1, 2, 3, 4, 5, 6, 7, 8, 9], 0.5) === 5);
check('2.5 % of [0..100] ≈ 2.5',
      approx(percentile([0, 25, 50, 75, 100], 0.025), 2.5, 0.5));
check('97.5 % of [0..100] ≈ 97.5',
      approx(percentile([0, 25, 50, 75, 100], 0.975), 97.5, 0.5));
check('linear interpolation [0, 10] @ 0.5 = 5',
      percentile([0, 10], 0.5) === 5);
check('p=0 → min',                    percentile([5, 1, 9, 3], 0) === 1);
check('p=1 → max',                    percentile([5, 1, 9, 3], 1) === 9);
check('NaNs skipped',
      percentile([NaN, 1, 2, NaN, 3], 0.5) === 2);
check('-1 sentinel skipped',
      percentile([-1, 1, 2, 3, -1, 4, 5], 0.5) === 3);
check('empty → NaN',                  Number.isNaN(percentile([], 0.5)));
check('null → NaN',                   Number.isNaN(percentile(null, 0.5)));
check('p out of range → NaN',         Number.isNaN(percentile([1, 2], -0.1))
                                       && Number.isNaN(percentile([1, 2], 1.5)));
check('single value → that value',    percentile([7], 0.5) === 7);

// =====================================================================
group('calibrateMeioticDriveBands — sufficient regimes');

// 30 regimes, transmission_ratio_A clustered around 0.5 with some
// outliers at 0.65 and 0.30 → empirical 95% CI should be near
// [~0.35, ~0.65].
const annotations_clean = [];
for (let i = 0; i < 25; i++) {
  annotations_clean.push({
    transmission: {
      transmission_ratio_A: 0.45 + (i % 10) * 0.01,   // 0.45 .. 0.54
      n_informative_transmissions: 50,
    },
  });
}
// Two extreme drivers
annotations_clean.push({ transmission: { transmission_ratio_A: 0.20, n_informative_transmissions: 50 } });
annotations_clean.push({ transmission: { transmission_ratio_A: 0.80, n_informative_transmissions: 50 } });
annotations_clean.push({ transmission: { transmission_ratio_A: 0.18, n_informative_transmissions: 50 } });
annotations_clean.push({ transmission: { transmission_ratio_A: 0.82, n_informative_transmissions: 50 } });

const cal_mei = calibrateMeioticDriveBands(annotations_clean);
check('ok = true',                    cal_mei.ok === true);
check('n_regimes_used = 29',          cal_mei.n_regimes_used === 29);
check('mendelian_band is an array of 2',
      Array.isArray(cal_mei.mendelian_band) && cal_mei.mendelian_band.length === 2);
check('mendelian_band[0] < mendelian_band[1]',
      cal_mei.mendelian_band[0] < cal_mei.mendelian_band[1]);
check('mendelian_band contains 0.5 (most regimes are clean)',
      cal_mei.mendelian_band[0] <= 0.5 && cal_mei.mendelian_band[1] >= 0.5);
check('mild_drive_band wider than mendelian_band',
      cal_mei.mild_drive_band[0] <= cal_mei.mendelian_band[0]
      && cal_mei.mild_drive_band[1] >= cal_mei.mendelian_band[1]);
check('strong_drive_band = [0.10, 0.90] (fixed)',
      cal_mei.strong_drive_band[0] === 0.10
      && cal_mei.strong_drive_band[1] === 0.90);
check('median_ratio close to 0.5',     approx(cal_mei.median_ratio, 0.5, 0.05));

// =====================================================================
group('calibrateMeioticDriveBands — insufficient');

const cal_short = calibrateMeioticDriveBands([
  { transmission: { transmission_ratio_A: 0.5, n_informative_transmissions: 50 } },
]);
check('< min_regimes → ok = false',   cal_short.ok === false);
check('reason = insufficient_regimes', cal_short.reason === 'insufficient_regimes');
check('n_regimes_with_data echoed',    cal_short.n_regimes_with_data === 1);

// Mix with too-few-dyads regimes
const cal_mixed = calibrateMeioticDriveBands([
  { transmission: { transmission_ratio_A: 0.5, n_informative_transmissions: 3 } },
  { transmission: { transmission_ratio_A: 0.5, n_informative_transmissions: 5 } },
], { min_dyads_per_regime: 10 });
check('regimes with too few dyads excluded',
      cal_mixed.ok === false
      && cal_mixed.n_regimes_with_data === 0);

// Null input
check('null → ok = false',            calibrateMeioticDriveBands(null).ok === false);

// =====================================================================
group('calibrateLinkageThresholdsFromCrossChrom — sufficient');

// 12 regimes: 6 on chr1, 6 on chr2. Cross-chrom pairs = 36.
// Build regimes where samples are IDENTICAL across regimes within a
// chrom (so intra-chrom V = 1) but RANDOM across chroms (so cross-
// chrom V should be moderate from population structure).
function mkRegime(id, chrom, homA, homB, het) {
  return {
    regime_id: id, regime_uid: chrom + ':' + id, chrom,
    hom_a_intersect: new Set(homA),
    hom_b_intersect: new Set(homB),
    het_union:       new Set(het),
    start_bp: 0, end_bp: 1e6, n_intervals: 1,
  };
}

// Build 60 samples; on chr1 each regime is uniform (sample i goes to
// AA if i<20, AB if 20≤i<40, BB if i≥40). On chr2 the pattern is
// shifted by a hash so cross-chrom V is small.
const regimes_cal = [];
for (let r = 0; r < 6; r++) {
  const a = [], b = [], h = [];
  for (let i = 0; i < 60; i++) {
    if (i < 20) a.push(i);
    else if (i < 40) h.push(i);
    else b.push(i);
  }
  regimes_cal.push(mkRegime(r, 'chr1', a, b, h));
}
// chr2: each regime randomises the assignment using a per-regime seed
for (let r = 6; r < 12; r++) {
  const a = [], b = [], h = [];
  for (let i = 0; i < 60; i++) {
    // deterministic but non-trivially permuted per (i, r-6)
    const code = ((i * 7 + (r - 6) * 13) % 60) % 3;
    if (code === 0) a.push(i);
    else if (code === 1) h.push(i);
    else b.push(i);
  }
  regimes_cal.push(mkRegime(r, 'chr2', a, b, h));
}
const sample_list_cal = Array.from({ length: 60 }, (_, i) => i);

const cal_link = calibrateLinkageThresholdsFromCrossChrom(regimes_cal, sample_list_cal);
check('ok = true',                    cal_link.ok === true);
check('n_cross_chrom_pairs_used = 36', cal_link.n_cross_chrom_pairs_used === 36);
check('linked_above ∈ [0, 1]',
      Number.isFinite(cal_link.linked_above)
      && cal_link.linked_above >= 0 && cal_link.linked_above <= 1);
check('weakly_linked_above ≤ linked_above',
      cal_link.weakly_linked_above <= cal_link.linked_above);

// =====================================================================
group('calibrateLinkageThresholdsFromCrossChrom — insufficient');

// Only one regime per chrom → only 1 cross-chrom pair available
const cal_link_short = calibrateLinkageThresholdsFromCrossChrom(
  [regimes_cal[0], regimes_cal[6]],
  sample_list_cal, { min_cross_chrom_pairs: 10 });
check('< min_cross_chrom_pairs → ok=false', cal_link_short.ok === false);
check('reason = insufficient_cross_chrom_pairs',
      cal_link_short.reason === 'insufficient_cross_chrom_pairs');

// Same-chrom-only → 0 cross-chrom pairs
const cal_link_same = calibrateLinkageThresholdsFromCrossChrom(
  regimes_cal.slice(0, 6), sample_list_cal);
check('same-chrom only → ok=false',   cal_link_same.ok === false);

check('null → ok=false',
      calibrateLinkageThresholdsFromCrossChrom(null, sample_list_cal).ok === false);

// =====================================================================
group('calibratePedigreeThresholdsFromKnownPairs — sufficient');

// Build regimes where samples 0..9 are FIRST-DEGREE relatives (share
// HOM_A across all 20 regimes), samples 100..109 are UNRELATED
// (random assignments across regimes).
const regimes_ped = [];
for (let r = 0; r < 20; r++) {
  const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];   // 1st-degree group
  const b = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const h = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  // Unrelated samples 100..109 — random per-regime
  for (let i = 100; i < 110; i++) {
    const code = ((i * 7 + r * 13) % 60) % 3;
    if (code === 0) a.push(i);
    else if (code === 1) h.push(i);
    else b.push(i);
  }
  regimes_ped.push({
    regime_id: r,
    hom_a_intersect: new Set(a),
    hom_b_intersect: new Set(b),
    het_union:       new Set(h),
  });
}

// Known pairs:
//   - 5 pairs of 1st-degree: e.g. (0,1), (2,3), (4,5), (6,7), (8,9)
//   - 5 pairs of unrelated: (100,101), (102,103), ...
const known_pairs = [
  { sample_a: 0, sample_b: 1, relationship_class: '1st_degree' },
  { sample_a: 2, sample_b: 3, relationship_class: '1st_degree' },
  { sample_a: 4, sample_b: 5, relationship_class: '1st_degree' },
  { sample_a: 6, sample_b: 7, relationship_class: '1st_degree' },
  { sample_a: 8, sample_b: 9, relationship_class: '1st_degree' },
  { sample_a: 100, sample_b: 101, relationship_class: 'unrelated' },
  { sample_a: 102, sample_b: 103, relationship_class: 'unrelated' },
  { sample_a: 104, sample_b: 105, relationship_class: 'unrelated' },
  { sample_a: 106, sample_b: 107, relationship_class: 'unrelated' },
  { sample_a: 108, sample_b: 109, relationship_class: 'unrelated' },
];

const cal_ped = calibratePedigreeThresholdsFromKnownPairs(known_pairs, regimes_ped);
check('ok = true',                    cal_ped.ok === true);
check('1st_degree bucket has 5',      cal_ped.bucket_counts.first_degree === 5);
check('unrelated bucket has 5',
      cal_ped.bucket_counts.unrelated_or_distant === 5);
check('median(1st_degree) high',      cal_ped.medians.first_degree > 0.8);
check('median(unrelated) low',         cal_ped.medians.unrelated < 0.6);
check('first_degree_above between the two medians',
      cal_ped.first_degree_above > cal_ped.medians.unrelated
      && cal_ped.first_degree_above < cal_ped.medians.first_degree);
// Missing bucket: duplicate_or_identical → falls back to default
check('duplicate_above falls back to default when bucket empty',
      cal_ped.duplicate_above === REGIME_PEDIGREE_DEFAULTS.duplicate_above);

// =====================================================================
group('calibratePedigreeThresholdsFromKnownPairs — insufficient');

const cal_ped_short = calibratePedigreeThresholdsFromKnownPairs(
  [{ sample_a: 0, sample_b: 1, relationship_class: '1st_degree' }],
  regimes_ped);
check('< min_pairs_per_class → ok=false',  cal_ped_short.ok === false);
check('reason = insufficient_known_pairs',
      cal_ped_short.reason === 'insufficient_known_pairs');
check('bucket_counts echoed',
      cal_ped_short.bucket_counts.first_degree === 1);

// Unknown relationship_class strings ignored
const cal_ped_bad = calibratePedigreeThresholdsFromKnownPairs(
  Array.from({ length: 10 }, (_, i) => ({
    sample_a: i, sample_b: i + 1, relationship_class: 'whatever',
  })), regimes_ped);
check('unknown class ignored → ok=false', cal_ped_bad.ok === false);

check('null known_pairs → ok=false',
      calibratePedigreeThresholdsFromKnownPairs(null, regimes_ped).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
