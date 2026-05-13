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
import {
  classifyRecombinationSuppression,
} from './recombination_suppression.js';

// =====================================================================
// Schema
// =====================================================================

/** The 12 classification axes this consolidator emits. Order is the
 *  display order the classification page will tile across.
 *
 *  Grouping (4 buckets, used by axesByGroup() for the page's
 *  "click to expand" toggle between grouped and flat views):
 *
 *    ORIGIN:    how the inversion arose
 *    STRUCTURE: what's inside / how it's structured now
 *    FATE:      what's happening to it now (selection / inheritance)
 *    ROLE:      the headline composite + pangenome class
 */
export const CLASSIFICATION_AXES = Object.freeze([
  // ORIGIN
  'origin_mechanism',
  'copy_origin_verdict',
  'position_class',
  'arrangement_n',
  // STRUCTURE
  'structure_class',
  'age_my_bracket',
  'recombination_suppression',
  // FATE
  'selection_efficacy',
  'divergence',
  'xpehh_signal',
  'segregation_status_majority',
  // ROLE
  'pangenome_class',
  'evolutionary_role',
]);

/** Spec-inspired grouping ("Origin vs Fate" — don't mix; image set 2 §"Important
 *  distinction"). Used by axesByGroup() to emit a 4-bucket structured view
 *  alongside the flat axes object. */
export const CLASSIFICATION_AXIS_GROUPS = Object.freeze({
  ORIGIN:    ['origin_mechanism', 'copy_origin_verdict', 'position_class', 'arrangement_n'],
  STRUCTURE: ['structure_class', 'age_my_bracket', 'recombination_suppression'],
  FATE:      ['selection_efficacy', 'divergence', 'xpehh_signal', 'segregation_status_majority'],
  ROLE:      ['pangenome_class', 'evolutionary_role'],
});

/** Sentinel for axes with no producer output / missing layer. */
export const AXIS_MISSING = null;

/** Module version for the row schema. */
export const INVERSION_CLASSIFICATION_VERSION = 'inversion_classification_v1.2';

// =====================================================================
// Vocab — evolutionary_role + pangenome_class
// =====================================================================

/** Spec image set 1 §5 — six evolutionary-role labels plus a fallback.
 *
 *  Derived from the other axes by simple, inspectable rules
 *  (classifyEvolutionaryRole below). Not a producer label — composite
 *  only, transparent. */
export const EVOLUTIONARY_ROLES = Object.freeze({
  NEUTRAL_PASSENGER:           'neutral_passenger',
  RECOMBINATION_MODIFIER:      'recombination_modifier',
  LOCAL_ADAPTATION_CONTAINER:  'local_adaptation_container',
  ECOTYPE_STABILIZER:          'ecotype_stabilizer',
  SUPERGENE:                   'supergene',
  SPECIATION_BARRIER:          'speciation_barrier',
  UNCLASSIFIED:                'unclassified',
});

/** Spec image set 2 §"Inversion pangenome = three classes" —
 *  pangenome-style classification of inversion candidates.
 *
 *  Practical rule (image set 2):
 *    Private  ≠ important   (often noise or recent events)
 *    General  ≠ adaptive    (often neutral or ancient)
 *    Co-shared = PRIORITY   (most likely to matter biologically) */
export const PANGENOME_CLASSES = Object.freeze({
  PRIVATE:    'private',         // subpopulation-specific
  CO_SHARED:  'co_shared',       // subset of populations — the priority class
  GENERAL:    'general',         // ~fixed everywhere — structural background
  UNKNOWN:    'unknown',
});

/** Default thresholds for the pangenome classifier. Inputs are
 *  per-population frequencies of the inverted arrangement. */
export const PANGENOME_DEFAULTS = Object.freeze({
  /** A population is "carrying" the inversion at freq ≥ this. */
  presence_freq_min:        0.05,
  /** Private: present in ≤ this fraction of populations. */
  private_pop_frac_max:     0.20,
  /** General: present in ≥ this fraction of populations AND ≥
   *  general_freq_min in each carrier population. */
  general_pop_frac_min:     0.85,
  general_freq_min:         0.50,
});

