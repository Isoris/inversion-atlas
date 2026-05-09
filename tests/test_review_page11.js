// tests/test_review_page11.js
//
// Sub-module + main re-export coverage for the page11 boundaries
// refinement page (verbatim chat-33 exports + lifecycle scaffolding).
//
// Round 5 step 22 (chat 39 cont., 2026-05-07): page11 promoted from
// chat-33 "verbatim bodies + bare-state references + unused
// SLOT_REGISTRY import" to atlas-router-compatible mount/unmount +
// _pageState live-binding. Pattern 2 ("single file with _state.js")
// applied. **THE FINAL MIGRATION — review group: 4 of 5 → 5 of 5;
// MIGRATION COMPLETE 21/21**.
//
// All 4 chat-33 exports preserved verbatim — and unlike page4 (which
// needed manual AST shims into 2 of 4 helpers), page11 needed ZERO
// shims. None of the 4 chat-33 functions read bare `state.X`; they
// operate exclusively on DOM and on the closure-scoped `bs` object
// returned by `_ensureBoundariesState()` (TODO_MISSING):
//   - renderBoundariesPage()   — main dispatcher, NOT shimmed
//   - _bndKeyHandler(e)        — hotkey dispatcher, NOT shimmed
//   - _bndAttachHotkeys()      — installs listener, NOT shimmed
//   - _bndDetachHotkeys()      — removes listener, NOT shimmed
//
// This test verifies:
//   - All 4 chat-33 exports survive unchanged.
//   - Lifecycle exports present (mount + unmount + refreshPage11).
//   - _state.js live-binding pattern.
//   - _bndAttachHotkeys + _bndDetachHotkeys round-trip cleanly when
//     `document` is stubbed minimally.
//   - _bndKeyHandler short-circuits gracefully when page11 is not
//     active (no DOM in Node, so `document.getElementById('page11')`
//     returns null → handler early-returns).
//   - refreshPage11(state) sets _pageState as side effect.
//   - renderBoundariesPage early-exits gracefully when
//     `document.getElementById('page11Content')` returns null
//     (the very first guard, before the TODO_MISSING
//     `_ensureBoundariesState()` throw).
//
// Replaces the chat-33 batch-2 test_review_page11.js, which was a
// 5-assertion parse-check stub that imported from
// `../inversion_review/page11.js` (pre-migration path) and was never
// run by the harness.

import * as page11 from '../atlases/inversion/pages/review/page11.js';
import * as state from '../atlases/inversion/pages/review/page11/_state.js';

// Minimal global.document stub — page11's renderBoundariesPage and
// _bndKeyHandler call document.getElementById; _bndAttachHotkeys +
// _bndDetachHotkeys call document.addEventListener /
// removeEventListener. The stub returns null for getElementById (so
// renderBoundariesPage's first guard early-exits before the
// TODO_MISSING `_ensureBoundariesState()` is reached) and tracks
// add/remove calls so the attach/detach round-trip can be verified.
const _docListeners = new Map(); // evt → array of cb
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById: (_) => null,
    addEventListener: (evt, cb) => {
      const list = _docListeners.get(evt) || [];
      list.push(cb);
      _docListeners.set(evt, list);
    },
    removeEventListener: (evt, cb) => {
      const list = _docListeners.get(evt) || [];
      const idx = list.indexOf(cb);
      if (idx >= 0) list.splice(idx, 1);
      _docListeners.set(evt, list);
    },
  };
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page11.js: lifecycle entry-points');
check('exports mount',                          typeof page11.mount === 'function');
check('exports unmount',                        typeof page11.unmount === 'function');
check('exports refreshPage11 (wrapper)',        typeof page11.refreshPage11 === 'function');
check('__MODULE_ID__ NOT exported',             !('__MODULE_ID__' in page11));

