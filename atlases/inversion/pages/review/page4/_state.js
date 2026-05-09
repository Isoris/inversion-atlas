// pages/review/page4/_state.js
//
// State module for the page4 karyotype/tier candidate-level view
// (chat 39 cont. round 5 step 21, 2026-05-07). Canonical shape;
// mirrors page16/page16b/page12/page17/_state.js.
//
// _pageState: module-level reference. Page4's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page4 has its OWN _pageState (separate from sibling review pages
// page6/page7/page_sv_evidence). Page4 reads state.candidate (cross-
// atlas slot) for the active candidate, and state.data (transient
// slot) for state.data.final_classification — the per-candidate
// 14-axis classification keyed by candidate id, produced by the
// cluster-side R-pipeline (characterize_candidate.R +
// classify_inversions.R, planned).
//
// page4 also exports a page-private const `karyoState` (sort/filter/
// subview UI state). This is NOT part of _pageState — it's a
// module-level singleton that persists across mounts (same pattern
// as the legacy karyoState at lines 62508-62526). The persisted
// subview choice is restored from localStorage at module-load time.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
