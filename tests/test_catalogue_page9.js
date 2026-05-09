// tests/test_catalogue_page9.js
//
// Sub-module + main re-export coverage for the page9 confirmed carousel.
//
// Round 5 step 7 (chat 36, 2026-05-07): page9 refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
//
// Page9 is a stub even in legacy: the HTML shell (#confirmedNavBar etc.)
// has no JS handlers in legacy/Inversion_atlas.html. Migration preserves
// the no-op stub behaviour: empty-state placeholder shown when no
// confirmed candidates; "carousel not yet wired" message when there are
// confirmed candidates. Full carousel implementation deferred (TODO_MISSING).

import * as page9 from '../atlases/inversion/pages/catalogue/page9.js';
import * as state from '../atlases/inversion/pages/catalogue/page9/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page9.js: lifecycle entry-points');
check('exports mount',                       typeof page9.mount === 'function');
check('exports unmount',                     typeof page9.unmount === 'function');
check('exports refreshConfirmedCarousel',    typeof page9.refreshConfirmedCarousel === 'function');
check('exports initConfirmedCarousel',       typeof page9.initConfirmedCarousel === 'function');

// -----------------------------------------------------------------------------
group('page9.js: __MODULE_ID__ removed');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page9));

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
group('Pure helpers: refreshConfirmedCarousel runs without throwing in Node (no document)');
// In Node without a document polyfill, the function should early-return.
let runOK = true; let runErr = null;
try { page9.refreshConfirmedCarousel(); }
catch (e) { runOK = false; runErr = e; }
check('refreshConfirmedCarousel() no-doc → early return',  runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { page9.refreshConfirmedCarousel({ candidateList: [] }); }
catch (e) { runOK2 = false; runErr2 = e; }
check('refreshConfirmedCarousel(state) no-doc → early return',  runOK2, runErr2 ? runErr2.message : '');

// initConfirmedCarousel is a stub — should not throw
let initOK = true; let initErr = null;
try { page9.initConfirmedCarousel(); }
catch (e) { initOK = false; initErr = e; }
check('initConfirmedCarousel() runs without throwing',  initOK, initErr ? initErr.message : '');

// reset
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('refreshConfirmedCarousel(state) sets _pageState as a side effect');
const synthState = { candidateList: [{ confirmed: true }, { confirmed: false }] };
page9.refreshConfirmedCarousel(synthState);
check('_pageState set after refreshConfirmedCarousel(state)',
      state._pageState === synthState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
