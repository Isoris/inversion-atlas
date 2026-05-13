// tests/test_discovery_page_similarity_panel.js
//
// Unit coverage for pages/discovery/page_similarity_panel — the
// HANDOFF_10 atlas-side cartridge for the per-window similarity
// matrix + ARI block-transition strip. Renderer + selection are
// pure JS; the full mount/unmount lifecycle is exercised in the
// smoke (DOM polyfill).

import * as page from '../atlases/inversion/pages/discovery/page_similarity_panel.js';
import * as state from '../atlases/inversion/pages/discovery/page_similarity_panel/_state.js';
import {
  paintTransitionTrack,
  paintSimilarityMatrix,
  findWindowAtPixel,
  findCellAtPixel,
  deriveSampleOrder,
  similarityValueToColor,
  ariValueToColor,
  buildBlockColorMap,
} from '../atlases/inversion/pages/discovery/page_similarity_panel/renderer.js';
import {
  createSimilarityPanelSelection,
  summariseWindow,
  blockSizesFromAssignment,
} from '../atlases/inversion/pages/discovery/page_similarity_panel/selection.js';

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
check('refreshSimilarityPanel exported',         typeof page.refreshSimilarityPanel === 'function');
check('initSimilarityPanelToolbar exported',     typeof page.initSimilarityPanelToolbar === 'function');

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',                     '_pageState' in state);
check('_setActiveState fn',                      typeof state._setActiveState === 'function');
check('_pageState starts null',                  state._pageState === null);
state._setActiveState({ marker: 'S' });
check('_setActiveState mutates',                 state._pageState && state._pageState.marker === 'S');
state._setActiveState(null);
check('_setActiveState(null) clears',            state._pageState === null);

// =====================================================================
group('renderer.similarityValueToColor');

// Default mode is 'reds' (sequential cream → deep red).
check('reds: v=0 → cream-ish (high R, G, B)',
      similarityValueToColor(0) === 'rgb(255,245,235)');
check('reds: v=1 → deep red',
      similarityValueToColor(1) === 'rgb(165,15,21)');
check('reds: v=0.5 → orange mid-stop',
      similarityValueToColor(0.5) === 'rgb(252,141,89)');
check('NaN → grey',
      similarityValueToColor(NaN) === 'rgb(220,220,220)');
check('reds: custom vmin/vmax respected',
      similarityValueToColor(0.5, 0, 1) === 'rgb(252,141,89)');

// Diverging mode kept available.
check('diverging: v=1 → deep red',
      /rgb\(255,\d+,\d+\)/.test(similarityValueToColor(1, -1, 1, 'diverging')));
check('diverging: v=0 → white',
      similarityValueToColor(0, -1, 1, 'diverging') === 'rgb(255,255,255)');
check('diverging: v=-1 → deep blue',
      /rgb\(\d+,\d+,200\)/.test(similarityValueToColor(-1, -1, 1, 'diverging')));

// =====================================================================
group('renderer.ariValueToColor');

check('ARI = 1 green-ish',                       /rgb\(220,200,80\)/.test(ariValueToColor(1)));
check('ARI = 0 red-ish',                         /rgb\(255,80,80\)/.test(ariValueToColor(0)));
check('NaN → grey',                              ariValueToColor(NaN) === 'rgb(220,220,220)');

// =====================================================================
group('renderer.buildBlockColorMap');

const cm = buildBlockColorMap(3);
check('color map has 0..2',                      ['0','1','2'].every(k => typeof cm[k] === 'string'));
check('block 0 differs from block 1',            cm[0] !== cm[1]);
const cmOver = buildBlockColorMap(2, { 1: '#aabbcc' });
check('overrides applied',                       cmOver[1] === '#aabbcc');
check('K=0 still has slot 0',                    typeof buildBlockColorMap(0)[0] === 'string');

// =====================================================================
group('renderer.deriveSampleOrder');

const natural = deriveSampleOrder('natural', null, 5);
check('natural: identity 0..4',
      Array.from(natural).join(',') === '0,1,2,3,4');
