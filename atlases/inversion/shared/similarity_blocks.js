// shared/similarity_blocks.js
//
// HANDOFF 10 Stage 4 — block detection on the per-window similarity
// matrix. Pure helpers; composes with shared/clustering.js
// (agglomerativeAverageLinkage) to find a best-K partition by
// silhouette + minimum-block-size.
//
// Pipeline:
//   1. similarityToDistance(simMatrix, N) → Float32Array distMatrix
//   2. agglomerativeAverageLinkage(distMatrix, N) (from shared/clustering.js)
//   3. cutDendrogramByK(dendrogram, N, K) → Int32Array assignment of length N
//   4. silhouetteScore(assignment, distMatrix, N) → mean silhouette ∈ [-1, 1]
//   5. detectSimilarityBlocks(simMatrix, N, opts) ties them all together.
//
// Average-linkage is preferred over Ward.D2 for correlation-based
// distances (Ward assumes squared-Euclidean) — same convention as the
// existing lineage/inheritance clusterings.

import {
  agglomerativeAverageLinkage,
} from './clustering.js';

/** Default silhouette threshold below which we fall back to K=1. */
export const DEFAULT_SILHOUETTE_THRESHOLD = 0.4;

/** Default minimum samples per block. */
export const DEFAULT_MIN_BLOCK_SIZE = 10;

/** Default upper bound on K to search. */
export const DEFAULT_MAX_K = 6;

/**
 * Convert a similarity matrix (Pearson, range [-1, 1]) into a
 * distance matrix (range [0, 2]) by `d = 1 - s`. The diagonal is
 * forced to 0 even if `sim[i,i] != 1` numerically.
 *
 * @param {Float32Array|Float64Array|Array<number>} simMatrix  flat N×N
 * @param {number} N
 * @returns {Float32Array}
 */
export function similarityToDistance(simMatrix, N) {
  const out = new Float32Array(N * N);
  if (!simMatrix || !(N > 0)) return out;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) { out[i * N + j] = 0; continue; }
      const s = simMatrix[i * N + j];
      const d = Number.isFinite(s) ? 1 - s : 2;   // missing → maximally distant
      out[i * N + j] = d < 0 ? 0 : (d > 2 ? 2 : d);
    }
  }
  return out;
}

/**
 * Cut a dendrogram to produce exactly K clusters (top-down). Works
 * by applying the first (N - K) merges from the dendrogram (which is
 * already in ascending-distance order from
 * `agglomerativeAverageLinkage`). Returns dense 0..K-1 cluster ids.
 *
 * Edge cases:
 *   - K ≥ N → identity assignment [0..N-1]
 *   - K ≤ 1 → all-zero assignment (single cluster)
 *   - dendrogram with fewer than (N-K) entries → as many merges as exist
 *
 * @param {Array<{members:Array<number>}>} dendrogram
 * @param {number} N
 * @param {number} K
 * @returns {Int32Array}  length N, dense 0..bestId-1
 */
export function cutDendrogramByK(dendrogram, N, K) {
  if (!(N > 0)) return new Int32Array(0);
  if (K >= N) {
    const out = new Int32Array(N);
    for (let i = 0; i < N; i++) out[i] = i;
    return out;
  }
  if (K <= 1) return new Int32Array(N);

  // Union-find over leaves.
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const nMerges = Math.min(N - K, dendrogram ? dendrogram.length : 0);
  for (let i = 0; i < nMerges; i++) {
    const m = dendrogram[i];
    const members = m && m.members;
    if (!members || members.length < 2) continue;
    const root = members[0];
    for (let k = 1; k < members.length; k++) union(root, members[k]);
  }

  // Compact group ids.
  const assignment = new Int32Array(N);
  const remap = new Map();
  let next_id = 0;
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (!remap.has(r)) remap.set(r, next_id++);
    assignment[i] = remap.get(r);
  }
  return assignment;
}

/**
 * Mean silhouette score for an N-sample partition. For each sample i:
 *
 *   a(i) = mean distance to other samples in i's cluster
 *   b(i) = min over other clusters C of (mean distance from i to C)
 *   s(i) = (b - a) / max(a, b)
 *
 * Returns the mean over all samples in [-1, 1]. Singleton clusters
 * contribute s(i) = 0 (legacy convention). If only one cluster
 * exists, returns 0 (silhouette undefined).
 *
 * @param {Int32Array|Array<number>} assignment   length N
 * @param {Float32Array|Array<number>} distMatrix flat N×N
 * @param {number} N
 * @returns {number}
 */
