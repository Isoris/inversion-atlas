// tests/test_catalogue_page_overview.js
//
// Sub-module + main re-export coverage for the page_overview synthesis tab.
//
// Round 5 step 8 (chat 36, 2026-05-07): page_overview refactored from
// chat-33 factory-only pattern to add the standard atlas-router
// lifecycle (mount/unmount/_pageState live-binding). The factory
// `wirePageOverview` is RETAINED for backward-compat — anything that
// was importing it keeps working.
//
// Page_overview is empty-stub-in-legacy: legacy/Inversion_atlas.html
// line 9322 is `<div id="page_overview" class="page"></div>` with no
// JS handlers anywhere. Migration preserves that no-op semantics
// while wiring the lifecycle for future synthesis-overview work.

import * as pageOv from '../atlases/inversion/pages/catalogue/page_overview.js';
import * as state  from '../atlases/inversion/pages/catalogue/page_overview/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page_overview.js: lifecycle entry-points (NEW round 5 step 8)');
check('exports mount',                       typeof pageOv.mount === 'function');
check('exports unmount',                     typeof pageOv.unmount === 'function');
check('exports renderPageOverview',          typeof pageOv.renderPageOverview === 'function');

// -----------------------------------------------------------------------------
group('page_overview.js: backward-compat factory (legacy chat-33 surface)');
check('exports wirePageOverview',            typeof pageOv.wirePageOverview === 'function');
check('exports default',                     typeof pageOv.default === 'function');
check('default is wirePageOverview',         pageOv.default === pageOv.wirePageOverview);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
check('_pageState starts null',              state._pageState === null);
state._setActiveState({ marker: 'OV' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'OV');
state._setActiveState(null);
check('_setActiveState(null) clears',        state._pageState === null);

// -----------------------------------------------------------------------------
group('renderPageOverview: no-op (matches legacy empty-div behaviour)');
let renderRet, renderThrew = false;
try { renderRet = pageOv.renderPageOverview(); }
catch (e) { renderThrew = true; }
check('renderPageOverview() does not throw',           !renderThrew);
check('renderPageOverview() returns undefined (no-op)', renderRet === undefined);

// renderPageOverview(state) sets _pageState as a side effect
const synthState = { foo: 'bar' };
pageOv.renderPageOverview(synthState);
check('renderPageOverview(state) sets _pageState',     state._pageState === synthState);
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('wirePageOverview: backward-compat factory still works');
const handle = pageOv.wirePageOverview({ data: {} });
check('wirePageOverview returns object',                  handle && typeof handle === 'object');
check('handle has renderPageOverview',                    typeof handle.renderPageOverview === 'function');

let factoryRenderThrew = false;
try { handle.renderPageOverview(); } catch (e) { factoryRenderThrew = true; }
check('factory renderPageOverview() does not throw',     !factoryRenderThrew);

// wirePageOverview also propagates state to _pageState (round 5 step 8 added this)
const factoryState = { source: 'factory' };
pageOv.wirePageOverview(factoryState);
check('wirePageOverview(state) sets _pageState too',      state._pageState === factoryState);
state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
