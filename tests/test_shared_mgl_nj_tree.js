// tests/test_shared_mgl_nj_tree.js
//
// Unit coverage for shared/mgl_nj_tree.js — neighbor-joining tree
// builder, distance helpers, clade labels, Newick serialization.

import {
  pairwiseEuclideanFromDosage,
  pairwiseMeanAbsDiffFromDosage,
  buildNjTree,
  cladeLabelsAtK,
  toNewickString,
} from '../atlases/inversion/shared/mgl_nj_tree.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('pairwiseEuclideanFromDosage');

// 1 marker × 4 samples, values [0, 1, 2, 3].
// d(0,1)=1, d(0,2)=2, d(0,3)=3, d(1,2)=1, d(1,3)=2, d(2,3)=1
const d1 = new Float64Array([0, 1, 2, 3]);
const D1 = pairwiseEuclideanFromDosage(d1, 1, 4);
check('D(0,0) = 0',                  Math.abs(D1[0 * 4 + 0]) < 1e-9);
check('D(0,1) = 1',                  Math.abs(D1[0 * 4 + 1] - 1) < 1e-9);
check('D(0,3) = 3',                  Math.abs(D1[0 * 4 + 3] - 3) < 1e-9);
check('D is symmetric',              Math.abs(D1[3 * 4 + 0] - D1[0 * 4 + 3]) < 1e-9);
check('D(1,2) = 1',                  Math.abs(D1[1 * 4 + 2] - 1) < 1e-9);

// =====================================================================
group('pairwiseMeanAbsDiffFromDosage');

// 2 markers × 3 samples
// M0: [1, 4, 9]  M1: [2, 6, 10]
// d(0,1) = (|1-4| + |2-6|)/2 = (3+4)/2 = 3.5
// d(0,2) = (|1-9| + |2-10|)/2 = (8+8)/2 = 8.0
// d(1,2) = (|4-9| + |6-10|)/2 = (5+4)/2 = 4.5
const d2 = new Float64Array([1, 4, 9, 2, 6, 10]);
const D2 = pairwiseMeanAbsDiffFromDosage(d2, 2, 3);
check('mean-abs D(0,1) = 3.5',       Math.abs(D2[0 * 3 + 1] - 3.5) < 1e-9);
check('mean-abs D(0,2) = 8.0',       Math.abs(D2[0 * 3 + 2] - 8.0) < 1e-9);
check('mean-abs D(1,2) = 4.5',       Math.abs(D2[1 * 3 + 2] - 4.5) < 1e-9);

// =====================================================================
group('buildNjTree — 4 leaves');

// Classical NJ example (Wikipedia): 4 leaves, distance matrix
//       a    b    c    d
//   a   0    5    9   9
//   b   5    0   10  10
//   c   9   10    0   8
//   d   9   10    8   0
// NJ should join (a,b) first (closest pair after Q-minimization).
const D_nj = [
  [0, 5, 9, 9],
  [5, 0, 10, 10],
  [9, 10, 0, 8],
  [9, 10, 8, 0],
];
const tree = buildNjTree(D_nj, ['a', 'b', 'c', 'd']);
check('4 leaves',                    tree.n_leaves === 4);
check('root_id valid',               tree.root_id >= 0 && tree.root_id < tree.nodes.length);
check('every leaf has parent',
      [0,1,2,3].every(i => tree.nodes[i].parent_id !== null));
check('leaves are leaves',
      [0,1,2,3].every(i => tree.nodes[i].is_leaf === true));
check('leaf labels preserved',
      tree.nodes[0].leaf_label === 'a' && tree.nodes[2].leaf_label === 'c');

// First-joined pair: a (id 0) and b (id 1) should share a parent.
check('a and b are siblings (closest pair)',
      tree.nodes[0].parent_id === tree.nodes[1].parent_id);

// Branch lengths from the classical example:
//   L_au = 5/2 + (sumA - sumB) / (2*(n-2)) = 2.5 + (23 - 25)/4 = 2.5 - 0.5 = 2
//   L_bu = 5 - 2 = 3
check('L_au ≈ 2',                    Math.abs(tree.nodes[0].branch_length - 2) < 1e-3);
check('L_bu ≈ 3',                    Math.abs(tree.nodes[1].branch_length - 3) < 1e-3);

// =====================================================================
group('buildNjTree — input shapes');