export function silhouetteScore(assignment, distMatrix, N) {
  if (!assignment || !distMatrix || !(N > 0)) return 0;
  // Group samples by cluster.
  const byCluster = new Map();
  for (let i = 0; i < N; i++) {
    const c = assignment[i];
    if (!byCluster.has(c)) byCluster.set(c, []);
    byCluster.get(c).push(i);
  }
  if (byCluster.size <= 1) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < N; i++) {
    const ci = assignment[i];
    const own = byCluster.get(ci) || [];
    if (own.length < 2) { count++; continue; }   // singleton → s = 0
    // a(i): mean distance to other own-cluster members
    let aSum = 0, aN = 0;
    for (const j of own) {
      if (j === i) continue;
      aSum += distMatrix[i * N + j];
      aN++;
    }
    const a = aN > 0 ? aSum / aN : 0;
    // b(i): min over other clusters of mean distance to that cluster
    let bMin = Infinity;
    for (const [cj, members] of byCluster) {
      if (cj === ci) continue;
      let bSum = 0;
      for (const j of members) bSum += distMatrix[i * N + j];
      const b = members.length > 0 ? bSum / members.length : Infinity;
      if (b < bMin) bMin = b;
    }
    const b = bMin;
    const denom = Math.max(a, b);
    const s = denom > 0 ? (b - a) / denom : 0;
    sum += s;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Detect best-K block structure on a similarity matrix. Searches
 * K = 2..maxK by silhouette, requires `min(blockSize) >= minBlockSize`
 * and `silhouette >= silhouetteThreshold`. When no candidate K
 * qualifies, returns K=1 (no block structure).
 *
 * Returns `{K, silhouette, assignment, leafOrder, blocks}` where
 * `leafOrder` is the dendrogram leaf order (suitable for matrix
 * row/col reordering) and `blocks` is the per-cluster sizes array.
 *
 * @param {Float32Array} simMatrix  flat N×N
 * @param {number} N
 * @param {{silhouetteThreshold?:number, minBlockSize?:number, maxK?:number}} opts
 * @returns {Object}
 */
export function detectSimilarityBlocks(simMatrix, N, opts) {
  const o = opts || {};
  const sigThr = Number.isFinite(o.silhouetteThreshold)
    ? o.silhouetteThreshold : DEFAULT_SILHOUETTE_THRESHOLD;
  const minBlock = Number.isFinite(o.minBlockSize)
    ? o.minBlockSize : DEFAULT_MIN_BLOCK_SIZE;
  const maxK = Number.isFinite(o.maxK) ? o.maxK : DEFAULT_MAX_K;

  if (!simMatrix || !(N >= 2)) {
    return {
      K: 1, silhouette: 0,
      assignment: new Int32Array(N || 0),
      leafOrder: [],
      blocks: [N || 0],
    };
  }

  const distMatrix = similarityToDistance(simMatrix, N);
  const dendrogram = agglomerativeAverageLinkage(distMatrix, N);
  // Leaf order: last (root) merge's members are a deepest-to-shallowest
  // traversal of leaves — same convention as the legacy lineage strip
  // drawer.
  let leafOrder = [];
  if (dendrogram.length > 0) {
    leafOrder = dendrogram[dendrogram.length - 1].members.slice();
  } else {
    for (let i = 0; i < N; i++) leafOrder.push(i);
  }

  let bestK = 1;
  let bestSil = 0;
  let bestAssignment = new Int32Array(N);
  let bestBlocks = [N];
  for (let K = 2; K <= maxK; K++) {
    const cl = cutDendrogramByK(dendrogram, N, K);
    const sizes = new Array(K).fill(0);
    for (let i = 0; i < N; i++) sizes[cl[i]]++;
    const minSize = Math.min(...sizes);
    if (minSize < minBlock) continue;
    const sil = silhouetteScore(cl, distMatrix, N);
    if (sil > bestSil && sil >= sigThr) {
      bestK = K;
      bestSil = sil;
      bestAssignment = cl;
      bestBlocks = sizes;
    }
  }
  return {
    K: bestK,
    silhouette: bestSil,
    assignment: bestAssignment,
    leafOrder,
    blocks: bestBlocks,
  };
}