const assign = new Int32Array([1, 0, 1, 0, 1]);
const byBlock = deriveSampleOrder('by_block', assign, 5);
check('by_block: block 0 first (samples 1, 3)',
      byBlock[0] === 1 && byBlock[1] === 3);
check('by_block: block 1 after (samples 0, 2, 4)',
      byBlock[2] === 0 && byBlock[3] === 2 && byBlock[4] === 4);
const unknown = deriveSampleOrder('something_else', assign, 5);
check('unknown mode → natural',
      Array.from(unknown).join(',') === '0,1,2,3,4');

// =====================================================================
group('renderer.paintTransitionTrack — fake canvas');

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
  fillText() { this.calls.push('fillText'); }
}
class FakeCanvas {
  constructor(w, h) { this.width = w || 800; this.height = h || 56; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

const windows = [
  { idx: 0, similarity: new Float64Array(16), K: 2, assignment: new Int32Array(4), n_markers_in_window: 25, silhouette_score: 0.5 },
  { idx: 1, similarity: new Float64Array(16), K: 2, assignment: new Int32Array(4), n_markers_in_window: 25, silhouette_score: 0.6 },
  { idx: 2, similarity: null,                  K: 1, assignment: null,             n_markers_in_window: 5,  silhouette_score: 0 },
  { idx: 3, similarity: new Float64Array(16), K: 3, assignment: new Int32Array(4), n_markers_in_window: 25, silhouette_score: 0.4 },
];
const ari = new Float64Array([0.8, NaN, 0.3]);
const tCanvas = new FakeCanvas(800, 56);
const tPaint = paintTransitionTrack(tCanvas, windows, ari, { active_window_idx: 1 });
check('transition: 4 window hit regions',        tPaint.window_hit_regions.length === 4);
check('transition: hit region widths > 0',
      tPaint.window_hit_regions.every(h => h.w > 0));
check('transition: clearRect called',            tCanvas._ctx.calls.includes('clearRect'));
check('transition: fillRect for each window',
      tCanvas._ctx.calls.filter(c => c === 'fillRect').length >= 4);
check('transition: active window outlined (strokeRect)',
      tCanvas._ctx.calls.includes('strokeRect'));
check('null windows → 0 hits',
      paintTransitionTrack(tCanvas, null, ari).window_hit_regions.length === 0);
check('empty windows → 0 hits',
      paintTransitionTrack(tCanvas, [], ari).window_hit_regions.length === 0);
check('null canvas → 0 hits',
      paintTransitionTrack(null, windows, ari).window_hit_regions.length === 0);

// =====================================================================
group('renderer.paintSimilarityMatrix — fake canvas');

// Build a 4×4 similarity matrix.
const n = 4;
const S = new Float64Array(n * n);
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++) {
    S[i * n + j] = (i === j) ? 1
                  : (Math.abs(i - j) <= 1 ? 0.7 : 0.1);
  }
}
const wr = { idx: 0, similarity: S, K: 2, assignment: new Int32Array([0, 0, 1, 1]),
             n_markers_in_window: 30, silhouette_score: 0.5 };
const mCanvas = new FakeCanvas(400, 400);
const mGeom = paintSimilarityMatrix(mCanvas, wr, {});
check('matrix: cell_size > 0',                   mGeom.cell_size > 0);
check('matrix: n_samples = 4',                   mGeom.n_samples === 4);
// 16 matrix cells + 8 cluster-band cells (4 top + 4 left, on by default)
check('matrix: fillRect for every cell + band',
      mCanvas._ctx.calls.filter(c => c === 'fillRect').length === 16 + 8);
check('matrix: clearRect called',                mCanvas._ctx.calls.includes('clearRect'));
check('matrix: strokeRect called (overlay + outline)',
      mCanvas._ctx.calls.filter(c => c === 'strokeRect').length >= 2);

// Cluster bands can be turned off.
const mCanvasNoBands = new FakeCanvas(400, 400);
paintSimilarityMatrix(mCanvasNoBands, wr, { show_cluster_bands: false });
check('matrix (no bands): 16 fillRect calls',
      mCanvasNoBands._ctx.calls.filter(c => c === 'fillRect').length === 16);

