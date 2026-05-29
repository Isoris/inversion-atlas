// pages/discovery/dosage_heatmap/renderer.js
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

// Matplotlib `magma` palette control points. Used for the default
// continuous dosage ramp — matches the "Regional het (dosage)"
// reference figure (yellow → orange → magenta → purple → near-black).
const MAGMA_STOPS = Object.freeze([
  [0.00, [  0,   0,   4]],
  [0.13, [ 28,  16,  68]],
  [0.25, [ 80,  18, 123]],
  [0.38, [127,  39, 132]],
  [0.50, [183,  55, 121]],
  [0.63, [225,  83, 103]],
  [0.75, [251, 135,  97]],
  [0.88, [254, 198, 132]],
  [1.00, [252, 253, 191]],
]);

function _interpStops(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (t <= b[0]) {
      const u = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return [
        Math.round(a[1][0] + (b[1][0] - a[1][0]) * u),
        Math.round(a[1][1] + (b[1][1] - a[1][1]) * u),
        Math.round(a[1][2] + (b[1][2] - a[1][2]) * u),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Continuous magma ramp for dosage / regional-het cells. Default
 * colour mode.
 *
 * @param {number} v       dosage scalar (default range [0, 2])
 * @param {number} [vmin]  default 0
 * @param {number} [vmax]  default 2
 * @returns {string}       'rgb(r,g,b)'
 */
export function dosageMagmaColor(v, vmin, vmax) {
  if (!Number.isFinite(v)) return 'rgb(230,210,220)';   // missing → pale pink
  const lo = Number.isFinite(vmin) ? vmin : 0;
  const hi = Number.isFinite(vmax) ? vmax : 2;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
  const c = _interpStops(MAGMA_STOPS, t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Discrete-genotype palette: white (0/0) · blue (0/1) · red (1/1).
 * Used when `color_mode === 'genotype'` — matches the reference
 * paper's dosage-heatmap convention.
 *
 * @param {number} v       dosage scalar in [0, 2]
 * @returns {string}       'rgb(r,g,b)'
 */
export function dosageGenotypeColor(v) {
  if (!Number.isFinite(v)) return 'rgb(238,214,222)';   // missing → mauve
  if (v < 0.5)  return 'rgb(248,248,250)';              // 0/0 — near-white
  if (v < 1.5)  return 'rgb( 56,107,196)';              // 0/1 — blue
  return 'rgb(196, 40, 50)';                            // 1/1 — red
}

/**
 * Back-compat alias for the old name (returned a sequential ramp).
 * Now resolves to the magma palette (the new default).
 */
export function dosageValueToColor(v, vmin, vmax) {
  return dosageMagmaColor(v, vmin, vmax);
}

/**
 * Pick a per-cell colourer for the given `color_mode`.
 *
 * @param {'magma'|'genotype'} mode
 * @returns {(v:number, vmin:number, vmax:number)=>string}
 */
export function pickDosageColorFn(mode) {
  if (mode === 'genotype') return (v) => dosageGenotypeColor(v);
  return dosageMagmaColor;
}

// Viridis stops for the per-sample θπ track.
const VIRIDIS_STOPS = Object.freeze([
  [0.00, [ 68,   1,  84]],
  [0.25, [ 59,  82, 139]],
  [0.50, [ 33, 145, 140]],
  [0.75, [ 94, 201,  97]],
  [1.00, [253, 231,  37]],
]);

function _viridisColor(v, vmin, vmax) {
  if (!Number.isFinite(v)) return 'rgb(60,60,60)';
  const lo = Number.isFinite(vmin) ? vmin : 0;
  const hi = Number.isFinite(vmax) ? vmax : 1;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
  const c = _interpStops(VIRIDIS_STOPS, t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Blue → white → red diverging palette for GHSL mean (deficit ↔ excess).
const GHSL_STOPS = Object.freeze([
  [0.00, [ 38,  72, 158]],
  [0.50, [245, 245, 245]],
  [1.00, [178,  34,  52]],
]);

function _ghslDivergingColor(v, vmin, vmax) {
  if (!Number.isFinite(v)) return 'rgb(60,60,60)';
  const lo = Number.isFinite(vmin) ? vmin : -1;
  const hi = Number.isFinite(vmax) ? vmax :  1;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
  const c = _interpStops(GHSL_STOPS, t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Confidence ramp for the in-page grouping confidence track: low
// confidence = muted slate, high = bright teal-green. Sequential so a
// quick scan shows which samples sit near a tier boundary (dark).
const CONFIDENCE_STOPS = Object.freeze([
  [0.00, [ 70,  78,  92]],
  [0.35, [120, 110,  80]],
  [0.70, [ 90, 170, 130]],
  [1.00, [ 80, 230, 160]],
]);

export function confidenceColor(v, vmin, vmax) {
  if (!Number.isFinite(v)) return 'rgb(50,55,65)';
  const lo = Number.isFinite(vmin) ? vmin : 0;
  const hi = Number.isFinite(vmax) ? vmax : 1;
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-9, hi - lo)));
  const c = _interpStops(CONFIDENCE_STOPS, t);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function _autoMin(arr) {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v < m) m = v;
  }
  return Number.isFinite(m) ? m : 0;
}
function _autoMax(arr) {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return Number.isFinite(m) ? m : 1;
}

/**
 * Build a stable group-id → CSS colour map. Accepts numeric or
 * string ids; strings are hashed to a slot.
 *
 * @param {Array<*>} group_ids   distinct ids in legend order
 * @param {Object<*,string>} [overrides]
 * @returns {Map<*, string>}
 */
/**
 * Colour palette for the regime-call ribbon. Keys match the controlled
 * vocabulary exported from shared/mgl_regime_consistency.js
 * (SAMPLE_REGIME_CALLS).
 */
export const REGIME_CALL_COLORS = Object.freeze({
  homA_like: '#3074C8',   // blue   = STD-like
  het_like:  '#9344B5',   // purple = heterozygote-like
  homB_like: '#D04545',   // red    = INV-like
  uncertain: '#7a8290',   // grey   = uncertain
});

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
 *   show_role_pair_track?:boolean  default true (auto-hidden when
 *                                   no marker has a role_pair value)
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
  // order_s / order_m may be a SUBSET / viewport (length < nS / nM) — e.g.
  // a variance-selected marker set or a cursor-centred zoom window. The
  // displayed counts come from the order arrays, not the data totals.
  const order_s = (o.sample_order instanceof Int32Array && o.sample_order.length >= 1)
    ? o.sample_order
    : deriveSampleOrder('natural', nS, data);
  const order_m = (o.marker_order instanceof Int32Array && o.marker_order.length >= 1)
    ? o.marker_order
    : deriveMarkerOrder('natural', nM, data);
  const nDispS = order_s.length;
  const nDispM = order_m.length;

  // Layout constants.
  const xPad = 8;
  const yPad = 8;
  const trackPx = 8;
  const trackGap = 1;
  const tickPad = 32;        // left gutter for y-axis tick labels (s=N)
  const labelPad = 44;       // left gutter for group-run text labels

  // Track toggles. The four per-sample left tracks (group / ghsl mean
  // / theta-pi mean / het-dosage mean) each render only when the
  // backing data is present AND the caller hasn't opted out.
  const showGroup       = (o.show_group_track !== false)        && !!data.sample_group;
  const showK6          = (o.show_k6_track === true)            && !!data.sample_k6;
  // 2026-05-27: regime overlays read from data.regime_overlay (set by
  // the page adapter from the active candidate). Each is independently
  // toggleable; gracefully skip when the underlying data isn't there.
  const regimeOverlay   = data.regime_overlay || null;
  const showRegimeCall  = (o.show_regime_call_track === true)
                          && regimeOverlay && regimeOverlay.sample_regime_call;
  const showLocusSpan   = (o.show_locus_span_overlay === true)
                          && regimeOverlay
                          && Number.isFinite(regimeOverlay.locus_start_marker)
                          && Number.isFinite(regimeOverlay.locus_end_marker);
  // Multi-regime span overlay (every regime from the catalogue overlapping
  // the window), drawn as labelled vertical bands. data.regime_spans is set
  // by the page when the grouping source is the regime catalogue.
  const showRegimeSpans = (o.show_regime_spans !== false)
                          && Array.isArray(data.regime_spans) && data.regime_spans.length > 0;
  const showGhsl        = (o.show_ghsl_track === true)          && !!data.sample_ghsl_mean;
  const showThetaPi     = (o.show_theta_pi_track === true)      && !!data.sample_theta_pi_mean;
  const showHetDosage   = (o.show_het_dosage_track === true)    && !!data.sample_het_dosage_mean;
  const showConfidence  = (o.show_confidence_track === true)    && !!data.sample_confidence;
  const showPolarity    = (o.show_polarity_track !== false)     && !!data.marker_polarity;
  const showTicks       = (o.show_y_ticks !== false);
  const showGroupLabels = (o.show_group_labels !== false)       && !!data.sample_group;
  // 2026-05-16: per-marker role-pair sidecar track (SPEC_0 §1 —
  // MAJOR_MINOR1 / MAJOR_MINOR2 / MINOR1_MINOR2 / MAJOR_MINOR3 /
  // MINOR1_MINOR3 / MINOR2_MINOR3). Auto-hidden when no marker has
  // a role_pair value (legacy bi-only data; or when the user
  // explicitly opts out via show_role_pair_track: false).
  const hasAnyRolePair = !!data.marker_role_pair
    && Array.isArray(data.marker_role_pair)
    && data.marker_role_pair.some(p => p);
  const showRolePair = (o.show_role_pair_track !== false) && hasAnyRolePair;

  // Continuous per-sample tracks are drawn with a unique palette each
  // so they're visually distinct from the group categorical track and
  // from the main matrix.
  const trackBlocks = [];
  if (showConfidence) {
    trackBlocks.push({
      kind: 'continuous', label: 'conf',
      values: data.sample_confidence,
      colorFn: confidenceColor, vmin: 0, vmax: 1,
    });
  }
  if (showHetDosage) {
    trackBlocks.push({
      kind: 'continuous', label: 'het',
      values: data.sample_het_dosage_mean,
      colorFn: dosageMagmaColor, vmin: 0, vmax: 1,
    });
  }
  if (showThetaPi) {
    trackBlocks.push({
      kind: 'continuous', label: 'θπ',
      values: data.sample_theta_pi_mean,
      colorFn: _viridisColor, vmin: null, vmax: null,    // auto-range
    });
  }
  if (showGhsl) {
    trackBlocks.push({
      kind: 'continuous', label: 'GHSL',
      values: data.sample_ghsl_mean,
      colorFn: _ghslDivergingColor, vmin: -1, vmax: 1,
    });
  }
  if (showK6) {
    trackBlocks.push({ kind: 'categorical_k6', label: 'K6' });
  }
  if (showRegimeCall) {
    trackBlocks.push({ kind: 'regime_call', label: 'regime' });
  }
  if (showGroup) {
    trackBlocks.push({ kind: 'group', label: 'group' });
  }

  const leftBands = trackBlocks.length * (trackPx + trackGap);
  const topBand   = (showPolarity ? trackPx + trackGap : 0)
                  + (showRolePair ? trackPx + trackGap : 0);
  const leftGutter = (showTicks ? tickPad : 0)
                   + (showGroupLabels ? labelPad : 0);
  const drawW = Math.max(50, W - xPad - leftGutter - leftBands - xPad);
  const drawH = Math.max(50, H - 2 * yPad - topBand);
  const cellW = drawW / nDispM;
  const cellH = drawH / nDispS;
  const matX = xPad + leftGutter + leftBands;
  const matY = yPad + topBand;

  const vmin = Number.isFinite(o.vmin) ? o.vmin : 0;
  const vmax = Number.isFinite(o.vmax) ? o.vmax : 2;
  const colorFn = pickDosageColorFn(o.color_mode || 'magma');
  const groupColors = (o.group_colors instanceof Map) ? o.group_colors
    : buildGroupColorMap(_distinctOf(data.sample_group));
  const k6Colors    = (o.k6_colors instanceof Map) ? o.k6_colors
    : buildGroupColorMap(_distinctOf(data.sample_k6));
  const selectedSamples = (o.selected_samples instanceof Set) ? o.selected_samples : null;
  const selectedMarkers = (o.selected_markers instanceof Set) ? o.selected_markers : null;

  // --- Locus span overlay (drawn AFTER matrix so it sits on top).
  // Resolves marker indices to canvas-x positions through order_m so
  // it stays correct under any marker-order mode.
  let locusSpanPxRange = null;
  if (showLocusSpan) {
    const lo = regimeOverlay.locus_start_marker | 0;
    const hi = regimeOverlay.locus_end_marker | 0;
    let xLo = Infinity, xHi = -Infinity;
    for (let c = 0; c < nDispM; c++) {
      const mi = order_m[c];
      if (mi >= lo && mi <= hi) {
        const x = matX + c * cellW;
        if (x < xLo) xLo = x;
        if (x + cellW > xHi) xHi = x + cellW;
      }
    }
    if (Number.isFinite(xLo) && xHi > xLo) {
      locusSpanPxRange = { x0: xLo, x1: xHi };
    }
  }

  // --- Matrix cells.
  for (let r = 0; r < nDispS; r++) {
    const si = order_s[r];
    const y  = matY + r * cellH;
    for (let c = 0; c < nDispM; c++) {
      const mi = order_m[c];
      const v  = data.cellValue(mi, si);
      ctx.fillStyle = colorFn(v, vmin, vmax);
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(matX + c * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }
  }

  // --- Left annotation tracks. Order: continuous (het / θπ / GHSL)
  // outermost, then K6, then group adjacent to the matrix so the user
  // sees the group bar right next to the corresponding rows.
  let leftX = xPad + leftGutter;
  for (const blk of trackBlocks) {
    if (blk.kind === 'continuous') {
      const lo = (blk.vmin == null) ? _autoMin(blk.values) : blk.vmin;
      const hi = (blk.vmax == null) ? _autoMax(blk.values) : blk.vmax;
      for (let r = 0; r < nDispS; r++) {
        const si = order_s[r];
        const v  = blk.values[si];
        ctx.fillStyle = blk.colorFn(v, lo, hi);
        if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
        }
      }
    } else if (blk.kind === 'categorical_k6') {
      for (let r = 0; r < nDispS; r++) {
        const si = order_s[r];
        const k  = data.sample_k6[si];
        ctx.fillStyle = k6Colors.get(k) || '#bbbbbb';
        if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
        }
      }
    } else if (blk.kind === 'group') {
      for (let r = 0; r < nDispS; r++) {
        const si = order_s[r];
        const g  = data.sample_group[si];
        ctx.fillStyle = groupColors.get(g) || '#bbbbbb';
        if (typeof ctx.fillRect === 'function') {
          ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
        }
      }
    } else if (blk.kind === 'regime_call') {
      // Color per regime_call vocabulary. Uncalled / out-of-locus
      // samples render as transparent so the matrix shows through.
      const calls = regimeOverlay.sample_regime_call;
      for (let r = 0; r < nDispS; r++) {
        const si = order_s[r];
        const c  = calls[si];
        const fill = REGIME_CALL_COLORS[c] || 'rgba(0,0,0,0)';
        if (typeof ctx.fillRect === 'function') {
          ctx.fillStyle = fill;
          ctx.fillRect(leftX, matY + r * cellH, trackPx, cellH + 0.5);
        }
      }
    }
    leftX += trackPx + trackGap;
  }

  // --- Locus span overlay (semi-transparent fill + outline on top of
  // the matrix, only the marker range belonging to the active candidate).
  if (locusSpanPxRange) {
    const { x0, x1 } = locusSpanPxRange;
    const matBottom = matY + nDispS * cellH;
    if (typeof ctx.save === 'function') ctx.save();
    if (typeof ctx.fillRect === 'function') {
      ctx.fillStyle = 'rgba(245,165,36,0.10)';
      ctx.fillRect(x0, matY, x1 - x0, matBottom - matY);
    }
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeStyle = 'rgba(245,165,36,0.85)';
      ctx.lineWidth = 1.25;
      ctx.strokeRect(x0 + 0.5, matY + 0.5,
                     (x1 - x0) - 1, (matBottom - matY) - 1);
    }
    if (typeof ctx.restore === 'function') ctx.restore();
  }

  // --- Multi-regime span overlay (catalogue). One labelled band per
  // overlapping regime; canonical marker ranges resolved to x through
  // order_m so they track the marker-order mode + zoom viewport.
  if (showRegimeSpans) {
    const matBottom = matY + nDispS * cellH;
    if (typeof ctx.save === 'function') ctx.save();
    let si = 0;
    for (const span of data.regime_spans) {
      const lo = span.lo | 0, hi = span.hi | 0;
      let xLo = Infinity, xHi = -Infinity;
      for (let c = 0; c < nDispM; c++) {
        const mi = order_m[c];
        if (mi >= lo && mi <= hi) {
          const x = matX + c * cellW;
          if (x < xLo) xLo = x;
          if (x + cellW > xHi) xHi = x + cellW;
        }
      }
      if (!Number.isFinite(xLo) || xHi <= xLo) { si++; continue; }
      const hue = (si * 47) % 360;            // spread hues per regime
      ctx.fillStyle   = `hsla(${hue},70%,55%,0.08)`;
      ctx.strokeStyle = `hsla(${hue},70%,60%,0.85)`;
      ctx.lineWidth = 1.25;
      if (typeof ctx.fillRect === 'function') ctx.fillRect(xLo, matY, xHi - xLo, matBottom - matY);
      if (typeof ctx.strokeRect === 'function') ctx.strokeRect(xLo + 0.5, matY + 0.5, (xHi - xLo) - 1, (matBottom - matY) - 1);
      if (typeof ctx.fillText === 'function' && (xHi - xLo) >= 24) {
        ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = `hsla(${hue},75%,72%,0.98)`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lbl = String(span.label || 'regime')
          + (Number.isFinite(span.confidence) ? ' ' + span.confidence.toFixed(2) : '');
        ctx.fillText(lbl, xLo + 2, matY + 1);
      }
      si++;
    }
    if (typeof ctx.restore === 'function') ctx.restore();
  }

  // --- Y-axis ticks: sample-index marks every ~10% of rows.
  if (showTicks && typeof ctx.fillText === 'function') {
    if (typeof ctx.save === 'function') ctx.save();
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(160,180,200,0.85)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tickStride = Math.max(1, Math.round(nDispS / 10));
    for (let r = 0; r < nDispS; r += tickStride) {
      const y = matY + (r + 0.5) * cellH;
      ctx.fillText('s=' + r, xPad + tickPad - 4, y);
    }
    if ((nDispS - 1) % tickStride !== 0) {
      ctx.fillText('s=' + (nS - 1), xPad + tickPad - 4,
                   matY + (nDispS - 0.5) * cellH);
    }
    if (typeof ctx.restore === 'function') ctx.restore();
  }

  // --- Group-run labels next to the group track (one centered label
  // per contiguous run of the same group in the row order).
  if (showGroupLabels && typeof ctx.fillText === 'function') {
    const labelX = xPad + (showTicks ? tickPad : 0) + labelPad - 6;
    if (typeof ctx.save === 'function') ctx.save();
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220,230,245,0.95)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let runStart = 0;
    let runVal = data.sample_group[order_s[0]];
    for (let r = 1; r <= nDispS; r++) {
      const v = (r < nDispS) ? data.sample_group[order_s[r]] : Symbol('end');
      if (v !== runVal) {
        const yMid = matY + ((runStart + r) / 2) * cellH;
        const runH = (r - runStart) * cellH;
        if (runH >= 12) {
          ctx.fillText(String(runVal == null ? '—' : runVal), labelX, yMid);
        }
        runStart = r;
        runVal = v;
      }
    }
    if (typeof ctx.restore === 'function') ctx.restore();
  }

  // --- Top tracks (stacked above the matrix).
  // Stack order top-to-bottom: role-pair track (highest), then
  // polarity stripe, then the matrix. Each track is `trackPx` tall
  // with `trackGap` between adjacent tracks. The role-pair track
  // sits at yPad; polarity follows below; the matrix starts at matY.
  let topY = yPad;
  if (showRolePair) {
    // Discrete palette per role-pair. MAJOR_MINOR1 (the default
    // bi-allelic pair) gets a subdued grey so multi-allelic pairs
    // stand out. Order matches SPEC_0 §1 pair-emission order.
    const ROLE_PAIR_COLORS = {
      'MAJOR_MINOR1':  'rgba(180, 180, 180, 0.7)',    // grey (default / bi-allelic)
      'MAJOR_MINOR2':  'rgba( 80, 140, 220, 0.85)',   // soft blue
      'MINOR1_MINOR2': 'rgba(245, 165,  36, 0.85)',   // soft orange
      'MAJOR_MINOR3':  'rgba( 60, 180, 120, 0.85)',   // soft green
      'MINOR1_MINOR3': 'rgba(176, 124, 247, 0.85)',   // soft purple
      'MINOR2_MINOR3': 'rgba(224,  85,  92, 0.85)',   // soft red
    };
    for (let c = 0; c < nDispM; c++) {
      const mi   = order_m[c];
      const pair = data.marker_role_pair[mi];
      const col  = pair ? (ROLE_PAIR_COLORS[pair] || 'rgba(120,120,120,0.5)')
                        : 'rgba(40,40,40,0.25)';   // very faint grey = no role_pair info
      ctx.fillStyle = col;
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(matX + c * cellW, topY, cellW + 0.5, trackPx);
      }
    }
    topY += trackPx + trackGap;
  }

  // --- Top polarity stripe (one cell per displayed marker; black =
  // flipped, light grey = unflipped).
  if (showPolarity) {
    for (let c = 0; c < nDispM; c++) {
      const mi = order_m[c];
      const f  = !!data.marker_polarity[mi];
      ctx.fillStyle = f ? 'rgba(20,20,20,0.85)' : 'rgba(220,220,220,0.85)';
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(matX + c * cellW, topY, cellW + 0.5, trackPx);
      }
    }
  }

  // --- Matrix outline.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(matX, matY, cellW * nDispM, cellH * nDispS);
  }

  // --- Hover crosshair.
  const hov = o.hovered_cell;
  if (hov && Number.isFinite(hov.row) && Number.isFinite(hov.col)) {
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 2;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(matX, matY + hov.row * cellH - 0.5,
                     cellW * nDispM, cellH + 1);
      ctx.strokeRect(matX + hov.col * cellW - 0.5, matY,
                     cellW + 1, cellH * nDispS);
    }
    ctx.lineWidth = 1;
  }

  // --- Keyboard cursor (←/→ marker column, optional ↑/↓ sample row).
  // Drawn as a bright cyan column/row band so it reads distinctly from
  // the orange hover crosshair. `cursor_col` / `cursor_row` are display
  // coordinates into the current order arrays.
  const curC = Number.isFinite(o.cursor_col) ? (o.cursor_col | 0) : -1;
  const curR = Number.isFinite(o.cursor_row) ? (o.cursor_row | 0) : -1;
  if (curC >= 0 && curC < nDispM && typeof ctx.fillRect === 'function') {
    ctx.fillStyle = 'rgba(45,210,231,0.16)';
    ctx.fillRect(matX + curC * cellW, matY, cellW, cellH * nDispS);
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeStyle = '#2dd2e7';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(matX + curC * cellW - 0.5, matY + 0.5, cellW + 1, cellH * nDispS - 1);
      ctx.lineWidth = 1;
    }
  }
  if (curR >= 0 && curR < nDispS && typeof ctx.fillRect === 'function') {
    ctx.fillStyle = 'rgba(45,210,231,0.16)';
    ctx.fillRect(matX, matY + curR * cellH, cellW * nDispM, cellH);
  }

  // --- Selected sample row / marker column underlays.
  if (selectedSamples && selectedSamples.size > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    for (let r = 0; r < nDispS; r++) {
      if (selectedSamples.has(order_s[r])) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(matX, matY + r * cellH - 0.5,
                         cellW * nDispM, cellH + 1);
        }
      }
    }
  }
  if (selectedMarkers && selectedMarkers.size > 0) {
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    for (let c = 0; c < nDispM; c++) {
      if (selectedMarkers.has(order_m[c])) {
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(matX + c * cellW - 0.5, matY,
                         cellW + 1, cellH * nDispS);
        }
      }
    }
  }

  return {
    layout: {
      matX, matY, matW: cellW * nDispM, matH: cellH * nDispS,
      cellW, cellH,
      n_displayed_samples: nDispS,
      n_displayed_markers: nDispM,
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

// Height of the clickable label-header strip at the top of each regime
// span band (must match the span overlay's label placement above).
export const REGIME_SPAN_LABEL_H = 14;

/**
 * Hit-test the regime-span label headers. A click lands "on" a regime when
 * it falls in the top REGIME_SPAN_LABEL_H px of the matrix within that
 * regime's x-range, resolved through the marker order so it tracks the
 * marker-order mode + zoom (same mapping as the span overlay).
 *
 * @returns {{ candidate_id, lo, hi, regime_class, confidence, label } | null}
 */
export function findRegimeSpanAtPixel(layout, regime_spans, px, py) {
  if (!layout || !Array.isArray(regime_spans) || regime_spans.length === 0) return null;
  const { matX, matY, cellW, n_displayed_markers, marker_order } = layout;
  if (!(cellW > 0)) return null;
  if (py < matY || py > matY + REGIME_SPAN_LABEL_H) return null;
  // Topmost (latest-drawn) span wins when bands overlap, matching paint order.
  for (let s = regime_spans.length - 1; s >= 0; s--) {
    const span = regime_spans[s];
    const lo = span.lo | 0, hi = span.hi | 0;
    let xLo = Infinity, xHi = -Infinity;
    for (let c = 0; c < n_displayed_markers; c++) {
      const mi = marker_order[c];
      if (mi >= lo && mi <= hi) {
        const x = matX + c * cellW;
        if (x < xLo) xLo = x;
        if (x + cellW > xHi) xHi = x + cellW;
      }
    }
    if (Number.isFinite(xLo) && xHi > xLo && px >= xLo && px <= xHi) return span;
  }
  return null;
}
