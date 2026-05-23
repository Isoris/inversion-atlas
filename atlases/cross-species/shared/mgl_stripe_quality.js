// shared/mgl_stripe_quality.js
// =====================================================================
// Per-sample dosage-coherence + stripe-quality classification for the
// candidate dosage heatmap. Migration of the legacy
// `computeStripeQuality` (STEP29 line 204-262 of the offline
// pipeline) into the new mgl_adapter shared layer.
//
// Inputs:
//   chunk         — { samples:string[], markers:Array, dosage:[][] }
//                   `dosage[marker_idx][sample_idx]` is the integer
//                   dosage (0..2) or -1 / null for NA.
//   sampleGroup   — (sample_idx:number) => 'HOMO_1' | 'HET' | 'HOMO_2'
//                   | null
//   samplePC1     — (sample_idx:number) => number | null  (u-axis
//                   coordinate for centroid_z_score)
//   opts          — optional thresholds (see MGL_STRIPE_QUALITY_DEFAULTS)
//
// Output:
//   Array<{
//     sample:               string,
//     coarse_group:         'HOMO_1' | 'HET' | 'HOMO_2' | 'unknown',
//     agreement_fraction:   number | null,
//     coherence_class:      'coherent' | 'intermediate' | 'discordant'
//                           | 'insufficient',
//     centroid_z_score:     number | null,
//     stripe_quality:       'core' | 'peripheral' | 'junk' | 'unknown',
//     tier_rule:            string  (human-readable rule applied),
//     n_informative_markers:number,
//   }>
//
// Pure compute. No DOM, no fetch.
// =====================================================================

const GROUPS = Object.freeze(['HOMO_1', 'HET', 'HOMO_2']);

/** Coherence + tier thresholds. Mirrors the legacy ladder. */
export const MGL_STRIPE_QUALITY_DEFAULTS = Object.freeze({
  // Marker selection: keep markers whose |HOM2 − HOM1| ≥ max(q75, 0.1).
  abs_delta_quantile:         0.75,
  abs_delta_floor:            0.10,
  // Fallback when too few markers pass the threshold.
  min_informative_markers:    10,
  fallback_top_n:             50,
  // Coherence-class thresholds (HET is laxer than the HOMO bands).
  het_coh_coherent:           0.55,
  het_coh_intermediate:       0.40,
  hom_coh_coherent:           0.70,
  hom_coh_intermediate:       0.45,
  // Centroid-Z gates for the tier ladder.
  het_z_peripheral:           3,
  hom_z_core:                 2,
  hom_z_peripheral:           4,
});

// =====================================================================
// 1. Per-group marker means
// =====================================================================

/**
 * Per-marker mean dosage within each parent-karyotype group, NA-aware.
 *
 * @param {Object} chunk
 * @param {Array<Array<number>>} dosage   chunk.dosage
 * @param {Object<string, number[]>} grpIdx   { HOMO_1: [si, ...], ... }
 * @param {number} n_markers
 * @returns {Object<string, Float64Array>}    per-group per-marker means
 */
export function perGroupMarkerMeans(dosage, grpIdx, n_markers) {
  const out = {};
  for (const g of GROUPS) {
    const idxs = grpIdx[g] || [];
    const buf = new Float64Array(n_markers);
    if (idxs.length < 2) {
      for (let mi = 0; mi < n_markers; mi++) buf[mi] = NaN;
      out[g] = buf;
      continue;
    }
    for (let mi = 0; mi < n_markers; mi++) {
      const row = dosage[mi];
      if (!row) { buf[mi] = NaN; continue; }
      let n = 0, sum = 0;
      for (const si of idxs) {
        const v = row[si];
        if (v == null || !Number.isFinite(v) || v < 0) continue;
        n++; sum += v;
      }
      buf[mi] = (n > 0) ? sum / n : NaN;
    }
    out[g] = buf;
  }
  return out;
}

// =====================================================================
// 2. Informative-marker selection
// =====================================================================

/**
 * Pick informative markers: those whose |HOMO_2 − HOMO_1| separation
 * is at least max(q-quantile, floor). Fall back to top-N by
 * |delta| when fewer than `min_informative_markers` survive.
 *
 * @param {Float64Array} grpMean_HOM1
 * @param {Float64Array} grpMean_HOM2
 * @param {Object} [opts]
 * @returns {{info_idx:number[], abs_delta:Float64Array}}
 */
