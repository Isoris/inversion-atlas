// tests/test_review_popstats.js
//
// Sub-module + main re-export coverage for the popstats track-stack view.
//
// 2026-05-20: rewritten for the native-port architecture. Previous incarnation
// of this test asserted the chat-33 thin-loader-stub fallback ("Popstats
// wiring (atlas_page6_wiring.js) not loaded"). That fallback was retired when
// renderPopstatsPage was ported into ./popstats/_render.js — the page now
// resolves scrubber_main and renders chips + a canvas track stack directly.
//
// This test verifies:
//   - Module exports present (mount, unmount, refreshPage6, plus the
//     showPopstatsPage / refreshPopstatsPage back-compat aliases).
//   - _state.js live-binding pattern.
//   - Sub-module helpers (collectTracks / loadView / saveView / categoryOf)
//     are pure and Node-friendly.

import * as popstats   from '../atlases/popstats/pages/review/popstats.js';
import * as state      from '../atlases/popstats/pages/review/popstats/_state.js';
import * as tracksMod  from '../atlases/popstats/pages/review/popstats/_tracks.js';
import * as viewMod    from '../atlases/popstats/pages/review/popstats/_view.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// localStorage polyfill — saveView/loadView call it.
if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
  };
}

// -----------------------------------------------------------------------------
group('popstats.js: lifecycle entry-points');
check('exports mount',                  typeof popstats.mount === 'function');
check('exports unmount',                typeof popstats.unmount === 'function');
check('exports refreshPage6',           typeof popstats.refreshPage6 === 'function');
check('exports showPopstatsPage alias', typeof popstats.showPopstatsPage === 'function');
check('exports refreshPopstatsPage alias',
      typeof popstats.refreshPopstatsPage === 'function');
check('__MODULE_ID__ not exported',     !('__MODULE_ID__' in popstats));

// -----------------------------------------------------------------------------
group('_state.js: live-binding pattern');
check('exports _pageState',             '_pageState' in state);
check('exports _setActiveState',        typeof state._setActiveState === 'function');
state._setActiveState(null);
check('_pageState starts null',         state._pageState === null);
state._setActiveState({ marker: 'A' });
check('_setActiveState mutates _pageState',
      state._pageState && state._pageState.marker === 'A');
state._setActiveState(null);
check('_setActiveState(null) clears',   state._pageState === null);

// -----------------------------------------------------------------------------
group('refreshPage6() with no _pageState: degenerate fallback (does not throw)');
state._setActiveState(null);
let fbOK = true; let fbErr = null;
try { popstats.refreshPage6(); }
catch (e) { fbOK = false; fbErr = e; }
check('refreshPage6() with null _pageState does not throw',
      fbOK, fbErr ? fbErr.message : '');

// -----------------------------------------------------------------------------
group('_tracks.js: collectTracks() shape on empty data');
const emptyTracks = tracksMod.collectTracks(null);
check('collectTracks(null) returns array',         Array.isArray(emptyTracks));
check('collectTracks(null) includes ideogram',     emptyTracks.some(t => t.id === 'ideogram'));
check('collectTracks(null) ideogram alwaysOn',
      emptyTracks.find(t => t.id === 'ideogram')?.alwaysOn === true);
check('collectTracks(null) z track has hasData=false',
      emptyTracks.find(t => t.id === 'z')?.hasData === false);

// -----------------------------------------------------------------------------
group('_tracks.js: collectTracks() with synthetic precomp data');
const synth = {
  windows: [
    { center_mb: 1.0, z: 0.5 },
    { center_mb: 2.0, z: 1.2 },
    { center_mb: 3.0, z: 3.5 },
  ],
  tracks: {
    theta_pi: { values: [0.01, 0.02, 0.015] },
    ghsl_overlap: { values: [0, 1, 0] },
  },
};
const t2 = tracksMod.collectTracks(synth);
check('collectTracks(synth) z track has hasData=true',
      t2.find(t => t.id === 'z')?.hasData === true);
// theta_pi from data.tracks adopts the static popstats placeholder rather
// than minting a tracksdict_ chip → the static entry's chip lights up.
check('collectTracks(synth) theta_pi static chip lit by data.tracks.theta_pi',
      (() => {
        const t = t2.find(x => x.id === 'theta_pi');
        if (!t || typeof t.getData !== 'function') return false;
        const d = t.getData(synth);
        return !!d && t.hasData === true
          && Array.isArray(d.mb) && Array.isArray(d.values)
          && d.values.length === 3;
      })());
check('collectTracks(synth) ghsl_overlap appears as auto-discovered',
      t2.some(t => t.id === 'tracksdict_ghsl_overlap'));
check('collectTracks sort: always category before popstats',
      (() => {
        const cats = t2.map(t => t.category || 'other');
        const idxAlways  = cats.indexOf('always');
        const idxPop     = cats.indexOf('popstats');
        return idxAlways < idxPop || idxPop === -1;
      })());
check('collectTracks sort: popstats category before qc',
      (() => {
        const cats = t2.map(t => t.category || 'other');
        const idxPop = cats.indexOf('popstats');
        const idxQc  = cats.indexOf('qc');
        return idxPop < idxQc || idxQc === -1 || idxPop === -1;
      })());
check('collectTracks: popstats chip set includes theta_pi + hobs_hexp + delta12_multi',
      ['theta_pi', 'hobs_hexp', 'delta12_multi'].every(id => t2.some(t => t.id === id)));

// -----------------------------------------------------------------------------
group('_view.js: chip-toggle persistence');
localStorage.clear();
const v0 = viewMod.loadView();
check('loadView() empty store returns hidden+shown Sets',
      v0.hidden instanceof Set && v0.shown instanceof Set);
v0.shown.add('theta_pi');
v0.hidden.add('z');
viewMod.saveView(v0);
const v1 = viewMod.loadView();
check('saveView round-trips shown',  v1.shown.has('theta_pi'));
check('saveView round-trips hidden', v1.hidden.has('z'));

// -----------------------------------------------------------------------------
group('_view.js: categoryOf + isVisible defaults');
check('categoryOf({category:"qc"}) === qc',
      viewMod.categoryOf({ category: 'qc' }) === 'qc');
check('categoryOf({}) === other',
      viewMod.categoryOf({}) === 'other');
const emptyView = { hidden: new Set(), shown: new Set() };
check('isVisible(alwaysOn, ...) === true',
      viewMod.isVisible({ alwaysOn: true }, emptyView));
check('isVisible(qc-track-with-data, empty-view) === false',
      !viewMod.isVisible({ category: 'qc', hasData: true, id: 'x' }, emptyView));
emptyView.shown.add('x');
check('isVisible(qc-track-with-data, shown-has-x) === true',
      viewMod.isVisible({ category: 'qc', hasData: true, id: 'x' }, emptyView));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
