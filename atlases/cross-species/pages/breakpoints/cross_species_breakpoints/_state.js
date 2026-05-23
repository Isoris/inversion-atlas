// pages/comparative/cross_species_breakpoints/_state.js
//
// State module for the cross_species_breakpoints cross-species breakpoints page (chat 36
// round 5 step 11, 2026-05-07). Mirrors confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/
// overview/marker_panels/local_pca_theta_pi/_state.js.
//
// _pageState: module-level reference. Page16's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page16 has its OWN _pageState (separate from sibling multi_species_cockpit — even
// though both are comparative-stage cockpit pages, they own different
// state slots: cross_species_breakpoints owns state.crossSpecies + cs* synteny caches +
// hover/wire flags; multi_species_cockpit owns state.dotplotMashmap +
// state.syntenyMultispecies + state.phyloTree + state.dxyPerInversion
// + state.compTEFragility + state.karyotypeLineage).
//
// stats_profile (synthesis stats profile) reads cross_species_breakpoints's _csGetSyntenyBlocks
// + _csPermutationTest via runtime `typeof X === 'function'` guards.
// Round 5 step 5 noted these would land naturally with cross_species_breakpoints
// migration; round 5 step 11 (this round) makes them proper exports.
// stats_profile's runtime guards can be promoted to imports in a follow-up
// round.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
