// tests/smoke_catalogue_page3_round5.mjs
//
// Round 5 step 3 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for the page3 catalogue split.
//
// Page3 mounts a catalogue toolbar + an empty table. The catalogue
// renderer (_buildCatalogueRows / _filterCatalogueRows /
// _sortCatalogueRows / _paintCatalogueRow) is referenced in legacy
// via `typeof X === 'function'` guards but never DEFINED — see
// HANDOFF_2026-05-07_chat36_round5_step3_done.md for full inventory.
// The only meaningful catalogue-toolbar action implemented in legacy
// is the breeding-card export pipeline (Turn 146, 1106 LOC migrated
// in this round).
//
// What this smoke verifies:
//   - module loads cleanly (no parse-time cycle)
//   - mount() sets up empty-state DOM correctly
//   - mount() calls _wireCatalogueBreedingExportBtns without throwing
//   - renderCataloguePage shows the empty-state hint
//   - _pageState live-binding works across module boundaries
//   - unmount() clears _pageState

import * as page3       from '../atlases/inversion/pages/catalogue/page3.js';
import * as state       from '../atlases/inversion/pages/catalogue/page3/_state.js';
import * as breeding    from '../atlases/inversion/pages/catalogue/page3/_breeding_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill (mirrors smoke_discovery_page1_round4.mjs and
// smoke_discovery_page2_round5.mjs). Only the pieces page3's mount path
// touches: getElementById, innerHTML, textContent, style, dataset,
// addEventListener.
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
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || [];
    const idx = list.indexOf(cb);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).forEach(cb => cb(evt));
  }
  appendChild(_) { /* no-op for smoke */ }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  click() { (this._listeners['click'] || []).forEach(cb => cb({ type: 'click' })); }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));
  return _nodes.get(id);
}

global.document = {
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
};

global.window = global;

// localStorage stub — _wireCatalogueBreedingExportBtns reads/writes
// the breeding_export_tier key.
const _storage = new Map();
global.localStorage = {
  getItem: (k) => _storage.has(k) ? _storage.get(k) : null,
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
  clear: () => _storage.clear(),
};

// requestAnimationFrame stub (some helpers use it)
global.requestAnimationFrame = (cb) => { try { cb(0); } catch (_) {} return 0; };

// Build the atlasState shape that atlas_router would pass to mount.
function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidateList: [],
      candidate_review_decisions: {},
      locked_karyotype_groups: {},
      tracks: {},
      cohortDiversity: null,
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
      activeSampleSet: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page3 has mount',                    typeof page3.mount === 'function');
check('page3 has unmount',                  typeof page3.unmount === 'function');
check('page3 has renderCataloguePage',      typeof page3.renderCataloguePage === 'function');
check('page3 has initCataloguePage',        typeof page3.initCataloguePage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state path');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page3.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// Empty-state DOM checks
const empty   = _ensureNode('catEmpty');
const head    = _ensureNode('catHead');
const body    = _ensureNode('catBody');
const selInfo = _ensureNode('catSelInfo');

check('catEmpty has empty-state text',
      empty.textContent && empty.textContent.startsWith('Load a JSON to populate'));
check('catEmpty visible (display:block)',     empty.style.display === 'block');
check('catHead innerHTML is empty',            head.innerHTML === '');
check('catBody innerHTML is empty',            body.innerHTML === '');
check('catSelInfo shows zero-selected',        selInfo.textContent === '0 selected of 0');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',  state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page3State stashed',
      atlasState.inversion._page3State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidateList',     Array.isArray(stashedState.candidateList));
check('_pageState has data slot',         'data' in stashedState);
check('_pageState has cohortDiversity',   'cohortDiversity' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: breeding-export wires bound after mount');
const tierSel = _ensureNode('catBreedingTierSel');
const htmlBtn = _ensureNode('catExportBreedingHTML');
const jsonBtn = _ensureNode('catExportBreedingJSON');
check('catBreedingTierSel marked _wired',   tierSel.dataset._wired === '1');
check('catExportBreedingHTML marked _wired', htmlBtn.dataset._wired === '1');
check('catExportBreedingJSON marked _wired', jsonBtn.dataset._wired === '1');
check('tier dropdown has change listener',
      tierSel._listeners['change'] && tierSel._listeners['change'].length === 1);
check('HTML button has click listener',
      htmlBtn._listeners['click'] && htmlBtn._listeners['click'].length === 1);
check('JSON button has click listener',
      jsonBtn._listeners['click'] && jsonBtn._listeners['click'].length === 1);

// -----------------------------------------------------------------------------
group('Smoke: localStorage tier round-trip');
// Simulate user choosing "tier_1" — storage should be updated.
tierSel.value = 'tier_1';
tierSel.dispatchEvent({ type: 'change' });
check('tier change persists to localStorage',
      localStorage.getItem('pca_scrubber_v3.breeding_export_tier') === 'tier_1');
// Reset for clean state
localStorage.clear();

// -----------------------------------------------------------------------------
group('Smoke: idempotency — mount twice doesn\'t double-bind');
const beforeListenerCount = htmlBtn._listeners['click'].length;
try { await page3.mount(root, atlasState, registry); }
catch (e) { fail++; console.log('  ✗ second mount() threw:', e.message); }
check('HTML button still has 1 click listener (idempotent)',
      htmlBtn._listeners['click'].length === beforeListenerCount);

// -----------------------------------------------------------------------------
group('Smoke: renderCataloguePage(state) called directly');
let renderOK = true; let renderErr = null;
try { page3.renderCataloguePage(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderCataloguePage(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');
check('catEmpty still shows empty-state text after re-render',
      empty.textContent && empty.textContent.startsWith('Load a JSON to populate'));

// -----------------------------------------------------------------------------
group('Smoke: initCataloguePage(state) idempotent');
let initOK = true; let initErr = null;
try { page3.initCataloguePage(stashedState); }
catch (e) { initOK = false; initErr = e; }
check('initCataloguePage(state) ran without throwing',
      initOK, initErr ? initErr.message : '');
check('still 1 click listener on HTML button (idempotent)',
      htmlBtn._listeners['click'].length === 1);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page3.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
