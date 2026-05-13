// shared/mgl_similarity_matrix.js
// =====================================================================
// Per-window sample × sample dosage-similarity matrix + adaptive
// block detection + ARI-based block-transition track. HANDOFF_9 +
// SPEC_0 §11.9.
//
// Conceptual question this module answers: "Per window, which samples
// have similar dosage profiles to which? Does the block structure
// (groups of similar samples) change across the candidate, or is it
// stable?"
//
// Distinct from the fingerprinter (HANDOFF_6, regime-via-rank-equivalence)
// and the dosage clustering (HANDOFF_8, sample-shape-clusters-per-
// candidate). This module answers per-WINDOW pairwise similarity
// + per-window block subdivision; the block-transition track shows
// where in the genome the block structure shifts.
//
// Pipeline (Stage 2-4 of HANDOFF_9):
//   1. Per-window similarity matrix (Pearson default / L1 / L2)
//   2. Per-window block detection via hierarchical-style clustering
//      (delegated to shared/mgl_nj_tree.buildNjTree + cladeLabelsAtK)
//      with adaptive K via silhouette-style scoring
//   3. ARI between adjacent windows → block-transition track
//
// Pure compute. No DOM, no fetch.
// =====================================================================

import {
  pairwiseEuclideanFromDosage,
  buildNjTree,
  cladeLabelsAtK,
} from './mgl_nj_tree.js';
import { computeARI } from './contingency.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Similarity metrics. */
export const MGL_SIMILARITY_METRICS = Object.freeze([
  'pearson', 'l1', 'l2',
]);

export const MGL_SIMILARITY_DEFAULTS = Object.freeze({
  /** Minimum markers per window to compute similarity. */
  min_markers_per_window:  20,
  /** K range for adaptive block detection. */
  K_min:                   2,
  K_max:                   6,
  /** Minimum block size (samples per cluster). */
  min_block_size:          10,
  /** Silhouette threshold to declare structure (K ≥ 2). */
  silhouette_threshold:    0.4,
});

// =====================================================================
// 1. Per-window similarity matrices
// =====================================================================

/**
 * Pearson correlation between sample dosage vectors across markers
 * in a window. Each sample is one vector of length n_markers; the
 * output is n_samples × n_samples symmetric, diagonal = 1.
 *
 * @param {Float64Array} dosage   row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @returns {Float64Array}        row-major n_samples × n_samples
 */
export function pearsonSimilarityMatrix(dosage, n_markers, n_samples) {
  const S = new Float64Array(n_samples * n_samples);
  if (n_markers < 2 || n_samples === 0) return S;
  // Pre-compute per-sample mean + sd over markers.
  const mean = new Float64Array(n_samples);
  const sd   = new Float64Array(n_samples);
  for (let s = 0; s < n_samples; s++) {
    let m = 0;
    for (let r = 0; r < n_markers; r++) m += dosage[r * n_samples + s];
    mean[s] = m / n_markers;
    let v = 0;
    for (let r = 0; r < n_markers; r++) {
      const d = dosage[r * n_samples + s] - mean[s];
      v += d * d;
    }
    sd[s] = Math.sqrt(v / n_markers);
  }
  // Diagonal first.
  for (let i = 0; i < n_samples; i++) S[i * n_samples + i] = 1;
  for (let i = 0; i < n_samples; i++) {
    for (let j = i + 1; j < n_samples; j++) {
      if (sd[i] === 0 || sd[j] === 0) {
        S[i * n_samples + j] = 0;
        S[j * n_samples + i] = 0;
        continue;
      }
      let num = 0;
      for (let r = 0; r < n_markers; r++) {
        num += (dosage[r * n_samples + i] - mean[i])
             * (dosage[r * n_samples + j] - mean[j]);
      }
      const corr = num / (n_markers * sd[i] * sd[j]);
      S[i * n_samples + j] = corr;
      S[j * n_samples + i] = corr;
    }
  }
  return S;
}

