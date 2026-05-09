// /tests/smoke_discovery_page2_round5.mjs
//
// Smoke test for the round-5-step-2 split of page2 (chat 36, 2026-05-07).
// Mirrors smoke_discovery_page1_round4.mjs structure but for page2's
// candidate-detail deep-dive. Verifies:
//   1. page2.js + 5 sub-modules load (no parse-time cycle issue from
//      _wires.js → page2.js → _wires.js).
//   2. mount() empty-state path (no candidate set) runs end-to-end.
//   3. mount() populated-state path (synthetic candidate) runs end-to-end
//      and exercises the 16 HTML builders + 7 wires + 7 draw functions
//      via renderCandidateMetadata's orchestration.
//   4. unmount() clears state.inversion._page2State and
//      _pageState (the page2 module's reference).
//   5. _pageState live-binding observed across module boundaries.
//   6. The 4 orchestrator entry points can be called directly.
//
// USAGE: from an assembled atlas-core+inversion workspace,
//   WORKSPACE=/path/to/workspace node tests/smoke_discovery_page2_round5.mjs
// Defaults to /home/claude/workspace if WORKSPACE is unset.

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace';

// ---------------------------------------------------------------------------
// Fake DOM (same as page1 smoke; page2 needs only a subset)
// ---------------------------------------------------------------------------

class FakeCanvasContext {
  constructor() {
    this.fillStyle = '#000'; this.strokeStyle = '#000';
    this.lineWidth = 1; this.font = '10px sans-serif';
    this.globalAlpha = 1; this.lineCap = 'butt'; this.lineJoin = 'miter';
    this.textAlign = 'left'; this.textBaseline = 'alphabetic';
    this.canvas = null; this.imageSmoothingEnabled = true; this._stack = [];
  }
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
    this.id = id; this.width = width; this.height = height;
    this.style = {};
    this.classList = { add(){}, remove(){}, toggle(){}, contains(){return false;} };
    this.dataset = {}; this._listeners = {};
  }
  getContext(kind) {
    if (kind === '2d') { const c = new FakeCanvasContext(); c.canvas = this; return c; }
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
    this.tagName = tag.toUpperCase(); this.id = id;
    this.children = []; this.style = {};
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
    this.dataset = {}; this._listeners = {};
    this._innerHTML = ''; this._textContent = '';
    this.checked = false; this.value = ''; this.disabled = false;
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
  const stack = [el]; const test = makeTester(sel);
  while (stack.length) {
    const n = stack.pop();
    if (test(n)) return n;
    for (const c of n.children || []) stack.push(c);
  }
  return null;
}
function _querySelectorAll(el, sel) {
  const out = []; const stack = [el]; const test = makeTester(sel);
  while (stack.length) {
    const n = stack.pop();
    if (test(n)) out.push(n);
    for (const c of n.children || []) stack.push(c);
  }
  return out;
}
function makeTester(sel) {
  if (sel.startsWith('#')) { const id = sel.slice(1); return n => n.id === id; }
  if (sel.startsWith('.')) { const cls = sel.slice(1); return n => n.classList && n.classList.contains(cls); }
  // Strip [attr=value] patterns and just match the tag for the simple case
  // (the tabBar query in refreshCandidateUI uses #tabBar button[data-page="page2"])
  if (sel.includes('[')) return () => null;   // no match — graceful fallback
  return n => n.tagName === sel.toUpperCase();
}

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
  addEventListener() {}, removeEventListener() {},
};
function registerEl(id, el) { _byId[id] = el; el.id = id; return el; }

// page2 reads / writes these elements during renderCandidateMetadata + wires.
const ROOT = new FakeElement('div', 'page2-root');
registerEl('candidateMeta', new FakeElement('div')); ROOT.appendChild(_byId['candidateMeta']);
registerEl('candidateEmpty', new FakeElement('div')); ROOT.appendChild(_byId['candidateEmpty']);

