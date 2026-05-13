// tests/test_shared_mgl_similarity_matrix.js
//
// Unit coverage for shared/mgl_similarity_matrix.js — per-window
// dosage similarity matrices (Pearson / L1 / L2) + adaptive block
// detection + ARI-based block-transition track + orchestrator.

import {
  MGL_SIMILARITY_METRICS,
  MGL_SIMILARITY_DEFAULTS,
  pearsonSimilarityMatrix,
  l1SimilarityMatrix,
  l2SimilarityMatrix,
  perWindowSimilarityMatrices,
  detectBlocksInWindow,
  ariBetweenAssignments,
  blockTransitionTrack,
  computeSimilarityAndBlocks,
} from '../atlases/inversion/shared/mgl_similarity_matrix.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('3 metrics defined',           MGL_SIMILARITY_METRICS.length === 3);
check('pearson in metrics',          MGL_SIMILARITY_METRICS.includes('pearson'));
check('min_markers default = 20',    MGL_SIMILARITY_DEFAULTS.min_markers_per_window === 20);
check('K_max default = 6',           MGL_SIMILARITY_DEFAULTS.K_max === 6);

// =====================================================================
group('pearsonSimilarityMatrix');

// 4 markers × 3 samples. Sample 0 and sample 1 are identical;
// sample 2 is the negation (anti-correlated).
const dosage = new Float64Array([
  // M0: s0=1, s1=1, s2=2
  1, 1, 2,
  // M1: s0=0, s1=0, s2=2
  0, 0, 2,
  // M2: s0=2, s1=2, s2=0
  2, 2, 0,
  // M3: s0=1, s1=1, s2=1
  1, 1, 1,
]);
const Sp = pearsonSimilarityMatrix(dosage, 4, 3);
check('diagonal = 1',                Math.abs(Sp[0] - 1) < 1e-9 && Math.abs(Sp[4] - 1) < 1e-9);
check('S(0, 1) = 1 (identical samples)',
      Math.abs(Sp[0 * 3 + 1] - 1) < 1e-9);
check('S is symmetric',              Math.abs(Sp[0 * 3 + 1] - Sp[1 * 3 + 0]) < 1e-9);
check('S(0, 2) negative (anti-corr)',Sp[0 * 3 + 2] < 0);

// Zero-sd sample: e.g. uniform dosage → Pearson undefined → 0
const flat = new Float64Array([1, 1, 0, 1, 1, 2, 1, 1, 1]);   // 3×3 with col0 flat
const Sp_flat = pearsonSimilarityMatrix(flat, 3, 3);
check('flat sample: S(0, j) = 0',    Math.abs(Sp_flat[0 * 3 + 1]) < 1e-9
                                  && Math.abs(Sp_flat[0 * 3 + 2]) < 1e-9);

// =====================================================================
group('l1SimilarityMatrix');

const Sl1 = l1SimilarityMatrix(dosage, 4, 3);
check('L1: diagonal = 1',            Math.abs(Sl1[0] - 1) < 1e-9);
check('L1: S(0, 1) = 1 (identical)', Math.abs(Sl1[0 * 3 + 1] - 1) < 1e-9);
check('L1: symmetric',               Sl1[0 * 3 + 2] === Sl1[2 * 3 + 0]);
check('L1: S(0, 2) in [0, 1]',
      Sl1[0 * 3 + 2] >= 0 && Sl1[0 * 3 + 2] <= 1);

// =====================================================================
group('l2SimilarityMatrix');

const Sl2 = l2SimilarityMatrix(dosage, 4, 3);
check('L2: diagonal = 1',            Math.abs(Sl2[0] - 1) < 1e-9);
check('L2: S(0, 1) = 1 (identical)', Math.abs(Sl2[0 * 3 + 1] - 1) < 1e-9);

// =====================================================================
group('perWindowSimilarityMatrices');

