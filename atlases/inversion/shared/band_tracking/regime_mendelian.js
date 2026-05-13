// shared/band_tracking/regime_mendelian.js
// =====================================================================
// LAYER 4a — per-regime Mendelian annotation.
//
// Annotates each long-range regime (Layer 2 output) with TWO
// independent Mendelian-inheritance views — both run when their
// respective inputs are available. The downstream consumer (paper /
// registry) can pick whichever method best fits the question.
//
//   METHOD A — Trio contradiction counting
//     Input: trios = [{father, mother, offspring}, ...] (from
//     ngsRelate / ngsPedigree first-degree pair resolver).
//     For each trio: look up each member's regime karyotype call,
//     look up the expected offspring PMF given parental karyotypes,
//     count "contradictions" (offspring in a state with expected
//     probability 0). Aggregates to a regime-level
//     contradiction_rate + support_status.
//     Granularity: one number per regime.
//
//   METHOD B — Per-family chi-square goodness-of-fit
//     Input: families = [{family_id, parents:[fa, mo],
//                          offspring:[so0, so1, ...]}, ...]
//     For each family: look up parent karyotypes, look up the
//     expected ratio for that cross (CROSS_TO_RATIO), tally
//     offspring karyotype counts, run mendelianChiSquare via
//     assessSegregation. Per-family 6-state segregation_status +
//     7-tag effect_direction.
//     Granularity: one row per (regime × family).
//
// Inputs:
//   - regimes              array of Layer-2 refined regimes (each
//                          with hom_a_intersect / hom_b_intersect /
//                          het_union Sets)
//   - opts.trios?          enables Method A
//   - opts.families?       enables Method B
//   - opts.inversion_type? per-regime classifier (caller-provided
//                          'paracentric' / 'pericentric' / 'unknown')
//                          for the para-vs-peri rollup
//
// All pure JS — no DOM, no fetch. Caller does the data resolution.

import {
  assessSegregation,
  buildParaPeriContingency,
  CROSS_TO_RATIO,
  SEGREGATION_STATUS,
  EFFECT_DIRECTION,
} from '../mendelian_segregation.js';
import {
  annotateRegimeWithDyads,
  MEIOTIC_DRIVE_VERDICTS,
} from './regime_dyad_mendelian.js';

// =====================================================================
// Vocab
// =====================================================================

/** Karyotype-state vocab used by both methods. */
export const REGIME_KARYOTYPE_STATES = Object.freeze(['AA', 'AB', 'BB']);

/** Method-A trio verdict tags (matches analysis/mendelian.js). */
export const TRIO_SUPPORT_STATUS = Object.freeze({
  SUPPORTED:    'supported',
  INCONCLUSIVE: 'inconclusive',
  CONTRADICTED: 'contradicted',
});

/**
 * Expected-offspring PMF lookup. Mirrors analysis/mendelian.js
 * EXPECTED but keyed in atlas-side `AA`/`AB`/`BB` instead of
 * `HOM_REF` / `HET` / `HOM_INV`. Symmetric — caller can index
 * either way.
 */
export const REGIME_EXPECTED = Object.freeze({
  AA: Object.freeze({
    AA: Object.freeze({ AA: 1.0, AB: 0.0, BB: 0.0 }),
    AB: Object.freeze({ AA: 0.5, AB: 0.5, BB: 0.0 }),
    BB: Object.freeze({ AA: 0.0, AB: 1.0, BB: 0.0 }),
  }),
  AB: Object.freeze({
    AA: Object.freeze({ AA: 0.5,  AB: 0.5, BB: 0.0  }),
    AB: Object.freeze({ AA: 0.25, AB: 0.5, BB: 0.25 }),
    BB: Object.freeze({ AA: 0.0,  AB: 0.5, BB: 0.5  }),
  }),
  BB: Object.freeze({
    AA: Object.freeze({ AA: 0.0, AB: 1.0, BB: 0.0 }),
    AB: Object.freeze({ AA: 0.0, AB: 0.5, BB: 0.5 }),
    BB: Object.freeze({ AA: 0.0, AB: 0.0, BB: 1.0 }),
  }),
});

