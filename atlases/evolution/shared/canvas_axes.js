// shared/canvas_axes.js
// =====================================================================
// Small, dependency-free canvas chrome helpers shared by evolution-
// atlas pages whose canvases used to ship without axes, tick marks,
// legends, or row/column labels — the visual gap that made them feel
// "mockup-like" even though the compute was real.
//
// All functions take a `CanvasRenderingContext2D`-shaped object and
// guard each draw call with a typeof check so the helpers no-op in
// Node test environments that polyfill only a subset of the canvas
// API. Coordinates are CSS pixels — callers are responsible for any
// DPR scaling on the context itself.
// =====================================================================

const DEFAULT_INK     = '#3a4250';
const DEFAULT_INK_DIM = 'rgba(80, 90, 110, 0.65)';
const DEFAULT_GRID    = 'rgba(80, 90, 110, 0.18)';

/**
 * Paint a 2-axis frame (x axis at bottom, y axis at left) with tick
 * marks + numeric labels + optional axis title.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} opts
 * @param {{x:number,y:number,w:number,h:number}} opts.plot   plot rect
 * @param {[number, number]} opts.xRange         [xmin, xmax] data values
 * @param {[number, number]} opts.yRange         [ymin, ymax] data values
 * @param {string} [opts.xLabel]                 axis title under x
 * @param {string} [opts.yLabel]                 axis title left of y (rotated)
 * @param {number} [opts.nXTicks=5]
 * @param {number} [opts.nYTicks=5]
 * @param {(v:number)=>string} [opts.fmt]        tick label formatter
 * @param {string} [opts.ink]                    main text colour
 * @param {string} [opts.inkDim]                 tick/text dim colour
 * @param {string} [opts.gridColor]              grid line colour
 * @param {boolean} [opts.showGrid=true]
 */
export function paintCanvasAxes(ctx, opts) {
  if (!ctx || !opts || !opts.plot) return;
  const p = opts.plot;
  const xr = opts.xRange || [0, 1];
  const yr = opts.yRange || [0, 1];
  const nx = opts.nXTicks || 5;
  const ny = opts.nYTicks || 5;
  const fmt = opts.fmt || _defaultFmt;
  const ink     = opts.ink     || DEFAULT_INK;
  const inkDim  = opts.inkDim  || DEFAULT_INK_DIM;
  const gridCol = opts.gridColor || DEFAULT_GRID;
  const showGrid = opts.showGrid !== false;

  // Plot frame.
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeStyle = inkDim;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w, p.h);
  }

  // Ticks.
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = inkDim;
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'center';

  const xTicks = _niceTicks(xr[0], xr[1], nx);
  for (const v of xTicks) {
    const t = (v - xr[0]) / (xr[1] - xr[0] || 1);
    const px = p.x + t * p.w;
    if (showGrid && typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = gridCol;
      ctx.beginPath();
      ctx.moveTo(px, p.y);
      ctx.lineTo(px, p.y + p.h);
      ctx.stroke();
    }
    if (typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = inkDim;
      ctx.beginPath();
      ctx.moveTo(px, p.y + p.h);
      ctx.lineTo(px, p.y + p.h + 3);
      ctx.stroke();
    }
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(fmt(v), px, p.y + p.h + 14);
    }
  }

  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'right';
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'middle';
  const yTicks = _niceTicks(yr[0], yr[1], ny);
  for (const v of yTicks) {
    const t = (v - yr[0]) / (yr[1] - yr[0] || 1);
    const py = p.y + p.h - t * p.h;
    if (showGrid && typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = gridCol;
      ctx.beginPath();
      ctx.moveTo(p.x,         py);
      ctx.lineTo(p.x + p.w,   py);
      ctx.stroke();
    }
    if (typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = inkDim;
      ctx.beginPath();
      ctx.moveTo(p.x - 3, py);
      ctx.lineTo(p.x,     py);
      ctx.stroke();
    }
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(fmt(v), p.x - 6, py);
    }
  }
  // Restore alignment.
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'alphabetic';
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';

  // Axis titles.
  if (opts.xLabel) {
    ctx.fillStyle = ink;
    ctx.font = '11px var(--mono, ui-monospace, monospace)';
    if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'center';
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(opts.xLabel, p.x + p.w / 2, p.y + p.h + 30);
    }
  }
  if (opts.yLabel) {
    ctx.fillStyle = ink;
    ctx.font = '11px var(--mono, ui-monospace, monospace)';
    if (typeof ctx.save === 'function') ctx.save();
    if (typeof ctx.translate === 'function') ctx.translate(p.x - 38, p.y + p.h / 2);
    if (typeof ctx.rotate === 'function') ctx.rotate(-Math.PI / 2);
    if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'center';
    if (typeof ctx.fillText === 'function') ctx.fillText(opts.yLabel, 0, 0);
    if (typeof ctx.restore === 'function') ctx.restore();
  }
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';
}

