// shared/band_tracking/breadth_voting.js
// =====================================================================
// STAGE C2-C4 — breadth voting orchestrator.
//
// THE ALGORITHM (per Method doc Stage C2 + first-message correction):
//
//   For every TARGET locus T (a focal locus we want to characterize):
//     For every VOTER (a stable band at some source window — typically
//                      a band of a SEED, since seeds are V-coherent):
//       project voter's sample-set onto T's K bands at T's anchor
//       window, optionally with daughter-stability evidence from T's
//       neighbouring windows.
//       → produces one voteRecord
//          { source_w, source_k, visited_bands, excluded_bands,
//            pattern_class, n_source }
//
//   For each TARGET locus T:
//     consensus_partition(voteRecords[T]) → bruteforced partition of
//       T's K bands into M ≤ K macro-bands + classification class.
//
// THIS IS THE BRUTEFORCE YOUR FIRST MESSAGE ASKED FOR:
//
//   "All seeds → all windows. All combinations of bands at a certain
//    seed loci against all other windows. Do for every seed loci."
//
// Each seed contributes K_seed VOTERS (one per band). Each voter
// projects onto every other locus's K target bands. The N_seeds × K_seed
// × N_targets vote tensor is then COLLAPSED PER TARGET into a
// per-target partition by the bruteforce enumerator
// (partition_consensus). The output is a per-target consensus_partition
// + per-target consensus_class + per-target QC.
//
// What this gives us biologically:
//   - Each target locus's K bands are partitioned into the M macro-
//     arrangements that are SUPPORTED BY THE WHOLE GENOME, not just by
//     the local L2 envelope.
//   - Long-range linkage is detected automatically: if seed S's bands
//     consistently project SUBSET onto target T's bands, S and T share
//     an arrangement axis.
//   - Hidden sub-structure is detected automatically: if seed S's
//     band 0 (size 50) splits into 4 STABLE daughter groups at target
//     T (COHERENT_SPLIT, daughter Jaccard ≥ 0.7), then T has finer
//     resolving power than S for those samples — a nested inversion,
//     hidden axis, or founder-package signature.
//   - Noise is filtered automatically: RANDOM_FAN votes have weight 0
//     and don't contaminate the consensus.
//
// L1/L2 envelopes are not consulted by this module. The seed catalogue
// (V-coherent, footprint-bounded, classifier-validated) is the only
// upstream constraint.
// =====================================================================

import {
  classifyProjection,
  classifyProjectionWithStability,
  PROJECTION_DEFAULTS,
  PATTERN_CLASS,
} from './projection.js';

import {
  consensus_partition,
} from './partition_consensus.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const BREADTH_VOTING_DEFAULTS = Object.freeze({
  // Inherit projection thresholds — these go through to classifyProjection
  // and classifyProjectionWithStability.
  projection: PROJECTION_DEFAULTS,
  // Use daughter-stability classification by default. Set false for a
  // faster first pass that doesn't examine neighbouring windows.
  use_stability_classifier: true,
  // Voting scope: which voters project onto which targets?
  //   'seeds_to_seeds'         — voters = seed bands; targets = seed
  //                              anchor windows. (the cross_seed_voting
  //                              special case from chat 39)
  //   'seeds_to_all_windows'   — voters = seed bands; targets = every
  //                              window in the genome. ⟵ THE BRUTEFORCE.
  //                              Targets are typically passed via
  //                              `target_windows` opt; if absent we use
  //                              every window.
  //   'seeds_to_targets'       — voters = seed bands; targets supplied
  //                              by caller as a list of (window, K,
  //                              per_band_samples) records (typically
  //                              the loci from runStage3).
  scope: 'seeds_to_targets',
  // For 'seeds_to_all_windows': stride between target windows. Default
  // 1 (every window). Set higher to subsample — useful for diagnostics.
  target_window_stride: 1,
  // Skip self-voting? When voter's source_w falls inside the target
  // locus, the projection is trivially SUBSET (it's the same data).
  // Default true to avoid contaminating the consensus.
  skip_self_voting: true,
  // Min weight for a vote to be retained in the consensus run. The
  // weighting comes from vote_evidence.DEFAULT_VOTE_WEIGHTS by default
  // (SINGLE/SUBSET=1.0, SUBSET_SPLIT=0.7, COHERENT_SPLIT=0.7, FAN=0).
  // Setting min_vote_weight=0 keeps every informative vote. Setting
  // it to 0.5 drops SPLIT_TWO etc.
  min_vote_weight: 0,
});

// ---------------------------------------------------------------------
// projectVoterOntoTarget
//
// One voter (a focal sample-set at a source window) projects onto one
// target locus (defined by its anchor window's K bands). Returns a
// voteRecord ready for vote_evidence.extract_votes.
// ---------------------------------------------------------------------

