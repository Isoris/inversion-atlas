// tests/test_discovery_page19.js
//
// Sub-module + main re-export coverage for the page19 negative-regions
// catalogue (lifecycle scaffolding only — no renderer to test yet).
//
// Round 5 step 14 (chat 38, 2026-05-07): page19 promoted from chat-33
// "0-function pure-HTML-scaffold" stub to the _pageState live-binding
// pattern + atlas-router mount/unmount lifecycle. Exact twin of page8
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
// from the pre-migration path `../inversion_discovery/page19.js` and
// asserted "no exports yet (scaffold only)" — both stale post-migration.

import * as page19 from '../atlases/inversion/pages/discovery/page19.js';
import * as state  from '../atlases/inversion/pages/discovery/page19/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page19.js: lifecycle entry-points');
check('exports mount',                       typeof page19.mount === 'function');
check('exports unmount',                     typeof page19.unmount === 'function');

// -----------------------------------------------------------------------------
group('page19.js: stub-preserving (no renderers)');
// Per chat-33 BATCH_1_NOTES: 0 functions extracted — pure HTML scaffold.
// The migration must NOT introduce phantom renderer exports; if a future
// batch adds them (_nrRender, _nrLoadFile, etc.), tighten this assertion
// to allow the specific names.
const exportedNames = Object.keys(page19).sort();
check('only mount + unmount exported (no phantom renderers)',
      exportedNames.length === 2 &&
      exportedNames.includes('mount') &&
      exportedNames.includes('unmount'),
      'got: [' + exportedNames.join(', ') + ']');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page19));

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
