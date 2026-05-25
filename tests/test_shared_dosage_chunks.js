// tests/test_shared_dosage_chunks.js
//
// Unit coverage for shared/dosage_chunks.js — chunk readers + per-L2
// het-rate computation (legacy lines 16540-16800).

import * as DC from '../atlases/inversion/shared/dosage_chunks.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('chunkGet');
const chunk = {
  dosage: [
    [0, 1, 2, -1],
    [1, 1, -1, 0],
  ],
};
check('valid 0 returned',     DC.chunkGet(chunk, 0, 0) === 0);
check('valid 1 returned',     DC.chunkGet(chunk, 0, 1) === 1);
check('valid 2 returned',     DC.chunkGet(chunk, 0, 2) === 2);
check('-1 → null',            DC.chunkGet(chunk, 0, 3) === null);

check('null chunk → null',    DC.chunkGet(null, 0, 0) === null);
check('no dosage → null',     DC.chunkGet({}, 0, 0) === null);
check('missing row → null',   DC.chunkGet(chunk, 99, 0) === null);

// -----------------------------------------------------------------------------
group('computeHetRateForRange: basic');
// 3 cohort samples; 1 chunk with 4 markers spanning bp 100..400.
// chunk.samples = ['S1', 'S2', 'S3'] aligns 1:1 with cohort.
// Markers + dosage:
//   m100: [0, 1, 2]     (S1=hom-REF, S2=HET, S3=hom-INV)
//   m200: [0, 1, 1]
//   m300: [1, 1, 0]
//   m400: [-1, 1, 0]    (S1=NA)
const fixtureState = {
  data: {
    n_samples: 3,
    samples: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }],
  },
};
const fixtureChunk = {
  samples: ['S1', 'S2', 'S3'],
  markers: [
    { pos_bp: 100 }, { pos_bp: 200 },
    { pos_bp: 300 }, { pos_bp: 400 },
  ],
  dosage: [
    [0, 1, 2],
    [0, 1, 1],
    [1, 1, 0],
    [-1, 1, 0],
  ],
};
const getCachedChunk = () => fixtureChunk;

const rates = DC.computeHetRateForRange(fixtureState, 0, 1000, { getCachedChunk });
check('returns Float32Array(3)',  rates instanceof Float32Array && rates.length === 3);
// S1: 3 non-NA (m100=0, m200=0, m300=1), 1 het (m300=1) → 1/3 ≈ 0.333
check('S1 het rate ≈ 0.333',      Math.abs(rates[0] - 1/3) < 1e-6);
// S2: 4 non-NA, all het (1) → 4/4 = 1.0
check('S2 het rate = 1.0',         rates[1] === 1.0);
// S3: 4 non-NA (2/1/0/0), 1 het → 1/4 = 0.25
check('S3 het rate = 0.25',         rates[2] === 0.25);

// -----------------------------------------------------------------------------
group('computeHetRateForRange: missing chunk / cache miss');
// No getCachedChunk → all-NaN
const ratesNoFn = DC.computeHetRateForRange(fixtureState, 0, 1000);
check('no getCachedChunk: all NaN',
      ratesNoFn.length === 3 && Array.from(ratesNoFn).every(v => Number.isNaN(v)));

// Callback returns null → all-NaN
const ratesNullCb = DC.computeHetRateForRange(fixtureState, 0, 1000,
                                              { getCachedChunk: () => null });
check('null chunk: all NaN',
      Array.from(ratesNullCb).every(v => Number.isNaN(v)));

// Invalid bp range
const ratesBadRange = DC.computeHetRateForRange(fixtureState, 500, 100,
                                                 { getCachedChunk });
check('end < start: all NaN',
      Array.from(ratesBadRange).every(v => Number.isNaN(v)));

// No markers in range
const ratesEmptyRange = DC.computeHetRateForRange(fixtureState, 5000, 6000,
                                                  { getCachedChunk });
check('no markers in range: all NaN',
      Array.from(ratesEmptyRange).every(v => Number.isNaN(v)));

// -----------------------------------------------------------------------------
group('computeHetRateForRange: cache');
const s2 = {
  data: { n_samples: 3, samples: fixtureState.data.samples },
};
const first = DC.computeHetRateForRange(s2, 0, 1000, {
  getCachedChunk, cacheKey: 'r1',
});
// Second call with same cacheKey: cache hit → returns identical reference
const second = DC.computeHetRateForRange(s2, 0, 1000, {
  getCachedChunk, cacheKey: 'r1',
});
check('cache hit: returns same reference',  first === second);

// Different cacheKey → fresh compute
const third = DC.computeHetRateForRange(s2, 0, 1000, {
  getCachedChunk, cacheKey: 'r2',
});
check('different cacheKey: fresh compute',  third !== first);

// Invalidate clears cache
DC.invalidateHetRateCache(s2);
const fourth = DC.computeHetRateForRange(s2, 0, 1000, {
  getCachedChunk, cacheKey: 'r1',
});
check('after invalidate: fresh compute',  fourth !== first);

// -----------------------------------------------------------------------------
group('computeHetRateForRange: NA samples');
// Samples present in cohort but not in chunk → NaN (not in idToCohort map)
const sExtra = {
  data: {
    n_samples: 4,
    samples: [
      { id: 'S1' }, { id: 'S2' }, { id: 'S3' },
      { id: 'EXTRA' },  // not in chunk
    ],
  },
};
const ratesExtra = DC.computeHetRateForRange(sExtra, 0, 1000, { getCachedChunk });
check('cohort sample missing from chunk → NaN',
      Number.isNaN(ratesExtra[3]) && rates[1] !== NaN);

