// shared/inversion_relationships.js
// =====================================================================
// Pair-level relationships between inversion candidates.
//
// Two distinct concepts (per the framework note: "do not mix them"):
//
//   1. INTERSECTING — geometric: their bp intervals overlap on the
//      same chromosome. Pure interval-arithmetic check.
//
//   2. CO_OCCURRING — statistical: their karyotype calls across the
//      cohort are associated more often than chance would predict.
//      Per-sample (genotype A, genotype B) χ² of independence on a
//      9-cell contingency (3 karyotypes × 3 karyotypes). Can be
//      same-chromosome (often, but not always — long-range LD) OR
//      different chromosomes (epistatic interactions, supergene
//      networks).
//
// Two inversions can be:
//   - INTERSECTING only        (overlap geometrically but uncorrelated)
//   - CO_OCCURRING only        (different chromosomes, correlated)
//   - BOTH                     (same chromosome, overlapping, correlated)
//   - NONE                     (independent, non-overlapping)
//
// Output: a pair-level row that the classification page can tile
// alongside its per-candidate row (the 13-axis row).
//
// Composes existing primitives:
//   - shared/contingency.js → chiSquare, cramersV, chiSqSurvival
// =====================================================================

import { chiSquare, cramersV, chiSqSurvival } from './contingency.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** 4-state relationship label. */
export const INVERSION_RELATIONSHIP_TYPES = Object.freeze({
  NONE:         'none',
  INTERSECTING: 'intersecting',
  CO_OCCURRING: 'co_occurring',
  BOTH:         'both',
});

/** Strength bands for the co-occurrence Cramér's V (matching the
 *  regime_linkage thresholds for cross-module consistency). */
export const CO_OCCURRENCE_STRENGTH = Object.freeze({
  STRONG:            'strong',
  WEAK:              'weak',
  INDEPENDENT:       'independent',
  INSUFFICIENT_DATA: 'insufficient_data',
});

export const INVERSION_RELATIONSHIP_DEFAULTS = Object.freeze({
  /** Cramér's V floor for "strong" co-occurrence. Match
   *  regime_linkage's linked_above = 0.50. */
  v_strong_above:     0.50,
  /** Cramér's V floor for "weak" co-occurrence. Match
   *  regime_linkage's weakly_linked_above = 0.20. */
  v_weak_above:       0.20,
  /** Min samples with calls at BOTH inversions for the test to fire. */
  min_n_both_called:  20,
  /** χ² significance level. */
  alpha:              0.05,
});

// =====================================================================
// 1. Geometric: intersection
// =====================================================================

/**
 * Pure-geometry intersection test on two inversion candidates'
 * `(chrom, start_bp, end_bp)` intervals. Uses the standard half-open
 * overlap rule (a.start < b.end && b.start < a.end).
 *
 * Different chromosomes always return `{intersect:false, overlap_bp:0}`.
 *
 * @param {{chrom:string, start_bp:number, end_bp:number}} a
 * @param {{chrom:string, start_bp:number, end_bp:number}} b
 * @returns {{intersect:boolean, overlap_bp:number,
 *            a_inside_b:boolean, b_inside_a:boolean,
 *            same_chrom:boolean}}
 */
export function classifyIntersection(a, b) {
  const empty = {
    intersect: false, overlap_bp: 0,
    a_inside_b: false, b_inside_a: false,
    same_chrom: false,
  };
  if (!a || !b) return empty;
  if (!a.chrom || !b.chrom || a.chrom !== b.chrom) return empty;
  if (!Number.isFinite(a.start_bp) || !Number.isFinite(a.end_bp)) return empty;
  if (!Number.isFinite(b.start_bp) || !Number.isFinite(b.end_bp)) return empty;
  const same_chrom = true;
  if (!(a.start_bp < b.end_bp && b.start_bp < a.end_bp)) {
    return { ...empty, same_chrom };
  }
  const lo = Math.max(a.start_bp, b.start_bp);
  const hi = Math.min(a.end_bp,   b.end_bp);
  const overlap_bp = Math.max(0, hi - lo);
  return {
    intersect:    true,
    overlap_bp,
    a_inside_b:   a.start_bp >= b.start_bp && a.end_bp <= b.end_bp,
    b_inside_a:   b.start_bp >= a.start_bp && b.end_bp <= a.end_bp,
    same_chrom:   true,
  };
}

