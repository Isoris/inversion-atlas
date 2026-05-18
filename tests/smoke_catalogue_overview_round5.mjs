// tests/smoke_catalogue_page_overview_round5.mjs
//
// Round 5 step 8 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for overview (synthesis-stage tab, empty
// in legacy).
//
// Page_overview is empty-stub-in-legacy: legacy/Inversion_atlas.html
// line 9322 is `<div id="overview" class="page"></div>` with no
// JS handlers anywhere (verified by grep). The render is a no-op.
// This smoke verifies the lifecycle wiring works without exercising
// any DOM beyond the bare-minimum (the empty <div> is its own state).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports + factory + default present
//   - mount() runs without throwing on empty atlasState
//   - mount() runs without throwing on populated atlasState
//   - _pageState live-binding observed across module boundaries
//   - renderPageOverview(state) callable directly
//   - Backward-compat factory wirePageOverview still works after lifecycle wiring
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const pageOv = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/overview.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/overview/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as confirmed_carousel/17/18/21 smoke harnesses.
// Page_overview's render is a no-op so the DOM is barely exercised, but
// the polyfill is here in case future synthesis-overview implementation
// reads from #overview.
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
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
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

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
};

global.window = global;

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
check('pageOv has mount',                    typeof pageOv.mount === 'function');
check('pageOv has unmount',                  typeof pageOv.unmount === 'function');
check('pageOv has renderPageOverview',       typeof pageOv.renderPageOverview === 'function');
check('pageOv has wirePageOverview (compat)', typeof pageOv.wirePageOverview === 'function');
check('pageOv has default (compat)',         typeof pageOv.default === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty atlasState');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await pageOv.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._pageOverviewState stashed',
      atlasState.inversion._pageOverviewState === state._pageState);
const stashedState = state._pageState;

// -----------------------------------------------------------------------------
group('Smoke: mount() populated atlasState');
const atlasState2 = buildAtlasState({
  inversion: {
    candidateList: [{ id: 'A', confirmed: true }],
    layersPresent: new Set(['scrubber_main']),
  },
});

let mount2OK = true; let mount2Err = null;
try { await pageOv.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');
check('_pageState carries through populated state',
      state._pageState && Array.isArray(state._pageState.candidateList)
      && state._pageState.candidateList[0].id === 'A');

// -----------------------------------------------------------------------------
group('Smoke: renderPageOverview(state) called directly');
let renderOK = true; let renderErr = null;
try { pageOv.renderPageOverview(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderPageOverview(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: backward-compat wirePageOverview still works post-lifecycle-wiring');
const handle = pageOv.wirePageOverview({ data: {} });
check('wirePageOverview returned object with renderPageOverview',
      handle && typeof handle.renderPageOverview === 'function');
let factoryOK = true; let factoryErr = null;
try { handle.renderPageOverview(); }
catch (e) { factoryOK = false; factoryErr = e; }
check('factory renderPageOverview() ran without throwing',
      factoryOK, factoryErr ? factoryErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await pageOv.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
