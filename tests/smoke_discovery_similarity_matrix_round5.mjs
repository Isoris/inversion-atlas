// tests/smoke_discovery_similarity_matrix_round5.mjs
//
// Full mount/unmount lifecycle smoke for the similarity-panel
// cartridge (HANDOFF_10).

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/similarity_matrix.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/similarity_matrix/_state.js`);

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
    if (id === 'similarityPanelTransitionCanvas') { this.width = 800; this.height = 56; }
    else                                           { this.width = 400; this.height = 400; }
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
    const isCanvas = (id === 'similarityPanelTransitionCanvas')
                  || (id === 'similarityPanelMatrixCanvas');
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
check('page has refreshSimilarityPanel',         typeof page.refreshSimilarityPanel === 'function');
check('page has initSimilarityPanelToolbar',     typeof page.initSimilarityPanelToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState (no similarity result)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran without throwing',          ok, err ? err.message : '');
  check('_pageState set',                        state._pageState && typeof state._pageState === 'object');
  check('atlasState stash present',              atlasState.inversion._page_similarity_panel_state !== undefined);
  check('candidate label = "—"',
        _ensureNode('similarityPanelCandidateLabel').textContent === '—');
  check('metric badge populated',
        _ensureNode('similarityPanelMetricBadge').textContent.length > 0);
  check('empty-state div visible',
        _ensureNode('similarityPanelEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared on unmount',         state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with a similarity result');
{
  const root = new FakeNode('atlas-root');
  // Build a synthetic 4-window result over 6 samples.
  function _eyeSim(n, blockA) {
    const S = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) S[i * n + j] = 1;
        else if ((blockA[i] === blockA[j])) S[i * n + j] = 0.85;
        else                                 S[i * n + j] = 0.15;
      }
    }
    return S;
  }
  const blocks = new Int32Array([0, 0, 0, 1, 1, 1]);
  const similarity_result = {
    windows: [
      { idx: 0, start_bp: 100, end_bp: 200, n_markers_in_window: 30,
        similarity: _eyeSim(6, blocks), K: 2, assignment: blocks,
        silhouette_score: 0.55 },
      { idx: 1, start_bp: 200, end_bp: 300, n_markers_in_window: 32,
        similarity: _eyeSim(6, blocks), K: 2, assignment: blocks,
        silhouette_score: 0.60 },
      { idx: 2, start_bp: 300, end_bp: 400, n_markers_in_window: 8,
        similarity: null, K: 1, assignment: null,
        silhouette_score: 0 },
      { idx: 3, start_bp: 400, end_bp: 500, n_markers_in_window: 28,
        similarity: _eyeSim(6, new Int32Array([0, 0, 1, 1, 0, 0])), K: 2,
        assignment: new Int32Array([0, 0, 1, 1, 0, 0]),
        silhouette_score: 0.50 },
    ],
    block_transition_ari: new Float64Array([1.0, NaN, 0.2]),
  };
  const atlasState = {
    inversion: {
      similarity_panel_state: {
        similarity_result,
        candidate_label: 'LG28:15-18 Mb',
        metric_label: 'pearson',
        sample_labels: ['s0','s1','s2','s3','s4','s5'],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');

  const tCanvas = _ensureNode('similarityPanelTransitionCanvas');
  const mCanvas = _ensureNode('similarityPanelMatrixCanvas');
  check('transition canvas cleared',
        tCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('transition canvas painted (fillRect)',
        tCanvas._ctx.calls.some(c => c[0] === 'fillRect'));
  check('matrix canvas cleared',
        mCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('matrix canvas painted (fillRect)',
        mCanvas._ctx.calls.some(c => c[0] === 'fillRect'));
  check('matrix canvas outlined (strokeRect)',
        mCanvas._ctx.calls.some(c => c[0] === 'strokeRect'));
  check('candidate label set',
        _ensureNode('similarityPanelCandidateLabel').textContent === 'LG28:15-18 Mb');
  check('metric badge = pearson',
        _ensureNode('similarityPanelMetricBadge').textContent === 'pearson');
  check('window label populated',
        _ensureNode('similarityPanelWindowLabel').textContent.indexOf('window 0') >= 0);
  check('right panel shows window detail',
        _ensureNode('similarityPanelSelectedFields').innerHTML.indexOf('Window') >= 0);
  check('block list populated',
        _ensureNode('similarityPanelBlockListBody').innerHTML.indexOf('block') >= 0);
  check('empty-state hidden',
        _ensureNode('similarityPanelEmpty').style.display === 'none');

  // -------------------------------------------------------------------
  group('Smoke: scrubbing the transition strip changes the active window');
  const ps = state._pageState;
  {
    const h = ps.transition_hits[3];  // last window
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    tCanvas._ctx.calls.length = 0;
    mCanvas._ctx.calls.length = 0;
    tCanvas.dispatchEvent({ type: 'click', clientX: cx, clientY: cy });
    check('click activates that window',
          ps.selection.getActiveWindowIdx() === 3);
    check('matrix repainted on scrub',
          mCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('window label updates',
          _ensureNode('similarityPanelWindowLabel').textContent.indexOf('window 3') >= 0);

    // Scrub onto the data-less window: should clear matrix + show empty.
    const hEmpty = ps.transition_hits[2];
    tCanvas.dispatchEvent({ type: 'click', clientX: hEmpty.x + hEmpty.w / 2, clientY: hEmpty.y + hEmpty.h / 2 });
    check('empty-state shown on data-less window',
          _ensureNode('similarityPanelEmpty').style.display === '');
  }

  // -------------------------------------------------------------------
  group('Smoke: hover on matrix updates right panel');
  {
    // Activate window 0 again.
    const h0 = ps.transition_hits[0];
    tCanvas.dispatchEvent({ type: 'click', clientX: h0.x + h0.w / 2, clientY: h0.y + h0.h / 2 });
    const geom = ps.matrix_geom;
    if (geom && geom.cell_size > 0) {
      const px = geom.x_origin + 1.5 * geom.cell_size;
      const py = geom.y_origin + 0.5 * geom.cell_size;
      mCanvas.dispatchEvent({ type: 'mousemove', clientX: px, clientY: py });
      check('hover cell tracked in selection',
            ps.selection.getHoveredCell() && ps.selection.getHoveredCell().i === 0);
      const fields = _ensureNode('similarityPanelSelectedFields').innerHTML;
      check('right panel shows S(i,j) on hover',
            fields.indexOf('S(i,j)') >= 0);
    } else {
      check('matrix geom usable for hover', false, 'no geom');
    }
  }

  // -------------------------------------------------------------------
  group('Smoke: matrix click toggles sample selection');
  {
    const geom = ps.matrix_geom;
    const px = geom.x_origin + 0.5 * geom.cell_size;
    const py = geom.y_origin + 0.5 * geom.cell_size;
    mCanvas.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('click adds sample 0 to selection',
          ps.selection.getSelectedSamples().has(0));
    mCanvas.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('click again removes sample 0',
          !ps.selection.getSelectedSamples().has(0));
  }

  // -------------------------------------------------------------------
  group('Smoke: toolbar toggles repaint');
  {
    mCanvas._ctx.calls.length = 0;
    const cb = _ensureNode('similarityPanelShowBlockOverlay');
    cb.checked = false;
    cb.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint fired after overlay toggle',
          mCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.show_block_overlay updated',
          ps.view_state.show_block_overlay === false);

    mCanvas._ctx.calls.length = 0;
    const cb2 = _ensureNode('similarityPanelShowDiagonal');
    cb2.checked = false;
    cb2.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint fired after diagonal toggle',
          mCanvas._ctx.calls.some(c => c[0] === 'clearRect'));

    mCanvas._ctx.calls.length = 0;
    const sel = _ensureNode('similarityPanelSampleOrder');
    sel.value = 'by_block';
    sel.dispatchEvent({ type: 'change', target: { value: 'by_block' } });
    check('repaint fired after order change',
          mCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.sample_order_mode updated',
          ps.view_state.sample_order_mode === 'by_block');
  }

  // -------------------------------------------------------------------
  group('Smoke: refresh idempotent');
  {
    const beforeLen = mCanvas._ctx.calls.length;
    page.refreshSimilarityPanel(ps);
    check('refresh runs again without throwing',
          mCanvas._ctx.calls.length > beforeLen);
  }

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
