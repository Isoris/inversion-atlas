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
// Layer 1e: PC1 sign anchoring + per-band trajectories + pairwise
//           correlation + group-by-trajectory-similarity.
// Layer 1f: karyotype-model combiner (trajectory + projection +
//           vote evidence → BIALLELIC / MULTI_ALLELIC / COMPLEX /
//           AMBIGUOUS).
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
  meanSignalPerBand,
  meanPc1PerBand,
  meanDosagePerBand,
  het_detect_candidate_band,
  het_detect_candidate_band_by_signal,
  het_track_skeleton,
  het_track_skeleton_by_signal,
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
// LAYER 1e — PC1 sign anchoring + per-band trajectories + pairwise
// correlation + trajectory-similarity grouping.
// ---------------------------------------------------------------------
export {
  TRAJECTORY_DEFAULTS,
  pickPc1OrientationReferenceSamples,
  computePc1SignAnchors,
  band_compute_pc1_trajectory,
  band_pairwise_trajectory_correlation,
  band_group_by_trajectory_similarity,
} from './trajectory.js';

// ---------------------------------------------------------------------
// LAYER 1f — karyotype-model combiner. Folds trajectory + projection
// + vote evidence into a per-band macro-group assignment and a
// candidate-level verdict (BIALLELIC / MULTI_ALLELIC / COMPLEX /
// AMBIGUOUS).
// ---------------------------------------------------------------------
export {
  KARYOTYPE_MODEL_VERDICTS,
  KT_AGREEMENT_FLAGS,
  KT_DEFAULTS,
  kt_combine_trajectory_and_projection_evidence,
  kt_infer_macro_band_groups,
  kt_resolve_karyotype_model,
} from './karyotype_model.js';

// ---------------------------------------------------------------------
// LAYER 2 — long-range haplotype regime refinement.
//
// Consumes het-skeleton intervals (Layer 1b) + HOM consensus sets
// (Layer 1c) and reconnects skeletons that were broken by analysis
// artefacts. Emits long-range REGIMES — chains of related intervals
// across a larger range than any single skeleton spans. Five
// relationships: EXTENSION / NESTED / SHARED_HET / SWAPPED /
// UNRELATED.
// ---------------------------------------------------------------------
export {
  HAPLOTYPE_REGIME_RELATIONSHIPS,
  HAPLOTYPE_REGIME_DEFAULTS,
  intervalSampleCore,
  relateIntervals,
  buildHaplotypeRegimeGraph,
  clusterHaplotypeRegimes,
  refineRegimesFromIntervals,
} from './haplotype_regime.js';

// ---------------------------------------------------------------------
// LAYER 3 — cross-regime topology + chromosome-scale chains +
// JSON serialiser. Consumes Layer 2's long-range regimes and infers
// NESTED / ADJACENT / CHAINED / OVERLAPPING_CONFLICT / INDEPENDENT
// relationships between them; walks CHAINED edges into multi-
// inversion lineage chains.
// ---------------------------------------------------------------------
export {
  REGIME_TOPOLOGY_RELATIONSHIPS,
  REGIME_TOPOLOGY_DEFAULTS,
  regimeBpFootprint,
  regimePairwiseTopology,
  buildRegimeTopologyGraph,
  findChromosomeRegimeChains,
  serializeRegimesToJson,
} from './regime_topology.js';

// ---------------------------------------------------------------------
// LAYER 4a — per-regime Mendelian annotation. Runs BOTH Method A
// (trio contradiction counting) and Method B (per-family chi-square
// goodness-of-fit) when their respective inputs are available.
// ---------------------------------------------------------------------
export {
  REGIME_KARYOTYPE_STATES,
  REGIME_EXPECTED,
  TRIO_SUPPORT_STATUS,
  TRIO_SUPPORT_THRESHOLDS,
  REGIME_MENDELIAN_DEFAULTS,
  regimeKaryotypeForSample,
  annotateRegimeWithTrios,
  annotateRegimeWithFamilies,
  annotateRegimesWithMendelian,
} from './regime_mendelian.js';

