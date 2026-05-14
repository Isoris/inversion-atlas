// shared/mgl_founder_consensus.js
// =====================================================================
// Per-site founder-like / MRCA-like consensus for the inversion
// arrangement. Given a per-sample dosage matrix and a class-membership
// vector telling us which samples are INV chromosomes (HOM_B + INV
// haps of HET if available), this module emits a single consensus
// row per site with:
//   - major allele (counted as dosage > 1.0 = derived, dosage < 1.0 = ref)
//   - allele frequency
//   - confidence tier  (high / medium / low / ambiguous / suspicious)
//   - reason code      (free-form short string)
//
// Two reconstructions are output side-by-side:
//   INV_present_consensus  — naive majority across all INV chromosomes
//   INV_sample_MRCA_like   — same vote weighted by an optional
//                             tree-root inverse-frequency prior; falls
//                             back to present-consensus when no
//                             tree is given (V1 stop-gap).
//
// Pure compute. No DOM, no fetch.
// =====================================================================

/** Confidence tiers. */
export const MGL_FOUNDER_TIERS = Object.freeze([
  'high', 'medium', 'low', 'ambiguous', 'suspicious',
]);

/** Reason codes. */
export const MGL_FOUNDER_REASONS = Object.freeze({
  FIXED_DERIVED:      'fixed_derived',     // freq ≥ 0.95 derived
  FIXED_REFERENCE:    'fixed_reference',   // freq ≤ 0.05 derived
  HIGH_FREQ:          'high_freq',         // 0.80 ≤ freq < 0.95 or 0.05 < freq ≤ 0.20
  MIXED:              'mixed',             // 0.20 < freq < 0.80
  HIGH_MISSINGNESS:   'high_missingness',  // > 30% NA among INV
  POSSIBLE_MOSAIC:    'possible_mosaic',   // freq close to STD-class freq
});

/** Defaults. */
export const MGL_FOUNDER_DEFAULTS = Object.freeze({
  tier_high:           0.95,
  tier_medium:         0.80,
  tier_low:            0.60,
  missingness_max:     0.30,
  mosaic_distance_max: 0.10,
});

// =====================================================================
// 1. Per-site frequency among a class
// =====================================================================

/**
 * Allele frequency (derived) at one site within a class. Each sample
 * contributes its dosage in [0..2], so the per-site freq is sum/(2n)
 * after dropping NA/-1 entries.
 *
 * @param {Float64Array|number[]} dosage_row   length = n_samples
 * @param {number[]} class_idx                 indices in dosage_row
 * @returns {{freq:number, n_called:number, n_missing:number}}
 */
export function siteFrequency(dosage_row, class_idx) {
  if (!dosage_row || !Array.isArray(class_idx)) {
    return { freq: NaN, n_called: 0, n_missing: 0 };
  }
  let sum = 0, called = 0, missing = 0;
  for (const si of class_idx) {
    const v = dosage_row[si];
    if (v == null || !Number.isFinite(v) || v < 0) { missing++; continue; }
    sum += v;
    called++;
  }
  return {
    freq:       called > 0 ? sum / (2 * called) : NaN,
    n_called:   called,
    n_missing:  missing,
  };
}

// =====================================================================
// 2. Tier + reason classifier for one site
// =====================================================================

/**
 * Classify a single site into a tier + reason, given the derived
 * allele frequency among INV chromosomes (plus optional STD-class
 * frequency for the mosaic check) and the missingness fraction.
 *
 * @param {number} freq_inv         derived freq among INV
 * @param {number} missing_frac     [0..1]
 * @param {Object} [opts]
 *   freq_std?:               number          STD-class derived freq
 *   tier_high?:              number
 *   tier_medium?:            number
 *   tier_low?:               number
 *   missingness_max?:        number
 *   mosaic_distance_max?:    number
 * @returns {{tier:string, reason:string, call:number|null}}
 *   call: 1 = derived, 0 = reference, null = ambiguous/suspicious
 */
