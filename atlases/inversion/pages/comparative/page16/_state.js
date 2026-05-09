// pages/comparative/page16/_state.js
//
// State module for the page16 cross-species breakpoints page (chat 36
// round 5 step 11, 2026-05-07). Mirrors page9/page17/page18/page21/
// page_overview/page10/page12/_state.js.
//
// _pageState: module-level reference. Page16's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page16 has its OWN _pageState (separate from sibling page16b — even
// though both are comparative-stage cockpit pages, they own different
// state slots: page16 owns state.crossSpecies + cs* synteny caches +
// hover/wire flags; page16b owns state.dotplotMashmap +
// state.syntenyMultispecies + state.phyloTree + state.dxyPerInversion
// + state.compTEFragility + state.karyotypeLineage).
//
// page17 (synthesis stats profile) reads page16's _csGetSyntenyBlocks
// + _csPermutationTest via runtime `typeof X === 'function'` guards.
// Round 5 step 5 noted these would land naturally with page16
// migration; round 5 step 11 (this round) makes them proper exports.
// page17's runtime guards can be promoted to imports in a follow-up
// round.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
