// pages/discovery/window_summary_table/_state.js
//
// State module for the window_summary_table per-window summary table (chat 38 round 5
// step 13, 2026-05-07). Mirrors confirmed_carousel/_state.js — same shape, distinct
// module, distinct _pageState reference.
//
// _pageState: module-level reference. Page8's mount sets it on entry so
// any helper bodies authored later see the active mount's state via ES
// module live-binding semantics.
//
// Page8 has its OWN _pageState (separate from other discovery pages).
//
// At chat-33 extraction time window_summary_table had ZERO JS bodies (pure HTML
// scaffold: see legacy/Inversion_atlas.html lines 7672-7774, 0 functions
// extracted per BATCH_1_NOTES.md). The lifecycle scaffolding here exists
// so future renderers (winSumTable, winSumStripCanvas, filters) can be
// authored fresh against the established _setActiveState pattern.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
