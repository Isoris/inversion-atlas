// tests/test_shared_similarity_blocks.js
//
// Unit coverage for shared/similarity_blocks.js — Stage-4 block
// detection on a per-window similarity matrix.

import {
  DEFAULT_SILHOUETTE_THRESHOLD,
  DEFAULT_MIN_BLOCK_SIZE,
  DEFAULT_MAX_K,
  similarityToDistance,
  cutDendrogramByK,
  silhouetteScore,
  detectSimilarityBlocks,
} from '../atlases/inversion/shared/similarity_blocks.js';
import {
  agglomerativeAverageLinkage,
} from '../atlases/inversion/shared/clustering.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('SIL_THRESHOLD = 0.4',  DEFAULT_SILHOUETTE_THRESHOLD === 0.4);
check('MIN_BLOCK = 10',        DEFAULT_MIN_BLOCK_SIZE === 10);
check('MAX_K = 6',             DEFAULT_MAX_K === 6);

// =====================================================================
group('similarityToDistance');

// 3×3 simMatrix
const sim3 = new Float32Array([
  1, 0.8, -0.5,
  0.8, 1, 0.2,
  -0.5, 0.2, 1,
]);
const d3 = similarityToDistance(sim3, 3);
check('diagonal = 0',                d3[0] === 0 && d3[4] === 0 && d3[8] === 0);
check('off-diag = 1-sim',
      Math.abs(d3[1] - 0.2) < 1e-6 && Math.abs(d3[2] - 1.5) < 1e-6);
check('symmetric',                   d3[1] === d3[3]);
check('clamped to [0, 2]',
      d3.every(v => v >= 0 && v <= 2));
// Missing sim values → distance 2 (maximally distant)
const simNaN = new Float32Array([1, NaN, 0, NaN, 1, 0, 0, 0, 1]);
const dNaN = similarityToDistance(simNaN, 3);
check('NaN sim → distance 2',        dNaN[1] === 2 && dNaN[3] === 2);

// =====================================================================
group('cutDendrogramByK — edge cases');

// Identity assignment when K ≥ N
const fakeDend = [];
const idK = cutDendrogramByK(fakeDend, 4, 4);
check('K=N: identity',
      Array.from(idK).join(',') === '0,1,2,3');
const idKBig = cutDendrogramByK(fakeDend, 4, 10);
check('K>N: identity',               Array.from(idKBig).join(',') === '0,1,2,3');

// K=1 → all zero
const oneK = cutDendrogramByK([], 4, 1);
check('K=1: all zero',               Array.from(oneK).every(v => v === 0));
const zeroK = cutDendrogramByK([], 4, 0);
check('K=0: all zero (degenerate)',  Array.from(zeroK).every(v => v === 0));

// N=0 → empty
check('N=0: empty',                  cutDendrogramByK([], 0, 3).length === 0);

// =====================================================================
group('cutDendrogramByK — happy path');

// 4 leaves with clear two-cluster structure: 0,1 close; 2,3 close;
// pairs far apart.
const dist4 = new Float32Array([
  0, 0.1, 0.9, 0.95,
  0.1, 0, 0.85, 0.9,
  0.9, 0.85, 0, 0.1,
  0.95, 0.9, 0.1, 0,
]);
const dend4 = agglomerativeAverageLinkage(dist4, 4);
const cut2 = cutDendrogramByK(dend4, 4, 2);
// Cluster 0 should be {0, 1}; cluster 1 should be {2, 3}
check('K=2: 2 distinct cluster ids',
      new Set(Array.from(cut2)).size === 2);
check('K=2: 0 and 1 share cluster',  cut2[0] === cut2[1]);
check('K=2: 2 and 3 share cluster',  cut2[2] === cut2[3]);
check('K=2: cluster ids differ',     cut2[0] !== cut2[2]);

const cut3 = cutDendrogramByK(dend4, 4, 3);
check('K=3: 3 distinct cluster ids',
      new Set(Array.from(cut3)).size === 3);

// =====================================================================
group('silhouetteScore');

// Perfect 2-cluster partition: 4 samples; {0,1} tightly together,
// {2,3} tightly together, far apart. Expect high silhouette.
const distPerfect = new Float32Array([
  0, 0.1, 0.9, 0.9,
  0.1, 0, 0.9, 0.9,
  0.9, 0.9, 0, 0.1,
  0.9, 0.9, 0.1, 0,
]);
const sPerfect = silhouetteScore([0, 0, 1, 1], distPerfect, 4);
check('perfect 2-cluster: silhouette > 0.8',  sPerfect > 0.8);

// Mixed partition: alternating cluster labels — should drop silhouette
const sBad = silhouetteScore([0, 1, 0, 1], distPerfect, 4);
check('mismatched partition: silhouette low or negative',
      sBad < 0.2);

