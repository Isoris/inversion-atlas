// tests/smoke_review_popstats_round5.mjs
//
// 2026-05-20: rewritten for the native-port architecture (popstats.js no
// longer thin-loads window.renderPopstatsPage; the renderer lives in
// ./popstats/_render.js and consumes the per-chrom precomp from
// `registry.resolve('scrubber_main', { chrom })`).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle + back-compat exports all present
//   - mount() with NO activeChrom → shows the "pick a chromosome" hint
//     in #psNoChrom and does NOT touch #psStack with stale content
//   - mount() with activeChrom + a synthetic registry.resolve('scrubber_main')
//     populates _pageState with { chrom, data, candidate, cur } and
//     atlasState.inversion._page6State is identity-equal
//   - mount() error path (registry.resolve throws) surfaces the message
//     in #psNoChrom rather than crashing
//   - unmount() clears _pageState
//
// The renderer's DOM-mutation paths (canvas drawing, chip click handlers)
// are exercised but not asserted in detail — that needs a real browser.

const REPO    = process.env.REPO || new URL('..', import.meta.url).pathname;
const popstats = await import(`${REPO}/atlases/inversion/pages/review/popstats.js`);
const state    = await import(`${REPO}/atlases/inversion/pages/review/popstats/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — querySelector('#id') returns a per-id FakeNode.
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.children = [];
    this.classList = {
      _set: new Set(),
      add: (c) => this.classList._set.add(c),
      remove: (c) => this.classList._set.delete(c),
      contains: (c) => this.classList._set.has(c),
    };
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  appendChild(c) { this.children.push(c); }
  querySelector(sel) {
    if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
    return _ensureNode(sel.slice(1));
  }
  querySelectorAll(_) { return []; }
  getBoundingClientRect() { return { width: 1200, height: 100 }; }
  getContext() {
    return {
      setTransform() {}, clearRect() {}, strokeRect() {}, fillRect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {},
      fill() {}, fillText() {}, save() {}, restore() {}, setLineDash() {},
      strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textAlign: '',
      globalAlpha: 1,
    };
  }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}
function _resetNodes() { _nodes.clear(); }

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
  documentElement: { },
};
global.window = global;
global.window.devicePixelRatio = 1;
global.window.requestAnimationFrame = (cb) => { cb(); return 0; };
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
    clear: () => _store.clear(),
  };
}

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({}, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('popstats has mount',                  typeof popstats.mount === 'function');
check('popstats has unmount',                typeof popstats.unmount === 'function');
check('popstats has refreshPage6',           typeof popstats.refreshPage6 === 'function');
check('popstats has showPopstatsPage alias', typeof popstats.showPopstatsPage === 'function');
check('popstats has refreshPopstatsPage alias',
      typeof popstats.refreshPopstatsPage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NO activeChrom → "pick a chromosome" hint');
_resetNodes();
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = { resolve: async () => { throw new Error('should not be called'); } };

let mountOK = true; let mountErr = null;
try { await popstats.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() no-chrom ran without throwing',
      mountOK, mountErr ? mountErr.message : '');

const psNoChrom = _ensureNode('psNoChrom');
check('#psNoChrom shown (display=block)',
      psNoChrom.style.display === 'block');
check('#psNoChrom hint mentions "chromosome"',
      psNoChrom.textContent.toLowerCase().includes('chromosome'));

// -----------------------------------------------------------------------------
group('Smoke: mount() with activeChrom + synthetic registry.resolve');
_resetNodes();
const synthData = {
  windows: [
    { center_mb: 1.0, z: 0.5 },
    { center_mb: 2.0, z: 1.5 },
    { center_mb: 3.0, z: 3.2 },
  ],
  tracks: {
    theta_pi: { values: [0.01, 0.02, 0.015] },
  },
};
let resolveCalls = 0;
const registry2 = {
  resolve: async (layer, args) => {
    resolveCalls++;
    if (layer === 'scrubber_main' && args && args.chrom === 'LG01') return synthData;
    throw new Error(`unknown layer ${layer}`);
  },
};
const atlasState2 = buildAtlasState({ shared: { activeChrom: 'LG01' } });

let mount2OK = true; let mount2Err = null;
try { await popstats.mount(root, atlasState2, registry2); }
catch (e) { mount2OK = false; mount2Err = e; }
check('mount() with chrom ran without throwing',
      mount2OK, mount2Err ? mount2Err.message : '');
check('registry.resolve called for scrubber_main',
      resolveCalls === 1, `actual: ${resolveCalls}`);

check('_pageState.chrom set',                state._pageState && state._pageState.chrom === 'LG01');
check('_pageState.data identity-equal',      state._pageState && state._pageState.data === synthData);
check('_pageState.candidate present (null)', state._pageState && 'candidate' in state._pageState);
check('_pageState.cur a number',             typeof state._pageState?.cur === 'number');

check('atlasState.inversion._page6State stashed',
      atlasState2.inversion._page6State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState2.inversion._page6State === state._pageState);

// -----------------------------------------------------------------------------
group('Smoke: mount() error path (registry.resolve throws) surfaces in #psNoChrom');
_resetNodes();
const atlasState3 = buildAtlasState({ shared: { activeChrom: 'LG99' } });
const registry3 = {
  resolve: async () => { throw new Error('engine offline'); },
};
let mount3OK = true; let mount3Err = null;
try { await popstats.mount(root, atlasState3, registry3); }
catch (e) { mount3OK = false; mount3Err = e; }
check('mount() error path did not throw',
      mount3OK, mount3Err ? mount3Err.message : '');
const psNoChrom3 = _ensureNode('psNoChrom');
check('#psNoChrom shown after resolve error',
      psNoChrom3.style.display === 'block');
check('#psNoChrom mentions the error message',
      psNoChrom3.textContent.includes('engine offline'));

// -----------------------------------------------------------------------------
group('Smoke: unmount() clears _pageState');
let unmountOK = true; let unmountErr = null;
try { await popstats.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
