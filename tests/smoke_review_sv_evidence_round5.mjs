// tests/smoke_review_page_sv_evidence_round5.mjs
//
// Round 5 step 19 (chat 39, 2026-05-07): full mount / render /
// unmount lifecycle smoke test for sv_evidence (SV evidence
// candidate-level view — review stage). **Direct twin of
// page6's + page7's smokes** (shipped steps 18 + 17); third (and
// final) migrated review tier-1 thin-loader-stub page (review
// group: 2 of 5 → 3 of 5).
//
// sv_evidence is a thin loader stub for window.AtlasSVEvidence
// (defined in the external js/atlas_sv_evidence.js bundle). Unlike
// page6 + page7 (whose external renderer is a single function), the
// sv_evidence external renderer is an OBJECT with three
// methods: .init, .loadCandidate, .destroy. The chat-33
// showSvEvidencePage(state) tries window.AtlasSVEvidence; if absent,
// falls back to setting #sv_evidence_root.innerHTML to a
// "module not loaded" message guarded by .__svInitFailed (so
// repeated calls don't re-paint). On the present path, init() is
// called once (guarded by mod.__pageInitDone) and loadCandidate(cid)
// is called whenever the candidate id changes (guarded by
// mod.__lastCid). hideSvEvidencePage() calls mod.destroy() if
// available.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle + wrapper + chat-33 exports all
//     present
//   - mount() with NO window.AtlasSVEvidence → fallback empty-state
//     visible (#sv_evidence_root.innerHTML mentions
//     'SV evidence module not loaded' + 'AtlasSVEvidence';
//     __svInitFailed guard set)
//   - mount() WITH a synthetic window.AtlasSVEvidence → init() called
//     once with rootSelector arg; loadCandidate(cid) called once;
//     mod.__pageInitDone + mod.__lastCid set; fallback NOT triggered
//   - re-mount with same candidate → init() NOT called again;
//     loadCandidate NOT called again (cid identity-equal guard)
//   - re-mount with different candidate → loadCandidate called again
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._pageSvEvidenceState stash identity-equal
//     to _pageState
//   - refreshPageSvEvidence(state) callable directly (re-render path)
//   - unmount() calls mod.destroy() (when present) and clears
//     _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const svEv  = await import(`${WORKSPACE}/atlases/inversion/pages/review/sv_evidence.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/sv_evidence/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page6/page7 smoke; the only DOM
// element sv_evidence touches is #sv_evidence_root (innerHTML +
// __svInitFailed guard).
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
check('sv_evidence has mount',
      typeof svEv.mount === 'function');
check('sv_evidence has unmount',
      typeof svEv.unmount === 'function');
check('sv_evidence has refreshPageSvEvidence (wrapper)',
      typeof svEv.refreshPageSvEvidence === 'function');
check('sv_evidence has showSvEvidencePage (chat-33)',
      typeof svEv.showSvEvidencePage === 'function');
check('sv_evidence has hideSvEvidencePage (chat-33)',
      typeof svEv.hideSvEvidencePage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NO window.AtlasSVEvidence → fallback empty-state');
_resetNodes();
// Ensure window.AtlasSVEvidence is absent.
delete global.AtlasSVEvidence;

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await svEv.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing (fallback path)',
      mountOK, mountErr ? mountErr.message : '');

const svRoot = _ensureNode('sv_evidence_root');
check('#sv_evidence_root text mentions "SV evidence module not loaded"',
      svRoot.innerHTML.includes('SV evidence module not loaded'));
check('#sv_evidence_root text mentions AtlasSVEvidence',
      svRoot.innerHTML.includes('AtlasSVEvidence'));
check('#sv_evidence_root text mentions atlas_sv_evidence.js',
      svRoot.innerHTML.includes('atlas_sv_evidence.js'));
check('#sv_evidence_root.__svInitFailed guard set',
      svRoot.__svInitFailed === true);

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._pageSvEvidenceState stashed',
      atlasState.inversion._pageSvEvidenceState !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._pageSvEvidenceState === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidate slot',
      'candidate' in stashedState);
check('_pageState.candidate defaults to null',
      stashedState.candidate === null);

