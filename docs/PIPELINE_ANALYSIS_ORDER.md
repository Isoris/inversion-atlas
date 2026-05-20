# Inversion pipeline — canonical analysis order

**Status**: mapping doc (no code changes in this commit).
**Authored** 2026-05-20, **revised** 2026-05-20 after user feedback re-positioning `haplotype_regime.js` and re-organising around three execution-flow clusters.
The legacy `INVERSION_PIPELINE_METHOD_v2.md` and the band_tracking/index.js header use a layer ordering; this doc uses an **execution-flow** ordering that matches what the haplotype_regimes page needs to call, in order.

**Purpose**: single source of truth for which file does what, in what order, with what inputs/outputs. The next-turn wiring pass will use this to thread the haplotype_regimes page through the full pipeline instead of just the legacy `runBandingPipeline` V-walker (which is one entry path among several).

---

## Total inventory: 43 scripts

- **33** in `atlases/inversion/shared/band_tracking/`
- **5** L3 primitives in `atlases/inversion/shared/` (`contingency`, `hungarian`, `kmeans`, `per_l2_cluster`, `cramers_v_merge`)
- **1** UI state in `atlases/inversion/shared/` (`regimes_registry`)
- **3** annotation utilities in `atlases/inversion/shared/regime_annotation/`
- **3** page-side renderers in `atlases/inversion/pages/discovery/haplotype_regimes/`

Every band_tracking/ script is placed below. Three are flagged as legacy/diagnostic and explicitly NOT part of the live pipeline.

---

## Three execution-flow clusters

The user's mental model: pre-voting (build seeds + their bands + band-subset combos) → voting (every band/window votes for every other) → post-voting (annotate, review, export). The 5-script voting cluster is the middle; everything else feeds in or out.

```
  ┌────────────────────────────────────────────────────────────────────┐
  │  CLUSTER 1 — PRE-VOTING                                            │
  │  Build seeds, their K bands, and 2^K-1 band-subset voter universe  │
  │                                                                    │
  │  Two alternative entry paths produce the same shape:               │
  │   (A) V-walker:    banding_pipeline → seed_discovery + ...         │
  │   (B) Het-skeleton: het.js → hom.js → cramers_v_merge → ...        │
  │   (C) Curated:      candidate-list from local_pca_dosage           │
  │                                                                    │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  CLUSTER 2 — VOTING (5 scripts + 1 orchestrator)                   │
  │                                                                    │
  │  For each band-subset of each seed (focal):                        │
  │    project onto every target window (projection.js)                │
  │    collect votes per target (vote_evidence + band_voters)          │
  │    enumerate set-partitions of K target bands (partition_enumerate)│
  │    pick best partition + consensus_class (partition_consensus)     │
  │  Wrapper: breadth_voting.js                                        │
  │                                                                    │
  └────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  CLUSTER 3 — POST-VOTING                                           │
  │                                                                    │
  │  Dosage overlay + per-sample karyotype call                        │
  │  Karyotype-model verdict (BIALLELIC / MULTI / COMPLEX / AMBIGUOUS) │
  │  Within-regime arrangement-identity (haplotype_regime.js)          │
  │  Cross-regime topology (regime_topology)                           │
  │  Mendelian + pedigree + linkage + dyad annotation                  │
  │  Positional + structural annotation                                │
  │  Genome-scale wiring                                               │
  │  Serializer + UI panels                                            │
  │                                                                    │
  └────────────────────────────────────────────────────────────────────┘
```

---

## CLUSTER 1 — pre-voting (build seeds + bands + voter universe)

The cluster has **three alternative entry paths** that all produce the same downstream shape: seeds with K-sample-set bands plus an enumeration of band-subset focal sets.

### Path A — V-walker (the current "Run pipeline" path)

Bruteforce auto-discovery using band_quality + Cramér's V walking.

