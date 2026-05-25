// pages/discovery/tree_panel/_auto_build.js
// =====================================================================
// Auto-build a sample-level NJ tree from the local-PCA dosage in
// scrubber_main, paired with K-means cluster labels from per-L2
// PC1 aggregation. Lets the tree panel paint a tree on mount without
// waiting for a candidate-mode workflow to stuff `tree_panel_state`.
//
// Strategy
// --------
// 1. Pick the L2 envelope that drives the tree:
//      - prefer the active candidate's first `l2_indices` entry
//      - else fall back to the L2 with the largest mean |z| across
//        its window range (the "most inversion-like" envelope)
// 2. Build a ClusterContext over a synthetic state and run
//    clusterL2(ctx, l2idx) to get a per-sample cluster label vector.
// 3. Build an n_samples × n_samples distance matrix by treating each
//    window in the L2 as a "marker": per-sample vector is the
//    sign-aligned PC1 across the L2's windows. Euclidean on that
//    matrix gives a stable sample-similarity surface even when one
//    or two windows are noisy.
// 4. Run mgl_nj_tree.buildNjTree(D) → tree shape the renderer expects.
//
// Output matches the tree_panel_state contract documented at the top
// of tree_panel.js.
// =====================================================================

import { buildNjTree, pairwiseEuclideanFromDosage } from '../../../shared/mgl_nj_tree.js';
import { contextFromState, clusterL2 } from '../../../shared/per_l2_cluster.js';

const DEFAULT_PALETTE = ['#3074C8', '#2BAA50', '#D04545', '#A060B8', '#D8A030', '#3DB5C0'];

/**
 * Build the tree-panel state object for the page renderer.
 *
 * @param {object} data        scrubber_main precomp for active chrom
 * @param {object|null} candidate  optional active candidate (drives L2 pick + label)
 * @returns {{
 *   tree: object,
 *   leaf_cluster_labels: number[],
 *   leaf_colors_by_cluster: string[],
 *   candidate_label: string,
 *   l2idx: number,
 * } | null}
 */
export function autoBuildTreeFromPCA(data, candidate) {
  if (!_dataReady(data)) return null;

  // Populate envelope `_s0` / `_e0` 0-based aliases that clusterL2 and
  // aggregateL2 read directly. local_pca_dosage's mount runs buildIndexes()
  // which does this; if the user lands on the tree page first the
  // envelopes still carry only the 1-based `start_w` / `end_w`.
  _ensureZeroBasedEnvelopes(data);

  const l2idx = _pickL2Index(data, candidate);
  if (l2idx < 0) return null;
  const env = data.l2_envelopes[l2idx];
  const s = env._s0 ?? (env.start_w - 1);
  const e = env._e0 ?? (env.end_w - 1);
  const nW = e - s + 1;
  if (nW < 2) return null;
  const nS = data.n_samples;
  if (!nS || nS < 4) return null;

  // 1. cluster labels per sample via the same code path local_pca_dosage uses.
  const ctx = contextFromState(_synthState(data));
  let labels;
  try {
    const cl = clusterL2(ctx, l2idx);
    labels = (cl && cl.labels) ? Array.from(cl.labels) : null;
  } catch (e) {
    console.warn('tree_panel auto-build: clusterL2 threw — labels will be all-zero', e);
    labels = null;
  }
  if (!labels) labels = new Array(nS).fill(0);

  // 2. distance matrix from per-L2 window PC1 vectors.
  //    Treat each window as a marker — row-major nW × nS.
  const dosage = new Float64Array(nW * nS);
  for (let wi = 0; wi < nW; wi++) {
    const w = data.windows[s + wi];
    if (!w || !w.pc1) continue;
    const sign = _signForWindow(data, s + wi);
    const off = wi * nS;
    for (let si = 0; si < nS; si++) {
      const v = w.pc1[si];
      dosage[off + si] = isFinite(v) ? v * sign : 0;
    }
  }
  const D = pairwiseEuclideanFromDosage(dosage, nW, nS);

  // 3. NJ tree. Leaf labels are integer indices so the renderer's
  //    per-leaf colour mapping (parseInt(lf.id, 10)) lines up with
  //    the cluster labels array.
  const tree = buildNjTree(D);
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) return null;

  // 4. Header label.
  let candidate_label;
  if (candidate && (candidate.id != null)) {
    candidate_label = `${candidate.id} · L2 #${l2idx} · auto-tree`;
  } else {
    const sMb = data.windows[s] && data.windows[s].center_mb;
    const eMb = data.windows[e] && data.windows[e].center_mb;
    const span = (isFinite(sMb) && isFinite(eMb))
      ? `${sMb.toFixed(2)}–${eMb.toFixed(2)} Mb`
      : `${nW} windows`;
    candidate_label = `L2 #${l2idx} · ${span} · auto-tree (top-|Z|)`;
  }

  return {
    tree,
    leaf_cluster_labels: labels,
    leaf_colors_by_cluster: DEFAULT_PALETTE.slice(),
    candidate_label,
    l2idx,
  };
}

