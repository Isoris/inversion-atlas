// shared/inversion_classification.js
// =====================================================================
// Per-candidate classification consolidator. Takes a candidate +
// pre-computed per-axis inputs and emits a single unified row the
// classification page renders.
//
// This module is intentionally a THIN bridge — it owns no math, only
// the mapping "which axis comes from which producer" + missing-axis
// handling + the schema the page consumes.
//
// Producer modules per axis (all already shipped):
//
//   AXIS                          | producer
//   ----------------------------- | -------------------------------------------
//   origin_mechanism              | copy_origin_painting.classifyBreakpointMechanism
//   copy_origin_verdict           | copy_origin_painting.summarizeArrangementCopyOrigin
//   position_class                | regime_annotation/positional.annotateRegimePosition
//   structure_class               | regime_annotation/structure.annotateRegimeStructure
//   selection_efficacy            | functional_burden.summarizeCandidateFunctionalBurden
//   age_my_bracket                | busco_4d_age.buildBuscoAgeBracketsBlock
//   segregation_status_majority   | mendelian_family_test.testFamilyCandidate (rolled up across families)
//   divergence                    | inversion_classification_axes.classifyCandidateDivergence
//   xpehh_signal                  | inversion_classification_axes.classifyCandidateXpehhSignal
//   arrangement_n                 | arrangement_calls.tabulateArrangementSizes
//
// The consolidator does NOT call the producers itself. The caller
// passes in producer outputs (or null/undefined when the layer is
// missing). The output row records which axes were actually present
// and a `coverage` score (n_present / n_total). The page can use
// `coverage < threshold` to dim or hide candidates that haven't been
// fully classified.
// =====================================================================

import {
  SEGREGATION_STATUS,
} from './mendelian_family_test.js';

// =====================================================================
// Schema
// =====================================================================

/** The 10 classification axes this consolidator emits. Order is the
 *  display order the classification page will tile across. */
export const CLASSIFICATION_AXES = Object.freeze([
  'origin_mechanism',
  'copy_origin_verdict',
  'position_class',
  'structure_class',
  'selection_efficacy',
  'age_my_bracket',
  'segregation_status_majority',
  'divergence',
  'xpehh_signal',
  'arrangement_n',
]);

/** Sentinel for axes with no producer output / missing layer. */
export const AXIS_MISSING = null;

/** Module version for the row schema. */
export const INVERSION_CLASSIFICATION_VERSION = 'inversion_classification_v1.0';

// =====================================================================
// 1. Per-axis extractors — pure, missing-tolerant
// =====================================================================

/** Origin mechanism from copy_origin_painting's classifyBreakpointMechanism
 *  output. Returns the `.label` string or null. */
export function extractOriginMechanism(mech) {
  if (!mech || typeof mech !== 'object') return AXIS_MISSING;
  return mech.label || AXIS_MISSING;
}

/** Copy-origin verdict from summarizeArrangementCopyOrigin output. */
export function extractCopyOriginVerdict(summary) {
  if (!summary || typeof summary !== 'object') return AXIS_MISSING;
  return summary.verdict || AXIS_MISSING;
}

/** Position class from annotateRegimePosition output. */
export function extractPositionClass(positional) {
  if (!positional || typeof positional !== 'object') return AXIS_MISSING;
  return positional.label || AXIS_MISSING;
}

/** Structure class from annotateRegimeStructure output. */
export function extractStructureClass(structure) {
  if (!structure || typeof structure !== 'object') return AXIS_MISSING;
  return structure.label || AXIS_MISSING;
}

/** Selection-efficacy composite tag from
 *  summarizeCandidateFunctionalBurden output. */
export function extractSelectionEfficacy(burden) {
  if (!burden || typeof burden !== 'object') return AXIS_MISSING;
  return burden.summary_tag || AXIS_MISSING;
}

/**
 * Age bracket from busco_4d_age.buildBuscoAgeBracketsBlock output.
 * Returns null when the producer gated (n_4d_sites < 200) or any μ
 * block is missing.
 *
 * Output: {mu_low_my, mu_mid_my, mu_high_my, n_4d_sites, ci95_mid}
 * — the page renders the mid as the headline, low/high as bounds.
 */
