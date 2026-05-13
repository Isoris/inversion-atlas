// shared/band_tracking/karyotype_caller.js
// =====================================================================
// Stage C7: per-axis per-sample karyotype caller.
//
// Combines:
//   - state_pc1[axis][sample]    = sample's macro-band membership for
//                                   this axis, translated through the
//                                   macro-band's dosage class
//   - state_dosage[axis][sample] = sample's per-axis polarized mean
//                                   dosage, classified by thresholds
//   - state_concordance[axis][sample] ∈ {AGREE, DISAGREE, AMBIGUOUS}
//   - state_call[axis][sample]   ∈ {HOM_REF, HET, HOM_INV, FLAGGED, NA}
//
// Logic:
//   - AGREE:    state_call = state_pc1 (= state_dosage), confidence HIGH
//   - DISAGREE: state_call = FLAGGED, confidence LOW
//                (Mendelian gates in Stage D will resolve)
//   - AMBIGUOUS: at least one of state_pc1/state_dosage is NA →
//                state_call = NA, confidence LOW
//
// The DISAGREE set is small in practice (typically <20% of samples)
// and is exactly what IGKC needs to act on.
// =====================================================================

import { DOSAGE_CLASS, classifyDosageMean, DOSAGE_DEFAULTS } from './dosage_overlay.js';

// ---------------------------------------------------------------------
// State enums
// ---------------------------------------------------------------------

export const KARYOTYPE_STATE = Object.freeze({
  HOM_REF: 'HOM_REF',
  HET:     'HET',
  HOM_INV: 'HOM_INV',
  NA:      'NA',
  FLAGGED: 'FLAGGED',
});

export const CONCORDANCE = Object.freeze({
  AGREE:     'AGREE',
  DISAGREE:  'DISAGREE',
  AMBIGUOUS: 'AMBIGUOUS',
});

export const CONFIDENCE = Object.freeze({
  HIGH:    'HIGH',
  MEDIUM:  'MEDIUM',
  LOW:     'LOW',
  FLAGGED: 'FLAGGED',
});

// ---------------------------------------------------------------------
// dosageClassToKaryotype
//
// Maps the macro-band-level dosage class (HOM_REF/HET/HOM_INV/...) to
// a per-sample karyotype state. They share enums, but this is an
// explicit mapping in case we later separate them.
// ---------------------------------------------------------------------

/**
 * @param {string} dosage_class    one of DOSAGE_CLASS values
 * @returns {string}               one of KARYOTYPE_STATE values
 */
export function dosageClassToKaryotype(dosage_class) {
  switch (dosage_class) {
    case DOSAGE_CLASS.HOM_REF: return KARYOTYPE_STATE.HOM_REF;
    case DOSAGE_CLASS.HET:     return KARYOTYPE_STATE.HET;
    case DOSAGE_CLASS.HOM_INV: return KARYOTYPE_STATE.HOM_INV;
    default:                    return KARYOTYPE_STATE.NA;
  }
}

// ---------------------------------------------------------------------
// resolveAxisMembership
//
// For one axis at one locus, build a per-sample mapping from sample
// index → which macro-band (axis-block) the sample belongs to.
//
// An axis can be:
//   - a single HET group (with 0..2 HOM groups)
//   - the macro-bands assigned to that axis are: the HET group's
//     macro-band IDs PLUS any HOM-class macro-bands that are
//     associated with this axis.
//
// For the {3} regime (one axis), all macro-bands belong to the axis.
// For the {3+3} regime (two axes), each axis claims one HET group plus
// "its" HOM macro-bands. The HOM-to-axis assignment uses sample-set
// overlap with the HET group.
// ---------------------------------------------------------------------

/**
 * @param {object} axis_result      from countAxesByHetDisjointness
 * @param {Array} classified         from classifyMacroBands
 * @returns {Array<{
 *   axis_id: number,
 *   macro_band_ids: number[],     // all macro-bands assigned to this axis
 *   het_macro_band_ids: number[],
 *   hom_ref_macro_band_id: number|null,
 *   hom_inv_macro_band_id: number|null,
 * }>}
 */
