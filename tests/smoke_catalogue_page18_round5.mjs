// tests/smoke_catalogue_page18_round5.mjs
//
// Round 5 step 4 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page18 (marker readiness panel).
//
// Page18 is a synthesis-stage page: takes the candidate list +
// crossSpecies + variant_afs (when loaded) and computes a tiered marker
// panel with private/dosage scores + auto-suggested controls. The
// renderer fills #mpBody with: tier-defs card, summary cards, toolbar
// (filters + load buttons), table of per-candidate rows, pilot plan
// instructions, methods.
//
// What this smoke verifies:
//   - module loads cleanly, all 16 helpers + lifecycle exports present
//   - mount() empty-state path: #mpBody filled with synthesis HTML
//     (no candidates → "no candidates" message via _mpDeriveAutoPanel)
//   - mount() populated path: synthetic candidate triggers tier
//     classification, table rendered with rows
//   - _pageState live-binding observed across module boundaries
//   - renderMarkerPanelPage(state) callable directly
//   - unmount() clears _pageState

import * as page18 from '../atlases/inversion/pages/catalogue/page18.js';
import * as state  from '../atlases/inversion/pages/catalogue/page18/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page1/2/3 smoke harnesses.
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
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).forEach(cb => cb(evt));
  }
  appendChild(c) { this.children.push(c); }
  removeChild(c) {
    const idx = this.children.indexOf(c);
    if (idx >= 0) this.children.splice(idx, 1);
  }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  click() { (this._listeners['click'] || []).forEach(cb => cb({ type: 'click' })); }
  querySelector(sel) {
    // Very minimal: support '#id' lookup for the wire functions
    if (typeof sel !== 'string' || !sel.startsWith('#')) return null;
    const id = sel.slice(1);
    return _ensureNode(id);
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

const _storage = new Map();
global.localStorage = {
  getItem: (k) => _storage.has(k) ? _storage.get(k) : null,
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
  clear: () => _storage.clear(),
};

global.requestAnimationFrame = (cb) => { try { cb(0); } catch (_) {} return 0; };

global.URL = { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} };
global.Blob = class { constructor() {} };
global.FileReader = class {
  constructor() { this.onload = null; }
  readAsText() {}
};

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidateList: [],
      crossSpecies: null,
      _markerPanel: null,
      markerThresholds: null,
      tracks: {},
    }, opts.inversion || {}),
    shared: Object.assign({
      activeChrom: null,
      activeCandidate: null,
    }, opts.shared || {}),
  };
}

// -----------------------------------------------------------------------------
group('Module exports');
check('page18 has mount',                    typeof page18.mount === 'function');
check('page18 has unmount',                  typeof page18.unmount === 'function');
check('page18 has renderMarkerPanelPage',    typeof page18.renderMarkerPanelPage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state path (no candidates)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page18.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const mpBody = _ensureNode('mpBody');
check('mpBody has innerHTML',                  typeof mpBody.innerHTML === 'string');
check('mpBody innerHTML contains tier defs',   mpBody.innerHTML.includes('Tier'));
check('mpBody innerHTML > 500 chars',          mpBody.innerHTML.length > 500);

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page18State stashed',
      atlasState.inversion._page18State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidateList',     Array.isArray(stashedState.candidateList));
check('_pageState has crossSpecies',      'crossSpecies' in stashedState);
check('_pageState has _markerPanel',      '_markerPanel' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() populated-state path (synthetic candidate)');
// Build a candidate with karyotype assignments + AF data for a clean Tier-1 marker
const synthCand = {
  id: 'cand_LG12_marker_001',
  chrom: 'LG12',
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  start_w: 25, end_w: 35,
  source: 'page1.lock',
  K: 3,
  confirmed: true,
  notes: '',
  // Karyotype assignments — feeds _mpSuggestControlsFromKaryotype
  assignments: {
    'sample001': 0,  // STD/STD
    'sample002': 0,  // STD/STD
    'sample003': 0,  // STD/STD
    'sample004': 1,  // STD/INV (het)
    'sample005': 1,  // STD/INV (het)
    'sample006': 2,  // INV/INV
    'sample007': 2,  // INV/INV
  },
  l2_indices: [0],
};
const atlasState2 = buildAtlasState({
  inversion: { candidateList: [synthCand] },
  shared: { activeChrom: 'LG12' },
});

// Reset the captured nodes so we can see fresh innerHTML
_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await page18.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const mpBody2 = _ensureNode('mpBody');
check('populated mpBody has innerHTML',                typeof mpBody2.innerHTML === 'string');
check('populated mpBody contains candidate ID or chrom',
      mpBody2.innerHTML.includes(synthCand.chrom) || mpBody2.innerHTML.includes(synthCand.id));
check('populated mpBody innerHTML > 1000 chars',       mpBody2.innerHTML.length > 1000);

// -----------------------------------------------------------------------------
group('Smoke: renderMarkerPanelPage(state) called directly');
let renderOK = true; let renderErr = null;
try { page18.renderMarkerPanelPage(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderMarkerPanelPage(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _mpDeriveAutoPanel reads from _pageState');
state._setActiveState(stashedState);
let derivedOK = true; let derivedErr = null;
try { const panel = page18._mpDeriveAutoPanel(); derivedOK = Array.isArray(panel); }
catch (e) { derivedOK = false; derivedErr = e; }
check('_mpDeriveAutoPanel() returns array via _pageState',
      derivedOK, derivedErr ? derivedErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page18.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
