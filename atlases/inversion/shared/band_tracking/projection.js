// shared/band_tracking/projection.js
// =====================================================================
// LAYER 2 PROJECTION — production version.
//
// Given:
//   - a FOCAL sample-set (a stable voter band) — a Set or Array of
//     sample indices that share an arrangement at one source window
//   - a TARGET window's K bands (each defined by a sample-set)
//
// Compute the per-target-band "purity" of the focal set's projection,
// classify into a pattern_class, and produce visited / excluded band
// lists for downstream voting.
//
// Purity rule (per Method doc Stage C2):
//   purity[t] = |S_focal ∩ S_target_t| / |S_focal|
//   purity[t] ≥ subset_purity (default 0.80)  → t VISITED
//   purity[t] ≤ ambiguous_threshold (default 0.5)  → t EXCLUDED  (when
//                                                                 the
//                                                                 voter
//                                                                 says
//                                                                 "not
//                                                                 like
//                                                                 me")
//   else                                             → ambiguous (no
//                                                                 contribution)
//
// CRITICAL DESIGN POINT (from chat transcript first message):
//
//   A 1-source-band → 4-target-band split is NOT automatically a FAN.
//   It depends on whether the daughter groups are STABLE across
//   neighbouring target windows.
//
//     - Daughter groups STABLE → COHERENT_SPLIT  (real sub-structure
//                                                 — nested inversion,
//                                                 hidden axis, founder
//                                                 packages, etc.)
//     - Daughter groups UNSTABLE → RANDOM_FAN    (low-resolution noise)
//
//   The full pattern_class taxonomy is therefore EXTENDED:
//     SINGLE / SUBSET / SUBSET_SPLIT / SPLIT_TWO  (existing — clean
//                                                  voted partitions)
//     COHERENT_SPLIT                              (NEW — daughter
//                                                  groups stable across
//                                                  neighbouring target
//                                                  windows)
//     RANDOM_FAN / SCATTER / EMPTY                (existing —
//                                                  uninformative)
//
//   classifyProjection() handles the static case (one target window).
//   classifyProjectionWithStability() handles the daughter-stability
//   case (focal × target window + neighbouring windows).
//
// Vote weights are set in vote_evidence.js. SUBSET / SINGLE = 1.0,
// COHERENT_SPLIT = 0.7 (informative but contains sub-structure that
// downstream consumers should be aware of), RANDOM_FAN = 0.0.
// =====================================================================

import { alignLabels } from '../hungarian.js';

// ---------------------------------------------------------------------
// PATTERN_CLASS taxonomy (extended)
// ---------------------------------------------------------------------

export const PATTERN_CLASS = Object.freeze({
  SINGLE:         'SINGLE',           // focal hits one target band cleanly
  SUBSET:         'SUBSET',           // focal hits 2+ target bands cleanly
  SUBSET_SPLIT:   'SUBSET_SPLIT',     // focal mostly-clean but one band split
  SPLIT_TWO:      'SPLIT_TWO',        // focal hits exactly 2 target bands
  COHERENT_SPLIT: 'COHERENT_SPLIT',   // NEW: focal splits into 3+ daughters
                                      //      that ARE stable across
                                      //      neighbouring target windows
  RANDOM_FAN:     'RANDOM_FAN',       // focal splits but daughters NOT
                                      //      stable across neighbours
                                      //      (alias kept: 'FAN' below)
  FAN:            'RANDOM_FAN',       // ALIAS — back-compat with code that
                                      //      writes 'FAN'. Same string.
  SCATTER:        'SCATTER',          // mass diffuse, no daughter coherence
  EMPTY:          'EMPTY',            // no overlap — voter has no opinion
});