export function resolveAxisMembership(axis_result, classified) {
  const macroById = new Map();
  for (const c of classified) macroById.set(c.block_id, c);

  const axes = axis_result.het_groups.map(g => ({
    axis_id: g.group_id,
    macro_band_ids: g.macro_band_ids.slice(),
    het_macro_band_ids: g.macro_band_ids.slice(),
    hom_ref_macro_band_id: null,
    hom_inv_macro_band_id: null,
  }));

  // Assign each HOM macro-band to the axis whose HET group has the most
  // sample overlap... well, almost. HOM samples by definition do NOT
  // overlap with HET samples. So we can't use HET overlap to assign
  // HOMs to axes.
  //
  // For the single-axis case ({3} regime), all HOMs go to axis 0 trivially.
  // For multi-axis cases ({3+3} etc.), HOM-to-axis assignment is harder
  // and requires looking at which axis's HET group has been depleted of
  // these samples.
  //
  // Strategy: for each HOM macro-band, find the axis whose HET group's
  // sample set is most "complementary" — i.e., the axis where these HOM
  // samples would need to be HOM (not HET) given the inversion's allele
  // frequency. Concretely: a HOM macro-band M is assigned to the axis A
  // if removing M's samples from A's complement (the non-HET-of-A samples)
  // best preserves a clean HOM_REF + HET + HOM_INV structure.
  //
  // For the simple K=3 single-axis case this collapses to: HOM_REF
  // macro-band → axis 0; HOM_INV macro-band → axis 0. There's only one
  // axis to assign to.

  if (axes.length === 1) {
    for (const c of classified) {
      if (c.dosage_class === DOSAGE_CLASS.HOM_REF) {
        axes[0].hom_ref_macro_band_id = c.block_id;
        if (!axes[0].macro_band_ids.includes(c.block_id))
          axes[0].macro_band_ids.push(c.block_id);
      } else if (c.dosage_class === DOSAGE_CLASS.HOM_INV) {
        axes[0].hom_inv_macro_band_id = c.block_id;
        if (!axes[0].macro_band_ids.includes(c.block_id))
          axes[0].macro_band_ids.push(c.block_id);
      }
    }
    return axes;
  }

  // Multi-axis: assign each HOM macro-band to the axis where it's most
  // "consistent". For now use a simple heuristic: a HOM macro-band's
  // samples are the samples NOT in the HET group of its axis. So for
  // each HOM macro-band, pick the axis whose HET-group-complement
  // overlaps most with the HOM macro-band's samples.
  for (const c of classified) {
    if (c.dosage_class !== DOSAGE_CLASS.HOM_REF
        && c.dosage_class !== DOSAGE_CLASS.HOM_INV) continue;
    let best_axis = -1, best_score = -1;
    for (let a = 0; a < axes.length; a++) {
      // Axis's HET sample set
      const het_set = axis_result.het_groups[a].sample_set;
      // Score: |HOM_macro ∩ ¬HET_axis| (HOM samples that are NOT HET of this axis)
      let score = 0;
      for (const s of c.samples) if (!het_set.has(s)) score++;
      if (score > best_score) { best_score = score; best_axis = a; }
    }
    if (best_axis >= 0) {
      const ax = axes[best_axis];
      if (c.dosage_class === DOSAGE_CLASS.HOM_REF && ax.hom_ref_macro_band_id == null) {
        ax.hom_ref_macro_band_id = c.block_id;
      } else if (c.dosage_class === DOSAGE_CLASS.HOM_INV && ax.hom_inv_macro_band_id == null) {
        ax.hom_inv_macro_band_id = c.block_id;
      }
      if (!ax.macro_band_ids.includes(c.block_id)) ax.macro_band_ids.push(c.block_id);
    }
  }
  return axes;
}

// ---------------------------------------------------------------------
// callKaryotypePerAxisPerSample
//
// For each axis at a locus and each sample (0..n_samples-1):
//   1. Compute state_pc1: which macro-band of this axis does the
//      sample belong to, and what is that macro-band's dosage class?
//   2. Compute state_dosage: classify the sample's per-axis mean
//      polarized dosage directly.
//   3. Concordance = AGREE if state_pc1 == state_dosage (and both ≠ NA);
//      DISAGREE if both ≠ NA but differ; AMBIGUOUS if either is NA.
//   4. state_call: state_pc1 if AGREE; FLAGGED if DISAGREE; NA otherwise.
//   5. Confidence: HIGH if AGREE & both states are HOM_REF/HET/HOM_INV;
//                  FLAGGED if DISAGREE; LOW otherwise.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array} args.classified              from classifyMacroBands
 * @param {object} args.axis_result            from countAxesByHetDisjointness
 * @param {Array} args.axes                    from resolveAxisMembership
 * @param {number} args.n_samples
 * @param {(axis_id:number, sample_idx:number) => number|null} args.samplePolarizedDosageMean
 *   per-axis-per-sample mean polarized dosage. For the simple
 *   single-axis case, the per-axis dosage IS the locus's polarized
 *   mean dosage. For multi-axis loci, this should be axis-specific
 *   (e.g., restricted to markers that distinguish that axis's HOM_REF
 *   from HOM_INV).
 * @param {object} [opts]
 * @returns {{
 *   per_axis_per_sample: Array<Array<{
 *     state_pc1: string,
 *     state_dosage: string,
 *     state_concordance: string,
 *     state_call: string,
 *     state_confidence: string,
 *     dosage_value: number,
 *     macro_band_id: number|null,
 *   }>>,                                       // [axis_id][sample_idx]
 *   summary: {
 *     n_agree: number, n_disagree: number, n_ambiguous: number,
 *     per_axis_summary: Array<{axis_id:number, n_agree:number,
 *                              n_disagree:number, n_ambiguous:number,
 *                              n_per_state:object}>,
 *   }
 * }}
 */
