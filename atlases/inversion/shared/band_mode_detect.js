// shared/band_mode_detect.js
//
// 1D bimodality detector on a heterozygosity vector (legacy lines
// 37451-37521: _dbdDetectModes + _dbdMean + the 3 _DBD_* thresholds).
// Used by the haplotype-divergence band classifier to decide
// whether a band's heterozygosity distribution should be split
// into two sub-modes.
//
// Algorithm:
//   - K-means with K=2, init centroids at the 25th + 75th
//     percentile of the sorted het values.
//   - Iterate ≤ 12 times or until labels stabilise.
//   - Compute the pooled standard deviation; gap_z = |Δcenter| / σ.
//   - Bimodal iff: each cluster has ≥ MIN_MODE_SAMPLES support
//                  AND gap_z ≥ MULTIMODAL_GAP_Z
//                  AND |Δcenter| ≥ MULTIMODAL_GAP_MIN (absolute).
//   - Order modes so center[0] < center[1].
//
// Pure: no DOM, no state. Headless-tolerant.

/** Bimodal iff gap between modes > 2σ. */
export const MULTIMODAL_GAP_Z = 2.0;
/** AND gap > 0.15 in absolute het units. */
export const MULTIMODAL_GAP_MIN = 0.15;
/** Mode needs ≥ 3 samples to be real. */
export const MIN_MODE_SAMPLES = 3;

/**
 * Arithmetic mean of an array-like. Zero on empty input.
 * Returns the legacy `_dbdMean` shape.
 *
 * @param {Array<number>|TypedArray} arr
 * @returns {number}
 */
export function meanOf(arr) {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/**
 * Detect modes in a 1D heterozygosity vector. Returns:
 *
 *   {
 *     n_modes:           1 | 2,
 *     mode_centers:      [c0]  or  [c0, c1]  (c0 < c1 when n_modes=2),
 *     mode_assignments:  Int8Array(N)  (0 or 1)
 *   }
 *
 * `n_modes = 1` is returned when:
 *   - input has < 2*MIN_MODE_SAMPLES samples
 *   - all values are within 1e-6 (degenerate distribution)
 *   - either cluster has < MIN_MODE_SAMPLES samples
 *   - gap_z < MULTIMODAL_GAP_Z, OR
 *   - |Δcenter| < MULTIMODAL_GAP_MIN
 *
 * @param {Array<number>|TypedArray} het
 * @returns {Object}
 */
export function detectBandModes(het) {
  if (!het || het.length < (2 * MIN_MODE_SAMPLES)) {
    return {
      n_modes: 1,
      mode_centers: [meanOf(het)],
      mode_assignments: new Int8Array(het ? het.length : 0),
    };
  }
  // K-means K=2 on 1D values
  const sorted = Array.from(het).sort((a, b) => a - b);
  let c0 = sorted[Math.floor(sorted.length * 0.25)];
  let c1 = sorted[Math.floor(sorted.length * 0.75)];
  if (c1 - c0 < 1e-6) {
    return {
      n_modes: 1,
      mode_centers: [meanOf(het)],
      mode_assignments: new Int8Array(het.length),
    };
  }
  const labels = new Int8Array(het.length);
  for (let it = 0; it < 12; it++) {
    let changed = false;
    for (let i = 0; i < het.length; i++) {
      const d0 = Math.abs(het[i] - c0);
      const d1 = Math.abs(het[i] - c1);
      const lab = d0 <= d1 ? 0 : 1;
      if (labels[i] !== lab) { labels[i] = lab; changed = true; }
    }
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (let i = 0; i < het.length; i++) {
      if (labels[i] === 0) { s0 += het[i]; n0++; }
      else                 { s1 += het[i]; n1++; }
    }
    if (n0 > 0) c0 = s0 / n0;
    if (n1 > 0) c1 = s1 / n1;
    if (!changed) break;
  }
  // Pooled σ
  let v0 = 0, n0 = 0, v1 = 0, n1 = 0;
  for (let i = 0; i < het.length; i++) {
    if (labels[i] === 0) { v0 += (het[i] - c0) ** 2; n0++; }
    else                 { v1 += (het[i] - c1) ** 2; n1++; }
  }
  const pooledVar = (v0 + v1) / Math.max(1, het.length - 2);
  const pooledSd = Math.sqrt(Math.max(pooledVar, 1e-12));
  const gap = Math.abs(c1 - c0);
  const gapZ = gap / pooledSd;
  if (n0 < MIN_MODE_SAMPLES || n1 < MIN_MODE_SAMPLES
      || gapZ < MULTIMODAL_GAP_Z || gap < MULTIMODAL_GAP_MIN) {
    return {
      n_modes: 1,
      mode_centers: [meanOf(het)],
      mode_assignments: new Int8Array(het.length),
    };
  }
  // Order modes so center 0 < center 1
  if (c0 > c1) {
    const tmp = c0; c0 = c1; c1 = tmp;
    for (let i = 0; i < labels.length; i++) labels[i] = 1 - labels[i];
  }
  return { n_modes: 2, mode_centers: [c0, c1], mode_assignments: labels };
}
