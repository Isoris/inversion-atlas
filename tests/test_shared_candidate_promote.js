// tests/test_shared_candidate_promote.js
//
// Unit coverage for shared/candidate_promote.js — candidate-builder
// helpers (legacy lines 57469-57565).

import * as CP from '../atlases/inversion/shared/candidate_promote.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
function _makeState() {
  return {
    k: 3,
    cur: 50,
    lockedLabels: new Int8Array([0, 1, 2, 0, 1, 2]),
    lockedRefL2:  1,
    data: {
      chrom: 'LG28',
      l2_envelopes: [
        { _s0: 0,   _e0: 10,  start_bp: 0,           end_bp: 1_000_000 },
        { _s0: 11,  _e0: 25,  start_bp: 1_100_000,   end_bp: 2_500_000 },
        { _s0: 26,  _e0: 40,  start_bp: 2_600_000,   end_bp: 4_000_000 },
        { _s0: 41,  _e0: 60,  start_bp: 4_100_000,   end_bp: 6_000_000 },
      ],
    },
  };
}
function _makeGetCluster(usedK) {
  return (l2idx) => ({
    labels: new Int8Array([0, 0, 1, 1, 2, 2, 0, 1, 2]),
    usedK: usedK != null ? usedK : 3,
  });
}

// -----------------------------------------------------------------------------
group('makeCandidateFromL2');
const state = _makeState();
const cand1 = CP.makeCandidateFromL2(state, 1, {
  getCluster: _makeGetCluster(3),
  now: 1_700_000_000,
});
check('returns candidate object',          cand1 && typeof cand1 === 'object');
check('source = l2_single',                cand1.source === 'l2_single');
check('chrom propagated',                  cand1.chrom === 'LG28');
check('l2_indices = [1]',                  cand1.l2_indices.length === 1 && cand1.l2_indices[0] === 1);
check('ref_l2 = 1',                        cand1.ref_l2 === 1);
check('ref_window = (11+25)/2 = 18',       cand1.ref_window === 18);
check('K = 3',                             cand1.K === 3);
check('locked_labels Int8Array',           cand1.locked_labels instanceof Int8Array);
check('locked_labels independent',
      cand1.locked_labels !== _makeGetCluster().labels);
check('start_w/end_w from env',
      cand1.start_w === 11 && cand1.end_w === 25);
check('start_bp/end_bp from env',
      cand1.start_bp === 1_100_000 && cand1.end_bp === 2_500_000);
check('created_at uses passed now',         cand1.created_at === 1_700_000_000);
check('notes empty',                        cand1.notes === '');
check('id minted',                          cand1.id.startsWith('cand_'));

// usedK override
const candK6 = CP.makeCandidateFromL2(state, 1, {
  getCluster: _makeGetCluster(6),
});
check('K uses cluster.usedK when set',     candK6.K === 6);

// defaultK opts override (when cluster.usedK absent)
const getClusterNoUsedK = () => ({ labels: new Int8Array([0, 1, 2]) });
const candDefaultK = CP.makeCandidateFromL2(state, 1, {
  getCluster: getClusterNoUsedK,
  defaultK: 4,
});
check('defaultK opts: 4 propagated',       candDefaultK.K === 4);

// state.k fallback
const candFromStateK = CP.makeCandidateFromL2(state, 1, {
  getCluster: getClusterNoUsedK,
});
check('state.k fallback: 3',               candFromStateK.K === 3);

// Edge cases
check('null state → null',
      CP.makeCandidateFromL2(null, 0, { getCluster: _makeGetCluster() }) === null);
check('null l2idx → null',
      CP.makeCandidateFromL2(state, null, { getCluster: _makeGetCluster() }) === null);
check('out-of-range l2idx → null',
      CP.makeCandidateFromL2(state, 99, { getCluster: _makeGetCluster() }) === null);
check('no getCluster → null',
      CP.makeCandidateFromL2(state, 1, {}) === null);
check('getCluster returns null → null',
      CP.makeCandidateFromL2(state, 1, { getCluster: () => null }) === null);
check('getCluster returns no labels → null',
      CP.makeCandidateFromL2(state, 1, { getCluster: () => ({}) }) === null);

// -----------------------------------------------------------------------------
group('makeCandidateFromL2Merge');
const merge = CP.makeCandidateFromL2Merge(state, [1, 2, 3], {
  getCluster: _makeGetCluster(3),
});
check('source = l2_merge',                 merge.source === 'l2_merge');
check('l2_indices sorted [1,2,3]',          merge.l2_indices.join(',') === '1,2,3');
check('ref_l2 = middle (2)',                merge.ref_l2 === 2);
check('start_w = min of envs',              merge.start_w === 11);
check('end_w = max of envs',                merge.end_w === 60);
check('start_bp = min of envs',             merge.start_bp === 1_100_000);
check('end_bp = max of envs',               merge.end_bp === 6_000_000);

// Unsorted input → sorted output
const mergeUnsorted = CP.makeCandidateFromL2Merge(state, [3, 1, 2], {
  getCluster: _makeGetCluster(),
});
check('unsorted input: sorted output',     mergeUnsorted.l2_indices.join(',') === '1,2,3');

// Single-element → delegates to makeCandidateFromL2 (source = l2_single)
const mergeSingle = CP.makeCandidateFromL2Merge(state, [1], {
  getCluster: _makeGetCluster(),
});
check('single-element delegates: source = l2_single',
      mergeSingle.source === 'l2_single');

// Edge cases
check('null state → null',
      CP.makeCandidateFromL2Merge(null, [1, 2], { getCluster: _makeGetCluster() }) === null);
check('empty l2idxs → null',
      CP.makeCandidateFromL2Merge(state, [], { getCluster: _makeGetCluster() }) === null);
check('null l2idxs → null',
      CP.makeCandidateFromL2Merge(state, null, { getCluster: _makeGetCluster() }) === null);
check('no getCluster → null',
      CP.makeCandidateFromL2Merge(state, [1, 2], {}) === null);
check('all envs missing → null',
      CP.makeCandidateFromL2Merge({ data: { l2_envelopes: [] } }, [1, 2], { getCluster: _makeGetCluster() }) === null);

// -----------------------------------------------------------------------------
group('makeCandidateFromLock');
const lock = CP.makeCandidateFromLock(state, {
  getCluster: _makeGetCluster(3),
});
check('source = lock_promote',              lock.source === 'lock_promote');
check('ref_l2 = state.lockedRefL2',          lock.ref_l2 === 1);
check('ref_window = state.cur (50)',         lock.ref_window === 50);
check('K from cluster (3)',                  lock.K === 3);
check('locked_labels from state.lockedLabels',
      Array.from(lock.locked_labels).join(',') === '0,1,2,0,1,2');
check('locked_labels independent',           lock.locked_labels !== state.lockedLabels);

// No getCluster: uses state.k fallback
const lockNoGet = CP.makeCandidateFromLock(state);
check('no getCluster: K = state.k (3)',      lockNoGet.K === 3);

// Edge cases
check('null state → null',                  CP.makeCandidateFromLock(null) === null);
check('no lockedLabels → null',
      CP.makeCandidateFromLock(Object.assign({}, state, { lockedLabels: null })) === null);
check('no lockedRefL2 → null',
      CP.makeCandidateFromLock(Object.assign({}, state, { lockedRefL2: null })) === null);
check('missing env → null',
      CP.makeCandidateFromLock(Object.assign({}, state, { lockedRefL2: 99 })) === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
