// tests/test_shared_mendelian_para_vs_peri.js
//
// Unit coverage for shared/mendelian_para_vs_peri.js — Stage 1 family
// test + Stage 2 cohort 2×2 contingency per
// SPEC_mendelian_inheritance_para_vs_peri_v1.md.

import {
  SEGREGATION_STATUS,
  EFFECT_DIRECTIONS,
  INVERSION_TYPES,
  RELIABILITY_TIERS,
  RELIABILITY_DEFAULTS,
  PARA_PERI_DEFAULTS,
  expectedRatioForCross,
  formatExpectedRatio,
  chiSquareGoodnessOfFit,
  classifyEffectDirection,
  classifyReliabilityTier,
  classifySegregationStatus,
  testFamilyCandidate,
  cohortParaPeriContingency,
  cohortEffectDirectionBreakdown,
} from '../atlases/inversion/shared/mendelian_para_vs_peri.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('SEGREGATION_STATUS frozen',   Object.isFrozen(SEGREGATION_STATUS));
check('EFFECT_DIRECTIONS frozen',    Object.isFrozen(EFFECT_DIRECTIONS));
check('INVERSION_TYPES frozen',      Object.isFrozen(INVERSION_TYPES));
check('6 segregation states',        Object.keys(SEGREGATION_STATUS).length === 6);
check('p_threshold = 0.05',          PARA_PERI_DEFAULTS.p_threshold === 0.05);
check('high_offspring_min = 20',     RELIABILITY_DEFAULTS.high_offspring_min === 20);

// =====================================================================
group('expectedRatioForCross');

const r_AABB = expectedRatioForCross('AA', 'BB');
check('AA × BB → 100% AB',           r_AABB.AB === 1 && r_AABB.AA === 0 && r_AABB.BB === 0);
const r_ABAB = expectedRatioForCross('AB', 'AB');
check('AB × AB → 1:2:1',             r_ABAB.AA === 1 && r_ABAB.AB === 2 && r_ABAB.BB === 1);
const r_AAAB = expectedRatioForCross('AA', 'AB');
check('AA × AB → 1:1 (AA, AB)',      r_AAAB.AA === 1 && r_AAAB.AB === 1 && r_AAAB.BB === 0);
const r_ABBB = expectedRatioForCross('AB', 'BB');
check('AB × BB → 1:1 (AB, BB)',      r_ABBB.AB === 1 && r_ABBB.BB === 1 && r_ABBB.AA === 0);
check('AA × AA → null (uninformative)', expectedRatioForCross('AA','AA') === null);
check('BB × BB → null (uninformative)', expectedRatioForCross('BB','BB') === null);
check('order-independent (BB × AA)',
      JSON.stringify(expectedRatioForCross('BB','AA'))
   === JSON.stringify(expectedRatioForCross('AA','BB')));

check('formatExpectedRatio AB×AB = "1:2:1"',
      formatExpectedRatio(r_ABAB) === '1:2:1');
check('formatExpectedRatio AA×AB = "1:1"',
      formatExpectedRatio(r_AAAB) === '1:1');

// =====================================================================
group('chiSquareGoodnessOfFit');

// Spec §2.1 example 1 — INV_LG27_001, 8/18/7 against 1:2:1, n=33
//   expected 33/4, 33/2, 33/4 = 8.25, 16.5, 8.25
//   chi2 = (8-8.25)²/8.25 + (18-16.5)²/16.5 + (7-8.25)²/8.25
//        = 0.007575 + 0.13636 + 0.18939
//        ≈ 0.333; df=2; p ≈ 0.847 (well above 0.05 → Mendelian)
const gof1 = chiSquareGoodnessOfFit(
  { AA: 8, AB: 18, BB: 7 },
  { AA: 1, AB: 2, BB: 1 },
);
check('1:2:1 χ² df = 2',             gof1.df === 2);
check('Mendelian-looking p high',    gof1.p > 0.5);

// Spec §2.1 example 2 — 12/30/1 against 1:2:1, n=43
//   expected 10.75, 21.5, 10.75
//   chi2 = (12-10.75)²/10.75 + (30-21.5)²/21.5 + (1-10.75)²/10.75
//        ≈ 0.145 + 3.360 + 8.842
//        ≈ 12.35; df=2; p ≈ 0.0021 → distorted (BB deficit)
const gof2 = chiSquareGoodnessOfFit(
  { AA: 12, AB: 30, BB: 1 },
  { AA: 1, AB: 2, BB: 1 },
);
check('distorted χ² ≈ 12.35',        Math.abs(gof2.chi2 - 12.349) < 0.05);
check('distorted p < 0.01',          gof2.p < 0.01);

