// shared/classification_to_tier_axes.js
// =====================================================================
// Adapter: per-candidate classification row (from
// shared/inversion_classification.buildInversionClassificationRow)
// → tier-axes `axisValues` shape consumed by
// pages/review/karyotype_tier/tier_axes.renderTierAxesGrid.
//
// Why this exists: karyotype_tier's Tier subview was designed against the
// cluster-side R-pipeline output (`final_classification.json`). My
// new per-axis primitives + consolidator produce the same data
// content under different vocabularies. This adapter translates so
// the existing renderer + grid layout in karyotype_tier keeps working
// without rewriting; we now have ONE classification view (karyotype_tier)
// fed by EITHER:
//   - state.data.final_classification[<cid>]   (R-pipeline, planned)
//   - the consolidator row, via this adapter   (atlas-side, today)
//
// Five vocab maps (consolidator → legacy TIER_AXES categories):
//   origin_mechanism      → mechanism_class
//   age_my_bracket        → age_class       (numeric My → categorical band)
//   selection_efficacy    → burden_class
//   pangenome_class       → polymorphism_class
//   structure_class       → internal_structure
//
// Eight net-new axes are forwarded as-is to TIER_AXES' new EXTENDED
// group (see pages/review/karyotype_tier/tier_axes.js — TIER_AXES_EXTENDED):
//   copy_origin_verdict, position_class, arrangement_n,
//   recombination_suppression, divergence, xpehh_signal,
//   pangenome_class (also forwarded as `pangenome_class_raw`),
//   evolutionary_role, segregation_status_majority
// =====================================================================

// =====================================================================
// 1. Vocab maps (frozen)
// =====================================================================

/** Spec image set 2 §4 — 4 legacy mechanism categories: NAHR / NHEJ
 *  / MMBIR / unknown. Map my 6 to those slots conservatively: complex
 *  + replication-based fall into MMBIR (the legacy bucket for
 *  template-switching / fork-stalling). */
export const MECHANISM_TO_LEGACY = Object.freeze({
  'NAHR-compatible':                                       'NAHR',
  'TE-mediated (NAHR special case)':                       'NAHR',
  'NHEJ/MMEJ-compatible':                                  'NHEJ',
  'complex paralogue mosaic':                              'MMBIR',
  'replication-based (fork-stalling / template-switching)':'MMBIR',
  'no mosaic evidence':                                    'unknown',
});

/** Spec image set 1 §4 — legacy: young / intermediate / ancient.
 *  Cutoffs chosen so the BUSCO 4D mu_mid example (1.30 My)
 *  classifies as "intermediate" while a "young" 0.4 My split is
 *  visibly distinct. */
export const AGE_NUMERIC_TO_CATEGORICAL_DEFAULTS = Object.freeze({
  young_below_my:    1.0,
  ancient_above_my:  5.0,
});

export const SELECTION_TO_BURDEN = Object.freeze({
  load_rich:  'enriched',
  clean:      'neutral',
  mixed:      'unknown',
});

/** legacy polymorphism_class: cohort_wide / lineage_restricted /
 *  family_restricted / unclassified. Map: general → cohort_wide,
 *  co_shared → lineage_restricted, private → family_restricted. */
export const PANGENOME_TO_POLYMORPHISM = Object.freeze({
  general:    'cohort_wide',
  co_shared:  'lineage_restricted',
  private:    'family_restricted',
  unknown:    'unclassified',
});

/** legacy internal_structure: clean / gradient / composite_undecomposed
 *  / unknown. */
export const STRUCTURE_TO_INTERNAL = Object.freeze({
  simple_haplotype_split:     'clean',
  inversion_dosage_like:      'clean',
  arm_scale_block:            'clean',
  structural_block_like:      'clean',
  nested_or_compound:         'composite_undecomposed',
  compound_inversion_like:    'composite_undecomposed',
  recombination_gradient_like:'gradient',
  noise_or_recombinant:       'unknown',
});

// =====================================================================
// 2. Per-axis translators (pure, missing-tolerant)
// =====================================================================

