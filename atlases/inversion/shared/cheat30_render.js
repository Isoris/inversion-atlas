// shared/cheat30_render.js
//
// Cheat30 age/origin display helpers (legacy lines 60373-60500). The
// cheat30 R-pipeline emits per-candidate genotype-pair GDS distributions
// + a verdict class; this module ships the display vocabularies and
// the inline-SVG ridgeline plot.
//
// The cheat30 data IO (storeCheat30Results, cheat30ForCandidate, ...)
// already lives in shared/cheat30_results.js — this module is purely
// the renderer + format helpers.
//
// Naming caveat (from the legacy header): cheat30 measures genotype-pair
// GDS = "shared haplotype background per arrangement", NOT a molecular
// clock. The age_proxy is ordinal (compare candidates), not absolute.

/** Origin-class verdict vocabulary + pill palette. */
export const AGEORIG_CLASS = Object.freeze({
  single_origin: Object.freeze({
    label: 'SINGLE ORIGIN',
    color: '#7ad394',
    explanation: 'I/I distribution is unimodal. All HOM_INV carriers share '
      + 'haplotype background — consistent with one founding inversion event.',
  }),
  recurrent: Object.freeze({
    label: 'RECURRENT',
    color: '#e07a7a',
    explanation: 'I/I distribution is bimodal. HOM_INV carriers cluster on '
      + 'multiple haplotype backgrounds — consistent with ≥2 independent '
      + 'inversion events at this locus.',
  }),
  weak_signal: Object.freeze({
    label: 'WEAK SIGNAL',
    color: '#e0bc7a',
    explanation: 'Same-genotype pairs are more similar than different-'
      + 'genotype pairs (Wilcoxon significant) but the effect is small. '
      + 'Consistent with young polymorphism, segregating introgression, or '
      + 'a technical artifact.',
  }),
  inconclusive: Object.freeze({
    label: 'INCONCLUSIVE',
    color: '#888',
    explanation: 'Could not classify: separation test not significant, or '
      + 'class size below threshold (need ≥5 samples in REF and INV).',
  }),
});

/** Ridge colors per genotype-pair type. */
export const AGEORIG_RIDGE_COLOR = Object.freeze({
  HOM_REF_HOM_REF: '#7ad394',
  HOM_INV_HOM_INV: '#e07a7a',
  HOM_REF_HOM_INV: '#9ea4ad',
  HET_HET:         '#7ad3db',
  HOM_REF_HET:     '#aebfb8',
  HET_HOM_INV:     '#bda4a4',
});

/** The three primary pair types rendered in the ridgeline plot. */
export const AGEORIG_PRIMARY_PAIR_TYPES = Object.freeze([
  'HOM_REF_HOM_REF', 'HOM_INV_HOM_INV', 'HOM_REF_HOM_INV',
]);

// =====================================================================
// Format helpers
// =====================================================================

/**
 * Format a P-value. Uses different precision tiers:
 *   ≤ 1e-16 → '<2.2×10⁻¹⁶' sentinel
 *   < 0.001 → scientific notation (e.g. '1.23×10-5')
 *   < 0.01  → 4 decimal places
 *   else    → 3 decimal places
 *
 * Returns 'na' for null/NaN.
 */
export function fmtP(p) {
  if (p == null || !Number.isFinite(p)) return 'na';
  if (p <= 1e-16) return '<2.2×10⁻¹⁶';
  if (p < 0.001)  return p.toExponential(2).replace('e', '×10').replace('+', '');
  if (p < 0.01)   return p.toFixed(4);
  return p.toFixed(3);
}

/** Format a numeric value to 4 decimal places, or 'na' for nullish. */
export function fmt4(x) {
  return (x == null || !Number.isFinite(x)) ? 'na' : Number(x).toFixed(4);
}

/** Format a numeric value to 3 decimal places, or 'na' for nullish. */
export function fmt3(x) {
  return (x == null || !Number.isFinite(x)) ? 'na' : Number(x).toFixed(3);
}

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// Ridgeline SVG builder
// =====================================================================

/** Pretty label for a pair type. */
function _pairTypeLabel(t) {
  if (t === 'HOM_REF_HOM_REF') return 'REF / REF';
  if (t === 'HOM_INV_HOM_INV') return 'INV / INV';
  if (t === 'HOM_REF_HOM_INV') return 'REF / INV';
  if (t === 'HET_HET')         return 'HET / HET';
  if (t === 'HOM_REF_HET')     return 'REF / HET';
  if (t === 'HET_HOM_INV')     return 'HET / INV';
  return t;
}

/**
 * Build the cheat30 ridgeline plot as an inline-SVG string. Pure: takes
 * pair_density + pair_summaries data explicitly. Renders the three
 * primary pair types (REF/REF, INV/INV, REF/INV) as locally-normalised
 * KDE ridges with dashed-mean overlays.
 *
 * @param {Object} pair_density
 *    keyed by pair_type → { x: number[], y: number[] }
 * @param {Object?} pair_summaries
 *    optional, keyed by pair_type → { mean: number }
 * @param {{width?:number, height?:number, types?:Array<string>}} opts
 * @returns {string}
 */
