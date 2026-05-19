// atlases/inversion/shared/per_sample_line_color.js
//
// Per-sample line-color resolvers for the local_pca_dosage per-sample-lines panel.
// Provides one resolver per state.linesColorMode value:
//
//   kmeans   — grey cloud (lines panel default; resolver returns null
//              and the caller falls through to the legacy grey stroke)
//   family   — handled by shared/sample_color.js#familyColor
//   lineage  — handled by local_pca_dosage/_state.js#_lineageColor
//   het      — per-sample mean het rate across visible windows (this module)
//   theta_pi — per-sample mean θπ across visible windows (this module)
//   ghsl     — per-sample mean GHSL across visible windows (this module)
//   dosage   — per-sample mean dosage across visible windows (this module)
//   froh     — per-sample F_ROH scalar (this module)
//   confounder_alert — F_ROH > 0.05 → red, else grey (this module)
//
// The "compute" half is split from the "color ramp" half so callers can:
//   1. perSampleValuesForMode(state, mode, range) → Float64Array | null
//   2. perSampleColor(mode, value, valuesArr, modeOpts) → CSS color | null
//
// This split lets `drawLinesPanel` cache the per-sample values for one
// frame and only call the color ramp per sample (cheap).
//
// 2026-05-18: per WIRE_AUDIT Group D — the lines panel previously
// only honoured 'family' and 'lineage' in its per-sample-coloring
// branch. The other modes existed in the dropdown but were no-ops.

import { computeHetRateForRange, computeDosageMeanForRange } from './dosage_chunks.js';
import { hetRateColor } from './het_rate.js';

const CONFOUNDER_FROH_THRESHOLD = 0.05;

/**
 * Returns true if a mode resolves to a per-sample scalar that we can
 * paint (i.e. is NOT 'kmeans' which paints grey). Used by the lines
 * panel to gate the per-sample-color branch.
 */
export function isPerSampleLineColorMode(mode) {
  return mode === 'family'
      || mode === 'lineage'
      || mode === 'het'
      || mode === 'theta_pi'
      || mode === 'ghsl'
      || mode === 'dosage'
      || mode === 'froh'
      || mode === 'confounder_alert';
}

/**
 * Compute per-sample summary values for a mode over a range. Returns
 * Float64Array(n_samples) or null when the layer is missing or the mode
 * has no compute step (family / lineage — those use their own
 * resolvers and don't need a value array).
 *
 * Range is in window indices [startW, endW] inclusive (the lines
 * panel's currently-visible window range).
 *
 * @param {object} state — atlas state with .data
 * @param {string} mode  — linesColorMode value
 * @param {{startW?:number, endW?:number}} range
 * @returns {Float64Array | null}
 */
export function perSampleValuesForMode(state, mode, range) {
  if (!state || !state.data) return null;
  if (mode === 'family' || mode === 'lineage' || mode === 'kmeans') return null;
  const d = state.data;
  const nS = d.n_samples | 0;
  if (nS <= 0) return null;
  const startW = (range && range.startW != null) ? (range.startW | 0) : 0;
  const endW   = (range && range.endW   != null) ? (range.endW   | 0) : (d.n_windows - 1);

  if (mode === 'froh' || mode === 'confounder_alert') {
    const arr = d.sample_froh;
    if (!arr || arr.length !== nS) return null;
    const out = new Float64Array(nS);
    for (let si = 0; si < nS; si++) out[si] = +arr[si];
    return out;
  }

  if (mode === 'theta_pi') {
    // 2026-05-19 — canonical field is theta_pi_per_window.values[si][w]
    // (per-sample × per-window 2D array). Old paths (theta_pi_panel /
    // per_sample_theta_pi with .div_roll) are pre-schema-2.18 drafts.
    const tpw = d.theta_pi_per_window;
    if (tpw && Array.isArray(tpw.values)) {
      return _perSampleMeanFrom2D(tpw.values, nS, startW, endW);
    }
    // Legacy fallback: panel-style div_roll.
    const panel = d.theta_pi_panel || d.per_sample_theta_pi || null;
    if (!panel) return null;
    return _perSampleMeanByWindowPanel(panel, nS, startW, endW, d);
  }

  if (mode === 'ghsl') {
    // 2026-05-19 — canonical field is ghsl_local_pca.pc_loadings_aligned
    // shaped [npc][n_windows][n_samples]. We average PC1 (loadings[0])
    // across the visible window range; the resulting per-sample scalar
    // separates the karyotype arms of the GHSL PC1 axis.
    const lp = d.ghsl_local_pca;
    if (lp && Array.isArray(lp.pc_loadings_aligned) && Array.isArray(lp.pc_loadings_aligned[0])) {
      return _perSamplePcMeanFromAligned(lp.pc_loadings_aligned[0], nS, startW, endW);
    }
    // Legacy fallback.
    const panel = d.ghsl_panel || null;
    if (!panel) return null;
    return _perSampleMeanByWindowPanel(panel, nS, startW, endW, d);
  }

  if (mode === 'het') {
    // Het uses the dosage_chunks-backed compute. The lines panel
    // already has a getCachedChunk callback in state.dosageChunkCache;
    // we pass it through if present. For headless / partial state, the
    // function returns NaN-filled arrays (acceptable — color resolver
    // falls back to grey).
    const w = d.windows;
    if (!w || !w[startW] || !w[endW]) return null;
    const startBp = w[startW].start_bp != null ? w[startW].start_bp
                                                : w[startW].center_bp;
    const endBp   = w[endW].end_bp != null ? w[endW].end_bp
                                            : w[endW].center_bp;
    if (!Number.isFinite(startBp) || !Number.isFinite(endBp)) return null;
    return computeHetRateForRange(state, startBp, endBp, {
      getCachedChunk: state._linesPanelGetCachedChunk || null,
      cacheKey: `lines:${startW}-${endW}`,
    });
  }

  if (mode === 'dosage') {
    // Per-sample mean dosage across the visible range. 2026-05-18 —
    // computeDosageMeanForRange (shared/dosage_chunks.js) gates on
    // the dosage_chunks layer being loaded; returns NaN-filled when
    // not. Same caching pattern as het.
    const w = d.windows;
    if (!w || !w[startW] || !w[endW]) return null;
    const startBp = w[startW].start_bp != null ? w[startW].start_bp
                                                : w[startW].center_bp;
    const endBp   = w[endW].end_bp != null ? w[endW].end_bp
                                            : w[endW].center_bp;
    if (!Number.isFinite(startBp) || !Number.isFinite(endBp)) return null;
    return computeDosageMeanForRange(state, startBp, endBp, {
      getCachedChunk: state._linesPanelGetCachedChunk || null,
      cacheKey: `lines:dosage:${startW}-${endW}`,
    });
  }

  return null;
}

