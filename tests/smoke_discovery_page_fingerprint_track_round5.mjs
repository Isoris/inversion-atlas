// tests/smoke_discovery_page_fingerprint_track_round5.mjs
//
// Full mount/unmount lifecycle smoke for the fingerprint track
// cartridge. Mirrors smoke_discovery_page_tree_panel_round5 in shape.

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_fingerprint_track.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_fingerprint_track/_state.js`);
const fp_mod = await import(`${WORKSPACE}/atlases/inversion/shared/mgl_fingerprinter.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// DOM polyfill
// =====================================================================

class FakeContext {
  constructor() {
    this.calls = []; this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 0; this.font = '';
  }
  clearRect(...a) { this.calls.push(['clearRect', ...a]); }
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() { this.calls.push(['stroke']); }
  fillRect(...a) { this.calls.push(['fillRect', ...a]); }
  strokeRect(...a) { this.calls.push(['strokeRect', ...a]); }
  arc() {}
  fill() { this.calls.push(['fill']); }
  fillText(...a) { this.calls.push(['fillText', ...a]); }
}

class FakeCanvas {
  constructor(id) {
    this.id = id; this.width = 800; this.height = 120;
    this._ctx = new FakeContext(); this._listeners = {};
    this.style = { display: '' };
  }
  getContext() { return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || []; const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) { const list = this._listeners[evt.type] || []; for (const cb of list) cb(evt); }
}

class FakeNode {
  constructor(id) {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false;
    this.style = { display: '' }; this._listeners = {}; this.children = [];
  }
  addEventListener(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); }
  removeEventListener(evt, cb) {
    const list = this._listeners[evt] || []; const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) { const list = this._listeners[evt.type] || []; for (const cb of list) cb(evt); }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const _nodes = new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) {
    const isCanvas = (id === 'fingerprintTrackCanvas')
                  || (id === 'fingerprintProportionsCanvas');
    _nodes.set(id, isCanvas ? new FakeCanvas(id) : new FakeNode(id));
  }
  return _nodes.get(id);
}

