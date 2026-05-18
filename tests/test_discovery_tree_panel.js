// tests/test_discovery_tree_panel.js
//
// Unit coverage for pages/discovery/tree_panel — the HANDOFF_5
// atlas-side tree panel cartridge. Renderer + selection are pure
// JS; the full mount/unmount lifecycle is exercised in the smoke
// (DOM polyfill).

import * as page from '../atlases/inversion/pages/discovery/tree_panel.js';
import * as state from '../atlases/inversion/pages/discovery/tree_panel/_state.js';
import {
  layoutFromMglTree,
  paintTree,
  findLeafAtPixel,
} from '../atlases/inversion/pages/discovery/tree_panel/renderer.js';
import {
  ariBetweenTreeAndClusters,
  createTreePanelSelection,
} from '../atlases/inversion/pages/discovery/tree_panel/selection.js';
import { buildNjTree } from '../atlases/inversion/shared/mgl_nj_tree.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('page entry — public exports');

check('mount exported',                  typeof page.mount === 'function');
check('unmount exported',                typeof page.unmount === 'function');
check('refreshTreePanel exported',       typeof page.refreshTreePanel === 'function');
check('initTreePanelToolbar exported',   typeof page.initTreePanelToolbar === 'function');

// =====================================================================
group('_state.js — live-binding pattern');

check('_pageState exported',          '_pageState' in state);
check('_setActiveState fn',           typeof state._setActiveState === 'function');
check('_pageState starts null',       state._pageState === null);
state._setActiveState({ marker: 'X' });
check('_setActiveState mutates',      state._pageState && state._pageState.marker === 'X');
state._setActiveState(null);
check('_setActiveState(null) clears', state._pageState === null);

// =====================================================================
group('renderer.layoutFromMglTree — round-trip via Newick');

// Build a small tree.
const tree = buildNjTree([
  [0, 5, 9, 9],
  [5, 0, 10, 10],
  [9, 10, 0, 8],
  [9, 10, 8, 0],
], ['a', 'b', 'c', 'd']);
const layout = layoutFromMglTree(tree, { cladogram: true });
check('layout: leaves count = 4',           layout.leaves.length === 4);
check('layout: every leaf has x/y',         layout.leaves.every(l => Number.isFinite(l.x) && Number.isFinite(l.y)));
check('layout: every leaf has id',          layout.leaves.every(l => typeof l.id === 'string' && l.id.length > 0));
check('layout: nodes array populated',      layout.nodes.length > 0);
check('layout: edges array populated',      layout.edges.length > 0);
check('layout: maxX > 0',                   layout.maxX > 0);

check('null tree → null layout',            layoutFromMglTree(null) === null);
check('empty nodes → null layout',          layoutFromMglTree({nodes: []}) === null);

// =====================================================================
group('renderer.paintTree — fake canvas');

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
  arc()      {}
  fill()     { this.calls.push('fill'); }
  fillText() { this.calls.push('fillText'); }
}
class FakeCanvas {
  constructor() { this.width = 800; this.height = 400; this._ctx = new FakeContext(); }
  getContext() { return this._ctx; }
}

const canvas = new FakeCanvas();
const paint = paintTree(canvas, layout, {
  leaf_colors_by_id: { a: '#aa0000', b: '#00aa00' },
});
check('paint: leaf_hit_regions = 4',            paint.leaf_hit_regions.length === 4);
check('paint: hit regions have r > 0',
      paint.leaf_hit_regions.every(h => h.r > 0));
check('paint: canvas cleared',                  canvas._ctx.calls.includes('clearRect'));
check('paint: stroke called for edges',         canvas._ctx.calls.includes('stroke'));
check('paint: fill called for leaf dots',       canvas._ctx.calls.includes('fill'));
check('paint: labels rendered (fillText)',      canvas._ctx.calls.includes('fillText'));

// Empty layout / null canvas
const emptyPaint = paintTree(canvas, null);
check('null layout: 0 hit regions',             emptyPaint.leaf_hit_regions.length === 0);
const nullPaint = paintTree(null, layout);
check('null canvas: 0 hit regions',             nullPaint.leaf_hit_regions.length === 0);

// =====================================================================
group('renderer.findLeafAtPixel');

const regions = [
  { leaf_id: 'a', x: 100, y: 50,  r: 5 },
  { leaf_id: 'b', x: 100, y: 100, r: 5 },
  { leaf_id: 'c', x: 100, y: 150, r: 5 },
];
check('hit at center',                          findLeafAtPixel(regions, 100, 50)  === 'a');
check('hit at edge',                            findLeafAtPixel(regions, 104, 100) === 'b');
check('miss',                                   findLeafAtPixel(regions, 200, 200) === null);
check('null regions → null',                    findLeafAtPixel(null, 0, 0) === null);

// =====================================================================
group('selection.createTreePanelSelection');

const sel = createTreePanelSelection();
let notifyCount = 0;
sel.subscribe(() => { notifyCount++; });

check('initial: getHovered() = null',           sel.getHovered() === null);
check('initial: selected is empty',             sel.getSelected().size === 0);

sel.setHovered('a');
check('setHovered notifies',                    notifyCount === 1);
check('hovered = a',                            sel.getHovered() === 'a');
sel.setHovered('a');   // no-op
check('repeat setHovered does not re-notify',   notifyCount === 1);
sel.setHovered(null);
check('clear hover notifies',                   notifyCount === 2 && sel.getHovered() === null);

sel.toggleSelected('a');
sel.toggleSelected('b');
check('two selected',                           sel.getSelected().size === 2);
sel.toggleSelected('a');
check('toggle removes',                         !sel.getSelected().has('a'));
sel.clearSelection();
check('clearSelection empties',                 sel.getSelected().size === 0);

const unsub = sel.subscribe(() => { notifyCount += 100; });
sel.setHovered('c');
check('multi-subscriber: both notified',        notifyCount > 100);
unsub();
sel.setHovered(null);
check('unsubscribed: extra notifier not called', notifyCount < 200);

// =====================================================================
group('selection.ariBetweenTreeAndClusters');

// Tree above: a, b, c, d with (a,b) grouping vs (c,d). Cluster labels
// matching: a→1, b→1, c→2, d→2 → ARI = 1.
const ari_match = ariBetweenTreeAndClusters(tree, [1, 1, 2, 2], 2);
check('ARI: perfect match → 1',                Math.abs(ari_match.ari - 1) < 1e-6);
check('ARI: n_leaves = 4',                     ari_match.n_leaves === 4);

// Inverted labels (same partition under permutation) → ARI = 1
const ari_perm = ariBetweenTreeAndClusters(tree, [9, 9, 5, 5], 2);
check('ARI: permuted labels → 1',              Math.abs(ari_perm.ari - 1) < 1e-6);

// Different partition → lower ARI
const ari_bad = ariBetweenTreeAndClusters(tree, [1, 2, 1, 2], 2);
check('ARI: cross-partition < 1',              ari_bad.ari < 1);

// Null inputs
check('null tree → NaN',
      Number.isNaN(ariBetweenTreeAndClusters(null, [1, 1, 2, 2]).ari));
check('null labels → NaN',
      Number.isNaN(ariBetweenTreeAndClusters(tree, null).ari));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