// ---------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------

function _dataReady(d) {
  return !!(d
    && Array.isArray(d.windows) && d.windows.length > 0
    && Array.isArray(d.l2_envelopes) && d.l2_envelopes.length > 0
    && typeof d.n_samples === 'number');
}

function _synthState(data) {
  // Mirror haplotype_regimes' defaults. aggMethod='mean_pc1' avoids the
  // pc2 read inside aggregateL2 — scrubber_main does carry pc2 in most
  // cases but the 1-D fit is the same partition haplotype_regimes uses
  // for cluster labels, so K lands on a consistent value across pages.
  return {
    data,
    k: 3,
    aggMethod: 'mean_pc1',
    kMode: 'adaptive',
    kRange: [2, 6],
    silThreshold: 0.5,
    minNGroup: 5,
    minNWin: 5,
    silScoreOn: 'pc1',
    flipPC1: false,
    pc1Sign: null,
  };
}

function _ensureZeroBasedEnvelopes(data) {
  const envs = data.l2_envelopes;
  if (!Array.isArray(envs)) return;
  for (const env of envs) {
    if (env == null) continue;
    if (env._s0 == null) env._s0 = (env.start_w | 0) - 1;
    if (env._e0 == null) env._e0 = (env.end_w   | 0) - 1;
  }
}

function _signForWindow(data, wIdx) {
  // pc1Sign isn't on scrubber_main itself; default sign is +1 unless a
  // caller has stashed flipPC1 + pc1Sign on the page state, which the
  // tree page does not.
  return 1;
}

function _pickL2Index(data, candidate) {
  const envelopes = data.l2_envelopes;
  if (!Array.isArray(envelopes) || envelopes.length === 0) return -1;

  if (candidate && Array.isArray(candidate.l2_indices) && candidate.l2_indices.length > 0) {
    const idx = candidate.l2_indices[0] | 0;
    if (idx >= 0 && idx < envelopes.length) return idx;
  }
  if (candidate && Number.isFinite(candidate.start_mb) && Number.isFinite(candidate.end_mb)) {
    const target = (candidate.start_mb + candidate.end_mb) / 2;
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < envelopes.length; i++) {
      const env = envelopes[i];
      const s0 = env._s0 ?? (env.start_w - 1);
      const e0 = env._e0 ?? (env.end_w - 1);
      const ws = data.windows[s0];
      const we = data.windows[e0];
      if (!ws || !we) continue;
      const cMb = (ws.center_mb + we.center_mb) / 2;
      const d = Math.abs(cMb - target);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  // Fallback: L2 with the largest mean |z| across its windows.
  let bestIdx = -1, bestScore = -Infinity;
  for (let i = 0; i < envelopes.length; i++) {
    const env = envelopes[i];
    const s0 = env._s0 ?? (env.start_w - 1);
    const e0 = env._e0 ?? (env.end_w - 1);
    if (e0 < s0) continue;
    let sum = 0, n = 0;
    for (let w = s0; w <= e0; w++) {
      const z = data.windows[w] && data.windows[w].z;
      if (isFinite(z)) { sum += Math.abs(z); n++; }
    }
    if (n === 0) continue;
    const score = sum / n;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}
