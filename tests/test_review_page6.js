// tests/test_review_page6.js
//
// Sub-module + main re-export coverage for the page6 popstats view
// (lifecycle scaffolding + verbatim chat-33 thin-loader exports).
//
// Round 5 step 18 (chat 38 cont., 2026-05-07): page6 promoted from
// chat-33 "thin loader stub for window.renderPopstatsPage" to the
// _pageState live-binding pattern + atlas-router mount/unmount
// lifecycle + state-aware public wrapper. **Direct twin of page7**
// (the first migrated review-stage page, shipped step 17). Second
// migrated review-stage page (review group: 1 of 5 → 2 of 5).
//
// Page6 is a thin loader stub for an external renderer
// (window.renderPopstatsPage, defined in js/atlas_page6_wiring.js).
// The chat-33 module exports showPopstatsPage(state) and
// refreshPopstatsPage(); both preserved verbatim because the tab
// dispatcher at legacy lines 59626-59627 + 59729-59730 calls them via
// typeof guard.
//
// This test verifies:
//   - Both chat-33 thin-loader exports survive unchanged.
//   - Lifecycle exports present (mount + unmount + refreshPage6).
//   - _state.js live-binding pattern.
//   - showPopstatsPage gracefully handles missing window.renderPopstatsPage
//     (the "fallback empty-state" path in the chat-33 body).
//   - refreshPage6(state) sets _pageState as side effect.
//
// Replaces the chat-33 batch-2 test_review_page6.js, which imported
// from `../inversion_review/page6.js` (pre-migration path) and was
// not run by the harness.

import * as page6 from '../atlases/inversion/pages/review/page6.js';
import * as state from '../atlases/inversion/pages/review/page6/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page6.js: lifecycle entry-points');
check('exports mount',                       typeof page6.mount === 'function');
check('exports unmount',                     typeof page6.unmount === 'function');
check('exports refreshPage6 (wrapper)',      typeof page6.refreshPage6 === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page6));

// -----------------------------------------------------------------------------
group('page6.js: chat-33 thin-loader exports preserved verbatim');
check('exports showPopstatsPage',            typeof page6.showPopstatsPage === 'function');
check('exports refreshPopstatsPage',         typeof page6.refreshPopstatsPage === 'function');

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
// In Node without a window polyfill, showPopstatsPage() should early-
// return cleanly (typeof window === 'undefined' check at top).
let runOK = true; let runErr = null;
try { page6.showPopstatsPage({ candidate: null }); }
catch (e) { runOK = false; runErr = e; }
check('showPopstatsPage(state) no-window → early return',
      runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { page6.refreshPopstatsPage(); }
catch (e) { runOK2 = false; runErr2 = e; }
check('refreshPopstatsPage() no-window → early return',
      runOK2, runErr2 ? runErr2.message : '');

// -----------------------------------------------------------------------------
group('refreshPage6(state) wrapper sets _pageState as a side effect');
state._setActiveState(null);
const synthState = { marker: 'B', candidate: null };
page6.refreshPage6(synthState);
check('_pageState set after refreshPage6(state)',
      state._pageState === synthState);

// -----------------------------------------------------------------------------
group('refreshPage6() with no args: degenerate fallback (does not throw)');
state._setActiveState({ marker: 'C', candidate: null });
let fbOK = true; let fbErr = null;
try { page6.refreshPage6(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPage6() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
