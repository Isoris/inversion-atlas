// pages/discovery/dosage_heatmap/index_aware_cluster.js
// =====================================================================
// Position-aware (index-aware) haplotype clustering for the dosage
// heatmap.
//
// Plain sample-vector clustering treats SNPs as an unordered bag of
// columns: two samples are "close" if their total dosage pattern matches,
// regardless of WHERE along the chromosome the matches fall. For inversion
// karyotypes that's too naive — recombination suppression creates locally
// CONTINUOUS haplotype blocks, so samples should cluster on their
// trajectory along genomic position, not on a positionless vector.
//
// This module clusters samples on ordered-bin trajectories:
//   1. split the displayed markers into ordered genomic bins,
//   2. summarise each sample per bin (mean dosage),
//   3. smooth along genomic index (a noisy bin can't flip the grouping),
//   4. pairwise TRAJECTORY distance = mean local dosage difference
//      + a fragmentation penalty (similarity that switches on/off along
//        the genome is penalised) − a continuity bonus (long stable runs
//        of similarity are rewarded),
//   5. k-medoids on that distance matrix (auto-K by silhouette).
//
// The result is shaped exactly like dosage_detect.detectGroups() so it
// plugs straight into the page's existing grouping/confidence/legend
// machinery, plus a position-aware row `order`.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================
import {
  computeSampleDosageFeatures, regimeCallsFromDosage,
  regimeCallFromMean, marginConfidence, summariseGroups,
  karyogroupName,
} from './dosage_detect.js';

// Largest sample count we'll build an m×m trajectory-distance matrix for.
// Above this the page falls back to the external grouping (clusterIndexAware
// returns null). Discovery cohorts are well under this in practice.
export const INDEX_AWARE_MAX_N = 2000;

/**
 * Order the working-set markers by genomic position and split them into
 * `nBins` contiguous ordered bins; summarise each sample as mean dosage
 * per bin → samples × bins trajectory matrix.
 *
 * @param {Object} canonical            adapter output (cellValue, marker_pos_bp…)
 * @param {Object} [opts]
 *   markerOrder?: Int32Array            working-set marker indices (else all)
 *   binSize?: number                    target markers per bin (default 25)
 *   minBins?, maxBins?: number          clamp on bin count (default 4 / 40)
 * @returns {{ B:Float64Array, nS:number, nBins:number,
 *             cols:Int32Array, binStart:Int32Array } | null}
 *   B is row-major nS×nBins (NaN where a sample has no data in a bin).
 */
export function buildSampleTrajectoryMatrix(canonical, opts) {
  const o = opts || {};
  const nS = (canonical && canonical.n_samples | 0) || 0;
  const nM = (canonical && canonical.n_markers | 0) || 0;
  if (!canonical || typeof canonical.cellValue !== 'function' || nS <= 0 || nM <= 0) return null;

  // Working-set columns, then ordered by genomic position when available.
  let cols;
  if (o.markerOrder instanceof Int32Array && o.markerOrder.length > 0) {
    cols = Int32Array.from(o.markerOrder);
  } else {
    cols = new Int32Array(nM);
    for (let i = 0; i < nM; i++) cols[i] = i;
  }
  const pos = canonical.marker_pos_bp;
  if (pos && pos.length >= nM) {
    const arr = Array.from(cols).sort((a, b) => {
      const pa = pos[a], pb = pos[b];
      const fa = Number.isFinite(pa), fb = Number.isFinite(pb);
      if (fa && fb) return pa - pb || (a - b);
      if (fa) return -1;
      if (fb) return 1;
      return a - b;
    });
    cols = Int32Array.from(arr);
  }
  const nUsed = cols.length;
  if (nUsed <= 0) return null;

  const binSize = Number.isFinite(o.binSize) && o.binSize > 0 ? (o.binSize | 0) : 25;
  const minBins = Number.isFinite(o.minBins) ? (o.minBins | 0) : 4;
  const maxBins = Number.isFinite(o.maxBins) ? (o.maxBins | 0) : 40;
  let nBins = Math.round(nUsed / binSize);
  nBins = Math.max(Math.min(minBins, nUsed), Math.min(nBins, maxBins, nUsed));
  if (nBins < 1) nBins = 1;

  // Contiguous bin boundaries over the ordered columns.
  const binStart = new Int32Array(nBins + 1);
  for (let b = 0; b <= nBins; b++) binStart[b] = Math.round((b * nUsed) / nBins);

  const cellValue = canonical.cellValue;
  const B = new Float64Array(nS * nBins);
  for (let s = 0; s < nS; s++) {
    for (let b = 0; b < nBins; b++) {
      let sum = 0, cnt = 0;
      for (let c = binStart[b]; c < binStart[b + 1]; c++) {
        const v = cellValue(cols[c], s);
        if (v == null || !Number.isFinite(v)) continue;
        sum += v; cnt++;
      }
      B[s * nBins + b] = cnt > 0 ? sum / cnt : NaN;
    }
  }
  return { B, nS, nBins, cols, binStart };
}

