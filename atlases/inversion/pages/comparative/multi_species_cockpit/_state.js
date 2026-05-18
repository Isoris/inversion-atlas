// pages/comparative/multi_species_cockpit/_state.js
//
// State module for the multi_species_cockpit multi-species classification cockpit
// page (chat 39 cont. round 5 step 20, 2026-05-07). Mirrors
// cross_species_breakpoints/_state.js (the sibling comparative-stage page) and the
// canonical _state.js shape (confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/
// overview/marker_panels/page12/page7/page6/sv_evidence).
//
// _pageState: module-level reference. Page16b's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page16b has its OWN _pageState (separate from sibling cross_species_breakpoints — even
// though both are comparative-stage cockpit pages, they own different
// state slots: cross_species_breakpoints owns state.crossSpecies + cs* synteny caches +
// hover/wire flags; multi_species_cockpit owns state.dotplotMashmap +
// state.syntenyMultispecies + state.phyloTree + state.dxyPerInversion
// + state.compTEFragility + state.karyotypeLineage +
// state._multiSpeciesUI + state._msClassifications +
// state.classifications).
//
// Cross-page guard situation: multi_species_cockpit owns six JSON layers but none
// of its helpers are runtime-guarded from other pages today. Page16
// reads multi_species_cockpit's state.dotplotMashmap as an optional overlay slot
// (data, not function call). So this migration does NOT unblock a
// cross-page guard-resolution payoff round (unlike cross_species_breakpoints → stats_profile,
// step 11).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