export function extractAgeMyBracket(buscoBlock) {
  if (!buscoBlock || typeof buscoBlock !== 'object') return AXIS_MISSING;
  if (!buscoBlock.mu_low || !buscoBlock.mu_mid || !buscoBlock.mu_high) return AXIS_MISSING;
  return {
    mu_low_my:  buscoBlock.mu_low.age_my,
    mu_mid_my:  buscoBlock.mu_mid.age_my,
    mu_high_my: buscoBlock.mu_high.age_my,
    ci95_mid:   buscoBlock.mu_mid.age_my_ci95,
    n_4d_sites: buscoBlock.n_4d_sites_used,
  };
}

/**
 * Majority segregation status across a candidate's family rows.
 *
 * Includes only reliability ≥ medium per the family-test spec §4.1.
 * Returns null when zero qualifying families.
 *
 * @param {Array<Object>} familyRows  testFamilyCandidate outputs
 *                                     filtered to this candidate
 * @returns {{status:string, n_families:number, n_mendelian:number,
 *            n_distorted:number, n_other:number}|null}
 */
export function extractSegregationStatusMajority(familyRows) {
  if (!Array.isArray(familyRows) || familyRows.length === 0) return AXIS_MISSING;
  const counts = Object.create(null);
  let n_med = 0;
  for (const row of familyRows) {
    if (!row) continue;
    if (row.reliability !== 'high' && row.reliability !== 'medium') continue;
    const s = row.segregation_status;
    if (!s) continue;
    counts[s] = (counts[s] || 0) + 1;
    n_med++;
  }
  if (n_med === 0) return AXIS_MISSING;
  let best = null, bestN = -1;
  for (const [s, c] of Object.entries(counts)) {
    if (c > bestN) { best = s; bestN = c; }
  }
  return {
    status:        best,
    n_families:    n_med,
    n_mendelian:   counts[SEGREGATION_STATUS.MENDELIAN]    || 0,
    n_distorted:   counts[SEGREGATION_STATUS.DISTORTED]    || 0,
    n_other:       n_med - (counts[SEGREGATION_STATUS.MENDELIAN] || 0)
                         - (counts[SEGREGATION_STATUS.DISTORTED] || 0),
  };
}

/** Divergence axis label (passthrough from classifyCandidateDivergence). */
export function extractDivergence(label) {
  if (label == null || typeof label !== 'string') return AXIS_MISSING;
  return label;
}

/** XP-EHH selection signal (passthrough). */
export function extractXpehhSignal(label) {
  if (label == null || typeof label !== 'string') return AXIS_MISSING;
  return label;
}

/**
 * Arrangement count from arrangement_calls.tabulateArrangementSizes.
 * Returns {n_arrangements, n_uncalled, fraction_uncalled} or null.
 */
export function extractArrangementN(tab) {
  if (!tab || typeof tab !== 'object') return AXIS_MISSING;
  const sizes = Array.isArray(tab.arrangement_sizes) ? tab.arrangement_sizes : null;
  if (!sizes) return AXIS_MISSING;
  const n_total = (tab.n_samples != null) ? tab.n_samples : sizes.reduce((a, b) => a + b, 0) + (tab.n_uncalled || 0);
  return {
    n_arrangements:   sizes.length,
    n_uncalled:       tab.n_uncalled || 0,
    fraction_uncalled: n_total > 0 ? (tab.n_uncalled || 0) / n_total : 0,
  };
}

// =====================================================================
// 2. Consolidator
// =====================================================================

