// tests/test_discovery_dosage_cluster_adaptive_k.js
//
// Unit coverage for pages/discovery/dosage_cluster_adaptive_k — HANDOFF_8
// atlas-side cartridge.

import * as page from '../atlases/inversion/pages/discovery/dosage_cluster_adaptive_k.js';
import * as state from '../atlases/inversion/pages/discovery/dosage_cluster_adaptive_k/_state.js';
import {
  paintClusterCurves,
  findClusterAtPixel,
  curvesRange,
  verdictColor,
  verdictLabel,
  clusterColor,
} from '../atlases/inversion/pages/discovery/dosage_cluster_adaptive_k/renderer.js';
import {
  createDosageClusterSelection,
  summariseKEntry,
  entryToDisplay,
  clusterSizesFromLabels,
} from '../atlases/inversion/pages/discovery/dosage_cluster_adaptive_k/selection.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');
check('mount exported',                          typeof page.mount === 'function');
check('unmount exported',                        typeof page.unmount === 'function');
check('refreshDosageCluster exported',           typeof page.refreshDosageCluster === 'function');
check('initDosageClusterToolbar exported',       typeof page.initDosageClusterToolbar === 'function');

// =====================================================================
group('_state.js — live-binding');
check('_pageState starts null',                  state._pageState === null);
state._setActiveState({ marker: 'C' });
check('_setActiveState mutates',                 state._pageState.marker === 'C');
state._setActiveState(null);
check('_setActiveState(null) clears',            state._pageState === null);

// =====================================================================
group('renderer.verdictColor / verdictLabel');
check('verdictColor: structure_detected = green',
      verdictColor('structure_detected') === '#2BAA50');
check('verdictColor: no_structure = grey',
      verdictColor('no_structure') === '#888888');
check('verdictColor: insufficient = orange',
      verdictColor('insufficient_data') === '#cf6e2a');
check('verdictLabel: known label',
      verdictLabel('structure_detected') === 'Structure detected');
check('verdictLabel: unknown passthrough',
      verdictLabel('something_else') === 'something_else');

// =====================================================================
group('renderer.clusterColor');
check('cluster 0 distinct from cluster 1',       clusterColor(0) !== clusterColor(1));
check('cluster wraps at palette size',           clusterColor(0) === clusterColor(9));
check('negative cluster id still returns a color',
      typeof clusterColor(-1) === 'string');

// =====================================================================
group('renderer.curvesRange');
const r1 = curvesRange([Float64Array.from([1, 2, 3]), Float64Array.from([0, 4, 5])]);
check('curvesRange: min/max captured',
      r1.min < 0 && r1.max > 5);
check('curvesRange: empty → default 0..1',
      curvesRange([]).min === 0 && curvesRange([]).max === 1);
check('curvesRange: all NaN → default',
      curvesRange([Float64Array.from([NaN, NaN])]).min === 0);
check('curvesRange: coincident → padded',
      curvesRange([Float64Array.from([1, 1, 1])]).max - curvesRange([Float64Array.from([1, 1, 1])]).min >= 1);

// =====================================================================
group('renderer.paintClusterCurves');

