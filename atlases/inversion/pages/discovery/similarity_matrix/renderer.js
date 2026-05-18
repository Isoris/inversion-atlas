// pages/discovery/similarity_matrix/renderer.js
// =====================================================================
// Canvas-based renderer for the similarity-matrix panel. Consumes the
// output of shared/mgl_similarity_matrix.computeSimilarityAndBlocks:
//
//   {
//     windows: [{ idx, start_bp?, end_bp?, n_markers_in_window,
//                  similarity:Float64Array|null,
//                  K, assignment:Int32Array|null, silhouette_score }],
//     block_transition_ari: Float64Array (length n_windows − 1),
//   }
//
// Two canvases are painted:
//   1. transition canvas  — horizontal strip showing per-window
//      activation + the (n_windows−1) ARI cells between adjacent
//      windows
//   2. matrix canvas      — n_samples × n_samples heatmap of the
//      currently-active window's similarity matrix
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

// =====================================================================
// 1. Colours
// =====================================================================

const DEFAULT_BLOCK_PALETTE = [
  '#3074C8', '#2BAA50', '#D04545',
  '#A060B8', '#D8A030', '#3DB5C0',
  '#C06080', '#60A030', '#705090', '#888888',
];

/**
 * Map a similarity scalar to a CSS-friendly rgb(...) string.
 *
 *   mode 'reds'        — sequential cream → deep red ramp.
 *                        Used for IBS-style similarity matrices.
 *   mode 'diverging'   — blue → white → red bilinear ramp through
 *                        the midpoint (vmin + vmax)/2.
 *
 * @param {number} v       similarity scalar
 * @param {number} [vmin]  defaults to 0 (reds) / −1 (diverging)
 * @param {number} [vmax]  defaults to 1
 * @param {string} [mode]  'reds' (default) or 'diverging'
 * @returns {string}
 */