| File | Layer | Role |
|---|---|---|
| `band_tracking/banding_pipeline.js` | orchestrator | `runStage1` + `runStage2` + `runStage3` + `runStage4` + `runBandingPipeline`. Stages 1-4 unified driver. |
| `band_tracking/seed_discovery.js` | Stage 1 | Coarse anchor sweep → band_quality refinement → V/H_off walker with hysteresis → local-radius extension → dedup. **Anchor gate**: `band_quality ≥ 0.50`. |
| `band_tracking/anchor_signals.js` | Stage 1 support | Per-window Cramér's V + H_off vs a tracked anchor labeling. **Per-window resolution, NEVER L2-broadcast** — that's the rule in the band_tracking/index.js header. |
| `band_tracking/window_classification.js` | Stage 1 support | Per-window 3-way classifier `INTERIOR / CROSSOVER / REGIME_END / UNRELIABLE` from V(w), H_off(w), band_quality(w). The walker break/extend signal. |
| `band_tracking/band_quality.js` | Stage 1 + Stage 3 gate | `min(silhouette_norm, size_balance, eig_ratio_norm) ∈ [0,1]`. Gates anchor selection (default 0.50) + chain extension (default 0.40). |
| `band_tracking/cross_seed_voting.js` | Stage 2 | Every seed votes on every other via Hungarian-aligned contingency → `pattern_class` matrix + reliability verdict (`VALID / NOISE / UNDETERMINED`) + linkage groups. |
| `band_tracking/locus_construction.js` | Stage 3 | Per-seed classifier-gated chain walk → per-band sample sets via `locusBandSampleSets` (intersection) or `locusBandSampleSetsMajority` (majority vote). |

**Output of Path A**: array of seeds, each with `{anchor_w, s_window, e_window, K, per_band_samples: Set[], classifications, ...}`.

### Path B — Het-skeleton (the user's reconstructed path)

Skeleton-first; no band_quality gate, no V-walker.

| File | Role |
|---|---|
| `shared/kmeans.js` | `kmeans1D` / `adaptiveK1D`: per-window K-means from `data.windows[w].pc1`. The PER-WINDOW labels every downstream consumer needs. |
| `band_tracking/single_band.js` | `single_band_track_from_seed`: extract one band as a sample set and Jaccard-walk it across windows. The "take each band separately" atomic operation. |
| `band_tracking/het.js` | `het_detect_candidate_band` (intermediate-PC1 band per window) → `het_track_skeleton` (Jaccard-walk a HET seed forward+backward) → `het_define_interval` (bp coords) → `iv_merge_het_tracks` (optional pre-merge). |
| `band_tracking/hom.js` | `hom_anchor_in_window` + `hom_anchor_to_het`: HOM_A (low-PC1) / HOM_B (high-PC1) anchors from each het skeleton; consensus via fraction-above-threshold voting. |
| `shared/contingency.js` | `buildContingency` + `cramersV` + `chiSquare` + ARI/NMI/fusion-event detectors. Atomic L3 currency. |
| `shared/hungarian.js` | `alignLabels`: K! permutation enumeration to align two label sets so contingency diagonal is maximized. |
| `shared/cramers_v_merge.js` | `computeAdjacentSeedMerges` / `runCramersVMergeLocal`: walk adjacent intervals → MERGE/SEPARATE/INSUFFICIENT verdicts → fuse consecutive MERGEs into chains → seeds. |

**Output of Path B**: array of intervals with bp coords + `{hom_a_consensus, hom_b_consensus, het_core, K bands}`.

### Path C — Curated candidate list (the existing short-range mode)

User-promoted candidates from the local_pca_dosage page.

| File | Role |
|---|---|
| `_local_pca_dosage_state.candidateList` (state) | User-drawn candidates with `{start_w, end_w, K, locked_labels}`. |
| `haplotype_regimes.js::_buildShortRangeResult` | Converts candidates into the same shape Path A / Path B produce. |

### Band-subset combo enumerator (shared by all three paths)

For each seed with K bands, the voter universe is `2^K - 1` non-empty subsets. The page builds these masks:

