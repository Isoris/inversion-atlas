// pages/discovery/page_fingerprint_track/renderer.js
// =====================================================================
// Canvas-based renderer for the fingerprint track. Consumes the
// output of shared/mgl_fingerprinter.fingerprintCandidate and paints
// a horizontal regime strip + switch markers along the candidate.
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

import { MGL_SWITCH_TYPES } from '../../../shared/mgl_fingerprinter.js';

// =====================================================================
// 1. Defaults
// =====================================================================

const DEFAULT_REGIME_PALETTE = [
  '#888888',  // regime 0 = missing data
  '#3074C8',
  '#2BAA50',
  '#D04545',
  '#A060B8',
  '#D8A030',
  '#3DB5C0',
  '#C06080',
  '#60A030',
  '#705090',
];

const SWITCH_GLYPH = {
  [MGL_SWITCH_TYPES.RETURN_SWITCH]:   '▲',
  [MGL_SWITCH_TYPES.TERMINAL_SWITCH]: '▼',
  [MGL_SWITCH_TYPES.BRIEF_SWITCH]:    '·',
};

// =====================================================================
// 2. Colour map for regime IDs
// =====================================================================

/**
 * Build a stable colour mapping from regime_id → CSS colour.
 *
 * @param {number} n_regimes
 * @param {Object<number,string>} [overrides]
 * @returns {Object<number,string>}
 */
export function buildRegimeColorMap(n_regimes, overrides) {
  const out = Object.create(null);
  const n = Math.max(0, n_regimes | 0);
  for (let r = 0; r <= n; r++) {
    out[r] = DEFAULT_REGIME_PALETTE[r % DEFAULT_REGIME_PALETTE.length];
  }
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      out[k] = overrides[k];
    }
  }
  return out;
}

// =====================================================================
// 3. Painter
// =====================================================================

/**
 * Paint the fingerprint track on a canvas.
 *
 *   Layout (top to bottom):
 *     switch row     (markers above the track)
 *     track row      (coloured regime segments)
 *     label row      (optional window labels)
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} fingerprint_result   shared/mgl_fingerprinter output
 * @param {Object} [opts]
 *   regime_colors_by_id?: Object<number,string>
 *   show_brief_switches?: boolean    default false
 *   show_labels?:         boolean    default true
 *   hovered_window?:      number|null
 *   hovered_switch?:      number|null
 *   selected_windows?:    Set<number>
 *   window_labels?:       Array<string>  per-window label, optional
 *   font_size?:           number
 * @returns {{
 *   window_hit_regions: Array<{window_idx:number, x:number, y:number,
 *                              w:number, h:number, regime_id:number}>,
 *   switch_hit_regions: Array<{switch_idx:number, x:number, y:number,
 *                              r:number, type:string}>,
 * }}
 */
