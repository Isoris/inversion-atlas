// tests/test_page9_carousel.js
//
// Unit tests for pages/catalogue/confirmed_carousel/carousel.js — the
// confirmed-candidates carousel logic that legacy never implemented.
//
// Pure-function tests run headlessly; DOM-renderer tests use a
// minimal mock document on globalThis.

// --- mock DOM -----------------------------------------------------------
// Set up BEFORE importing the carousel module (the module captures
// `document` at call time, not import time, so this can also be done
// at test runtime — but we install once globally for simplicity).
function makeMockEl() {
  const el = {
    style: {},
    innerHTML: '',
    textContent: '',
    _listeners: new Map(),
    classList: {
      _set: new Set(),
      contains(c) { return this._set.has(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
    },
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = this._listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    _fire(type, evt) {
      const arr = this._listeners.get(type);
      if (!arr) return;
      for (const fn of arr.slice()) fn(evt);
    },
  };
  return el;
}

function makeMockDoc() {
  const els = {
    confirmedNavBar:          makeMockEl(),
    confirmedNavPrev:         makeMockEl(),
    confirmedNavNext:         makeMockEl(),
    confirmedNavInfo:         makeMockEl(),
    confirmedCandidateMeta:   makeMockEl(),
    confirmedEmpty:           makeMockEl(),
    confirmed_carousel:                    makeMockEl(),
  };
  const docListeners = new Map();
  return {
    _els: els,
    getElementById(id) { return els[id] || null; },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = docListeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    _fireKey(key) {
      const arr = docListeners.get('keydown');
      if (!arr) return false;
      for (const fn of arr.slice()) fn({ key, preventDefault() {} });
      return true;
    },
  };
}

globalThis.document = makeMockDoc();

// --- import after document is set --------------------------------------
const {
  filterConfirmed,
  resolveCarouselIndex,
  navigateCarousel,
  renderConfirmedMeta,
  renderConfirmedCarousel,
  wireConfirmedCarouselNav,
  teardownConfirmedCarouselNav,
} = await import('../atlases/inversion/pages/catalogue/confirmed_carousel/carousel.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Fixture: 3 confirmed + 2 unconfirmed candidates
// =====================================================================
function makeFixture() {
  return {
    candidateList: [
      { id: 'A', confirmed: true,  chrom: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000, K: 3, locked_labels: Int8Array.from([0, 0, 1, 1, 2]) },
      { id: 'B', confirmed: false, chrom: 'LG28', start_bp: 5_000_000, end_bp: 6_000_000, K: 3 },
      { id: 'C', confirmed: true,  chrom: 'LG14', start_bp: 10_000_000, end_bp: 12_000_000, K: 2, locked_labels: Int8Array.from([0, 0, 0, 1, 1]),
                  manuscript_note: 'big inversion' },
      { id: 'D', confirmed: false, chrom: 'LG28', start_bp: 15_000_000, end_bp: 16_000_000 },
      { id: 'E', confirmed: true,  chrom: 'LG07', start_bp: 50_000_000, end_bp: 51_500_000, K: 3, haplotype_vocab: 'standard' },
    ],
    confirmedCarouselIndex: 0,
  };
}

// =====================================================================
group('filterConfirmed');
check('null state → []',                      filterConfirmed(null).length === 0);
check('missing candidateList → []',           filterConfirmed({}).length === 0);
{
  const state = makeFixture();
  const r = filterConfirmed(state);
  check('3 confirmed of 5',                    r.length === 3);
  check('order preserved (A, C, E)',
        r[0].id === 'A' && r[1].id === 'C' && r[2].id === 'E');
}
check('null entries dropped',
      filterConfirmed({ candidateList: [null, { confirmed: true, id: 'X' }] }).length === 1);
check('confirmed must be strictly true',
      filterConfirmed({ candidateList: [{ confirmed: 'yes', id: 'X' },
                                        { confirmed: 1, id: 'Y' }] }).length === 0);

// =====================================================================
group('resolveCarouselIndex');
check('empty list → -1',                      resolveCarouselIndex({ candidateList: [] }) === -1);
{
  const state = makeFixture();
  check('default index 0',                    resolveCarouselIndex(state) === 0);
  state.confirmedCarouselIndex = 2;
  check('index 2 (last) preserved',           resolveCarouselIndex(state) === 2);
  state.confirmedCarouselIndex = 99;
  check('over-range clamped to last',         resolveCarouselIndex(state) === 2);
  state.confirmedCarouselIndex = -5;
  check('negative clamped to 0',              resolveCarouselIndex(state) === 0);
  state.confirmedCarouselIndex = null;
  check('null index → 0',                     resolveCarouselIndex(state) === 0);
  state.confirmedCarouselIndex = 1.5;
  check('non-integer index → 0',              resolveCarouselIndex(state) === 0);
}

// =====================================================================
group('navigateCarousel');
{
  const state = makeFixture();
  check('+1 from 0 → 1',                      navigateCarousel(state, +1) === 1);
  check('state mutated to 1',                 state.confirmedCarouselIndex === 1);
  check('+1 from 1 → 2',                      navigateCarousel(state, +1) === 2);
  check('+1 from 2 → 0 (wrap)',               navigateCarousel(state, +1) === 0);
  check('-1 from 0 → 2 (wrap)',               navigateCarousel(state, -1) === 2);
  check('-1 from 2 → 1',                      navigateCarousel(state, -1) === 1);
  // Large delta wraps modularly
  check('+7 from 1 → (1+7) % 3 = 2',          navigateCarousel(state, +7) === 2);
  check('-10 from 2 → (2-10) % 3 mod = 1',    navigateCarousel(state, -10) === 1);
  // delta 0 leaves position
  check('0 delta unchanged',                  navigateCarousel(state, 0) === 1);
  // non-finite delta defaults to 0
  check('NaN delta → no move',                navigateCarousel(state, NaN) === 1);
}
check('null state → -1',                      navigateCarousel(null, 1) === -1);
{
  const state = { candidateList: [] };
  check('empty list → -1 + no mutation',
        navigateCarousel(state, 1) === -1
        && state.confirmedCarouselIndex === undefined);
}

// =====================================================================
group('renderConfirmedMeta');
{
  const cand = {
    id: 'INV_LG28_001',
    chrom: 'LG28',
    start_bp: 15_115_000,
    end_bp:   18_005_000,
    K: 3,
    locked_labels: Int8Array.from([0, 0, 0, 0, 0, 1, 1, 1, 2, 2]),
    manuscript_note: 'Confirmed pericentric inversion',
  };
  const html = renderConfirmedMeta(cand);
  check('returns string',                       typeof html === 'string' && html.length > 0);
  check('contains id',                          html.includes('INV_LG28_001'));
  check('contains chrom',                       html.includes('LG28'));
  check('contains bp range (Mb format)',        html.includes('15.12 Mb') || html.includes('15.11 Mb'));
  check('contains K=3',                         html.includes('K=3'));
  check('contains band counts (band 0: 5)',     html.includes('band 0:') && html.includes('<b>5</b>'));
  check('contains note',                        html.includes('Confirmed pericentric inversion'));
}
{
  // No locked_labels → no band counts section
  const cand = { id: 'X', chrom: 'LG28', start_bp: 1, end_bp: 2 };
  const html = renderConfirmedMeta(cand);
  check('no labels: still renders',             html.includes('X'));
  check('no labels: no "band membership"',      !html.includes('Band membership'));
}
{
  // haplotype_vocab rendered
  const cand = { id: 'X', haplotype_vocab: 'multi3', K: 6, locked_labels: Int8Array.from([0]) };
  const html = renderConfirmedMeta(cand);
  check('haplotype_vocab rendered',             html.includes('multi3'));
}
{
  // HTML-escape user-provided strings
  const cand = { id: 'X<script>alert(1)</script>', chrom: '<b>oops</b>',
                 manuscript_note: '"injection" attempt & test' };
  const html = renderConfirmedMeta(cand);
  check('id escaped',                           html.includes('&lt;script&gt;'));
  check('chrom escaped',                        html.includes('&lt;b&gt;'));
  check('note escaped',                         html.includes('&quot;injection&quot;')
                                                 && html.includes('&amp; test'));
}
check('null candidate → empty string',         renderConfirmedMeta(null) === '');
check('candidate without id → empty string',   renderConfirmedMeta({}) === '');

// =====================================================================
group('renderConfirmedCarousel (DOM)');
{
  // Empty state
  const state = { candidateList: [] };
  renderConfirmedCarousel(state);
  const doc = globalThis.document._els;
  check('empty: navBar hidden',                 doc.confirmedNavBar.style.display === 'none');
  check('empty: meta hidden',                   doc.confirmedCandidateMeta.style.display === 'none');
  check('empty: empty-state shown',             doc.confirmedEmpty.style.display === 'block');
}
{
  // Populated
  const state = makeFixture();
  state.confirmedCarouselIndex = 1;   // → candidate C
  renderConfirmedCarousel(state);
  const doc = globalThis.document._els;
  check('populated: navBar visible',            doc.confirmedNavBar.style.display !== 'none');
  check('populated: meta visible',              doc.confirmedCandidateMeta.style.display !== 'none');
  check('populated: empty-state hidden',        doc.confirmedEmpty.style.display === 'none');
  check('info shows "2 / 3"',                   doc.confirmedNavInfo.textContent === '2 / 3');
  check('meta contains candidate C id',         doc.confirmedCandidateMeta.innerHTML.includes('>C<'));
}
{
  // Over-range index clamped + written back
  const state = makeFixture();
  state.confirmedCarouselIndex = 99;
  renderConfirmedCarousel(state);
  check('over-range clamped + persisted',       state.confirmedCarouselIndex === 2);
  check('info shows "3 / 3"',                   globalThis.document._els.confirmedNavInfo.textContent === '3 / 3');
}
{
  // Empty list resets nothing (no clamp write-back when list is empty)
  const state = { candidateList: [], confirmedCarouselIndex: 5 };
  renderConfirmedCarousel(state);
  check('empty list: index untouched',          state.confirmedCarouselIndex === 5);
}

// =====================================================================
group('wireConfirmedCarouselNav — click + keydown');
{
  // Reset doc fixture freshly
  globalThis.document = makeMockDoc();
  globalThis.document._els.confirmed_carousel.classList.add('active');
  const state = makeFixture();
  state.confirmedCarouselIndex = 0;
  renderConfirmedCarousel(state);

  wireConfirmedCarouselNav(state);
  // Click next
  globalThis.document._els.confirmedNavNext._fire('click', {});
  check('click next → idx 1',                   state.confirmedCarouselIndex === 1);
  // Click prev
  globalThis.document._els.confirmedNavPrev._fire('click', {});
  check('click prev → idx 0',                   state.confirmedCarouselIndex === 0);
  // Keydown right
  globalThis.document._fireKey('ArrowRight');
  check('ArrowRight → idx 1',                   state.confirmedCarouselIndex === 1);
  // Keydown left
  globalThis.document._fireKey('ArrowLeft');
  check('ArrowLeft → idx 0',                    state.confirmedCarouselIndex === 0);
  // Other keys ignored
  globalThis.document._fireKey('Enter');
  check('Enter ignored',                        state.confirmedCarouselIndex === 0);
}
{
  // Keydown ignored when confirmed_carousel not active
  globalThis.document = makeMockDoc();
  // confirmed_carousel has no 'active' class
  const state = makeFixture();
  state.confirmedCarouselIndex = 0;
  wireConfirmedCarouselNav(state);
  globalThis.document._fireKey('ArrowRight');
  check('confirmed_carousel not active: key ignored',        state.confirmedCarouselIndex === 0);
}
{
  // Idempotent: calling twice doesn't accumulate handlers
  globalThis.document = makeMockDoc();
  globalThis.document._els.confirmed_carousel.classList.add('active');
  const state = makeFixture();
  state.confirmedCarouselIndex = 0;
  wireConfirmedCarouselNav(state);
  wireConfirmedCarouselNav(state);
  // One fire should only step by 1
  globalThis.document._fireKey('ArrowRight');
  check('idempotent wiring: 1 fire = 1 step',   state.confirmedCarouselIndex === 1);
}
{
  // Teardown removes handlers
  globalThis.document = makeMockDoc();
  globalThis.document._els.confirmed_carousel.classList.add('active');
  const state = makeFixture();
  state.confirmedCarouselIndex = 0;
  wireConfirmedCarouselNav(state);
  teardownConfirmedCarouselNav();
  globalThis.document._fireKey('ArrowRight');
  globalThis.document._els.confirmedNavNext._fire('click', {});
  check('teardown: keydown no-op',              state.confirmedCarouselIndex === 0);
  // Teardown idempotent
  let threw = false;
  try { teardownConfirmedCarouselNav(); } catch (_) { threw = true; }
  check('teardown idempotent (no throw)',       !threw);
}

// =====================================================================
group('headless tolerance');
{
  // Remove document; functions should return without throwing
  const saved = globalThis.document;
  delete globalThis.document;
  let threw = false;
  try {
    renderConfirmedCarousel({ candidateList: [] });
    wireConfirmedCarouselNav({});
    teardownConfirmedCarouselNav();
  } catch (_) { threw = true; }
  check('no document: no throw',                !threw);
  globalThis.document = saved;
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
