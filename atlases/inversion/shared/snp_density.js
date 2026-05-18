// shared/snp_density.js
//
// Per-window SNP-density resolver + viridis-style color ramp + canvas
// strip drawer (legacy lines 33801 + 34456-34570). Drives the thin
// gradient strip drawn at the top of local_pca_dosage's PC1 panel when SNP-
// density mode is 'strip'.
//
// All compute is pure: caller passes the window object (or the
// windows array) explicitly so the helper is testable without
// state.data access.

/** Display-mode vocab: 'off' | 'strip' | 'shade'. */
export const LINES_SNP_DENSITY_MODES = Object.freeze(['off', 'strip', 'shade']);

// =====================================================================
// Per-window value resolver
// =====================================================================

/**
 * Resolve a SNP-density value for one window. Priority chain:
 *   1. window.n_snps      (precomp top-level)
 *   2. window.snp_count   (alternative naming)
 *   3. window.lambda1     (proxy)
 *   4. window.variance_pc1 (proxy)
 *   5. variance of window.pc1[] (computed proxy)
 *
 * Returns null when none of the above is available / valid.
 *
 * @param {Object} window
 * @returns {number|null}
 */
export function snpDensityForWindow(window) {
  if (!window || typeof window !== 'object') return null;
  if (Number.isFinite(window.n_snps))       return window.n_snps;
  if (Number.isFinite(window.snp_count))    return window.snp_count;
  if (Number.isFinite(window.lambda1))      return window.lambda1;
  if (Number.isFinite(window.variance_pc1)) return window.variance_pc1;
  const pc1 = window.pc1;
  if (Array.isArray(pc1) || ArrayBuffer.isView(pc1)) {
    if (!pc1.length || pc1.length < 2) return null;
    let sum = 0, sumSq = 0, n = 0;
    for (const v of pc1) {
      if (Number.isFinite(v)) { sum += v; sumSq += v * v; n++; }
    }
    if (n < 2) return null;
    const mean = sum / n;
    return (sumSq / n) - mean * mean;  // variance
  }
  return null;
}

/**
 * Return a label identifying which source snpDensityForWindow used.
 * Returns 'none' when no value is available.
 *
 * @param {Object} window
 * @returns {string}
 */
export function snpDensitySource(window) {
  if (!window || typeof window !== 'object') return 'none';
  if (Number.isFinite(window.n_snps))       return 'precomp:n_snps';
  if (Number.isFinite(window.snp_count))    return 'precomp:snp_count';
  if (Number.isFinite(window.lambda1))      return 'precomp:lambda1';
  if (Number.isFinite(window.variance_pc1)) return 'precomp:variance_pc1';
  if (Array.isArray(window.pc1) || ArrayBuffer.isView(window.pc1)) {
    return 'proxy:pc1_variance';
  }
  return 'none';
}

// =====================================================================
// Color ramp
// =====================================================================

/**
 * Viridis-style cool→warm color ramp. `t` is normalised in [0, 1];
 * out-of-range values are clamped. Returns an `rgb(r, g, b)` string.
 *
 * Stops:
 *   0.00 → blue
 *   0.25 → cyan
 *   0.50 → green
 *   0.75 → yellow
 *   1.00 → orange
 */
