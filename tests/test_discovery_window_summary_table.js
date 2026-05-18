// tests/test_discovery_page8.js
//
// Sub-module + main re-export coverage for the window_summary_table per-window summary
// table (lifecycle scaffolding only — no renderer to test yet).
//
// Round 5 step 13 (chat 38, 2026-05-07): window_summary_table promoted from chat-33
// "0-function pure-HTML-scaffold" stub to the _pageState live-binding
// pattern + atlas-router mount/unmount lifecycle. This is the discovery-
// group counterpart of the confirmed_carousel stub-preserving migration (round 5
// step 7).
//
// Page8 has no JS handlers in legacy/Inversion_atlas.html (confirmed by
// `grep winSum` returning HTML/CSS/comments only). The HTML shell shows
// the empty-state #winSumNoChrom message; mount() does not render
// anything. This test verifies the lifecycle scaffolding is in place so
// the merge chat / a follow-up batch can author the renderers
// (winSumTable, winSumStripCanvas, filters) against a stable state shape.
//
// Replaces the chat-33 batch-1 test_discovery_page8.js, which imported
// from the pre-migration path `../inversion_discovery/window_summary_table.js` and
// asserted "no exports yet (scaffold only)" — both stale post-migration.

import * as window_summary_table from '../atlases/inversion/pages/discovery/window_summary_table.js';
import * as state from '../atlases/inversion/pages/discovery/window_summary_table/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('window_summary_table.js: lifecycle entry-points');
check('exports mount',                       typeof window_summary_table.mount === 'function');
check('exports unmount',                     typeof window_summary_table.unmount === 'function');

// -----------------------------------------------------------------------------
group('window_summary_table.js: renderer entries (post-cartridge wiring)');
// Legacy shipped only the HTML shell (BATCH_1_NOTES: 0 functions extracted).
// The cartridge supplies the table + strip + toolbar implementation.
check('exports refreshWinSummary',         typeof window_summary_table.refreshWinSummary === 'function');
check('exports initWinSummaryToolbar',     typeof window_summary_table.initWinSummaryToolbar === 'function');
check('__MODULE_ID__ NOT exported',        !('__MODULE_ID__' in window_summary_table));

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
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
