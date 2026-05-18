// Atlas/inversion_comparative/help.js
// =============================================================================
// help — Quick-reference / help page (static)
// (`<div id="help">` — ~1158 LOC of declarative help/vocabulary/hotkeys/
//  pipeline reference content; no interactive elements that require JS)
//
// Source: legacy/Inversion_atlas.html lines 8159-9316 (HTML help content) +
// CSS at lines 2054-2071. Only JS reference is the tabBar router at line
// 5142 (data-page="help" data-stage="help") and a single dispatch at line
// 27509 in _renderMultiSpeciesPage's tabBar refresh logic.
//
// IMPORTANT — handoff doc / actual content discrepancy (chat-33 finding,
// preserved here for posterity):
//   HANDOFF_BATCH_5.md described help as 'Multi-species comparison page
//   (Pairwise dotplots, synteny graph, breakpoint annotations)' at legacy
//   lines 8159-9316. In legacy/Inversion_atlas.html, lines 8159-9316 are
//   actually the static QUICK-REFERENCE / HELP page (data-page='help',
//   data-stage='help'). The actual multi-species cockpit is multi_species_cockpit
//   (lines 8033-8100; renderer _renderMultiSpeciesPage at legacy line
//   27497). multi_species_cockpit lives in multi_species_cockpit.js and remains unmigrated as of
//   round 5 step 16.
//
// Because help is purely declarative HTML (the help/vocabulary/hotkeys/
// pipeline reference content), it has NO dedicated render function in the
// legacy file. This module preserves the chat-33 stub: renderPage5() is a
// true no-op that exists so the page-loader can dispatch to help the
// same way it dispatches to other pages (uniform routing).
//
// Round-5-step-16 status: stub-preserving + lifecycle scaffolding (confirmed_carousel
// template applied to a page where the chat-33 export is also a no-op).
// This is a degenerate case of the "stub-preserving + one wired entry"
// pattern (round-5-step-15 local_pca_ghsl) — the wired entry exists and is
// called from mount(), but the entry itself is a no-op so mount()
// effectively does nothing beyond setting _pageState. The wrapper +
// lifecycle exist for future-proofing if help ever gains real
// renderable content.
//
// **Closing comparative tier-1**: with this round, help + cross_species_breakpoints are
// both migrated; only multi_species_cockpit (2416 LOC multi-species cockpit) remains
// in the comparative group (1 of 3 → 2 of 3).
// =============================================================================

import { _pageState, _setActiveState } from './help/_state.js';

// ---------------------------------------------------------------------------
// Chat-33 exports — PRESERVED VERBATIM (help.js round-5-step-16, no
// behavioural change to the help-page contract).
// ---------------------------------------------------------------------------

/**
 * renderPage5 — chat-33 stub. Help page is static HTML; nothing to do at
 * render time. The HTML content lives in help.html and is mounted by
 * the shell when the help tab activates.
 *
 * Signature unchanged from chat-33 extraction (takes optional state arg
 * per HANDOFF_BATCH_1 convention, even though it ignores it).
 */
export function renderPage5(/* state */) {
  // No-op. Help page is static HTML — nothing to do at render time.
  return;
}

/**
 * PAGE5_META — chat-33 export. Tab metadata used by the page-loader's
 * tabBar router (data-page="help", data-stage="help", num=16). The
 * `static: true` flag tells the loader help needs no JS render call.
 */
export const PAGE5_META = {
  id: 'help',
  stage: 'help',
  label: 'help',
  num: 16,  // tab number from legacy
  static: true,
};

// ---------------------------------------------------------------------------
// State-aware public wrapper (degenerate variant)
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around renderPage5. Mirrors the
 * confirmed_carousel / local_pca_ghsl wrapper pattern: if `state` is passed, sets _pageState
 * before delegating. Currently a degenerate case because renderPage5
 * itself is a no-op; the wrapper exists for future-proofing if help
 * ever gains real renderable content.
 *
 * Returns whatever renderPage5 returns (currently undefined).
 */
export function refreshPage5(state) {
  if (state) _setActiveState(state);
  return renderPage5(state || _pageState || {});
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 16, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to help.
 *
 * Builds a (mostly empty) legacy-shape state for uniformity with other
 * migrated pages. Calls refreshPage5 — currently a no-op chain, but
 * runs through the lifecycle so any future activation lands cleanly.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshPage5(legacyState); }
  catch (e) { console.warn('help.mount: refreshPage5 threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page5State = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  // Page5 has no real state slots (it's a static help page). We still
  // copy inversion-state-shaped properties so future activation has a
  // predictable starting point.
  return Object.assign({}, inv);
}
