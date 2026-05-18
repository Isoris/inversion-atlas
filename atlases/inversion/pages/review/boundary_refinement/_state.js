// pages/review/boundary_refinement/_state.js
//
// State module for the boundary_refinement boundaries refinement view
// (chat 39 cont. round 5 step 22, 2026-05-07). Canonical shape;
// mirrors karyotype_tier/popstats/ancestry_per_window/sv_evidence/local_pca_theta_pi/stats_profile/_state.js.
//
// _pageState: module-level reference. Page11's mount + entry points
// call _setActiveState(state) on entry so the helper bodies see the
// active mount's state via ES module live-binding semantics.
//
// Page11 has its OWN _pageState (separate from sibling review pages
// karyotype_tier/popstats/ancestry_per_window/sv_evidence). The 4 chat-33 exports
// (renderBoundariesPage + the three hotkey functions) read NO bare
// `state.X` — they operate exclusively on DOM and on the closure-
// scoped `bs` object returned by `_ensureBoundariesState()` (a
// TODO_MISSING helper). So unlike karyotype_tier (which got manual AST shims
// into 2 of 4 helpers), boundary_refinement needs ZERO bare-state shims at the
// migration round. _pageState exists for the canonical lifecycle-
// wrapper pattern + future-proofing once the 31 TODO_MISSING `_bnd*`
// helpers land — those WILL read state.candidate /
// state.candidateList / state.repeatDensity / state.ncRNADensity /
// state.data, per the trailing comment block in boundary_refinement.js.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
