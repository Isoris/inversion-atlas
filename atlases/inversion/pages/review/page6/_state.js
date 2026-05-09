// pages/review/page6/_state.js
//
// State module for the page6 popstats view (chat 38 cont. round 5
// step 18, 2026-05-07). Mirrors page7/_state.js (the direct twin) —
// same shape, distinct module, distinct _pageState reference.
//
// Page6's chat-33 exports (showPopstatsPage, refreshPopstatsPage) are
// thin loader stubs that delegate to a window.renderPopstatsPage
// defined in an external script (js/atlas_page6_wiring.js — the
// canonical popstats wiring bundle). _pageState exists for the
// canonical state-aware wrapper pattern + future-proofing.
//
// Page6 has its OWN _pageState (separate from page7 and other review
// pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
