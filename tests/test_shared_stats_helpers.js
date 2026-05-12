// tests/test_shared_stats_helpers.js

import {
  mad,
  madNormalize,
  rollingMedian,
  shannonEntropy,
} from '../atlases/inversion/shared/stats_helpers.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('mad');
check('null → 0',                              mad(null) === 0);
check('undefined → 0',                         mad(undefined) === 0);
check('empty → 0',                             mad([]) === 0);
check('single value → 0 (n < 2)',              mad([5]) === 0);
{
  // Classic example: [1,2,3,4,5] → median 3, abs deviations [2,1,0,1,2] → median 1
  check('[1..5] → 1',                          mad([1, 2, 3, 4, 5]) === 1);
}
{
  // With NaNs / nulls / -1 sentinel — all dropped
  check('mixed missing: [1, NaN, 2, null, 3, -1, 4, 5] → 1',
        mad([1, NaN, 2, null, 3, -1, 4, 5]) === 1);
}
{
  // All-missing → 0
  check('all-missing → 0',                     mad([NaN, null, -1, NaN]) === 0);
}
{
  // Two values: med = lower (1), abs devs = [0, 1] → med = 0
  check('two values: lower median used',       mad([1, 3]) === 0);
}
{
  // Float32Array input
  const arr = Float32Array.from([1, 2, 3, 4, 5]);
  check('Float32Array input works',            mad(arr) === 1);
}
{
  // Constant array → 0 (all deviations 0)
  check('constant array → 0',                  mad([7, 7, 7, 7]) === 0);
}

// =====================================================================
group('madNormalize');
{
  const r = madNormalize([2, 4, 6, 8], 2);
  check('returns Float64Array',                 r instanceof Float64Array);
  check('length matches input',                 r.length === 4);
  check('[2,4,6,8] / 2 = [1,2,3,4]',
        r[0] === 1 && r[1] === 2 && r[2] === 3 && r[3] === 4);
}
{
  // NA-tolerant: NaN/null/-1 → 0 in output (not NaN)
  const r = madNormalize([2, NaN, 4, null, -1, 6], 2);
  check('NaN slot → 0',                         r[1] === 0);
  check('null slot → 0',                        r[3] === 0);
  check('-1 sentinel → 0',                      r[4] === 0);
  check('finite slots normalized',              r[0] === 1 && r[2] === 2 && r[5] === 3);
}
{
  // Zero MAD → all zeros
  const r = madNormalize([1, 2, 3], 0);
  check('mad=0 → all zeros',                    r[0] === 0 && r[1] === 0 && r[2] === 0);
}
{
  // NaN MAD → all zeros
  const r = madNormalize([1, 2, 3], NaN);
  check('mad=NaN → all zeros',                  r[0] === 0);
}
check('null arr → empty Float64Array',         madNormalize(null, 2).length === 0);
{
  // Float32Array input
  const arr = Float32Array.from([2, 4, 6]);
  const r = madNormalize(arr, 2);
  check('Float32Array input works',             r[1] === 2);
}

