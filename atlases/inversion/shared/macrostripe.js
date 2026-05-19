// atlases/inversion/shared/macrostripe.js
//
// Phase 1 of SPEC_macrostripe_microgroup_hierarchy.md: derive a
// per-sample macrostripe_id Int8Array from the existing band-tracking
// pipeline output. Pure projection — no new compute; reuses
// shared/band_tracking/locus_construction.js#locusBandSampleSets.
//
// User direction (chat 2026-05-18): use the existing band-tracking
// Stage 3/4 output as the macrostripe label; default the atlas
// coloring to macrostripe; keep per-window K-means microgroups as
// the opt-in advanced view.
//
// API:
//   getMacrostripeIdPerSample(state)
//     → Int8Array of length n_samples, or null when banding hasn't
//       run for the current chrom. Sample-i value = macrostripe id
//       in [0, K_locus); -1 when the sample is unassigned at the
//       current scrubber window.
//
//   getMacrostripeIdsAtWindow(state, w)
//     → same but for an explicit window index instead of state.cur.
//
//   getMacrostripeColor(state, si)
//     → CSS color string, or null when no macrostripe is available.
//       Defers to shared/page1_data_helpers.js#groupColor for the
//       palette so macrostripe colors match the K-means palette
//       the user already learned.
//
// When this returns null the caller falls through to today's
// per-window K-means coloring (the gating in drawPCA /
// drawLinesPanel handles the fallback).

import { locusBandSampleSets } from './band_tracking/locus_construction.js';
import { groupColor } from './page1_data_helpers.js';

/**
 * Find the Stage 3 locus that covers the given window index.
 * Returns null when banding hasn't run or no locus covers w.
 */
function _findLocusForWindow(state, w) {
  if (!state || !state.bandingResult) return null;
  const stage3 = state.bandingResult.stage3;
  if (!stage3 || !Array.isArray(stage3.loci)) return null;
  // Locus structure: { s, e, K, chromosome_idx?, ... } where [s, e] is
  // the inclusive window range.
  for (const L of stage3.loci) {
    if (!L) continue;
    const lo = (L.s | 0);
    const hi = (L.e | 0);
    if (w >= lo && w <= hi) return L;
  }
  return null;
}

/**
 * Build the getLabels callback that locusBandSampleSets needs.
 * Reads per-window K-means labels from state.l2GroupCache when
 * present, else computes on-the-fly via per_l2_cluster.
 */
function _makeGetLabelsForLocus(state) {
  return function getLabels(w) {
    if (!state || !state.data) return null;
    const data = state.data;
    if (!data.windows || !data.windows[w]) return null;
    // Find the L2 envelope containing window w.
    if (!Array.isArray(data.l2_envelopes)) return null;
    let envIdx = -1;
    for (let i = 0; i < data.l2_envelopes.length; i++) {
      const env = data.l2_envelopes[i];
      if (!env) continue;
      if (w >= (env._s0 | 0) && w <= (env._e0 | 0)) { envIdx = i; break; }
    }
    if (envIdx < 0) return null;
    // Pull cluster from the existing cache — same path drawPCA uses.
    const cache = state.l2GroupCache;
    if (cache && cache.has && cache.has(envIdx)) {
      const cl = cache.get(envIdx);
      if (cl && cl.labels) return cl.labels;
    }
    // No cluster yet for this envelope — return null; locusBandSampleSets
    // tolerates missing windows.
    return null;
  };
}

/**
 * Project the macrostripe sample-sets from Stage 3 onto an
 * Int8Array[n_samples]. Returns null when no locus covers the
 * given window OR banding hasn't run.
 */
export function getMacrostripeIdsAtWindow(state, w) {
  if (!state || !state.data) return null;
  const n_samples = (state.data.n_samples | 0);
  if (n_samples <= 0) return null;
  const locus = _findLocusForWindow(state, w);
  if (!locus) return null;
  // Cache the per-locus projection so repeated calls within the same
  // chrom + same locus don't re-run the Hungarian chain intersection.
  const cacheKey = `${locus.s}_${locus.e}_${locus.K | 0}`;
  if (!state.__macrostripeCache) state.__macrostripeCache = new Map();
  if (state.__macrostripeCache.has(cacheKey)) {
    return state.__macrostripeCache.get(cacheKey);
  }
  const getLabels = _makeGetLabelsForLocus(state);
  const r = locusBandSampleSets(locus, getLabels, n_samples);
  if (!r || !r.per_band_samples) {
    state.__macrostripeCache.set(cacheKey, null);
    return null;
  }
  // Flatten: sample → band index (or -1 when not in any).
  const out = new Int8Array(n_samples).fill(-1);
  const K = r.K | 0;
  for (let b = 0; b < K; b++) {
    const set = r.per_band_samples[b];
    if (!set) continue;
    for (const si of set) {
      if (si >= 0 && si < n_samples) out[si] = b;
    }
  }
  state.__macrostripeCache.set(cacheKey, out);
  return out;
}

/**
 * Convenience: macrostripe ids at the current scrubber position.
 */
export function getMacrostripeIdPerSample(state) {
  if (!state || !state.data) return null;
  const w = (state.cur | 0);
  return getMacrostripeIdsAtWindow(state, w);
}

/**
 * CSS color for sample si based on its macrostripe id. Reuses
 * groupColor so macrostripe palette matches the K-means palette
 * the user already learned. Returns null when no macrostripe
 * is available (gating callsite falls through to today's coloring).
 */
export function getMacrostripeColor(state, si) {
  const ids = getMacrostripeIdPerSample(state);
  if (!ids) return null;
  const bid = ids[si];
  if (bid == null || bid < 0) return null;
  return groupColor(bid) || null;
}

/**
 * Invalidate the macrostripe cache. Call this when state.data
 * rotates (new chromosome) or when state.bandingResult is
 * regenerated.
 */
export function invalidateMacrostripeCache(state) {
  if (!state) return;
  state.__macrostripeCache = new Map();
}

if (typeof window !== 'undefined') {
  window._getMacrostripeIdPerSample = getMacrostripeIdPerSample;
  window._getMacrostripeIdsAtWindow = getMacrostripeIdsAtWindow;
  window._getMacrostripeColor = getMacrostripeColor;
}
