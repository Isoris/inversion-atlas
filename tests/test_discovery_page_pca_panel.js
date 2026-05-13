// tests/test_discovery_page_pca_panel.js
//
// Unit coverage for pages/discovery/page_pca_panel — the per-window
// PCA scatter cartridge (SPEC_0 §10 Phase 1). Renderer + selection
// are pure JS; full mount/unmount lifecycle is exercised in the
// smoke (DOM polyfill).

import * as page from '../atlases/inversion/pages/discovery/page_pca_panel.js';
import * as state from '../atlases/inversion/pages/discovery/page_pca_panel/_state.js';
import {
  paintScrubberStrip,
  paintScatter,
  findWindowAtPixel,
  findPointAtPixel,
  findPointsInBox,
  buildClusterColorMap,
  variancetoColor,
  axisRange,
} from '../atlases/inversion/pages/discovery/page_pca_panel/renderer.js';
import {
  createPcaPanelSelection,
  summarisePcaResult,
  clusterSizesFromAssignment,
} from '../atlases/inversion/pages/discovery/page_pca_panel/selection.js';

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
check('refreshPcaPanel exported',                typeof page.refreshPcaPanel === 'function');
check('initPcaPanelToolbar exported',            typeof page.initPcaPanelToolbar === 'function');

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',                     '_pageState' in state);
check('_setActiveState fn',                      typeof state._setActiveState === 'function');
check('_pageState starts null',                  state._pageState === null);
state._setActiveState({ marker: 'P' });
check('_setActiveState mutates',                 state._pageState && state._pageState.marker === 'P');
state._setActiveState(null);
check('_setActiveState(null) clears',            state._pageState === null);

// =====================================================================
group('renderer.buildClusterColorMap');

const cm = buildClusterColorMap(3);
check('color map has 0..2',                      ['0','1','2'].every(k => typeof cm[k] === 'string'));
check('cluster 0 differs from cluster 1',        cm[0] !== cm[1]);
check('overrides applied',
      buildClusterColorMap(2, { 1: '#aabbcc' })[1] === '#aabbcc');
check('K=0 still has slot 0',                    typeof buildClusterColorMap(0)[0] === 'string');

// =====================================================================
group('renderer.variancetoColor');

check('t=0 → cream',                             variancetoColor(0) === 'rgb(255,245,235)');
check('t=1 → deep red',                          variancetoColor(1) === 'rgb(165,15,21)');
check('NaN → grey',                              variancetoColor(NaN) === 'rgb(220,220,220)');
check('t clamped above 1',                       variancetoColor(2) === 'rgb(165,15,21)');
check('t clamped below 0',                       variancetoColor(-1) === 'rgb(255,245,235)');

// =====================================================================
group('renderer.axisRange');

const r1 = axisRange([1, 2, 3, 4, 5]);
check('axisRange: min < hi pad',                 r1.min < 1);
check('axisRange: max > hi val',                 r1.max > 5);
const rConst = axisRange([3, 3, 3]);
check('axisRange: coincident values expanded',
      rConst.max - rConst.min >= 1);
const rEmpty = axisRange([]);
check('axisRange: empty → default ±1',           rEmpty.min === -1 && rEmpty.max === 1);
const rNaN = axisRange([NaN, NaN]);
check('axisRange: all-NaN → default ±1',         rNaN.min === -1 && rNaN.max === 1);

// =====================================================================
group('renderer.paintScrubberStrip — fake canvas');