// =====================================================================
// 2. Statistical: co-occurrence χ² across cohort
// =====================================================================

/**
 * Test whether two inversions' karyotype calls are associated across
 * a shared sample list.
 *
 * Karyotype encoding: 0=AA, 1=AB, 2=BB. Missing/uncalled = -1 or null.
 *
 * @param {Int8Array|Array<number>} karyo_a   per-sample karyotype for A
 * @param {Int8Array|Array<number>} karyo_b   per-sample karyotype for B
 * @param {Object} [opts]
 * @returns {{
 *   table:           number[][],   // 3×3 contingency (rows = A, cols = B)
 *   n_both_called:   number,
 *   chi2:            number,
 *   df:              number,
 *   p_value:         number,
 *   cramers_v:       number,
 *   strength:        string,       // one of CO_OCCURRENCE_STRENGTH
 * }}
 */
export function classifyCoOccurrence(karyo_a, karyo_b, opts) {
  const o = opts || {};
  const D = INVERSION_RELATIONSHIP_DEFAULTS;
  const minN = Number.isFinite(o.min_n_both_called) ? o.min_n_both_called : D.min_n_both_called;
  const vStrong = Number.isFinite(o.v_strong_above) ? o.v_strong_above : D.v_strong_above;
  const vWeak   = Number.isFinite(o.v_weak_above)   ? o.v_weak_above   : D.v_weak_above;
  const alpha   = Number.isFinite(o.alpha)          ? o.alpha          : D.alpha;

  const a = karyo_a, b = karyo_b;
  if (!a || !b || a.length === 0 || b.length === 0) {
    return _emptyCoResult();
  }
  const N = Math.min(a.length, b.length);
  // 3×3 contingency
  const table = [[0,0,0],[0,0,0],[0,0,0]];
  let n_both = 0;
  for (let i = 0; i < N; i++) {
    const va = a[i], vb = b[i];
    if (va == null || vb == null || va < 0 || vb < 0) continue;
    if (va > 2 || vb > 2) continue;
    table[va][vb]++;
    n_both++;
  }
  if (n_both < minN) {
    return {
      table, n_both_called: n_both,
      chi2: NaN, df: 4, p_value: NaN, cramers_v: NaN,
      strength: CO_OCCURRENCE_STRENGTH.INSUFFICIENT_DATA,
    };
  }
  const cs = chiSquare(table, 3);
  const p_value = chiSqSurvival(cs.chi2, cs.df);
  // cramersV expects a flat row-major Int32Array
  const flat = new Int32Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) flat[r * 3 + c] = table[r][c];
  }
  const v = cramersV(flat, 3, 3);
  let strength;
  if (!Number.isFinite(p_value) || p_value >= alpha) {
    strength = CO_OCCURRENCE_STRENGTH.INDEPENDENT;
  } else if (v >= vStrong) {
    strength = CO_OCCURRENCE_STRENGTH.STRONG;
  } else if (v >= vWeak) {
    strength = CO_OCCURRENCE_STRENGTH.WEAK;
  } else {
    strength = CO_OCCURRENCE_STRENGTH.INDEPENDENT;
  }
  return {
    table, n_both_called: n_both,
    chi2: cs.chi2, df: cs.df, p_value, cramers_v: v, strength,
  };
}

function _emptyCoResult() {
  return {
    table: [[0,0,0],[0,0,0],[0,0,0]],
    n_both_called: 0,
    chi2: NaN, df: 4, p_value: NaN, cramers_v: NaN,
    strength: CO_OCCURRENCE_STRENGTH.INSUFFICIENT_DATA,
  };
}

// =====================================================================
// 3. Pair-level orchestrator — emit the page's relationship row
// =====================================================================

