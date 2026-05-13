// shared/band_tracking/trajectory.js
// =====================================================================
// PC1 sign anchoring + per-band PC1 trajectories + pairwise trajectory
// correlation + group-by-trajectory-similarity.
//
// Why this exists: PC1 sign at each window is arbitrary (PCA's
// flip-symmetry). To compare a single-band track's PC1 trajectory
// across windows meaningfully, every window's PC1 must be sign-
// corrected against a fixed anchor. The anchor is a stable subset
// of reference samples whose PC1 sign should remain constant.
//
// All five exports operate on PER-WINDOW callbacks (getPc1(w),
// getLabels(w), ...) — same per-window contract as anchor_signals.js
// and the rest of band_tracking/. NEVER L2-broadcast.
//
//   pickPc1OrientationReferenceSamples(labels, pc1, K, opts?)
//      At one anchor window, pick samples in the most-extreme-PC1
//      bands as orientation references. Returns Set<sampleIdx>.
//
//   computePc1SignAnchors(reference_samples, {getPc1, s_window,
//                                              e_window})
//      For each window in [s_window, e_window], compute sign ∈
//      {-1, +1} such that reference samples have non-negative mean
//      PC1 after the sign flip. Returns Int8Array(N_windows).
//
//   band_compute_pc1_trajectory(track, {getPc1, signByWindow?})
//      For a single-band track (output of single_band_track_from_seed),
//      compute the band's mean PC1 at each tracked window, with the
//      optional sign correction applied. Returns Float64Array(N).
//
//   band_pairwise_trajectory_correlation(trajA, trajB)
//      Pearson correlation between two equal-length trajectories.
//      NaN values are pairwise-deleted.
//
//   band_group_by_trajectory_similarity(trajectories, opts?)
//      Cluster bands by pairwise trajectory correlation. Bands with
//      |r| >= threshold collapse into one group; sign preserved as
//      a sign-bit per band (positive-correlated → +1 within group,
//      anti-correlated → -1). Returns {group_of, n_groups,
//      group_sign}.
//
// Pure JS — no DOM, no fetch.

/** Defaults for trajectory primitives. */
export const TRAJECTORY_DEFAULTS = Object.freeze({
  // Minimum |correlation| for two bands to share a trajectory group.
  group_min_abs_corr: 0.70,
  // Minimum reference-sample magnitude (|PC1|) to anchor sign at the
  // reference window. Samples below this threshold are skipped.
  ref_min_abs_pc1: 0.0,
  // How many top-magnitude samples to pick as references (per
  // pickPc1OrientationReferenceSamples).
  ref_n_samples: 10,
});

/**
 * Pick reference samples for PC1 sign anchoring. At one window with
 * labels + pc1 + K bands, choose samples in the BAND with the
 * highest |mean PC1| (the most-extreme homozygote-edge band) — these
 * samples are the cleanest anchor for sign orientation across
 * windows.
 *
 * Returns a `Set<sampleIdx>` (size ≤ `opts.ref_n_samples`). Returns
 * an empty set when K < 2 or no band has finite mean PC1.
 *
 * @param {Int8Array|Array<number>} labels
 * @param {Float32Array|Array<number>} pc1
 * @param {number} K
 * @param {{ref_n_samples?:number, ref_min_abs_pc1?:number}} [opts]
 * @returns {Set<number>}
 */
export function pickPc1OrientationReferenceSamples(labels, pc1, K, opts) {
  const out = new Set();
  if (!labels || !pc1 || !(K >= 2)) return out;
  const o = opts || {};
  const nRef = Number.isFinite(o.ref_n_samples)
    ? o.ref_n_samples : TRAJECTORY_DEFAULTS.ref_n_samples;
  const minAbs = Number.isFinite(o.ref_min_abs_pc1)
    ? o.ref_min_abs_pc1 : TRAJECTORY_DEFAULTS.ref_min_abs_pc1;

  // Per-band sum / count of PC1 to compute means.
  const sums = new Float64Array(K);
  const counts = new Int32Array(K);
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0 || l >= K) continue;
    const v = pc1[i];
    if (!Number.isFinite(v)) continue;
    sums[l] += v; counts[l]++;
  }
  // Pick the band with maximum |mean PC1|.
  let bestK = -1, bestAbs = -1;
  for (let k = 0; k < K; k++) {
    if (counts[k] === 0) continue;
    const mean = sums[k] / counts[k];
    if (Math.abs(mean) > bestAbs) { bestAbs = Math.abs(mean); bestK = k; }
  }
  if (bestK < 0) return out;
  // Collect samples in best band sorted by |pc1| desc; take top nRef
  // that exceed minAbs.
  const candidates = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== bestK) continue;
    const v = pc1[i];
    if (!Number.isFinite(v)) continue;
    if (Math.abs(v) < minAbs) continue;
    candidates.push([i, Math.abs(v)]);
  }
  candidates.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < Math.min(nRef, candidates.length); i++) {
    out.add(candidates[i][0]);
  }
  return out;
}

