// tests/test_shared_k6_parent_map.js
//
// Unit coverage for shared/k6_parent_map.js — K=6 → K=3 nesting
// classifier.

import {
  K6_PURITY_DEFAULT,
  K6_VERDICTS,
  computeK6ParentMap,
} from '../atlases/inversion/shared/k6_parent_map.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Helper: build a votes matrix [si][p] = label
function votes(matrix) { return matrix.map(row => Int8Array.from(row)); }

// =====================================================================
group('constants');

check('K6_PURITY_DEFAULT = 0.80',     K6_PURITY_DEFAULT === 0.80);
check('K6_VERDICTS frozen',           Object.isFrozen(K6_VERDICTS));
check('NESTED / MIXED / CROSS_CUTTING / NO_DATA present',
      K6_VERDICTS.NESTED === 'NESTED'
      && K6_VERDICTS.MIXED === 'MIXED'
      && K6_VERDICTS.CROSS_CUTTING === 'CROSS_CUTTING'
      && K6_VERDICTS.NO_DATA === 'NO_DATA');

// =====================================================================
group('NO_DATA paths');

check('null k3 → NO_DATA',
      computeK6ParentMap(null, {}).verdict === K6_VERDICTS.NO_DATA);
check('null k6 → NO_DATA',
      computeK6ParentMap({}, null).verdict === K6_VERDICTS.NO_DATA);
check('invalid shape → NO_DATA',
      computeK6ParentMap({ K: 0, n_samples: 0, n_intervals: 0, votes: [] },
        { K: 0, n_samples: 0, n_intervals: 0, votes: [] })
        .verdict === K6_VERDICTS.NO_DATA);

// Both votes arrays empty (no labels at all)
const emptyVotes = {
  K: 3, n_samples: 2, n_intervals: 2,
  votes: votes([[-1, -1], [-1, -1]]),
};
const emptyVotes6 = {
  K: 6, n_samples: 2, n_intervals: 2,
  votes: votes([[-1, -1], [-1, -1]]),
};
check('all -1 votes → NO_DATA',
      computeK6ParentMap(emptyVotes, emptyVotes6).verdict === K6_VERDICTS.NO_DATA);

// =====================================================================
group('NESTED verdict — every K6 group has one parent');

// 6 samples × 2 intervals
// K3 labels: 3 samples in g0, 3 in g1, plus a small g2 group
// K6 labels: split each K3 group cleanly into 2 K6 subgroups
//   K3=0 → K6 in {0, 1}
//   K3=1 → K6 in {2, 3}
//   K3=2 → K6 in {4, 5}
const k3Nested = {
  K: 3, n_samples: 6, n_intervals: 2,
  votes: votes([
    [0, 0],  // s0 → K3=0 in both intervals
    [0, 0],
    [1, 1],
    [1, 1],
    [2, 2],
    [2, 2],
  ]),
};
const k6Nested = {
  K: 6, n_samples: 6, n_intervals: 2,
  votes: votes([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ]),
};
const rN = computeK6ParentMap(k3Nested, k6Nested, 0.80);
check('NESTED',                       rN.verdict === K6_VERDICTS.NESTED);
check('n_with_data = 6',              rN.n_with_data === 6);
check('n_pure = 6',                   rN.n_pure === 6);
check('parent_of_k6[0] = 0',          rN.parent_of_k6[0] === 0);
check('parent_of_k6[1] = 0',          rN.parent_of_k6[1] === 0);
check('parent_of_k6[2] = 1',          rN.parent_of_k6[2] === 1);
check('parent_of_k6[3] = 1',          rN.parent_of_k6[3] === 1);
check('parent_of_k6[4] = 2',          rN.parent_of_k6[4] === 2);
check('parent_of_k6[5] = 2',          rN.parent_of_k6[5] === 2);
check('every purity = 1',
      Array.from(rN.purity).every(p => p === 1));

