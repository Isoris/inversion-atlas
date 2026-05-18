// pages/discovery/local_pca_dosage/fish_inspect_popover.js
//
// Fish-inspect popover for the per-sample lines panel (legacy lines
// 57671-57804). Clicking near a tracked fish's PC1 trace opens a
// floating card with that fish's call data (regime, confidence, votes,
// sub-bands) for the currently-active candidate.
//
// Architecture is split so the hit-test + HTML builder run without a
// DOM (testable in Node) while the show/wire half handles positioning
// and lifecycle.
//
// The legacy version read state, getLinesValuesAt, getLinesSignAt as
// globals; here state is the first argument of every entry point and
// the data helpers are explicit ES imports.

import {
  getLinesValuesAt,
  getLinesSignAt,
} from '../../../shared/page1_data_helpers.js';

const POPOVER_EL_ID = 'fishInspectPopover';

/** Hit-test tolerance (vertical px) between click and a tracked line. */
export const FIP_HIT_TOL_PX = 8;

// =====================================================================
// Hit-test (pure)
// =====================================================================

/**
 * Resolve which tracked sample (if any) the click is closest to in the
 * PC1 panel. Returns `{ si, wi, dy }` on hit, null on miss.
 *
 * When `forceSi` is provided, the lookup picks that specific sample and
 * skips the FIP_HIT_TOL_PX distance gate — used when the caller already
 * knows which fish to show (e.g. a marker click).
 *
 * Pure: takes state explicitly, reads only state.__linesGeom['pc1'],
 * state.data.windows, and state.tracked. No DOM access.
 *
 * @param {Object} state   local_pca_dosage _pageState
 * @param {number} px      cursor x in canvas CSS coords
 * @param {number} py      cursor y in canvas CSS coords
 * @param {number} [forceSi] override the hit-test, pick this sample
 * @returns {{ si: number, wi: number, dy: number } | null}
 */
export function fishInspectHitTest(state, px, py, forceSi) {
  if (!state) return null;
  if (!state.tracked || state.tracked.length === 0) return null;
  const geom = state.__linesGeom && state.__linesGeom['pc1'];
  if (!geom) return null;
  const fracX = (px - geom.pad.l) / geom.plotW;
  if (fracX < 0 || fracX > 1) return null;
  const mb = geom.mbMin + fracX * (geom.mbMax - geom.mbMin);
  const d = state.data;
  if (!d) return null;
  const wins = d.windows;
  if (!wins || wins.length === 0) return null;

  // Closest window by center_mb (linear scan — one click, fine).
  let bestWi = 0, bestDist = Math.abs(wins[0].center_mb - mb);
  for (let wi = 1; wi < wins.length; wi++) {
    const dst = Math.abs(wins[wi].center_mb - mb);
    if (dst < bestDist) { bestDist = dst; bestWi = wi; }
  }

  const valsRaw = getLinesValuesAt(state, bestWi, 'pc1');
  const sign = getLinesSignAt(state, bestWi, 'pc1');
  if (!valsRaw) return null;

  const toY = (v) =>
    geom.pad.t + geom.plotH - ((v - geom.yMin) / (geom.yMax - geom.yMin)) * geom.plotH;

  if (forceSi != null && forceSi >= 0) {
    return { si: forceSi | 0, wi: bestWi, dy: 0 };
  }
  let bestSi = -1, bestDy = Infinity;
  for (const si of state.tracked) {
    const v = valsRaw[si] * sign;
    if (!isFinite(v)) continue;
    const yp = toY(v);
    const dy = Math.abs(yp - py);
    if (dy < bestDy) { bestDy = dy; bestSi = si; }
  }
  if (bestSi < 0 || bestDy > FIP_HIT_TOL_PX) return null;
  return { si: bestSi, wi: bestWi, dy: bestDy };
}

// =====================================================================
// HTML builder (pure)
// =====================================================================

/**
 * Render the popover body for a hit. Pure: takes state + the resolved
 * sample index. Returns the markup string. No DOM access.
 *
 * @param {Object} state
 * @param {number} si  resolved sample index from fishInspectHitTest
 * @returns {string}
 */
