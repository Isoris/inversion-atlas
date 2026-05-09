// tests/test_discovery_page15.js
//
// Sub-module + main re-export coverage for the page15 GHSL haplotype-
// divergence page (lifecycle scaffolding + one wired entry).
//
// Round 5 step 15 (chat 38, 2026-05-07): page15 promoted from chat-33
// "1-function extracted" stub to the _pageState live-binding pattern +
// atlas-router mount/unmount lifecycle + state-aware public wrapper.
//
// Page15 has ONE chat-33 extracted helper (_refreshGhslLayerStatus,
// legacy lines 53065-53081) that toggles five [data-gh-layer] indicator
// chips between "🟢 loaded" / "⚪ not loaded" based on
// state.layersPresent (a Set). The chat-33 helper signature is
// preserved verbatim (takes state as explicit first arg). A new public
// wrapper refreshGhslLayerStatus(state) sets _pageState as a side
// effect before delegating, mirroring page9's refreshConfirmedCarousel
// pattern.
//
// This is the "stub-preserving + one wired entry" pattern (pattern 4
// in CONTINUE_HERE), first instance in the migration.
//
// Replaces the chat-33 batch-1 test_discovery_page15.js, which imported
// from the pre-migration path `../inversion_discovery/page15.js` and
// asserted only that _refreshGhslLayerStatus exists — both stale
// post-migration.

import * as page15 from '../atlases/inversion/pages/discovery/page15.js';
import * as state  from '../atlases/inversion/pages/discovery/page15/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page15.js: lifecycle entry-points');
check('exports mount',                       typeof page15.mount === 'function');
check('exports unmount',                     typeof page15.unmount === 'function');
check('exports refreshGhslLayerStatus',      typeof page15.refreshGhslLayerStatus === 'function');
check('exports _refreshGhslLayerStatus',     typeof page15._refreshGhslLayerStatus === 'function');
check('__MODULE_ID__ NOT exported',          !('__MODULE_ID__' in page15));

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
group('Pure helpers: _refreshGhslLayerStatus runs without throwing in Node (no document)');
let runOK = true; let runErr = null;
try { page15._refreshGhslLayerStatus({ layersPresent: new Set() }); }
catch (e) { runOK = false; runErr = e; }
check('_refreshGhslLayerStatus(state) no-doc → early return',
      runOK, runErr ? runErr.message : '');

let runOK2 = true; let runErr2 = null;
try { page15.refreshGhslLayerStatus({ layersPresent: new Set(['ghsl_panel']) }); }
catch (e) { runOK2 = false; runErr2 = e; }
check('refreshGhslLayerStatus(state) no-doc → early return',
      runOK2, runErr2 ? runErr2.message : '');

// -----------------------------------------------------------------------------
group('refreshGhslLayerStatus(state) sets _pageState as a side effect');
state._setActiveState(null);
const synthState = { layersPresent: new Set(['ghsl_panel', 'ghsl_kstripes']) };
page15.refreshGhslLayerStatus(synthState);
check('_pageState set after refreshGhslLayerStatus(state)',
      state._pageState === synthState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
group('refreshGhslLayerStatus() with no args falls back to _pageState');
// When no state is passed, the wrapper resolves to _pageState (or {} if
// null). Should not throw.
state._setActiveState({ layersPresent: new Set(['cusum_ghsl']) });
let fbOK = true; let fbErr = null;
try { page15.refreshGhslLayerStatus(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshGhslLayerStatus() no-arg fallback runs without throwing',
      fbOK, fbErr ? fbErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
