// shared/mendelian_para_vs_peri.js
// =====================================================================
// Paracentric-vs-pericentric Mendelian-inheritance analysis
// (specs_todo/SPEC_mendelian_inheritance_para_vs_peri_v1.md).
//
// Two stages of compute:
//   Stage 1 — per (candidate × family): given parental karyotypes
//             and offspring karyotype counts, run a χ² goodness-of-
//             fit test against the Mendelian expectation; classify
//             the result on the 6-state segregation enum (§5),
//             annotate effect-direction (§6), and assign a
//             reliability tier (§4).
//   Stage 2 — cohort-level: build the 2×2 paracentric × pericentric
//             contingency, choose Fisher's exact or χ² automatically,
//             and break down effect_direction by inversion_type.
//
// This module composes existing primitives:
//   shared/contingency.js — fisher2x2, chiSquare, chiSqSurvival.
//   The χ² goodness-of-fit (1×K case) is computed inline since
//   contingency.js's chiSquare is for K×K tables.
//
// SPEC FRAMING: "Non-Mendelian is not a failure — it's a biological
// or technical signal worth labeling explicitly" (§5).
// =====================================================================

import { fisher2x2, chiSquare, chiSqSurvival } from './contingency.js';

// =====================================================================
// Vocabularies (frozen)
// =====================================================================

/** Spec §5 — 6-state segregation status enum. */
export const SEGREGATION_STATUS = Object.freeze({
  MENDELIAN:         'MENDELIAN',
  DISTORTED:         'DISTORTED',
  AMBIGUOUS:         'AMBIGUOUS',
  UNDERPOWERED:      'UNDERPOWERED',
  COMPLEX_MODEL:     'COMPLEX_MODEL',
  PARENT_UNCERTAIN:  'PARENT_UNCERTAIN',
});

/** Spec §6 — effect-direction tags. */
export const EFFECT_DIRECTIONS = Object.freeze({
  AA_DEFICIT:                     'AA_deficit',
  AB_DEFICIT:                     'AB_deficit',
  BB_DEFICIT:                     'BB_deficit',
  HETEROZYGOTE_EXCESS:            'heterozygote_excess',
  HETEROZYGOTE_DEFICIT:           'heterozygote_deficit',
  ONE_PARENT_TRANSMISSION_BIAS:   'one_parent_transmission_bias',
  NONE:                           'none',
});

/** Inversion-type labels (spec §1 framing). */
export const INVERSION_TYPES = Object.freeze({
  PARACENTRIC: 'paracentric',
  PERICENTRIC: 'pericentric',
  UNKNOWN:     'unknown',
});

/** Reliability tier labels (spec §4.1). */
export const RELIABILITY_TIERS = Object.freeze({
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low',
});

/** Spec §4.1 — reliability-tier thresholds. */
export const RELIABILITY_DEFAULTS = Object.freeze({
  high_offspring_min:    20,
  medium_offspring_min:  10,
  high_call_rate_min:    0.90,
  medium_call_rate_min:  0.80,
});

/** Spec §2 + §5 — test thresholds. */
export const PARA_PERI_DEFAULTS = Object.freeze({
  /** Significance threshold for χ²/Fisher per family. */
  p_threshold:              0.05,
  /** Family sizes below this in any test → UNDERPOWERED. */
  underpowered_n_offspring: 5,
  /** Borderline-p margin: |p − p_threshold| within this fraction →
   *  AMBIGUOUS for low-reliability families (§5). */
  borderline_margin:        0.02,
});

// =====================================================================
// 1. Mendelian expectation per cross
// =====================================================================

/**
 * Spec §2 step 2 — return the expected count ratio for a cross of
 * parental karyotypes. Karyotypes are 'AA' | 'AB' | 'BB'.
 *
 * Returns null for the two uninformative crosses (AA×AA, BB×BB)
 * because they predict a single karyotype class.
 *
 * Output keys are normalised to {'AA','AB','BB'}. Missing keys ⇒ 0.
 *
 * @param {string} p1
 * @param {string} p2
 * @returns {{AA:number, AB:number, BB:number}|null}
 */
export function expectedRatioForCross(p1, p2) {
  const pair = [p1, p2].sort().join('×');
  switch (pair) {
    case 'AA×AB': return { AA: 1, AB: 1, BB: 0 };
    case 'AB×BB': return { AA: 0, AB: 1, BB: 1 };
    case 'AB×AB': return { AA: 1, AB: 2, BB: 1 };
    case 'AA×BB': return { AA: 0, AB: 1, BB: 0 };   // 100% AB
    case 'AA×AA': return null;
    case 'BB×BB': return null;
    default:      return null;
  }
}

