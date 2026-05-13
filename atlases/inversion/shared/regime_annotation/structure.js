// shared/regime_annotation/structure.js
// =====================================================================
// Layer 2 of the regime-annotation spec
// (specs_todo/SPEC_regime_annotation_v34.md §"Layer 2 — Regime
// structure annotation").
//
// Per-regime structural annotation: what does this regime LOOK like?
// Number of macro-bands, regime length, sharpness of boundaries,
// whether the regime nests an internal sub-structure.
//
// Inputs:
//   - regime          a Layer-2 (haplotype_regime.js) regime
//   - structure_meta  per-regime structural metrics from upstream:
//                      {
//                        consensus_partition_M?:  int  macro-band count
//                                                       (from partition_consensus)
//                        band_count?:             int  K from stage3 locus
//                        regime_sharpness?:       float boundary score
//                        internal_nesting?:       bool sub-resolution detection
//                        transition_width_bp?:    int  boundary width
//                        sample_switching_rate?:  float per-window turnover
//                        consensus_class?:        string from Stage-4 consensus
//                                                       (RANDOM_FAN / COHERENT_SPLIT / ...)
//                      }
//   - opts            override defaults: arm_scale_frac, sharp_threshold,
//                      diffuse_threshold (sharpness; opposite of width)
//
// Returns:
//   {
//     number_of_haplotype_regimes,
//     band_count,
//     regime_length_bp,
//     regime_sharpness,
//     internal_nesting,
//     transition_width_bp,
//     sample_switching_rate,
//     boundary_kind:   'sharp' | 'diffuse' | null,
//     label:           one of REGIME_STRUCTURE_LABELS values
//   }
//
// Pure JS — no DOM, no fetch.

/**
 * Structure-label vocab per SPEC §"Layer 2 — Output label" table.
 * Resolution priority (most-specific first):
 *   noise_or_recombinant (RANDOM_FAN from Stage 4) →
 *   compound_inversion_like (nested) →
 *   arm_scale_block (length ≥ arm_scale_frac of chrom arm) →
 *   nested_or_compound (M = 4..6) →
 *   inversion_dosage_like (M = 3) →
 *   simple_haplotype_split (M = 2) →
 *   recombination_gradient_like (diffuse boundaries) →
 *   structural_block_like (sharp boundaries, fallback)
 */
export const REGIME_STRUCTURE_LABELS = Object.freeze({
  SIMPLE_HAPLOTYPE_SPLIT:      'simple_haplotype_split',
  INVERSION_DOSAGE_LIKE:       'inversion_dosage_like',
  NESTED_OR_COMPOUND:          'nested_or_compound',
  STRUCTURAL_BLOCK_LIKE:       'structural_block_like',
  RECOMBINATION_GRADIENT_LIKE: 'recombination_gradient_like',
  COMPOUND_INVERSION_LIKE:     'compound_inversion_like',
  ARM_SCALE_BLOCK:             'arm_scale_block',
  NOISE_OR_RECOMBINANT:        'noise_or_recombinant',
});

/** Defaults per SPEC §"Layer 2". */
export const REGIME_STRUCTURE_DEFAULTS = Object.freeze({
  // Used for arm_scale_block detection — same default as Layer 1
  // positional spec to stay consistent.
  arm_scale_frac:    0.30,
  // Boundary-sharpness thresholds (caller-supplied via opts when
  // calibrated; defaults are placeholder until real data).
  sharp_threshold:   0.70,   // regime_sharpness ≥ this → 'sharp'
  diffuse_threshold: 0.30,   // regime_sharpness ≤ this → 'diffuse'
});

/**
 * Annotate one regime with its structural label.
 *
 * @param {Object} regime
 * @param {Object} structure_meta
 * @param {Object} [opts]
 * @returns {Object|null}
 */
