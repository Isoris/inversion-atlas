// pages/catalogue/confirmed_carousel/_state.js
//
// State module for the confirmed_carousel confirmed carousel (chat 36 round 5
// step 7, 2026-05-07). Mirrors stats_profile/marker_readiness/annotation_cockpit/_state.js.
//
// _pageState: module-level reference. Page9's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page9 has its OWN _pageState (separate from other catalogue pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