/**
 * 1 − normalised L1 distance similarity. Range [0, 1] (assuming
 * dosage values in [0, 2]).
 *
 * @param {Float64Array} dosage   row-major n_markers × n_samples
 * @returns {Float64Array}        row-major n_samples × n_samples
 */
export function l1SimilarityMatrix(dosage, n_markers, n_samples) {
  const S = new Float64Array(n_samples * n_samples);
  if (n_markers === 0 || n_samples === 0) return S;
  const norm = 2 * n_markers;     // max possible L1 distance (dosage ∈ [0, 2])
  for (let i = 0; i < n_samples; i++) S[i * n_samples + i] = 1;
  for (let i = 0; i < n_samples; i++) {
    for (let j = i + 1; j < n_samples; j++) {
      let d = 0;
      for (let r = 0; r < n_markers; r++) {
        d += Math.abs(dosage[r * n_samples + i] - dosage[r * n_samples + j]);
      }
      const sim = 1 - d / norm;
      S[i * n_samples + j] = sim;
      S[j * n_samples + i] = sim;
    }
  }
  return S;
}

/**
 * 1 − (Euclidean distance / max distance) similarity.
 *
 * @returns {Float64Array}        row-major n_samples × n_samples
 */
export function l2SimilarityMatrix(dosage, n_markers, n_samples) {
  // Build the full distance matrix first (reuses NJ helper), then
  // normalise + invert.
  const Dist = pairwiseEuclideanFromDosage(dosage, n_markers, n_samples);
  const S = new Float64Array(n_samples * n_samples);
  let max = 0;
  for (let k = 0; k < Dist.length; k++) if (Dist[k] > max) max = Dist[k];
  for (let i = 0; i < n_samples; i++) S[i * n_samples + i] = 1;
  if (max === 0) return S;
  for (let i = 0; i < n_samples; i++) {
    for (let j = i + 1; j < n_samples; j++) {
      const sim = 1 - Dist[i * n_samples + j] / max;
      S[i * n_samples + j] = sim;
      S[j * n_samples + i] = sim;
    }
  }
  return S;
}

/**
 * Build similarity matrices for many windows in one call.
 *
 * @param {Float64Array} dosage   row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @param {Array<{start_idx:number, end_idx:number}>} windows
 * @param {Object} [opts]
 * @param {string}  [opts.metric='pearson']
 * @returns {Array<{n_markers_in_window:number,
 *                   similarity:Float64Array|null}>}
 */
export function perWindowSimilarityMatrices(dosage, n_markers, n_samples, windows, opts) {
  const o = opts || {};
  const metric = o.metric || 'pearson';
  const minMarkers = Number.isFinite(o.min_markers_per_window)
    ? o.min_markers_per_window : MGL_SIMILARITY_DEFAULTS.min_markers_per_window;
  if (!windows || windows.length === 0) return [];
  const out = new Array(windows.length);
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    const s = Math.max(0, w.start_idx | 0);
    const e = Math.max(s, Math.min(n_markers, (w.end_idx | 0)));
    const n_w = e - s;
    if (n_w < minMarkers) {
      out[wi] = { n_markers_in_window: n_w, similarity: null };
      continue;
    }
    // Slice the dosage rows for this window into a contiguous matrix.
    const slice = dosage.slice(s * n_samples, e * n_samples);
    let sim;
    if (metric === 'l1') {
      sim = l1SimilarityMatrix(slice, n_w, n_samples);
    } else if (metric === 'l2') {
      sim = l2SimilarityMatrix(slice, n_w, n_samples);
    } else {
      sim = pearsonSimilarityMatrix(slice, n_w, n_samples);
    }
    out[wi] = { n_markers_in_window: n_w, similarity: sim };
  }
  return out;
}

// =====================================================================
// 2. Per-window block detection (hierarchical-style via NJ + clade cut)
// =====================================================================