/** Thresholds for support_status (Method A). */
export const TRIO_SUPPORT_THRESHOLDS = Object.freeze({
  // contradiction_rate > this → CONTRADICTED
  contradicted_above: 0.10,
  // contradiction_rate > this AND ≤ contradicted_above → INCONCLUSIVE
  inconclusive_above: 0.02,
  // Otherwise SUPPORTED.
  // (matches the legacy analysis/mendelian_inheritance.js _supportStatus.)
});

/**
 * Minimum informative trios / families required for a regime
 * annotation to leave the `insufficient_data` short-circuit.
 */
export const REGIME_MENDELIAN_DEFAULTS = Object.freeze({
  min_trios: 5,
  min_families: 1,
});

// =====================================================================
// 1. Per-regime karyotype lookup
// =====================================================================

/**
 * Look up a sample's karyotype assignment in one regime. Returns
 * 'AA' / 'AB' / 'BB' / null (uncalled).
 *
 * @param {Object} regime
 * @param {number} sampleIdx
 * @returns {string|null}
 */
export function regimeKaryotypeForSample(regime, sampleIdx) {
  if (!regime || !Number.isFinite(sampleIdx)) return null;
  const homA = regime.hom_a_intersect;
  const homB = regime.hom_b_intersect;
  const het  = regime.het_union;
  if (homA && homA.has && homA.has(sampleIdx)) return 'AA';
  if (homB && homB.has && homB.has(sampleIdx)) return 'BB';
  if (het  && het.has  && het.has(sampleIdx))  return 'AB';
  return null;
}

// =====================================================================
// 2. METHOD A — trio contradiction counting
// =====================================================================

/**
 * Run Method A on one regime. Returns:
 *   {
 *     method: 'A',
 *     n_trios:           int   total trios supplied
 *     n_informative:     int   trios with all 3 members called in this regime
 *     n_contradictions:  int   offspring sits in expected-PMF-zero state
 *     contradiction_rate: float
 *     support_status:    SUPPORTED | INCONCLUSIVE | CONTRADICTED
 *                       | 'insufficient_data',
 *     trio_rows:         [{father, mother, offspring, fa_kar, mo_kar,
 *                          off_kar, expected_pmf, is_contradiction}],
 *     by_parent_cross:   { 'AA_x_AB': {n_trios, n_contradictions, ...} },
 *   }
 *
 * @param {Object} regime
 * @param {Array<{father:number, mother:number, offspring:number}>} trios
 * @param {Object} [opts]
 * @returns {Object}
 */