| File | Role |
|---|---|
| `haplotype_regimes/regimes_page.js` | `enumerateBandSubsets(K)`, `maskToBands(mask, K)`, `maskLabel(mask, K)`. K=3 → 7 combos. |

Once Cluster 1 finishes, every focal is a `(seed_id, band_mask, sample_set)` triple ready to feed Cluster 2.

---

## CLUSTER 2 — voting (the 5-script middle + orchestrator)

For each focal `(seed_id, band_mask)`, project onto every target window/seed in the genome, aggregate the votes, and emit a per-focal consensus + classification.

| File | Role |
|---|---|
| `band_tracking/projection.js` | `classifyProjection(focal_samples, target_labels, K_target)` → `{visited_bands, excluded_bands, pattern_class, purity_vector}`. Pattern class ∈ {SINGLE, SUBSET, SUBSET_SPLIT, SPLIT_TWO, COHERENT_SPLIT, RANDOM_FAN, SCATTER, EMPTY}. Also `classifyProjectionWithStability` for multi-window daughter-stability check. |
| `band_tracking/vote_evidence.js` | `extract_votes` / `build_coassociation_matrix` / `build_per_band_vote_index` / `voteRecords_from_projections`. Pattern-class weights (default SINGLE/SUBSET = 1.0, SUBSET_SPLIT = 0.7, SPLIT_TWO = 0.5, FAN/SCATTER/EMPTY = 0). |
| `band_tracking/band_voters.js` | Band-centric inversion of the voter graph: `collect_voters_for_band` / `compute_partner_affinities` / `derive_partner_sets` / `compute_voter_consensus` / `compute_overlap_conflict`. **This is "every other band votes for us" — visitors, excluders, partners, conflicts per focal band.** |
| `band_tracking/partition_enumerate.js` | `enumerate_partitions_as_blocks` + `score_partition_against_coassoc` + `select_top_partitions_adaptive`. Brute Bell(K) partitions of K bands scored by pair-weighted agreement. |
| `band_tracking/partition_consensus.js` | `consensus_partition`: ties vote_evidence + band_voters + partition_enumerate into one call → top-N partitions, `consensus_class ∈ {CLEAN_PARTITION, SOFT_PARTITION, AMBIGUOUS_BAND, OVERLAPPING_VOTES, MULTI_LAYER_STRUCTURE, NO_CLEAN_CONSENSUS}`, `resolving_power_class`. |

**Orchestrator**:

| File | Role |
|---|---|
| `band_tracking/breadth_voting.js` | `runBreadthVoting` + helpers (`buildVotersFromSeedLoci`, `buildTargetsFromWindows`, `buildTargetsFromStage3Loci`). The for-loop wrapper: N_voters × K × N_targets → calls projection per pair, hands the vote stream to partition_consensus per target. Outputs `{per_target: [{consensus, voteRecords, n_voters}], summary: {n_targets, n_stability_upgraded}}`. |

**Output of Cluster 2**: per-target consensus partition + classification = the long-range segregation pattern in the population. "This focal band always traverses these samples; this band never crosses us; this region splits in this way."

---

## CLUSTER 3 — post-voting (annotate, refine, review, export)

### 3a — Dosage overlay + per-sample karyotype call (Stage C5-C7)

| File | Role |
|---|---|
| `band_tracking/dosage_overlay.js` | Stage C5-C6. For each macro-band emitted by Cluster 2's consensus partition: mean polarized dosage → class `HOM_REF / HET / HOM_INV / AMBIGUOUS`. Polarity check (one HET per arrangement axis). HET-disjointness count = number of independent arrangement axes. |
| `band_tracking/karyotype_caller.js` | Stage C7. Per-axis per-sample state_pc1 vs state_dosage → concordance ∈ `{AGREE, DISAGREE, AMBIGUOUS}` → final call `HOM_REF / HET / HOM_INV / FLAGGED / NA` + confidence. DISAGREE goes to Mendelian gates for resolution. |
| `band_tracking/iv.js` | Per-sample karyotype call from het skeleton + HOM anchors (the simpler version of karyotype_caller that uses only Layer 1b/1c outputs, before breadth voting). Useful when Path B is the seed source. |

