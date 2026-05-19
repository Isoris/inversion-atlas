const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/age_divergence.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/age_divergence/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- ' + n + ' ---'); }

class FakeCtx { constructor(){this.calls=[]; this.fillStyle=''; this.strokeStyle=''; this.font=''; this.lineWidth=0;}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);} fillText(...a){this.calls.push(['fillText',...a]);} }
class FakeCanvas{constructor(id){this.id=id;this.width=600;this.height=220;this._ctx=new FakeCtx();}getContext(){return this._ctx;}}
class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.style={display:''};}}
const _nodes=new Map();
function _ensureNode(id){ if (!_nodes.has(id)) _nodes.set(id, id==='ageCanvas'?new FakeCanvas(id):new FakeNode(id)); return _nodes.get(id); }
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('unmount fn', typeof page.unmount === 'function');
check('refreshAge fn', typeof page.refreshAge === 'function');

group('Smoke: empty atlasState');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('ageEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: divergence computed');
{
  const dosage = [];
  for (let mi = 0; mi < 4; mi++) dosage.push(Float64Array.from([2,2,2,2, 0,0,0,0]));
  dosage.push(Float64Array.from([1,1,0,0, 0,0,0,0]));
  dosage.push(Float64Array.from([1,1,0,0, 0,0,0,0]));
  dosage.push(Float64Array.from([0,0,0,0, 1,1,0,0]));
  dosage.push(Float64Array.from([0,0,0,0, 1,1,0,0]));
  const atlasState = {
    inversion: {
      age_state: {
        dosage, n_markers: 8, n_samples: 8,
        inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
        candidate_label: 'LG28 age',
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('candidate label set',
        _ensureNode('ageCandidateLabel').textContent === 'LG28 age');
  check('age_class populated',
        typeof ps.metrics.age_class === 'string');
  check('badge populated',
        _ensureNode('ageClassBadge').textContent.length > 0
     && _ensureNode('ageClassBadge').textContent !== '—');
  check('canvas painted (bars)',
        _ensureNode('ageCanvas')._ctx.calls.some(c => c[0] === 'fillRect'));
  check('metrics body populated',
        _ensureNode('ageMetricsBody').innerHTML.indexOf('π_INV') >= 0);
  check('reason body populated',
        _ensureNode('ageReasonBody').textContent.length > 0);
  check('atlasState stash present',
        atlasState.inversion._page_age_state !== undefined);
  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