export function callKaryotypePerAxisPerSample(args, opts) {
  opts = Object.assign({}, DOSAGE_DEFAULTS, opts || {});
  const { classified, axes, n_samples, samplePolarizedDosageMean } = args;
  const macroById = new Map();
  for (const c of classified) macroById.set(c.block_id, c);

  const out = [];
  let n_agree_total = 0, n_disagree_total = 0, n_ambig_total = 0;
  const per_axis_summary = [];

  for (const ax of axes) {
    // Sample-to-macro-band index for this axis: sample_idx → block_id
    const sample_to_macro = new Map();
    for (const block_id of ax.macro_band_ids) {
      const mb = macroById.get(block_id);
      if (!mb) continue;
      for (const s of mb.samples) sample_to_macro.set(s, block_id);
    }

    const calls = [];
    let n_a = 0, n_d = 0, n_amb = 0;
    const n_per_state = {
      HOM_REF: 0, HET: 0, HOM_INV: 0, FLAGGED: 0, NA: 0,
    };

    for (let i = 0; i < n_samples; i++) {
      const block_id = sample_to_macro.has(i) ? sample_to_macro.get(i) : null;
      let state_pc1;
      if (block_id == null) {
        state_pc1 = KARYOTYPE_STATE.NA;
      } else {
        const mb = macroById.get(block_id);
        state_pc1 = dosageClassToKaryotype(mb.dosage_class);
      }
      const dval = samplePolarizedDosageMean(ax.axis_id, i);
      let state_dosage;
      if (dval == null || !Number.isFinite(dval)) {
        state_dosage = KARYOTYPE_STATE.NA;
      } else {
        const dcls = classifyDosageMean(dval, opts);
        state_dosage = dosageClassToKaryotype(dcls);
      }

      let concord, call, conf;
      const both_known = state_pc1 !== KARYOTYPE_STATE.NA
                       && state_dosage !== KARYOTYPE_STATE.NA;
      if (!both_known) {
        concord = CONCORDANCE.AMBIGUOUS;
        call    = KARYOTYPE_STATE.NA;
        conf    = CONFIDENCE.LOW;
        n_amb++;
      } else if (state_pc1 === state_dosage) {
        concord = CONCORDANCE.AGREE;
        call    = state_pc1;
        conf    = CONFIDENCE.HIGH;
        n_a++;
      } else {
        concord = CONCORDANCE.DISAGREE;
        call    = KARYOTYPE_STATE.FLAGGED;
        conf    = CONFIDENCE.FLAGGED;
        n_d++;
      }
      n_per_state[call]++;

      calls.push({
        state_pc1,
        state_dosage,
        state_concordance: concord,
        state_call:        call,
        state_confidence:  conf,
        dosage_value:      dval,
        macro_band_id:     block_id,
      });
    }
    out.push(calls);
    per_axis_summary.push({
      axis_id: ax.axis_id,
      n_agree: n_a, n_disagree: n_d, n_ambiguous: n_amb,
      n_per_state,
    });
    n_agree_total    += n_a;
    n_disagree_total += n_d;
    n_ambig_total    += n_amb;
  }

  return {
    per_axis_per_sample: out,
    summary: {
      n_agree: n_agree_total,
      n_disagree: n_disagree_total,
      n_ambiguous: n_ambig_total,
      per_axis_summary,
    },
  };
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._dosageClassToKaryotype       = dosageClassToKaryotype;
  window._resolveAxisMembership        = resolveAxisMembership;
  window._callKaryotypePerAxisPerSample = callKaryotypePerAxisPerSample;
  window._KARYOTYPE_STATE              = KARYOTYPE_STATE;
  window._CONCORDANCE                  = CONCORDANCE;
  window._CONFIDENCE                   = CONFIDENCE;
}