export function annotateRegimeWithTrios(regime, trios, opts) {
  const o = opts || {};
  const minTrios = Number.isFinite(o.min_trios)
    ? o.min_trios : REGIME_MENDELIAN_DEFAULTS.min_trios;
  const above = Number.isFinite(o.contradicted_above)
    ? o.contradicted_above : TRIO_SUPPORT_THRESHOLDS.contradicted_above;
  const incon = Number.isFinite(o.inconclusive_above)
    ? o.inconclusive_above : TRIO_SUPPORT_THRESHOLDS.inconclusive_above;

  const trio_rows = [];
  const by_parent_cross = Object.create(null);
  let n_contradictions = 0;
  let n_informative = 0;
  const total = Array.isArray(trios) ? trios.length : 0;

  for (let t = 0; t < total; t++) {
    const trio = trios[t];
    if (!trio) continue;
    const fa_kar = regimeKaryotypeForSample(regime, trio.father);
    const mo_kar = regimeKaryotypeForSample(regime, trio.mother);
    const off_kar = regimeKaryotypeForSample(regime, trio.offspring);
    if (fa_kar == null || mo_kar == null || off_kar == null) {
      trio_rows.push({
        father: trio.father, mother: trio.mother, offspring: trio.offspring,
        fa_kar, mo_kar, off_kar,
        expected_pmf: null, is_contradiction: null,
      });
      continue;
    }
    const pmf = REGIME_EXPECTED[fa_kar][mo_kar];
    const is_contradiction = pmf[off_kar] === 0;
    n_informative++;
    if (is_contradiction) n_contradictions++;
    const key = [fa_kar, mo_kar].sort().join('_x_');
    if (!by_parent_cross[key]) {
      by_parent_cross[key] = { n_trios: 0, n_contradictions: 0,
                                offspring_tally: { AA: 0, AB: 0, BB: 0 } };
    }
    by_parent_cross[key].n_trios++;
    if (is_contradiction) by_parent_cross[key].n_contradictions++;
    by_parent_cross[key].offspring_tally[off_kar]++;
    trio_rows.push({
      father: trio.father, mother: trio.mother, offspring: trio.offspring,
      fa_kar, mo_kar, off_kar,
      expected_pmf: pmf, is_contradiction,
    });
  }
  if (n_informative < minTrios) {
    return {
      method: 'A', n_trios: total, n_informative, n_contradictions: 0,
      contradiction_rate: null,
      support_status: 'insufficient_data',
      trio_rows, by_parent_cross,
    };
  }
  const rate = n_contradictions / n_informative;
  let support;
  if (rate > above)      support = TRIO_SUPPORT_STATUS.CONTRADICTED;
  else if (rate > incon) support = TRIO_SUPPORT_STATUS.INCONCLUSIVE;
  else                   support = TRIO_SUPPORT_STATUS.SUPPORTED;
  return {
    method: 'A',
    n_trios: total, n_informative, n_contradictions,
    contradiction_rate: rate,
    support_status: support,
    trio_rows, by_parent_cross,
  };
}

// =====================================================================
// 3. METHOD B — per-family chi-square goodness-of-fit
// =====================================================================

/**
 * Run Method B on one regime. Returns:
 *   {
 *     method: 'B',
 *     n_families:         int total families supplied
 *     n_informative:      int families with both parents called +
 *                              ≥ min_offspring offspring
 *     family_rows:        [{family_id, parent1_call, parent2_call,
 *                          expected_ratio, obs_AA, obs_AB, obs_BB,
 *                          n_offspring, p_value, chi2, df,
 *                          segregation_status, effect_direction, ...}],
 *     summary:            counts per segregation_status across families
 *   }
 *
 * @param {Object} regime
 * @param {Array<{family_id:any, parents:Array<number>, offspring:Array<number>}>} families
 * @param {Object} [opts]
 * @returns {Object}
 */
export function annotateRegimeWithFamilies(regime, families, opts) {
  const o = opts || {};
  const minFamilies = Number.isFinite(o.min_families)
    ? o.min_families : REGIME_MENDELIAN_DEFAULTS.min_families;

  const family_rows = [];
  const summary = {
    n_MENDELIAN: 0, n_DISTORTED: 0, n_AMBIGUOUS: 0,
    n_UNDERPOWERED: 0, n_COMPLEX_MODEL: 0, n_PARENT_UNCERTAIN: 0,
  };
  let n_informative = 0;
  const total = Array.isArray(families) ? families.length : 0;

  for (let f = 0; f < total; f++) {
    const fam = families[f];
    if (!fam || !Array.isArray(fam.parents) || fam.parents.length < 2
        || !Array.isArray(fam.offspring) || fam.offspring.length === 0) {
      continue;
    }
    const p1 = regimeKaryotypeForSample(regime, fam.parents[0]);
    const p2 = regimeKaryotypeForSample(regime, fam.parents[1]);
    // Tally offspring karyotypes inside the regime.
    let obs_AA = 0, obs_AB = 0, obs_BB = 0;
    for (const offIdx of fam.offspring) {
      const k = regimeKaryotypeForSample(regime, offIdx);
      if (k === 'AA') obs_AA++;
      else if (k === 'AB') obs_AB++;
      else if (k === 'BB') obs_BB++;
    }
    // Resolve expected ratio from the parental cross.
    const crossKey = p1 && p2 ? [p1, p2].sort().join('_x_') : null;
    const ratioStr = crossKey ? CROSS_TO_RATIO[crossKey] : null;
    // assessSegregation handles ratio resolution + parent_uncertain
    // short-circuit; we just hand it a per-row shape.
    const row = assessSegregation({
      family_id: fam.family_id,
      inversion_type: fam.inversion_type || o.inversion_type || null,
      parent1_call: p1, parent2_call: p2,
      expected_ratio: ratioStr || null,
      observed: [obs_AA, obs_AB, obs_BB],
      reliability: fam.reliability || 'medium',
      parent_uncertain: (p1 == null) || (p2 == null),
      complex_model: !!fam.complex_model,
    }, o);
    if (row) {
      family_rows.push(row);
      const tag = 'n_' + row.segregation_status;
      if (tag in summary) summary[tag]++;
      if (row.segregation_status !== SEGREGATION_STATUS.UNDERPOWERED
          && row.segregation_status !== SEGREGATION_STATUS.PARENT_UNCERTAIN) {
        n_informative++;
      }
    }
  }
  return {
    method: 'B',
    n_families: total, n_informative,
    family_rows, summary,
    insufficient: n_informative < minFamilies,
  };
}

