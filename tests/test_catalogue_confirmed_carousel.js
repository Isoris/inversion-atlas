// tests/test_catalogue_page9.js
//
// Sub-module + main re-export coverage for the confirmed_carousel confirmed carousel.
//
// Round 5 step 7 (chat 36, 2026-05-07): confirmed_carousel refactored from chat-33
// "single-file with const state = window.state || {}" pattern to the
// _pageState live-binding pattern + atlas-router mount/unmount lifecycle.
//
// Page9 is a stub even in legacy: the HTML shell (#confirmedNavBar etc.)
// has no JS handlers in legacy/Inversion_atlas.html. Migration preserves
// the no-op stub behaviour: empty-state placeholder shown when no
// confirmed candidates; "carousel not yet wired" message when there are
// confirmed candidates. Full carousel implementation deferred (TODO_MISSING).

import * as confirmed_carousel from '../atlases/inversion/pages/catalogue/confirmed_carousel.js';
import * as state from '../atlases/inversion/pages/catalogue/confirmed_carousel/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('confirmed_carousel.js: lifecycle entry-points');
check('exports mount',                       typeof confirmed_carousel.mount === 'function');
check('exports unmount',                     typeof confirmed_carousel.unmount === 'function');
check('exports refreshConfirmedCarousel',    typeof confirmed_carousel.refreshConfirmedCarousel === 'function');
check('exports initConfirmedCarousel',       typeof confirmed_carousel.initConfirmedCarousel === 'function');

// -----------------------------------------------------------------------------
group('confirmed_carousel.js: __MODULE_ID__ removed');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in confirmed_carousel));

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
try { confirmed_carousel.refreshConfirmedCarousel(); }
catch (e) { runOK = false; runErr = e; }
check('refreshConfirmedCarousel() no-doc → early return',  runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { confirmed_carousel.refreshConfirmedCarousel({ candidateList: [] }); }
catch (e) { runOK2 = false; runErr2 = e; }
check('refreshConfirmedCarousel(state) no-doc → early return',  runOK2, runErr2 ? runErr2.message : '');

// initConfirmedCarousel is a stub — should not throw
let initOK = true; let initErr = null;
try { confirmed_carousel.initConfirmedCarousel(); }
catch (e) { initOK = false; initErr = e; }
check('initConfirmedCarousel() runs without throwing',  initOK, initErr ? initErr.message : '');

// reset
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('refreshConfirmedCarousel(state) sets _pageState as a side effect');
const synthState = { candidateList: [{ confirmed: true }, { confirmed: false }] };
confirmed_carousel.refreshConfirmedCarousel(synthState);
check('_pageState set after refreshConfirmedCarousel(state)',
      state._pageState === synthState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
