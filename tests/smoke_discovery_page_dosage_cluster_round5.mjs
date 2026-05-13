// tests/smoke_discovery_page_dosage_cluster_round5.mjs

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_dosage_cluster.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_dosage_cluster/_state.js`);

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
    this.id = id; this.width = 600; this.height = 320;
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
    _nodes.set(id, id === 'dosageClusterCurvesCanvas' ? new FakeCanvas(id) : new FakeNode(id));
  }
  return _nodes.get(id);
}
global.document = { body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`) };
global.window = global;

// =====================================================================
group('Module exports');
check('page has mount',                          typeof page.mount === 'function');
check('page has unmount',                        typeof page.unmount === 'function');
check('page has refreshDosageCluster',           typeof page.refreshDosageCluster === 'function');
check('page has initDosageClusterToolbar',       typeof page.initDosageClusterToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  check('candidate label = "—"',
        _ensureNode('dosageClusterCandidateLabel').textContent === '—');
  check('verdict badge = "—"',
        _ensureNode('dosageClusterVerdictBadge').textContent === '—');
  check('empty-state visible',
        _ensureNode('dosageClusterEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with a clustering result');
{
  const root = new FakeNode('atlas-root');
  const cluster_result = {
    verdict: 'structure_detected',
    K_chosen: 2,
    per_K: [
      { K: 1, passes: true, silhouette: 0, stability: 1, min_size: 10,
        spatial_coherence: 0, delta_sil: 0, labels: null, cluster_curves: null },
      { K: 2, passes: true, silhouette: 0.42, stability: 0.85,
        min_size: 5, spatial_coherence: 0.71, delta_sil: 0.42,
        labels: new Int32Array([0,0,1,1,0,1]),
        cluster_curves: [
          Float64Array.from([0.1, 0.2, 0.15, 0.18, 0.16]),
          Float64Array.from([1.7, 1.8, 1.75, 1.78, 1.76]),
        ] },
      { K: 3, passes: false, silhouette: 0.50, stability: 0.7,
        min_size: 2, spatial_coherence: 0.6, delta_sil: 0.08,
        labels: new Int32Array([0,1,2,0,1,2]),
        cluster_curves: [
          Float64Array.from([0.1, 0.2, 0.15]),
          Float64Array.from([1.2, 1.3, 1.25]),
          Float64Array.from([1.7, 1.8, 1.75]),
        ] },
    ],
    chosen_labels: new Int32Array([0,0,1,1,0,1]),
    chosen_curves: [
      Float64Array.from([0.1, 0.2, 0.15, 0.18, 0.16]),
      Float64Array.from([1.7, 1.8, 1.75, 1.78, 1.76]),
    ],
  };
  const atlasState = {
    inversion: {
      dosage_cluster_state: {
        cluster_result,
        candidate_label: 'LG28 clusters',
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  const c = _ensureNode('dosageClusterCurvesCanvas');
  check('canvas cleared',                         c._ctx.calls.some(x => x[0] === 'clearRect'));
  check('canvas stroked curves',                  c._ctx.calls.some(x => x[0] === 'stroke'));
  check('candidate label set',
        _ensureNode('dosageClusterCandidateLabel').textContent === 'LG28 clusters');
  check('verdict badge = "Structure detected"',
        _ensureNode('dosageClusterVerdictBadge').textContent === 'Structure detected');
  check('K badge shows K = 2',
        _ensureNode('dosageClusterKBadge').textContent.indexOf('K = 2') >= 0);
  check('per-K table populated',
        _ensureNode('dosageClusterPerKBody').innerHTML.indexOf('<table') >= 0);
  check('chosen-detail fields populated',
        _ensureNode('dosageClusterChosenFields').innerHTML.indexOf('silhouette') >= 0);
  check('empty-state hidden',
        _ensureNode('dosageClusterEmpty').style.display === 'none');

  // Click a per-K row → focus that K.
  const ps = state._pageState;
  c._ctx.calls.length = 0;
  _ensureNode('dosageClusterPerKBody').dispatchEvent({
    type: 'click',
    target: { getAttribute: (k) => k === 'data-k' ? '3' : null, parentNode: null },
  });
  check('table click sets focusedK = 3',
        ps.selection.getFocusedK() === 3);
  check('repaint fired (curves canvas cleared)',
        c._ctx.calls.some(x => x[0] === 'clearRect'));

  // Hover on the curve canvas — picks one cluster.
  // The hit regions are around the curves' average y. Use the first
  // band's center.
  if (ps.curve_hit_regions.length > 0) {
    const h = ps.curve_hit_regions[0];
    c.dispatchEvent({ type: 'mousemove',
      clientX: h.x + h.w / 2, clientY: h.y + h.h / 2 });
    check('hover sets hoveredCluster',
          ps.selection.getHoveredCluster() === h.cluster_id);
  } else {
    check('curve hit regions populated', false, 'no hits');
  }

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
