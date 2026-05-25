// tests/smoke_review_page_ancestry_scroller_round5.mjs
//
// Mount / unmount + render lifecycle smoke for the Fish Ancestry
// Scroller page (review-stage). Mirrors smoke_review_page_sv_evidence
// in shape: DOM polyfill, FakeNode + FakeCanvas, build a minimal
// model fixture, mount, assert renderers ran, click a fake event on
// the Layer-2 canvas, assert the selection card populates, then
// unmount and assert teardown.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports present
//   - mount() runs on minimal atlasState (no model — empty-state)
//   - mount() runs on a fully populated atlasState (paints all four
//     canvases — Layer 1/2, metrics, Layer 3)
//   - _pageState live-binding visible across module boundaries
//   - atlasState.popstats._page_fish_ancestry_scrollerState stash
//   - view-mode dropdown change triggers a repaint (clearRect called)
//   - click on the Layer-2 canvas populates the right-panel selection
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page = await import(`${WORKSPACE}/atlases/inversion/pages/review/fish_ancestry_scroller.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/fish_ancestry_scroller/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// DOM polyfill — FakeNode + FakeCanvas. Canvases record paint calls
// so the smoke can assert paintLayer*() ran.
// =====================================================================

class FakeContext {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 0;
    this.calls = [];
  }
  clearRect(...a) { this.calls.push(['clearRect', ...a]); }
  fillRect(...a)  { this.calls.push(['fillRect', ...a]); }
  strokeRect(...a){ this.calls.push(['strokeRect', ...a]); }
}

class FakeCanvas {
  constructor(id) {
    this.id = id;
    this.width = 400;
    this.height = 200;
    this._ctx = new FakeContext();
    this._listeners = {};
    this.style = { display: '' };
    this.dataset = {};
  }
  getContext() { return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(evt) {
    const list = this._listeners[evt.type] || [];
    for (const cb of list) cb(evt);
  }
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = true;
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.children = [];
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(evt) {
    const list = this._listeners[evt.type] || [];
    for (const cb of list) cb(evt);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) {
    const isCanvas = /Canvas$/.test(id) || id.indexOf('Canvas') >= 0;
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
// Fixtures
// =====================================================================

function buildEmptyAtlasState() {
  return { inversion: { activeChrom: null }, shared: {} };
}

function buildPopulatedAtlasState() {
  return {
    inversion: {
      activeChrom: 'LG28',
      ancestry_scroller: {
        candidate: { id: 'inv_LG28_1', name: 'Inversion LG28-Inv1' },
        chrom: 'LG28',
        viewport_bp: [14_200_000, 18_600_000],
        breakpoints: [15_030_000, 17_890_000],
        K: 3,
        model: {
          fish_rows: ['F1', 'F2', 'F3', 'F4'],
          window_grid: [
            { idx: 0, start_bp: 14_200_000, end_bp: 14_700_000 },
            { idx: 1, start_bp: 14_700_000, end_bp: 15_200_000 },
            { idx: 2, start_bp: 15_200_000, end_bp: 15_700_000 },
            { idx: 3, start_bp: 15_700_000, end_bp: 16_200_000 },
            { idx: 4, start_bp: 16_200_000, end_bp: 16_700_000 },
            { idx: 5, start_bp: 16_700_000, end_bp: 17_200_000 },
            { idx: 6, start_bp: 17_200_000, end_bp: 17_700_000 },
            { idx: 7, start_bp: 17_700_000, end_bp: 18_200_000 },
          ],
          pc1_band: {
            F1: ['band1','band1','band1','band1','band1','band1','band1','band1'],
            F2: ['band1','band1','band2','band2','band2','band2','band1','band1'],
            F3: ['band1','band1','band3','band3','band3','band3','band1','band1'],
            F4: ['band1','band1','band1','band2','band2','band1','band1','band1'],
          },
          bricks: {
            F1: [{ start_idx: 0, end_idx: 7, dominant_k: 0, dominant_share: 0.92,
                   start_bp: 14_200_000, end_bp: 18_200_000,
                   mean_delta_q: 0.05, het_z: -0.4, mean_entropy: 0.1,
                   alignment_confidence: 0.95, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Hom-Std', flags: [] }],
            F2: [{ start_idx: 0, end_idx: 1, dominant_k: 0, dominant_share: 0.88,
                   start_bp: 14_200_000, end_bp: 15_200_000,
                   mean_delta_q: 0.07, het_z: 0.2, mean_entropy: 0.15,
                   alignment_confidence: 0.91, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Het', flags: [] },
                 { start_idx: 2, end_idx: 5, dominant_k: 1, dominant_share: 0.55,
                   start_bp: 15_200_000, end_bp: 17_200_000,
                   mean_delta_q: 0.40, het_z: 1.6, mean_entropy: 0.45,
                   alignment_confidence: 0.78, dosage_concordance: 'partial',
                   pc1_band_label: 'Band 2 (Het)',
                   dosage_state: 'Het', flags: ['HIGH_HET'] },
                 { start_idx: 6, end_idx: 7, dominant_k: 0, dominant_share: 0.85,
                   start_bp: 17_200_000, end_bp: 18_200_000,
                   mean_delta_q: 0.06, het_z: 0.0, mean_entropy: 0.12,
                   alignment_confidence: 0.93, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Het', flags: [] }],
            F3: [{ start_idx: 0, end_idx: 1, dominant_k: 0, dominant_share: 0.90,
                   start_bp: 14_200_000, end_bp: 15_200_000,
                   mean_delta_q: 0.04, het_z: -0.3, mean_entropy: 0.08,
                   alignment_confidence: 0.96, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Hom-Inv', flags: [] },
                 { start_idx: 2, end_idx: 5, dominant_k: 2, dominant_share: 0.80,
                   start_bp: 15_200_000, end_bp: 17_200_000,
                   mean_delta_q: 0.65, het_z: -0.2, mean_entropy: 0.20,
                   alignment_confidence: 0.87, dosage_concordance: 'discordant',
                   pc1_band_label: 'Band 3 (Inv Hom)',
                   dosage_state: 'Hom-Inv',
                   flags: ['HIGH_DELTA_Q', 'DOSAGE_DISCORDANT'] },
                 { start_idx: 6, end_idx: 7, dominant_k: 0, dominant_share: 0.86,
                   start_bp: 17_200_000, end_bp: 18_200_000,
                   mean_delta_q: 0.05, het_z: 0.0, mean_entropy: 0.10,
                   alignment_confidence: 0.94, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Hom-Inv', flags: [] }],
            F4: [{ start_idx: 0, end_idx: 7, dominant_k: 0, dominant_share: 0.91,
                   start_bp: 14_200_000, end_bp: 18_200_000,
                   mean_delta_q: 0.06, het_z: 0.1, mean_entropy: 0.11,
                   alignment_confidence: 0.94, dosage_concordance: 'concordant',
                   pc1_band_label: 'Band 1 (Std Hom)',
                   dosage_state: 'Hom-Std', flags: [] }],
          },
        },
      },
    },
    shared: {},
  };
}

// =====================================================================
group('Module exports');
check('page has mount',                       typeof page.mount === 'function');
check('page has unmount',                     typeof page.unmount === 'function');
check('page has refreshAncestryScroller',     typeof page.refreshAncestryScroller === 'function');
check('page has initAncestryScrollerToolbar', typeof page.initAncestryScrollerToolbar === 'function');

// =====================================================================
group('Smoke: mount() on minimal atlasState (empty-state)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = buildEmptyAtlasState();
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); }
  catch (e) { ok = false; err = e; }
  check('mount() ran without throwing', ok, err ? err.message : '');
  check('_pageState set',               state._pageState && typeof state._pageState === 'object');
  // 2026-05-26: stash moved to atlasState.popstats._page_fish_ancestry_scrollerState.
  check('atlasState stash present',     atlasState.popstats && atlasState.popstats._page_fish_ancestry_scrollerState !== undefined);
  check('header chromLabel = "—"',      _ensureNode('ancScrollChromLabel').textContent === '—');
  check('selection card shows empty hint',
        _ensureNode('ancScrollSelectedFields').innerHTML.indexOf('No brick selected') >= 0);
  await page.unmount(root);
  check('_pageState cleared on unmount', state._pageState === null);
}

// reset DOM for the next round
_nodes.clear();

// =====================================================================
group('Smoke: mount() on populated atlasState');
{
  const root = new FakeNode('atlas-root');
  const atlasState = buildPopulatedAtlasState();
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); }
  catch (e) { ok = false; err = e; }
  check('mount() ran without throwing', ok, err ? err.message : '');
  check('header chromLabel set',     _ensureNode('ancScrollChromLabel').textContent === 'LG28:');
  check('viewport set',              _ensureNode('ancScrollViewport').textContent.indexOf('14.20') >= 0);

  const c1 = _ensureNode('ancScrollLayer1Canvas');
  const c2 = _ensureNode('ancScrollLayer2Canvas');
  const cm = _ensureNode('ancScrollMetricsCanvas');
  const c3 = _ensureNode('ancScrollLayer3Canvas');
  check('Layer1 painted (clearRect called)',
        c1._ctx.calls.some(c => c[0] === 'clearRect'));
  check('Layer1 painted ≥4 rows × 8 cols cells',
        c1._ctx.calls.filter(c => c[0] === 'fillRect').length >= 32);
  check('Layer2 painted (clearRect called)',
        c2._ctx.calls.some(c => c[0] === 'clearRect'));
  check('Metrics painted (5 rows × 8 cols cells)',
        cm._ctx.calls.filter(c => c[0] === 'fillRect').length >= 40);
  check('Layer3 painted (clearRect called)',
        c3._ctx.calls.some(c => c[0] === 'clearRect'));

  // -------------------------------------------------------------------
  group('Smoke: Layer-2 click populates selection');
  // Click in (x≈100, y≈75) given canvas_w=400 canvas_h=200, 8 cols × 4 rows:
  //   colW=50, rowH=50  → c=2, r=1 → F2 row, brick covering 2..5 (K=1).
  const evt = { type: 'click', clientX: 100, clientY: 75 };
  c2.dispatchEvent(evt);
  const fields = _ensureNode('ancScrollSelectedFields').innerHTML;
  check('selection card mentions F2',  fields.indexOf('F2') >= 0);
  check('selection card mentions K2',  fields.indexOf('K2') >= 0);

  // -------------------------------------------------------------------
  group('Smoke: view-mode change repaints Layer 2');
  const vmSel = _ensureNode('ancScrollViewMode');
  vmSel.value = 'het_z';
  c2._ctx.calls.length = 0;
  vmSel.dispatchEvent({ type: 'change', target: { value: 'het_z' } });
  check('Layer2 re-cleared after view-mode change',
        c2._ctx.calls.some(c => c[0] === 'clearRect'));

  // -------------------------------------------------------------------
  group('Smoke: unmount() teardown');
  await page.unmount(root);
  check('_pageState cleared',           state._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
