// pages/discovery/dosage_cluster_adaptive_k/renderer.js
// =====================================================================
// Canvas painter for the per-cluster mean dosage curves. Consumes
// shared/mgl_dosage_clustering.adaptiveKDosageClustering output:
//
//   {
//     verdict: 'structure_detected' | 'no_structure' | 'insufficient_data',
//     K_chosen, per_K: [...],
//     chosen_labels, chosen_curves: Array<Float64Array>   // length K, each
//                                                          // length = n_dim
//   }
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

const DEFAULT_CLUSTER_PALETTE = [
  '#3074C8', '#2BAA50', '#D04545',
  '#A060B8', '#D8A030', '#3DB5C0',
  '#C06080', '#60A030', '#705090',
];

const VERDICT_LABEL = Object.freeze({
  structure_detected: 'Structure detected',
  no_structure:       'No structure',
  insufficient_data:  'Insufficient data',
});

// =====================================================================
// 1. Verdict + colour helpers
// =====================================================================

export function verdictColor(verdict) {
  switch (verdict) {
    case 'structure_detected': return '#2BAA50';
    case 'no_structure':       return '#888888';
    case 'insufficient_data':  return '#cf6e2a';
    default:                   return '#888888';
  }
}

export function verdictLabel(verdict) {
  return VERDICT_LABEL[verdict] || (verdict || '—');
}

export function clusterColor(k) {
  return DEFAULT_CLUSTER_PALETTE[((k | 0) % DEFAULT_CLUSTER_PALETTE.length + DEFAULT_CLUSTER_PALETTE.length) % DEFAULT_CLUSTER_PALETTE.length];
}

// =====================================================================
// 2. Axis range helper
// =====================================================================

/**
 * Compute (min, max) over a list of curves (Float64Array | number[]).
 *
 * @param {Array<Float64Array|number[]|null>} curves
 * @returns {{min:number, max:number}}
 */
export function curvesRange(curves) {
  if (!Array.isArray(curves) || curves.length === 0) return { min: 0, max: 1 };
  let lo = Infinity, hi = -Infinity;
  for (const c of curves) {
    if (!c) continue;
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = 0.05 * (hi - lo);
  return { min: lo - pad, max: hi + pad };
}

// =====================================================================
// 3. Painter
// =====================================================================

/**
 * Paint the per-cluster mean dosage curves.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Float64Array|number[]>} curves   chosen_curves
 * @param {Object} [opts]
 *   hovered_cluster?: number|null
 *   highlighted_window?: number|null     vertical guide
 *   cluster_colors?: Array<string>        per cluster
 *   font_size?: number
 * @returns {{
 *   curve_hit_regions: Array<{cluster_id:number, x:number, y:number,
 *                              w:number, h:number}>,
 *   plot: {x:number, y:number, w:number, h:number},
 *   x_range: {min:number, max:number},
 *   y_range: {min:number, max:number},
 * }}
 */
export function paintClusterCurves(canvas, curves, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { curve_hit_regions: [], plot: null, x_range: null, y_range: null };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 320;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!Array.isArray(curves) || curves.length === 0) {
    return { curve_hit_regions: [], plot: null, x_range: null, y_range: null };
  }

  const nDim = curves.reduce((m, c) => Math.max(m, (c && c.length) || 0), 0);
  if (nDim < 1) {
    return { curve_hit_regions: [], plot: null, x_range: null, y_range: null };
  }
  const leftPad = 36;
  const topPad = 12;
  const rightPad = 12;
  const bottomPad = 24;
  const plot = {
    x: leftPad,
    y: topPad,
    w: Math.max(50, W - leftPad - rightPad),
    h: Math.max(50, H - topPad - bottomPad),
  };
  const yRange = curvesRange(curves);
  const xRange = { min: 0, max: Math.max(1, nDim - 1) };
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  const colors = Array.isArray(o.cluster_colors) ? o.cluster_colors : null;
  ctx.font = fontSize + 'px sans-serif';

  // Plot frame.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  // Optional highlighted window guide.
  if (Number.isFinite(o.highlighted_window)
      && o.highlighted_window >= 0 && o.highlighted_window <= nDim - 1) {
    const t = (o.highlighted_window - xRange.min) / Math.max(1e-9, xRange.max - xRange.min);
    const gx = plot.x + t * plot.w;
    ctx.strokeStyle = 'rgba(245, 165, 36, 0.7)';
    ctx.lineWidth = 1;
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath(); ctx.moveTo(gx, plot.y); ctx.lineTo(gx, plot.y + plot.h);
      if (typeof ctx.stroke === 'function') ctx.stroke();
    }
  }

  // Axis labels.
  if (typeof ctx.fillText === 'function') {
    ctx.fillStyle = 'rgba(40, 50, 70, 0.85)';
    ctx.fillText(`window (n=${nDim})`,
                 plot.x + 4, plot.y + plot.h + fontSize + 4);
    ctx.fillText(`dosage  [${yRange.min.toFixed(2)} … ${yRange.max.toFixed(2)}]`,
                 4, plot.y + 2 + fontSize);
  }

  // Curves.
  const hits = [];
  for (let k = 0; k < curves.length; k++) {
    const c = curves[k];
    if (!c || c.length === 0) continue;
    const color = (colors && colors[k]) || clusterColor(k);
    const isHov = (o.hovered_cluster === k);
    ctx.strokeStyle = color;
    ctx.lineWidth = isHov ? 2.5 : 1.5;
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < c.length; i++) {
        const v = c[i];
        if (!Number.isFinite(v)) continue;
        const tx = (xRange.max > xRange.min) ? (i - xRange.min) / (xRange.max - xRange.min) : 0;
        const ty = (yRange.max > yRange.min) ? (v - yRange.min) / (yRange.max - yRange.min) : 0;
        const px = plot.x + tx * plot.w;
        const py = plot.y + plot.h - ty * plot.h;
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      }
      if (typeof ctx.stroke === 'function') ctx.stroke();
    }
    // Hit region — a band around the average y of the curve.
    let sum = 0, n = 0;
    for (let i = 0; i < c.length; i++) {
      if (Number.isFinite(c[i])) { sum += c[i]; n++; }
    }
    const avg = n > 0 ? sum / n : (yRange.min + yRange.max) / 2;
    const ty = (yRange.max > yRange.min) ? (avg - yRange.min) / (yRange.max - yRange.min) : 0;
    const yc = plot.y + plot.h - ty * plot.h;
    hits.push({
      cluster_id: k,
      x: plot.x,
      y: yc - 6,
      w: plot.w,
      h: 12,
    });
  }
  ctx.lineWidth = 1;

  return {
    curve_hit_regions: hits,
    plot,
    x_range: xRange,
    y_range: yRange,
  };
}

/**
 * Find the cluster curve closest to a canvas pixel (returns
 * cluster_id) — or null when outside any band.
 *
 * @param {Array<{cluster_id:number, x:number, y:number, w:number, h:number}>} hits
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findClusterAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  let best = null, bestDist = Infinity;
  for (const h of hits) {
    if (px < h.x || px > h.x + h.w) continue;
    const dy = Math.abs(py - (h.y + h.h / 2));
    if (dy < bestDist) {
      bestDist = dy;
      best = h.cluster_id;
    }
  }
  // Only "hit" when reasonably close.
  return bestDist <= 10 ? best : null;
}