export function similarityValueToColor(v, vmin, vmax, mode) {
  if (!Number.isFinite(v)) return 'rgb(220,220,220)';
  const m = mode || 'reds';
  if (m === 'diverging') {
    const lo = Number.isFinite(vmin) ? vmin : -1;
    const hi = Number.isFinite(vmax) ? vmax :  1;
    const mid = (lo + hi) / 2;
    let r, g, b;
    if (v >= mid) {
      const t = Math.max(0, Math.min(1, (v - mid) / Math.max(1e-9, hi - mid)));
      r = 255;
      g = Math.round(255 - 195 * t);
      b = Math.round(255 - 195 * t);
    } else {
      const t = Math.max(0, Math.min(1, (mid - v) / Math.max(1e-9, mid - lo)));
      r = Math.round(255 - 215 * t);
      g = Math.round(255 - 155 * t);
      b = Math.round(255 - 55  * t);
    }
    return `rgb(${r},${g},${b})`;
  }
  // 'reds' sequential ramp: cream (low) → orange (mid) → deep red (high)
  const lo = Number.isFinite(vmin) ? vmin : 0;
  const hi = Number.isFinite(vmax) ? vmax : 1;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
  // Stops sampled from the matplotlib "Reds" palette.
  //   t=0   → rgb(255,245,235) (cream)
  //   t=0.5 → rgb(252,141, 89) (orange)
  //   t=1   → rgb(165, 15, 21) (deep red)
  let r, g, b;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(255 + (252 - 255) * s);
    g = Math.round(245 + (141 - 245) * s);
    b = Math.round(235 + ( 89 - 235) * s);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(252 + (165 - 252) * s);
    g = Math.round(141 + ( 15 - 141) * s);
    b = Math.round( 89 + ( 21 -  89) * s);
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * Map an ARI ∈ [-1, 1] (typically 0..1) to a green→yellow→red ramp.
 * NaN cells get grey.
 *
 * @param {number} v
 * @returns {string}
 */
export function ariValueToColor(v) {
  if (!Number.isFinite(v)) return 'rgb(220,220,220)';
  const t = Math.max(0, Math.min(1, v));
  // t=1 → green, t=0 → red, t=0.5 → yellow
  const r = Math.round(255 * (1 - t) + 220 * t);
  const g = Math.round(80  * (1 - t) + 200 * t);
  const b = 80;
  return `rgb(${r},${g},${b})`;
}

/**
 * Build a block-id → CSS colour map.
 *
 * @param {number} K
 * @param {Object<number,string>} [overrides]
 * @returns {Object<number,string>}
 */
export function buildBlockColorMap(K, overrides) {
  const out = Object.create(null);
  const n = Math.max(0, K | 0);
  for (let k = 0; k < Math.max(1, n); k++) {
    out[k] = DEFAULT_BLOCK_PALETTE[k % DEFAULT_BLOCK_PALETTE.length];
  }
  if (overrides) for (const k of Object.keys(overrides)) out[k] = overrides[k];
  return out;
}

// =====================================================================
// 2. Sample ordering
// =====================================================================

/**
 * Derive a sample-order permutation for the matrix.
 *
 *   'natural' → identity (0..n-1)
 *   'by_block' → samples sorted by block_id then natural-index
 *
 * @param {string} mode
 * @param {Int32Array|null} assignment   per-sample block ID, or null
 * @param {number} n_samples
 * @returns {Int32Array}                 length n_samples
 */
export function deriveSampleOrder(mode, assignment, n_samples) {
  const out = new Int32Array(n_samples);
  for (let i = 0; i < n_samples; i++) out[i] = i;
  if (mode === 'by_block' && assignment && assignment.length === n_samples) {
    const idx = Array.from(out);
    idx.sort((a, b) => {
      const ka = assignment[a], kb = assignment[b];
      if (ka !== kb) return ka - kb;
      return a - b;
    });
    for (let i = 0; i < n_samples; i++) out[i] = idx[i];
  }
  return out;
}

// =====================================================================
// 3. Transition strip painter
// =====================================================================

/**
 * Paint the per-window activation strip + the n-1 ARI cells between
 * adjacent windows.
 *
 *   Row 1: one cell per window. Active window = bold outline.
 *   Row 2: one cell per inter-window gap. Colour = ARI value.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<Object>} windows           similarity.windows
 * @param {Float64Array} ari                block_transition_ari (length n-1)
 * @param {Object} [opts]
 *   active_window_idx?: number
 *   hovered_window_idx?: number
 *   font_size?: number
 * @returns {{
 *   window_hit_regions: Array<{window_idx:number, x:number, y:number,
 *                              w:number, h:number, K:number}>,
 * }}
 */
export function paintTransitionTrack(canvas, windows, ari, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { window_hit_regions: [] };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 56;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);

  if (!Array.isArray(windows) || windows.length === 0) {
    return { window_hit_regions: [] };
  }

  const n = windows.length;
  const xPad = 8;
  const yPad = 4;
  const rowGap = 2;
  const drawW = Math.max(50, W - 2 * xPad);
  const cellW = drawW / n;
  // Row heights: window-activation 1/3, gap-ARI 2/3.
  const rowH = Math.max(8, (H - 2 * yPad - rowGap) / 2);
  const wRowY = yPad;
  const aRowY = yPad + rowH + rowGap;
  const active = Number.isFinite(o.active_window_idx) ? o.active_window_idx : -1;
  const hovered = Number.isFinite(o.hovered_window_idx) ? o.hovered_window_idx : -1;
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 9;
  ctx.font = fontSize + 'px sans-serif';

  // ----- Row 1: window activation cells
  const hits = [];
  for (let i = 0; i < n; i++) {
    const w = windows[i];
    const x = xPad + i * cellW;
    // Background — light grey if no similarity, by-K colour if present.
    let bg = 'rgb(230,230,230)';
    if (w.similarity) {
      const cmap = buildBlockColorMap(w.K || 1);
      bg = cmap[0];
      // Tinted by K (higher K → lighter)
      // No, keep first-block colour as a stable hint.
    }
    ctx.fillStyle = bg;
    if (typeof ctx.fillRect === 'function') ctx.fillRect(x, wRowY, cellW + 0.5, rowH);
    // Highlight + active.
    if (i === active || i === hovered) {
      ctx.strokeStyle = (i === active) ? '#000000' : '#f5a524';
      ctx.lineWidth = (i === active) ? 2 : 1;
      if (typeof ctx.strokeRect === 'function') ctx.strokeRect(x + 0.5, wRowY + 0.5, cellW - 0.5, rowH - 0.5);
      ctx.lineWidth = 1;
    }
    hits.push({
      window_idx: i,
      x, y: wRowY, w: cellW, h: rowH,
      K: w.K || 1,
    });
  }
  // Outline the window row.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(xPad, wRowY, drawW, rowH);

  // ----- Row 2: ARI gap cells (centred between adjacent windows)
  if (ari && ari.length > 0) {
    for (let i = 0; i < ari.length; i++) {
      const x = xPad + (i + 0.5) * cellW;
      ctx.fillStyle = ariValueToColor(ari[i]);
      if (typeof ctx.fillRect === 'function') ctx.fillRect(x, aRowY, cellW + 0.5, rowH);
    }
    ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
    ctx.lineWidth = 1;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(xPad + cellW / 2, aRowY,
                     Math.max(0, drawW - cellW), rowH);
    }
  }

  return { window_hit_regions: hits };
}

