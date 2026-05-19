// tests/test_discovery_page19.js
//
// Sub-module + main re-export coverage for the negative_regions negative-regions
// catalogue (lifecycle scaffolding only — no renderer to test yet).
//
// Round 5 step 14 (chat 38, 2026-05-07): negative_regions promoted from chat-33
// "0-function pure-HTML-scaffold" stub to the _pageState live-binding
// pattern + atlas-router mount/unmount lifecycle. Exact twin of window_summary_table
// step-13 migration; uses the same template.
//
// Page19 has no JS handlers in legacy/Inversion_atlas.html (confirmed by
// `grep nrLoadBtn|nrSummaryCards|_nrRender` returning HTML/CSS/comments
// only — note: the HTML contains an inline comment referencing
// "_nrRender()" as the planned future renderer name, but no JS file
// implements it). The HTML shell shows the static caution banner +
// empty summary cards; mount() does not render anything. This test
// verifies the lifecycle scaffolding is in place so the merge chat /
// a follow-up batch can author the renderers (_nrRender, _nrLoadFile,
// _nrExportCsv, _nrReset) against a stable state shape.
//
// Replaces the chat-33 batch-1 test_discovery_page19.js, which imported
// from the pre-migration path `../inversion_discovery/negative_regions.js` and
// asserted "no exports yet (scaffold only)" — both stale post-migration.

import * as negative_regions from '../atlases/inversion/pages/discovery/negative_regions.js';
import * as state  from '../atlases/inversion/pages/discovery/negative_regions/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('negative_regions.js: lifecycle entry-points');
check('exports mount',                       typeof negative_regions.mount === 'function');
check('exports unmount',                     typeof negative_regions.unmount === 'function');

// -----------------------------------------------------------------------------
group('negative_regions.js: renderer entries (post-cartridge wiring)');
// Legacy shipped only the HTML shell (BATCH_1_NOTES: 0 functions extracted).
// The cartridge supplies the renderer + toolbar wiring that legacy's inline
// HTML comment had stubbed as "_nrRender()".
check('exports refreshNegativeRegions',      typeof negative_regions.refreshNegativeRegions === 'function');
check('exports initNegativeRegionsToolbar',  typeof negative_regions.initNegativeRegionsToolbar === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in negative_regions));

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
