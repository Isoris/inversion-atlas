// shared/mgl_mosaicism_detector.js
// =====================================================================
// Per-sample per-window mosaic / leakage detector for INV chromosomes.
// A site / window looks "leaky" when a HOM-B sample carries the STD-
// like allele combination (or vice versa) — likely the trace of a
// recombination event, gene-conversion patch, or polarity switch
// within an otherwise INV background.
//
// V1 simplification: per-window, count the fraction of informative
// sites at which the sample's dosage matches the STD-class consensus
// rather than the INV-class consensus. Above a threshold → leaky-
// window flag for that sample.
//
// Aggregates:
//   leaky_window_fraction       per sample, fraction of windows flagged
//   sample_leakage_score        normalised 0..1
//   per_window_mean_leakage     across-sample mean leakage per window
//
// Pure compute. No DOM.
// =====================================================================

export const MGL_MOSAICISM_DEFAULTS = Object.freeze({
  window_size_markers:    20,
  carrier_threshold:      0.5,
  per_window_leak_thresh: 0.40,   // sample-window flagged when this much
                                  // of its informative sites match STD
                                  // consensus instead of INV consensus
  min_informative:        4,
});

// =====================================================================
// 1. Per-class consensus per marker
// =====================================================================

/**
 * Mean dosage at each site for each class. Used as a per-site
 * "INV consensus" / "STD consensus" reference.
 *
 * @returns {{inv:Float64Array, std:Float64Array}}
 */
export function classMeansPerSite(args) {
  const a = args || {};
  const n_markers = a.n_markers | 0;
  const n_samples = a.n_samples | 0;
  const inv_mean = new Float64Array(n_markers);
  const std_mean = new Float64Array(n_markers);
  if (!a.dosage) return { inv: inv_mean, std: std_mean };
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
    inv_mean[mi] = si_n > 0 ? si_sum / si_n : NaN;
    let st_sum = 0, st_n = 0;
    if (Array.isArray(a.std_idx)) {
      for (const s of a.std_idx) {
        const v = get(mi, s);
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        st_sum += v; st_n++;
      }
    }
    std_mean[mi] = st_n > 0 ? st_sum / st_n : NaN;
  }
  return { inv: inv_mean, std: std_mean };
}

// =====================================================================
// 2. Per-sample per-window leakage
// =====================================================================

/**
 * For each INV sample × window: among informative sites (where
 * |INV_mean - STD_mean| > 0.5), count the fraction at which the
 * sample's dosage is closer to STD than to INV. Window is
 * "leaky" when that fraction ≥ per_window_leak_thresh.
 *
 * @param {Object} args   dosage / n_markers / n_samples / inv_idx /
 *                        std_idx / opts (window_size_markers,
 *                        per_window_leak_thresh, min_informative)
 * @returns {{
 *   per_sample_per_window:Float64Array,   n_inv × n_windows leakage frac
 *   per_sample_leakage:Float64Array,      n_inv leakage score
 *   per_window_mean:Float64Array,         n_windows across-sample mean
 *   n_inv:number, n_windows:number,
 *   window_starts:Int32Array, window_ends:Int32Array,
 * }}
 */
