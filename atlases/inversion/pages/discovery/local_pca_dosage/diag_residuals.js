// pages/discovery/local_pca_dosage/diag_residuals.js
//
// Per-fish residual-Z diagnostic + the "residual" sample-color mode
// (legacy lines 36341-36523). Drives:
//   - the "color by residual_z" mode in getSampleColor (state.colorMode
//     === 'residual')
//   - the karyotype/tier page's per-candidate suspicion column
//     (diagComputeCandidateSuspicion)
//
// Residual_z is the within-band Euclidean distance from the K-means
// centroid in (PC1, PC2) space, z-scored relative to the within-band
// distance σ. A fish deep inside its cluster scores near 0; a fish
// far from its centroid (potentially mis-clustered, or genuinely
// distinct) scores high. Threshold 2.5 flags "suspicious".
//
// Two compute paths:
//   - PRECOMP-PROVIDED: when w.band_residual_z is shipped by the
//     R-side precomp, use it directly (eigenvalue-derived sd is more
//     robust than the atlas's quick-and-dirty within-band sd).
//   - ATLAS-COMPUTED: derive K-means assignment + residuals via
//     kmeans2D from shared/kmeans.js.
//
// All entry points take `state` as their first argument. The cache
// lives on state._diagCache (per-state, per-(winIdx, k)).

import { kmeans2D } from '../../../shared/kmeans.js';

// =====================================================================
// Thresholds (legacy lines 36341-36342)
// =====================================================================

/** Residual z-score above this flags a fish as "suspicious". */
export const DIAG_RESIDUAL_SUSPICIOUS_Z = 2.5;

/**
 * Per-fish band consistency floor — fraction of windows in which the
 * fish stays in the modal band over the candidate's span. Below this,
 * the fish is flagged regardless of its peak residual_z.
 */
export const DIAG_BAND_CONSISTENCY_THRESH = 0.85;

// =====================================================================
// Residual color ramp (legacy lines 36350-36370)
// =====================================================================

/**
 * Three-stop interpolation: blue (z=0, --accent-2) → amber (z=2, --accent)
 * → red (z=4, --bad). z is clamped to [0, 4]. Non-finite → neutral grey.
 *
 * @param {number} z   residual z-score
 * @returns {string}   hex color
 */
export function diagResidualColor(z) {
  if (z == null || !isFinite(z)) return '#888';
  const t = Math.min(1, Math.max(0, z / 4));
  const stops = [
    [0.00, [79, 163, 255]],   // --accent-2 (cool blue)
    [0.50, [245, 165, 36]],   // --accent (amber)
    [1.00, [224,  85,  92]],  // --bad (red)
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      lo = stops[i]; hi = stops[i + 1]; break;
    }
  }
  const span = hi[0] - lo[0];
  const f = span > 0 ? (t - lo[0]) / span : 0;
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * f);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * f);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// =====================================================================
// Per-window residuals (legacy lines 36376-36453)
// =====================================================================

/**
 * Compute per-fish residual_z for `winIdx`. Cached on
 * state._diagCache by (winIdx, k). Returns:
 *   { residuals: Float32Array, labels: Int8Array | null,
 *     centroids_x?, centroids_y?, within_sd?, source: 'precomp' | 'atlas' }
 * or null when the window lacks pc1/pc2.
 *
 * @param {Object} state
 * @param {number} winIdx
 * @param {number} [k]   defaults to state.k or 3
 * @returns {Object|null}
 */
export function diagComputeWindowResiduals(state, winIdx, k) {
  if (!state || !state.data || !state.data.windows) return null;
  const w = state.data.windows[winIdx];
  if (!w || !Array.isArray(w.pc1) || !Array.isArray(w.pc2)) return null;
  k = k || (state.k || 3);
  const cacheKey = winIdx + ':' + k;
  if (!state._diagCache) state._diagCache = {};
  if (state._diagCache[cacheKey]) return state._diagCache[cacheKey];

  // PRECOMP-PROVIDED PATH: w.band_residual_z is the eigenvalue-derived
  // residual from the R-side precomp. Same shape + semantics, more
  // robust than the atlas-side estimate.
  if (Array.isArray(w.band_residual_z) && w.band_residual_z.length === w.pc1.length) {
    const result = {
      residuals: Float32Array.from(w.band_residual_z),
      labels: w.band ? Int8Array.from(w.band) : null,
      source: 'precomp',
    };
    state._diagCache[cacheKey] = result;
    return result;
  }

  // ATLAS-COMPUTED PATH: K-means + within-band z-score.
  const pc1 = w.pc1, pc2 = w.pc2;
  const n = pc1.length;
  if (n === 0) return null;
  const km = kmeans2D(pc1, pc2, k);
  const residuals = new Float32Array(n);
  const within_sum = new Float64Array(k);
  const within_n = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    const lab = km.labels[i];
    const dx = pc1[i] - km.cx[lab];
    const dy = pc2[i] - km.cy[lab];
    const d = Math.sqrt(dx * dx + dy * dy);
    residuals[i] = d;
    within_sum[lab] += d;
    within_n[lab]++;
  }
  const within_mean = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    within_mean[j] = within_n[j] > 0 ? within_sum[j] / within_n[j] : 0;
  }
  const sd_sum = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const lab = km.labels[i];
    const dev = residuals[i] - within_mean[lab];
    sd_sum[lab] += dev * dev;
  }
  const within_sd = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    within_sd[j] = within_n[j] > 1 ? Math.sqrt(sd_sum[j] / (within_n[j] - 1)) : 1;
    if (!(within_sd[j] > 0)) within_sd[j] = 1;
  }
  // Convert raw distance → z-score relative to within-band sd.
  // Distance is non-negative; clamp negative z (a "deep inside cluster"
  // fish) to 0 for residual interpretation.
  for (let i = 0; i < n; i++) {
    const lab = km.labels[i];
    residuals[i] = (residuals[i] - within_mean[lab]) / within_sd[lab];
    if (residuals[i] < 0) residuals[i] = 0;
  }
  const result = {
    residuals,
    labels: km.labels,
    centroids_x: km.cx,
    centroids_y: km.cy,
    within_sd,
    source: 'atlas',
  };
  state._diagCache[cacheKey] = result;
  return result;
}