/**
 * Moving-average smooth each sample's trajectory along the genomic-index
 * (bin) axis. NaN bins are skipped in the average; a bin stays NaN only
 * if its whole window is NaN.
 *
 * @returns {Float64Array} new nS×nBins matrix
 */
export function smoothTrajectories(B, nS, nBins, window) {
  const w = Number.isFinite(window) && window >= 1 ? (window | 0) : 3;
  const r = (w - 1) >> 1;
  const out = new Float64Array(nS * nBins);
  for (let s = 0; s < nS; s++) {
    const base = s * nBins;
    for (let k = 0; k < nBins; k++) {
      let sum = 0, cnt = 0;
      for (let d = -r; d <= r; d++) {
        const kk = k + d;
        if (kk < 0 || kk >= nBins) continue;
        const v = B[base + kk];
        if (Number.isFinite(v)) { sum += v; cnt++; }
      }
      out[base + k] = cnt > 0 ? sum / cnt : NaN;
    }
  }
  return out;
}

/**
 * Index-aware trajectory distance between samples i and j.
 *
 *   D = mean_local_diff + lambda·fragmentation − mu·continuity
 *
 * where, over bins where both samples have data:
 *   mean_local_diff = mean |Bs[i,k] − Bs[j,k]|
 *   fragmentation   = (# of similar↔dissimilar switches) / (validBins−1)
 *   continuity      = (longest run of "similar" bins) / validBins
 * "similar" ⇔ local diff < threshold. Result clamped to ≥ 0. When the two
 * samples share no comparable bin, returns `maxDist` (default 2 = full
 * dosage range) so they don't spuriously cluster.
 */
export function trajectoryDistance(Bs, nBins, i, j, opts) {
  const o = opts || {};
  const threshold = Number.isFinite(o.threshold) ? o.threshold : 0.5;
  const lambda    = Number.isFinite(o.lambda)    ? o.lambda    : 0.5;
  const mu        = Number.isFinite(o.mu)        ? o.mu        : 0.15;
  const maxDist   = Number.isFinite(o.maxDist)   ? o.maxDist   : 2;
  const bi = i * nBins, bj = j * nBins;
  let diffSum = 0, valid = 0, switches = 0;
  let prevSimilar = null, run = 0, longestRun = 0;
  for (let k = 0; k < nBins; k++) {
    const a = Bs[bi + k], b = Bs[bj + k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const diff = Math.abs(a - b);
    diffSum += diff; valid++;
    const similar = diff < threshold;
    if (prevSimilar !== null && similar !== prevSimilar) switches++;
    prevSimilar = similar;
    if (similar) { run++; if (run > longestRun) longestRun = run; } else { run = 0; }
  }
  if (valid === 0) return maxDist;
  const meanDiff      = diffSum / valid;
  const fragmentation = valid > 1 ? switches / (valid - 1) : 0;
  const continuity    = longestRun / valid;
  const d = meanDiff + lambda * fragmentation - mu * continuity;
  return d > 0 ? d : 0;
}

// Pairwise distance matrix (flat m×m) over a subset of sample rows `idx`.
function _distanceMatrix(Bs, nBins, idx, opts) {
  const m = idx.length;
  const D = new Float64Array(m * m);
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      const d = trajectoryDistance(Bs, nBins, idx[a], idx[b], opts);
      D[a * m + b] = d; D[b * m + a] = d;
    }
  }
  return D;
}

