// shared/inversion_pipeline.js
// =====================================================================
// End-to-end orchestrator. Runs Stage A → D using the existing modules
// + the new ones (band_quality, locus_construction, dosage_overlay,
// karyotype_caller, igkc_gates, direction_resolver).
//
// Stage A is upstream: this module ASSUMES per-window K-means labels,
// L2 envelopes, and band_quality scores are already available via the
// context object. The orchestrator does not run K-means or PCA itself.
//
// Stage B-D are run here, sequentially.
//
// Inputs (context object):
//   - n_samples, n_windows, n_chromosomes
//   - per-window: pc1, labels, K, eig1, eig2, l2_idx
//   - per-locus dosage: callback (locus, sample) → mean polarized dosage
//   - per-axis dosage: callback (axis_id, sample) → mean polarized dosage
//   - candidate regions: array of {chromosome, s_window, e_window}
//   - KING edges: array of {a, b, kinship, relationship_class}
//
// Outputs:
//   - loci genome-wide
//   - per-locus consensus + macro-bands + axes
//   - per-axis per-sample karyotype calls
//   - dyad results, trio results, direction results
//   - IKC matrix
// =====================================================================

import {
  bandQualityForWindow,
  bandQualityGenomeWide,
  BAND_QUALITY_DEFAULTS,
} from './band_tracking/band_quality.js';

import {
  constructLoci,
  locusBandSampleSets,
  LOCUS_CONSTRUCTION_DEFAULTS,
} from './band_tracking/locus_construction.js';

import {
  classifyMacroBands,
  countAxesByHetDisjointness,
  polaritySanityCheck,
  DOSAGE_DEFAULTS,
} from './band_tracking/dosage_overlay.js';

import {
  resolveAxisMembership,
  callKaryotypePerAxisPerSample,
} from './band_tracking/karyotype_caller.js';

import {
  igkcAllDyads,
  IGKC_DEFAULTS,
} from './inheritance/igkc_gates.js';

import {
  resolveAllDyadDirections,
  buildIKCMatrix,
  DIRECTION_DEFAULTS,
} from './inheritance/direction_resolver.js';

// ---------------------------------------------------------------------
// Helper: build the macro_bands array from a partition + per-band sample sets
//
// A partition (output of partition_consensus) groups K original bands
// into M ≤ K macro-bands. Each macro-band is the UNION of original
// bands' sample sets.
// ---------------------------------------------------------------------

/**
 * @param {Array<number[]>} blocks                  partition's blocks
 * @param {Array<Set<number>>} per_band_samples    sample-set per original band
 * @returns {Array<{block_id:number, samples:Set<number>}>}
 */
export function partitionToMacroBands(blocks, per_band_samples) {
  const macro = [];
  for (let bid = 0; bid < blocks.length; bid++) {
    const samples = new Set();
    for (const orig_band of blocks[bid]) {
      const s = per_band_samples[orig_band];
      if (s) for (const x of s) samples.add(x);
    }
    macro.push({ block_id: bid, samples });
  }
  return macro;
}

// ---------------------------------------------------------------------
// runStageB: locus construction (one chromosome)
// ---------------------------------------------------------------------

/**
 * @param {object} ctx
 * @param {number} chromosome_idx
 * @param {object} [opts]
 * @returns {{
 *   loci: Array,
 *   per_locus_band_sets: Array,
 *   diagnostics: {raw_chains, skipped_windows, broken_at}
 * }}
 */
export function runStageB(ctx, chromosome_idx, opts) {
  const merged = Object.assign({}, BAND_QUALITY_DEFAULTS,
                                LOCUS_CONSTRUCTION_DEFAULTS, opts || {});
  const chr = ctx.chromosomes[chromosome_idx];
  const args = {
    getLabels:       (w) => ctx.getLabels(w),
    getK:            (w) => ctx.getK(w),
    getBandQuality:  (w) => ctx.getBandQuality(w),
    getL2Idx:        (w) => ctx.getL2Idx(w),
    s_window:        chr.s_window,
    e_window:        chr.e_window,
  };
  const { loci, raw_chains, skipped_windows, broken_at } = constructLoci(args, merged);
  const per_locus_band_sets = loci.map(L => locusBandSampleSets(L, ctx.getLabels, ctx.n_samples));
  return {
    loci,
    per_locus_band_sets,
    diagnostics: { raw_chains, skipped_windows, broken_at },
  };
}

