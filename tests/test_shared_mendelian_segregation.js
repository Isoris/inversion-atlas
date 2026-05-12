// tests/test_shared_mendelian_segregation.js
//
// Unit coverage for shared/mendelian_segregation.js — chi-square
// Mendelian goodness-of-fit + recombination-rate estimation + SPEC
// §5/§6/§7 verdict composition.

import {
  MENDELIAN_RATIOS,
  CROSS_TO_RATIO,
  SEGREGATION_STATUS,
  EFFECT_DIRECTION,
  DEFAULT_ALPHA,
  DEFAULT_MIN_OFFSPRING,
  resolveRatio,
  mendelianChiSquare,
  estimateRecombinationRate,
  effectDirection,
  assessSegregation,
  buildParaPeriContingency,
} from '../atlases/inversion/shared/mendelian_segregation.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-3); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + constants');

check('MENDELIAN_RATIOS frozen',
      Object.isFrozen(MENDELIAN_RATIOS));
check('MENDELIAN_RATIOS["1:2:1"] = [0.25, 0.5, 0.25]',
      MENDELIAN_RATIOS['1:2:1'][0] === 0.25
      && MENDELIAN_RATIOS['1:2:1'][1] === 0.5
      && MENDELIAN_RATIOS['1:2:1'][2] === 0.25);
check('MENDELIAN_RATIOS["1:1"] = [0.5, 0.5]',
      MENDELIAN_RATIOS['1:1'][0] === 0.5
      && MENDELIAN_RATIOS['1:1'][1] === 0.5);
check('MENDELIAN_RATIOS["3:1"] = [0.75, 0.25]',
      MENDELIAN_RATIOS['3:1'][0] === 0.75
      && MENDELIAN_RATIOS['3:1'][1] === 0.25);
check('MENDELIAN_RATIOS["9:3:3:1"] sums to 1',
      Math.abs(MENDELIAN_RATIOS['9:3:3:1']
        .reduce((a, b) => a + b, 0) - 1) < 1e-9);
check('CROSS_TO_RATIO frozen',
      Object.isFrozen(CROSS_TO_RATIO));
check('AB x AB → 1:2:1',
      CROSS_TO_RATIO['AB_x_AB'] === '1:2:1');
check('AA x AB → 1:1',
      CROSS_TO_RATIO['AA_x_AB'] === '1:1');
check('AA x AA → null (uninformative)',
      CROSS_TO_RATIO['AA_x_AA'] === null);
check('SEGREGATION_STATUS frozen',
      Object.isFrozen(SEGREGATION_STATUS));
check('EFFECT_DIRECTION frozen',
      Object.isFrozen(EFFECT_DIRECTION));
check('DEFAULT_ALPHA = 0.05',  DEFAULT_ALPHA === 0.05);
check('DEFAULT_MIN_OFFSPRING = 10', DEFAULT_MIN_OFFSPRING === 10);

// =====================================================================
group('resolveRatio');

check('label "1:2:1" → array',
      Array.isArray(resolveRatio('1:2:1'))
      && resolveRatio('1:2:1').length === 3);
check('label "1:1" → [0.5, 0.5]',
      resolveRatio('1:1')[0] === 0.5
      && resolveRatio('1:1')[1] === 0.5);
check('unknown label → null',
      resolveRatio('foo') === null);
check('array [1,2,1] → normalised [0.25, 0.5, 0.25]',
      (() => {
        const r = resolveRatio([1, 2, 1]);
        return approx(r[0], 0.25) && approx(r[1], 0.5) && approx(r[2], 0.25);
      })());
check('array [9,3,3,1] → 9/16, 3/16, 3/16, 1/16',
      (() => {
        const r = resolveRatio([9, 3, 3, 1]);
        return approx(r[0], 9/16) && approx(r[3], 1/16);
      })());
check('all-zero array → null',
      resolveRatio([0, 0, 0]) === null);
check('negative cell → null',
      resolveRatio([1, -1, 1]) === null);
check('empty → null',
      resolveRatio([]) === null);
check('null → null',
      resolveRatio(null) === null);

// =====================================================================
group('mendelianChiSquare — happy path (1:2:1 fit)');

