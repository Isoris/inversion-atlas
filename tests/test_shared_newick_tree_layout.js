// tests/test_shared_newick_tree_layout.js
//
// Unit coverage for shared/newick_tree_layout.js — Newick parser +
// rectangular layout + Phase 3 ladder/parallel/scattered classifier.

import {
  parseNewick,
  computeRectangularLayout,
  classifyTreePattern,
} from '../atlases/inversion/shared/newick_tree_layout.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('parseNewick — leaf-only');

const t1 = parseNewick('A;');
check('single leaf: id=A',          t1 && t1.id === 'A');
check('single leaf: no children',    t1.children.length === 0);

// =====================================================================
group('parseNewick — basic balanced tree');

const t2 = parseNewick('((A:0.1,B:0.1):0.05,C:0.15);');
check('root has 2 children',         t2.children.length === 2);
check('left child is internal',      t2.children[0].children.length === 2);
check('A is leaf',                   t2.children[0].children[0].id === 'A');
check('A branch length = 0.1',       approx(t2.children[0].children[0].length, 0.1));
check('B branch length = 0.1',       approx(t2.children[0].children[1].length, 0.1));
check('internal branch length 0.05', approx(t2.children[0].length, 0.05));
check('C branch length = 0.15',      approx(t2.children[1].length, 0.15));

// =====================================================================
group('parseNewick — bootstrap support');

const tBoot = parseNewick('((A:0.1,B:0.1)95:0.05,(C:0.1,D:0.1)82:0.05);');
check('internal node has support=95', tBoot.children[0].support === 95);
check('second internal support=82',   tBoot.children[1].support === 82);

// =====================================================================
group('parseNewick — quoted names');

const tQ = parseNewick("('Sample A':0.1,'Sample B':0.1);");
check('quoted leaf 1: id contains space',
      tQ.children[0].id === 'Sample A');
check('quoted leaf 2: id contains space',
      tQ.children[1].id === 'Sample B');

// =====================================================================
group('parseNewick — edge cases');

check('empty → null',                  parseNewick('') === null);
check('null → null',                   parseNewick(null) === null);
check('whitespace → null',             parseNewick('   ') === null);

// Newick without semicolon
const tNoSemi = parseNewick('(A:0.1,B:0.1)');
check('trailing ; missing tolerated',  tNoSemi.children.length === 2);

// =====================================================================
group('computeRectangularLayout — basic');

const tBal = parseNewick('((A:1,B:1):1,(C:1,D:1):1);');
const L = computeRectangularLayout(tBal);
check('4 leaves',                      L.nLeaves === 4);
check('leaves array length 4',         L.leaves.length === 4);
check('leaf ids preserved',
      L.leaves.map(l => l.id).sort().join() === 'A,B,C,D');
check('all leaves at maxX',
      L.leaves.every(l => l.x === L.maxX));
check('edges count = nodes - 1',
      L.edges.length === L.nodes.length - 1);
check('first leaf y = 0',              L.leaves[0].y === 0);
check('last leaf y = nLeaves - 1',     L.leaves[3].y === 3);
// Root is at x=0
const root = L.nodes.find(n => n.parent < 0);
check('root x = 0',                    root.x === 0);
// Internal node y = midpoint of children
const internalLeft = L.nodes.find(n =>
  !n.isLeaf && n.parent === L.nodes.indexOf(root));
if (internalLeft) {
  const childY = internalLeft.childIdxs.map(ci => L.nodes[ci].y);
  check('internal y = midpoint of children',
        approx(internalLeft.y, 0.5 * (Math.min(...childY) + Math.max(...childY))));
}

// =====================================================================
group('computeRectangularLayout — cladogram mode');

const Lclad = computeRectangularLayout(tBal, { cladogram: true });
// All leaves should be at the same depth (2 hops)
check('cladogram: all leaves at maxX',
      Lclad.leaves.every(l => l.x === Lclad.maxX));
check('cladogram: maxX = leaf depth = 2',
      Lclad.maxX === 2);

// =====================================================================
group('computeRectangularLayout — branch-length mode');