// ---------------------------------------------------------------------
// runStageC: per-locus breadth voting + karyotype calling
//
// REQUIRES: a partition_consensus result per locus. The orchestrator
// expects that breadth voting (Stage C2-C4) has been run by the caller
// (using the existing vote_evidence + partition_consensus modules).
// This step takes that consensus as input and produces axes + calls.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {object} args.locus
 * @param {object} args.locus_band_sets       output of locusBandSampleSets
 * @param {Array<number[]>} args.consensus_partition    blocks from partition_consensus
 * @param {(sample_idx:number) => number|null} args.sampleMeanLocusDosage
 * @param {(axis_id:number, sample_idx:number) => number|null} args.samplePerAxisDosage
 * @param {number} args.n_samples
 * @param {object} [opts]
 * @returns {{
 *   macro_bands: Array,
 *   classified: Array,
 *   axis_result: object,
 *   polarity: string,
 *   axes: Array,
 *   calls: object
 * }}
 */
export function runStageCForLocus(args, opts) {
  const merged = Object.assign({}, DOSAGE_DEFAULTS, opts || {});
  // Stage C5: dosage overlay per macro-band
  const macro_bands = partitionToMacroBands(args.consensus_partition,
                                              args.locus_band_sets.per_band_samples);
  const classified = classifyMacroBands(macro_bands, args.sampleMeanLocusDosage, merged);
  // Stage C6: HET-disjointness → axes
  const axis_result = countAxesByHetDisjointness(classified, merged);
  const polarity = polaritySanityCheck(axis_result);
  // Stage C7: per-axis per-sample karyotype call
  const axes = resolveAxisMembership(axis_result, classified);
  const calls = callKaryotypePerAxisPerSample({
    classified,
    axis_result,
    axes,
    n_samples: args.n_samples,
    samplePolarizedDosageMean: args.samplePerAxisDosage,
  }, merged);
  return { macro_bands, classified, axis_result, polarity, axes, calls };
}

// ---------------------------------------------------------------------
// flattenCallsForInheritance
//
// Takes the per-locus stage-C output and produces the flat
// `axis_calls` array consumed by Stage D (igkc_gates,
// direction_resolver).
//
// Each entry: {locus_id, axis_id, calls_per_sample}
// ---------------------------------------------------------------------

/**
 * @param {Array<{locus_id, axes, calls}>} per_locus_stage_c
 * @returns {Array<{locus_id, axis_id, calls_per_sample}>}
 */
export function flattenCallsForInheritance(per_locus_stage_c) {
  const out = [];
  for (const lc of per_locus_stage_c) {
    for (let a = 0; a < lc.axes.length; a++) {
      out.push({
        locus_id: lc.locus_id,
        axis_id:  lc.axes[a].axis_id,
        calls_per_sample: lc.calls.per_axis_per_sample[a],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// runStageD: inheritance layer
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array} args.king_edges
 * @param {Array} args.axis_calls    flat output of flattenCallsForInheritance
 * @param {number} args.n_samples
 * @param {object} [opts]
 * @returns {{dyad_results, direction_results, ikc}}
 */
export function runStageD(args, opts) {
  const merged = Object.assign({}, IGKC_DEFAULTS, DIRECTION_DEFAULTS, opts || {});
  const dyad_results = igkcAllDyads({
    king_edges: args.king_edges,
    axis_calls: args.axis_calls,
  }, merged);
  // D4 — direction resolver (only if enough axes per dyad; resolver
  // checks min_informative_axes internally)
  const direction_results = resolveAllDyadDirections({
    king_edges: args.king_edges,
    axis_calls: args.axis_calls,
  }, merged);
  // D5 — IKC matrix
  const { ikc, summary } = buildIKCMatrix({
    n_samples: args.n_samples,
    king_edges: args.king_edges,
    dyad_results,
    direction_results,
  });
  return { dyad_results, direction_results, ikc, summary };
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._partitionToMacroBands     = partitionToMacroBands;
  window._runStageB                  = runStageB;
  window._runStageCForLocus          = runStageCForLocus;
  window._flattenCallsForInheritance = flattenCallsForInheritance;
  window._runStageD                  = runStageD;
}
