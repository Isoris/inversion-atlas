// tests/test_shared_mgl_pca_compute.js
//
// Unit coverage for shared/mgl_pca_compute.js — power-iteration
// eigendecomp + centering + polarity-flip + per-window PCA.

import {
  topEigenvectorsSymmetric,
  centerDosageOnSubset,
  applyPolarityFlipsFromRefPC1,
  buildSampleCovariance,
  pcaForWindow,
  computePcaForWindowList,
} from '../atlases/inversion/shared/mgl_pca_compute.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('topEigenvectorsSymmetric — diagonal matrix');

// 4×4 diagonal matrix with eigenvalues 4, 3, 2, 1 (eigenvectors = std basis)
const D = new Float64Array(16);
D[0] = 4; D[5] = 3; D[10] = 2; D[15] = 1;
const eig = topEigenvectorsSymmetric(D, 4, 2);
check('top eigval ≈ 4',              Math.abs(eig.values[0] - 4) < 1e-3);
check('second eigval ≈ 3',           Math.abs(eig.values[1] - 3) < 1e-3);
check('top eigvec aligned with e0',  Math.abs(Math.abs(eig.vectors[0][0]) - 1) < 1e-3);
check('top eigvec is unit norm',
      Math.abs(eig.vectors[0].reduce((s,v) => s + v*v, 0) - 1) < 1e-6);

// =====================================================================
group('topEigenvectorsSymmetric — known 3×3');

// A = [[2, 1, 0], [1, 2, 0], [0, 0, 1]]
// Eigenvalues: 3, 1, 1 (algebraic: top = 3 with eigvec = (1,1,0)/√2)
const A = new Float64Array([2,1,0, 1,2,0, 0,0,1]);
const eA = topEigenvectorsSymmetric(A, 3, 2);
check('top eigval ≈ 3',              Math.abs(eA.values[0] - 3) < 1e-3);
check('top eigvec ≈ (1,1,0)/√2',
      Math.abs(Math.abs(eA.vectors[0][0]) - Math.SQRT1_2) < 1e-3
   && Math.abs(Math.abs(eA.vectors[0][1]) - Math.SQRT1_2) < 1e-3
   && Math.abs(eA.vectors[0][2]) < 1e-3);

// =====================================================================
group('centerDosageOnSubset');

// 2 markers × 4 samples. Row-major.
// Marker 0: [1, 2, 3, 4] mean=2.5 → centered [-1.5, -0.5, 0.5, 1.5]
// Marker 1: [5, 5, 5, 5] mean=5   → centered [0, 0, 0, 0]
const dose = new Float64Array([1,2,3,4, 5,5,5,5]);
centerDosageOnSubset(dose, 2, 4, null);
check('marker 0 centered to -1.5/-0.5/0.5/1.5',
      Math.abs(dose[0] - (-1.5)) < 1e-9 && Math.abs(dose[3] - 1.5) < 1e-9);
check('marker 1 all zero (uniform input)',
      Math.abs(dose[4]) < 1e-9 && Math.abs(dose[7]) < 1e-9);

// Subset centering — mean of samples [0, 1] only
const dose2 = new Float64Array([1,2,3,4]);
centerDosageOnSubset(dose2, 1, 4, [0, 1]);
// Subset mean = (1+2)/2 = 1.5 → centered values [1-1.5, 2-1.5, 3-1.5, 4-1.5]
check('subset centering: shifts by subset mean',
      Math.abs(dose2[0] - (-0.5)) < 1e-9
   && Math.abs(dose2[2] - 1.5) < 1e-9);

// =====================================================================
group('applyPolarityFlipsFromRefPC1');

// 2 markers × 4 samples, already centered.
// Marker 0 correlates POSITIVELY with ref_pc1 → no flip
// Marker 1 correlates NEGATIVELY → flip
const dose3 = new Float64Array([
  -1, -0.5, 0.5, 1,    // marker 0: increases with sample idx
   1,  0.5, -0.5, -1,  // marker 1: decreases with sample idx
]);
const ref_pc1 = new Float64Array([-1, -0.5, 0.5, 1]);   // increases
const flipped = applyPolarityFlipsFromRefPC1(dose3, 2, 4, ref_pc1);
check('1 marker flipped',            flipped === 1);
check('marker 0 unchanged',          dose3[0] === -1);
check('marker 1 flipped to increasing', dose3[4] === -1);

check('null ref → 0 flips',
      applyPolarityFlipsFromRefPC1(new Float64Array([0,0,0,0]), 1, 4, null) === 0);

// =====================================================================
group('buildSampleCovariance');

// 1 marker × 3 samples, values [1, 2, 3]. Already centered would be
// [-1, 0, 1]. Cov_ij = (1/m) sum d[r,i] d[r,j] with m=1.
//   C[0,0] = 1, C[0,1] = 0, C[0,2] = -1, etc.
const d_small = new Float64Array([-1, 0, 1]);
const Csmall = buildSampleCovariance(d_small, 1, 3);
check('cov(0,0) = 1',                Math.abs(Csmall[0] - 1) < 1e-9);
check('cov(0,2) = -1',               Math.abs(Csmall[2] - (-1)) < 1e-9);
check('cov is symmetric',            Math.abs(Csmall[2] - Csmall[6]) < 1e-9);

