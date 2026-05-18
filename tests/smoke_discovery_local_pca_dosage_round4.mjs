// /tests/smoke_discovery_page1_round4.mjs
//
// Smoke test for the round-4 split of local_pca_dosage (chat 35, 2026-05-06).
// Mirrors the eighth-pass smoke test scope, plus extras for the split:
//   - mount()/unmount() lifecycle through atlas_api.bootstrap
//   - _pageState live-binding across module boundaries
//
// USAGE: from an assembled atlas-core+inversion workspace,
//   WORKSPACE=/path/to/workspace node tests/smoke_discovery_page1_round4.mjs
// Defaults to /home/claude/workspace if WORKSPACE is unset.
//
// Builds a fake DOM, synthetic data (N=100 windows, S=50 samples,
// 2 L1 envelopes, 2 L2 envelopes, 8 family IDs, sim_thumb), and exercises:
//   1. applyData populates state correctly
//   2. setCur(state, 25) runs the full draw chain without errors
//   3. unmount cleans up
//   4. mount() lifecycle through atlas_api.bootstrap
//   5. _pageState live-binding across module boundaries
//
// Per the eighth-pass handoff expectations:
//   - pc1Sign has 100 entries
//   - windowToL1[0] === -1, windowToL1[20] === 0, windowToL1[50] === -1, windowToL1[75] === 1
//   - 8 family IDs become hubs (each has 6-7 samples ≥ n=4 threshold)
//   - l2NeighborsInL1.size === 2

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace';

// Defer all imports — we use dynamic import so the file path is
// configurable via WORKSPACE env var.
const local_pca_dosage = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/local_pca_dosage.js`);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

// ---------------------------------------------------------------------------
// Fake DOM — minimal HTMLCanvasElement + getContext + getBoundingClientRect
// ---------------------------------------------------------------------------

class FakeCanvasContext {
  constructor() {
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '10px sans-serif';
    this.globalAlpha = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.canvas = null;
    this.imageSmoothingEnabled = true;
    this._stack = [];
  }
  // No-op methods — count calls so we can verify draw activity.
  fillRect()    {} strokeRect()  {} clearRect()  {}
  beginPath()   {} closePath()   {}
  moveTo()      {} lineTo()      {} arc()        {} arcTo() {}
  rect()        {} fill()        {} stroke()     {}
  fillText()    {} strokeText()  {}
  measureText(s){ return { width: (s ? s.length : 0) * 6 }; }
  setLineDash() {} getLineDash() { return []; }
  save()        { this._stack.push({}); }
  restore()     { this._stack.pop(); }
  translate()   {} rotate()      {} scale()       {} transform() {} setTransform() {} resetTransform() {}
  clip()        {} createLinearGradient() { return { addColorStop(){} }; }
  createRadialGradient() { return { addColorStop(){} }; }
  bezierCurveTo() {} quadraticCurveTo() {}
  putImageData() {} getImageData(x, y, w, h) {
    return { data: new Uint8ClampedArray(w*h*4), width: w, height: h };
  }
  createImageData(w, h) {
    return { data: new Uint8ClampedArray(w*h*4), width: w, height: h };
  }
  drawImage() {} ellipse() {} roundRect() {}
}

class FakeCanvas {
  constructor(id, width = 800, height = 200) {
    this.id = id;
    this.width = width;
    this.height = height;
    this.style = {};
    this.classList = { add(){}, remove(){}, toggle(){}, contains(){return false;} };
    this.dataset = {};
    this._listeners = {};
  }
  getContext(kind) {
    if (kind === '2d') {
      const c = new FakeCanvasContext();
      c.canvas = this;
      return c;
    }
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.width, bottom: this.height,
             width: this.width, height: this.height, x: 0, y: 0 };
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (!this._listeners[t]) return;
    this._listeners[t] = this._listeners[t].filter(f => f !== fn);
  }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
}

class FakeElement {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.style = {};
    this.classList = {
      _classes: new Set(),
      add(c){this._classes.add(c);},
      remove(c){this._classes.delete(c);},
      toggle(c, force){
        if (force === true) this._classes.add(c);
        else if (force === false) this._classes.delete(c);
        else if (this._classes.has(c)) this._classes.delete(c);
        else this._classes.add(c);
      },
      contains(c){return this._classes.has(c);}
    };
    this.dataset = {};
    this._listeners = {};
    this._innerHTML = '';
    this._textContent = '';
    this.checked = false;
    this.value = '';
    this.disabled = false;
    this.parentNode = null;
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v == null ? '' : String(v); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length-1] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
    return c;
  }
  querySelector(sel) { return _querySelector(this, sel); }
  querySelectorAll(sel) { return _querySelectorAll(this, sel); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    if (!this._listeners[t]) return;
    this._listeners[t] = this._listeners[t].filter(f => f !== fn);
  }
  setAttribute(k, v) { this[k] = v; if (k === 'id') this.id = v; }
  getAttribute(k) { return this[k]; }
  hasAttribute(k) { return this[k] !== undefined; }
  removeAttribute(k) { delete this[k]; }
  insertAdjacentHTML() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 200, width: 800, height: 200, x:0, y:0 };
  }
  cloneNode() { return new FakeElement(this.tagName, this.id); }
  focus() {} blur() {} click() {}
}

function _querySelector(el, sel) {
  // Very thin: support `#id`, `.class`, `tag`, `[attr=val]`, descendant.
  // Fallback: linear walk.
  const stack = [el];
  const test = makeTester(sel);
  while (stack.length) {
    const n = stack.pop();
    if (test(n)) return n;
    for (const c of n.children || []) stack.push(c);
  }
  return null;
}
function _querySelectorAll(el, sel) {
  const out = [];
  const stack = [el];
  const test = makeTester(sel);
  while (stack.length) {
    const n = stack.pop();
    if (test(n)) out.push(n);
    for (const c of n.children || []) stack.push(c);
  }
  return out;
}
function makeTester(sel) {
  // Only handle simple cases.
  if (sel.startsWith('#')) {
    const id = sel.slice(1);
    return n => n.id === id;
  }
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return n => n.classList && n.classList.contains(cls);
  }
  return n => n.tagName === sel.toUpperCase();
}

