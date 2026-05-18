const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/inv_internal_substructure.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/inv_internal_substructure/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

class FakeCtx{constructor(){this.calls=[]; this.fillStyle=''; this.strokeStyle='';}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);}}
class FakeCanvas{constructor(id){this.id=id;this.width=500;this.height=400;this._ctx=new FakeCtx();}getContext(){return this._ctx;}}
class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.style={display:''};}}
const _nodes=new Map();
function _ensureNode(id){if (!_nodes.has(id)) _nodes.set(id, id==='ihCanvas'?new FakeCanvas(id):new FakeNode(id));return _nodes.get(id);}
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('refreshInternalHistory fn', typeof page.refreshInternalHistory === 'function');

group('Smoke: empty');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('ihEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: PCA computed');
{
  // 8 samples, inv_idx=[0..5], 12 markers with two latent sub-groups
  const dosage = [];
  for (let mi = 0; mi < 12; mi++) {
    // First 3 samples → high dosage at first 6 markers; next 3 → high at last 6.
    if (mi < 6) dosage.push(Float64Array.from([2, 2, 2, 0, 0, 0, 0, 0]));
    else        dosage.push(Float64Array.from([0, 0, 0, 2, 2, 2, 0, 0]));
  }
  const atlasState = {
    inversion: {
      internal_history_state: {
        dosage, n_markers: 12, n_samples: 8,
        inv_idx: [0,1,2,3,4,5],
        candidate_label: 'LG28 ih',
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('candidate label', _ensureNode('ihCandidateLabel').textContent === 'LG28 ih');
  check('pca populated', ps.pca && ps.pca.pc1 && ps.pca.pc1.length === 6);
  check('lam1 finite', Number.isFinite(ps.pca.lam1));
  check('canvas painted',
        _ensureNode('ihCanvas')._ctx.calls.some(c => c[0]==='fillRect'));
  check('metrics body populated',
        _ensureNode('ihMetricsBody').innerHTML.indexOf('λ1') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_internal_history_state !== undefined);
  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
