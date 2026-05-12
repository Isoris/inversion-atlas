// shared/sigma_profile.js
//
// σ-profile classifier for a candidate (legacy lines 10406-10460
// sigmaProfileCandidate). Tests the "two inversions vs double
// crossovers vs noisy region" hypothesis on a candidate's per-sample
// σ-of-sign-aligned-PC1 distribution.
//
// Verdict logic:
//   K <= 3                                → 'NA'                (no extra bands)
//   q50 < 0.05 AND ratio_high < 0.05      → 'TWO_INVERSIONS'    (everyone stable)
//   is_bimodal AND 0.02 < ratio_high < 0.25 → 'CROSSOVER_ARTIFACTS' (few drifters)
//   q50 > 0.10                             → 'NOISY_REGION'      (everyone high σ)
//   else                                   → 'UNDETERMINED'
//
// Bimodality coefficient (Sarle's): (skew² + 1) / kurtosis > 5/9 ≈ 0.555
//
// Pure: caller passes state explicitly via sampleSpreadRange.

import { sampleSpreadRange } from './sample_spread.js';

/** Bimodality threshold (Sarle's BC). */
export const SIGMA_BIMODAL_BC_THRESHOLD = 5 / 9;

/** Top-N drifters returned in the verdict. */
export const SIGMA_TOP_N = 12;

/**
 * Classify a candidate's σ profile. Returns:
 *   {
 *     sd: Float64Array(n_samples),   // per-sample σ
 *     q50, q90, q95,                  // quantiles of the finite σ values
 *     n_high, ratio_high,             // count + fraction of σ > 2×q50
 *     bimodality_coef, is_bimodal,    // Sarle's BC + threshold gate
 *     verdict: 'NA' | 'TWO_INVERSIONS' | 'CROSSOVER_ARTIFACTS'
 *            | 'NOISY_REGION' | 'UNDETERMINED',
 *     reason: human-readable string,
 *     top_high: [{si, sigma}],         // top SIGMA_TOP_N drifters (desc σ)
 *   }
 *
 * Returns null when:
 *   - cand is null / has no start_w/end_w
 *   - sampleSpreadRange returns null
 *   - fewer than 10 finite σ values (not enough power)
 *
 * @param {Object} state
 * @param {Object} cand
 * @returns {Object|null}
 */
export function sigmaProfileCandidate(state, cand) {
  if (!cand) return null;
  if (!Number.isInteger(cand.start_w) || !Number.isInteger(cand.end_w)) return null;
  const sd = sampleSpreadRange(state, cand.start_w, cand.end_w);
  if (!sd) return null;
  const vals = [];
  for (let i = 0; i < sd.length; i++) {
    if (Number.isFinite(sd[i])) vals.push(sd[i]);
  }
  if (vals.length < 10) return null;
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const q50 = q(0.50), q90 = q(0.90), q95 = q(0.95);

  let mean = 0;
  for (const v of vals) mean += v;
  mean /= vals.length;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of vals) {
    const d = v - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= vals.length;
  m3 /= vals.length;
  m4 /= vals.length;
  const variance = m2;
  const skew = variance > 0 ? m3 / Math.pow(variance, 1.5) : 0;
  const kurt = variance > 0 ? m4 / (variance * variance) : 3;
  const bimodality_coef = (skew * skew + 1) / kurt;
  const is_bimodal = bimodality_coef > SIGMA_BIMODAL_BC_THRESHOLD;

  const high_thr = 2 * q50;
  let n_high = 0;
  for (const v of vals) if (v > high_thr) n_high++;
  const ratio_high = n_high / vals.length;

  let verdict, reason;
  const K = cand.K;
  if (!Number.isFinite(K) || K <= 3) {
    verdict = 'NA';
    reason = 'K=' + (K != null ? K : '?') + ', no extra bands to explain';
  } else if (q50 < 0.05 && ratio_high < 0.05) {
    verdict = 'TWO_INVERSIONS';
    reason = K + ' bands, all samples stable across candidate (q50='
      + q50.toFixed(3) + ')';
  } else if (is_bimodal && ratio_high > 0.02 && ratio_high < 0.25) {
    verdict = 'CROSSOVER_ARTIFACTS';
    reason = n_high + ' samples drifting across candidate ('
      + (ratio_high * 100).toFixed(0) + '%, BC='
      + bimodality_coef.toFixed(2) + ')';
  } else if (q50 > 0.10) {
    verdict = 'NOISY_REGION';
    reason = 'everyone has high σ (q50=' + q50.toFixed(3) + ') — low power';
  } else {
    verdict = 'UNDETERMINED';
    reason = 'q50=' + q50.toFixed(3) + ', BC=' + bimodality_coef.toFixed(2)
      + ', ratio_high=' + (ratio_high * 100).toFixed(0) + '%';
  }

  // Top drifters across the full sd array (descending σ), capped.
  const sortedIdx = [];
  for (let si = 0; si < sd.length; si++) sortedIdx.push(si);
  sortedIdx.sort((a, b) => sd[b] - sd[a]);
  const topCount = Math.min(SIGMA_TOP_N, n_high);
  const top_high = sortedIdx.slice(0, topCount).map(si => ({
    si, sigma: sd[si],
  }));

  return {
    sd, q50, q90, q95, n_high, ratio_high,
    bimodality_coef, is_bimodal,
    verdict, reason, top_high,
  };
}
