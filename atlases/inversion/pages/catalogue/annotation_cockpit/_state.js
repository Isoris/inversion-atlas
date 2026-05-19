// pages/catalogue/annotation_cockpit/_state.js
//
// State module for the annotation_cockpit annotation cockpit (chat 36 round 5
// step 6, 2026-05-07). Mirrors stats_profile/marker_readiness/_state.js (round 5 step 4
// + step 5).
//
// _pageState: module-level reference. Page21's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page21 has its OWN _pageState (separate from stats_profile/marker_readiness). Each
// page mounts its own. Cross-page helpers used by multiple pages live
// in atlases/inversion/shared/ and take `state` as first arg (or read
// no state at all).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