// Asymmetric tree: A has long branch, B short
const tAsym = parseNewick('((A:5,B:0.1):0.5,C:1);');
const LA = computeRectangularLayout(tAsym);
const leafA = LA.leaves.find(l => l.id === 'A');
const leafB = LA.leaves.find(l => l.id === 'B');
const leafC = LA.leaves.find(l => l.id === 'C');
// A: root → 0.5 → 5 = 5.5
// B: root → 0.5 → 0.1 = 0.6
// C: root → 1 = 1
check('A leaf x ≈ 5.5',                approx(leafA.x, 5.5));
check('B leaf x ≈ 0.6',                approx(leafB.x, 0.6));
check('C leaf x = 1',                  approx(leafC.x, 1));
check('maxX = 5.5',                    approx(LA.maxX, 5.5));

// =====================================================================
group('computeRectangularLayout — scaleX/scaleY');

const LS = computeRectangularLayout(tBal, { scaleX: 100, scaleY: 50 });
check('scaleY=50: last leaf y = 150',  LS.leaves[3].y === 150);
check('scaled maxX = 200',             LS.maxX === 200);

// =====================================================================
group('computeRectangularLayout — null inputs');

const Lnull = computeRectangularLayout(null);
check('null tree: empty layout',       Lnull.nLeaves === 0 && Lnull.edges.length === 0);

// =====================================================================
group('classifyTreePattern — parallel');

// Three bands, each leaf in its own band, bands as sister clades.
const tPar = parseNewick(
  '((A1:1,A2:1,A3:1,A4:1,A5:1):1,'
  + '((B1:1,B2:1,B3:1,B4:1,B5:1):0.5,'
  + '(C1:1,C2:1,C3:1,C4:1,C5:1):0.5):1);'
);
const Lpar = computeRectangularLayout(tPar);
const bandOf = {};
['A1','A2','A3','A4','A5'].forEach(id => bandOf[id] = 'A');
['B1','B2','B3','B4','B5'].forEach(id => bandOf[id] = 'B');
['C1','C2','C3','C4','C5'].forEach(id => bandOf[id] = 'C');
const cls = classifyTreePattern(Lpar, bandOf);
check('parallel: pattern in {parallel, ladder}',
      cls.pattern === 'parallel' || cls.pattern === 'ladder');
check('parallel: n_bands = 3',         cls.n_bands === 3);
check('parallel: all bands pure',
      cls.purity.A >= 0.99 && cls.purity.B >= 0.99 && cls.purity.C >= 0.99);

// =====================================================================
group('classifyTreePattern — scattered');

// Bands mixed across the tree
const tScat = parseNewick('((A1:1,B1:1):1,(A2:1,B2:1):1);');
const Lscat = computeRectangularLayout(tScat);
const bandScatBand = { A1: 'A', A2: 'A', B1: 'B', B2: 'B' };
const clsScat = classifyTreePattern(Lscat, bandScatBand);
check('scattered: pattern = scattered', clsScat.pattern === 'scattered');
check('scattered: purity < 1',
      clsScat.purity.A < 1 || clsScat.purity.B < 1);

// =====================================================================
group('classifyTreePattern — ladder');

// Nested structure: B inside C inside A's parent
const tLad = parseNewick(
  '(A1:1,((B1:1,B2:1):1,(C1:1,C2:1):1):1);'
);
const Llad = computeRectangularLayout(tLad);
const bandLad = { A1:'A', B1:'B', B2:'B', C1:'C', C2:'C' };
const clsLad = classifyTreePattern(Llad, bandLad);
// With only 1 leaf in band A, purity might be 1.0 (singleton) → pure
check('ladder: A pure (singleton)',     clsLad.purity.A === 1);

// =====================================================================
group('classifyTreePattern — empty / null');

check('null layout → ambiguous',
      classifyTreePattern(null, {}).pattern === 'ambiguous');
check('null bandOf → ambiguous',
      classifyTreePattern(Lpar, null).pattern === 'ambiguous');

// Empty bandOf
check('empty bandOf → ambiguous',
      classifyTreePattern(Lpar, {}).pattern === 'ambiguous');

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
