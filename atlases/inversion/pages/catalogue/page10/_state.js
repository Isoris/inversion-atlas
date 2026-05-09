// pages/catalogue/page10/_state.js
//
// State module for the page10 marker panels (chat 36 round 5 step 9,
// 2026-05-07). Mirrors page9/page17/page18/page21/page_overview/_state.js.
//
// _pageState: module-level reference. Page10's mount + entry points
// call _setActiveState(state) on entry so the renderer body sees the
// active mount's state via ES module live-binding semantics.
//
// Page10 has its OWN _pageState (separate from sibling catalogue
// pages). The legacy chat-33 surface (factory pattern wirePage10(state))
// closure-captures state and is RETAINED verbatim for backward-compat;
// the new lifecycle surface uses _pageState. Both surfaces stay
// consistent because the factory ALSO calls _setActiveState(state) on
// entry (same trick as page_overview round 5 step 8).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
