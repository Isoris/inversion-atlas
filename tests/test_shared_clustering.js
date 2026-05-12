// tests/test_shared_clustering.js
//
// Unit tests for shared/clustering.js — hierarchical-clustering
// primitives extracted from legacy 38863-38968.

import {
  agglomerativeAverageLinkage,
  cutDendrogram,
  clusterByConcordance,
  cosineDistance,
} from '../atlases/inversion/shared/clustering.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol;
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Helper: build a flat N×N distance matrix from a 2D array.
function dist(matrix2D) {
  const N = matrix2D.length;
  const flat = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) flat[i * N + j] = matrix2D[i][j];
  return flat;
}

// =====================================================================
group('agglomerativeAverageLinkage — trivial cases');
{
  // N=1: nothing to merge
  const d = agglomerativeAverageLinkage(dist([[0]]), 1);
  check('N=1: empty dendrogram', d.length === 0);
}
{
  // N=2: one merge at the only off-diagonal distance
  const d = agglomerativeAverageLinkage(dist([[0, 0.3], [0.3, 0]]), 2);
  check('N=2: 1 merge',          d.length === 1);
  check('N=2: merge dist = 0.3', approx(d[0].dist, 0.3, 1e-6));
  check('N=2: merge size = 2',   d[0].size === 2);
  check('N=2: merges {0,1}',     d[0].members.includes(0) && d[0].members.includes(1));
}

// =====================================================================
group('agglomerativeAverageLinkage — 3 points');
{
  // Pairwise: 0-1 close (0.1), 0-2 far (0.9), 1-2 medium (0.6)
  // First merge: 0+1 at 0.1. Then d(01, 2) = (1*0.9 + 1*0.6)/2 = 0.75
  const M = [
    [0,   0.1, 0.9],
    [0.1, 0,   0.6],
    [0.9, 0.6, 0  ],
  ];
  const d = agglomerativeAverageLinkage(dist(M), 3);
  check('3 points: 2 merges', d.length === 2);
  check('first merge dist = 0.1', approx(d[0].dist, 0.1, 1e-5));
  check('second merge dist = 0.75', approx(d[1].dist, 0.75, 1e-5));
  check('first merge members = [0,1]',
        d[0].members.length === 2 && d[0].members.includes(0) && d[0].members.includes(1));
  check('second merge includes all 3 leaves',
        d[1].members.length === 3 && d[1].size === 3);
}

// =====================================================================
group('cutDendrogram — threshold cuts');
{
  // Same 3-point dendrogram. Cuts:
  //   threshold = 0.05 → no merges accepted → 3 singletons
  //   threshold = 0.5  → 0+1 merge only     → 2 groups
  //   threshold = 0.8  → both merges accepted → 1 group
  const M = [
    [0,   0.1, 0.9],
    [0.1, 0,   0.6],
    [0.9, 0.6, 0  ],
  ];
  const dendro = agglomerativeAverageLinkage(dist(M), 3);

  const c1 = cutDendrogram(dendro, 3, 0.05);
  check('threshold 0.05: 3 groups', c1.n_groups === 3);
  check('threshold 0.05: each leaf is its own group',
        c1.group_id_per_band[0] !== c1.group_id_per_band[1]
        && c1.group_id_per_band[1] !== c1.group_id_per_band[2]);

  const c2 = cutDendrogram(dendro, 3, 0.5);
  check('threshold 0.5: 2 groups', c2.n_groups === 2);
  check('threshold 0.5: 0 and 1 same group',
        c2.group_id_per_band[0] === c2.group_id_per_band[1]);
  check('threshold 0.5: 2 in different group',
        c2.group_id_per_band[2] !== c2.group_id_per_band[0]);

  const c3 = cutDendrogram(dendro, 3, 0.8);
  check('threshold 0.8: 1 group', c3.n_groups === 1);
  check('threshold 0.8: all leaves same group',
        c3.group_id_per_band[0] === c3.group_id_per_band[1]
        && c3.group_id_per_band[1] === c3.group_id_per_band[2]);
}

// =====================================================================
group('cutDendrogram — group ids are compact (0..n_groups-1)');
{
  const M = [
    [0, 0.1, 0.9, 0.95],
    [0.1, 0, 0.85, 0.9],
    [0.9, 0.85, 0, 0.05],
    [0.95, 0.9, 0.05, 0],
  ];
  const dendro = agglomerativeAverageLinkage(dist(M), 4);
  const cut = cutDendrogram(dendro, 4, 0.5);
  check('4 points, 2 close pairs: 2 groups', cut.n_groups === 2);
  // group ids should be 0 and 1 (not arbitrary union-find roots)
  const ids = new Set();
  for (let i = 0; i < 4; i++) ids.add(cut.group_id_per_band[i]);
  check('group ids are {0, 1}', ids.size === 2 && ids.has(0) && ids.has(1));
}