// ---------------------------------------------------------------------------
// Fake document
// ---------------------------------------------------------------------------

const _byId = {};

const _document = {
  body: new FakeElement('body'),
  documentElement: new FakeElement('html'),
  createElement(tag) {
    if (tag === 'canvas') return new FakeCanvas('', 800, 200);
    return new FakeElement(tag);
  },
  createElementNS(_ns, tag) { return new FakeElement(tag); },
  createTextNode(s) { return { nodeValue: String(s) }; },
  createDocumentFragment() { return new FakeElement('#fragment'); },
  getElementById(id) { return _byId[id] || null; },
  querySelector(sel) {
    if (sel.startsWith('#')) return _byId[sel.slice(1)] || null;
    return null;
  },
  querySelectorAll(sel) {
    const out = [];
    if (sel.startsWith('#')) { const e = _byId[sel.slice(1)]; if (e) out.push(e); }
    return out;
  },
  addEventListener() {},
  removeEventListener() {},
};
function registerEl(id, el) { _byId[id] = el; el.id = id; return el; }

// local_pca_dosage.html identifies the canvases the draw functions hit. Provide them.
const ROOT = new FakeElement('div', 'local_pca_dosage-root');
const sim   = new FakeCanvas('simCanvas',  900, 220);  registerEl('simCanvas', sim);   ROOT.appendChild(sim);
const z     = new FakeCanvas('zCanvas',    900, 200);  registerEl('zCanvas', z);       ROOT.appendChild(z);
const pca   = new FakeCanvas('pcaCanvas',  500, 500);  registerEl('pcaCanvas', pca);   ROOT.appendChild(pca);
const lines = new FakeCanvas('linesCanvas',900, 400);  registerEl('linesCanvas', lines); ROOT.appendChild(lines);
const anchor = new FakeCanvas('anchorCanvas', 900, 60); registerEl('anchorCanvas', anchor); ROOT.appendChild(anchor);
const tracksCanvas = new FakeCanvas('tracksCanvas', 900, 120); registerEl('tracksCanvas', tracksCanvas); ROOT.appendChild(tracksCanvas);

// Some sidebar/topbar elements that legacy code asks for; we just provide
// them so the null-safe checks see something rather than crash.
for (const id of [
  'dataStatus','headerMeta','schemaBadge','simScaleSelect','simScaleWrap',
  'pcaPicker','linesPicker','linesYpicker','linesColorPicker','colorModePicker',
  'pcaAxisPicker','bandPickBar','candidateUI','candidateList','candList',
  'l3Panel','l3SlabPanel','l3ScaleStabilityPanel','trackedList','manualGroupsList',
  'winLabel','winInfo','linesPanel','linesPanelControls','linesPanelCheckboxes',
  'screeInset','anchorStrip','anchorScreeInset','playBtn','scrubber',
  'trackPanels','trackedCount','tracksPanel','candidateBar','linesPanelHeader',
  'pinUI','linesColorMode','linesColorOnPCA','candidateMeta','candidateEmpty',
  'l3StatusBar','l3SlabPickRow','linesYsourcesRow','linesYsourcePicker',
  'emptyState',
]) {
  if (!_byId[id]) {
    const el = id.toLowerCase().includes('canvas')
      ? new FakeCanvas(id, 800, 200)
      : new FakeElement('div');
    registerEl(id, el);
    ROOT.appendChild(el);
  }
}