/** Default thresholds for the evolutionary-role composite. */
export const EVOLUTIONARY_ROLE_DEFAULTS = Object.freeze({
  age_old_my_min:           3.0,   // mu_mid_my above this → "old"
  age_young_my_max:         1.0,   // mu_mid_my below this → "young"
});

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

// =====================================================================
// 2. Pangenome class — derived from per-population frequencies
// =====================================================================

/**
 * Spec image set 2 — classify an inversion as private / co-shared /
 * general based on its presence-frequency across populations.
 *
 * @param {Array<{population:string, freq:number, n:number}>|null} freq_by_pop
 *   Per-population frequency of the inverted arrangement. `freq` in
 *   [0, 1]; `n` is the population sample size (used for low-power
 *   gate — if every population has n < 5, returns UNKNOWN).
 * @param {Object} [opts]
 * @returns {{class:string, n_populations:number, n_carrier:number,
 *            fraction_carrier:number}|null}
 */
export function classifyPangenomeClass(freq_by_pop, opts) {
  if (!Array.isArray(freq_by_pop) || freq_by_pop.length === 0) return AXIS_MISSING;
  const o = opts || {};
  const D = PANGENOME_DEFAULTS;
  const presMin   = Number.isFinite(o.presence_freq_min)    ? o.presence_freq_min    : D.presence_freq_min;
  const privMax   = Number.isFinite(o.private_pop_frac_max) ? o.private_pop_frac_max : D.private_pop_frac_max;
  const genFrac   = Number.isFinite(o.general_pop_frac_min) ? o.general_pop_frac_min : D.general_pop_frac_min;
  const genFreqMin= Number.isFinite(o.general_freq_min)     ? o.general_freq_min     : D.general_freq_min;

  let n_pops = 0, n_carrier = 0, n_general_freq = 0, n_with_data = 0;
  for (const r of freq_by_pop) {
    if (!r) continue;
    n_pops++;
    if (Number.isFinite(r.n) && r.n >= 5) n_with_data++;
    if (Number.isFinite(r.freq) && r.freq >= presMin) {
      n_carrier++;
      if (r.freq >= genFreqMin) n_general_freq++;
    }
  }
  if (n_pops === 0 || n_with_data === 0) {
    return { class: PANGENOME_CLASSES.UNKNOWN, n_populations: n_pops, n_carrier: 0, fraction_carrier: 0 };
  }
  const fraction_carrier = n_carrier / n_pops;
  let cls;
  if (fraction_carrier <= privMax) {
    cls = PANGENOME_CLASSES.PRIVATE;
  } else if (fraction_carrier >= genFrac
             && (n_general_freq / n_pops) >= genFrac) {
    cls = PANGENOME_CLASSES.GENERAL;
  } else {
    cls = PANGENOME_CLASSES.CO_SHARED;
  }
  return { class: cls, n_populations: n_pops, n_carrier, fraction_carrier };
}

// =====================================================================
// 3. Evolutionary role — composite derived from other axes
// =====================================================================

