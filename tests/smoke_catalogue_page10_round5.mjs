// tests/smoke_catalogue_page10_round5.mjs
//
// Round 5 step 9 (chat 36, 2026-05-07): full mount / render / unmount
// lifecycle smoke test for page10 (marker panels).
//
// Page10 is a catalogue-stage page that renders one card per candidate
// inversion regime, showing tier (HIGH/MEDIUM/LOW), expected accuracy,
// per-regime marker counts (g0/g1/g2), Tm range + multiplex spread, and
// (when marker_catalogue + marker_primers loaded) a per-marker table.
//
// What this smoke verifies:
//   - module loads cleanly, lifecycle exports + factory + default present
//   - mount() empty-layers path: page10Content shows "No marker panels loaded"
//     guidance, page10Subtitle says "(no marker layer loaded)"
//   - mount() with marker_panel_summary populated: cards rendered with
//     tier badges + accuracy + per-regime counts; subtitle has tier counts
//   - _pageState live-binding observed across module boundaries
//   - renderPage10(state) callable directly
//   - Backward-compat factory wirePage10 still works after lifecycle wiring
//   - unmount() clears _pageState

const WORKSPACE = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const page10 = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page10.js`);
const state  = await import(`${WORKSPACE}/atlases/inversion/pages/catalogue/page10/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Minimal DOM polyfill — same shape as page9/17/18/21/page_overview smoke
// harnesses. Page10 uses innerHTML/textContent + getElementById; no canvas.
// -----------------------------------------------------------------------------

class FakeNode {
  constructor(id) {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.style = { display: '' };
    this.dataset = {};
    this._listeners = {};
    this.children = [];
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] = this._listeners[evt] || []).push(cb);
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
check('page10 has mount',                       typeof page10.mount === 'function');
check('page10 has unmount',                     typeof page10.unmount === 'function');
check('page10 has renderPage10',                typeof page10.renderPage10 === 'function');
check('page10 has renderMarkerPage (compat)',   typeof page10.renderMarkerPage === 'function');
check('page10 has wirePage10 (compat)',         typeof page10.wirePage10 === 'function');
check('page10 has default (compat)',            typeof page10.default === 'function');

// -----------------------------------------------------------------------------
group('Smoke: mount() empty-layers path');
const root = new FakeNode('atlas-root');
const atlasState = buildAtlasState({});
const registry = {};

let mountOK = true; let mountErr = null;
try { await page10.mount(root, atlasState, registry); }
catch (e) { mountOK = false; mountErr = e; }
check('mount() ran without throwing', mountOK, mountErr ? mountErr.message : '');

const slot = _ensureNode('page10Content');
const subtitle = _ensureNode('page10Subtitle');
check('page10Subtitle textContent set to "(no marker layer loaded)"',
      subtitle.textContent === '(no marker layer loaded)');
check('page10Content innerHTML contains "No marker panels loaded"',
      slot.innerHTML.includes('No marker panels loaded'));

// -----------------------------------------------------------------------------
group('Smoke: _pageState live-binding');
check('_pageState set after mount',
      state._pageState && typeof state._pageState === 'object');
check('atlasState.inversion._page10State stashed',
      atlasState.inversion._page10State === state._pageState);
const stashedState = state._pageState;
check('_pageState has candidateList',           Array.isArray(stashedState.candidateList));

// -----------------------------------------------------------------------------
group('Smoke: mount() with marker_panel_summary loaded (synthetic)');
// Build synthetic marker_panel_summary + matching candidate so the renderer
// emits a real card with tier badge, accuracy, regime counts.
const synthCand = {
  id: 'cand_LG12_001',
  candidate_id: 'cand_LG12_001',
  chrom: 'LG12',
  start_bp: 5_000_000,
  end_bp: 12_000_000,
  regime_counts: 'g0:38;g1:50;g2:138',
};
const synthPanel = {
  candidate_id: 'cand_LG12_001',
  confidence_tier: 'HIGH',
  expected_call_accuracy: 0.945,
  n_markers: 7,
  panel_class: 'g0+g2_separators',
  n_g0_diagnostic: 3,
  n_g1_diagnostic: 1,
  n_g2_diagnostic: 3,
  tm_min: 58.3,
  tm_max: 60.9,
  tm_spread: 2.6,
  warnings: '',
};

const atlasState2 = buildAtlasState({
  inversion: {
    candidateList: [synthCand],
    tracks: {
      LG12: {
        chrom: 'LG12',
        _layers_present: ['marker_panel_summary'],
        marker_panel_summary: [synthPanel],
        marker_catalogue: [],
        marker_primers: [],
      },
    },
  },
  shared: { activeChrom: 'LG12' },
});

_nodes.clear();

let mount2OK = true; let mount2Err = null;
try { await page10.mount(root, atlasState2, registry); }
catch (e) { mount2OK = false; mount2Err = e; }
check('populated mount() ran without throwing', mount2OK, mount2Err ? mount2Err.message : '');

const slot2 = _ensureNode('page10Content');
const subtitle2 = _ensureNode('page10Subtitle');
check('populated slot innerHTML contains candidate id',
      slot2.innerHTML.includes('cand_LG12_001'));
check('populated slot innerHTML contains tier "HIGH"',
      slot2.innerHTML.includes('HIGH'));
check('populated slot innerHTML contains accuracy "94.5%"',
      slot2.innerHTML.includes('94.5%'));
check('populated slot innerHTML contains chrom "LG12"',
      slot2.innerHTML.includes('LG12'));
check('populated slot innerHTML contains "Markers" detail header (catalogue empty branch)',
      slot2.innerHTML.includes('Marker catalogue not loaded'));
check('populated subtitle has panel count',
      subtitle2.textContent.includes('1 panel'));
check('populated subtitle has tier counts',
      subtitle2.textContent.includes('HIGH 1'));

// -----------------------------------------------------------------------------
group('Smoke: renderPage10(state) called directly');
let renderOK = true; let renderErr = null;
try { page10.renderPage10(stashedState); }
catch (e) { renderOK = false; renderErr = e; }
check('renderPage10(state) ran without throwing',
      renderOK, renderErr ? renderErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: backward-compat wirePage10 still works post-lifecycle-wiring');
const handle = page10.wirePage10({ data: {}, candidateList: [] });
check('wirePage10 returned handle with renderPage10',
      handle && typeof handle.renderPage10 === 'function');
check('handle.renderMarkerPage === handle.renderPage10 (legacy alias)',
      handle.renderMarkerPage === handle.renderPage10);
let factoryOK = true; let factoryErr = null;
try { handle.renderPage10(); }
catch (e) { factoryOK = false; factoryErr = e; }
check('factory renderPage10() ran without throwing',
      factoryOK, factoryErr ? factoryErr.message : '');

// -----------------------------------------------------------------------------
group('Smoke: unmount()');
let unmountOK = true; let unmountErr = null;
try { await page10.unmount(root); }
catch (e) { unmountOK = false; unmountErr = e; }
check('unmount() ran without throwing', unmountOK, unmountErr ? unmountErr.message : '');
check('_pageState cleared by unmount', state._pageState === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