// Deterministic k-medoids on a precomputed flat m×m distance matrix.
// Farthest-first init (most-central seed, then farthest-from-chosen),
// Voronoi assignment + medoid update to convergence.
function _kMedoids(D, m, k, maxIter) {
  if (k >= m) {                       // each point its own medoid
    const labels = new Int32Array(m);
    for (let i = 0; i < m; i++) labels[i] = i;
    return { labels, medoids: Array.from({ length: m }, (_, i) => i) };
  }
  // Seed 0: minimal total distance (most central).
  let seed0 = 0, bestTot = Infinity;
  for (let i = 0; i < m; i++) {
    let tot = 0; for (let j = 0; j < m; j++) tot += D[i * m + j];
    if (tot < bestTot) { bestTot = tot; seed0 = i; }
  }
  const medoids = [seed0];
  while (medoids.length < k) {
    let far = -1, farD = -Infinity;
    for (let i = 0; i < m; i++) {
      if (medoids.indexOf(i) >= 0) continue;
      let nearest = Infinity;
      for (const md of medoids) { const d = D[i * m + md]; if (d < nearest) nearest = d; }
      if (nearest > farD) { farD = nearest; far = i; }
    }
    if (far < 0) break;
    medoids.push(far);
  }

  const labels = new Int32Array(m);
  const iters = Number.isFinite(maxIter) ? maxIter : 50;
  for (let it = 0; it < iters; it++) {
    // Assign.
    let changed = false;
    for (let i = 0; i < m; i++) {
      let best = 0, bestD = Infinity;
      for (let g = 0; g < medoids.length; g++) {
        const d = D[i * m + medoids[g]];
        if (d < bestD) { bestD = d; best = g; }
      }
      if (labels[i] !== best) { labels[i] = best; changed = true; }
    }
    // Update: medoid = in-cluster point with min sum of distances.
    let moved = false;
    for (let g = 0; g < medoids.length; g++) {
      let best = medoids[g], bestSum = Infinity;
      for (let i = 0; i < m; i++) {
        if (labels[i] !== g) continue;
        let sum = 0;
        for (let j = 0; j < m; j++) if (labels[j] === g) sum += D[i * m + j];
        if (sum < bestSum) { bestSum = sum; best = i; }
      }
      if (best !== medoids[g]) { medoids[g] = best; moved = true; }
    }
    if (!changed && !moved) break;
  }
  return { labels, medoids };
}

// Per-point silhouette from a flat m×m distance matrix + labels.
function _silhouetteFromMatrix(D, m, labels, k) {
  const out = new Float64Array(m);
  const cnt = new Int32Array(k);
  for (let i = 0; i < m; i++) cnt[labels[i]]++;
  for (let i = 0; i < m; i++) {
    const gi = labels[i];
    if (cnt[gi] <= 1) { out[i] = 0; continue; }
    const sumTo = new Float64Array(k);
    for (let j = 0; j < m; j++) { if (j === i) continue; sumTo[labels[j]] += D[i * m + j]; }
    const a = sumTo[gi] / (cnt[gi] - 1);
    let b = Infinity;
    for (let g = 0; g < k; g++) {
      if (g === gi || cnt[g] === 0) continue;
      const avg = sumTo[g] / cnt[g];
      if (avg < b) b = avg;
    }
    out[i] = Number.isFinite(b) && Math.max(a, b) > 0 ? (b - a) / Math.max(a, b) : 0;
  }
  return out;
}

function _mean(arr) {
  let s = 0, c = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) { s += arr[i]; c++; }
  return c > 0 ? s / c : NaN;
}