// =====================================================================
// 4. Orchestrator — run whichever methods have inputs
// =====================================================================

/**
 * Annotate every regime with both Method A and Method B (when their
 * respective inputs are available). Returns one annotation object
 * per regime. Caller can also opt into the cohort-level
 * paracentric-vs-pericentric rollup (Method B Stage 2) via
 * `opts.para_peri_rollup = true` AND per-regime `inversion_type`.
 *
 * Output:
 *   {
 *     ok, n_regimes,
 *     per_regime: [{ regime_id, method_a?, method_b? }, ...],
 *     para_peri_table?:  output of buildParaPeriContingency on the
 *                        UNION of all method_b family_rows across regimes
 *   }
 *
 * @param {Array<Object>} regimes
 * @param {{trios?:Array, families?:Array, para_peri_rollup?:boolean,
 *          inversion_type?:string}} opts
 * @returns {Object}
 */
export function annotateRegimesWithMendelian(regimes, opts) {
  if (!Array.isArray(regimes)) {
    return { ok: false, n_regimes: 0, per_regime: [] };
  }
  const o = opts || {};
  const per_regime = regimes.map(r => {
    const out = { regime_id: r ? r.regime_id : null };
    if (Array.isArray(o.trios) && o.trios.length > 0) {
      out.method_a = annotateRegimeWithTrios(r, o.trios, o);
    }
    if (Array.isArray(o.families) && o.families.length > 0) {
      out.method_b = annotateRegimeWithFamilies(r, o.families, o);
    }
    return out;
  });
  const result = { ok: true, n_regimes: regimes.length, per_regime };
  if (o.para_peri_rollup && Array.isArray(o.families)) {
    const allRows = [];
    for (const ann of per_regime) {
      if (!ann.method_b || !Array.isArray(ann.method_b.family_rows)) continue;
      for (const row of ann.method_b.family_rows) allRows.push(row);
    }
    result.para_peri_table = buildParaPeriContingency(allRows);
  }
  return result;
}

// =====================================================================
// 5. computeFamilyReliabilityTier — SPEC §4.1 auto-tier
// =====================================================================

/** Reliability tier vocab (SPEC §4.1). */
export const FAMILY_RELIABILITY_TIERS = Object.freeze({
  HIGH: 'high', MEDIUM: 'medium', LOW: 'low',
});

/** Thresholds per SPEC §4.1 table. */
export const FAMILY_RELIABILITY_DEFAULTS = Object.freeze({
  // Offspring count tiers (SPEC §4.1 col 3).
  offspring_high:  20,
  offspring_med:   10,
  // Call-rate tiers (SPEC §4.1 col 4).
  call_rate_high:  0.90,
  call_rate_med:   0.80,
});

