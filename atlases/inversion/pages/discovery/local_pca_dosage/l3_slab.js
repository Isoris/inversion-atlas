// pages/discovery/local_pca_dosage/l3_slab.js
//
// Slab-clustering helpers for the L3 panel — verbatim port of legacy
// aggregateSlab + clusterSlabAtK + getSlabClusterAt (legacy lines
// 11822-11948).
//
// 2026-05-15: ported because the slab-comparison paths in
// `renderL3PanelSlab` (when state.compareUnit ∈ {win1, win5, win10, winN})
// call `getSlabClusterAt(...)` and `clusterSlabAtK(...)` as if global.
// In the modular tree neither was defined → every slab render in K=6
// or multi-K mode threw ReferenceError silently. User-visible
// symptom: "recluster K3/K6 kind of works ? but k6 I'm not sure so
// much" (chat 2026-05-15). Behaviour is bit-for-bit identical to
// legacy; the only difference is one extra field on the cluster
// result — `silhouette` is now computed (legacy left it null).
//
// Public entries (in legacy call-site order):
//   aggregateSlab(state, s, e) → { xs, ys, nW, s, e }
//   clusterSlabAtK(state, s, e, K) → { ok, labels, n_per_group,
//                                       centers, centers_y, nW, s, e,
//                                       silhouette, fixedKLabels,
//                                       isSlab: true, ... }
//   getSlabClusterAt(state, s, e, K) → memoized clusterSlabAtK
//
// Migration note (legacy → modular signature):
//   - legacy reads bare `state`; this module takes state as 1st arg
//   - legacy's `getPC(w)` global is replaced by the equivalent path
//     through ctx-from-state (`contextFromState(state).getPC(w)`)
//     because no per-window PC getter is exposed on `state` directly
//   - legacy's family-purity block was a copy of clusterL2AtK's
//     family-purity. Preserved verbatim except for the state.data
//     access pattern.

import { contextFromState } from '../../../shared/per_l2_cluster.js';
import { kmeans1D, kmeans2D, silhouette1D, silhouette2D } from '../../../shared/kmeans.js';

/**
 * Mean / median PC1 + mean PC2 across [s, e] windows for each sample.
 * Honours state.aggMethod (median_pc1 / mean_pc12 / default mean_pc1).
 * Returns null when there's no data or the slab is empty.
 *
 * Verbatim from legacy/Inversion_atlas.html lines 11822-11858 with the
 * sole change: takes state as explicit arg (no global state) and uses
 * contextFromState(state).getPC(w) for per-window PC access.
 *
 * @param {Object} state
 * @param {number} s — start window index (inclusive)
 * @param {number} e — end window index (inclusive)
 * @returns {{xs: Float64Array, ys: Float64Array|null, nW: number, s: number, e: number}|null}
 */
export function aggregateSlab(state, s, e) {
  const d = state && state.data;
  if (!d) return null;
  const nS = d.n_samples;
  const nW = e - s + 1;
  if (nW <= 0) return null;

  const ctx = contextFromState(state);
  const xs = new Float64Array(nS);
  const ys = state.aggMethod === 'mean_pc12' ? new Float64Array(nS) : null;

  if (state.aggMethod === 'median_pc1') {
    const tmp = new Float64Array(nW);
    for (let si = 0; si < nS; si++) {
      for (let w = 0; w < nW; w++) {
        const { pc1, sign } = ctx.getPC(s + w);
        tmp[w] = pc1[si] * sign;
      }
      const sorted = Array.from(tmp).sort((a, b) => a - b);
      xs[si] = sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) >> 1]
        : 0.5 * (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]);
    }
  } else {
    for (let w = 0; w < nW; w++) {
      const { pc1, pc2, sign } = ctx.getPC(s + w);
      for (let si = 0; si < nS; si++) {
        xs[si] += pc1[si] * sign;
        if (ys) ys[si] += pc2[si];
      }
    }
    for (let si = 0; si < nS; si++) {
      xs[si] /= nW;
      if (ys) ys[si] /= nW;
    }
  }
  return { xs, ys, nW, s, e };
}

/**
 * Cluster a slab at a specific K (always fixed-K — slabs ignore
 * adaptive K-mode). Verbatim port of legacy clusterSlabAtK with one
 * addition: silhouette is now computed from `agg.xs` + `result.labels`
 * via `silhouette1D` (was hard-coded null in legacy line 11930).
 *
 * @param {Object} state
 * @param {number} s
 * @param {number} e
 * @param {number} K
 * @returns {Object}
 */
