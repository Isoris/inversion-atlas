// shared/mgl_inversion_divergence.js
// =====================================================================
// Deep-divergence + age-class metrics per inversion candidate.
//
// Inputs:
//   dosage (Float64Array or markers-as-rows) + per-class sample indices
//   for INV and STD chromosomes.
//
// Outputs (per inversion):
//   pi_inv:               mean per-site heterozygosity within INV
//   pi_std:               mean per-site heterozygosity within STD
//   dxy:                  mean per-site between-class allele-frequency
//                          dissimilarity (Hudson-style)
//   fst_hudson:           Hudson FST  (1 − pi_within / pi_between)
//   private_inv:          n sites where INV is polymorphic and STD is
//                          fixed for the alternate allele
//   private_std:          mirror
//   fixed_differences:    n sites where INV is fixed for one allele
//                          and STD is fixed for the opposite
//   age_class:             young_clean / old_divergent /
//                          old_swept / leaky / insufficient
//   age_class_reason:      short string
//
// Pure compute. No DOM.
// =====================================================================

export const MGL_DIVERGENCE_DEFAULTS = Object.freeze({
  fix_threshold:       0.95,      // freq ≥ thr or ≤ 1-thr = "fixed"
  min_called_per_class: 4,
});

// =====================================================================
// 1. Per-site allele frequency by class
// =====================================================================

/**
 * Site-by-site allele frequencies for INV and STD classes.
 *
 * @param {Object} args
 *   dosage, n_markers, n_samples, inv_idx, std_idx
 * @returns {{
 *   freq_inv:Float64Array, freq_std:Float64Array,
 *   n_called_inv:Int32Array, n_called_std:Int32Array,
 * }}
 */
export function perSiteClassFrequencies(args) {
  const a = args || {};
  const n_markers = a.n_markers | 0;
  const n_samples = a.n_samples | 0;
  const fi = new Float64Array(n_markers);
  const fs = new Float64Array(n_markers);
  const ci = new Int32Array(n_markers);
  const cs = new Int32Array(n_markers);
  if (!a.dosage) return { freq_inv: fi, freq_std: fs, n_called_inv: ci, n_called_std: cs };
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  const get = (mi, si) => isFlat ? a.dosage[mi * n_samples + si] : (a.dosage[mi] && a.dosage[mi][si]);
  for (let mi = 0; mi < n_markers; mi++) {
    let si_sum = 0, si_n = 0;
    if (Array.isArray(a.inv_idx)) {
      for (const s of a.inv_idx) {
        const v = get(mi, s);
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        si_sum += v; si_n++;
      }
    }
    let st_sum = 0, st_n = 0;
    if (Array.isArray(a.std_idx)) {
      for (const s of a.std_idx) {
        const v = get(mi, s);
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        st_sum += v; st_n++;
      }
    }
    fi[mi] = si_n > 0 ? si_sum / (2 * si_n) : NaN;
    fs[mi] = st_n > 0 ? st_sum / (2 * st_n) : NaN;
    ci[mi] = si_n; cs[mi] = st_n;
  }
  return { freq_inv: fi, freq_std: fs, n_called_inv: ci, n_called_std: cs };
}

// =====================================================================
// 2. π / dXY / FST (Hudson)
// =====================================================================

/**
 * Per-class mean π (expected heterozygosity), per-site dXY, and a
 * Hudson FST. All metrics drop sites where either class was below
 * the per-class call threshold.
 *
 * @param {Object} freqs   output of perSiteClassFrequencies
 * @param {Object} [opts]  min_called_per_class
 * @returns {{
 *   pi_inv:number, pi_std:number, dxy:number, fst_hudson:number,
 *   n_sites_evaluated:number, n_skipped:number,
 * }}
 */
export function divergenceFromFreqs(freqs, opts) {
  const o = opts || {};
  const D = MGL_DIVERGENCE_DEFAULTS;
  const minCalled = Number.isFinite(o.min_called_per_class)
    ? o.min_called_per_class : D.min_called_per_class;
  const n = freqs.freq_inv.length;
  let sumPiInv = 0, sumPiStd = 0, sumDxy = 0, kept = 0, skipped = 0;
  for (let i = 0; i < n; i++) {
    if (freqs.n_called_inv[i] < minCalled || freqs.n_called_std[i] < minCalled) {
      skipped++; continue;
    }
    const p = freqs.freq_inv[i], q = freqs.freq_std[i];
    if (!Number.isFinite(p) || !Number.isFinite(q)) { skipped++; continue; }
    sumPiInv += 2 * p * (1 - p);
    sumPiStd += 2 * q * (1 - q);
    sumDxy   += p * (1 - q) + q * (1 - p);
    kept++;
  }
  const pi_inv = kept > 0 ? sumPiInv / kept : NaN;
  const pi_std = kept > 0 ? sumPiStd / kept : NaN;
  const dxy    = kept > 0 ? sumDxy   / kept : NaN;
  // Hudson FST = 1 - (pi_inv + pi_std) / (2 * dxy)
  const fst = (kept > 0 && dxy > 0)
    ? 1 - (pi_inv + pi_std) / (2 * dxy)
    : NaN;
  return {
    pi_inv, pi_std, dxy,
    fst_hudson: fst,
    n_sites_evaluated: kept,
    n_skipped: skipped,
  };
}

// =====================================================================
// 3. Private + fixed differences
// =====================================================================

