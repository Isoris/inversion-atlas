// pages/review/page11/_state.js
//
// State module for the page11 boundaries refinement view
// (chat 39 cont. round 5 step 22, 2026-05-07). Canonical shape;
// mirrors page4/page6/page7/page_sv_evidence/page12/page17/_state.js.
//
// _pageState: module-level reference. Page11's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page11 has its OWN _pageState (separate from sibling review pages
// page4/page6/page7/page_sv_evidence). The 4 chat-33 exports
// (renderBoundariesPage + the three hotkey functions) read NO bare
// `state.X` — they operate exclusively on DOM and on the closure-
// scoped `bs` object returned by `_ensureBoundariesState()` (a
// TODO_MISSING helper). So unlike page4 (which got manual AST shims
// into 2 of 4 helpers), page11 needs ZERO bare-state shims at the
// migration round. _pageState exists for the canonical lifecycle-
// wrapper pattern + future-proofing once the 31 TODO_MISSING `_bnd*`
// helpers land — those WILL read state.candidate /
// state.candidateList / state.repeatDensity / state.ncRNADensity /
// state.data, per the trailing comment block in page11.js.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