export function snpDensityColorRamp(t) {
  const tc = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  let r, g, b;
  if (tc < 0.25) {
    const u = tc / 0.25;
    r = Math.round(40 + u * 0);
    g = Math.round(60 + u * 100);
    b = Math.round(180 + u * 75);
  } else if (tc < 0.5) {
    const u = (tc - 0.25) / 0.25;
    r = 40;
    g = Math.round(160 + u * 60);
    b = Math.round(255 - u * 100);
  } else if (tc < 0.75) {
    const u = (tc - 0.5) / 0.25;
    r = Math.round(40 + u * 200);
    g = 220;
    b = Math.round(155 - u * 100);
  } else {
    const u = (tc - 0.75) / 0.25;
    r = Math.round(240 + u * 15);
    g = Math.round(220 - u * 60);
    b = Math.round(55 - u * 50);
  }
  return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

// =====================================================================
// Canvas strip drawer
// =====================================================================

/**
 * Paint the SNP-density strip at the top of the PC1 panel. One thin
 * vertical bar per visible window, colored by snpDensityColorRamp
 * over the visible-window value range.
 *
 * Skips when:
 *   - mode is 'off' or 'shade' (shade is a separate drawer)
 *   - < 5 visible windows
 *   - < 5 finite density values
 *   - vMin === vMax (no variation to map)
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH         (unused; kept for symmetry with sibling drawers)
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {Array<{center_mb?:number, n_snps?:number, lambda1?:number, pc1?:ArrayLike<number>}>} windows
 * @param {{mode?:string, stripHeight?:number}} opts
 */
export function drawSnpDensityStrip(ctx, pad, plotW, plotH, mbMin, mbMax, windows, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!Array.isArray(windows) || windows.length === 0) return;
  const o = opts || {};
  const mode = (typeof o.mode === 'string') ? o.mode : 'strip';
  if (mode !== 'strip') return;

  // Visible windows
  const visibleW = [];
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    if (!w) continue;
    const mb = w.center_mb;
    if (Number.isFinite(mb) && mb >= mbMin && mb <= mbMax) visibleW.push(wi);
  }
  if (visibleW.length < 5) return;

  const vals = visibleW.map(wi => snpDensityForWindow(windows[wi]))
                       .filter(v => v != null && Number.isFinite(v));
  if (vals.length < 5) return;
  let vMin = Infinity, vMax = -Infinity;
  for (const v of vals) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax) || vMin === vMax) return;

  const stripH = Number.isFinite(o.stripHeight) ? o.stripHeight : 4;
  const stripY = Math.max(0, pad.t - stripH - 1);
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  if (typeof ctx.save === 'function') ctx.save();

  for (const wi of visibleW) {
    const w = windows[wi];
    const v = snpDensityForWindow(w);
    if (v == null || !Number.isFinite(v)) continue;
    const t = (v - vMin) / (vMax - vMin);
    const mb = w.center_mb;
    if (!Number.isFinite(mb)) continue;
    const x = mbToX(mb);
    let bw = 2;
    if (wi > 0 && wi < windows.length - 1) {
      const wL = windows[wi - 1], wR = windows[wi + 1];
      if (wL && wR && Number.isFinite(wL.center_mb) && Number.isFinite(wR.center_mb)) {
        bw = ((mbToX(wR.center_mb) - mbToX(wL.center_mb)) / 2) + 1;
      }
    }
    ctx.fillStyle = snpDensityColorRamp(t);
    ctx.fillRect(x - bw / 2, stripY, bw, stripH);
  }

  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeStyle = 'rgba(120, 128, 140, 0.6)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(pad.l, stripY, plotW, stripH);
  }

  if (typeof ctx.restore === 'function') ctx.restore();
}

/**
 * Paint the SNP-density SHADE over the full plot height (mode='shade').
 * Alpha = (1 - t) × maxAlpha, so darker shade = lower density (worse
 * resolution). One translucent vertical bar per visible window;
 * near-transparent bars (< 0.01 alpha) are skipped.
 *
 * Companion to drawSnpDensityStrip — caller picks one based on
 * state.linesSnpDensityMode.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH        used as the bar height (full plot)
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {Array<Object>} windows
 * @param {{mode?:string, maxAlpha?:number}} opts
 */
export function drawSnpDensityShade(ctx, pad, plotW, plotH, mbMin, mbMax, windows, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!Array.isArray(windows) || windows.length === 0) return;
  const o = opts || {};
  const mode = (typeof o.mode === 'string') ? o.mode : 'shade';
  if (mode !== 'shade') return;
  const maxAlpha = Number.isFinite(o.maxAlpha) ? o.maxAlpha : 0.18;

  const visibleW = [];
  for (let wi = 0; wi < windows.length; wi++) {
    const w = windows[wi];
    if (!w) continue;
    const mb = w.center_mb;
    if (Number.isFinite(mb) && mb >= mbMin && mb <= mbMax) visibleW.push(wi);
  }
  if (visibleW.length < 5) return;

  const vals = visibleW.map(wi => snpDensityForWindow(windows[wi]))
                       .filter(v => v != null && Number.isFinite(v));
  if (vals.length < 5) return;
  let vMin = Infinity, vMax = -Infinity;
  for (const v of vals) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (!Number.isFinite(vMin) || !Number.isFinite(vMax) || vMin === vMax) return;

  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  if (typeof ctx.save === 'function') ctx.save();

  for (const wi of visibleW) {
    const w = windows[wi];
    const v = snpDensityForWindow(w);
    if (v == null || !Number.isFinite(v)) continue;
    const t = (v - vMin) / (vMax - vMin);
    const alpha = (1 - t) * maxAlpha;
    if (alpha < 0.01) continue;
    const mb = w.center_mb;
    if (!Number.isFinite(mb)) continue;
    const x = mbToX(mb);
    let bw = 2;
    if (wi > 0 && wi < windows.length - 1) {
      const wL = windows[wi - 1], wR = windows[wi + 1];
      if (wL && wR && Number.isFinite(wL.center_mb) && Number.isFinite(wR.center_mb)) {
        bw = ((mbToX(wR.center_mb) - mbToX(wL.center_mb)) / 2) + 1;
      }
    }
    ctx.fillStyle = 'rgba(40, 50, 70, ' + alpha.toFixed(3) + ')';
    ctx.fillRect(x - bw / 2, pad.t, bw, plotH);
  }

  if (typeof ctx.restore === 'function') ctx.restore();
}
