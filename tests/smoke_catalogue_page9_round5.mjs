// tests/smoke_catalogue_page9_round5.mjs
//
// Round 5 step 7 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page9 (confirmed candidates carousel).
//
// Page9 is a catalogue-stage page that's a stub even in legacy: the HTML
// shell (#confirmedNavBar, #confirmedNavPrev, #confirmedNavNext,
// #confirmedNavInfo, #confirmedCandidateMeta, #confirmedEmpty) has no JS
// handlers in legacy/Inversion_atlas.html. Migration preserves the
// behaviour: empty-state placeholder shown when no confirmed candidates;
// "carousel not yet wired" message when there are confirmed candidates.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports + 2 public entries present
//   - mount() empty-state (no candidateList): #confirmedEmpty shown,
//     #confirmedNavBar + #confirmedCandidateMeta hidden
//   - mount() empty-state (candidateList=[]): same behaviour
//   - mount() with confirmed candidates: empty-state still shown but
//     repopulated with "N confirmed candidates" + "Carousel rendering
//     is not yet wired" placeholder text (verbatim legacy stub behaviour)
//   - _pageState live-binding observed across module boundaries
//   - refreshConfirmedCarousel(state) callable directly
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page9 = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page9.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page9/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page17/18/21 smoke harnesses.
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
      candidateList: [],
      confirmedCarouselIndex: 0,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page9 has mount',                       typeof page9.mount === 'function');
check('page9 has unmount',                     typeof page9.unmount === 'function');
check('page9 has refreshConfirmedCarousel',    typeof page9.refreshConfirmedCarousel === 'function');
check('page9 has initConfirmedCarousel',       typeof page9.initConfirmedCarousel === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state (no candidateList)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page9.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const navBar = _ensureNode('confirmedNavBar');
const meta   = _ensureNode('confirmedCandidateMeta');
const empty  = _ensureNode('confirmedEmpty');
check('confirmedEmpty placeholder shown',                empty.style.display  === 'block');
check('confirmedNavBar hidden',                          navBar.style.display === 'none');
check('confirmedCandidateMeta hidden',                   meta.style.display   === 'none');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page9State stashed',
      atlasState.inversion._page9State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidateList',                    Array.isArray(stashedState.candidateList));
check('_pageState has confirmedCarouselIndex',           'confirmedCarouselIndex' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() with confirmed candidates (verbatim legacy stub)');
// 2 confirmed + 1 unconfirmed candidate. Legacy stub still shows the empty
// element but populates it with "N confirmed candidates" + "Carousel
// rendering is not yet wired" message.
const atlasState2 = buildAtlasState({
  inversion: {
    candidateList: [
      { id: 'A', confirmed: true },
      { id: 'B', confirmed: false },
      { id: 'C', confirmed: true },
    ],
  },
});

_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await page9.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const empty2  = _ensureNode('confirmedEmpty');
const navBar2 = _ensureNode('confirmedNavBar');
const meta2   = _ensureNode('confirmedCandidateMeta');
check('confirmedEmpty still visible (carousel not wired)',  empty2.style.display === 'block');
check('confirmedEmpty innerHTML mentions count "2"',        empty2.innerHTML.includes('2'));
check('confirmedEmpty innerHTML mentions "confirmed candidate"',
      empty2.innerHTML.includes('confirmed candidate'));
check('confirmedEmpty innerHTML notes carousel not wired',
      empty2.innerHTML.toLowerCase().includes('not yet wired'));
check('confirmedNavBar still hidden (carousel not wired)',  navBar2.style.display === 'none');
check('confirmedCandidateMeta still hidden',                meta2.style.display   === 'none');

// -----------------------------------------------------------------------------
group('Smoke: refreshConfirmedCarousel(state) called directly');
let renderOK = true; let renderErr = null;
try { page9.refreshConfirmedCarousel(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshConfirmedCarousel(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page9.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
