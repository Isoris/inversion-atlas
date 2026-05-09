// tests/smoke_discovery_page12_round5.mjs
//
// Round 5 step 10 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page12 (local-PCA-θπ chromosome-wide
// diversity scanner — the θπ sister of page1).
//
// Page12 is a discovery-stage page: same six-panel layout as page1, but
// reads theta_pi_* layers from state.data instead of dosage. Empty-state
// placeholder visible until the R pipeline ships at least one theta_pi
// layer; first layer landing hides the placeholder and reveals the
// relevant panels. Eight verbatim helpers from legacy lines 53045-54168.
//
// What this smoke verifies:
//   - module loads cleanly, all 8 verbatim + 8 wrappers + 3 lifecycle exports
//   - mount() empty-layers path: #thetaPiEmpty visible, all panels hidden
//   - mount() with theta_pi layers loaded: #thetaPiEmpty hidden, relevant
//     panels shown (panel visibility driven by which layers are in
//     state.layersPresent)
//   - cusum_theta layer with synthetic persample data: #thCusumStripCanvas
//     gets a real draw (FakeContext._ops > 0)
//   - data-th-layer indicators get textContent updated (loaded vs not loaded)
//   - _pageState live-binding observed across module boundaries
//   - renderPage12(state) callable directly (covers all 8 panels)
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page12 = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page12.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page12/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page1/2/3/9/10/17/18/21 smoke harnesses.
// Adds canvas-context shim because page12's draw paths use canvas extensively
// (8 panels, all canvas-driven).
// Adds querySelectorAll('[data-th-layer]') for the layer-status indicators.
// -----------------------------------------------------------------------------

class FakeContext {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = '';
    this.textBaseline = '';
    this.globalAlpha = 1;
    this._ops = 0;
  }
  setTransform() {}
  fillRect()    { this._ops++; }
  strokeRect()  { this._ops++; }
  fillText()    { this._ops++; }
  strokeText()  { this._ops++; }
  beginPath()   { this._ops++; }
  closePath()   { this._ops++; }
  moveTo()      { this._ops++; }
  lineTo()      { this._ops++; }
  arc()         { this._ops++; }
  stroke()      { this._ops++; }
  fill()        { this._ops++; }
  rect()        { this._ops++; }
  clearRect()   { this._ops++; }
  save()        {}
  restore()     {}
  translate()   {}
  scale()       {}
  measureText() { return { width: 10 }; }
  createLinearGradient() { return { addColorStop: () => {} }; }
  getImageData() { return { data: [] }; }
  putImageData() {}
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.tagName = (typeof id === 'string' && id.startsWith('<'))
                   ? id.slice(1, -1).toUpperCase() : '';
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.value = '';
    this.children = [];
    this.width  = 0;
    this.height = 0;
    this.clientWidth  = 1200;
    this.clientHeight = 200;
    this._ctx = null;
  }
  getContext() {
    if (!this._ctx) this._ctx = new FakeContext();
    return this._ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  focus() {}
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; if (k.startsWith('data-')) {
    const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    this.dataset[camel] = v;
  } }
  getAttribute(k) { return this[k]; }
  click() { (this._listeners['click'] || []).forEach(cb => cb({ type: 'click' })); }
  querySelector(sel) {
    if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
    return _ensureNode(sel.slice(1));
  }
  querySelectorAll(_) { return []; }
}

const _nodes = new Map();
const _layerIndicators = [];  // simulate document.querySelectorAll('[data-th-layer]')

function _ensureNode(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}

function _makeLayerIndicator(layerName) {
  const node = new FakeNode(`<span>`);
  node.dataset.thLayer = layerName;
  node.style = { color: '' };
  _layerIndicators.push(node);
  return node;
}

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
  querySelectorAll: (sel) => {
    if (sel === '[data-th-layer]') return _layerIndicators;
    return [];
  },
};

global.window = global;
global.devicePixelRatio = 1;

const _storage = new Map();
global.localStorage = {
  getItem: (k) => _storage.has(k) ? _storage.get(k) : null,
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
  clear: () => _storage.clear(),
};

global.requestAnimationFrame = (cb) => { try { cb(0); } catch (_) {} return 0; };

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidateList: [],
      layersPresent: new Set(),
      tracks: {},
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page12 has mount',                       typeof page12.mount === 'function');
check('page12 has unmount',                     typeof page12.unmount === 'function');
check('page12 has renderPage12',                typeof page12.renderPage12 === 'function');
check('page12 has state-aware wrappers (8)',
      typeof page12.refreshThetaPiLayerStatus === 'function'
      && typeof page12.refreshThetaPiPanelVisibility === 'function'
      && typeof page12.drawThCusumHero === 'function'
      && typeof page12.drawThLinesPanel === 'function'
      && typeof page12.drawThSimMatPanel === 'function'
      && typeof page12.drawThZPanel === 'function'
      && typeof page12.drawThAnchorStripPanel === 'function'
      && typeof page12.drawThPcaPanel === 'function');
