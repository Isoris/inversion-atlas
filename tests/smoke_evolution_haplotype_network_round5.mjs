// tests/smoke_evolution_page_haplotype_network_round5.mjs

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/haplotype_network.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/haplotype_network/_state.js`);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

class FakeCtx {
  constructor() { this.calls = []; this.fillStyle=''; this.strokeStyle=''; this.lineWidth=0; this.font=''; }
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
  constructor(id) { this.id=id; this.width=800; this.height=400; this._ctx=new FakeCtx(); this._listeners={}; this.style={display:''}; }
  getContext() { return this._ctx; }
  getBoundingClientRect() { return { left:0, top:0, width:this.width, height:this.height }; }
  addEventListener(evt, cb) { (this._listeners[evt]=this._listeners[evt]||[]).push(cb); }
  removeEventListener(evt, cb) { const l=this._listeners[evt]||[]; const i=l.indexOf(cb); if (i>=0) l.splice(i,1); }
  dispatchEvent(evt) { const l=this._listeners[evt.type]||[]; for (const cb of l) cb(evt); }
}
class FakeNode {
  constructor(id) { this.id=id; this.innerHTML=''; this.textContent=''; this.value=''; this.checked=false; this.style={display:''}; this._listeners={}; this.children=[]; }
  addEventListener(evt, cb) { (this._listeners[evt]=this._listeners[evt]||[]).push(cb); }
  removeEventListener(evt, cb) { const l=this._listeners[evt]||[]; const i=l.indexOf(cb); if (i>=0) l.splice(i,1); }
  dispatchEvent(evt) { const l=this._listeners[evt.type]||[]; for (const cb of l) cb(evt); }
  appendChild(c) { this.children.push(c); }
  setAttribute(k, v) { this[k]=v; }
  getAttribute(k) { return this[k]; }
}
const _nodes=new Map();
function _ensureNode(id) {
  if (!_nodes.has(id)) _nodes.set(id, id==='hapNetCanvas' ? new FakeCanvas(id) : new FakeNode(id));
  return _nodes.get(id);
}
global.document = { body: new FakeNode('body'),
  getElementById: (id) => _ensureNode(id),
  createElement: (tag) => new FakeNode(`<${tag}>`) };
global.window = global;

// =====================================================================
group('exports');
check('mount fn',                                 typeof page.mount === 'function');
check('unmount fn',                               typeof page.unmount === 'function');
check('refreshHapNet fn',                         typeof page.refreshHapNet === 'function');
check('initHapNetToolbar fn',                     typeof page.initHapNetToolbar === 'function');

// =====================================================================
group('Smoke: empty atlasState');
{
  const root = new FakeNode('atlas-root');
  const atlasState = { inversion: {}, shared: {} };
  let ok=true, err=null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok=false; err=e; }
  check('mount() ran',                              ok, err ? err.message : '');
  check('empty-state visible',
        _ensureNode('hapNetEmpty').style.display === '');
  check('summary badge = "—"',
        _ensureNode('hapNetSummaryBadge').textContent === '—');
  await page.unmount(root);
  check('_pageState cleared',                       state._pageState === null);
}

_nodes.clear();

// =====================================================================
group('Smoke: mount with INV samples');
{
  const root = new FakeNode('atlas-root');
  // 6 samples; pick inv_idx=[0..3] with 2 distinct sub-haplotypes.
  const dosage = [
    Float64Array.from([2, 2, 0, 0, 0, 0]),
    Float64Array.from([0, 0, 2, 2, 0, 0]),
    Float64Array.from([2, 0, 2, 0, 0, 0]),
    Float64Array.from([1, 1, 1, 1, 0, 0]),
    Float64Array.from([0, 1, 0, 1, 1, 1]),
  ];
  const atlasState = {
    inversion: {
      haplotype_network_state: {
        dosage, n_markers: 5, n_samples: 6,
        inv_idx: [0, 1, 2, 3],
        candidate_label: 'LG28 hapnet',
      },
    },
    shared: {},
  };
  let ok=true, err=null;
  try { await page.mount(root, atlasState, {}); } catch (e) { ok=false; err=e; }
  check('mount() ran',                              ok, err ? err.message : '');
  const c = _ensureNode('hapNetCanvas');
  check('canvas cleared',                           c._ctx.calls.some(x => x[0]==='clearRect'));
  check('candidate label set',
        _ensureNode('hapNetCandidateLabel').textContent === 'LG28 hapnet');
  check('summary badge populated',
        _ensureNode('hapNetSummaryBadge').textContent.indexOf('node') >= 0);
  check('node list populated',
        _ensureNode('hapNetNodeBody').innerHTML.indexOf('node') >= 0);
  check('empty-state hidden',
        _ensureNode('hapNetEmpty').style.display === 'none');
  check('atlasState stash present',
        atlasState.inversion._page_haplotype_network_state !== undefined);

  // Hover a node.
  const ps = state._pageState;
  if (ps.node_hit_regions.length > 0) {
    const h = ps.node_hit_regions[0];
    c.dispatchEvent({ type: 'mousemove', clientX: h.x, clientY: h.y });
    check('hover tracked',                           ps.selection.getHoveredNode() === h.node_id);
    check('right panel shows Node id',
          _ensureNode('hapNetSelectedFields').innerHTML.indexOf('Node id') >= 0);
  } else {
    check('node hit regions populated', false, 'no hits');
  }

  // Click toggles node selection.
  if (ps.node_hit_regions.length > 0) {
    const h = ps.node_hit_regions[0];
    c.dispatchEvent({ type: 'click', clientX: h.x, clientY: h.y });
    check('click adds node to selection',
          ps.selection.getSelectedNodes().has(h.node_id));
    c.dispatchEvent({ type: 'click', clientX: h.x, clientY: h.y });
    check('click again removes',
          !ps.selection.getSelectedNodes().has(h.node_id));
  }

  // Toolbar: hamming radius.
  {
    c._ctx.calls.length = 0;
    const hr = _ensureNode('hapNetHammingRadius');
    hr.value = '4';
    hr.dispatchEvent({ type: 'change', target: { value: '4' } });
    check('view_state.hamming_radius = 4',
          ps.view_state.hamming_radius === 4);
    check('repaint after radius change',
          c._ctx.calls.some(x => x[0]==='clearRect'));
  }

  // Layout seed change.
  {
    const ls = _ensureNode('hapNetLayoutSeed');
    ls.value = '99';
    ls.dispatchEvent({ type: 'change', target: { value: '99' } });
    check('view_state.layout_seed = 99',
          ps.view_state.layout_seed === 99);
  }

  await page.unmount(root);
  check('_pageState cleared',                       state._pageState === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
