// tests/test_comparative_page5.js
//
// Sub-module + main re-export coverage for the page5 quick-reference /
// help page (lifecycle scaffolding + verbatim chat-33 exports).
//
// Round 5 step 16 (chat 38, 2026-05-07): page5 promoted from chat-33
// "renderPage5 + PAGE5_META" stub to the _pageState live-binding pattern
// + atlas-router mount/unmount lifecycle + state-aware public wrapper
// (degenerate no-op variant, since renderPage5 is itself a no-op).
//
// Page5 is a static help page — purely declarative HTML, no DOM behaviour
// to verify. The migration preserves both chat-33 exports verbatim
// (renderPage5 + PAGE5_META) and adds the canonical lifecycle. This
// test verifies:
//   - Both chat-33 exports survive unchanged (PAGE5_META.id/stage/static
//     particularly important — used by the page-loader's tabBar router).
//   - Lifecycle exports present (mount + unmount + refreshPage5).
//   - _state.js live-binding pattern.
//   - refreshPage5(state) sets _pageState as side effect (mirrors page9 /
//     page15 wrapper pattern).
//
// Replaces the chat-33 test_comparative_page5.js, which imported from the
// pre-migration path `../inversion_comparative/page5.js` and was not
// included in the migrated-page test harness.

import * as page5 from '../atlases/inversion/pages/comparative/page5.js';
import * as state from '../atlases/inversion/pages/comparative/page5/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page5.js: lifecycle entry-points');
check('exports mount',                       typeof page5.mount === 'function');
check('exports unmount',                     typeof page5.unmount === 'function');
check('exports refreshPage5 (wrapper)',      typeof page5.refreshPage5 === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page5));

// -----------------------------------------------------------------------------
group('page5.js: chat-33 exports preserved verbatim');
check('exports renderPage5',                 typeof page5.renderPage5 === 'function');
check('exports PAGE5_META',                  typeof page5.PAGE5_META === 'object' && page5.PAGE5_META !== null);
check('PAGE5_META.id === "page5"',           page5.PAGE5_META && page5.PAGE5_META.id === 'page5');
check('PAGE5_META.stage === "help"',         page5.PAGE5_META && page5.PAGE5_META.stage === 'help');
check('PAGE5_META.label === "help"',         page5.PAGE5_META && page5.PAGE5_META.label === 'help');
check('PAGE5_META.num === 16',               page5.PAGE5_META && page5.PAGE5_META.num === 16);
check('PAGE5_META.static === true',          page5.PAGE5_META && page5.PAGE5_META.static === true);
check('renderPage5() returns undefined (no-op)',
      page5.renderPage5() === undefined);
check('renderPage5(state) returns undefined (no-op, ignores arg)',
      page5.renderPage5({ marker: 'A' }) === undefined);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
check('_pageState starts null',              state._pageState === null);
state._setActiveState({ marker: 'B' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'B');
state._setActiveState(null);
check('_setActiveState(null) clears',        state._pageState === null);

// -----------------------------------------------------------------------------
group('refreshPage5(state) wrapper sets _pageState as a side effect');
state._setActiveState(null);
const synthState = { marker: 'C' };
page5.refreshPage5(synthState);
check('_pageState set after refreshPage5(state)',
      state._pageState === synthState);

// -----------------------------------------------------------------------------
group('refreshPage5() with no args: degenerate no-op (does not throw)');
state._setActiveState({ marker: 'D' });
let fbOK = true; let fbErr = null;
try { page5.refreshPage5(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPage5() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
