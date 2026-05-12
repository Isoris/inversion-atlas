// shared/dosage_marker_select.js
//
// Dosage-marker selection + sample ordering for the dosage-heatmap
// panel (legacy lines 15766-15865: selectTopMarkers +
// orderSamplesByGroupAndPC1).
//
// Two pure helpers:
//   - selectTopMarkers(chunk, region, capN, opts):
//       Pick the top-N highest-information markers from a dosage
//       chunk within a bp window. Ranks by `diagnostic_score` when
//       every marker has one; falls back to per-marker variance
//       otherwise. Drops markers with missingness > threshold first.
//
//   - orderSamplesByGroupAndPC1(nSamples, groupOf, pc1Of, groupOrder):
//       Stable ordering by (coarse_group_refined, PC1) so the
//       heatmap groups samples by karyotype state and then sorts
//       within group by PC1.
//
// Pure: no DOM, no state. Caller passes the chunk + callbacks
// explicitly. Headless-tolerant.

/** Defaults mirror legacy DOSAGE_HEATMAP_DEFAULTS (lines 15613-15619). */
export const DOSAGE_HEATMAP_DEFAULTS = Object.freeze({
  MISSING_THRESHOLD: 0.20,    // drop markers with > 20% missing
  DEFAULT_CAP:       200,
  HARD_CAP:          500,
  WINDOW_RADIUS:     5,       // ±5 windows in cursor-bound mode
  MAX_CHUNK_CACHE:   50,      // LRU cap for dosage chunks
  DEBOUNCE_MS:       150,
});

/**
 * Pick the top-N highest-information markers from a dosage chunk
 * within `region = {start_bp, end_bp}`.
 *
 * Pipeline:
 *   1. Subset to markers inside [start_bp, end_bp].
 *   2. Drop missingness > `opts.missing_threshold`
 *      (default DOSAGE_HEATMAP_DEFAULTS.MISSING_THRESHOLD).
 *   3. Rank by `diagnostic_score` when EVERY surviving marker has
 *      a finite score; otherwise rank by per-marker variance
 *      computed from `chunk.dosage[mi]`.
 *   4. Sort by score descending, take top N (capped to HARD_CAP).
 *   5. Restore positional order so the heatmap reads left → right
 *      by bp.
 *
 * Returns:
 *   { selected_indices, total_in_region, dropped_missingness,
 *     used_diagnostic_score }
 *
 * @param {Object} chunk    {samples, markers:[{marker_id, pos_bp,
 *                            missingness, diagnostic_score?}],
 *                            dosage:[][]}
 * @param {{start_bp:number, end_bp:number}} region
 * @param {number} capN
 * @param {{missing_threshold?:number}} opts
 * @returns {Object}
 */
export function selectTopMarkers(chunk, region, capN, opts) {
  const o = opts || {};
  const missingThreshold = (o.missing_threshold != null)
    ? o.missing_threshold : DOSAGE_HEATMAP_DEFAULTS.MISSING_THRESHOLD;
  const N = Math.max(1, Math.min(DOSAGE_HEATMAP_DEFAULTS.HARD_CAP, capN | 0));
  if (!chunk || !Array.isArray(chunk.markers) || !Array.isArray(chunk.dosage)
      || !region) {
    return {
      selected_indices: [], total_in_region: 0,
      dropped_missingness: 0, used_diagnostic_score: false,
    };
  }
  // Step 1: collect markers in region
  const inRegion = [];
  for (let mi = 0; mi < chunk.markers.length; mi++) {
    const m = chunk.markers[mi];
    if (!m || m.pos_bp == null) continue;
    if (m.pos_bp < region.start_bp || m.pos_bp > region.end_bp) continue;
    inRegion.push(mi);
  }
  // Step 2: drop missingness
  const passing = [];
  let droppedMissing = 0;
  for (const mi of inRegion) {
    const miss = chunk.markers[mi].missingness;
    if (miss != null && Number.isFinite(miss) && miss > missingThreshold) {
      droppedMissing++;
    } else {
      passing.push(mi);
    }
  }
  if (passing.length === 0) {
    return {
      selected_indices: [], total_in_region: inRegion.length,
      dropped_missingness: droppedMissing, used_diagnostic_score: false,
    };
  }
  // Step 3: diagnostic_score (all-or-nothing column)
  const allHaveDiagScore = passing.every(mi => {
    const ds = chunk.markers[mi].diagnostic_score;
    return ds != null && Number.isFinite(ds);
  });
  let rankScore;
  if (allHaveDiagScore) {
    rankScore = passing.map(mi => chunk.markers[mi].diagnostic_score);
  } else {
    // Step 4: variance fallback. NA encoded as -1 in the legacy.
    rankScore = passing.map(mi => {
      const row = chunk.dosage[mi];
      if (!Array.isArray(row) && !ArrayBuffer.isView(row)) return 0;
      let n = 0, sum = 0, sumSq = 0;
      for (let i = 0; i < row.length; i++) {
        const v = row[i];
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        n++; sum += v; sumSq += v * v;
      }
      if (n < 2) return 0;
      const mean = sum / n;
      return sumSq / n - mean * mean;
    });
  }
  // Step 5: sort by score desc, take top N
  const indexed = passing.map((mi, j) => ({ mi, score: rankScore[j] }));
  indexed.sort((a, b) => b.score - a.score);
  const taken = indexed.slice(0, N).map(x => x.mi);
  // Restore positional order so the heatmap reads left → right by bp.
  taken.sort((a, b) => chunk.markers[a].pos_bp - chunk.markers[b].pos_bp);
  return {
    selected_indices: taken,
    total_in_region: inRegion.length,
    dropped_missingness: droppedMissing,
    used_diagnostic_score: allHaveDiagScore,
  };
}

/**
 * Order sample indices by (coarse_group_refined, PC1).
 *
 * `groupOf(idx)` returns the per-sample group label; `pc1Of(idx)`
 * returns a numeric PC1 (lower = first within group). Samples whose
 * group is not in `groupOrder` go to the end. Non-finite PC1 values
 * sort as 0 (preserves stable behaviour under the rest of the
 * comparator).
 *
 * @param {number} nSamples
 * @param {(i:number)=>any} groupOf
 * @param {(i:number)=>number} pc1Of
 * @param {Array<any>} groupOrder
 * @returns {Array<number>}
 */
export function orderSamplesByGroupAndPC1(nSamples, groupOf, pc1Of, groupOrder) {
  if (!(nSamples > 0)) return [];
  const ord = [];
  for (let i = 0; i < nSamples; i++) ord.push(i);
  const rank = new Map();
  (groupOrder || []).forEach((g, idx) => rank.set(g, idx));
  ord.sort((a, b) => {
    const ga = groupOf(a), gb = groupOf(b);
    const ra = rank.has(ga) ? rank.get(ga) : 999;
    const rb = rank.has(gb) ? rank.get(gb) : 999;
    if (ra !== rb) return ra - rb;
    const pa = pc1Of(a), pb = pc1Of(b);
    const va = (pa == null || !Number.isFinite(pa)) ? 0 : pa;
    const vb = (pb == null || !Number.isFinite(pb)) ? 0 : pb;
    return va - vb;
  });
  return ord;
}
