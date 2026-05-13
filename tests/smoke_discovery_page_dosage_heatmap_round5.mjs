// tests/smoke_discovery_page_dosage_heatmap_round5.mjs
//
// Full mount/unmount lifecycle smoke for the dosage-heatmap cartridge.

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_dosage_heatmap.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_dosage_heatmap/_state.js`);

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
    this.id = id; this.width = 600; this.height = 400;
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
    this.offsetWidth = 0; this.offsetHeight = 0;
    this.clientWidth = 600; this.clientHeight = 400;
    this.parentElement = null;
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
    const isCanvas = (id === 'dosageHeatmapCanvas');
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
check('page has refreshDosageHeatmap',           typeof page.refreshDosageHeatmap === 'function');
check('page has initDosageHeatmapToolbar',       typeof page.initDosageHeatmapToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState (no heatmap)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran without throwing',          ok, err ? err.message : '');
  check('_pageState set',                        state._pageState && typeof state._pageState === 'object');
  check('atlasState stash present',              atlasState.inversion._page_dosage_heatmap_state !== undefined);
  check('candidate label = "—"',
        _ensureNode('dosageHeatmapCandidateLabel').textContent === '—');
  check('view badge = "—"',
        _ensureNode('dosageHeatmapViewBadge').textContent === '—');
  check('empty-state div visible',
        _ensureNode('dosageHeatmapEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared on unmount',         state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with mgl_heatmap_result');
{
  const root = new FakeNode('atlas-root');
  const mgl = {
    candidate_id: 'cand_x',
    n_samples: 5, samples: ['sA','sB','sC','sD','sE'],
    n_markers: 4,
    markers: [
      { marker: 'rs1', dosage_centered: Float64Array.from([-0.3, -0.5, 0.2, 0.4, 0.2]),
        polarity_flipped: false },
      { marker: 'rs2', dosage_centered: Float64Array.from([0.5, 0.5, -0.3, -0.3, -0.4]),
        polarity_flipped: true },
      { marker: 'rs3', dosage_centered: Float64Array.from([-0.1, 0.0, 0.3, 0.4, -0.6]),
        polarity_flipped: false },
      { marker: 'rs4', dosage_centered: Float64Array.from([0.4, 0.3, -0.5, -0.6, 0.4]),
        polarity_flipped: false },
    ],
    centering: { anchor: 'cohort_mean', polarity_reference: 'pc1' },
  };
  const atlasState = {
    inversion: {
      dosage_heatmap_state: {
        mgl_heatmap_result: mgl,
        candidate_label: 'LG28:15-18 Mb',
        sample_group: ['HOMO_1','HOMO_1','HET','HOMO_2','HOMO_2'],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  const c = _ensureNode('dosageHeatmapCanvas');
  check('canvas cleared',                         c._ctx.calls.some(x => x[0] === 'clearRect'));
  check('canvas painted (fillRect)',              c._ctx.calls.some(x => x[0] === 'fillRect'));
  check('canvas outlined (strokeRect)',           c._ctx.calls.some(x => x[0] === 'strokeRect'));
  check('candidate label set',
        _ensureNode('dosageHeatmapCandidateLabel').textContent === 'LG28:15-18 Mb');
  check('view badge populated',
        _ensureNode('dosageHeatmapViewBadge').textContent.indexOf('cohort_mean') >= 0);
  check('legend populated',
        _ensureNode('dosageHeatmapLegendBody').innerHTML.indexOf('HOMO_1') >= 0);
  check('empty-state hidden',
        _ensureNode('dosageHeatmapEmpty').style.display === 'none');

  // ---
  group('Smoke: hover updates the right panel');
  const ps = state._pageState;
  const layout = ps.layout;
  {
    const px = layout.matX + layout.cellW * 1.5;
    const py = layout.matY + layout.cellH * 2.5;
    c.dispatchEvent({ type: 'mousemove', clientX: px, clientY: py });
    check('hover tracked in selection',
          ps.selection.getHoveredCell() !== null);
    const fields = _ensureNode('dosageHeatmapSelectedFields').innerHTML;
    check('right panel shows dosage value',       fields.indexOf('Dosage') >= 0);
    check('right panel shows cell summary',       fields.indexOf('Cell') >= 0);
    check('last_cursor_px stashed on hover',
          ps.last_cursor_px && Number.isFinite(ps.last_cursor_px.x));
  }

  // ---
  group('Smoke: floating tooltip overlay');
  {
    const tip = _ensureNode('dosageHeatmapTooltip');
    check('tooltip element shown after hover',
          tip.style.display === 'block');
    check('tooltip text matches cell summary',
          tip.innerHTML && tip.innerHTML.length > 0);
    // Move off the canvas → tooltip hides.
    c.dispatchEvent({ type: 'mouseleave' });
    check('tooltip hidden on mouseleave',
          tip.style.display === 'none');
    check('hovered cell cleared on mouseleave',
          ps.selection.getHoveredCell() === null);
  }

  // ---
  group('Smoke: click toggles selection');
  {
    const px = layout.matX + layout.cellW * 0.5;
    const py = layout.matY + layout.cellH * 0.5;
    // Sample at row=0 depends on sample-order (default 'by_group');
    // resolve it the same way the painter does.
    const sampleAtRow0 = layout.sample_order[0];
    const markerAtCol0 = layout.marker_order[0];
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('click adds the row-0 sample to selection',
          ps.selection.getSelectedSamples().has(sampleAtRow0));
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('click again removes the row-0 sample',
          !ps.selection.getSelectedSamples().has(sampleAtRow0));
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py, shiftKey: true });
    check('shift-click adds the col-0 marker to selection',
          ps.selection.getSelectedMarkers().has(markerAtCol0));
  }

  // ---
  group('Smoke: toolbar toggles repaint');
  {
    c._ctx.calls.length = 0;
    const so = _ensureNode('dosageHeatmapSampleOrder');
    so.value = 'natural';
    so.dispatchEvent({ type: 'change', target: { value: 'natural' } });
    check('repaint after sample-order change',
          c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.sample_order_mode updated',
          ps.view_state.sample_order_mode === 'natural');

    c._ctx.calls.length = 0;
    const mo = _ensureNode('dosageHeatmapMarkerOrder');
    mo.value = 'by_polarity';
    mo.dispatchEvent({ type: 'change', target: { value: 'by_polarity' } });
    check('repaint after marker-order change',
          c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.marker_order_mode updated',
          ps.view_state.marker_order_mode === 'by_polarity');

    c._ctx.calls.length = 0;
    const gt = _ensureNode('dosageHeatmapShowGroupTrack');
    gt.checked = false;
    gt.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint after group-track toggle',
          c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.show_group_track = false',
          ps.view_state.show_group_track === false);

    c._ctx.calls.length = 0;
    const pt = _ensureNode('dosageHeatmapShowPolarityTrack');
    pt.checked = false;
    pt.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint after polarity-track toggle',
          c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.show_polarity_track = false',
          ps.view_state.show_polarity_track === false);
  }

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with legacy_chunk (adapter path)');
{
  const root = new FakeNode('atlas-root');
  const chunk = {
    samples: ['cga01','cga02','cga03','cga04'],
    markers: [
      { marker_id: 'M0001', pos_bp: 1000 },
      { marker_id: 'M0002', pos_bp: 2000 },
      { marker_id: 'M0003', pos_bp: 3000 },
    ],
    dosage: [
      [0, 0, 2, 2],
      [1, 1, 1, 0],
      [2, 2, 0, 0],
    ],
  };
  const atlasState = {
    inversion: {
      dosage_heatmap_state: {
        legacy_chunk: chunk,
        candidate_label: 'cand_legacy',
        selected_marker_indices: [0, 1, 2],
        sample_group: ['HOMO_1','HOMO_1','HOMO_2','HOMO_2'],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran (legacy)',                    ok, err ? err.message : '');
  const c = _ensureNode('dosageHeatmapCanvas');
  check('legacy: canvas painted',
        c._ctx.calls.some(x => x[0] === 'fillRect'));
  check('legacy: candidate label set',
        _ensureNode('dosageHeatmapCandidateLabel').textContent === 'cand_legacy');
  check('legacy: data adapted (4×3 canonical)',
        state._pageState.data.n_samples === 4
     && state._pageState.data.n_markers === 3);
  check('legacy: hover hit works through adapted cellValue',
        Math.abs(state._pageState.data.cellValue(0, 0) - 0) < 1e-9);
  await page.unmount(root);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
