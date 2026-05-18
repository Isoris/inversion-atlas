// pages/discovery/pca_scatter_per_window/renderer.js
// =====================================================================
// Canvas-based renderer for the per-window PCA scatter panel.
// Consumes the output of shared/mgl_pca_compute.computePcaForWindowList:
//
//   pca_results: Array<{ lam1, lam2, pc1:Float64Array,
//                          pc2:Float64Array, ... } | null>
//
// Two canvases are painted:
//   1. scrubber canvas — horizontal strip with one cell per window,
//      coloured by lam1 + lam2 magnitude so dominant windows pop.
//   2. scatter canvas — the current window's PC1×PC2 cloud, points
//      coloured by an optional cluster assignment.
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

const DEFAULT_CLUSTER_PALETTE = [
  '#3074C8', '#2BAA50', '#D04545',
  '#A060B8', '#D8A030', '#3DB5C0',
  '#C06080', '#60A030', '#705090', '#888888',
];

// =====================================================================
// 1. Colour helpers
// =====================================================================

/**
 * Build a stable cluster-id → CSS colour map.
 *
 * @param {number} K
 * @param {Object<number,string>} [overrides]
 * @returns {Object<number,string>}
 */
export function buildClusterColorMap(K, overrides) {
  const out = Object.create(null);
  const n = Math.max(0, K | 0);
  for (let k = 0; k < Math.max(1, n); k++) {
    out[k] = DEFAULT_CLUSTER_PALETTE[k % DEFAULT_CLUSTER_PALETTE.length];
  }
  if (overrides) for (const k of Object.keys(overrides)) out[k] = overrides[k];
  return out;
}

/**
 * Map a magnitude scalar to a sequential cream→deep-red ramp. Used
 * to colour scrubber cells by how much variance the PCA captures.
 *
 * @param {number} t   value in [0, 1]
 * @returns {string}
 */
export function variancetoColor(t) {
  if (!Number.isFinite(t)) return 'rgb(220,220,220)';
  const s = Math.max(0, Math.min(1, t));
  // Same stops as the similarity panel "Reds" ramp.
  let r, g, b;
  if (s < 0.5) {
    const u = s * 2;
    r = Math.round(255 + (252 - 255) * u);
    g = Math.round(245 + (141 - 245) * u);
    b = Math.round(235 + ( 89 - 235) * u);
  } else {
    const u = (s - 0.5) * 2;
    r = Math.round(252 + (165 - 252) * u);
    g = Math.round(141 + ( 15 - 141) * u);
    b = Math.round( 89 + ( 21 -  89) * u);
  }
  return `rgb(${r},${g},${b})`;
}

// =====================================================================
// 2. Scrubber strip
// =====================================================================

/**
 * Paint the per-window scrubber strip. Each cell is coloured by
 * `lam1 + lam2` magnitude (normalised across the result list) so
 * windows with strongly differentiated samples pop.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Object|null>} pca_results
 * @param {Object} [opts]
 *   active_window_idx?: number
 *   hovered_window_idx?: number
 * @returns {{
 *   window_hit_regions: Array<{window_idx:number, x:number, y:number,
 *                              w:number, h:number, magnitude:number}>,
 * }}
 */
export function paintScrubberStrip(canvas, pca_results, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { window_hit_regions: [] };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 24;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!Array.isArray(pca_results) || pca_results.length === 0) {
    return { window_hit_regions: [] };
  }

  const n = pca_results.length;
  const xPad = 8;
  const yPad = 4;
  const drawW = Math.max(50, W - 2 * xPad);
  const drawH = Math.max(8, H - 2 * yPad);
  const cellW = drawW / n;
  const active = Number.isFinite(o.active_window_idx) ? o.active_window_idx : -1;
  const hovered = Number.isFinite(o.hovered_window_idx) ? o.hovered_window_idx : -1;

  // Normalise lam1+lam2 magnitudes across the list.
  let maxMag = 0;
  for (const r of pca_results) {
    if (!r) continue;
    const m = (Number.isFinite(r.lam1) ? r.lam1 : 0)
            + (Number.isFinite(r.lam2) ? r.lam2 : 0);
    if (m > maxMag) maxMag = m;
  }

  const hits = [];
  for (let i = 0; i < n; i++) {
    const r = pca_results[i];
    let m = 0;
    if (r) {
      m = (Number.isFinite(r.lam1) ? r.lam1 : 0)
        + (Number.isFinite(r.lam2) ? r.lam2 : 0);
    }
    const t = (maxMag > 0) ? m / maxMag : 0;
    const x = xPad + i * cellW;
    ctx.fillStyle = r ? variancetoColor(t) : 'rgb(230,230,230)';
    if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(x, yPad, cellW + 0.5, drawH);
    }
    if (i === active || i === hovered) {
      ctx.strokeStyle = (i === active) ? '#000000' : '#f5a524';
      ctx.lineWidth = (i === active) ? 2 : 1;
      if (typeof ctx.strokeRect === 'function') {
        ctx.strokeRect(x + 0.5, yPad + 0.5, cellW - 0.5, drawH - 0.5);
      }
      ctx.lineWidth = 1;
    }
    hits.push({
      window_idx: i, x, y: yPad, w: cellW, h: drawH, magnitude: m,
    });
  }
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(xPad, yPad, drawW, drawH);

  return { window_hit_regions: hits };
}