/**
 * Spec image set 1 §5 — assign the headline evolutionary-role label
 * from the other axes' values.
 *
 * Rules (precedence order):
 *
 *   1. age old (mu_mid ≥ age_old_my_min) AND
 *      divergence = strong AND
 *      segregation = DISTORTED                              → SPECIATION_BARRIER
 *
 *   2. selection_efficacy = load_rich AND
 *      pangenome_class = co_shared AND
 *      segregation = MENDELIAN                              → SUPERGENE
 *
 *   3. selection_efficacy = load_rich AND
 *      xpehh_signal in {mild_outlier, strong_outlier}       → LOCAL_ADAPTATION_CONTAINER
 *
 *   4. pangenome_class = co_shared AND
 *      structure_class is simple/dosage-like                → ECOTYPE_STABILIZER
 *
 *   5. divergence = strong AND selection_efficacy != load_rich
 *                                                           → RECOMBINATION_MODIFIER
 *
 *   6. age young (mu_mid ≤ age_young_my_max) AND
 *      selection_efficacy = clean AND
 *      divergence in {no_divergence, no_data} AND
 *      xpehh_signal in {no_signal, no_data}                 → NEUTRAL_PASSENGER
 *
 *   default                                                 → UNCLASSIFIED
 *
 * The rules are conservative — when an axis is missing, the rule that
 * depends on it falls through. UNCLASSIFIED is the right answer when
 * the available evidence isn't enough to choose.
 *
 * @param {Object} axes   the `axes` map from buildInversionClassificationRow
 * @param {Object} [opts]
 * @returns {string}      one of EVOLUTIONARY_ROLES values
 */
export function classifyEvolutionaryRole(axes, opts) {
  if (!axes) return EVOLUTIONARY_ROLES.UNCLASSIFIED;
  const o = opts || {};
  const D = EVOLUTIONARY_ROLE_DEFAULTS;
  const oldMin   = Number.isFinite(o.age_old_my_min)   ? o.age_old_my_min   : D.age_old_my_min;
  const youngMax = Number.isFinite(o.age_young_my_max) ? o.age_young_my_max : D.age_young_my_max;

  const age   = axes.age_my_bracket;
  const mu_mid = age && Number.isFinite(age.mu_mid_my) ? age.mu_mid_my : null;
  const div   = axes.divergence;
  const sel   = axes.selection_efficacy;
  const xpehh = axes.xpehh_signal;
  const seg   = axes.segregation_status_majority;
  const segStatus = (seg && seg.status) || null;
  const pang  = axes.pangenome_class;
  const pangCls = (pang && pang.class) || null;
  const struct = axes.structure_class;

  // Rule 1 — speciation barrier
  if (mu_mid != null && mu_mid >= oldMin
      && div === 'strong_divergence'
      && segStatus === 'DISTORTED') {
    return EVOLUTIONARY_ROLES.SPECIATION_BARRIER;
  }

  // Rule 2 — supergene
  if (sel === 'load_rich'
      && pangCls === PANGENOME_CLASSES.CO_SHARED
      && segStatus === 'MENDELIAN') {
    return EVOLUTIONARY_ROLES.SUPERGENE;
  }

  // Rule 3 — local adaptation container
  if (sel === 'load_rich'
      && (xpehh === 'mild_outlier' || xpehh === 'strong_outlier')) {
    return EVOLUTIONARY_ROLES.LOCAL_ADAPTATION_CONTAINER;
  }

  // Rule 4 — ecotype stabilizer
  if (pangCls === PANGENOME_CLASSES.CO_SHARED
      && (struct === 'simple_haplotype_split' || struct === 'inversion_dosage_like')) {
    return EVOLUTIONARY_ROLES.ECOTYPE_STABILIZER;
  }

  // Rule 5 — recombination modifier
  if (div === 'strong_divergence' && sel !== 'load_rich') {
    return EVOLUTIONARY_ROLES.RECOMBINATION_MODIFIER;
  }

  // Rule 6 — neutral passenger
  if (mu_mid != null && mu_mid <= youngMax
      && sel === 'clean'
      && (div === 'no_divergence' || div === 'no_data')
      && (xpehh === 'no_signal' || xpehh === 'no_data')) {
    return EVOLUTIONARY_ROLES.NEUTRAL_PASSENGER;
  }

  return EVOLUTIONARY_ROLES.UNCLASSIFIED;
}

/**
 * Recombination-suppression axis. Bridges the consolidator inputs
 * (regime-linkage summary + karyotype distribution + family rows)
 * into the shape classifyRecombinationSuppression expects.
 *
 * Returns AXIS_MISSING when all three inputs are absent. Otherwise
 * returns the classifier's label string — `no_data` here means
 * inputs were present but didn't carry usable evidence.
 *
 * @param {Object|null} regime_linkage_summary
 * @param {Object|null} karyotype_distribution
 * @param {Array|null}  family_rows
 * @returns {string|null}
 */
