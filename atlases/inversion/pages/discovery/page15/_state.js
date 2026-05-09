// pages/discovery/page15/_state.js
//
// State module for the page15 GHSL haplotype-divergence page (chat 38
// round 5 step 15, 2026-05-07). Mirrors page8/page19/_state.js — same
// shape, distinct module, distinct _pageState reference.
//
// _pageState: module-level reference. Page15's mount sets it on entry
// so the public state-aware wrapper refreshGhslLayerStatus(state) can
// fall back to _pageState when called without an explicit state arg.
//
// Page15 has its OWN _pageState (separate from other discovery pages).
//
// Unlike page8/page19, page15 has ONE real chat-33 extracted helper
// (_refreshGhslLayerStatus, legacy lines 53065-53081) that takes state
// as an explicit argument. The helper signature is preserved verbatim;
// _pageState exists for the public wrapper's fall-back path and for
// future helpers that may opt into the live-binding pattern.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
