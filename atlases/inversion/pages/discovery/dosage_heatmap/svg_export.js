// pages/discovery/dosage_heatmap/svg_export.js
// =====================================================================
// Vector (SVG) export of the dosage heatmap — the manuscript-figure path.
// Reproduces the on-screen view (same sample_order / marker_order /
// color_mode) as standalone SVG: dosage matrix + optional left group
// column + top polarity stripe + a genomic-position axis + a colour
// legend. Vector output so it scales cleanly for print; a PDF is obtained
// by printing the SVG (see dosage_heatmap.js _exportFigure).
//
// Pure: returns an SVG string, no DOM. Colours reuse the canvas renderer's
// palettes so the figure matches the screen exactly.
// =====================================================================
import {
  pickDosageColorFn, dosageGenotypeColor, buildGroupColorMap,
} from './renderer.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {Object} canonical  heatmap data (dosage_get(r,c) or matrix,
 *                            sample_group?, marker_polarity?, marker_pos_bp?)
 * @param {Object} [opts]
 *   sample_order?: Int32Array
 *   marker_order?: Int32Array
 *   color_mode?:   'magma'|'genotype'|'fan'|'occupancy'   (default 'genotype')
 *   show_group_track?:    boolean (default true)
 *   show_polarity_track?: boolean (default true)
 *   width?, height?:      px (default 1100 × 700)
 *   title?:               string
 *   vmin?, vmax?:         dosage scale (default 0..2)
 *   group_colors?:        Map<label,color>
 * @returns {string} standalone SVG document
 */
