// shared/band_tracking/dosage_overlay.js
// =====================================================================
// Stage C5-C6: dosage overlay per macro-band + HET-disjointness count.
//
// After breadth voting + partition consensus emits a partition that
// collapses K original bands into M macro-bands, this module:
//
//   1. Computes mean polarized dosage per macro-band (C5).
//   2. Classifies each macro-band as HOM_REF / HET / HOM_INV / AMBIGUOUS.
//   3. Sanity-checks polarity: exactly one HET-class macro-band per
//      arrangement axis. Multiple HET-class macro-bands with overlapping
//      sample sets → polarity failure. Multiple with disjoint sample sets
//      → multiple axes (regime {3+3} etc).
//   4. Counts independent arrangement axes via HET-disjointness (C6).
//
// Polarized dosage convention (post-STEP29 L1/L2):
//   HOM_REF ≈ 0, HET ≈ 1, HOM_INV ≈ 2  (per polarized marker)
//
// Per-macro-band dosage mean is computed by averaging polarized
// dosages across (samples in macro-band × markers in locus).
// =====================================================================

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const DOSAGE_CLASS = Object.freeze({
  HOM_REF:           'HOM_REF',
  HET:               'HET',
  HOM_INV:           'HOM_INV',
  AMBIGUOUS_DOSAGE:  'AMBIGUOUS_DOSAGE',
  NO_SAMPLES:        'NO_SAMPLES',
});

export const POLARITY_CHECK = Object.freeze({
  ANCHORED:  'ANCHORED',
  FAILED:    'FAILED',
  AMBIGUOUS: 'AMBIGUOUS',
});

export const DOSAGE_DEFAULTS = Object.freeze({
  hom_ref_max:    0.3,
  het_min:        0.7,
  het_max:        1.3,
  hom_inv_min:    1.7,
  het_overlap_same:    0.7,    // Jaccard ≥ this → same HET class
  het_overlap_disjoint: 0.3,   // Jaccard ≤ this → disjoint axes
  min_samples_for_class: 5,    // macro-band must have ≥ this many samples
});

// ---------------------------------------------------------------------
// classifyDosageMean
// ---------------------------------------------------------------------

/**
 * @param {number} mean
 * @param {object} [opts]
 * @returns {string}                one of DOSAGE_CLASS values
 */
export function classifyDosageMean(mean, opts) {
  opts = Object.assign({}, DOSAGE_DEFAULTS, opts || {});
  if (!Number.isFinite(mean)) return DOSAGE_CLASS.AMBIGUOUS_DOSAGE;
  if (mean <= opts.hom_ref_max) return DOSAGE_CLASS.HOM_REF;
  if (mean >= opts.het_min && mean <= opts.het_max) return DOSAGE_CLASS.HET;
  if (mean >= opts.hom_inv_min) return DOSAGE_CLASS.HOM_INV;
  return DOSAGE_CLASS.AMBIGUOUS_DOSAGE;
}

// ---------------------------------------------------------------------
// macroBandDosage
//
// For one macro-band (a set of original-band sample-sets unioned),
// compute the mean polarized dosage across its samples × the locus's
// polarized markers.
//
// The marker iteration is delegated to a callback because the dosage
// data layout is environment-specific (LRU chunk index in the atlas,
// dosage matrix on LANTA, etc.).
// ---------------------------------------------------------------------

/**
 * @param {Set<number>} sample_set            sample indices in macro-band
 * @param {(sample_idx:number) => number|null} sampleMeanDosage
 *   callback: returns the sample's mean polarized dosage across all
 *   markers in the locus, or null if no markers/data.
 * @returns {{mean:number, n_samples:number, n_with_data:number}}
 */
export function macroBandDosage(sample_set, sampleMeanDosage) {
  let sum = 0, n_with = 0;
  for (const i of sample_set) {
    const m = sampleMeanDosage(i);
    if (m == null || !Number.isFinite(m)) continue;
    sum += m;
    n_with++;
  }
  return {
    mean: n_with > 0 ? sum / n_with : NaN,
    n_samples: sample_set.size,
    n_with_data: n_with,
  };
}

