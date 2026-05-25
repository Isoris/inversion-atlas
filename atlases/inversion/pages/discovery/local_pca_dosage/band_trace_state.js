// pages/discovery/local_pca_dosage/band_trace_state.js
//
// State-managed wrapper around the pure-compute band_trace layer
// (shared/band_trace.js). Caches the per-fish-set trace on
// state.bandTraceCache + state.bandTraceCacheKey, persists the
// fish-set and on/off toggle to localStorage, and offers
// a convenience helper to seed the fish-set from the focal candidate's
// largest band.
//
// Legacy source: lines 39717-39832 (cache key + getOrCompute), plus
// the setters at 39752-39795 and the candidate-seeded helper at 39804.
// All bodies took an implicit `state` global; here `state` is the
// first argument of every entry point.

import {
  bandTraceForFishSet,
} from '../../../shared/band_trace.js';
import { persistDebounced } from '../../../shared/persist_debounced.js';

// =====================================================================
// localStorage keys (legacy lines 39700-39701)
// =====================================================================

export const BTRACE_ON_LS_KEY        = 'inversion_atlas.bandTraceOn';
export const BTRACE_FISH_SET_LS_KEY  = 'inversion_atlas.bandTraceFishSet';

// =====================================================================
// Cache key (legacy lines 39717-39727)
// =====================================================================

/**
 * Deterministic fingerprint of (chrom, fish-set, K, envelope-count).
 * FNV-ish 32-bit hash on the sorted fish-set keeps the key short.
 *
 * @param {string|null} chrom
 * @param {Set<number>|number[]|null} fishSet
 * @param {number} K
 * @param {number} n_envelopes
 * @returns {string|null}
 */
export function bandTraceCacheKey(chrom, fishSet, K, n_envelopes) {
  if (!fishSet) return null;
  const sorted = (fishSet instanceof Set ? Array.from(fishSet) : Array.from(fishSet))
                   .map(x => x | 0).sort((a, b) => a - b);
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < sorted.length; i++) h = (h * 31 + (sorted[i] + 2)) | 0;
  const fp = (h >>> 0).toString(16);
  return (chrom || '?') + '|' + sorted.length + ':' + fp + '|K' + (K | 0) + '|nE' + (n_envelopes | 0);
}

// =====================================================================
// Cached compute (legacy lines 39731-39749)
// =====================================================================

/**
 * Get the cached trace for state.bandTraceFishSet, recomputing when
 * the cache key drifts. Returns null when no fish-set is selected or
 * the active chromosome has no L2 envelopes.
 *
 * @param {object} state  local_pca_dosage _pageState
 * @returns {object|null}
 */
export function bandTraceGetOrCompute(state) {
  if (!state) return null;
  const fishSet = state.bandTraceFishSet;
  if (!fishSet || !fishSet.length) return null;
  const d = state.data;
  if (!d || !Array.isArray(d.l2_envelopes) || d.l2_envelopes.length === 0) return null;
  const K = state.k || 3;
  const chrom = d.chrom || null;
  const key = bandTraceCacheKey(chrom, fishSet, K, d.l2_envelopes.length);
  if (state.bandTraceCacheKey === key && state.bandTraceCache) {
    return state.bandTraceCache;
  }
  const l2_indices = d.l2_envelopes.map((_, i) => i);
  // The pure-compute layer needs a getLabelsForL2 callback. The atlas
  // exposes per-L2 K-means labels via state.l2GroupCache, which local_pca_dosage's
  // L3 panel + lines panel both maintain. Caller is responsible for
  // ensuring that cache is warm; if it isn't, the compute degrades
  // gracefully via the projection's empty-chain return.
  const getLabelsForL2 = (li) => {
    const cache = state.l2GroupCache;
    if (!cache) return null;
    const entry = cache.get ? cache.get(li) : cache[li];
    return (entry && entry.labels) ? entry.labels : null;
  };
  const trace = bandTraceForFishSet(fishSet, { K, l2_indices, getLabelsForL2 });
  state.bandTraceCache = trace;
  state.bandTraceCacheKey = key;
  return trace;
}

