// pages/catalogue/stats_profile/_state.js
//
// State module for the stats_profile stats profile page (chat 36 round 5
// step 5, 2026-05-07). Mirrors the local_pca_dosage round-4 / candidate_focus round-5-step-2
// / catalogue round-5-step-3 / marker_readiness round-5-step-4 pattern.
//
// _pageState: module-level reference. Page17's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page17 has its OWN _pageState (separate from local_pca_dosage/candidate_focus/catalogue/marker_readiness).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