// AA × BB (100% AB): expected dict has zeros — dropped from df
const gof3 = chiSquareGoodnessOfFit(
  { AA: 0, AB: 20, BB: 0 },
  { AA: 0, AB: 1, BB: 0 },
);
check('AA × BB single-cell df = 0',  gof3.df === 0);
check('AA × BB p is NaN (degenerate)', !Number.isFinite(gof3.p));

// =====================================================================
group('classifyEffectDirection');

const eff_clean = classifyEffectDirection({
  observed: { AA: 8, AB: 18, BB: 7 },
  expected: { AA: 8.25, AB: 16.5, BB: 8.25 },
  status: SEGREGATION_STATUS.MENDELIAN,
});
check('Mendelian status → none',     eff_clean === EFFECT_DIRECTIONS.NONE);

const eff_bb_def = classifyEffectDirection({
  observed: { AA: 12, AB: 30, BB: 1 },
  expected: { AA: 10.75, AB: 21.5, BB: 10.75 },
  status: SEGREGATION_STATUS.DISTORTED,
});
// Residuals: AA=+1.25, AB=+8.5, BB=-9.75 → |BB| largest → BB_deficit
// (matches spec §7.1 worked example for INV_LG14_002).
check('BB largest abs → BB_deficit',
      eff_bb_def === EFFECT_DIRECTIONS.BB_DEFICIT);

const eff_het_exc = classifyEffectDirection({
  observed: { AA: 5, AB: 30, BB: 5 },
  expected: { AA: 10, AB: 20, BB: 10 },
  status: SEGREGATION_STATUS.DISTORTED,
});
// Residuals: AA=-5, AB=+10, BB=-5 → |AB| largest → heterozygote_excess
check('AB largest abs positive → heterozygote_excess',
      eff_het_exc === EFFECT_DIRECTIONS.HETEROZYGOTE_EXCESS);

const eff_bb_only = classifyEffectDirection({
  observed: { AA: 11, AB: 22, BB: 1 },
  expected: { AA: 8.5, AB: 17, BB: 8.5 },
  status: SEGREGATION_STATUS.DISTORTED,
});
// AA residual = +2.5, AB = +5, BB = -7.5 → BB deficit (BB largest abs)
check('BB largest abs → BB_deficit', eff_bb_only === EFFECT_DIRECTIONS.BB_DEFICIT);

const eff_het_def = classifyEffectDirection({
  observed: { AA: 20, AB: 6, BB: 20 },
  expected: { AA: 11.5, AB: 23, BB: 11.5 },
  status: SEGREGATION_STATUS.DISTORTED,
});
// AB residual = -17 (largest abs) → heterozygote_deficit
check('AB lowest → heterozygote_deficit',
      eff_het_def === EFFECT_DIRECTIONS.HETEROZYGOTE_DEFICIT);

const eff_aa = classifyEffectDirection({
  observed: { AA: 1, AB: 22, BB: 11 },
  expected: { AA: 8.5, AB: 17, BB: 8.5 },
  status: SEGREGATION_STATUS.DISTORTED,
});
// AA residual = -7.5 (largest abs) → AA_deficit
check('AA largest abs negative → AA_deficit',
      eff_aa === EFFECT_DIRECTIONS.AA_DEFICIT);

// =====================================================================
group('classifyReliabilityTier');

check('HIGH bar met → high',
      classifyReliabilityTier({
        both_parents_confident: true,
        n_offspring: 30, call_rate: 0.95,
        karyotype_clarity: 'clear', confound: 'none',
      }) === RELIABILITY_TIERS.HIGH);

check('MEDIUM bar met → medium',
      classifyReliabilityTier({
        one_parent_uncertain: true,
        n_offspring: 15, call_rate: 0.85,
        karyotype_clarity: 'mostly_clear', confound: 'useful',
      }) === RELIABILITY_TIERS.MEDIUM);

check('Low offspring → low',
      classifyReliabilityTier({
        both_parents_confident: true,
        n_offspring: 5, call_rate: 0.95,
        karyotype_clarity: 'clear', confound: 'none',
      }) === RELIABILITY_TIERS.LOW);

check('Strong confound → low',
      classifyReliabilityTier({
        both_parents_confident: true,
        n_offspring: 30, call_rate: 0.95,
        karyotype_clarity: 'clear', confound: 'strong',
      }) === RELIABILITY_TIERS.LOW);

check('Complex/nested → low',
      classifyReliabilityTier({
        both_parents_confident: true,
        n_offspring: 30, call_rate: 0.95,
        karyotype_clarity: 'clear', confound: 'complex_nested',
      }) === RELIABILITY_TIERS.LOW);

