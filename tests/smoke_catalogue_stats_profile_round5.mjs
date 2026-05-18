// tests/smoke_catalogue_page17_round5.mjs
//
// Round 5 step 5 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for stats_profile (stats profile page).
//
// Page17 is a synthesis-stage page. It auto-derives ~7 statistical
// rows from cs_breakpoints + candidate list (cross-species permutation
// test, repeat-flank Spalax check, fusion-fission, markerability,
// etc.), accepts a stats_profile JSON/TSV overlay for rows requiring
// annotation (gene density, GO/KEGG, ROH burden, FST). Renders into
// #spBody.
//
// Page17 imports:
//   - _esc from shared/page1_data_helpers.js
//   - _mpDeriveAutoPanel from sibling marker_readiness.js (was typeof-guarded
//     in legacy; round 5 step 5 makes it a real import)
//   - _csGetSyntenyBlocks + _csPermutationTest from cross_species_breakpoints.js (round 5
//     step 12 promotion of the legacy typeof-runtime-guards; mount()
//     bridges legacyState into cross_species_breakpoints's _pageState the same way it
//     already bridges into marker_readiness's _pageState)
//
// What this smoke verifies:
//   - module loads cleanly with both imports resolved
//   - mount() empty-state path: #spBody filled with header + table
//   - mount() populated path: synthetic candidate flexes the derived
//     rows (cs permutation test, etc.)
//   - _pageState live-binding observed across module boundaries
//   - direct renderStatsProfilePage(state) call works
//   - unmount() clears _pageState