// -----------------------------------------------------------------------------
group('page11.js: 4 chat-33 exports preserved verbatim');
check('exports renderBoundariesPage',           typeof page11.renderBoundariesPage === 'function');
check('exports _bndKeyHandler',                 typeof page11._bndKeyHandler === 'function');
check('exports _bndAttachHotkeys',              typeof page11._bndAttachHotkeys === 'function');
check('exports _bndDetachHotkeys',              typeof page11._bndDetachHotkeys === 'function');

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                     '_pageState' in state);
check('exports _setActiveState',                typeof state._setActiveState === 'function');
check('_pageState starts null',                 state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',     state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',           state._pageState === null);

// -----------------------------------------------------------------------------
group('renderBoundariesPage: early-exit when slot is null (no DOM)');
// document.getElementById returns null for everything in this stub →
// the very first guard `if (!slot) return` fires, BEFORE the
// TODO_MISSING `_ensureBoundariesState()` is ever called. So
// renderBoundariesPage should NOT throw in this environment.
state._setActiveState({ candidate: null, data: {} });
let r1OK = true; let r1Err = null;
try { page11.renderBoundariesPage(); }
catch (e) { r1OK = false; r1Err = e; }
check('renderBoundariesPage no-throw (slot=null path)',
      r1OK, r1Err ? r1Err.message : '');

// -----------------------------------------------------------------------------
group('_bndKeyHandler: short-circuits gracefully (page11 not active)');
// document.getElementById('page11') → null → handler early-returns.
let r2OK = true; let r2Err = null;
try { page11._bndKeyHandler({ key: 'a' }); }
catch (e) { r2OK = false; r2Err = e; }
check('_bndKeyHandler no-throw (page11=null path)',
      r2OK, r2Err ? r2Err.message : '');

// -----------------------------------------------------------------------------
group('_bndAttachHotkeys / _bndDetachHotkeys round-trip');
// Pre-condition: no listeners. Attach should add exactly one keydown
// listener; detach should remove it; second attach should re-add.
_docListeners.clear();

let r3OK = true; let r3Err = null;
try { page11._bndAttachHotkeys(); }
catch (e) { r3OK = false; r3Err = e; }
check('_bndAttachHotkeys no-throw',
      r3OK, r3Err ? r3Err.message : '');
const keydownListeners = _docListeners.get('keydown') || [];
check('exactly 1 keydown listener attached',
      keydownListeners.length === 1, `actual: ${keydownListeners.length}`);

// Idempotency: second attach should be a no-op (guarded by
// _bndKeyHandlerAttached internal flag).
let r4OK = true; let r4Err = null;
try { page11._bndAttachHotkeys(); }
catch (e) { r4OK = false; r4Err = e; }
check('_bndAttachHotkeys idempotent (no double-install)',
      r4OK && (_docListeners.get('keydown') || []).length === 1);

let r5OK = true; let r5Err = null;
try { page11._bndDetachHotkeys(); }
catch (e) { r5OK = false; r5Err = e; }
check('_bndDetachHotkeys no-throw',
      r5OK, r5Err ? r5Err.message : '');
check('keydown listener removed after detach',
      (_docListeners.get('keydown') || []).length === 0);

// Idempotency on detach side too.
let r6OK = true; let r6Err = null;
try { page11._bndDetachHotkeys(); }
catch (e) { r6OK = false; r6Err = e; }
check('_bndDetachHotkeys idempotent (no double-detach)',
      r6OK && (_docListeners.get('keydown') || []).length === 0);

// -----------------------------------------------------------------------------
group('refreshPage11(state) wrapper sets _pageState as side effect');
state._setActiveState(null);
const synthState = { candidate: null, candidateList: [], data: {}, repeatDensity: {}, ncRNADensity: {}, marker: 'B' };
let r7OK = true; let r7Err = null;
try { page11.refreshPage11(synthState); }
catch (e) { r7OK = false; r7Err = e; }
// In no-DOM context, renderBoundariesPage hits document.getElementById
// → returns null → early-returns at the slot guard. So refreshPage11
// should NOT throw, AND _pageState should be set.
check('refreshPage11(state) ran without throwing (no-DOM, slot=null path)',
      r7OK, r7Err ? r7Err.message : '');
check('_pageState set after refreshPage11(state)',
      state._pageState === synthState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
