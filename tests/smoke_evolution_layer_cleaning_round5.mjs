const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/layer_cleaning.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/layer_cleaning/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

class FakeCtx{constructor(){this.calls=[];this.fillStyle='';this.strokeStyle='';this.lineWidth=0;}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);}}
class FakeCanvas{constructor(id){this.id=id;this.width=800;this.height=300;this._ctx=new FakeCtx();}getContext(){return this._ctx;}}
class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.value='';this.style={display:''};this._listeners={};}
  addEventListener(e,c){(this._listeners[e]=this._listeners[e]||[]).push(c);}
  removeEventListener(e,c){const l=this._listeners[e]||[];const i=l.indexOf(c);if(i>=0)l.splice(i,1);}
  dispatchEvent(e){const l=this._listeners[e.type]||[];for(const c of l)c(e);}}
const _nodes=new Map();
function _ensureNode(id){if (!_nodes.has(id)) _nodes.set(id, id==='lcCanvas'?new FakeCanvas(id):new FakeNode(id));return _nodes.get(id);}
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('refreshLayerCleaning fn', typeof page.refreshLayerCleaning === 'function');

group('Smoke: empty');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('lcEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: weights computed');
{
  const atlasState = {
    inversion: {
      layer_cleaning_state: {
        n_samples: 5,
        kinship: Float64Array.from([
          1, 0.5, 0, 0, 0,
          0.5, 1, 0, 0, 0,
          0, 0, 1, 0, 0,
          0, 0, 0, 1, 0,
          0, 0, 0, 0, 1,
        ]),
        family_ids: ['A', 'A', 'B', null, null],
        hatchery_dup: [false, false, false, true, false],
        candidate_label: 'LG28 lc',
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('candidate label', _ensureNode('lcCandidateLabel').textContent === 'LG28 lc');
  check('weights computed', ps.weights.length === 5);
  check('summary populated', ps.summary && ps.summary.n_total === 5);
  check('canvas painted',
        _ensureNode('lcCanvas')._ctx.calls.some(c => c[0]==='fillRect'));
  check('counts body populated',
        _ensureNode('lcCountsBody').innerHTML.indexOf('n total') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_layer_cleaning_state !== undefined);

  // Kinship threshold change.
  const kt = _ensureNode('lcKinshipThr');
  kt.value = '0.6';
  kt.dispatchEvent({ type: 'change', target: { value: '0.6' } });
  check('kinship_threshold = 0.6', ps.view_state.kinship_threshold === 0.6);

  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