export function mechanismToLegacy(s) {
  if (!s) return null;
  return MECHANISM_TO_LEGACY[s] || 'unknown';
}

export function ageNumericToCategorical(ageBracket, opts) {
  if (!ageBracket || !Number.isFinite(ageBracket.mu_mid_my)) return null;
  const o = opts || {};
  const young = Number.isFinite(o.young_below_my)
    ? o.young_below_my : AGE_NUMERIC_TO_CATEGORICAL_DEFAULTS.young_below_my;
  const ancient = Number.isFinite(o.ancient_above_my)
    ? o.ancient_above_my : AGE_NUMERIC_TO_CATEGORICAL_DEFAULTS.ancient_above_my;
  const mid = ageBracket.mu_mid_my;
  if (mid < young)   return 'young';
  if (mid > ancient) return 'ancient';
  return 'intermediate';
}

export function selectionToBurden(s) {
  if (!s) return null;
  return SELECTION_TO_BURDEN[s] || 'unknown';
}

export function pangenomeToPolymorphism(pangenome) {
  if (!pangenome || !pangenome.class) return null;
  return PANGENOME_TO_POLYMORPHISM[pangenome.class] || 'unclassified';
}

export function structureToInternal(s) {
  if (!s) return null;
  return STRUCTURE_TO_INTERNAL[s] || 'unknown';
}

// =====================================================================
// 3. Main adapter — consolidator row → tier axisValues
// =====================================================================

/**
 * Take a row from buildInversionClassificationRow and emit the
 * `{axisId → stringValue}` object that renderTierAxesGrid consumes.
 *
 * Missing-tolerant: if an axis is unset on the input row, the
 * corresponding output key is left undefined (renderer shows
 * "— not yet computed" for it).
 *
 * @param {Object} row     output of buildInversionClassificationRow
 * @param {Object} [opts]  forwarded to ageNumericToCategorical
 * @returns {Object|null}  axisValues object, or null when the input
 *                         row is missing.
 */
export function classificationRowToTierAxisValues(row, opts) {
  if (!row || !row.axes) return null;
  const a = row.axes;
  const out = Object.create(null);

  // -------- legacy schema slots (mapped) --------
  const mech = mechanismToLegacy(a.origin_mechanism);
  if (mech)  out.mechanism_class = mech;

  const age = ageNumericToCategorical(a.age_my_bracket, opts);
  if (age)   out.age_class = age;

  const burden = selectionToBurden(a.selection_efficacy);
  if (burden) out.burden_class = burden;

  const poly = pangenomeToPolymorphism(a.pangenome_class);
  if (poly)  out.polymorphism_class = poly;

  const internal = structureToInternal(a.structure_class);
  if (internal) out.internal_structure = internal;

  // -------- EXTENDED group (net-new axes, forwarded as-is) --------
  if (typeof a.copy_origin_verdict === 'string')        out.copy_origin_verdict = a.copy_origin_verdict;
  if (typeof a.position_class === 'string')             out.position_class      = a.position_class;
  if (typeof a.recombination_suppression === 'string')  out.recombination_suppression = a.recombination_suppression;
  if (typeof a.divergence === 'string')                 out.divergence          = a.divergence;
  if (typeof a.xpehh_signal === 'string')               out.xpehh_signal        = a.xpehh_signal;
  if (typeof a.evolutionary_role === 'string')          out.evolutionary_role   = a.evolutionary_role;

  // pangenome_class is mapped above to polymorphism_class; ALSO surface
  // the raw label so the new EXTENDED row can show it directly.
  if (a.pangenome_class && typeof a.pangenome_class.class === 'string') {
    out.pangenome_class_raw = a.pangenome_class.class;
  }
  // arrangement_n is structured; surface the count as a small string.
  if (a.arrangement_n && Number.isFinite(a.arrangement_n.n_arrangements)) {
    out.arrangement_n_raw = String(a.arrangement_n.n_arrangements);
  }
  // segregation_status_majority surface the headline status.
  if (a.segregation_status_majority
      && typeof a.segregation_status_majority.status === 'string') {
    out.segregation_status = a.segregation_status_majority.status;
  }

  return out;
}