// ---------------------------------------------------------------------
// classifyMacroBands
//
// Apply dosage overlay to all macro-bands of one locus.
// Output one record per macro-band.
// ---------------------------------------------------------------------

/**
 * @param {Array<{block_id:number, samples:Set<number>}>} macro_bands
 * @param {(sample_idx:number) => number|null} sampleMeanDosage
 * @param {object} [opts]
 * @returns {Array<{
 *   block_id: number,
 *   samples: Set<number>,
 *   n_samples: number,
 *   dosage_mean: number,
 *   dosage_class: string,
 *   has_enough_samples: boolean,
 * }>}
 */
export function classifyMacroBands(macro_bands, sampleMeanDosage, opts) {
  opts = Object.assign({}, DOSAGE_DEFAULTS, opts || {});
  const out = [];
  for (const mb of macro_bands) {
    const d = macroBandDosage(mb.samples, sampleMeanDosage);
    const has_enough = mb.samples.size >= opts.min_samples_for_class;
    let cls;
    if (mb.samples.size === 0) cls = DOSAGE_CLASS.NO_SAMPLES;
    else if (!has_enough) cls = DOSAGE_CLASS.AMBIGUOUS_DOSAGE;
    else cls = classifyDosageMean(d.mean, opts);
    out.push({
      block_id: mb.block_id,
      samples: mb.samples,
      n_samples: mb.samples.size,
      n_with_data: d.n_with_data,
      dosage_mean: d.mean,
      dosage_class: cls,
      has_enough_samples: has_enough,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// jaccardSets
// ---------------------------------------------------------------------

/**
 * @param {Set<number>} A
 * @param {Set<number>} B
 * @returns {number}        Jaccard ∈ [0, 1]; 0 if both empty
 */
export function jaccardSets(A, B) {
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  // Iterate over the smaller set
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  for (const x of small) if (big.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni > 0 ? inter / uni : 0;
}

// ---------------------------------------------------------------------
// countAxesByHetDisjointness  (Stage C6)
//
// Given classified macro-bands of one locus, count the number of
// disjoint HET-class sample sets. That's the number of independent
// arrangement axes.
//
// Algorithm (single-linkage clustering on Jaccard ≥ het_overlap_same):
//   1. Collect HET-class macro-bands.
//   2. Group by transitive Jaccard overlap ≥ het_overlap_same.
//   3. Verify each pair across groups has Jaccard ≤ het_overlap_disjoint.
//   4. Number of groups = number of axes.
//
// Edge cases:
//   - 0 HET-class macro-bands → 0 axes (no segregating inversion).
//   - 1 HET-class → 1 axis ({3} regime, or {2} if a HOM is missing).
//   - ≥ 2 HET groups with disjoint members → multi-axis regime.
//   - HET classes with intermediate Jaccard (between thresholds) →
//     flagged as ambiguous; counted as separate but with a warning.
// ---------------------------------------------------------------------

/**
 * @param {Array} classified            output of classifyMacroBands
 * @param {object} [opts]
 * @returns {{
 *   n_axes: number,
 *   het_groups: Array<{group_id:number, macro_band_ids:number[],
 *                       sample_set:Set<number>}>,
 *   hom_macro_bands: number[],         // block_ids of HOM_REF and HOM_INV
 *   ambiguous_macro_bands: number[],   // block_ids of AMBIGUOUS_DOSAGE
 *   warnings: string[],
 *   axis_overlap_matrix: Array<Array<number>>,
 * }}
 */
export function countAxesByHetDisjointness(classified, opts) {
  opts = Object.assign({}, DOSAGE_DEFAULTS, opts || {});
  const warnings = [];
  const het_bands = classified.filter(c => c.dosage_class === DOSAGE_CLASS.HET);
  const hom_bands = classified.filter(
    c => c.dosage_class === DOSAGE_CLASS.HOM_REF
      || c.dosage_class === DOSAGE_CLASS.HOM_INV
  );
  const ambig = classified.filter(c => c.dosage_class === DOSAGE_CLASS.AMBIGUOUS_DOSAGE);

  if (het_bands.length === 0) {
    return {
      n_axes: 0,
      het_groups: [],
      hom_macro_bands: hom_bands.map(b => b.block_id),
      ambiguous_macro_bands: ambig.map(b => b.block_id),
      warnings: ['no_het_class_macro_band'],
      axis_overlap_matrix: [],
    };
  }

  // Single-linkage cluster over Jaccard ≥ het_overlap_same
  const N = het_bands.length;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; };

  const J = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    J[i][i] = 1;
    for (let j = i + 1; j < N; j++) {
      const j_ij = jaccardSets(het_bands[i].samples, het_bands[j].samples);
      J[i][j] = j_ij; J[j][i] = j_ij;
      if (j_ij >= opts.het_overlap_same) union(i, j);
    }
  }

  // Collect groups
  const group_of = new Map();   // root → group index
  const groups = [];
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (!group_of.has(r)) {
      group_of.set(r, groups.length);
      groups.push([]);
    }
    groups[group_of.get(r)].push(i);
  }

  // Inter-group Jaccard sanity check
  for (let g1 = 0; g1 < groups.length; g1++) {
    for (let g2 = g1 + 1; g2 < groups.length; g2++) {
      // Use union of group's member sample sets to compute group-vs-group Jaccard
      const A = new Set();
      for (const i of groups[g1]) for (const s of het_bands[i].samples) A.add(s);
      const B = new Set();
      for (const i of groups[g2]) for (const s of het_bands[i].samples) B.add(s);
      const j = jaccardSets(A, B);
      if (j > opts.het_overlap_disjoint) {
        warnings.push(
          `het_groups_${g1}_${g2}_intermediate_overlap=${j.toFixed(3)} ` +
          `(>${opts.het_overlap_disjoint}, <${opts.het_overlap_same})`);
      }
    }
  }

  // Build group records
  const het_groups = groups.map((member_idx, gid) => {
    const sample_set = new Set();
    for (const i of member_idx) for (const s of het_bands[i].samples) sample_set.add(s);
    return {
      group_id: gid,
      macro_band_ids: member_idx.map(i => het_bands[i].block_id),
      sample_set,
    };
  });

  return {
    n_axes: groups.length,
    het_groups,
    hom_macro_bands: hom_bands.map(b => b.block_id),
    ambiguous_macro_bands: ambig.map(b => b.block_id),
    warnings,
    axis_overlap_matrix: J,
  };
}

// ---------------------------------------------------------------------
// polaritySanityCheck
//
// Detects the case where the STEP29 polarization has failed for a
// locus — manifests as multiple HET-class macro-bands with high
// overlap (so they're "the same HET" but split between bands by an
// orthogonal signal, suggesting the polarization didn't separate
// HOM_REF from HOM_INV cleanly).
//
// If countAxesByHetDisjointness returns 1 axis but the underlying
// HET-class macro-bands had to be unioned (i.e., the locus had ≥ 2
// HET-class macro-bands with high overlap), polarity is ANCHORED but
// noisy; flag for review. If overlap is intermediate (warnings present),
// polarity is AMBIGUOUS.
// ---------------------------------------------------------------------

/**
 * @param {ReturnType<typeof countAxesByHetDisjointness>} axisResult
 * @returns {string}     one of POLARITY_CHECK values
 */
export function polaritySanityCheck(axisResult) {
  if (axisResult.warnings.some(w => w.includes('intermediate_overlap'))) {
    return POLARITY_CHECK.AMBIGUOUS;
  }
  if (axisResult.warnings.includes('no_het_class_macro_band')) {
    return POLARITY_CHECK.FAILED;
  }
  return POLARITY_CHECK.ANCHORED;
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._classifyDosageMean      = classifyDosageMean;
  window._macroBandDosage         = macroBandDosage;
  window._classifyMacroBands      = classifyMacroBands;
  window._jaccardSets             = jaccardSets;
  window._countAxesByHetDisjointness = countAxesByHetDisjointness;
  window._polaritySanityCheck     = polaritySanityCheck;
  window._DOSAGE_CLASS            = DOSAGE_CLASS;
  window._POLARITY_CHECK          = POLARITY_CHECK;
  window._DOSAGE_DEFAULTS         = DOSAGE_DEFAULTS;
}
