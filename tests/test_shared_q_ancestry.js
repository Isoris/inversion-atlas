// tests/test_shared_q_ancestry.js
//
// Unit tests for atlases/popstats/shared/q_ancestry.js — the
// Q-association ancestry coloring + legend bars module.

import {
  QA_DEFAULT_PALETTE,
  QA_ADMIX_THRESHOLD_DEFAULT,
  qaEnsureState,
  qaRegisterK,
  qaSetK,
  qaClearState,
  qaSampleQ,
  qaResolveSample,
  qaSampleColor,
  qaProportionBars,
} from '../atlases/popstats/shared/q_ancestry.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Build a 6-sample, K=2 Q-matrix:
//   sample 0: 0.95 Q1, 0.05 Q2  (dominant 0, hard)
//   sample 1: 0.80 Q1, 0.20 Q2  (dominant 0, hard)
//   sample 2: 0.50 Q1, 0.50 Q2  (admixed, max_q < 0.7 → grey in hard)
//   sample 3: 0.20 Q1, 0.80 Q2  (dominant 1, hard)
//   sample 4: 0.70 Q1, 0.30 Q2  (exactly at threshold, hard → color)
//   sample 5: 0.05 Q1, 0.95 Q2  (dominant 1, hard)
function makeK2Vectors() {
  return Float32Array.from([
    0.95, 0.05,
    0.80, 0.20,
    0.50, 0.50,
    0.20, 0.80,
    0.70, 0.30,
    0.05, 0.95,
  ]);
}

// =====================================================================
group('constants');
check('QA_DEFAULT_PALETTE length 20',
      Array.isArray(QA_DEFAULT_PALETTE) && QA_DEFAULT_PALETTE.length === 20);
check('QA_DEFAULT_PALETTE is frozen',
      Object.isFrozen(QA_DEFAULT_PALETTE));
check('QA_ADMIX_THRESHOLD_DEFAULT = 0.7',
      QA_ADMIX_THRESHOLD_DEFAULT === 0.7);

// =====================================================================
group('qaEnsureState');
check('null state → null',                  qaEnsureState(null) === null);
{
  const state = {};
  const ui = qaEnsureState(state);
  check('initializes registry',             !!ui);
  check('K starts null',                    ui.K === null);
  check('q_vectors starts null',            ui.q_vectors === null);
  check('available_K is empty array',       Array.isArray(ui.available_K) && ui.available_K.length === 0);
  check('palette cloned from default',
        Array.isArray(ui.palette) && ui.palette.length === 20
        && ui.palette[0] === QA_DEFAULT_PALETTE[0]
        && ui.palette !== QA_DEFAULT_PALETTE);
  check('admix_threshold = 0.7',            ui.admix_threshold === 0.7);
  check('qDisplayMode defaults to hard',    state.qDisplayMode === 'hard');
  check('qLegendMode defaults to per_cluster', state.qLegendMode === 'per_cluster');
  // Idempotent
  const ui2 = qaEnsureState(state);
  check('idempotent (same object)',         ui === ui2);
}
{
  // Pre-existing user prefs are preserved
  const state = { qDisplayMode: 'blend', qLegendMode: 'cohort' };
  qaEnsureState(state);
  check('preserves qDisplayMode = blend',   state.qDisplayMode === 'blend');
  check('preserves qLegendMode = cohort',   state.qLegendMode === 'cohort');
}

// =====================================================================
group('qaRegisterK — input validation');
check('K not integer → false',              qaRegisterK({}, 2.5, [0, 0]) === false);
check('K < 2 → false',                      qaRegisterK({}, 1, [0]) === false);
check('K > 20 → false',                     qaRegisterK({}, 21, []) === false);
check('null q_vectors → false',             qaRegisterK({}, 2, null) === false);

