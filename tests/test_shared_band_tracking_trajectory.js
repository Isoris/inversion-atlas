// tests/test_shared_band_tracking_trajectory.js
//
// Unit coverage for shared/band_tracking/trajectory.js — Layer 1e.

import {
  TRAJECTORY_DEFAULTS,
  pickPc1OrientationReferenceSamples,
  computePc1SignAnchors,
  band_compute_pc1_trajectory,
  band_pairwise_trajectory_correlation,
  band_group_by_trajectory_similarity,
} from '../atlases/inversion/shared/band_tracking/trajectory.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('frozen',                       Object.isFrozen(TRAJECTORY_DEFAULTS));
check('group_min_abs_corr = 0.70',    TRAJECTORY_DEFAULTS.group_min_abs_corr === 0.70);
check('ref_n_samples = 10',           TRAJECTORY_DEFAULTS.ref_n_samples === 10);

// =====================================================================
group('pickPc1OrientationReferenceSamples');

// 6 samples, 2 bands. Band 0: pc1 = {-3, -2}; band 1: pc1 = {0.1, 0.2, 0.3, 0.4}
// |mean band 0| = 2.5, |mean band 1| = 0.25 → band 0 wins
const labels = Int8Array.of(0, 0, 1, 1, 1, 1);
const pc1    = Float32Array.of(-3, -2, 0.1, 0.2, 0.3, 0.4);
const refs = pickPc1OrientationReferenceSamples(labels, pc1, 2);
check('reference set non-empty',      refs.size > 0);
check('refs are in band 0',
      refs.has(0) && refs.has(1));
check('refs ≤ ref_n_samples (default 10)',
      refs.size <= 10);
// nRef = 1 → only the most extreme sample (idx 0, |pc1|=3)
const refsTop = pickPc1OrientationReferenceSamples(labels, pc1, 2,
  { ref_n_samples: 1 });
check('ref_n_samples=1 keeps most extreme',
      refsTop.size === 1 && refsTop.has(0));
// K < 2 → empty
check('K=1 → empty set',
      pickPc1OrientationReferenceSamples(Int8Array.of(0), Float32Array.of(1), 1).size === 0);
// null inputs → empty
check('null labels → empty',
      pickPc1OrientationReferenceSamples(null, pc1, 2).size === 0);

// =====================================================================
group('computePc1SignAnchors');

// 3 windows. Reference samples = {0, 1}.
// Window 0: pc1 = [-2, -1, 0, 0]  → ref mean = -1.5 → sign -1
// Window 1: pc1 = [+2, +1, 0, 0]  → ref mean = +1.5 → sign +1
// Window 2: pc1 = [+0, +0, 0, 0]  → ref mean =  0   → sign +1 (≥ 0)
const wPc1 = [
  Float32Array.of(-2, -1, 0, 0),
  Float32Array.of(2, 1, 0, 0),
  Float32Array.of(0, 0, 0, 0),
];
const signs = computePc1SignAnchors(new Set([0, 1]), {
  getPc1: (w) => wPc1[w],
  s_window: 0, e_window: 2,
});
check('3-window signs length 3',      signs.length === 3);
check('window 0 sign = -1',           signs[0] === -1);
check('window 1 sign = +1',           signs[1] === 1);
check('window 2 sign = +1 (zero mean)', signs[2] === 1);

// No callbacks → all +1
const fallback = computePc1SignAnchors(new Set([0]), {});
check('no callback → length 0',       fallback.length === 0);

// Reference samples missing at a window → sign +1 fallback
const missing = computePc1SignAnchors(new Set([99]), {
  getPc1: (w) => wPc1[w],
  s_window: 0, e_window: 0,
});
check('missing refs → sign +1',       missing[0] === 1);

// =====================================================================
group('band_compute_pc1_trajectory');

// Build a fake track: 3 windows, band members vary.
const track = {
  ok: true,
  windows: [
    { w: 0, k: 1, members: new Set([0, 1]) },
    { w: 1, k: 1, members: new Set([0, 1]) },
    { w: 2, k: 1, members: new Set([0, 1]) },
  ],
};
const pc1ByW = [
  Float32Array.of(1, 1, 5, 5),
  Float32Array.of(2, 2, 5, 5),
  Float32Array.of(3, 3, 5, 5),
];
const traj = band_compute_pc1_trajectory(track, {
  getPc1: (w) => pc1ByW[w],
});
check('traj length = 3',              traj.length === 3);
check('traj[0] = 1',                  approx(traj[0], 1));
check('traj[1] = 2',                  approx(traj[1], 2));
check('traj[2] = 3',                  approx(traj[2], 3));

// With sign-flip on window 1
const flipped = band_compute_pc1_trajectory(track, {
  getPc1: (w) => pc1ByW[w],
  signByWindow: new Map([[0, 1], [1, -1], [2, 1]]),
});
check('flipped traj[1] = -2',         approx(flipped[1], -2));

