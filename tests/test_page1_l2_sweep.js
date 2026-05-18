// tests/test_page1_l2_sweep.js
//
// Unit tests for pages/discovery/local_pca_dosage/l2_sweep.js — the auto-promote
// pipeline that turns interesting L2 envelopes into candidates when
// state.l2SweepEnabled is true.

import {
  AUTO_PROMOTE_MIN_SILHOUETTE,
  AUTO_PROMOTE_MIN_GROUPS,
  AUTO_PROMOTE_MIN_BAND_SIZE,
  AUTO_PROMOTE_DEDUPE_BP,
  L2_SWEEP_DISMISSED_KEY_PFX,
  loadL2SweepDismissed,
  saveL2SweepDismissed,
  addL2SweepDismissed,
  invalidateL2SweepCache,
  autoPromoteFromSweep,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/l2_sweep.js';
import {
  ClusterCache,
  contextFromState,
  clusterCacheKey,
} from '../atlases/inversion/shared/per_l2_cluster.js';

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

// Minimal `document` shim — just enough for addCandidateToList's
// persistCandidateList + refreshCandidateUI to not throw on missing
// DOM. None of these calls do anything visible in Node; they just have
// to be no-ops.
function installDocument() {
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {}, dataset: {}, classList: { add() {}, remove() {} },
      setAttribute() {}, appendChild() {}, addEventListener() {},
      removeEventListener() {}, click() {},
    }),
    body: { appendChild() {}, removeChild() {} },
  };
}
function uninstallDocument() { delete globalThis.document; }

// =====================================================================
group('constants');
check('MIN_SILHOUETTE = 0.30',           AUTO_PROMOTE_MIN_SILHOUETTE === 0.30);
check('MIN_GROUPS = 2',                  AUTO_PROMOTE_MIN_GROUPS === 2);
check('MIN_BAND_SIZE = 5',               AUTO_PROMOTE_MIN_BAND_SIZE === 5);
check('DEDUPE_BP = 100_000',             AUTO_PROMOTE_DEDUPE_BP === 100_000);
check('DISMISSED_KEY_PFX',
      L2_SWEEP_DISMISSED_KEY_PFX === 'pca_scrubber_v3.l2SweepDismissed.');

// =====================================================================
group('dismissed-set persistence (with localStorage shim)');
{
  installLocalStorage();
  check('load with no chrom → empty Set',     loadL2SweepDismissed(null).size === 0);
  check('load with unset chrom → empty Set',  loadL2SweepDismissed('LG28').size === 0);
  saveL2SweepDismissed('LG28', new Set([3, 5, 7]));
  const got = loadL2SweepDismissed('LG28');
  check('saved set round-trips: size = 3',    got.size === 3);
  check('contains 3, 5, 7',                   got.has(3) && got.has(5) && got.has(7));
  addL2SweepDismissed('LG28', 11);
  const got2 = loadL2SweepDismissed('LG28');
  check('add appends: size = 4',              got2.size === 4 && got2.has(11));
  // null guards
  saveL2SweepDismissed(null, new Set([1]));
  check('save with no chrom: no-op (no key added for null)',
        localStorage.getItem(L2_SWEEP_DISMISSED_KEY_PFX + 'null') === null);
  addL2SweepDismissed(null, 99);
  addL2SweepDismissed('LG28', 'not-an-int');
  const got3 = loadL2SweepDismissed('LG28');
  check('add ignores non-int and null-chrom',  got3.size === 4);
  // Corrupt JSON: fail-soft to empty
  localStorage.setItem(L2_SWEEP_DISMISSED_KEY_PFX + 'LG07', '{not-json');
  check('corrupt JSON → empty Set',           loadL2SweepDismissed('LG07').size === 0);
  uninstallLocalStorage();
  uninstallDocument();
}

