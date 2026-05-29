// tests/test_discovery_dosage_marker_select.js
//
// Unit coverage for pages/discovery/dosage_heatmap/marker_select.js —
// per-marker variance, SNP views, subsample, and cursor/zoom viewport.

import {
  computeMarkerVariance,
  selectMarkers,
  viewportWindow,
  markerViewport,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/marker_select.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// 6 samples, 5 markers. Marker variance increases with marker index:
// marker 0 constant (var 0), marker 4 most variable.
function makeCanonical() {
  const nS = 6, nM = 5;
  const rows = [
    [1, 1, 1, 1, 1, 1],            // var 0
    [0.9, 1.0, 1.1, 0.9, 1.0, 1.1],
    [0.5, 1.0, 1.5, 0.5, 1.0, 1.5],
    [0.2, 1.0, 1.8, 0.2, 1.0, 1.8],
    [0, 0, 0, 2, 2, 2],            // var 1 (max)
  ];
  return {
    n_samples: nS, n_markers: nM,
    cellValue: (m, s) => rows[m][s],
  };
}

// =====================================================================
group('computeMarkerVariance');

const can = makeCanonical();
const v = computeMarkerVariance(can);
check('length = n_markers', v.length === 5);
check('marker 0 variance = 0', Math.abs(v[0]) < 1e-9);
check('variance increases with index', v[0] < v[2] && v[2] < v[4]);
check('marker 4 variance = 1', Math.abs(v[4] - 1) < 1e-9);
check('all-NA marker → NaN', Number.isNaN(computeMarkerVariance({
  n_samples: 2, n_markers: 1, cellValue: () => null,
})[0]));

// =====================================================================
group('selectMarkers — views');

check('all → identity ascending', Array.from(selectMarkers(can, { view: 'all' })).join(',') === '0,1,2,3,4');
const hi = selectMarkers(can, { view: 'high_var', n: 2 });
check('high_var n=2 picks markers 3 & 4', Array.from(hi).join(',') === '3,4');
const lo = selectMarkers(can, { view: 'low_var', n: 2 });
check('low_var n=2 picks markers 0 & 1', Array.from(lo).join(',') === '0,1');
check('selected always ascending', (() => {
  const r = selectMarkers(can, { view: 'high_var', n: 3 });
  for (let i = 1; i < r.length; i++) if (r[i] <= r[i - 1]) return false;
  return true;
})());

const rand = selectMarkers(can, { view: 'random', n: 3, seed: 7 });
check('random n=3 returns 3 markers', rand.length === 3);
check('random is reproducible for a seed', (() => {
  const a = selectMarkers(can, { view: 'random', n: 3, seed: 7 });
  const b = selectMarkers(can, { view: 'random', n: 3, seed: 7 });
  return Array.from(a).join(',') === Array.from(b).join(',');
})());
check('random in-range + unique', (() => {
  const r = Array.from(rand);
  return r.every(i => i >= 0 && i < 5) && new Set(r).size === r.length;
})());
check('n>=nM → all markers', selectMarkers(can, { view: 'high_var', n: 99 }).length === 5);
check('empty canonical → empty', selectMarkers({ n_markers: 0 }, { view: 'all' }).length === 0);

// =====================================================================
group('viewportWindow');

check('zoom 1 → whole list', (() => { const w = viewportWindow(100, 50, 1); return w.start === 0 && w.count === 100; })());
check('zoom 2 → half, centred', (() => { const w = viewportWindow(100, 50, 2); return w.count === 50 && w.start === 25; })());
check('clamps at left edge', (() => { const w = viewportWindow(100, 0, 2); return w.start === 0 && w.count === 50; })());
check('clamps at right edge', (() => { const w = viewportWindow(100, 99, 2); return w.start === 50 && w.count === 50; })());
check('zoom larger than list → count 1', (() => { const w = viewportWindow(3, 1, 16); return w.count === 1; })());
check('empty list → count 0', (() => { const w = viewportWindow(0, 0, 2); return w.count === 0; })());

// =====================================================================
group('markerViewport');

const sel = selectMarkers(can, { view: 'all' });
const mvp = markerViewport(sel, 2, 1);
check('viewport order is Int32Array', mvp.order instanceof Int32Array);
check('zoom 1 shows all 5', mvp.order.length === 5);
const mvp2 = markerViewport(sel, 0, 2);
check('zoom 2 shows ceil(5/2)=3 from start', mvp2.count === 3 && mvp2.start === 0
  && Array.from(mvp2.order).join(',') === '0,1,2');

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