// =====================================================================
group('clusterByConcordance — concordance → distance → groups');
{
  // 4 samples; first two have concordance 0.95 (≈ same lineage),
  // last two have concordance 0.95, cross-pairs are 0.05.
  const N = 4;
  const C = new Float32Array(N * N);
  for (let i = 0; i < N; i++) C[i * N + i] = 1;
  C[0 * N + 1] = C[1 * N + 0] = 0.95;
  C[2 * N + 3] = C[3 * N + 2] = 0.95;
  C[0 * N + 2] = C[2 * N + 0] = 0.05;
  C[0 * N + 3] = C[3 * N + 0] = 0.05;
  C[1 * N + 2] = C[2 * N + 1] = 0.05;
  C[1 * N + 3] = C[3 * N + 1] = 0.05;

  const result = clusterByConcordance(C, N, 0.5);
  check('returns object with threshold / dendrogram / lineage_id_per_sample / n_lineages',
        typeof result === 'object' && result.threshold === 0.5
        && Array.isArray(result.dendrogram)
        && result.lineage_id_per_sample instanceof Int32Array
        && typeof result.n_lineages === 'number');
  check('2 lineages',            result.n_lineages === 2);
  check('0 and 1 same lineage',  result.lineage_id_per_sample[0] === result.lineage_id_per_sample[1]);
  check('2 and 3 same lineage',  result.lineage_id_per_sample[2] === result.lineage_id_per_sample[3]);
  check('0 and 2 different',     result.lineage_id_per_sample[0] !== result.lineage_id_per_sample[2]);
}

// =====================================================================
group('clusterByConcordance — full concordance produces 1 group');
{
  const N = 5;
  const C = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) C[i * N + j] = 1;
  const result = clusterByConcordance(C, N, 0.5);
  check('all-1 concordance: 1 lineage', result.n_lineages === 1);
}

// =====================================================================
group('cosineDistance');
check('identical → 0',
      Math.abs(cosineDistance([1, 0, 0], [1, 0, 0])) < 1e-9);
check('orthogonal → 1',
      Math.abs(cosineDistance([1, 0, 0], [0, 1, 0]) - 1) < 1e-9);
check('opposite → 2 (clamped from -1 sim)',
      Math.abs(cosineDistance([1, 0, 0], [-1, 0, 0]) - 2) < 1e-9);
check('scale-invariant (same direction)',
      Math.abs(cosineDistance([2, 0, 0], [1, 0, 0])) < 1e-9);
check('45° angle → 1 - cos(45°) ≈ 0.293',
      Math.abs(cosineDistance([1, 0], [1, 1]) - (1 - 1 / Math.sqrt(2))) < 1e-9);
{
  // Float32Array input works
  const u = Float32Array.from([1, 1, 0]);
  const v = Float32Array.from([1, 0, 1]);
  // cos sim = 1 / (sqrt(2) * sqrt(2)) = 0.5, distance = 0.5
  check('Float32Array input',                   Math.abs(cosineDistance(u, v) - 0.5) < 1e-6);
}
// Zero vector returns maximally distant (1) per legacy convention
check('zero u → 1',                           cosineDistance([0, 0, 0], [1, 1, 1]) === 1);
check('zero v → 1',                           cosineDistance([1, 1, 1], [0, 0, 0]) === 1);
check('both zero → 1',                        cosineDistance([0, 0], [0, 0]) === 1);
// Shape errors → NaN
check('null u → NaN',                         Number.isNaN(cosineDistance(null, [1])));
check('null v → NaN',                         Number.isNaN(cosineDistance([1], null)));
check('unequal length → NaN',
      Number.isNaN(cosineDistance([1, 2], [1, 2, 3])));
// Numerical safety: small floating-point can push sim outside [-1, 1]
{
  // Construct vectors that should give sim = 1 exactly; ensure result is
  // exactly 0 (no negative-due-to-fp).
  const u = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  const v = Float64Array.from([0.1, 0.2, 0.3, 0.4]);
  const d = cosineDistance(u, v);
  check('identical fp64 → ≥ 0 (clamped)',      d >= 0 && d < 1e-9);
}
check('empty arrays → both zero norms → 1',   cosineDistance([], []) === 1);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
