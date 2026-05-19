// pages/comparative/help/_state.js
//
// State module for the help quick-reference / help page (chat 38
// round 5 step 16, 2026-05-07). Mirrors window_summary_table/local_pca_ghsl/negative_regions/_state.js
// — same shape, distinct module, distinct _pageState reference.
//
// Page5 is a static help page (purely declarative HTML) — its
// renderPage5() function is a true no-op. _pageState exists for
// uniformity with the other migrated pages and for the
// canonical state-aware wrapper pattern, even though the wrapper
// currently does nothing useful.
//
// Page5 has its OWN _pageState (separate from other comparative pages).

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
