// tests/test_shared_sample_spread.js
//
// Unit coverage for shared/sample_spread.js — per-sample σ of
// sign-aligned PC1 across a window range (legacy lines 10294-10330).

import * as SS from '../atlases/inversion/shared/sample_spread.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('sampleSpreadRange: 3-sample fixture');
// 3 samples, 4 windows. Sample 0 is stable (pc1≈0.1 across), sample 1
// drifts (0.1 → 0.4 → 0.7 → 1.0), sample 2 is constant 0.5.
const state = {
  data: {
    n_samples: 3,
    windows: [
      { pc1: [0.1, 0.1, 0.5], pc2: [0, 0, 0] },
      { pc1: [0.1, 0.4, 0.5], pc2: [0, 0, 0] },
      { pc1: [0.1, 0.7, 0.5], pc2: [0, 0, 0] },
      { pc1: [0.1, 1.0, 0.5], pc2: [0, 0, 0] },
    ],
  },
};

const sd = SS.sampleSpreadRange(state, 0, 3);
check('returns Float64Array',          sd instanceof Float64Array);
check('length matches n_samples',      sd.length === 3);
// Sample 0 perfectly stable → sd ≈ 0
check('stable sample (0): sd ≈ 0',     sd[0] < 1e-9);
// Sample 1 drifting → sd > 0 (much larger than sample 0)
check('drifting sample (1): sd > 0.3', sd[1] > 0.3);
// Sample 2 perfectly stable → sd ≈ 0
check('stable sample (2): sd ≈ 0',     sd[2] < 1e-9);

// -----------------------------------------------------------------------------
group('sampleSpreadRange: sign flip');
// With state.flipPC1 + state.pc1Sign, sample-0's pc1 gets negated
// in windows whose sign is -1.
//
// 4 windows, all sample 0 has pc1 = 0.5. signs = [1, -1, 1, -1] ⇒
// sign-aligned values = [0.5, -0.5, 0.5, -0.5] ⇒ mean=0, var > 0.
const stateFlip = {
  flipPC1: true,
  pc1Sign: [1, -1, 1, -1],
  data: {
    n_samples: 1,
    windows: [
      { pc1: [0.5] }, { pc1: [0.5] }, { pc1: [0.5] }, { pc1: [0.5] },
    ],
  },
};
const sdFlip = SS.sampleSpreadRange(stateFlip, 0, 3);
check('sign-flip applied → non-zero sd',  sdFlip[0] > 0.4);

// -----------------------------------------------------------------------------
group('sampleSpreadRange: edge cases');
check('null state → null',             SS.sampleSpreadRange(null, 0, 3) === null);
check('no data → null',                SS.sampleSpreadRange({}, 0, 3) === null);
check('nW < 2 → null',                 SS.sampleSpreadRange(state, 0, 0) === null);
check('non-integer indices → null',    SS.sampleSpreadRange(state, 0, 1.5) === null);
check('missing n_samples → null',
      SS.sampleSpreadRange({ data: { windows: state.data.windows } }, 0, 1) === null);

// Out-of-range window → getPC returns null → sampleSpreadRange returns null
check('out-of-range end window → null',  SS.sampleSpreadRange(state, 0, 99) === null);

// -----------------------------------------------------------------------------
group('sampleSpreadL2');
const stateL2 = {
  data: Object.assign({}, state.data, {
    l2_envelopes: [
      { _s0: 0, _e0: 3 },
      { _s0: 1, _e0: 2 },   // narrower range
      { /* missing _s0/_e0 */ },
    ],
  }),
};
const sdL2_0 = SS.sampleSpreadL2(stateL2, 0);
check('L2 0: full-range sd matches sampleSpreadRange',
      sdL2_0 && Math.abs(sdL2_0[1] - sd[1]) < 1e-9);

const sdL2_1 = SS.sampleSpreadL2(stateL2, 1);
check('L2 1: narrower-range sd computed',  sdL2_1 instanceof Float64Array);

check('L2 with missing _s0/_e0 → null',
      SS.sampleSpreadL2(stateL2, 2) === null);
check('out-of-range L2 idx → null',         SS.sampleSpreadL2(stateL2, 99) === null);
check('no envelopes → null',
      SS.sampleSpreadL2({ data: { n_samples: 3, windows: state.data.windows } }, 0) === null);
check('null state → null',                  SS.sampleSpreadL2(null, 0) === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