// =====================================================================
group('qaRegisterK + qaSetK — happy path');
{
  const state = {};
  const q = makeK2Vectors();
  const ok = qaRegisterK(state, 2, q);
  check('register K=2 returns true',        ok === true);
  check('K auto-selected on first register', state._qAncestry.K === 2);
  check('q_vectors populated',              state._qAncestry.q_vectors === q);
  check('group_names defaulted',
        Array.isArray(state._qAncestry.group_names)
        && state._qAncestry.group_names.length === 2
        && state._qAncestry.group_names[0] === 'Q1');
  check('available_K = [2]',                state._qAncestry.available_K.length === 1 && state._qAncestry.available_K[0] === 2);
  // Add K=4 (still registered)
  qaRegisterK(state, 4, new Float32Array(6 * 4), ['A', 'B', 'C', 'D']);
  check('K=2 stays active when K=4 added',  state._qAncestry.K === 2);
  check('available_K sorted [2, 4]',
        state._qAncestry.available_K.length === 2
        && state._qAncestry.available_K[0] === 2
        && state._qAncestry.available_K[1] === 4);
  // Switch to K=4
  check('qaSetK(4) succeeds',               qaSetK(state, 4) === true);
  check('active K = 4',                     state._qAncestry.K === 4);
  check('group_names switched to custom',   state._qAncestry.group_names[0] === 'A');
  // Re-register K=2 (idempotent overwrite)
  qaRegisterK(state, 2, Float32Array.from([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0]));
  check('re-register doesn\'t change active K', state._qAncestry.K === 4);
  // Set unknown K
  check('qaSetK on unregistered K → false', qaSetK(state, 99) === false);
}

// =====================================================================
group('qaSampleQ');
{
  const state = {};
  qaRegisterK(state, 2, makeK2Vectors());
  const q0 = qaSampleQ(state, 0);
  check('q[0] is Float32Array(2)',          q0 instanceof Float32Array && q0.length === 2);
  check('q[0] = [0.95, 0.05]',
        Math.abs(q0[0] - 0.95) < 1e-5 && Math.abs(q0[1] - 0.05) < 1e-5);
  const q5 = qaSampleQ(state, 5);
  check('q[5] = [0.05, 0.95]',
        Math.abs(q5[0] - 0.05) < 1e-5 && Math.abs(q5[1] - 0.95) < 1e-5);
  check('out-of-range si → null',           qaSampleQ(state, 99) === null);
  check('negative si → null',               qaSampleQ(state, -1) === null);
  check('non-integer si → null',            qaSampleQ(state, 1.5) === null);
}
{
  // No K selected → null
  const state = {};
  qaEnsureState(state);
  check('no K registered → null',           qaSampleQ(state, 0) === null);
}

// =====================================================================
group('qaResolveSample');
{
  const state = {};
  qaRegisterK(state, 2, makeK2Vectors());
  const r0 = qaResolveSample(state, 0);
  check('returns object',                   !!r0);
  check('sample 0 dominant = 0',            r0.dominant === 0);
  check('sample 0 max_q ≈ 0.95',            Math.abs(r0.max_q - 0.95) < 1e-5);
  const r3 = qaResolveSample(state, 3);
  check('sample 3 dominant = 1',            r3.dominant === 1);
  check('sample 3 max_q ≈ 0.80',            Math.abs(r3.max_q - 0.80) < 1e-5);
  check('no Q data → null',                 qaResolveSample({}, 0) === null);
}

// =====================================================================
group('qaSampleColor — hard mode (default)');
{
  const state = {};
  qaRegisterK(state, 2, makeK2Vectors());
  // Palette[0] = orange, palette[1] = purple
  const expected0 = QA_DEFAULT_PALETTE[0];
  const expected1 = QA_DEFAULT_PALETTE[1];
  check('sample 0 (0.95 Q1) → palette[0]',  qaSampleColor(state, 0) === expected0);
  check('sample 1 (0.80 Q1) → palette[0]',  qaSampleColor(state, 1) === expected0);
  check('sample 2 (0.50/0.50) → grey (admixed)', qaSampleColor(state, 2) === '#888');
  check('sample 3 (0.80 Q2) → palette[1]',  qaSampleColor(state, 3) === expected1);
  check('sample 4 (0.70 at threshold) → palette[0] (float-tolerant)',
        qaSampleColor(state, 4) === expected0);
  check('sample 5 (0.95 Q2) → palette[1]',  qaSampleColor(state, 5) === expected1);
  check('no data → grey',                   qaSampleColor({}, 0) === '#888');
  check('out-of-range si → grey',           qaSampleColor(state, 99) === '#888');
}

