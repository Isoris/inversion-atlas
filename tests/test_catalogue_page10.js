// tests/test_catalogue_page10.js
//
// Sub-module + main re-export coverage + behavioural exercises for the
// page10 marker panels page.
//
// Round 5 step 9 (chat 36, 2026-05-07): page10 refactored from chat-33
// factory-only pattern (`wirePage10(state) → { renderPage10,
// renderMarkerPage }`) to add the standard atlas-router lifecycle
// alongside (mount/unmount/renderPage10/_pageState live-binding). The
// factory is RETAINED verbatim — same approach as page_overview
// (round 5 step 8). All chat-33 behavioural cases preserved.

import * as page10 from '../atlases/inversion/pages/catalogue/page10.js';
import * as state  from '../atlases/inversion/pages/catalogue/page10/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('page10.js: lifecycle entry-points (NEW round 5 step 9)');
check('exports mount',                       typeof page10.mount === 'function');
check('exports unmount',                     typeof page10.unmount === 'function');
check('exports renderPage10',                typeof page10.renderPage10 === 'function');
check('exports renderMarkerPage (compat)',   typeof page10.renderMarkerPage === 'function');

// -----------------------------------------------------------------------------
group('page10.js: backward-compat factory (legacy chat-33 surface)');
check('exports wirePage10',                  typeof page10.wirePage10 === 'function');
check('exports default',                     typeof page10.default === 'function');
check('default is wirePage10',               page10.default === page10.wirePage10);

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',                  '_pageState' in state);
check('exports _setActiveState',             typeof state._setActiveState === 'function');
state._setActiveState(null);
check('_pageState clearable',                state._pageState === null);
state._setActiveState({ marker: 'P10' });
check('_setActiveState mutates _pageState',  state._pageState && state._pageState.marker === 'P10');
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Backward-compat: wirePage10 returns expected handle (chat-33 contract)');
const handle = page10.wirePage10({ data: {}, candidateList: [] });
check('wirePage10 returns object',                       handle && typeof handle === 'object');
check('handle.renderPage10 is function',                 typeof handle.renderPage10 === 'function');
check('handle.renderMarkerPage is function',             typeof handle.renderMarkerPage === 'function');
check('renderPage10 === renderMarkerPage (same fn)',     handle.renderPage10 === handle.renderMarkerPage);

// wirePage10(state) propagates to _pageState (round 5 step 9 added this)
const wireState = { source: 'factory', data: {}, candidateList: [] };
page10.wirePage10(wireState);
check('wirePage10(state) sets _pageState too',           state._pageState === wireState);
state._setActiveState(null);

// -----------------------------------------------------------------------------
group('Behavioural: empty-layers path (subtitle + empty-state HTML) — preserved from chat-33');
{
  const slot = { innerHTML: '' };
  const subtitle = { textContent: '' };
  globalThis.document = {
    getElementById: id => {
      if (id === 'page10Content') return slot;
      if (id === 'page10Subtitle') return subtitle;
      return null;
    },
  };
  const localState = { data: { _layers_present: [] }, candidateList: [] };
  const { renderPage10 } = page10.wirePage10(localState);
  renderPage10();
  check('empty-layers subtitle set to "(no marker layer loaded)"',
        subtitle.textContent === '(no marker layer loaded)');
  check('empty-layers slot HTML mentions "No marker panels loaded"',
        slot.innerHTML.includes('No marker panels loaded'));
}

// -----------------------------------------------------------------------------
group('Behavioural: missing slot DOM tolerated — preserved from chat-33');
{
  globalThis.document = { getElementById: () => null };
  const { renderPage10 } = page10.wirePage10({ data: {}, candidateList: [] });
  let threw = false;
  try { renderPage10(); } catch (e) { threw = true; }
  check('renderPage10 with missing DOM does not throw', !threw);
}

// -----------------------------------------------------------------------------
group('Behavioural: layer present but zero summaries — preserved from chat-33');
{
  const slot = { innerHTML: '' };
  const subtitle = { textContent: '' };
  globalThis.document = {
    getElementById: id => id === 'page10Content' ? slot : id === 'page10Subtitle' ? subtitle : null,
  };
  const localState = {
    data: {
      _layers_present: ['marker_panel_summary'],
      marker_panel_summary: [],
      marker_catalogue: [],
      marker_primers: [],
    },
    candidateList: [],
  };
  const { renderPage10 } = page10.wirePage10(localState);
  renderPage10();
  check('zero-summaries empty state rendered',
        slot.innerHTML.includes('Marker layer loaded but no panels emitted'));
}

// -----------------------------------------------------------------------------
group('NEW: renderPage10(state) direct entry — same behaviour as factory.renderPage10()');
{
  const slot = { innerHTML: '' };
  const subtitle = { textContent: '' };
  globalThis.document = {
    getElementById: id => id === 'page10Content' ? slot : id === 'page10Subtitle' ? subtitle : null,
  };
  const localState = { data: { _layers_present: [] }, candidateList: [] };
  let threw = false;
  try { page10.renderPage10(localState); } catch (e) { threw = true; }
  check('direct renderPage10(state) does not throw',         !threw);
  check('direct renderPage10 hits empty-layers branch',      slot.innerHTML.includes('No marker panels loaded'));
  check('direct renderPage10 sets _pageState',               state._pageState === localState);
  state._setActiveState(null);
}

// -----------------------------------------------------------------------------
group('NEW: renderMarkerPage(state) direct entry (legacy alias)');
{
  const slot = { innerHTML: '' };
  const subtitle = { textContent: '' };
  globalThis.document = {
    getElementById: id => id === 'page10Content' ? slot : id === 'page10Subtitle' ? subtitle : null,
  };
  const localState = { data: { _layers_present: [] }, candidateList: [] };
  let threw = false;
  try { page10.renderMarkerPage(localState); } catch (e) { threw = true; }
  check('direct renderMarkerPage(state) does not throw',     !threw);
  check('direct renderMarkerPage hits empty-layers branch',  slot.innerHTML.includes('No marker panels loaded'));
  state._setActiveState(null);
}

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
