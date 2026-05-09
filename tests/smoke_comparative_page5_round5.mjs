// tests/smoke_comparative_page5_round5.mjs
//
// Round 5 step 16 (chat 38, 2026-05-07): full mount / unmount lifecycle
// smoke test for page5 (quick-reference / help page — comparative tier-1
// closeout).
//
// Page5 is a static help page — purely declarative HTML (~1158 LOC of
// help/vocabulary/hotkeys/pipeline reference content), no interactive
// elements that require JS. The chat-33 renderPage5() is a true no-op;
// the round-5-step-16 migration adds a state-aware wrapper refreshPage5
// that sets _pageState before delegating, plus mount/unmount lifecycle.
// Both chat-33 exports (renderPage5 + PAGE5_META) are preserved verbatim
// because the page-loader's tabBar router reads PAGE5_META.id/stage/
// static at legacy line 5142.
//
// What this smoke verifies (lighter than page15's behavioural smoke
// because page5 has no DOM behaviour to assert):
//   - module loads cleanly, lifecycle + wrapper + chat-33 exports all
//     present
//   - mount() runs without throwing on minimal atlasState
//   - mount() runs without throwing on populated atlasState
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page5State stash identity-equal to
//     _pageState (canonical shape proof)
//   - refreshPage5(state) callable directly (re-run path)
//   - PAGE5_META survives intact
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page5 = await import(`${WORKSPACE}/atlases/inversion/pages/comparative/page5.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/comparative/page5/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page8/9/19 smoke harnesses.
// Page5's mount doesn't touch the DOM (renderPage5 is a no-op) but the
// polyfill is here for uniformity + future-proofing.
// -----------------------------------------------------------------------------

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
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
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
check('page5 has mount',                   typeof page5.mount === 'function');
check('page5 has unmount',                 typeof page5.unmount === 'function');
check('page5 has refreshPage5 (wrapper)',  typeof page5.refreshPage5 === 'function');
check('page5 has renderPage5 (chat-33)',   typeof page5.renderPage5 === 'function');
check('page5 has PAGE5_META',              typeof page5.PAGE5_META === 'object');

// -----------------------------------------------------------------------------
group('PAGE5_META shape (used by tabBar router at legacy line 5142)');
check('PAGE5_META.id === "page5"',         page5.PAGE5_META.id === 'page5');
check('PAGE5_META.stage === "help"',       page5.PAGE5_META.stage === 'help');
check('PAGE5_META.static === true',        page5.PAGE5_META.static === true);

// -----------------------------------------------------------------------------
group('Smoke: mount() on minimal atlasState');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page5.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page5State stashed',
      atlasState.inversion._page5State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page5State === state._pageState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with populated atlasState (no real state slots needed)');
// Page5 has no real state slots (it's a static help page). Mount with a
// populated inversion namespace anyway to verify _buildLegacyState's
// Object.assign({}, inv) base-copy doesn't blow up on extra fields.
const atlasState2 = buildAtlasState({
  inversion: {
    activeChrom: 'LG28',
    candidateList: [{ id: 'C001', confirmed: true }],
    extraField:    'should be copied through',
  },
});

let mount2OK = true; let mount2Err = null;
try { await page5.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');
check('atlasState2 stash refreshed',           atlasState2.inversion._page5State === state._pageState);
check('extra fields copied through to _pageState',
      state._pageState.extraField === 'should be copied through');

// -----------------------------------------------------------------------------
group('Smoke: refreshPage5(state) called directly (re-run path)');
const reRunState = { marker: 'rerun' };
let renderOK = true; let renderErr = null;
try { page5.refreshPage5(reRunState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshPage5(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');
check('refreshPage5(state) updated _pageState',
      state._pageState === reRunState);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page5.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
