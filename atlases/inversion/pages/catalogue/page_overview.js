// inversion_catalogue/page_overview.js
// =====================================================================
// Page "Overview" — synthesis-stage tab, declared but empty in legacy.
//
// Legacy state (Inversion_atlas.html line 9322):
//     <div id="page_overview" class="page"></div>
//
// The tab button exists at legacy line 5138 (data-page="page_overview"
// data-stage="synthesis") but no body and no render function were ever
// shipped. There are zero references to `renderOverview`, `renderPage_overview`,
// or `page_overview` in any JS scope of the legacy file — verified by
// `grep -niE "(renderOverview|page_overview|renderPageOverview)"`,
// which only returns the tab button and the empty <div>.
//
// This module exists so the page registry has a non-throwing entry for
// `page_overview`. If/when the synthesis overview gets designed, replace
// the body of renderPageOverview() with the real render logic and update
// page_overview.html with the panel skeleton.
//
// Round 5 step 8 (chat 36, 2026-05-07): refactored from chat-33 factory-
// only pattern (`wirePageOverview(state) → { renderPageOverview }`) to
// add the standard atlas-router lifecycle (mount/unmount/_pageState
// live-binding). The factory is RETAINED for backward-compat — anything
// that was importing wirePageOverview keeps working.
// =====================================================================

import { _pageState, _setActiveState } from './page_overview/_state.js';

/**
 * Internal: render the synthesis overview using _pageState.
 *
 * Current behaviour (matches legacy stub): no-op. The synthesis-stage
 * overview was scoped but never implemented in Inversion_atlas.html.
 * Future implementation should:
 *   (a) decide whether to drop the tab from the new build, OR
 *   (b) populate it with a high-level workflow summary
 *       (counts of candidates per stage, layer-presence checklist, etc.)
 */
function _renderPageOverview() {
  // TODO_MISSING(synthesis_overview_design) — legacy ships an empty stub.
  // No-op for now — keeps the empty <div> exactly as the legacy did.
  // When implemented, read from _pageState (currently always present
  // because mount/refresh sets it).
}

/**
 * Public entry — state-aware wrapper. Sets _pageState before delegating
 * so the (currently-empty) renderer sees live data.
 */
export function renderPageOverview(state) {
  if (state) _setActiveState(state);
  return _renderPageOverview();
}

/**
 * Backward-compat factory (legacy chat-33 surface). Retained so anything
 * importing `wirePageOverview` keeps working. The returned closure
 * shares state with the module-level _pageState via _setActiveState,
 * so the new lifecycle and the old factory both see the same data.
 */
export function wirePageOverview(state) {
  if (state) _setActiveState(state);
  return { renderPageOverview: _renderPageOverview };
}

export default wirePageOverview;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 36 round 5 step 8, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page_overview.
 *
 * Builds a legacy-shape state (currently a passthrough — page_overview
 * declares no requires_layers / requires_slots in pages.registry.json,
 * so there's nothing chrom-specific to wire). The mount is structured
 * the same as sibling pages so the future overview implementation can
 * read from atlasState.inversion + atlasState.shared without a
 * separate refactor.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { renderPageOverview(legacyState); }
  catch (e) { console.warn('page_overview.mount: renderPageOverview threw —', e); }

  if (atlasState.inversion) atlasState.inversion._pageOverviewState = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  // Pass-through: page_overview reads no specific state slots in the
  // current empty-stub implementation. When the real overview lands,
  // it'll likely want candidateList + layersPresent + ancestry-related
  // slots — those flow through Object.assign({}, inv) below.
  return Object.assign({}, inv);
}