// Function sign source
const traj2 = band_compute_pc1_trajectory(track, {
  getPc1: (w) => pc1ByW[w],
  signByWindow: (w) => w === 0 ? -1 : 1,
});
check('function sign: traj[0] = -1',  approx(traj2[0], -1));

// Empty / null track → all NaN
const trajNull = band_compute_pc1_trajectory(null, { getPc1: () => null });
check('null track → empty',           trajNull.length === 0);

// No members at a window → NaN
const trackMiss = {
  ok: true,
  windows: [{ w: 0, k: 0, members: new Set() }],
};
const trajMiss = band_compute_pc1_trajectory(trackMiss, {
  getPc1: () => Float32Array.of(1, 2, 3),
});
check('empty members → NaN',          Number.isNaN(trajMiss[0]));

// =====================================================================
group('band_pairwise_trajectory_correlation');

// Perfectly correlated
const a = Float64Array.of(1, 2, 3, 4, 5);
const b = Float64Array.of(2, 4, 6, 8, 10);
const r1 = band_pairwise_trajectory_correlation(a, b);
check('perfect: r = 1',               approx(r1.r, 1));
check('n_used = 5',                   r1.n_used === 5);

// Perfectly anti-correlated
const c = Float64Array.of(5, 4, 3, 2, 1);
const r2 = band_pairwise_trajectory_correlation(a, c);
check('anti-correlated: r = -1',      approx(r2.r, -1));

// NaN pairwise-deleted
const d = Float64Array.of(1, NaN, 3, NaN, 5);
const r3 = band_pairwise_trajectory_correlation(a, d);
check('NaN deletion: n_used = 3',     r3.n_used === 3);

// Length mismatch
check('length mismatch → NaN',
      Number.isNaN(band_pairwise_trajectory_correlation(a, [1]).r));

// Single point → NaN (need ≥ 2)
check('n < 2 → NaN',
      Number.isNaN(band_pairwise_trajectory_correlation(
        Float64Array.of(1), Float64Array.of(2)).r));

// Constant (no variance) → NaN
check('constant → NaN',
      Number.isNaN(band_pairwise_trajectory_correlation(
        Float64Array.of(1, 1, 1, 1), Float64Array.of(2, 3, 4, 5)).r));

// Null inputs
check('null → NaN',
      Number.isNaN(band_pairwise_trajectory_correlation(null, a).r));

// =====================================================================
group('band_group_by_trajectory_similarity');

// 4 bands: bands 0,1 perfectly positively correlated; bands 2,3
// perfectly anti-correlated to bands 0/1.
// trajA = [1,2,3,4,5]; trajB = [2,4,6,8,10]; trajC = [-1,-2,-3,-4,-5];
// trajD = [-2,-4,-6,-8,-10]. Bands 0..3 should all collapse into one
// group (|r|=1 for all pairs), with sign flips.
const traj4 = [
  Float64Array.of(1, 2, 3, 4, 5),
  Float64Array.of(2, 4, 6, 8, 10),
  Float64Array.of(-1, -2, -3, -4, -5),
  Float64Array.of(-2, -4, -6, -8, -10),
];
const grouped = band_group_by_trajectory_similarity(traj4,
  { group_min_abs_corr: 0.9 });
check('all 4 bands in one group',     grouped.n_groups === 1);
check('group_of length = 4',          grouped.group_of.length === 4);
check('group_of[0] === group_of[2]',  grouped.group_of[0] === grouped.group_of[2]);
// Signs: bands 0, 1 same sign; bands 2, 3 opposite.
check('bands 0 / 1 same sign',
      grouped.group_sign[0] === grouped.group_sign[1]);
check('bands 0 / 2 opposite signs',
      grouped.group_sign[0] !== grouped.group_sign[2]);

// Correlation matrix is symmetric and diag=1
check('matrix diag = 1',
      grouped.correlation_matrix[0] === 1 && grouped.correlation_matrix[5] === 1);
check('matrix symmetric',
      grouped.correlation_matrix[1] === grouped.correlation_matrix[4]);

// Uncorrelated bands → 4 distinct groups
const traj4Indep = [
  Float64Array.of(1, 2, 3, 4),
  Float64Array.of(1, 1, 2, 2),
  Float64Array.of(4, 1, 3, 2),
  Float64Array.of(3, 2, 4, 1),
];
const groupedIndep = band_group_by_trajectory_similarity(traj4Indep,
  { group_min_abs_corr: 0.99 });
check('uncorrelated → many groups',   groupedIndep.n_groups > 1);

// Empty input
const empty = band_group_by_trajectory_similarity([], { group_min_abs_corr: 0.5 });
check('empty → n_groups 0',           empty.n_groups === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