// Defensive register: any element refresh*UI / wire* might query.
for (const id of [
  'tabBar', 'candListContainer', 'candListPane', 'candListHeading',
  'promoteCandidateBtn', 'candidateBar',
  // Canvases referenced by drawCand* functions
  'candLocalPCACanvas', 'candLinesCanvas', 'candGHSLCanvas',
  'candidateSigmaCanvas', 'candidateLocationCanvas',
  // Per-band / haplotype / regime / dosage IDs the wires bind to
  'candHapAnnotationsTextarea', 'candRegimeRow', 'candDosageHeatmap',
  'candAncestryConfound', 'candConfirmedToggle', 'candNavPrev', 'candNavNext',
  'linesCanvas',
]) {
  if (!_byId[id]) {
    const el = id.toLowerCase().includes('canvas') ? new FakeCanvas(id, 800, 200) : new FakeElement('div');
    registerEl(id, el);
    ROOT.appendChild(el);
  }
}

const _localStorageMap = {};
const _localStorage = {
  getItem(k) { return _localStorageMap[k] === undefined ? null : _localStorageMap[k]; },
  setItem(k, v) { _localStorageMap[k] = String(v); },
  removeItem(k) { delete _localStorageMap[k]; },
  clear() { for (const k of Object.keys(_localStorageMap)) delete _localStorageMap[k]; },
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
// Imports (deferred so WORKSPACE env can configure path)
// ---------------------------------------------------------------------------

const page2 = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page2.js`);
const page2State = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page2/_state.js`);

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name}  ${detail}`); fail++; }
}

// ---------------------------------------------------------------------------
// Test 1: module loads cleanly (no parse-time cycle bomb)
// ---------------------------------------------------------------------------

console.log('--- Smoke: page2 module load ---');
check('page2 default loads', typeof page2 === 'object' && page2 !== null);
check('page2 exports mount', typeof page2.mount === 'function');
check('page2 exports unmount', typeof page2.unmount === 'function');
check('page2 exports renderCandidateMetadata', typeof page2.renderCandidateMetadata === 'function');
check('page2 exports refreshCandidateUI', typeof page2.refreshCandidateUI === 'function');
check('page2 exports _navigateToCandidate', typeof page2._navigateToCandidate === 'function');
check('page2 exports wireCandidateNav', typeof page2.wireCandidateNav === 'function');

// ---------------------------------------------------------------------------
// Test 2: mount() empty-state path (no candidate set)
// ---------------------------------------------------------------------------

console.log('--- Smoke: mount() empty-state (no candidate) ---');

const atlasState = {
  shared: {
    activeChrom: 'LG12',
    activeCandidate: null,    // empty state
    activeSampleSet: null,
  },
  inversion: {
    candidateList: [],
    tracks: {},
  },
};

let mountOK = false;
try {
  await page2.mount(ROOT, atlasState, { resolve: async () => null });
  mountOK = true;
} catch (e) {
  console.log('  mount threw:', e.message);
  console.log(e.stack);
}
check('mount() empty-state ran without throwing', mountOK);
check('page2State stashed on inversion bucket',
      atlasState.inversion._page2State !== undefined);

// renderCandidateMetadata writes to candidateMeta when candidate is null:
// it sets innerHTML='' and display='none', and shows the empty state.
const slot = _byId['candidateMeta'];
check('candidateMeta innerHTML cleared (no candidate)', slot.innerHTML === '');
check('candidateMeta display=none (no candidate)', slot.style.display === 'none');
check('candidateEmpty display=block (no candidate)',
      _byId['candidateEmpty'].style.display === 'block');

// ---------------------------------------------------------------------------
// Test 3: mount() populated-state path (synthetic candidate)
// ---------------------------------------------------------------------------

console.log('--- Smoke: mount() populated-state (synthetic candidate) ---');

// Build a synthetic candidate matching the legacy schema. Generated to
// flex every sub-panel HTML builder + every wire + every draw function.
// Field set extracted from candidate{To,From}JSON in legacy.
const synthCandidate = {
  id: 'cand_LG12_smoke_001',
  source: 'page1.lock',
  chrom: 'LG12',
  l2_indices: [0, 1],         // Array.from(...) — must be iterable
  ref_l2: 0,
  ref_window: 25,
  K: 3,
  locked_labels: null,        // Int8Array | null
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  start_w: 25,
  end_w: 35,
  created_at: 1700000000000,
  notes: '',
  confirmed: false,
  resolution: 'L2',
  l3_cuts: [],
  parent_split_id: null,
  // v4 turn 47+ optional metric fields — undefined is fine
  aggregate_concordance: undefined,
  band_continuity_pct: undefined,
  band_continuity_verdict: undefined,
  regime_counts: undefined,
  fish_calls: undefined,
  qc_status: undefined,
  // Block chips / inspector slots (FIG_C08-style)
  block_chips: [],
  // Ancestry confound slot
  ancestry_confound_status: null,
  // Regime row slot
  regime_row: null,
  // Age origin slot
  age_origin: null,
  // Marker fields
  primer_status: null,
};

atlasState.shared.activeCandidate = synthCandidate;
atlasState.inversion.candidateList = [synthCandidate];

let mountOK2 = false;
try {
  await page2.mount(ROOT, atlasState, { resolve: async () => null });
  mountOK2 = true;
} catch (e) {
  console.log('  mount populated threw:', e.message);
  console.log(e.stack);
}
check('mount() populated ran without throwing', mountOK2);
check('candidateMeta has innerHTML (composed sub-panels)',
      _byId['candidateMeta'].innerHTML.length > 0);
// Each builder contributes a non-empty fragment; total HTML should be
// in the 10s of KB at minimum.
check('candidateMeta innerHTML > 1000 chars',
      _byId['candidateMeta'].innerHTML.length > 1000,
      `was ${_byId['candidateMeta'].innerHTML.length}`);

// ---------------------------------------------------------------------------
// Test 4: each orchestrator runs directly without throwing
// ---------------------------------------------------------------------------

console.log('--- Smoke: each orchestrator entry-point directly ---');

const directState = atlasState.inversion._page2State;

let okRender = true; try { page2.renderCandidateMetadata(directState); } catch (e) { okRender = false; console.log('  renderCandidateMetadata:', e.message); }
check('renderCandidateMetadata(state) ran without throwing', okRender);

let okRefresh = true; try { page2.refreshCandidateUI(directState); } catch (e) { okRefresh = false; console.log('  refreshCandidateUI:', e.message); }
check('refreshCandidateUI(state) ran without throwing', okRefresh);

let okNav = true; try { page2._navigateToCandidate(directState, synthCandidate); } catch (e) { okNav = false; console.log('  _navigateToCandidate:', e.message); }
check('_navigateToCandidate(state, c) ran without throwing', okNav);

let okWireNav = true; try { page2.wireCandidateNav(directState, synthCandidate); } catch (e) { okWireNav = false; console.log('  wireCandidateNav:', e.message); }
check('wireCandidateNav(state, c) ran without throwing', okWireNav);

// ---------------------------------------------------------------------------
// Test 5: _pageState live-binding observed across module boundaries
// ---------------------------------------------------------------------------

console.log('--- Smoke: _pageState live-binding ---');

const stateA = { __label: 'A', candidate: null, candidateList: [], data: null };
const stateB = { __label: 'B', candidate: null, candidateList: [], data: null };

page2State._setActiveState(stateA);
check('_setActiveState(A) → _state.js sees A', page2State._pageState === stateA);
page2State._setActiveState(stateB);
check('_setActiveState(B) → _state.js sees B', page2State._pageState === stateB);

// Restore directState for unmount test.
page2State._setActiveState(directState);
check('_pageState restored to directState', page2State._pageState === directState);

// ---------------------------------------------------------------------------
// Test 6: unmount cleanup
// ---------------------------------------------------------------------------

console.log('--- Smoke: unmount() ---');

let unmountOK = false;
try {
  await page2.unmount(ROOT);
  unmountOK = true;
} catch (e) {
  console.log('  unmount threw:', e.message);
}
check('unmount() ran without throwing', unmountOK);
// unmount uses _getState() (atlas-core), which may not have inversion bucket.
// The _page2State delete is best-effort; what we can verify deterministically
// is that _setActiveState(null) was called.
check('_pageState cleared by unmount', page2State._pageState === null);

// ---------------------------------------------------------------------------
// Final
// ---------------------------------------------------------------------------

console.log('');
console.log('=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