export function annotateRegimeStructure(regime, structure_meta, opts) {
  if (!regime) return null;
  const s = structure_meta || {};
  const o = opts || {};
  const armFrac = Number.isFinite(o.arm_scale_frac)
    ? o.arm_scale_frac : REGIME_STRUCTURE_DEFAULTS.arm_scale_frac;
  const sharpThr = Number.isFinite(o.sharp_threshold)
    ? o.sharp_threshold : REGIME_STRUCTURE_DEFAULTS.sharp_threshold;
  const diffThr = Number.isFinite(o.diffuse_threshold)
    ? o.diffuse_threshold : REGIME_STRUCTURE_DEFAULTS.diffuse_threshold;

  const start_bp = Number.isFinite(regime.start_bp) ? regime.start_bp : 0;
  const end_bp   = Number.isFinite(regime.end_bp)   ? regime.end_bp   : 0;
  const regime_length_bp = Math.max(0, end_bp - start_bp);

  // boundary_kind from regime_sharpness (when populated)
  let boundary_kind = null;
  const sharpness = Number.isFinite(s.regime_sharpness)
    ? s.regime_sharpness : null;
  if (sharpness != null) {
    if (sharpness >= sharpThr)      boundary_kind = 'sharp';
    else if (sharpness <= diffThr)  boundary_kind = 'diffuse';
  }

  // arm_scale: from caller's chromosome arm length when supplied.
  let arm_scale = false;
  if (Number.isFinite(s.arm_length_bp) && s.arm_length_bp > 0) {
    arm_scale = regime_length_bp >= armFrac * s.arm_length_bp;
  }

  // Label resolution
  const M = Number.isFinite(s.consensus_partition_M)
    ? s.consensus_partition_M : null;
  let label;
  if (s.consensus_class === 'RANDOM_FAN') {
    label = REGIME_STRUCTURE_LABELS.NOISE_OR_RECOMBINANT;
  } else if (s.internal_nesting === true) {
    label = REGIME_STRUCTURE_LABELS.COMPOUND_INVERSION_LIKE;
  } else if (arm_scale) {
    label = REGIME_STRUCTURE_LABELS.ARM_SCALE_BLOCK;
  } else if (M != null && M >= 4 && M <= 6) {
    label = REGIME_STRUCTURE_LABELS.NESTED_OR_COMPOUND;
  } else if (M === 3) {
    label = REGIME_STRUCTURE_LABELS.INVERSION_DOSAGE_LIKE;
  } else if (M === 2) {
    label = REGIME_STRUCTURE_LABELS.SIMPLE_HAPLOTYPE_SPLIT;
  } else if (boundary_kind === 'diffuse') {
    label = REGIME_STRUCTURE_LABELS.RECOMBINATION_GRADIENT_LIKE;
  } else {
    // Default fallback when we have no M and no diffuse signature.
    label = REGIME_STRUCTURE_LABELS.STRUCTURAL_BLOCK_LIKE;
  }

  return {
    number_of_haplotype_regimes: M,
    band_count: Number.isFinite(s.band_count) ? s.band_count : null,
    regime_length_bp,
    regime_sharpness: sharpness,
    internal_nesting: s.internal_nesting === true,
    transition_width_bp: Number.isFinite(s.transition_width_bp)
      ? s.transition_width_bp : null,
    sample_switching_rate: Number.isFinite(s.sample_switching_rate)
      ? s.sample_switching_rate : null,
    boundary_kind,
    arm_scale,
    label,
  };
}

/**
 * Annotate a batch of regimes given a per-regime structure_meta
 * lookup. `structureMetaFor(regime)` returns the meta object for
 * one regime, or null when unavailable.
 *
 * @param {Array<Object>} regimes
 * @param {Function|Map|Object} structureMetaFor
 * @param {Object} [opts]
 * @returns {Array<Object|null>}
 */
export function annotateRegimeStructures(regimes, structureMetaFor, opts) {
  if (!Array.isArray(regimes)) return [];
  let getMeta;
  if (typeof structureMetaFor === 'function') getMeta = structureMetaFor;
  else if (structureMetaFor instanceof Map)   getMeta = (r) =>
    structureMetaFor.get(r && r.regime_id != null ? r.regime_id : null);
  else if (structureMetaFor)                  getMeta = (r) =>
    structureMetaFor[r && r.regime_id != null ? r.regime_id : null];
  else                                        getMeta = () => null;
  return regimes.map(r => annotateRegimeStructure(r, getMeta(r), opts));
}
