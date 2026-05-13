// shared/regime_annotation/positional.js
// =====================================================================
// Layer 1 of the regime-annotation spec
// (specs_todo/SPEC_regime_annotation_v34.md §"Layer 1 — Positional
// annotation").
//
// Per-regime positional annotation: where does this regime sit on its
// chromosome relative to the centromere / telomeres / arm structure?
//
// Inputs:
//   - regime          one Layer-2 (haplotype_regime.js) regime; expects
//                      `chrom`, `start_bp`, `end_bp` fields
//   - chrom_meta      per-chromosome metadata object:
//                      {
//                        length_bp:                int    chromosome length
//                        centromere_start_bp?:     int    centromere call
//                        centromere_end_bp?:       int
//                        arm_lengths?: {p:int, q:int}    optional precomputed
//                      }
//   - opts            override defaults: pericentromeric_window_bp,
//                      subtelomeric_window_bp, arm_scale_frac
//
// Returns:
//   {
//     chrom, start_bp, end_bp, length_bp,
//     nearest_centromere_distance_bp,
//     overlaps_inferred_centromere,
//     overlaps_pericentromeric_window,
//     distance_to_telomere_left_bp,
//     distance_to_telomere_right_bp,
//     subtelomeric,
//     arm_scale,
//     label
//   }
//
// Pure JS — no DOM, no fetch.

/**
 * Positional-label vocab per SPEC §"Layer 1 — Output label".
 * Resolution order: centromeric > pericentromeric > subtelomeric >
 * arm-scale > interstitial. (A regime can in principle satisfy more
 * than one; we pick the most specific.)
 */
export const REGIME_POSITIONAL_LABELS = Object.freeze({
  CENTROMERIC:       'centromeric',
  PERICENTROMERIC:   'pericentromeric',
  SUBTELOMERIC:      'subtelomeric',
  ARM_SCALE:         'arm-scale',
  INTERSTITIAL:      'interstitial',
});

/** Defaults per SPEC §"Defaults to confirm during audit". */
export const REGIME_POSITIONAL_DEFAULTS = Object.freeze({
  pericentromeric_window_bp: 5_000_000,
  subtelomeric_window_bp:    2_000_000,
  arm_scale_frac:            0.30,
});

/**
 * Annotate one regime with its chromosome-positional context.
 *
 * @param {Object} regime
 * @param {Object} chrom_meta
 * @param {Object} [opts]
 * @returns {Object|null}  null when regime / chrom_meta is missing
 *                         the required fields.
 */
