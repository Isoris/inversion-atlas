// tests/test_shared_mgl_doubleton_sfs_clusters.js
//
// Coverage for shared/mgl_doubleton_sfs_clusters — 2D-SFS doubleton
// sharing → average-linkage hierarchical clustering of INV chromosomes.

import {
  buildDoubletonShareMatrix,
  sharedToDistance,
  averageLinkageCluster,
  clusterInvByDoubletonSharing,
  perClusterMeanDosage,
  MGL_DOUBLETON_DEFAULTS,
} from '../atlases/evolution/shared/mgl_doubleton_sfs_clusters.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('exports');
check('defaults frozen',                          Object.isFrozen(MGL_DOUBLETON_DEFAULTS));
check('buildDoubletonShareMatrix fn',             typeof buildDoubletonShareMatrix === 'function');
check('sharedToDistance fn',                      typeof sharedToDistance === 'function');
check('averageLinkageCluster fn',                 typeof averageLinkageCluster === 'function');
check('clusterInvByDoubletonSharing fn',          typeof clusterInvByDoubletonSharing === 'function');
check('perClusterMeanDosage fn',                  typeof perClusterMeanDosage === 'function');

// =====================================================================
group('buildDoubletonShareMatrix — fixture');
//
// 6 samples; markers chosen so:
//   M0: doubleton in {0, 1}
//   M1: doubleton in {0, 1}
//   M2: doubleton in {2, 3}
//   M3: tripleton (excluded since k_target=2 default)
//   M4: doubleton in {0, 2}
//
// Expected shared counts (n=6 in the inv_idx, but really we tally
// among the 4-sample INV class [0,1,2,3] — std at 4,5 are dropped):
//   pair (0,1): 2 (M0 + M1)
//   pair (2,3): 1 (M2)
//   pair (0,2): 1 (M4)
//   all others: 0
const dosage = [
  Float64Array.from([2, 2, 0, 0, 0, 0]),  // M0
  Float64Array.from([1, 1, 0, 0, 0, 0]),  // M1 (HET also counts as carrier)
  Float64Array.from([0, 0, 2, 2, 0, 0]),  // M2
  Float64Array.from([2, 2, 2, 0, 0, 0]),  // M3 — tripleton, excluded
  Float64Array.from([2, 0, 2, 0, 0, 0]),  // M4
];
const r = buildDoubletonShareMatrix({
  dosage, n_markers: 5, n_samples: 6,
  inv_idx: [0, 1, 2, 3],
});
check('shared(0,1) = 2',                          r.shared[0 * 4 + 1] === 2);
check('shared(2,3) = 1',                          r.shared[2 * 4 + 3] === 1);
check('shared(0,2) = 1',                          r.shared[0 * 4 + 2] === 1);
check('shared(1,2) = 0',                          r.shared[1 * 4 + 2] === 0);
check('shared diagonal = 0',                      r.shared[0 * 4 + 0] === 0);
check('shared symmetric',
      r.shared[0 * 4 + 1] === r.shared[1 * 4 + 0]
   && r.shared[2 * 4 + 3] === r.shared[3 * 4 + 2]);
check('n_doubleton_sites = 4 (M0, M1, M2, M4)',   r.n_doubleton_sites === 4);
check('per_sample_carrier[0] = 4 (carries M0,M1,M3,M4)',
      r.per_sample_carrier[0] === 4);

// k_target override → look for tripletons instead.
const r3 = buildDoubletonShareMatrix({
  dosage, n_markers: 5, n_samples: 6,
  inv_idx: [0, 1, 2, 3],
  opts: { k_target: 3 },
});
check('k_target=3 picks only M3',                 r3.n_doubleton_sites === 1);
check('k_target=3 share(0,1) = 1 (via M3)',       r3.shared[0 * 4 + 1] === 1);

// Empty / null safety.
check('null args → empty',
      buildDoubletonShareMatrix(null).shared.length === 0);
check('inv_idx < 2 → empty',
      buildDoubletonShareMatrix({ dosage, n_markers: 5, n_samples: 6,
                                   inv_idx: [0] }).shared.length === 0);

// Flat Float64Array input.
const flat = new Float64Array(5 * 6);
for (let mi = 0; mi < 5; mi++) for (let si = 0; si < 6; si++) flat[mi * 6 + si] = dosage[mi][si];
const rFlat = buildDoubletonShareMatrix({
  dosage: flat, n_markers: 5, n_samples: 6, inv_idx: [0, 1, 2, 3],
});
check('flat-array input matches array-of-arrays',
      rFlat.shared[0 * 4 + 1] === r.shared[0 * 4 + 1]
   && rFlat.shared[2 * 4 + 3] === r.shared[2 * 4 + 3]);