// =====================================================================
// Sample color (legacy lines 36513-36517)
// =====================================================================

/**
 * Resolve the residual-mode color for sample `si` in window `winIdx`.
 * Falls back to neutral grey when no PC data / no residuals available.
 *
 * @param {Object} state
 * @param {number} si
 * @param {number} winIdx
 * @returns {string}  hex color
 */
export function diagSampleColor(state, si, winIdx) {
  const r = diagComputeWindowResiduals(state, winIdx);
  if (!r || r.residuals == null || r.residuals[si] == null) return '#888';
  return diagResidualColor(r.residuals[si]);
}

// =====================================================================
// Cache invalidation (legacy lines 36520-36523)
// =====================================================================

/** Drop the residual cache. Called when window data changes. */
export function diagClearCache(state) {
  if (!state) return;
  state._diagCache = {};
}

// =====================================================================
// Candidate-level suspicion summary (legacy lines 36458-36509)
// =====================================================================

/**
 * Per-candidate suspicion summary across [winLo, winHi]. For each
 * fish: mean residual, max residual, band consistency, suspicious
 * flag (max_z ≥ DIAG_RESIDUAL_SUSPICIOUS_Z or consistency <
 * DIAG_BAND_CONSISTENCY_THRESH).
 *
 * Used by the karyotype/tier page's suspicion column.
 *
 * @param {Object} state
 * @param {number} winLo  inclusive
 * @param {number} winHi  inclusive
 * @param {number} [k]
 * @returns {{meanZ:Float32Array, maxZ:Float64Array,
 *           consistency:Float32Array, suspicious:Uint8Array,
 *           n_windows:number} | null}
 */
export function diagComputeCandidateSuspicion(state, winLo, winHi, k) {
  if (!state || !state.data) return null;
  k = k || (state.k || 3);
  if (winLo == null || winHi == null || winHi < winLo) return null;
  const nWin = winHi - winLo + 1;
  if (nWin < 1) return null;
  const w0 = state.data.windows[winLo];
  if (!w0 || !Array.isArray(w0.pc1)) return null;
  const nS = w0.pc1.length;

  const sumZ = new Float64Array(nS);
  const maxZ = new Float64Array(nS);
  const cnt = new Int32Array(nS);
  const labelsByWin = [];

  for (let wi = winLo; wi <= winHi; wi++) {
    const r = diagComputeWindowResiduals(state, wi, k);
    if (!r) continue;
    labelsByWin.push(r.labels);
    const z = r.residuals;
    for (let si = 0; si < nS; si++) {
      sumZ[si] += z[si];
      if (z[si] > maxZ[si]) maxZ[si] = z[si];
      cnt[si]++;
    }
  }

  // Per-fish band consistency: fraction of windows where the fish was
  // in its modal band across the span.
  const consistency = new Float32Array(nS);
  for (let si = 0; si < nS; si++) {
    if (labelsByWin.length === 0) { consistency[si] = 1; continue; }
    const counts = new Int32Array(k);
    for (let wi = 0; wi < labelsByWin.length; wi++) {
      const lab = labelsByWin[wi] ? labelsByWin[wi][si] : null;
      if (lab != null && lab >= 0 && lab < k) counts[lab]++;
    }
    let modeCount = 0;
    for (let j = 0; j < k; j++) if (counts[j] > modeCount) modeCount = counts[j];
    consistency[si] = labelsByWin.length > 0 ? modeCount / labelsByWin.length : 1;
  }

  const meanZ = new Float32Array(nS);
  for (let si = 0; si < nS; si++) meanZ[si] = cnt[si] > 0 ? sumZ[si] / cnt[si] : 0;

  const suspicious = new Uint8Array(nS);
  for (let si = 0; si < nS; si++) {
    const failResid = maxZ[si] >= DIAG_RESIDUAL_SUSPICIOUS_Z;
    const failConsistency = consistency[si] < DIAG_BAND_CONSISTENCY_THRESH;
    if (failResid || failConsistency) suspicious[si] = 1;
  }
  return { meanZ, maxZ, consistency, suspicious, n_windows: nWin };
}