/**
 * For each window in [s_window, e_window], compute the sign that
 * orients PC1 so that the reference samples have non-negative mean
 * PC1 after the flip.
 *
 * Sign convention:
 *   - Window's reference-sample mean PC1 ≥ 0 → sign = +1 (keep)
 *   - Window's reference-sample mean PC1 < 0  → sign = -1 (flip)
 *   - No finite reference values at window     → sign = +1
 *     (fallback; caller can choose to ignore this window in
 *      downstream trajectory comparisons)
 *
 * @param {Set<number>|Array<number>} reference_samples
 * @param {{getPc1:(w:number)=>Float32Array|Array<number>|null,
 *          s_window:number, e_window:number}} args
 * @returns {Int8Array}  length (e_window - s_window + 1); values
 *                       in {-1, +1}; never 0.
 */
export function computePc1SignAnchors(reference_samples, args) {
  const refList = Array.from(reference_samples || []);
  const { getPc1, s_window, e_window } = args || {};
  const N = (e_window - s_window) + 1;
  const out = new Int8Array(N);
  if (typeof getPc1 !== 'function' || !(N > 0)) {
    out.fill(1);
    return out;
  }
  for (let i = 0; i < N; i++) {
    const w = s_window + i;
    const pc1 = getPc1(w);
    if (!pc1) { out[i] = 1; continue; }
    let sum = 0, n = 0;
    for (const si of refList) {
      const v = pc1[si];
      if (!Number.isFinite(v)) continue;
      sum += v; n++;
    }
    if (n === 0) { out[i] = 1; continue; }
    out[i] = (sum / n) >= 0 ? 1 : -1;
  }
  return out;
}

/**
 * Per-window mean PC1 of a single-band track (output of
 * single_band_track_from_seed). When `signByWindow` is supplied
 * (Map<w, ±1> or function w → ±1), each window's mean is multiplied
 * by the sign.
 *
 * Returns Float64Array of length `track.windows.length`. Windows
 * with no finite PC1 → NaN.
 *
 * @param {Object} track  output of single_band_track_from_seed
 * @param {{getPc1:(w:number)=>Float32Array|Array<number>|null,
 *          signByWindow?:Map<number,number>|Function}} args
 * @returns {Float64Array}
 */
export function band_compute_pc1_trajectory(track, args) {
  const n = track && track.ok && Array.isArray(track.windows)
    ? track.windows.length : 0;
  const out = new Float64Array(n);
  if (!n || !args || typeof args.getPc1 !== 'function') {
    for (let i = 0; i < n; i++) out[i] = NaN;
    return out;
  }
  const signFor = args.signByWindow;
  const lookupSign = (w) => {
    if (!signFor) return 1;
    if (typeof signFor === 'function') return signFor(w) || 1;
    if (signFor instanceof Map) {
      const v = signFor.get(w);
      return v != null ? v : 1;
    }
    return 1;
  };
  for (let i = 0; i < n; i++) {
    const rec = track.windows[i];
    const pc1 = args.getPc1(rec.w);
    if (!pc1 || !rec.members) { out[i] = NaN; continue; }
    let sum = 0, c = 0;
    for (const si of rec.members) {
      const v = pc1[si];
      if (!Number.isFinite(v)) continue;
      sum += v; c++;
    }
    if (c === 0) { out[i] = NaN; continue; }
    out[i] = (sum / c) * lookupSign(rec.w);
  }
  return out;
}

