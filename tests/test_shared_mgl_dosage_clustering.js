// tests/test_shared_mgl_dosage_clustering.js
//
// Unit coverage for shared/mgl_dosage_clustering.js — per-window
// profile builder, n-dim K-means, silhouette, bootstrap stability,
// spatial coherence, per-cluster curves, adaptive-K selector.

import {
  MGL_DOSAGE_CLUSTERING_VERDICTS,
  MGL_DOSAGE_CLUSTERING_DEFAULTS,
  buildPerWindowProfileMatrix,
  kmeansNDim,
  silhouetteNDim,
  bootstrapStability,
  spatialCoherence,
  perClusterMeanCurves,
  adaptiveKDosageClustering,
} from '../atlases/inversion/shared/mgl_dosage_clustering.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('3 verdicts',                   Object.keys(MGL_DOSAGE_CLUSTERING_VERDICTS).length === 3);
check('K_max default = 6',            MGL_DOSAGE_CLUSTERING_DEFAULTS.K_max === 6);
check('silhouette_threshold = 0.4',   MGL_DOSAGE_CLUSTERING_DEFAULTS.silhouette_threshold === 0.4);
check('stability_threshold = 0.7',    MGL_DOSAGE_CLUSTERING_DEFAULTS.stability_threshold === 0.7);

// =====================================================================
group('buildPerWindowProfileMatrix');

// 4 markers × 3 samples. 2 windows: markers 0-2 and 2-4.
// Marker dosage by index (row-major): m × s
//   M0: [1, 2, 3]
//   M1: [1, 2, 3]
//   M2: [4, 5, 6]
//   M3: [4, 5, 6]
const dosage = new Float64Array([1,2,3, 1,2,3, 4,5,6, 4,5,6]);
const profile = buildPerWindowProfileMatrix(dosage, 4, 3, [
  { start_idx: 0, end_idx: 2 },
  { start_idx: 2, end_idx: 4 },
]);
// Expect (sample × window) row-major:
//   sample 0: [(1+1)/2, (4+4)/2] = [1, 4]
//   sample 1: [(2+2)/2, (5+5)/2] = [2, 5]
//   sample 2: [(3+3)/2, (6+6)/2] = [3, 6]
check('profile size',                 profile.length === 3 * 2);
check('sample 0 / win 0 = 1',         Math.abs(profile[0 * 2 + 0] - 1) < 1e-9);
check('sample 0 / win 1 = 4',         Math.abs(profile[0 * 2 + 1] - 4) < 1e-9);
check('sample 2 / win 0 = 3',         Math.abs(profile[2 * 2 + 0] - 3) < 1e-9);
check('sample 2 / win 1 = 6',         Math.abs(profile[2 * 2 + 1] - 6) < 1e-9);

check('empty inputs → empty',         buildPerWindowProfileMatrix(null, 0, 0, []).length === 0);

// =====================================================================
group('kmeansNDim — two well-separated clusters');

// 6 samples × 2 dims. Two clearly separated groups.
const D = new Float64Array([
  0.0, 0.0,
  0.1, 0.1,
  0.2, 0.0,
  10.0, 10.0,
  10.1, 9.9,
  9.9, 10.1,
]);
const km = kmeansNDim(D, 6, 2, 2, { n_init: 5 });
check('km: labels length 6',          km.labels.length === 6);
check('km: 2 distinct labels',        new Set(km.labels).size === 2);
// First 3 share a label, last 3 share a label.
check('km: first cluster grouped',    km.labels[0] === km.labels[1] && km.labels[1] === km.labels[2]);
check('km: second cluster grouped',   km.labels[3] === km.labels[4] && km.labels[4] === km.labels[5]);
check('km: cross-cluster different',  km.labels[0] !== km.labels[3]);
check('km: inertia finite',           Number.isFinite(km.inertia));
check('km: centroids size 2×2 = 4',   km.centroids.length === 4);

// =====================================================================
group('silhouetteNDim');

// Well-separated → high silhouette (close to 1)
const sil_good = silhouetteNDim(D, 6, 2, km.labels, 2);
check('sil good clusters > 0.7',      sil_good > 0.7);

// Random labels → low silhouette
const random_labels = new Int32Array([0, 1, 0, 1, 0, 1]);
const sil_bad = silhouetteNDim(D, 6, 2, random_labels, 2);
check('sil random labels < good',     sil_bad < sil_good);

// K=1 → 0
check('K=1 → 0',                      silhouetteNDim(D, 6, 2, new Int32Array(6), 1) === 0);

// =====================================================================
group('bootstrapStability');