// SPEC §2.1 first worked example: 8/18/7 vs 1:2:1 (n=33).
// Expected: 8.25, 16.5, 8.25
// chi2 = 0.0625/8.25 + 2.25/16.5 + 1.5625/8.25
//      ≈ 0.00758 + 0.13636 + 0.18939 = 0.3333
// df = 2, p ≈ 0.846 (clearly non-sig)
const f1 = mendelianChiSquare([8, 18, 7], '1:2:1');
check('ok',                       f1.ok === true);
check('df = 2',                   f1.df === 2);
check('n_total = 33',             f1.n_total === 33);
check('chi2 ≈ 0.333',             approx(f1.chi2, 0.3333, 0.01));
check('p_value ≈ 0.846',          approx(f1.p_value, 0.846, 0.02));
check('not significant',          f1.significant === false);
check('expected[0] = 8.25',       approx(f1.expected[0], 8.25));
check('expected[1] = 16.5',       approx(f1.expected[1], 16.5));
check('expected[2] = 8.25',       approx(f1.expected[2], 8.25));
check('observed not aliased',     f1.observed !== undefined
                                   && f1.observed.length === 3);

// =====================================================================
group('mendelianChiSquare — distortion (1:2:1 strong skew)');

// SPEC §2.1 second worked example: 12/30/1 vs 1:2:1 (n=43).
// Expected: 10.75, 21.5, 10.75
// chi2 = 1.5625/10.75 + 72.25/21.5 + 95.0625/10.75
//      ≈ 0.1453 + 3.3605 + 8.8430 = 12.35
// df = 2, p ≈ 0.0021 (significant)
const f2 = mendelianChiSquare([12, 30, 1], '1:2:1');
check('ok',                       f2.ok === true);
check('chi2 ≈ 12.35',             approx(f2.chi2, 12.35, 0.1));
check('p < 0.01',                 f2.p_value < 0.01);
check('p ≈ 0.0021',               approx(f2.p_value, 0.0021, 0.001));
check('significant',              f2.significant === true);

// =====================================================================
group('mendelianChiSquare — 2-class 1:1 perfect fit');

const f3 = mendelianChiSquare([10, 10], '1:1');
check('chi2 = 0 on perfect fit',  f3.chi2 === 0);
check('p_value = 1',              f3.p_value === 1);
check('df = 1',                   f3.df === 1);
check('not significant',          f3.significant === false);

// =====================================================================
group('mendelianChiSquare — 3:1 fit');

// 75:25 observed, 75:25 expected → perfect fit
const f4 = mendelianChiSquare([75, 25], '3:1');
check('3:1 perfect fit: chi2 = 0', f4.chi2 === 0);
check('df = 1',                   f4.df === 1);

// 60:40 observed vs 75:25 expected → skewed
const f5 = mendelianChiSquare([60, 40], '3:1');
check('3:1 distorted: chi2 > 0',  f5.chi2 > 0);
// n=100, exp = [75, 25]; chi2 = 225/75 + 225/25 = 3 + 9 = 12; df=1, p ≈ 0.00053
check('chi2 ≈ 12',                approx(f5.chi2, 12, 0.5));
check('significant at 3:1',       f5.significant === true);

// =====================================================================
group('mendelianChiSquare — error paths');

check('empty observed → ok=false',
      mendelianChiSquare([], '1:2:1').ok === false);
check('unknown ratio → reason=unresolved_ratio',
      mendelianChiSquare([1, 2, 1], 'whatever').reason === 'unresolved_ratio');
check('shape mismatch → ok=false',
      mendelianChiSquare([1, 2, 1, 1], '1:2:1').reason === 'shape_mismatch');
check('negative cell → ok=false',
      mendelianChiSquare([1, -2, 1], '1:2:1').ok === false);
check('zero total → ok=false',
      mendelianChiSquare([0, 0, 0], '1:2:1').reason === 'zero_total');
check('non-array observed → ok=false',
      mendelianChiSquare('foo', '1:2:1').ok === false);
check('low expected cell tagged',
      mendelianChiSquare([1, 0, 0], [1, 2, 1]).expected_low_cells > 0);

// =====================================================================
group('estimateRecombinationRate — testcross');

const tc1 = estimateRecombinationRate({ parental: 90, recombinant: 10 },
                                       'testcross');
check('testcross ok',             tc1.ok === true);
check('r_hat = 0.1',              approx(tc1.r_hat, 0.1));
check('n_total = 100',            tc1.n_total === 100);
// se = sqrt(0.1*0.9/100) = sqrt(0.0009) = 0.03
check('se ≈ 0.03',                approx(tc1.se, 0.03, 0.001));
// 95% CI: 0.1 ± 1.96*0.03 = [0.0412, 0.1588]
check('ci_low ≈ 0.041',           approx(tc1.ci_low, 0.041, 0.005));
check('ci_high ≈ 0.159',          approx(tc1.ci_high, 0.159, 0.005));
check('design = testcross',       tc1.design === 'testcross');

const tc2 = estimateRecombinationRate([50, 50], 'testcross');
check('array shorthand → r=0.5', approx(tc2.r_hat, 0.5));
check('ci_high capped at 0.5',   tc2.ci_high <= 0.5 + 1e-9);

const bc = estimateRecombinationRate({ parental: 45, recombinant: 5 },
                                      'backcross');
