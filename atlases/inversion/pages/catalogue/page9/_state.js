// pages/catalogue/page9/_state.js
//
// State module for the page9 confirmed carousel (chat 36 round 5
// step 7, 2026-05-07). Mirrors page17/page18/page21/_state.js.
//
// _pageState: module-level reference. Page9's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page9 has its OWN _pageState (separate from other catalogue pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