class FakeContext {
  constructor() {
    this.calls = [];
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect() { this.calls.push('clearRect'); }
  beginPath() { this.calls.push('beginPath'); }
  moveTo()   {}
  lineTo()   {}
  stroke()   { this.calls.push('stroke'); }
  fillRect() { this.calls.push('fillRect'); }
  strokeRect() { this.calls.push('strokeRect'); }
  arc()      {}
  fill()     { this.calls.push('fill'); }
  fillText() { this.calls.push('fillText'); }
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 600; this.height = h || 320; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

const curves = [
  Float64Array.from([0.5, 0.6, 0.55, 0.62, 0.59]),
  Float64Array.from([1.5, 1.4, 1.45, 1.42, 1.50]),
  Float64Array.from([0.05, 0.08, 0.10, 0.06, 0.04]),
];
const cc = new FakeCanvas();
const pr = paintClusterCurves(cc, curves);
check('paint: 3 hit regions',                    pr.curve_hit_regions.length === 3);
check('paint: layout returned',                  pr.plot && pr.plot.w > 0 && pr.plot.h > 0);
check('paint: clearRect called',                 cc._ctx.calls.includes('clearRect'));
check('paint: stroke called 3 times for curves',
      cc._ctx.calls.filter(c => c === 'stroke').length >= 3);
check('paint: strokeRect for plot frame',        cc._ctx.calls.includes('strokeRect'));
check('paint: axis labels rendered',
      cc._ctx.calls.filter(c => c === 'fillText').length >= 2);

const ccHov = new FakeCanvas();
paintClusterCurves(ccHov, curves, { hovered_cluster: 1 });
check('paint with hover: still 3 strokes',
      ccHov._ctx.calls.filter(c => c === 'stroke').length >= 3);

const ccGuide = new FakeCanvas();
paintClusterCurves(ccGuide, curves, { highlighted_window: 2 });
check('paint with guide: extra stroke for guide',
      ccGuide._ctx.calls.filter(c => c === 'stroke').length
      >= cc._ctx.calls.filter(c => c === 'stroke').length);

check('null canvas → empty',
      paintClusterCurves(null, curves).curve_hit_regions.length === 0);
check('null curves → empty',
      paintClusterCurves(new FakeCanvas(), null).curve_hit_regions.length === 0);
check('empty curves → empty',
      paintClusterCurves(new FakeCanvas(), []).curve_hit_regions.length === 0);

// =====================================================================
group('renderer.findClusterAtPixel');

const hits = [
  { cluster_id: 0, x: 10, y: 50,  w: 100, h: 12 },
  { cluster_id: 1, x: 10, y: 150, w: 100, h: 12 },
  { cluster_id: 2, x: 10, y: 250, w: 100, h: 12 },
];
check('hit closest to cluster 0',                findClusterAtPixel(hits, 50, 56) === 0);
check('hit closest to cluster 1',                findClusterAtPixel(hits, 50, 156) === 1);
check('miss far from any',                       findClusterAtPixel(hits, 50, 0) === null);
check('miss off x-axis',                         findClusterAtPixel(hits, 999, 156) === null);
check('null hits → null',                        findClusterAtPixel(null, 0, 0) === null);

// =====================================================================
group('selection.createDosageClusterSelection');

const sel = createDosageClusterSelection(3);
let n = 0;
sel.subscribe(() => { n++; });

check('initial: focusedK = 3',                   sel.getFocusedK() === 3);
check('initial: hoveredCluster = null',          sel.getHoveredCluster() === null);

sel.setFocusedK(5);
check('setFocusedK notifies',                    n === 1);
sel.setFocusedK(5);
check('repeat no-op',                            n === 1);
sel.setFocusedK(null);
check('clear focusedK notifies',                 n === 2);

sel.setHoveredCluster(1);
check('hover cluster notifies',                  n === 3);
sel.setHoveredCluster(null);
check('clear hover cluster notifies',            n === 4);

// Default initialFocusK
const sel2 = createDosageClusterSelection();
check('default focusedK = null',                 sel2.getFocusedK() === null);

// =====================================================================
group('selection.summariseKEntry');

const entry = {
  K: 3, passes: true,
  silhouette: 0.42, stability: 0.85,
  min_size: 12, spatial_coherence: 0.71,
  delta_sil: 0.07,
  labels: new Int32Array([0,0,1,1,2,2,1,0]),
  cluster_curves: [Float64Array.from([1,2,3])],
};
const rows = summariseKEntry(entry);
check('summary has K row',                       rows.find(r => r.label === 'K').value === '3');
check('summary has silhouette row',              rows.find(r => r.label === 'silhouette').value === '0.420');
check('summary has Δsil with sign',              rows.find(r => r.label === 'Δsil').value === '+0.070');
check('summary has passes row',                  rows.find(r => r.label === 'passes').value === 'yes');
check('summary handles negative Δsil',
      summariseKEntry({ ...entry, delta_sil: -0.05 }).find(r => r.label === 'Δsil').value === '-0.050');
check('summary null entry → []',                 summariseKEntry(null).length === 0);

// =====================================================================
group('selection.entryToDisplay');

const result = {
  verdict: 'structure_detected',
  K_chosen: 2,
  per_K: [
    { K: 1, passes: true, cluster_curves: null },
    { K: 2, passes: true, cluster_curves: [Float64Array.from([1])] },
    { K: 3, passes: false, cluster_curves: [Float64Array.from([2])] },
  ],
  chosen_labels: new Int32Array([0,0,1,1]),
};
check('focusedK present → use it',
      entryToDisplay(result, 3).K === 3);
check('focusedK missing → K_chosen',
      entryToDisplay(result, null).K === 2);
check('K_chosen missing → first non-null curves',
      entryToDisplay({ per_K: result.per_K }, null).K === 2);
check('empty per_K → null',
      entryToDisplay({ per_K: [] }, null) === null);
check('null result → null',
      entryToDisplay(null, null) === null);

// =====================================================================
group('selection.clusterSizesFromLabels');
const cs = clusterSizesFromLabels(new Int32Array([0,0,1,1,1,2]));
check('sorted desc',                              cs[0][1] === 3 && cs[1][1] === 2 && cs[2][1] === 1);
check('null → []',                                clusterSizesFromLabels(null).length === 0);
check('empty → []',                               clusterSizesFromLabels(new Int32Array(0)).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
