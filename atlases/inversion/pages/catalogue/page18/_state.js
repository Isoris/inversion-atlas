// pages/catalogue/page18/_state.js
//
// State module for the page18 marker readiness panel (chat 36 round 5
// step 4, 2026-05-07). Mirrors the page1 round-4 / page2 round-5-step-2
// / page3 round-5-step-3 pattern.
//
// _pageState: module-level reference. Page18's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page18 has its OWN _pageState (separate from page1/page2/page3).
// Each page mounts its own. Cross-page helpers used by multiple pages
// live in atlases/inversion/shared/page1_data_helpers.js and take
// `state` as first arg (or read no state at all, like _esc).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
