// pages/discovery/page_dosage_heatmap/renderer.js
// =====================================================================
// Canvas painter for the sample × marker dosage heatmap. Same visual
// aesthetic as the legacy `drawDosageHeatmap`:
//   - left side annotation tracks (K=3 group, optional K=6 cluster)
//   - top polarity stripe
//   - main matrix coloured by sequential cream → deep-red ramp
//   - hover crosshair + per-cell hit-testing
//
// Input is a CANONICAL shape; both the new mgl_heatmap_json output
// and the legacy chunk shape are adapted into this via
// `./adapters.js`. Painting one of them is identical to painting
// the other.
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

// =====================================================================
// 1. Colour helpers
// =====================================================================

const DEFAULT_GROUP_PALETTE = [
  '#3074C8', '#2BAA50', '#D04545',
  '#A060B8', '#D8A030', '#3DB5C0',
  '#C06080', '#60A030', '#705090', '#888888',
];

/**
 * Sequential cream → orange → deep red ramp (matches the similarity
 * panel "Reds" ramp). Used for dosage cells.
 *
 * @param {number} v       dosage scalar (default range [0, 2])
 * @param {number} [vmin]  default 0
 * @param {number} [vmax]  default 2
 * @returns {string}       'rgb(r,g,b)'
 */
export function dosageValueToColor(v, vmin, vmax) {
  if (!Number.isFinite(v)) return 'rgb(200,200,200)';
  const lo = Number.isFinite(vmin) ? vmin : 0;
  const hi = Number.isFinite(vmax) ? vmax : 2;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
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
 * Build a stable group-id → CSS colour map. Accepts numeric or
 * string ids; strings are hashed to a slot.
 *
 * @param {Array<*>} group_ids   distinct ids in legend order
 * @param {Object<*,string>} [overrides]
 * @returns {Map<*, string>}
 */
export function buildGroupColorMap(group_ids, overrides) {
  const out = new Map();
  const seen = new Set();
  const ids = Array.isArray(group_ids) ? group_ids : [];
  let slot = 0;
  for (const id of ids) {
    if (id == null) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.set(id, DEFAULT_GROUP_PALETTE[slot % DEFAULT_GROUP_PALETTE.length]);
    slot++;
  }
  if (overrides) {
    for (const k of Object.keys(overrides)) out.set(_coerceKey(k, ids), overrides[k]);
  }
  return out;
}

function _coerceKey(k, refIds) {
  // Try to match the key type of the existing ids (number vs string).
  if (refIds && refIds.length > 0 && typeof refIds[0] === 'number') {
    const n = Number(k);
    if (Number.isFinite(n)) return n;
  }
  return k;
}

// =====================================================================
// 2. Ordering helpers
// =====================================================================

/**
 * Build an Int32Array sample permutation according to mode.
 *
 *   'natural'  → identity
 *   'by_group' → group bucket then index
 *   'by_k6'    → k6 bucket then index
 *
 * @param {string} mode
 * @param {number} n_samples
 * @param {Object} [src]   { sample_group:Array<*>, sample_k6:Int32Array }
 * @returns {Int32Array}
 */
export function deriveSampleOrder(mode, n_samples, src) {
  const out = new Int32Array(n_samples);
  for (let i = 0; i < n_samples; i++) out[i] = i;
  if (mode === 'by_group' && src && src.sample_group
      && src.sample_group.length === n_samples) {
    const g = src.sample_group;
    const arr = Array.from(out);
    arr.sort((a, b) => _cmpAny(g[a], g[b]) || (a - b));
    for (let i = 0; i < n_samples; i++) out[i] = arr[i];
  } else if (mode === 'by_k6' && src && src.sample_k6
             && src.sample_k6.length === n_samples) {
    const k = src.sample_k6;
    const arr = Array.from(out);
    arr.sort((a, b) => (k[a] - k[b]) || (a - b));
    for (let i = 0; i < n_samples; i++) out[i] = arr[i];
  }
  return out;
}

function _cmpAny(a, b) {
  if (a === b) return 0;
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

/**
 * Build a marker permutation.
 *
 *   'natural'      → identity
 *   'by_polarity'  → unflipped first, flipped second
 *
 * @param {string} mode
 * @param {number} n_markers
 * @param {Object} [src]   { marker_polarity:Array<boolean> }
 * @returns {Int32Array}
 */
export function deriveMarkerOrder(mode, n_markers, src) {
  const out = new Int32Array(n_markers);
  for (let i = 0; i < n_markers; i++) out[i] = i;
  if (mode === 'by_polarity' && src && src.marker_polarity
      && src.marker_polarity.length === n_markers) {
    const p = src.marker_polarity;
    const arr = Array.from(out);
    arr.sort((a, b) => (Number(p[a] || 0) - Number(p[b] || 0)) || (a - b));
    for (let i = 0; i < n_markers; i++) out[i] = arr[i];
  }
  return out;
}

// =====================================================================
// 3. Painter
// =====================================================================

/**
 * Paint the dosage heatmap. Input is the canonical shape:
 *
 *   data = {
 *     n_samples, n_markers,
 *     cellValue:        (m_canonical:number, s_canonical:number) => number|null,
 *     sample_group?:    Array<*>,             // per canonical sample idx
 *     sample_k6?:       Int32Array,           // per canonical sample idx
 *     marker_polarity?: Array<boolean>,       // per canonical marker idx
 *     sample_labels?:   Array<string>,
 *     marker_labels?:   Array<string>,
 *   }
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} data
 * @param {Object} [opts]
 *   sample_order?:       Int32Array
 *   marker_order?:       Int32Array
 *   show_group_track?:   boolean   default true
 *   show_k6_track?:      boolean   default false
 *   show_polarity_track?:boolean   default true
 *   group_colors?:       Map<*,string>
 *   k6_colors?:          Map<*,string>
 *   hovered_cell?:       {row:number, col:number} | null  (display coords)
 *   selected_samples?:   Set<number>  (canonical sample ids)
 *   selected_markers?:   Set<number>  (canonical marker ids)
 *   vmin?:               number
 *   vmax?:               number
 * @returns {{
 *   layout: {
 *     matX:number, matY:number, matW:number, matH:number,
 *     cellW:number, cellH:number,
 *     n_displayed_samples:number, n_displayed_markers:number,
 *     sample_order:Int32Array, marker_order:Int32Array,
 *   },
 * }}
 */
export function paintDosageHeatmap(canvas, data, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') return { layout: null };
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 600;
  const H = canvas.height || 400;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!data || typeof data.cellValue !== 'function'
      || !(data.n_samples > 0) || !(data.n_markers > 0)) {
    return { layout: null };
  }

  const nS = data.n_samples;
  const nM = data.n_markers;
  const order_s = (o.sample_order instanceof Int32Array && o.sample_order.length === nS)
    ? o.sample_order
    : deriveSampleOrder('natural', nS, data);
  const order_m = (o.marker_order instanceof Int32Array && o.marker_order.length === nM)
    ? o.marker_order
    : deriveMarkerOrder('natural', nM, data);

  // Track widths / heights.
  const xPad = 8;
  const yPad = 8;
  const trackPx = 8;
  const trackGap = 1;
  const showGroup     = (o.show_group_track !== false)    && !!data.sample_group;
  const showK6        = (o.show_k6_track === true)        && !!data.sample_k6;
  const showPolarity  = (o.show_polarity_track !== false) && !!data.marker_polarity;
  const leftBands = (showGroup ? trackPx + trackGap : 0)
                 + (showK6    ? trackPx + trackGap : 0);
  const topBand   = (showPolarity ? trackPx + trackGap : 0);
  const drawW = Math.max(50, W - 2 * xPad - leftBands);
  const drawH = Math.max(50, H - 2 * yPad - topBand);
  const cellW = drawW / nM;
  const cellH = drawH / nS;
  const matX = xPad + leftBands;
  const matY = yPad + topBand;

  const vmin = Number.isFinite(o.vmin) ? o.vmin : 0;
  const vmax = Number.isFinite(o.vmax) ? o.vmax : 2;
  const groupColors = (o.group_colors instanceof Map) ? o.group_colors
    : buildGroupColorMap(_distinctOf(data.sample_group));
  const k6Colors    = (o.k6_colors instanceof Map) ? o.k6_colors
    : buildGroupColorMap(_distinctOf(data.sample_k6));
  const selectedSamples = (o.selected_samples instanceof Set) ? o.selected_samples : null;
  const selectedMarkers = (o.selected_markers instanceof Set) ? o.selected_markers : null;

  // --- Matrix cells.
  for (let r = 0; r < nS; r++) {
    const si = order_s[r];
    const y  = matY + r * cellH;
    for (let c = 0; c < nM; c++) {
      const mi = order_m[c];
      const v  = data.cellValue(mi, si);
      ctx.fillStyle = dosageValueToColor(v, vmin, vmax);
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(matX + c * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  // --- Left tracks: group + optional k6.
  let leftX = xPad;
  if (showGroup) {
    for (let r = 0; r < nS; r++) {
      const si = order_s[r];
      const g  = data.sample_group[si];
      ctx.fillStyle = groupColors.get(g) || '#bbbbbb';
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
      }
    }
    leftX += trackPx + trackGap;
  }
  if (showK6) {
    for (let r = 0; r < nS; r++) {
      const si = order_s[r];
      const k  = data.sample_k6[si];
      ctx.fillStyle = k6Colors.get(k) || '#bbbbbb';
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
      }
    }
    leftX += trackPx + trackGap;
  }

  // --- Top polarity stripe (one cell per displayed marker; black =
  // flipped, light grey = unflipped).
  if (showPolarity) {
    for (let c = 0; c < nM; c++) {
      const mi = order_m[c];
      const f  = !!data.marker_polarity[mi];
      ctx.fillStyle = f ? 'rgba(20,20,20,0.85)' : 'rgba(220,220,220,0.85)';
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(matX + c * cellW, yPad, cellW + 0.5, trackPx);
      }
    }
  }

  // --- Matrix outline.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(matX, matY, cellW * nM, cellH * nS);
  }

  // --- Hover crosshair.
  const hov = o.hovered_cell;
  if (hov && Number.isFinite(hov.row) && Number.isFinite(hov.col)) {
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 2;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(matX, matY + hov.row * cellH - 0.5,
                     cellW * nM, cellH + 1);
      ctx.strokeRect(matX + hov.col * cellW - 0.5, matY,
                     cellW + 1, cellH * nS);
    }
    ctx.lineWidth = 1;
  }

  // --- Selected sample row / marker column underlays.
  if (selectedSamples && selectedSamples.size > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    for (let r = 0; r < nS; r++) {
      if (selectedSamples.has(order_s[r])) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(matX, matY + r * cellH - 0.5,
                         cellW * nM, cellH + 1);
        }
      }
    }
  }
  if (selectedMarkers && selectedMarkers.size > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    for (let c = 0; c < nM; c++) {
      if (selectedMarkers.has(order_m[c])) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(matX + c * cellW - 0.5, matY,
                         cellW + 1, cellH * nS);
        }
      }
    }
  }

  return {
    layout: {
      matX, matY, matW: cellW * nM, matH: cellH * nS,
      cellW, cellH,
      n_displayed_samples: nS,
      n_displayed_markers: nM,
      sample_order: order_s,
      marker_order: order_m,
    },
  };
}