/**
 * Compute the family's reliability tier per SPEC §4.1. The tier is
 * the MIN across four axes (both-parents-called, offspring n, call
 * rate, karyotype clarity). A family with strong evidence on all
 * four axes is `high`; degraded on any axis demotes it.
 *
 * Axes:
 *   1. Both parents called in this regime?  — yes/uncertain/no
 *   2. Offspring n                          — ≥ 20 / 10-20 / < 10
 *   3. Call rate (n_called / n_offspring)   — ≥ 90% / ≥ 80% / < 80%
 *   4. Karyotype clarity                    — 3 / 2 / 1 classes populated
 *
 * Returns:
 *   {
 *     tier:    HIGH | MEDIUM | LOW,
 *     axes:    {parents, offspring_n, call_rate, karyotype_clarity},
 *     limiting_axis: name of the worst axis (the one that capped the tier),
 *   }
 *
 * SPEC §4.1 col 5 (confound check) is caller-supplied via
 * `opts.confound_tier` ∈ {'high','medium','low'}; defaults to 'high'
 * (no confound assumed) when omitted.
 *
 * @param {{parents:Array<number>, offspring:Array<number>}} family
 * @param {Object} regime
 * @param {Object} [opts]
 * @returns {Object}
 */
export function computeFamilyReliabilityTier(family, regime, opts) {
  const o = opts || {};
  const offHigh = Number.isFinite(o.offspring_high)
    ? o.offspring_high : FAMILY_RELIABILITY_DEFAULTS.offspring_high;
  const offMed  = Number.isFinite(o.offspring_med)
    ? o.offspring_med  : FAMILY_RELIABILITY_DEFAULTS.offspring_med;
  const callHigh = Number.isFinite(o.call_rate_high)
    ? o.call_rate_high : FAMILY_RELIABILITY_DEFAULTS.call_rate_high;
  const callMed  = Number.isFinite(o.call_rate_med)
    ? o.call_rate_med  : FAMILY_RELIABILITY_DEFAULTS.call_rate_med;

  // Axis 1 — both parents called
  let parents_axis;
  if (!family || !Array.isArray(family.parents) || family.parents.length < 2) {
    parents_axis = FAMILY_RELIABILITY_TIERS.LOW;
  } else {
    const p1 = regimeKaryotypeForSample(regime, family.parents[0]);
    const p2 = regimeKaryotypeForSample(regime, family.parents[1]);
    parents_axis = (p1 && p2)
      ? FAMILY_RELIABILITY_TIERS.HIGH
      : (p1 || p2)
        ? FAMILY_RELIABILITY_TIERS.MEDIUM
        : FAMILY_RELIABILITY_TIERS.LOW;
  }

  // Axis 2 — offspring count
  const n_offspring = (family && Array.isArray(family.offspring))
    ? family.offspring.length : 0;
  const offspring_axis = n_offspring >= offHigh ? FAMILY_RELIABILITY_TIERS.HIGH
    : n_offspring >= offMed ? FAMILY_RELIABILITY_TIERS.MEDIUM
    : FAMILY_RELIABILITY_TIERS.LOW;

  // Axis 3 — call rate
  let n_called = 0;
  if (family && Array.isArray(family.offspring)) {
    for (const idx of family.offspring) {
      if (regimeKaryotypeForSample(regime, idx) != null) n_called++;
    }
  }
  const call_rate = n_offspring > 0 ? n_called / n_offspring : 0;
  const call_rate_axis = call_rate >= callHigh ? FAMILY_RELIABILITY_TIERS.HIGH
    : call_rate >= callMed ? FAMILY_RELIABILITY_TIERS.MEDIUM
    : FAMILY_RELIABILITY_TIERS.LOW;

  // Axis 4 — karyotype clarity (number of populated classes in the regime)
  let n_classes = 0;
  if (regime) {
    if (regime.hom_a_intersect && regime.hom_a_intersect.size > 0) n_classes++;
    if (regime.hom_b_intersect && regime.hom_b_intersect.size > 0) n_classes++;
    if (regime.het_union       && regime.het_union.size > 0)       n_classes++;
  }
  const karyotype_axis = n_classes >= 3 ? FAMILY_RELIABILITY_TIERS.HIGH
    : n_classes >= 2 ? FAMILY_RELIABILITY_TIERS.MEDIUM
    : FAMILY_RELIABILITY_TIERS.LOW;

  // Optional confound axis (caller supplied)
  const confound_axis = o.confound_tier || FAMILY_RELIABILITY_TIERS.HIGH;

  // Tier = min across axes
  const order = { high: 2, medium: 1, low: 0 };
  const axes = {
    parents: parents_axis,
    offspring_n: offspring_axis,
    call_rate: call_rate_axis,
    karyotype_clarity: karyotype_axis,
    confound: confound_axis,
  };
  let tier = FAMILY_RELIABILITY_TIERS.HIGH;
  let limiting_axis = 'parents';
  for (const [name, ax] of Object.entries(axes)) {
    if (order[ax] < order[tier]) {
      tier = ax;
      limiting_axis = name;
    }
  }
  return {
    tier,
    axes,
    limiting_axis,
    n_offspring, n_called, call_rate, n_classes,
  };
}

