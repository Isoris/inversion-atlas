// shared/stats_helpers.js
//
// Small pure-stat helpers used by the boundary-refinement +
// band-tracking + diagnostic modules. All four are NA-tolerant: they
// drop non-finite values + the legacy "-1 means missing" sentinel.
//
// Legacy origin:
//   - mad            : _perTrackMad             at line 17864
//   - madNormalize   : _madNormalize            at line 17881
//   - rollingMedian  : _rollingMedian           at line 17839
//   - shannonEntropy : _bandTraceShannonEntropy at line 39421

/**
 * Median absolute deviation, NA-tolerant. Returns 0 when fewer than
 * 2 non-NA values (caller should fall back to ±1 to avoid divide-by-
 * zero downstream).
 *
 * Treats `null`, `undefined`, non-finite, and the legacy `-1` sentinel
 * as missing.
 *
 * @param {Array<number>|TypedArray|null} arr
 * @returns {number}
 */
export function mad(arr) {
  if (!arr) return 0;
  const finite = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null && Number.isFinite(v) && v !== -1) finite.push(v);
  }
  if (finite.length < 2) return 0;
  finite.sort((a, b) => a - b);
  const med = finite[(finite.length - 1) >> 1];
  const absDev = finite.map(v => Math.abs(v - med));
  absDev.sort((a, b) => a - b);
  return absDev[(absDev.length - 1) >> 1];
}

/**
 * Element-wise division by a scalar MAD. NA inputs (null / undefined /
 * non-finite / -1 sentinel) AND zero/NA MAD both produce 0 in the
 * output — downstream sums never propagate NaN.
 *
 * @param {Array<number>|TypedArray|null} arr
 * @param {number} madValue
 * @returns {Float64Array}
 */
export function madNormalize(arr, madValue) {
  const n = arr ? arr.length : 0;
  const out = new Float64Array(n);
  if (!madValue || !Number.isFinite(madValue) || madValue === 0) return out;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    out[i] = (v != null && Number.isFinite(v) && v !== -1) ? (v / madValue) : 0;
  }
  return out;
}

/**
 * Rolling-median smoother. For each index, returns the median of the
 * centered window of `width` neighbors (clamped at array edges).
 * Width should be odd; for even, the lower median is returned. NA
 * values (null / undefined / non-finite / -1 sentinel) are excluded
 * from each window's median. When a window has no non-NA values,
 * the output is NaN for that index.
 *
 * @param {Array<number>|TypedArray|null} arr
 * @param {number} width   any value < 1 is clamped to 1; ints only
 * @returns {Float64Array}
 */
export function rollingMedian(arr, width) {
  if (!arr) return new Float64Array(0);
  const n = arr.length;
  const out = new Float64Array(n);
  const w = Math.max(1, width | 0);
  const half = (w - 1) >> 1;
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      const v = arr[j];
      if (v != null && Number.isFinite(v) && v !== -1) buf.push(v);
    }
    if (buf.length === 0) { out[i] = NaN; continue; }
    buf.sort((a, b) => a - b);
    out[i] = buf[(buf.length - 1) >> 1];
  }
  return out;
}

/**
 * Shannon entropy of a discrete distribution, normalized to [0, 1]
 * by dividing by log(K). Returns 0 when the distribution is
 * degenerate (single non-zero category, or empty / all-zero input)
 * and 1 when uniform across K categories.
 *
 * `fractions` need NOT sum to exactly 1 — they are renormalized
 * internally by their sum. K is the category count for the
 * normalizer (typically equals fractions.length, but accepting it
 * as a separate arg lets callers normalize a sub-vector against
 * the parent K).
 *
 * @param {Array<number>|TypedArray|null} fractions
 * @param {number} K   number of categories (≥ 2 for non-zero output)
 * @returns {number}   in [0, 1]
 */
export function shannonEntropy(fractions, K) {
  if (!fractions || fractions.length === 0 || K <= 1) return 0;
  let total = 0;
  for (let i = 0; i < fractions.length; i++) total += fractions[i];
  if (total <= 0) return 0;
  let H = 0;
  for (let i = 0; i < fractions.length; i++) {
    const p = fractions[i] / total;
    if (p > 0) H -= p * Math.log(p);
  }
  const Hmax = Math.log(K);
  if (Hmax <= 0) return 0;
  const norm = H / Hmax;
  // Floating-point can deliver 1.0000000004 from a uniform input.
  if (norm < 0) return 0;
  if (norm > 1) return 1;
  return norm;
}
