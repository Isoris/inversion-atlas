// tests/smoke_review_page11_round5.mjs
//
// Round 5 step 22 (chat 39 cont., 2026-05-07): full mount / render /
// unmount lifecycle smoke test for page11 (boundaries refinement
// page). **THE FINAL MIGRATION** (review group: 4 of 5 → 5 of 5;
// MIGRATION COMPLETE 21/21). Pattern 2 (single-file with _state.js)
// applied; closest peers are page4 (step 21, the direct template),
// page12 (step 10), stats_profile (step 5).
//
// page11 has 4 chat-33 functions, all preserved verbatim. Unlike
// page4 (which got manual AST shims into 2 of 4 helpers), page11
// got ZERO shims — none of its 4 chat-33 functions read bare
// `state.X`. They operate exclusively on DOM and on the closure-
// scoped `bs` object returned by `_ensureBoundariesState()` (still
// TODO_MISSING).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports present
//   - mount() with NULL candidate runs without throwing — even
//     before reaching state.candidate, renderBoundariesPage's first
//     non-DOM-guard call is `_ensureBoundariesState()` which is
//     TODO_MISSING and throws ReferenceError. The mount-time
//     try/catch swallows that throw; mount() itself does NOT throw.
//   - mount() with state.candidate set + state.candidateList
//     populated has the same try/catch behaviour (the throw still
//     happens at `_ensureBoundariesState`, before any state read)
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page11State stash identity-equal to
//     _pageState (matches page4's stash pattern)
//   - refreshPage11(state) callable directly (re-render path)
//   - mount() also installs the keydown hotkey listener via
//     _bndAttachHotkeys; unmount() removes it via _bndDetachHotkeys
//   - unmount() clears _pageState
//   - _bndKeyHandler short-circuits when page11 element absent
//
// Cross-page guard-resolution audit performed step 22: NONE of
// page11's 31 TODO_MISSING markers are already exported in the
// migrated tree. Confirms these are genuinely page11-private
// helpers awaiting a Batch-2 extraction round.

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page11 = await import(`${WORKSPACE}/atlases/inversion/pages/review/page11.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/page11/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — page11 uses getElementById, .style, .innerHTML,
// .classList, addEventListener, querySelectorAll, querySelector,
// insertBefore, appendChild, removeChild. No canvas.
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
    this.style = { display: '', background: '', borderColor: '', color: '', fontWeight: '', margin: '' };
    this.dataset = {};
    this._listeners = {};
    this.value = '';
    this.children = [];
    this.classList = new FakeClassList();
    this.nextSibling = null;
    this.tagName = 'DIV';
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  appendChild(c) { this.children.push(c); return c; }
  insertBefore(c, _ref) { this.children.push(c); return c; }
  removeChild(c) {
    const idx = this.children.indexOf(c);
    if (idx >= 0) this.children.splice(idx, 1);
    return c;
  }
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

// document-level listener tracking (for hotkey attach/detach assertions)
const _docListeners = new Map();

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
  addEventListener: (evt, cb) => {
    const list = _docListeners.get(evt) || [];
    list.push(cb);
    _docListeners.set(evt, list);
  },
  removeEventListener: (evt, cb) => {
    const list = _docListeners.get(evt) || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
    _docListeners.set(evt, list);
  },
  activeElement: null,
};

global.window = global;

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidate: null,
      candidateList: [],
      data: {},
      repeatDensity: {},
      ncRNADensity: {},
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
      candidateList: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page11 has mount',                    typeof page11.mount === 'function');
check('page11 has unmount',                  typeof page11.unmount === 'function');
check('page11 has refreshPage11 (wrapper)',  typeof page11.refreshPage11 === 'function');
check('page11 has renderBoundariesPage',     typeof page11.renderBoundariesPage === 'function');
check('page11 has _bndKeyHandler',           typeof page11._bndKeyHandler === 'function');
check('page11 has _bndAttachHotkeys',        typeof page11._bndAttachHotkeys === 'function');
check('page11 has _bndDetachHotkeys',        typeof page11._bndDetachHotkeys === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NULL candidate → mount-time throw swallowed');
_resetNodes();
_docListeners.clear();
// Pre-cleanup: ensure detached so the attach during mount registers
// fresh.
try { page11._bndDetachHotkeys(); } catch (_) {}

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page11.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
// renderBoundariesPage's slot guard returns null → returns null
// (FakeNode for `page11Content` exists, BUT the next call is
// _ensureBoundariesState() which is TODO_MISSING → ReferenceError →
// caught by mount's try/catch). mount() itself must NOT throw.
check('mount() ran without throwing (TODO_MISSING swallowed)',
      mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding + state stash');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page11State stashed',
      atlasState.inversion._page11State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page11State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidate slot',           'candidate' in stashedState);
check('_pageState has candidateList slot',       'candidateList' in stashedState);
check('_pageState has data slot',                'data' in stashedState);
check('_pageState has repeatDensity slot',       'repeatDensity' in stashedState);
check('_pageState has ncRNADensity slot',        'ncRNADensity' in stashedState);
check('_pageState.candidate is null (default)',  stashedState.candidate === null);
check('_pageState.candidateList is empty array', Array.isArray(stashedState.candidateList) && stashedState.candidateList.length === 0);

// -----------------------------------------------------------------------------
group('Smoke: hotkey listener installed by mount()');
const keydownAfterMount = _docListeners.get('keydown') || [];
check('exactly 1 keydown listener installed by mount',
      keydownAfterMount.length === 1, `actual: ${keydownAfterMount.length}`);

// -----------------------------------------------------------------------------
group('Smoke: _bndKeyHandler short-circuits when page11 element absent');
// FakeNode for 'page11' exists but classList does not contain 'active'
// → handler early-returns at the active-class guard.
let kh1OK = true; let kh1Err = null;
try { page11._bndKeyHandler({ key: 'a' }); }
catch (e) { kh1OK = false; kh1Err = e; }
check('_bndKeyHandler({key:"a"}) no-throw (page11 not active)',
      kh1OK, kh1Err ? kh1Err.message : '');

// Make page11 active and verify the handler still doesn't throw
// (the modifier-key check + INPUT/TEXTAREA/SELECT check passes;
// the handler then dispatches to _bndOverrideLeft etc. which are
// TODO_MISSING — but ONLY if the key matches a hotkey. Use a key
// that matches NO branch to avoid the ReferenceError throw path.)
const page11Node = _ensureNode('page11');
page11Node.classList.add('active');
let kh2OK = true; let kh2Err = null;
try { page11._bndKeyHandler({ key: 'z' /* unmatched */ }); }
catch (e) { kh2OK = false; kh2Err = e; }
check('_bndKeyHandler({key:"z"}) no-throw (active, no hotkey match)',
      kh2OK, kh2Err ? kh2Err.message : '');

// Modifier-key short-circuit
let kh3OK = true; let kh3Err = null;
try { page11._bndKeyHandler({ key: 'a', ctrlKey: true, preventDefault: () => {} }); }
catch (e) { kh3OK = false; kh3Err = e; }
check('_bndKeyHandler short-circuits on ctrlKey',
      kh3OK, kh3Err ? kh3Err.message : '');

// -----------------------------------------------------------------------------
group('Smoke: mount() with state.candidate set + populated candidateList');
// Clean unmount between mount groups — this matches the production
// navigation flow (unmount → mount) and keeps the module's internal
// `_bndKeyHandlerAttached` flag in sync with `document`. Clearing
// `_docListeners` directly would desync them and the next mount's
// idempotency guard would no-op the attach.
await page11.unmount(root);
_resetNodes();

const synthCandidate = {
  id: 'cand_LG28_001',
  chrom: 'LG28',
  start_bp: 15_115_000,
  end_bp: 18_005_000,
  K: 3,
  ref_l2: 12,
};
const synthCandidateList = [synthCandidate];

const atlasState2 = buildAtlasState({
  shared: {
    activeCandidate: synthCandidate,
    candidateList: synthCandidateList,
  },
  inversion: {
    candidate: synthCandidate,
    candidateList: synthCandidateList,
    data: {},
  },
});

let mount2OK = true; let mount2Err = null;
try { await page11.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
// Same outcome: renderBoundariesPage hits TODO_MISSING
// _ensureBoundariesState → ReferenceError → swallowed by try/catch.
check('mount() ran without throwing (populated candidate path, TODO_MISSING swallowed)',
      mount2OK, mount2Err ? mount2Err.message : '');

check('atlasState2 stash refreshed',
      atlasState2.inversion._page11State === state._pageState);
check('_pageState.candidate propagated',
      state._pageState.candidate && state._pageState.candidate.id === 'cand_LG28_001');
check('_pageState.candidateList propagated (length 1)',
      Array.isArray(state._pageState.candidateList) && state._pageState.candidateList.length === 1);
check('_pageState.candidate.chrom === "LG28"',
      state._pageState.candidate.chrom === 'LG28');

// -----------------------------------------------------------------------------
group('Smoke: refreshPage11(state) callable directly (re-render path)');
const reRenderState = {
  candidate: null,
  candidateList: [],
  data: {},
  repeatDensity: {},
  ncRNADensity: {},
};
let r1OK = true; let r1Err = null;
try { page11.refreshPage11(reRenderState); }
catch (e) { r1OK = false; r1Err = e; }
// renderBoundariesPage: slot exists (FakeNode autoreturned), then
// _ensureBoundariesState throws → BUT refreshPage11 does NOT have a
// try/catch (only mount does). So this CAN throw. Either outcome is
// acceptable — what we check is _pageState was set BEFORE the throw.
// The wrapper assigns _pageState first, then calls
// renderBoundariesPage. The throw will propagate, but state was
// already mutated.
const r1ThrewWithRefSet = !r1OK && state._pageState === reRenderState;
const r1NoThrewWithRefSet = r1OK && state._pageState === reRenderState;
check('refreshPage11(state) updated _pageState (with or without throw)',
      r1ThrewWithRefSet || r1NoThrewWithRefSet,
      `r1OK=${r1OK} _pageState===reRenderState=${state._pageState === reRenderState}`);

// -----------------------------------------------------------------------------
group('Smoke: unmount() detaches hotkeys + clears _pageState');
const keydownBefore = _docListeners.get('keydown') || [];
const hadHotkey = keydownBefore.length === 1;
check('hotkey listener present before unmount',
      hadHotkey, `actual: ${keydownBefore.length}`);

let unmountOK = true; let unmountErr = null;
try { await page11.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);
check('keydown listener removed by unmount',
      (_docListeners.get('keydown') || []).length === 0);

// Idempotent unmount: second call should also no-throw and stay clean.
let unmount2OK = true; let unmount2Err = null;
try { await page11.unmount(root); }
catch (e) { unmount2OK = false; unmount2Err = e; }
check('unmount() idempotent (second call no-throw)',
      unmount2OK, unmount2Err ? unmount2Err.message : '');
check('_pageState still null after second unmount', state._pageState === null);

// -----------------------------------------------------------------------------
group('Smoke: mount → unmount round-trip cleanliness');
// Fresh mount after unmount should re-install hotkey + re-set state,
// matching a real navigate-away-and-back.
_resetNodes();
const atlasState3 = buildAtlasState({});

let mount3OK = true; let mount3Err = null;
try { await page11.mount(root, atlasState3, registry); }
catch (e) { mount3OK = false; mount3Err = e; }
check('mount() after unmount no-throw', mount3OK, mount3Err ? mount3Err.message : '');
check('_pageState set after re-mount',
      state._pageState && typeof state._pageState === 'object');
check('hotkey re-attached after re-mount',
      (_docListeners.get('keydown') || []).length === 1);

let unmount3OK = true;
try { await page11.unmount(root); }
catch (e) { unmount3OK = false; }
check('final unmount no-throw', unmount3OK);
check('_pageState cleared by final unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
