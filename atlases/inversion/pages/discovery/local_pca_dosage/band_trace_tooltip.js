// pages/discovery/local_pca_dosage/band_trace_tooltip.js
//
// Tooltip + hit-test layer for the band-trace strip (legacy lines
// 40026-40202). Surfaces hover details on the per-L2 stacked bars
// drawn by _drawBandTraceStrip in z_panel.js.
//
// Architecture:
//   - The strip renderer pushes a list of CSS-pixel-space hit rects
//     onto state._btraceHits (one per L2 column, carrying the
//     trace.per_l2[i] entry).
//   - On every mousemove, the wired-up canvas runs bandTraceHitTest
//     against those rects; on a hit, the tooltip HTML is built from
//     the entry and shown with edge-clamping.
//
// The HTML builder is split out from the show/hide pair so it can be
// unit-tested against a synthetic hit without a DOM.

import { BTRACE_REGIME_COLOR } from '../../../shared/band_trace.js';
import { karyoColor } from '../../../shared/color_helpers.js';

// =====================================================================
// Hit-test (legacy 40160-40171)
// =====================================================================

/**
 * Find the first hit rect that contains the cursor. Hits are stored in
 * CSS-pixel space (the canvas is setTransform'd to dpr before drawing
 * so the renderer's pad/plotW/plotH are CSS pixels; mouse coords from
 * getBoundingClientRect are also CSS pixels — no DPR multiplication).
 *
 * Rectangles do not overlap (each L2 column is disjoint), so first hit
 * is the only hit.
 *
 * @param {Array<{x:number,y:number,w:number,h:number}>} hits
 * @param {number} mouseX  CSS-pixel x relative to canvas
 * @param {number} mouseY
 * @returns {object|null}
 */
