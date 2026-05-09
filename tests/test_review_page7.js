// tests/test_review_page7.js
//
// Sub-module + main re-export coverage for the page7 ancestry view
// (lifecycle scaffolding + verbatim chat-33 thin-loader exports).
//
// Round 5 step 17 (chat 38, 2026-05-07): page7 promoted from chat-33
// "thin loader stub for window.renderAncestryPage" to the _pageState
// live-binding pattern + atlas-router mount/unmount lifecycle +
// state-aware public wrapper. **First migrated review-stage page**.
//
// Page7 is a thin loader stub for an external renderer
// (window.renderAncestryPage, expected sibling of
// js/atlas_page6_wiring.js). The chat-33 module exports
// showAncestryPage(state) and refreshAncestryPage(); both preserved
// verbatim because the tab dispatcher at legacy lines 59629-59630 +
// 59732-59733 calls them via typeof guard.
//
// This test verifies:
//   - Both chat-33 thin-loader exports survive unchanged.
//   - Lifecycle exports present (mount + unmount + refreshPage7).
//   - _state.js live-binding pattern.
//   - showAncestryPage gracefully handles missing window.renderAncestryPage
//     (the "fallback empty-state" path in the chat-33 body).
//   - refreshPage7(state) sets _pageState as side effect.
//
// Replaces the chat-33 batch-2 test_review_page7.js, which imported
// from `../inversion_review/page7.js` (pre-migration path) and was
// not run by the harness.

import * as page7 from '../atlases/inversion/pages/review/page7.js';
import * as state from '../atlases/inversion/pages/review/page7/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page7.js: lifecycle entry-points');
check('exports mount',                       typeof page7.mount === 'function');
check('exports unmount',                     typeof page7.unmount === 'function');
check('exports refreshPage7 (wrapper)',      typeof page7.refreshPage7 === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page7));

// -----------------------------------------------------------------------------
group('page7.js: chat-33 thin-loader exports preserved verbatim');
check('exports showAncestryPage',            typeof page7.showAncestryPage === 'function');
check('exports refreshAncestryPage',         typeof page7.refreshAncestryPage === 'function');

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
check('_pageState starts null',              state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',        state._pageState === null);

// -----------------------------------------------------------------------------
group('Pure helpers: chat-33 loader behaviour without window');
// In Node without a window polyfill, showAncestryPage() should early-
// return cleanly (typeof window === 'undefined' check at top).
let runOK = true; let runErr = null;
try { page7.showAncestryPage({ candidate: null }); }
catch (e) { runOK = false; runErr = e; }
check('showAncestryPage(state) no-window → early return',
      runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { page7.refreshAncestryPage(); }
catch (e) { runOK2 = false; runErr2 = e; }
check('refreshAncestryPage() no-window → early return',
      runOK2, runErr2 ? runErr2.message : '');

// -----------------------------------------------------------------------------
group('refreshPage7(state) wrapper sets _pageState as a side effect');
state._setActiveState(null);
const synthState = { marker: 'B', candidate: null };
page7.refreshPage7(synthState);
check('_pageState set after refreshPage7(state)',
      state._pageState === synthState);

// -----------------------------------------------------------------------------
group('refreshPage7() with no args: degenerate fallback (does not throw)');
state._setActiveState({ marker: 'C', candidate: null });
let fbOK = true; let fbErr = null;
try { page7.refreshPage7(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPage7() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
