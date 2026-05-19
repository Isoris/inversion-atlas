// pages/discovery/local_pca_dosage/inheritance_tooltip.js
//
// Tooltip + hit-test layer for the I·g pill labels strip drawn by
// _drawInheritanceLabelsStrip in z_panel.js. Hovers a pill, surfaces
// the candidate's per-band fish counts and inheritance-group
// assignments. Legacy source: lines 45333-45469.
//
// Architecture mirrors band_trace_tooltip.js:
//   - The strip pushes hit rects onto state._inhPillHitRegions
//     (CSS coords scaled into the canvas's internal pixel space by the
//     wiring layer when the cursor moves).
//   - On every mousemove, the canvas runs through the regions; on a
//     hit, the tooltip HTML is built from the regions data + the
//     active inheritance result.
//
// Pure HTML builder is separated from show/hide so it can be tested
// in Node without a DOM.

import { karyoColor, inhGroupColor } from '../../../shared/color_helpers.js';

const TOOLTIP_EL_ID = 'inhPillTooltip';

// =====================================================================
// Hit-test
// =====================================================================

/**
 * Find the first hit region containing the cursor. Caller must already
 * have applied the canvas dpr → CSS-coord scaling (the strip stores
 * hits in canvas-internal pixel space; the wiring layer scales mouse
 * coords by canvas.width / rect.width to match).
 */
export function inhPillHitTest(regions, x, y) {
  if (!Array.isArray(regions) || regions.length === 0) return null;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (!r) continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

// =====================================================================
// Tooltip DOM
// =====================================================================

export function inhTooltipEnsureEl() {
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
 * Render the tooltip HTML for one pill. Pure: takes the hit region
 * + state and returns markup. No DOM access — testable in Node.
 *
 * @param {Object} hit
 *        { item_idx, seq_num, candidate_id, n_groups, start_bp, end_bp }
 * @param {Object} state  local_pca_dosage _pageState (read-only: looks up
 *                        inheritanceResult + candidates/_detailed)
 * @returns {string}
 */
export function inhTooltipBuildHtml(hit, state) {
  if (!hit) return '';
  const result = state && state.inheritanceResult;
  const i = hit.item_idx;
  let html = '';
  // Header: candidate id + bp span + group count
  html += `<div style="color:#f5a524;font-weight:bold;margin-bottom:4px;">`;
  html += `I${hit.seq_num} · ${hit.candidate_id}</div>`;
  html += `<div style="color:#a8b1c4;margin-bottom:6px;font-size:10px;">`;
  html += `${(hit.start_bp / 1e6).toFixed(2)} – ${(hit.end_bp / 1e6).toFixed(2)} Mb · `;
  html += `${hit.n_groups} inheritance group${hit.n_groups === 1 ? '' : 's'}</div>`;

  // Per-band composition row, when the inheritance result is fresh.
  if (result && result.cut && result.cut.group_id_per_band
      && result.items_meta && result.items_meta[i]
      && result.band_index) {
    const bandIdx = result.band_index;
    const groupPerBand = result.cut.group_id_per_band;
    const meta = result.items_meta[i];
    const itemBands = [];
    for (let bi = 0; bi < bandIdx.length; bi++) {
      if (bandIdx[bi].item_idx === i) {
        itemBands.push({ band: bandIdx[bi].band, group: groupPerBand[bi] });
      }
    }
    itemBands.sort((a, b) => a.band - b.band);
    if (itemBands.length > 0) {
      html += `<div style="color:var(--ink-dimmer,#7a8398);margin-bottom:3px;font-size:10px;">bands:</div>`;
      html += `<table style="border-collapse:collapse;">`;
      // Lookup the candidate to get locked_labels for fish counts
      const isDetailed = state && state.activeMode === 'detailed';
      const src = state && (isDetailed ? state.candidates_detailed : state.candidates);
      const cand = src && src[meta.id];
      const lockedLabels = (cand && cand.locked_labels) || null;
      for (const ib of itemBands) {
        const swatch = karyoColor(ib.band);
        const groupC = (ib.group != null) ? inhGroupColor(ib.group) : '#7a8398';
        // Count fish in this band
        let nFish = 0;
        if (lockedLabels) {
          for (let s = 0; s < lockedLabels.length; s++) {
            if (lockedLabels[s] === ib.band) nFish++;
          }
        }
        html += `<tr>`;
        html += `<td style="padding:1px 6px 1px 0;">`;
        html += `<span style="display:inline-block;width:8px;height:8px;background:${swatch};border-radius:1px;vertical-align:middle;margin-right:3px;"></span>`;
        html += `b${ib.band}</td>`;
        html += `<td style="padding:1px 6px 1px 0;color:#a8b1c4;">${nFish} fish</td>`;
        html += `<td style="padding:1px 0;">`;
        if (ib.group != null) {
          html += `<span style="display:inline-block;padding:1px 5px;background:${groupC};color:#1c2231;border-radius:2px;font-weight:bold;">g${ib.group}</span>`;
        } else {
          html += `<span style="color:var(--ink-dimmer,#7a8398);">—</span>`;
        }
        html += `</td>`;
        html += `</tr>`;
      }
      html += `</table>`;
    }
  } else {
    html += `<div style="color:var(--ink-dimmer,#7a8398);font-style:italic;">`;
    html += `composition unavailable (cache stale or no inheritance result)</div>`;
  }
  return html;
}

export function inhTooltipShow(hit, clientX, clientY, state) {
  const tip = inhTooltipEnsureEl();
  if (!tip) return;
  tip.innerHTML = inhTooltipBuildHtml(hit, state);
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

export function inhTooltipHide() {
  if (typeof document === 'undefined') return;
  const tip = document.getElementById(TOOLTIP_EL_ID);
  if (tip) tip.style.display = 'none';
}

// =====================================================================
// Canvas wiring
// =====================================================================

/**
 * Install hover handlers on a canvas to drive the I·g pill tooltip.
 * Idempotent. Scales CSS-pixel mouse coords by (canvas.width/rect.width)
 * to match the regions, which are stored in canvas-internal coords by
 * _drawInheritanceLabelsStrip (the strip renderer doesn't apply the
 * dpr setTransform that band-trace uses, hence the scaling here).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} state  local_pca_dosage _pageState
 */
export function wireInheritancePillTooltip(canvas, state) {
  if (!canvas || canvas.dataset.inhTooltipWired === '1') return;
  canvas.dataset.inhTooltipWired = '1';
  canvas.addEventListener('mousemove', (ev) => {
    const regions = state && state._inhPillHitRegions;
    if (!regions || regions.length === 0) { inhTooltipHide(); return; }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width  > 0 ? canvas.width  / rect.width  : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const x = (ev.clientX - rect.left) * scaleX;
    const y = (ev.clientY - rect.top)  * scaleY;
    const hit = inhPillHitTest(regions, x, y);
    if (hit) {
      inhTooltipShow(hit, ev.clientX, ev.clientY, state);
      canvas.style.cursor = 'help';
    } else {
      inhTooltipHide();
      canvas.style.cursor = 'crosshair';
    }
  });
  canvas.addEventListener('mouseleave', inhTooltipHide);
}