// 30 markers × 4 samples. 3 windows of 10 markers each.
const D30 = new Float64Array(30 * 4);
for (let r = 0; r < 30; r++) {
  D30[r * 4 + 0] = (r % 3 === 0 ? 0 : 2);
  D30[r * 4 + 1] = (r % 3 === 0 ? 0 : 2);
  D30[r * 4 + 2] = (r % 3 === 0 ? 2 : 0);
  D30[r * 4 + 3] = (r % 3 === 0 ? 1 : 1);
}
const wins = [
  { start_idx: 0,  end_idx: 10 },
  { start_idx: 10, end_idx: 20 },
  { start_idx: 20, end_idx: 30 },
];
const sims = perWindowSimilarityMatrices(D30, 30, 4, wins, {
  metric: 'pearson', min_markers_per_window: 5,
});
check('3 windows produced',          sims.length === 3);
check('each window has 4×4 = 16 entries',
      sims.every(s => s.similarity && s.similarity.length === 16));
check('per-window n_markers_in_window correct',
      sims.every(s => s.n_markers_in_window === 10));

// Skip windows below min_markers_per_window
const tiny_wins = [{ start_idx: 0, end_idx: 5 }];
const tiny_sims = perWindowSimilarityMatrices(D30, 30, 4, tiny_wins, {
  metric: 'pearson', min_markers_per_window: 10,
});
check('tiny window: similarity = null', tiny_sims[0].similarity === null);

// Different metrics
const sims_l1 = perWindowSimilarityMatrices(D30, 30, 4, wins, {
  metric: 'l1', min_markers_per_window: 5,
});
check('l1 metric: 3 windows',         sims_l1.length === 3 && sims_l1[0].similarity != null);
const sims_l2 = perWindowSimilarityMatrices(D30, 30, 4, wins, {
  metric: 'l2', min_markers_per_window: 5,
});
check('l2 metric: 3 windows',         sims_l2.length === 3 && sims_l2[0].similarity != null);

// =====================================================================
group('detectBlocksInWindow — clear 2-block fixture');

// 20 samples. First 10 share one profile, last 10 share another.
// Similarity = 1 within-block, 0 between-block.
const N = 20;
const S2 = new Float64Array(N * N);
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const sameBlk = (i < 10) === (j < 10);
    S2[i * N + j] = sameBlk ? 1 : 0;
  }
}
const blocks = detectBlocksInWindow(S2, N, { min_block_size: 5 });
check('detect: K = 2',                blocks.K === 2);
check('detect: silhouette high',      blocks.silhouette_score > 0.5);
check('detect: first 10 share block',
      blocks.assignment[0] === blocks.assignment[9]);
check('detect: last 10 share block',
      blocks.assignment[10] === blocks.assignment[19]);
check('detect: cross-block distinct', blocks.assignment[0] !== blocks.assignment[10]);
check('detect: all_K populated',      Array.isArray(blocks.all_K) && blocks.all_K.length > 0);

// No structure: uniform similarity → K = 1
const Suni = new Float64Array(N * N).fill(1);
const blocks_uni = detectBlocksInWindow(Suni, N, { min_block_size: 5 });
check('uniform similarity: K = 1',    blocks_uni.K === 1);

// Single sample → K = 1
const blocks_one = detectBlocksInWindow(new Float64Array([1]), 1);
check('n=1: K = 1',                   blocks_one.K === 1);

// =====================================================================
group('ariBetweenAssignments');

// Identical assignments → ARI = 1
check('identical → ARI = 1',
      Math.abs(ariBetweenAssignments(
        new Int32Array([0, 0, 1, 1, 2, 2]),
        new Int32Array([0, 0, 1, 1, 2, 2]),
      ) - 1) < 1e-9);

// Permuted labels (same partition) → ARI = 1
check('same partition, permuted labels → ARI = 1',
      Math.abs(ariBetweenAssignments(
        new Int32Array([0, 0, 1, 1, 2, 2]),
        new Int32Array([2, 2, 0, 0, 1, 1]),
      ) - 1) < 1e-9);

