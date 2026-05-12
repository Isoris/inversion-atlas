// shared/band_reach.js
//
// Per-fish "band reach" across an L2 chain (legacy lines 38190-38330 +
// 47640-47820). For a chain of L2 envelopes, projects each L2's
// cluster labels back into the leftmost L2's band space via Hungarian
// alignment, then counts how many distinct bands each fish visits
// across the chain. The histogram of per-fish reach values diagnoses
// the regime: narrow (one stable system) vs wide (everyone wandering)
// vs bimodal-stacked (two-system pattern: half stable, half wide).
//
// All compute is pure: takes the per-L2 cluster outputs as an array
// of `{ labels, fixedKLabels?, usedK? }` records, plus an optional
// alignLabels callback (defaults to identity when not supplied).

import { alignLabels } from './hungarian.js';

// =====================================================================
// Reach thresholds
// =====================================================================

/** band_reach ≤ this = "narrow" (one-system stable fish). */
export const BREACH_NARROW_THRESHOLD = 2;
/** ≥ this fraction narrow → regime is narrow. */
export const BREACH_NARROW_FRAC_HIGH = 0.70;
/** < this fraction narrow → regime is wide. */
export const BREACH_NARROW_FRAC_LOW  = 0.30;
/** Need ≥ this many fish to call a band populated. */
export const BREACH_MIN_FISH_PER_BAND = 5;

// =====================================================================
// Bimodality thresholds
// =====================================================================

/** Each peak ≥ this fraction of fish to count as a peak. */
export const BR_BIMODAL_NARROW_MIN   = 0.25;
export const BR_BIMODAL_WIDE_MIN     = 0.25;
/** Trough must be below this × smaller-peak count. */
export const BR_BIMODAL_DIP_FRAC     = 0.75;
/** Fraction-threshold for unimodal-narrow verdict. */
export const BR_UNIMODAL_NARROW_HIGH = 0.70;
/** Fraction-threshold for unimodal-wide verdict. */
export const BR_UNIMODAL_WIDE_HIGH   = 0.50;
/** Need ≥ this many valid fish for verdict to fire. */
export const BR_MIN_VALID_FISH       = 10;
/** reach ≤ this = "narrow" bucket for bimodality verdict. */
export const BR_NARROW_REACH_MAX     = 2;
/** reach ≥ this = "wide" bucket. */
export const BR_WIDE_REACH_MIN       = 4;
/** reach == this = trough between peaks. */
export const BR_TROUGH_REACH         = 3;

// =====================================================================
// Hungarian-aligned label projection
// =====================================================================

/**
 * Project a chain of label arrays into the leftmost L2's band space.
 * For each L2 i > 0, computes Hungarian alignment to L2 (i-1)'s
 * (already-projected) labels, inverts the permutation, and rewrites
 * cur[s] → invPerm[cur[s]].
 *
 * @param {Array<{labels:ArrayLike<number>}>} labelChain
 * @param {number} K
 * @returns {Array<Int8Array>}  one per L2; first is leftmost (identity)
 */
export function projectChainToLeftmost(labelChain, K) {
  if (!Array.isArray(labelChain) || labelChain.length === 0) return [];
  const nS = labelChain[0].labels.length;
  const out = [labelChain[0].labels];
  for (let i = 1; i < labelChain.length; i++) {
    const prev = out[i - 1];
    const cur = labelChain[i].labels;
    let perm = null;
    try {
      const a = alignLabels(prev, cur, K);
      perm = a && a.perm;
    } catch (_) { /* identity fallback */ }
    let invPerm = null;
    if (perm) {
      invPerm = new Int8Array(K);
      for (let k = 0; k < K; k++) invPerm[k] = -1;
      for (let k = 0; k < K; k++) {
        const tgt = perm[k];
        if (tgt >= 0 && tgt < K) invPerm[tgt] = k;
      }
    }
    const projected = new Int8Array(nS);
    for (let s = 0; s < nS; s++) {
      const c = cur[s];
      if (c < 0) projected[s] = -1;
      else if (invPerm && invPerm[c] >= 0) projected[s] = invPerm[c];
      else projected[s] = c;
    }
    out.push(projected);
  }
  return out;
}

// =====================================================================
// Band reach across L2 chain
// =====================================================================

/**
 * For a chain of L2 cluster outputs, compute per-fish band-reach
 * (number of distinct projected bands visited) + per-band visit
 * counts + regime_breadth verdict.
 *
 * @param {Array<{labels:ArrayLike<number>, fixedKLabels?:ArrayLike<number>, usedK?:number}>} clusters
 * @param {{l2_indices?:Array<number>, K?:number}} opts
 * @returns {Object|null}
 */
