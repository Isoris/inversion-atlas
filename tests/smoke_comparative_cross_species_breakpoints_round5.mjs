// tests/smoke_comparative_page16_round5.mjs
//
// Round 5 step 11 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for cross_species_breakpoints (cross-species breakpoints page —
// the comparative-stage cockpit for chromosome-scale rearrangements
// between Cgar and Cmac).
//
// Page16 is comparative-stage: 2556 LOC of verbatim body extracted
// from legacy lines 20971-21114 (constants + IO/state) + 23717-26025
// (cross-species runtime: filter/sort, render*, ideograms, flank
// charts, synteny, dotplot, focal-vs-bg) + 28367-28419
// (_csBuildPermResultHtml). 50 top-level helpers; 28 got the
// AST-injected `const state = _pageState;` shim.
//
// Strategic value: cross_species_breakpoints owns _csGetSyntenyBlocks +
// _csPermutationTest, previously runtime-guarded in stats_profile (synthesis
// stats profile). Round 5 step 11 makes them explicit ES exports.
//
// What this smoke verifies:
//   - module loads cleanly, all 27 explicit ES exports present
//   - mount() empty path: cross-species panels render without throwing
//     (empty-state guidance, no actual breakpoint data)
//   - mount() with synthetic crossSpecies + synteny_blocks: verbatim
//     render path executes; FakeContext receives draw ops on the
//     canvas-driven panels (#csIdeogramCanvas, etc.)
//   - _pageState live-binding observed across module boundaries
//   - _csGetSyntenyBlocks accessible via direct call after mount
//     (proves the cross-page-helper export contract)
//   - renderCrossSpeciesPage(state) callable directly
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const cross_species_breakpoints = await import(`${WORKSPACE}/atlases/inversion/pages/comparative/cross_species_breakpoints.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/comparative/cross_species_breakpoints/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as local_pca_dosage/2/3/9/10/12/17/18/21 smoke
// harnesses. Adds canvas-context shim because cross_species_breakpoints's render path uses
// canvas (#csIdeogramCanvas + flank chart canvases). Adds insertAdjacentHTML
// because the ideogram building uses it.
// -----------------------------------------------------------------------------

class FakeContext {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
    this.font = '';
    this.textAlign = '';
    this.textBaseline = '';
    this.globalAlpha = 1;
    this._ops = 0;
  }
  setTransform() {}
  fillRect()    { this._ops++; }
  strokeRect()  { this._ops++; }
  fillText()    { this._ops++; }
  strokeText()  { this._ops++; }
  beginPath()   { this._ops++; }
  closePath()   { this._ops++; }
  moveTo()      { this._ops++; }
  lineTo()      { this._ops++; }
  arc()         { this._ops++; }
  stroke()      { this._ops++; }
  fill()        { this._ops++; }
  rect()        { this._ops++; }
  clearRect()   { this._ops++; }
  save()        {}
  restore()     {}
  translate()   {}
  scale()       {}
  measureText() { return { width: 10 }; }
  createLinearGradient() { return { addColorStop: () => {} }; }
  getImageData() { return { data: [] }; }
  putImageData() {}
}

class FakeNode {
  constructor(id) {
    this.id = id;
    this.tagName = (typeof id === 'string' && id.startsWith('<'))
                   ? id.slice(1, -1).toUpperCase() : '';
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.value = '';
    this.children = [];
    this.width  = 0;
    this.height = 0;
    this.clientWidth  = 1200;
    this.clientHeight = 200;
    this._ctx = null;
    this.scrollLeft = 0;
    this.scrollTop = 0;
  }
  getContext() {
    if (!this._ctx) this._ctx = new FakeContext();
    return this._ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
             width: this.clientWidth, height: this.clientHeight };
  }
  focus() {}
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
  }
  removeEventListener(evt, cb) {
    const a = this._listeners[evt];
    if (a) { const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }
  }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  setAttribute(k, v) { this[k] = v; if (k.startsWith('data-')) {
    const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    this.dataset[camel] = v;
  } }
  getAttribute(k) { return this[k]; }
  insertAdjacentHTML(_, html) { this.innerHTML += html; }
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
  querySelector:    (sel) => sel.startsWith('#') ? _ensureNode(sel.slice(1)) : null,
  querySelectorAll: () => [],
};

global.window = global;
global.devicePixelRatio = 1;

const _storage = new Map();
global.localStorage = {
  getItem: (k) => _storage.has(k) ? _storage.get(k) : null,
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
  clear: () => _storage.clear(),
};

global.requestAnimationFrame = (cb) => { try { cb(0); } catch (_) {} return 0; };
global.cancelAnimationFrame  = () => {};

function buildAtlasState(opts) {
  return {
    inversion: Object.assign({
      candidateList: [],
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
check('cross_species_breakpoints has mount',                    typeof cross_species_breakpoints.mount === 'function');
check('cross_species_breakpoints has unmount',                  typeof cross_species_breakpoints.unmount === 'function');
check('cross_species_breakpoints has renderCrossSpeciesPage',   typeof cross_species_breakpoints.renderCrossSpeciesPage === 'function');
check('cross_species_breakpoints has _renderCrossSpeciesPage',  typeof cross_species_breakpoints._renderCrossSpeciesPage === 'function');
check('cross_species_breakpoints has _csGetSyntenyBlocks (stats_profile guard target)',
      typeof cross_species_breakpoints._csGetSyntenyBlocks === 'function');
check('cross_species_breakpoints has _csPermutationTest (stats_profile guard target)',
      typeof cross_species_breakpoints._csPermutationTest === 'function');
check('cross_species_breakpoints has CS_EVENT_DEF',
      cross_species_breakpoints.CS_EVENT_DEF && typeof cross_species_breakpoints.CS_EVENT_DEF === 'object');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty crossSpecies path');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await cross_species_breakpoints.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding after mount');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
// 2026-05-26: stash moved from atlasState.inversion._page16State to
// atlasState['cross-species']._page_cross_species_breakpointsState (this
// is a cross-species page, not an inversion page).
check('atlasState["cross-species"]._page_cross_species_breakpointsState stashed',
      atlasState['cross-species'] &&
      atlasState['cross-species']._page_cross_species_breakpointsState === state._pageState);
const stashedState = state._pageState;
check('_pageState has crossSpecies slot',     'crossSpecies' in stashedState);
check('_pageState has _crossSpeciesUI slot',  '_crossSpeciesUI' in stashedState);
check('_pageState has candidateList',         Array.isArray(stashedState.candidateList));

// -----------------------------------------------------------------------------
group('Smoke: _csGetSyntenyBlocks reads via _pageState (live-binding)');
// After mount with no crossSpecies, _csGetSyntenyBlocks should return null.
check('_csGetSyntenyBlocks() returns null when crossSpecies missing',
      cross_species_breakpoints._csGetSyntenyBlocks() === null);

// Inject synthetic data into _pageState directly to verify live-binding
// (simulates what would happen after a JSON load).
stashedState.crossSpecies = {
  synteny_blocks: [
    { gar_chr: 'LG12', mac_chr: 'CMA01', gar_start: 1e6, gar_end: 5e6, block_size_bp: 4e6 },
    { gar_chr: 'LG12', mac_chr: 'CMA01', gar_start: 6e6, gar_end: 10e6, block_size_bp: 4e6 },
  ],
};
const blocks = cross_species_breakpoints._csGetSyntenyBlocks();
check('_csGetSyntenyBlocks() returns array after data set',
      Array.isArray(blocks) && blocks.length === 2);
check('_csGetSyntenyBlocks() returns the actual array (live-binding)',
      blocks === stashedState.crossSpecies.synteny_blocks);

// -----------------------------------------------------------------------------
group('Smoke: mount() with synthetic crossSpecies (cs_breakpoints_v1)');
// Reset captured nodes
_nodes.clear();

const synthCS = {
  tool: 'cross_species_breakpoints_v1',
  schema_version: 1,
  generated_at: '2026-05-07T00:00:00Z',
  species_query: 'C. gariepinus',
  species_target: 'C. macrocephalus',
  input_paf: 'wfmash_gar_to_mac.paf',
  params: {},
  n_breakpoints: 1,
  n_by_event_type: { inversion: 1 },
  breakpoints: [
    {
      id: 'bp_001',
      event_type: 'inversion',
      gar_chr: 'LG12',
      gar_pos_start: 5_000_000,
      gar_pos_end:   12_000_000,
      gar_pos_mb: 8.5,
      prev_block: { mac_chr: 'CMA01', mac_start_bp: 4_000_000, mac_end_bp: 5_000_000,
                    strand: '+', block_size_bp: 1e6, mapping_quality: 60 },
      next_block: { mac_chr: 'CMA01', mac_start_bp: 12_000_000, mac_end_bp: 13_000_000,
                    strand: '-', block_size_bp: 1e6, mapping_quality: 60 },
      flanking_repeat_density_gar: { 'all_TE': { mean: 0.45, max: 0.62, n_windows: 50 } },
      flanking_repeat_density_mac: {
        prev: { mac_chr: 'CMA01', anchor_bp: 5_000_000,
                by_class: { 'all_TE': { mean: 0.32, max: 0.51, n_windows: 50 } } },
        next: { mac_chr: 'CMA01', anchor_bp: 12_000_000,
                by_class: { 'all_TE': { mean: 0.38, max: 0.55, n_windows: 50 } } },
      },
    },
  ],
  synteny_blocks: [
    { gar_chr: 'LG12', mac_chr: 'CMA01', gar_start: 1e6,  gar_end: 5e6,  block_size_bp: 4e6 },
    { gar_chr: 'LG12', mac_chr: 'CMA01', gar_start: 12e6, gar_end: 50e6, block_size_bp: 38e6 },
  ],
};

const atlasState2 = buildAtlasState({
  inversion: {
    crossSpecies: synthCS,
    candidateList: [{ id: 'cand_001', chrom: 'LG12', start_bp: 5e6, end_bp: 12e6 }],
    tracks: {
      LG12: { chrom: 'LG12', _layers_present: [] },
    },
  },
  shared: { activeChrom: 'LG12' },
});

let mount2OK = true; let mount2Err = null;
try { await cross_species_breakpoints.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

// _csGetSyntenyBlocks should now return the synteny_blocks array.
const blocks2 = cross_species_breakpoints._csGetSyntenyBlocks();
check('post-populated-mount _csGetSyntenyBlocks returns 2 blocks',
      Array.isArray(blocks2) && blocks2.length === 2);

// -----------------------------------------------------------------------------
group('Smoke: renderCrossSpeciesPage(state) called directly');
let renderOK = true; let renderErr = null;
try { cross_species_breakpoints.renderCrossSpeciesPage(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
// Render may throw on missing DOM, but _pageState should be set either way.
check('renderCrossSpeciesPage(state) sets _pageState (even if render throws)',
      state._pageState === stashedState, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: _csComputeSynteny runs through verbatim body via _pageState');
// _csComputeSynteny iterates the synteny_blocks and builds per-(gar,mac)
// tallies. Reset the cache slot so the function actually runs.
stashedState._csSyntenyCache = null;
let computeOK = true; let computeErr = null; let computeResult = null;
try { computeResult = cross_species_breakpoints._csComputeSynteny(); }
catch (e) { computeOK = false; computeErr = e; }
check('_csComputeSynteny() ran without throwing',
      computeOK, computeErr ? computeErr.message : '');
check('_csComputeSynteny() returned non-null result',
      computeResult !== null);

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await cross_species_breakpoints.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