### 3b — Karyotype-model verdict combiner (Layer 1f)

| File | Role |
|---|---|
| `band_tracking/trajectory.js` | PC1 sign anchoring (resolve flip ambiguity via reference-sample pool) + per-band PC1 trajectory time series + pairwise Pearson + `band_group_by_trajectory_similarity`. **All exports use the per-window callback contract; NEVER L2-broadcast.** |
| `band_tracking/karyotype_model.js` | `kt_combine_trajectory_and_projection_evidence` + `kt_infer_macro_band_groups` + `kt_resolve_karyotype_model`. Fold three evidence streams (trajectory grouping + projection pattern_class + vote consensus class) into per-band agreement → macro-band assignment → candidate-level verdict `BIALLELIC / MULTI_ALLELIC / COMPLEX / AMBIGUOUS`. |

### 3c — Within-regime arrangement-identity (the *corrected* role of `haplotype_regime.js`)

| File | Role |
|---|---|
| `band_tracking/haplotype_regime.js` | `intervalSampleCore` + `relateIntervals` + `buildHaplotypeRegimeGraph` + `clusterHaplotypeRegimes` + `refineRegimesFromIntervals`. Given intervals that the voting pass has identified as part of the segregation pattern, decide whether two intervals represent the **same physical inversion arrangement**: EXTENSION (same arrangement) / NESTED (one contains other) / SHARED_HET (same heterozygotes, different homozygote pools) / SWAPPED (same arrangement with PC1-sign flip) / UNRELATED (different biology). It's arrangement-identity resolution, **not** the source of the long-range segregation signal — that comes from Cluster 2. |

### 3d — Cross-regime topology + Mendelian + pedigree + linkage + dyad

