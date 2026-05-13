// shared/mgl_dosage_clustering.js
// =====================================================================
// Adaptive interval dosage clustering — HANDOFF_8 + SPEC_0 §11.8.
//
// For each candidate interval, let the data choose the best number
// of dosage clusters. Clusters samples by the SHAPE of dosage
// across the interval (vector of per-window dosage), not just mean
// dosage — so nested structures and double-crossover signatures
// surface naturally.
//
// Scope: Stages 1, 3, 5 of HANDOFF_8 — atlas-side compute that can
// run in the browser. Stage 1.5 polarity correction is out of scope
// here (delegated to mgl_pca_compute.applyPolarityFlipsFromRefPC1
// which already does the same math); Stage 4 hierarchical refinement
// is deferred.
//
// Algorithms:
//   1. K-means (n-dim Lloyd, multi-start)
//   2. Mean silhouette score (per-point silhouette averaged)
//   3. Bootstrap stability via marker subsampling
//   4. Spatial coherence (within-cluster vs between-cluster variance
//      around the per-cluster mean dosage curve)
//   5. Adaptive K selector applying HANDOFF_8 §"Decision rule":
//        sil > 0.4 AND stability > 0.7 AND min_size ≥ floor(0.02·n,5)
//        AND spatial_coh > 0.5 AND Δsil(K vs K-1) ≥ 0.05
//      → pick smallest passing K. None passes → "no_structure".
//
// Pure compute. No DOM, no fetch.
// =====================================================================

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Verdict labels per HANDOFF_8 §"When K_chosen = 1". */
export const MGL_DOSAGE_CLUSTERING_VERDICTS = Object.freeze({
  STRUCTURE_DETECTED:  'structure_detected',
  NO_STRUCTURE:        'no_structure',
  INSUFFICIENT_DATA:   'insufficient_data',
});

/** Thresholds for the adaptive-K decision rule (HANDOFF_8 §"Decision rule"). */
export const MGL_DOSAGE_CLUSTERING_DEFAULTS = Object.freeze({
  K_max:                       6,
  silhouette_threshold:        0.4,
  stability_threshold:         0.7,
  min_size_fraction:           0.02,    // floor at 5
  min_size_floor:              5,
  spatial_coherence_threshold: 0.5,
  silhouette_improvement_min:  0.05,
  kmeans_n_init:               20,
  bootstrap_n_reps:            50,
  bootstrap_marker_subsample:  0.8,
});

// =====================================================================
// 1. Per-window dosage matrix builder
// =====================================================================

/**
 * From a row-major (n_markers × n_samples) dosage matrix + a window
 * grid, build a (n_samples × n_windows) matrix of per-window
 * per-sample dosage means.
 *
 * Each window is `{start_idx, end_idx}` (marker-index range, half-open).
 *
 * @param {Float64Array} dosage_matrix   row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @param {Array<{start_idx:number, end_idx:number}>} windows
 * @returns {Float64Array}    row-major n_samples × n_windows
 */
export function buildPerWindowProfileMatrix(dosage_matrix, n_markers, n_samples, windows) {
  if (!dosage_matrix || n_markers === 0 || n_samples === 0
      || !Array.isArray(windows) || windows.length === 0) {
    return new Float64Array(0);
  }
  const W = windows.length;
  const out = new Float64Array(n_samples * W);
  for (let wi = 0; wi < W; wi++) {
    const w = windows[wi];
    const s = Math.max(0, w.start_idx | 0);
    const e = Math.max(s, Math.min(n_markers, (w.end_idx | 0)));
    const span = e - s;
    if (span === 0) continue;
    for (let si = 0; si < n_samples; si++) {
      let sum = 0;
      for (let r = s; r < e; r++) sum += dosage_matrix[r * n_samples + si];
      out[si * W + wi] = sum / span;
    }
  }
  return out;
}

// =====================================================================
// 2. K-means (n-dim, multi-start Lloyd)
// =====================================================================