// Normalised between-group dosage separation in [0,1): the smallest
// standardised gap between any two group dosage means (gap / pooled SD),
// squashed through 1−exp(−x/1.5). 0 = groups overlap; →1 = cleanly apart.
function _dosageSeparationNorm(meanFull, idx, labSub, k) {
  const sum = new Float64Array(k), sq = new Float64Array(k);
  const cnt = new Int32Array(k);
  for (let i = 0; i < idx.length; i++) {
    const v = meanFull[idx[i]];
    if (!Number.isFinite(v)) continue;
    const g = labSub[i];
    sum[g] += v; sq[g] += v * v; cnt[g]++;
  }
  const mu = new Float64Array(k), sd = new Float64Array(k);
  for (let g = 0; g < k; g++) {
    mu[g] = cnt[g] > 0 ? sum[g] / cnt[g] : NaN;
    const varG = cnt[g] > 0 ? Math.max(0, sq[g] / cnt[g] - mu[g] * mu[g]) : NaN;
    sd[g] = Number.isFinite(varG) ? Math.sqrt(varG) : 0;
  }
  let minGap = Infinity;
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      if (cnt[a] === 0 || cnt[b] === 0) continue;
      const pooled = Math.sqrt(((sd[a] ** 2) + (sd[b] ** 2)) / 2) || 1e-9;
      const g = Math.abs(mu[a] - mu[b]) / pooled;
      if (g < minGap) minGap = g;
    }
  }
  if (!Number.isFinite(minGap)) return 0;
  return 1 - Math.exp(-minGap / 1.5);
}

/**
 * Position-aware haplotype clustering. Returns a result shaped like
 * dosage_detect.detectGroups() (mode 'index_aware') plus `order`.
 *
 * @param {Object} canonical
 * @param {Object} [opts]
 *   k?: number|'auto'                   target K (default auto over kMin..kMax)
 *   kMin?, kMax?: number                auto-K range (default 2..4)
 *   minNGroup?: number                  reject auto-K with a group smaller (default 4)
 *   markerOrder?: Int32Array            working-set markers
 *   binSize?, smoothWindow?, threshold?, lambda?, mu?: distance/binning knobs
 * @returns {Object|null}
 */