| File | Role |
|---|---|
| `band_tracking/regime_topology.js` | `regimePairwiseTopology` / `buildRegimeTopologyGraph` / `findChromosomeRegimeChains` / `serializeRegimesToJson`. Per-chromosome cross-regime relationships: NESTED / ADJACENT / CHAINED / OVERLAPPING_CONFLICT / INDEPENDENT. Walks CHAINED edges into multi-inversion lineage chains. |
| `band_tracking/regime_mendelian.js` | Method A (trio contradiction counting) + Method B (per-family χ² goodness-of-fit). Per-regime `support_status ∈ {SUPPORTED, INCONCLUSIVE, CONTRADICTED}` + per-(regime, family) `segregation_status` (6 states) + `effect_direction` (7 tags). |
| `band_tracking/regime_pedigree.js` | Inverse direction: cross-regime co-membership → pairwise relatedness verdicts (DUPLICATE / FIRST_DEGREE / SECOND_DEGREE / UNRELATED / INSUFFICIENT_DATA). Cross-checks ngsPedigree pair calls. |
| `band_tracking/regime_linkage.js` | Cohort LD between regimes (3×3 karyotype contingency + Cramér's V across all samples) + family-level recombination test (doubly-het parents → offspring → r̂). Pairwise verdict: LINKED / WEAKLY_LINKED / INDEPENDENT / INSUFFICIENT_DATA. |
| `band_tracking/regime_dyad_mendelian.js` | Dyad (single-parent) gates + pooled-dyad binomial transmission test + meiotic-drive classification: MENDELIAN / MILD_DRIVE / STRONG_DRIVE / INVIABILITY / INSUFFICIENT_DATA. |

### 3e — Positional + structural annotation

| File | Role |
|---|---|
| `shared/regime_annotation/index.js` | Public API for the annotation layer (`SPEC_regime_annotation_v34.md` Stage 5.5). |
| `shared/regime_annotation/positional.js` | `annotateRegimePosition` / `annotateRegimePositions`: per-regime chromosome-position context. Label ∈ {CENTROMERIC, PERICENTROMERIC, SUBTELOMERIC, ARM_SCALE, INTERSTITIAL} + distance to centromere/telomeres + arm scale. |
| `shared/regime_annotation/structure.js` | `annotateRegimeStructure` / `annotateRegimeStructures`: per-regime structural label ∈ {SIMPLE_HAPLOTYPE_SPLIT, INVERSION_DOSAGE_LIKE, NESTED_OR_COMPOUND, NOISE_OR_RECOMBINANT, ...} from M / K / boundary sharpness / internal nesting. |

### 3f — Genome-scale integration hub

| File | Role |
|---|---|
| `band_tracking/genome_scale.js` | `mergePerChromosomeRegimes` (per-chrom outputs → flat array with chrom + regime_uid) + `crossChromosomeRegimeLinks` (CHAINED links across chromosomes with min_shared HOM samples) + `genomeWidePedigreeFromRegimes` + `genomeWideRegimeReport`. **The single-call top-level orchestrator for Layers 4-5.** |

### 3g — Catalogue serializer + UI persistence

| File | Role |
|---|---|
| `band_tracking/regime_catalogue.js` | `buildCatalogue` + `computeKnobHash` + `serializeCatalogue`. In-memory output → on-disk JSON triple (`manifest.json` + `knobs.json` + `catalogue.json`). Content-addressed by knob_hash (SHA-1 prefix). |
| `shared/regimes_registry.js` | UI-side persistence (localStorage) of user-authored regime labels + axis topology. **Not part of the detection pipeline** — passenger module the page uses for editable annotations. |

### 3h — Atlas-page review panels

| File | Role |
|---|---|
| `haplotype_regimes.js` (the page) | Mounts the page, builds the pipeline ctx, dispatches Run-pipeline button to the right Cluster 1 path. Wires the L3 pairs table, auto-merge V button, promote-seed button. |
| `haplotype_regimes/regimes_page.js` | 4-canvas 2×2 grid layout. Focal-voter selector + arrow-key navigation. Houses `enumerateBandSubsets` + `maskToBands` + `maskLabel` (the band-combo enumerator). |
| `haplotype_regimes/regimes_panel.js` | Target-band-lanes panel (chrom + genome scope). Per-window pattern_class strip on top; per-sample lane jumps below. `_dosageClassColour` palette. |
| `haplotype_regimes/regimes_pc1_panel.js` | PC1-lines panel (chrom + genome scope). Per-sample lines coloured by voter-band membership. "You are here" rectangle over the seed window range with dosage-tinted K stripes. |

---

## Module API surfaces (not pipeline steps)

| File | Status |
|---|---|
| `band_tracking/index.js` | Public API re-export aggregator. Imported by the haplotype_regimes page + tests. No execution. |
| `band_tracking/index_min.js` | **Diagnostic-only** re-export for Option-B `consensus_partition` drivers (LG28 harness). Skips Layer 1 entirely. NOT production. |

---

## Flagged anomalies — files NOT in the live pipeline

| File | Status | Notes |
|---|---|---|
| `band_tracking/_kmeans_imported.js` | **Duplicate** of `shared/kmeans.js` (same `// shared/kmeans.js` header on line 1). Relocated copy. One of the two should be deleted in a cleanup pass. |
| `band_tracking/projection_STUB.js` | **Stub**. Exists to satisfy `vote_evidence` imports during minimal Stage-4 tests. Production `projection.js` overwrites it. Verify production lands on top in any deployment. |
| `band_tracking/index_min.js` | **Diagnostic surface**. Production uses `index.js`. |

These three files are real, but should not be invoked by the live pipeline.

---

## Gaps in the connection graph (today)

1. **`banding_pipeline.js` is not re-exported by `index.js`** — reachable only from outside band_tracking/. The haplotype_regimes page calls it directly. Fine but worth noting.
2. **`iv.js` has no downstream consumer inside band_tracking/.** Its output feeds `regime_mendelian.js` via the page's explicit invocation. Intentional separation of concerns.
3. **`regime_catalogue.js` (the serializer) has no in-code consumer inside band_tracking/.** Output is disk JSON for cross-cohort aggregation. By design.
4. **Page-side gap (the one the next-turn commit closes)**: the page currently calls only Cluster 1 Path A (`runBandingPipeline`) + the per-pair Cramér's V table for `_renderL3PairsTable`. **Cluster 1 Path B (het-skeleton via `het.js` → `hom.js` → `cramers_v_merge`), all of Cluster 3 from §3a onward, and the genome_scale integration hub are not yet wired.**
5. **The page passes L2-broadcast labels to the pipeline.** `_wireCtxCallbacks` currently routes through `per_l2_cluster.clusterL2` which returns the same labels for every window in an L2 envelope. The band_tracking/index.js header is explicit: **"per-window K-means labels via getLabels/getK callbacks, NEVER L2-broadcast."** Fix: per-window `kmeans1D` from `data.windows[w].pc1`.

---

## What `haplotype_regime.js` actually is (the user's correction)

Previously this doc placed `haplotype_regime.js` as Layer 3 ("the long-range haplotype regime detector"). That was wrong. The long-range *segregation* signal comes from **Cluster 2 (voting)** — every band of every seed projected onto every target window, aggregated via partition consensus.

`haplotype_regime.js`'s actual role is **within-regime arrangement-identity refinement**: given intervals that have *already been identified as part of a long-range segregation pattern by the voting pass*, decide whether two of those intervals represent the same physical inversion arrangement (EXTENSION), opposite-strand version of the same arrangement (SWAPPED), one nested inside the other (NESTED), shared heterozygotes but different homozygote pools (SHARED_HET), or different biology (UNRELATED). It's an arrangement-identity resolution step, not a pattern-discovery step.

The script's own header still describes itself as "long-range regimes — chains of intervals that share haplotype identity." That's literally what `clusterHaplotypeRegimes` does (union-find over EXTENSION+SWAPPED edges), but in the user's mental model this is *refinement on top of* the segregation patterns Cluster 2 has already discovered, not the source of the long-range signal.

---

## What "long-range segregation pattern" means in the user's flow

The voting cluster (Cluster 2) operates per-focal-band-subset and asks: across the entire genome, who votes for me visited, who votes excluded, who fans? This is "long-range" because the **voter set spans the whole genome** — every other seed, every other band, every other window. The result tells us "this band of this seed always travels with this sample-set across the genome" (long-range = many distant voters agree). That's the segregation pattern: who segregates with whom across the population, supported by genome-wide co-presence evidence.

This is distinct from:
- "Long" in the V-walker sense (a seed footprint can be many windows wide) — that's Path A's `s_window..e_window` extent.
- "Long-range" in `haplotype_regime.js` (intervals fused across skeleton breaks) — that's Cluster 3c's interval-identity resolution.

Three different "long-range" meanings; the user's primary one is the voting one.

---

## Three load-bearing entry points for the haplotype_regimes page

The page's "Run pipeline" button should chain (per mode):

**Mode 1 — V-walker (current default)**
1. Cluster 1 Path A: `runBandingPipeline(ctx, opts)` — Stages 1-4.
2. Cluster 3 from §3a onward: dosage_overlay → karyotype_caller → karyotype_model → haplotype_regime (refine arrangement identity) → regime_topology → optional 4b-4d → genome_scale.
3. Render via `initRegimesPage` (already wired) + post-render annotations.

**Mode 2 — Curated candidates (short-range, existing)**
1. Cluster 1 Path C: `_buildShortRangeResult(state)` — seeds from candidate list.
2. Same Cluster 2 + Cluster 3 tail as Mode 1.

**Mode 3 — Het-skeleton (NEW, matches user's reconstructed pipeline)**
1. Cluster 1 Path B: per-window `kmeans1D` → `het_detect_candidate_band` per window → `het_track_skeleton` from each HET seed → `het_define_interval` → `hom_anchor_to_het` per skeleton → `computeAdjacentSeedMerges` between adjacent intervals → fuse into Cramér's V seeds.
2. Same Cluster 2 + Cluster 3 tail as Modes 1 and 2.

All three modes share Clusters 2 and 3 verbatim — they differ only in how Cluster 1 produces seeds.

---

## Per-window K-means: the load-bearing rule

The band_tracking/index.js header is explicit:
> "per-window K-means labels via getLabels/getK callbacks, NEVER L2-broadcast — same per-window upgrade noted in anchor_signals.js header"

Current `haplotype_regimes.js::_wireCtxCallbacks` violates this (routes through `per_l2_cluster.clusterL2`). The next-turn commit replaces the L2 routing with per-window `kmeans1D` / `adaptiveK1D` from `data.windows[w].pc1`, caches the labels in a `perWinLabels[w]` array, and stubs `getL2Idx = () => 0` (the legacy L2 branch is unreachable in classifier mode anyway, per `locus_construction.js`).

This single change unblocks Cluster 1 Path A (V-walker sees non-degenerate adjacent-window contingencies), Path B (het.js can detect HET bands per window), and Cluster 3b (trajectory.js needs per-window labels for sign anchoring).

---

## Next-turn wiring plan (preview, not yet implemented)

1. **Replace `_wireCtxCallbacks` body**:
   - Per-window `kmeans1D` / `adaptiveK1D` cache → `getLabels(w)` / `getK(w)` callbacks
   - Drop L2 routing; stub `getL2Idx = () => 0`
   - Keep band_quality computation (now uses per-window labels — correct)
   - Drop synthetic-L2 hack (no longer needed)

2. **Add mode 3 toggle** to `rgModeBar`. Persist to localStorage like modes 1+2.

3. **Implement Mode 3 entry path** (Cluster 1 Path B):
   - Loop per window: `het_detect_candidate_band`
   - For each HET seed: `het_track_skeleton` (forward + backward via Jaccard)
   - `het_define_interval` → bp coords
   - `hom_anchor_to_het` per skeleton → HOM_A / HOM_B
   - `computeAdjacentSeedMerges` between adjacent intervals → fuse chains
   - Output: same seed-with-bands shape Mode 1's `runStage3` produces

4. **Implement the shared Cluster 2 + Cluster 3 tail** (called by all three modes):
   - `breadth_voting.runBreadthVoting` (Cluster 2 — already inside `runBandingPipeline` for Mode 1, called explicitly for Modes 2+3)
   - `dosage_overlay.classifyMacroBands` + `dosage_overlay.countAxesByHetDisjointness`
   - `karyotype_caller.callAxisKaryotype` per axis per sample
   - `karyotype_model.kt_resolve_karyotype_model` for the verdict
   - `haplotype_regime.refineRegimesFromIntervals` for arrangement identity
   - `regime_topology.buildRegimeTopologyGraph` + `findChromosomeRegimeChains`
   - Optional 4b-4d (Mendelian/pedigree/linkage/dyad) when trios/families/dyads supplied
   - `genome_scale.genomeWideRegimeReport` — single-call hub that can take all the above
   - `regime_annotation/positional.annotateRegimePositions` + `regime_annotation/structure.annotateRegimeStructures`
   - `regime_catalogue.serializeCatalogue` for the export button

5. **Diagnostics**:
   - band_quality stats (mean, max, n_pass_default, first 10)
   - Per-window K-means provenance (n_computed, n_skipped)
   - Per-cluster timing breakdown (`heat_detect: 120ms, skeleton_track: 340ms, breadth_vote: 1800ms, refine_regimes: 80ms, ...`)
   - Surface 0-seeds reason in status bar

6. **Render**: feed the final Cluster 3 output into the existing 4-panel `initRegimesPage` shell + any new panels for positional/structural annotations.

The two prior commits on this branch (band_quality wiring `476459d`, synthetic-L2 fallback `1891155`) are subsumed naturally — the new per-window K-means path computes band_quality against real labels, and the synthetic-L2 hack disappears entirely.

---

*End of mapping doc. The wiring lives in the next-turn commit.*