// Half-shuffled → ARI ~< 1
const ari_shuffled = ariBetweenAssignments(
  new Int32Array([0, 0, 0, 0, 1, 1, 1, 1]),
  new Int32Array([0, 0, 1, 1, 0, 0, 1, 1]),
);
check('half-shuffled → ARI < 1',      ari_shuffled < 0.5);

// =====================================================================
group('blockTransitionTrack');

// 3 windows: w0 has 2 blocks {0,1,2,3} vs {4,5}; w1 same partition;
// w2 has different partition {0,2,4} vs {1,3,5}.
const ws = [
  { assignment: new Int32Array([0, 0, 0, 0, 1, 1]) },
  { assignment: new Int32Array([0, 0, 0, 0, 1, 1]) },
  { assignment: new Int32Array([0, 1, 0, 1, 0, 1]) },
];
const track = blockTransitionTrack(ws);
check('track length = n_windows - 1 = 2',
      track.length === 2);
check('w0→w1 stable: ARI = 1',        Math.abs(track[0] - 1) < 1e-9);
check('w1→w2 unstable: ARI < 1',       track[1] < 1);

// Skipped windows (null assignment) → NaN
const ws_skip = [
  { assignment: new Int32Array([0, 0, 1, 1]) },
  { assignment: null },
  { assignment: new Int32Array([0, 0, 1, 1]) },
];
const track_skip = blockTransitionTrack(ws_skip);
check('skipped window: ARI = NaN',    Number.isNaN(track_skip[0]) && Number.isNaN(track_skip[1]));

// Edge: < 2 windows → empty
check('1 window → empty track',       blockTransitionTrack([{}]).length === 0);

// =====================================================================
group('computeSimilarityAndBlocks — end-to-end');

// 60 markers × 14 samples. First window: samples 0-6 share one
// dosage pattern with variance across markers; samples 7-13 share
// the opposite pattern. Pearson needs within-sample variance to
// score similarity — flat-dosage fixtures collapse to sd=0 → 0
// correlation. Pattern: r%3==0 → 2, r%3==1 → 0, r%3==2 → 1, with
// half the cohort having that flipped. Second window: uniform =
// no signal (all samples flat).
const NW = 60, NS = 14;
const Dbig = new Float64Array(NW * NS);
for (let r = 0; r < 30; r++) {
  const a = (r % 3 === 0) ? 2 : (r % 3 === 1 ? 0 : 1);
  const b = (r % 3 === 0) ? 0 : (r % 3 === 1 ? 2 : 1);
  for (let s = 0; s < NS; s++) {
    Dbig[r * NS + s] = (s < 7) ? a : b;
  }
}
// Window 2: uniform — no signal
for (let r = 30; r < 60; r++) {
  for (let s = 0; s < NS; s++) Dbig[r * NS + s] = 1;
}
const result = computeSimilarityAndBlocks({
  dosage:     Dbig,
  n_markers:  NW,
  n_samples:  NS,
  windows: [
    { start_idx:  0, end_idx: 30, start_bp: 100, end_bp: 200 },
    { start_idx: 30, end_idx: 60, start_bp: 200, end_bp: 300 },
  ],
  opts: { metric: 'pearson', min_block_size: 5, min_markers_per_window: 20 },
});
check('e2e: 2 windows',               result.windows.length === 2);
check('e2e: w0 detects 2 blocks',     result.windows[0].K === 2);
check('e2e: w1 uniform → K = 1',      result.windows[1].K === 1);
check('e2e: w0 start_bp preserved',   result.windows[0].start_bp === 100);
check('e2e: block_transition_ari length = 1', result.block_transition_ari.length === 1);
// w0 vs w1 have very different block structures → low ARI
check('e2e: block transition ARI low (block structure changes)',
      result.block_transition_ari[0] < 0.6 || Number.isNaN(result.block_transition_ari[0]));

// Edge: null inputs
const empty = computeSimilarityAndBlocks({});
check('empty: returns 0 windows',     empty.windows.length === 0);
check('empty: empty track',           empty.block_transition_ari.length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
