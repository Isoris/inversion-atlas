// tests/test_comparative_page5.js
//
// Sub-module + main re-export coverage for the help quick-reference /
// help page (lifecycle scaffolding + verbatim chat-33 exports).
//
// Round 5 step 16 (chat 38, 2026-05-07): help promoted from chat-33
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
//   - refreshPage5(state) sets _pageState as side effect (mirrors confirmed_carousel /
//     local_pca_ghsl wrapper pattern).
//
// Replaces the chat-33 test_comparative_page5.js, which imported from the
// pre-migration path `../inversion_comparative/help.js` and was not
// included in the migrated-page test harness.

import * as help from '../atlases/inversion/pages/comparative/help.js';
import * as state from '../atlases/inversion/pages/comparative/help/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('help.js: lifecycle entry-points');
check('exports mount',                       typeof help.mount === 'function');
check('exports unmount',                     typeof help.unmount === 'function');
check('exports refreshPage5 (wrapper)',      typeof help.refreshPage5 === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in help));

// -----------------------------------------------------------------------------
group('help.js: chat-33 exports preserved verbatim');
check('exports renderPage5',                 typeof help.renderPage5 === 'function');
check('exports PAGE5_META',                  typeof help.PAGE5_META === 'object' && help.PAGE5_META !== null);
check('PAGE5_META.id === "help"',           help.PAGE5_META && help.PAGE5_META.id === 'help');
check('PAGE5_META.stage === "help"',         help.PAGE5_META && help.PAGE5_META.stage === 'help');
check('PAGE5_META.label === "help"',         help.PAGE5_META && help.PAGE5_META.label === 'help');
check('PAGE5_META.num === 16',               help.PAGE5_META && help.PAGE5_META.num === 16);
check('PAGE5_META.static === true',          help.PAGE5_META && help.PAGE5_META.static === true);
check('renderPage5() returns undefined (no-op)',
      help.renderPage5() === undefined);
check('renderPage5(state) returns undefined (no-op, ignores arg)',
      help.renderPage5({ marker: 'A' }) === undefined);

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
help.refreshPage5(synthState);
check('_pageState set after refreshPage5(state)',
      state._pageState === synthState);

// -----------------------------------------------------------------------------
group('refreshPage5() with no args: degenerate no-op (does not throw)');
state._setActiveState({ marker: 'D' });
let fbOK = true; let fbErr = null;
try { help.refreshPage5(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPage5() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
