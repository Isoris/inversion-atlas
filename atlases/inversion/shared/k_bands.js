// shared/k_bands.js
//
// K-band consensus pipeline. Given a list of L2 envelope indices that
// jointly define a candidate inversion's footprint, run K-means at
// chosen K across each L2 and emit a per-(sample, L2) "vote" matrix
// of PC1-rank-aligned band labels. The anchor L2 (middle by default)
// supplies the canonical band order; every other L2 is Hungarian-
// aligned to it.
//
// Two functions:
//
//   computeKBands({ getCluster, l2_indices, n_samples, K, ref_l2? })
//     - Pure modulo the injected getCluster(l2idx, K) callback that
//       returns { labels: Int8Array, centers: number[K] } (or null on
//       failure). Page1 wires getCluster to
//       clusterL2AtK(contextFromState(state), l2idx, K) so this module
//       never touches state directly.
//     - Returns { ok, K, anchor, n_intervals, n_samples, anchorRanks,
//                 votes (Array<Int8Array(n_intervals)>),
//                 per_l2_concord: [{l2_idx, concord_to_ref}],
//                 roles: Map<l2_idx,'core'|'support'> }
//       or { ok:false, reason } on degenerate input.
//
//   computeK6ParentMap(k3Pass, k6Pass, purity_threshold = 0.80)
//     - PURE: takes two pass results from computeKBands at K=3 and K=6.
//     - Returns parent-of-k6 map + per-K6-group purity + verdict
//       (NESTED | CROSS_CUTTING | MIXED | NO_DATA) + a subband_label()
//       helper that emits 'g0a' / 'g0b' / ... for visualization.
//
// Legacy origin:
//   - _computeKBands       line 30399
//   - _computeK6ParentMap  line 30484

import { alignLabels } from './hungarian.js';

// =====================================================================
// computeKBands
// =====================================================================

/**
 * Run K-means K-band consensus across a list of L2 envelopes.
 *
 * @param {Object} args
 * @param {(l2idx:number, K:number) => {labels:Int8Array, centers:number[]}|null} args.getCluster
 *        Page-side cluster getter. Returns the K-means result for one
 *        L2 envelope (labels per sample + centroid PC1 per cluster)
 *        or null when clustering fails.
 * @param {number[]} args.l2_indices    L2 envelope indices to test
 * @param {number} args.n_samples       total cohort sample count
 * @param {number} args.K               desired K (≥ 2)
 * @param {number} [args.ref_l2]        explicit anchor L2 index;
 *        defaults to the middle of l2_indices
 * @returns {Object}
 */
