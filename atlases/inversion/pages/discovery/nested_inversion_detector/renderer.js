// pages/discovery/nested_inversion_detector/renderer.js
// =====================================================================
// Canvas painter for the nested-inversion detector panel. Consumes
// shared/mgl_nested_detector.detectNestedInversion output:
//
//   {
//     verdict:        'nested_detected' | 'no_nested_structure' | 'insufficient_data',
//     strata_scanned: Array<'HOM1'|'HET'|'HOM2'>,
//     per_stratum_candidates: { HOM1: [...], HET: [...], HOM2: [...] },
//     inner_intervals: Array<{window_start, window_end, stratum?,
//                              silhouette?, ...}>
//   }
//
// Layout:
//   - 3 horizontal tracks, one per parent karyotype stratum
//   - Each track shows per-window inner-band-candidate squares
//     (size = silhouette quality), plus highlighted bars for the
//     contiguous inner intervals
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

const STRATA = Object.freeze(['HOM1', 'HET', 'HOM2']);

const STRATUM_COLORS = Object.freeze({
  HOM1: '#3074C8',
  HET:  '#D8A030',
  HOM2: '#D04545',
});

const VERDICT_LABEL = Object.freeze({
  nested_detected:      'Nested detected',
  no_nested_structure:  'No nested structure',
  insufficient_data:    'Insufficient data',
});

const INTERVAL_FILL = 'rgba(245, 165, 36, 0.35)';
const INTERVAL_STROKE = 'rgba(245, 165, 36, 0.95)';

// =====================================================================
// 1. Verdict colour
// =====================================================================

/**
 * Map a verdict string to a CSS colour for the badge.
 *
 * @param {string} verdict
 * @returns {string}
 */
export function verdictColor(verdict) {
  switch (verdict) {
    case 'nested_detected':     return '#D04545';
    case 'no_nested_structure': return '#2BAA50';
    case 'insufficient_data':   return '#888888';
    default:                    return '#888888';
  }
}

/** Human-friendly verdict label. */
export function verdictLabel(verdict) {
  return VERDICT_LABEL[verdict] || (verdict || '—');
}

// =====================================================================
// 2. Window-count helper
// =====================================================================

/**
 * Find the maximum window index referenced in the result, used as the
 * x-axis extent. Returns 0 when the result is empty.
 *
 * @param {Object} result
 * @returns {number}
 */
export function totalWindowCount(result) {
  if (!result) return 0;
  let max = -1;
  const psc = result.per_stratum_candidates || {};
  for (const s of STRATA) {
    const arr = psc[s];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      if (Number.isFinite(c.window_idx) && c.window_idx > max) max = c.window_idx;
      if (Number.isFinite(c.window_end) && c.window_end > max) max = c.window_end;
    }
  }
  const intervals = Array.isArray(result.inner_intervals) ? result.inner_intervals : [];
  for (const iv of intervals) {
    if (Number.isFinite(iv.window_end) && iv.window_end > max) max = iv.window_end;
  }
  return Math.max(0, max + 1);
}

// =====================================================================
// 3. Painter
// =====================================================================

/**
 * Paint the three-stratum nested-detector tracks.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} result
 * @param {Object} [opts]
 *   n_windows?:       number   (defaults to totalWindowCount(result))
 *   hovered_band_id?: number|null
 *   hovered_interval_idx?: number|null
 *   font_size?:       number
 * @returns {{
 *   band_hit_regions: Array<{stratum:string, band_id:number, candidate_idx:number,
 *                            x:number, y:number, w:number, h:number}>,
 *   interval_hit_regions: Array<{interval_idx:number,
 *                            x:number, y:number, w:number, h:number}>,
 * }}
 */
