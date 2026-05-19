// pages/discovery/pca_comparator/_state.js
//
// Page-state binding for the cross-evidence PCA comparator.
// Mirrors the pattern in tree_panel/_state.js: a module-local
// `_pageState` plus a setter, so the renderer + selection modules
// can read state without taking it as an argument.

export let _pageState = null;

export function _setActiveState(s) {
  _pageState = s;
}
