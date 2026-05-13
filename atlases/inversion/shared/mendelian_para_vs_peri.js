// shared/mendelian_para_vs_peri.js
// =====================================================================
// Cohort-level comparison of Mendelian-segregation outcomes between
// paracentric and pericentric inversions
// (specs_todo/SPEC_mendelian_inheritance_para_vs_peri_v1.md §3 + §8).
//
// SCOPE — this file is intentionally SMALL: it contains only the
// para-vs-peri-specific cohort math. The per-family Mendelian test
// itself (cross expectations, χ² goodness-of-fit, reliability tier,
// segregation status, effect direction) is GENERIC — same math for
// paracentric, pericentric, or unknown inversions — and lives in
// shared/mendelian_family_test.js. Inversion type is just a
// passthrough label on each row; this module groups on it.
//
// Re-exports the generic vocab so existing call sites importing from
// here keep working unchanged.
// =====================================================================

import {
  SEGREGATION_STATUS,
  EFFECT_DIRECTIONS,
  INVERSION_TYPES,
  RELIABILITY_TIERS,
} from './mendelian_family_test.js';
import { fisher2x2, chiSquare } from './contingency.js';

// =====================================================================
// Re-exports (back-compat for callers expecting these here)
// =====================================================================

export {
  SEGREGATION_STATUS,
  EFFECT_DIRECTIONS,
  INVERSION_TYPES,
  RELIABILITY_TIERS,
  RELIABILITY_DEFAULTS,
  MENDELIAN_TEST_DEFAULTS as PARA_PERI_DEFAULTS,
  expectedRatioForCross,
  formatExpectedRatio,
  chiSquareGoodnessOfFit,
  classifyEffectDirection,
  classifyReliabilityTier,
  classifySegregationStatus,
  testFamilyCandidate,
} from './mendelian_family_test.js';

// =====================================================================
// 1. 2×2 contingency: paracentric × pericentric
// =====================================================================

/**
 * Spec §3 — build the 2×2:
 *
 *               | Mendelian | distorted |
 *   paracentric |   a       |    b      |
 *   pericentric |   c       |    d      |
 *
 * Choose Fisher's exact when any cell ≤ 5, χ² otherwise.
 *
 * Includes only rows with reliability ≥ medium (per spec §4.1 —
 * "high + medium are formal evidence"). Per-class totals are still
 * tabulated for context.
 *
 * @param {Array<Object>} rows  per-family rows (from testFamilyCandidate)
 * @returns {Object}            {table, test, p, totals_by_type}
 */
export function cohortParaPeriContingency(rows) {
  const r = Array.isArray(rows) ? rows : [];
  const counts = {
    paracentric: { MENDELIAN: 0, DISTORTED: 0, other: 0 },
    pericentric: { MENDELIAN: 0, DISTORTED: 0, other: 0 },
    unknown:     { MENDELIAN: 0, DISTORTED: 0, other: 0 },
  };
  for (const row of r) {
    const t = row && row.inversion_type;
    if (!counts[t]) continue;
    const rel = row.reliability;
    if (rel !== RELIABILITY_TIERS.HIGH && rel !== RELIABILITY_TIERS.MEDIUM) continue;
    if (row.segregation_status === SEGREGATION_STATUS.MENDELIAN) counts[t].MENDELIAN++;
    else if (row.segregation_status === SEGREGATION_STATUS.DISTORTED) counts[t].DISTORTED++;
    else counts[t].other++;
  }
  const a = counts.paracentric.MENDELIAN;
  const b = counts.paracentric.DISTORTED;
  const c = counts.pericentric.MENDELIAN;
  const d = counts.pericentric.DISTORTED;
  const table = [[a, b], [c, d]];
  let test = null, p = NaN;
  const allGtFive = a > 5 && b > 5 && c > 5 && d > 5;
  if (a + b + c + d === 0) {
    test = 'no_data';
  } else if (allGtFive) {
    const cs = chiSquare(table, 2);
    test = 'chi_square';
    p = cs.p_approx;
  } else {
    test = 'fisher_exact';
    p = fisher2x2(table);
  }
  return {
    table,
    test,
    p,
    totals_by_type: counts,
  };
}

// =====================================================================
// 2. Effect-direction stratification by inversion type (spec §8 Q3)
// =====================================================================

/**
 * Spec §8 Q3 — when distorted, is it homozygote deficit / heterozygote
 * excess / one-arrangement loss? Stratified by inversion type.
 *
 * @param {Array<Object>} rows
 * @returns {{paracentric:Object, pericentric:Object, unknown:Object}}
 */
export function cohortEffectDirectionBreakdown(rows) {
  const r = Array.isArray(rows) ? rows : [];
  const init = () => ({
    AA_deficit: 0, AB_deficit: 0, BB_deficit: 0,
    heterozygote_excess: 0, heterozygote_deficit: 0,
    one_parent_transmission_bias: 0, none: 0,
  });
  const out = {
    paracentric: init(),
    pericentric: init(),
    unknown:     init(),
  };
  for (const row of r) {
    if (row && row.segregation_status !== SEGREGATION_STATUS.DISTORTED) continue;
    const t = row.inversion_type;
    if (!out[t]) continue;
    const tag = row.effect_direction;
    if (tag in out[t]) out[t][tag]++;
  }
  return out;
}
