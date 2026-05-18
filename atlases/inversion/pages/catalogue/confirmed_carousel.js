// Atlas/inversion_catalogue/confirmed_carousel.js
// =============================================================================
// confirmed_carousel — Confirmed candidates carousel
// (`<div id="confirmed_carousel">` contains the prev/next nav bar and meta slot)
//
// Source: legacy/Inversion_atlas.html lines 7782–7812 (HTML shell only)
//
// IMPORTANT: A grep of the legacy file reveals the confirmed_carousel carousel JS does
// NOT EXIST in legacy/Inversion_atlas.html. The HTML shell is wired with
// IDs (#confirmedNavBar, #confirmedNavPrev, #confirmedNavNext,
// #confirmedNavInfo, #confirmedCandidateMeta, #confirmedEmpty) but no
// JavaScript file in the legacy drop populates or wires them. The page is
// effectively a stub even in the legacy build — pressing the confirmed_carousel tab
// shows the empty-state message at #confirmedEmpty.
//
// Confirmed by:
//   $ grep -n 'confirmedNav' legacy/Inversion_atlas.html
//   7783: <div id="confirmedNavBar" ...
//   7787: <button id="confirmedNavPrev" ...
//   7793: <button id="confirmedNavNext" ...
//   (all hits are HTML only — no JS handlers)
//
// What the page is supposed to do (per the page-tab tooltip at legacy
// line 5076 and the empty-state copy at legacy lines 7802–7811):
//   "Carousel walk-through of all candidates marked confirmed on page 2."
//   - state.candidateList.filter(c => c.confirmed === true)
//   - prev/next buttons cycle through the confirmed set
//   - reuses the page2 candidate-focus rendering for the current candidate
//
// External dependencies (when wired up):
//   TODO_MISSING(_renderConfirmedCarousel)
//     — full carousel renderer (does not exist yet in legacy)
//   TODO_MISSING(_wireConfirmedCarouselNav)
//     — keydown ←/→ + button click handlers (does not exist yet)
//   TODO_MISSING(renderCandidateFocus)  — owned by Batch 1 (page2)
//     — the confirmed_carousel carousel reuses page2's candidate-focus renderer for
//       the currently-displayed confirmed candidate
//   global `state`                — reads state.candidateList,
//                                   state.confirmedCarouselIndex (new)
//
// Decision for this batch: ship a no-op shell with the public entry,
// matching the legacy behaviour (showing the empty-state message). The
// merge chat — or a follow-up batch — implements the real carousel.
// =============================================================================

import { _pageState, _setActiveState } from './confirmed_carousel/_state.js';
import {
  renderConfirmedCarousel,
  wireConfirmedCarouselNav,
  teardownConfirmedCarouselNav,
} from './confirmed_carousel/carousel.js';

/**
 * Public entry — state-aware wrapper. Sets _pageState before
 * delegating to the carousel renderer.
 */
export function refreshConfirmedCarousel(state) {
  if (state) _setActiveState(state);
  return renderConfirmedCarousel(_pageState);
}

/**
 * Wire the prev/next/keydown handlers. Idempotent (the carousel
 * module tears down any prior handlers internally before wiring
 * new ones).
 */
export function initConfirmedCarousel() {
  wireConfirmedCarouselNav(_pageState);
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 36 round 5 step 7, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to confirmed_carousel.
 *
 * Builds a legacy-shape state with the slots confirmed_carousel needs: candidateList
 * (read by refreshConfirmedCarousel to count confirmed candidates),
 * confirmedCarouselIndex (will be needed once the full carousel lands).
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshConfirmedCarousel(legacyState); }
  catch (e) { console.warn('confirmed_carousel.mount: refreshConfirmedCarousel threw —', e); }

  try { initConfirmedCarousel(); }
  catch (e) { console.warn('confirmed_carousel.mount: initConfirmedCarousel threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page9State = legacyState;
}

/**
 * Unmount: remove keydown / button handlers, clear _pageState so
 * post-unmount callbacks see null.
 */
export async function unmount(root) {
  try { teardownConfirmedCarouselNav(); }
  catch (e) { console.warn('confirmed_carousel.unmount: teardown threw —', e); }
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  legacy.candidateList            = inv.candidateList            || [];
  legacy.confirmedCarouselIndex   = inv.confirmedCarouselIndex   || 0;
  return legacy;
}
