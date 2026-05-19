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

// =====================================================================
// DBSCAN primitive — pure JS, O(N²) naive (fine for N=226).
// Legacy: _dbscan (11094-11148). Mirrors STEP22's R dbscan::dbscan
// call-site. `points` is either Float64Array (1D) or
// { dim:D, data:Float64Array of length N*D, n:N } for D-dimensional.
// Returns: Int32Array of cluster labels in [0, n_clusters], where
// 0 = NOISE (R convention).
// =====================================================================
export function dbscan(pointsObj, eps, minPts) {
  const isFlat = ArrayBuffer.isView(pointsObj);
  const dim = isFlat ? 1 : pointsObj.dim;
  const data = isFlat ? pointsObj : pointsObj.data;
  const n = isFlat ? pointsObj.length : pointsObj.n;
  const eps2 = eps * eps;

  function dist2(i, j) {
    if (dim === 1) {
      const d = data[i] - data[j];
      return d * d;
    }
    let s = 0;
    for (let k = 0; k < dim; k++) {
      const d = data[i * dim + k] - data[j * dim + k];
      s += d * d;
    }
    return s;
  }
  function neighbors(i) {
    const out = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && dist2(i, j) <= eps2) out.push(j);
    }
    return out;
  }

  const labels = new Int32Array(n);   // 0 = unvisited; -1 = noise; ≥1 = cluster
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== 0) continue;
    const nb = neighbors(i);
    if (nb.length < minPts - 1) {
      labels[i] = -1;
      continue;
    }
    cid++;
    labels[i] = cid;
    const queue = nb.slice();
    while (queue.length > 0) {
      const j = queue.shift();
      if (labels[j] === -1) labels[j] = cid;
      if (labels[j] !== 0) continue;
      labels[j] = cid;
      const nb2 = neighbors(j);
      if (nb2.length >= minPts - 1) {
        for (const k of nb2) if (labels[k] === 0) queue.push(k);
      }
    }
  }
  // R dbscan convention: 0 = noise
  for (let i = 0; i < n; i++) if (labels[i] === -1) labels[i] = 0;
  return labels;
}

// k-distance auto-eps (STEP22): eps = median(k-NN distance) × 0.8.
// Legacy: _kDistAutoEps (11153-11188). Returns NaN if data is degenerate.
export function kDistAutoEps(pointsObj, k) {
  const isFlat = ArrayBuffer.isView(pointsObj);
  const dim = isFlat ? 1 : pointsObj.dim;
  const data = isFlat ? pointsObj : pointsObj.data;
  const n = isFlat ? pointsObj.length : pointsObj.n;
  if (n < 2) return NaN;
  const k_actual = Math.min(k, n - 1);
  const knnDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d2s = new Float64Array(n - 1);
    let p = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let s = 0;
      if (dim === 1) {
        const d = data[i] - data[j]; s = d * d;
      } else {
        for (let kk = 0; kk < dim; kk++) {
          const d = data[i * dim + kk] - data[j * dim + kk];
          s += d * d;
        }
      }
      d2s[p++] = s;
    }
    const sorted = Array.from(d2s).sort((a, b) => a - b);
    knnDists[i] = Math.sqrt(sorted[k_actual - 1]);
  }
  const finite = Array.from(knnDists).filter(v => isFinite(v));
  if (finite.length === 0) return NaN;
  finite.sort((a, b) => a - b);
  const median = finite.length % 2 === 1
    ? finite[(finite.length - 1) >> 1]
    : 0.5 * (finite[finite.length / 2 - 1] + finite[finite.length / 2]);
  return median * 0.8;
}

