// tests/test_shared_newick.js
//
// Unit tests for atlases/inversion/shared/newick.js — the leaf-order
// Newick parser.

import { parseNewickToLeaves } from '../atlases/inversion/shared/newick.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('parseNewickToLeaves — basic shapes');
{
  // Two-leaf cladogram
  const leaves = parseNewickToLeaves('(A,B);');
  check('flat 2-leaf: length=2',                leaves.length === 2);
  check('leaf order preserved',                 leaves[0].id === 'A' && leaves[1].id === 'B');
  check('both at depth 1',                      leaves[0].depth === 1 && leaves[1].depth === 1);
}
{
  // Nested
  const leaves = parseNewickToLeaves('((A,B),C);');
  check('nested: 3 leaves',                     leaves.length === 3);
  check('A depth 2',                            leaves[0].id === 'A' && leaves[0].depth === 2);
  check('B depth 2',                            leaves[1].id === 'B' && leaves[1].depth === 2);
  check('C depth 1',                            leaves[2].id === 'C' && leaves[2].depth === 1);
}
{
  // Branch lengths stripped
  const leaves = parseNewickToLeaves('((A:0.1,B:0.2):0.05,C:0.15);');
  check('branch lengths stripped: A',           leaves[0].id === 'A');
  check('branch lengths stripped: B',           leaves[1].id === 'B');
  check('branch lengths stripped: C',           leaves[2].id === 'C');
  check('correct count',                        leaves.length === 3);
}
{
  // Catfish 9-species example
  const newick = '((((Tros,Smer),(Tfulv,Ipun,Hwyc)),Phyp),(Capus,Cfus,(Cmac,Cgar)));';
  const leaves = parseNewickToLeaves(newick);
  check('catfish: 10 leaves',                   leaves.length === 10);
  check('catfish: ends with Cgar',              leaves[leaves.length - 1].id === 'Cgar');
  check('catfish: Cmac before Cgar',
        leaves[leaves.length - 2].id === 'Cmac');
}

// =====================================================================
group('parseNewickToLeaves — allowedIds filter');
{
  const allowed = ['A', 'C'];
  const leaves = parseNewickToLeaves('(A,B,C);', allowed);
  check('all 3 leaves recorded',                leaves.length === 3);
  check('A not flagged',                        leaves.find(l => l.id === 'A')._unknown === undefined);
  check('B flagged as unknown',                 leaves.find(l => l.id === 'B')._unknown === true);
  check('C not flagged',                        leaves.find(l => l.id === 'C')._unknown === undefined);
}
{
  // Set instance also works
  const leaves = parseNewickToLeaves('(A,B);', new Set(['A']));
  check('Set instance works as allowed',        leaves.find(l => l.id === 'B')._unknown === true);
}
{
  // No allowed list → nothing flagged
  const leaves = parseNewickToLeaves('(A,B);');
  check('no allowedIds: nothing flagged',
        leaves.every(l => l._unknown === undefined));
}

// =====================================================================
group('parseNewickToLeaves — edge cases');
check('empty string → []',                    parseNewickToLeaves('').length === 0);
check('null → []',                            parseNewickToLeaves(null).length === 0);
check('undefined → []',                       parseNewickToLeaves(undefined).length === 0);
check('non-string → []',                      parseNewickToLeaves(42).length === 0);
{
  // Missing semicolon: still parses
  const leaves = parseNewickToLeaves('(A,B)');
  check('missing semicolon: 2 leaves',          leaves.length === 2);
}
{
  // Semicolon stops parsing
  const leaves = parseNewickToLeaves('(A,B);(C,D);');
  check('content after ; ignored',              leaves.length === 2);
  check('only first tree returned',             leaves[0].id === 'A' && leaves[1].id === 'B');
}
{
  // Whitespace around ids is trimmed
  const leaves = parseNewickToLeaves('( A , B );');
  check('A trimmed of leading space',           leaves[0].id === 'A');
  check('B trimmed of trailing space',          leaves[1].id === 'B');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
