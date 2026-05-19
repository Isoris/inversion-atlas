// pages/discovery/tree_panel/_state.js
//
// Live-binding state for the tree panel (HANDOFF_5 atlas side).
// Same pattern as pages/discovery/window_summary_table/_state.js — submodules
// import `_pageState` as a binding, the main entry calls
// `_setActiveState()` at mount and clears it at unmount.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