// =====================================================================
// 6. rollupEffectDirection — SPEC §8 Question 3
// =====================================================================

/**
 * Aggregate the per-family effect_direction tags across a regime
 * (or any family-row collection). Answers SPEC §8 Question 3:
 * "when distorted, is the distortion mostly homozygote deficit,
 * heterozygote excess, or one-arrangement loss?"
 *
 * Returns:
 *   {
 *     n_total:           int   total rows
 *     n_distorted:       int   rows with segregation_status DISTORTED
 *     by_direction:      {none, AA_deficit, BB_deficit, AB_deficit,
 *                         heterozygote_excess, heterozygote_deficit,
 *                         one_parent_transmission_bias}
 *     dominant_direction:string|null  most-frequent NON-'none' direction
 *     dominant_frac:     fraction of DISTORTED rows in the dominant
 *                        direction; NaN when no distorted rows
 *   }
 *
 * @param {Array<Object>} family_rows  output of annotateRegimeWithFamilies
 * @returns {Object}
 */
export function rollupEffectDirection(family_rows) {
  const directions = ['none', 'AA_deficit', 'BB_deficit', 'AB_deficit',
    'heterozygote_excess', 'heterozygote_deficit',
    'one_parent_transmission_bias'];
  const by_direction = Object.create(null);
  for (const d of directions) by_direction[d] = 0;
  let n_total = 0, n_distorted = 0;
  for (const row of family_rows || []) {
    if (!row) continue;
    n_total++;
    if (row.segregation_status === 'DISTORTED') n_distorted++;
    const d = row.effect_direction || 'none';
    if (d in by_direction) by_direction[d]++;
  }
  // Pick dominant NON-'none' direction.
  let dom = null, domCount = 0;
  for (const d of directions) {
    if (d === 'none') continue;
    if (by_direction[d] > domCount) {
      dom = d;
      domCount = by_direction[d];
    }
  }
  const dominant_frac = n_distorted > 0 ? domCount / n_distorted : NaN;
  return {
    n_total, n_distorted,
    by_direction,
    dominant_direction: dom,
    dominant_frac,
  };
}

// =====================================================================
// 7. annotateRegimeMendelianAll — combined trio + family + dyad
// =====================================================================