check('backcross alias works',    bc.ok === true && approx(bc.r_hat, 0.1));

// Error paths
check('testcross with 3-class → ok=false',
      estimateRecombinationRate([1, 2, 3], 'testcross').ok === false);
check('zero total → ok=false',
      estimateRecombinationRate({ parental: 0, recombinant: 0 },
                                 'testcross').ok === false);
check('NaN counts → ok=false',
      estimateRecombinationRate({ parental: NaN, recombinant: 10 },
                                 'testcross').ok === false);

// =====================================================================
group('estimateRecombinationRate — f2 design');

// Unlinked F2 9:3:3:1 → r ≈ 0.5
const f2_unlinked = estimateRecombinationRate(
  { AB: 9, Ab: 3, aB: 3, ab: 1 }, 'f2');
check('f2 unlinked ok',           f2_unlinked.ok === true);
check('f2 unlinked r ≈ 0.5',      approx(f2_unlinked.r_hat, 0.5, 0.02));

// Tight-linkage F2 (n_ab → n/4 → r=0)
const f2_tight = estimateRecombinationRate(
  { AB: 30, Ab: 5, aB: 5, ab: 16 }, 'f2');
// f_ab = 16/56 = 0.2857. r = 1 - 2*sqrt(0.2857) = 1 - 1.069 = -0.069 → clamped 0
check('f2 tight r clamped to 0',  approx(f2_tight.r_hat, 0, 0.05));

// Mid linkage: n_ab = 9, n = 64 → f_ab = 0.1406, r = 1 - 2*0.375 = 0.25
const f2_mid = estimateRecombinationRate(
  { AB: 40, Ab: 8, aB: 7, ab: 9 }, 'f2');
check('f2 mid: 0 < r < 0.5',
      f2_mid.r_hat > 0 && f2_mid.r_hat < 0.5);

// Array shorthand
const f2_arr = estimateRecombinationRate([36, 12, 12, 4], 'f2');
check('f2 array shorthand works', f2_arr.ok === true);

// Error paths
check('unknown design → ok=false',
      estimateRecombinationRate([1, 2], 'whatever').ok === false);
check('f2 with 2 classes → ok=false',
      estimateRecombinationRate([1, 2], 'f2').ok === false);

// =====================================================================
group('effectDirection');

// Perfect Mendelian → NONE
check('perfect fit → none',
      effectDirection([10, 20, 10], [10, 20, 10]) === EFFECT_DIRECTION.NONE);

// BB deficit: SPEC §2.1 worked example expected pattern
check('BB deficit',
      effectDirection([12, 30, 1], [10.75, 21.5, 10.75])
        === EFFECT_DIRECTION.BB_DEFICIT);

// AA deficit
check('AA deficit',
      effectDirection([1, 20, 12], [10, 20, 12])
        === EFFECT_DIRECTION.AA_DEFICIT);

// Heterozygote excess: AB much larger than expected
check('heterozygote excess',
      effectDirection([5, 40, 5], [12.5, 25, 12.5])
        === EFFECT_DIRECTION.HETEROZYGOTE_EXCESS);

// Heterozygote deficit: AB smaller than expected
check('heterozygote deficit',
      effectDirection([20, 5, 20], [11.25, 22.5, 11.25])
        === EFFECT_DIRECTION.HETEROZYGOTE_DEFICIT);

// Small residuals → NONE
check('tiny residuals → none',
      effectDirection([10, 20, 10], [10.1, 20.2, 10.1])
        === EFFECT_DIRECTION.NONE);

// Shape mismatch → NONE
check('shape mismatch → none',
      effectDirection([1, 2], [1, 2, 3]) === EFFECT_DIRECTION.NONE);

// Non-array → NONE
check('non-array → none',
      effectDirection('foo', 'bar') === EFFECT_DIRECTION.NONE);

// =====================================================================
group('assessSegregation — MENDELIAN');

const r1 = assessSegregation({
  candidate_id: 'INV_LG27_001',
  family_id: 'FAM_004',
  inversion_type: 'paracentric',
  parent1_call: 'AB', parent2_call: 'AB',
  observed: [8, 18, 7],
  reliability: 'high',
});
check('MENDELIAN status',         r1.segregation_status === SEGREGATION_STATUS.MENDELIAN);
check('effect_direction = none',  r1.effect_direction === EFFECT_DIRECTION.NONE);
check('p_value set',              Number.isFinite(r1.p_value));
check('chi2 set',                 Number.isFinite(r1.chi2));
check('ratio_used = 1:2:1',       r1.ratio_used === '1:2:1');
check('n_offspring = 33',         r1.n_offspring === 33);
check('candidate_id propagated',  r1.candidate_id === 'INV_LG27_001');
check('family_id propagated',     r1.family_id === 'FAM_004');

