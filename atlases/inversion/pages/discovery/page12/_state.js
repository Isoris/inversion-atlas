// pages/discovery/page12/_state.js
//
// State module for the page12 local-PCA-θπ chromosome-wide diversity
// scanner (chat 36 round 5 step 10, 2026-05-07). Mirrors
// page9/page17/page18/page21/page_overview/page10/_state.js.
//
// _pageState: module-level reference. Page12's mount + entry points
// call _setActiveState(state) on entry so the helper bodies can rely
// on _pageState as a fallback when a `state` argument isn't passed.
// All 8 verbatim helpers already take `state` as their first argument
// (chat-33 already migrated that pattern), so the live-binding is a
// belt-and-suspenders convenience for atlas-router-driven mounts.
//
// Page12 has its OWN _pageState (separate from page1 even though they
// share a six-panel layout — page1 reads dosage, page12 reads θπ).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
