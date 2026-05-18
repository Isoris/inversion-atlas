// pages/catalogue/catalogue/_state.js
//
// State module for the catalogue split (chat 36 round 5 step 3, 2026-05-07).
// Mirrors the page1 round-4 / page2 round-5-step-2 pattern.
//
// _pageState: module-level reference. Page3's entry points
// (mount, renderCataloguePage, _wireCatalogueBreedingExportBtns) call
// _setActiveState(state) on entry so the helper bodies in
// _breeding_export.js see the active mount's state via ES module
// live-binding semantics.
//
// Page3 has its OWN _pageState (separate from page1's and page2's).
// Each page mounts its own. Cross-page helpers used by multiple pages
// live in atlases/inversion/shared/page1_data_helpers.js and take
// `state` as first arg — they don't read any page's _pageState.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
