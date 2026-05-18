// tests/test_page1_inheritance.js
//
// Unit tests for pages/discovery/local_pca_dosage/inheritance.js — state-managed
// inheritance-group orchestrator. Wraps shared/inheritance_groups.js
// with item gathering, cache management, and last-compute status.

import {
  INH_LABEL_KEY,
  INH_LABELS_DEFAULT_ON,
  INH_LABEL_STRIP_HEIGHT,
  INH_LABEL_FONT_PX,
  INH_LABEL_MIN_BAND_PX,
  isAutoCandidate,
  hashLockedLabels,
  gatherActiveCandidatesForInheritance,
  inheritanceCacheKey,
  runInheritanceCompute,
  invalidateInheritanceCache,
  formatInheritanceLabel,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/inheritance.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('INH_LABEL_KEY',       INH_LABEL_KEY === 'inversion_atlas.linesInheritanceLabelsOn');
check('LABELS_DEFAULT_ON',   INH_LABELS_DEFAULT_ON === true);
check('STRIP_HEIGHT = 11',   INH_LABEL_STRIP_HEIGHT === 11);
check('FONT_PX = 9',         INH_LABEL_FONT_PX === 9);
check('MIN_BAND_PX = 12',    INH_LABEL_MIN_BAND_PX === 12);

// =====================================================================
group('isAutoCandidate');
check('null → false',                isAutoCandidate(null) === false);
check('confirmed → false (even auto_)',
      isAutoCandidate({ confirmed: true, source: 'auto_xyz' }) === false);
check('source starts auto_ → true',  isAutoCandidate({ source: 'auto_sweep' }) === true);
check('source = user_promoted → false',
      isAutoCandidate({ source: 'user_promoted' }) === false);
check('no source → false',           isAutoCandidate({}) === false);
check('non-string source → false',   isAutoCandidate({ source: 42 }) === false);

// =====================================================================
group('hashLockedLabels');
check('empty → 0',                   hashLockedLabels([]) === 0);
check('null → 0',                    hashLockedLabels(null) === 0);
{
  const h1 = hashLockedLabels([0, 0, 1, 1, 2]);
  const h2 = hashLockedLabels([0, 0, 1, 1, 2]);
  check('same labels → same hash',   h1 === h2);
  const h3 = hashLockedLabels([0, 1, 0, 1, 2]);   // permuted
  check('permuted labels → different hash',  h1 !== h3);
  check('hash is unsigned 32-bit',           h1 >= 0 && h1 <= 0xFFFFFFFF);
}

// =====================================================================
group('gatherActiveCandidatesForInheritance');
{
  check('null state → []',          gatherActiveCandidatesForInheritance(null).length === 0);
  check('no candidates → []',       gatherActiveCandidatesForInheritance({}).length === 0);

  // Build a state with 3 candidates: two confirmed, one auto-only.
  // Also one missing locked_labels (must be excluded) and one missing bp.
  const state = {
    k: 3,
    activeMode: 'default',
    candidates: {
      A: { K: 3, locked_labels: [0, 1, 2], start_bp: 1e6, end_bp: 2e6, confirmed: true },
      B: { K: 3, locked_labels: [0, 0, 1], start_bp: 5e6, end_bp: 6e6, confirmed: true },
      C: { K: 3, locked_labels: [1, 1, 2], start_bp: 3e6, end_bp: 4e6, source: 'auto_sweep' },
      D: { K: 3, /* no locked_labels */    start_bp: 7e6, end_bp: 8e6, confirmed: true },
      E: { K: 3, locked_labels: [0, 1, 2], /* no bp */ confirmed: true },
    },
  };
  const items = gatherActiveCandidatesForInheritance(state);
  check('3 filtered: A, B, (C excluded auto), (D missing labels), (E missing bp)',
        items.length === 2);
  check('sorted by start_bp: A first, B second',
        items[0].id === 'A' && items[1].id === 'B');
  check('seq_num assigned: 1, 2',
        items[0].seq_num === 1 && items[1].seq_num === 2);
  check('K propagated from candidate',  items[0].K === 3);
  check('labels reference preserved',   items[0].labels === state.candidates.A.locked_labels);
}

// =====================================================================
group('gatherActiveCandidatesForInheritance — detailed mode');
{
  // activeMode = 'detailed' reads from candidates_detailed instead.
  const state = {
    k: 3,
    activeMode: 'detailed',
    candidates: {
      A: { K: 3, locked_labels: [0, 1, 2], start_bp: 1e6, end_bp: 2e6, confirmed: true },
    },
    candidates_detailed: {
      X: { K: 3, locked_labels: [0, 1, 2], start_bp: 1e6, end_bp: 2e6, confirmed: true },
      Y: { K: 3, locked_labels: [0, 1, 2], start_bp: 3e6, end_bp: 4e6, confirmed: true },
    },
  };
  const items = gatherActiveCandidatesForInheritance(state);
  check('detailed mode reads candidates_detailed',
        items.length === 2 && items[0].id === 'X');
}

// =====================================================================
group('inheritanceCacheKey');
{
  const items = [
    { id: 'A', K: 3, labels: [0, 1, 2], start_bp: 1e6, end_bp: 2e6 },
    { id: 'B', K: 3, labels: [0, 0, 1], start_bp: 5e6, end_bp: 6e6 },
  ];
  const k1 = inheritanceCacheKey(items, 'default');
  const k2 = inheritanceCacheKey(items, 'default');
  check('same inputs → same key',      k1 === k2);
  check('different mode → different key',
        k1 !== inheritanceCacheKey(items, 'detailed'));
  check('explicit threshold → different key',
        k1 !== inheritanceCacheKey(items, 'default', 0.25));
  // threshold jitter (< 4 decimals) does NOT fragment the cache
  check('threshold 0.15 vs 0.150001 → same key',
        inheritanceCacheKey(items, 'default', 0.15) ===
        inheritanceCacheKey(items, 'default', 0.150001));
  // label fingerprint folded in
  const items2 = [
    { id: 'A', K: 3, labels: [0, 1, 2], start_bp: 1e6, end_bp: 2e6 },
    { id: 'B', K: 3, labels: [1, 1, 2], start_bp: 5e6, end_bp: 6e6 },   // changed
  ];
  check('different labels → different key',
        k1 !== inheritanceCacheKey(items2, 'default'));
  // bp boundary shift invalidates
  const items3 = [
    { id: 'A', K: 3, labels: [0, 1, 2], start_bp: 1.1e6, end_bp: 2e6 },
    { id: 'B', K: 3, labels: [0, 0, 1], start_bp: 5e6, end_bp: 6e6 },
  ];
  check('shifted bp → different key',
        k1 !== inheritanceCacheKey(items3, 'default'));
}

// =====================================================================
group('formatInheritanceLabel');
check('single seq: I1·3g',   formatInheritanceLabel(1, 1, 3) === 'I1·3g');
check('range: I1-3·5g',      formatInheritanceLabel(1, 3, 5) === 'I1-3·5g');

// =====================================================================
group('runInheritanceCompute — insufficient items');
{
  check('null state → null',
        runInheritanceCompute(null) === null);

  const state = { candidates: {} };
  const r = runInheritanceCompute(state);
  check('no candidates: null',         r === null);
  check('status.ok = false',           state.inheritanceLastStatus.ok === false);
  check('status.reason = insufficient_items',
        state.inheritanceLastStatus.reason === 'insufficient_items');
  check('result + key cleared',
        state.inheritanceResult === null && state.inheritanceCacheKey === null);
}

// =====================================================================
group('runInheritanceCompute — happy path');
{
  // 2 candidates with identical labels — should yield 3 groups
  // (each band-pair is perfectly identical).
  const labels = [0, 0, 1, 1, 2, 2];
  const state = {
    k: 3,
    activeMode: 'default',
    candidates: {
      A: { K: 3, locked_labels: labels, start_bp: 1e6, end_bp: 2e6, confirmed: true },
      B: { K: 3, locked_labels: labels, start_bp: 3e6, end_bp: 4e6, confirmed: true },
    },
  };
  const r = runInheritanceCompute(state);
  check('non-null result',             r !== null);
  check('result on state.inheritanceResult', state.inheritanceResult === r);
  check('cache key set',               typeof state.inheritanceCacheKey === 'string');
  check('status.ok = true',            state.inheritanceLastStatus.ok === true);
  check('status.reason = computed',    state.inheritanceLastStatus.reason === 'computed');
  check('status.n_items = 2',          state.inheritanceLastStatus.n_items === 2);
  check('result.rtab.group_ids.length === 3',
        r.rtab.group_ids.length === 3);
  check('items_meta has 2 entries with seq_num',
        r.items_meta.length === 2
        && r.items_meta[0].seq_num === 1
        && r.items_meta[1].seq_num === 2);

  // Second call: cache hit
  const r2 = runInheritanceCompute(state);
  check('second call returns cached object',  r2 === r);
  check('status.reason = cached',             state.inheritanceLastStatus.reason === 'cached');

  // Force flag: recomputes
  const r3 = runInheritanceCompute(state, { force: true });
  check('force=true: recomputes (different object)',  r3 !== r);
  check('status.reason = computed after force',       state.inheritanceLastStatus.reason === 'computed');

  // Explicit threshold
  const r4 = runInheritanceCompute(state, { threshold: 1.5, force: true });
  check('threshold 1.5: 1 group (everything merges)',
        r4.rtab.group_ids.length === 1);
}

// =====================================================================
group('runInheritanceCompute — threshold falls back to state.gPanelInheritanceThreshold');
{
  const labels = [0, 0, 1, 1, 2, 2];
  const state = {
    k: 3,
    activeMode: 'default',
    gPanelInheritanceThreshold: 1.5,
    candidates: {
      A: { K: 3, locked_labels: labels, start_bp: 1e6, end_bp: 2e6, confirmed: true },
      B: { K: 3, locked_labels: labels, start_bp: 3e6, end_bp: 4e6, confirmed: true },
    },
  };
  const r = runInheritanceCompute(state);
  check('state threshold used: 1 group',     r.rtab.group_ids.length === 1);
  check('status.threshold = 1.5',            state.inheritanceLastStatus.threshold === 1.5);
}

// =====================================================================
group('invalidateInheritanceCache');
{
  const state = {
    inheritanceResult: { stale: true },
    inheritanceCacheKey: 'stale_key',
    inheritanceLastStatus: { ok: true },
  };
  invalidateInheritanceCache(state);
  check('result cleared',              state.inheritanceResult === null);
  check('cache key cleared',           state.inheritanceCacheKey === null);
  check('last status cleared',         state.inheritanceLastStatus === null);

  // null state: no throw
  let threw = false;
  try { invalidateInheritanceCache(null); } catch (_) { threw = true; }
  check('null state: no throw',        !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
