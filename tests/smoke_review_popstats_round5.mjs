// tests/smoke_review_page6_round5.mjs
//
// Round 5 step 18 (chat 38 cont., 2026-05-07): full mount / render /
// unmount lifecycle smoke test for popstats (popstats track stack —
// review stage). **Direct twin of ancestry_per_window's smoke** (shipped step 17);
// second migrated review-stage page (review group: 1 of 5 → 2 of 5).
//
// Page6 is a thin loader stub for window.renderPopstatsPage (defined
// in the external js/atlas_page6_wiring.js bundle). The chat-33
// showPopstatsPage(state) tries window.renderPopstatsPage; if absent,
// falls back to setting #psNoChrom's display:block + innerHTML to a
// "wiring not loaded" message and clearing #psStack.innerHTML.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle + wrapper + chat-33 exports all
//     present
//   - mount() with NO window.renderPopstatsPage → fallback empty-state
//     visible (#psNoChrom display='block', message text present;
//     #psStack innerHTML cleared)
//   - mount() WITH a synthetic window.renderPopstatsPage → renderer
//     called; fallback NOT triggered (#psNoChrom not touched)
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page6State stash identity-equal to
//     _pageState
//   - refreshPage6(state) callable directly (re-render path)
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const popstats = await import(`${WORKSPACE}/atlases/inversion/pages/review/popstats.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/popstats/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as ancestry_per_window smoke plus #psNoChrom +
// #psStack accessibility.
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
function _resetNodes() { _nodes.clear(); }

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
};

global.window = global;

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      data: {},
      popstatsLive: {},
      popstatsTracksOn: new Set(),
      popstatsGalleryOpen: false,
      candidate: null,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('popstats has mount',                       typeof popstats.mount === 'function');
check('popstats has unmount',                     typeof popstats.unmount === 'function');
check('popstats has refreshPage6 (wrapper)',      typeof popstats.refreshPage6 === 'function');
check('popstats has showPopstatsPage (chat-33)',  typeof popstats.showPopstatsPage === 'function');
check('popstats has refreshPopstatsPage (chat-33)',
      typeof popstats.refreshPopstatsPage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NO window.renderPopstatsPage → fallback empty-state');
_resetNodes();
// Ensure window.renderPopstatsPage is absent.
delete global.renderPopstatsPage;

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await popstats.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing (fallback path)',
      mountOK, mountErr ? mountErr.message : '');

const psNoChrom = _ensureNode('psNoChrom');
const psStack   = _ensureNode('psStack');
check('#psNoChrom shown (display=block)',
      psNoChrom.style.display === 'block');
check('#psNoChrom text mentions "Popstats wiring"',
      psNoChrom.innerHTML.includes('Popstats wiring'));
check('#psNoChrom text mentions atlas_page6_wiring.js',
      psNoChrom.innerHTML.includes('atlas_page6_wiring.js'));
check('#psStack innerHTML cleared',
      psStack.innerHTML === '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page6State stashed',
      atlasState.inversion._page6State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page6State === state._pageState);
const stashedState = state._pageState;
check('_pageState has data slot',                    'data' in stashedState);
check('_pageState.popstatsTracksOn is Set',          stashedState.popstatsTracksOn instanceof Set);
check('_pageState has popstatsLive slot',            'popstatsLive' in stashedState);
check('_pageState has popstatsGalleryOpen slot',     'popstatsGalleryOpen' in stashedState);
check('_pageState has candidate slot',               'candidate' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() WITH window.renderPopstatsPage → renderer called, no fallback');
_resetNodes();
let rendererCalls = 0;
global.renderPopstatsPage = function () { rendererCalls++; };

const atlasState2 = buildAtlasState({
  inversion: {
    candidate: { id: 'C001', confirmed: true },
    data: { theta_pi: { _stub: true }, fst: { _stub: true } },
    popstatsTracksOn: new Set(['theta_pi', 'fst']),
  },
});

let mount2OK = true; let mount2Err = null;
try { await popstats.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing',
      mount2OK, mount2Err ? mount2Err.message : '');
check('window.renderPopstatsPage called once by mount',
      rendererCalls === 1, `actual: ${rendererCalls}`);

const psNoChrom2 = _ensureNode('psNoChrom');
check('#psNoChrom NOT touched when renderer present (display unset)',
      psNoChrom2.style.display === '');
check('atlasState2 stash refreshed',
      atlasState2.inversion._page6State === state._pageState);
check('_pageState.candidate propagated',
      state._pageState.candidate && state._pageState.candidate.id === 'C001');

// -----------------------------------------------------------------------------
group('Smoke: refreshPage6(state) called directly (re-render path)');
const reRenderState = {
  data: { theta_pi: { _stub: true } },
  popstatsLive: {},
  popstatsTracksOn: new Set(['fst']),
  popstatsGalleryOpen: false,
  candidate: null,
};
let renderOK = true; let renderErr = null;
try { popstats.refreshPage6(reRenderState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshPage6(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');
check('window.renderPopstatsPage called again',
      rendererCalls === 2, `actual: ${rendererCalls}`);
check('refreshPage6(state) updated _pageState',
      state._pageState === reRenderState);

// Cleanup synthetic renderer.
delete global.renderPopstatsPage;

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
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
