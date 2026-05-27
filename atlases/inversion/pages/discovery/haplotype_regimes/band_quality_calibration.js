// pages/discovery/haplotype_regimes/band_quality_calibration.js
//
// band_quality diagnostics + adaptive anchor-threshold picker.
// Extracted from haplotype_regimes.js as part of the page audit's
// file split (2026-05-27).
//
// Surfaces the per-window BQ cache distribution so that when the
// pipeline returns 0 seeds the user can see immediately whether
//   (a) BQ wasn't computed at all (producer didn't ship the field
//       and the silhouette derivation failed), or
//   (b) BQ exists but every window is below the seed gate's 0.50
//       default — needs a lower anchor threshold.
// The auto-calibrator picks the lowest threshold (≥ 0.20) that
// produces ≥ 5 candidate anchor windows, falling back to half the
// observed max when even 0.30 is too high.

/**
 * Compute a summary of the per-window band_quality cache.
 *
 * @param {Object} state   haplotype_regimes legacy state — reads
 *                          state._regimesBandQualityCache (Float32Array)
 *                          and state._regimesBandQualityProvenance
 * @returns {{
 *   n_windows: number,
 *   n_nonzero: number,
 *   n_pass_default: number,   // BQ ≥ 0.50 — seed_discovery default
 *   n_pass_chain:   number,   // BQ ≥ 0.40 — chain-walk default
 *   n_pass_low:     number,   // BQ ≥ 0.30 — low fallback
 *   mean: number, max: number,
 *   first_10: number[],
 *   provenance: Object,
 *   l2_synthesized: boolean
 * }}
 */
export function bandQualityStats(state) {
  const bq = state._regimesBandQualityCache || new Float32Array(0);
  const prov = state._regimesBandQualityProvenance || {};
  let nNonZero = 0, nPass50 = 0, nPass40 = 0, nPass30 = 0;
  let sum = 0, max = -Infinity;
  for (let i = 0; i < bq.length; i++) {
    const v = bq[i];
    if (!Number.isFinite(v)) continue;
    if (v > 0)    nNonZero++;
    if (v >= 0.3) nPass30++;
    if (v >= 0.4) nPass40++;
    if (v >= 0.5) nPass50++;
    sum += v;
    if (v > max) max = v;
  }
  const first10 = [];
  for (let i = 0; i < Math.min(10, bq.length); i++) {
    first10.push(+bq[i].toFixed(3));
  }
  return {
    n_windows:        bq.length,
    n_nonzero:        nNonZero,
    n_pass_default:   nPass50,        // 0.50 = seed_discovery default
    n_pass_chain:     nPass40,        // 0.40 = chain-walk default
    n_pass_low:       nPass30,        // 0.30 = low fallback
    mean:             bq.length > 0 ? +(sum / bq.length).toFixed(3) : 0,
    max:              Number.isFinite(max) ? +max.toFixed(3) : 0,
    first_10:         first10,
    provenance:       prov,
    l2_synthesized:   !!state._regimesL2Synthesized,
  };
}

/**
 * Adaptive seed-discovery anchor-BQ threshold. Steps:
 *   1. If default 0.50 catches ≥ 5 windows → 0.50.
 *   2. Else if 0.40 catches ≥ 5 → 0.40.
 *   3. Else if 0.30 catches ≥ 5 → 0.30.
 *   4. Else clamp(max * 0.5, 0.20, 0.30) — last-resort attempt.
 *
 * Below 0.20 we stop dropping; the walker will return 0 seeds and
 * the right answer is "no inversions detectable on this chromosome".
 *
 * @param {Object} stats   output of bandQualityStats(state)
 * @returns {number}       threshold in [0.20, 0.50]
 */
export function autoCalibrateAnchorBQ(stats) {
  if (!stats || !stats.n_windows) return 0.50;
  if (stats.n_pass_default >= 5) return 0.50;
  if (stats.n_pass_chain   >= 5) return 0.40;
  if (stats.n_pass_low     >= 5) return 0.30;
  return Math.max(0.20, Math.min(0.30, stats.max * 0.5));
}
