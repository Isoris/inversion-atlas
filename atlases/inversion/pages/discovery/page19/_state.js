// pages/discovery/page19/_state.js
//
// State module for the page19 negative-regions catalogue (chat 38 round 5
// step 14, 2026-05-07). Mirrors page8/_state.js exactly — same shape,
// distinct module, distinct _pageState reference.
//
// _pageState: module-level reference. Page19's mount sets it on entry so
// any helper bodies authored later see the active mount's state via ES
// module live-binding semantics.
//
// Page19 has its OWN _pageState (separate from other discovery pages).
//
// At chat-33 extraction time page19 had ZERO JS bodies (pure HTML
// scaffold: see legacy/Inversion_atlas.html lines 7378-7572, 0 functions
// extracted per BATCH_1_NOTES.md). The lifecycle scaffolding here exists
// so future renderers (_nrRender, _nrLoadFile, _nrExportCsv, _nrReset)
// can be authored fresh against the established _setActiveState pattern.

export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