export function classifySite(freq_inv, missing_frac, opts) {
  const o = opts || {};
  const D = MGL_FOUNDER_DEFAULTS;
  const tHigh   = Number.isFinite(o.tier_high)   ? o.tier_high   : D.tier_high;
  const tMed    = Number.isFinite(o.tier_medium) ? o.tier_medium : D.tier_medium;
  const tLow    = Number.isFinite(o.tier_low)    ? o.tier_low    : D.tier_low;
  const missCap = Number.isFinite(o.missingness_max) ? o.missingness_max : D.missingness_max;
  const mosaicCap = Number.isFinite(o.mosaic_distance_max)
    ? o.mosaic_distance_max : D.mosaic_distance_max;

  if (!Number.isFinite(freq_inv)) {
    return { tier: 'suspicious', reason: MGL_FOUNDER_REASONS.HIGH_MISSINGNESS, call: null };
  }
  if (missing_frac > missCap) {
    return { tier: 'suspicious', reason: MGL_FOUNDER_REASONS.HIGH_MISSINGNESS,
             call: null };
  }
  // Distance to the symmetry centre (0.5).
  const distFromMid = Math.abs(freq_inv - 0.5);
  // Tier by closeness to 0 or 1.
  if (freq_inv >= tHigh) {
    return { tier: 'high', reason: MGL_FOUNDER_REASONS.FIXED_DERIVED, call: 1 };
  }
  if (freq_inv <= 1 - tHigh) {
    return { tier: 'high', reason: MGL_FOUNDER_REASONS.FIXED_REFERENCE, call: 0 };
  }
  // Possible mosaic check (only relevant when STD is supplied and
  // INV freq sits close to STD freq — site looks like it leaked).
  if (Number.isFinite(o.freq_std)
      && Math.abs(freq_inv - o.freq_std) <= mosaicCap
      && distFromMid >= 0.30) {
    // Strong-looking site that nonetheless matches STD's pattern.
    return { tier: 'suspicious', reason: MGL_FOUNDER_REASONS.POSSIBLE_MOSAIC,
             call: freq_inv >= 0.5 ? 1 : 0 };
  }
  if (freq_inv >= tMed) {
    return { tier: 'medium', reason: MGL_FOUNDER_REASONS.HIGH_FREQ, call: 1 };
  }
  if (freq_inv <= 1 - tMed) {
    return { tier: 'medium', reason: MGL_FOUNDER_REASONS.HIGH_FREQ, call: 0 };
  }
  if (freq_inv >= tLow) {
    return { tier: 'low', reason: MGL_FOUNDER_REASONS.HIGH_FREQ, call: 1 };
  }
  if (freq_inv <= 1 - tLow) {
    return { tier: 'low', reason: MGL_FOUNDER_REASONS.HIGH_FREQ, call: 0 };
  }
  return { tier: 'ambiguous', reason: MGL_FOUNDER_REASONS.MIXED, call: null };
}

// =====================================================================
// 3. End-to-end consensus builder
// =====================================================================

/**
 * Compute the founder-like / MRCA-like consensus across all sites.
 *
 * @param {Object} args
 * @param {Float64Array|Array<number[]|Float64Array>} args.dosage
 *   Either row-major Float64Array(n_markers * n_samples), or
 *   markers-as-rows Array<Array|Float64Array>. Both shapes accepted.
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {number[]} args.inv_idx     INV-class sample indices
 * @param {number[]} [args.std_idx]   STD-class sample indices (optional;
 *                                    enables possible-mosaic check)
 * @param {string[]} [args.marker_labels]
 * @param {Object} [args.opts]
 * @returns {{
 *   sites:Array<{
 *     site_idx:number, label:string,
 *     freq_inv:number, freq_std:number|null,
 *     n_called_inv:number, n_missing_inv:number,
 *     present_consensus:{tier:string, reason:string, call:number|null},
 *     mrca_like:{tier:string, reason:string, call:number|null},
 *   }>,
 *   n_high:number, n_medium:number, n_low:number,
 *   n_ambiguous:number, n_suspicious:number,
 * }}
 */