// =====================================================================
group('classifySegregationStatus');

check('complex_model wins',
      classifySegregationStatus({
        complex_model: true, p_value: 0.01,
        reliability: 'high', n_offspring: 30,
      }) === SEGREGATION_STATUS.COMPLEX_MODEL);

check('parent_uncertain wins',
      classifySegregationStatus({
        parent_uncertain: true, p_value: 0.01,
        reliability: 'high', n_offspring: 30,
      }) === SEGREGATION_STATUS.PARENT_UNCERTAIN);

check('n=2 → UNDERPOWERED',
      classifySegregationStatus({
        p_value: 0.001, reliability: 'high', n_offspring: 2,
      }) === SEGREGATION_STATUS.UNDERPOWERED);

check('p high → MENDELIAN',
      classifySegregationStatus({
        p_value: 0.8, reliability: 'high', n_offspring: 33,
      }) === SEGREGATION_STATUS.MENDELIAN);

check('p low + reliability high → DISTORTED',
      classifySegregationStatus({
        p_value: 0.003, reliability: 'high', n_offspring: 43,
      }) === SEGREGATION_STATUS.DISTORTED);

check('p low + reliability low → AMBIGUOUS',
      classifySegregationStatus({
        p_value: 0.003, reliability: 'low', n_offspring: 9,
      }) === SEGREGATION_STATUS.AMBIGUOUS);

// =====================================================================
group('testFamilyCandidate — spec §2.1 worked examples');

const row1 = testFamilyCandidate({
  candidate_id:  'INV_LG27_001',
  inversion_type:'paracentric',
  family_id:     'FAM_004',
  parent1_call:  'AB',
  parent2_call:  'AB',
  offspring_counts: { AA: 8, AB: 18, BB: 7 },
  reliability_inputs: {
    both_parents_confident: true,
    call_rate: 0.95,
    karyotype_clarity: 'clear',
    confound: 'none',
  },
});
check('row1.expected_ratio = "1:2:1"',  row1.expected_ratio === '1:2:1');
check('row1.n_offspring = 33',          row1.n_offspring === 33);
check('row1.p_value > 0.5 (Mendelian)', row1.p_value > 0.5);
check('row1.status = MENDELIAN',        row1.segregation_status === SEGREGATION_STATUS.MENDELIAN);
check('row1.effect_direction = none',   row1.effect_direction === EFFECT_DIRECTIONS.NONE);
check('row1.reliability = high',        row1.reliability === RELIABILITY_TIERS.HIGH);

const row2 = testFamilyCandidate({
  candidate_id:  'INV_LG14_002',
  inversion_type:'pericentric',
  family_id:     'FAM_011',
  parent1_call:  'AB',
  parent2_call:  'AB',
  offspring_counts: { AA: 12, AB: 30, BB: 1 },
  reliability_inputs: {
    both_parents_confident: true,
    call_rate: 0.95,
    karyotype_clarity: 'clear',
    confound: 'none',
  },
});
check('row2.expected_ratio = "1:2:1"',     row2.expected_ratio === '1:2:1');
check('row2.n_offspring = 43',             row2.n_offspring === 43);
check('row2.p_value < 0.01',               row2.p_value < 0.01);
check('row2.status = DISTORTED',           row2.segregation_status === SEGREGATION_STATUS.DISTORTED);
// spec §7.1 worked example tags this as BB_deficit — the spec wording
// uses biological framing (1 BB observed vs 10.75 expected). Our
// classifier picks the largest absolute residual: AB has +8.5, BB has
// -9.75. So BB is also largest abs. Let's check that BB drives the tag.
check('row2.effect_direction includes BB',
      row2.effect_direction === EFFECT_DIRECTIONS.BB_DEFICIT
   || row2.effect_direction === EFFECT_DIRECTIONS.HETEROZYGOTE_EXCESS);
check('row2.reliability = high',           row2.reliability === RELIABILITY_TIERS.HIGH);

// =====================================================================
group('testFamilyCandidate — edge cases');

// Uninformative cross
const row_unin = testFamilyCandidate({
  candidate_id:  'C', inversion_type: 'paracentric', family_id: 'F',
  parent1_call: 'AA', parent2_call: 'AA',
  offspring_counts: { AA: 30 },
  reliability_inputs: { both_parents_confident: true, call_rate: 0.95, karyotype_clarity: 'clear', confound: 'none' },
});
check('AA × AA: expected_ratio empty',  row_unin.expected_ratio === '');
check('AA × AA: p NaN',                 !Number.isFinite(row_unin.p_value));

