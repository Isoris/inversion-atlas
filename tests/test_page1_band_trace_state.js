// tests/test_page1_band_trace_state.js
//
// Unit tests for pages/discovery/page1/band_trace_state.js — the
// state-managed wrapper around shared/band_trace.js.

import {
  BTRACE_ON_LS_KEY,
  BTRACE_FISH_SET_LS_KEY,
  bandTraceCacheKey,
  bandTraceGetOrCompute,
  setBandTraceFishSet,
  setBandTraceOn,
  loadBandTraceState,
  bandTraceFromFocalCandidate,
} from '../atlases/inversion/pages/discovery/page1/band_trace_state.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// In-memory localStorage shim
function installLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  return store;
}
function uninstallLocalStorage() { delete globalThis.localStorage; }

// =====================================================================
group('bandTraceCacheKey — fingerprint determinism');
{
  const k1 = bandTraceCacheKey('LG28', [1, 2, 3], 3, 50);
  const k2 = bandTraceCacheKey('LG28', [3, 2, 1], 3, 50);   // same set, diff order
  const k3 = bandTraceCacheKey('LG28', new Set([1, 2, 3]), 3, 50);
  check('same set, different order → same key',  k1 === k2);
  check('Set vs Array with same members → same key', k1 === k3);

  const k4 = bandTraceCacheKey('LG28', [1, 2, 3], 3, 60);   // diff envelope count
  check('different n_envelopes → different key', k1 !== k4);
  const k5 = bandTraceCacheKey('LG28', [1, 2, 3], 4, 50);   // diff K
  check('different K → different key',           k1 !== k5);
  const k6 = bandTraceCacheKey('LG07', [1, 2, 3], 3, 50);   // diff chrom
  check('different chrom → different key',       k1 !== k6);

  check('null fish-set → null key',   bandTraceCacheKey('LG28', null, 3, 50) === null);
}

// =====================================================================
group('setBandTraceFishSet — basic behaviour');
{
  installLocalStorage();
  const state = { bandTraceFishSet: null, bandTraceCache: { stale: true },
                  bandTraceCacheKey: 'stale' };
  const out = setBandTraceFishSet(state, [3, 1, 1, 2, -1]);
  check('returns deduped + non-negative array', Array.isArray(out) && out.length === 3);
  check('preserves order of first appearance',  out[0] === 3 && out[1] === 1 && out[2] === 2);
  check('writes state.bandTraceFishSet',        state.bandTraceFishSet === out);
  check('invalidates cache',                    state.bandTraceCache === null && state.bandTraceCacheKey === null);
  check('persists to localStorage',
        localStorage.getItem(BTRACE_FISH_SET_LS_KEY) === JSON.stringify(out));

  // Clear path
  const cleared = setBandTraceFishSet(state, null);
  check('null arg clears fish-set',             cleared === null && state.bandTraceFishSet === null);
  check('null arg removes from localStorage',   localStorage.getItem(BTRACE_FISH_SET_LS_KEY) === null);

  // Null state guard
  check('null state → null',                    setBandTraceFishSet(null, [1, 2, 3]) === null);
  uninstallLocalStorage();
}

// =====================================================================
group('setBandTraceOn — toggle + persist');
{
  installLocalStorage();
  const state = {};
  setBandTraceOn(state, true);
  check('state.bandTraceOn = true',  state.bandTraceOn === true);
  check('localStorage = "1"',        localStorage.getItem(BTRACE_ON_LS_KEY) === '1');
  setBandTraceOn(state, false);
  check('state.bandTraceOn = false', state.bandTraceOn === false);
  check('localStorage = "0"',        localStorage.getItem(BTRACE_ON_LS_KEY) === '0');
  setBandTraceOn(state, 'truthy');   // coerce
  check('truthy coerces to true',    state.bandTraceOn === true);
  // null state: should not throw
  let threw = false;
  try { setBandTraceOn(null, true); } catch (_) { threw = true; }
  check('null state: no throw',      !threw);
  uninstallLocalStorage();
}

// =====================================================================
group('loadBandTraceState — round-trip via localStorage');
{
  installLocalStorage();
  const writeState = {};
  setBandTraceOn(writeState, true);
  setBandTraceFishSet(writeState, [5, 7, 9]);

  const readState = {};
  loadBandTraceState(readState);
  check('on/off restored to true',         readState.bandTraceOn === true);
  check('fish-set restored: 3 entries',    Array.isArray(readState.bandTraceFishSet) && readState.bandTraceFishSet.length === 3);
  check('fish-set includes 5',             readState.bandTraceFishSet.includes(5));
  check('fish-set includes 7',             readState.bandTraceFishSet.includes(7));
  check('fish-set includes 9',             readState.bandTraceFishSet.includes(9));
  check('cache cleared on load',           readState.bandTraceCache === null);

  // Default when nothing persisted
  uninstallLocalStorage();
  installLocalStorage();
  const empty = {};
  loadBandTraceState(empty);
  check('no storage: on = false (default)', empty.bandTraceOn === false);
  check('no storage: fish-set null',        empty.bandTraceFishSet === null);

  // Corrupt JSON in storage → fail-soft
  localStorage.setItem(BTRACE_FISH_SET_LS_KEY, '{not-json');
  const corrupt = {};
  let threw = false;
  try { loadBandTraceState(corrupt); } catch (_) { threw = true; }
  check('corrupt JSON: no throw',           !threw);
  check('corrupt JSON: fish-set null',      corrupt.bandTraceFishSet === null);

  uninstallLocalStorage();
}

