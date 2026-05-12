// atlases/inversion/shared/band_trace.js
//
// Band-trace compute layer (legacy lines 39395-39667).
//
// Given a fish-set (sample indices) and a list of L2 envelopes,
// project each fish's K-means label across all L2s via Hungarian-
// chained alignment and report the per-L2 band distribution. Used by
// the lines-panel band-trace strip to surface "do these fish co-
// segregate as a haplotype block, or do they fan out across bands?"
//
// The legacy version read `state` (k, data.l2_envelopes) as a fallback
// when caller didn't provide opts. The modern surface requires opts to
// be explicit (K + l2_indices + getLabelsForL2), making the function
// pure and trivially testable. The state-managed wrapper
// (_bandTraceGetOrCompute) is a separate concern and lives in
// page1/band_trace_state.js (todo).
//
// Pipeline:
//   fishSet × l2_indices × getLabelsForL2
//     → hungarianChainProjection (already in shared/hungarian.js)
//     → per-L2 counts/fractions/entropy
//     → regime call (co_seg | partial | fanned | sparse | no_valid)
//
// All math reuses the existing shared/hungarian.js primitives — no
// duplicated alignment logic.

import { hungarianChainProjection } from './hungarian.js';

// =====================================================================
// Constants (legacy lines 39404-39411)
// =====================================================================

/** Entropy normalized to [0, 1]. ≤ this → co_seg. */
export const BTRACE_COSEG_ENTROPY_MAX = 0.40;

/** Entropy normalized to [0, 1]. ≥ this → fanned. */
export const BTRACE_FANNED_ENTROPY_MIN = 0.85;

/** Minimum non-(-1) labels at an L2 before regime != 'sparse'. */
export const BTRACE_MIN_VALID_FISH = 3;

/** Minimum length of a co_seg/partial run before it counts as a regime run. */
export const BTRACE_MIN_RUN_LENGTH = 2;

// =====================================================================
// Helpers
// =====================================================================

/**
 * Normalized Shannon entropy on a distribution of K bins. Returns a
 * value in [0, 1]: 0 when all mass is in one bin, 1 when uniform.
 *
 * @param {ArrayLike<number>} fractions  per-bin mass (need not sum to 1; renormalised)
 * @param {number} K                     bin count (>= 1)
 * @returns {number}
 */
export function bandTraceShannonEntropy(fractions, K) {
  if (!fractions || fractions.length === 0 || K <= 1) return 0;
  let H = 0;
  let total = 0;
  for (let i = 0; i < fractions.length; i++) total += fractions[i];
  if (total <= 0) return 0;
  for (let i = 0; i < fractions.length; i++) {
    const p = fractions[i] / total;
    if (p > 0) H -= p * Math.log(p);
  }
  const Hmax = Math.log(K);
  if (Hmax <= 0) return 0;
  const norm = H / Hmax;
  // Clamp; floating point can deliver 1.0000000004 from a uniform input.
  if (norm < 0) return 0;
  if (norm > 1) return 1;
  return norm;
}

// =====================================================================
// Core trace function (legacy lines 39475-39569)
// =====================================================================

/**
 * Trace a fish-set across L2 windows. Returns null on insufficient input.
 *
 * @param {Set<number> | number[] | Int32Array} fishSet
 *        Sample indices to track. Set is the fast path; arrays are coerced.
 * @param {Object} opts
 * @param {number} opts.K                   Required. Cardinality of band labels.
 * @param {number[]} opts.l2_indices        Required. L2 indices to walk (chrom-order).
 * @param {(li:number)=>Int8Array|null} opts.getLabelsForL2
 *        Required. Per-L2 K-means labels at each sample index.
 * @param {number} [opts.coseg_max=BTRACE_COSEG_ENTROPY_MAX]
 * @param {number} [opts.fanned_min=BTRACE_FANNED_ENTROPY_MIN]
 * @param {number} [opts.min_valid=BTRACE_MIN_VALID_FISH]
 * @returns {{
 *   n_fish_selected: number, n_chains: number, n_total_L2: number,
 *   K: number, per_l2: Array<{
 *     l2_idx, chain_idx, chain_position, n_valid,
 *     band_counts, band_fractions, entropy,
 *     dominant_band, dominant_fraction, regime
 *   }>
 * } | null}
 */
