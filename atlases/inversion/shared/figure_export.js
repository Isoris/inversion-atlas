// shared/figure_export.js
// =====================================================================
// Vector + high-DPI raster figure export from canvas paint routines.
//
// Two output paths share one trick: the panel's paint code takes a
// `ctx` object that quacks like CanvasRenderingContext2D. We can pass
// it either:
//   - a real 2d context (screen rendering, status quo);
//   - a SVGRecordingContext that appends <rect>, <path>, <text> etc.
//     to a buffer instead of drawing pixels (this module);
//   - a real 2d context on a 4×-scaled off-screen canvas (this module),
//     yielding a print-quality PNG.
//
// Transparent background by default: we never paint a backdrop in the
// recording / off-screen canvas. The panel's paint code typically
// clears + fills the panel background as its first step — pass
// `figure_mode: true` so the paint code skips that fill.
//
// SVG element vocabulary used: <rect>, <path>, <text>, <g> (for
// save/restore + globalAlpha). Compatible with Illustrator / Inkscape.
//
// Surface area covered (matches `ctx.<method>` grep across regimes
// panels):
//   props:   fillStyle strokeStyle lineWidth font textAlign textBaseline globalAlpha
//   methods: beginPath moveTo lineTo stroke fill closePath
//            fillRect strokeRect clearRect
//            fillText strokeText measureText
//            save restore setTransform scale setLineDash
//            arc (heatmaps may use, included defensively)
// =====================================================================

/**
 * Pseudo CanvasRenderingContext2D that records SVG fragments.
 *
 * Construct one per export:
 *   const ctx = new SVGRecordingContext(W, H);
 *   paintMyPanel(ctx, data, { figure_mode: true });
 *   const svg = ctx.toSVG();
 *
 * Coordinate system matches canvas: origin top-left, y increases
 * downward. We mirror save/restore by stack-pushing the current
 * style + opening / closing <g> elements when globalAlpha changes.
 */
export class SVGRecordingContext {
  constructor(width, height) {
    this.width = width | 0;
    this.height = height | 0;
    this._parts = [];
    this._state = {
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      globalAlpha: 1, lineDash: [],
    };
    this._stack = [];
    this._path = [];
    this._groups = [];   // open <g> tags opened by save() under non-1 alpha
    this._textMetricsCache = new Map();
  }

  // --- style props (mirror canvas property setters) ----------------
  set fillStyle(v)    { this._state.fillStyle = v; }
  get fillStyle()     { return this._state.fillStyle; }
  set strokeStyle(v)  { this._state.strokeStyle = v; }
  get strokeStyle()   { return this._state.strokeStyle; }
  set lineWidth(v)    { this._state.lineWidth = v; }
  get lineWidth()     { return this._state.lineWidth; }
  set font(v)         { this._state.font = v; }
  get font()          { return this._state.font; }
  set textAlign(v)    { this._state.textAlign = v; }
  get textAlign()     { return this._state.textAlign; }
  set textBaseline(v) { this._state.textBaseline = v; }
  get textBaseline()  { return this._state.textBaseline; }
  set globalAlpha(v)  { this._state.globalAlpha = v; }
  get globalAlpha()   { return this._state.globalAlpha; }

  // --- state stack -------------------------------------------------
  save() {
    // Open a <g opacity="…"> when alpha is non-1 so the alpha applies
    // to everything painted until restore().
    const a = this._state.globalAlpha;
    if (a < 1) {
      this._parts.push(`<g opacity="${_num(a)}">`);
      this._stack.push({ state: Object.assign({}, this._state), closeTag: '</g>' });
    } else {
      this._stack.push({ state: Object.assign({}, this._state), closeTag: '' });
    }
  }
  restore() {
    const top = this._stack.pop();
    if (!top) return;
    if (top.closeTag) this._parts.push(top.closeTag);
    this._state = top.state;
  }

  // --- transforms (no-op for SVG: paint code uses these for DPR
  // scaling, which doesn't apply to vector output) ------------------
  setTransform() { /* no-op */ }
  scale()        { /* no-op */ }
  translate()    { /* no-op */ }