/**
 * Adaptive block detection for one similarity matrix. Tries
 * K = K_min..K_max, scores each via mean-silhouette-style metric on
 * the similarity matrix, picks the best.
 *
 *   silhouette-style score = mean(within-block similarity) -
 *                            mean(across-block similarity)
 *
 * Same direction as classical silhouette (high = good). Cheap to
 * compute from the similarity matrix without recomputing distances.
 *
 * Returns K = 1 when no K ≥ 2 passes; that's the "no structure"
 * verdict for this window.
 *
 * @param {Float64Array} S          row-major n_samples × n_samples
 * @param {number} n_samples
 * @param {Object} [opts]
 * @returns {{K:number, assignment:Int32Array,
 *            silhouette_score:number, all_K:Array<Object>}}
 */
export function detectBlocksInWindow(S, n_samples, opts) {
  const o = opts || {};
  const D = MGL_SIMILARITY_DEFAULTS;
  const Kmin    = Number.isFinite(o.K_min)               ? o.K_min               : D.K_min;
  const Kmax    = Number.isFinite(o.K_max)               ? o.K_max               : D.K_max;
  const minBlk  = Number.isFinite(o.min_block_size)      ? o.min_block_size      : D.min_block_size;
  const silThr  = Number.isFinite(o.silhouette_threshold)? o.silhouette_threshold: D.silhouette_threshold;
  if (n_samples < 2) {
    return {
      K: 1, assignment: new Int32Array(n_samples).fill(0),
      silhouette_score: 0, all_K: [],
    };
  }
  // Build NJ tree from similarity → distance = 1 − S.
  const dist = new Float64Array(n_samples * n_samples);
  for (let i = 0; i < n_samples * n_samples; i++) dist[i] = 1 - S[i];
  const tree = buildNjTree(dist);
  const all_K = [];
  let best = { K: 1, assignment: new Int32Array(n_samples).fill(0), silhouette_score: 0 };
  for (let K = Kmin; K <= Math.min(Kmax, n_samples); K++) {
    const labels = cladeLabelsAtK(tree, K).map(l => parseInt(l.replace('clade_', ''), 10));
    const ass = new Int32Array(labels);
    // Min block size filter.
    const counts = new Int32Array(K);
    for (let i = 0; i < n_samples; i++) {
      if (ass[i] >= 0 && ass[i] < K) counts[ass[i]]++;
    }
    let blkOk = true;
    for (let k = 0; k < K; k++) {
      if (counts[k] === 0) continue;
      if (counts[k] < minBlk) { blkOk = false; break; }
    }
    const score = _meanSilhouetteFromSimilarity(S, n_samples, ass);
    all_K.push({ K, assignment: ass, silhouette_score: score,
                  passes: blkOk && score > silThr });
    if (blkOk && score > silThr && score > best.silhouette_score) {
      best = { K, assignment: ass, silhouette_score: score };
    }
  }
  return Object.assign(best, { all_K });
}

function _meanSilhouetteFromSimilarity(S, n, labels) {
  // For each i: a(i) = mean similarity to same-cluster peers,
  // b(i) = max mean similarity to other-cluster samples.
  // score(i) = a(i) - b(i)  (high = same cluster is tighter than
  // any neighbouring cluster). Returns mean over i.
  if (n < 2) return 0;
  // Discover clusters present.
  const setK = new Set();
  for (let i = 0; i < n; i++) setK.add(labels[i]);
  const K = setK.size;
  if (K < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const li = labels[i];
    const sims = Object.create(null);
    const cnts = Object.create(null);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sims[labels[j]] = (sims[labels[j]] || 0) + S[i * n + j];
      cnts[labels[j]] = (cnts[labels[j]] || 0) + 1;
    }
    const a = cnts[li] ? sims[li] / cnts[li] : 0;
    let b = -Infinity;
    for (const k in sims) {
      const ki = Number(k);
      if (ki === li) continue;
      const m = sims[k] / cnts[k];
      if (m > b) b = m;
    }
    if (!Number.isFinite(b)) b = 0;
    sum += a - b;
  }
  return sum / n;
}