export function paintNestedTracks(canvas, result, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { band_hit_regions: [], interval_hit_regions: [] };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 160;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!result) return { band_hit_regions: [], interval_hit_regions: [] };

  const nWin = Number.isFinite(o.n_windows) ? o.n_windows : totalWindowCount(result);
  if (nWin <= 0) return { band_hit_regions: [], interval_hit_regions: [] };

  const labelPad = 36;
  const xPad = 8;
  const yPad = 8;
  const trackGap = 4;
  const drawW = Math.max(50, W - 2 * xPad - labelPad);
  const drawH = Math.max(30, H - 2 * yPad);
  const trackH = (drawH - 2 * trackGap) / 3;
  const cellW = drawW / nWin;
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  ctx.font = fontSize + 'px sans-serif';

  const band_hits = [];
  const psc = result.per_stratum_candidates || {};

  // Track strip + label + candidate cells per stratum.
  STRATA.forEach((stratum, si) => {
    const y0 = yPad + si * (trackH + trackGap);
    // Label.
    ctx.fillStyle = 'rgba(40, 50, 70, 0.85)';
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(stratum, xPad, y0 + fontSize + (trackH - fontSize) / 2);
    }
    // Track baseline.
    ctx.strokeStyle = 'rgba(40, 50, 70, 0.35)';
    ctx.lineWidth = 1;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(xPad + labelPad, y0, drawW, trackH);
    }
    // Candidate bars.
    const cands = Array.isArray(psc[stratum]) ? psc[stratum] : [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const ws = Number.isFinite(c.window_start) ? c.window_start
              : Number.isFinite(c.window_idx) ? c.window_idx : null;
      if (ws == null) continue;
      const we = Number.isFinite(c.window_end) ? c.window_end : ws;
      const xa = xPad + labelPad + ws * cellW;
      const xb = xPad + labelPad + (we + 1) * cellW;
      const w = Math.max(1, xb - xa);
      // Silhouette → vertical fill height (0..1 mapped to trackH).
      const sil = Number.isFinite(c.silhouette)
        ? Math.max(0, Math.min(1, c.silhouette)) : 0.5;
      const fh = Math.max(2, sil * (trackH - 4));
      const yc = y0 + (trackH - fh) / 2;
      ctx.fillStyle = STRATUM_COLORS[stratum] || '#888';
      if (typeof ctx.fillRect === 'function') ctx.fillRect(xa, yc, w, fh);
      band_hits.push({
        stratum,
        band_id: band_hits.length,
        candidate_idx: i,
        x: xa, y: yc, w, h: fh,
      });
    }
  });

  // Inner-interval overlays span all three tracks.
  const intervals = Array.isArray(result.inner_intervals) ? result.inner_intervals : [];
  const iv_hits = [];
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    const ws = Number.isFinite(iv.window_start) ? iv.window_start : null;
    const we = Number.isFinite(iv.window_end) ? iv.window_end : ws;
    if (ws == null) continue;
    const xa = xPad + labelPad + ws * cellW;
    const xb = xPad + labelPad + (we + 1) * cellW;
    const w = Math.max(1, xb - xa);
    ctx.fillStyle = INTERVAL_FILL;
    if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(xa, yPad, w, drawH);
    }
    const hovered = (o.hovered_interval_idx === i);
    ctx.strokeStyle = hovered ? '#f5a524' : INTERVAL_STROKE;
    ctx.lineWidth = hovered ? 2 : 1;
    if (typeof ctx.strokeRect === 'function') {
      ctx.strokeRect(xa, yPad + 0.5, w, drawH - 1);
    }
    ctx.lineWidth = 1;
    iv_hits.push({
      interval_idx: i,
      x: xa, y: yPad, w, h: drawH,
    });
  }

  return { band_hit_regions: band_hits, interval_hit_regions: iv_hits };
}

// =====================================================================
// 4. Hit-testing
// =====================================================================

export function findBandAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    if (px >= h.x && px <= h.x + h.w
        && py >= h.y && py <= h.y + h.h) {
      return h;
    }
  }
  return null;
}

export function findIntervalAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    if (px >= h.x && px <= h.x + h.w
        && py >= h.y && py <= h.y + h.h) {
      return h.interval_idx;
    }
  }
  return null;
}

/** Expose the stratum palette so the right-panel rows can match. */
export function stratumColor(stratum) {
  return STRATUM_COLORS[stratum] || '#888888';
}