export function bandTraceForFishSet(fishSet, opts) {
  opts = opts || {};

  // Coerce fishSet to a plain Set for fast `has(si)`.
  let fishSetObj;
  if (fishSet instanceof Set) fishSetObj = fishSet;
  else if (Array.isArray(fishSet) || (fishSet && typeof fishSet.length === 'number')) {
    fishSetObj = new Set();
    for (let i = 0; i < fishSet.length; i++) fishSetObj.add(fishSet[i] | 0);
  } else {
    return null;
  }
  if (fishSetObj.size === 0) return null;

  const K = opts.K | 0;
  if (K <= 0) return null;
  const cosegMax  = (typeof opts.coseg_max  === 'number') ? opts.coseg_max  : BTRACE_COSEG_ENTROPY_MAX;
  const fannedMin = (typeof opts.fanned_min === 'number') ? opts.fanned_min : BTRACE_FANNED_ENTROPY_MIN;
  const minValid  = (typeof opts.min_valid  === 'number') ? opts.min_valid  : BTRACE_MIN_VALID_FISH;

  const l2_indices = opts.l2_indices;
  if (!Array.isArray(l2_indices) && !(l2_indices && typeof l2_indices.length === 'number')) {
    return null;
  }
  if (l2_indices.length === 0) return null;

  if (typeof opts.getLabelsForL2 !== 'function') return null;

  // Run the Hungarian chain projection.
  const projection = hungarianChainProjection(l2_indices, K, opts.getLabelsForL2);
  if (!projection || projection.n_chains === 0) return null;

  const n_samples = projection.n_samples;
  const per_l2 = [];

  for (let ci = 0; ci < projection.chains.length; ci++) {
    const chain = projection.chains[ci];
    const proj  = chain.projected;        // Int8Array[n_L2 * n_samples]
    const n_L2  = chain.n_L2;
    for (let row = 0; row < n_L2; row++) {
      const counts = new Int32Array(K);
      let n_valid = 0;
      const base = row * n_samples;
      // Walk the fish-set; sum into counts where label is in [0, K).
      for (const si of fishSetObj) {
        if (si < 0 || si >= n_samples) continue;
        const lab = proj[base + si];
        if (lab < 0 || lab >= K) continue;
        counts[lab]++;
        n_valid++;
      }
      const fractions = new Float32Array(K);
      let dominant_band = -1, dominant_fraction = 0;
      if (n_valid > 0) {
        for (let k = 0; k < K; k++) {
          fractions[k] = counts[k] / n_valid;
          if (fractions[k] > dominant_fraction) {
            dominant_fraction = fractions[k];
            dominant_band = k;
          }
        }
      }
      const entropy = bandTraceShannonEntropy(fractions, K);
      let regime;
      if (n_valid === 0)             regime = 'no_valid';
      else if (n_valid < minValid)   regime = 'sparse';
      else if (entropy <= cosegMax)  regime = 'co_seg';
      else if (entropy >= fannedMin) regime = 'fanned';
      else                           regime = 'partial';

      per_l2.push({
        l2_idx: chain.l2_indices[row],
        chain_idx: ci,
        chain_position: row,
        n_valid,
        band_counts: counts,
        band_fractions: fractions,
        entropy,
        dominant_band,
        dominant_fraction,
        regime,
      });
    }
  }

  return {
    n_fish_selected: fishSetObj.size,
    n_chains: projection.n_chains,
    n_total_L2: projection.n_total_L2,
    K,
    per_l2,
  };
}

// =====================================================================
// Regime-run aggregator (legacy lines 39597-39667)
// =====================================================================

/**
 * Walk per_l2 entries in chromosome order and emit runs of consecutive
 * L2s that share a co-segregating regime. A "run" is a stretch of
 * `co_seg` (and optionally `partial`) L2s where the dominant band is
 * stable. `fanned`, `sparse`, `no_valid` break runs.
 *
 * Single-L2 runs are filtered out by default (min_run_length = 2).
 * Runs do not span chain breaks even when the regime is identical on
 * both sides (Hungarian alignment couldn't stitch, so band IDs aren't
 * comparable across chains).
 *
 * @param {ReturnType<typeof bandTraceForFishSet>} trace
 * @param {Object} [opts]
 * @param {number} [opts.min_run_length=BTRACE_MIN_RUN_LENGTH]
 * @param {boolean} [opts.allow_partial=true]  Include `partial` regime in runs.
 * @returns {Array<Object>}
 */