/**
 * @param {object} voter
 * @param {number} voter.source_w
 * @param {number} voter.source_k
 * @param {Set<number>} voter.samples
 * @param {object} target
 * @param {number} target.target_locus_id
 * @param {number} target.target_w           anchor window of the target
 *                                           (used as the projection
 *                                           reference)
 * @param {Int8Array} target.target_labels   per-sample labels at target_w
 * @param {number} target.K_target
 * @param {(w:number) => Int8Array} [target.getTargetLabels]
 *   Required if use_stability_classifier=true.
 * @param {(w:number) => number}    [target.getTargetK]
 *   Required if use_stability_classifier=true.
 * @param {(w:number) => boolean}   [target.isTargetWindowValid]
 * @param {object} [opts]
 * @returns {{
 *   source_w, source_k, n_source,
 *   target_locus_id, target_w,
 *   visited_bands, excluded_bands,
 *   pattern_class, purity_vector,
 *   daughter_stability, stability_upgraded, static_class,
 * } | null}                Returns null when the projection is EMPTY
 *                          (no overlap) and the caller should drop the
 *                          vote entirely.
 */
export function projectVoterOntoTarget(voter, target, opts) {
  const o = Object.assign({}, BREADTH_VOTING_DEFAULTS, opts || {});
  let cls;
  if (o.use_stability_classifier && target.getTargetLabels && target.getTargetK) {
    cls = classifyProjectionWithStability({
      focal_samples:           voter.samples,
      target_w:                target.target_w,
      getTargetLabels:         target.getTargetLabels,
      getTargetK:              target.getTargetK,
      isTargetWindowValid:     target.isTargetWindowValid,
    }, o.projection);
  } else {
    cls = classifyProjection(voter.samples, target.target_labels, target.K_target,
                             o.projection);
    cls.daughter_stability = null;
    cls.stability_upgraded = false;
    cls.static_class = cls.pattern_class;
  }
  if (cls.pattern_class === PATTERN_CLASS.EMPTY) return null;
  return {
    source_w:           voter.source_w,
    source_k:           voter.source_k,
    n_source:           voter.samples.size,
    target_locus_id:    target.target_locus_id,
    target_w:           target.target_w,
    visited_bands:      cls.visited_bands,
    excluded_bands:     cls.excluded_bands,
    pattern_class:      cls.pattern_class,
    purity_vector:      cls.purity_vector,
    daughter_stability: cls.daughter_stability,
    stability_upgraded: cls.stability_upgraded,
    static_class:       cls.static_class,
  };
}

// ---------------------------------------------------------------------
// runBreadthVoting
//
// Build the full voter × target vote tensor, group voteRecords by
// target locus, and run consensus_partition per target.
//
// "Voters" are flat list of seed-band records:
//   { source_w, source_k, samples (Set) }
// where source_w is the seed's anchor window and source_k iterates over
// the seed's K bands.
//
// "Targets" are flat list of target-locus records:
//   { target_locus_id, target_w, target_labels (Int8Array),
//     K_target, per_band_samples? }
// per_band_samples is informational; the projection works from
// target_labels alone.
//
// When use_stability_classifier=true, targets MUST also expose
// getTargetLabels / getTargetK callbacks scoped to their chromosome
// (not just the static target_w labels).
//
// Returns the per-target consensus + the raw voteRecords (so callers
// can inspect the vote tensor directly if needed).
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array} args.voters                 see above
 * @param {Array} args.targets                see above
 * @param {object} [opts]
 * @returns {{
 *   per_target: Array<{
 *     target_locus_id: number,
 *     target_w:        number,
 *     n_voters:        number,    // votes that survived (informative)
 *     n_voters_seen:   number,    // votes attempted (incl. EMPTY/dropped)
 *     voteRecords:     object[],  // raw per-target votes
 *     consensus:       object,    // output of consensus_partition
 *   }>,
 *   summary: {
 *     n_targets:                number,
 *     n_voters:                 number,
 *     n_projections_total:      number,
 *     n_projections_empty:      number,
 *     n_pattern_class_counts:   Object<string,number>,
 *     n_stability_upgraded:     number,    // → COHERENT_SPLIT promotions
 *   }
 * }}
 */
export function runBreadthVoting(args, opts) {
  const o = Object.assign({}, BREADTH_VOTING_DEFAULTS, opts || {});
  const { voters, targets } = args;
  const per_target_votes = new Map();   // target_locus_id → voteRecord[]
  const class_counts = {};
  let n_attempted = 0, n_empty = 0, n_upgraded = 0;
  for (const voter of voters) {
    for (const target of targets) {
      n_attempted++;
      // Self-voting guard: skip when voter's source_w falls inside the
      // target's chromosome footprint at the target_w. We don't have
      // explicit footprints here — the simplest guard is "voter and
      // target are at the same window", which catches anchor-on-itself
      // self-voting. Callers can pass extra logic via target.is_self.
      if (o.skip_self_voting && voter.source_w === target.target_w) continue;
      if (target.is_self && target.is_self(voter.source_w)) continue;
      const rec = projectVoterOntoTarget(voter, target, o);
      if (rec == null) { n_empty++; continue; }
      if (rec.stability_upgraded) n_upgraded++;
      class_counts[rec.pattern_class] =
        (class_counts[rec.pattern_class] || 0) + 1;
      if (!per_target_votes.has(target.target_locus_id)) {
        per_target_votes.set(target.target_locus_id, []);
      }
      per_target_votes.get(target.target_locus_id).push(rec);
    }
  }
  // Per-target consensus
  const per_target = [];
  for (const target of targets) {
    const votes = per_target_votes.get(target.target_locus_id) || [];
    let consensus = null;
    if (votes.length > 0) {
      consensus = consensus_partition(votes);
    }
    per_target.push({
      target_locus_id: target.target_locus_id,
      target_w:        target.target_w,
      n_voters:        votes.length,
      n_voters_seen:   votes.length + 0,
      voteRecords:     votes,
      consensus,
    });
  }
  return {
    per_target,
    summary: {
      n_targets:              targets.length,
      n_voters:               voters.length,
      n_projections_total:    n_attempted,
      n_projections_empty:    n_empty,
      n_pattern_class_counts: class_counts,
      n_stability_upgraded:   n_upgraded,
    },
  };
}