export function computeKBands(args) {
  if (!args || typeof args.getCluster !== 'function') {
    return { ok: false, reason: 'NO_CLUSTER_FN' };
  }
  const { getCluster, l2_indices, n_samples, K } = args;
  let ref_l2 = args.ref_l2;
  if (!Array.isArray(l2_indices) || l2_indices.length === 0) {
    return { ok: false, reason: 'NO_INTERVALS' };
  }
  if (!Number.isInteger(n_samples) || n_samples < 1) {
    return { ok: false, reason: 'NO_DATA' };
  }
  if (K == null || K < 2) return { ok: false, reason: 'BAD_K' };

  let anchor = ref_l2;
  if (anchor == null || !l2_indices.includes(anchor)) {
    anchor = l2_indices[Math.floor(l2_indices.length / 2)];
  }
  const anchorCl = getCluster(anchor, K);
  if (!anchorCl || !anchorCl.labels || !anchorCl.centers) {
    return { ok: false, reason: 'ANCHOR_CLUSTER_FAILED' };
  }

  // PC1-rank the anchor's labels: g0..g(K-1) map to ascending PC1 centroids
  const anchorRanks = (() => {
    const order = [];
    for (let k = 0; k < K; k++) order.push({ k, c: anchorCl.centers[k] });
    order.sort((a, b) => a.c - b.c);
    const rankOf = new Int8Array(K);
    for (let r = 0; r < order.length; r++) rankOf[order[r].k] = r;
    const out = new Int8Array(n_samples);
    for (let si = 0; si < n_samples; si++) out[si] = rankOf[anchorCl.labels[si]];
    return out;
  })();

  const n_intervals = l2_indices.length;
  const votes = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) votes[si] = new Int8Array(n_intervals);
  const per_l2_concord = [];
  const roles = new Map();

  for (let p = 0; p < n_intervals; p++) {
    const idx = l2_indices[p];
    const isCore = (idx === anchor);
    roles.set(idx, isCore ? 'core' : 'support');
    if (isCore) {
      for (let si = 0; si < n_samples; si++) votes[si][p] = anchorRanks[si];
      per_l2_concord.push({ l2_idx: idx, concord_to_ref: 1.0 });
      continue;
    }
    const cl = getCluster(idx, K);
    if (!cl || !cl.labels || !cl.centers) {
      for (let si = 0; si < n_samples; si++) votes[si][p] = -1;
      per_l2_concord.push({ l2_idx: idx, concord_to_ref: NaN });
      continue;
    }
    // PC1-rank this L2's labels
    const order = [];
    for (let k = 0; k < K; k++) order.push({ k, c: cl.centers[k] });
    order.sort((a, b) => a.c - b.c);
    const rankOf = new Int8Array(K);
    for (let r = 0; r < order.length; r++) rankOf[order[r].k] = r;
    const ranked = new Int8Array(n_samples);
    for (let si = 0; si < n_samples; si++) ranked[si] = rankOf[cl.labels[si]];
    // Hungarian-align ranked labels to the anchor's ranks
    const align = alignLabels(anchorRanks, ranked, K);
    if (!align || !align.aligned) {
      for (let si = 0; si < n_samples; si++) votes[si][p] = -1;
      per_l2_concord.push({ l2_idx: idx, concord_to_ref: NaN });
      continue;
    }
    for (let si = 0; si < n_samples; si++) votes[si][p] = align.aligned[si];
    per_l2_concord.push({ l2_idx: idx, concord_to_ref: align.concord });
  }

  return {
    ok: true,
    K, anchor, n_intervals, n_samples,
    anchorRanks, votes, per_l2_concord, roles,
  };
}

// =====================================================================
// computeK6ParentMap
// =====================================================================

/** Default purity threshold for "this K6 group is nested under a K3 parent". */
export const K6_PURITY_THRESHOLD_DEFAULT = 0.80;

/** Possible verdict tags returned by computeK6ParentMap. */
export const K6_PARENT_VERDICTS = Object.freeze([
  'NESTED', 'CROSS_CUTTING', 'MIXED', 'NO_DATA',
]);

/**
 * Given two pass results from computeKBands at K=3 and K=6, build the
 * K6→K3 parent map by max-overlap voting. For each K6 group, count
 * how many (sample × L2-interval) cells fall into each K3 group.
 * The K3 group with the largest overlap is the parent; purity =
 * max_overlap / total_K6_samples ∈ [0, 1].
 *
 * Returns:
 *   {
 *     K3, K6,
 *     parent_of_k6:  Int8Array(K6)         which K3 parent
 *     purity:        Float64Array(K6)      max_overlap / group_size
 *     overlap_table: Int32Array(K6 × K3)   row-major
 *     n_pure, n_with_data,
 *     verdict:       'NESTED' (all pure) | 'CROSS_CUTTING' (none pure)
 *                  | 'MIXED' (some pure) | 'NO_DATA',
 *     purity_threshold,
 *     subband_letter: string[K6]           'a' | 'b' | ... per parent's rank
 *     subband_label(k6) → 'g0a' | 'g0b' | ... | null
 *   }
 *
 * Pure function; reads only the pass objects' fields.
 *
 * @param {{K:number, n_samples:number, n_intervals:number, votes:Int8Array[]}} k3Pass
 * @param {{K:number, n_samples:number, n_intervals:number, votes:Int8Array[]}} k6Pass
 * @param {number} [purity_threshold]
 */