// scrubber as input
const scrubberEl = _byId['scrubber'];
scrubberEl.tagName = 'INPUT'; scrubberEl.type = 'range'; scrubberEl.max = '0';

// playBtn as button
const playEl = _byId['playBtn']; playEl.tagName = 'BUTTON';

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const _localStorageMap = {};
const _localStorage = {
  getItem(k) { return _localStorageMap[k] === undefined ? null : _localStorageMap[k]; },
  setItem(k, v) { _localStorageMap[k] = String(v); },
  removeItem(k) { delete _localStorageMap[k]; },
  clear() { for (const k of Object.keys(_localStorageMap)) delete _localStorageMap[k]; }
};

globalThis.document = _document;
globalThis.window = globalThis;
globalThis.localStorage = _localStorage;
globalThis.requestAnimationFrame = (fn) => { try { fn(0); } catch (_) {} return 0; };
globalThis.cancelAnimationFrame = () => {};
globalThis.requestIdleCallback = (fn) => { try { fn({ timeRemaining: () => 50 }); } catch (_) {} return 0; };
globalThis.cancelIdleCallback = () => {};
globalThis.devicePixelRatio = 1;
globalThis.HTMLCanvasElement = FakeCanvas;
globalThis.Image = class { constructor(){ this.onload=null; this.onerror=null; this.src=''; }};
globalThis.indexedDB = undefined;
globalThis.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });

// ---------------------------------------------------------------------------
// Synthetic data
// ---------------------------------------------------------------------------

const N = 100;   // windows
const S = 50;    // samples

function makeSamples(s) {
  const out = [];
  // 8 family IDs, each with ~6 samples (>=4 threshold → all become hubs)
  for (let i = 0; i < s; i++) {
    out.push({
      sample_id: 'S' + i,
      ind: 'IND' + i,
      cga: 'CGA' + i,
      family_id: i % 8,        // 0..7 cycling
      l1_id: null, l2_id: null,
    });
  }
  return out;
}

function makeWindows(n, s) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = {
      id: i,
      center_mb: 1 + i * 0.5,         // 1..50.5 Mb
      start_bp: 1_000_000 + i * 500_000,
      end_bp:   1_000_000 + (i+1) * 500_000,
      pc1: new Float32Array(s),
      pc2: new Float32Array(s),
      pc1_var_explained: 0.4 + (i % 5) * 0.02,
      pc2_var_explained: 0.2 + (i % 3) * 0.01,
      n_snps: 1000 + (i % 7) * 10,
    };
    // Fill PCs with a simple deterministic pattern
    for (let k = 0; k < s; k++) {
      w.pc1[k] = Math.cos(i * 0.1 + k * 0.05);
      w.pc2[k] = Math.sin(i * 0.07 + k * 0.04);
    }
    out.push(w);
  }
  return out;
}

