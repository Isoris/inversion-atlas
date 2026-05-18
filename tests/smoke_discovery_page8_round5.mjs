// tests/smoke_discovery_page8_round5.mjs
//
// Round 5 step 13 (chat 38, 2026-05-07): full mount / unmount lifecycle
// smoke test for page8 (per-window summary table — discovery stage).
//
// Page8 is a discovery-stage page that's a stub even in legacy: the HTML
// shell (#winSummaryToolbar, #winSumChips, #winSumStripCanvas, #winSumTable,
// #winSumZFilter, #winSumL2Filter, #winSumNoChrom, #winSumBisnpInfoBtn,
// #winSumBisnpInfoPanel, …) has no JS handlers in legacy/Inversion_atlas.html
// (confirmed by `grep winSum` returning HTML/CSS/comments only). Migration
// preserves the no-render stub behaviour: mount() only sets _pageState +
// stashes it on atlasState.inversion._page8State; the empty-state
// #winSumNoChrom message remains visible (HTML default). Full renderers
// (winSumTable, winSumStripCanvas, filters) deferred (TODO_MISSING).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports present
//   - mount() runs without throwing on minimal atlasState
//   - mount() runs without throwing on populated atlasState
//   - _pageState live-binding observed across module boundaries
//   - atlasState.inversion._page8State stash present + identity-equal
//     to _pageState (canonical state-shape proof)
//   - legacy state shape: activeChrom + precomp slots present
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page8 = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page8.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page8/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as confirmed_carousel/17/18/21 smoke harnesses.
// Page8's mount doesn't touch the DOM in this round (no render) but the
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
      activeChrom: null,
      precomp:     null,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page8 has mount',                       typeof page8.mount === 'function');
check('page8 has unmount',                     typeof page8.unmount === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() on minimal atlasState (no precomp loaded)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page8.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page8State stashed',
      atlasState.inversion._page8State !== undefined);
check('stashed state identity-equal to _pageState',
      atlasState.inversion._page8State === state._pageState);
const stashedState = state._pageState;
check('_pageState has activeChrom slot',                 'activeChrom' in stashedState);
check('_pageState has precomp slot',                     'precomp' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with populated state (active chromosome)');
_nodes.clear();

const atlasState2 = buildAtlasState({
  inversion: {
    activeChrom: 'LG28',
    precomp: {
      chrom: 'LG28',
      windows: [
        { start_bp: 0,       end_bp: 100_000, center_bp:  50_000, z: 1.0, lam1: 1.5, lam2: 0.5, n_snps: 80, l2_id: 'L2_a' },
        { start_bp: 100_000, end_bp: 200_000, center_bp: 150_000, z: 3.2, lam1: 3.0, lam2: 0.3, n_snps: 120, l2_id: 'L2_b' },
      ],
    },
  },
});

let mount2OK = true; let mount2Err = null;
try { await page8.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');
check('_pageState.activeChrom propagated',     state._pageState.activeChrom === 'LG28');
check('_pageState.precomp propagated',         state._pageState.precomp && state._pageState.precomp.chrom === 'LG28');
check('atlasState2 stash refreshed',           atlasState2.inversion._page8State === state._pageState);

const chips = _ensureNode('winSumChips');
const body  = _ensureNode('winSumTableBody');
check('winSumChips rendered (chrom)',          chips.innerHTML.includes('LG28'));
check('winSumChips counts "2 / 2"',            chips.innerHTML.includes('2 / 2'));
check('winSumTableBody has 2 rows',            (body.innerHTML.match(/<tr/g) || []).length === 2);
check('winSumNoChrom hidden after populated',  _ensureNode('winSumNoChrom').style.display === 'none');
check('winSumStrip visible after populated',   _ensureNode('winSumStrip').style.display === 'block');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page8.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
