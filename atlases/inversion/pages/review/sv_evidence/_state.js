// pages/review/sv_evidence/_state.js
//
// State module for the sv_evidence SV-evidence view (chat 39
// round 5 step 19, 2026-05-07). Mirrors ancestry_per_window/_state.js +
// popstats/_state.js — same shape, distinct module, distinct
// _pageState reference.
//
// sv_evidence's chat-33 exports (showSvEvidencePage,
// hideSvEvidencePage) are thin loader stubs that delegate to a
// window.AtlasSVEvidence object (with .init / .loadCandidate /
// .destroy methods) defined in the external js/atlas_sv_evidence.js
// bundle. _pageState exists for the canonical state-aware wrapper
// pattern + future-proofing.
//
// sv_evidence has its OWN _pageState (separate from popstats,
// ancestry_per_window, and other review pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
