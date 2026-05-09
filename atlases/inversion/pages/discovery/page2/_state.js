// pages/discovery/page2/_state.js
//
// State module for the page2 split (chat 36 round 5 step 2, 2026-05-07).
// Mirrors the page1 round-4 pattern.
//
// _pageState: module-level reference. Page2's entry points
// (renderCandidateMetadata, wireCandidateNav, mount, refreshCandidateUI,
// _navigateToCandidate) call _setActiveState(state) on entry so the
// helper bodies in _html_builders.js, _wires.js, _list.js,
// _draw_panels.js see the active mount's state via ES module
// live-binding semantics.
//
// Page2 has its OWN _pageState (separate from page1's). Cross-page
// helpers used by both pages live in atlases/inversion/shared/
// (page1_data_helpers.js et al.) and take `state` as first arg —
// they don't read either page's _pageState. See
// HANDOFF_2026-05-07_chat36_round5_step1_done.md for the rationale.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