// =====================================================================
group('dismissed-set headless tolerance (no localStorage)');
check('load: empty Set without localStorage',  loadL2SweepDismissed('LG28').size === 0);
{
  let threw = false;
  try { saveL2SweepDismissed('LG28', new Set([1])); }
  catch (_) { threw = true; }
  check('save: no-throw without localStorage', !threw);
}

// =====================================================================
group('invalidateL2SweepCache');
{
  const state = { l2SweepResult: { stale: true }, l2SweepCacheKey: 'old' };
  invalidateL2SweepCache(state);
  check('result cleared',     state.l2SweepResult === null);
  check('cache key cleared',  state.l2SweepCacheKey === null);

  let threw = false;
  try { invalidateL2SweepCache(null); } catch (_) { threw = true; }
  check('null state: no throw', !threw);
}

// =====================================================================
// Build a synthetic sweep result that autoPromoteFromSweep can chew on.
// Five L2 candidates with different gate failure modes:
//   l2idx 10: PASSES every gate
//   l2idx 20: LOW_SILHOUETTE (silhouette 0.10)
//   l2idx 30: SMALL_BAND (n_per_group = [4, 50])
//   l2idx 40: TOO_FEW_GROUPS (only 1 group touches it)
//   l2idx 50: DEDUPE_TOO_CLOSE (within 100 kb of l2idx 10)
//   l2idx 60: DISMISSED (in dismissed set)
//   l2idx 70: ALREADY_IN_CANDIDATE (covered by saved candidate)
// =====================================================================
function makeFixtureState() {
  installLocalStorage();
  installDocument();
  saveL2SweepDismissed('LG28', new Set([60]));
  // Only l2_envelopes[10] needs to exist (it's the L2 that passes every
  // gate); the rest get rejected before any envelope lookup. Pre-seed
  // state._l2ClusterCache so getL2Cluster(state, 10) hits without
  // invoking the real clusterL2 compute (which needs a fully-populated
  // state.data.windows/n_samples/sim_mat etc.).
  const envelopes = [];
  envelopes[10] = {
    start_bp: 10_000_000, end_bp: 11_000_000, _s0: 100, _e0: 110,
  };
  const fakeCluster = {
    ok: true,
    fixedKLabels: new Int8Array([0, 0, 1, 1, 2, 2]),
    nW: 11, usedK: 3, n_per_group: [2, 2, 2],
  };
  const state = {
    k: 3,
    activeMode: 'default',
    data: {
      chrom: 'LG28',
      l2_envelopes: envelopes,
      n_samples: 6,
    },
    candidateList: [
      { id: 'existing_1', l2_indices: [70], start_bp: 70_000_000, end_bp: 71_000_000 },
    ],
  };
  // Seed the cluster cache. clusterCacheKey reads ctx.k / kMode / aggMethod
  // / minNGroup / minNWin / silThreshold / kRange — match what contextFromState
  // would compute from this state.
  const ctx = contextFromState(state);
  const cache = new ClusterCache();
  cache._key = clusterCacheKey(ctx);
  cache._map.set(10, fakeCluster);
  state._l2ClusterCache = cache;
  return state;
}