/**
 * Run Method A (trios), Method B (families), AND Method 4d (dyads)
 * on one regime — whichever inputs are supplied — and emit a
 * unified annotation with a cross-method agreement flag.
 *
 * Cross-method agreement: a regime is considered "all-methods-agree"
 * when:
 *   - Method A (if run): support_status === SUPPORTED
 *   - Method B (if run): summary.n_DISTORTED / summary.n_total ≤
 *     `distortion_frac_for_agreement` (default 0.20)
 *   - Method 4d (if run): meiotic_drive.verdict === MENDELIAN
 *
 * When all available methods agree → `methods_agree_mendelian = true`.
 * When all available methods agree on a non-Mendelian outcome (e.g.
 * A=CONTRADICTED + B mostly DISTORTED + 4d STRONG_DRIVE) →
 * `methods_agree_distorted = true`. Mixed → both false (a flag for
 * paper-quality reviewer attention).
 *
 * Returns:
 *   {
 *     regime_id,
 *     method_a?:     output of annotateRegimeWithTrios
 *     method_b?:     output of annotateRegimeWithFamilies
 *     method_4d?:    output of annotateRegimeWithDyads
 *     effect_rollup?: output of rollupEffectDirection (from method_b)
 *     methods_agree_mendelian: bool
 *     methods_agree_distorted: bool
 *     summary_verdict: 'mendelian' | 'distorted' | 'mixed' |
 *                      'insufficient_data'
 *   }
 *
 * @param {Object} regime
 * @param {{trios?:Array, families?:Array, dyads?:Array,
 *          distortion_frac_for_agreement?:number}} args
 * @param {Object} [opts]
 * @returns {Object}
 */
export function annotateRegimeMendelianAll(regime, args, opts) {
  const a = args || {};
  const o = opts || {};
  const distFracThr = Number.isFinite(a.distortion_frac_for_agreement)
    ? a.distortion_frac_for_agreement : 0.20;

  const out = { regime_id: regime ? regime.regime_id : null };
  let agreeMend = [], agreeDist = [];

  // Method A — trios
  if (Array.isArray(a.trios) && a.trios.length > 0) {
    out.method_a = annotateRegimeWithTrios(regime, a.trios, o);
    if (out.method_a.support_status === TRIO_SUPPORT_STATUS.SUPPORTED) {
      agreeMend.push('A');
    } else if (out.method_a.support_status === TRIO_SUPPORT_STATUS.CONTRADICTED) {
      agreeDist.push('A');
    }
  }
  // Method B — families
  if (Array.isArray(a.families) && a.families.length > 0) {
    out.method_b = annotateRegimeWithFamilies(regime, a.families, o);
    out.effect_rollup = rollupEffectDirection(out.method_b.family_rows);
    const totalCalled = out.method_b.summary.n_MENDELIAN
                        + out.method_b.summary.n_DISTORTED;
    if (totalCalled > 0) {
      const distFrac = out.method_b.summary.n_DISTORTED / totalCalled;
      if (distFrac <= distFracThr) agreeMend.push('B');
      else if (distFrac >= 1 - distFracThr) agreeDist.push('B');
    }
  }
  // Method 4d — dyads
  if (Array.isArray(a.dyads) && a.dyads.length > 0) {
    out.method_4d = annotateRegimeWithDyads(regime, a.dyads, o);
    const v = out.method_4d.meiotic_drive.verdict;
    if (v === MEIOTIC_DRIVE_VERDICTS.MENDELIAN) {
      agreeMend.push('4d');
    } else if (v === MEIOTIC_DRIVE_VERDICTS.STRONG_DRIVE
               || v === MEIOTIC_DRIVE_VERDICTS.INVIABILITY) {
      agreeDist.push('4d');
    }
  }

  // Cross-method agreement flags.
  const n_methods_run =
    (out.method_a  ? 1 : 0) +
    (out.method_b  ? 1 : 0) +
    (out.method_4d ? 1 : 0);
  out.n_methods_run = n_methods_run;
  out.methods_agree_mendelian = n_methods_run > 0
    && agreeMend.length === n_methods_run;
  out.methods_agree_distorted = n_methods_run > 0
    && agreeDist.length === n_methods_run;

  if (n_methods_run === 0) {
    out.summary_verdict = 'insufficient_data';
  } else if (out.methods_agree_mendelian) {
    out.summary_verdict = 'mendelian';
  } else if (out.methods_agree_distorted) {
    out.summary_verdict = 'distorted';
  } else {
    out.summary_verdict = 'mixed';
  }
  return out;
}