/**
 * Pearson correlation between two equal-length trajectories. NaN
 * values pairwise-deleted (skip if either array has NaN at index i).
 *
 * Returns:
 *   { r, n_used }   where r ∈ [-1, 1] or NaN when n_used < 2 or
 *                   either side has zero variance.
 *
 * @param {Float32Array|Float64Array|Array<number>} a
 * @param {Float32Array|Float64Array|Array<number>} b
 * @returns {{r:number, n_used:number}}
 */
export function band_pairwise_trajectory_correlation(a, b) {
  if (!a || !b || a.length !== b.length) return { r: NaN, n_used: 0 };
  const xs = [], ys = [];
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  const n = xs.length;
  if (n < 2) return { r: NaN, n_used: n };
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = xs[i] - mx, yi = ys[i] - my;
    num += xi * yi; dx += xi * xi; dy += yi * yi;
  }
  if (dx === 0 || dy === 0) return { r: NaN, n_used: n };
  const r = num / Math.sqrt(dx * dy);
  return { r: Math.max(-1, Math.min(1, r)), n_used: n };
}

/**
 * Cluster bands by trajectory similarity. Builds an N×N pairwise
 * |correlation| matrix; bands at correlation ≥ threshold collapse
 * into the same group. Within each group, the sign of each band
 * (relative to the group's first member) is preserved as a ±1 flag
 * so callers can know which bands are positive vs anti-correlated.
 *
 * Uses union-find: for each pair (i, j) with |r| ≥ threshold,
 * union i with j and propagate the relative sign (sign[j] =
 * sign[i] * sign(r)).
 *
 * @param {Array<Float64Array|Array<number>>} trajectories
 * @param {{group_min_abs_corr?:number}} [opts]
 * @returns {{
 *   group_of:    Int32Array(N),
 *   group_sign:  Int8Array(N),
 *   n_groups:    number,
 *   correlation_matrix: Float64Array(N*N),
 * }}
 */
export function band_group_by_trajectory_similarity(trajectories, opts) {
  const o = opts || {};
  const thr = Number.isFinite(o.group_min_abs_corr)
    ? o.group_min_abs_corr : TRAJECTORY_DEFAULTS.group_min_abs_corr;
  const N = Array.isArray(trajectories) ? trajectories.length : 0;
  const group_of = new Int32Array(N);
  const group_sign = new Int8Array(N);
  const correlation_matrix = new Float64Array(N * N);
  if (N === 0) {
    return { group_of, group_sign, n_groups: 0, correlation_matrix };
  }
  // Init union-find + signs.
  const parent = new Int32Array(N);
  const sign = new Int8Array(N);
  for (let i = 0; i < N; i++) { parent[i] = i; sign[i] = 1; }
  function find(x) {
    let acc = 1;
    while (parent[x] !== x) {
      acc *= sign[x];
      x = parent[x];
    }
    return { root: x, sign: acc };
  }
  function union(a, b, relSign) {
    const fa = find(a), fb = find(b);
    if (fa.root === fb.root) return;
    // We want sign[a] * sign-relative-to-a-root * relSign = sign[b]
    // * sign-relative-to-b-root  → solve for new sign at fb.root.
    // Simpler: set fb's root parent = fa.root, with edge sign such
    // that propagating from b to fa.root via this new edge gives
    // relSign relative to a.
    parent[fb.root] = fa.root;
    sign[fb.root] = (fa.sign * relSign * fb.sign) > 0 ? 1 : -1;
  }
  // Pairwise correlations.
  for (let i = 0; i < N; i++) correlation_matrix[i * N + i] = 1;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const c = band_pairwise_trajectory_correlation(
        trajectories[i], trajectories[j]);
      const r = Number.isFinite(c.r) ? c.r : 0;
      correlation_matrix[i * N + j] = r;
      correlation_matrix[j * N + i] = r;
      if (Math.abs(r) >= thr) union(i, j, r >= 0 ? 1 : -1);
    }
  }
  // Compact group ids.
  const remap = new Map();
  let next = 0;
  for (let i = 0; i < N; i++) {
    const f = find(i);
    if (!remap.has(f.root)) { remap.set(f.root, next++); }
    group_of[i] = remap.get(f.root);
    group_sign[i] = f.sign;
  }
  return { group_of, group_sign, n_groups: next, correlation_matrix };
}