/**
 * Count private and fixed-difference sites.
 *
 *   private_inv: site where INV is polymorphic AND STD is fixed (≈0 or ≈1)
 *   private_std: site where STD is polymorphic AND INV is fixed
 *   fixed_diff:  site where INV fixed for one allele and STD fixed for
 *                 the opposite
 *
 * @param {Object} freqs
 * @param {Object} [opts]   fix_threshold, min_called_per_class
 * @returns {{private_inv:number, private_std:number,
 *            fixed_differences:number}}
 */
export function privateAndFixed(freqs, opts) {
  const o = opts || {};
  const D = MGL_DIVERGENCE_DEFAULTS;
  const thr = Number.isFinite(o.fix_threshold) ? o.fix_threshold : D.fix_threshold;
  const minCalled = Number.isFinite(o.min_called_per_class)
    ? o.min_called_per_class : D.min_called_per_class;
  const n = freqs.freq_inv.length;
  let privInv = 0, privStd = 0, fixed = 0;
  for (let i = 0; i < n; i++) {
    if (freqs.n_called_inv[i] < minCalled || freqs.n_called_std[i] < minCalled) continue;
    const p = freqs.freq_inv[i], q = freqs.freq_std[i];
    if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
    const pFix = (p >= thr || p <= 1 - thr);
    const qFix = (q >= thr || q <= 1 - thr);
    if (!pFix && qFix) privInv++;
    if (pFix && !qFix) privStd++;
    if (pFix && qFix) {
      // Both fixed; do they disagree?
      const pAllele = p >= 0.5 ? 1 : 0;
      const qAllele = q >= 0.5 ? 1 : 0;
      if (pAllele !== qAllele) fixed++;
    }
  }
  return { private_inv: privInv, private_std: privStd, fixed_differences: fixed };
}

// =====================================================================
// 4. Age-class classifier
// =====================================================================

/**
 * Map (pi_inv, pi_std, dxy, fst, private counts, fixed counts) to
 * one of the age classes. Heuristic interpretation table.
 *
 * @param {Object} metrics    output of divergenceFromFreqs ∪ privateAndFixed
 * @returns {{age_class:string, age_class_reason:string}}
 */
export function ageClass(metrics) {
  if (!metrics || !Number.isFinite(metrics.dxy) || !Number.isFinite(metrics.fst_hudson)) {
    return { age_class: 'insufficient', age_class_reason: 'metrics_not_finite' };
  }
  const m = metrics;
  // Working thresholds — conservative defaults; can be calibrated.
  const HIGH_DXY = 0.012;
  const LOW_DXY  = 0.003;
  const HIGH_PI  = 0.008;
  const LOW_PI   = 0.002;
  const HIGH_FST = 0.40;
  const MANY_PRIV = 30;
  const SOME_FIXED = 5;
  // young_clean: low pi_inv (recent expansion), high FST today
  if (m.pi_inv <= LOW_PI && m.fst_hudson >= HIGH_FST && m.dxy < HIGH_DXY) {
    return { age_class: 'young_clean',
             age_class_reason: 'low pi_inv + high FST + shallow dxy' };
  }
  // old_divergent: high pi_inv + high dxy + many private variants
  if (m.pi_inv >= HIGH_PI && m.dxy >= HIGH_DXY && m.private_inv >= MANY_PRIV) {
    return { age_class: 'old_divergent',
             age_class_reason: 'high pi_inv + deep dxy + many private' };
  }
  // old_swept: high dxy but low pi_inv (old but bottlenecked)
  if (m.pi_inv <= LOW_PI && m.dxy >= HIGH_DXY) {
    return { age_class: 'old_swept',
             age_class_reason: 'deep dxy but low pi_inv (sweep / bottleneck)' };
  }
  // leaky: high pi_inv but low dxy (mosaic / gene conversion)
  if (m.pi_inv >= HIGH_PI && m.dxy <= LOW_DXY) {
    return { age_class: 'leaky',
             age_class_reason: 'high pi_inv but shallow dxy (leakage)' };
  }
  // many fixed differences + moderate pi → old divergent (subtype)
  if (m.fixed_differences >= SOME_FIXED && m.dxy >= LOW_DXY) {
    return { age_class: 'old_divergent',
             age_class_reason: 'many fixed differences' };
  }
  return { age_class: 'complex_or_unclear',
           age_class_reason: 'pattern does not match canonical classes' };
}

// =====================================================================
// 5. End-to-end orchestrator
// =====================================================================

/**
 * One-call orchestrator: dosage → all metrics + age class.
 *
 * @param {Object} args   dosage / n_markers / n_samples / inv_idx /
 *                        std_idx / opts
 * @returns {Object}      union of divergence + private/fixed + age_class
 */
export function computeDivergence(args) {
  const a = args || {};
  if (!a.dosage || !(a.n_markers > 0) || !(a.n_samples > 0)
      || !Array.isArray(a.inv_idx) || !Array.isArray(a.std_idx)) {
    return {
      pi_inv: NaN, pi_std: NaN, dxy: NaN, fst_hudson: NaN,
      private_inv: 0, private_std: 0, fixed_differences: 0,
      n_sites_evaluated: 0, n_skipped: 0,
      age_class: 'insufficient', age_class_reason: 'missing_input',
    };
  }
  const freqs = perSiteClassFrequencies(a);
  const div   = divergenceFromFreqs(freqs, a.opts);
  const pvf   = privateAndFixed(freqs, a.opts);
  const merged = Object.assign({}, div, pvf);
  const cls   = ageClass(merged);
  return Object.assign(merged, cls);
}