class FakeContext {
  constructor() {
    this.calls = [];
    this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect() { this.calls.push('clearRect'); }
  beginPath() {}
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
  constructor(w, h) { this.width = w || 800; this.height = h || 24; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

const pca_results = [
  { lam1: 0.4, lam2: 0.1, pc1: Float64Array.from([0.5, -0.5, 0.5, -0.5]),
    pc2: Float64Array.from([0.3, 0.3, -0.3, -0.3]),
    polarity_flips_applied: 0 },
  { lam1: 0.8, lam2: 0.2, pc1: Float64Array.from([0.7, -0.7, 0.5, -0.5]),
    pc2: Float64Array.from([0.4, 0.4, -0.4, -0.4]),
    polarity_flips_applied: 1 },
  null,
  { lam1: 0.3, lam2: 0.05, pc1: Float64Array.from([0.1, 0, -0.1, 0.05]),
    pc2: Float64Array.from([0, 0.1, 0, -0.1]),
    polarity_flips_applied: 0 },
];

const sCanvas = new FakeCanvas(800, 24);
const sPaint = paintScrubberStrip(sCanvas, pca_results, { active_window_idx: 1 });
check('scrubber: 4 hit regions',                 sPaint.window_hit_regions.length === 4);
check('scrubber: each region has w > 0',
      sPaint.window_hit_regions.every(h => h.w > 0));
check('scrubber: clearRect called',              sCanvas._ctx.calls.includes('clearRect'));
check('scrubber: fillRect for every cell',
      sCanvas._ctx.calls.filter(c => c === 'fillRect').length === 4);
check('scrubber: active outlined (strokeRect)',  sCanvas._ctx.calls.includes('strokeRect'));
check('null pca_results → 0 hits',
      paintScrubberStrip(sCanvas, null).window_hit_regions.length === 0);
check('empty pca_results → 0 hits',
      paintScrubberStrip(sCanvas, []).window_hit_regions.length === 0);
check('null canvas → 0 hits',
      paintScrubberStrip(null, pca_results).window_hit_regions.length === 0);
check('hit region carries magnitude',
      sPaint.window_hit_regions.every(h => Number.isFinite(h.magnitude)));

// =====================================================================
group('renderer.paintScatter — fake canvas');

const scCanvas = new FakeCanvas(600, 600);
const scPaint = paintScatter(scCanvas, pca_results[1], {
  cluster_assignment: new Int32Array([0, 0, 1, 1]),
});
check('scatter: 4 point hit regions',            scPaint.point_hit_regions.length === 4);
check('scatter: each hit region has positive r',
      scPaint.point_hit_regions.every(h => h.r > 0));
check('scatter: clearRect called',               scCanvas._ctx.calls.includes('clearRect'));
check('scatter: strokeRect for plot frame',      scCanvas._ctx.calls.includes('strokeRect'));
check('scatter: stroke for guide lines',         scCanvas._ctx.calls.includes('stroke'));
check('scatter: 4 fill calls for points',
      scCanvas._ctx.calls.filter(c => c === 'fill').length === 4);
check('scatter: axis labels rendered (fillText)',
      scCanvas._ctx.calls.filter(c => c === 'fillText').length >= 2);
check('scatter: x label = PC1',                  scPaint.x_axis_label === 'PC1');
check('scatter: y label = PC2',                  scPaint.y_axis_label === 'PC2');

const scSwap = paintScatter(new FakeCanvas(), pca_results[1], { axis_choice: 'pc2_pc1' });
check('axis swap: x label = PC2',                scSwap.x_axis_label === 'PC2');
check('axis swap: y label = PC1',                scSwap.y_axis_label === 'PC1');

// Hover/select decoration adds extra strokes.
const scCanvas2 = new FakeCanvas();
paintScatter(scCanvas2, pca_results[1], {
  hovered_sample: 1,
  selected_samples: new Set([0]),
  cluster_assignment: new Int32Array([0, 0, 1, 1]),
});
check('hover + select: extra stroke calls',
      scCanvas2._ctx.calls.filter(c => c === 'stroke').length
      > scCanvas._ctx.calls.filter(c => c === 'stroke').length);

// Null / empty cases.
const emptyHits = paintScatter(scCanvas, null, {});
check('null pca_result: 0 hit regions',          emptyHits.point_hit_regions.length === 0);
check('null canvas: 0 hit regions',
      paintScatter(null, pca_results[1], {}).point_hit_regions.length === 0);

const noPc = paintScatter(scCanvas, { lam1: 1, lam2: 0.5, pc1: null, pc2: null }, {});
check('null pc1/pc2: 0 hit regions',             noPc.point_hit_regions.length === 0);

// Non-finite values still produce hit-region entries, but with r = 0
// so they can't be selected.
const nfPaint = paintScatter(new FakeCanvas(), {
  lam1: 1, lam2: 0.5,
  pc1: Float64Array.from([0.5, NaN, 0.5, 0]),
  pc2: Float64Array.from([0.5, 0.5, NaN, 0]),
}, {});
check('non-finite PC: still 4 hit regions (with r=0)',
      nfPaint.point_hit_regions.length === 4);
check('non-finite PC: r=0 for bad points',
      nfPaint.point_hit_regions[1].r === 0 && nfPaint.point_hit_regions[2].r === 0);

// Labels can be toggled on.
const scLab = new FakeCanvas();
paintScatter(scLab, pca_results[1], {
  show_labels: true,
  sample_labels: ['s0', 's1', 's2', 's3'],
});
check('labels: fillText count grows with show_labels',
      scLab._ctx.calls.filter(c => c === 'fillText').length
      > scCanvas._ctx.calls.filter(c => c === 'fillText').length);

// =====================================================================
group('renderer.findWindowAtPixel');

const h0 = sPaint.window_hit_regions[0];
check('window hit at center',
      findWindowAtPixel(sPaint.window_hit_regions, h0.x + h0.w / 2, h0.y + h0.h / 2) === 0);
check('window miss above',
      findWindowAtPixel(sPaint.window_hit_regions, h0.x, h0.y - 5) === null);
check('null hits → null',                        findWindowAtPixel(null, 0, 0) === null);

// =====================================================================
group('renderer.findPointAtPixel');

const p0 = scPaint.point_hit_regions[0];
check('point hit at center',
      findPointAtPixel(scPaint.point_hit_regions, p0.x, p0.y) === 0);
check('point miss far away',
      findPointAtPixel(scPaint.point_hit_regions, p0.x + 9999, p0.y) === null);
check('null hits → null',                        findPointAtPixel(null, 0, 0) === null);
// Non-finite-PC points (r=0) cannot be hit.
check('r=0 points cannot be hit',
      findPointAtPixel(nfPaint.point_hit_regions,
                       nfPaint.point_hit_regions[1].x,
                       nfPaint.point_hit_regions[1].y) !== 1);

// =====================================================================
group('renderer.findPointsInBox');

const boxHits = [
  { sample_idx: 0, x: 10,  y: 20, r: 4 },
  { sample_idx: 1, x: 60,  y: 30, r: 4 },
  { sample_idx: 2, x: 100, y: 50, r: 4 },
  { sample_idx: 3, x: 200, y: 100, r: 4 },
  { sample_idx: 4, x: 5,   y: 5,  r: 0 },  // r=0 → never hit
];
check('box covers 0-2',
      findPointsInBox(boxHits, { x0: 0, y0: 0, x1: 120, y1: 60 }).sort().join(',') === '0,1,2');
check('reversed box still works',
      findPointsInBox(boxHits, { x0: 120, y0: 60, x1: 0, y1: 0 }).sort().join(',') === '0,1,2');
check('empty box → []',
      findPointsInBox(boxHits, { x0: 300, y0: 300, x1: 400, y1: 400 }).length === 0);
check('r=0 points never selected',
      !findPointsInBox(boxHits, { x0: 0, y0: 0, x1: 999, y1: 999 }).includes(4));
check('null hits → []',                          findPointsInBox(null, { x0: 0, y0: 0, x1: 1, y1: 1 }).length === 0);
check('null box → []',                           findPointsInBox(boxHits, null).length === 0);

// Drag-box overlay drawn on paint.
const drCanvas = new FakeCanvas();
paintScatter(drCanvas, pca_results[1], {
  drag_box: { x0: 50, y0: 50, x1: 150, y1: 150 },
});
check('drag-box: extra strokeRect call for overlay',
      drCanvas._ctx.calls.filter(c => c === 'strokeRect').length
      > scCanvas._ctx.calls.filter(c => c === 'strokeRect').length);

// =====================================================================
group('selection.createPcaPanelSelection');

const sel = createPcaPanelSelection(2);
let n = 0;
sel.subscribe(() => { n++; });

check('initial: active = 2',                     sel.getActiveWindowIdx() === 2);
check('initial: hoveredWindow = null',           sel.getHoveredWindowIdx() === null);
check('initial: hoveredSample = null',           sel.getHoveredSample() === null);
check('initial: selectedSamples empty',          sel.getSelectedSamples().size === 0);
check('getHovered convenience = window',         sel.getHovered() === null);

sel.setActiveWindowIdx(5);
check('active update notifies',                  n === 1);
sel.setActiveWindowIdx(5);
check('repeat active no-op',                     n === 1);

sel.setHoveredWindowIdx(1);
check('hover-window notifies',                   n === 2);
sel.setHoveredWindowIdx(null);
check('clear hover-window notifies',             n === 3);

sel.setHoveredSample(3);
check('hover-sample notifies',                   n === 4);
sel.setHoveredSample(3);
check('repeat hover-sample no-op',               n === 4);
sel.setHoveredSample(null);
check('clear hover-sample notifies',             n === 5);

sel.toggleSelectedSample(0);
sel.toggleSelectedSample(3);
check('two selected',                            sel.getSelectedSamples().size === 2);
sel.toggleSelectedSample(0);
check('toggle removes',                          !sel.getSelectedSamples().has(0));
sel.clearSelection();
check('clearSelection empties',                  sel.getSelectedSamples().size === 0);

sel.setActiveWindowIdx('abc');
check('non-numeric active → null',               sel.getActiveWindowIdx() === null);
sel.toggleSelectedSample(null);
check('toggleSelectedSample(null) no-op',        sel.getSelectedSamples().size === 0);

const unsub = sel.subscribe(() => { n += 100; });
sel.setActiveWindowIdx(8);
check('multi-subscriber notifies all',           n > 100);
unsub();
const before = n;
sel.setActiveWindowIdx(9);
check('unsubscribed not called',                 n - before < 100);

const sel2 = createPcaPanelSelection();
check('default active = 0',                      sel2.getActiveWindowIdx() === 0);

// =====================================================================
group('selection.summarisePcaResult');

const rows = summarisePcaResult(pca_results[1], {
  window_idx: 7, start_bp: 100, end_bp: 200, n_samples: 4,
});
check('summary has Window row',
      rows.find(r => r.label === 'Window').value === '7');
check('summary has Range row',
      rows.find(r => r.label === 'Range').value === '100–200 bp');
check('summary has Samples row',
      rows.find(r => r.label === 'Samples').value === '4');
check('summary has λ1 row',
      rows.find(r => r.label === 'λ1').value === '0.8000');
check('summary has λ2 row',
      rows.find(r => r.label === 'λ2').value === '0.2000');
check('summary has Polarity flips row',
      rows.find(r => r.label === 'Polarity flips').value === '1');

const noPolar = summarisePcaResult(pca_results[0], { window_idx: 0 });
check('summary without polarity-flips omits row',
      !noPolar.find(r => r.label === 'Polarity flips'));

const rowsNull = summarisePcaResult(null, { window_idx: 4 });
check('null pca: PCA: "— (no result)"',
      rowsNull.find(r => r.label === 'PCA').value === '— (no result)');

// =====================================================================
group('selection.clusterSizesFromAssignment');

const cs = clusterSizesFromAssignment(new Int32Array([0, 0, 1, 1, 1, 2]));
check('sorted by count desc',                    cs[0][1] === 3 && cs[1][1] === 2 && cs[2][1] === 1);
check('cluster ids preserved',
      cs.map(([k]) => k).sort().join(',') === '0,1,2');
check('null → []',                               clusterSizesFromAssignment(null).length === 0);
check('empty → []',
      clusterSizesFromAssignment(new Int32Array(0)).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
