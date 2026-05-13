// shared/band_tracking/band_quality.js
// =====================================================================
// Per-window band_quality scorer.
//
// A scalar in [0, 1] that summarizes how trustworthy the K-means
// banding at one window is. Used by the chain walk (chain_walk.js) to
// skip "fanning" windows where the banding is unreliable.
//
// Formula (default):
//   band_quality(w) = min( silhouette_norm(w),
//                          size_balance(w),
//                          eig_ratio_norm(w) )
//
// The min enforces "all three must be good" — a window with great
// separation (high silhouette) but a single dominant band (poor size
// balance) still gets a low score.
//
// Components:
//   silhouette_norm  — silhouette of the K-means clustering, clamped
//                      to [0, 1]. Negative silhouette → 0.
//   size_balance     — entropy of band sizes, normalized by log(K).
//                      Equal-sized bands → 1; one giant band → 0.
//   eig_ratio_norm   — saturating function of eig1/eig2; >2 → ~1,
//                      <1 → 0. Captures "PC1 dominates a single
//                      arrangement axis".
//
// Threshold:
//   Default 0.4 (calibrate on LG28). Windows below threshold are
//   skipped as voters AND break chain extension.
// =====================================================================

const DEFAULT_BQ_THRESHOLD = 0.4;

// ---------------------------------------------------------------------
// Silhouette of a 1D K-means clustering
//
// Uses the classical Rousseeuw silhouette: for each point i,
//   a(i) = mean distance to other points in the same cluster
//   b(i) = min over OTHER clusters c of (mean distance to points in c)
//   s(i) = (b - a) / max(a, b)   ∈ [-1, 1]
// silhouette = mean over i of s(i).
//
// For 1D PC1 data with K up to ~6, this is O(n_samples^2 / K) which
// is fine for n_samples=226.
// ---------------------------------------------------------------------

/**
 * @param {Float32Array|Float64Array|number[]} pc1   sign-aligned PC1 per sample
 * @param {Int8Array|number[]} labels                K-means cluster labels
 * @param {number} K
 * @returns {number}                                 silhouette ∈ [-1, 1]
 */
export function silhouette1D(pc1, labels, K) {
  const n = pc1.length;
  if (n < K + 1) return 0;
  // Group sample indices by cluster
  const groups = Array.from({ length: K }, () => []);
  for (let i = 0; i < n; i++) groups[labels[i]].push(i);
  // Drop empty clusters from K-effective for silhouette purposes
  const nonEmpty = groups.filter(g => g.length > 0);
  if (nonEmpty.length < 2) return 0;

  let sumS = 0, count = 0;
  for (let c = 0; c < K; c++) {
    if (groups[c].length === 0) continue;
    const own = groups[c];
    if (own.length === 1) {
      // Convention: singleton silhouette = 0
      count++;
      continue;
    }
    for (const i of own) {
      // a(i): mean distance to others in own cluster
      let a = 0;
      for (const j of own) if (j !== i) a += Math.abs(pc1[i] - pc1[j]);
      a /= (own.length - 1);
      // b(i): min over other non-empty clusters
      let b = Infinity;
      for (let cc = 0; cc < K; cc++) {
        if (cc === c || groups[cc].length === 0) continue;
        let m = 0;
        for (const j of groups[cc]) m += Math.abs(pc1[i] - pc1[j]);
        m /= groups[cc].length;
        if (m < b) b = m;
      }
      const denom = Math.max(a, b);
      sumS += denom > 0 ? (b - a) / denom : 0;
      count++;
    }
  }
  return count > 0 ? sumS / count : 0;
}

// ---------------------------------------------------------------------
// Size balance: entropy of cluster sizes, normalized by log(K_eff).
//   1 = perfectly balanced; 0 = degenerate (one cluster has everything)
// Empty clusters are dropped from K_eff (so K_eff ≤ K).
// ---------------------------------------------------------------------

/**
 * @param {Int8Array|number[]} labels
 * @param {number} K
 * @returns {number}                    ∈ [0, 1]
 */
export function sizeBalance(labels, K) {
  const sizes = new Int32Array(K);
  for (let i = 0; i < labels.length; i++) sizes[labels[i]]++;
  const n = labels.length;
  if (n === 0) return 0;
  let H = 0, K_eff = 0;
  for (let c = 0; c < K; c++) {
    if (sizes[c] === 0) continue;
    K_eff++;
    const p = sizes[c] / n;
    H -= p * Math.log(p);
  }
  if (K_eff < 2) return 0;
  const Hmax = Math.log(K_eff);
  return Hmax > 0 ? H / Hmax : 0;
}