// Single cluster (all same label) → 0
const sOne = silhouetteScore([0, 0, 0, 0], distPerfect, 4);
check('all one cluster: silhouette = 0',  sOne === 0);

// Singleton cluster contributes s=0
const sSingle = silhouetteScore([0, 0, 0, 1], distPerfect, 4);
check('with singleton: silhouette finite',
      Number.isFinite(sSingle));

// Null inputs
check('null assignment → 0',
      silhouetteScore(null, distPerfect, 4) === 0);
check('null distMatrix → 0',
      silhouetteScore([0, 0, 1, 1], null, 4) === 0);
check('N=0 → 0',
      silhouetteScore([], [], 0) === 0);

// =====================================================================
group('detectSimilarityBlocks — clear 2-block structure');

// 20 samples; first 10 mutually similar, last 10 mutually similar,
// little similarity across.
const N = 20;
const simBlock = new Float32Array(N * N);
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    if (i === j) simBlock[i * N + j] = 1;
    else {
      const sameBlock = (i < 10) === (j < 10);
      simBlock[i * N + j] = sameBlock ? 0.9 : 0.05;
    }
  }
}
const r = detectSimilarityBlocks(simBlock, N);
check('detected K=2',                r.K === 2);
check('silhouette > 0.5',            r.silhouette > 0.5);
check('assignment length = 20',      r.assignment.length === 20);
check('block 0..9 share cluster',
      r.assignment[0] === r.assignment[9]);
check('block 10..19 share cluster',
      r.assignment[10] === r.assignment[19]);
check('blocks have correct sizes',
      r.blocks.length === 2 && r.blocks.every(s => s === 10));
check('leafOrder is permutation of 0..N-1',
      r.leafOrder.length === N
      && new Set(r.leafOrder).size === N);

// =====================================================================
group('detectSimilarityBlocks — no block structure → K=1');

// 12 samples all equally similar at ~0.5
const Nflat = 12;
const simFlat = new Float32Array(Nflat * Nflat);
for (let i = 0; i < Nflat; i++) {
  for (let j = 0; j < Nflat; j++) {
    simFlat[i * Nflat + j] = i === j ? 1 : 0.5 + 0.01 * Math.sin(i + j);
  }
}
const rFlat = detectSimilarityBlocks(simFlat, Nflat);
check('flat similarity → K=1',        rFlat.K === 1);
check('flat: silhouette = 0',         rFlat.silhouette === 0);

// =====================================================================
group('detectSimilarityBlocks — minBlockSize gate');

// 3-block structure but tiny "block" of size 2 → with default
// minBlockSize=10, should fall to K=2 or K=1.
const Nb = 22;
const simTiny = new Float32Array(Nb * Nb);
for (let i = 0; i < Nb; i++) {
  for (let j = 0; j < Nb; j++) {
    if (i === j) simTiny[i * Nb + j] = 1;
    else {
      // 0..9 = block A; 10..19 = block B; 20..21 = tiny block C
      const ba = i < 10 ? 0 : i < 20 ? 1 : 2;
      const bb = j < 10 ? 0 : j < 20 ? 1 : 2;
      simTiny[i * Nb + j] = ba === bb ? 0.9 : 0.05;
    }
  }
}
const rTiny = detectSimilarityBlocks(simTiny, Nb, { minBlockSize: 10 });
check('tiny block excluded: K ≤ 2', rTiny.K <= 2);

// Override minBlockSize=2 → K=3 should now appear
const rPermissive = detectSimilarityBlocks(simTiny, Nb, { minBlockSize: 2 });
check('minBlockSize=2: K=3 detected', rPermissive.K === 3);

// =====================================================================
group('detectSimilarityBlocks — silhouetteThreshold gate');

// Block structure that gives silhouette ~ 0.3 (below default 0.4)
// Mid-similarity values.
const Nm = 20;
const simMid = new Float32Array(Nm * Nm);
for (let i = 0; i < Nm; i++) {
  for (let j = 0; j < Nm; j++) {
    if (i === j) simMid[i * Nm + j] = 1;
    else {
      const same = (i < 10) === (j < 10);
      simMid[i * Nm + j] = same ? 0.55 : 0.45;
    }
  }
}
const rMid = detectSimilarityBlocks(simMid, Nm);
// Default threshold is 0.4; check behaviour with very high threshold
const rHigh = detectSimilarityBlocks(simMid, Nm, { silhouetteThreshold: 0.99 });
check('high threshold: falls back to K=1', rHigh.K === 1);

// =====================================================================
group('detectSimilarityBlocks — invalid inputs');

const rNull = detectSimilarityBlocks(null, 4);
check('null sim → K=1',               rNull.K === 1);
const rSmall = detectSimilarityBlocks(new Float32Array(1), 1);
check('N=1 → K=1',                    rSmall.K === 1);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
