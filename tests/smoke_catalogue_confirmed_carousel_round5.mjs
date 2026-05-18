// tests/smoke_catalogue_page9_round5.mjs
//
// Round 5 step 7 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for confirmed_carousel (confirmed candidates carousel).
//
// Page9 is the confirmed-candidates carousel. Legacy shipped only the
// HTML shell (#confirmedNavBar, #confirmedNavPrev, #confirmedNavNext,
// #confirmedNavInfo, #confirmedCandidateMeta, #confirmedEmpty) with no JS.
// The cartridge ships the carousel implementation (confirmed_carousel/carousel.js).
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports + 2 public entries present
//   - mount() empty-state (no candidateList): #confirmedEmpty shown,
//     #confirmedNavBar + #confirmedCandidateMeta hidden
//   - mount() with confirmed candidates: #confirmedEmpty hidden,
//     #confirmedNavBar + #confirmedCandidateMeta visible + populated;
//     nav-info shows "1 / N" position
//   - _pageState live-binding observed across module boundaries
//   - refreshConfirmedCarousel(state) callable directly
//   - unmount() clears _pageState + tears down handlers

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const confirmed_carousel = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/confirmed_carousel.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/confirmed_carousel/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as stats_profile/18/21 smoke harnesses.
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
check('confirmed_carousel has mount',                       typeof confirmed_carousel.mount === 'function');
check('confirmed_carousel has unmount',                     typeof confirmed_carousel.unmount === 'function');
check('confirmed_carousel has refreshConfirmedCarousel',    typeof confirmed_carousel.refreshConfirmedCarousel === 'function');
check('confirmed_carousel has initConfirmedCarousel',       typeof confirmed_carousel.initConfirmedCarousel === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state (no candidateList)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await confirmed_carousel.mount(root, atlasState, registry); }
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
group('Smoke: mount() with confirmed candidates (carousel renders)');
// 2 confirmed + 1 unconfirmed candidate. Cartridge ships the carousel:
// expect empty-state hidden, nav-bar + meta visible + populated, info
// showing "1 / 2" (first of two confirmed).
const atlasState2 = buildAtlasState({
  inversion: {
    candidateList: [
      { id: 'A', confirmed: true,  chrom: 'LG28', start_bp: 1, end_bp: 2 },
      { id: 'B', confirmed: false },
      { id: 'C', confirmed: true,  chrom: 'LG14', start_bp: 5, end_bp: 6 },
    ],
  },
});

_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await confirmed_carousel.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const empty2  = _ensureNode('confirmedEmpty');
const navBar2 = _ensureNode('confirmedNavBar');
const meta2   = _ensureNode('confirmedCandidateMeta');
const info2   = _ensureNode('confirmedNavInfo');
check('confirmedEmpty hidden (carousel renders)',           empty2.style.display === 'none');
check('confirmedNavBar visible',                            navBar2.style.display !== 'none');
check('confirmedCandidateMeta visible',                     meta2.style.display !== 'none');
check('nav-info shows "1 / 2"',                             info2.textContent === '1 / 2');
check('meta innerHTML mentions first confirmed (A)',        meta2.innerHTML.includes('>A<'));
check('meta does not mention unconfirmed (B)',              !meta2.innerHTML.includes('>B<'));

// -----------------------------------------------------------------------------
group('Smoke: refreshConfirmedCarousel(state) called directly');
let renderOK = true; let renderErr = null;
try { confirmed_carousel.refreshConfirmedCarousel(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('refreshConfirmedCarousel(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await confirmed_carousel.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
