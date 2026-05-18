// pages/catalogue/overview/_state.js
//
// State module for the overview synthesis tab (chat 36 round 5
// step 8, 2026-05-07). Mirrors confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/_state.js.
//
// _pageState: module-level reference. Page_overview's mount + entry
// points call _setActiveState(state) on entry so any future helper
// bodies see the active mount's state via ES module live-binding
// semantics. Currently no helpers read state — overview is an
// empty-stub-in-legacy whose render is a no-op — but the live-binding
// is wired now so the inevitable real implementation can read state
// without a separate refactor.
//
// Page_overview has its OWN _pageState (separate from other pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