// subband_label
check('subband_label(0) = g0a',       rN.subband_label(0) === 'g0a');
check('subband_label(1) = g0b',       rN.subband_label(1) === 'g0b');
check('subband_label(2) = g1a',       rN.subband_label(2) === 'g1a');
check('subband_label(3) = g1b',       rN.subband_label(3) === 'g1b');
check('subband_label(4) = g2a',       rN.subband_label(4) === 'g2a');
check('subband_label(5) = g2b',       rN.subband_label(5) === 'g2b');
check('subband_label(99) = null',     rN.subband_label(99) === null);
check('subband_label(-1) = null',     rN.subband_label(-1) === null);

// =====================================================================
group('CROSS_CUTTING verdict — every K6 group splits across K3 parents');

// Each K6 group has 50/50 between two K3 groups → purity = 0.5
const k3Cross = {
  K: 2, n_samples: 4, n_intervals: 2,
  votes: votes([
    [0, 0],
    [1, 1],
    [0, 0],
    [1, 1],
  ]),
};
const k6Cross = {
  K: 2, n_samples: 4, n_intervals: 2,
  votes: votes([
    [0, 1],
    [0, 1],
    [1, 0],
    [1, 0],
  ]),
};
const rC = computeK6ParentMap(k3Cross, k6Cross, 0.80);
check('CROSS_CUTTING verdict',          rC.verdict === K6_VERDICTS.CROSS_CUTTING);
check('n_pure = 0',                     rC.n_pure === 0);
check('every purity = 0.5',
      Array.from(rC.purity).every(p => p === 0.5));

// =====================================================================
group('MIXED verdict — some pure, some split');

// K6 group 0 → 100% in K3=0 (pure)
// K6 group 1 → 50/50 across K3 (not pure)
const k3Mix = {
  K: 2, n_samples: 4, n_intervals: 1,
  votes: votes([[0], [0], [1], [1]]),
};
const k6Mix = {
  K: 2, n_samples: 4, n_intervals: 1,
  votes: votes([[0], [0], [1], [1]]),
};
// Both pure → NESTED. Make one impure:
const k6Mix2 = {
  K: 2, n_samples: 4, n_intervals: 2,
  votes: votes([
    [0, 0],
    [0, 0],
    [1, 0],   // K6=1 mostly K3=1 but some K3=0
    [1, 1],
  ]),
};
const k3Mix2 = {
  K: 2, n_samples: 4, n_intervals: 2,
  votes: votes([
    [0, 0],
    [0, 0],
    [1, 0],
    [1, 1],
  ]),
};
const rM = computeK6ParentMap(k3Mix2, k6Mix2, 0.80);
check('MIXED case verdict ∈ {MIXED, NESTED, CROSS_CUTTING}',
      [K6_VERDICTS.MIXED, K6_VERDICTS.NESTED, K6_VERDICTS.CROSS_CUTTING]
        .indexOf(rM.verdict) >= 0);
// purity_threshold passed through
check('purity_threshold echoed',
      rM.purity_threshold === 0.80);

// =====================================================================
group('purity_threshold sensitivity');

// Same data, two different thresholds → different verdicts
const k3T = {
  K: 2, n_samples: 4, n_intervals: 5,
  votes: votes([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],   // K3 mostly 1, one in 0
    [1, 1, 1, 1, 1],
  ]),
};
const k6T = {
  K: 2, n_samples: 4, n_intervals: 5,
  votes: votes([
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1],
  ]),
};
// K6=0 is 100% K3=0 → purity 1.0
// K6=1 is 9/10 K3=1, 1/10 K3=0 → purity 0.9
const r80 = computeK6ParentMap(k3T, k6T, 0.80);
const r95 = computeK6ParentMap(k3T, k6T, 0.95);
check('threshold 0.80: both pure → NESTED',
      r80.verdict === K6_VERDICTS.NESTED);
check('threshold 0.95: K6=1 drops out → MIXED',
      r95.verdict === K6_VERDICTS.MIXED);

// =====================================================================
group('default purity_threshold');

const rDef = computeK6ParentMap(k3T, k6T);   // no threshold arg
check('default threshold applied',     rDef.purity_threshold === K6_PURITY_DEFAULT);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