export function clusterIndexAware(canonical, opts) {
  const o = opts || {};
  const traj = buildSampleTrajectoryMatrix(canonical, o);
  if (!traj) return null;
  const { nS, nBins } = traj;
  const Bs = smoothTrajectories(traj.B, nS, nBins, o.smoothWindow);

  // Per-sample mean dosage (over the genomic-ordered working set) for
  // tier calls / margin / relabelling — reuses the detect feature path.
  const feats = computeSampleDosageFeatures(canonical, traj.cols);

  // Samples with at least one finite bin are clusterable.
  const idx = [];
  for (let s = 0; s < nS; s++) {
    let any = false;
    for (let k = 0; k < nBins; k++) if (Number.isFinite(Bs[s * nBins + k])) { any = true; break; }
    if (any) idx.push(s);
  }
  const kMin = Number.isFinite(o.kMin) ? (o.kMin | 0) : 2;
  if (idx.length < kMin) return null;
  if (idx.length > INDEX_AWARE_MAX_N) return null;   // page falls back

  const distOpts = { threshold: o.threshold, lambda: o.lambda, mu: o.mu };
  const D = _distanceMatrix(Bs, nBins, idx, distOpts);
  const m = idx.length;

  // Index-aware clustering keeps the full position-ordered trajectory, so
  // — unlike the 1-D `bands` path — it can genuinely resolve more than 3
  // arrangements. Auto-K therefore sweeps a wider ceiling (default 8).
  const kMax = Number.isFinite(o.kMax) ? (o.kMax | 0) : 8;
  const minNGroup = Number.isFinite(o.minNGroup) ? (o.minNGroup | 0) : 4;
  const sepWeight = Number.isFinite(o.sepWeight) ? o.sepWeight : 0.25;
  const wantAuto = (o.k == null || o.k === 'auto' || !Number.isFinite(o.k));
  const tryKs = wantAuto
    ? Array.from({ length: Math.max(1, kMax - kMin + 1) }, (_, i) => kMin + i)
    : [Math.max(1, o.k | 0)];

  let best = null;
  for (const k of tryKs) {
    if (k < 1 || k > m) continue;
    const { labels: labSub } = _kMedoids(D, m, k, 50);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < labSub.length; i++) counts[labSub[i]]++;
    if (wantAuto && k > 1 && Math.min(...counts) < minNGroup) continue;
    const sil = (k >= 2) ? _silhouetteFromMatrix(D, m, labSub, k) : null;
    // Auto-K score blends cluster cohesion (silhouette) with how well the
    // groups SEPARATE on dosage — the "elevated between-arrangement" signal
    // that defines a real inversion partition, not just tight blobs.
    const silMean = sil ? _mean(sil) : 0;
    const sepNorm = (k >= 2) ? _dosageSeparationNorm(feats.mean, idx, labSub, k) : 0;
    const score = silMean + sepWeight * sepNorm;
    if (!best || score > (best.score)) best = { k, labSub, sil, score };
  }
  if (!best) {
    const labSub = new Int32Array(m);   // single group fallback
    best = { k: 1, labSub, sil: null, score: 0 };
  }

  // Relabel clusters ascending by mean dosage so cluster 0 is lowest-dosage
  // (consistent with detect bands / clusters).
  let K = best.k, labSub = best.labSub;
  const cMean = new Float64Array(K), cCnt = new Int32Array(K);
  for (let i = 0; i < m; i++) {
    const v = feats.mean[idx[i]];
    if (Number.isFinite(v)) { cMean[labSub[i]] += v; cCnt[labSub[i]]++; }
  }
  for (let g = 0; g < K; g++) cMean[g] = cCnt[g] > 0 ? cMean[g] / cCnt[g] : Infinity;
  const ord = Array.from({ length: K }, (_, i) => i).sort((a, b) => cMean[a] - cMean[b]);
  const remap = new Int32Array(K);
  for (let i = 0; i < K; i++) remap[ord[i]] = i;
  const centers = new Float64Array(K);
  for (let g = 0; g < K; g++) centers[g] = cMean[ord[g]];

  // Scatter to full-length arrays.
  const labels = new Int32Array(nS).fill(-1);
  const silFull = new Float64Array(nS).fill(NaN);
  for (let i = 0; i < m; i++) {
    labels[idx[i]] = remap[labSub[i]];
    if (best.sil) silFull[idx[i]] = best.sil[i];
  }

  const margin = marginConfidence(feats.mean);
  const regime_call = regimeCallsFromDosage(feats.mean);
  const groups = summariseGroups({ labels, mean: feats.mean, centers, margin, sil: silFull, k: Math.max(K, 1) });

  // Readable labels: karyogroup identity (KG-A…) + modal dosage tier as a
  // secondary attribute. Identity stays distinct from the 3 tiers so a
  // richer K isn't squashed back into homA/het/homB.
  const labelName = new Array(Math.max(K, 1));
  for (let g = 0; g < labelName.length; g++) {
    const tier = regimeCallFromMean(centers[g]).replace('_like', '');
    labelName[g] = `${karyogroupName(g)} (${tier})`;
    if (groups[g]) groups[g].karyogroup = karyogroupName(g);
  }
  const sample_group = new Array(nS);
  const karyogroup  = new Array(nS);
  for (let s = 0; s < nS; s++) {
    sample_group[s] = labels[s] >= 0 ? labelName[labels[s]] : null;
    karyogroup[s]   = labels[s] >= 0 ? karyogroupName(labels[s]) : null;
  }

  // Position-aware row order: cluster asc, then distance-to-medoid asc
  // (tight, smooth blocks); no-data samples last.
  const distToMedoid = new Float64Array(nS).fill(Infinity);
  {
    const { labels: labSub2, medoids } = _kMedoids(D, m, Math.max(K, 1), 50);
    // labSub2 follows pre-relabel cluster ids; map medoid distance per point.
    for (let i = 0; i < m; i++) distToMedoid[idx[i]] = D[i * m + medoids[labSub2[i]]];
  }
  const order = new Int32Array(nS);
  for (let s = 0; s < nS; s++) order[s] = s;
  const orderArr = Array.from(order).sort((a, b) => {
    const la = labels[a], lb = labels[b];
    const ka = la < 0 ? Infinity : la, kb = lb < 0 ? Infinity : lb;
    if (ka !== kb) return ka - kb;
    const da = distToMedoid[a], db = distToMedoid[b];
    if (da !== db) return da - db;
    return a - b;
  });
  for (let s = 0; s < nS; s++) order[s] = orderArr[s];

  let overall = 0, oc = 0;
  for (let i = 0; i < silFull.length; i++) if (Number.isFinite(silFull[i])) { overall += silFull[i]; oc++; }

  return {
    mode: 'index_aware', k: K,
    labels, sample_group, karyogroup, regime_call,
    mean: feats.mean, het: feats.het,
    margin, silhouette: silFull,
    overall_silhouette: oc > 0 ? overall / oc : NaN,
    groups,
    order,
    n_bins: nBins,
  };
}
