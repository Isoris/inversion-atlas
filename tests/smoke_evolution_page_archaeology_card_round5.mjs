const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_archaeology_card.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_archaeology_card/_state.js`);

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

class FakeNode{constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.style={display:''};}}
const _nodes=new Map();
function _ensureNode(id){if (!_nodes.has(id)) _nodes.set(id, new FakeNode(id));return _nodes.get(id);}
global.document={body:new FakeNode('body'),getElementById:id=>_ensureNode(id),createElement:()=>new FakeNode()};
global.window=global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('refreshArchaeology fn', typeof page.refreshArchaeology === 'function');

group('Smoke: empty');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('empty visible', _ensureNode('acEmpty').style.display === '');
  check('verdict badge = "—"',
        _ensureNode('acVerdictBadge').textContent === '—');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}
_nodes.clear();

group('Smoke: young_clean fixture');
{
  const atlasState = {
    inversion: {
      archaeology_card_state: {
        candidate_label: 'LG28 ac',
        metrics: {
          pi_inv: 0.001, pi_std: 0.005, dxy: 0.005, fst_hudson: 0.6,
          private_inv: 5, private_std: 10, fixed_differences: 0,
          arrangement_frequency: 0.15, leakage_score: 0.05,
        },
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('verdict young_clean', ps.card.verdict === 'young_clean');
  check('badge populated',
        _ensureNode('acVerdictBadge').textContent === 'Young, clean');
  check('reason box populated',
        _ensureNode('acReasonBox').textContent.indexOf('low pi_inv') >= 0);
  check('interpretation box populated',
        _ensureNode('acInterpretationBox').textContent.indexOf('recent') >= 0);
  check('metrics body populated',
        _ensureNode('acMetricsBody').innerHTML.indexOf('π_INV') >= 0);
  check('confidence body populated',
        _ensureNode('acConfBody').textContent.indexOf('%') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_archaeology_card_state !== undefined);
  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
