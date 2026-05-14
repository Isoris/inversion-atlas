// tests/test_analysis_anchor_track_cache_compute.js
//
// JSON-in / JSON-out compute() coverage for the anchor-track cache.

import { compute } from '../atlases/inversion/analysis/anchor_track_cache/compute.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const FIXTURE = JSON.parse(readFileSync(
  '/home/user/inversion-atlas/atlases/inversion/analysis/anchor_track_cache/example_input.json',
  'utf8'));

// =====================================================================
group('compute — null / empty inputs');
check('null input → insufficient',
      compute(null).source === 'insufficient');
check('empty windows → insufficient',
      compute({ windows: [], anchors: [0] }).source === 'insufficient');
check('empty anchors → insufficient',
      compute({ windows: FIXTURE.windows, anchors: [] }).source === 'insufficient');

// =====================================================================
group('compute — fixture');
const out = compute(FIXTURE);
check('chrom propagated',                       out.chrom === 'LG28');
check('source = compute',                       out.source === 'compute');
check('n_anchors = 1',                          out.n_anchors === 1);
check('n_windows = 10',                         out.n_windows === 10);
check('s_window inferred from idx',             out.s_window === 0);
check('e_window inferred from idx',             out.e_window === 9);

const track = out.tracks[0];
check('track has anchor_w',                     track.anchor_w === 4);
check('track has K_a = 2',                      track.K_a === 2);
check('track v_track length = 10',              track.v_track.length === 10);
check('track h_off_track length = 10',          track.h_off_track.length === 10);
check('V(anchor=4, w=4) = 1.0',                 Math.abs(track.v_track[4] - 1.0) < 1e-6);
check('V(anchor=4, w=2) = 1.0 (interior)',      Math.abs(track.v_track[2] - 1.0) < 1e-6);
check('V(anchor=4, w=0) = 0.0 (REGIME_END)',    Math.abs(track.v_track[0]) < 1e-6);
check('V(anchor=4, w=9) = 0.0 (REGIME_END)',    Math.abs(track.v_track[9]) < 1e-6);
check('all v_track entries are finite or null', track.v_track.every(v => v === null || Number.isFinite(v)));

// =====================================================================
group('compute — multiple anchors');
const multi = compute({ ...FIXTURE, anchors: [4, 0] });
check('multi: n_anchors = 2',                   multi.n_anchors === 2);
check('multi: anchor[0] = 4',                   multi.tracks[0].anchor_w === 4);
check('multi: anchor[1] = 0',                   multi.tracks[1].anchor_w === 0);

// =====================================================================
group('compute — bad anchor records disabled track');
const badAnchor = compute({
  windows: FIXTURE.windows,
  anchors: [99],   // out-of-range
});
check('out-of-range anchor → disabled track',
      badAnchor.tracks[0] && badAnchor.tracks[0].disabled === true);
check('source = insufficient when every anchor disabled',
      badAnchor.source === 'insufficient');

// =====================================================================
group('compute — params override s/e window');
const narrow = compute({ ...FIXTURE, params: { s_window: 2, e_window: 6 } });
check('narrow range: s_window = 2',             narrow.s_window === 2);
check('narrow range: e_window = 6',             narrow.e_window === 6);
check('narrow range: v_track length = 5',       narrow.tracks[0].v_track.length === 5);

// =====================================================================
group('compute — provenance round-tripping');
const prov = compute({
  ...FIXTURE,
  input_layer_ids: ['scrubber_main:LG28', 'v_cache:source'],
});
check('input_layer_ids round-tripped',
      prov.input_layer_ids.length === 2
   && prov.input_layer_ids.includes('v_cache:source'));

// =====================================================================
group('compute — output is JSON-serialisable');
let s;
try { s = JSON.stringify(out); } catch (_) { s = null; }
check('output is JSON-serialisable',            typeof s === 'string');
check('round-trip preserves n_anchors',         JSON.parse(s).n_anchors === out.n_anchors);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
