// pages/discovery/haplotype_regimes/pipeline_ctx.js
//
// Pipeline-ctx wiring (2026-05-27 Part C extraction).
//
// Wire the per-window K-means cache + band_quality cache + L2
// envelope mapping + the canonical pipeline-ctx accessors that the
// V-walker, het-skeleton, and short-range builders all read through.
// This is the "load-bearing" setup the band_tracking pipeline
// depends on:
//
//   - state._regimesPerWinLabels      Array<Int32Array | null>
//   - state._regimesPerWinK           Int8Array
//   - state._regimesPerWinProvenance  { n_windows, n_computed, n_skipped }
//   - state._regimesClusterCache      ClusterCache (kept for the L3
//                                      pairs table; the pipeline no
//                                      longer routes through L2)
//   - state._regimesClusterCtx        contextFromState(state)
//   - state._regimesBandQualityCache  Float32Array
//   - state._regimesBandQualityProvenance
//   - state._regimesGetBpFor          (w) → bp midpoint of window w
//   - state._regimesCtx               {
//       chromosomes, getLabels, getK, getBandQuality, getL2Idx,
//       isWindowValid, n_samples, getBpFor
//     }
//   - state._regimesGetPC1            (w) → raw pc1 vector
//   - state.windowToL2                Int32Array
//
// The pipeline reads from these — see band_tracking/index.js for
// the contract.

import { contextFromState, ClusterCache } from '../../../shared/per_l2_cluster.js';
import { kmeans1D, adaptiveK1D } from '../../../shared/kmeans.js';
import { bandQualityForWindow } from '../../../shared/band_tracking/band_quality.js';

/**
 * Wire the regimes pipeline ctx + per-window caches onto `state`.
 * Idempotent in the sense that it overwrites previous values when
 * data swaps; callers should call this exactly once per
 * (chrom, mount) pair.
 *
 * @param {Object} state       legacy state (mutated)
 * @param {Object} atlasState  atlas-core shared bucket (unused here
 *                             — kept for symmetry; the regimes page
 *                             does not currently need cross-atlas
 *                             reads at ctx-wire time)
 */