// Internal alias resolution — when callers pass 'FAN' we want the
// stored string to be 'RANDOM_FAN' (so consumers see one canonical name).
function canon(cls) {
  if (cls === 'FAN') return PATTERN_CLASS.RANDOM_FAN;
  return cls;
}

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const PROJECTION_DEFAULTS = Object.freeze({
  // Visited threshold — fraction of focal samples that must concentrate
  // on a target band for the band to be marked VISITED. Used for the
  // SINGLE case (1 band gets ≥ subset_purity).
  subset_purity:           0.80,
  // Excluded threshold — focal hits target band with fraction at or
  // below this → mark target band as EXCLUDED (voter says "not me").
  ambiguous_threshold:     0.10,
  // Min focal samples needed for the projection to be meaningful.
  min_n_focal:             5,
  // Min |S_focal ∩ S_target_t| absolute count for a target band to even
  // be considered for VISITED. Avoids spurious "purity" from tiny
  // intersections.
  min_visited_count:       3,
  // SPLIT visited rule — a band is part of the visited set if its
  // purity is ≥ split_min_purity AND the cumulative purity of the
  // top-K visited bands is ≥ split_total_purity. This catches the
  // case "G0 (size 60) splits 30/30 onto two target bands" where
  // single_band purity (0.50) is below subset_purity (0.80) but the
  // combined purity (1.0) is.
  split_min_purity:        0.20,
  split_total_purity:      0.80,
  // SPLIT_TWO: visited bands == 2.
  // n_visited == 1 → SINGLE; 2 → SPLIT_TWO; 3+ → SUBSET_SPLIT (then
  // daughter-stability check upgrades to COHERENT_SPLIT).
  // SCATTER: largest single band purity below this AND no split rule
  // matches.
  scatter_max_frac:        0.20,

  // Daughter-stability parameters (used by
  // classifyProjectionWithStability):
  // Median Jaccard between Hungarian-aligned daughter groups across
  // neighbouring target windows must reach this for COHERENT_SPLIT.
  daughter_stability_threshold: 0.70,
  // Number of neighbouring target windows to examine on each side.
  // Total examined = 2 * neighbour_radius + 1 (incl. centre window).
  neighbour_radius:        3,
  // Minimum fraction of neighbour pairs that must yield a valid
  // daughter alignment for the median to be trusted. Below this,
  // not enough evidence — fall back to RANDOM_FAN.
  min_neighbour_pairs_frac: 0.5,
});

// ---------------------------------------------------------------------
// classifyProjection
//
// Static (one target window) classification. Call this when daughter-
// stability evidence isn't available (e.g. the voter is at a chromosome
// edge, or the user wants a quick first pass). For the full
// COHERENT_SPLIT vs RANDOM_FAN distinction, use
// classifyProjectionWithStability.
// ---------------------------------------------------------------------

/**
 * @param {Set<number>|number[]} focal_samples
 *   The voter band's sample set. Usually a stable identity from one
 *   source window's K-means.
 * @param {Int8Array|number[]} target_labels
 *   Per-sample K-means labels at the target window. Length = n_samples.
 * @param {number} K_target
 * @param {object} [opts]
 * @returns {{
 *   pattern_class:     string,
 *   visited_bands:     number[],
 *   excluded_bands:    number[],
 *   purity_vector:     Float64Array,    // length K_target
 *   counts:            Int32Array,      // |S_focal ∩ S_target_t|
 *   n_focal:           number,
 *   n_focal_in_target: number,          // total focal samples present at target
 *   n_visited:         number,
 *   max_purity:        number,
 * }}
 */
