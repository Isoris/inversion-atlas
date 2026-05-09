// tests/smoke_discovery_page19_round5.mjs
//
// Round 5 step 14 (chat 38, 2026-05-07): full mount / unmount lifecycle
// smoke test for page19 (negative-regions catalogue — discovery stage).
//
// Page19 is a discovery-stage page that's a stub even in legacy: the HTML
// shell (#nrLoadBtn, #nrLoadInput, #nrExportCsvBtn, #nrResetBtn,
// #nrSummaryCards, #nrTableSlot, #nrTableBadge) has no JS handlers in
// legacy/Inversion_atlas.html (confirmed by grep — note the HTML contains
// an inline comment referencing "_nrRender()" as the planned future
// renderer name, but no JS file implements it). Migration preserves the
// no-render stub behaviour: mount() only sets _pageState + stashes it on
// atlasState.inversion._page19State; the static caution banner + empty
// summary cards remain visible (HTML default). Full renderers (_nrRender,
// _nrLoadFile, _nrExportCsv, _nrReset) deferred (TODO_MISSING).
//
// Exact twin of smoke_discovery_page8_round5.mjs structure; differences:
//   - state slots: negativeRegions (array) + activeChrom (vs page8's
//     activeChrom + precomp).
//   - identity-equal stash check: atlasState.inversion._page19State.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports present
//   - mount() runs without throwing on minimal atlasState
//   - mount() runs without throwing on populated atlasState
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page19State stash present + identity-equal
//     to _pageState (canonical state-shape proof)
//   - legacy state shape: negativeRegions + activeChrom slots present
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page19 = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page19.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page19/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page8/9/17/18/21 smoke harnesses.
// Page19's mount doesn't touch the DOM in this round (no render) but the
// polyfill is here for future-proofing when renderers land.
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
    inversion: Object.assign({
      negativeRegions: [],
      activeChrom:     null,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page19 has mount',                       typeof page19.mount === 'function');
check('page19 has unmount',                     typeof page19.unmount === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() on minimal atlasState (no negative_regions loaded)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page19.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page19State stashed',
      atlasState.inversion._page19State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page19State === state._pageState);
const stashedState = state._pageState;
check('_pageState has negativeRegions slot',             'negativeRegions' in stashedState);
check('_pageState.negativeRegions is array',             Array.isArray(stashedState.negativeRegions));
check('_pageState has activeChrom slot',                 'activeChrom' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with populated state (loaded negative regions)');
// Two regions with different statuses — mirrors the per-region_status
// summary-card grouping the future renderer will implement.
const atlasState2 = buildAtlasState({
  inversion: {
    activeChrom: 'LG28',
    negativeRegions: [
      { chrom: 'LG28', start: 1_000_000, end: 2_000_000, region_status: 'no_detectable_inversion_high_confidence' },
      { chrom: 'LG28', start: 5_000_000, end: 6_500_000, region_status: 'no_detectable_inversion_low_confidence'  },
    ],
  },
});

let mount2OK = true; let mount2Err = null;
try { await page19.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');
check('_pageState.activeChrom propagated',     state._pageState.activeChrom === 'LG28');
check('_pageState.negativeRegions propagated', state._pageState.negativeRegions.length === 2);
check('atlasState2 stash refreshed',           atlasState2.inversion._page19State === state._pageState);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page19.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