export function bandTraceHitTest(hits, mouseX, mouseY) {
  if (!Array.isArray(hits) || hits.length === 0) return null;
  for (let i = 0; i < hits.length; i++) {
    const r = hits[i];
    if (!r) continue;
    if (mouseX >= r.x && mouseX <= r.x + r.w &&
        mouseY >= r.y && mouseY <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

// =====================================================================
// Tooltip DOM (legacy 40028-40149)
// =====================================================================

const TOOLTIP_EL_ID = 'btracePointTooltip';

/**
 * Get-or-create the singleton tooltip element. Returns null in headless
 * environments (no document).
 */
export function bandTraceTooltipEnsureEl() {
  if (typeof document === 'undefined') return null;
  let tip = document.getElementById(TOOLTIP_EL_ID);
  if (tip) return tip;
  tip = document.createElement('div');
  tip.id = TOOLTIP_EL_ID;
  tip.style.cssText = 'position:fixed; pointer-events:none; z-index:10000;'
                    + 'background:#0f1422; color:#e8edf6; border:1px solid #3a4560;'
                    + 'border-radius:4px; padding:8px 10px; font-family:var(--mono,monospace);'
                    + 'font-size:11px; line-height:1.5; max-width:320px;'
                    + 'box-shadow:0 6px 20px rgba(0,0,0,0.5); display:none;';
  document.body.appendChild(tip);
  return tip;
}

/**
 * Render the tooltip HTML for one hit. Pure: takes the hit + optional
 * context (n_chains, n_fish_selected) and returns the markup. No DOM
 * access — testable in Node.
 *
 * @param {object} hit  Hit rect with at least { l2_idx, entry } where
 *                      `entry` is the trace's per_l2[i] record.
 * @param {{n_chains?: number, n_fish_selected?: number}} [opts]
 * @returns {string}
 */
export function bandTraceTooltipBuildHtml(hit, opts) {
  if (!hit || !hit.entry) return '';
  opts = opts || {};
  const e = hit.entry;
  const regimeC = BTRACE_REGIME_COLOR[e.regime] || BTRACE_REGIME_COLOR.no_valid;

  let html = '';
  // Header line — L2 index + regime chip
  html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">';
  html += '<span style="color:#f5a524;font-weight:bold;">L2 #' + ((hit.l2_idx | 0)) + '</span>';
  html += '<span style="display:inline-block;padding:1px 6px;background:' + regimeC
       +  ';color:#1c2231;border-radius:2px;font-weight:bold;font-size:10px;">'
       +  (e.regime || '?') + '</span>';
  // chain_idx is interesting only when there are multiple chains.
  if (opts.n_chains && opts.n_chains > 1) {
    html += '<span style="color:var(--ink-dimmer,#7a8398);font-size:10px;">chain '
         +  (e.chain_idx | 0) + '</span>';
  }
  html += '</div>';

  // Body table — n_valid, dominant_band/fraction, entropy
  html += '<table style="border-collapse:collapse;font-size:10px;">';
  html += '<tr><td style="color:#7a8398;padding:1px 8px 1px 0;">n_valid:</td>';
  html += '<td style="color:#e8edf6;font-family:var(--mono,monospace);">' + (e.n_valid | 0)
       +  (opts.n_fish_selected ? ' / ' + (opts.n_fish_selected | 0) : '') + '</td></tr>';
  if (e.dominant_band != null && e.dominant_band >= 0) {
    const swatch = karyoColor(e.dominant_band);
    html += '<tr><td style="color:#7a8398;padding:1px 8px 1px 0;">dominant:</td>';
    html += '<td style="color:#e8edf6;">';
    html += '<span style="display:inline-block;width:8px;height:8px;background:' + swatch
         +  ';border-radius:1px;vertical-align:middle;margin-right:3px;"></span>';
    html += 'b' + (e.dominant_band | 0);
    html += ' (' + (Number.isFinite(e.dominant_fraction)
                    ? (e.dominant_fraction * 100).toFixed(1) : '?') + '%)';
    html += '</td></tr>';
  }
  html += '<tr><td style="color:#7a8398;padding:1px 8px 1px 0;">entropy:</td>';
  html += '<td style="color:#e8edf6;font-family:var(--mono,monospace);">'
       +  (Number.isFinite(e.entropy) ? e.entropy.toFixed(3) : 'NA') + '</td></tr>';
  html += '</table>';

  // Per-band fractions (only for L2s with valid data).
  if (e.regime !== 'no_valid' && e.band_fractions && e.band_fractions.length) {
    html += '<div style="color:#7a8398;font-size:10px;margin-top:4px;">band fractions:</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">';
    for (let k = 0; k < e.band_fractions.length; k++) {
      const frac = e.band_fractions[k] || 0;
      if (frac <= 0) continue;
      const sw = karyoColor(k);
      html += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;">';
      html += '<span style="display:inline-block;width:8px;height:8px;background:' + sw
           +  ';border-radius:1px;"></span>';
      html += 'b' + k + ' ' + (frac * 100).toFixed(0) + '%';
      html += '</span>';
    }
    html += '</div>';
  }

  return html;
}

/**
 * Position + show the tooltip at the given client (viewport) coords.
 * Edge-clamps so the tooltip stays inside the viewport.
 */
export function bandTraceTooltipShow(hit, clientX, clientY, opts) {
  const tip = bandTraceTooltipEnsureEl();
  if (!tip) return;
  tip.innerHTML = bandTraceTooltipBuildHtml(hit, opts);
  tip.style.display = 'block';
  const margin = 12;
  const vw = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
  const vh = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 800;
  const rect = tip.getBoundingClientRect();
  let x = clientX + margin;
  let y = clientY + margin;
  if (x + rect.width  > vw - 8) x = clientX - rect.width  - margin;
  if (y + rect.height > vh - 8) y = clientY - rect.height - margin;
  tip.style.left = Math.max(4, x) + 'px';
  tip.style.top  = Math.max(4, y) + 'px';
}

/** Hide the singleton tooltip. No-op in headless environments. */
export function bandTraceTooltipHide() {
  if (typeof document === 'undefined') return;
  const tip = document.getElementById(TOOLTIP_EL_ID);
  if (tip) tip.style.display = 'none';
}

// =====================================================================
// Canvas wiring (legacy 40178-40202)
// =====================================================================

/**
 * Install hover handlers on the lines-panel PC1 sub-canvas to drive the
 * band-trace tooltip. Idempotent — only attaches once per canvas via a
 * dataset marker. Reads hit-list + trace from state on every move so
 * re-renders that mutate state._btraceHits / state.bandTraceCache are
 * picked up without rewiring.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} state  local_pca_dosage _pageState (for bandTraceOn,
 *                        _btraceHits, bandTraceCache reads)
 */
export function wireBandTraceTooltip(canvas, state) {
  if (!canvas || canvas.dataset.btraceTooltipWired === '1') return;
  canvas.dataset.btraceTooltipWired = '1';
  canvas.addEventListener('mousemove', (ev) => {
    if (!state || !state.bandTraceOn) { bandTraceTooltipHide(); return; }
    const hits = state._btraceHits;
    if (!hits || hits.length === 0) { bandTraceTooltipHide(); return; }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hit = bandTraceHitTest(hits, x, y);
    if (hit) {
      const trace = state.bandTraceCache;
      bandTraceTooltipShow(hit, ev.clientX, ev.clientY, {
        n_chains: trace ? trace.n_chains : 1,
        n_fish_selected: trace ? trace.n_fish_selected : 0,
      });
    } else {
      bandTraceTooltipHide();
    }
  });
  canvas.addEventListener('mouseleave', bandTraceTooltipHide);
}
