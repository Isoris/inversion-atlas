// tests/smoke_review_page7_round5.mjs
//
// Round 5 step 17 (chat 38, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for ancestry_per_window (ancestry view — review stage).
// **First migrated review-stage page** — review group: 0 of 5 → 1 of 5.
//
// Page7 is a thin loader stub for window.renderAncestryPage (an external
// renderer expected as a sibling of js/atlas_page6_wiring.js). The
// chat-33 showAncestryPage(state) tries window.renderAncestryPage; if
// absent, falls back to setting #ancNoChrom's display:block + innerHTML
// to a "renderer not loaded" message and clearing #ancStack.innerHTML.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle + wrapper + chat-33 exports all
//     present
//   - mount() with NO window.renderAncestryPage → fallback empty-state
//     visible (#ancNoChrom display='block', message text present;
//     #ancStack innerHTML cleared)
//   - mount() WITH a synthetic window.renderAncestryPage → renderer
//     called; fallback NOT triggered (#ancNoChrom not touched)
//   - _pageState live-binding observed across module boundaries
//   - atlasState.popstats._page_ancestry_per_windowState stash identity-equal to
//     _pageState
//   - refreshPage7(state) callable directly (re-render path)
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const ancestry_per_window = await import(`${WORKSPACE}/atlases/inversion/pages/review/ancestry_per_window.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/review/ancestry_per_window/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as window_summary_table/9/19 smokes plus
// #ancNoChrom + #ancStack accessibility.
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
  // 2026-05-26: ancestry_per_window is a popstats page now. Canonical
  // slots: chrom + candidate live under .shared; viewChips live under
  // .popstats. Keep .inversion for back-compat tests that still target it.
  return {
    inversion: Object.assign({}, opts.inversion || {}),
    popstats:  Object.assign({
      ancestryViewChips: new Set(),
    }, opts.popstats || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('ancestry_per_window has mount',                       typeof ancestry_per_window.mount === 'function');
check('ancestry_per_window has unmount',                     typeof ancestry_per_window.unmount === 'function');
check('ancestry_per_window has refreshPage7 (wrapper)',      typeof ancestry_per_window.refreshPage7 === 'function');
check('ancestry_per_window has showAncestryPage (chat-33)',  typeof ancestry_per_window.showAncestryPage === 'function');
check('ancestry_per_window has refreshAncestryPage (chat-33)',
      typeof ancestry_per_window.refreshAncestryPage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() with NO window.renderAncestryPage → fallback empty-state');
_resetNodes();
// Ensure window.renderAncestryPage is absent.
delete global.renderAncestryPage;

const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await ancestry_per_window.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing (fallback path)',
      mountOK, mountErr ? mountErr.message : '');

const ancNoChrom = _ensureNode('ancNoChrom');
const ancStack   = _ensureNode('ancStack');
check('#ancNoChrom shown (display=block)',
      ancNoChrom.style.display === 'block');
// 2026-05-26: fallback text rewritten to surface the known-TODO state
// (renderer lost in the inversion→popstats split) plus the data contract
// the page would consume. Audit-driven UX improvement.
check('#ancNoChrom text mentions "renderer pending"',
      ancNoChrom.innerHTML.includes('renderer pending'));
check('#ancNoChrom text mentions the data contract',
      ancNoChrom.innerHTML.includes('state.data.ancestry'));
check('#ancStack innerHTML cleared',
      ancStack.innerHTML === '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
// 2026-05-26: stash moved to atlasState.popstats._page_ancestry_per_windowState
// (popstats is its own atlas now, not a sub-section of inversion).
check('atlasState.popstats._page_ancestry_per_windowState stashed',
      atlasState.popstats && atlasState.popstats._page_ancestry_per_windowState !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.popstats._page_ancestry_per_windowState === state._pageState);
const stashedState = state._pageState;
check('_pageState has data slot',                'data' in stashedState);
check('_pageState.ancestryViewChips is Set',     stashedState.ancestryViewChips instanceof Set);
check('_pageState has candidate slot',           'candidate' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() WITH window.renderAncestryPage → renderer called, no fallback');
_resetNodes();
let rendererCalls = 0;
global.renderAncestryPage = function () { rendererCalls++; };

// 2026-05-26: canonical sources after the popstats namespace migration —
// candidate from shared.activeCandidate; data via registry.resolve('scrubber_main').
const atlasState2 = buildAtlasState({
  shared: {
    activeChrom: 'LG01',
    activeCandidate: { id: 'C001', confirmed: true },
  },
});
const registry2 = {
  resolve: async (name, args) =>
    name === 'scrubber_main' && args && args.chrom === 'LG01'
      ? { ancestry: { _stub: true } }
      : null,
};

let mount2OK = true; let mount2Err = null;
try { await ancestry_per_window.mount(root, atlasState2, registry2); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing',
      mount2OK, mount2Err ? mount2Err.message : '');
check('window.renderAncestryPage called once by mount',
      rendererCalls === 1, `actual: ${rendererCalls}`);

const ancNoChrom2 = _ensureNode('ancNoChrom');
check('#ancNoChrom NOT touched when renderer present (display unset)',
      ancNoChrom2.style.display === '');
check('atlasState2 stash refreshed',
      atlasState2.popstats && atlasState2.popstats._page_ancestry_per_windowState === state._pageState);
check('_pageState.candidate propagated',
      state._pageState.candidate && state._pageState.candidate.id === 'C001');

// -----------------------------------------------------------------------------
group('Smoke: refreshPage7(state) called directly (re-render path)');
const reRenderState = { data: { ancestry: { _stub: true } }, ancestryViewChips: new Set(['label']), candidate: null };
let renderOK = true; let renderErr = null;
try { ancestry_per_window.refreshPage7(reRenderState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshPage7(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');
check('window.renderAncestryPage called again',
      rendererCalls === 2, `actual: ${rendererCalls}`);
check('refreshPage7(state) updated _pageState',
      state._pageState === reRenderState);

// Cleanup synthetic renderer.
delete global.renderAncestryPage;

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await ancestry_per_window.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