export function paintFingerprintTrack(canvas, fingerprint_result, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { window_hit_regions: [], switch_hit_regions: [] };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 120;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);

  if (!fingerprint_result
      || !Array.isArray(fingerprint_result.windows)
      || fingerprint_result.windows.length === 0) {
    return { window_hit_regions: [], switch_hit_regions: [] };
  }

  const windows = fingerprint_result.windows;
  const n = windows.length;
  const xPad = 8;
  const yPad = 6;
  const switchRowH = 18;
  const labelRowH = (o.show_labels !== false) ? 16 : 0;
  const trackY = yPad + switchRowH;
  const trackH = Math.max(12, H - 2 * yPad - switchRowH - labelRowH);
  const drawW = Math.max(50, W - 2 * xPad);
  const cellW = drawW / n;

  const colors = o.regime_colors_by_id
    || buildRegimeColorMap(fingerprint_result.n_regimes || 0);
  const selected = (o.selected_windows instanceof Set) ? o.selected_windows : null;
  const hoveredW = Number.isFinite(o.hovered_window) ? o.hovered_window : null;
  const hoveredS = Number.isFinite(o.hovered_switch) ? o.hovered_switch : null;
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  ctx.font = fontSize + 'px sans-serif';

  // --------------------------------------------------------------- track
  const window_hit_regions = [];
  for (let i = 0; i < n; i++) {
    const w = windows[i];
    const regime = w.regime_id | 0;
    const x = xPad + i * cellW;
    const y = trackY;
    ctx.fillStyle = colors[regime] || colors[0] || '#888888';
    if (typeof ctx.fillRect === 'function') ctx.fillRect(x, y, cellW + 0.5, trackH);
    if (hoveredW === i || (selected && selected.has(i))) {
      ctx.strokeStyle = (selected && selected.has(i)) ? '#000000' : '#f5a524';
      ctx.lineWidth = 2;
      if (typeof ctx.stroke === 'function') {
        if (typeof ctx.beginPath === 'function') ctx.beginPath();
        if (typeof ctx.moveTo === 'function') {
          ctx.moveTo(x, y);
          ctx.lineTo(x + cellW, y);
          ctx.moveTo(x, y + trackH);
          ctx.lineTo(x + cellW, y + trackH);
        }
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    window_hit_regions.push({
      window_idx: i,
      x, y,
      w: cellW,
      h: trackH,
      regime_id: regime,
    });
  }

  // Outline the track.
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(xPad, trackY, drawW, trackH);
  }

  // ------------------------------------------------------------ switches
  const switch_hit_regions = [];
  const switches = Array.isArray(fingerprint_result.switches)
    ? fingerprint_result.switches
    : [];
  const showBrief = !!o.show_brief_switches;
  for (let s = 0; s < switches.length; s++) {
    const sw = switches[s];
    const isBrief = sw.type === MGL_SWITCH_TYPES.BRIEF_SWITCH;
    if (isBrief && !showBrief) continue;
    const startX = xPad + sw.window_start * cellW;
    const endX   = xPad + (sw.window_end + 1) * cellW;
    const midX   = (startX + endX) / 2;
    const sy     = yPad + switchRowH / 2;
    const r      = Math.min(8, switchRowH / 2 - 2);

    // Glyph
    const glyph = SWITCH_GLYPH[sw.type] || '?';
    ctx.fillStyle = (hoveredS === s) ? '#f5a524' : 'rgba(40, 50, 70, 0.95)';
    if (typeof ctx.fillText === 'function') {
      ctx.fillText(glyph, midX - fontSize / 2, sy + fontSize / 3);
    }
    switch_hit_regions.push({
      switch_idx: s,
      x: midX,
      y: sy,
      r: r + 4,
      type: sw.type,
    });
  }

  // -------------------------------------------------------------- labels
  if (o.show_labels !== false && labelRowH > 0) {
    ctx.fillStyle = 'rgba(40, 50, 70, 0.7)';
    const labels = Array.isArray(o.window_labels) ? o.window_labels : null;
    // Show ~10 labels max to avoid crowding.
    const stride = Math.max(1, Math.ceil(n / 10));
    const ly = trackY + trackH + fontSize + 2;
    for (let i = 0; i < n; i += stride) {
      const x = xPad + i * cellW + cellW / 2 - fontSize;
      const text = labels && labels[i] ? String(labels[i]) : String(i);
      if (typeof ctx.fillText === 'function') ctx.fillText(text, x, ly);
    }
  }

  return { window_hit_regions, switch_hit_regions };
}

// =====================================================================
// 4. Hit testing
// =====================================================================

/**
 * Find the window-index under a canvas pixel, or null.
 *
 * @param {Array<{window_idx:number, x:number, y:number,
 *                w:number, h:number}>} hitRegions
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findWindowAtPixel(hitRegions, px, py) {
  if (!Array.isArray(hitRegions)) return null;
  for (const h of hitRegions) {
    if (px >= h.x && px <= h.x + h.w
        && py >= h.y && py <= h.y + h.h) {
      return h.window_idx;
    }
  }
  return null;
}

/**
 * Find the switch-index under a canvas pixel, or null.
 *
 * @param {Array<{switch_idx:number, x:number, y:number, r:number}>} hitRegions
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findSwitchAtPixel(hitRegions, px, py) {
  if (!Array.isArray(hitRegions)) return null;
  for (const h of hitRegions) {
    const dx = px - h.x, dy = py - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h.switch_idx;
  }
  return null;
}