export function classifyProjection(focal_samples, target_labels, K_target, opts) {
  const o = Object.assign({}, PROJECTION_DEFAULTS, opts || {});
  const focal = focal_samples instanceof Set ? focal_samples : new Set(focal_samples);
  const n_focal = focal.size;
  const counts = new Int32Array(K_target);
  let n_present = 0;
  for (const si of focal) {
    const lbl = target_labels[si];
    if (lbl != null && lbl >= 0 && lbl < K_target) {
      counts[lbl]++;
      n_present++;
    }
  }
  const purity_vector = new Float64Array(K_target);
  if (n_focal < o.min_n_focal || n_present === 0) {
    return {
      pattern_class:     PATTERN_CLASS.EMPTY,
      visited_bands:     [],
      excluded_bands:    [],
      purity_vector, counts,
      n_focal, n_focal_in_target: n_present,
      n_visited:         0,
      max_purity:        0,
    };
  }
  // Purity is computed against n_focal (the WHOLE voter set), not
  // n_present, so silence-via-absence reduces purity. This matches the
  // method doc.
  let max_purity = 0;
  for (let t = 0; t < K_target; t++) {
    purity_vector[t] = counts[t] / n_focal;
    if (purity_vector[t] > max_purity) max_purity = purity_vector[t];
  }
  // ---------------------------------------------------------------
  // VISITED determination — two-tier rule:
  //
  //   Tier 1: SINGLE rule. If any one band has purity ≥ subset_purity
  //           (default 0.80), it's the only visited band. Other bands
  //           are excluded if their purity ≤ ambiguous_threshold,
  //           ambiguous otherwise.
  //
  //   Tier 2: SPLIT rule. If no single band hits subset_purity, look
  //           for a small set of bands whose CUMULATIVE purity is
  //           ≥ split_total_purity (default 0.80) AND each individual
  //           band has purity ≥ split_min_purity (default 0.20). Those
  //           bands form the visited set. Their union is "where the
  //           voter sends its samples."
  //
  // This is the CORRECT generalisation of the method doc spec to
  // multi-band splits. A 50/50 split (purity 0.5/0.5) would be
  // SPLIT_TWO under tier 2 (cumulative 1.0 ≥ 0.80, both ≥ 0.20). A
  // 33/33/33 split would be SUBSET_SPLIT under tier 2 (cumulative
  // 0.99 ≥ 0.80, all ≥ 0.20) and the daughter-stability classifier
  // can then promote it to COHERENT_SPLIT.
  // ---------------------------------------------------------------
  const visited = [];
  const excluded = [];
  if (max_purity >= o.subset_purity) {
    // Tier 1 — exactly one visited band.
    let top = -1;
    for (let t = 0; t < K_target; t++) {
      if (purity_vector[t] >= o.subset_purity && counts[t] >= o.min_visited_count) {
        if (top < 0 || purity_vector[t] > purity_vector[top]) top = t;
      }
    }
    if (top >= 0) visited.push(top);
    for (let t = 0; t < K_target; t++) {
      if (t === top) continue;
      if (purity_vector[t] <= o.ambiguous_threshold) excluded.push(t);
    }
  } else {
    // Tier 2 — try to find a split set.
    // Sort bands by purity desc, accumulate, stop when cumulative ≥
    // split_total_purity. Each included band must individually be
    // ≥ split_min_purity.
    const order = Array.from({ length: K_target }, (_, t) => t)
      .sort((a, b) => purity_vector[b] - purity_vector[a]);
    let cum = 0;
    for (const t of order) {
      if (purity_vector[t] < o.split_min_purity) break;
      if (counts[t] < o.min_visited_count) continue;
      visited.push(t);
      cum += purity_vector[t];
      if (cum >= o.split_total_purity) break;
    }
    // If cum didn't reach split_total_purity, the visited set isn't
    // a valid split — discard it.
    if (cum < o.split_total_purity) visited.length = 0;
    visited.sort((a, b) => a - b);
    for (let t = 0; t < K_target; t++) {
      if (visited.includes(t)) continue;
      if (purity_vector[t] <= o.ambiguous_threshold) excluded.push(t);
    }
  }
  // Static pattern_class decision tree.
  const n_visited = visited.length;
  let pattern_class;
  if (n_visited === 0) {
    if (max_purity < o.scatter_max_frac) {
      pattern_class = PATTERN_CLASS.SCATTER;
    } else {
      pattern_class = PATTERN_CLASS.RANDOM_FAN;
    }
  } else if (n_visited === 1) {
    pattern_class = PATTERN_CLASS.SINGLE;
  } else if (n_visited === 2) {
    pattern_class = PATTERN_CLASS.SPLIT_TWO;
  } else {
    // 3+ visited bands. STATIC classifier cannot know if the daughter
    // groups are stable — that's a temporal question. Without
    // neighbour evidence we conservatively call SUBSET_SPLIT (the voter
    // does have visited target bands cleanly; multiplicity ≥ 3 is
    // a structural finding that may be COHERENT_SPLIT once we add
    // stability evidence).
    pattern_class = PATTERN_CLASS.SUBSET_SPLIT;
  }
  return {
    pattern_class,
    visited_bands: visited,
    excluded_bands: excluded,
    purity_vector, counts,
    n_focal,
    n_focal_in_target: n_present,
    n_visited,
    max_purity,
  };
}