export function bandTraceRegimeRuns(trace, opts) {
  opts = opts || {};
  if (!trace || !Array.isArray(trace.per_l2) || trace.per_l2.length === 0) return [];
  const minRunLen = (typeof opts.min_run_length === 'number') ? opts.min_run_length : BTRACE_MIN_RUN_LENGTH;
  const allowPartial = (opts.allow_partial !== false);   // default: include partial

  const runs = [];
  let cur = null;
  function flush() {
    if (!cur) return;
    if (cur.n_L2 < minRunLen) { cur = null; return; }
    cur.mean_dominant_fraction = cur.sum_dom / cur.n_L2;
    cur.mean_entropy           = cur.sum_ent / cur.n_L2;
    delete cur.sum_dom;
    delete cur.sum_ent;
    delete cur.band_mode_counts;
    runs.push(cur);
    cur = null;
  }

  for (let i = 0; i < trace.per_l2.length; i++) {
    const e = trace.per_l2[i];
    const inRegime = (e.regime === 'co_seg' || (allowPartial && e.regime === 'partial'));
    if (!inRegime) { flush(); continue; }

    if (!cur) {
      cur = {
        start_l2_idx: e.l2_idx,
        end_l2_idx:   e.l2_idx,
        start_chain_position: e.chain_position,
        end_chain_position:   e.chain_position,
        chain_idx: e.chain_idx,
        n_L2: 1,
        dominant_band: e.dominant_band,
        n_co_seg: e.regime === 'co_seg' ? 1 : 0,
        n_partial: e.regime === 'partial' ? 1 : 0,
        sum_dom: e.dominant_fraction || 0,
        sum_ent: e.entropy || 0,
        band_mode_counts: {},
      };
      cur.band_mode_counts[e.dominant_band] = 1;
      continue;
    }
    // Same chain? If chain changes mid-run, flush and restart.
    if (e.chain_idx !== cur.chain_idx) {
      flush();
      i--;   // re-examine this entry as the new run's first
      continue;
    }
    cur.end_l2_idx = e.l2_idx;
    cur.end_chain_position = e.chain_position;
    cur.n_L2++;
    if (e.regime === 'co_seg') cur.n_co_seg++;
    else if (e.regime === 'partial') cur.n_partial++;
    cur.sum_dom += (e.dominant_fraction || 0);
    cur.sum_ent += (e.entropy || 0);
    const db = e.dominant_band;
    cur.band_mode_counts[db] = (cur.band_mode_counts[db] || 0) + 1;
    // Update dominant_band to the mode of the run-so-far for stability.
    let bestBand = cur.dominant_band, bestCount = cur.band_mode_counts[bestBand] || 0;
    for (const b in cur.band_mode_counts) {
      if (cur.band_mode_counts[b] > bestCount) {
        bestCount = cur.band_mode_counts[b];
        bestBand = +b;
      }
    }
    cur.dominant_band = bestBand;
  }
  flush();
  return runs;
}

// =====================================================================
// Console-debug exposures (preserves legacy `window._bandTraceForFishSet`)
// =====================================================================
if (typeof window !== 'undefined') {
  window._bandTraceForFishSet     = bandTraceForFishSet;
  window._bandTraceRegimeRuns     = bandTraceRegimeRuns;
  window._bandTraceShannonEntropy = bandTraceShannonEntropy;
  window._BTRACE_COSEG_ENTROPY_MAX  = BTRACE_COSEG_ENTROPY_MAX;
  window._BTRACE_FANNED_ENTROPY_MIN = BTRACE_FANNED_ENTROPY_MIN;
  window._BTRACE_MIN_VALID_FISH     = BTRACE_MIN_VALID_FISH;
  window._BTRACE_MIN_RUN_LENGTH     = BTRACE_MIN_RUN_LENGTH;
}
