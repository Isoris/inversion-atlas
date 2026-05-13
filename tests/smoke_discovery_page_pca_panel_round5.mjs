// tests/smoke_discovery_page_pca_panel_round5.mjs
//
// Full mount/unmount lifecycle smoke for the PCA-panel cartridge
// (SPEC_0 §10 Phase 1).

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_pca_panel.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_pca_panel/_state.js`);

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
  strokeRect(...a) { this.calls.push(['strokeRect', ...a]); }
  arc() {}
  fill() { this.calls.push(['fill']); }
  fillText(...a) { this.calls.push(['fillText', ...a]); }
}

class FakeCanvas {
  constructor(id) {
    this.id = id;
    if (id === 'pcaPanelScrubberCanvas') { this.width = 800; this.height = 24; }
    else                                  { this.width = 600; this.height = 600; }
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
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false;
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
    const isCanvas = (id === 'pcaPanelScrubberCanvas')
                  || (id === 'pcaPanelScatterCanvas');
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
check('page has mount',                          typeof page.mount === 'function');
check('page has unmount',                        typeof page.unmount === 'function');
check('page has refreshPcaPanel',                typeof page.refreshPcaPanel === 'function');
check('page has initPcaPanelToolbar',            typeof page.initPcaPanelToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState (no PCA results)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran without throwing',          ok, err ? err.message : '');
  check('_pageState set',                        state._pageState && typeof state._pageState === 'object');
  check('atlasState stash present',              atlasState.inversion._page_pca_panel_state !== undefined);
  check('candidate label = "—"',
        _ensureNode('pcaPanelCandidateLabel').textContent === '—');
  check('anchor badge populated',
        _ensureNode('pcaPanelAnchorBadge').textContent.length > 0);
  check('empty-state div visible',
        _ensureNode('pcaPanelEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared on unmount',         state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with PCA results');
{
  const root = new FakeNode('atlas-root');
  const pca_results = [
    { lam1: 0.40, lam2: 0.12,
      pc1: Float64Array.from([0.5, -0.5, 0.4, -0.4, 0.3]),
      pc2: Float64Array.from([0.3, 0.3, -0.3, -0.3, 0.1]),
      polarity_flips_applied: 0 },
    { lam1: 0.80, lam2: 0.18,
      pc1: Float64Array.from([0.7, -0.7, 0.5, -0.5, 0.2]),
      pc2: Float64Array.from([0.4, 0.4, -0.4, -0.4, 0.1]),
      polarity_flips_applied: 2 },
    null,
    { lam1: 0.30, lam2: 0.05,
      pc1: Float64Array.from([0.1, 0, -0.1, 0.05, 0]),
      pc2: Float64Array.from([0, 0.1, 0, -0.1, 0.05]),
      polarity_flips_applied: 0 },
  ];
  const atlasState = {
    inversion: {
      pca_panel_state: {
        pca_results,
        candidate_label: 'LG28:15-18 Mb',
        anchor_label: 'view_self',
        sample_labels: ['s0', 's1', 's2', 's3', 's4'],
        cluster_assignment: new Int32Array([0, 0, 1, 1, 2]),
        window_meta: [
          { start_bp: 100, end_bp: 200 },
          { start_bp: 200, end_bp: 300 },
          { start_bp: 300, end_bp: 400 },
          { start_bp: 400, end_bp: 500 },
        ],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  const sCanvas = _ensureNode('pcaPanelScrubberCanvas');
  const scCanvas = _ensureNode('pcaPanelScatterCanvas');
  check('scrubber canvas cleared',
        sCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('scrubber drew cells (fillRect)',
        sCanvas._ctx.calls.some(c => c[0] === 'fillRect'));
  check('scatter canvas cleared',
        scCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('scatter drew points (fill)',
        scCanvas._ctx.calls.some(c => c[0] === 'fill'));
  check('candidate label set',
        _ensureNode('pcaPanelCandidateLabel').textContent === 'LG28:15-18 Mb');
  check('anchor badge = view_self',
        _ensureNode('pcaPanelAnchorBadge').textContent === 'view_self');
  check('window label populated',
        _ensureNode('pcaPanelWindowLabel').textContent.indexOf('window 0') >= 0);
  check('right panel shows window detail',
        _ensureNode('pcaPanelSelectedFields').innerHTML.indexOf('λ1') >= 0);
  check('cluster list populated',
        _ensureNode('pcaPanelClusterListBody').innerHTML.indexOf('cluster') >= 0);
  check('empty-state hidden',
        _ensureNode('pcaPanelEmpty').style.display === 'none');

  // -------------------------------------------------------------------
  group('Smoke: scrubbing the strip changes the active window');
  const ps = state._pageState;
  {
    const h = ps.scrubber_hits[1];
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    scCanvas._ctx.calls.length = 0;
    sCanvas.dispatchEvent({ type: 'click', clientX: cx, clientY: cy });
    check('click activates window 1',
          ps.selection.getActiveWindowIdx() === 1);
    check('scatter repainted on scrub',
          scCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('window label updates',
          _ensureNode('pcaPanelWindowLabel').textContent.indexOf('window 1') >= 0);

    // Scrub onto the null window → empty-state shown.
    const hNull = ps.scrubber_hits[2];
    sCanvas.dispatchEvent({ type: 'click', clientX: hNull.x + hNull.w / 2, clientY: hNull.y + hNull.h / 2 });
    check('empty-state shown on null window',
          _ensureNode('pcaPanelEmpty').style.display === '');
  }

  // -------------------------------------------------------------------
  group('Smoke: hover on scatter updates right panel');
  {
    const h0 = ps.scrubber_hits[1];
    sCanvas.dispatchEvent({ type: 'click', clientX: h0.x + h0.w / 2, clientY: h0.y + h0.h / 2 });
    if (ps.scatter_hits.length > 0) {
      const p = ps.scatter_hits[0];
      scCanvas.dispatchEvent({ type: 'mousemove', clientX: p.x, clientY: p.y });
      check('hover tracked in selection',
            ps.selection.getHoveredSample() === 0);
      const fields = _ensureNode('pcaPanelSelectedFields').innerHTML;
      check('right panel shows hover detail',
            fields.indexOf('PC1, PC2') >= 0);
    } else {
      check('scatter hits populated', false, 'no points');
    }
  }

  // -------------------------------------------------------------------
  group('Smoke: click on scatter toggles selection');
  {
    const p = ps.scatter_hits[2];
    scCanvas.dispatchEvent({ type: 'click', clientX: p.x, clientY: p.y });
    check('click adds sample 2',
          ps.selection.getSelectedSamples().has(2));
    scCanvas.dispatchEvent({ type: 'click', clientX: p.x, clientY: p.y });
    check('click again removes sample 2',
          !ps.selection.getSelectedSamples().has(2));
  }

  // -------------------------------------------------------------------
  group('Smoke: toolbar toggles repaint');
  {
    scCanvas._ctx.calls.length = 0;
    const c = _ensureNode('pcaPanelColorBy');
    c.value = 'none';
    c.dispatchEvent({ type: 'change', target: { value: 'none' } });
    check('repaint after color-by change',
          scCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.color_by updated',
          ps.view_state.color_by === 'none');

    scCanvas._ctx.calls.length = 0;
    const a = _ensureNode('pcaPanelAxisChoice');
    a.value = 'pc2_pc1';
    a.dispatchEvent({ type: 'change', target: { value: 'pc2_pc1' } });
    check('repaint after axis change',
          scCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.axis_choice updated',
          ps.view_state.axis_choice === 'pc2_pc1');

    scCanvas._ctx.calls.length = 0;
    const l = _ensureNode('pcaPanelShowLabels');
    l.checked = true;
    l.dispatchEvent({ type: 'change', target: { checked: true } });
    check('repaint after labels toggle',
          scCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.show_labels updated',
          ps.view_state.show_labels === true);
  }

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