// Float64Array input
const flat = new Float64Array([
  0, 5, 9, 9,
  5, 0, 10, 10,
  9, 10, 0, 8,
  9, 10, 8, 0,
]);
const tree_flat = buildNjTree(flat, ['a','b','c','d']);
check('Float64Array input works',    tree_flat.n_leaves === 4);

// Edge cases
check('n=0 → empty tree',            buildNjTree([], []).n_leaves === 0);
check('n=1 → empty tree',            buildNjTree([[0]], ['x']).n_leaves === 1);

// =====================================================================
group('cladeLabelsAtK');

// On the 4-leaf tree above:
// K=2 should yield {a,b} vs {c,d} since the longest internal edge
// connects the (a,b)-internal subtree to the (c,d)-internal subtree.
const labels_k2 = cladeLabelsAtK(tree, 2);
check('K=2 → 4 labels',              labels_k2.length === 4);
check('K=2: a and b same clade',     labels_k2[0] === labels_k2[1]);
check('K=2: c and d same clade',     labels_k2[2] === labels_k2[3]);
check('K=2: a/b distinct from c/d',  labels_k2[0] !== labels_k2[2]);

// K=1 = everyone in one clade
const labels_k1 = cladeLabelsAtK(tree, 1);
check('K=1 → all clade_0',           labels_k1.every(l => l === 'clade_0'));

// K=4 = every leaf its own clade
const labels_k4 = cladeLabelsAtK(tree, 4);
check('K=4: 4 distinct labels',
      new Set(labels_k4).size === 4);

// K > n_leaves clamped to n_leaves
const labels_k10 = cladeLabelsAtK(tree, 10);
check('K=10 (n=4): every leaf its own clade',
      new Set(labels_k10).size === 4);

// Empty tree
check('empty tree → empty labels',   cladeLabelsAtK({nodes: [], n_leaves: 0}, 2).length === 0);

// =====================================================================
group('toNewickString');

const newick = toNewickString(tree);
check('Newick: ends with semicolon', newick.endsWith(';'));
check('Newick: starts with paren',   newick.startsWith('('));
check('Newick: contains all labels',
      newick.includes('a') && newick.includes('b')
   && newick.includes('c') && newick.includes('d'));
check('Newick: includes branch length',  newick.match(/:[0-9]/));

// Special-character label quoting
const treeQuoted = buildNjTree([[0,1],[1,0]], ["foo'bar", "x y"]);
const nwQ = toNewickString(treeQuoted);
check('Newick: quoted labels',
      nwQ.includes("'foo''bar'") && nwQ.includes("'x y'"));

// =====================================================================
group('Integration: dosage → distance → tree → clade labels');

// 6 samples, 3 markers. Two clear groups: first 3 samples have
// dosage ~0, last 3 have dosage ~2 → expect a 2-clade split.
const d_int = new Float64Array([
  // M0: 0.0 0.1 0.2 1.8 1.9 2.0
  0.0, 0.1, 0.2, 1.8, 1.9, 2.0,
  // M1: 0.1 0.2 0.0 2.0 1.7 1.9
  0.1, 0.2, 0.0, 2.0, 1.7, 1.9,
  // M2: 0.0 0.1 0.1 1.9 2.0 1.8
  0.0, 0.1, 0.1, 1.9, 2.0, 1.8,
]);
const D_int = pairwiseEuclideanFromDosage(d_int, 3, 6);
const tree_int = buildNjTree(D_int, ['s0', 's1', 's2', 's3', 's4', 's5']);
const cl_int = cladeLabelsAtK(tree_int, 2);

// Build a Set per clade and check.
const groupA = new Set();
const groupB = new Set();
for (let i = 0; i < 6; i++) {
  (cl_int[i] === cl_int[0] ? groupA : groupB).add(i);
}
check('integration: 2-clade split exists',  groupA.size + groupB.size === 6);
// First 3 samples should all be in one clade (low-dosage group)
check('integration: s0/s1/s2 share clade',
      cl_int[0] === cl_int[1] && cl_int[1] === cl_int[2]);
// Last 3 should all be in the OTHER clade
check('integration: s3/s4/s5 share clade',
      cl_int[3] === cl_int[4] && cl_int[4] === cl_int[5]);
check('integration: two groups are distinct',
      cl_int[0] !== cl_int[3]);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