/**
 * Classify the full relationship between two inversion candidates,
 * combining intersection and co-occurrence.
 *
 * @param {Object} candA              {chrom, start_bp, end_bp, karyo}
 * @param {Object} candB              {chrom, start_bp, end_bp, karyo}
 *   `karyo` is the per-sample Int8Array of karyotype calls (encoding
 *   per classifyCoOccurrence).
 * @param {Object} [opts]
 * @returns {{
 *   relationship:    string,             // one of INVERSION_RELATIONSHIP_TYPES
 *   intersection:    ReturnType<classifyIntersection>,
 *   co_occurrence:   ReturnType<classifyCoOccurrence>,
 *   same_chrom:      boolean,
 * }}
 */
export function classifyInversionRelationship(candA, candB, opts) {
  const intersection  = classifyIntersection(candA, candB);
  const co_occurrence = classifyCoOccurrence(
    candA && candA.karyo, candB && candB.karyo, opts,
  );
  const intersect = intersection.intersect;
  const coOccurs  = co_occurrence.strength === CO_OCCURRENCE_STRENGTH.STRONG
                 || co_occurrence.strength === CO_OCCURRENCE_STRENGTH.WEAK;
  let relationship;
  if (intersect && coOccurs)         relationship = INVERSION_RELATIONSHIP_TYPES.BOTH;
  else if (intersect)                relationship = INVERSION_RELATIONSHIP_TYPES.INTERSECTING;
  else if (coOccurs)                 relationship = INVERSION_RELATIONSHIP_TYPES.CO_OCCURRING;
  else                               relationship = INVERSION_RELATIONSHIP_TYPES.NONE;
  return {
    relationship,
    intersection,
    co_occurrence,
    same_chrom: intersection.same_chrom,
  };
}

// =====================================================================
// 4. Pairwise relationship matrix (N×N, upper triangle)
// =====================================================================

/**
 * Build the pairwise relationship table for a list of inversion
 * candidates. Returns only the upper triangle (i < j) — the matrix
 * is symmetric.
 *
 * @param {Array<Object>} inversions   list of {candidate_id, chrom,
 *                                              start_bp, end_bp, karyo}
 * @param {Object} [opts]
 * @returns {Array<{
 *   a_id:string, b_id:string,
 *   relationship:string,
 *   intersection:Object, co_occurrence:Object,
 *   same_chrom:boolean,
 * }>}
 */
export function buildRelationshipMatrix(inversions, opts) {
  if (!Array.isArray(inversions) || inversions.length < 2) return [];
  const out = [];
  for (let i = 0; i < inversions.length; i++) {
    for (let j = i + 1; j < inversions.length; j++) {
      const a = inversions[i], b = inversions[j];
      if (!a || !b) continue;
      const rel = classifyInversionRelationship(a, b, opts);
      out.push({
        a_id: a.candidate_id || null,
        b_id: b.candidate_id || null,
        relationship: rel.relationship,
        intersection: rel.intersection,
        co_occurrence: rel.co_occurrence,
        same_chrom:    rel.same_chrom,
      });
    }
  }
  return out;
}

/**
 * Filter a relationship matrix to the top-K strongest co-occurring
 * pairs by Cramér's V (descending). Useful for "show me the most
 * statistically associated pairs" view.
 *
 * @param {Array<Object>} matrix
 * @param {number} k    default 10
 * @returns {Array<Object>}
 */
export function topCoOccurringPairs(matrix, k) {
  if (!Array.isArray(matrix)) return [];
  const kk = Number.isFinite(k) && k > 0 ? k : 10;
  return matrix
    .filter(p => p && p.co_occurrence
              && Number.isFinite(p.co_occurrence.cramers_v))
    .slice()
    .sort((a, b) => b.co_occurrence.cramers_v - a.co_occurrence.cramers_v)
    .slice(0, kk);
}

/**
 * Filter a relationship matrix to all intersecting pairs (same
 * chromosome, overlapping bp intervals), sorted by overlap_bp
 * descending.
 */
export function intersectingPairs(matrix) {
  if (!Array.isArray(matrix)) return [];
  return matrix
    .filter(p => p && p.intersection && p.intersection.intersect)
    .slice()
    .sort((a, b) => b.intersection.overlap_bp - a.intersection.overlap_bp);
}