export function perWindowLeakage(args) {
  const a = args || {};
  const o = a.opts || {};
  const D = MGL_MOSAICISM_DEFAULTS;
  const wsize = Number.isFinite(o.window_size_markers) ? o.window_size_markers : D.window_size_markers;
  const minInf = Number.isFinite(o.min_informative) ? o.min_informative : D.min_informative;
  const leakThr = Number.isFinite(o.per_window_leak_thresh) ? o.per_window_leak_thresh : D.per_window_leak_thresh;
  if (!a.dosage || !Array.isArray(a.inv_idx) || a.inv_idx.length === 0) {
    return { per_sample_per_window: new Float64Array(0),
             per_sample_leakage: new Float64Array(0),
             per_window_mean: new Float64Array(0),
             n_inv: 0, n_windows: 0,
             window_starts: new Int32Array(0), window_ends: new Int32Array(0) };
  }
  const means = classMeansPerSite(a);
  const n_markers = a.n_markers | 0;
  const n_samples = a.n_samples | 0;
  const n_inv = a.inv_idx.length;
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  const get = (mi, si) => isFlat ? a.dosage[mi * n_samples + si] : (a.dosage[mi] && a.dosage[mi][si]);
  const n_windows = Math.ceil(n_markers / wsize);
  const ws = new Int32Array(n_windows);
  const we = new Int32Array(n_windows);
  for (let w = 0; w < n_windows; w++) {
    ws[w] = w * wsize;
    we[w] = Math.min(n_markers, (w + 1) * wsize);
  }
  const psw = new Float64Array(n_inv * n_windows);
  const pwm = new Float64Array(n_windows);
  const pwm_counts = new Int32Array(n_windows);
  for (let pi = 0; pi < n_inv; pi++) {
    const si = a.inv_idx[pi];
    for (let w = 0; w < n_windows; w++) {
      let n_inf = 0, n_closer_std = 0;
      for (let mi = ws[w]; mi < we[w]; mi++) {
        const v = get(mi, si);
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        const mi_inv = means.inv[mi];
        const mi_std = means.std[mi];
        if (!Number.isFinite(mi_inv) || !Number.isFinite(mi_std)) continue;
        if (Math.abs(mi_inv - mi_std) < 0.5) continue;
        n_inf++;
        const d_inv = Math.abs(v - mi_inv);
        const d_std = Math.abs(v - mi_std);
        if (d_std < d_inv) n_closer_std++;
      }
      const frac = n_inf >= minInf ? n_closer_std / n_inf : NaN;
      psw[pi * n_windows + w] = frac;
      if (Number.isFinite(frac)) {
        pwm[w] += frac;
        pwm_counts[w]++;
      }
    }
  }
  // Per-sample leakage = fraction of windows flagged as leaky.
  const psl = new Float64Array(n_inv);
  for (let pi = 0; pi < n_inv; pi++) {
    let n_flagged = 0, n_eval = 0;
    for (let w = 0; w < n_windows; w++) {
      const f = psw[pi * n_windows + w];
      if (!Number.isFinite(f)) continue;
      n_eval++;
      if (f >= leakThr) n_flagged++;
    }
    psl[pi] = n_eval > 0 ? n_flagged / n_eval : NaN;
  }
  for (let w = 0; w < n_windows; w++) {
    pwm[w] = pwm_counts[w] > 0 ? pwm[w] / pwm_counts[w] : NaN;
  }
  return {
    per_sample_per_window: psw,
    per_sample_leakage:    psl,
    per_window_mean:       pwm,
    n_inv, n_windows,
    window_starts: ws, window_ends: we,
  };
}

// =====================================================================
// 3. Integrity verdict
// =====================================================================

/**
 * Aggregate per-sample leakage into a single integrity verdict.
 *
 * @param {Float64Array} per_sample_leakage
 * @param {Object} [opts]    clean_max, leaky_min
 * @returns {{integrity:string, n_clean:number, n_leaky:number,
 *            n_intermediate:number, mean_leakage:number}}
 */
export function integrityVerdict(per_sample_leakage, opts) {
  const o = opts || {};
  const cleanMax = Number.isFinite(o.clean_max)  ? o.clean_max  : 0.10;
  const leakyMin = Number.isFinite(o.leaky_min)  ? o.leaky_min  : 0.30;
  const n = per_sample_leakage ? per_sample_leakage.length : 0;
  let n_clean = 0, n_leaky = 0, n_int = 0, sum = 0, n_eval = 0;
  for (let i = 0; i < n; i++) {
    const v = per_sample_leakage[i];
    if (!Number.isFinite(v)) continue;
    n_eval++; sum += v;
    if (v <= cleanMax)      n_clean++;
    else if (v >= leakyMin) n_leaky++;
    else                    n_int++;
  }
  const mean = n_eval > 0 ? sum / n_eval : NaN;
  let integrity = 'insufficient';
  if (n_eval > 0) {
    if (n_leaky > n_clean && n_leaky > n_int)       integrity = 'leaky';
    else if (n_clean > n_leaky && n_clean > n_int)  integrity = 'clean';
    else                                            integrity = 'mixed';
  }
  return { integrity, n_clean, n_leaky, n_intermediate: n_int, mean_leakage: mean };
}
