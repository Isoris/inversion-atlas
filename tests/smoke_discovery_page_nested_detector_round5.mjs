// tests/smoke_discovery_page_nested_detector_round5.mjs

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_nested_detector.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/discovery/page_nested_detector/_state.js`);

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
    this.id = id; this.width = 800; this.height = 160;
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
    _nodes.set(id, id === 'nestedDetectorTracksCanvas' ? new FakeCanvas(id) : new FakeNode(id));
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
check('page has refreshNestedDetector',          typeof page.refreshNestedDetector === 'function');
check('page has initNestedDetectorToolbar',      typeof page.initNestedDetectorToolbar === 'function');

// =====================================================================
group('Smoke: mount on empty atlasState');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  check('candidate label = "—"',
        _ensureNode('nestedDetectorCandidateLabel').textContent === '—');
  check('verdict badge = "—"',
        _ensureNode('nestedDetectorVerdictBadge').textContent === '—');
  check('empty-state visible',
        _ensureNode('nestedDetectorEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with a detector result');
{
  const root = new FakeNode('atlas-root');
  const result = {
    verdict: 'nested_detected',
    strata_scanned: ['HOM1', 'HET'],
    per_stratum_candidates: {
      HOM1: [
        { window_start: 2, window_end: 4, silhouette: 0.6 },
        { window_start: 7, window_end: 8, silhouette: 0.5 },
      ],
      HET:  [{ window_start: 3, window_end: 5, silhouette: 0.7 }],
      HOM2: [],
    },
    inner_intervals: [
      { window_start: 2, window_end: 5, strata: ['HOM1', 'HET'],
        combined_silhouette: 0.65 },
    ],
  };
  const atlasState = {
    inversion: {
      nested_detector_state: {
        detector_result: result,
        candidate_label: 'LG28 nested',
        n_windows: 10,
      },
    },
    shared: {},
  };
  let ok = true, err = null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok = false; err = e; }
  check('mount() ran',                            ok, err ? err.message : '');
  const c = _ensureNode('nestedDetectorTracksCanvas');
  check('canvas cleared',                         c._ctx.calls.some(x => x[0] === 'clearRect'));
  check('canvas painted (fillRect)',              c._ctx.calls.some(x => x[0] === 'fillRect'));
  check('candidate label set',
        _ensureNode('nestedDetectorCandidateLabel').textContent === 'LG28 nested');
  check('verdict badge = "Nested detected"',
        _ensureNode('nestedDetectorVerdictBadge').textContent === 'Nested detected');
  check('strata badge populated',
        _ensureNode('nestedDetectorStrataBadge').textContent.indexOf('HOM1, HET') >= 0);
  check('inner intervals body populated',
        _ensureNode('nestedDetectorIntervalsBody').innerHTML.indexOf('Interval 0') >= 0);
  check('candidates list populated',
        _ensureNode('nestedDetectorCandidatesBody').innerHTML.indexOf('HOM1') >= 0);
  check('empty-state hidden',
        _ensureNode('nestedDetectorEmpty').style.display === 'none');

  // Hover an interval.
  const ps = state._pageState;
  const ivHit = ps.interval_hit_regions[0];
  c.dispatchEvent({ type: 'mousemove',
    clientX: ivHit.x + ivHit.w / 2, clientY: ivHit.y + ivHit.h / 2 });
  check('hover interval tracked',
        ps.selection.getHoveredInterval() === 0);

  // Click toggles selection.
  c.dispatchEvent({ type: 'click',
    clientX: ivHit.x + ivHit.w / 2, clientY: ivHit.y + ivHit.h / 2 });
  check('click adds interval 0 to selection',
        ps.selection.getSelectedIntervals().has(0));
  c.dispatchEvent({ type: 'click',
    clientX: ivHit.x + ivHit.w / 2, clientY: ivHit.y + ivHit.h / 2 });
  check('click again removes interval',
        !ps.selection.getSelectedIntervals().has(0));

  await page.unmount(root);
  check('_pageState cleared',                  state._pageState === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