/**
 * N-dimensional K-means with multi-start Lloyd.
 *
 * @param {Float64Array} D          row-major n_points × n_dim
 * @param {number} n_points
 * @param {number} n_dim
 * @param {number} K
 * @param {Object} [opts]
 * @returns {{labels:Int32Array, centroids:Float64Array,
 *            inertia:number, iters:number}}
 */
export function kmeansNDim(D, n_points, n_dim, K, opts) {
  const o = opts || {};
  const n_init = Number.isFinite(o.n_init)
    ? o.n_init : MGL_DOSAGE_CLUSTERING_DEFAULTS.kmeans_n_init;
  const max_iter = Number.isFinite(o.max_iter) ? o.max_iter : 100;
  let best = null;
  for (let init = 0; init < n_init; init++) {
    const seed = (o.seed || 1) + init;
    const run = _kmeansSingleRun(D, n_points, n_dim, K, seed, max_iter);
    if (!best || run.inertia < best.inertia) best = run;
  }
  return best;
}

function _kmeansSingleRun(D, n_points, n_dim, K, seed, max_iter) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // K-means++ init: pick first centroid uniformly, then weighted by D².
  const centroids = new Float64Array(K * n_dim);
  const first = Math.floor(rng() * n_points);
  for (let d = 0; d < n_dim; d++) centroids[d] = D[first * n_dim + d];
  const dists = new Float64Array(n_points).fill(Infinity);
  for (let c = 1; c < K; c++) {
    let total = 0;
    for (let i = 0; i < n_points; i++) {
      let dd = 0;
      for (let d = 0; d < n_dim; d++) {
        const diff = D[i * n_dim + d] - centroids[(c - 1) * n_dim + d];
        dd += diff * diff;
      }
      if (dd < dists[i]) dists[i] = dd;
      total += dists[i];
    }
    let pick = rng() * total;
    let acc = 0, chosen = 0;
    for (let i = 0; i < n_points; i++) {
      acc += dists[i];
      if (acc >= pick) { chosen = i; break; }
    }
    for (let d = 0; d < n_dim; d++) centroids[c * n_dim + d] = D[chosen * n_dim + d];
  }
  // Lloyd iterations
  const labels = new Int32Array(n_points);
  let iters = 0, changed = true, inertia = Infinity;
  while (changed && iters < max_iter) {
    changed = false;
    inertia = 0;
    for (let i = 0; i < n_points; i++) {
      let bestK = 0, bestD = Infinity;
      for (let c = 0; c < K; c++) {
        let dd = 0;
        for (let d = 0; d < n_dim; d++) {
          const diff = D[i * n_dim + d] - centroids[c * n_dim + d];
          dd += diff * diff;
        }
        if (dd < bestD) { bestD = dd; bestK = c; }
      }
      if (labels[i] !== bestK) { labels[i] = bestK; changed = true; }
      inertia += bestD;
    }
    // Recompute centroids
    const sums   = new Float64Array(K * n_dim);
    const counts = new Int32Array(K);
    for (let i = 0; i < n_points; i++) {
      const k = labels[i];
      counts[k]++;
      for (let d = 0; d < n_dim; d++) sums[k * n_dim + d] += D[i * n_dim + d];
    }
    for (let k = 0; k < K; k++) {
      if (counts[k] === 0) continue;
      for (let d = 0; d < n_dim; d++) centroids[k * n_dim + d] = sums[k * n_dim + d] / counts[k];
    }
    iters++;
  }
  return { labels, centroids, inertia, iters };
}

// =====================================================================
// 3. Mean silhouette score
// =====================================================================

/**
 * Mean silhouette score (n-dim, Euclidean).
 *
 *   s(i) = (b(i) - a(i)) / max(a(i), b(i))
 *
 * Where a(i) is mean dist from i to other points in its cluster,
 * and b(i) is the smallest mean dist from i to points in a different
 * cluster. Score ∈ [-1, 1]. Returns 0 for singletons.
 *
 * @returns {number}   mean silhouette over all points
 */
