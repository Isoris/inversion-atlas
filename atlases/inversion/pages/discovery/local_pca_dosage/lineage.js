// pages/discovery/local_pca_dosage/lineage.js
//
// State-managed lineage compute (legacy lines 39085-39360). Wraps the
// pure clustering primitives in shared/clustering.js with cache
// management on state.lineageResult + state.lineageCacheKey.
//
// Pipeline:
//   hungarianChainProjection(l2_indices, K, getLabelsForL2)
//     → concordanceMatrix(projection)
//     → clusterByConcordance(matrix, N, 1 - threshold)
//   → result cached on state, returned on every call until invalidated.
//
// The caller — local_pca_dosage/_state.js `_lineageColor` — currently schedules
// this via requestIdleCallback after first reference. Once local_pca_dosage's
// L2-label cache is warm, runLineageCompute(state) returns the cached
// result instantly.

import { hungarianChainProjection, concordanceMatrix } from '../../../shared/hungarian.js';
import { clusterByConcordance } from '../../../shared/clustering.js';
import { getL2Cluster } from '../../../shared/page1_data_helpers.js';

// =====================================================================
// Constants (legacy lines 39089-39091)
// =====================================================================

/** Distance cut: 1 - concordance threshold; pairs ≥ (1-this) merge. */
export const LINEAGE_DEFAULT_THRESHOLD = 0.50;

/** Chrom needs at least this many L2 envelopes before lineage compute fires. */
export const LINEAGE_MIN_L2_FOR_COMPUTE = 3;

// =====================================================================
// Cache key (legacy lines 39285-39289)
// =====================================================================

/**
 * Deterministic fingerprint of the inputs that influence the lineage
 * result. Mismatched key → recompute on next runLineageCompute call.
 */
export function lineageCacheKey(l2_indices, K, threshold, mode, chrom) {
  return [
    chrom || '_', mode || 'default', K, threshold,
    l2_indices.length,
    (l2_indices[0] || 0),
    (l2_indices[l2_indices.length - 1] || 0),
  ].join('::');
}

/**
 * 2026-05-21 perf (Tier-C finding #4): threshold-independent slice of
 * the lineage cache key. The projection + concordance matrix depend on
 * (chrom, mode, K, l2_indices) but NOT on threshold — threshold is a
 * pure post-processing knob in clusterByConcordance. Splitting the
 * cache lets the threshold slider rebuild only the cluster step,
 * skipping the expensive O(n_L2²) concordance recomputation.
 */
function _lineageProjectionKey(l2_indices, K, mode, chrom) {
  return [
    chrom || '_', mode || 'default', K,
    l2_indices.length,
    (l2_indices[0] || 0),
    (l2_indices[l2_indices.length - 1] || 0),
  ].join('::');
}

// =====================================================================
// Orchestrator (legacy lines 39298-39360)
// =====================================================================

/**
 * Compute (or fetch cached) per-sample lineage assignments. Mutates
 * state.lineageResult + state.lineageCacheKey. Returns null when there
 * aren't enough L2 envelopes, when the projection is empty, or when
 * state itself is missing.
 *
 * @param {object} state                     local_pca_dosage _pageState (mutated)
 * @param {Object} [opts]
 * @param {number[]} [opts.l2_indices]       Override (default: all envelopes)
 * @param {number} [opts.threshold=LINEAGE_DEFAULT_THRESHOLD]
 * @param {boolean} [opts.force]             Skip cache check
 * @param {(li:number)=>Int8Array|null} [opts.getLabelsForL2]
 *        Required-by-projection callback (default: read state.l2GroupCache)
 * @returns {object|null}
 */
export function runLineageCompute(state, opts) {
  if (!state || !state.data) return null;
  opts = opts || {};

  const allL2 = (state.data.l2_envelopes || []).map((_, i) => i);
  const l2_indices = Array.isArray(opts.l2_indices) ? opts.l2_indices : allL2;
  if (l2_indices.length < LINEAGE_MIN_L2_FOR_COMPUTE) {
    state.lineageResult = null;
    state.lineageCacheKey = null;
    return null;
  }
  const threshold = (typeof opts.threshold === 'number')
                    ? opts.threshold : LINEAGE_DEFAULT_THRESHOLD;
  const K = state.k || 3;
  const mode = state.activeMode || 'default';
  const chrom = (state.data && state.data.chrom) || '';
  const key = lineageCacheKey(l2_indices, K, threshold, mode, chrom);

  if (!opts.force && state.lineageCacheKey === key && state.lineageResult) {
    return state.lineageResult;
  }

  // 2026-05-21 perf (Tier-C finding #4): check the threshold-independent
  // projection cache first. If hit, we skip hungarianChainProjection +
  // concordanceMatrix entirely and just re-run clusterByConcordance
  // with the new threshold. Threshold-slider changes are now O(cluster)
  // instead of O(projection + concordance + cluster).
  const projKey = _lineageProjectionKey(l2_indices, K, mode, chrom);
  let projection, concordance;
  const projCache = state.lineageProjectionCache;
  if (!opts.force && projCache && projCache.key === projKey) {
    projection = projCache.projection;
    concordance = projCache.concordance;
  } else {
    // Default getLabelsForL2: route through getL2Cluster so the data-
    // identity cache (state.data._l2ClusterCache) is consulted, and
    // misses compute on demand. 2026-05-21: replaces a direct read of
    // state.l2GroupCache (now stale — the cache moved to state.data).
    const getLabelsForL2 = opts.getLabelsForL2 || ((li) => {
      const entry = getL2Cluster(state, li);
      return (entry && entry.labels) ? entry.labels : null;
    });

    try {
      projection = hungarianChainProjection(l2_indices, K, getLabelsForL2);
    } catch (_) {
      state.lineageResult = null;
      state.lineageCacheKey = null;
      return null;
    }
    if (!projection || projection.n_samples === 0 || projection.n_total_L2 === 0) {
      state.lineageResult = null;
      state.lineageCacheKey = null;
      state.lineageProjectionCache = null;
      return null;
    }
    concordance = concordanceMatrix(projection);
    state.lineageProjectionCache = { key: projKey, projection, concordance };
  }

  const cluster = clusterByConcordance(concordance, projection.n_samples, threshold);

  // Per-lineage fish counts for downstream UI.
  const fishCountPerLineage = new Int32Array(cluster.n_lineages);
  for (let s = 0; s < projection.n_samples; s++) {
    const li = cluster.lineage_id_per_sample[s];
    if (li >= 0 && li < cluster.n_lineages) fishCountPerLineage[li]++;
  }

  const result = {
    n_samples: projection.n_samples,
    n_L2: projection.n_total_L2,
    n_chains: projection.n_chains,
    threshold,
    K,
    mode,
    chrom,
    // Strip the projected Int8Array from cached chains to keep memory sane.
    chains: projection.chains.map(ch => ({
      l2_indices: ch.l2_indices.slice(),
      n_L2: ch.n_L2,
      start_idx: ch.start_idx,
    })),
    concordance_matrix: concordance,
    dendrogram: cluster.dendrogram,
    lineage_id_per_sample: cluster.lineage_id_per_sample,
    n_lineages: cluster.n_lineages,
    fish_count_per_lineage: fishCountPerLineage,
  };
  state.lineageResult = result;
  state.lineageCacheKey = key;
  return result;
}
