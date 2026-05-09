// tests/smoke_discovery_page15_round5.mjs
//
// Round 5 step 15 (chat 38, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page15 (GHSL haplotype-divergence page —
// discovery stage). Closes the discovery group (6 of 6 migrated).
//
// Page15 has ONE chat-33 extracted helper (_refreshGhslLayerStatus)
// that iterates [data-gh-layer] DOM nodes and toggles textContent +
// style.color between "🟢 loaded" / "⚪ not loaded" based on
// state.layersPresent (a Set). The state-aware public wrapper
// refreshGhslLayerStatus(state) sets _pageState before delegating
// (mirrors page9's refreshConfirmedCarousel pattern).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle + wrapper + underscore-helper
//     all exported
//   - mount() runs without throwing on minimal atlasState
//   - mount() actually toggles the [data-gh-layer] chips
//     (this is the BEHAVIOURAL check that distinguishes page15 from
//     the pure-stub page8/page19 smokes)
//   - mount() with populated layersPresent toggles the matching chips
//     to "🟢 loaded" / var(--good); leaves the others as
//     "⚪ not loaded" / var(--ink-dimmer)
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page15State stash identity-equal to
//     _pageState
//   - refreshGhslLayerStatus(state) callable directly (re-render path)
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page15 = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page15.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page15/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — enriched for page15: must support
// querySelectorAll('[data-gh-layer]') returning the registered
// indicator nodes.
//
// Page15.html declares 5 [data-gh-layer] indicators:
//   ghsl_panel, ghsl_kstripes, ghsl_karyotype_runs,
//   ghsl_d17_envelopes, cusum_ghsl
// -----------------------------------------------------------------------------

const _ghLayerNodes = [];

class FakeGhLayerNode {
  constructor(layerName) {
    this.id = '_gh_' + layerName;
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '', color: '' };
    this.dataset = { ghLayer: layerName };
    this._listeners = {};
    this.value = '';
    this.children = [];
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  querySelector(_) { return null; }
  querySelectorAll(_) { return []; }
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.value = '';
    this.children = [];
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
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

// Register all 5 [data-gh-layer] nodes mirroring page15.html.
const GH_LAYERS = [
  'ghsl_panel', 'ghsl_kstripes', 'ghsl_karyotype_runs',
  'ghsl_d17_envelopes', 'cusum_ghsl',
];
function _resetGhLayerNodes() {
  _ghLayerNodes.length = 0;
  for (const name of GH_LAYERS) _ghLayerNodes.push(new FakeGhLayerNode(name));
}
_resetGhLayerNodes();

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
  querySelectorAll: (sel) => {
    if (sel === '[data-gh-layer]') return _ghLayerNodes;
    return [];
  },
};

global.window = global;

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      layersPresent: new Set(),
      activeChrom:   null,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

function _findChip(layerName) {
  return _ghLayerNodes.find(n => n.dataset.ghLayer === layerName);
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page15 has mount',                       typeof page15.mount === 'function');
check('page15 has unmount',                     typeof page15.unmount === 'function');
check('page15 has refreshGhslLayerStatus',      typeof page15.refreshGhslLayerStatus === 'function');
check('page15 has _refreshGhslLayerStatus',     typeof page15._refreshGhslLayerStatus === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() on minimal atlasState (no GHSL layers loaded)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page15.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// All 5 chips should now read "⚪ not loaded".
const allUnloaded = _ghLayerNodes.every(n => n.textContent === '⚪ not loaded');
check('all 5 [data-gh-layer] chips set to "⚪ not loaded"', allUnloaded);
const allDimmer = _ghLayerNodes.every(n => n.style.color === 'var(--ink-dimmer)');
check('all 5 chips coloured var(--ink-dimmer)', allDimmer);

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page15State stashed',
      atlasState.inversion._page15State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page15State === state._pageState);
const stashedState = state._pageState;
check('_pageState has layersPresent slot (Set)',
      stashedState.layersPresent instanceof Set);
check('_pageState has activeChrom slot',                 'activeChrom' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with two GHSL layers present');
_resetGhLayerNodes();  // clear chip state from prior mount

const atlasState2 = buildAtlasState({
  inversion: {
    activeChrom: 'LG28',
    layersPresent: new Set(['ghsl_panel', 'cusum_ghsl']),
  },
});

let mount2OK = true; let mount2Err = null;
try { await page15.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

// The two named chips should be "loaded"; the other three "not loaded".
check('ghsl_panel chip → "🟢 loaded"',
      _findChip('ghsl_panel').textContent === '🟢 loaded');
check('cusum_ghsl chip → "🟢 loaded"',
      _findChip('cusum_ghsl').textContent === '🟢 loaded');
check('ghsl_kstripes chip stays "⚪ not loaded"',
      _findChip('ghsl_kstripes').textContent === '⚪ not loaded');
check('loaded chip coloured var(--good)',
      _findChip('ghsl_panel').style.color === 'var(--good)');
check('unloaded chip coloured var(--ink-dimmer)',
      _findChip('ghsl_kstripes').style.color === 'var(--ink-dimmer)');
check('atlasState2 stash refreshed',
      atlasState2.inversion._page15State === state._pageState);

// -----------------------------------------------------------------------------
group('Smoke: refreshGhslLayerStatus(state) called directly (re-render path)');
// Simulate a layer landing post-mount: rebuild state with three layers.
_resetGhLayerNodes();
const reRenderState = { layersPresent: new Set(['ghsl_panel', 'ghsl_kstripes', 'ghsl_d17_envelopes']) };
let renderOK = true; let renderErr = null;
try { page15.refreshGhslLayerStatus(reRenderState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshGhslLayerStatus(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');
check('ghsl_panel re-rendered to "🟢 loaded"',
      _findChip('ghsl_panel').textContent === '🟢 loaded');
check('ghsl_d17_envelopes re-rendered to "🟢 loaded"',
      _findChip('ghsl_d17_envelopes').textContent === '🟢 loaded');
check('cusum_ghsl re-rendered to "⚪ not loaded"',
      _findChip('cusum_ghsl').textContent === '⚪ not loaded');
check('refreshGhslLayerStatus(state) updated _pageState',
      state._pageState === reRenderState);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page15.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