// ---------------------------------------------------------------------
// classifyProjectionWithStability
//
// Full classification — examines neighbouring target windows to decide
// COHERENT_SPLIT vs RANDOM_FAN when the static classifier returns
// SUBSET_SPLIT or RANDOM_FAN.
//
// Algorithm (per chat transcript):
//   1. Static-classify the focal projection at the target window.
//   2. If static class is SUBSET_SPLIT or RANDOM_FAN (i.e. the focal
//      splits into ≥ 2 daughters):
//      a. At each neighbouring target window w' in [w - R, w + R]:
//         - For each visited target band t at w, define the daughter
//           group D_t = focal samples that landed in band t at w.
//         - At w', look up where each D_t went — Hungarian-align the
//           K_w × K_w' contingency restricted to the focal subset.
//      b. Compute median Jaccard of matched daughters across all
//         neighbouring window pairs.
//      c. If median Jaccard ≥ daughter_stability_threshold AND the
//         number of valid pairs ≥ min_neighbour_pairs_frac × max
//         possible: upgrade to COHERENT_SPLIT.
//      d. Otherwise: RANDOM_FAN.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Set<number>|number[]} args.focal_samples
 * @param {number} args.target_w                 the target window index
 * @param {(w:number) => Int8Array} args.getTargetLabels
 * @param {(w:number) => number}    args.getTargetK
 * @param {(w:number) => boolean}   [args.isTargetWindowValid]
 *   Optional. Returns false for windows that should be skipped (out of
 *   chromosome, low band_quality, etc.). Defaults to "always valid".
 * @param {object} [opts]
 * @returns {{
 *   pattern_class:        string,
 *   visited_bands:        number[],
 *   excluded_bands:       number[],
 *   purity_vector:        Float64Array,
 *   counts:               Int32Array,
 *   n_focal:              number,
 *   n_focal_in_target:    number,
 *   daughter_stability:   number|null,    // median Jaccard, or null if not computed
 *   n_neighbour_pairs:    number,
 *   static_class:         string,         // what classifyProjection said
 *   stability_upgraded:   boolean,        // true if static FAN/SUBSET_SPLIT
 *                                         //   was promoted to COHERENT_SPLIT
 * }}
 */