export function silhouetteNDim(D, n_points, n_dim, labels, K) {
  if (K <= 1 || n_points < 2) return 0;
  let totalScore = 0;
  for (let i = 0; i < n_points; i++) {
    const li = labels[i];
    const sums = new Float64Array(K);
    const counts = new Int32Array(K);
    for (let j = 0; j < n_points; j++) {
      if (i === j) continue;
      let dd = 0;
      for (let d = 0; d < n_dim; d++) {
        const diff = D[i * n_dim + d] - D[j * n_dim + d];
        dd += diff * diff;
      }
      const dist = Math.sqrt(dd);
      sums[labels[j]] += dist;
      counts[labels[j]]++;
    }
    let a = 0, b = Infinity;
    if (counts[li] > 0) a = sums[li] / counts[li];
    for (let k = 0; k < K; k++) {
      if (k === li || counts[k] === 0) continue;
      const m = sums[k] / counts[k];
      if (m < b) b = m;
    }
    const denom = Math.max(a, b);
    if (denom > 0 && Number.isFinite(b)) {
      totalScore += (b - a) / denom;
    }
  }
  return totalScore / n_points;
}

// =====================================================================
// 4. Bootstrap stability via marker subsampling
// =====================================================================

/**
 * Bootstrap cluster stability: subsample markers (columns) with
 * replacement, re-cluster, and compute pair-stability — the
 * fraction of bootstrap reps in which sample pairs that cluster
 * together originally also cluster together in the subsample.
 *
 * Output ∈ [0, 1]; 1.0 = perfectly stable.
 *
 * @param {Float64Array} D
 * @param {number} n_points
 * @param {number} n_dim
 * @param {Int32Array} ref_labels  cluster labels from the full-data clustering
 * @param {number} K
 * @param {Object} [opts]
 * @returns {number}
 */
export function bootstrapStability(D, n_points, n_dim, ref_labels, K, opts) {
  const o = opts || {};
  const n_reps = Number.isFinite(o.n_reps)
    ? o.n_reps : MGL_DOSAGE_CLUSTERING_DEFAULTS.bootstrap_n_reps;
  const subsample_frac = Number.isFinite(o.marker_subsample)
    ? o.marker_subsample : MGL_DOSAGE_CLUSTERING_DEFAULTS.bootstrap_marker_subsample;
  if (n_points < 2 || n_dim < 2) return 1;
  const n_sub = Math.max(2, Math.floor(n_dim * subsample_frac));
  // Pre-compute the "ground truth" same-cluster matrix as bitset rows.
  // For each pair (i,j), original same_cluster = (ref_labels[i] === ref_labels[j]).
  let s = (o.seed || 7) >>> 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let agree = 0, total = 0;
  for (let r = 0; r < n_reps; r++) {
    // Subsample n_sub marker indices.
    const idx = new Int32Array(n_sub);
    for (let k = 0; k < n_sub; k++) idx[k] = Math.floor(rng() * n_dim);
    // Build the subsampled D'.
    const Dp = new Float64Array(n_points * n_sub);
    for (let i = 0; i < n_points; i++) {
      for (let k = 0; k < n_sub; k++) Dp[i * n_sub + k] = D[i * n_dim + idx[k]];
    }
    const km = kmeansNDim(Dp, n_points, n_sub, K, { n_init: 5, seed: 13 + r });
    // Pair agreement (sampled — full O(n²) is fine at 226).
    for (let i = 0; i < n_points; i++) {
      for (let j = i + 1; j < n_points; j++) {
        const sameRef = ref_labels[i] === ref_labels[j];
        const sameRep = km.labels[i] === km.labels[j];
        if (sameRef === sameRep) agree++;
        total++;
      }
    }
  }
  return total > 0 ? agree / total : 1;
}

// =====================================================================
// 5. Spatial coherence
// =====================================================================

/**
 * Spatial coherence: within-cluster variance around the per-cluster
 * mean dosage curve, normalised by between-cluster variance.
 *
 *   coh = 1 - SS_within / SS_total
 *
 * SS_within = Σ_cluster Σ_sample |x - μ_cluster|²
 * SS_total  = Σ_sample |x - μ_grand|²
 *
 * Range [0, 1]. 1 = perfectly coherent (samples in a cluster share
 * the same dosage curve). 0 = no within-cluster coherence.
 *
 * @param {Float64Array} D
 * @param {number} n_points
 * @param {number} n_dim
 * @param {Int32Array} labels
 * @returns {number}
 */