/**
 * Build the per-candidate classification row.
 *
 * @param {Object} candidate
 *   { candidate_id, chrom, start_bp, end_bp, inversion_type? }
 *
 * @param {Object} inputs
 *   {
 *     breakpoint_mechanism:    output of classifyBreakpointMechanism,
 *     copy_origin_summary:     output of summarizeArrangementCopyOrigin,
 *     regime_position:         output of annotateRegimePosition,
 *     regime_structure:        output of annotateRegimeStructure,
 *     functional_burden:       output of summarizeCandidateFunctionalBurden,
 *     busco_4d_age:            output of buildBuscoAgeBracketsBlock,
 *     family_rows:             Array<testFamilyCandidate output> for this candidate,
 *     divergence_label:        output of classifyCandidateDivergence,
 *     xpehh_label:             output of classifyCandidateXpehhSignal,
 *     arrangement_sizes:       output of tabulateArrangementSizes,
 *   }
 *
 * Returns a row matching the schema:
 *
 *   {
 *     candidate_id, chrom, start_bp, end_bp, inversion_type,
 *     axes: { <CLASSIFICATION_AXES key> → value or null },
 *     coverage: { n_present, n_total, fraction },
 *     created_at, module_version,
 *   }
 */
export function buildInversionClassificationRow(candidate, inputs) {
  const c = candidate || {};
  const i = inputs || {};

  const axes = {
    origin_mechanism:             extractOriginMechanism(i.breakpoint_mechanism),
    copy_origin_verdict:          extractCopyOriginVerdict(i.copy_origin_summary),
    position_class:               extractPositionClass(i.regime_position),
    structure_class:              extractStructureClass(i.regime_structure),
    selection_efficacy:           extractSelectionEfficacy(i.functional_burden),
    age_my_bracket:               extractAgeMyBracket(i.busco_4d_age),
    segregation_status_majority:  extractSegregationStatusMajority(i.family_rows),
    divergence:                   extractDivergence(i.divergence_label),
    xpehh_signal:                 extractXpehhSignal(i.xpehh_label),
    arrangement_n:                extractArrangementN(i.arrangement_sizes),
  };

  let n_present = 0;
  for (const k of CLASSIFICATION_AXES) {
    if (axes[k] !== AXIS_MISSING) n_present++;
  }
  const n_total = CLASSIFICATION_AXES.length;

  return {
    candidate_id:    c.candidate_id || null,
    chrom:           c.chrom || null,
    start_bp:        Number.isFinite(c.start_bp) ? c.start_bp : null,
    end_bp:          Number.isFinite(c.end_bp)   ? c.end_bp   : null,
    inversion_type:  c.inversion_type || 'unknown',
    axes,
    coverage: {
      n_present, n_total,
      fraction: n_total > 0 ? n_present / n_total : 0,
    },
    created_at:      new Date().toISOString(),
    module_version:  INVERSION_CLASSIFICATION_VERSION,
  };
}

// =====================================================================
// 3. Bulk producer + filter helpers (page-side conveniences)
// =====================================================================

/**
 * Build classification rows for many candidates.
 *
 * @param {Array<{candidate:Object, inputs:Object}>} pairs
 * @returns {Array<Object>}
 */
export function buildClassificationRows(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map(p => buildInversionClassificationRow(p && p.candidate, p && p.inputs));
}

/**
 * Filter rows to those meeting a minimum coverage threshold (fraction
 * of axes with non-null values).
 *
 * @param {Array<Object>} rows
 * @param {number} minFraction   default 0.5
 * @returns {Array<Object>}
 */
export function filterByCoverage(rows, minFraction) {
  const min = Number.isFinite(minFraction) ? minFraction : 0.5;
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && r.coverage && r.coverage.fraction >= min);
}

/**
 * Group rows by their value on a single axis. Returns
 * `{ axis_value → Array<row> }`. Rows with that axis missing are
 * collected under the key `'__missing__'`.
 *
 * @param {Array<Object>} rows
 * @param {string} axisKey   one of CLASSIFICATION_AXES
 * @returns {Object<string, Array<Object>>}
 */
export function groupByAxis(rows, axisKey) {
  const out = Object.create(null);
  if (!Array.isArray(rows) || !CLASSIFICATION_AXES.includes(axisKey)) return out;
  for (const r of rows) {
    if (!r || !r.axes) continue;
    const v = r.axes[axisKey];
    let key;
    if (v === AXIS_MISSING)            key = '__missing__';
    else if (typeof v === 'string')    key = v;
    else if (typeof v === 'object')    key = '__object__';     // structured axis
    else                               key = String(v);
    (out[key] = out[key] || []).push(r);
  }
  return out;
}