function makeFixtureResult() {
  return {
    items_meta: [
      { id: 'L2:10', K: 3, seq_num: 1, start_bp: 10_000_000, end_bp: 11_000_000 },
      { id: 'L2:20', K: 3, seq_num: 2, start_bp: 20_000_000, end_bp: 21_000_000 },
      { id: 'L2:30', K: 3, seq_num: 3, start_bp: 30_000_000, end_bp: 31_000_000 },
      { id: 'L2:40', K: 3, seq_num: 4, start_bp: 40_000_000, end_bp: 41_000_000 },
      { id: 'L2:50', K: 3, seq_num: 5, start_bp: 10_050_000, end_bp: 10_950_000 },
      { id: 'L2:60', K: 3, seq_num: 6, start_bp: 60_000_000, end_bp: 61_000_000 },
      { id: 'L2:70', K: 3, seq_num: 7, start_bp: 70_000_000, end_bp: 71_000_000 },
    ],
    l2_meta: [
      { l2idx: 10, item_idx: 0, start_bp: 10_000_000, end_bp: 11_000_000,
        n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 },
      { l2idx: 20, item_idx: 1, start_bp: 20_000_000, end_bp: 21_000_000,
        n_per_group: [50, 50, 50], silhouette: 0.10, n_bands: 3 },     // FAILS gate 3
      { l2idx: 30, item_idx: 2, start_bp: 30_000_000, end_bp: 31_000_000,
        n_per_group: [4, 50, 50], silhouette: 0.55, n_bands: 3 },      // FAILS gate 4
      { l2idx: 40, item_idx: 3, start_bp: 40_000_000, end_bp: 41_000_000,
        n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 },     // FAILS gate 5
      { l2idx: 50, item_idx: 4, start_bp: 10_050_000, end_bp: 10_950_000,
        n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 },     // FAILS gate 6
      { l2idx: 60, item_idx: 5, start_bp: 60_000_000, end_bp: 61_000_000,
        n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 },     // FAILS gate 1
      { l2idx: 70, item_idx: 6, start_bp: 70_000_000, end_bp: 71_000_000,
        n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 },     // FAILS gate 2
    ],
    // rtab tells the gate-2 logic which item_idxs touch >=2 groups.
    rtab: {
      group_ids: [0, 1, 2],
      per_group: {
        0: { 0: [0, 1], 1: [0], 2: [0], 4: [0], 5: [0], 6: [0] },
        1: { 0: [1], 1: [1], 2: [1], 4: [1], 5: [1], 6: [1] },
        2: { 0: [2], 1: [2], 2: [2], 3: [0],   4: [2], 5: [2], 6: [2] },
      },
    },
  };
}

// =====================================================================
group('autoPromoteFromSweep — happy path: only L2:10 promotes');
{
  const state = makeFixtureState();
  const result = makeFixtureResult();
  const { promoted, skipped } = autoPromoteFromSweep(state, result);
  check('exactly 1 L2 promoted',         promoted.length === 1);
  check('promoted L2 = 10',              promoted[0] === 10);
  check('6 L2s skipped',                 skipped.length === 6);
  // Inspect each skip reason
  const byL2 = Object.fromEntries(skipped.map(s => [s.l2idx, s.reason]));
  check('L2:20 → LOW_SILHOUETTE',       byL2[20] === 'LOW_SILHOUETTE');
  check('L2:30 → SMALL_BAND',           byL2[30] === 'SMALL_BAND');
  check('L2:40 → TOO_FEW_GROUPS',       byL2[40] === 'TOO_FEW_GROUPS');
  check('L2:50 → DEDUPE_TOO_CLOSE',     byL2[50] === 'DEDUPE_TOO_CLOSE');
  check('L2:60 → DISMISSED',            byL2[60] === 'DISMISSED');
  check('L2:70 → ALREADY_IN_CANDIDATE', byL2[70] === 'ALREADY_IN_CANDIDATE');
  // The promoted candidate was added to state.candidateList
  check('candidate list grew from 1 → 2', state.candidateList.length === 2);
  const added = state.candidateList[1];
  check('new candidate has source = auto_l2_sweep',
        added.source === 'auto_l2_sweep');
  check('new candidate confirmed = false',  added.confirmed === false);
  check('new candidate carries L2 ids',     added.l2_indices && added.l2_indices[0] === 10);
  check('new candidate id starts with auto_l2sweep_',
        added.id && added.id.startsWith('auto_l2sweep_'));
  uninstallLocalStorage();
  uninstallDocument();
}

// =====================================================================
group('autoPromoteFromSweep — empty inputs');
check('null state → empty result',
      autoPromoteFromSweep(null, {}).promoted.length === 0);
check('null result → empty result',
      autoPromoteFromSweep({}, null).promoted.length === 0);
check('no l2_meta → empty result',
      autoPromoteFromSweep({}, {}).promoted.length === 0);
