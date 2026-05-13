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

/**
 * Empirical percentile of a numeric array. `p` is a fraction in
 * [0, 1] (e.g. 0.025 for 2.5th percentile, 0.975 for 97.5th).
 * Uses linear interpolation between adjacent ranks.
 *
 * Drops non-finite values + the legacy `-1` missing sentinel.
 * Returns NaN when fewer than 1 valid value, or when `p` is out
 * of [0, 1].
 *
 * @param {Array<number>|TypedArray|null} arr
 * @param {number} p  fraction in [0, 1]
 * @returns {number}
 */
export function percentile(arr, p) {
  if (!arr || !Number.isFinite(p) || p < 0 || p > 1) return NaN;
  const vals = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v !== -1) vals.push(v);
  }
  if (vals.length === 0) return NaN;
  if (vals.length === 1) return vals[0];
  vals.sort((a, b) => a - b);
  const idx = p * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  const frac = idx - lo;
  return vals[lo] * (1 - frac) + vals[hi] * frac;
}

/**
 * Kruskal–Wallis 3+-group rank-sum test, tie-corrected.
 *
 * Treats `null`, `undefined`, non-finite, and the legacy `-1` sentinel
 * as missing within each group.
 *
 * Returns:
 *   {
 *     H:    number,           // tie-corrected statistic
 *     df:   number,           // k − 1
 *     p:    number,           // p-value from upper-tail χ²(df), via
 *                             // series approx (≈ scipy chi2.sf)
 *     n_groups:   int,        // groups with ≥ 1 finite value
 *     n_per_group: Array<int>,
 *     n_total:    int,
 *   }
 *
 * Returns null when fewer than 2 non-empty groups OR when n_total < 3.
 *
 * @param {Array<Array<number>>} groups
 * @returns {Object|null}
 */
export function kruskalWallis(groups) {
  if (!Array.isArray(groups)) return null;
  // Pool finite values tagged by group index.
  const pooled = [];
  const n_per_group = new Array(groups.length).fill(0);
  for (let g = 0; g < groups.length; g++) {
    const arr = groups[g];
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (v != null && Number.isFinite(v) && v !== -1) {
        pooled.push({ v, g });
        n_per_group[g]++;
      }
    }
  }
  const N = pooled.length;
  const k_nonempty = n_per_group.filter(n => n > 0).length;
  if (k_nonempty < 2 || N < 3) return null;
  // Sort by value, assign average ranks.
  pooled.sort((a, b) => a.v - b.v);
  const tieSizes = [];
  let i = 0;
  while (i < N) {
    let j = i;
    while (j < N && pooled[j].v === pooled[i].v) j++;
    const runLen = j - i;
    const avgRank = (i + 1 + j) / 2;
    for (let m = i; m < j; m++) pooled[m].rank = avgRank;
    if (runLen > 1) tieSizes.push(runLen);
    i = j;
  }
  // Sum of ranks per group.
  const R = new Array(groups.length).fill(0);
  for (const p of pooled) R[p.g] += p.rank;
  let H = 0;
  for (let g = 0; g < groups.length; g++) {
    if (n_per_group[g] > 0) {
      H += (R[g] * R[g]) / n_per_group[g];
    }
  }
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  // Tie correction.
  let tieFactor = 0;
  for (const t of tieSizes) tieFactor += t * t * t - t;
  const denom = 1 - tieFactor / (N * N * N - N);
  if (denom > 0) H = H / denom;
  const df = k_nonempty - 1;
  const p = _chi2SfSeries(H, df);
  return {
    H, df, p,
    n_groups: k_nonempty,
    n_per_group,
    n_total: N,
  };
}

/**
 * Upper-tail χ² survival probability P(X² > x) using the regularised
 * upper incomplete gamma function Q(df/2, x/2). Series + continued-
 * fraction split à la Numerical Recipes.
 *
 * Returns 1 for x ≤ 0, 0 for non-finite, ~scipy.stats.chi2.sf
 * accuracy out to df ≈ 100.
 */
function _chi2SfSeries(x, df) {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df < 1) return NaN;
  if (x <= 0) return 1;
  const a = df / 2;
  const xx = x / 2;
  if (xx < a + 1) {
    // Series for P(a, x); Q = 1 − P.
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 1; n < 1000; n++) {
      ap += 1;
      del *= xx / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const lnGammaA = _lnGamma(a);
    const lnP = -xx + a * Math.log(xx) - lnGammaA + Math.log(sum);
    return Math.max(0, Math.min(1, 1 - Math.exp(lnP)));
  } else {
    // Continued fraction for Q(a, x).
    let b = xx + 1 - a;
    let c = 1 / 1e-30;
    let d = 1 / b;
    let h = d;
    for (let n = 1; n < 1000; n++) {
      const an = -n * (n - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < 1e-30) d = 1e-30;
      c = b + an / c;
      if (Math.abs(c) < 1e-30) c = 1e-30;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-12) break;
    }
    const lnGammaA = _lnGamma(a);
    const lnQ = -xx + a * Math.log(xx) - lnGammaA + Math.log(h);
    return Math.max(0, Math.min(1, Math.exp(lnQ)));
  }
}

function _lnGamma(z) {
  // Lanczos approximation (g=7, n=9). Accurate to ~1e-15 for z > 0.
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - _lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Convenience: median of an array (NA-tolerant via the percentile
 * helper). Equivalent to percentile(arr, 0.5).
 *
 * @param {Array<number>|TypedArray|null} arr
 * @returns {number}
 */
export function median(arr) {
  return percentile(arr, 0.5);
}

/**
 * Convenience: inter-quartile range [Q1, Q3] as a 2-element tuple
 * (NA-tolerant). Returns [NaN, NaN] when the array has fewer than
 * 1 finite value.
 *
 * @param {Array<number>|TypedArray|null} arr
 * @returns {[number, number]}
 */
export function iqr(arr) {
  return [percentile(arr, 0.25), percentile(arr, 0.75)];
}