/** Pretty-print an expected ratio as a colon-separated string
 *  (e.g. "1:2:1"), excluding zero classes (so AA×AB renders "1:1"). */
export function formatExpectedRatio(ratio) {
  if (!ratio) return '';
  const parts = [];
  for (const k of ['AA', 'AB', 'BB']) {
    if (ratio[k] > 0) parts.push(String(ratio[k]));
  }
  return parts.join(':');
}

// =====================================================================
// 2. χ² goodness-of-fit
// =====================================================================

/**
 * Spec §2 step 3 — χ² goodness-of-fit, observed vs expected ratio.
 *
 * `observed` and `ratio` share key shape (AA/AB/BB). Zero-expected
 * cells are dropped (degrees of freedom adjusted). Returns NaN p
 * when fewer than 2 informative cells (degenerate).
 *
 * @param {{AA?:number, AB?:number, BB?:number}} observed
 * @param {{AA?:number, AB?:number, BB?:number}} ratio
 * @returns {{chi2:number, df:number, p:number, n:number,
 *           expected:{AA:number,AB:number,BB:number}}}
 */
export function chiSquareGoodnessOfFit(observed, ratio) {
  const keys = ['AA', 'AB', 'BB'];
  let n = 0;
  for (const k of keys) {
    const v = observed && observed[k];
    if (Number.isFinite(v)) n += v;
  }
  let denom = 0;
  for (const k of keys) {
    const v = ratio && ratio[k];
    if (Number.isFinite(v) && v > 0) denom += v;
  }
  const expected = { AA: 0, AB: 0, BB: 0 };
  let chi2 = 0, cells = 0;
  for (const k of keys) {
    const E = denom > 0 ? (n * (ratio[k] || 0)) / denom : 0;
    expected[k] = E;
    if (E > 0) {
      const O = (observed && observed[k]) || 0;
      chi2 += (O - E) * (O - E) / E;
      cells++;
    }
  }
  const df = Math.max(0, cells - 1);
  const p = df > 0 ? chiSqSurvival(chi2, df) : NaN;
  return { chi2, df, p, n, expected };
}

// =====================================================================
// 3. Effect-direction classifier
// =====================================================================

/**
 * Spec §6 — annotate which class is over/under-represented in a
 * DISTORTED result.
 *
 * Returns the dominant deviation; ties or non-distorted statuses
 * return EFFECT_DIRECTIONS.NONE. Heterozygote_excess /
 * heterozygote_deficit take precedence over single-cell deficits
 * when the AB cell drives the χ²; otherwise the largest absolute
 * deficit wins.
 *
 * @param {{
 *   observed: {AA:number, AB:number, BB:number},
 *   expected: {AA:number, AB:number, BB:number},
 *   status?:  string,
 * }} args
 * @returns {string} one of EFFECT_DIRECTIONS values
 */
export function classifyEffectDirection(args) {
  if (!args) return EFFECT_DIRECTIONS.NONE;
  if (args.status && args.status !== SEGREGATION_STATUS.DISTORTED) {
    return EFFECT_DIRECTIONS.NONE;
  }
  const o = args.observed || {}, e = args.expected || {};
  const dAA = (o.AA || 0) - (e.AA || 0);
  const dAB = (o.AB || 0) - (e.AB || 0);
  const dBB = (o.BB || 0) - (e.BB || 0);
  // Heterozygote pattern takes precedence when AB drives the largest
  // absolute residual.
  if (Math.abs(dAB) >= Math.abs(dAA) && Math.abs(dAB) >= Math.abs(dBB)) {
    if (dAB > 0) return EFFECT_DIRECTIONS.HETEROZYGOTE_EXCESS;
    if (dAB < 0) return EFFECT_DIRECTIONS.HETEROZYGOTE_DEFICIT;
  }
  // Otherwise the largest absolute homozygote deficit wins.
  const deficits = [
    { tag: EFFECT_DIRECTIONS.AA_DEFICIT, mag: dAA < 0 ? -dAA : 0 },
    { tag: EFFECT_DIRECTIONS.BB_DEFICIT, mag: dBB < 0 ? -dBB : 0 },
  ];
  deficits.sort((a, b) => b.mag - a.mag);
  if (deficits[0].mag > 0) return deficits[0].tag;
  return EFFECT_DIRECTIONS.NONE;
}