export function annotateRegimePosition(regime, chrom_meta, opts) {
  if (!regime || !chrom_meta) return null;
  const start_bp = Number.isFinite(regime.start_bp) ? regime.start_bp : null;
  const end_bp   = Number.isFinite(regime.end_bp)   ? regime.end_bp   : null;
  if (start_bp == null || end_bp == null) return null;

  const o = opts || {};
  const periWin = Number.isFinite(o.pericentromeric_window_bp)
    ? o.pericentromeric_window_bp
    : REGIME_POSITIONAL_DEFAULTS.pericentromeric_window_bp;
  const subWin = Number.isFinite(o.subtelomeric_window_bp)
    ? o.subtelomeric_window_bp
    : REGIME_POSITIONAL_DEFAULTS.subtelomeric_window_bp;
  const armFrac = Number.isFinite(o.arm_scale_frac)
    ? o.arm_scale_frac
    : REGIME_POSITIONAL_DEFAULTS.arm_scale_frac;

  const length_bp = Math.max(0, end_bp - start_bp);
  const chromLen = Number.isFinite(chrom_meta.length_bp)
    ? chrom_meta.length_bp : null;
  const cStart = Number.isFinite(chrom_meta.centromere_start_bp)
    ? chrom_meta.centromere_start_bp : null;
  const cEnd   = Number.isFinite(chrom_meta.centromere_end_bp)
    ? chrom_meta.centromere_end_bp : null;

  // Centromere overlap + nearest-centromere distance
  let nearest_centromere_distance_bp = null;
  let overlaps_inferred_centromere = false;
  let overlaps_pericentromeric_window = false;
  if (cStart != null && cEnd != null) {
    const overlap = !(end_bp < cStart || start_bp > cEnd);
    overlaps_inferred_centromere = overlap;
    if (overlap) {
      nearest_centromere_distance_bp = 0;
    } else if (end_bp < cStart) {
      nearest_centromere_distance_bp = cStart - end_bp;
    } else {
      nearest_centromere_distance_bp = start_bp - cEnd;
    }
    overlaps_pericentromeric_window =
      nearest_centromere_distance_bp <= periWin;
  }

  // Telomere distances
  let distance_to_telomere_left_bp = null;
  let distance_to_telomere_right_bp = null;
  let subtelomeric = false;
  if (chromLen != null) {
    distance_to_telomere_left_bp  = start_bp;
    distance_to_telomere_right_bp = Math.max(0, chromLen - end_bp);
    subtelomeric = distance_to_telomere_left_bp  <= subWin
                || distance_to_telomere_right_bp <= subWin;
  }

  // Arm-scale: regime length ≥ arm_scale_frac × arm length
  // Use the arm the regime midpoint sits in (p arm = before centromere,
  // q arm = after). When no centromere data, fall back to chromosome
  // length / 2 as a rough arm estimator.
  let arm_scale = false;
  if (chromLen != null) {
    let arm_len = chromLen / 2;
    if (chrom_meta.arm_lengths) {
      const mid = 0.5 * (start_bp + end_bp);
      if (cStart != null && mid < cStart && Number.isFinite(chrom_meta.arm_lengths.p)) {
        arm_len = chrom_meta.arm_lengths.p;
      } else if (cEnd != null && mid > cEnd && Number.isFinite(chrom_meta.arm_lengths.q)) {
        arm_len = chrom_meta.arm_lengths.q;
      }
    } else if (cStart != null && cEnd != null) {
      const mid = 0.5 * (start_bp + end_bp);
      arm_len = mid < cStart ? cStart : (chromLen - cEnd);
    }
    arm_scale = length_bp >= armFrac * arm_len;
  }

  // Resolve label per SPEC priority (most specific wins).
  let label;
  if (overlaps_inferred_centromere)        label = REGIME_POSITIONAL_LABELS.CENTROMERIC;
  else if (overlaps_pericentromeric_window) label = REGIME_POSITIONAL_LABELS.PERICENTROMERIC;
  else if (subtelomeric)                    label = REGIME_POSITIONAL_LABELS.SUBTELOMERIC;
  else if (arm_scale)                       label = REGIME_POSITIONAL_LABELS.ARM_SCALE;
  else                                      label = REGIME_POSITIONAL_LABELS.INTERSTITIAL;

  return {
    chrom: regime.chrom || chrom_meta.chrom || null,
    start_bp, end_bp, length_bp,
    nearest_centromere_distance_bp,
    overlaps_inferred_centromere,
    overlaps_pericentromeric_window,
    distance_to_telomere_left_bp,
    distance_to_telomere_right_bp,
    subtelomeric,
    arm_scale,
    label,
  };
}

/**
 * Annotate a batch of regimes given a per-chrom metadata map.
 *
 * @param {Array<Object>} regimes
 * @param {Map<string, Object>|Object} chromMetaMap   chrom_id → chrom_meta
 * @param {Object} [opts]
 * @returns {Array<Object|null>}
 */
export function annotateRegimePositions(regimes, chromMetaMap, opts) {
  if (!Array.isArray(regimes)) return [];
  const getMeta = chromMetaMap instanceof Map
    ? (k) => chromMetaMap.get(k)
    : (k) => chromMetaMap ? chromMetaMap[k] : null;
  return regimes.map(r => {
    const chrom = r ? (r.chrom || null) : null;
    const meta = chrom != null ? getMeta(chrom) : null;
    return annotateRegimePosition(r, meta, opts);
  });
}
