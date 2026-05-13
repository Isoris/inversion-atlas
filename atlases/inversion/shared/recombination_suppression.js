// shared/recombination_suppression.js
// =====================================================================
// Per-candidate recombination-suppression classifier.
//
// Inputs (per the design note: "long range haplotype regimes +
// mendelian inheritance"):
//
//   1. Long-range linkage across regimes within the candidate's
//      interval (from shared/band_tracking/regime_linkage.js).
//      Strong Cramér's V between regime pairs = strong LD block =
//      strong suppression.
//
//   2. Mendelian segregation across families typed for this candidate
//      (from shared/mendelian_family_test.js). Many DISTORTED families
//      = recombinants slipping through = degraded suppression.
//
//   3. Karyotype distribution. The framework note explicitly says
//      "Homozygous state → No suppression" — if a population is
//      ~all-homozygous, there's no heterokaryotype substrate for
//      suppression to operate on, regardless of LD.
//
// The output is a single label in a 5-state vocab; the rules are
// inspectable, no ML.
// =====================================================================

// =====================================================================
// Vocab + defaults
// =====================================================================

/** 5-state recombination-suppression label. */
export const RECOMBINATION_SUPPRESSION = Object.freeze({
  STRONG:                    'strong',
  PARTIAL:                   'partial',
  ERODED:                    'eroded',
  NO_SUPPRESSION_HOMOZYGOUS: 'no_suppression_homozygous',
  NO_DATA:                   'no_data',
});

/** Default thresholds.
 *  Linkage thresholds intentionally match regime_linkage.js so the
 *  two modules agree on what "strong" linkage means. */
export const RECOMBINATION_SUPPRESSION_DEFAULTS = Object.freeze({
  /** Cramér's V floor for "strong" linkage (matches regime_linkage
   *  linked_above = 0.50). */
  v_strong:                0.50,
  /** Cramér's V floor for non-eroded (matches regime_linkage
   *  weakly_linked_above = 0.20). Below this with the inversion
   *  still polymorphic → ERODED. */
  v_eroded_below:          0.20,
  /** Fraction of families that must be MENDELIAN to call clean
   *  inheritance. */
  mendelian_clean_fraction: 0.80,
  /** Fraction of families that must be MENDELIAN at minimum for
   *  the inheritance signal to count at all. Below this → PARTIAL
   *  unless other evidence rescues. */
  mendelian_partial_floor:  0.50,
  /** Minimum heterokaryotype fraction (n_AB / n_called) for
   *  suppression to be testable. Below → NO_SUPPRESSION_HOMOZYGOUS. */
  min_het_fraction:         0.10,
  /** Minimum number of families needed for the Mendelian signal
   *  to participate. */
  min_n_families:           3,
});

// =====================================================================
// 1. Per-input summarisers (pure, missing-tolerant)
// =====================================================================

/**
 * Compute the cohort heterokaryotype fraction from a karyotype
 * distribution. Returns NaN when the cohort is empty or only
 * uncalled samples.
 *
 * @param {{n_AA?:number, n_AB?:number, n_BB?:number, n_uncalled?:number}} dist
 * @returns {number}
 */
export function heterokaryotypeFraction(dist) {
  if (!dist || typeof dist !== 'object') return NaN;
  const aa = Number.isFinite(dist.n_AA) ? dist.n_AA : 0;
  const ab = Number.isFinite(dist.n_AB) ? dist.n_AB : 0;
  const bb = Number.isFinite(dist.n_BB) ? dist.n_BB : 0;
  const called = aa + ab + bb;
  if (called === 0) return NaN;
  return ab / called;
}

/**
 * Mendelian "clean" fraction (n_mendelian / n_families, ignoring
 * other-status families). Returns NaN when n_families is 0.
 *
 * @param {{n_families?:number, n_mendelian?:number, n_distorted?:number, n_other?:number}} sum
 * @returns {number}
 */
export function mendelianCleanFraction(sum) {
  if (!sum || typeof sum !== 'object') return NaN;
  const n = Number.isFinite(sum.n_families) ? sum.n_families : 0;
  if (n === 0) return NaN;
  const m = Number.isFinite(sum.n_mendelian) ? sum.n_mendelian : 0;
  return m / n;
}

// =====================================================================
// 2. classifyRecombinationSuppression
// =====================================================================

/**
 * Map (regime_linkage_summary, mendelian_summary, karyotype_distribution)
 * to a recombination-suppression label.
 *
 * Decision rule (precedence order):
 *
 *   1. no_data
 *      - All three inputs missing OR none provides usable evidence.
 *
 *   2. no_suppression_homozygous
 *      - Heterokaryotype fraction < min_het_fraction AND linkage
 *        evidence available (or absent) — there's no substrate.
 *
 *   3. strong
 *      - max regime-linkage V ≥ v_strong AND
 *        (no Mendelian data OR clean fraction ≥ mendelian_clean_fraction)
 *      - Tight LD block + clean inheritance = full suppression.
 *
 *   4. eroded
 *      - max regime-linkage V < v_eroded_below
 *        (inversion still polymorphic but LD is gone — gene
 *        conversion has eaten away the block, typical of old
 *        inversions).
 *
 *   5. partial
 *      - default for cases between strong and eroded, OR strong
 *        linkage with some non-Mendelian families.
 *
 * @param {{
 *   regime_linkage_summary?:  {max_v?:number, mean_v?:number,
 *                              n_pairs?:number,
 *                              n_linked?:number,
 *                              n_weakly_linked?:number,
 *                              n_independent?:number},
 *   mendelian_summary?:       {n_families?:number, n_mendelian?:number,
 *                              n_distorted?:number, n_other?:number},
 *   karyotype_distribution?:  {n_AA?:number, n_AB?:number,
 *                              n_BB?:number, n_uncalled?:number},
 * }} args
 * @param {Object} [opts]   threshold overrides
 * @returns {string}        one of RECOMBINATION_SUPPRESSION values
 */
