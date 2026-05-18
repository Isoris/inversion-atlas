// pages/review/fish_ancestry_scroller/_state.js
//
// Live-binding state for the Ancestry Scroller page. Same pattern as
// pages/discovery/page8/_state.js — submodules import `_pageState`
// as a binding, the main entry calls _setActiveState() to swap it in
// at mount and clear it at unmount.
//
// The scroller's render path is callback-driven (no module-level
// singletons); _pageState exists so click handlers wired by
// submodules can read the current selection / view-mode without
// being plumbed the state via every argument list.

export let _pageState = null;

export function _setActiveState(s) {
  _pageState = s;
}
