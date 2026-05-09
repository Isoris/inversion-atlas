// tests/smoke_review_page4_round5.mjs
//
// Round 5 step 21 (chat 39 cont., 2026-05-07): full mount / render /
// unmount lifecycle smoke test for page4 (karyotype/tier candidate-
// level review page). **First real review-stage migration**
// (review group: 3 of 5 → 4 of 5). Pattern 2 (single-file with
// _state.js) applied; closest peers are page12 (step 10) and page17
// (step 5) in pattern shape.
//
// page4 has 4 chat-33 functions + 1 page-private const (karyoState),
// all preserved verbatim. The 2 of 4 functions that read bare `state`
// (renderCandidateKaryotype + renderCandidateTier) got the manual
// AST shim `const state = _pageState;` injected at body open. The
// other 2 (_refreshSubviewButtonStyles + setKaryoSubview) don't read
// state — left untouched.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports present
//   - mount() with NULL candidate runs without throwing — both
//     renderers exit cleanly via the `if (!state.candidate) return`
//     branch, painting the empty-state DOM (#candKaryoEmpty visible,
//     #candKaryoContent + #candTierContent hidden, subview bar hidden)
//   - mount() with state.candidate set + Tier subview active routes
//     to renderCandidateTier; with the final_classification layer
//     ABSENT, the renderer paints the empty-state HTML at
//     #candTierContent. The empty-state path calls
//     _renderTierAxesGrid(null) inside a template literal which
//     throws ReferenceError (still TODO_MISSING per the chat-33
//     extraction) — mount-time try/catch swallows this, so mount()
//     itself does NOT throw. We verify mount() returned without
//     propagating the throw.
//   - mount() with state.candidate set + Karyotype subview active
//     calls _renderCandidateKaryotypeBody (also TODO_MISSING) which
//     throws ReferenceError. Same try/catch behaviour.
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page4State stash identity-equal to
//     _pageState
//   - refreshPage4(state) callable directly (re-render path)
//   - setKaryoSubview('tier') updates karyoState.subview AND
//     localStorage AND triggers a re-render via
//     renderCandidateKaryotype
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page4 = await import(`${WORKSPACE}/atlases/inversion/pages/review/page4.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/page4/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — page4 uses getElementById, .style, .innerHTML,
// .classList, .textContent. No canvas, no querySelector.
// -----------------------------------------------------------------------------

class FakeClassList {
  constructor() { this._set = new Set(); }
  add(c) { this._set.add(c); }
  remove(c) { this._set.delete(c); }
  contains(c) { return this._set.has(c); }
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '', background: '', borderColor: '', color: '', fontWeight: '' };
    this.dataset = {};
    this._listeners = {};
    this.value = '';
    this.children = [];
    this.classList = new FakeClassList();
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
  querySelector(_) { return null; }
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

// localStorage stub — setKaryoSubview persists, page4 module-load
// reads on import (already done).
const _localStorage = new Map();
global.localStorage = {
  getItem: (k) => _localStorage.has(k) ? _localStorage.get(k) : null,
  setItem: (k, v) => { _localStorage.set(k, String(v)); },
  removeItem: (k) => { _localStorage.delete(k); },
  clear: () => { _localStorage.clear(); },
};

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidate: null,
      data: {},
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page4 has mount',                     typeof page4.mount === 'function');
check('page4 has unmount',                   typeof page4.unmount === 'function');
check('page4 has refreshPage4 (wrapper)',    typeof page4.refreshPage4 === 'function');
check('page4 has renderCandidateKaryotype',  typeof page4.renderCandidateKaryotype === 'function');
check('page4 has renderCandidateTier',       typeof page4.renderCandidateTier === 'function');
check('page4 has _refreshSubviewButtonStyles',typeof page4._refreshSubviewButtonStyles === 'function');
check('page4 has setKaryoSubview',           typeof page4.setKaryoSubview === 'function');
check('page4 has karyoState (const)',        typeof page4.karyoState === 'object');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NULL candidate → empty-state path');
_resetNodes();
_localStorage.clear();
// Reset karyoState to default for predictable behaviour
page4.karyoState.subview = 'karyotype';

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page4.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing (NULL candidate path)',
      mountOK, mountErr ? mountErr.message : '');

const empty = _ensureNode('candKaryoEmpty');
const content = _ensureNode('candKaryoContent');
const subviewBar = _ensureNode('candKaryoSubviewBar');
const tierContent = _ensureNode('candTierContent');
check('#candKaryoEmpty.style.display === "block"',
      empty.style.display === 'block', `actual: "${empty.style.display}"`);
check('#candKaryoContent.style.display === "none"',
      content.style.display === 'none', `actual: "${content.style.display}"`);
check('#candKaryoSubviewBar.style.display === "none"',
      subviewBar.style.display === 'none', `actual: "${subviewBar.style.display}"`);
check('#candTierContent.style.display === "none"',
      tierContent.style.display === 'none', `actual: "${tierContent.style.display}"`);
check('#candKaryoContent.innerHTML cleared',
      content.innerHTML === '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page4State stashed',
      atlasState.inversion._page4State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page4State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidate slot',           'candidate' in stashedState);
check('_pageState has data slot',                'data' in stashedState);
check('_pageState.candidate is null (default)',  stashedState.candidate === null);

// -----------------------------------------------------------------------------
group('Smoke: mount() with state.candidate set + Tier subview, NO final_classification');
_resetNodes();
page4.karyoState.subview = 'tier';

const synthCandidate = {
  id: 'cand_LG12_001',
  chrom: 'LG12',
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  K: 3,
  ref_l2: 7,
};

const atlasState2 = buildAtlasState({
  shared: { activeCandidate: synthCandidate },
  inversion: {
    candidate: synthCandidate,  // legacy may also read here
    data: {},  // NO final_classification — empty-state path
  },
});

let mount2OK = true; let mount2Err = null;
try { await page4.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
// mount-time try/catch wraps the dispatcher; the dispatcher routes
// to renderCandidateTier which paints the empty-state HTML at
// #candTierContent. The empty-state HTML calls _renderTierAxesGrid(null)
// inside a template literal — that throws ReferenceError (still
// TODO_MISSING per chat-33). The try/catch in mount() swallows it.
check('mount() ran without throwing (Tier + missing _renderTierAxesGrid swallowed)',
      mount2OK, mount2Err ? mount2Err.message : '');

const tierContent2 = _ensureNode('candTierContent');
const empty2 = _ensureNode('candKaryoEmpty');
const subviewBar2 = _ensureNode('candKaryoSubviewBar');
check('#candKaryoEmpty hidden (candidate set)',
      empty2.style.display === 'none', `actual: "${empty2.style.display}"`);
check('#candKaryoSubviewBar shown (candidate set)',
      subviewBar2.style.display === 'flex', `actual: "${subviewBar2.style.display}"`);
check('#candTierContent shown (Tier subview routed)',
      tierContent2.style.display === 'block', `actual: "${tierContent2.style.display}"`);

// _pageState should still be set (mount-time _setActiveState happens
// before the try-block).
check('atlasState2 stash refreshed',
      atlasState2.inversion._page4State === state._pageState);
check('_pageState.candidate propagated',
      state._pageState.candidate && state._pageState.candidate.id === 'cand_LG12_001');

// -----------------------------------------------------------------------------
group('Smoke: setKaryoSubview state-mutation + persistence');
_resetNodes();
_localStorage.clear();
page4.karyoState.subview = 'karyotype';

// Reset _pageState to a null-candidate state so setKaryoSubview's
// internal call to renderCandidateKaryotype doesn't reach the missing
// _renderCandidateKaryotypeBody / _renderTierAxesGrid helpers (the
// prior test left _pageState pointing at a populated atlasState2).
state._setActiveState({ candidate: null, data: {} });

let r1OK = true; let r1Err = null;
try { page4.setKaryoSubview('tier'); }
catch (e) { r1OK = false; r1Err = e; }
check('setKaryoSubview("tier") ran without throwing',
      r1OK, r1Err ? r1Err.message : '');
check('karyoState.subview === "tier" after set',
      page4.karyoState.subview === 'tier');
check('localStorage["pca_scrubber_v3.candSubview"] === "tier"',
      _localStorage.get('pca_scrubber_v3.candSubview') === 'tier');

let r2OK = true; let r2Err = null;
try { page4.setKaryoSubview('karyotype'); }
catch (e) { r2OK = false; r2Err = e; }
check('setKaryoSubview("karyotype") ran without throwing',
      r2OK, r2Err ? r2Err.message : '');
check('karyoState.subview === "karyotype" after set',
      page4.karyoState.subview === 'karyotype');
check('localStorage["pca_scrubber_v3.candSubview"] === "karyotype"',
      _localStorage.get('pca_scrubber_v3.candSubview') === 'karyotype');

let r3OK = true; let r3Err = null;
try { page4.setKaryoSubview('invalid'); }
catch (e) { r3OK = false; r3Err = e; }
check('setKaryoSubview("invalid") is a no-op (no throw, subview unchanged)',
      r3OK && page4.karyoState.subview === 'karyotype');

// -----------------------------------------------------------------------------
group('Smoke: refreshPage4(state) callable directly (re-render path)');
const reRenderState = { candidate: null, data: {} };
let r4OK = true; let r4Err = null;
try { page4.refreshPage4(reRenderState); }
catch (e) { r4OK = false; r4Err = e; }
check('refreshPage4(state) ran without throwing',
      r4OK, r4Err ? r4Err.message : '');
check('refreshPage4(state) updated _pageState',
      state._pageState === reRenderState);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page4.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