// =====================================================================
// uv-denoise — DBSCAN pre-filter + K-means3 on survivors.
// Legacy: _clusterFromRotation_UVDenoise (11220-11281).
// =====================================================================
export function clusterFromRotation_UVDenoise(state, rot) {
  if (!rot || !rot.ok) return { ok: false, reason: rot ? rot.reason : 'NO_ROT' };
  const nS = rot.us.length;

  const pts = new Float64Array(nS * 2);
  for (let i = 0; i < nS; i++) { pts[i * 2] = rot.us[i]; pts[i * 2 + 1] = rot.vs[i]; }
  const ptsObj = { dim: 2, data: pts, n: nS };

  const eps = kDistAutoEps(ptsObj, 5);
  if (!isFinite(eps) || eps <= 0) {
    const result = kmeans2D(rot.us, rot.vs, 3);
    return wrapKmeansResultAsCluster(state, result, 3, 'UVDenoise-fallback-no-eps');
  }
  const minPts = Math.max(3, Math.floor(nS * 0.08));
  const dbLabels = dbscan(ptsObj, eps, minPts);

  const nonNoiseIdx = [];
  for (let i = 0; i < nS; i++) if (dbLabels[i] !== 0) nonNoiseIdx.push(i);
  if (nonNoiseIdx.length < 9) {
    const result = kmeans2D(rot.us, rot.vs, 3);
    return wrapKmeansResultAsCluster(state, result, 3, 'UVDenoise-fallback-too-few-survivors');
  }
  const sub_us = new Float64Array(nonNoiseIdx.length);
  const sub_vs = new Float64Array(nonNoiseIdx.length);
  for (let i = 0; i < nonNoiseIdx.length; i++) {
    sub_us[i] = rot.us[nonNoiseIdx[i]];
    sub_vs[i] = rot.vs[nonNoiseIdx[i]];
  }
  const k3sub = kmeans2D(sub_us, sub_vs, 3);

  const labels = new Int8Array(nS);
  const npg = new Array(3).fill(0);
  for (let i = 0; i < nonNoiseIdx.length; i++) {
    const idx = nonNoiseIdx[i];
    labels[idx] = k3sub.labels[i];
    npg[k3sub.labels[i]]++;
  }
  for (let i = 0; i < nS; i++) {
    if (dbLabels[i] === 0) {
      // Noise — assign to nearest centroid in (u, v).
      let best = 0, bd = Infinity;
      for (let j = 0; j < 3; j++) {
        const dux = rot.us[i] - k3sub.cx[j], dvy = rot.vs[i] - k3sub.cy[j];
        const dd = dux * dux + dvy * dvy;
        if (dd < bd) { bd = dd; best = j; }
      }
      labels[i] = best;
      npg[best]++;
    }
  }
  return wrapKmeansResultAsCluster(state, { labels, n_per_group: npg }, 3, null);
}

export function clusterL2_UVDenoise(state, l2idx) {
  return clusterFromRotation_UVDenoise(state, getOrComputeUVRotation(state, l2idx));
}
export function clusterSlab_UVDenoise(state, s, e) {
  return clusterFromRotation_UVDenoise(state, getOrComputeUVRotationSlab(state, s, e));
}

// =====================================================================
// uv-dbscan — K-means3 first, then DBSCAN within each stripe on v values.
// Legacy: _clusterFromRotation_UVDBSCAN (11316-11383).
// Samples in the dominant subcluster keep the stripe label; samples in
// minority subclusters or noise get reassigned to the 2nd-closest
// stripe — visible as off-diagonal mass in the contingency.
// =====================================================================
export function clusterFromRotation_UVDBSCAN(state, rot) {
  if (!rot || !rot.ok) return { ok: false, reason: rot ? rot.reason : 'NO_ROT' };
  const nS = rot.us.length;
  const k3uv = kmeans2D(rot.us, rot.vs, 3);
  if (!k3uv || !k3uv.labels) return { ok: false, reason: 'KMEANS_FAILED' };

  const labels = new Int8Array(nS);
  const npg = [0, 0, 0];
  for (let g = 0; g < 3; g++) {
    const idx = [];
    for (let i = 0; i < nS; i++) if (k3uv.labels[i] === g) idx.push(i);
    const ng = idx.length;
    if (ng < 3) {
      for (const i of idx) { labels[i] = g; npg[g]++; }
      continue;
    }
    const v_vals = new Float64Array(ng);
    for (let i = 0; i < ng; i++) v_vals[i] = rot.vs[idx[i]];

    const eps = kDistAutoEps(v_vals, Math.min(5, ng - 1));
    if (!isFinite(eps) || eps <= 0) {
      for (const i of idx) { labels[i] = g; npg[g]++; }
      continue;
    }
    const minPts = Math.max(3, Math.floor(ng * 0.08));
    const dbLabels = dbscan(v_vals, eps, minPts);

    const counts = new Map();
    for (let i = 0; i < ng; i++) {
      if (dbLabels[i] === 0) continue;
      counts.set(dbLabels[i], (counts.get(dbLabels[i]) || 0) + 1);
    }
    let domSub = -1, domCount = 0;
    counts.forEach((cnt, sub) => { if (cnt > domCount) { domCount = cnt; domSub = sub; } });

    for (let i = 0; i < ng; i++) {
      const orig_i = idx[i];
      if (dbLabels[i] === domSub) {
        labels[orig_i] = g;
        npg[g]++;
      } else {
        // Alternative-best stripe (second-closest centroid in u,v).
        let bestAlt = (g + 1) % 3, bd = Infinity;
        for (let j = 0; j < 3; j++) {
          if (j === g) continue;
          const dux = rot.us[orig_i] - k3uv.cx[j], dvy = rot.vs[orig_i] - k3uv.cy[j];
          const dd = dux * dux + dvy * dvy;
          if (dd < bd) { bd = dd; bestAlt = j; }
        }
        labels[orig_i] = bestAlt;
        npg[bestAlt]++;
      }
    }
  }
  return wrapKmeansResultAsCluster(state, { labels, n_per_group: npg }, 3, null);
}

export function clusterL2_UVDBSCAN(state, l2idx) {
  return clusterFromRotation_UVDBSCAN(state, getOrComputeUVRotation(state, l2idx));
}
export function clusterSlab_UVDBSCAN(state, s, e) {
  return clusterFromRotation_UVDBSCAN(state, getOrComputeUVRotationSlab(state, s, e));
}

