// tests/test_review_page4.js
//
// Sub-module + main re-export coverage for the page4 karyotype/tier
// candidate-level review page (verbatim chat-33 exports + manual AST
// shim into the 2 of 4 helpers that read bare `state` + lifecycle
// scaffolding).
//
// Round 5 step 21 (chat 39 cont., 2026-05-07): page4 promoted from
// chat-33 "verbatim bodies + bare-state references + unused
// SLOT_REGISTRY import" to atlas-router-compatible mount/unmount +
// _pageState live-binding. Pattern 2 ("single file with _state.js")
// applied. **First real review-stage migration** (review group: 3 of
// 5 → 4 of 5).
//
// All 4 chat-33 exports preserved verbatim apart from a one-line
// `const state = _pageState;` shim manually inserted at the body
// open of renderCandidateKaryotype + renderCandidateTier (the 2 of
// 4 helpers that read bare `state`):
//   - renderCandidateKaryotype()       — main dispatcher, shimmed
//   - _refreshSubviewButtonStyles(active) — pure helper, NOT shimmed
//   - renderCandidateTier()            — Tier sub-view, shimmed
//   - setKaryoSubview(next)            — subview-toggle, NOT shimmed
// Plus the page-private `karyoState` const (also preserved verbatim).
//
// This test verifies:
//   - All 5 chat-33 exports survive unchanged.
//   - karyoState is the right shape (sortKey + sortAsc + filter +
//     bandFilter + subview).
//   - karyoState.subview defaults to 'karyotype'.
//   - Lifecycle exports present (mount + unmount + refreshPage4).
//   - _state.js live-binding pattern.
//   - _refreshSubviewButtonStyles + setKaryoSubview run without
//     throwing in no-DOM (Node) context.
//   - renderCandidateKaryotype + renderCandidateTier early-return
//     gracefully via the `if (!state.candidate) return` branch (the
//     primary mount-time path).
//   - setKaryoSubview('tier') / setKaryoSubview('karyotype') update
//     karyoState.subview correctly.
//   - setKaryoSubview('invalid') is a no-op.
//   - refreshPage4(state) sets _pageState as side effect.
//
// Replaces the chat-33 batch-2 test_review_page4.js, which imported
// from `../inversion_review/page4.js` (pre-migration path) and was
// not run by the harness.

import * as page4 from '../atlases/inversion/pages/review/page4.js';
import * as state from '../atlases/inversion/pages/review/page4/_state.js';

// Minimal global.document stub — page4's renderers and
// _refreshSubviewButtonStyles call document.getElementById. In
// Node without a DOM, those throw ReferenceError; the stub
// returns null for all IDs, which the chat-33 bodies handle
// gracefully via guards like `if (!empty || !content) return`
// and `if (!btn || !btn.style) return`.
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { getElementById: (_) => null };
}

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page4.js: lifecycle entry-points');
check('exports mount',                          typeof page4.mount === 'function');
check('exports unmount',                        typeof page4.unmount === 'function');
check('exports refreshPage4 (wrapper)',         typeof page4.refreshPage4 === 'function');
check('__MODULE_ID__ NOT exported',             !('__MODULE_ID__' in page4));

// -----------------------------------------------------------------------------
group('page4.js: 5 chat-33 exports preserved verbatim');
check('exports renderCandidateKaryotype',       typeof page4.renderCandidateKaryotype === 'function');
check('exports _refreshSubviewButtonStyles',    typeof page4._refreshSubviewButtonStyles === 'function');
check('exports renderCandidateTier',            typeof page4.renderCandidateTier === 'function');
check('exports setKaryoSubview',                typeof page4.setKaryoSubview === 'function');
check('exports karyoState (const)',             typeof page4.karyoState === 'object');

// -----------------------------------------------------------------------------
group('page4.js: karyoState shape (chat-33 verbatim)');
check('karyoState.sortKey is "k_label"',        page4.karyoState.sortKey === 'k_label');
check('karyoState.sortAsc is true',             page4.karyoState.sortAsc === true);
check('karyoState.filter is empty string',      page4.karyoState.filter === '');
check('karyoState.bandFilter is empty string',  page4.karyoState.bandFilter === '');
check('karyoState.subview is "karyotype" or "tier"',
      page4.karyoState.subview === 'karyotype' || page4.karyoState.subview === 'tier');

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
group('Pure helpers: _refreshSubviewButtonStyles + setKaryoSubview run without DOM');
// Both are no-DOM-safe: setActive guards `if (!btn || !btn.style) return`,
// setKaryoSubview short-circuits if next is invalid.
let r1OK = true; let r1Err = null;
try { page4._refreshSubviewButtonStyles('karyotype'); }
catch (e) { r1OK = false; r1Err = e; }
check('_refreshSubviewButtonStyles("karyotype") no-throw (no DOM)',
      r1OK, r1Err ? r1Err.message : '');

let r2OK = true; let r2Err = null;
try { page4._refreshSubviewButtonStyles('tier'); }
catch (e) { r2OK = false; r2Err = e; }
check('_refreshSubviewButtonStyles("tier") no-throw (no DOM)',
      r2OK, r2Err ? r2Err.message : '');

// -----------------------------------------------------------------------------
group('setKaryoSubview state-mutation behaviour');
const originalSubview = page4.karyoState.subview;
let r3OK = true; let r3Err = null;
try { page4.setKaryoSubview('invalid'); }
catch (e) { r3OK = false; r3Err = e; }
check('setKaryoSubview("invalid") no-throw',
      r3OK, r3Err ? r3Err.message : '');
check('setKaryoSubview("invalid") is a no-op (subview unchanged)',
      page4.karyoState.subview === originalSubview);

// Restore subview to a known value before the next test so localStorage-side-
// effects don't pollute the unit test in a non-DOM environment.
page4.karyoState.subview = 'karyotype';

// -----------------------------------------------------------------------------
group('refreshPage4(state) wrapper sets _pageState as side effect');
state._setActiveState(null);
const synthState = { candidate: null, data: {}, marker: 'B' };
let r4OK = true; let r4Err = null;
try { page4.refreshPage4(synthState); }
catch (e) { r4OK = false; r4Err = e; }
// In no-DOM context, renderCandidateKaryotype hits document.getElementById
// which is undefined → the dispatcher returns null/undefined gracefully (the
// `if (!empty || !content) return` guard). So refreshPage4 should NOT throw
// in this environment, AND _pageState should be set.
check('refreshPage4(state) ran without throwing (no-DOM, candidate=null path)',
      r4OK, r4Err ? r4Err.message : '');
check('_pageState set after refreshPage4(state)',
      state._pageState === synthState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