export function spatialCoherence(D, n_points, n_dim, labels) {
  if (n_points < 2 || n_dim < 1) return 0;
  // Grand mean per dim.
  const mu = new Float64Array(n_dim);
  for (let i = 0; i < n_points; i++) {
    for (let d = 0; d < n_dim; d++) mu[d] += D[i * n_dim + d];
  }
  for (let d = 0; d < n_dim; d++) mu[d] /= n_points;
  // Per-cluster mean.
  const K = labels.reduce((m, v) => Math.max(m, v), -1) + 1;
  const sums   = new Float64Array(K * n_dim);
  const counts = new Int32Array(K);
  for (let i = 0; i < n_points; i++) {
    const k = labels[i];
    counts[k]++;
    for (let d = 0; d < n_dim; d++) sums[k * n_dim + d] += D[i * n_dim + d];
  }
  const muK = new Float64Array(K * n_dim);
  for (let k = 0; k < K; k++) {
    if (counts[k] === 0) continue;
    for (let d = 0; d < n_dim; d++) muK[k * n_dim + d] = sums[k * n_dim + d] / counts[k];
  }
  // SS_total and SS_within.
  let SS_total = 0, SS_within = 0;
  for (let i = 0; i < n_points; i++) {
    const k = labels[i];
    for (let d = 0; d < n_dim; d++) {
      const x = D[i * n_dim + d];
      const dt = x - mu[d];
      SS_total += dt * dt;
      const dw = x - muK[k * n_dim + d];
      SS_within += dw * dw;
    }
  }
  if (SS_total === 0) return 0;
  return Math.max(0, Math.min(1, 1 - SS_within / SS_total));
}

// =====================================================================
// 6. Per-cluster mean dosage curves
// =====================================================================

/**
 * Per-cluster mean dosage curve (n_dim values per cluster).
 *
 * @param {Float64Array} D
 * @param {number} n_points
 * @param {number} n_dim
 * @param {Int32Array} labels
 * @param {number} K
 * @returns {Array<Float64Array>}   one Float64Array per cluster
 */
export function perClusterMeanCurves(D, n_points, n_dim, labels, K) {
  const sums   = new Array(K);
  const counts = new Int32Array(K);
  for (let k = 0; k < K; k++) sums[k] = new Float64Array(n_dim);
  for (let i = 0; i < n_points; i++) {
    const k = labels[i];
    counts[k]++;
    for (let d = 0; d < n_dim; d++) sums[k][d] += D[i * n_dim + d];
  }
  const out = new Array(K);
  for (let k = 0; k < K; k++) {
    out[k] = new Float64Array(n_dim);
    if (counts[k] === 0) continue;
    for (let d = 0; d < n_dim; d++) out[k][d] = sums[k][d] / counts[k];
  }
  return out;
}

// =====================================================================
// 7. Adaptive K selector
// =====================================================================

/**
 * Adaptive K selection per HANDOFF_8 §"Decision rule".
 *
 *   Pick the smallest K ∈ [2, K_max] such that:
 *     1. silhouette(K) > silhouette_threshold (0.4)
 *     2. stability(K)   > stability_threshold (0.7)
 *     3. min_cluster_size ≥ max(min_size_floor, min_size_fraction · n)
 *     4. spatial_coherence(K) > spatial_coherence_threshold (0.5)
 *     5. Δsil(K vs K-1) ≥ silhouette_improvement_min (0.05)
 *
 *   No K passes → verdict = NO_STRUCTURE (K_chosen = 1).
 *
 * @param {Float64Array} D
 * @param {number} n_points
 * @param {number} n_dim
 * @param {Object} [opts]
 * @returns {{
 *   verdict:string, K_chosen:number,
 *   per_K: Array<{
 *     K:number, passes:boolean,
 *     silhouette:number, stability:number,
 *     min_size:number, spatial_coherence:number,
 *     delta_sil:number, labels:Int32Array|null,
 *     cluster_curves:Array<Float64Array>|null,
 *   }>,
 *   chosen_labels:  Int32Array|null,
 *   chosen_curves:  Array<Float64Array>|null,
 * }}
 */