const mCanvas2 = new FakeCanvas(400, 400);
const mGeom2 = paintSimilarityMatrix(mCanvas2, wr, {
  sample_order: deriveSampleOrder('by_block', wr.assignment, 4),
  show_block_overlay: false,
});
check('matrix (by_block, no overlay): cell_size > 0', mGeom2.cell_size > 0);
check('matrix (no overlay): fewer strokeRect calls',
      mCanvas2._ctx.calls.filter(c => c === 'strokeRect').length <
      mCanvas._ctx.calls.filter(c => c === 'strokeRect').length);

// Hover crosshair adds 2 strokeRect calls regardless of overlay.
const mCanvas3 = new FakeCanvas(400, 400);
paintSimilarityMatrix(mCanvas3, wr, {
  hovered_cell: { i: 1, j: 2 },
  show_block_overlay: false,
});
check('matrix (hovered, no overlay): hover crosshair drawn',
      mCanvas3._ctx.calls.filter(c => c === 'strokeRect').length >= 3);

const noSim = { idx: 0, similarity: null, K: 1, assignment: null,
                n_markers_in_window: 0, silhouette_score: 0 };
const mGeomEmpty = paintSimilarityMatrix(new FakeCanvas(), noSim, {});
check('null-similarity: cell_size = 0',          mGeomEmpty.cell_size === 0);
check('null canvas: cell_size = 0',
      paintSimilarityMatrix(null, wr, {}).cell_size === 0);
check('null window_record: cell_size = 0',
      paintSimilarityMatrix(new FakeCanvas(), null, {}).cell_size === 0);

// =====================================================================
group('renderer.findWindowAtPixel');

const hits = tPaint.window_hit_regions;
const h0 = hits[0];
check('window hit at center',
      findWindowAtPixel(hits, h0.x + h0.w / 2, h0.y + h0.h / 2) === 0);
check('window miss above',                       findWindowAtPixel(hits, h0.x, h0.y - 5) === null);
check('null window hits → null',                 findWindowAtPixel(null, 0, 0) === null);

// =====================================================================
group('renderer.findCellAtPixel');

const cellCenter = (r, c) => ({
  x: mGeom.x_origin + (c + 0.5) * mGeom.cell_size,
  y: mGeom.y_origin + (r + 0.5) * mGeom.cell_size,
});
const center11 = cellCenter(1, 1);
const center02 = cellCenter(0, 2);
const c11 = findCellAtPixel(mGeom, center11.x, center11.y);
check('cell hit at (1,1) → {i:1, j:1}',          c11 && c11.i === 1 && c11.j === 1);
const c02 = findCellAtPixel(mGeom, center02.x, center02.y);
check('cell hit at (0,2) → {i:0, j:2}',          c02 && c02.i === 0 && c02.j === 2);
check('cell miss out of bounds',                 findCellAtPixel(mGeom, 0, 0) === null);
check('null geom → null',                        findCellAtPixel(null, 100, 100) === null);

// by_block permutation produces ID-space hits (canonical sample IDs)
const order = deriveSampleOrder('by_block', wr.assignment, 4);
const mGeomOrdered = paintSimilarityMatrix(new FakeCanvas(), wr, { sample_order: order });
// Top-left cell in display space → first sample in order space.
const tl = findCellAtPixel(mGeomOrdered, mGeomOrdered.x_origin + 1, mGeomOrdered.y_origin + 1);
check('by_block: top-left → order[0]',           tl && tl.i === order[0] && tl.j === order[0]);

// =====================================================================
group('selection.createSimilarityPanelSelection');

const sel = createSimilarityPanelSelection(3);
let nNotify = 0;
sel.subscribe(() => { nNotify++; });

check('initial: active = 3',                     sel.getActiveWindowIdx() === 3);
check('initial: hoveredWindow = null',           sel.getHoveredWindowIdx() === null);
check('initial: hoveredCell = null',             sel.getHoveredCell() === null);
check('initial: selectedSamples empty',          sel.getSelectedSamples().size === 0);
check('getHovered convenience = window',         sel.getHovered() === null);

