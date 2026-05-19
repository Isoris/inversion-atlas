// shared/uv_rotation.js
//
// UV-rotation primitive: takes per-sample aggregated (PC1, PC2) values,
// runs K-means3 on them, finds the axis from K-means centroid[0] to
// centroid[2], and rotates every sample + centroid into a (u, v) basis
// aligned with that axis. u = along-axis (the "STD/HET/INV gradient");
// v = orthogonal residual.
//
// 2026-05-18 extension: ported the full pipeline from legacy
// (10928-11574) on top of the existing computeUVRotationCore:
//   Phase 1: aggregateWindowRangeForUV
//   Phase 2: computeUVRotationCore (was the only thing here before)
//   L2/slab caches: getOrComputeUVRotation, getOrComputeUVRotationSlab
//   Cluster shape: wrapKmeansResultAsCluster
//   Phase 3 + L2/slab entry: clusterFromRotation_UVRotated +
//                            clusterL2_UVRotated / clusterSlab_UVRotated
// These enable the L3 panel's "uv-rotated" (a.k.a. "distance-uv")
// re-cluster mode. The 4 other UV-* modes (denoise / dbscan /
// dist-rank / dist-fuzzy) still need porting from legacy 11195-11540.
//
// Legacy origin: lines 11035-11075 of legacy/Inversion_atlas.html
// (_computeUVRotationCore).

import { contextFromState } from './per_l2_cluster.js';
import { kmeans2D } from './kmeans.js';

/**
 * Run K-means3 on (xs, ys), find the axis from centroid[0] to
 * centroid[2], rotate everything into (u, v) basis.
 *
 * Phase ordering convention: the caller is expected to have already
 * aggregated per-sample mean PC1 (× sign) and PC2 across a window
 * range. K-means3 partitions those aggregated points into 3 clusters
 * (STD / HET / INV). The "axis" is the line from cluster 0's
 * centroid to cluster 2's centroid; rotation aligns the basis so
 * `u` is along that line and `v` is orthogonal.
 *
 * Returns:
 *   { ok: true, xs, ys, us, vs, angle (degrees),
 *     hom1_x/y, het_x/y, hom2_x/y,       // K-means centroids in (x,y)
 *     hom1_u/v, het_u/v, hom2_u/v,       // K-means centroids in (u,v)
 *     baseLabels: Int8Array,
 *     baseN: number[3],
 *     degenerate: boolean                 // true iff axisLen² ≤ 0
 *   }
 * or { ok: false, reason: 'KMEANS_FAILED' } if K-means returned bad shape.
 *
 * Inputs `xs` / `ys` are Float64Array of length `nS`. `nS` is passed
 * separately so callers using sub-views don't have to slice.
 *
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {number} nS
 * @returns {Object}
 */
export function computeUVRotationCore(xs, ys, nS) {
  const k3 = kmeans2D(xs, ys, 3);
  if (!k3 || !k3.cx || !k3.cy || k3.cx.length !== 3) {
    return { ok: false, reason: 'KMEANS_FAILED' };
  }
  const dx = k3.cx[2] - k3.cx[0];
  const dy = k3.cy[2] - k3.cy[0];
  const axisLen2 = dx * dx + dy * dy;
  const angle = (axisLen2 > 0) ? Math.atan2(dy, dx) : 0;
  const cos_a = Math.cos(angle);
  const sin_a = Math.sin(angle);

  const us = new Float64Array(nS);
  const vs = new Float64Array(nS);
  for (let si = 0; si < nS; si++) {
    const px = xs[si], py = ys[si];
    us[si] =  px * cos_a + py * sin_a;
    vs[si] = -px * sin_a + py * cos_a;
  }

  // Rotate centroids too (cheap; lets distance-to-Het modes skip
  // recomputing).
  const hom1_u =  k3.cx[0] * cos_a + k3.cy[0] * sin_a;
  const hom1_v = -k3.cx[0] * sin_a + k3.cy[0] * cos_a;
  const het_u  =  k3.cx[1] * cos_a + k3.cy[1] * sin_a;
  const het_v  = -k3.cx[1] * sin_a + k3.cy[1] * cos_a;
  const hom2_u =  k3.cx[2] * cos_a + k3.cy[2] * sin_a;
  const hom2_v = -k3.cx[2] * sin_a + k3.cy[2] * cos_a;

  return {
    ok: true,
    xs, ys, us, vs,
    angle: angle * 180 / Math.PI,
    hom1_x: k3.cx[0], hom1_y: k3.cy[0],
    het_x:  k3.cx[1], het_y:  k3.cy[1],
    hom2_x: k3.cx[2], hom2_y: k3.cy[2],
    hom1_u, hom1_v, het_u, het_v, hom2_u, hom2_v,
    baseLabels: k3.labels,
    baseN: k3.n_per_group.slice(),
    degenerate: axisLen2 <= 0,
  };
}