export function selectInformativeMarkers(grpMean_HOM1, grpMean_HOM2, opts) {
  const o = opts || {};
  const D = MGL_STRIPE_QUALITY_DEFAULTS;
  const n_markers = (grpMean_HOM1 && grpMean_HOM1.length) || 0;
  const absDelta = new Float64Array(n_markers);
  for (let mi = 0; mi < n_markers; mi++) {
    const d = grpMean_HOM2[mi] - grpMean_HOM1[mi];
    absDelta[mi] = Number.isFinite(d) ? Math.abs(d) : 0;
  }
  const sorted = Array.from(absDelta).sort((a, b) => a - b);
  const qFrac = Number.isFinite(o.abs_delta_quantile) ? o.abs_delta_quantile : D.abs_delta_quantile;
  const qIdx = Math.floor(sorted.length * qFrac);
  const q = sorted.length > 0 ? sorted[Math.min(qIdx, sorted.length - 1)] : 0;
  const floor = Number.isFinite(o.abs_delta_floor) ? o.abs_delta_floor : D.abs_delta_floor;
  const thresh = Math.max(q, floor);
  let info_idx = [];
  for (let mi = 0; mi < n_markers; mi++) {
    if (absDelta[mi] >= thresh) info_idx.push(mi);
  }
  const min_info = Number.isFinite(o.min_informative_markers)
    ? o.min_informative_markers : D.min_informative_markers;
  if (info_idx.length < min_info) {
    const topN = Number.isFinite(o.fallback_top_n) ? o.fallback_top_n : D.fallback_top_n;
    const ranked = Array.from({ length: n_markers }, (_, mi) => mi);
    ranked.sort((a, b) => absDelta[b] - absDelta[a]);
    info_idx = ranked.slice(0, Math.min(topN, n_markers));
  }
  return { info_idx, abs_delta: absDelta };
}

// =====================================================================
// 3. Median + MAD on a numeric array (NA-aware)
// =====================================================================

/**
 * Returns the median + MAD (median absolute deviation) of finite
 * values; null when no finite values are present.
 *
 * @param {Array<number>} values
 * @returns {{median:number, mad:number} | null}
 */
export function medianAndMad(values) {
  if (!Array.isArray(values)) return null;
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return null;
  v.sort((a, b) => a - b);
  const median = v[(v.length - 1) >> 1];
  const dev = v.map(x => Math.abs(x - median));
  dev.sort((a, b) => a - b);
  const mad = dev[(dev.length - 1) >> 1];
  return { median, mad: mad > 0 ? mad : 1 };
}

// =====================================================================
// 4. End-to-end stripe-quality classification
// =====================================================================

/**
 * Per-sample stripe-quality classification.
 *
 * @param {Object} chunk
 * @param {Function} sampleGroup  (si) => 'HOMO_1'|'HET'|'HOMO_2'|null
 * @param {Function} samplePC1    (si) => number|null
 * @param {Object} [opts]         threshold overrides
 * @returns {Array<Object>}       per-sample classification rows
 */
