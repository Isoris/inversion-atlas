// tests/test_shared_mgl_event_tree.js
import {
  carrierOverlap, classifyPairRelationships, ageRank, buildEventTree,
  MGL_EVENT_TREE_DEFAULTS,
} from '../atlases/inversion/shared/mgl_event_tree.js';

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

group('exports');
check('frozen defaults', Object.isFrozen(MGL_EVENT_TREE_DEFAULTS));

group('carrierOverlap');
// 6 samples, 3 candidates.
// cand 0: carriers [1,1,1,1,0,0]  (size 4)
// cand 1: carriers [0,1,1,0,0,0]  (size 2, NESTED in 0)
// cand 2: carriers [0,0,0,0,1,1]  (size 2, MUTUAL EXCLUSIVE with 0/1)
const carriers = Uint8Array.from([
  1, 0, 0,
  1, 1, 0,
  1, 1, 0,
  1, 0, 0,
  0, 0, 1,
  0, 0, 1,
]);
const o = carrierOverlap(carriers, 6, 3);
check('size cand0 = 4', o.per_candidate_count[0] === 4);
check('size cand1 = 2', o.per_candidate_count[1] === 2);
check('size cand2 = 2', o.per_candidate_count[2] === 2);
check('overlap(0,1) = 2', o.pair_overlap[0 * 3 + 1] === 2);
check('overlap(0,2) = 0', o.pair_overlap[0 * 3 + 2] === 0);
check('symmetric', o.pair_overlap[1 * 3 + 0] === o.pair_overlap[0 * 3 + 1]);

group('classifyPairRelationships');
const pairs = classifyPairRelationships(o);
check('3 ordered pairs', pairs.length === 3);
const p01 = pairs.find(p => (p.a === 0 && p.b === 1) || (p.a === 1 && p.b === 0));
check('(0, 1) nested (2/2 overlap)', p01.relationship === 'nested');
const p02 = pairs.find(p => (p.a === 0 && p.b === 2) || (p.a === 2 && p.b === 0));
check('(0, 2) mutual_exclusive', p02.relationship === 'mutual_exclusive');
const p12 = pairs.find(p => (p.a === 1 && p.b === 2) || (p.a === 2 && p.b === 1));
check('(1, 2) mutual_exclusive', p12.relationship === 'mutual_exclusive');

group('ageRank');
const per = [
  { id: 'inv0', pi_inv: 0.010, dxy: 0.015, private_inv: 50, outgroup_present: true },
  { id: 'inv1', pi_inv: 0.001, dxy: 0.001, private_inv: 5,  outgroup_present: false },
  { id: 'inv2', pi_inv: 0.005, dxy: 0.005, private_inv: 20, outgroup_present: false },
];
const r = ageRank(per);
check('inv0 ranked oldest', r[0].id === 'inv0' && r[0].age_rank === 0);
check('inv1 + inv2 tied as youngest (score 0)',
      r[1].age_score === 0 && r[2].age_score === 0);
check('null → []', ageRank(null).length === 0);

group('buildEventTree');
const e = buildEventTree({
  carriers, n_samples: 6, n_candidates: 3,
  per_candidate: per,
});
check('per_candidate_count present', e.per_candidate_count.length === 3);
check('pairs.length = 3', e.pairs.length === 3);
check('age_rank.length = 3', e.age_rank.length === 3);

check('null args → empty result',
      buildEventTree(null).pairs.length === 0);

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