sel.setActiveWindowIdx(5);
check('set active notifies',                     nNotify === 1);
check('active = 5',                              sel.getActiveWindowIdx() === 5);
sel.setActiveWindowIdx(5);
check('repeat set active no-op',                 nNotify === 1);

sel.setHoveredWindowIdx(2);
check('hover window notifies',                   nNotify === 2);
sel.setHoveredWindowIdx(2);
check('repeat hover window no-op',               nNotify === 2);
sel.setHoveredWindowIdx(null);
check('clear hover window notifies',             nNotify === 3);

sel.setHoveredCell({ i: 1, j: 2 });
check('hover cell notifies',                     nNotify === 4);
check('hovered cell read back',
      sel.getHoveredCell() && sel.getHoveredCell().i === 1 && sel.getHoveredCell().j === 2);
sel.setHoveredCell({ i: 1, j: 2 });
check('repeat hover cell no-op',                 nNotify === 4);
sel.setHoveredCell(null);
check('clear hover cell notifies',               nNotify === 5);
sel.setHoveredCell({ i: NaN, j: 2 });
check('non-finite cell → null',                  sel.getHoveredCell() === null);

sel.toggleSelectedSample(0);
sel.toggleSelectedSample(2);
check('two selected samples',                    sel.getSelectedSamples().size === 2);
sel.toggleSelectedSample(0);
check('toggle removes',                          !sel.getSelectedSamples().has(0));
sel.clearSelection();
check('clearSelection empties',                  sel.getSelectedSamples().size === 0);

// Non-finite inputs coerce
sel.setActiveWindowIdx('abc');
check('non-numeric active → null',               sel.getActiveWindowIdx() === null);
sel.toggleSelectedSample(null);
check('toggleSelectedSample(null) no-op',        sel.getSelectedSamples().size === 0);

const unsub = sel.subscribe(() => { nNotify += 100; });
sel.setActiveWindowIdx(7);
check('multi-subscriber notifies all',           nNotify > 100);
unsub();
const before = nNotify;
sel.setActiveWindowIdx(8);
check('unsubscribed not called',                 nNotify - before < 100);

// Default initialActiveIdx
const sel2 = createSimilarityPanelSelection();
check('default active = 0',                      sel2.getActiveWindowIdx() === 0);

// =====================================================================
group('selection.summariseWindow');

const sw = summariseWindow({
  idx: 5, start_bp: 100000, end_bp: 200000,
  n_markers_in_window: 42, K: 3, silhouette_score: 0.612,
});
check('summary has Window row',                  sw.find(r => r.label === 'Window').value === '5');
check('summary has Range row',                   sw.find(r => r.label === 'Range').value === '100000–200000 bp');
check('summary has Markers row',                 sw.find(r => r.label === 'Markers').value === '42');
check('summary has K row',                       sw.find(r => r.label === 'K blocks').value === '3');
check('summary has Silhouette row',              sw.find(r => r.label === 'Silhouette').value === '0.612');

const swNoBp = summariseWindow({ idx: 0, n_markers_in_window: 0, K: 1, silhouette_score: NaN });
check('summary without bp omits Range',          !swNoBp.find(r => r.label === 'Range'));
check('summary NaN silhouette → "—"',
      swNoBp.find(r => r.label === 'Silhouette').value === '—');
check('null window → single empty row',
      summariseWindow(null).length === 1
   && summariseWindow(null)[0].value === '—');

// =====================================================================
group('selection.blockSizesFromAssignment');

const bs = blockSizesFromAssignment(new Int32Array([0, 0, 1, 1, 1, 2]));
check('block sizes sorted desc by count',
      bs[0][1] === 3 && bs[1][1] === 2 && bs[2][1] === 1);
check('block ids preserved',
      bs.map(([k]) => k).sort().join(',') === '0,1,2');
check('null assignment → []',
      blockSizesFromAssignment(null).length === 0);
check('empty assignment → []',
      blockSizesFromAssignment(new Int32Array(0)).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