export function computeBandReachAcrossL2s(clusters, opts) {
  if (!Array.isArray(clusters) || clusters.length === 0) return null;
  for (const cl of clusters) {
    if (!cl || !cl.labels) return null;
  }
  const nS = clusters[0].labels.length;
  for (const cl of clusters) {
    if (cl.labels.length !== nS) return null;
  }
  const o = opts || {};
  let K = Number.isFinite(o.K) ? o.K : (clusters[0].usedK || 3);
  // labels for projection use fixedKLabels when present
  const labelChain = clusters.map(c => ({
    labels: c.fixedKLabels || c.labels,
    K:      c.usedK || K,
  }));
  const projected = projectChainToLeftmost(labelChain, K);

  const Kmax = K;
  const reach = new Int8Array(nS);
  const bandVisitCount = new Int32Array(Kmax);
  const visitedBitSet = new Int32Array(nS);
  for (const lab of projected) {
    for (let s = 0; s < nS; s++) {
      const k = lab[s];
      if (k < 0 || k >= 32) continue;
      visitedBitSet[s] |= (1 << k);
    }
  }
  for (let s = 0; s < nS; s++) {
    let bits = visitedBitSet[s];
    let cnt = 0;
    while (bits) { bits &= (bits - 1); cnt++; }
    reach[s] = cnt;
  }
  for (let s = 0; s < nS; s++) {
    for (let k = 0; k < Kmax; k++) {
      if (visitedBitSet[s] & (1 << k)) bandVisitCount[k]++;
    }
  }

  let narrowFishCount = 0;
  let validFishCount  = 0;
  for (let s = 0; s < nS; s++) {
    if (reach[s] === 0) continue;
    validFishCount++;
    if (reach[s] <= BREACH_NARROW_THRESHOLD) narrowFishCount++;
  }
  const narrow_fraction = validFishCount > 0 ? narrowFishCount / validFishCount : 0;

  let bands_populated = 0;
  for (let k = 0; k < Kmax; k++) {
    if (bandVisitCount[k] >= BREACH_MIN_FISH_PER_BAND) bands_populated++;
  }

  let regime_breadth;
  if (validFishCount === 0 || bands_populated < 2)         regime_breadth = 'no_signal';
  else if (narrow_fraction >= BREACH_NARROW_FRAC_HIGH)     regime_breadth = 'narrow';
  else if (narrow_fraction <  BREACH_NARROW_FRAC_LOW)      regime_breadth = 'wide';
  else                                                      regime_breadth = 'medium';

  return {
    l2_indices: Array.isArray(o.l2_indices) ? o.l2_indices.slice() : null,
    n_samples: nS,
    n_valid: validFishCount,
    K: Kmax,
    per_sample_band_reach: reach,
    per_band_visit_count:  bandVisitCount,
    narrow_fraction,
    bands_populated,
    regime_breadth,
  };
}

// =====================================================================
// Bimodality verdict on the reach histogram
// =====================================================================

/**
 * Given a band-reach result (from computeBandReachAcrossL2s), apply
 * the bimodality verdict rules. Returns:
 *   { reach_histogram, narrow_count, wide_count, trough_count,
 *     narrow_fraction, wide_fraction, trough_fraction,
 *     trough_below_both, bimodality_coef, is_bimodal,
 *     verdict, reason }
 *
 * Verdict ∈ {'NA','BIMODAL_STACKED','UNIMODAL_NARROW','UNIMODAL_WIDE','UNDETERMINED'}.
 *
 * @param {Object} reachData  from computeBandReachAcrossL2s
 * @returns {Object|null}
 */