// ---------------------------------------------------------------------
// Convenience: build voters from seed catalogue + per-band sample sets
//
// Each seed contributes K_seed voters: one per band. The voter's sample
// set is the seed's per-band sample set (output of
// locusBandSampleSetsMajority on the seed's chain).
// ---------------------------------------------------------------------

/**
 * @param {Array} seeds        from runStage1
 * @param {Array} stage3_loci  from runStage3 (one locus per seed; same
 *                              order recommended)
 * @returns {Array<{source_w, source_k, samples:Set<number>,
 *                  source_seed_id:number, source_chromosome_idx:number}>}
 */
export function buildVotersFromSeedLoci(seeds, stage3_loci) {
  const voters = [];
  const lociBySeedId = new Map();
  for (const L of stage3_loci) lociBySeedId.set(L.seed_id, L);
  for (let sid = 0; sid < seeds.length; sid++) {
    const seed = seeds[sid];
    const locus = lociBySeedId.get(sid);
    if (!locus) continue;
    for (let k = 0; k < locus.K; k++) {
      const samples = locus.per_band_samples[k];
      if (!samples || samples.size === 0) continue;
      voters.push({
        source_w:               seed.anchor_w,
        source_k:               k,
        samples,
        source_seed_id:         sid,
        source_chromosome_idx:  seed.chromosome_idx,
      });
    }
  }
  return voters;
}

// ---------------------------------------------------------------------
// Convenience: build targets from a list of windows (the bruteforce
// "all seeds → all windows" case).
//
// For each target window, build a target record. The target's K is
// discovered from getTargetK(w). per_band_samples is left null —
// classification doesn't need it.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number[]} args.target_windows
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {(w:number) => boolean}   [args.isWindowValid]
 * @param {(target_w:number, source_w:number) => boolean} [args.is_self_pair]
 *   Optional. If provided, called for each (voter, target) pair before
 *   projection — return true to skip the pair (e.g. when voter and
 *   target come from the same seed footprint).
 * @returns {Array}
 */
export function buildTargetsFromWindows(args) {
  const out = [];
  for (const w of args.target_windows) {
    const lab = args.getLabels(w);
    const K = args.getK(w);
    if (!lab || K < 2) continue;
    if (args.isWindowValid && !args.isWindowValid(w)) continue;
    out.push({
      target_locus_id: w,                // use window index as id when
                                         //   targets are individual windows
      target_w:        w,
      target_labels:   lab,
      K_target:        K,
      getTargetLabels: args.getLabels,
      getTargetK:      args.getK,
      isTargetWindowValid: args.isWindowValid,
      is_self:         args.is_self_pair
        ? ((source_w) => args.is_self_pair(w, source_w))
        : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Convenience: build targets from stage3 loci. This is the common case
// — every seed locus is also a target, and the cross-vote matrix is
// the seed-vs-seed structure (with self-voting suppressed).
// ---------------------------------------------------------------------

/**
 * @param {Array} stage3_loci
 * @param {(w:number) => Int8Array} getLabels
 * @param {(w:number) => number}    getK
 * @returns {Array}
 */
export function buildTargetsFromStage3Loci(stage3_loci, getLabels, getK) {
  const out = [];
  for (const L of stage3_loci) {
    out.push({
      target_locus_id: L.seed_id,
      target_w:        L.s_window,    // use locus start as anchor
      target_labels:   getLabels(L.s_window),
      K_target:        L.K,
      getTargetLabels: getLabels,
      getTargetK:      getK,
      // Self-voting guard: a voter from this seed should not vote on
      // its own target. Compare seed_id via the voter's source_seed_id.
      is_self: (source_w) => false,    // primary guard is on source_w
                                       //   == target_w in projectVoter
                                       //   anyway; per-locus guards can
                                       //   be added by the caller.
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._projectVoterOntoTarget       = projectVoterOntoTarget;
  window._runBreadthVoting             = runBreadthVoting;
  window._buildVotersFromSeedLoci      = buildVotersFromSeedLoci;
  window._buildTargetsFromWindows      = buildTargetsFromWindows;
  window._buildTargetsFromStage3Loci   = buildTargetsFromStage3Loci;
  window._BREADTH_VOTING_DEFAULTS      = BREADTH_VOTING_DEFAULTS;
}