// ---------------------------------------------------------------------
// Phase 1 — per-sample (PC1*sign, PC2) mean across windows [s, e].
//
// Uses MEAN unconditionally regardless of state.aggMethod: the
// rotation math doesn't need the median variant; means are stable
// enough for the principal-axis fit. Slabs keep that convention too
// (legacy 10974-11005).
//
// Legacy: _aggregateWindowRangeForUV (10974-11029).
//
// @param {Object} state — atlas state with .data + .pc1Sign + .flipPC1
// @param {number} s — start window (inclusive)
// @param {number} e — end window (inclusive)
// @returns {{xs: Float64Array, ys: Float64Array} | null}
export function aggregateWindowRangeForUV(state, s, e) {
  if (!state || !state.data) return null;
  const nW = e - s + 1;
  if (nW < 1) return null;
  const nS = state.data.n_samples;
  const ctx = contextFromState(state);
  const xs = new Float64Array(nS);
  const ys = new Float64Array(nS);
  for (let w = 0; w < nW; w++) {
    const { pc1, pc2, sign } = ctx.getPC(s + w);
    for (let si = 0; si < nS; si++) {
      xs[si] += pc1[si] * sign;
      ys[si] += pc2[si];
    }
  }
  for (let si = 0; si < nS; si++) {
    xs[si] /= nW;
    ys[si] /= nW;
  }
  return { xs, ys };
}

// ---------------------------------------------------------------------
// L2 rotation cache. Keyed by l2idx. Data-key invalidates on
// chrom or n_windows change. Legacy: _getOrComputeUVRotation (10928).
// ---------------------------------------------------------------------
export function getOrComputeUVRotation(state, l2idx) {
  if (!state) return { ok: false, reason: 'NO_STATE' };
  if (!state.l2UVRotationCache) state.l2UVRotationCache = new Map();
  const dataKey = state.data ? state.data.chrom + '|' + state.data.n_windows : '';
  if (state._l2UVRotationCacheDataKey !== dataKey) {
    state.l2UVRotationCache = new Map();
    state._l2UVRotationCacheDataKey = dataKey;
  }
  if (state.l2UVRotationCache.has(l2idx)) {
    return state.l2UVRotationCache.get(l2idx);
  }
  const d = state.data;
  if (!d) {
    const fail = { ok: false, reason: 'NO_DATA' };
    state.l2UVRotationCache.set(l2idx, fail);
    return fail;
  }
  const env = d.l2_envelopes && d.l2_envelopes[l2idx];
  if (!env) {
    const fail = { ok: false, reason: 'NO_ENV' };
    state.l2UVRotationCache.set(l2idx, fail);
    return fail;
  }
  const nW = env._e0 - env._s0 + 1;
  if (nW < 1) {
    const fail = { ok: false, reason: 'NO_WINDOWS' };
    state.l2UVRotationCache.set(l2idx, fail);
    return fail;
  }
  const agg = aggregateWindowRangeForUV(state, env._s0, env._e0);
  if (!agg) {
    const fail = { ok: false, reason: 'NO_WINDOWS' };
    state.l2UVRotationCache.set(l2idx, fail);
    return fail;
  }
  const result = computeUVRotationCore(agg.xs, agg.ys, d.n_samples);
  state.l2UVRotationCache.set(l2idx, result);
  return result;
}