// =====================================================================
group('sharedToDistance');
const d = sharedToDistance(r.shared, 4);
check('d(0,1) = 1/3 (shared=2)',                  Math.abs(d[0 * 4 + 1] - (1 / 3)) < 1e-9);
check('d(2,3) = 1/2 (shared=1)',                  Math.abs(d[2 * 4 + 3] - 0.5) < 1e-9);
check('d(1,2) = 1.0 (shared=0)',                  d[1 * 4 + 2] === 1);
check('d diagonal = 0',                           d[0 * 4 + 0] === 0);
check('d symmetric',                              d[0 * 4 + 1] === d[1 * 4 + 0]);

// =====================================================================
group('averageLinkageCluster — manual sanity');
//
// Build a clear 4-leaf situation: {0, 1} close, {2, 3} close, the two
// pairs far apart.
const dist4 = Float64Array.from([
  0,   0.1, 0.9, 0.9,
  0.1, 0,   0.9, 0.9,
  0.9, 0.9, 0,   0.1,
  0.9, 0.9, 0.1, 0,
]);
const cl = averageLinkageCluster(dist4, 4, 2);
check('K=2: 2 actual clusters',                   cl.K_actual === 2);
check('K=2: leaves 0 and 1 share a cluster',      cl.labels[0] === cl.labels[1]);
check('K=2: leaves 2 and 3 share a cluster',      cl.labels[2] === cl.labels[3]);
check('K=2: clusters distinct',                   cl.labels[0] !== cl.labels[2]);
check('K=2: merges array populated',              cl.merges.length === 2);

// K=1 → all together.
const cl1 = averageLinkageCluster(dist4, 4, 1);
check('K=1: all in one cluster',                  cl1.K_actual === 1);

// K=4 → no merges (each leaf its own).
const cl4 = averageLinkageCluster(dist4, 4, 4);
check('K=4: 4 actual clusters',                   cl4.K_actual === 4);
check('K=4: 0 merges',                            cl4.merges.length === 0);

// Edge case: 0 leaves / 1 leaf.
check('n=0 → empty result',                       averageLinkageCluster(new Float64Array(0), 0, 1).labels.length === 0);
check('n=1 → 1 cluster, no merges',
      averageLinkageCluster(new Float64Array([0]), 1, 1).K_actual === 1);

// =====================================================================
group('clusterInvByDoubletonSharing — end-to-end');
//
// Use the 4-INV-sample fixture from above. With strong sharing in
// (0,1) and (2,3), K=2 should split correctly.
const e = clusterInvByDoubletonSharing({
  dosage, n_markers: 5, n_samples: 6,
  inv_idx: [0, 1, 2, 3],
  opts: { K_max: 4, min_group_size: 2 },
});
check('K_actual ≤ 4',                             e.K_actual <= 4 && e.K_actual >= 1);
check('labels length = inv_idx length',           e.labels.length === 4);
check('per_sample_carrier propagated',            e.per_sample_carrier.length === 4);
// (0,1) should land in the same group.
check('labels[0] === labels[1]',                  e.labels[0] === e.labels[1]);
check('labels[2] === labels[3]',                  e.labels[2] === e.labels[3]);
check('distinct labels for (0,1) vs (2,3)',       e.labels[0] !== e.labels[2]);

// All-equal sharing matrix → K=1 fallback (every pair equally close).
const eFlat = clusterInvByDoubletonSharing({
  dosage: [Float64Array.from([0, 0, 0, 0])],
  n_markers: 1, n_samples: 4,
  inv_idx: [0, 1, 2, 3],
  opts: { K_max: 4, min_group_size: 2 },
});
check('zero-share → K_actual ≥ 1',                eFlat.K_actual >= 1);

// =====================================================================
group('perClusterMeanDosage');
const means = perClusterMeanDosage({
  dosage, n_markers: 5, n_samples: 6,
  inv_idx: [0, 1, 2, 3],
  labels: new Int32Array([0, 0, 1, 1]),
  K_actual: 2,
});
check('2 clusters returned',                      means.length === 2);
check('cluster 0 mean on M0 = (2+2)/2 = 2',       Math.abs(means[0][0] - 2) < 1e-9);
check('cluster 1 mean on M2 = (2+2)/2 = 2',       Math.abs(means[1][2] - 2) < 1e-9);
check('cluster 0 mean on M2 = 0 (both 0)',        means[0][2] === 0);
check('null args → []',                           perClusterMeanDosage(null).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
