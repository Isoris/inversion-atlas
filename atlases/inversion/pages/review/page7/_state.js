// pages/review/page7/_state.js
//
// State module for the page7 ancestry view (chat 38 round 5 step 17,
// 2026-05-07). Mirrors page5/page8/page15/page19/_state.js — same
// shape, distinct module, distinct _pageState reference.
//
// Page7's chat-33 exports (showAncestryPage, refreshAncestryPage) are
// thin loader stubs that delegate to a window.renderAncestryPage
// defined in an external sibling script (alongside
// js/atlas_page6_wiring.js). _pageState exists for the canonical
// state-aware wrapper pattern + future-proofing.
//
// Page7 has its OWN _pageState (separate from other review pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