// Helper: per-sample mean across [startW, endW] inclusive when the
// values are a flat sample-major 2D array: M[sample_idx][window_idx].
// This is the shape theta_pi_per_window.values uses today.
function _perSampleMeanFrom2D(M, nS, startW, endW) {
  if (!Array.isArray(M) || M.length === 0) return null;
  const lo = Math.max(0, startW | 0);
  const hi = Math.min((M[0] && M[0].length ? M[0].length - 1 : -1), endW | 0);
  if (hi < lo) return null;
  const out = new Float64Array(nS);
  for (let si = 0; si < nS; si++) {
    const row = M[si];
    if (!row) { out[si] = NaN; continue; }
    let sum = 0, n = 0;
    for (let w = lo; w <= hi; w++) {
      const v = row[w];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    out[si] = n > 0 ? (sum / n) : NaN;
  }
  return out;
}

// Helper: per-sample mean across [startW, endW] inclusive when the
// values are a WINDOW-MAJOR slice of an aligned-loadings cube:
// pcSlice[window_idx][sample_idx]. This is what ghsl_local_pca's
// pc_loadings_aligned[0] (= PC1 across all windows × samples) gives us.
function _perSamplePcMeanFromAligned(pcSlice, nS, startW, endW) {
  if (!Array.isArray(pcSlice) || pcSlice.length === 0) return null;
  const lo = Math.max(0, startW | 0);
  const hi = Math.min(pcSlice.length - 1, endW | 0);
  if (hi < lo) return null;
  const out = new Float64Array(nS);
  // Accumulate per sample by walking windows once, samples-inner.
  const sums = new Float64Array(nS);
  const counts = new Int32Array(nS);
  for (let w = lo; w <= hi; w++) {
    const row = pcSlice[w];
    if (!Array.isArray(row)) continue;
    const N = Math.min(nS, row.length);
    for (let si = 0; si < N; si++) {
      const v = row[si];
      if (Number.isFinite(v)) { sums[si] += v; counts[si]++; }
    }
  }
  for (let si = 0; si < nS; si++) {
    out[si] = counts[si] > 0 ? (sums[si] / counts[si]) : NaN;
  }
  return out;
}

// Helper: per-sample mean across [startW, endW] inclusive when the
// panel provides div_roll[scale][sample_idx][window_idx] (the GHSL /
// theta_pi panel shape). Returns Float64Array(nS) of means.
function _perSampleMeanByWindowPanel(panel, nS, startW, endW, data) {
  if (!panel || !panel.div_roll) return null;
  const scaleKey = panel.primary_scale ||
                   (panel.scales && panel.scales[0]) ||
                   Object.keys(panel.div_roll)[0];
  if (!scaleKey || !panel.div_roll[scaleKey]) return null;
  const M = panel.div_roll[scaleKey];
  if (!Array.isArray(M) || M.length === 0) return null;
  // Some panels are window-indexed natively (window_idx == bp window),
  // others are bp-windowed (panel.start_bp / panel.end_bp). Resolve
  // the appropriate column range.
  let lo = startW, hi = endW;
  if (panel.start_bp && panel.end_bp && panel.start_bp.length) {
    // bp-windowed panel — map [startW, endW] → bp range → panel cols
    const w = data.windows;
    if (!w || !w[startW] || !w[endW]) return null;
    const sBp = w[startW].start_bp != null ? w[startW].start_bp : w[startW].center_bp;
    const eBp = w[endW].end_bp     != null ? w[endW].end_bp     : w[endW].center_bp;
    if (!Number.isFinite(sBp) || !Number.isFinite(eBp)) return null;
    const cols = [];
    const N = panel.start_bp.length;
    for (let i = 0; i < N; i++) {
      const mid = (panel.start_bp[i] + panel.end_bp[i]) / 2;
      if (mid >= sBp && mid <= eBp) cols.push(i);
    }
    if (cols.length === 0) return null;
    const out = new Float64Array(nS);
    for (let si = 0; si < nS; si++) {
      const row = M[si];
      if (!row) { out[si] = NaN; continue; }
      let sum = 0, n = 0;
      for (const c of cols) {
        const v = row[c];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      out[si] = n > 0 ? (sum / n) : NaN;
    }
    return out;
  }
  // Window-indexed: panel.div_roll[scale][sample][window_idx].
  const out = new Float64Array(nS);
  for (let si = 0; si < nS; si++) {
    const row = M[si];
    if (!row) { out[si] = NaN; continue; }
    let sum = 0, n = 0;
    for (let w = lo; w <= hi; w++) {
      const v = row[w];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    out[si] = n > 0 ? (sum / n) : NaN;
  }
  return out;
}

/**
 * Resolve a sample's CSS color from its precomputed scalar value.
 * Returns null when the value is NaN / mode has no ramp / etc. —
 * caller falls back to the default grey stroke.
 *
 * @param {string} mode  — linesColorMode value
 * @param {number} value — per-sample scalar for this mode
 * @param {Float64Array|null} valuesArr — full array (for vmin/vmax
 *                          normalisation in sequential modes)
 * @returns {string | null}
 */
export function perSampleColorFor(mode, value, valuesArr) {
  if (!Number.isFinite(value)) return null;

  if (mode === 'het') {
    // hetRateColor handles its own normalization (0..1 rate).
    return hetRateColor(value);
  }

  if (mode === 'froh') {
    // F_ROH in [0, 1]. Grey at 0; red intensity at 1.
    const t = Math.max(0, Math.min(1, value));
    return _sequentialGreyToRed(t);
  }

  if (mode === 'confounder_alert') {
    // Binary: F_ROH > 0.05 → red; else grey. Threshold is the same
    // one band_diagnostics uses for the confounder warning.
    return value > CONFOUNDER_FROH_THRESHOLD
      ? 'rgb(217,79,79)'
      : 'rgb(140,150,170)';
  }

  if (mode === 'theta_pi' || mode === 'ghsl') {
    // Sequential ramp normalized to the array's [min, max].
    if (!valuesArr) return null;
    let vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < valuesArr.length; i++) {
      const v = valuesArr[i];
      if (!Number.isFinite(v)) continue;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    if (!isFinite(vMin) || vMin === vMax) return null;
    const t = (value - vMin) / (vMax - vMin);
    return _sequentialBlueToYellow(t);
  }

  if (mode === 'dosage') {
    // Diploid dosage on [0, 2] scale: 0 = HOMO_REF, 1 = HET, 2 = HOMO_ALT.
    // Use a divergent ramp so 1 (het) sits at the visual midpoint and
    // 0 / 2 stand out at opposite ends. Cool teal → grey → warm red.
    const t = Math.max(0, Math.min(1, value / 2));   // 0..1
    return _divergentTealRedThroughGrey(t);
  }

  return null;
}

// Sequential ramps. Kept inline (no dependency on a chroma library);
// linear interpolation between two stops. Both ramps stay readable on
// the dark plot background.

function _sequentialGreyToRed(t) {
  // t=0 → grey #8c96aa; t=1 → red-orange #d94f4f.
  const r = Math.round(140 + (217 - 140) * t);
  const g = Math.round(150 + ( 79 - 150) * t);
  const b = Math.round(170 + ( 79 - 170) * t);
  return `rgb(${r},${g},${b})`;
}

function _sequentialBlueToYellow(t) {
  // t=0 → cool blue #2b6ca8; t=1 → warm yellow #f0c14b. Mid: greenish.
  const r = Math.round( 43 + (240 -  43) * t);
  const g = Math.round(108 + (193 - 108) * t);
  const b = Math.round(168 + ( 75 - 168) * t);
  return `rgb(${r},${g},${b})`;
}

function _divergentTealRedThroughGrey(t) {
  // t=0 → teal #2c8fa1, t=0.5 → grey #9aa1a8, t=1 → red #d94f4f.
  // Two linear segments meeting at the grey midpoint.
  if (t <= 0.5) {
    const u = t * 2;
    const r = Math.round( 44 + (154 -  44) * u);
    const g = Math.round(143 + (161 - 143) * u);
    const b = Math.round(161 + (168 - 161) * u);
    return `rgb(${r},${g},${b})`;
  }
  const u = (t - 0.5) * 2;
  const r = Math.round(154 + (217 - 154) * u);
  const g = Math.round(161 + ( 79 - 161) * u);
  const b = Math.round(168 + ( 79 - 168) * u);
  return `rgb(${r},${g},${b})`;
}