export function buildHeatmapSvg(canonical, opts) {
  const o = opts || {};
  const d = canonical || {};
  const nS = d.n_samples | 0, nM = d.n_markers | 0;
  const order_s = (o.sample_order instanceof Int32Array && o.sample_order.length)
    ? o.sample_order : _iota(nS);
  const order_m = (o.marker_order instanceof Int32Array && o.marker_order.length)
    ? o.marker_order : _iota(nM);
  const R = order_s.length, C = order_m.length;

  const W = Math.max(320, o.width || 1100);
  const H = Math.max(240, o.height || 700);
  const mode = o.color_mode || 'genotype';
  const vmin = Number.isFinite(o.vmin) ? o.vmin : 0;
  const vmax = Number.isFinite(o.vmax) ? o.vmax : 2;
  const colorFn = pickDosageColorFn(mode);
  const getVal = _valueAccessor(d);

  const showGroup = (o.show_group_track !== false) && !!d.sample_group;
  const showPol   = (o.show_polarity_track !== false) && !!d.marker_polarity;

  // Margins: title top, axis bottom, group column + legend.
  const mT = o.title ? 34 : 14;
  const polH = showPol ? 10 : 0;
  const grpW = showGroup ? 14 : 0;
  const mL = 8 + grpW;
  const mR = 12;
  const axisH = 30;        // genomic position axis
  const legendH = 34;
  const matX = mL;
  const matY = mT + polH + 4;
  const matW = Math.max(40, W - mL - mR);
  const matH = Math.max(40, H - matY - axisH - legendH);
  const cw = matW / Math.max(1, C);
  const ch = matH / Math.max(1, R);

  const groupColors = (o.group_colors instanceof Map) ? o.group_colors
    : buildGroupColorMap(_distinct(d.sample_group));

  const parts = [];
  parts.push(`<svg xmlns="${NS}" width="${W}" height="${H}" `
    + `viewBox="0 0 ${W} ${H}" font-family="Helvetica,Arial,sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  if (o.title) {
    parts.push(`<text x="${matX}" y="20" font-size="15" font-weight="600" `
      + `fill="#1a2230">${_esc(o.title)}</text>`);
  }

  // --- Dosage matrix. Coalesce equal-colour horizontal runs per row into a
  // single <rect> so the file stays compact.
  parts.push('<g shape-rendering="crispEdges">');
  for (let r = 0; r < R; r++) {
    const si = order_s[r];
    const y = matY + r * ch;
    let runStart = 0, runCol = null;
    for (let c = 0; c <= C; c++) {
      const col = (c < C) ? colorFn(getVal(si, order_m[c]), vmin, vmax) : null;
      if (col !== runCol) {
        if (runCol != null && c > runStart) {
          const x = matX + runStart * cw;
          parts.push(`<rect x="${_n(x)}" y="${_n(y)}" width="${_n((c - runStart) * cw + 0.5)}" `
            + `height="${_n(ch + 0.5)}" fill="${runCol}"/>`);
        }
        runStart = c; runCol = col;
      }
    }
  }
  parts.push('</g>');

  // --- Left group colour column.
  if (showGroup) {
    parts.push('<g>');
    for (let r = 0; r < R; r++) {
      const si = order_s[r];
      const lab = d.sample_group[si];
      const col = groupColors.get(lab) || '#bbbbbb';
      parts.push(`<rect x="${_n(matX - grpW - 2)}" y="${_n(matY + r * ch)}" `
        + `width="${grpW}" height="${_n(ch + 0.5)}" fill="${col}"/>`);
    }
    parts.push('</g>');
  }

  // --- Top polarity stripe.
  if (showPol) {
    parts.push('<g>');
    for (let c = 0; c < C; c++) {
      const f = !!d.marker_polarity[order_m[c]];
      parts.push(`<rect x="${_n(matX + c * cw)}" y="${_n(mT)}" width="${_n(cw + 0.5)}" `
        + `height="${polH}" fill="${f ? '#141414' : '#dcdcdc'}"/>`);
    }
    parts.push('</g>');
  }

  // --- Matrix frame.
  parts.push(`<rect x="${_n(matX)}" y="${_n(matY)}" width="${_n(C * cw)}" `
    + `height="${_n(R * ch)}" fill="none" stroke="#28324699" stroke-width="1"/>`);

  // --- Genomic position axis (uses marker_pos_bp of the displayed markers).
  const axisY = matY + R * ch;
  parts.push(_bpAxisSvg(d.marker_pos_bp, order_m, matX, matW, axisY, axisH));

  // --- Colour legend.
  parts.push(_legendSvg(mode, vmin, vmax, matX, H - legendH + 8));

  parts.push('</svg>');
  return parts.join('');
}

// Map displayed markers' bp onto the matrix x-axis; emit ~5 ticks.
function _bpAxisSvg(posBp, order_m, x0, w, y, h) {
  const C = order_m.length;
  if (!posBp || !posBp.length || C < 2) return '';
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < C; c++) { const p = posBp[order_m[c]]; if (Number.isFinite(p)) { if (p < lo) lo = p; if (p > hi) hi = p; } }
  if (!(hi > lo)) return '';
  const out = [`<line x1="${_n(x0)}" y1="${_n(y + 2)}" x2="${_n(x0 + w)}" y2="${_n(y + 2)}" stroke="#566" stroke-width="1"/>`];
  const N = 5;
  for (let k = 0; k <= N; k++) {
    const frac = k / N;
    const bp = lo + frac * (hi - lo);
    const x = x0 + frac * w;
    out.push(`<line x1="${_n(x)}" y1="${_n(y + 2)}" x2="${_n(x)}" y2="${_n(y + 7)}" stroke="#566" stroke-width="1"/>`);
    out.push(`<text x="${_n(x)}" y="${_n(y + 20)}" font-size="10" fill="#445" text-anchor="middle">${_bpLabel(bp)}</text>`);
  }
  return out.join('');
}

// Legend: for genotype mode show the three discrete swatches; for
// continuous modes a coarse gradient strip.
function _legendSvg(mode, vmin, vmax, x, y) {
  if (mode === 'genotype') {
    const items = [['0/0', dosageGenotypeColor(0)], ['0/1', dosageGenotypeColor(1)], ['1/1', dosageGenotypeColor(2)]];
    const out = [];
    let cx = x;
    for (const [lab, col] of items) {
      out.push(`<rect x="${_n(cx)}" y="${_n(y)}" width="14" height="14" fill="${col}" stroke="#999" stroke-width="0.5"/>`);
      out.push(`<text x="${_n(cx + 18)}" y="${_n(y + 11)}" font-size="11" fill="#334">${lab}</text>`);
      cx += 60;
    }
    return out.join('');
  }
  const colorFn = pickDosageColorFn(mode);
  const out = [], steps = 24, sw = 6;
  for (let i = 0; i < steps; i++) {
    const v = vmin + (i / (steps - 1)) * (vmax - vmin);
    out.push(`<rect x="${_n(x + i * sw)}" y="${_n(y)}" width="${sw + 0.5}" height="12" fill="${colorFn(v, vmin, vmax)}"/>`);
  }
  out.push(`<text x="${_n(x)}" y="${_n(y + 26)}" font-size="10" fill="#445">${_n(vmin)}</text>`);
  out.push(`<text x="${_n(x + steps * sw)}" y="${_n(y + 26)}" font-size="10" fill="#445" text-anchor="end">${_n(vmax)}</text>`);
  return out.join('');
}

// Matches the canvas renderer's cellValue(marker, sample) accessor.
function _valueAccessor(d) {
  if (typeof d.cellValue === 'function') return (s, m) => d.cellValue(m, s);
  if (typeof d.dosage_get === 'function') return (s, m) => d.dosage_get(s, m);
  const M = d.matrix, nM = d.n_markers | 0;
  if (M) return (s, m) => M[s * nM + m];
  return () => NaN;
}
function _iota(n) { const a = new Int32Array(Math.max(0, n)); for (let i = 0; i < a.length; i++) a[i] = i; return a; }
function _distinct(arr) {
  if (!arr) return [];
  const seen = new Set(), out = [];
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v != null && !seen.has(v)) { seen.add(v); out.push(v); } }
  return out;
}
function _bpLabel(bp) {
  if (bp >= 1e6) return (bp / 1e6).toFixed(2) + ' Mb';
  if (bp >= 1e3) return (bp / 1e3).toFixed(0) + ' kb';
  return String(Math.round(bp));
}
function _n(x) { return (Math.round(x * 100) / 100); }
function _esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}