// =====================================================================
group('qaSampleColor — blend mode');
{
  const state = { qDisplayMode: 'blend' };
  qaRegisterK(state, 2, makeK2Vectors());
  // Sample 2 is 50/50 — should be midway between palette[0] and palette[1]
  const c2 = qaSampleColor(state, 2);
  check('blend mode emits hex',             typeof c2 === 'string' && c2.startsWith('#') && c2.length === 7);
  // Sample 0 is 0.95/0.05 — should be very close to palette[0]
  const c0 = qaSampleColor(state, 0);
  check('sample 0 blend close to palette[0]',
        c0 !== '#888' && c0.length === 7);
  // Sample 4 (0.70 Q1) blended with palette[0]=orange + palette[1]=purple
  //   palette[0] = #f5a524 = (245,165,36)
  //   palette[1] = #9b59b6 = (155,89,182)
  //   blend = 0.70*orange + 0.30*purple
  //         = (0.7*245+0.3*155, 0.7*165+0.3*89, 0.7*36+0.3*182)
  //         = (218, 142.2, 79.8) → (218, 142, 80)
  const c4 = qaSampleColor(state, 4);
  // Float32 jitter on the 0.7 / 0.3 → check r is in [215, 220]
  const r4 = parseInt(c4.slice(1, 3), 16);
  check('sample 4 blend red channel ≈ 218 (±3)', r4 >= 215 && r4 <= 221, 'got ' + r4);
}

// =====================================================================
group('qaProportionBars — cohort layout');
{
  const state = {};
  qaRegisterK(state, 2, makeK2Vectors());
  const b = qaProportionBars(state, 'cohort');
  check('returns object',                   !!b);
  check('n = 6',                            b.n === 6);
  check('props length = 2',                 b.props.length === 2);
  // mean Q1 = (0.95+0.80+0.50+0.20+0.70+0.05)/6 ≈ 0.5333
  check('cohort mean Q1 ≈ 0.5333',          Math.abs(b.props[0] - (0.95 + 0.80 + 0.50 + 0.20 + 0.70 + 0.05) / 6) < 1e-4);
  // Sum to 1.0
  check('cohort props sum to 1.0',          Math.abs(b.props[0] + b.props[1] - 1.0) < 1e-4);
  check('no Q data → null',                 qaProportionBars({}, 'cohort') === null);
}

// =====================================================================
group('qaProportionBars — per_cluster layout');
{
  const state = {};
  qaRegisterK(state, 2, makeK2Vectors());
  // Cluster 0 = samples [0, 1, 2] (mixed Q), cluster 1 = samples [3, 4, 5]
  const labels = [0, 0, 0, 1, 1, 1];
  const b = qaProportionBars(state, 'per_cluster', labels);
  check('returns object',                   !!b);
  check('clusters length = 2',              b.clusters.length === 2);
  check('cluster 0 count = 3',              b.clusters[0].count === 3);
  check('cluster 1 count = 3',              b.clusters[1].count === 3);
  // Cluster 0 mean Q1 = (0.95+0.80+0.50)/3 = 0.75
  check('cluster 0 Q1 mean ≈ 0.75',         Math.abs(b.clusters[0].props[0] - 0.75) < 1e-4);
  // Cluster 1 mean Q1 = (0.20+0.70+0.05)/3 ≈ 0.3167
  check('cluster 1 Q1 mean ≈ 0.3167',       Math.abs(b.clusters[1].props[0] - (0.20 + 0.70 + 0.05) / 3) < 1e-4);
  // Missing labels → null
  check('per_cluster without labels → null', qaProportionBars(state, 'per_cluster', null) === null);
  // Skip -1 / null labels
  const labelsWithGaps = [0, 0, -1, 1, 1, null];
  const b2 = qaProportionBars(state, 'per_cluster', labelsWithGaps);
  check('skips negative labels in cluster set', b2.clusters.length === 2);
  check('cluster 0 count = 2 (skipped -1)',  b2.clusters[0].count === 2);
  check('cluster 1 count = 2 (skipped null)', b2.clusters[1].count === 2);
}

// =====================================================================
group('qaClearState');
{
  const state = { qDisplayMode: 'blend', qLegendMode: 'cohort' };
  qaRegisterK(state, 2, makeK2Vectors());
  qaClearState(state);
  check('_qAncestry removed',               state._qAncestry === undefined);
  check('qDisplayMode preserved',           state.qDisplayMode === 'blend');
  check('qLegendMode preserved',            state.qLegendMode === 'cohort');
  // null state → no throw
  let threw = false;
  try { qaClearState(null); } catch (_) { threw = true; }
  check('null state: no throw',             !threw);
}

// =====================================================================
group('getSampleColor wiring (local_pca_dosage/_state.js)');
{
  const mod = await import('../atlases/inversion/pages/discovery/local_pca_dosage/_state.js');
  check('getSampleColor exported',          typeof mod.getSampleColor === 'function');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
