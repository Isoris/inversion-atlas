// pages/catalogue/page17/_state.js
//
// State module for the page17 stats profile page (chat 36 round 5
// step 5, 2026-05-07). Mirrors the page1 round-4 / page2 round-5-step-2
// / page3 round-5-step-3 / page18 round-5-step-4 pattern.
//
// _pageState: module-level reference. Page17's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page17 has its OWN _pageState (separate from page1/page2/page3/page18).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