// -----------------------------------------------------------------------------
group('computeHetRateForL2');
const sL2 = {
  data: {
    n_samples: 3,
    samples: fixtureState.data.samples,
    l2_envelopes: [
      { start_bp: 100, end_bp: 300 },
      { start_bp: 500, end_bp: 700 },  // out of chunk range
    ],
  },
};
const l2Rates = DC.computeHetRateForL2(sL2, 0, { getCachedChunk });
check('L2 0 het rates computed',
      l2Rates instanceof Float32Array && l2Rates.length === 3);
// S2 all-het in m100/m200/m300 → 1.0
check('L2 0 S2 = 1.0',  l2Rates[1] === 1.0);

// Missing L2 → all-NaN
check('out-of-range L2 → all NaN',
      Array.from(DC.computeHetRateForL2(sL2, 99, { getCachedChunk }))
        .every(v => Number.isNaN(v)));

// Empty envelopes array → all-NaN
check('no envelopes: all NaN',
      Array.from(DC.computeHetRateForL2({ data: { n_samples: 3 } }, 0,
                                         { getCachedChunk }))
        .every(v => Number.isNaN(v)));

// -----------------------------------------------------------------------------
group('computeHetRateForSlab');
const sSlab = {
  data: {
    n_samples: 3,
    samples: fixtureState.data.samples,
    windows: {
      start_bp: [0,   200, 400, 600],
      end_bp:   [199, 399, 599, 799],
    },
  },
};
// Slab [0..1] → bp [0..399]: markers m100 + m200 fall in range
const slabRates = DC.computeHetRateForSlab(sSlab, 0, 1, { getCachedChunk });
check('slab het rates computed',  slabRates instanceof Float32Array);
// m100 + m200: S2 is 1+1 = 2 het out of 2 non-NA → 1.0
check('slab S2 = 1.0',             slabRates[1] === 1.0);

// Invalid slab indices
check('endW < startW → all NaN',
      Array.from(DC.computeHetRateForSlab(sSlab, 2, 1, { getCachedChunk }))
        .every(v => Number.isNaN(v)));
check('out-of-range slab → all NaN',
      Array.from(DC.computeHetRateForSlab(sSlab, 0, 99, { getCachedChunk }))
        .every(v => Number.isNaN(v)));

// No windows
check('no windows: all NaN',
      Array.from(DC.computeHetRateForSlab({ data: { n_samples: 3 } }, 0, 1,
                                          { getCachedChunk }))
        .every(v => Number.isNaN(v)));

// -----------------------------------------------------------------------------
group('resetDosageDiagnosticsForChromChange');
{
  // Populate every slot the helper claims to clear; verify it does.
  const state = {
    __hetRateCache:                    new Map([['k1', new Float32Array([0.5])]]),
    __dosageMeanCache:                 new Map([['k2', new Float32Array([1.0])]]),
    __cohortSampleAliasMap:            { samples: [], map: new Map() },
    __chunkShapeValidated:             true,
    __dosageMatchRateLogged:           true,
    __hetAllNanLogged:                 true,
    __hetMarkerFilterLogged:           true,
    __dosageMeanAllNanLogged:          true,
    __dosageMeanMarkerFilterLogged:    true,
    __lastDosageFetchError:            { url: 'x', message: 'y', at: 1 },
    // Chunk LRU is INTENTIONALLY preserved across chrom changes.
    __dosageChunkLru:                  new Map([['LG01:1-1000', { samples: [] }]]),
  };
  DC.resetDosageDiagnosticsForChromChange(state);
  check('het-rate cache cleared',
        state.__hetRateCache.size === 0);
  check('dosage-mean cache cleared',
        state.__dosageMeanCache.size === 0);
  check('alias map cleared',
        state.__cohortSampleAliasMap === null);
  check('chunk-shape-validated flag reset',
        state.__chunkShapeValidated === false);
  check('match-rate-logged flag reset',
        state.__dosageMatchRateLogged === false);
  check('hetAllNan-logged flag reset',
        state.__hetAllNanLogged === false);
  check('hetMarkerFilter-logged flag reset',
        state.__hetMarkerFilterLogged === false);
  check('dosageMeanAllNan-logged flag reset',
        state.__dosageMeanAllNanLogged === false);
  check('dosageMeanMarkerFilter-logged flag reset',
        state.__dosageMeanMarkerFilterLogged === false);
  check('lastDosageFetchError cleared',
        state.__lastDosageFetchError === null);
  // Critical invariant: chunk LRU is NOT cleared (per-chrom navigation
  // back to a previously-visited chrom should reuse cached chunks).
  check('chunk LRU PRESERVED (per-chrom keys + covering-fallback already filter)',
        state.__dosageChunkLru.size === 1);
}

// Defensive: null / empty state shouldn't crash.
check('reset on null state → no throw',
      (() => { try { DC.resetDosageDiagnosticsForChromChange(null); return true; }
               catch (_) { return false; } })());
check('reset on empty state → no throw',
      (() => { try { DC.resetDosageDiagnosticsForChromChange({}); return true; }
               catch (_) { return false; } })());

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