import * as stats_profile from '../atlases/inversion/pages/catalogue/stats_profile.js';
import * as state  from '../atlases/inversion/pages/catalogue/stats_profile/_state.js';
import * as cross_species_breakpoints from '../atlases/inversion/pages/comparative/cross_species_breakpoints.js';
import * as page16state from '../atlases/inversion/pages/comparative/cross_species_breakpoints/_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as the page1/2/3/18 smoke harnesses.
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
      _statsProfile: null,
      _markerPanel: null,
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
check('stats_profile has mount',                    typeof stats_profile.mount === 'function');
check('stats_profile has unmount',                  typeof stats_profile.unmount === 'function');
check('stats_profile has renderStatsProfilePage',   typeof stats_profile.renderStatsProfilePage === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-state path (no candidates)');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await stats_profile.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const spBody = _ensureNode('spBody');
check('spBody has innerHTML',                  typeof spBody.innerHTML === 'string');
check('spBody innerHTML > 500 chars',          spBody.innerHTML.length > 500);
// Page17 renders a stats table — check for table-like content
check('spBody contains <table> tag',           spBody.innerHTML.includes('<table'));

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page17State stashed',
      atlasState.inversion._page17State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidateList',     Array.isArray(stashedState.candidateList));
check('_pageState has crossSpecies',      'crossSpecies' in stashedState);
check('_pageState has _statsProfile',     '_statsProfile' in stashedState);

// -----------------------------------------------------------------------------
group('Smoke: mount() populated-state (synthetic candidate)');
const synthCand = {
  id: 'cand_LG12_stats_001',
  chrom: 'LG12',
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  start_w: 25, end_w: 35,
  source: 'page1.lock',
  K: 3,
  confirmed: true,
  notes: '',
  l2_indices: [0],
};
const atlasState2 = buildAtlasState({
  inversion: { candidateList: [synthCand] },
  shared: { activeChrom: 'LG12' },
});

_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await stats_profile.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const spBody2 = _ensureNode('spBody');
check('populated spBody has innerHTML',         typeof spBody2.innerHTML === 'string');
check('populated spBody innerHTML > 1000 chars', spBody2.innerHTML.length > 1000);

// -----------------------------------------------------------------------------
group('Smoke: renderStatsProfilePage(state) called directly');
let renderOK = true; let renderErr = null;
try { stats_profile.renderStatsProfilePage(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderStatsProfilePage(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _spDeriveAllRows reads from _pageState');
state._setActiveState(stashedState);
let derivedOK = true; let derivedErr = null;
let rows;
try { rows = stats_profile._spDeriveAllRows(); derivedOK = Array.isArray(rows); }
catch (e) { derivedOK = false; derivedErr = e; }
check('_spDeriveAllRows() returns array via _pageState',
      derivedOK, derivedErr ? derivedErr.message : '');
if (Array.isArray(rows)) {
  check('_spDeriveAllRows() returns non-empty array',
        rows.length > 0, `got ${rows.length} rows`);
}

// -----------------------------------------------------------------------------
group('Smoke: cross_species_breakpoints cross-page bridge (round 5 step 12)');
// Round 5 step 12: stats_profile promoted typeof-runtime-guards on
// _csGetSyntenyBlocks + _csPermutationTest to explicit imports from
// cross_species_breakpoints, plus mount() now calls cross_species_breakpoints's _setActiveState. Verify the
// bridge actually wires crossSpecies + candidateList through cross_species_breakpoints's
// _pageState end-to-end.

// Build an atlasState with a real cs_breakpoints_v1-shaped crossSpecies
// + a candidate that overlaps a synteny edge (so the perm test has
// data to bite on).
const synthBlocks = [
  { gar_chr: 'LG12', gar_start_bp:  1_000_000, gar_end_bp:  4_000_000,
    mac_chr: 'CMA01', mac_start_bp: 1_000_000, mac_end_bp:  4_000_000,
    aligned_bp: 3_000_000, orientation: '+' },
  { gar_chr: 'LG12', gar_start_bp:  4_500_000, gar_end_bp: 12_500_000,
    mac_chr: 'CMA01', mac_start_bp: 4_500_000, mac_end_bp: 12_500_000,
    aligned_bp: 8_000_000, orientation: '-' },
  { gar_chr: 'LG12', gar_start_bp: 13_000_000, gar_end_bp: 18_000_000,
    mac_chr: 'CMA01', mac_start_bp: 13_000_000, mac_end_bp: 18_000_000,
    aligned_bp: 5_000_000, orientation: '+' },
];
const synthCs = {
  schema: 'cs_breakpoints_v1',
  metadata: { source: 'smoke synthetic' },
  breakpoints: [],
  synteny_blocks: synthBlocks,
  chrom_lengths_query:  { LG12:  20_000_000 },
  chrom_lengths_target: { CMA01: 20_000_000 },
};
const atlasState3 = buildAtlasState({
  inversion: { candidateList: [synthCand], crossSpecies: synthCs },
  shared: { activeChrom: 'LG12' },
});

_nodes.clear();
page16state._setActiveState(null);  // clean slate

let mount3OK = true; let mount3Err = null;
try { await stats_profile.mount(root, atlasState3, registry); }
catch (e) { mount3OK = false; mount3Err = e; }
check('stats_profile.mount(crossSpecies) ran without throwing',
      mount3OK, mount3Err ? mount3Err.message : '');

// cross_species_breakpoints's _pageState should now point at the same legacy state stats_profile built.
check('cross_species_breakpoints._pageState set after stats_profile.mount',
      page16state._pageState !== null && typeof page16state._pageState === 'object');
check('cross_species_breakpoints._pageState IS stats_profile._pageState (shared bridge)',
      page16state._pageState === state._pageState);
check('bridged cross_species_breakpoints._pageState carries crossSpecies',
      page16state._pageState && page16state._pageState.crossSpecies === synthCs);
check('bridged cross_species_breakpoints._pageState carries candidateList',
      page16state._pageState && Array.isArray(page16state._pageState.candidateList) &&
      page16state._pageState.candidateList.length === 1);

// _csGetSyntenyBlocks (imported from cross_species_breakpoints) must read the bridged state.
const bridgedBlocks = cross_species_breakpoints._csGetSyntenyBlocks();
check('cross_species_breakpoints._csGetSyntenyBlocks() reads bridged synteny_blocks',
      Array.isArray(bridgedBlocks) && bridgedBlocks.length === 3);
check('first bridged block matches synthetic input',
      bridgedBlocks && bridgedBlocks[0] && bridgedBlocks[0].gar_chr === 'LG12');

// _spDeriveCsPermutation is stats_profile's formerly-guarded function. With
// the bridge in place + a candidate that overlaps a synteny edge, the
// import-only path should reach _csPermutationTest end-to-end and
// produce a real derived row (state: 'derived'). This is the strongest
// proof that the typeof-guard removal preserves semantics: not just
// "didn't throw" but "actually exercises the perm-test code path".
let derivCsOK = true; let derivCsErr = null; let derivCs;
try { derivCs = stats_profile._spDeriveCsPermutation(); }
catch (e) { derivCsOK = false; derivCsErr = e; }
check('_spDeriveCsPermutation() ran without throwing (imports-only path)',
      derivCsOK, derivCsErr ? derivCsErr.message : '');
check('_spDeriveCsPermutation() returns a derived row',
      derivCs && typeof derivCs === 'object' && derivCs.state === 'derived',
      `got ${derivCs === null ? 'null' : typeof derivCs}`);
check('_spDeriveCsPermutation() row has p_value',
      derivCs && 'p_value' in derivCs && derivCs.p_value !== null);
check('_spDeriveCsPermutation() row has effect tag',
      derivCs && typeof derivCs.effect === 'string' &&
      ['not_significant','closer_than_expected','farther_than_expected'].includes(derivCs.effect));
check('_spDeriveCsPermutation() row has n_valid count',
      derivCs && Number.isFinite(derivCs.n) && derivCs.n >= 1);


// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await stats_profile.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);
// Round 5 step 12: stats_profile.unmount must NOT clear cross_species_breakpoints._pageState.
// If cross_species_breakpoints is currently mounted (or will be) it manages its own state;
// clearing it here would break the stats_profile → cross_species_breakpoints navigation flow.
// (Same contract as the stats_profile → marker_readiness unmount comment.)
check('stats_profile.unmount does NOT clear cross_species_breakpoints._pageState',
      page16state._pageState !== null);
// Cleanup so other test runs in the same process see a fresh slate.
page16state._setActiveState(null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