  setLineDash(d) { this._state.lineDash = (Array.isArray(d) ? d.slice() : []); }

  // --- rects -------------------------------------------------------
  clearRect() { /* no-op — transparent background is the default */ }
  fillRect(x, y, w, h) {
    if (!(w > 0) || !(h > 0)) return;
    this._parts.push(
      `<rect x="${_num(x)}" y="${_num(y)}" width="${_num(w)}" height="${_num(h)}" `
      + `fill="${_esc(this._state.fillStyle)}" ${_alpha(this)}/>`);
  }
  strokeRect(x, y, w, h) {
    if (!(w > 0) || !(h > 0)) return;
    this._parts.push(
      `<rect x="${_num(x)}" y="${_num(y)}" width="${_num(w)}" height="${_num(h)}" `
      + `fill="none" stroke="${_esc(this._state.strokeStyle)}" `
      + `stroke-width="${_num(this._state.lineWidth)}" ${_dash(this)}${_alpha(this)}/>`);
  }

  // --- paths -------------------------------------------------------
  beginPath() { this._path = []; }
  moveTo(x, y) { this._path.push(`M${_num(x)} ${_num(y)}`); }
  lineTo(x, y) { this._path.push(`L${_num(x)} ${_num(y)}`); }
  closePath()  { this._path.push('Z'); }
  arc(cx, cy, r, _a0, _a1) {
    // Treat as full circle — sufficient for the way the codebase uses
    // arc() (small dots, full sweep). If an honest partial arc shows
    // up, expand to A/L commands.
    this._path.push(
      `M${_num(cx - r)} ${_num(cy)} `
      + `A${_num(r)} ${_num(r)} 0 1 0 ${_num(cx + r)} ${_num(cy)} `
      + `A${_num(r)} ${_num(r)} 0 1 0 ${_num(cx - r)} ${_num(cy)} Z`);
  }
  stroke() {
    if (this._path.length === 0) return;
    this._parts.push(
      `<path d="${this._path.join(' ')}" fill="none" `
      + `stroke="${_esc(this._state.strokeStyle)}" `
      + `stroke-width="${_num(this._state.lineWidth)}" `
      + `stroke-linecap="round" stroke-linejoin="round" `
      + `${_dash(this)}${_alpha(this)}/>`);
  }
  fill() {
    if (this._path.length === 0) return;
    this._parts.push(
      `<path d="${this._path.join(' ')}" fill="${_esc(this._state.fillStyle)}" ${_alpha(this)}/>`);
  }

  // --- text --------------------------------------------------------
  fillText(text, x, y) {
    if (text == null || text === '') return;
    const { fontSize, fontFamily } = _parseFont(this._state.font);
    this._parts.push(
      `<text x="${_num(x)}" y="${_num(y)}" `
      + `font-family="${_esc(fontFamily)}" font-size="${_num(fontSize)}" `
      + `text-anchor="${_textAnchor(this._state.textAlign)}" `
      + `dominant-baseline="${_baseline(this._state.textBaseline)}" `
      + `fill="${_esc(this._state.fillStyle)}" ${_alpha(this)}>`
      + `${_esc(String(text))}</text>`);
  }
  strokeText(text, x, y) { this.fillText(text, x, y); }
  measureText(text) {
    // Rough width estimate (no DOM access — approximate from font size
    // and char count). Good enough for label placement; precise metrics
    // matter mainly on screen where the real ctx provides them.
    const { fontSize } = _parseFont(this._state.font);
    const w = (text == null ? 0 : String(text).length) * fontSize * 0.55;
    return { width: w };
  }

  // --- finish ------------------------------------------------------
  toSVG(opts) {
    const o = opts || {};
    // Close any unbalanced <g>.
    while (this._stack.length > 0) this.restore();
    const title = o.title ? `<title>${_esc(o.title)}</title>` : '';
    const desc  = o.description ? `<desc>${_esc(o.description)}</desc>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<svg xmlns="http://www.w3.org/2000/svg" `
      + `width="${this.width}" height="${this.height}" `
      + `viewBox="0 0 ${this.width} ${this.height}">\n`
      + title + desc + this._parts.join('') + `\n</svg>\n`;
  }
}