// =====================================================================
// 4. Reliability tier
// =====================================================================

/**
 * Spec §4.1 — classify reliability based on parent-call confidence,
 * offspring size, call rate, karyotype clarity, and confound checks.
 *
 * @param {{
 *   both_parents_confident?: boolean,
 *   one_parent_uncertain?:   boolean,
 *   n_offspring:             number,
 *   call_rate:               number,
 *   karyotype_clarity?:      'clear'|'mostly_clear'|'weak',
 *   confound?:               'none'|'useful'|'strong'|'complex_nested',
 * }} args
 * @returns {string}  one of RELIABILITY_TIERS values
 */
export function classifyReliabilityTier(args, opts) {
  const o = opts || {};
  const D = RELIABILITY_DEFAULTS;
  const hi_n = Number.isFinite(o.high_offspring_min)   ? o.high_offspring_min   : D.high_offspring_min;
  const md_n = Number.isFinite(o.medium_offspring_min) ? o.medium_offspring_min : D.medium_offspring_min;
  const hi_c = Number.isFinite(o.high_call_rate_min)   ? o.high_call_rate_min   : D.high_call_rate_min;
  const md_c = Number.isFinite(o.medium_call_rate_min) ? o.medium_call_rate_min : D.medium_call_rate_min;

  const a = args || {};
  const n   = Number.isFinite(a.n_offspring) ? a.n_offspring : 0;
  const cr  = Number.isFinite(a.call_rate)   ? a.call_rate   : 0;
  const clarity = a.karyotype_clarity || 'clear';
  const confound = a.confound || 'none';
  const bothConfident = a.both_parents_confident !== false && !a.one_parent_uncertain;

  // HIGH bar (all must hold).
  const high =
    bothConfident &&
    n  >= hi_n &&
    cr >= hi_c &&
    clarity === 'clear' &&
    (confound === 'none' || confound === 'useful');
  if (high) return RELIABILITY_TIERS.HIGH;

  // MEDIUM bar.
  const medium =
    n  >= md_n &&
    cr >= md_c &&
    clarity !== 'weak' &&
    confound !== 'strong' &&
    confound !== 'complex_nested';
  if (medium) return RELIABILITY_TIERS.MEDIUM;

  return RELIABILITY_TIERS.LOW;
}

// =====================================================================
// 5. Segregation-status classifier (spec §5 enum)
// =====================================================================

/**
 * Spec §5 — map (test result, reliability, modifiers) → segregation
 * status enum.
 *
 * Order of checks (precedence):
 *   1. complex_model_flag → COMPLEX_MODEL
 *   2. parent_uncertain   → PARENT_UNCERTAIN
 *   3. n_offspring < underpowered_n_offspring → UNDERPOWERED
 *   4. p ≥ p_threshold    → MENDELIAN
 *   5. p borderline AND reliability low → AMBIGUOUS
 *   6. otherwise          → DISTORTED
 *
 * @param {{
 *   p_value:           number,
 *   reliability:       string,
 *   n_offspring:       number,
 *   parent_uncertain?: boolean,
 *   complex_model?:    boolean,
 * }} args
 * @param {Object} [opts]
 * @returns {string}  one of SEGREGATION_STATUS values
 */
export function classifySegregationStatus(args, opts) {
  const o = opts || {};
  const pThresh = Number.isFinite(o.p_threshold) ? o.p_threshold : PARA_PERI_DEFAULTS.p_threshold;
  const minN    = Number.isFinite(o.underpowered_n_offspring) ? o.underpowered_n_offspring : PARA_PERI_DEFAULTS.underpowered_n_offspring;
  const margin  = Number.isFinite(o.borderline_margin) ? o.borderline_margin : PARA_PERI_DEFAULTS.borderline_margin;

  const a = args || {};
  if (a.complex_model)    return SEGREGATION_STATUS.COMPLEX_MODEL;
  if (a.parent_uncertain) return SEGREGATION_STATUS.PARENT_UNCERTAIN;
  if (!Number.isFinite(a.n_offspring) || a.n_offspring < minN) {
    return SEGREGATION_STATUS.UNDERPOWERED;
  }
  if (!Number.isFinite(a.p_value))     return SEGREGATION_STATUS.UNDERPOWERED;
  if (a.p_value >= pThresh)            return SEGREGATION_STATUS.MENDELIAN;
  // Borderline + low reliability → ambiguous.
  if (a.reliability === RELIABILITY_TIERS.LOW
      && Math.abs(a.p_value - pThresh) < margin) {
    return SEGREGATION_STATUS.AMBIGUOUS;
  }
  if (a.reliability === RELIABILITY_TIERS.LOW
      && a.p_value < pThresh) {
    return SEGREGATION_STATUS.AMBIGUOUS;
  }
  return SEGREGATION_STATUS.DISTORTED;
}