export function classifyRecombinationSuppression(args, opts) {
  const o = opts || {};
  const D = RECOMBINATION_SUPPRESSION_DEFAULTS;
  const vStrong      = Number.isFinite(o.v_strong)                 ? o.v_strong                 : D.v_strong;
  const vErodedBelow = Number.isFinite(o.v_eroded_below)           ? o.v_eroded_below           : D.v_eroded_below;
  const cleanFrac    = Number.isFinite(o.mendelian_clean_fraction) ? o.mendelian_clean_fraction : D.mendelian_clean_fraction;
  const partialFloor = Number.isFinite(o.mendelian_partial_floor)  ? o.mendelian_partial_floor  : D.mendelian_partial_floor;
  const minHet       = Number.isFinite(o.min_het_fraction)         ? o.min_het_fraction         : D.min_het_fraction;
  const minFams      = Number.isFinite(o.min_n_families)           ? o.min_n_families           : D.min_n_families;

  const a = args || {};
  const linkSum = a.regime_linkage_summary;
  const menSum  = a.mendelian_summary;
  const karyo   = a.karyotype_distribution;

  const hasLink = linkSum && Number.isFinite(linkSum.max_v);
  const max_v   = hasLink ? linkSum.max_v : NaN;
  const hetFrac = heterokaryotypeFraction(karyo);
  const hasKaryo = Number.isFinite(hetFrac);
  const cleanF  = mendelianCleanFraction(menSum);
  const n_fams  = menSum && Number.isFinite(menSum.n_families) ? menSum.n_families : 0;
  const hasMen  = n_fams >= minFams;

  // Rule 1 — no_data
  if (!hasLink && !hasMen && !hasKaryo) {
    return RECOMBINATION_SUPPRESSION.NO_DATA;
  }

  // Rule 2 — no_suppression_homozygous (substrate check)
  // If we have karyotype data and heterokaryotypes are vanishingly
  // rare, there's no suppression to call. This wins over the linkage
  // verdict because the framework note is explicit: "Homozygous
  // state → No suppression."
  if (hasKaryo && hetFrac < minHet) {
    return RECOMBINATION_SUPPRESSION.NO_SUPPRESSION_HOMOZYGOUS;
  }

  // Rule 3 — strong
  if (hasLink && max_v >= vStrong) {
    if (!hasMen) return RECOMBINATION_SUPPRESSION.STRONG;
    if (cleanF >= cleanFrac) return RECOMBINATION_SUPPRESSION.STRONG;
    // High linkage but Mendelian data shows recombinants slipping through.
    return RECOMBINATION_SUPPRESSION.PARTIAL;
  }

  // Rule 4 — eroded (low linkage, polymorphic inversion)
  if (hasLink && max_v < vErodedBelow) {
    return RECOMBINATION_SUPPRESSION.ERODED;
  }

  // Rule 5 — partial (intermediate linkage, or Mendelian data only)
  if (hasLink || hasMen) {
    // If linkage missing but Mendelian very clean → call partial
    // (we lack the LD evidence to upgrade to strong).
    if (!hasLink && hasMen) {
      if (cleanF >= cleanFrac) return RECOMBINATION_SUPPRESSION.PARTIAL;
      if (cleanF >= partialFloor) return RECOMBINATION_SUPPRESSION.PARTIAL;
      // Mostly distorted with no LD context → eroded-or-broken
      // (default to partial, the conservative call).
      return RECOMBINATION_SUPPRESSION.PARTIAL;
    }
    return RECOMBINATION_SUPPRESSION.PARTIAL;
  }

  // Should be unreachable, but fall back to no_data.
  return RECOMBINATION_SUPPRESSION.NO_DATA;
}

// =====================================================================
// 3. Convenience: summarise a regime-linkage matrix into the shape
//    classifyRecombinationSuppression expects.
// =====================================================================

/**
 * Roll a regime-linkage matrix output (from
 * regime_linkage.regimeLinkageMatrix) into the
 * `regime_linkage_summary` shape this module consumes.
 *
 * @param {{pairs:Array<{cramers_v:number, verdict:string}>}} linkageMatrix
 * @returns {{max_v:number, mean_v:number, n_pairs:number,
 *            n_linked:number, n_weakly_linked:number,
 *            n_independent:number}|null}
 */
export function summarizeRegimeLinkageMatrix(linkageMatrix) {
  if (!linkageMatrix || !Array.isArray(linkageMatrix.pairs)
      || linkageMatrix.pairs.length === 0) {
    return null;
  }
  let max_v = -Infinity, sum_v = 0, n_finite = 0;
  let n_linked = 0, n_weak = 0, n_indep = 0;
  for (const p of linkageMatrix.pairs) {
    if (!p) continue;
    if (Number.isFinite(p.cramers_v)) {
      if (p.cramers_v > max_v) max_v = p.cramers_v;
      sum_v += p.cramers_v;
      n_finite++;
    }
    if (p.verdict === 'linked')        n_linked++;
    else if (p.verdict === 'weakly_linked') n_weak++;
    else if (p.verdict === 'independent')   n_indep++;
  }
  return {
    max_v:           n_finite > 0 ? max_v : NaN,
    mean_v:          n_finite > 0 ? sum_v / n_finite : NaN,
    n_pairs:         linkageMatrix.pairs.length,
    n_linked,
    n_weakly_linked: n_weak,
    n_independent:   n_indep,
  };
}