// -----------------------------------------------------------------------------
group('Smoke: mount() WITH window.AtlasSVEvidence → init + loadCandidate called, no fallback');
_resetNodes();
let initCalls = 0;
let initArgs = null;
let loadCalls = 0;
let loadArgs = [];
let destroyCalls = 0;
global.AtlasSVEvidence = {
  init: function (cfg) { initCalls++; initArgs = cfg; },
  loadCandidate: function (cid) { loadCalls++; loadArgs.push(cid); },
  destroy: function () { destroyCalls++; },
};

const atlasState2 = buildAtlasState({
  inversion: {
    candidate: { id: 'C001', confirmed: true },
  },
});

let mount2OK = true; let mount2Err = null;
try { await svEv.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing',
      mount2OK, mount2Err ? mount2Err.message : '');
check('AtlasSVEvidence.init called once by mount',
      initCalls === 1, `actual: ${initCalls}`);
check('AtlasSVEvidence.init received { rootSelector: "#sv_evidence_root" }',
      initArgs && initArgs.rootSelector === '#sv_evidence_root');
check('mod.__pageInitDone guard set',
      global.AtlasSVEvidence.__pageInitDone === true);
check('AtlasSVEvidence.loadCandidate called once with "C001"',
      loadCalls === 1 && loadArgs[loadArgs.length - 1] === 'C001',
      `calls=${loadCalls} args=${JSON.stringify(loadArgs)}`);
check('mod.__lastCid guard set to "C001"',
      global.AtlasSVEvidence.__lastCid === 'C001');

const svRoot2 = _ensureNode('sv_evidence_root');
check('#sv_evidence_root NOT painted with fallback when renderer present',
      !svRoot2.innerHTML.includes('SV evidence module not loaded'));
check('atlasState2 stash refreshed',
      atlasState2.inversion._pageSvEvidenceState === state._pageState);
check('_pageState.candidate propagated',
      state._pageState.candidate && state._pageState.candidate.id === 'C001');

// -----------------------------------------------------------------------------
group('Smoke: refreshPageSvEvidence with SAME candidate → init/loadCandidate guards hold');
const sameCidState = { candidate: { id: 'C001', confirmed: true } };
let refreshSameOK = true; let refreshSameErr = null;
try { svEv.refreshPageSvEvidence(sameCidState); }
catch (e) { refreshSameOK = false; refreshSameErr = e; }
check('refreshPageSvEvidence(state) ran without throwing',
      refreshSameOK, refreshSameErr ? refreshSameErr.message : '');
check('init NOT called again (mod.__pageInitDone guards it)',
      initCalls === 1, `actual: ${initCalls}`);
check('loadCandidate NOT called again (mod.__lastCid guards it)',
      loadCalls === 1, `actual: ${loadCalls}`);

// -----------------------------------------------------------------------------
group('Smoke: refreshPageSvEvidence with DIFFERENT candidate → loadCandidate fires again');
const diffCidState = { candidate: { id: 'C002', confirmed: true } };
let refreshDiffOK = true; let refreshDiffErr = null;
try { svEv.refreshPageSvEvidence(diffCidState); }
catch (e) { refreshDiffOK = false; refreshDiffErr = e; }
check('refreshPageSvEvidence(state) with new cid ran without throwing',
      refreshDiffOK, refreshDiffErr ? refreshDiffErr.message : '');
check('loadCandidate fired for "C002"',
      loadCalls === 2 && loadArgs[loadArgs.length - 1] === 'C002',
      `calls=${loadCalls} args=${JSON.stringify(loadArgs)}`);
check('mod.__lastCid updated to "C002"',
      global.AtlasSVEvidence.__lastCid === 'C002');

// -----------------------------------------------------------------------------
group('Smoke: unmount() with synthetic AtlasSVEvidence → destroy called, _pageState cleared');
let unmountOK = true; let unmountErr = null;
try { await svEv.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('AtlasSVEvidence.destroy called once by unmount',
      destroyCalls === 1, `actual: ${destroyCalls}`);
check('_pageState cleared by unmount', state._pageState === null);

// Cleanup synthetic renderer.
delete global.AtlasSVEvidence;

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
