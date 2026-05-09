// shared/band_tracking/anchor_signals.js
// =====================================================================
// Per-window Cramer's V and off-diagonal entropy to a tracked-anchor
// labeling. This is the per-window upgrade of recomputeAnchorConcord
// in pca_panel.js, which currently broadcasts one V per L2 envelope.
//
// The anchor is defined by:
//   - a tracked sample subset S      (typically all samples that had a
//                                     confident band assignment at the
//                                     anchor window)
//   - a labeling L_a : S → [0, K_a)  (kmeans labels of S at the anchor)
//
// At each test window w, we look up w's kmeans labels for the same
// samples S and compute:
//   - V(w)      = Cramer's V of the K_a × K_w Hungarian-aligned
//                  contingency built from S's anchor-vs-w label pairs
//   - H_off(w)  = normalised off-diagonal entropy of the same aligned
//                  table — diagnostic of *how* labels travel:
//                  low  = travelers concentrate in one off-diagonal cell
//                         (coherent crossover)
//                  high = travelers scatter across many cells
//                         (random scrambling, regime end)
//
// V and H_off are independent signals. Together with band_quality they
// drive classifyWindow() in window_classification.js.
// =====================================================================

import { alignLabels } from '../hungarian.js';
import { cramersV } from '../contingency.js';

// ---------------------------------------------------------------------
// off-diagonal entropy of an aligned contingency
//
// Given the K_a × K_c Hungarian-aligned table T where the diagonal is
// the "stayed in band" mass, compute the entropy of the off-diagonal
// distribution, normalised so:
//   - 0 = all off-diagonal mass in one cell  (one band travelled
//         coherently to one other band — crossover signature)
//   - 1 = off-diagonal mass uniform across all (K_eff-1) other-cells per
//         row, summed over rows (random scattering)
//
// We compute it row-wise then average across rows (weighted by row's
// off-diagonal mass). A row whose off-diagonal mass is zero contributes
// nothing (no travelers from that band).
//
// Returns NaN if there is no off-diagonal mass at all (perfect
// alignment — both V will be 1.0 and H_off is undefined; classifier
// treats this as INTERIOR-adjacent).
// ---------------------------------------------------------------------

/**
 * @param {Array<number[]>|Float64Array|Int32Array} table
 *   K_a × K_c contingency. Accepts a flat row-major typed array of
 *   length K_a*K_c, or a 2D nested array. When K_a !== K_c the
 *   "diagonal" is interpreted as the K_min largest-overlap matched
 *   cells from Hungarian alignment — see the alignLabels caller.
 * @param {number} K_a
 * @param {number} K_c
 * @returns {number}
 */
export function offDiagonalEntropy(table, K_a, K_c) {
  // Normalise to flat row-major
  const get = (r, c) => Array.isArray(table)
    ? (Array.isArray(table[r]) ? table[r][c] : table[r * K_c + c])
    : table[r * K_c + c];

  const K_min = Math.min(K_a, K_c);
  // Total off-diagonal mass per row (excluding the matched diagonal cell)
  let total_off = 0;
  let weighted_H = 0;
  let n_off_rows = 0;
  for (let r = 0; r < K_a; r++) {
    let row_off = 0;
    // Collect off-diagonal cells for this row.
    // "Diagonal" here is r === c when r < K_min, else there is no diagonal
    // for this row (it's an extra row from K_a > K_c).
    const off_cells = [];
    for (let c = 0; c < K_c; c++) {
      if (r < K_min && c === r) continue;
      const v = get(r, c);
      if (v > 0) {
        off_cells.push(v);
        row_off += v;
      }
    }
    if (row_off === 0) continue;
    n_off_rows++;
    total_off += row_off;
    // Per-row entropy of where this row's travelers went, normalised
    // by log(n_off_cells_possible). Only available off-cells participate
    // in the normalising base — if K_c=3 and the diagonal is at c=2,
    // there are 2 possible off-cells and full uniform entropy is log(2).
    const n_off_possible = (r < K_min) ? (K_c - 1) : K_c;
    if (n_off_possible <= 1) continue;
    let H_row = 0;
    for (const v of off_cells) {
      const p = v / row_off;
      if (p > 0) H_row -= p * Math.log(p);
    }
    H_row /= Math.log(n_off_possible);  // normalise to [0, 1]
    // Weight by this row's contribution to total off-diagonal mass.
    weighted_H += H_row * row_off;
  }
  if (total_off === 0 || n_off_rows === 0) return NaN;
  return weighted_H / total_off;
}

// ---------------------------------------------------------------------
// computeWindowSignals
//
// For one anchor + one test window, return { v, h_off, K_w, n_used }.
// n_used is the number of tracked samples actually present in both
// labelings (important for downstream weighting / NaN handling).
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Map<number,number>|Array<[number,number]>} args.anchor_labels
 *   Map (or [si, lbl] pairs) from sample index to anchor-window label.
 *   Only these samples participate in the contingency.
 * @param {number} args.K_a               number of anchor bands
 * @param {Int8Array|number[]} args.labels_w   per-sample labels at window w
 * @param {number} args.K_w               number of bands at window w
 * @returns {{ v:number, h_off:number, K_w:number, n_used:number }}
 */