function _distinctOf(arr) {
  if (!arr) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// =====================================================================
// 4. Hit-testing
// =====================================================================

/**
 * Hit-test a canvas-relative pixel against the painter's layout.
 * Returns canonical (marker_idx, sample_idx) along with display
 * (row, col) and the raw dosage value.
 *
 * @param {Object} layout    output of paintDosageHeatmap
 * @param {Function} cellValue
 * @param {number} px
 * @param {number} py
 * @returns {{marker_idx:number, sample_idx:number, row:number, col:number,
 *            dosage:number|null}|null}
 */
export function findCellAtPixel(layout, cellValue, px, py) {
  if (!layout) return null;
  const { matX, matY, matW, matH, cellW, cellH,
          n_displayed_samples, n_displayed_markers,
          sample_order, marker_order } = layout;
  if (cellW <= 0 || cellH <= 0) return null;
  if (px < matX || py < matY || px >= matX + matW || py >= matY + matH) return null;
  const col = Math.floor((px - matX) / cellW);
  const row = Math.floor((py - matY) / cellH);
  if (col < 0 || col >= n_displayed_markers || row < 0 || row >= n_displayed_samples) {
    return null;
  }
  const marker_idx = marker_order[col];
  const sample_idx = sample_order[row];
  const dosage = (typeof cellValue === 'function')
    ? cellValue(marker_idx, sample_idx) : null;
  return { marker_idx, sample_idx, row, col, dosage };
}