// On well-separated D, stability should be high.
const stab_good = bootstrapStability(D, 6, 2, km.labels, 2, { n_reps: 20 });
check('stability on good clusters > 0.8', stab_good > 0.8);

// Single dim → returns 1 (per impl gate)
const stab_1d = bootstrapStability(D, 6, 1, km.labels, 2);
check('1-dim returns 1 (gate)',       stab_1d === 1);

// =====================================================================
group('spatialCoherence');

const coh_good = spatialCoherence(D, 6, 2, km.labels);
check('coherence on good clusters > 0.9', coh_good > 0.9);

const coh_bad = spatialCoherence(D, 6, 2, random_labels);
check('coherence random labels < good',   coh_bad < coh_good);

// =====================================================================
group('perClusterMeanCurves');

const curves = perClusterMeanCurves(D, 6, 2, km.labels, 2);
check('2 curves returned',            curves.length === 2);
check('each curve has 2 dims',
      curves[0].length === 2 && curves[1].length === 2);
// One cluster should be near origin, the other near (10, 10)
const c0 = curves[0], c1 = curves[1];
const near_origin = (Math.hypot(c0[0], c0[1]) < 1)
                  ? c0 : (Math.hypot(c1[0], c1[1]) < 1) ? c1 : null;
check('one curve near origin',        near_origin != null);

// =====================================================================
group('adaptiveKDosageClustering — 2 clear clusters');

const adaptive = adaptiveKDosageClustering(D, 6, 2, {
  bootstrap_n_reps: 10,    // speed up tests
  min_size_floor: 2,       // tiny test cohort; production default is 5
});
check('verdict: structure_detected',  adaptive.verdict === MGL_DOSAGE_CLUSTERING_VERDICTS.STRUCTURE_DETECTED);
check('K_chosen = 2',                 adaptive.K_chosen === 2);
check('per_K includes K=1 baseline',  adaptive.per_K[0].K === 1);
check('chosen_labels populated',      adaptive.chosen_labels && adaptive.chosen_labels.length === 6);
check('chosen_curves populated',      adaptive.chosen_curves && adaptive.chosen_curves.length === 2);

// =====================================================================
group('adaptiveKDosageClustering — no structure');

// 20 samples × 3 dims of pure noise → no clusters.
const noise = new Float64Array(20 * 3);
let s = 12345;
for (let i = 0; i < noise.length; i++) {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  noise[i] = ((s % 1000) / 1000);
}
const adaptive_noise = adaptiveKDosageClustering(noise, 20, 3, {
  bootstrap_n_reps: 5,
  K_max: 4,
});
check('noise: verdict = no_structure', adaptive_noise.verdict === MGL_DOSAGE_CLUSTERING_VERDICTS.NO_STRUCTURE);
check('noise: K_chosen = 1',           adaptive_noise.K_chosen === 1);
check('noise: chosen_labels = null',   adaptive_noise.chosen_labels === null);

// =====================================================================
group('adaptiveKDosageClustering — insufficient data');

const insuff = adaptiveKDosageClustering(new Float64Array([]), 0, 0);
check('empty: insufficient_data',     insuff.verdict === MGL_DOSAGE_CLUSTERING_VERDICTS.INSUFFICIENT_DATA);

const singleton = adaptiveKDosageClustering(new Float64Array([0.5]), 1, 1);
check('1 sample: insufficient_data',  singleton.verdict === MGL_DOSAGE_CLUSTERING_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
group('adaptiveKDosageClustering — 3-cluster fixture');

// 9 samples × 2 dims, 3 well-separated clusters
const D3 = new Float64Array([
  0, 0,    0.1, 0.0,  0.05, 0.1,        // cluster 0 near (0, 0)
  5, 0,    5.1, 0.0,  4.95, 0.1,        // cluster 1 near (5, 0)
  0, 5,    0.1, 5.0,  0.05, 5.1,        // cluster 2 near (0, 5)
]);
const adaptive_3 = adaptiveKDosageClustering(D3, 9, 2, {
  bootstrap_n_reps: 8,
  K_max: 5,
  min_size_floor: 3,
});
check('3-cluster fixture: structure_detected',
      adaptive_3.verdict === MGL_DOSAGE_CLUSTERING_VERDICTS.STRUCTURE_DETECTED);
check('3-cluster fixture: K_chosen ≥ 2',
      adaptive_3.K_chosen >= 2);
check('3-cluster fixture: chosen_curves populated',
      adaptive_3.chosen_curves && adaptive_3.chosen_curves.length === adaptive_3.K_chosen);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