// ---------------------------------------------------------------------
// Eigenvalue-ratio normalizer:
//   ratio = eig1 / eig2 (or eig1 / max(eig2, ε))
//   norm  = 1 - exp(-(ratio - 1) / scale)   for ratio > 1
//         = 0                                otherwise
// At ratio=2: ~0.63. At ratio=4: ~0.95. At ratio=1: 0.
// Captures "PC1 dominates" without a hard threshold.
// ---------------------------------------------------------------------

/**
 * @param {number} eig1
 * @param {number} eig2
 * @param {number} [scale=1.5]
 * @returns {number}                    ∈ [0, 1]
 */
export function eigRatioNorm(eig1, eig2, scale) {
  const s = scale != null ? +scale : 1.5;
  const denom = Math.max(eig2, 1e-9);
  const ratio = eig1 / denom;
  if (ratio <= 1) return 0;
  return 1 - Math.exp(-(ratio - 1) / s);
}

// ---------------------------------------------------------------------
// Combined band_quality at one window.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Float32Array|number[]} args.pc1     sign-aligned PC1 (n_samples)
 * @param {Int8Array|number[]} args.labels     K-means labels (n_samples)
 * @param {number} args.K                       K used for clustering
 * @param {number} args.eig1
 * @param {number} args.eig2
 * @param {object} [opts]
 * @param {number} [opts.eig_scale=1.5]
 * @returns {{
 *   band_quality: number,    // ∈ [0, 1]
 *   silhouette:   number,    // ∈ [-1, 1]
 *   silhouette_norm: number, // clamped to [0, 1]
 *   size_balance: number,    // ∈ [0, 1]
 *   eig_ratio:    number,
 *   eig_ratio_norm: number,
 *   K_eff:        number,    // number of non-empty clusters
 * }}
 */
export function bandQualityForWindow(args, opts) {
  opts = opts || {};
  const sil = silhouette1D(args.pc1, args.labels, args.K);
  const silN = Math.max(0, Math.min(1, sil));
  const sb = sizeBalance(args.labels, args.K);
  const er = (args.eig1 ?? 0) / Math.max(args.eig2 ?? 1, 1e-9);
  const erN = eigRatioNorm(args.eig1, args.eig2, opts.eig_scale);

  // K_eff
  const sizes = new Int32Array(args.K);
  for (let i = 0; i < args.labels.length; i++) sizes[args.labels[i]]++;
  let K_eff = 0;
  for (let c = 0; c < args.K; c++) if (sizes[c] > 0) K_eff++;

  const bq = Math.min(silN, sb, erN);
  return {
    band_quality: bq,
    silhouette: sil,
    silhouette_norm: silN,
    size_balance: sb,
    eig_ratio: er,
    eig_ratio_norm: erN,
    K_eff,
  };
}

// ---------------------------------------------------------------------
// Genome-wide pass: compute band_quality for every window.
//
// Caller supplies a per-window accessor. Output is one record per
// window in chromosomal order, suitable for direct consumption by
// chain_walk.js.
// ---------------------------------------------------------------------

/**
 * @param {object} ctx                             ClusterContext-like
 * @param {(w:number) => {pc1:Float32Array,
 *                        labels:Int8Array,
 *                        K:number,
 *                        eig1:number, eig2:number}} getWindow
 * @param {number} n_windows
 * @param {object} [opts]
 * @returns {Array<{w:number} & ReturnType<typeof bandQualityForWindow>>}
 */
export function bandQualityGenomeWide(ctx, getWindow, n_windows, opts) {
  const out = [];
  for (let w = 0; w < n_windows; w++) {
    const args = getWindow(w);
    if (!args) { out.push({ w, band_quality: 0, K_eff: 0,
                            silhouette: 0, silhouette_norm: 0,
                            size_balance: 0, eig_ratio: 0,
                            eig_ratio_norm: 0 }); continue; }
    const r = bandQualityForWindow(args, opts);
    out.push({ w, ...r });
  }
  return out;
}

// ---------------------------------------------------------------------
// Threshold helper
// ---------------------------------------------------------------------

export function bandQualityPasses(bq, threshold) {
  const t = threshold != null ? +threshold : DEFAULT_BQ_THRESHOLD;
  return bq.band_quality >= t;
}

export const BAND_QUALITY_DEFAULTS = Object.freeze({
  threshold: DEFAULT_BQ_THRESHOLD,
  eig_scale: 1.5,
});

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._silhouette1D            = silhouette1D;
  window._sizeBalance             = sizeBalance;
  window._eigRatioNorm            = eigRatioNorm;
  window._bandQualityForWindow    = bandQualityForWindow;
  window._bandQualityGenomeWide   = bandQualityGenomeWide;
  window._bandQualityPasses       = bandQualityPasses;
  window._BAND_QUALITY_DEFAULTS   = BAND_QUALITY_DEFAULTS;
}
