// tests/test_analysis_anchor_track_cache_adapter.js
//
// Adapter coverage. buildInput, saveOutput, buildLiveCache.

import {
  buildInput,
  saveOutput,
  buildLiveCache,
  runAnchorTrackCache,
} from '../atlases/inversion/analysis/anchor_track_cache/adapter_atlas.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function _w(idx, K, labels) { return { idx, K, labels }; }
const FIXTURE_WINDOWS = [
  _w(0, 2, [1, 0, 1, 0, 1, 0, 1, 0]),
  _w(1, 2, [1, 0, 1, 0, 1, 0, 1, 0]),
  _w(2, 2, [0, 0, 0, 0, 1, 1, 1, 1]),
  _w(3, 2, [0, 0, 0, 0, 1, 1, 1, 1]),
  _w(4, 2, [0, 0, 0, 0, 1, 1, 1, 1]),
  _w(5, 2, [0, 0, 0, 0, 1, 1, 1, 1]),
];

// =====================================================================
group('buildInput — atlasState path');
{
  const atlasState = {
    data: { chrom: 'LG28', windows: FIXTURE_WINDOWS },
  };
  const input = await buildInput({}, { atlasState });
  check('chrom inferred',                          input.chrom === 'LG28');
  check('windows pulled',                          input.windows.length === 6);
  check('anchors default to all valid windows',
        input.anchors.length === 6 && input.anchors.includes(3));
}

// =====================================================================
group('buildInput — aplr path');
{
  const fakeAplr = {
    async resolveLayer(id) {
      if (id === 'win:42') return { chrom: 'LG28', windows: FIXTURE_WINDOWS };
      return null;
    },
  };
  const input = await buildInput({
    window_layer_id: 'win:42',
    anchors: [3],
  }, { aplr: fakeAplr });
  check('aplr resolved layer',                     input.windows.length === 6);
  check('caller-supplied anchors respected',       input.anchors.length === 1 && input.anchors[0] === 3);
  check('input_layer_ids populated',               input.input_layer_ids.includes('win:42'));
}

// =====================================================================
group('saveOutput — local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeResult = {
    chrom: 'LG28', s_window: 0, e_window: 5,
    n_windows: 6, n_anchors: 1, source: 'compute',
    tracks: [{ anchor_w: 3, K_a: 2, disabled: false,
                v_track: new Array(6).fill(1.0),
                h_off_track: new Array(6).fill(0),
                k_w_track: new Array(6).fill(2) }],
    input_layer_ids: [], params_used: {},
  };
  const sink = await saveOutput(fakeResult, {}, { atlasState: localState });
  check('local-stash path used',                   sink.layer_status === 'local_stash');
  check('layer_id encodes chrom',                  sink.layer_id.indexOf('LG28') >= 0);
  check('stash present',
        localState.inversion._anchor_tracks
     && localState.inversion._anchor_tracks.LG28 === fakeResult);
}

// =====================================================================
group('saveOutput — aplr path');
{
  let committed = null;
  const fakeAplr = {
    async commitLayer(layer) { committed = layer; return { layer_id: 'lay:99' }; },
  };
  const sink = await saveOutput({
    chrom: 'LG28', s_window: 0, e_window: 5,
    n_windows: 6, n_anchors: 0, source: 'insufficient',
    tracks: [], input_layer_ids: [], params_used: {},
  }, {}, { aplr: fakeAplr });
  check('aplr.commitLayer called',                 committed !== null);
  check('layer_type = anchor_track_cache',         committed.layer_type === 'anchor_track_cache');
  check('layer_id from aplr',                      sink.layer_id === 'lay:99');
}

// =====================================================================
group('saveOutput — aplr throws → local fallback');
{
  const localState = { inversion: {} };
  const sink = await saveOutput({
    chrom: 'LG28', s_window: 0, e_window: 0, n_windows: 0,
    n_anchors: 0, source: 'insufficient', tracks: [],
    input_layer_ids: [], params_used: {},
  }, {}, {
    aplr: { async commitLayer() { throw new Error('x'); } },
    atlasState: localState,
  });
  check('on aplr failure → falls back to local stash',
        sink.layer_status === 'local_stash');
}

// =====================================================================
group('buildLiveCache — fast live API');
{
  const atlasState = { data: { chrom: 'LG28', windows: FIXTURE_WINDOWS } };
  const cache = buildLiveCache(atlasState);
  // V at anchor=3 should be 1.0 across windows 2..5 (same partition)
  // and 0.0 at windows 0..1 (broken).
  check('V(3, 3) = 1.0',                           Math.abs(cache.getV(3, 3) - 1.0) < 1e-6);
  check('V(3, 4) = 1.0',                           Math.abs(cache.getV(3, 4) - 1.0) < 1e-6);
  check('V(3, 0) = 0.0',                           Math.abs(cache.getV(3, 0)) < 1e-6);
  // Second call same anchor → cache hit.
  cache.getV(3, 2);
  cache.getV(3, 5);
  const s = cache.stats();
  check('live cache memoises within anchor',
        s.n_hits >= 1 && s.n_computed >= 1);
}

// =====================================================================
group('buildLiveCache — empty atlasState');
{
  const cache = buildLiveCache(null);
  check('null atlas → disabled cache',             cache.stats().disabled === true);
  check('disabled cache returns NaN on getV',      Number.isNaN(cache.getV(0, 0)));
  const empty = buildLiveCache({ data: { windows: [] } });
  check('empty windows → disabled cache',          empty.stats().disabled === true);
}

// =====================================================================
group('runAnchorTrackCache — end-to-end');
{
  const atlasState = {
    data: { chrom: 'LG28', windows: FIXTURE_WINDOWS },
    inversion: {},
  };
  const { result, sink } = await runAnchorTrackCache(
    { anchors: [3] },
    { atlasState });
  check('end-to-end result emitted',               result.source === 'compute');
  check('end-to-end sink emitted',                 sink && sink.layer_status === 'local_stash');
  check('atlasState stashed result',
        atlasState.inversion._anchor_tracks.LG28 === result);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
