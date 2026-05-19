// tests/test_shared_macrostripe.js
//
// Unit coverage for shared/macrostripe.js — Phase 1 of
// SPEC_macrostripe_microgroup_hierarchy.md. Tests the projection
// from a synthetic bandingResult.stage3.loci → per-sample
// Int8Array macrostripe ids.

import {
  getMacrostripeIdPerSample,
  getMacrostripeIdsAtWindow,
  getMacrostripeColor,
  invalidateMacrostripeCache,
} from '../atlases/inversion/shared/macrostripe.js';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else      { fail++; console.log('  ✗', name, detail ? '— ' + detail : ''); }
}
function group(label) { console.log('\n--- ' + label + ' ---'); }

// =====================================================================
// Synthetic fixture: 6 samples, 5 windows, K=3.
//   sample 0,1 → band 0 at every window
//   sample 2,3 → band 1 at every window
//   sample 4,5 → band 2 at every window
// The labels are stable across windows, so the Hungarian-chain
// intersection in locusBandSampleSets returns full sets.
// =====================================================================
function makeState() {
  const labels = [
    new Int8Array([0, 0, 1, 1, 2, 2]),
    new Int8Array([0, 0, 1, 1, 2, 2]),
    new Int8Array([0, 0, 1, 1, 2, 2]),
    new Int8Array([0, 0, 1, 1, 2, 2]),
    new Int8Array([0, 0, 1, 1, 2, 2]),
  ];
  const cluster = { labels: labels[0], fixedKLabels: labels[0],
                    n_per_group: [2, 2, 2] };
  const l2GroupCache = new Map();
  l2GroupCache.set(0, cluster);
  return {
    data: {
      n_samples: 6,
      n_windows: 5,
      chrom: 'LG_TEST',
      windows: Array.from({ length: 5 }, () => ({})),
      l2_envelopes: [{ _s0: 0, _e0: 4 }],
    },
    l2GroupCache,
    bandingResult: {
      stage3: {
        loci: [
          { s: 0, e: 4, K: 3, chromosome_idx: 0 },
        ],
      },
    },
    cur: 2,
    // Mock getLabels(w) for locusBandSampleSets to consume via our shim
    __testLabels: labels,
  };
}

// Override the internal getLabels-from-cache path by stubbing
// state.l2GroupCache to always return the test cluster. Window→envelope
// mapping in macrostripe.js#_makeGetLabelsForLocus does the lookup.

group('getMacrostripeIdsAtWindow on a stable 3-band fixture');
{
  const state = makeState();
  // First call computes; should give Int8Array of length 6.
  const ids = getMacrostripeIdsAtWindow(state, 2);
  check('returns Int8Array',           ids instanceof Int8Array);
  check('length = n_samples',          ids && ids.length === 6);
  // Verify per-sample assignment matches the labels.
  check('sample 0 → band 0',           ids && ids[0] === 0);
  check('sample 2 → band 1',           ids && ids[2] === 1);
  check('sample 5 → band 2',           ids && ids[5] === 2);
}

group('cache: repeat call returns same object');
{
  const state = makeState();
  const a = getMacrostripeIdsAtWindow(state, 2);
  const b = getMacrostripeIdsAtWindow(state, 2);
  check('repeat call returns SAME cached object', a === b);
}

group('invalidateMacrostripeCache resets');
{
  const state = makeState();
  const a = getMacrostripeIdsAtWindow(state, 2);
  invalidateMacrostripeCache(state);
  const b = getMacrostripeIdsAtWindow(state, 2);
  check('after invalidate, fresh compute (new object)', a !== b);
  check('values still correct after recompute',
        b[0] === 0 && b[2] === 1 && b[5] === 2);
}

group('returns null when bandingResult absent');
{
  const state = makeState();
  delete state.bandingResult;
  const ids = getMacrostripeIdsAtWindow(state, 2);
  check('no bandingResult → null', ids === null);
}

group('returns null when window outside any locus');
{
  const state = makeState();
  // Locus covers [0, 4]; ask for window 99
  const ids = getMacrostripeIdsAtWindow(state, 99);
  check('window outside locus range → null', ids === null);
}

group('getMacrostripeIdPerSample uses state.cur');
{
  const state = makeState();
  state.cur = 3;
  const ids = getMacrostripeIdPerSample(state);
  check('reads state.cur',  ids instanceof Int8Array);
  check('sample 4 → band 2', ids && ids[4] === 2);
}

group('getMacrostripeColor returns CSS color');
{
  const state = makeState();
  const c = getMacrostripeColor(state, 0);
  check('sample 0 → some color',     typeof c === 'string' && c.length > 0);
  // Sample 2 + sample 4 are in different bands → distinct colors.
  const c2 = getMacrostripeColor(state, 2);
  const c4 = getMacrostripeColor(state, 4);
  check('different bands → different colors', c2 !== c4);
}

group('getMacrostripeColor null cases');
{
  const state = makeState();
  delete state.bandingResult;
  const c = getMacrostripeColor(state, 0);
  check('no bandingResult → null', c === null);
}

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
