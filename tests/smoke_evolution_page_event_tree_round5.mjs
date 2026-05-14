const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_event_tree.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_event_tree/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

class FakeCtx{constructor(){this.calls=[];this.fillStyle='';this.strokeStyle='';this.lineWidth=0;}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);}}
class FakeCanvas{constructor(id){this.id=id;this.width=600;this.height=400;this._ctx=new FakeCtx();}getContext(){return this._ctx;}}
class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.style={display:''};}}
const _nodes=new Map();
function _ensureNode(id){if (!_nodes.has(id)) _nodes.set(id, id==='etCanvas'?new FakeCanvas(id):new FakeNode(id));return _nodes.get(id);}
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('refreshEventTree fn', typeof page.refreshEventTree === 'function');

group('Smoke: empty');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('etEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: tree computed');
{
  const carriers = Uint8Array.from([
    1, 0, 0,
    1, 1, 0,
    1, 1, 0,
    1, 0, 0,
    0, 0, 1,
    0, 0, 1,
  ]);
  const atlasState = {
    inversion: {
      event_tree_state: {
        carriers, n_samples: 6, n_candidates: 3,
        chrom_label: 'LG28',
        per_candidate: [
          { id: 'inv0', label: 'INV-A' },
          { id: 'inv1', label: 'INV-B' },
          { id: 'inv2', label: 'INV-C' },
        ],
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('chrom label set', _ensureNode('etChromLabel').textContent === 'LG28');
  check('tree built', ps.tree && ps.tree.pairs.length === 3);
  check('summary badge populated',
        _ensureNode('etSummaryBadge').textContent.indexOf('nested') >= 0);
  check('canvas painted',
        _ensureNode('etCanvas')._ctx.calls.some(c => c[0] === 'fillRect'));
  check('pairs body populated',
        _ensureNode('etPairsBody').innerHTML.indexOf('INV-A') >= 0);
  check('age body populated',
        _ensureNode('etAgeBody').innerHTML.indexOf('rank') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_event_tree_state !== undefined);
  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