export function drawCheat30Ridgeline(pair_density, pair_summaries, opts) {
  const o = opts || {};
  const W = o.width  || 380;
  const H = o.height || 180;
  const padL = 8, padR = 8, padT = 8, padB = 22;
  const types = Array.isArray(o.types) ? o.types : AGEORIG_PRIMARY_PAIR_TYPES;
  const haveTypes = types.filter(t =>
    pair_density && pair_density[t]
    && Array.isArray(pair_density[t].x) && Array.isArray(pair_density[t].y)
    && pair_density[t].x.length === pair_density[t].y.length
    && pair_density[t].x.length >= 2);
  if (haveTypes.length === 0) {
    return '<div class="ageorig-ridgeline-empty">no pair_density in cheat30 result</div>';
  }
  let xmin = Infinity, xmax = -Infinity;
  for (const t of haveTypes) {
    for (const xv of pair_density[t].x) {
      if (Number.isFinite(xv)) {
        if (xv < xmin) xmin = xv;
        if (xv > xmax) xmax = xv;
      }
    }
  }
  if (!Number.isFinite(xmin) || xmin === xmax) {
    return '<div class="ageorig-ridgeline-empty">degenerate x range</div>';
  }

  const rowH = (H - padT - padB) / haveTypes.length;
  const ridgeH = rowH * 0.82;
  const xToPx = (x) => padL + (x - xmin) / (xmax - xmin) * (W - padL - padR);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H
    + '" xmlns="http://www.w3.org/2000/svg" class="ageorig-ridgeline-svg">';
  // X axis line
  svg += '<line x1="' + padL + '" y1="' + (H - padB + 2)
    + '" x2="' + (W - padR) + '" y2="' + (H - padB + 2)
    + '" stroke="#444" stroke-width="0.5"/>';
  // Axis ticks
  for (let i = 0; i <= 4; i++) {
    const xv = xmin + (xmax - xmin) * i / 4;
    const px = xToPx(xv);
    svg += '<line x1="' + px + '" y1="' + (H - padB + 2)
      + '" x2="' + px + '" y2="' + (H - padB + 5)
      + '" stroke="#444" stroke-width="0.5"/>';
    svg += '<text x="' + px + '" y="' + (H - padB + 14)
      + '" font-family="var(--mono, monospace)" font-size="9" fill="#888" '
      + 'text-anchor="middle">' + xv.toFixed(2) + '</text>';
  }
  // X axis label
  svg += '<text x="' + (W / 2) + '" y="' + (H - 4)
    + '" font-family="var(--mono, monospace)" font-size="9" fill="#888" '
    + 'text-anchor="middle">GDS</text>';

  // Each ridge
  for (let ri = 0; ri < haveTypes.length; ri++) {
    const t = haveTypes[ri];
    const dens = pair_density[t];
    const ymaxLocal = Math.max.apply(null, dens.y.filter(v => Number.isFinite(v)));
    if (!(ymaxLocal > 0)) continue;
    const baseY = padT + ri * rowH + ridgeH;
    const yToPx = (y) => baseY - (y / ymaxLocal) * ridgeH;
    const pts = [];
    for (let k = 0; k < dens.x.length; k++) {
      pts.push(xToPx(dens.x[k]) + ',' + yToPx(dens.y[k]));
    }
    const startX = xToPx(dens.x[0]);
    const endX   = xToPx(dens.x[dens.x.length - 1]);
    const fillPath = 'M ' + startX + ',' + baseY + ' L ' + pts.join(' L ')
      + ' L ' + endX + ',' + baseY + ' Z';
    const linePath = 'M ' + pts.join(' L ');
    const color = AGEORIG_RIDGE_COLOR[t] || '#888';
    svg += '<path d="' + fillPath + '" fill="' + color + '" fill-opacity="0.30" stroke="none"/>';
    svg += '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="1.2"/>';
    if (pair_summaries && pair_summaries[t] && Number.isFinite(pair_summaries[t].mean)) {
      const meanPx = xToPx(pair_summaries[t].mean);
      svg += '<line x1="' + meanPx + '" y1="' + (baseY - ridgeH)
        + '" x2="' + meanPx + '" y2="' + baseY
        + '" stroke="' + color + '" stroke-width="1" stroke-dasharray="2,2"/>';
    }
    svg += '<text x="' + (padL + 2) + '" y="' + (baseY - ridgeH + 9)
      + '" font-family="var(--mono, monospace)" font-size="9" fill="' + color
      + '" text-anchor="start" font-weight="bold">'
      + _escape(_pairTypeLabel(t)) + '</text>';
  }
  svg += '</svg>';
  return svg;
}

/**
 * Look up a verdict-class entry by `origin_class`. Falls back to
 * 'inconclusive' for unknown values. Returns one of the four
 * AGEORIG_CLASS entries.
 *
 * @param {string?} origin_class
 * @returns {Object}
 */
export function resolveAgeOriginClass(origin_class) {
  if (origin_class && AGEORIG_CLASS[origin_class]) {
    return AGEORIG_CLASS[origin_class];
  }
  return AGEORIG_CLASS.inconclusive;
}