export function clusterSlabAtK(state, s, e, K) {
  const d = state && state.data;
  if (!d) return { ok: false, reason: 'NO_DATA' };
  const nW = e - s + 1;
  if (nW < 1) return { ok: false, reason: 'NO_WINDOWS' };
  const agg = aggregateSlab(state, s, e);
  if (!agg) return { ok: false, reason: 'NO_WINDOWS' };

  let result;
  if (state.aggMethod === 'mean_pc12') {
    result = kmeans2D(agg.xs, agg.ys, K);
  } else {
    result = kmeans1D(agg.xs, K);
  }

  // Lower minimum thresholds for slabs because slabs are intentionally
  // small. L2 minimum is state.minNWin (typically 5). Slabs of size 1
  // are allowed. We do still check minNGroup on the K-means result so
  // K-means failure is surfaced as ok=false.
  const minNGroup = Math.max(2, (state.minNGroup | 0));
  const ok = result.n_per_group.every(c => c >= minNGroup);
  const reason = ok ? null : 'LOW_GROUP_N';

  // 2026-05-18: compute silhouette honouring state.silScoreOn. Default
  // is 'pc1' even in 2-D fits, because the inversion signal is
  // primarily 1-D and PC1-only silhouette is the cleaner K-quality
  // indicator. 'same_as_fit' scores on (PC1, PC2) when fit is 2-D.
  let silhouette = null;
  try {
    if (K >= 2 && result.labels && agg.xs && agg.xs.length >= 4) {
      const fit2D = state.aggMethod === 'mean_pc12' && agg.ys;
      const scoreOn2D = fit2D && state.silScoreOn === 'same_as_fit';
      const xsKept = [], ysKept = [], labsKept = [];
      for (let i = 0; i < result.labels.length; i++) {
        const lab = result.labels[i];
        const xOK = Number.isFinite(agg.xs[i]);
        const yOK = !scoreOn2D || Number.isFinite(agg.ys[i]);
        if (lab >= 0 && lab < K && xOK && yOK) {
          xsKept.push(agg.xs[i]);
          if (scoreOn2D) ysKept.push(agg.ys[i]);
          labsKept.push(lab);
        }
      }
      if (xsKept.length >= 4) {
        const sil = scoreOn2D
          ? silhouette2D(xsKept, ysKept, labsKept, K)
          : silhouette1D(xsKept, labsKept, K);
        if (Number.isFinite(sil)) silhouette = sil;
      }
    }
  } catch (_) { /* silhouette is opt-in; never break the cluster */ }

  // Family purity — verbatim from legacy. Falls through when no
  // family metadata is present.
  let fam_purity = NaN;
  let fam_per_cluster = null;
  if (d.samples && d.samples.length === d.n_samples) {
    const famIds = d.samples.map(s2 => (s2 && s2.family_id != null) ? s2.family_id : -1);
    const sumByCluster = new Array(K).fill(0);
    const totalByCluster = new Array(K).fill(0);
    fam_per_cluster = new Array(K).fill(null);
    for (let k = 0; k < K; k++) {
      const counts = new Map();
      for (let i = 0; i < result.labels.length; i++) {
        if (result.labels[i] !== k) continue;
        totalByCluster[k]++;
        const fid = famIds[i];
        if (fid !== -1) counts.set(fid, (counts.get(fid) || 0) + 1);
      }
      let bestN = 0, bestF = null;
      for (const [f, c] of counts) if (c > bestN) { bestN = c; bestF = f; }
      const matched = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      const purity_k = matched > 0 ? bestN / matched : NaN;
      fam_per_cluster[k] = {
        fid: bestF, n: bestN,
        top_family: bestF, top_count: bestN,
        total: totalByCluster[k], purity: purity_k,
      };
      sumByCluster[k] = isFinite(purity_k) ? purity_k * totalByCluster[k] : 0;
    }
    const totalAll = totalByCluster.reduce((a, b) => a + b, 0);
    if (totalAll > 0) {
      fam_purity = sumByCluster.reduce((a, b) => a + b, 0) / totalAll;
    }
  }

  return {
    labels: result.labels,
    n_per_group: result.n_per_group,
    centers: result.centers || result.cx,
    centers_y: result.cy || null,
    nW,
    s, e,                           // slab range (kept for diagnostics)
    n_below_threshold: false,       // slabs are always intentionally short
    ok,
    reason,
    fam_purity,
    fam_per_cluster,
    coherence: NaN,
    incoherent: false,
    usedK: K,
    silhouette,                     // 2026-05-15: was hard-null in legacy
    fixedKLabels: result.labels,
    isSlab: true,                   // identifies slab-not-L2 to consumers
  };
}

/**
 * Memoized clusterSlabAtK using a state-scoped Map. Cache is keyed by
 * (s, e, K); invalidated when the active chromosome changes (the
 * dataKey tracks `chrom|n_windows`).
 *
 * Verbatim from legacy/Inversion_atlas.html lines 11936-11948.
 *
 * @param {Object} state
 * @param {number} s
 * @param {number} e
 * @param {number} K
 * @returns {Object}
 */
export function getSlabClusterAt(state, s, e, K) {
  if (!state.slabGroupCache) state.slabGroupCache = new Map();
  const dataKey = state.data ? state.data.chrom + '|' + state.data.n_windows : '';
  if (state._slabGroupCacheDataKey !== dataKey) {
    state.slabGroupCache = new Map();
    state._slabGroupCacheDataKey = dataKey;
  }
  const k = `${s}_${e}_${K}`;
  if (state.slabGroupCache.has(k)) return state.slabGroupCache.get(k);
  const r = clusterSlabAtK(state, s, e, K);
  state.slabGroupCache.set(k, r);
  return r;
}