// =====================================================================
group('rollingMedian');
{
  const r = rollingMedian([1, 2, 3, 4, 5], 3);
  check('returns Float64Array',                 r instanceof Float64Array);
  check('length matches input',                 r.length === 5);
  // Window width 3: each output is median of {i-1, i, i+1} (clipped at edges)
  // i=0: [1,2] → med 1; i=1: [1,2,3] → med 2; i=2: [2,3,4] → med 3;
  // i=3: [3,4,5] → med 4; i=4: [4,5] → med 4
  check('left edge clamped',                    r[0] === 1);
  check('center i=1 → 2',                       r[1] === 2);
  check('center i=2 → 3',                       r[2] === 3);
  check('center i=3 → 4',                       r[3] === 4);
  // right edge: window {4,5} (2 values) → lower median = 4
  check('right edge: lower median (even count)', r[4] === 4);
}
{
  // Width 5
  const r = rollingMedian([1, 100, 2, 100, 3], 5);
  check('width 5 over noisy input:',            true);  // header
  // All five points in any window → median (lower for even, exact for odd)
  // i=2: [1, 100, 2, 100, 3] → sorted [1, 2, 3, 100, 100] → median 3
  check('i=2 median = 3 (resilient to spikes)', r[2] === 3);
}
{
  // NA-tolerant: -1 sentinel + NaN excluded from window medians
  const r = rollingMedian([1, NaN, 3, -1, 5], 3);
  // i=2 window [NaN, 3, -1] → only 3 → median 3
  check('window with only -1+NaN+1 finite → 3', r[2] === 3);
  // i=3 window [3, -1, 5] → [3, 5] → lower median 3
  check('i=3 window: finite-only median',       r[3] === 3);
}
{
  // Width < 1 clamped to 1: output equals input (for finite values)
  const r = rollingMedian([1, 2, 3], 0);
  check('width 0 → clamped to 1 (identity)',    r[0] === 1 && r[1] === 2 && r[2] === 3);
}
{
  // Empty input
  const r = rollingMedian([], 3);
  check('empty input → empty Float64Array',     r.length === 0);
}
{
  // All-NA window → NaN
  const r = rollingMedian([-1, NaN, null], 3);
  check('all-NA → NaN',                         Number.isNaN(r[1]));
}
check('null arr → empty Float64Array',         rollingMedian(null, 3).length === 0);

// =====================================================================
group('shannonEntropy');
{
  // Uniform K=2: H/log(2) = 1
  check('uniform K=2 → 1',                      Math.abs(shannonEntropy([0.5, 0.5], 2) - 1) < 1e-9);
}
{
  // Uniform K=3: H/log(3) = 1
  check('uniform K=3 → 1',                      Math.abs(shannonEntropy([1, 1, 1], 3) - 1) < 1e-9);
}
{
  // Degenerate (single non-zero): H = 0
  check('[1, 0, 0] → 0',                        shannonEntropy([1, 0, 0], 3) === 0);
  check('[0, 5, 0] → 0',                        shannonEntropy([0, 5, 0], 3) === 0);
}
{
  // Renormalization: [2, 2] same as [0.5, 0.5]
  check('non-unit fractions renormalized',
        Math.abs(shannonEntropy([2, 2], 2) - 1) < 1e-9);
}
{
  // Intermediate: K=2, [0.9, 0.1] → ~0.469
  const h = shannonEntropy([0.9, 0.1], 2);
  check('K=2 [0.9, 0.1] in (0.4, 0.5)',         h > 0.4 && h < 0.5);
}
{
  // Empty / null inputs → 0
  check('null → 0',                             shannonEntropy(null, 2) === 0);
  check('empty array → 0',                      shannonEntropy([], 2) === 0);
  check('K <= 1 → 0',                           shannonEntropy([0.5, 0.5], 1) === 0);
  check('K = 0 → 0',                            shannonEntropy([0.5, 0.5], 0) === 0);
}
{
  // All-zero distribution → 0
  check('all-zero → 0',                         shannonEntropy([0, 0, 0], 3) === 0);
}
{
  // Negative sum (shouldn't happen but defensively guarded) → 0
  check('sum ≤ 0 → 0',                          shannonEntropy([-1, -1], 2) === 0);
}
{
  // Float32Array input
  const arr = Float32Array.from([1, 1, 1]);
  check('Float32Array uniform → 1',             Math.abs(shannonEntropy(arr, 3) - 1) < 1e-9);
}
{
  // K > fractions.length: normalizer log(K) used; entropy ≤ 1
  // [1, 1] with K=4 → H = log(2), Hmax = log(4) → norm = 0.5
  check('K > fractions.length: partial entropy',
        Math.abs(shannonEntropy([1, 1], 4) - 0.5) < 1e-9);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
