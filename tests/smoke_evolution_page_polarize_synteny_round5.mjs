// tests/smoke_evolution_page_polarize_synteny_round5.mjs

const WORKSPACE = process.env.WORKSPACE || '/home/user/inversion-atlas';
const page  = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_polarize_synteny.js`);
const state = await import(`${WORKSPACE}/atlases/inversion/pages/evolution/page_evolution_polarize_synteny/_state.js`);

let pass=0, fail=0;
function check(label, cond) { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label); } }
function group(name) { console.log('\n--- ' + name + ' ---'); }

class FakeCtx { constructor(){this.calls=[]; this.fillStyle=''; this.strokeStyle=''; this.font=''; this.lineWidth=0;}
  clearRect(...a){this.calls.push(['clearRect',...a]);} fillRect(...a){this.calls.push(['fillRect',...a]);}
  strokeRect(...a){this.calls.push(['strokeRect',...a]);} fillText(...a){this.calls.push(['fillText',...a]);} }
class FakeCanvas { constructor(id){this.id=id; this.width=600; this.height=80; this._ctx=new FakeCtx();}
  getContext(){return this._ctx;} }
class FakeNode { constructor(id){this.id=id; this.innerHTML=''; this.textContent=''; this.style={display:''};} }
const _nodes=new Map();
function _ensureNode(id){ if (!_nodes.has(id)) _nodes.set(id, id==='syntenyCanvas' ? new FakeCanvas(id) : new FakeNode(id)); return _nodes.get(id); }
global.document = { body: new FakeNode('body'), getElementById: (id) => _ensureNode(id), createElement: () => new FakeNode() };
global.window = global;

group('exports');
check('mount fn', typeof page.mount === 'function');
check('unmount fn', typeof page.unmount === 'function');
check('refreshSynteny fn', typeof page.refreshSynteny === 'function');

group('Smoke: empty atlasState');
{
  const root = new FakeNode('atlas-root');
  await page.mount(root, { inversion: {} }, {});
  check('verdict badge populated',
        _ensureNode('syntenyVerdictBadge').textContent.length > 0);
  check('empty visible',
        _ensureNode('syntenyEmpty').style.display === '');
  await page.unmount(root);
  check('_pageState cleared', state._pageState === null);
}

_nodes.clear();

group('Smoke: votes loaded');
{
  const atlasState = {
    inversion: {
      polarize_synteny_state: {
        candidate_label: 'LG28 syn',
        votes: [
          { species: 'C. macrocephalus', vote: 'matches_A', confidence: 0.9 },
          { species: 'C. batrachus',     vote: 'matches_A', confidence: 0.8 },
          { species: 'C. magur',         vote: 'matches_A', confidence: 0.95 },
          { species: 'C. fuscus',        vote: 'matches_B', confidence: 0.6 },
          { species: 'C. anguillaris',   vote: 'unresolved' },
        ],
      },
    },
  };
  const root = new FakeNode('atlas-root');
  await page.mount(root, atlasState, {});
  const ps = state._pageState;
  check('candidate label set',
        _ensureNode('syntenyCandidateLabel').textContent === 'LG28 syn');
  check('aggregate computed',
        ps.aggregate && ps.aggregate.n_a === 3 && ps.aggregate.n_b === 1);
  check('verdict ancestral=A',
        ps.aggregate.verdict === 'ancestral=A');
  check('canvas painted',
        _ensureNode('syntenyCanvas')._ctx.calls.some(c => c[0]==='fillRect'));
  check('votes body lists species',
        _ensureNode('syntenyVotesBody').innerHTML.indexOf('C. magur') >= 0);
  check('summary shows counts',
        _ensureNode('syntenyVoteSummary').textContent.indexOf('A=3') >= 0);
  check('atlasState stash present',
        atlasState.inversion._page_polarize_synteny_state !== undefined);
  check('empty hidden',
        _ensureNode('syntenyEmpty').style.display === 'none');
  await page.unmount(root);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
