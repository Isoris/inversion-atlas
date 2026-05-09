// tests/test_discovery_page12.js
//
// Sub-module + main re-export coverage + behavioural exercises for the
// page12 local-PCA-θπ chromosome-wide diversity scanner.
//
// Round 5 step 10 (chat 36, 2026-05-07): page12 refactored from chat-33
// "8 verbatim helpers, state-as-first-arg, no lifecycle" pattern to
// add the standard atlas-router lifecycle (mount/unmount/renderPage12 +
// state-aware wrappers + _pageState live-binding) on top of the verbatim
// 8 helpers (which are kept underscore-prefixed and still exported for
// callers that pass state explicitly).
//
// Page12 is the θπ sister of page1: same six-panel layout, but reads
// theta_pi_* layers from state.data instead of dosage. Empty-state
// placeholder until R-pipeline ships layers.

import * as page12 from '../atlases/inversion/pages/discovery/page12.js';
import * as state  from '../atlases/inversion/pages/discovery/page12/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page12.js: lifecycle entry-points (NEW round 5 step 10)');
check('exports mount',                   typeof page12.mount === 'function');
check('exports unmount',                 typeof page12.unmount === 'function');
check('exports renderPage12',            typeof page12.renderPage12 === 'function');

// -----------------------------------------------------------------------------
group('page12.js: state-aware wrappers (NEW round 5 step 10)');
const wrappers = [
  'refreshThetaPiLayerStatus',
  'refreshThetaPiPanelVisibility',
  'drawThCusumHero',
  'drawThLinesPanel',
  'drawThSimMatPanel',
  'drawThZPanel',
  'drawThAnchorStripPanel',
  'drawThPcaPanel',
];
for (const name of wrappers) {
  check(`exports ${name}`, typeof page12[name] === 'function');
}

// -----------------------------------------------------------------------------
group('page12.js: verbatim underscore-prefixed helpers (preserved from chat-33)');
const verbatim = [
  '_refreshThetaPiLayerStatus',
  '_refreshThetaPiPanelVisibility',
  '_drawThCusumHero',
  '_drawThLinesPanel',
  '_drawThSimMatPanel',
  '_drawThZPanel',
  '_drawThAnchorStripPanel',
  '_drawThPcaPanel',
];
for (const name of verbatim) {
  check(`exports ${name}`, typeof page12[name] === 'function');
}

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
state._setActiveState(null);
check('_pageState clearable',                state._pageState === null);
state._setActiveState({ marker: 'P12' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'P12');
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Behavioural: helpers tolerate missing document (Node without DOM)');
// _refreshThetaPiLayerStatus + _refreshThetaPiPanelVisibility check
// `typeof document === 'undefined'` and early-return — they should not
// throw when called without a document.
{
  const noDoc = (() => { try { return typeof document === 'undefined'; } catch { return true; } })();
  // Save and remove document for the next two tests; if it's already
  // undefined, no-op.
  const savedDoc = (typeof globalThis.document !== 'undefined') ? globalThis.document : undefined;
  delete globalThis.document;

  let threw1 = false;
  try { page12._refreshThetaPiLayerStatus({ layersPresent: new Set() }); }
  catch (e) { threw1 = true; }
  check('_refreshThetaPiLayerStatus tolerates no-document', !threw1);

  let threw2 = false;
  try { page12._refreshThetaPiPanelVisibility({ layersPresent: new Set() }); }
  catch (e) { threw2 = true; }
  check('_refreshThetaPiPanelVisibility tolerates no-document', !threw2);

  let threw3 = false;
  try { page12._drawThCusumHero({ data: null }); }
  catch (e) { threw3 = true; }
  check('_drawThCusumHero tolerates null data (early return)', !threw3);

  if (savedDoc !== undefined) globalThis.document = savedDoc;
}

// -----------------------------------------------------------------------------
group('State-aware wrappers: set _pageState as side effect');
state._setActiveState(null);

const probeState = { layersPresent: new Set(['theta_pi_per_window']), data: null };
page12.refreshThetaPiLayerStatus(probeState);
check('refreshThetaPiLayerStatus(state) sets _pageState',  state._pageState === probeState);

state._setActiveState(null);
page12.refreshThetaPiPanelVisibility(probeState);
check('refreshThetaPiPanelVisibility(state) sets _pageState', state._pageState === probeState);

state._setActiveState(null);
page12.drawThCusumHero(probeState);
check('drawThCusumHero(state) sets _pageState',  state._pageState === probeState);

state._setActiveState(null);
page12.renderPage12(probeState);
check('renderPage12(state) sets _pageState',  state._pageState === probeState);

state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Wrappers: tolerate no-state argument when _pageState is null');
// When called with no args and _pageState is null, the wrapper falls
// back to `{}` which gives the helper a defined-but-empty state. The
// helpers internally check `state.layersPresent && state.layersPresent.has(...)`
// etc., so they tolerate missing fields gracefully.
state._setActiveState(null);

let threw = false;
try { page12.refreshThetaPiLayerStatus(); } catch (e) { threw = true; }
check('refreshThetaPiLayerStatus() with no state + null _pageState does not throw', !threw);

let threw2 = false;
try { page12.refreshThetaPiPanelVisibility(); } catch (e) { threw2 = true; }
check('refreshThetaPiPanelVisibility() with no state + null _pageState does not throw', !threw2);

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
