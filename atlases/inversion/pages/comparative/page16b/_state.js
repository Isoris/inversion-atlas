// pages/comparative/page16b/_state.js
//
// State module for the page16b multi-species classification cockpit
// page (chat 39 cont. round 5 step 20, 2026-05-07). Mirrors
// page16/_state.js (the sibling comparative-stage page) and the
// canonical _state.js shape (page9/page17/page18/page21/
// page_overview/page10/page12/page7/page6/page_sv_evidence).
//
// _pageState: module-level reference. Page16b's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page16b has its OWN _pageState (separate from sibling page16 — even
// though both are comparative-stage cockpit pages, they own different
// state slots: page16 owns state.crossSpecies + cs* synteny caches +
// hover/wire flags; page16b owns state.dotplotMashmap +
// state.syntenyMultispecies + state.phyloTree + state.dxyPerInversion
// + state.compTEFragility + state.karyotypeLineage +
// state._multiSpeciesUI + state._msClassifications +
// state.classifications).
//
// Cross-page guard situation: page16b owns six JSON layers but none
// of its helpers are runtime-guarded from other pages today. Page16
// reads page16b's state.dotplotMashmap as an optional overlay slot
// (data, not function call). So this migration does NOT unblock a
// cross-page guard-resolution payoff round (unlike page16 → page17,
// step 11).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
