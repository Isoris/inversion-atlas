// shared/band_tracking/index.js
// =====================================================================
// Public API for the band-tracking layer.
//
// Pipeline (top-down):
//
//   per-window K-means labels  (existing — produced by shared/per_l2_cluster.js
//                                or upstream R-side)
//          ↓
//   single_band_track_from_seed  →  one-band trajectory across windows
//   single_band_score_continuity →  per-step retained/lost/gained + jaccard
//          ↓
//   het_detect_candidate_band    →  intermediate-PC1 bands per window
//   het_track_skeleton           →  forward+backward stitched het track
//   het_define_interval          →  bp coordinates from a skeleton
//          ↓
//   hom_anchor_to_het            →  HOM_A / HOM_B sample sets for the interval
//          ↓
//   iv_call_samples_from_skeleton →  per-sample karyotype calls
//          ↓
//   iv_merge_het_tracks          →  optional: merge nearby intervals with
//                                   shared sample cores (post-call cleanup
//                                   for noisy stretches)
//
// All math reuses the existing shared/contingency.js primitives —
// nothing here rewrites the L3 contingency core.
// =====================================================================

// ---------------------------------------------------------------------
// LAYER 1 — single-band trajectory + het skeleton + HOM anchors +
// per-sample karyotype caller.
//
// The cartridge is ahead of legacy on this layer — these modules were
// designed and built to the spec contracts (per-window K-means
// labels via getLabels/getK callbacks, NEVER L2-broadcast — same
// per-window upgrade noted in anchor_signals.js header).
//
// Layer 1a: single-band trajectory across windows.
// Layer 1b: het-band detection + skeleton (interval seed for
//           long-range haplotype regime).
// Layer 1c: HOM_A / HOM_B anchor sample sets from a het skeleton.
// Layer 1d: per-sample karyotype caller — TAIL of the pipeline.
//
// Still to build (separate PR): trajectory.js (per-band pc1
// trajectories + sign anchors) and karyotype_model.js (combiner
// that consumes trajectory + projection + vote evidence).
// ---------------------------------------------------------------------
export {
  SINGLE_BAND_DEFAULTS,
  bandMembers,
  bandJaccard,
  single_band_track_from_seed,
  single_band_score_continuity,
} from './single_band.js';

export {
  HET_DEFAULTS,
  meanPc1PerBand,
  het_detect_candidate_band,
  het_track_skeleton,
  het_define_interval,
  iv_merge_het_tracks,
} from './het.js';

export {
  HOM_DEFAULTS,
  hom_anchor_in_window,
  hom_anchor_to_het,
} from './hom.js';

export {
  IV_CALLS,
  IV_CALL_DEFAULTS,
  iv_call_samples_from_skeleton,
} from './iv.js';

// ---------------------------------------------------------------------
// LAYER 2 — BandSet Projection (set-based authority)
//
// Note: legacy aspirational names (bp_compute_projection_vector,
// bp_detect_visited_excluded_bands, bp_classify_projection_pattern,
// bp_project_bandset_to_target_bands) were never implemented under
// those identifiers; the working surface in projection.js uses
// classifyProjection / classifyProjectionWithStability. If the
// bp_* identifiers ever materialise (legacy extraction), re-add
// them to this block.
// ---------------------------------------------------------------------
export {
  PATTERN_CLASS,
  PROJECTION_DEFAULTS,
  classifyProjection,
  classifyProjectionWithStability,
} from './projection.js';

// COMBINER (karyotype_model.js): still pending — designs against the
// vote-evidence + trajectory + projection stack. Layer 1d (iv.js)
// already gives a working per-sample call from het skeleton + HOM
// anchors; karyotype_model.js will fold that into a multi-evidence
// verdict once trajectory.js lands.

// ---------------------------------------------------------------------
// VOTE EVIDENCE — raw vote extraction + co-association matrix
// (shared foundation for both band-centric and locus-centric views)
// ---------------------------------------------------------------------
export {
  extract_votes,
  build_coassociation_matrix,
  build_per_band_vote_index,
  voteRecords_from_projections,
} from './vote_evidence.js';

// ---------------------------------------------------------------------
// LAYER A — band-centric: "standing on the band, looking at who votes for us"
// ---------------------------------------------------------------------
export {
  collect_voters_for_band,
  compute_partner_affinities,
  derive_partner_sets,
  compute_voter_consensus,
  compute_overlap_conflict,
  build_per_band_view,
} from './band_voters.js';

// ---------------------------------------------------------------------
// LAYER B math — bruteforce partition enumeration + scoring
// ---------------------------------------------------------------------
export {
  enumerate_partitions_as_blocks,
  score_partition_against_coassoc,
  enumerate_and_score_all_partitions,
  select_top_partitions_adaptive,
  partitions_are_compatible,
  bellNumber,
} from './partition_enumerate.js';

// ---------------------------------------------------------------------
// LAYER C — orchestrator: full consensus pipeline + 6 classes + QC fields
// ---------------------------------------------------------------------
export {
  consensus_partition,
  CONSENSUS_CLASS,
  RESOLVING_POWER_CLASS,
} from './partition_consensus.js';