export function adaptiveKDosageClustering(D, n_points, n_dim, opts) {
  const o = opts || {};
  const D_def = MGL_DOSAGE_CLUSTERING_DEFAULTS;
  const K_max     = Number.isFinite(o.K_max)
    ? o.K_max : D_def.K_max;
  const silThr    = Number.isFinite(o.silhouette_threshold)
    ? o.silhouette_threshold : D_def.silhouette_threshold;
  const stabThr   = Number.isFinite(o.stability_threshold)
    ? o.stability_threshold : D_def.stability_threshold;
  const sizeFrac  = Number.isFinite(o.min_size_fraction)
    ? o.min_size_fraction : D_def.min_size_fraction;
  const sizeFloor = Number.isFinite(o.min_size_floor)
    ? o.min_size_floor : D_def.min_size_floor;
  const cohThr    = Number.isFinite(o.spatial_coherence_threshold)
    ? o.spatial_coherence_threshold : D_def.spatial_coherence_threshold;
  const dSilMin   = Number.isFinite(o.silhouette_improvement_min)
    ? o.silhouette_improvement_min : D_def.silhouette_improvement_min;

  if (n_points < 2 || n_dim < 1) {
    return {
      verdict: MGL_DOSAGE_CLUSTERING_VERDICTS.INSUFFICIENT_DATA,
      K_chosen: 1, per_K: [], chosen_labels: null, chosen_curves: null,
    };
  }
  const minSize = Math.max(sizeFloor, Math.floor(sizeFrac * n_points));
  const per_K = [];
  // Always record K=1 as the baseline.
  per_K.push({
    K: 1, passes: true,
    silhouette: 0, stability: 1, min_size: n_points,
    spatial_coherence: 0, delta_sil: 0,
    labels: null, cluster_curves: null,
  });

  let prev_sil = 0;
  let chosen = null;
  for (let K = 2; K <= K_max && K <= n_points; K++) {
    const km = kmeansNDim(D, n_points, n_dim, K, o);
    const sil = silhouetteNDim(D, n_points, n_dim, km.labels, K);
    const stab = bootstrapStability(D, n_points, n_dim, km.labels, K, o);
    // min_cluster_size
    const counts = new Int32Array(K);
    for (let i = 0; i < n_points; i++) counts[km.labels[i]]++;
    let cMin = Infinity;
    for (let k = 0; k < K; k++) if (counts[k] < cMin) cMin = counts[k];
    const coh = spatialCoherence(D, n_points, n_dim, km.labels);
    const dSil = sil - prev_sil;
    const passes =
      sil  > silThr   &&
      stab > stabThr  &&
      cMin >= minSize &&
      coh  > cohThr   &&
      dSil >= dSilMin;
    const curves = perClusterMeanCurves(D, n_points, n_dim, km.labels, K);
    const entry = {
      K, passes,
      silhouette: sil, stability: stab,
      min_size: cMin, spatial_coherence: coh,
      delta_sil: dSil,
      labels: km.labels,
      cluster_curves: curves,
    };
    per_K.push(entry);
    if (passes && chosen === null) chosen = entry;
    prev_sil = sil;
  }
  if (!chosen) {
    return {
      verdict: MGL_DOSAGE_CLUSTERING_VERDICTS.NO_STRUCTURE,
      K_chosen: 1, per_K,
      chosen_labels: null, chosen_curves: null,
    };
  }
  return {
    verdict:       MGL_DOSAGE_CLUSTERING_VERDICTS.STRUCTURE_DETECTED,
    K_chosen:      chosen.K,
    per_K,
    chosen_labels: chosen.labels,
    chosen_curves: chosen.cluster_curves,
  };
}
