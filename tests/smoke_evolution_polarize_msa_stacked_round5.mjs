// tests/smoke_evolution_page_polarize_msa_round5.mjs

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/polarize_msa_stacked.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/polarize_msa_stacked/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

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
    this.id = id; this.width = 800; this.height = 360;
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
    _nodes.set(id, id === 'polarizeMsaCanvas' ? new FakeCanvas(id) : new FakeNode(id));
  }
  return _nodes.get(id);
}
global.document = { body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`) };
global.window = global;

// =====================================================================
group('Module exports');
check('mount fn',                                 typeof page.mount === 'function');
check('unmount fn',                               typeof page.unmount === 'function');
check('refreshPolarizeMsa fn',                    typeof page.refreshPolarizeMsa === 'function');
check('initPolarizeMsaToolbar fn',                typeof page.initPolarizeMsaToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                              ok, err ? err.message : '');
  check('candidate label = "—"',
        _ensureNode('polarizeMsaCandidateLabel').textContent === '—');
  check('verdict badge = "—"',
        _ensureNode('polarizeMsaVerdictBadge').textContent === '—');
  check('empty-state visible',
        _ensureNode('polarizeMsaEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared',                     state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with INV + STD + outgroup');
{
  const root = new FakeNode('atlas-root');
  const dosage = [
    Float64Array.from([2, 2, 2, 2, 0, 0, 0, 0]),
    Float64Array.from([0, 0, 0, 0, 2, 2, 2, 2]),
    Float64Array.from([1, 1, 2, 2, 0, 0, 0, 0]),
    Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0]),
    Float64Array.from([2, 2, 2, 2, 2, 2, 2, 2]),
  ];
  const atlasState = {
    inversion: {
      polarize_msa_state: {
        dosage, n_markers: 5, n_samples: 8,
        inv_idx: [0, 1, 2, 3],
        std_idx: [4, 5],
        outgroup_idx: [6, 7],
        candidate_label: 'LG28 polarize',
        marker_labels: ['M0', 'M1', 'M2', 'M3', 'M4'],
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                              ok, err ? err.message : '');
  const c = _ensureNode('polarizeMsaCanvas');
  check('canvas cleared',                           c._ctx.calls.some(x => x[0] === 'clearRect'));
  check('canvas painted (fillRect cells)',          c._ctx.calls.some(x => x[0] === 'fillRect'));
  check('candidate label set',
        _ensureNode('polarizeMsaCandidateLabel').textContent === 'LG28 polarize');
  check('verdict badge populated',
        _ensureNode('polarizeMsaVerdictBadge').textContent !== '—');
  check('sites count populated',
        _ensureNode('polarizeMsaSitesCount').textContent.indexOf('5') >= 0);
  check('empty-state hidden',
        _ensureNode('polarizeMsaEmpty').style.display === 'none');
  check('row legend populated',
        _ensureNode('polarizeMsaRowLegendBody').innerHTML.indexOf('INV founder') >= 0);
  check('tier summary populated',
        _ensureNode('polarizeMsaTierBody').innerHTML.indexOf('high') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_polarize_msa_state !== undefined);

  // Hover the matrix.
  const ps = state._pageState;
  const layout = ps.layout;
  {
    const px = layout.matX + layout.cellW * 0.5;
    const py = layout.matY + layout.cellH * 0.5;
    c.dispatchEvent({ type: 'mousemove', clientX: px, clientY: py });
    check('hover tracked',                          ps.selection.getHoveredCell() !== null);
    check('right panel updated with Row entry',
          _ensureNode('polarizeMsaSelectedFields').innerHTML.indexOf('Row') >= 0);
  }

  // Click toggles row selection.
  {
    const px = layout.matX + layout.cellW * 0.5;
    const py = layout.matY + layout.cellH * 0.5;
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('row 0 added to selection',
          ps.selection.getSelectedRows().has(0));
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py });
    check('row 0 removed',
          !ps.selection.getSelectedRows().has(0));
    // Shift-click → site.
    c.dispatchEvent({ type: 'click', clientX: px, clientY: py, shiftKey: true });
    check('shift-click adds site',
          ps.selection.getSelectedSites().has(0));
  }

  // Toggle confidence stripe.
  {
    c._ctx.calls.length = 0;
    const cb = _ensureNode('polarizeMsaShowConfidence');
    cb.checked = false;
    cb.dispatchEvent({ type: 'change', target: { checked: false } });
    check('confidence stripe toggle clears repainted',
          c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.show_confidence_stripe = false',
          ps.view_state.show_confidence_stripe === false);
  }

  // K subgroups change → rebuild.
  {
    c._ctx.calls.length = 0;
    const ks = _ensureNode('polarizeMsaKSubgroups');
    ks.value = '4';
    ks.dispatchEvent({ type: 'change', target: { value: '4' } });
    check('K change repaints',                      c._ctx.calls.some(x => x[0] === 'clearRect'));
    check('view_state.K_max = 4',                   ps.view_state.K_max === 4);
  }

  // Consensus mode → rebuild.
  {
    const cm = _ensureNode('polarizeMsaConsensusMode');
    cm.value = 'mrca';
    cm.dispatchEvent({ type: 'change', target: { value: 'mrca' } });
    check('view_state.consensus_mode = mrca',
          ps.view_state.consensus_mode === 'mrca');
  }

  await page.unmount(root);
  check('_pageState cleared',                     state._pageState === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