export function extractRecombinationSuppression(
  regime_linkage_summary,
  karyotype_distribution,
  family_rows,
) {
  if (!regime_linkage_summary && !karyotype_distribution
      && (!Array.isArray(family_rows) || family_rows.length === 0)) {
    return AXIS_MISSING;
  }
  let mendelian_summary = null;
  if (Array.isArray(family_rows) && family_rows.length > 0) {
    let n_med = 0, n_mendelian = 0, n_distorted = 0, n_other = 0;
    for (const row of family_rows) {
      if (!row) continue;
      if (row.reliability !== 'high' && row.reliability !== 'medium') continue;
      n_med++;
      if (row.segregation_status === SEGREGATION_STATUS.MENDELIAN)      n_mendelian++;
      else if (row.segregation_status === SEGREGATION_STATUS.DISTORTED) n_distorted++;
      else n_other++;
    }
    if (n_med > 0) {
      mendelian_summary = { n_families: n_med, n_mendelian, n_distorted, n_other };
    }
  }
  return classifyRecombinationSuppression({
    regime_linkage_summary,
    mendelian_summary,
    karyotype_distribution,
  });
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
export function buildInversionClassificationRow(candidate, inputs, opts) {
  const c = candidate || {};
  const i = inputs || {};
  const o = opts || {};

  const axes = {
    // ORIGIN
    origin_mechanism:             extractOriginMechanism(i.breakpoint_mechanism),
    copy_origin_verdict:          extractCopyOriginVerdict(i.copy_origin_summary),
    position_class:               extractPositionClass(i.regime_position),
    arrangement_n:                extractArrangementN(i.arrangement_sizes),
    // STRUCTURE
    structure_class:              extractStructureClass(i.regime_structure),
    age_my_bracket:               extractAgeMyBracket(i.busco_4d_age),
    recombination_suppression:    extractRecombinationSuppression(i.regime_linkage_summary, i.karyotype_distribution, i.family_rows),
    // FATE
    selection_efficacy:           extractSelectionEfficacy(i.functional_burden),
    divergence:                   extractDivergence(i.divergence_label),
    xpehh_signal:                 extractXpehhSignal(i.xpehh_label),
    segregation_status_majority:  extractSegregationStatusMajority(i.family_rows),
    // ROLE — composite axes computed last (read other axes' values)
    pangenome_class:              null,
    evolutionary_role:            null,
  };
  // Pangenome class is a per-population frequency rollup (own producer
  // input — `i.freq_by_pop`). Computed after the per-axis extractors
  // because evolutionary_role reads it.
  axes.pangenome_class = classifyPangenomeClass(i.freq_by_pop, o);
  // Evolutionary role is the headline composite — depends on every
  // other axis. Always computed (UNCLASSIFIED is the right fallback
  // when evidence is thin).
  axes.evolutionary_role = classifyEvolutionaryRole(axes, o);

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

/**
 * Re-shape a classification row's flat `axes` map into the 4-group
 * structure (Origin / Structure / Fate / Role).
 *
 * The flat `axes` stays intact on the row — this is an additive view
 * the page uses when the user toggles the "grouped" mode. Same values,
 * different shape.
 *
 * @param {Object} row   output of buildInversionClassificationRow
 * @returns {Object}     { ORIGIN: {...}, STRUCTURE: {...},
 *                         FATE: {...}, ROLE: {...} }
 */
export function axesByGroup(row) {
  const out = Object.create(null);
  if (!row || !row.axes) return out;
  for (const [group, keys] of Object.entries(CLASSIFICATION_AXIS_GROUPS)) {
    const bucket = Object.create(null);
    for (const k of keys) bucket[k] = row.axes[k];
    out[group] = bucket;
  }
  return out;
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
