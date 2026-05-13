// shared/mendelian_family_test.js
// =====================================================================
// Generic per-family Mendelian-inheritance test for inversion
// candidates. Same math regardless of inversion type (paracentric /
// pericentric / unknown) — `inversion_type` is just a passthrough
// label carried on the output row so downstream cohort comparisons
// (e.g. mendelian_para_vs_peri.js) can group by it.
//
// What this module supplies:
//   - segregation-status enum (6 states; spec §5)
//   - effect-direction tag vocabulary (spec §6)
//   - reliability-tier classifier (spec §4.1)
//   - per-family χ² goodness-of-fit (spec §2)
//   - status classifier composing (test result, reliability, modifiers)
//   - end-to-end per-family row producer matching spec §7 schema
//
// Composes existing primitives (no duplication):
//   - shared/contingency.js → chiSqSurvival (for goodness-of-fit p)
//
// "Non-Mendelian is not a failure — it's a biological or technical
//  signal worth labeling explicitly" (spec §5).
// =====================================================================

import { chiSqSurvival } from './contingency.js';

// =====================================================================
// Vocabularies (frozen)
// =====================================================================

/** 6-state segregation-status enum (spec §5). */
export const SEGREGATION_STATUS = Object.freeze({
  MENDELIAN:         'MENDELIAN',
  DISTORTED:         'DISTORTED',
  AMBIGUOUS:         'AMBIGUOUS',
  UNDERPOWERED:      'UNDERPOWERED',
  COMPLEX_MODEL:     'COMPLEX_MODEL',
  PARENT_UNCERTAIN:  'PARENT_UNCERTAIN',
});

/** Effect-direction tags (spec §6). */
export const EFFECT_DIRECTIONS = Object.freeze({
  AA_DEFICIT:                     'AA_deficit',
  AB_DEFICIT:                     'AB_deficit',
  BB_DEFICIT:                     'BB_deficit',
  HETEROZYGOTE_EXCESS:            'heterozygote_excess',
  HETEROZYGOTE_DEFICIT:           'heterozygote_deficit',
  ONE_PARENT_TRANSMISSION_BIAS:   'one_parent_transmission_bias',
  NONE:                           'none',
});

/** Inversion-type labels — carried through as a passthrough. */
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

/** Reliability tier thresholds (spec §4.1). */
export const RELIABILITY_DEFAULTS = Object.freeze({
  high_offspring_min:    20,
  medium_offspring_min:  10,
  high_call_rate_min:    0.90,
  medium_call_rate_min:  0.80,
});

/** Test thresholds (spec §2 + §5). */
export const MENDELIAN_TEST_DEFAULTS = Object.freeze({
  p_threshold:              0.05,
  underpowered_n_offspring: 5,
  borderline_margin:        0.02,
});

// =====================================================================
// 1. Mendelian expectation per cross
// =====================================================================

/**
 * Expected count ratio for a cross of parental karyotypes
 * ('AA' / 'AB' / 'BB'). Null for uninformative homozygote × homozygote
 * crosses (AA×AA, BB×BB → predict a single class).
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
 *  (e.g. "1:2:1"), excluding zero classes. */
export function formatExpectedRatio(ratio) {
  if (!ratio) return '';
  const parts = [];
  for (const k of ['AA', 'AB', 'BB']) {
    if (ratio[k] > 0) parts.push(String(ratio[k]));
  }
  return parts.join(':');
}

// =====================================================================
// 2. χ² goodness-of-fit (1×K)
// =====================================================================