// ---------------------------------------------------------------------
// Slab rotation cache. Keyed by `${s}_${e}`; same invalidation as L2.
// Legacy: _getOrComputeUVRotationSlab (10975-11000).
// ---------------------------------------------------------------------
export function getOrComputeUVRotationSlab(state, s, e) {
  if (!state) return { ok: false, reason: 'NO_STATE' };
  if (!state.slabUVRotationCache) state.slabUVRotationCache = new Map();
  const dataKey = state.data ? state.data.chrom + '|' + state.data.n_windows : '';
  if (state._slabUVRotationCacheDataKey !== dataKey) {
    state.slabUVRotationCache = new Map();
    state._slabUVRotationCacheDataKey = dataKey;
  }
  const d = state.data;
  if (!d) return { ok: false, reason: 'NO_DATA' };
  if (s == null || e == null || s < 0 || e >= d.n_windows || s > e) {
    return { ok: false, reason: 'BAD_RANGE' };
  }
  const cacheKey = `${s}_${e}`;
  if (state.slabUVRotationCache.has(cacheKey)) {
    return state.slabUVRotationCache.get(cacheKey);
  }
  const agg = aggregateWindowRangeForUV(state, s, e);
  if (!agg) {
    const fail = { ok: false, reason: 'NO_WINDOWS' };
    state.slabUVRotationCache.set(cacheKey, fail);
    return fail;
  }
  const result = computeUVRotationCore(agg.xs, agg.ys, d.n_samples);
  state.slabUVRotationCache.set(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------
// Cluster-shape adapter. Wraps a kmeans1D/2D result in the shape
// getL2Cluster / getL2ClusterAt consumers expect:
//   { ok, reason, labels, n_per_group,
//     fam_purity, fam_per_cluster,
//     coherence, incoherent, usedK,
//     silhouette, fixedKLabels }
// Family-purity is computed when state.data.samples is available.
// Legacy: _wrapKmeansResultAsCluster (11576-11626).
// ---------------------------------------------------------------------
export function wrapKmeansResultAsCluster(state, result, K, reasonOverride) {
  if (!state || !result) {
    return { ok: false, reason: reasonOverride || 'NO_RESULT' };
  }
  const d = state.data;
  const minNGroup = (state.minNGroup | 0) || 5;
  const ok = result.n_per_group.every(c => c >= minNGroup);
  const reason = reasonOverride
    ? reasonOverride
    : (ok ? null : 'LOW_GROUP_N');

  let fam_purity = NaN;
  let fam_per_cluster = null;
  if (d && d.samples && d.samples.length === d.n_samples) {
    const famIds = d.samples.map(s => (s && s.family_id != null) ? s.family_id : -1);
    const sumByCluster = new Array(K).fill(0);
    const totalByCluster = new Array(K).fill(0);
    fam_per_cluster = new Array(K).fill(null);
    for (let k = 0; k < K; k++) {
      const counts = new Map();
      for (let si = 0; si < d.n_samples; si++) {
        if (result.labels[si] !== k) continue;
        const fid = famIds[si];
        counts.set(fid, (counts.get(fid) || 0) + 1);
        totalByCluster[k]++;
      }
      let maxCount = 0, maxFid = -1;
      counts.forEach((cnt, fid) => {
        if (cnt > maxCount) { maxCount = cnt; maxFid = fid; }
      });
      sumByCluster[k] = maxCount;
      fam_per_cluster[k] = { dom_fid: maxFid, dom_n: maxCount, total: totalByCluster[k] };
    }
    const grandTotal = totalByCluster.reduce((a, b) => a + b, 0);
    const grandDom = sumByCluster.reduce((a, b) => a + b, 0);
    fam_purity = grandTotal > 0 ? grandDom / grandTotal : NaN;
  }

  return {
    ok, reason,
    labels: result.labels,
    n_per_group: result.n_per_group,
    fam_purity,
    fam_per_cluster,
    coherence: NaN,
    incoherent: false,
    usedK: K,
    silhouette: null,
    fixedKLabels: result.labels,
  };
}

// ---------------------------------------------------------------------
// Phase 3 (post-rotation) for uv-rotated mode. Takes a rotation
// result; runs kmeans2D on (us, vs) for the final 3-cluster partition.
// Legacy: _clusterFromRotation_UVRotated (11560-11574).
// ---------------------------------------------------------------------
export function clusterFromRotation_UVRotated(state, rot) {
  if (!rot || !rot.ok) {
    return { ok: false, reason: rot ? rot.reason : 'NO_ROT' };
  }
  if (rot.degenerate) {
    // All centroids coincide — fall back to the K-means3 base partition.
    return wrapKmeansResultAsCluster(
      state,
      { labels: rot.baseLabels, n_per_group: rot.baseN },
      3, 'UVRotated-degenerate-fallback'
    );
  }
  const result = kmeans2D(rot.us, rot.vs, 3);
  return wrapKmeansResultAsCluster(state, result, 3, null);
}

// ---------------------------------------------------------------------
// L2 + slab entries for the uv-rotated mode.
// Legacy: clusterL2_UVRotated (11549-11553), clusterSlab_UVRotated (11555-11558).
// ---------------------------------------------------------------------
export function clusterL2_UVRotated(state, l2idx) {
  return clusterFromRotation_UVRotated(state, getOrComputeUVRotation(state, l2idx));
}

export function clusterSlab_UVRotated(state, s, e) {
  return clusterFromRotation_UVRotated(state, getOrComputeUVRotationSlab(state, s, e));
}

if (typeof window !== 'undefined') {
  window._aggregateWindowRangeForUV   = aggregateWindowRangeForUV;
  window._computeUVRotationCore       = computeUVRotationCore;
  window._wrapKmeansResultAsCluster   = (result, K, reasonOverride) =>
    wrapKmeansResultAsCluster(window.state, result, K, reasonOverride);
}