// =====================================================================
// 6. Per-family test orchestrator → spec §7 output row
// =====================================================================

/**
 * Spec §7 schema producer for one (family × candidate) test.
 *
 * @param {{
 *   candidate_id:   string,
 *   inversion_type: string,
 *   family_id:      string,
 *   parent1_call:   string,
 *   parent2_call:   string,
 *   offspring_counts:{AA:number, AB:number, BB:number},
 *   reliability_inputs:Object,   // forwarded to classifyReliabilityTier
 *   parent_uncertain?:boolean,
 *   complex_model?:  boolean,
 * }} family
 * @param {Object} [opts]
 * @returns {Object}  spec §7 row
 */
export function testFamilyCandidate(family, opts) {
  const f = family || {};
  const o = opts || {};
  const expected = expectedRatioForCross(f.parent1_call, f.parent2_call);
  const obs = f.offspring_counts || {};
  const obs_AA = Number.isFinite(obs.AA) ? obs.AA : 0;
  const obs_AB = Number.isFinite(obs.AB) ? obs.AB : 0;
  const obs_BB = Number.isFinite(obs.BB) ? obs.BB : 0;
  const n_offspring = obs_AA + obs_AB + obs_BB;
  let gof = null, p_value = NaN;
  if (expected) {
    gof = chiSquareGoodnessOfFit({ AA: obs_AA, AB: obs_AB, BB: obs_BB }, expected);
    p_value = gof.p;
  }
  const reliability = classifyReliabilityTier(
    Object.assign({}, f.reliability_inputs, { n_offspring }),
    o,
  );
  const status = classifySegregationStatus({
    p_value,
    reliability,
    n_offspring,
    parent_uncertain: f.parent_uncertain || !expected && _crossIsUninformative(f.parent1_call, f.parent2_call) === false,
    complex_model:    f.complex_model,
  }, o);
  const effect_direction = classifyEffectDirection({
    observed: { AA: obs_AA, AB: obs_AB, BB: obs_BB },
    expected: gof ? gof.expected : { AA: 0, AB: 0, BB: 0 },
    status,
  });
  return {
    candidate_id:       f.candidate_id || null,
    inversion_type:     f.inversion_type || INVERSION_TYPES.UNKNOWN,
    family_id:          f.family_id || null,
    parent1_call:       f.parent1_call || null,
    parent2_call:       f.parent2_call || null,
    expected_ratio:     expected ? formatExpectedRatio(expected) : '',
    n_offspring,
    obs_AA, obs_AB, obs_BB,
    p_value,
    effect_direction,
    reliability,
    segregation_status: status,
  };
}

function _crossIsUninformative(p1, p2) {
  const pair = [p1, p2].sort().join('×');
  return pair === 'AA×AA' || pair === 'BB×BB';
}

// =====================================================================
// 7. Cohort-level (Stage 2) — para vs peri 2×2 contingency
// =====================================================================

/**
 * Spec §3 — build the 2×2 contingency:
 *
 *               | Mendelian | distorted |
 *   paracentric |   a       |    b      |
 *   pericentric |   c       |    d      |
 *
 * Choose Fisher's exact when any cell ≤ 5, χ² otherwise.
 *
 * Includes only rows with reliability ≥ medium (per spec §4.1
 * "high + medium are formal evidence"). The cohort summary still
 * reports per-class totals for context.
 *
 * @param {Array<Object>} rows   spec §7 rows
 * @returns {Object}             {table, test, p, totals_by_type}
 */
export function cohortParaPeriContingency(rows, opts) {
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
// 8. Effect-direction stratification by inversion type (spec §8 Q3)
// =====================================================================

/**
 * Spec §8 question 3 — when distorted, is it homozygote deficit /
 * heterozygote excess / one-arrangement loss? Stratified by
 * inversion type.
 *
 * @param {Array<Object>} rows
 * @returns {{
 *   paracentric: Object<effect_direction, count>,
 *   pericentric: Object<effect_direction, count>,
 *   unknown:     Object<effect_direction, count>,
 * }}
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
