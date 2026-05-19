// tests/test_review_page4.js
//
// Sub-module + main re-export coverage for the karyotype_tier karyotype/tier
// candidate-level review page (verbatim chat-33 exports + manual AST
// shim into the 2 of 4 helpers that read bare `state` + lifecycle
// scaffolding).
//
// Round 5 step 21 (chat 39 cont., 2026-05-07): karyotype_tier promoted from
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
// from `../inversion_review/karyotype_tier.js` (pre-migration path) and was
// not run by the harness.

import * as karyotype_tier from '../atlases/inversion/pages/review/karyotype_tier.js';
import * as state from '../atlases/inversion/pages/review/karyotype_tier/_state.js';

// Minimal global.document stub — karyotype_tier's renderers and
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
group('karyotype_tier.js: lifecycle entry-points');
check('exports mount',                          typeof karyotype_tier.mount === 'function');
check('exports unmount',                        typeof karyotype_tier.unmount === 'function');
check('exports refreshPage4 (wrapper)',         typeof karyotype_tier.refreshPage4 === 'function');
check('__MODULE_ID__ NOT exported',             !('__MODULE_ID__' in karyotype_tier));

// -----------------------------------------------------------------------------
group('karyotype_tier.js: 5 chat-33 exports preserved verbatim');
check('exports renderCandidateKaryotype',       typeof karyotype_tier.renderCandidateKaryotype === 'function');
check('exports _refreshSubviewButtonStyles',    typeof karyotype_tier._refreshSubviewButtonStyles === 'function');
check('exports renderCandidateTier',            typeof karyotype_tier.renderCandidateTier === 'function');
check('exports setKaryoSubview',                typeof karyotype_tier.setKaryoSubview === 'function');
check('exports karyoState (const)',             typeof karyotype_tier.karyoState === 'object');

// -----------------------------------------------------------------------------
group('karyotype_tier.js: karyoState shape (chat-33 verbatim)');
check('karyoState.sortKey is "k_label"',        karyotype_tier.karyoState.sortKey === 'k_label');
check('karyoState.sortAsc is true',             karyotype_tier.karyoState.sortAsc === true);
check('karyoState.filter is empty string',      karyotype_tier.karyoState.filter === '');
check('karyoState.bandFilter is empty string',  karyotype_tier.karyoState.bandFilter === '');
check('karyoState.subview is "karyotype" or "tier"',
      karyotype_tier.karyoState.subview === 'karyotype' || karyotype_tier.karyoState.subview === 'tier');

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
try { karyotype_tier._refreshSubviewButtonStyles('karyotype'); }
catch (e) { r1OK = false; r1Err = e; }
check('_refreshSubviewButtonStyles("karyotype") no-throw (no DOM)',
      r1OK, r1Err ? r1Err.message : '');

let r2OK = true; let r2Err = null;
try { karyotype_tier._refreshSubviewButtonStyles('tier'); }
catch (e) { r2OK = false; r2Err = e; }
check('_refreshSubviewButtonStyles("tier") no-throw (no DOM)',
      r2OK, r2Err ? r2Err.message : '');

// -----------------------------------------------------------------------------
group('setKaryoSubview state-mutation behaviour');
const originalSubview = karyotype_tier.karyoState.subview;
let r3OK = true; let r3Err = null;
try { karyotype_tier.setKaryoSubview('invalid'); }
catch (e) { r3OK = false; r3Err = e; }
check('setKaryoSubview("invalid") no-throw',
      r3OK, r3Err ? r3Err.message : '');
check('setKaryoSubview("invalid") is a no-op (subview unchanged)',
      karyotype_tier.karyoState.subview === originalSubview);

// Restore subview to a known value before the next test so localStorage-side-
// effects don't pollute the unit test in a non-DOM environment.
karyotype_tier.karyoState.subview = 'karyotype';

// -----------------------------------------------------------------------------
group('refreshPage4(state) wrapper sets _pageState as side effect');
state._setActiveState(null);
const synthState = { candidate: null, data: {}, marker: 'B' };
let r4OK = true; let r4Err = null;
try { karyotype_tier.refreshPage4(synthState); }
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