/**
 * Paint row + column labels on the outside of a matrix plot (used by
 * event_tree_relative_ordering's relationship matrix, mosaicism cells,
 * etc.). Labels are ellipsised when they would overflow their slot.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} opts
 * @param {{x,y,w,h}} opts.plot
 * @param {string[]} opts.rowLabels        length = N
 * @param {string[]} opts.colLabels        length = N (default = rowLabels)
 * @param {number}   [opts.maxChars=8]     ellipsise beyond this
 * @param {number}   [opts.fontPx=10]
 * @param {string}   [opts.ink]
 */
export function paintMatrixLabels(ctx, opts) {
  if (!ctx || !opts || !opts.plot) return;
  const p = opts.plot;
  const rows = opts.rowLabels || [];
  const cols = opts.colLabels || rows;
  const N = Math.max(rows.length, cols.length);
  if (N <= 0) return;
  const cellW = p.w / N;
  const cellH = p.h / N;
  const maxC = opts.maxChars || 8;
  const ink = opts.ink || DEFAULT_INK_DIM;
  ctx.fillStyle = ink;
  ctx.font = `${opts.fontPx || 10}px ui-monospace, monospace`;
  // Column labels: rotated 45° above the plot.
  if (typeof ctx.save === 'function') ctx.save();
  for (let j = 0; j < cols.length; j++) {
    const cx = p.x + (j + 0.5) * cellW;
    const cy = p.y - 4;
    if (typeof ctx.save === 'function') ctx.save();
    if (typeof ctx.translate === 'function') ctx.translate(cx, cy);
    if (typeof ctx.rotate === 'function') ctx.rotate(-Math.PI / 4);
    if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';
    if (typeof ctx.fillText === 'function') ctx.fillText(_truncate(cols[j], maxC), 0, 0);
    if (typeof ctx.restore === 'function') ctx.restore();
  }
  if (typeof ctx.restore === 'function') ctx.restore();
  // Row labels: right-aligned to the left of the plot.
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'right';
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'middle';
  for (let i = 0; i < rows.length; i++) {
    const ry = p.y + (i + 0.5) * cellH;
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(_truncate(rows[i], maxC), p.x - 4, ry);
    }
  }
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'alphabetic';
}

/**
 * Paint a horizontal colour-key legend at a corner of the canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} opts
 * @param {{x:number, y:number}} opts.origin   top-left of the legend
 * @param {Array<{label:string, color:string}>} opts.entries
 * @param {number}   [opts.fontPx=10]
 * @param {number}   [opts.swatch=10]    swatch square side
 * @param {number}   [opts.gap=10]       gap between entries
 * @param {string}   [opts.ink]
 */
export function paintLegend(ctx, opts) {
  if (!ctx || !opts || !opts.origin || !Array.isArray(opts.entries)) return;
  const o = opts.origin;
  const fontPx = opts.fontPx || 10;
  const sw = opts.swatch || 10;
  const gap = opts.gap != null ? opts.gap : 10;
  const ink = opts.ink || DEFAULT_INK;
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'middle';
  let x = o.x;
  const y = o.y;
  for (const e of opts.entries) {
    ctx.fillStyle = e.color || '#888';
    if (typeof ctx.fillRect === 'function') ctx.fillRect(x, y - sw / 2, sw, sw);
    x += sw + 4;
    ctx.fillStyle = ink;
    const text = e.label || '';
    if (typeof ctx.fillText === 'function') ctx.fillText(text, x, y);
    x += (text.length * fontPx * 0.6) + gap;
  }
  if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'alphabetic';
}

// =====================================================================
// Helpers
// =====================================================================

function _defaultFmt(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toExponential(1);
  if (a >= 1)    return v.toFixed(2);
  if (a >= 0.01) return v.toFixed(3);
  return v.toExponential(1);
}

function _truncate(s, max) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Build a small set of "nice" tick values inside [lo, hi]. Avoids the
 * common-but-ugly off-by-one ranges that pure linspace produces.
 */
function _niceTicks(lo, hi, n) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
  const step = _niceStep((hi - lo) / Math.max(1, n - 1));
  const out = [];
  // Start one step ABOVE lo so we never label tick 0 outside the plot.
  const start = Math.ceil(lo / step) * step;
  for (let v = start; v <= hi + step * 0.001; v += step) {
    out.push(_roundFloat(v, step));
    if (out.length > 20) break;        // safety
  }
  return out;
}
function _niceStep(s) {
  const exp = Math.floor(Math.log10(Math.abs(s) || 1));
  const f = Math.abs(s) / Math.pow(10, exp);
  let nice;
  if      (f < 1.5) nice = 1;
  else if (f < 3)   nice = 2;
  else if (f < 7)   nice = 5;
  else              nice = 10;
  return nice * Math.pow(10, exp);
}
function _roundFloat(v, step) {
  const exp = Math.max(0, -Math.floor(Math.log10(step)));
  return parseFloat(v.toFixed(exp + 1));
}