check('empty l2_meta → empty result',
      autoPromoteFromSweep({}, { l2_meta: [] }).promoted.length === 0);

// =====================================================================
group('autoPromoteFromSweep — silhouette boundary (=0.30 passes)');
{
  installLocalStorage();
  const state = {
    k: 3, activeMode: 'default',
    data: { chrom: 'LG28', l2_envelopes: [] },
    candidateList: [],
  };
  const r = {
    items_meta: [
      { id: 'L2:5', K: 3, seq_num: 1, start_bp: 1e6, end_bp: 2e6 },
    ],
    l2_meta: [
      { l2idx: 5, item_idx: 0, start_bp: 1e6, end_bp: 2e6,
        n_per_group: [50, 50, 50], silhouette: 0.30, n_bands: 3 },
    ],
    rtab: {
      group_ids: [0, 1, 2],
      per_group: {
        0: { 0: [0] }, 1: { 0: [1] }, 2: { 0: [2] },
      },
    },
  };
  // l2_envelopes[5] doesn't exist → cand build will fail. Skip the
  // happy-path assertion and instead verify the gate doesn't reject at
  // boundary 0.30. (Test would need a fuller fixture for full promote.)
  const { promoted, skipped } = autoPromoteFromSweep(state, r);
  // The promote may still ADD_THREW because l2_envelopes[5] is undef.
  // But the LOW_SILHOUETTE reason must NOT appear.
  const reasons = skipped.map(s => s.reason);
  check('silhouette = 0.30 passes gate 3',  !reasons.includes('LOW_SILHOUETTE'));
  uninstallLocalStorage();
  uninstallDocument();
}

// =====================================================================
group('autoPromoteFromSweep — dedupe distance boundary');
{
  installLocalStorage();
  // Existing candidate at [10M, 11M]. Test L2 at [11.1M, 12M] is
  // exactly 100kb away (boundary). Distance is calculated as
  // max(0, max(11.1M, 10M) - min(12M, 11M)) = max(0, 11.1M - 11M)
  // = 100_000 exactly. The gate uses strict `<` so distance = 100_000
  // does NOT qualify as too close → promotes.
  const state = {
    k: 3, activeMode: 'default',
    data: { chrom: 'LG28', l2_envelopes: [] },
    candidateList: [
      { id: 'existing', start_bp: 10_000_000, end_bp: 11_000_000 },
    ],
  };
  const r = {
    items_meta: [{ id: 'L2:5', K: 3, seq_num: 1, start_bp: 11_100_000, end_bp: 12_000_000 }],
    l2_meta: [{ l2idx: 5, item_idx: 0, start_bp: 11_100_000, end_bp: 12_000_000,
                n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 }],
    rtab: {
      group_ids: [0, 1, 2],
      per_group: { 0: { 0: [0] }, 1: { 0: [1] }, 2: { 0: [2] } },
    },
  };
  const { skipped } = autoPromoteFromSweep(state, r);
  const reasons = skipped.map(s => s.reason);
  check('distance = 100_000 passes gate 6 (strict <)',
        !reasons.includes('DEDUPE_TOO_CLOSE'));

  // Closer pair: 50_000 bp gap → must skip
  state.candidateList = [{ id: 'existing', start_bp: 10_000_000, end_bp: 11_000_000 }];
  r.l2_meta = [{ l2idx: 5, item_idx: 0, start_bp: 11_050_000, end_bp: 12_000_000,
                  n_per_group: [50, 50, 50], silhouette: 0.55, n_bands: 3 }];
  r.items_meta = [{ id: 'L2:5', K: 3, seq_num: 1, start_bp: 11_050_000, end_bp: 12_000_000 }];
  const { skipped: skipped2 } = autoPromoteFromSweep(state, r);
  check('distance = 50_000 fails gate 6',
        skipped2.some(s => s.reason === 'DEDUPE_TOO_CLOSE'));
  uninstallLocalStorage();
  uninstallDocument();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