/**
 * Paint an existing canvas-style routine into an SVG string.
 *
 * @param {(ctx:any, ...args:any[]) => void} paintFn
 * @param {number} width
 * @param {number} height
 * @param {Array<any>} [paintArgs]  forwarded to paintFn after ctx
 * @returns {string}                SVG document
 */
export function paintToSVG(paintFn, width, height, paintArgs) {
  const ctx = new SVGRecordingContext(width, height);
  const args = paintArgs || [];
  paintFn.apply(null, [ctx].concat(args));
  return ctx.toSVG();
}

/**
 * Paint a canvas-style routine onto an off-screen canvas at scale ×
 * (default 4× for print-quality PNG).
 *
 * @param {(ctx:CanvasRenderingContext2D, w:number, h:number, ...args:any[]) => void} paintFn
 *        first arg ctx, then logical width / height in CSS pixels;
 *        the function should scale by DPR internally OR not scale at
 *        all (we apply ctx.scale(scale, scale) on its behalf when
 *        `auto_scale: true` is set in opts).
 * @param {number} width        logical width (CSS pixels)
 * @param {number} height       logical height (CSS pixels)
 * @param {Object} opts         { scale, auto_scale, paintArgs }
 * @returns {HTMLCanvasElement} the rendered canvas
 */
export function paintToHighDPICanvas(paintFn, width, height, opts) {
  const o = opts || {};
  const scale = (o.scale > 0) ? o.scale : 4;
  const cv = document.createElement('canvas');
  cv.width  = Math.max(1, Math.round(width  * scale));
  cv.height = Math.max(1, Math.round(height * scale));
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  if (o.auto_scale !== false) ctx.scale(scale, scale);
  const args = o.paintArgs || [];
  paintFn.apply(null, [ctx, width, height].concat(args));
  return cv;
}

/**
 * Trigger a browser download for a string blob.
 */
export function downloadString(filename, content, mime) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 100);
}

/**
 * Convenience: trigger a download of a canvas as PNG.
 */
export function downloadCanvasAsPNG(canvas, filename) {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    // Fallback path: toDataURL.
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 100);
    return;
  }
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 100);
  }, 'image/png');
}

// ---------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------

function _num(v) {
  if (!Number.isFinite(v)) return '0';
  // 3 decimal places is enough for any vector renderer; keeps file size down.
  return (Math.round(v * 1000) / 1000).toString();
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function _alpha(self) {
  const a = self._state.globalAlpha;
  return (a < 1) ? `opacity="${_num(a)}" ` : '';
}

function _dash(self) {
  const d = self._state.lineDash;
  if (!d || d.length === 0) return '';
  return `stroke-dasharray="${d.map(_num).join(' ')}" `;
}

function _textAnchor(canvasAlign) {
  if (canvasAlign === 'center')                return 'middle';
  if (canvasAlign === 'right' || canvasAlign === 'end') return 'end';
  return 'start';
}

function _baseline(canvasBaseline) {
  if (canvasBaseline === 'middle')          return 'central';
  if (canvasBaseline === 'top')             return 'hanging';
  if (canvasBaseline === 'bottom')          return 'text-bottom';
  if (canvasBaseline === 'hanging')         return 'hanging';
  if (canvasBaseline === 'alphabetic')      return 'alphabetic';
  if (canvasBaseline === 'ideographic')     return 'ideographic';
  return 'alphabetic';
}

function _parseFont(canvasFont) {
  // Canvas font shorthand: "italic 10px ui-monospace, monospace".
  // Minimal parse: pull the px size and everything after.
  const m = /([\d.]+)px\s+(.+)$/.exec(canvasFont || '');
  if (m) return { fontSize: parseFloat(m[1]) || 10, fontFamily: m[2] };
  return { fontSize: 10, fontFamily: 'sans-serif' };
}