global.document = {
  body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`),
};
global.window = global;

// =====================================================================
group('Module exports');
check('page has mount',                          typeof page.mount === 'function');
check('page has unmount',                        typeof page.unmount === 'function');
check('page has refreshFingerprintTrack',        typeof page.refreshFingerprintTrack === 'function');
check('page has initFingerprintTrackToolbar',    typeof page.initFingerprintTrackToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState (no fingerprint)');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran without throwing',          ok, err ? err.message : '');
  check('_pageState set',                        state._pageState && typeof state._pageState === 'object');
  check('atlasState stash present',              atlasState.inversion._page_fingerprint_track_state !== undefined);
  check('candidate label = "—"',                 _ensureNode('fingerprintCandidateLabel').textContent === '—');
  check('scenario badge = "—"',                  _ensureNode('fingerprintScenarioBadge').textContent === '—');
  check('empty-state div visible',               _ensureNode('fingerprintTrackEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared on unmount',         state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with a fingerprint result');
{
  const root = new FakeNode('atlas-root');
  const bands = ['A', 'B', 'C'];
  function mk(piA, piB, piC, dab, dac, dbc, fab, fac, fbc) {
    return {
      theta_pi_A: piA, theta_pi_B: piB, theta_pi_C: piC,
      dXY_A_B: dab, dXY_A_C: dac, dXY_B_C: dbc,
      Fst_A_B: fab, Fst_A_C: fac, Fst_B_C: fbc,
    };
  }
  // 6 windows, regime pattern [1,1,1,2,2,1] → return_switch in the middle
  const winProfiles = [
    mk(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
    mk(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
    mk(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
    mk(0.03, 0.02, 0.01, 0.06, 0.05, 0.04, 0.3, 0.2, 0.1),
    mk(0.03, 0.02, 0.01, 0.06, 0.05, 0.04, 0.3, 0.2, 0.1),
    mk(0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.1, 0.2, 0.3),
  ];
  const fingerprint_result = fp_mod.fingerprintCandidate(winProfiles, bands);
  const atlasState = {
    inversion: {
      fingerprint_track_state: {
        fingerprint_result,
        candidate_label: 'LG28:15-18 Mb',
        window_labels: ['w0', 'w1', 'w2', 'w3', 'w4', 'w5'],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  const canvas = _ensureNode('fingerprintTrackCanvas');
  check('canvas painted (clearRect)',
        canvas._ctx.calls.some(c => c[0] === 'clearRect'));
  check('canvas drew strip (fillRect)',
        canvas._ctx.calls.some(c => c[0] === 'fillRect'));
  check('canvas outlined track (strokeRect)',
        canvas._ctx.calls.some(c => c[0] === 'strokeRect'));
  check('canvas drew switch glyph (fillText)',
        canvas._ctx.calls.some(c => c[0] === 'fillText'));
  check('candidate label set',
        _ensureNode('fingerprintCandidateLabel').textContent === 'LG28:15-18 Mb');
  check('scenario badge populated',
        _ensureNode('fingerprintScenarioBadge').textContent.indexOf('recombinant') >= 0
     || _ensureNode('fingerprintScenarioBadge').textContent.indexOf('regime') >= 0);
  check('switch-list populated',
        _ensureNode('fingerprintSwitchListBody').innerHTML.indexOf('return') >= 0
     || _ensureNode('fingerprintSwitchListBody').innerHTML.indexOf('terminal') >= 0);
  check('empty-state hidden',
        _ensureNode('fingerprintTrackEmpty').style.display === 'none');

  // -------------------------------------------------------------------
  group('Smoke: proportions treemap painted');
  {
    const pCanvas = _ensureNode('fingerprintProportionsCanvas');
    check('proportions canvas cleared',
          pCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('proportions canvas drew tiles (fillRect)',
          pCanvas._ctx.calls.some(c => c[0] === 'fillRect'));
    check('proportions canvas drew borders (strokeRect)',
          pCanvas._ctx.calls.some(c => c[0] === 'strokeRect'));
    check('regime_hit_regions populated',
          state._pageState.regime_hit_regions.length > 0);

    // Hovering a regime tile should highlight (re-paint the tile
    // with a different stroke colour). We can't inspect colour, so
    // just verify the hover toggles hovered_regime on state and
    // triggers a repaint.
    const hit = state._pageState.regime_hit_regions[0];
    pCanvas._ctx.calls.length = 0;
    pCanvas.dispatchEvent({
      type: 'mousemove',
      clientX: hit.x + hit.w / 2,
      clientY: hit.y + hit.h / 2,
    });
    check('hover on tile updates hovered_regime',
          state._pageState.hovered_regime === hit.regime_id);
    check('proportions canvas repainted on hover',
          pCanvas._ctx.calls.some(c => c[0] === 'clearRect'));
  }

  // -------------------------------------------------------------------
  group('Smoke: hover updates the right panel');
  const ps = state._pageState;
  if (ps && ps.window_hit_regions && ps.window_hit_regions.length > 0) {
    const h = ps.window_hit_regions[2];
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    canvas.dispatchEvent({ type: 'mousemove', clientX: cx, clientY: cy });
    check('hover: hoveredWindow = idx',
          ps.selection.getHoveredWindow() === h.window_idx);
    const fields = _ensureNode('fingerprintSelectedFields').innerHTML;
    check('right panel updated with window label',
          fields.indexOf('w2') >= 0 || fields.indexOf('idx 2') >= 0);
    check('right panel shows Regime',           fields.indexOf('Regime') >= 0);
  } else {
    check('window hit regions populated', false, 'no hit regions');
  }

  // -------------------------------------------------------------------
  group('Smoke: click toggles selection');
  {
    const h = ps.window_hit_regions[2];
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    canvas.dispatchEvent({ type: 'click', clientX: cx, clientY: cy });
    check('click adds window to selection',
          ps.selection.getSelected().has(h.window_idx));
    canvas.dispatchEvent({ type: 'click', clientX: cx, clientY: cy });
    check('click again removes window',
          !ps.selection.getSelected().has(h.window_idx));
  }

  // -------------------------------------------------------------------
  group('Smoke: toolbar toggles repaint');
  {
    canvas._ctx.calls.length = 0;
    const cb = _ensureNode('fingerprintShowBriefSwitches');
    cb.checked = true;
    cb.dispatchEvent({ type: 'change', target: { checked: true } });
    check('repaint fired after brief-switch toggle',
          canvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.show_brief_switches updated',
          ps.view_state.show_brief_switches === true);

    canvas._ctx.calls.length = 0;
    const cb2 = _ensureNode('fingerprintShowLabels');
    cb2.checked = false;
    cb2.dispatchEvent({ type: 'change', target: { checked: false } });
    check('repaint fired after label toggle',
          canvas._ctx.calls.some(c => c[0] === 'clearRect'));
    check('view_state.show_labels updated',
          ps.view_state.show_labels === false);
  }

  // -------------------------------------------------------------------
  group('Smoke: refresh idempotent');
  {
    const beforeLen = canvas._ctx.calls.length;
    page.refreshFingerprintTrack(ps);
    check('refresh runs again without throwing',
          canvas._ctx.calls.length > beforeLen);
    check('selection survives refresh',
          ps.selection.getSelected().size === 0);
  }

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
