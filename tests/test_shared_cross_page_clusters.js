// tests/test_shared_cross_page_clusters.js
//
// Unit tests for atlases/inversion/shared/cross_page_clusters.js — the
// cross-page cluster registry that drives the cluster_dosage /
// cluster_theta_pi / cluster_ghsl sample-color modes.

import {
  XP_CLUSTER_SOURCES,
  XP_K_PALETTE,
  xpEnsureClusterRegistry,
  xpRegisterClusters,
  xpLookupClusters,
  xpActiveCandidateId,
  xpClusterColor,
  xpSampleColor,
  xpComputeConcordance,
} from '../atlases/inversion/shared/cross_page_clusters.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('XP_CLUSTER_SOURCES = [dosage, theta_pi, ghsl]',
      Array.isArray(XP_CLUSTER_SOURCES)
      && XP_CLUSTER_SOURCES.length === 3
      && XP_CLUSTER_SOURCES.includes('dosage')
      && XP_CLUSTER_SOURCES.includes('theta_pi')
      && XP_CLUSTER_SOURCES.includes('ghsl'));
check('XP_CLUSTER_SOURCES is frozen',
      Object.isFrozen(XP_CLUSTER_SOURCES));
check('XP_K_PALETTE length = 5',
      Array.isArray(XP_K_PALETTE) && XP_K_PALETTE.length === 5);
check('XP_K_PALETTE[0] = #4fa3ff (blue, label 0)',
      XP_K_PALETTE[0] === '#4fa3ff');
check('XP_K_PALETTE is frozen',
      Object.isFrozen(XP_K_PALETTE));

// =====================================================================
group('xpEnsureClusterRegistry');
check('null state → null',
      xpEnsureClusterRegistry(null) === null);
{
  const state = {};
  const reg = xpEnsureClusterRegistry(state);
  check('creates registry on first call',  !!reg && !!reg.dosage && !!reg.theta_pi && !!reg.ghsl);
  check('attaches to state',               state._crossPageClusters === reg);
  const reg2 = xpEnsureClusterRegistry(state);
  check('idempotent (same object)',         reg === reg2);
}

// =====================================================================
group('xpRegisterClusters — happy path');
{
  const state = {};
  const labels = [0, 1, 2, 0, 1, 2];
  const ok = xpRegisterClusters(state, 'dosage', 'cand_1', labels, 3);
  check('register returns true',           ok === true);
  const entry = xpLookupClusters(state, 'dosage', 'cand_1');
  check('entry retrievable',               !!entry);
  check('labels is Int8Array',             entry.labels instanceof Int8Array);
  check('labels values preserved',         entry.labels[0] === 0 && entry.labels[5] === 2);
  check('k stored',                        entry.k === 3);
  check('source stored',                   entry.source === 'dosage');
  check('candidate_id stored',             entry.candidate_id === 'cand_1');
}
{
  // Already-Int8 input is kept by reference (no copy)
  const state = {};
  const labels = Int8Array.from([0, 1, 2]);
  xpRegisterClusters(state, 'theta_pi', 'cand_2', labels, 3);
  const entry = xpLookupClusters(state, 'theta_pi', 'cand_2');
  check('Int8Array input not re-copied',   entry.labels === labels);
}
{
  // Default k
  const state = {};
  xpRegisterClusters(state, 'ghsl', 'cand_3', [0, 1]);
  check('default k = 3',                   xpLookupClusters(state, 'ghsl', 'cand_3').k === 3);
}
{
  // Idempotent overwrite
  const state = {};
  xpRegisterClusters(state, 'dosage', 'cand_1', [0, 0, 0], 1);
  xpRegisterClusters(state, 'dosage', 'cand_1', [1, 1, 1], 2);
  const e = xpLookupClusters(state, 'dosage', 'cand_1');
  check('second register overwrites',      e.k === 2 && e.labels[0] === 1);
}

// =====================================================================
group('xpRegisterClusters — input validation');
check('null state → false',           xpRegisterClusters(null, 'dosage', 'c', [0]) === false);
check('null source → false',          xpRegisterClusters({}, null, 'c', [0]) === false);
check('null candId → false',          xpRegisterClusters({}, 'dosage', null, [0]) === false);
check('null labels → false',          xpRegisterClusters({}, 'dosage', 'c', null) === false);
check('unknown source → false',       xpRegisterClusters({}, 'qopt', 'c', [0]) === false);

// =====================================================================
group('xpLookupClusters');
check('null state → null',            xpLookupClusters(null, 'dosage', 'c') === null);
check('null source → null',           xpLookupClusters({}, null, 'c') === null);
check('null candId → null',           xpLookupClusters({}, 'dosage', null) === null);
check('unknown source → null',
      xpLookupClusters({_crossPageClusters: {dosage: {c: {labels: Int8Array.of(0), k: 1}}}},
                       'qopt', 'c') === null);
check('unknown candidate → null',
      xpLookupClusters({_crossPageClusters: {dosage: {}}}, 'dosage', 'never_seen') === null);

// =====================================================================
group('xpActiveCandidateId — resolver chain');
check('null state → null',                 xpActiveCandidateId(null) === null);
check('empty state → null',                xpActiveCandidateId({}) === null);
check('focalCandidate wins',
      xpActiveCandidateId({
        focalCandidate: {id: 'focal'},
        lockedCandidate: {id: 'locked'},
        currentCandidate: {id: 'current'},
        focalEnvIdx: 7,
      }) === 'focal');
check('lockedCandidate when no focal',
      xpActiveCandidateId({
        lockedCandidate: {id: 'locked'},
        currentCandidate: {id: 'current'},
      }) === 'locked');