// =====================================================================
// 3. Scatter geometry helpers
// =====================================================================

/**
 * Compute a sensible axis range from a vector of values. Returns the
 * tight min..max padded by 5%; coincident extremes get bumped to
 * ±0.5 so we still get a usable axis.
 *
 * @param {Float64Array|number[]} vals
 * @returns {{min:number, max:number}}
 */
export function axisRange(vals) {
  if (!vals || vals.length === 0) return { min: -1, max: 1 };
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: -1, max: 1 };
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = 0.05 * (hi - lo);
  return { min: lo - pad, max: hi + pad };
}

/**
 * Map a (pc_x, pc_y) value pair to canvas (px, py) coordinates given
 * the plot area.
 */
function _mapPoint(x, y, xR, yR, plot) {
  const px = plot.x + ((x - xR.min) / (xR.max - xR.min)) * plot.w;
  // Invert y so larger values plot higher.
  const py = plot.y + plot.h - ((y - yR.min) / (yR.max - yR.min)) * plot.h;
  return { px, py };
}

// =====================================================================
// 4. Scatter painter
// =====================================================================

/**
 * Paint the PC1×PC2 scatter for one window.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} pca_result        one entry from pca_results
 * @param {Object} [opts]
 *   axis_choice?:       'pc1_pc2' (default) or 'pc2_pc1'
 *   cluster_assignment?:Int32Array per sample
 *   cluster_colors?:    Object<number,string>
 *   sample_labels?:     Array<string>
 *   selected_samples?:  Set<number>
 *   hovered_sample?:    number|null
 *   show_labels?:       boolean   default false
 *   point_radius?:      number
 *   font_size?:         number
 * @returns {{
 *   point_hit_regions: Array<{sample_idx:number, x:number, y:number, r:number}>,
 *   x_axis_label: string,
 *   y_axis_label: string,
 * }}
 */