/**
 * χ² goodness-of-fit, observed vs expected ratio. Zero-expected cells
 * are dropped (df adjusted). Returns NaN p when fewer than 2 informative
 * cells.
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
 * Annotate which class is over/under-represented in a DISTORTED result.
 * Heterozygote_excess / _deficit take precedence when |dAB| is the
 * largest absolute residual; otherwise the largest absolute homozygote
 * deficit wins. Returns NONE for non-DISTORTED statuses or no
 * dominant deviation.
 *
 * @param {{observed:Object, expected:Object, status?:string}} args
 * @returns {string}  one of EFFECT_DIRECTIONS values
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
  if (Math.abs(dAB) >= Math.abs(dAA) && Math.abs(dAB) >= Math.abs(dBB)) {
    if (dAB > 0) return EFFECT_DIRECTIONS.HETEROZYGOTE_EXCESS;
    if (dAB < 0) return EFFECT_DIRECTIONS.HETEROZYGOTE_DEFICIT;
  }
  const deficits = [
    { tag: EFFECT_DIRECTIONS.AA_DEFICIT, mag: dAA < 0 ? -dAA : 0 },
    { tag: EFFECT_DIRECTIONS.BB_DEFICIT, mag: dBB < 0 ? -dBB : 0 },
  ];
  deficits.sort((a, b) => b.mag - a.mag);
  if (deficits[0].mag > 0) return deficits[0].tag;
  return EFFECT_DIRECTIONS.NONE;
}

// =====================================================================
// 4. Reliability tier (spec §4.1)
// =====================================================================

/**
 * Classify reliability from parent-call confidence, offspring count,
 * call rate, karyotype clarity, and confound flags.
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

  const high =
    bothConfident && n >= hi_n && cr >= hi_c && clarity === 'clear'
    && (confound === 'none' || confound === 'useful');
  if (high) return RELIABILITY_TIERS.HIGH;

  const medium =
    n >= md_n && cr >= md_c && clarity !== 'weak'
    && confound !== 'strong' && confound !== 'complex_nested';
  if (medium) return RELIABILITY_TIERS.MEDIUM;

  return RELIABILITY_TIERS.LOW;
}

// =====================================================================
// 5. Segregation-status classifier (spec §5)
// =====================================================================

/**
 * Map (test result, reliability, modifiers) → SEGREGATION_STATUS enum.
 *
 * Order of precedence:
 *   1. complex_model_flag → COMPLEX_MODEL
 *   2. parent_uncertain   → PARENT_UNCERTAIN
 *   3. n_offspring < underpowered_n_offspring → UNDERPOWERED
 *   4. p ≥ p_threshold    → MENDELIAN
 *   5. p borderline AND reliability low → AMBIGUOUS
 *   6. otherwise          → DISTORTED
 *
 * @param {Object} args
 * @param {Object} [opts]
 * @returns {string}  one of SEGREGATION_STATUS values
 */
export function classifySegregationStatus(args, opts) {
  const o = opts || {};
  const pThresh = Number.isFinite(o.p_threshold)              ? o.p_threshold              : MENDELIAN_TEST_DEFAULTS.p_threshold;
  const minN    = Number.isFinite(o.underpowered_n_offspring) ? o.underpowered_n_offspring : MENDELIAN_TEST_DEFAULTS.underpowered_n_offspring;
  const margin  = Number.isFinite(o.borderline_margin)        ? o.borderline_margin        : MENDELIAN_TEST_DEFAULTS.borderline_margin;

  const a = args || {};
  if (a.complex_model)    return SEGREGATION_STATUS.COMPLEX_MODEL;
  if (a.parent_uncertain) return SEGREGATION_STATUS.PARENT_UNCERTAIN;
  if (!Number.isFinite(a.n_offspring) || a.n_offspring < minN) {
    return SEGREGATION_STATUS.UNDERPOWERED;
  }
  if (!Number.isFinite(a.p_value)) return SEGREGATION_STATUS.UNDERPOWERED;
  if (a.p_value >= pThresh)        return SEGREGATION_STATUS.MENDELIAN;
  if (a.reliability === RELIABILITY_TIERS.LOW
      && Math.abs(a.p_value - pThresh) < margin) {
    return SEGREGATION_STATUS.AMBIGUOUS;
  }
  if (a.reliability === RELIABILITY_TIERS.LOW && a.p_value < pThresh) {
    return SEGREGATION_STATUS.AMBIGUOUS;
  }
  return SEGREGATION_STATUS.DISTORTED;
}

// =====================================================================
// 6. Per-family test orchestrator → spec §7 schema row
// =====================================================================

/**
 * End-to-end per (family × candidate) test.
 *
 * `inversion_type` is a passthrough label — it does NOT affect the
 * math (the cross / χ² / status logic is identical for paracentric,
 * pericentric, and unknown inversions). Downstream cohort comparisons
 * (e.g. para vs peri 2×2) group on this label.
 *
 * @param {Object} family
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
    parent_uncertain: f.parent_uncertain,
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