const data = {
  chrom: 'LG12',
  n_windows: N,
  n_samples: S,
  default_sim_scale: null,
  sim_scales: {},   // empty — will fall back to sim_thumb
  sim_thumb: new Uint8Array(N * N).map(() => Math.floor(Math.random() * 255)),
  sim_thumb_n: N,
  windows: makeWindows(N, S),
  samples: makeSamples(S),
  l1_envelopes: [
    // covers windows 21..40 → windowToL1[20]=0, [50]=-1
    { id: 'L1A', start_w: 21, end_w: 40, parent_l1_id: null, score: 5.5 },
    // covers windows 71..90 → windowToL1[75]=1
    { id: 'L1B', start_w: 71, end_w: 90, parent_l1_id: null, score: 4.8 },
  ],
  l2_envelopes: [
    { id: 'L2A', start_w: 25, end_w: 35, parent_l1_id: 'L1A', score: 3.2 },
    { id: 'L2B', start_w: 75, end_w: 85, parent_l1_id: 'L1B', score: 2.9 },
  ],
  l2_boundaries: [],
  family_source: 'pairs',
  theta_cutoff: 0.0884,
  has_pc2: true,
  tracks: {},   // none
  schema_version: 2,
  _layers_present: ['windows', 'envelopes', 'samples'],
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  cur: 0,
  data: null,
  candidate: null,
  candidateList: [],
  tracked: [],
  hubFamilies: [],
  smallFamilyIds: new Set(),
  singletonFamilyIds: new Set(),
  familyPalette: {},
  ancestryPalette: {},
  l2GroupCache: null,
  cacheKey: null,
  schemaVersion: 1,
  layersPresent: new Set(),
  pc1Sign: null,
  windowToL1: null,
  windowToL2: null,
  l2NeighborsInL1: null,
  viewControls: { pcaXY: ['pc1','pc2'], linesYsources: ['pc1'], linked: true },
  viewMode: 'genome',
  simScale: null,
  simInMinimap: false,
  linesColorMode: 'kmeans',
  colorMode: 'family',
  zColorMode: null,
  zValueMode: null,
  zHighlightThr: null,
  candidateMode: 'list',
  l3Mode: 'main',
  l3ReclusterMode: 'none',
  l3SecondaryMetric: null,
  scaleStabilityPanes: 0,
  l3CacheFp: null,
  l3CacheRendered: null,
  l3Draft: null,
  secondaryL2: null,
  trackedN: 0,
  compareUnit: 'mb',
  crossSpecies: null,
  lockedLabels: null,
  lockedRefL2: null,
  bandTraceFishSet: null,
  _lineageComputeScheduled: false,
  _simGeom: null,
  _simMinimapGeom: null,
  _zGeom: null,
  _bandTraceCache: null,
  _l3Cache: null,
  _linesCache: null,
  _ghslCache: null,
  _sampleIdxCache: null,
  l2SweepEnabled: false,
  playing: false,
  playTimer: null,
  candidate_review_decisions: {},
  locked_karyotype_groups: {},
  linesPanelCandidateBands: false,
  activeSampleSet: null,
  trailN: 5,
  jitterAmp: 0.0,
  k: 3,
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('--- Smoke: applyData ---');
try {
  local_pca_dosage.applyData(state, data);
  check('applyData ran without throwing', true);
} catch (e) {
  check('applyData ran without throwing', false, e.stack || e);
}

// State validations
check('schemaVersion === 2',                      state.schemaVersion === 2,    `got ${state.schemaVersion}`);
check('layersPresent is a Set with windows',       state.layersPresent instanceof Set && state.layersPresent.has('windows'));
check('pc1Sign has 100 entries',                  state.pc1Sign && state.pc1Sign.length === 100, `got len ${state.pc1Sign && state.pc1Sign.length}`);
check('windowToL1[0] === -1',                     state.windowToL1 && state.windowToL1[0] === -1, `got ${state.windowToL1 && state.windowToL1[0]}`);
check('windowToL1[20] === 0',                     state.windowToL1 && state.windowToL1[20] === 0, `got ${state.windowToL1 && state.windowToL1[20]}`);
check('windowToL1[50] === -1',                    state.windowToL1 && state.windowToL1[50] === -1, `got ${state.windowToL1 && state.windowToL1[50]}`);
check('windowToL1[75] === 1',                     state.windowToL1 && state.windowToL1[75] === 1, `got ${state.windowToL1 && state.windowToL1[75]}`);
check('windowToL2[20] === -1 (before L2A)',       state.windowToL2 && state.windowToL2[20] === -1, `got ${state.windowToL2 && state.windowToL2[20]}`);
check('windowToL2[24] === 0 (L2A starts at start_w=25)', state.windowToL2 && state.windowToL2[24] === 0, `got ${state.windowToL2 && state.windowToL2[24]}`);
check('windowToL2[30] === 0 (inside L2A)',        state.windowToL2 && state.windowToL2[30] === 0, `got ${state.windowToL2 && state.windowToL2[30]}`);
check('windowToL2[80] === 1 (inside L2B)',        state.windowToL2 && state.windowToL2[80] === 1, `got ${state.windowToL2 && state.windowToL2[80]}`);
check('hubFamilies has 8 entries (n>=4 each)',    Array.isArray(state.hubFamilies) && state.hubFamilies.length === 8, `got len ${state.hubFamilies && state.hubFamilies.length}`);
check('l2NeighborsInL1.size === 2',                state.l2NeighborsInL1 instanceof Map && state.l2NeighborsInL1.size === 2, `got ${state.l2NeighborsInL1 && state.l2NeighborsInL1.size}`);

console.log('\n--- Smoke: setCur(state, 25) → full draw chain ---');
try {
  local_pca_dosage.setCur(state, 25);
  check('setCur(state, 25) ran without throwing', true);
} catch (e) {
  check('setCur(state, 25) ran without throwing', false, e.stack || e);
}
check('state.cur === 25', state.cur === 25, `got ${state.cur}`);

// One more: drive each of the public draw fns directly
console.log('\n--- Smoke: each draw fn directly ---');
for (const [name, fn] of [
  ['drawSim',          () => local_pca_dosage.drawSim(state)],
  ['drawSimMini',      () => local_pca_dosage.drawSimMini(state)],
  ['drawZ',            () => local_pca_dosage.drawZ(state)],
  ['drawLinesPanel',   () => local_pca_dosage.drawLinesPanel(state)],
  ['drawPCA',          () => local_pca_dosage.drawPCA(state)],
  ['drawAnchorStrip',  () => local_pca_dosage.drawAnchorStrip(state)],
  ['drawTracks',       () => local_pca_dosage.drawTracks(state)],
  ['updateWinLabel',   () => local_pca_dosage.updateWinLabel(state)],
]) {
  try { fn(); check(`${name} ran without throwing`, true); }
  catch (e) { check(`${name} ran without throwing`, false, (e.stack || String(e)).split('\n').slice(0, 4).join(' | ')); }
}

console.log('\n--- Smoke: unmount ---');
try {
  await local_pca_dosage.unmount(ROOT);
  check('unmount ran without throwing', true);
} catch (e) {
  check('unmount ran without throwing', false, e.stack || e);
}

// ---------------------------------------------------------------------------
// Round-4 addition: full mount() lifecycle through atlas-core's atlas_api.
// Bootstrap atlas_api with a fake state + registry, then call mount/unmount.
// ---------------------------------------------------------------------------

console.log('\n--- Smoke: mount() lifecycle through atlas-core ---');
const atlasApi = await import(`${WORKSPACE}/core/atlas_api.js`);

const fakeAtlasState = {
  shared: {
    activeChrom: 'LG12',
    activeCandidate: null,
    activeSampleSet: null,
  },
  inversion: {
    candidateList: [],
    candidate_review_decisions: {},
    locked_karyotype_groups: {},
  },
  // Minimal subscribe/emit so anything that calls them doesn't crash.
  _listeners: {},
  subscribe(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
  emit(ev, p) { for (const fn of this._listeners[ev] || []) try { fn(p); } catch (_) {} },
};

const fakeRegistry = {
  async resolve(key, _args) {
    if (key === 'scrubber_main') return data;   // hand the same synthetic data
    return null;
  },
  set: () => {}, invalidate: () => {}, trace: () => {},
};

atlasApi.bootstrap({ registry: fakeRegistry, atlasState: fakeAtlasState });

const MOUNT_ROOT = new FakeElement('div', 'mount-root');
// Need querySelector on root to find the canvases — wire them up
MOUNT_ROOT.children.push(sim, z, pca, lines, anchor, tracksCanvas, playEl, scrubberEl);

try {
  await local_pca_dosage.mount(MOUNT_ROOT, fakeAtlasState, fakeRegistry);
  check('mount() ran end-to-end without throwing', true);
} catch (e) {
  check('mount() ran end-to-end without throwing', false, e.stack || e);
}
check('mount stashed local_pca_dosage state on inversion bucket',
  fakeAtlasState.inversion._page1State !== undefined);
check('mount populated state.data',
  fakeAtlasState.inversion._page1State && fakeAtlasState.inversion._page1State.data === data);

try {
  await local_pca_dosage.unmount(MOUNT_ROOT);
  check('unmount() ran without throwing (lifecycle)', true);
} catch (e) {
  check('unmount() ran without throwing (lifecycle)', false, e.stack || e);
}
check('unmount cleared inversion._page1State',
  fakeAtlasState.inversion._page1State === undefined);

// ---------------------------------------------------------------------------
// Live-binding micro-test: verify _pageState is shared across modules
// via ES module live-binding semantics.
// ---------------------------------------------------------------------------

console.log('\n--- Smoke: _pageState live-binding across module boundaries ---');
const stateMod = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/local_pca_dosage/_state.js`);
const stateA = { tag: 'A' };
const stateB = { tag: 'B' };
stateMod._setActiveState(stateA);
check('_setActiveState(A) → _state.js sees A', stateMod._pageState === stateA);
stateMod._setActiveState(stateB);
check('_setActiveState(B) → _state.js sees B', stateMod._pageState === stateB);
// Also via a transitive importer (sim_panel.js imports _pageState)
// We can't directly inspect sim_panel's view of _pageState without
// adding a debug export, but we can verify by calling drawSimMini with
// the wrong state and checking it sees the right one via _setActiveState.
// Since drawSimMini calls _setActiveState(state) on entry, the live-binding
// flow is exercised every time setCur runs.
stateMod._setActiveState(state);
check('_pageState restored to test state', stateMod._pageState === state);

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