// =====================================================================
group('bandTraceGetOrCompute — empty-state short circuits');
check('null state → null',            bandTraceGetOrCompute(null) === null);
check('no fish-set → null',           bandTraceGetOrCompute({}) === null);
check('empty fish-set → null',
      bandTraceGetOrCompute({ bandTraceFishSet: [] }) === null);
check('no data → null',
      bandTraceGetOrCompute({ bandTraceFishSet: [1] }) === null);
check('no l2_envelopes → null',
      bandTraceGetOrCompute({ bandTraceFishSet: [1], data: {} }) === null);
check('empty l2_envelopes → null',
      bandTraceGetOrCompute({ bandTraceFishSet: [1],
                              data: { l2_envelopes: [] } }) === null);

// =====================================================================
group('bandTraceGetOrCompute — caching');
{
  // Synthesise a minimal state with an l2GroupCache that returns labels
  // for 3 L2s. All samples are in band 0 → trace.regime should be co_seg.
  const N_SAMPLES = 6;
  const K = 3;
  const labels = new Int8Array(N_SAMPLES);   // all zeros → band 0
  const l2GroupCache = new Map([
    [0, { labels }],
    [1, { labels }],
    [2, { labels }],
  ]);
  const state = {
    k: K,
    bandTraceFishSet: [0, 1, 2, 3, 4, 5],
    data: { chrom: 'LG28', l2_envelopes: [{}, {}, {}] },
    l2GroupCache,
  };
  const t1 = bandTraceGetOrCompute(state);
  check('first call returns non-null trace',  t1 !== null);
  check('trace has 3 per_l2 entries',         t1.per_l2.length === 3);
  check('cache populated',                    state.bandTraceCache === t1);
  check('cache key populated',                typeof state.bandTraceCacheKey === 'string');

  const t2 = bandTraceGetOrCompute(state);
  check('second call returns cached object',  t2 === t1);

  // Invalidate by changing the fish-set → cache key should drift
  setBandTraceFishSet(state, [0, 1, 2]);
  // ^ that sets cache to null directly. Verify next get recomputes.
  const t3 = bandTraceGetOrCompute(state);
  check('after fish-set change: recomputes',  t3 !== null && t3 !== t1);
}

// =====================================================================
group('bandTraceFromFocalCandidate — seed from largest band');
{
  installLocalStorage();
  // Candidate with 6 samples, K=3 bands. Membership: band 0 → 1 sample,
  // band 1 → 4 samples, band 2 → 1 sample. Largest = band 1.
  const state = {
    candidate: {
      K: 3,
      locked_labels: [0, 1, 1, 1, 1, 2],
    },
  };
  const result = bandTraceFromFocalCandidate(state);
  check('returns the picked fish-set',         Array.isArray(result));
  check('fish-set has 4 members (band 1 size)', result.length === 4);
  check('fish-set members match band 1 indices',
        result.includes(1) && result.includes(2)
        && result.includes(3) && result.includes(4));
  check('also writes state.bandTraceFishSet',
        Array.isArray(state.bandTraceFishSet)
        && state.bandTraceFishSet.length === 4);

  // Caller-specified band
  const state2 = {
    candidate: { K: 3, locked_labels: [0, 1, 1, 1, 1, 2] },
  };
  const r2 = bandTraceFromFocalCandidate(state2, { bandIdx: 0 });
  check('opts.bandIdx picks specific band',    r2.length === 1 && r2[0] === 0);
  const r3 = bandTraceFromFocalCandidate(state2, { bandIdx: 2 });
  check('opts.bandIdx=2 picks sample 5',       r3.length === 1 && r3[0] === 5);

  // Empty band → null
  const r4 = bandTraceFromFocalCandidate(state2, { bandIdx: 99 });
  // Out-of-range bandIdx falls back to largest, so this picks band 1 again
  check('out-of-range bandIdx falls back to largest', r4.length === 4);

  // No candidate
  check('no candidate → null',     bandTraceFromFocalCandidate({}) === null);
  check('no locked_labels → null', bandTraceFromFocalCandidate({ candidate: {} }) === null);
  check('null state → null',       bandTraceFromFocalCandidate(null) === null);

  uninstallLocalStorage();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