// =====================================================================
// uv-dist-rank — distance-to-Het ranked into terciles per stripe.
// Closest tercile of each Hom stripe → relabeled as Het (1). Reveals
// drift toward Het in the contingency.
// Legacy: _clusterFromRotation_UVDistRank (11423-11460).
// =====================================================================
export function clusterFromRotation_UVDistRank(state, rot) {
  if (!rot || !rot.ok) return { ok: false, reason: rot ? rot.reason : 'NO_ROT' };
  const nS = rot.us.length;
  const k3uv = kmeans2D(rot.us, rot.vs, 3);
  if (!k3uv || !k3uv.labels) return { ok: false, reason: 'KMEANS_FAILED' };

  const distToHet = new Float64Array(nS);
  for (let i = 0; i < nS; i++) {
    const du = rot.us[i] - rot.het_u, dv = rot.vs[i] - rot.het_v;
    distToHet[i] = Math.sqrt(du * du + dv * dv);
  }

  const labels = new Int8Array(nS);
  const npg = [0, 0, 0];
  for (let g = 0; g < 3; g++) {
    const idx = [];
    for (let i = 0; i < nS; i++) if (k3uv.labels[i] === g) idx.push(i);
    if (g === 1) {
      for (const i of idx) { labels[i] = 1; npg[1]++; }
      continue;
    }
    if (idx.length === 0) continue;
    idx.sort((a, b) => distToHet[a] - distToHet[b]);
    const tercile = Math.floor(idx.length / 3);
    for (let i = 0; i < tercile; i++) { labels[idx[i]] = 1; npg[1]++; }
    for (let i = tercile; i < idx.length; i++) { labels[idx[i]] = g; npg[g]++; }
  }
  return wrapKmeansResultAsCluster(state, { labels, n_per_group: npg }, 3, null);
}

export function clusterL2_UVDistRank(state, l2idx) {
  return clusterFromRotation_UVDistRank(state, getOrComputeUVRotation(state, l2idx));
}
export function clusterSlab_UVDistRank(state, s, e) {
  return clusterFromRotation_UVDistRank(state, getOrComputeUVRotationSlab(state, s, e));
}

// =====================================================================
// uv-dist-fuzzy — soft inverse-distance weights; tie-break < 0.45 →
// reassign to second-best. Reveals K-means-ambiguous samples in the
// contingency. Legacy: _clusterFromRotation_UVDistFuzzy (11495-11533).
// =====================================================================
export function clusterFromRotation_UVDistFuzzy(state, rot) {
  if (!rot || !rot.ok) return { ok: false, reason: rot ? rot.reason : 'NO_ROT' };
  const nS = rot.us.length;
  const eps_inv = 1e-9;
  const cx = [rot.hom1_u, rot.het_u, rot.hom2_u];
  const cy = [rot.hom1_v, rot.het_v, rot.hom2_v];

  const labels = new Int8Array(nS);
  const npg = [0, 0, 0];
  for (let i = 0; i < nS; i++) {
    const dists = [0, 0, 0];
    let invSum = 0;
    for (let j = 0; j < 3; j++) {
      const du = rot.us[i] - cx[j], dv = rot.vs[i] - cy[j];
      dists[j] = Math.sqrt(du * du + dv * dv);
      invSum += 1 / (dists[j] + eps_inv);
    }
    const w = [
      (1 / (dists[0] + eps_inv)) / invSum,
      (1 / (dists[1] + eps_inv)) / invSum,
      (1 / (dists[2] + eps_inv)) / invSum,
    ];
    let best = 0;
    if (w[1] > w[best]) best = 1;
    if (w[2] > w[best]) best = 2;
    if (w[best] < 0.45) {
      let second = (best + 1) % 3;
      if (w[(best + 2) % 3] > w[second]) second = (best + 2) % 3;
      best = second;
    }
    labels[i] = best;
    npg[best]++;
  }
  return wrapKmeansResultAsCluster(state, { labels, n_per_group: npg }, 3, null);
}

export function clusterL2_UVDistFuzzy(state, l2idx) {
  return clusterFromRotation_UVDistFuzzy(state, getOrComputeUVRotation(state, l2idx));
}
export function clusterSlab_UVDistFuzzy(state, s, e) {
  return clusterFromRotation_UVDistFuzzy(state, getOrComputeUVRotationSlab(state, s, e));
}

if (typeof window !== 'undefined') {
  window._aggregateWindowRangeForUV   = aggregateWindowRangeForUV;
  window._computeUVRotationCore       = computeUVRotationCore;
  window._wrapKmeansResultAsCluster   = (result, K, reasonOverride) =>
    wrapKmeansResultAsCluster(window.state, result, K, reasonOverride);
  window._dbscan                      = dbscan;
  window._kDistAutoEps                = kDistAutoEps;
}