check('page12 has verbatim helpers (8)',
      typeof page12._refreshThetaPiLayerStatus === 'function'
      && typeof page12._drawThPcaPanel === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-layers path (no theta_pi data)');
// Pre-create some [data-th-layer] indicators so the layer-status helper
// has something to update.
_makeLayerIndicator('theta_pi_per_window');
_makeLayerIndicator('cusum_theta');

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page12.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const empty = _ensureNode('thetaPiEmpty');
const ctrlBar = _ensureNode('thCtrlBar');
const cusumPanel = _ensureNode('thCusumHeroPanel');
const linesPanel = _ensureNode('thLinesPanel');
check('thetaPiEmpty placeholder shown',         empty.style.display === 'block');
check('thCtrlBar hidden in empty mount',        ctrlBar.style.display === 'none');
check('thCusumHeroPanel hidden in empty mount', cusumPanel.style.display === 'none');
check('thLinesPanel hidden in empty mount',     linesPanel.style.display === 'none');

// Layer-status indicators should be marked "not loaded".
check('layer indicator updated to "not loaded"',
      _layerIndicators[0].textContent.includes('not loaded'));

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page12State stashed',
      atlasState.inversion._page12State === state._pageState);
const stashedState = state._pageState;
check('_pageState has layersPresent (Set)',     stashedState.layersPresent instanceof Set);
check('_pageState has candidate slot',          'candidate' in stashedState);
check('_pageState has cur slot',                'cur' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with cusum_theta + theta_pi_per_window layers loaded');
// Synthetic cusum_theta data: 3 carriers with cp_bp positions in a chrom.
const synthCusum = {
  range_bp: { start: 1_000_000, end: 50_000_000 },
  persample: [
    { sample: 's1', cp_bp:  5_000_000, strength:  4.2, karyotype: 'HOM_REF' },
    { sample: 's2', cp_bp: 12_000_000, strength:  6.8, karyotype: 'HET'     },
    { sample: 's3', cp_bp: 28_000_000, strength: -3.1, karyotype: 'HOM_INV' },
  ],
};

const atlasState2 = buildAtlasState({
  inversion: {
    layersPresent: new Set(['cusum_theta', 'theta_pi_per_window']),
    tracks: {
      LG12: {
        cusum_theta: synthCusum,
        // No theta_pi_per_window data; the helper handles missing-data via early return.
      },
    },
  },
  shared: { activeChrom: 'LG12' },
});

// Reset captured nodes
_nodes.clear();
_layerIndicators.length = 0;
_makeLayerIndicator('theta_pi_per_window');
_makeLayerIndicator('cusum_theta');

let mount2OK = true; let mount2Err = null;
try { await page12.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const empty2 = _ensureNode('thetaPiEmpty');
const ctrlBar2 = _ensureNode('thCtrlBar');
const cusumPanel2 = _ensureNode('thCusumHeroPanel');
const linesPanel2 = _ensureNode('thLinesPanel');
const simPanel2 = _ensureNode('thSimPanel');
check('thetaPiEmpty hidden when layers loaded',  empty2.style.display === 'none');
check('thCtrlBar shown when any layer loaded',   ctrlBar2.style.display === 'flex');
check('thCusumHeroPanel shown (cusum_theta loaded)',
      cusumPanel2.style.display === 'block');
check('thLinesPanel shown (theta_pi_per_window loaded)',
      linesPanel2.style.display === 'block');
check('thSimPanel hidden (theta_pi_local_pca NOT loaded)',
      simPanel2.style.display === 'none');

// Layer indicators reflect actual presence.
check('"theta_pi_per_window" indicator → loaded',
      _layerIndicators[0].textContent.includes('loaded')
      && !_layerIndicators[0].textContent.includes('not'));
check('"cusum_theta" indicator → loaded',
      _layerIndicators[1].textContent.includes('loaded')
      && !_layerIndicators[1].textContent.includes('not'));

// CUSUM hero strip canvas gets drawing operations.
const stripCanvas = _ensureNode('thCusumStripCanvas');
check('thCusumStripCanvas had draw operations recorded',
      stripCanvas._ctx && stripCanvas._ctx._ops > 0);

// -----------------------------------------------------------------------------
group('Smoke: renderPage12(state) called directly');
let renderOK = true; let renderErr = null;
try { page12.renderPage12(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderPage12(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: state-aware wrappers callable individually');
let wrapperOK = true; let wrapperErr = null;
try {
  page12.refreshThetaPiLayerStatus(stashedState);
  page12.refreshThetaPiPanelVisibility(stashedState);
  page12.drawThCusumHero(stashedState);
}
catch (e) { wrapperOK = false; wrapperErr = e; }
check('individual wrappers ran without throwing',
      wrapperOK, wrapperErr ? wrapperErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page12.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