export function wireCtxCallbacks(state, atlasState) {
  const data = state.data;
  const N = data.n_windows;

  // ---------------------------------------------------------------------
  // Clustering knobs (per state, shared with downstream consumers).
  // ---------------------------------------------------------------------
  state.k            = state.k            != null ? state.k            : 3;
  state.aggMethod    = state.aggMethod    || 'mean_pc1';
  state.kMode        = state.kMode        || 'adaptive';
  state.kRange       = state.kRange       || [2, 6];
  state.silThreshold = state.silThreshold != null ? state.silThreshold : 0.5;
  state.minNGroup    = state.minNGroup    != null ? state.minNGroup    : 5;
  state.minNWin      = state.minNWin      != null ? state.minNWin      : 5;

  // ---------------------------------------------------------------------
  // PER-WINDOW K-means cache (the load-bearing change).
  //
  // The band_tracking/index.js header is explicit:
  //   "per-window K-means labels via getLabels/getK callbacks,
  //    NEVER L2-broadcast — same per-window upgrade noted in
  //    anchor_signals.js header"
  //
  // Previously we routed through per_l2_cluster.clusterL2 which returned
  // the same labels for every window inside one L2 envelope → adjacent-
  // window contingencies were trivially 1.0 → V-walker found nothing.
  // Now: kmeans1D (or adaptiveK1D) per window directly from
  // data.windows[w].pc1. ~226 samples × ~10k windows × adaptive K=2-6 is
  // ~1-2 seconds total on real data.
  // ---------------------------------------------------------------------
  const perWinLabels = new Array(N);
  const perWinK      = new Int8Array(N);
  const kRangeLo = (state.kRange && state.kRange[0]) || 2;
  const kRangeHi = (state.kRange && state.kRange[1]) || 6;
  const useAdaptiveK = state.kMode === 'adaptive';
  const fixedK = state.k;
  let perWinComputed = 0;
  let perWinSkipped  = 0;
  for (let w = 0; w < N; w++) {
    const win = data.windows && data.windows[w];
    if (!win || !win.pc1 || win.pc1.length === 0) {
      perWinLabels[w] = null;
      perWinK[w] = 0;
      perWinSkipped++;
      continue;
    }
    let labels, K;
    if (useAdaptiveK) {
      const ak = adaptiveK1D(win.pc1, kRangeLo, kRangeHi,
                             state.silThreshold, state.minNGroup);
      if (ak != null) {
        labels = ak.labels;
        K = ak.k;
      } else {
        const fit = kmeans1D(win.pc1, kRangeLo);
        labels = fit.labels;
        K = kRangeLo;
      }
    } else {
      const fit = kmeans1D(win.pc1, fixedK);
      labels = fit.labels;
      K = fixedK;
    }
    perWinLabels[w] = labels;
    perWinK[w] = K;
    perWinComputed++;
  }
  state._regimesPerWinLabels = perWinLabels;
  state._regimesPerWinK      = perWinK;
  state._regimesPerWinProvenance = {
    n_windows:  N,
    n_computed: perWinComputed,
    n_skipped:  perWinSkipped,
  };

  // ---------------------------------------------------------------------
  // L2-cluster cache: KEPT for backwards compat with the L3 pairs table
  // (l3_pairs_table.js reads it). The PIPELINE no longer routes through it.
  // ---------------------------------------------------------------------
  const windowToL2 = new Int32Array(N).fill(-1);
  if (Array.isArray(data.l2_envelopes) && data.l2_envelopes.length > 0) {
    data.l2_envelopes.forEach((env, i) => {
      const s0 = env.start_w - 1, e0 = env.end_w - 1;
      env._s0 = env._s0 != null ? env._s0 : s0;
      env._e0 = env._e0 != null ? env._e0 : e0;
      for (let w = Math.max(0, s0); w <= Math.min(N - 1, e0); w++) {
        windowToL2[w] = i;
      }
    });
  }
  state.windowToL2 = windowToL2;
  const clCtx = contextFromState(state);
  const clCache = new ClusterCache();
  state._regimesClusterCache = clCache;
  state._regimesClusterCtx   = clCtx;

  // ---------------------------------------------------------------------
  // Per-window getLabels / getK callbacks — read from the per-window
  // K-means cache, NOT the L2 cluster cache.
  // ---------------------------------------------------------------------
  const labelsForWindow = (w) => (w >= 0 && w < N) ? perWinLabels[w] : null;
  const KForWindow      = (w) => (w >= 0 && w < N) ? (perWinK[w] | 0) : 0;

  // ---------------------------------------------------------------------
  // band_quality cache — computed against PER-WINDOW labels (not
  // L2-broadcast). Producer-shipped band_quality on the window still
  // wins when present.
  // ---------------------------------------------------------------------
  const bqCache = new Float32Array(N);
  let bqProducerCount = 0;
  let bqComputedCount = 0;
  let bqZeroCount     = 0;
  for (let w = 0; w < N; w++) {
    const win = data.windows && data.windows[w];
    if (!win) { bqCache[w] = 0; bqZeroCount++; continue; }
    const shipped = (win.band_quality != null) ? win.band_quality
                  : (win.bq           != null) ? win.bq
                  : null;
    if (shipped != null && Number.isFinite(+shipped)) {
      bqCache[w] = +shipped;
      bqProducerCount++;
      continue;
    }
    const labels = perWinLabels[w];
    const K      = perWinK[w] | 0;
    if (!labels || K < 2 || !win.pc1) { bqCache[w] = 0; bqZeroCount++; continue; }
    const r = bandQualityForWindow({
      pc1:    win.pc1,
      labels,
      K,
      eig1:   Number.isFinite(win.lam1) ? win.lam1 : 0,
      eig2:   Number.isFinite(win.lam2) ? win.lam2 : 0,
    });
    bqCache[w] = Number.isFinite(r.band_quality) ? r.band_quality : 0;
    bqComputedCount++;
  }
  state._regimesBandQualityCache = bqCache;
  state._regimesBandQualityProvenance = {
    n_windows:    N,
    n_from_producer: bqProducerCount,
    n_computed:   bqComputedCount,
    n_zero:       bqZeroCount,
  };

  const bandQualityForWindow_cb = (w) =>
    (w >= 0 && w < N) ? (bqCache[w] || 0) : 0;

  // ---------------------------------------------------------------------
  // bp accessor — needed by het_define_interval. Returns center_bp when
  // available, falling back to mid-window if only start_bp/end_bp are
  // shipped, else null.
  // ---------------------------------------------------------------------
  const getBpFor = (w) => {
    const win = data.windows && data.windows[w];
    if (!win) return null;
    if (Number.isFinite(win.center_bp)) return win.center_bp;
    if (Number.isFinite(win.center_mb)) return win.center_mb * 1e6;
    if (Number.isFinite(win.start_bp) && Number.isFinite(win.end_bp)) {
      return (win.start_bp + win.end_bp) / 2;
    }
    return null;
  };
  state._regimesGetBpFor = getBpFor;

  // ---------------------------------------------------------------------
  // Pipeline ctx. getL2Idx stubbed to 0 per STAGE_B_v3_NOTES §2 — the
  // chain walk's L2-hard-stop branch is unreachable in classifier mode
  // anyway; this just makes that explicit.
  // ---------------------------------------------------------------------
  state._regimesCtx = {
    chromosomes: [{ s_window: 0, e_window: N - 1, name: state.activeChrom }],
    getLabels:      labelsForWindow,
    getK:           KForWindow,
    getBandQuality: bandQualityForWindow_cb,
    getL2Idx:       (_w) => 0,
    isWindowValid:  (w) => KForWindow(w) >= 2,
    n_samples:      data.n_samples,
    getBpFor,
  };

  // PC1 accessor for the regimes_pc1_panel. Apply the per-window
  // sign-flip from state.pc1Sign so this panel matches the per-sample
  // lines panel on local_pca_dosage (which routes PC1 through
  // getPCRender — see shared/pc_accessors.js). Without this, windows
  // whose sign-align inverted PC1 are drawn with the opposite y-axis
  // convention, producing the X-braid the user noticed.
  state._regimesGetPC1 = (w) => {
    const win = data.windows && data.windows[w];
    if (!win || !win.pc1) return null;
    const sign = (state.flipPC1 && state.pc1Sign) ? (state.pc1Sign[w] || 1) : 1;
    if (sign === 1) return win.pc1;
    // Return a flipped copy so callers see render-ready PC1. Algorithms
    // that don't care about sign (het_detect_candidate_band etc.) still
    // work — sign-flipping just permutes "low/high" labels symmetrically.
    const out = new Float32Array(win.pc1.length);
    for (let i = 0; i < win.pc1.length; i++) out[i] = -win.pc1[i];
    return out;
  };
}