export function classifyProjectionWithStability(args, opts) {
  const o = Object.assign({}, PROJECTION_DEFAULTS, opts || {});
  const { focal_samples, target_w, getTargetLabels, getTargetK } = args;
  const isValid = args.isTargetWindowValid || ((_) => true);
  const labels_w = getTargetLabels(target_w);
  const K_w     = getTargetK(target_w);
  const stat = classifyProjection(focal_samples, labels_w, K_w, o);
  // No stability check needed if static class is already definitive
  // OR if it's EMPTY/SINGLE/SUBSET/SPLIT_TWO/SCATTER (no daughter
  // groups to track).
  const needs_stability = (
    stat.pattern_class === PATTERN_CLASS.SUBSET_SPLIT ||
    stat.pattern_class === PATTERN_CLASS.RANDOM_FAN
  );
  if (!needs_stability || stat.n_visited < 2) {
    return {
      ...stat,
      daughter_stability: null,
      n_neighbour_pairs:  0,
      static_class:       stat.pattern_class,
      stability_upgraded: false,
    };
  }
  // Build daughter groups: for each visited target band t, the set of
  // focal samples that landed in that band.
  const focalSet = focal_samples instanceof Set
    ? focal_samples
    : new Set(focal_samples);
  const daughters = stat.visited_bands.map(t => {
    const D = new Set();
    for (const si of focalSet) {
      if (labels_w[si] === t) D.add(si);
    }
    return D;
  });
  // For each neighbour w', compute median Jaccard between the daughters
  // observed at w and the daughters that emerge at w'. The daughters at
  // w' are: groups defined by w'-bands restricted to the focal subset
  // and Hungarian-aligned to the w-daughters.
  const jaccards = [];
  let n_valid = 0, n_attempted = 0;
  for (let dw = -o.neighbour_radius; dw <= o.neighbour_radius; dw++) {
    if (dw === 0) continue;
    const w_n = target_w + dw;
    n_attempted++;
    if (!isValid(w_n)) continue;
    const labels_n = getTargetLabels(w_n);
    if (!labels_n) continue;
    const K_n = getTargetK(w_n);
    if (K_n < 2) continue;
    // Focal-restricted contingency: rows = w-band (visited subset),
    // cols = w'-band, entries = |samples in both|.
    const D_count = daughters.length;
    const K_align = Math.max(D_count, K_n);
    const w_arr = [], n_arr = [];
    for (const si of focalSet) {
      const lw = labels_w[si];
      const ln = labels_n[si];
      if (lw == null || ln == null) continue;
      // Map lw to its index within visited_bands (or -1 if not visited)
      const di = stat.visited_bands.indexOf(lw);
      if (di < 0) continue;     // skip focal samples that fell outside
                                //   the visited subset at w
      if (ln < 0 || ln >= K_n) continue;
      w_arr.push(di);
      n_arr.push(ln);
    }
    if (w_arr.length < o.min_n_focal) continue;
    const aligned = alignLabels(w_arr, n_arr, K_align);
    // Per-daughter Jaccard from the aligned table (rows = daughter id,
    // cols = aligned w'-band id; diagonal = matched pair).
    const T = aligned.table;
    for (let d = 0; d < D_count; d++) {
      let row_sum = 0, col_sum = 0;
      const inter = T[d][d];
      for (let c = 0; c < K_align; c++) row_sum += T[d][c];
      for (let r = 0; r < K_align; r++) col_sum += T[r][d];
      const denom = row_sum + col_sum - inter;
      if (denom > 0) jaccards.push(inter / denom);
    }
    n_valid++;
  }
  // Decide stability
  let daughter_stability = null;
  let stability_upgraded = false;
  let final_class = stat.pattern_class;
  if (jaccards.length > 0 &&
      n_valid >= Math.ceil(o.min_neighbour_pairs_frac * n_attempted)) {
    jaccards.sort((a, b) => a - b);
    const m = jaccards.length;
    daughter_stability = m % 2 === 0
      ? (jaccards[m / 2 - 1] + jaccards[m / 2]) / 2
      : jaccards[(m - 1) / 2];
    if (daughter_stability >= o.daughter_stability_threshold) {
      final_class = PATTERN_CLASS.COHERENT_SPLIT;
      stability_upgraded = true;
    } else {
      // The static classifier said SUBSET_SPLIT or RANDOM_FAN. With
      // unstable daughters, it's RANDOM_FAN regardless of which it
      // started as (the SUBSET_SPLIT label was conservative; once we
      // know daughters aren't stable, it really is fanning).
      final_class = PATTERN_CLASS.RANDOM_FAN;
    }
  }
  // If we had no valid neighbour pairs at all, leave the static class
  // (rare — only happens at chromosome edges with very few neighbours).
  return {
    ...stat,
    pattern_class:      final_class,
    daughter_stability,
    n_neighbour_pairs:  n_valid,
    static_class:       stat.pattern_class,
    stability_upgraded,
  };
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._classifyProjection                 = classifyProjection;
  window._classifyProjectionWithStability    = classifyProjectionWithStability;
  window._PATTERN_CLASS                      = PATTERN_CLASS;
  window._PROJECTION_DEFAULTS                = PROJECTION_DEFAULTS;
}
