// shared/lineage_clustering.js
//
// Lineage clustering (legacy lines 39260-39296 _lineageClustering +
// _lineageCacheKey). Given a per-sample concordance matrix across L2
// envelopes, cuts samples into "lineages" via agglomerative average-
// linkage clustering at a fixed (1 - concordance) distance threshold.
//
// The lineage strip drawn on page1 reads
// `state.lineageResult.lineage_id_per_sample[si]` to color each fish
// trajectory. This module produces that result without any state-globals.

import { agglomerativeAverageLinkage, cutDendrogram } from './clustering.js';

/** Default (1 - concordance) distance cut threshold. */
export const LINEAGE_DEFAULT_THRESHOLD = 0.50;

/** Hungarian-chain agreement minimum for chain-break detection. */
export const LINEAGE_CHAIN_BREAK_AGREEMENT = 0.50;

/** Need at least this many L2 envelopes to attempt lineage compute. */
export const LINEAGE_MIN_L2_FOR_COMPUTE = 3;

/** Smallest accepted lineage size (no merging below this). */
export const LINEAGE_MIN_FISH_PER_LINEAGE = 1;

/**
 * Cluster samples into lineages from a per-sample concordance matrix.
 * Distance = 1 - concordance; diagonal is 0. Returns:
 *
 *   {
 *     threshold,
 *     dendrogram,
 *     lineage_id_per_sample,    // Int8/Int32Array, group id per sample
 *     n_lineages,                // number of distinct groups
 *   }
 *
 * @param {ArrayLike<number>} concordanceMatrix  flat row-major N×N
 * @param {number} n_samples
 * @param {number?} threshold  defaults to LINEAGE_DEFAULT_THRESHOLD
 * @returns {Object}
 */
export function lineageClustering(concordanceMatrix, n_samples, threshold) {
  const thr = (typeof threshold === 'number') ? threshold : LINEAGE_DEFAULT_THRESHOLD;
  const distMatrix = new Float32Array(n_samples * n_samples);
  for (let i = 0; i < n_samples; i++) {
    for (let j = 0; j < n_samples; j++) {
      distMatrix[i * n_samples + j] = (i === j)
        ? 0
        : (1 - concordanceMatrix[i * n_samples + j]);
    }
  }
  const dendrogram = agglomerativeAverageLinkage(distMatrix, n_samples);
  const cut = cutDendrogram(dendrogram, n_samples, thr);
  return {
    threshold: thr,
    dendrogram,
    lineage_id_per_sample: cut.group_id_per_band,
    n_lineages: cut.n_groups,
  };
}

/**
 * Cache key for lineage compute. Captures the inputs that, when
 * changed, must invalidate the cached result:
 *   - chrom (cross-chrom switches)
 *   - mode ('default' | 'detailed')
 *   - K (K=3 ↔ K=6 switches)
 *   - threshold
 *   - L2 set (length + endpoints — full content hash would be heavy)
 *
 * Returns a "::"-joined fingerprint string.
 *
 * @param {ArrayLike<number>} l2_indices
 * @param {number} K
 * @param {number} threshold
 * @param {string?} mode
 * @param {string?} chrom
 * @returns {string}
 */
export function lineageCacheKey(l2_indices, K, threshold, mode, chrom) {
  const arr = Array.isArray(l2_indices) || ArrayBuffer.isView(l2_indices)
    ? l2_indices : [];
  const n = arr.length;
  const first = n > 0 ? (arr[0] || 0) : 0;
  const last  = n > 0 ? (arr[n - 1] || 0) : 0;
  return [
    chrom || '_',
    mode || 'default',
    K,
    threshold,
    n,
    first,
    last,
  ].join('::');
}
