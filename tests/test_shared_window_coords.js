// tests/test_shared_window_coords.js

import { bsearchWin } from '../atlases/inversion/shared/window_coords.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('bsearchWin — empty / null');
check('null arr, lo → 0',                      bsearchWin(null, 5, 'lo') === 0);
check('null arr, hi → -1',                     bsearchWin(null, 5, 'hi') === -1);
check('empty arr, lo → 0',                     bsearchWin([], 5, 'lo') === 0);
check('empty arr, hi → -1',                    bsearchWin([], 5, 'hi') === -1);

// =====================================================================
group('bsearchWin — mode "lo" (first index >= target)');
{
  const arr = [10, 20, 30, 40, 50];
  // target below all → 0
  check('target < arr[0] → 0',                 bsearchWin(arr, 5, 'lo') === 0);
  check('target == arr[0] → 0',                bsearchWin(arr, 10, 'lo') === 0);
  // exact match
  check('target == arr[2] → 2',                bsearchWin(arr, 30, 'lo') === 2);
  // between values: returns next-higher index
  check('target between [0] and [1] → 1',      bsearchWin(arr, 15, 'lo') === 1);
  check('target between [3] and [4] → 4',      bsearchWin(arr, 45, 'lo') === 4);
  // target == last
  check('target == arr[last] → last',          bsearchWin(arr, 50, 'lo') === 4);
  // target above all
  check('target > all → arr.length',           bsearchWin(arr, 99, 'lo') === 5);
}

// =====================================================================
group('bsearchWin — mode "hi" (last index <= target)');
{
  const arr = [10, 20, 30, 40, 50];
  // target below all → -1
  check('target < arr[0] → -1',                bsearchWin(arr, 5, 'hi') === -1);
  // target == arr[0]
  check('target == arr[0] → 0',                bsearchWin(arr, 10, 'hi') === 0);
  // exact match
  check('target == arr[2] → 2',                bsearchWin(arr, 30, 'hi') === 2);
  // between values: returns next-lower index
  check('target between [1] and [2] → 1',      bsearchWin(arr, 25, 'hi') === 1);
  check('target between [3] and [4] → 3',      bsearchWin(arr, 45, 'hi') === 3);
  // target == last
  check('target == arr[last] → last',          bsearchWin(arr, 50, 'hi') === 4);
  // target above all
  check('target > all → last index',           bsearchWin(arr, 99, 'hi') === 4);
}

// =====================================================================
group('bsearchWin — TypedArray inputs');
{
  const arr = new Int32Array([100, 200, 300]);
  check('Int32Array lo',                       bsearchWin(arr, 150, 'lo') === 1);
  check('Int32Array hi',                       bsearchWin(arr, 150, 'hi') === 0);
}
{
  const arr = new Float64Array([0.1, 0.2, 0.3, 0.4]);
  check('Float64Array lo',                     bsearchWin(arr, 0.25, 'lo') === 2);
}

// =====================================================================
group('bsearchWin — single-element arrays');
{
  const arr = [42];
  check('single elem, target below → lo: 0',   bsearchWin(arr, 10, 'lo') === 0);
  check('single elem, target below → hi: -1',  bsearchWin(arr, 10, 'hi') === -1);
  check('single elem, target equal → lo: 0',   bsearchWin(arr, 42, 'lo') === 0);
  check('single elem, target equal → hi: 0',   bsearchWin(arr, 42, 'hi') === 0);
  check('single elem, target above → lo: 1',   bsearchWin(arr, 99, 'lo') === 1);
  check('single elem, target above → hi: 0',   bsearchWin(arr, 99, 'hi') === 0);
}

// =====================================================================
group('bsearchWin — duplicates');
{
  // Duplicates: lo returns FIRST occurrence; hi returns LAST.
  const arr = [10, 20, 20, 20, 30];
  check('duplicates: lo → first occurrence',   bsearchWin(arr, 20, 'lo') === 1);
  check('duplicates: hi → last occurrence',    bsearchWin(arr, 20, 'hi') === 3);
}

// =====================================================================
group('bsearchWin — invariant: lo and hi compose for in-bounds targets');
{
  // For any target IN-BOUNDS:
  //   lo and hi return indices that bracket the target (or coincide on exact match)
  const arr = [10, 20, 30, 40, 50];
  for (let t = 15; t < 45; t += 5) {
    const lo = bsearchWin(arr, t, 'lo');
    const hi = bsearchWin(arr, t, 'hi');
    if (arr.includes(t)) {
      check(`exact ${t}: lo === hi`,           lo === hi);
    } else {
      check(`gap ${t}: hi + 1 === lo`,         hi + 1 === lo);
    }
  }
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