export function bandReachBimodalityFromReach(reachData) {
  if (!reachData || !reachData.per_sample_band_reach) return null;
  const reach = reachData.per_sample_band_reach;
  const K = reachData.K || 3;
  const nS = reach.length;

  const histLen = Math.max(K + 1, BR_WIDE_REACH_MIN + 1);
  const reach_histogram = new Int32Array(histLen);
  let n_valid = 0;
  for (let s = 0; s < nS; s++) {
    const r = reach[s];
    if (r <= 0) continue;
    n_valid++;
    if (r >= histLen) reach_histogram[histLen - 1]++;
    else reach_histogram[r]++;
  }

  let narrow_count = 0, wide_count = 0;
  for (let r = 1; r <= BR_NARROW_REACH_MAX && r < histLen; r++) {
    narrow_count += reach_histogram[r];
  }
  for (let r = BR_WIDE_REACH_MIN; r < histLen; r++) {
    wide_count += reach_histogram[r];
  }
  const trough_count = (BR_TROUGH_REACH < histLen)
    ? reach_histogram[BR_TROUGH_REACH] : 0;

  const narrow_fraction = n_valid > 0 ? narrow_count / n_valid : 0;
  const wide_fraction   = n_valid > 0 ? wide_count   / n_valid : 0;
  const trough_fraction = n_valid > 0 ? trough_count / n_valid : 0;

  const smallerPeak = Math.min(narrow_count, wide_count);
  const trough_below_both = (trough_count < BR_BIMODAL_DIP_FRAC * smallerPeak);

  let bimodality_coef = NaN, is_bimodal = false;
  if (n_valid >= BR_MIN_VALID_FISH) {
    let mean = 0, count = 0;
    for (let s = 0; s < nS; s++) {
      if (reach[s] > 0) { mean += reach[s]; count++; }
    }
    if (count > 0) {
      mean /= count;
      let m2 = 0, m3 = 0, m4 = 0;
      for (let s = 0; s < nS; s++) {
        if (reach[s] > 0) {
          const d = reach[s] - mean;
          m2 += d*d; m3 += d*d*d; m4 += d*d*d*d;
        }
      }
      m2 /= count; m3 /= count; m4 /= count;
      const variance = m2;
      const skew = variance > 0 ? m3 / Math.pow(variance, 1.5) : 0;
      const kurt = variance > 0 ? m4 / (variance * variance) : 3;
      bimodality_coef = (skew * skew + 1) / kurt;
      is_bimodal = bimodality_coef > (5 / 9);
    }
  }

  let verdict, reason;
  if (K < 4) {
    verdict = 'NA';
    reason = 'K=' + K + ', need at least 4 bands for band-reach bimodality';
  } else if (n_valid < BR_MIN_VALID_FISH) {
    verdict = 'NA';
    reason = 'only ' + n_valid + ' valid fish (need ' + BR_MIN_VALID_FISH + ')';
  } else if (narrow_fraction >= BR_BIMODAL_NARROW_MIN
             && wide_fraction >= BR_BIMODAL_WIDE_MIN
             && trough_below_both) {
    verdict = 'BIMODAL_STACKED';
    reason = (narrow_fraction*100).toFixed(0) + '% narrow + '
      + (wide_fraction*100).toFixed(0) + '% wide, dip at reach='
      + BR_TROUGH_REACH + ' (' + (trough_fraction*100).toFixed(0) + '%)';
  } else if (narrow_fraction >= BR_UNIMODAL_NARROW_HIGH
             && wide_fraction <  BR_BIMODAL_WIDE_MIN) {
    verdict = 'UNIMODAL_NARROW';
    reason = (narrow_fraction*100).toFixed(0) + '% of fish stay narrow';
  } else if (wide_fraction >= BR_UNIMODAL_WIDE_HIGH
             && narrow_fraction < BR_BIMODAL_NARROW_MIN) {
    verdict = 'UNIMODAL_WIDE';
    reason = (wide_fraction*100).toFixed(0) + '% of fish wander wide';
  } else {
    verdict = 'UNDETERMINED';
    reason = 'narrow=' + (narrow_fraction*100).toFixed(0)
      + '%, wide=' + (wide_fraction*100).toFixed(0)
      + '%, trough=' + (trough_fraction*100).toFixed(0) + '%';
  }

  return {
    l2_indices: reachData.l2_indices,
    n_samples: nS,
    n_valid,
    K,
    reach_histogram: Array.from(reach_histogram),
    narrow_count, wide_count, trough_count,
    narrow_fraction, wide_fraction, trough_fraction,
    trough_below_both,
    bimodality_coef, is_bimodal,
    verdict, reason,
  };
}

/**
 * Convenience: compute reach then derive bimodality verdict in one call.
 * Returns the bimodality result, or null when computeBandReachAcrossL2s
 * returned null.
 *
 * @param {Array<Object>} clusters   per-L2 cluster outputs
 * @param {Object?} opts             passed to computeBandReachAcrossL2s
 * @returns {Object|null}
 */
export function bandReachBimodality(clusters, opts) {
  const reachData = computeBandReachAcrossL2s(clusters, opts);
  if (!reachData) return null;
  return bandReachBimodalityFromReach(reachData);
}