export function computeFounderConsensus(args) {
  const a = args || {};
  if (!a.dosage || !(a.n_markers > 0) || !(a.n_samples > 0)
      || !Array.isArray(a.inv_idx) || a.inv_idx.length === 0) {
    return { sites: [], n_high: 0, n_medium: 0, n_low: 0,
             n_ambiguous: 0, n_suspicious: 0 };
  }
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  const getRow = (mi) => {
    if (!isFlat) return a.dosage[mi];
    const off = mi * a.n_samples;
    return a.dosage.subarray(off, off + a.n_samples);
  };
  const opts = a.opts || {};
  const out = { sites: new Array(a.n_markers),
                n_high: 0, n_medium: 0, n_low: 0,
                n_ambiguous: 0, n_suspicious: 0 };
  for (let mi = 0; mi < a.n_markers; mi++) {
    const row = getRow(mi);
    const inv = siteFrequency(row, a.inv_idx);
    const std = Array.isArray(a.std_idx) ? siteFrequency(row, a.std_idx)
                                          : { freq: null, n_called: 0, n_missing: 0 };
    const missing_frac = (inv.n_called + inv.n_missing) > 0
      ? inv.n_missing / (inv.n_called + inv.n_missing) : 1;
    const siteOpts = Number.isFinite(std.freq) ? Object.assign({}, opts, { freq_std: std.freq }) : opts;
    const present = classifySite(inv.freq, missing_frac, siteOpts);
    // MRCA-like is identical to present-consensus when no tree-root
    // prior is supplied. V1 stop-gap until we wire a per-site root
    // estimator.
    const mrca    = present;
    const label   = (a.marker_labels && a.marker_labels[mi]) || ('M' + mi);
    out.sites[mi] = {
      site_idx:      mi,
      label,
      freq_inv:      inv.freq,
      freq_std:      Number.isFinite(std.freq) ? std.freq : null,
      n_called_inv:  inv.n_called,
      n_missing_inv: inv.n_missing,
      present_consensus: present,
      mrca_like:         mrca,
    };
    if      (present.tier === 'high')       out.n_high++;
    else if (present.tier === 'medium')     out.n_medium++;
    else if (present.tier === 'low')        out.n_low++;
    else if (present.tier === 'ambiguous')  out.n_ambiguous++;
    else                                    out.n_suspicious++;
  }
  return out;
}

// =====================================================================
// 4. Compress the per-site consensus into a single dosage-row
//    suitable for piping into the existing dosage-heatmap renderer
//    as an additional consensus "sample".
// =====================================================================

/**
 * Turn a computed consensus into a {dosage_row, mask_row} pair where
 * dosage_row[mi] ∈ {0, 1, 2, NaN} and mask_row[mi] encodes the tier
 * (numeric: 4=high … 0=suspicious) so a renderer can dim or stripe
 * low-confidence sites.
 *
 * @param {Object} consensus     output of computeFounderConsensus
 * @param {string} which         'present_consensus' (default) or 'mrca_like'
 * @returns {{dosage_row:Float64Array, mask_row:Int8Array}}
 */
export function consensusToDosageRow(consensus, which) {
  const key = (which === 'mrca_like') ? 'mrca_like' : 'present_consensus';
  if (!consensus || !Array.isArray(consensus.sites)) {
    return { dosage_row: new Float64Array(0), mask_row: new Int8Array(0) };
  }
  const n = consensus.sites.length;
  const dosage_row = new Float64Array(n);
  const mask_row = new Int8Array(n);
  const tierToMask = { high: 4, medium: 3, low: 2, ambiguous: 1, suspicious: 0 };
  for (let mi = 0; mi < n; mi++) {
    const s = consensus.sites[mi];
    const cls = s && s[key];
    if (!cls || cls.call == null) { dosage_row[mi] = NaN; mask_row[mi] = 0; continue; }
    // Map call 0→0, 1→2 (a "consensus chromosome" is homozygous for
    // the called allele, so dosage = 0 or 2).
    dosage_row[mi] = cls.call === 1 ? 2 : 0;
    mask_row[mi]   = tierToMask[cls.tier] != null ? tierToMask[cls.tier] : 0;
  }
  return { dosage_row, mask_row };
}