export function paintScatter(canvas, pca_result, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { point_hit_regions: [], x_axis_label: '', y_axis_label: '' };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 600;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!pca_result || !pca_result.pc1 || !pca_result.pc2) {
    return { point_hit_regions: [], x_axis_label: '', y_axis_label: '' };
  }

  const axisChoice = (o.axis_choice === 'pc2_pc1') ? 'pc2_pc1' : 'pc1_pc2';
  const xVec = (axisChoice === 'pc1_pc2') ? pca_result.pc1 : pca_result.pc2;
  const yVec = (axisChoice === 'pc1_pc2') ? pca_result.pc2 : pca_result.pc1;
  const xLam = (axisChoice === 'pc1_pc2') ? pca_result.lam1 : pca_result.lam2;
  const yLam = (axisChoice === 'pc1_pc2') ? pca_result.lam2 : pca_result.lam1;
  const xLabel = (axisChoice === 'pc1_pc2') ? 'PC1' : 'PC2';
  const yLabel = (axisChoice === 'pc1_pc2') ? 'PC2' : 'PC1';
  const xR = axisRange(xVec);
  const yR = axisRange(yVec);

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
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  const pointR = Number.isFinite(o.point_radius) ? o.point_radius : 3;
  const cmap = o.cluster_colors
    || buildClusterColorMap((o.cluster_assignment ? _maxOf(o.cluster_assignment) + 1 : 1));
  const ass = o.cluster_assignment;
  const selected = (o.selected_samples instanceof Set) ? o.selected_samples : null;
  const hovered = Number.isFinite(o.hovered_sample) ? o.hovered_sample : null;
  ctx.font = fontSize + 'px sans-serif';

  // Plot frame.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  // Origin guide lines when 0 is inside the range.
  if (typeof ctx.beginPath === 'function') {
    ctx.strokeStyle = 'rgba(40, 50, 70, 0.18)';
    if (xR.min <= 0 && xR.max >= 0) {
      const { px } = _mapPoint(0, yR.min, xR, yR, plot);
      ctx.beginPath();
      ctx.moveTo(px, plot.y);
      ctx.lineTo(px, plot.y + plot.h);
      ctx.stroke();
    }
    if (yR.min <= 0 && yR.max >= 0) {
      const { py } = _mapPoint(xR.min, 0, xR, yR, plot);
      ctx.beginPath();
      ctx.moveTo(plot.x,           py);
      ctx.lineTo(plot.x + plot.w, py);
      ctx.stroke();
    }
  }

  // Axis labels.
  if (typeof ctx.fillText === 'function') {
    ctx.fillStyle = 'rgba(40, 50, 70, 0.85)';
    const xLamStr = Number.isFinite(xLam) ? xLam.toFixed(3) : '—';
    const yLamStr = Number.isFinite(yLam) ? yLam.toFixed(3) : '—';
    ctx.fillText(`${xLabel}  (λ=${xLamStr})`,
                 plot.x + 4, plot.y + plot.h + fontSize + 4);
    ctx.fillText(`${yLabel}  (λ=${yLamStr})`,
                 4, plot.y + 2 + fontSize);
  }

  // Points.
  const n = xVec.length;
  const hits = new Array(n);
  for (let i = 0; i < n; i++) {
    const xv = xVec[i], yv = yVec[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      hits[i] = { sample_idx: i, x: -1, y: -1, r: 0 };
      continue;
    }
    const { px, py } = _mapPoint(xv, yv, xR, yR, plot);
    const isSel = selected && selected.has(i);
    const isHov = hovered === i;
    const r = isHov ? pointR + 2 : (isSel ? pointR + 1 : pointR);
    let col = 'rgba(60, 80, 100, 0.85)';
    if (ass && ass.length === n) col = cmap[ass[i]] || col;
    ctx.fillStyle = col;
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (typeof ctx.fill === 'function') ctx.fill();
      if (isSel || isHov) {
        ctx.strokeStyle = isHov ? '#f5a524' : '#000000';
        ctx.lineWidth = 1.5;
        if (typeof ctx.stroke === 'function') ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    if (o.show_labels && o.sample_labels && o.sample_labels[i]
        && typeof ctx.fillText === 'function') {
      ctx.fillStyle = 'rgba(40, 50, 70, 0.85)';
      ctx.fillText(String(o.sample_labels[i]), px + r + 2, py + fontSize / 3);
    }
    hits[i] = { sample_idx: i, x: px, y: py, r: r + 2 };
  }
  // Drag-box overlay (when a box-select is in progress).
  if (o.drag_box
      && Number.isFinite(o.drag_box.x0) && Number.isFinite(o.drag_box.y0)
      && Number.isFinite(o.drag_box.x1) && Number.isFinite(o.drag_box.y1)) {
    const b = o.drag_box;
    const bx = Math.min(b.x0, b.x1);
    const by = Math.min(b.y0, b.y1);
    const bw = Math.abs(b.x1 - b.x0);
    const bh = Math.abs(b.y1 - b.y0);
    if (bw > 1 && bh > 1) {
      ctx.fillStyle = 'rgba(245, 165, 36, 0.10)';
      if (typeof ctx.fillRect === 'function') ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(245, 165, 36, 0.95)';
      ctx.lineWidth = 1;
      if (typeof ctx.strokeRect === 'function') ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
  }

  return {
    point_hit_regions: hits,
    x_axis_label: xLabel,
    y_axis_label: yLabel,
  };
}

/**
 * Return all sample indices whose point hit-region centre falls
 * inside the axis-aligned rectangle [x0..x1] × [y0..y1] (canvas px).
 *
 * @param {Array<{sample_idx:number, x:number, y:number, r:number}>} hits
 * @param {{x0:number, y0:number, x1:number, y1:number}} box
 * @returns {number[]}
 */
export function findPointsInBox(hits, box) {
  if (!Array.isArray(hits) || !box) return [];
  const lx = Math.min(box.x0, box.x1);
  const hx = Math.max(box.x0, box.x1);
  const ly = Math.min(box.y0, box.y1);
  const hy = Math.max(box.y0, box.y1);
  const out = [];
  for (const h of hits) {
    if (h.r <= 0) continue;
    if (h.x >= lx && h.x <= hx && h.y >= ly && h.y <= hy) out.push(h.sample_idx);
  }
  return out;
}

function _maxOf(arr) {
  if (!arr || arr.length === 0) return 0;
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

// =====================================================================
// 5. Hit testing
// =====================================================================

/**
 * Find the scrubber-strip window cell under a canvas pixel.
 *
 * @param {Array<{window_idx:number, x:number, y:number, w:number, h:number}>} hits
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findWindowAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    if (px >= h.x && px <= h.x + h.w
        && py >= h.y && py <= h.y + h.h) {
      return h.window_idx;
    }
  }
  return null;
}

/**
 * Find the scatter point under a canvas pixel.
 *
 * @param {Array<{sample_idx:number, x:number, y:number, r:number}>} hits
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findPointAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    if (h.r <= 0) continue;
    const dx = px - h.x, dy = py - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h.sample_idx;
  }
  return null;
}