// =====================================================================
group('assessSegregation — DISTORTED');

const r2 = assessSegregation({
  candidate_id: 'INV_LG14_002',
  family_id: 'FAM_011',
  inversion_type: 'pericentric',
  parent1_call: 'AB', parent2_call: 'AB',
  observed: [12, 30, 1],
  reliability: 'high',
});
check('DISTORTED status',         r2.segregation_status === SEGREGATION_STATUS.DISTORTED);
check('effect_direction = BB_deficit',
      r2.effect_direction === EFFECT_DIRECTION.BB_DEFICIT);
check('p < 0.05',                  r2.p_value < 0.05);

// =====================================================================
group('assessSegregation — explicit hard tags');

const rPU = assessSegregation({
  observed: [10, 20, 10],
  parent_uncertain: true,
  expected_ratio: '1:2:1',
});
check('parent_uncertain → PARENT_UNCERTAIN',
      rPU.segregation_status === SEGREGATION_STATUS.PARENT_UNCERTAIN);
check('parent_uncertain: p_value cleared',
      rPU.p_value === null);

const rCM = assessSegregation({
  observed: [10, 20, 10],
  complex_model: true,
  expected_ratio: '1:2:1',
});
check('complex_model → COMPLEX_MODEL',
      rCM.segregation_status === SEGREGATION_STATUS.COMPLEX_MODEL);

const rUP = assessSegregation({
  observed: [2, 3, 1],
  parent1_call: 'AB', parent2_call: 'AB',
  reliability: 'high',
});
check('small n → UNDERPOWERED',
      rUP.segregation_status === SEGREGATION_STATUS.UNDERPOWERED);

const rNoRatio = assessSegregation({
  observed: [10, 20, 10],
  parent1_call: 'AA', parent2_call: 'AA',
  reliability: 'high',
});
check('AA × AA (no ratio) → COMPLEX_MODEL',
      rNoRatio.segregation_status === SEGREGATION_STATUS.COMPLEX_MODEL);

const rAmbig = assessSegregation({
  observed: [12, 30, 1],
  expected_ratio: '1:2:1',
  reliability: 'low',
});
check('low reliability distortion → AMBIGUOUS',
      rAmbig.segregation_status === SEGREGATION_STATUS.AMBIGUOUS);

// SPEC §7.1 worked example: obs_AA / obs_AB / obs_BB shorthand
const rShort = assessSegregation({
  candidate_id: 'INV_LG27_001',
  obs_AA: 8, obs_AB: 18, obs_BB: 7,
  expected_ratio: '1:2:1',
  reliability: 'high',
});
check('obs_AA/AB/BB shorthand',
      rShort.segregation_status === SEGREGATION_STATUS.MENDELIAN
      && rShort.n_offspring === 33);

// Null input → null
check('null row → null',          assessSegregation(null) === null);

// =====================================================================
group('buildParaPeriContingency');

const rows = [
  { inversion_type: 'paracentric', segregation_status: 'MENDELIAN' },
  { inversion_type: 'paracentric', segregation_status: 'MENDELIAN' },
  { inversion_type: 'paracentric', segregation_status: 'DISTORTED' },
  { inversion_type: 'pericentric', segregation_status: 'MENDELIAN' },
  { inversion_type: 'pericentric', segregation_status: 'DISTORTED' },
  { inversion_type: 'pericentric', segregation_status: 'DISTORTED' },
  { inversion_type: 'pericentric', segregation_status: 'AMBIGUOUS' },     // excluded
  { inversion_type: 'unknown',     segregation_status: 'MENDELIAN' },     // excluded
  { inversion_type: 'paracentric', segregation_status: 'UNDERPOWERED' }, // excluded
  null,                                                                   // excluded
];
const tab = buildParaPeriContingency(rows);
check('ok = true',                tab.ok === true);
check('para_M = 2',               tab.table[0][0] === 2);
check('para_D = 1',               tab.table[0][1] === 1);
check('peri_M = 1',               tab.table[1][0] === 1);
check('peri_D = 2',               tab.table[1][1] === 2);
check('n_paracentric = 3',        tab.n_paracentric === 3);
check('n_pericentric = 3',        tab.n_pericentric === 3);
check('n_excluded = 4',           tab.n_excluded === 4);

const tabEmpty = buildParaPeriContingency([]);
check('empty cohort: table all-zero',
      tabEmpty.ok === true
      && tabEmpty.table[0][0] === 0 && tabEmpty.table[0][1] === 0
      && tabEmpty.table[1][0] === 0 && tabEmpty.table[1][1] === 0);

check('non-array → ok=false',
      buildParaPeriContingency(null).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