// ---------------------------------------------------------------------
// LAYER 4b — INVERSE-direction pedigree inference. Derives pairwise
// relatedness from cross-regime co-membership; cross-checks against
// ngsRelate / ngsPedigree pair calls. Per user framing:
//
//   scan genomes > find inversions > use inversion haplotype regimes
//   to find who is parent and offspring of who.
// ---------------------------------------------------------------------
export {
  REGIME_PEDIGREE_DEFAULTS,
  REGIME_PEDIGREE_VERDICTS,
  regimePairCoMembership,
  classifyRegimeRelatedness,
  inferRelatednessFromRegimes,
  crossCheckPedigreeWithRegimes,
  calibratePedigreeThresholdsFromKnownPairs,
} from './regime_pedigree.js';

// ---------------------------------------------------------------------
// LAYER 5 — chromosome-scale wiring. Per-chromosome regime
// collections (Layer 2 output per chrom) → unified genome-wide
// collection + cross-chrom CHAINED links + whole-genome pedigree
// inference. Closes the "scan genomes > find inversions > infer
// pedigree" loop the user flagged.
// ---------------------------------------------------------------------
export {
  GENOME_SCALE_LINKS,
  GENOME_SCALE_DEFAULTS,
  mergePerChromosomeRegimes,
  crossChromosomeRegimeLinks,
  genomeWidePedigreeFromRegimes,
  genomeWideRegimeReport,
} from './genome_scale.js';

// ---------------------------------------------------------------------
// LAYER 4c — cross-regime LD + family-aware recombination test.
//
// "These samples behave like this in many chromosomes so probably
// they are linked, in terms of Mendelian" — formalised as:
//
//   COHORT-LEVEL LD     3×3 karyotype contingency table across
//                       samples → χ² + Cramér's V → LINKED /
//                       WEAKLY_LINKED / INDEPENDENT verdict.
//
//   FAMILY-LEVEL        for families with doubly-heterozygous
//   RECOMBINATION       parents at both regimes, count parental-
//                       vs recombinant-type offspring; estimate
//                       r̂ via estimateRecombinationRate
//                       (testcross design).
// ---------------------------------------------------------------------
export {
  REGIME_LINKAGE_VERDICTS,
  REGIME_LINKAGE_DEFAULTS,
  buildSampleRegimeMatrix,
  pairwiseRegimeContingency,
  regimeLD,
  regimeLinkageMatrix,
  familyRegimeRecombination,
  calibrateLinkageThresholdsFromCrossChrom,
} from './regime_linkage.js';

// ---------------------------------------------------------------------
// LAYER 4d — DYAD-aware Mendelian + meiotic-drive classification.
//
// Trios are rare in real cohorts; parent-offspring DYADS are common
// (mom+kid, dad+kid). This layer:
//   - Annotates regimes from dyads alone (using cohort allele
//     frequency for the unknown other-mate's contribution)
//   - Pools across many AB-parent dyads to estimate transmission
//     ratio
//   - Classifies the meiotic-drive verdict (MENDELIAN /
//     MILD_DRIVE / STRONG_DRIVE / INVIABILITY) instead of the
//     strict binary mendelian / non-mendelian flag
// ---------------------------------------------------------------------
export {
  MEIOTIC_DRIVE_VERDICTS,
  MEIOTIC_DRIVE_DEFAULTS,
  estimateAlleleFrequency,
  expectedDyadPMF,
  assessDyadConsistency,
  estimateTransmissionRatio,
  classifyMeioticDrive,
  annotateRegimeWithDyads,
  calibrateMeioticDriveBands,
  annotateRegimesWithDyadsAuto,
} from './regime_dyad_mendelian.js';

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

// COMBINER (karyotype_model.js): shipped in Layer 1f below. Folds
// trajectory + projection + vote evidence into a candidate-level
// verdict (BIALLELIC / MULTI_ALLELIC / COMPLEX / AMBIGUOUS).

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