export function fishInspectBuildHtml(state, si) {
  const cand = state && state.candidate;
  if (!cand) return '';
  const d = state.data || {};
  const fc = (Array.isArray(cand.fish_calls) ? cand.fish_calls[si] : null) || null;
  const sample = (d.samples && d.samples[si]) || {};
  const sampleId = sample.cga || sample.ind || ('s' + si);
  const candShortId = (cand.id || '').replace(/^cand_/, '');

  let html = '';
  html += `<div class="fip-head">`;
  html += `<span class="fip-id">${sampleId}</span>`;
  html += `<span class="fip-cand">${candShortId}</span>`;
  html += `<button class="fip-close" type="button" title="Close">×</button>`;
  html += `</div>`;
  if (!fc) {
    html += `<div class="fip-row"><span class="fip-lbl">no call</span>`
         +  `<span class="fip-val">No fish call data for this sample × candidate</span></div>`;
    return html;
  }
  const regimeStr = fc.ambiguous
    ? '<span class="ambig">ambiguous</span>'
    : `g${fc.regime}`;
  html += `<div class="fip-row"><span class="fip-lbl">regime</span>`
       +  `<span class="fip-val">${regimeStr}</span></div>`;
  html += `<div class="fip-row"><span class="fip-lbl">confidence</span>`
       +  `<span class="fip-val">${fc.confidence != null ? fc.confidence.toFixed(3) : 'NA'}`
       +  ` (${fc.n_supporting}/${fc.n_intervals})</span></div>`;
  if (fc.subband_stability != null) {
    const stability = fc.subband_stability.toFixed(3);
    const stabClass = fc.subband_stability < 1 ? 'ambig' : '';
    html += `<div class="fip-row"><span class="fip-lbl">stability</span>`
         +  `<span class="fip-val ${stabClass}">${stability}</span></div>`;
  }
  if (Array.isArray(fc.votes)) {
    const tokens = fc.votes.map(v => {
      if (v < 0) return `<span class="vote-token">.</span>`;
      const cls = (fc.regime != null && v !== fc.regime)
        ? 'vote-token jumped'
        : 'vote-token consensus';
      return `<span class="${cls}">g${v}</span>`;
    }).join('');
    html += `<div class="fip-row"><span class="fip-lbl">votes (K=3)</span>`
         +  `<span class="fip-val">${tokens}</span></div>`;
  }
  if (Array.isArray(fc.subband_path)) {
    const tokens = fc.subband_path
      .map(s => `<span class="sub-token">${s || '.'}</span>`)
      .join('');
    html += `<div class="fip-row"><span class="fip-lbl">sub-bands (K=6)</span>`
         +  `<span class="fip-val">${tokens}</span></div>`;
  }
  return html;
}

// =====================================================================
// Show / dismiss (DOM-bound)
// =====================================================================

function _dismissPopover(pop, outsideHandler) {
  if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
  if (typeof document !== 'undefined' && document.removeEventListener && outsideHandler) {
    document.removeEventListener('click', outsideHandler, true);
  }
}

/**
 * Open the popover at the cursor for the given hit. Headless-safe: no-op
 * (returns false) when document is undefined or the hit is null.
 *
 * @param {Object} state
 * @param {{si:number, wi:number, dy:number}} hit
 * @param {{clientX:number, clientY:number}} clickEvent
 * @returns {boolean}  true when the popover was opened
 */
export function showFishInspectPopover(state, hit, clickEvent) {
  if (!hit || typeof document === 'undefined') return false;
  const html = fishInspectBuildHtml(state, hit.si);
  if (!html) return false;

  let pop = document.getElementById(POPOVER_EL_ID);
  if (!pop) {
    pop = document.createElement('div');
    pop.id = POPOVER_EL_ID;
    document.body.appendChild(pop);
  }
  pop.innerHTML = html;

  // Initial position
  pop.style.display = '';
  pop.style.left = `${clickEvent.clientX + 12}px`;
  pop.style.top  = `${clickEvent.clientY + 8}px`;

  // Edge-clamp
  const popRect = pop.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth)  || 1024;
  const vh = (typeof window !== 'undefined' && window.innerHeight) ||  768;
  if (popRect.right > vw - 8) {
    pop.style.left = `${Math.max(8, clickEvent.clientX - popRect.width - 12)}px`;
  }
  if (popRect.bottom > vh - 8) {
    pop.style.top  = `${Math.max(8, clickEvent.clientY - popRect.height - 8)}px`;
  }

  // Close button + click-outside dismissal
  const closeBtn = pop.querySelector ? pop.querySelector('.fip-close') : null;
  let outsideHandler = null;
  const dismiss = () => _dismissPopover(pop, outsideHandler);
  outsideHandler = (ev) => {
    if (!pop || !pop.contains) return;
    if (pop.contains(ev.target)) return;
    dismiss();
  };
  if (closeBtn) closeBtn.addEventListener('click', dismiss);
  // Defer outside-click listener so the originating click doesn't
  // immediately dismiss the popover.
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', outsideHandler, true);
      }
    }, 0);
  }
  return true;
}

/**
 * Compose hit-test + render. Returns true when a popover opened.
 *
 * @param {Event} clickEvent
 * @param {HTMLCanvasElement} cv  the PC1 sub-canvas
 * @param {Object} state
 * @param {number} [forceSi]
 * @returns {boolean}
 */
export function maybeShowFishInspectPopover(clickEvent, cv, state, forceSi) {
  if (!cv || !cv.getBoundingClientRect) return false;
  const rect = cv.getBoundingClientRect();
  const px = clickEvent.clientX - rect.left;
  const py = clickEvent.clientY - rect.top;
  const hit = fishInspectHitTest(state, px, py, forceSi);
  if (!hit) return false;
  return showFishInspectPopover(state, hit, clickEvent);
}
