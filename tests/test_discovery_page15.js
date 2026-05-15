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

// 2026-05-15 — panel renderers added.
check('exports refreshGhslPanelVisibility',  typeof page15.refreshGhslPanelVisibility === 'function');
check('exports _refreshGhslPanelVisibility', typeof page15._refreshGhslPanelVisibility === 'function');
check('exports renderGhslPanels',            typeof page15.renderGhslPanels === 'function');
check('exports _renderGhslCtrlBar',          typeof page15._renderGhslCtrlBar === 'function');
check('exports _drawGhslMeanStrip',          typeof page15._drawGhslMeanStrip === 'function');
check('exports _drawGhslHeatmap',            typeof page15._drawGhslHeatmap === 'function');
check('exports _drawGhslLines',              typeof page15._drawGhslLines === 'function');
check('exports _renderGhslSampleTable',      typeof page15._renderGhslSampleTable === 'function');

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
group('Panel-visibility helper: no-doc → early return');
let visOK = true; let visErr = null;
try { page15._refreshGhslPanelVisibility({ layersPresent: new Set() }); }
catch (e) { visOK = false; visErr = e; }
check('_refreshGhslPanelVisibility(state) no-doc → early return',
      visOK, visErr ? visErr.message : '');

// -----------------------------------------------------------------------------
group('Panel renderers: no-doc → early return on synthetic ghsl_panel');
// Build a tiny synthetic ghsl_panel matching the documented shape from
// shared/ghsl_panel.js — verifies the renderers walk the data structure
// without throwing in a Node environment (no DOM; getElementById absent).
const synthPanel = {
  n_samples: 4, n_windows: 6,
  samples: ['CGA001', 'CGA002', 'CGA003', 'CGA004'],
  scales: ['s10k', 's25k', 's100k'],
  primary_scale: 's25k',
  div_roll: {
    s25k: [
      [0.10, 0.12, 0.18, 0.22, 0.15, 0.11],
      [0.08, 0.11, 0.14, 0.20, 0.13, 0.09],
      [0.30, 0.32, 0.40, 0.50, 0.42, 0.31],
      [null, 0.13, 0.17, NaN, 0.16, 0.10],
    ],
    s10k: [[0.05,0.06,0.07,0.08,0.09,0.10],
           [0.05,0.06,0.07,0.08,0.09,0.10],
           [0.20,0.22,0.25,0.28,0.30,0.31],
           [0.05,0.06,0.07,0.08,0.09,0.10]],
    s100k: [[0.20,0.22,0.24,0.26,0.28,0.30],
            [0.20,0.22,0.24,0.26,0.28,0.30],
            [0.50,0.52,0.55,0.58,0.60,0.62],
            [0.20,0.22,0.24,0.26,0.28,0.30]],
  },
};
const synthStripes = {
  by_k: {
    '3': { stripe_per_sample: [0, 0, 1, 2], stripe_means: [0.10, 0.40, 0.13],
           stripe_medians: [0.11, 0.40, 0.13], n_per_stripe: [2, 1, 1] },
  },
};
const renderState = {
  activeChrom: 'LG28',
  layersPresent: new Set(['ghsl_panel', 'ghsl_kstripes']),
  data: { ghsl_panel: synthPanel, ghsl_kstripes: synthStripes },
};

let renderOK = true; let renderErr = null;
try { page15.renderGhslPanels(renderState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderGhslPanels(state) no-doc + synthetic ghsl_panel → no throw',
      renderOK, renderErr ? renderErr.message : '');

// Each individual renderer should also no-throw without DOM.
for (const [name, fn] of [
  ['_renderGhslCtrlBar',     page15._renderGhslCtrlBar],
  ['_drawGhslMeanStrip',     page15._drawGhslMeanStrip],
  ['_drawGhslHeatmap',       page15._drawGhslHeatmap],
  ['_drawGhslLines',         page15._drawGhslLines],
  ['_renderGhslSampleTable', page15._renderGhslSampleTable],
]) {
  let ok = true; let err = null;
  try { fn(renderState); } catch (e) { ok = false; err = e; }
  check(`${name}(state) no-doc → no throw`, ok, err ? err.message : '');
}

// renderGhslPanels with no ghsl_panel → no-op, no throw.
let emptyOK = true; let emptyErr = null;
try { page15.renderGhslPanels({ layersPresent: new Set() }); }
catch (e) { emptyOK = false; emptyErr = e; }
check('renderGhslPanels(state) without ghsl_panel → no-op no throw',
      emptyOK, emptyErr ? emptyErr.message : '');

state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