// =====================================================================
// 3. ARI between adjacent windows / block-transition track
// =====================================================================

/**
 * Adjusted Rand Index between two per-window block assignments.
 *
 * @param {Int32Array|number[]} a
 * @param {Int32Array|number[]} b
 * @returns {number}     ARI ∈ [-1, 1]
 */
export function ariBetweenAssignments(a, b) {
  return computeARI(a, b);
}

/**
 * Block-transition track: ARI between every pair of consecutive
 * windows. Length = n_windows − 1. Low ARI = block structure
 * shifts between those windows (transition point).
 *
 * Windows with `assignment === null` (skipped by QC) yield ARI = NaN.
 *
 * @param {Array<{assignment:Int32Array|null}>} per_window_blocks
 * @returns {Float64Array}   length n_windows − 1
 */
export function blockTransitionTrack(per_window_blocks) {
  if (!Array.isArray(per_window_blocks) || per_window_blocks.length < 2) {
    return new Float64Array(0);
  }
  const N = per_window_blocks.length;
  const out = new Float64Array(N - 1);
  for (let i = 0; i < N - 1; i++) {
    const a = per_window_blocks[i] && per_window_blocks[i].assignment;
    const b = per_window_blocks[i + 1] && per_window_blocks[i + 1].assignment;
    if (!a || !b) { out[i] = NaN; continue; }
    out[i] = computeARI(a, b);
  }
  return out;
}

// =====================================================================
// 4. End-to-end orchestrator
// =====================================================================

/**
 * Top-level pipeline: dosage matrix + window grid →
 *   per-window similarity matrices + per-window block detection +
 *   ARI block-transition track.
 *
 * @param {Object} args
 * @param {Float64Array} args.dosage          row-major n_markers × n_samples
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {Array<{start_idx:number, end_idx:number,
 *                start_bp?:number, end_bp?:number, idx?:number}>}
 *                                args.windows
 * @param {Object} [args.opts]    forwarded to perWindow + detectBlocks
 * @returns {{
 *   windows: Array<{idx:number, start_bp?:number, end_bp?:number,
 *                    n_markers_in_window:number,
 *                    similarity:Float64Array|null,
 *                    K:number, assignment:Int32Array|null,
 *                    silhouette_score:number}>,
 *   block_transition_ari: Float64Array,
 * }}
 */
export function computeSimilarityAndBlocks(args) {
  const a = args || {};
  const opts = a.opts || {};
  if (!a.dosage || !Array.isArray(a.windows)) {
    return { windows: [], block_transition_ari: new Float64Array(0) };
  }
  const sims = perWindowSimilarityMatrices(
    a.dosage, a.n_markers, a.n_samples, a.windows, opts,
  );
  const windows = new Array(a.windows.length);
  for (let wi = 0; wi < a.windows.length; wi++) {
    const w = a.windows[wi];
    const sm = sims[wi];
    if (!sm.similarity) {
      windows[wi] = {
        idx:                  Number.isFinite(w.idx) ? w.idx : wi,
        start_bp:             w.start_bp != null ? w.start_bp : null,
        end_bp:               w.end_bp   != null ? w.end_bp   : null,
        n_markers_in_window:  sm.n_markers_in_window,
        similarity:           null,
        K:                    1,
        assignment:           null,
        silhouette_score:     0,
      };
      continue;
    }
    const blocks = detectBlocksInWindow(sm.similarity, a.n_samples, opts);
    windows[wi] = {
      idx:                  Number.isFinite(w.idx) ? w.idx : wi,
      start_bp:             w.start_bp != null ? w.start_bp : null,
      end_bp:               w.end_bp   != null ? w.end_bp   : null,
      n_markers_in_window:  sm.n_markers_in_window,
      similarity:           sm.similarity,
      K:                    blocks.K,
      assignment:           blocks.assignment,
      silhouette_score:     blocks.silhouette_score,
    };
  }
  const trans = blockTransitionTrack(windows);
  return { windows, block_transition_ari: trans };
}