check('currentCandidate when no locked',
      xpActiveCandidateId({currentCandidate: {id: 'current'}}) === 'current');
check('focalEnvIdx fallback → env_<idx>',
      xpActiveCandidateId({focalEnvIdx: 7}) === 'env_7');
check('focalEnvIdx = 0 still resolves',
      xpActiveCandidateId({focalEnvIdx: 0}) === 'env_0');
check('focalCandidate without id falls through',
      xpActiveCandidateId({focalCandidate: {}, lockedCandidate: {id: 'locked'}}) === 'locked');

// =====================================================================
group('xpClusterColor');
check('label = null → grey',         xpClusterColor(null) === '#888');
check('label = undefined → grey',    xpClusterColor(undefined) === '#888');
check('label < 0 → grey',            xpClusterColor(-1) === '#888');
check('label 0 → blue',              xpClusterColor(0) === '#4fa3ff');
check('label 1 → grey-mid',          xpClusterColor(1) === '#b8b8b8');
check('label 4 → red',               xpClusterColor(4) === '#e0555c');
check('label >= 5 → grey (oob)',     xpClusterColor(5) === '#888');

// =====================================================================
group('xpSampleColor — composition');
{
  const state = {focalCandidate: {id: 'cand_42'}};
  xpRegisterClusters(state, 'dosage', 'cand_42', [0, 1, 2, 0, -1], 3);
  check('label 0 → blue',              xpSampleColor(state, 0, 'dosage') === '#4fa3ff');
  check('label 1 → grey-mid',          xpSampleColor(state, 1, 'dosage') === '#b8b8b8');
  check('label 2 → amber',             xpSampleColor(state, 2, 'dosage') === '#f5a524');
  check('label -1 (unassigned) → grey', xpSampleColor(state, 4, 'dosage') === '#888');
  check('source with no data for cand → grey',
        xpSampleColor(state, 0, 'theta_pi') === '#888');
}
{
  // No active candidate → grey
  const state = {};
  xpRegisterClusters(state, 'dosage', 'cand_orphan', [0], 1);
  check('no active candidate → grey',  xpSampleColor(state, 0, 'dosage') === '#888');
}

// =====================================================================
group('xpComputeConcordance — perfect agreement');
{
  const state = {focalCandidate: {id: 'cand_x'}};
  // Both sources agree perfectly: same labels.
  xpRegisterClusters(state, 'dosage',   'cand_x', [0, 0, 0, 1, 1, 1, 2, 2, 2], 3);
  xpRegisterClusters(state, 'theta_pi', 'cand_x', [0, 0, 0, 1, 1, 1, 2, 2, 2], 3);
  const c = xpComputeConcordance(state, 'dosage', 'theta_pi');
  check('returns object',                !!c);
  check('n = 9',                         c.n === 9);
  check('kA = kB = 3',                   c.kA === 3 && c.kB === 3);
  check('agreement = 1.0',               c.agreement === 1.0);
  check('ari = 1.0',                     Math.abs(c.ari - 1.0) < 1e-9);
  check('cramers_v ≈ 1.0',               Math.abs(c.cramers_v - 1.0) < 1e-9);
  check('diagonal contingency',
        c.contingency[0][0] === 3 && c.contingency[1][1] === 3 && c.contingency[2][2] === 3
        && c.contingency[0][1] === 0);
}

// =====================================================================
group('xpComputeConcordance — independent labels');
{
  const state = {focalCandidate: {id: 'cand_indep'}};
  // Perfect anti-correlation: still has high agreement under greedy
  // row-max matching (after permutation), but ARI is sensitive to the
  // joint distribution. For a clean permutation we expect ari = 1.0.
  xpRegisterClusters(state, 'dosage',   'cand_indep', [0, 0, 1, 1, 2, 2], 3);
  xpRegisterClusters(state, 'theta_pi', 'cand_indep', [2, 2, 0, 0, 1, 1], 3);
  const c = xpComputeConcordance(state, 'dosage', 'theta_pi');
  check('permutation: agreement = 1.0',  c.agreement === 1.0);
  check('permutation: ari = 1.0',        Math.abs(c.ari - 1.0) < 1e-9);
}

// =====================================================================
group('xpComputeConcordance — partial disagreement');
{
  const state = {focalCandidate: {id: 'cand_partial'}};
  // 5/6 agree, 1 swap
  xpRegisterClusters(state, 'dosage',   'cand_partial', [0, 0, 0, 1, 1, 1], 2);
  xpRegisterClusters(state, 'theta_pi', 'cand_partial', [0, 0, 1, 1, 1, 1], 2);
  const c = xpComputeConcordance(state, 'dosage', 'theta_pi');
  check('partial: agreement = 5/6',      Math.abs(c.agreement - 5 / 6) < 1e-9);
  check('partial: ari > 0',              c.ari > 0);
  check('partial: ari < 1',              c.ari < 1);
}

// =====================================================================
group('xpComputeConcordance — input validation');
check('no active candidate → null',
      xpComputeConcordance({}, 'dosage', 'theta_pi') === null);
{
  const state = {focalCandidate: {id: 'cand_missing'}};
  // Only one source has data
  xpRegisterClusters(state, 'dosage', 'cand_missing', [0, 1], 2);
  check('one source missing → null',
        xpComputeConcordance(state, 'dosage', 'theta_pi') === null);
}

// =====================================================================
group('getSampleColor wiring (page1/_state.js)');
{
  const mod = await import('../atlases/inversion/pages/discovery/page1/_state.js');
  check('getSampleColor exported',           typeof mod.getSampleColor === 'function');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
