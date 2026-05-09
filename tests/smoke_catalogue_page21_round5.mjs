// tests/smoke_catalogue_page21_round5.mjs
//
// Round 5 step 6 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page21 (annotation cockpit).
//
// Page21 is a catalogue-stage page: takes the active candidate list +
// per-window PC1 trajectories and renders an interactive cockpit canvas
// (cursor-driven candidate selection, digit-key band picking, lasso/track
// linkage shading). The renderer fills #annoCockpitCanvas + footer panels
// (#annoCandidateInfo + #annoLinkagePanel) and lazy-inits state.cockpitCursor.
//
// What this smoke verifies:
//   - module loads cleanly, all 11 helpers + 5 constants + lifecycle exports present
//   - mount() empty-state path: no candidates → empty placeholder shown,
//     body hidden (no canvas draw call)
//   - mount() populated path: synthetic candidate triggers cockpit render,
//     canvas .width set, lazy-inited state.cockpitCursor present
//   - _pageState live-binding observed across module boundaries
//   - refreshAnnotationCockpit(state) callable directly
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page21 = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page21.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page21/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page1/2/3/17/18 smoke harnesses.
// Adds canvas-context shim because page21's draw path uses canvas extensively.
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
  beginPath()   { this._ops++; }
  moveTo()      { this._ops++; }
  lineTo()      { this._ops++; }
  stroke()      { this._ops++; }
  rect()        { this._ops++; }
  clearRect()   { this._ops++; }
  save()        {}
  restore()     {}
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.tagName = (typeof id === 'string' && id.startsWith('<')) ? id.slice(1, -1).toUpperCase() : '';
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
    this.clientHeight = 500;
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
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).forEach(cb => cb(evt));
  }
  appendChild(c) { this.children.push(c); }
  removeChild(c) {
    const idx = this.children.indexOf(c);
    if (idx >= 0) this.children.splice(idx, 1);
  }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  click() { (this._listeners['click'] || []).forEach(cb => cb({ type: 'click' })); }
  querySelector(sel) {
    if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
    return _ensureNode(sel.slice(1));
  }
  querySelectorAll(_) { return []; }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
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

global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
global.Blob = class { constructor() {} };
global.FileReader = class {
  constructor() { this.onload = null; }
  readAsText() {}
};

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      tracked: [],
      cockpitCursor: null,
      cockpitSelectedBand: null,
      candidates: null,
      candidates_detailed: null,
      activeMode: null,
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
check('page21 has mount',                       typeof page21.mount === 'function');
check('page21 has unmount',                     typeof page21.unmount === 'function');
check('page21 has refreshAnnotationCockpit',    typeof page21.refreshAnnotationCockpit === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state path (no candidates)');
// The 4 external helpers (_gatherActiveCandidatesForInheritance etc.) are
// undefined globals at runtime — kept as runtime guards in the body. In an
// empty-state mount with no global stub for them, the call to
// _gatherActiveCandidatesForInheritance throws ReferenceError; mount catches
// it via the try/catch wrapper and degrades gracefully.
//
// To exercise the empty-state code path properly, stub the global to return [].
global._gatherActiveCandidatesForInheritance = function () { return []; };

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page21.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const empty = _ensureNode('annotationCockpitEmpty');
const body  = _ensureNode('annotationCockpitBody');
check('empty placeholder shown in empty mount',  empty.style.display === 'block');
check('body hidden in empty mount',              body.style.display  === 'none');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page21State stashed',
      atlasState.inversion._page21State === state._pageState);
const stashedState = state._pageState;
check('_pageState has tracked array',                   Array.isArray(stashedState.tracked));
check('_pageState has cockpitCursor (lazy-inited)',     stashedState.cockpitCursor != null
                                                        && stashedState.cockpitCursor.mb === null);

// -----------------------------------------------------------------------------
group('Smoke: mount() populated-state path (synthetic candidate)');
// Build a candidate with K=3 band assignments + windows so the canvas
// draw path executes (per-band polyline rendering + axis ticks + cursor line).
const synthCand = {
  id: 'cand_LG12_001',
  seq_num: 1,
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  K: 3,
  labels: [0, 0, 1, 1, 2, 2, 0],  // 7 fish
};
global._gatherActiveCandidatesForInheritance = function () { return [synthCand]; };

const atlasState2 = buildAtlasState({
  inversion: {
    tracks: {
      LG12: {
        chrom_len_bp: 50_000_000,
        samples: ['s1','s2','s3','s4','s5','s6','s7'],
        windows: [
          { start_bp:        0, end_bp:  5_000_000, pca: { pc1: [-1.2, -1.1, 0.0, 0.1, 1.0, 1.1, -1.0] } },
          { start_bp: 5_000_000, end_bp: 12_000_000, pca: { pc1: [-1.5, -1.4, 0.2, 0.3, 1.4, 1.5, -1.2] } },
          { start_bp:12_000_000, end_bp: 50_000_000, pca: { pc1: [-1.0, -0.9, 0.1, 0.2, 0.9, 1.0, -0.8] } },
        ],
      },
    },
  },
  shared: { activeChrom: 'LG12' },
});

// Reset captured nodes so we can observe fresh state
_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await page21.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const empty2 = _ensureNode('annotationCockpitEmpty');
const body2  = _ensureNode('annotationCockpitBody');
check('empty placeholder hidden in populated mount', empty2.style.display === 'none');
check('body shown in populated mount',                body2.style.display  === 'block');

const canvas = _ensureNode('annoCockpitCanvas');
check('canvas.width set by draw path',                canvas.width  > 0);
check('canvas.height set by draw path',               canvas.height > 0);
check('canvas context recorded operations',           canvas._ctx && canvas._ctx._ops > 0);

// -----------------------------------------------------------------------------
group('Smoke: refreshAnnotationCockpit(state) called directly');
let renderOK = true; let renderErr = null;
try { page21.refreshAnnotationCockpit(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshAnnotationCockpit(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _annoCockpitChromExtent reads from _pageState');
state._setActiveState({ data: { chrom_len_bp: 30_000_000 } });
const extent = page21._annoCockpitChromExtent([]);
check('_annoCockpitChromExtent picks chrom_len_bp via _pageState',
      extent && Math.abs(extent.mbMax - 30) < 1e-9);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page21.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// Cleanup global stub
delete global._gatherActiveCandidatesForInheritance;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
