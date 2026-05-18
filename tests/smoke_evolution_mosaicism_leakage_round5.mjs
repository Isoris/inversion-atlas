const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/mosaicism_leakage.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/mosaicism_leakage/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

class FakeCtx{constructor(){this.calls=[]; this.fillStyle=''; this.strokeStyle=''; this.lineWidth=0;}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);}}
class FakeCanvas{constructor(id){this.id=id;this.width=800;this.height=320;this._ctx=new FakeCtx();this._listeners={};}
  getContext(){return this._ctx;}
  getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
  addEventListener(e,c){(this._listeners[e]=this._listeners[e]||[]).push(c);}
  removeEventListener(e,c){const l=this._listeners[e]||[];const i=l.indexOf(c);if(i>=0)l.splice(i,1);}
  dispatchEvent(e){const l=this._listeners[e.type]||[];for(const c of l)c(e);}}
class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.style={display:''};this._listeners={};}
  addEventListener(e,c){(this._listeners[e]=this._listeners[e]||[]).push(c);}
  removeEventListener(e,c){const l=this._listeners[e]||[];const i=l.indexOf(c);if(i>=0)l.splice(i,1);}
  dispatchEvent(e){const l=this._listeners[e.type]||[];for(const c of l)c(e);}}
const _nodes=new Map();
function _ensureNode(id){if (!_nodes.has(id)) _nodes.set(id, id==='mosCanvas'?new FakeCanvas(id):new FakeNode(id));return _nodes.get(id);}
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('unmount fn', typeof page.unmount === 'function');
check('refreshMosaicism fn', typeof page.refreshMosaicism === 'function');

group('Smoke: empty');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('mosEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: loaded');
{
  const dosage = [];
  for (let mi = 0; mi < 40; mi++) {
    if (mi < 20) dosage.push(Float64Array.from([2,2,2,2, 0,0,0,0]));
    else         dosage.push(Float64Array.from([0,2,2,2, 0,0,0,0]));
  }
  const atlasState = {
    inversion: {
      mosaicism_state: {
        dosage, n_markers: 40, n_samples: 8,
        inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
        candidate_label: 'LG28 mos',
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('candidate label', _ensureNode('mosCandidateLabel').textContent === 'LG28 mos');
  check('leak computed', ps.leak && ps.leak.n_windows === 2);
  check('integrity badge populated',
        _ensureNode('mosIntegrityBadge').textContent.length > 0
     && _ensureNode('mosIntegrityBadge').textContent !== '—');
  check('canvas painted',
        _ensureNode('mosCanvas')._ctx.calls.some(c => c[0]==='fillRect'));
  check('atlasState stash present',
        atlasState.inversion._page_mosaicism_state !== undefined);

  // Move over a cell.
  const L = ps.layout;
  const px = L.padX + L.cellW * 0.5;
  const py = L.padY + L.cellH * 0.5;
  _ensureNode('mosCanvas').dispatchEvent({ type: 'mousemove', clientX: px, clientY: py });
  check('hover populated',
        ps.hover && ps.hover.sample_idx === 0);

  // Window size change.
  const ws = _ensureNode('mosWindowSize');
  ws.value = '10';
  ws.dispatchEvent({ type: 'change', target: { value: '10' } });
  check('window_size_markers = 10', ps.view_state.window_size_markers === 10);

  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