// =====================================================================
// 4. Similarity-matrix painter
// =====================================================================

/**
 * Paint a window's similarity matrix as a heatmap, optionally with
 * a block-overlay outline around per-block diagonal squares.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} window_record    one entry from similarity.windows
 * @param {Object} [opts]
 *   sample_order?:        Int32Array              permutation (length n_samples)
 *   sample_labels?:       Array<string>           length n_samples
 *   show_block_overlay?:  boolean                 default true
 *   show_diagonal?:       boolean                 default true
 *   hovered_cell?:        { i:number, j:number }  hovered sample pair
 *   selected_samples?:    Set<number>             highlight rows/cols
 *   vmin?:                number                  ramp lower bound
 *   vmax?:                number                  ramp upper bound
 *   font_size?:           number
 * @returns {{
 *   cell_size: number,
 *   x_origin: number,
 *   y_origin: number,
 *   n_samples: number,
 *   sample_order: Int32Array,
 * }}
 */
export function paintSimilarityMatrix(canvas, window_record, opts) {
  const o = opts || {};
  const out = {
    cell_size: 0, x_origin: 0, y_origin: 0,
    n_samples: 0, sample_order: new Int32Array(0),
  };
  if (!canvas || typeof canvas.getContext !== 'function') return out;
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 600;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!window_record || !window_record.similarity) return out;

  const S = window_record.similarity;
  const n = Math.round(Math.sqrt(S.length));
  if (n < 2) return out;

  const order = (o.sample_order instanceof Int32Array && o.sample_order.length === n)
    ? o.sample_order
    : deriveSampleOrder('natural', window_record.assignment || null, n);

  // Cluster bands sit just outside the matrix (top + left edges)
  // when a block assignment is available. Skipped if absent or all
  // samples land in the same block.
  const ass = window_record.assignment;
  const showBands = (o.show_cluster_bands !== false)
                 && ass && ass.length === n;
  const xPad = 8;
  const yPad = 8;
  // Reserve room for the cluster-bands (~6px) when shown; the bands
  // attach to the top + left so we shift the matrix origin right + down.
  const bandPx = showBands ? 7 : 0;
  const bandGap = showBands ? 2 : 0;
  const drawW = Math.max(50, W - 2 * xPad - bandPx - bandGap);
  const drawH = Math.max(50, H - 2 * yPad - bandPx - bandGap);
  const cell = Math.max(1, Math.min(drawW, drawH) / n);
  const totalSide = cell * n;
  const x0 = xPad + bandPx + bandGap;
  const y0 = yPad + bandPx + bandGap;
  const ramp = o.ramp_mode || 'reds';
  const defaultVmin = (ramp === 'diverging') ? -1 : 0;
  const vmin = Number.isFinite(o.vmin) ? o.vmin : defaultVmin;
  const vmax = Number.isFinite(o.vmax) ? o.vmax :  1;
  const showDiag = (o.show_diagonal !== false);
  const selected = (o.selected_samples instanceof Set) ? o.selected_samples : null;
  const blockColors = (o.block_colors_by_id && typeof o.block_colors_by_id === 'object')
    ? o.block_colors_by_id
    : null;
  const cmap = blockColors || buildBlockColorMap(window_record.K || 1);

  // Cells.
  for (let r = 0; r < n; r++) {
    const si = order[r];
    for (let c = 0; c < n; c++) {
      const sj = order[c];
      if (!showDiag && si === sj) {
        ctx.fillStyle = 'rgb(245,245,245)';
      } else {
        const v = S[si * n + sj];
        ctx.fillStyle = similarityValueToColor(v, vmin, vmax, ramp);
      }
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(x0 + c * cell, y0 + r * cell, cell + 0.5, cell + 0.5);
      }
    }
  }

  // Cluster bands: one cell per visual row/column, painted in the
  // gutter between the matrix and the canvas border. Makes the
  // outside boundary of each cluster pop without overloading the
  // matrix itself.
  if (showBands) {
    for (let r = 0; r < n; r++) {
      const s = order[r];
      const k = ass[s] | 0;
      ctx.fillStyle = cmap[k] || '#888888';
      // Top band (column)
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(x0 + r * cell, yPad, cell + 0.5, bandPx);
        // Left band (row)
        ctx.fillRect(xPad, y0 + r * cell, bandPx, cell + 0.5);
      }
    }
  }

  // Block overlay outlines (when ordered by_block and assignment given).
  if (o.show_block_overlay !== false
      && window_record.assignment
      && window_record.assignment.length === n) {
    const ass = window_record.assignment;
    // Walk the ordered list; emit a square outline for each block run.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 1.5;
    let runStart = 0;
    let runK = ass[order[0]];
    for (let r = 1; r <= n; r++) {
      const here = (r < n) ? ass[order[r]] : -1;
      if (here !== runK) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(
            x0 + runStart * cell,
            y0 + runStart * cell,
            (r - runStart) * cell,
            (r - runStart) * cell,
          );
        }
        runStart = r; runK = here;
      }
    }
    ctx.lineWidth = 1;
  }

  // Hovered cell crosshair.
  if (o.hovered_cell && Number.isFinite(o.hovered_cell.i)
      && Number.isFinite(o.hovered_cell.j)) {
    const hi = o.hovered_cell.i, hj = o.hovered_cell.j;
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 2;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(x0 + hj * cell - 0.5, y0,                  cell + 1, totalSide);
      ctx.strokeRect(x0,                   y0 + hi * cell - 0.5, totalSide, cell + 1);
    }
    ctx.lineWidth = 1;
  }

  // Selected-sample row/col underlays (subtle).
  if (selected && selected.size > 0) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    for (let r = 0; r < n; r++) {
      if (selected.has(order[r])) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(x0, y0 + r * cell - 0.5, totalSide, cell + 1);
          ctx.strokeRect(x0 + r * cell - 0.5, y0, cell + 1, totalSide);
        }
      }
    }
  }

  // Matrix outline.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.7)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') ctx.strokeRect(x0, y0, totalSide, totalSide);

  out.cell_size    = cell;
  out.x_origin     = x0;
  out.y_origin     = y0;
  out.n_samples    = n;
  out.sample_order = order;
  return out;
}

// =====================================================================
// 5. Hit testing
// =====================================================================

/**
 * Find the window cell on the transition strip under a pixel.
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
 * Find the (sample-i, sample-j) cell of the heatmap under a pixel.
 * Returns canonical sample IDs (not visual order indices).
 *
 * @param {{x_origin:number, y_origin:number, cell_size:number,
 *           n_samples:number, sample_order:Int32Array}} matrixGeom
 *           result of paintSimilarityMatrix
 * @param {number} px
 * @param {number} py
 * @returns {{i:number, j:number}|null}
 */
export function findCellAtPixel(matrixGeom, px, py) {
  if (!matrixGeom || matrixGeom.cell_size <= 0) return null;
  const { x_origin, y_origin, cell_size, n_samples, sample_order } = matrixGeom;
  const c = Math.floor((px - x_origin) / cell_size);
  const r = Math.floor((py - y_origin) / cell_size);
  if (c < 0 || c >= n_samples || r < 0 || r >= n_samples) return null;
  return { i: sample_order[r], j: sample_order[c] };
}