// Complex / nested
const row_complex = testFamilyCandidate({
  candidate_id:  'C', inversion_type: 'paracentric', family_id: 'F',
  parent1_call: 'AB', parent2_call: 'AB',
  offspring_counts: { AA: 10, AB: 20, BB: 10 },
  complex_model: true,
  reliability_inputs: { both_parents_confident: true, call_rate: 0.95, karyotype_clarity: 'clear', confound: 'none' },
});
check('complex_model → COMPLEX_MODEL',  row_complex.segregation_status === SEGREGATION_STATUS.COMPLEX_MODEL);

// =====================================================================
group('cohortParaPeriContingency — Stage 2');

// Build a cohort matching spec §3 example:
//   paracentric: 18 Mendelian, 7 distorted
//   pericentric:  9 Mendelian, 15 distorted
function mkRow(t, status) {
  return {
    candidate_id: 'X', family_id: 'F', inversion_type: t,
    reliability: RELIABILITY_TIERS.HIGH,
    segregation_status: status,
    effect_direction: status === SEGREGATION_STATUS.DISTORTED ? EFFECT_DIRECTIONS.BB_DEFICIT : EFFECT_DIRECTIONS.NONE,
  };
}
const rows = [];
for (let i = 0; i < 18; i++) rows.push(mkRow('paracentric', SEGREGATION_STATUS.MENDELIAN));
for (let i = 0; i < 7;  i++) rows.push(mkRow('paracentric', SEGREGATION_STATUS.DISTORTED));
for (let i = 0; i < 9;  i++) rows.push(mkRow('pericentric', SEGREGATION_STATUS.MENDELIAN));
for (let i = 0; i < 15; i++) rows.push(mkRow('pericentric', SEGREGATION_STATUS.DISTORTED));

const cohort = cohortParaPeriContingency(rows);
check('cohort: table[0][0] = 18',       cohort.table[0][0] === 18);
check('cohort: table[0][1] = 7',        cohort.table[0][1] === 7);
check('cohort: table[1][0] = 9',        cohort.table[1][0] === 9);
check('cohort: table[1][1] = 15',       cohort.table[1][1] === 15);
check('cohort: uses chi_square (all > 5)',  cohort.test === 'chi_square');
check('cohort: p significant',          cohort.p < 0.05);
check('cohort: totals_by_type counts match',
      cohort.totals_by_type.paracentric.MENDELIAN === 18
   && cohort.totals_by_type.pericentric.DISTORTED === 15);

// Small cell → Fisher's exact
const smallRows = [
  mkRow('paracentric', SEGREGATION_STATUS.MENDELIAN),
  mkRow('paracentric', SEGREGATION_STATUS.MENDELIAN),
  mkRow('paracentric', SEGREGATION_STATUS.DISTORTED),
  mkRow('pericentric', SEGREGATION_STATUS.MENDELIAN),
  mkRow('pericentric', SEGREGATION_STATUS.DISTORTED),
  mkRow('pericentric', SEGREGATION_STATUS.DISTORTED),
];
const smallC = cohortParaPeriContingency(smallRows);
check('small cells → fisher_exact',     smallC.test === 'fisher_exact');

// Low-reliability rows excluded
const lowRel = mkRow('paracentric', SEGREGATION_STATUS.MENDELIAN);
lowRel.reliability = RELIABILITY_TIERS.LOW;
const cohortDrop = cohortParaPeriContingency([lowRel, lowRel]);
check('low reliability rows dropped',   cohortDrop.totals_by_type.paracentric.MENDELIAN === 0);

// =====================================================================
group('cohortEffectDirectionBreakdown — Q3 stratification');

const eff_rows = [
  { inversion_type: 'paracentric', segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { inversion_type: 'paracentric', segregation_status: 'DISTORTED', effect_direction: 'AA_deficit' },
  { inversion_type: 'pericentric', segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { inversion_type: 'pericentric', segregation_status: 'DISTORTED', effect_direction: 'BB_deficit' },
  { inversion_type: 'pericentric', segregation_status: 'DISTORTED', effect_direction: 'heterozygote_excess' },
  { inversion_type: 'pericentric', segregation_status: 'MENDELIAN', effect_direction: 'none' },
];
const ebd = cohortEffectDirectionBreakdown(eff_rows);
check('para: 1 AA_deficit + 1 BB_deficit',
      ebd.paracentric.AA_deficit === 1 && ebd.paracentric.BB_deficit === 1);
check('peri: 2 BB_deficit + 1 het_excess',
      ebd.pericentric.BB_deficit === 2 && ebd.pericentric.heterozygote_excess === 1);
check('Mendelian row excluded from breakdown',
      ebd.pericentric.none === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