// =====================================================================
group('pcaForWindow — view_self');

// Build a fake dosage matrix that has clear sample structure:
// 6 markers × 4 samples; each marker increases linearly with sample idx
// (so top eigenvector points along [-, -, +, +] roughly).
// Already-centered: marker r values [-1.5, -0.5, 0.5, 1.5] × scale_r
const nm = 6, nss = 4;
const D2 = new Float64Array(nm * nss);
for (let r = 0; r < nm; r++) {
  const scale = (r + 1) * 0.5;
  D2[r * nss + 0] = -1.5 * scale;
  D2[r * nss + 1] = -0.5 * scale;
  D2[r * nss + 2] =  0.5 * scale;
  D2[r * nss + 3] =  1.5 * scale;
}
const pca = pcaForWindow({
  dosage: D2, n_markers: nm, n_samples: nss,
  anchor_mode: 'view_self',
});
check('PCA: lam1 > 0',               pca.lam1 > 0);
check('PCA: lam1 > lam2',            pca.lam1 > pca.lam2);
check('PCA: pc1 length = n_samples', pca.pc1.length === nss);
check('PCA: pc1 captures linear gradient (sign(pc1[0]) != sign(pc1[3]))',
      Math.sign(pca.pc1[0]) !== Math.sign(pca.pc1[3]));

// =====================================================================
group('pcaForWindow — bi_baseline (projection onto external basis)');

// Use the view_self result as the "anchor". Re-project: lam_proj
// should equal lam1 (same axis).
const projected = pcaForWindow({
  dosage: D2.slice(), n_markers: nm, n_samples: nss,
  anchor_mode: 'bi_baseline',
  anchor_vectors: [pca.pc1, pca.pc2],
});
check('projected: lam1 ≈ self lam1',  Math.abs(projected.lam1 - pca.lam1) < 1e-3);
check('projected: pc1 = anchor pc1',
      projected.pc1.length === nss
   && Math.abs(projected.pc1[0] - pca.pc1[0]) < 1e-9);

// Missing anchor → fallback to self
const fallback = pcaForWindow({
  dosage: D2.slice(), n_markers: nm, n_samples: nss,
  anchor_mode: 'bi_baseline',
  anchor_vectors: null,
});
check('missing anchor: fallback to self', fallback.lam1 > 0 && fallback.pc1.length === nss);

// =====================================================================
group('pcaForWindow — anchor_mode = both');

const both = pcaForWindow({
  dosage: D2.slice(), n_markers: nm, n_samples: nss,
  anchor_mode: 'both',
  anchor_vectors: [pca.pc1, pca.pc2],
});
check('both: lam1 = anchor lam1',     Math.abs(both.lam1 - pca.lam1) < 1e-3);
check('both: lam1_self = self lam1',  Math.abs(both.lam1_self - pca.lam1) < 1e-3);
check('both: pc1_self length',        both.pc1_self.length === nss);

// =====================================================================
group('computePcaForWindowList');

// Build a parser-like result with 12 markers split into 3 windows of 4.
const big = {
  n_markers: 12,
  n_samples: nss,
  dosage_matrix: new Float64Array(12 * nss),
};
for (let r = 0; r < 12; r++) {
  const scale = (r % 4 + 1) * 0.5;
  big.dosage_matrix[r * nss + 0] = -1.5 * scale;
  big.dosage_matrix[r * nss + 1] = -0.5 * scale;
  big.dosage_matrix[r * nss + 2] =  0.5 * scale;
  big.dosage_matrix[r * nss + 3] =  1.5 * scale;
}
const wins = [
  { idx: 0, start_idx: 0, end_idx: 4,  start_bp: 100, end_bp: 200 },
  { idx: 1, start_idx: 4, end_idx: 8,  start_bp: 200, end_bp: 300 },
  { idx: 2, start_idx: 8, end_idx: 12, start_bp: 300, end_bp: 400 },
];
const results = computePcaForWindowList({
  dosage_result: big,
  windows:       wins,
  anchor_mode:   'view_self',
});
check('3 windows produced',           results.length === 3);
check('per window: lam1 > 0',
      results.every(w => Number.isFinite(w.lam1) && w.lam1 > 0));
check('per window: pc1.length = n_samples',
      results.every(w => w.pc1.length === nss));
check('per window: n_pair_rows = 4',
      results.every(w => w.n_pair_rows === 4));
check('per window: idx preserved',
      results[0].idx === 0 && results[2].idx === 2);
check('per window: start_bp / end_bp preserved',
      results[0].start === 100 && results[0].end === 200);
check('per window: polarity_flips_applied default 0',
      results.every(w => w.polarity_flips_applied === 0));

// With polarity flipping
const ref = new Float64Array([-1, -0.5, 0.5, 1]);
const flipped_results = computePcaForWindowList({
  dosage_result: big,
  windows:       wins,
  anchor_mode:   'view_self',
  polarity_ref_pc1: ref,
});
check('with polarity ref: every window reports flips applied (or 0)',
      flipped_results.every(w => Number.isFinite(w.polarity_flips_applied)));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