export function computeWindowSignals(args) {
  const { anchor_labels, K_a, labels_w, K_w } = args;
  if (!labels_w || K_a < 2 || K_w < 2) {
    return { v: NaN, h_off: NaN, K_w, n_used: 0 };
  }
  // Build flat per-sample arrays restricted to the tracked subset.
  // We use anchor_labels (Map or pair list) as the iteration spine.
  const it = anchor_labels instanceof Map
    ? anchor_labels.entries()
    : anchor_labels[Symbol.iterator]();
  const a_arr = [];
  const w_arr = [];
  for (const [si, lbl_a] of it) {
    if (lbl_a < 0 || lbl_a >= K_a) continue;
    const lbl_w = labels_w[si];
    if (lbl_w == null || lbl_w < 0 || lbl_w >= K_w) continue;
    a_arr.push(lbl_a);
    w_arr.push(lbl_w);
  }
  const n_used = a_arr.length;
  if (n_used < 5) return { v: NaN, h_off: NaN, K_w, n_used };
  // Hungarian alignment requires square K. When K_a !== K_w, pad to
  // max(K_a, K_w) and accept the rectangular semantics: the alignment
  // matches each anchor band to the best window band; extra bands on
  // the larger side end up unaligned and contribute to off-diagonal
  // entropy as travelers-with-no-home, which is the right behaviour.
  const K_align = Math.max(K_a, K_w);
  const aligned = alignLabels(a_arr, w_arr, K_align);
  // Build the K_a × K_w contingency from the (already aligned) labels.
  // alignLabels returned aligned labels in g2's frame — we need the
  // contingency table directly. alignLabels.table is K_align × K_align
  // and its rows/cols correspond to the padded space; we crop to the
  // active K_a × K_w region for V and H_off computation.
  const T_full = aligned.table;            // K_align × K_align (Int32Array rows)
  // Flat K_a*K_w table (row-major)
  const T = new Int32Array(K_a * K_w);
  for (let r = 0; r < K_a; r++) {
    for (let c = 0; c < K_w; c++) {
      T[r * K_w + c] = T_full[r][c];
    }
  }
  const v = cramersV(T, K_a, K_w);
  const h_off = offDiagonalEntropy(T, K_a, K_w);
  return { v, h_off, K_w, n_used };
}

// ---------------------------------------------------------------------
// computeAnchorTracksRange
//
// Compute V(w), H_off(w), K_w over a window range. Caches diag-stats
// per anchor are not needed (the contingency for each w is independent).
//
// Caller supplies getLabels(w) and getK(w) — same callbacks the chain
// walk uses. This keeps the anchor-signal computation orthogonal to
// where labels live.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Map<number,number>} args.anchor_labels
 * @param {number} args.K_a
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {number} args.s_window
 * @param {number} args.e_window
 * @returns {{ v_track:Float32Array, h_off_track:Float32Array,
 *            k_w_track:Int8Array,  n_used_track:Int32Array,
 *            s_window:number, e_window:number }}
 */
export function computeAnchorTracksRange(args) {
  const { anchor_labels, K_a, getLabels, getK, s_window, e_window } = args;
  const N = e_window - s_window + 1;
  const v_track     = new Float32Array(N);
  const h_off_track = new Float32Array(N);
  const k_w_track   = new Int8Array(N);
  const n_used_track = new Int32Array(N);
  for (let i = 0; i < N; i++) { v_track[i] = NaN; h_off_track[i] = NaN; }
  for (let w = s_window; w <= e_window; w++) {
    const labels_w = getLabels(w);
    const K_w = getK(w);
    if (!labels_w || K_w < 2) {
      // Leave NaN; classifier will treat as UNRELIABLE.
      continue;
    }
    const sig = computeWindowSignals({ anchor_labels, K_a, labels_w, K_w });
    const i = w - s_window;
    v_track[i]     = sig.v;
    h_off_track[i] = sig.h_off;
    k_w_track[i]   = sig.K_w;
    n_used_track[i] = sig.n_used;
  }
  return { v_track, h_off_track, k_w_track, n_used_track, s_window, e_window };
}

// ---------------------------------------------------------------------
// captureAnchor
//
// Build an anchor record from a window's labels and a tracked-sample
// subset. Mirrors the anchor-capture logic that pca_panel's
// _ensureAnchor performs, but as a pure function so seed_discovery
// can call it programmatically.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.win_idx
 * @param {Int8Array|number[]} args.labels      per-sample labels at win_idx
 * @param {number} args.K
 * @param {Iterable<number>} args.tracked_sample_idx
 *   the sample indices to track. If empty/null, all samples with a
 *   valid label are tracked (typical seed-discovery default).
 * @returns {{ winIdx:number, K:number, labels:Map<number,number>, n_tracked:number }}
 */
export function captureAnchor(args) {
  const { win_idx, labels, K, tracked_sample_idx } = args;
  const m = new Map();
  if (tracked_sample_idx == null) {
    // Track every sample with a valid label
    for (let si = 0; si < labels.length; si++) {
      const lbl = labels[si];
      if (lbl != null && lbl >= 0 && lbl < K) m.set(si, lbl);
    }
  } else {
    for (const si of tracked_sample_idx) {
      const lbl = labels[si];
      if (lbl != null && lbl >= 0 && lbl < K) m.set(si, lbl);
    }
  }
  return { winIdx: win_idx, K, labels: m, n_tracked: m.size };
}

// Console-debug
if (typeof window !== 'undefined') {
  window._offDiagonalEntropy   = offDiagonalEntropy;
  window._computeWindowSignals = computeWindowSignals;
  window._computeAnchorTracksRange = computeAnchorTracksRange;
  window._captureAnchor        = captureAnchor;
}