export function computeK6ParentMap(k3Pass, k6Pass, purity_threshold) {
  if (!k3Pass || !k6Pass || !k3Pass.votes || !k6Pass.votes) {
    return {
      K3: k3Pass ? k3Pass.K : 0,
      K6: k6Pass ? k6Pass.K : 0,
      parent_of_k6: new Int8Array(0),
      purity:       new Float64Array(0),
      overlap_table: new Int32Array(0),
      n_pure: 0, n_with_data: 0,
      verdict: 'NO_DATA',
      purity_threshold: purity_threshold == null ? K6_PURITY_THRESHOLD_DEFAULT : +purity_threshold,
      subband_letter: [],
      subband_label: () => null,
    };
  }
  const K3 = k3Pass.K, K6 = k6Pass.K;
  const n_samples = k3Pass.n_samples;
  const n_intervals = k3Pass.n_intervals;
  const thr = (purity_threshold == null) ? K6_PURITY_THRESHOLD_DEFAULT : +purity_threshold;

  // Build overlap table: rows = K6 groups, cols = K3 groups
  const overlap = new Int32Array(K6 * K3);
  for (let si = 0; si < n_samples; si++) {
    const v3 = k3Pass.votes[si];
    const v6 = k6Pass.votes[si];
    for (let p = 0; p < n_intervals; p++) {
      const lk3 = v3[p], lk6 = v6[p];
      if (lk3 < 0 || lk3 >= K3 || lk6 < 0 || lk6 >= K6) continue;
      overlap[lk6 * K3 + lk3]++;
    }
  }

  const parent_of_k6 = new Int8Array(K6);
  const purity = new Float64Array(K6);
  let n_pure = 0, n_with_data = 0;
  for (let r = 0; r < K6; r++) {
    let total = 0, maxc = 0, parent = -1;
    for (let c = 0; c < K3; c++) {
      const v = overlap[r * K3 + c];
      total += v;
      if (v > maxc) { maxc = v; parent = c; }
    }
    parent_of_k6[r] = parent;
    purity[r] = total > 0 ? maxc / total : 0;
    if (total > 0) {
      n_with_data++;
      if (purity[r] >= thr) n_pure++;
    }
  }

  let verdict;
  if (n_with_data === 0)         verdict = 'NO_DATA';
  else if (n_pure === n_with_data) verdict = 'NESTED';
  else if (n_pure === 0)         verdict = 'CROSS_CUTTING';
  else                           verdict = 'MIXED';

  // Per-parent ordinal letters. Within each K3 parent, K6 groups are
  // ranked by K6 label index (which is PC1-rank thanks to computeKBands).
  const childrenOfParent = Array.from({ length: K3 }, () => []);
  for (let r = 0; r < K6; r++) {
    if (parent_of_k6[r] >= 0) childrenOfParent[parent_of_k6[r]].push(r);
  }
  const subband_letter = new Array(K6).fill('?');
  for (let c = 0; c < K3; c++) {
    const kids = childrenOfParent[c];
    for (let i = 0; i < kids.length; i++) {
      subband_letter[kids[i]] = String.fromCharCode(97 + i);  // 'a', 'b', ...
    }
  }
  function subband_label(k6) {
    if (k6 < 0 || k6 >= K6) return null;
    const parent = parent_of_k6[k6];
    if (parent < 0) return null;
    return `g${parent}${subband_letter[k6]}`;
  }

  return {
    K3, K6,
    parent_of_k6,
    purity,
    overlap_table: overlap,
    n_pure, n_with_data,
    verdict,
    purity_threshold: thr,
    subband_letter,
    subband_label,
  };
}