// =====================================================================
// Setters (legacy lines 39752-39795)
// =====================================================================

/**
 * Set the tracked fish-set. Pass an empty array (or null) to clear.
 * Invalidates the cache and persists the new value to localStorage.
 *
 * Returns the resolved fish-set (deduped + integer-coerced) or null.
 */
export function setBandTraceFishSet(state, arr) {
  if (!state) return null;
  if (!arr || !arr.length) {
    state.bandTraceFishSet = null;
    state.bandTraceCache = null;
    state.bandTraceCacheKey = null;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.removeItem(BTRACE_FISH_SET_LS_KEY); } catch (_) {}
    }
    return null;
  }
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] | 0;
    if (v < 0) continue;
    if (seen.has(v)) continue;
    seen.add(v); out.push(v);
  }
  state.bandTraceFishSet = out;
  state.bandTraceCache = null;
  state.bandTraceCacheKey = null;
  persistDebounced(BTRACE_FISH_SET_LS_KEY, out);
  return out;
}

/**
 * Toggle whether the band-trace strip is rendered. Persists to
 * localStorage so the user's preference survives reload.
 */
export function setBandTraceOn(state, on) {
  if (!state) return;
  state.bandTraceOn = !!on;
  persistDebounced(BTRACE_ON_LS_KEY, on ? '1' : '0');
}

/**
 * Load the persisted on/off toggle + fish-set from localStorage into
 * state. Fail-soft on JSON or storage errors. Called from local_pca_dosage.applyData()
 * on every chromosome swap (the fish-set is cohort-wide, not per-chrom,
 * so it survives chrom changes — but the cache is per-chrom).
 */
export function loadBandTraceState(state) {
  if (!state) return;
  state.bandTraceOn = false;
  state.bandTraceFishSet = null;
  state.bandTraceCache = null;
  state.bandTraceCacheKey = null;
  if (typeof localStorage === 'undefined') return;
  try {
    state.bandTraceOn = (localStorage.getItem(BTRACE_ON_LS_KEY) === '1');
  } catch (_) {}
  try {
    const raw = localStorage.getItem(BTRACE_FISH_SET_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const seen = new Set();
        const out = [];
        for (let i = 0; i < parsed.length; i++) {
          const v = parsed[i] | 0;
          if (v < 0 || seen.has(v)) continue;
          seen.add(v); out.push(v);
        }
        state.bandTraceFishSet = out.length > 0 ? out : null;
      }
    }
  } catch (_) {}
}

// =====================================================================
// Convenience: seed fish-set from focal candidate (legacy lines 39804-39832)
// =====================================================================

/**
 * Auto-fill the fish-set from the currently focused candidate's
 * largest band (or a caller-specified band). The candidate is
 * state.candidate; if it has locked_labels and a sensible K, the
 * largest-membership band's sample indices become the new fish-set.
 *
 * Returns the resolved fish-set array on success, or null when there's
 * no candidate, no locked_labels, or every band is empty.
 *
 * @param {object} state
 * @param {{bandIdx?: number}} [opts]  Pass bandIdx to pick a non-largest band.
 * @returns {number[]|null}
 */
export function bandTraceFromFocalCandidate(state, opts) {
  if (!state) return null;
  const c = state.candidate;
  if (!c || !c.locked_labels || !c.locked_labels.length) return null;
  const K = c.K || state.k || 3;
  const counts = new Int32Array(K);
  const labels = c.locked_labels;
  for (let s = 0; s < labels.length; s++) {
    const lab = labels[s];
    if (lab >= 0 && lab < K) counts[lab]++;
  }
  let pickBand = (opts && Number.isInteger(opts.bandIdx)) ? opts.bandIdx : -1;
  if (pickBand < 0 || pickBand >= K) {
    let best = 0, bestCount = -1;
    for (let k = 0; k < K; k++) if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
    pickBand = best;
  }
  const out = [];
  for (let s = 0; s < labels.length; s++) {
    if (labels[s] === pickBand) out.push(s);
  }
  if (out.length === 0) return null;
  setBandTraceFishSet(state, out);
  return out;
}