export function computeStripeQuality(chunk, sampleGroup, samplePC1, opts) {
  if (!chunk || !Array.isArray(chunk.samples) || !Array.isArray(chunk.markers)
      || !Array.isArray(chunk.dosage)) {
    return [];
  }
  const o = opts || {};
  const D = MGL_STRIPE_QUALITY_DEFAULTS;
  const n_samples = chunk.samples.length;
  const n_markers = chunk.markers.length;
  // Group membership.
  const grpOf = new Array(n_samples);
  const grpIdx = { HOMO_1: [], HET: [], HOMO_2: [] };
  for (let si = 0; si < n_samples; si++) {
    const g = sampleGroup(si);
    grpOf[si] = g;
    if (grpIdx[g]) grpIdx[g].push(si);
  }
  // Per-group means.
  const grpMean = perGroupMarkerMeans(chunk.dosage, grpIdx, n_markers);
  // Informative markers.
  const sel = selectInformativeMarkers(grpMean.HOMO_1, grpMean.HOMO_2, opts);
  const info_idx = sel.info_idx;
  // Per-group PC1 median + MAD.
  const pc1Stats = {};
  for (const g of GROUPS) {
    const vals = grpIdx[g].map(samplePC1);
    pc1Stats[g] = medianAndMad(vals);
  }
  // Per-sample loop.
  const out = new Array(n_samples);
  const hetCoh1   = Number.isFinite(o.het_coh_coherent)     ? o.het_coh_coherent     : D.het_coh_coherent;
  const hetCoh2   = Number.isFinite(o.het_coh_intermediate) ? o.het_coh_intermediate : D.het_coh_intermediate;
  const homCoh1   = Number.isFinite(o.hom_coh_coherent)     ? o.hom_coh_coherent     : D.hom_coh_coherent;
  const homCoh2   = Number.isFinite(o.hom_coh_intermediate) ? o.hom_coh_intermediate : D.hom_coh_intermediate;
  const hetZPer   = Number.isFinite(o.het_z_peripheral)     ? o.het_z_peripheral     : D.het_z_peripheral;
  const homZCore  = Number.isFinite(o.hom_z_core)           ? o.hom_z_core           : D.hom_z_core;
  const homZPer   = Number.isFinite(o.hom_z_peripheral)     ? o.hom_z_peripheral     : D.hom_z_peripheral;

  for (let si = 0; si < n_samples; si++) {
    const g = grpOf[si];
    // Agreement fraction: among informative markers, how often is the
    // sample's dosage closer to its own group's mean than to the
    // average of the other two groups?
    let agreeFrac = NaN;
    if (g && grpMean[g] && grpIdx[g].length >= 2) {
      const others = GROUPS.filter(x => x !== g);
      let nValid = 0, nOwnCloser = 0;
      for (const mi of info_idx) {
        const x = chunk.dosage[mi][si];
        if (x == null || !Number.isFinite(x) || x < 0) continue;
        const own = grpMean[g][mi];
        const otherMean = (grpMean[others[0]][mi] + grpMean[others[1]][mi]) / 2;
        if (!Number.isFinite(own) || !Number.isFinite(otherMean)) continue;
        const dOwn   = Math.abs(x - own);
        const dOther = Math.abs(x - otherMean);
        nValid++;
        if (dOwn < dOther) nOwnCloser++;
      }
      if (nValid > 0) agreeFrac = nOwnCloser / nValid;
    }
    // Coherence class.
    let cohClass;
    if (!Number.isFinite(agreeFrac)) {
      cohClass = 'insufficient';
    } else if (g === 'HET') {
      cohClass = (agreeFrac >= hetCoh1) ? 'coherent'
               : (agreeFrac >= hetCoh2) ? 'intermediate'
               : 'discordant';
    } else {
      cohClass = (agreeFrac >= homCoh1) ? 'coherent'
               : (agreeFrac >= homCoh2) ? 'intermediate'
               : 'discordant';
    }
    // Centroid-Z.
    let centroidZ = NaN;
    const pc1 = samplePC1(si);
    if (g && pc1Stats[g] && Number.isFinite(pc1)) {
      centroidZ = (pc1 - pc1Stats[g].median) / pc1Stats[g].mad;
    }
    // Tier rule (mirrors STEP29 lines 252-262).
    let tier;
    if (g === 'HET') {
      tier = (cohClass === 'coherent') ? 'core'
           : (cohClass === 'intermediate' && Number.isFinite(centroidZ) && centroidZ < hetZPer) ? 'peripheral'
           : (cohClass === 'discordant') ? 'junk'
           : 'peripheral';
    } else if (g === 'HOMO_1' || g === 'HOMO_2') {
      tier = (cohClass === 'coherent' && Number.isFinite(centroidZ) && centroidZ < homZCore) ? 'core'
           : ((cohClass === 'coherent' || cohClass === 'intermediate')
              && Number.isFinite(centroidZ) && centroidZ < homZPer) ? 'peripheral'
           : 'junk';
    } else {
      tier = 'unknown';
    }
    out[si] = {
      sample:                chunk.samples[si],
      coarse_group:          g || 'unknown',
      agreement_fraction:    Number.isFinite(agreeFrac) ? agreeFrac : null,
      coherence_class:       cohClass,
      centroid_z_score:      Number.isFinite(centroidZ) ? centroidZ : null,
      stripe_quality:        tier,
      tier_rule:             `coherence=${cohClass};z=${Number.isFinite(centroidZ) ? centroidZ.toFixed(1) : 'NA'};group=${g || 'unknown'}`,
      n_informative_markers: info_idx.length,
    };
  }
  return out;
}

// =====================================================================
// 5. Summary helper
// =====================================================================

/**
 * Roll up the per-sample classification into counts by
 * (coarse_group, stripe_quality).
 *
 * @param {Array<Object>} rows  output of computeStripeQuality
 * @returns {Object<string, Object<string, number>>}
 */
export function stripeQualitySummary(rows) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const g = r.coarse_group || 'unknown';
    const t = r.stripe_quality || 'unknown';
    if (!out[g]) out[g] = { core: 0, peripheral: 0, junk: 0, unknown: 0 };
    if (out[g][t] == null) out[g][t] = 0;
    out[g][t]++;
  }
  return out;
}
