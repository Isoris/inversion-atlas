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
