// tests/smoke_discovery_tree_panel_round5.mjs
//
// Full mount/unmount lifecycle smoke for the tree-panel cartridge.
// Mirrors smoke_review_page_ancestry_scroller in shape.

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/tree_panel.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/tree_panel/_state.js`);
const tree_mod = await import(`${WORKSPACE}/atlases/inversion/shared/mgl_nj_tree.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// DOM polyfill
// =====================================================================

class FakeContext {
  constructor() {
    this.calls = []; this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect(...a) { this.calls.push(['clearRect', ...a]); }
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() { this.calls.push(['stroke']); }
  fillRect(...a) { this.calls.push(['fillRect', ...a]); }
  arc() {}
  fill() { this.calls.push(['fill']); }
  fillText(...a) { this.calls.push(['fillText', ...a]); }
}

class FakeCanvas {
  constructor(id) {
    this.id = id; this.width = 800; this.height = 400;
    this._ctx = new FakeContext(); this._listeners = {};
    this.style = { display: '' };
  }
  getContext() { return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || []; const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) { const list = this._listeners[evt.type] || []; for (const cb of list) cb(evt); }
}

class FakeNode {
  constructor(id) {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = true;
    this.style = { display: '' }; this._listeners = {}; this.children = [];
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || []; const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) { const list = this._listeners[evt.type] || []; for (const cb of list) cb(evt); }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) {
    const isCanvas = id === 'treePanelCanvas';
    _nodes.set(id, isCanvas ? new FakeCanvas(id) : new FakeNode(id));
  }
  return _nodes.get(id);
}

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
};
global.window = global;

// =====================================================================
group('Module exports');
check('page has mount',                  typeof page.mount === 'function');
check('page has unmount',                typeof page.unmount === 'function');
check('page has refreshTreePanel',       typeof page.refreshTreePanel === 'function');
check('page has initTreePanelToolbar',   typeof page.initTreePanelToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState (no tree)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran without throwing',     ok, err ? err.message : '');
  check('_pageState set',                   state._pageState && typeof state._pageState === 'object');
  check('atlasState stash present',         atlasState.inversion._page_tree_panel_state !== undefined);
  check('candidate label = "—"',            _ensureNode('treePanelCandidateLabel').textContent === '—');
  // Empty state shown (the panel doesn't have a tree)
  check('empty-state div visible',          _ensureNode('treePanelEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared on unmount',    state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with a tree + cluster labels');
{
  const root = new FakeNode('atlas-root');
  // Build a 6-leaf NJ tree.
  const dist = [
    [0, 1, 1, 5, 5, 5],
    [1, 0, 1, 5, 5, 5],
    [1, 1, 0, 5, 5, 5],
    [5, 5, 5, 0, 1, 1],
    [5, 5, 5, 1, 0, 1],
    [5, 5, 5, 1, 1, 0],
  ];
  const tree = tree_mod.buildNjTree(dist, ['s0','s1','s2','s3','s4','s5']);
  const atlasState = {
    inversion: {
      tree_panel_state: {
        tree,
        leaf_cluster_labels: [1, 1, 1, 2, 2, 2],
        leaf_colors_by_cluster: ['#3074C8', '#2BAA50', '#D04545'],
        candidate_label: 'LG28:15-18 Mb',
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                       ok, err ? err.message : '');
  const canvas = _ensureNode('treePanelCanvas');
  check('canvas painted (clearRect)',        canvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('canvas drew leaves (fill)',         canvas._ctx.calls.some(c => c[0] === 'fill'));
  check('canvas drew labels (fillText)',     canvas._ctx.calls.some(c => c[0] === 'fillText'));
  check('candidate label set',               _ensureNode('treePanelCandidateLabel').textContent === 'LG28:15-18 Mb');
  // ARI badge populated
  check('ARI badge populated',
        _ensureNode('treePanelARIBadge').textContent.indexOf('ARI') >= 0);
  // Legend populated
  check('legend populated',
        _ensureNode('treePanelLegendBody').innerHTML.indexOf('1') >= 0
     || _ensureNode('treePanelLegendBody').innerHTML.indexOf('2') >= 0);
  // Empty-state hidden
  check('empty-state hidden when tree present',
        _ensureNode('treePanelEmpty').style.display === 'none');

  // -------------------------------------------------------------------
  group('Smoke: hover updates the right panel');
  // Pick the first hit region from the live state and dispatch a
  // mousemove event right over it.
  const ps = state._pageState;
  if (ps && ps.hit_regions && ps.hit_regions.length > 0) {
    const h = ps.hit_regions[0];
    canvas.dispatchEvent({ type: 'mousemove', clientX: h.x, clientY: h.y });
    check('hover: selection.hovered = leaf id',
          ps.selection.getHovered() === h.leaf_id);
    const fields = _ensureNode('treePanelSelectedFields').innerHTML;
    check('right panel updated with leaf id',
          fields.indexOf(h.leaf_id) >= 0);
  } else {
    check('hit regions populated', false, 'no hit regions');
  }

  // -------------------------------------------------------------------
  group('Smoke: click toggles selection');
  {
    const h = ps.hit_regions[0];
    canvas.dispatchEvent({ type: 'click', clientX: h.x, clientY: h.y });
    check('click adds leaf to selection',     ps.selection.getSelected().has(h.leaf_id));
    canvas.dispatchEvent({ type: 'click', clientX: h.x, clientY: h.y });
    check('click again removes leaf',         !ps.selection.getSelected().has(h.leaf_id));
  }

  // -------------------------------------------------------------------
  group('Smoke: toolbar toggles repaint');
  {
    canvas._ctx.calls.length = 0;
    const cb = _ensureNode('treePanelColorByCluster');
    cb.checked = false;
    cb.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint fired after color toggle',
          canvas._ctx.calls.some(c => c[0] === 'clearRect'));
  }

  await page.unmount(root);
  check('_pageState cleared',                state._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
