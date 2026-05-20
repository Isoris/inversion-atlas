# Inversion pipeline — canonical analysis order

**Status**: mapping doc (no code changes in this commit).
**Authored** 2026-05-20 from a band_tracking/ + shared/ recon and the user's
reconstructed-from-memory analysis order. The legacy
`INVERSION_PIPELINE_METHOD_v2.md` is partly outdated; this doc supersedes
it where they disagree.

**Purpose**: single source of truth for which file does what, in what order,
with what inputs/outputs. The next-turn wiring pass will use this to thread
the haplotype_regimes page through the full pipeline instead of just the
legacy `runBandingPipeline` V-walker (which is one entry path among several).

**Total inventory**: 33 files in `atlases/inversion/shared/band_tracking/`
plus 7 supporting primitives in `atlases/inversion/shared/`, plus 3 utilities
in `atlases/inversion/shared/regime_annotation/`. 43 scripts.

---

## Pipeline shape (compressed)

```
LAYER 0   L3 primitives          contingency, hungarian, kmeans,
                                 per_l2_cluster, cramers_v_merge
                                            │
LAYER 1a  single-band trajectory          single_band.js
LAYER 1b  HET skeleton                    het.js
LAYER 1c  HOM anchors                     hom.js
LAYER 1d  per-sample karyotype call       iv.js
LAYER 1e  PC1 sign anchor + grouping      trajectory.js
LAYER 1f  karyotype-model combiner        karyotype_model.js
                                            │
LAYER 2   Stages 1-4 unified              banding_pipeline.js
          ├ Stage 1  seed discovery       seed_discovery.js + anchor_signals +
          │                               window_classification + band_quality
          ├ Stage 2  cross-seed voting    cross_seed_voting.js
          ├ Stage 3  locus construction   locus_construction.js
          └ Stage 4  breadth voting       breadth_voting.js +
                                          partition_consensus + partition_enumerate +
                                          vote_evidence + band_voters + projection
                                            │
LAYER 3   long-range regime refinement    haplotype_regime.js
                                            │
LAYER 4a  cross-regime topology           regime_topology.js
LAYER 4b  Mendelian (trios + families)    regime_mendelian.js
LAYER 4c  pedigree (inverse direction)    regime_pedigree.js
LAYER 4c  regime LD                       regime_linkage.js
LAYER 4d  dyad Mendelian + meiotic drive  regime_dyad_mendelian.js
                                            │
LAYER 5   chromosome-scale wiring         genome_scale.js
                                            │
POST      regime annotation               regime_annotation/positional.js
                                          regime_annotation/structure.js
POST      catalogue serializer            regime_catalogue.js
```

The user's reconstructed-from-memory order: **per-window K-means → het.js (skeleton) → contingency + cramers_v_merge (V-seeds) → for each band: 2-direction voting → long-range/short-range haplotype regimes.** That maps to: Layer 0 → Layer 1b → (skip 1c-1f or run them, depending on whether per-sample calls are needed) → Layer 2 Stage 4 (breadth voting = "every window votes for us; we vote for every window") → Layer 3 (`haplotype_regime.refineRegimesFromIntervals`).

The two readings (the index.js layer order vs. the user's execution order) are not in conflict — they are the same chain viewed by **organizational grouping** vs. **what-feeds-what**.

---

## Layer 0 — L3 primitive foundation (`shared/`, not in band_tracking/)

These live one level up because they are reused across the atlas (PCA panels, dosage chunks, etc.), not exclusive to band_tracking. The pipeline is built on top of them.

| File | Role | Top exports | Inputs | Outputs | Consumed by |
|------|------|-------------|--------|---------|-------------|
| `shared/contingency.js` | K×K contingency table + Cramér's V / χ² / ARI / NMI. The atomic currency of band-tracking. | `buildContingency`, `cramersV`, `chiSquare`, `chiSqSurvival`, `detectFuseEvents`, `detectSplitEvents` | two label arrays + K | M[KA×KB], V, χ² p, fusion/split events | anchor_signals, cross_seed_voting, cramers_v_merge, regime_linkage, regime_dyad_mendelian |
| `shared/hungarian.js` | Brute K! permutation to maximize contingency diagonal. K ≤ 8 (atlas uses K=3,6). | `alignLabels`, `LINEAGE_CHAIN_BREAK_AGREEMENT` | two label arrays + K | aligned contingency + permutation | anchor_signals, locus_construction, cross_seed_voting, cramers_v_merge, projection |
| `shared/kmeans.js` | 1D/2D K-means + silhouette + adaptive K. | `kmeans1D`, `kmeans2D`, `silhouette1D`, `adaptiveK1D`, `adaptiveK2D` | PC1 (and PC2) + K | labels Int8Array + centers | per_l2_cluster + everything downstream via getLabels callbacks |
| `shared/per_l2_cluster.js` | Per-L2-envelope aggregation + K-means. **Per the band_tracking/index.js header, the pipeline must NOT use L2-broadcast labels — getLabels(w) must return per-window K-means.** Keep this module for visualization consumers; the pipeline replaces its labels source with per-window kmeans1D. | `contextFromState`, `aggregateL2`, `clusterL2`, `getL2Cluster`, `clusterL2AtK` | L2 envelope PC1/PC2 + knobs | cached per-L2 labels + silhouette | legacy visualization (L3 pairs panel) |
| `shared/cramers_v_merge.js` | Adjacent-seed Cramér's V pair walk → MERGE / SEPARATE / INSUFFICIENT verdicts → chains into candidate regions. Already wired to a UI button (`_runAutoMergeCramersV`). | `computeAdjacentSeedMerges`, `CRAMERS_V_MERGE_DEFAULTS`, `runCramersVMergeLocal` | seeds[] + getLabels + getK | per-pair {v, χ², p, verdict} + multi-seed chains | UI auto-merge button; **could feed Layer 2 Stage 2 instead of cross_seed_voting if we want V-only seeding** |
| `shared/regimes_registry.js` | UI persistence (localStorage) of user-authored regime labels + axis topology. **Not part of the detection pipeline.** | regimes registry exports | state | hydrated regimes for the page UI | haplotype_regimes UI |

---

## Layer 1 — single-band trajectory, HET / HOM, per-sample call

### 1a — Single-band trajectory

| File | Role |
|------|------|
| `band_tracking/single_band.js` | Atomic unit of band identity. Jaccard-walking forward/backward from a seed window+band, emits a track of band-membership-by-window with continuity scores. |

Exports: `SINGLE_BAND_DEFAULTS`, `bandMembers`, `bandJaccard`, `single_band_track_from_seed`, `single_band_score_continuity`.
Inputs: `getLabels(w)`, `getK(w)`, seed (w, k), chr range.
Outputs: `{ok, seed_w, seed_k, s_window, e_window, windows:[{w,k,members,jaccard}], continuity}`.
Consumed by: **het.js, trajectory.js, haplotype_regime.js.**

### 1b — HET detection + skeleton (interval seed)

| File | Role |
|------|------|
| `band_tracking/het.js` | Detect the HET band at each window (mid-PC1 OR mean-dosage ≈ 1.0). Stitch a forward+backward skeleton via single_band_track from a het seed. Define the bp interval. |

Exports: `meanSignalPerBand`, `meanPc1PerBand`, `meanDosagePerBand`, `het_detect_candidate_band`, `het_detect_candidate_band_by_signal`, `het_track_skeleton`, `het_track_skeleton_by_signal`, `het_define_interval`, `iv_merge_het_tracks`, `HET_DEFAULTS`.
Inputs: per-window getLabels/getPc1/getK/getBpFor + seed_w; mean signal per band.
Outputs: skeleton (windows + het_span_fracs + continuity) and interval (start_bp / end_bp / n_windows).
Consumed by: **hom.js, iv.js, haplotype_regime.js.**

### 1c — HOM_A / HOM_B anchors

| File | Role |
|------|------|
| `band_tracking/hom.js` | Walk the het skeleton; at each window pick the low-PC1 band as HOM_A and the high-PC1 band as HOM_B; consensus via fraction-above-threshold voting. |

Exports: `HOM_DEFAULTS`, `hom_anchor_in_window`, `hom_anchor_to_het`.
Outputs: `{ok, n_windows, hom_a_per_window, hom_b_per_window, hom_a_consensus, hom_b_consensus, scores}`.
Consumed by: **iv.js, haplotype_regime.js.**

### 1d — Per-sample karyotype caller (Layer 1 tail)

| File | Role |
|------|------|
| `band_tracking/iv.js` | For each sample, walk the het skeleton; tally het / hom_a / hom_b membership; emit `STD/STD | HET | INV/INV | AMBIGUOUS | UNCALLED`. |

Exports: `IV_CALLS`, `IV_CALL_DEFAULTS`, `iv_call_samples_from_skeleton`.
Consumed by: **karyotype_model.js (Layer 1f), regime_mendelian.js.**

### 1e — PC1 sign anchoring + per-band trajectory grouping

| File | Role |
|------|------|
| `band_tracking/trajectory.js` | Resolve PC1 sign ambiguity (reference-sample pool), extract per-band trajectory time series, pairwise Pearson, group bands by trajectory similarity (coherent signal = same arrangement). |

Exports: `TRAJECTORY_DEFAULTS`, `pickPc1OrientationReferenceSamples`, `computePc1SignAnchors`, `band_compute_pc1_trajectory`, `band_pairwise_trajectory_correlation`, `band_group_by_trajectory_similarity`.
Consumed by: **karyotype_model.js.**

### 1f — Karyotype-model combiner

| File | Role |
|------|------|
| `band_tracking/karyotype_model.js` | Fold trajectory grouping + projection pattern_class + vote consensus class into per-band agreement → macro-band assignment → candidate-level verdict: `BIALLELIC / MULTI_ALLELIC / COMPLEX / AMBIGUOUS`. |

Exports: `KARYOTYPE_MODEL_VERDICTS`, `KT_AGREEMENT_FLAGS`, `KT_DEFAULTS`, `kt_combine_trajectory_and_projection_evidence`, `kt_infer_macro_band_groups`, `kt_resolve_karyotype_model`.

---

## Layer 2 — Stages 1–4 unified V-walker (`banding_pipeline.js`)

### 2a — Per-window signal primitives

| File | Role |
|------|------|
| `band_tracking/band_quality.js` | Per-window stability score `min(silhouette_norm, size_balance, eig_ratio_norm) ∈ [0,1]`. Gate for chain extension + seed-discovery anchor validation. Default threshold 0.40 (chain) / 0.50 (anchor). |
| `band_tracking/anchor_signals.js` | Per-window Cramér's V + off-diagonal entropy (H_off) vs. a tracked-anchor labeling. **The header is explicit: per-window resolution, NOT L2-broadcast.** Replaces legacy `recomputeAnchorConcord`. |
| `band_tracking/window_classification.js` | Per-window 3-way classification `INTERIOR / CROSSOVER / REGIME_END / UNRELIABLE` from V(w), H_off(w), band_quality. The load-bearing walker break/extend signal. |

### 2b — Stage 1: seed discovery

| File | Role |
|------|------|
| `band_tracking/seed_discovery.js` | Coarse-grid anchor sweep → neighborhood refinement on band_quality → V/H_off walk over [anchor-R, anchor+R] with hysteresis → local-radius extension → dedup. **This is where the 0-seeds bug bites if band_quality is missing.** |

Exports: `discoverSeedsOnChromosome`, `SEED_DISCOVERY_DEFAULTS`.

### 2c — Stage 2: cross-seed voting

| File | Role |
|------|------|
| `band_tracking/cross_seed_voting.js` | Every seed votes on every other via Hungarian-aligned contingency; per-row purity → `pattern_class ∈ {SINGLE, SUBSET, SUBSET_SPLIT, SPLIT_TWO, FAN, SCATTER, EMPTY}`; reliability + linkage groups (mutual-SUBSET connected components). |

Exports: `runStage2`, `CROSS_SEED_VOTING_DEFAULTS`.

### 2d — Stage 3: locus construction

| File | Role |
|------|------|
| `band_tracking/locus_construction.js` | Chain walk inside each seed footprint in classifier mode (gated by getClassification). Per-band sample-set aggregation (majority or intersection). Emits loci. **L2-gap merge step exists but is unreachable when getClassification is provided** — matches the L2-free design. |

Exports: `chainWalkOneChromosome`, `locusBandSampleSets`, `locusBandSampleSetsMajority`, `LOCUS_CONSTRUCTION_DEFAULTS`.

### 2e — Stage 4: breadth voting + partition consensus

Five files, one orchestrator (`breadth_voting.js`):

| File | Role |
|------|------|
| `band_tracking/projection.js` | Focal sample-set → target window K bands → purity → `pattern_class`. Daughter-stability via `classifyProjectionWithStability` (multi-window neighbour stability). **This is "we vote for every window".** |
| `band_tracking/vote_evidence.js` | Vote tuple extraction + co-association matrix + per-band vote indices. Pattern-class weights (default SINGLE/SUBSET = 1.0, SUBSET_SPLIT = 0.7, SPLIT_TWO = 0.5, FAN/SCATTER/EMPTY = 0). |
| `band_tracking/band_voters.js` | Band-centric view: "standing on band b, who votes for us?" Visitor / excluder sets + partner-set affinity + conflict scoring. **This is "every window votes for us".** |
| `band_tracking/partition_enumerate.js` | Brute-enumerate all set-partitions of K bands (Bell(K), K ≤ 10), score by pair-weighted agreement with coassoc matrix, adaptive top-N. |
| `band_tracking/partition_consensus.js` | Stage-4 orchestrator: ties vote_evidence + band_voters + partition_enumerate. Outputs per-target consensus + 6-class consensus_class + resolving_power_class. |
| `band_tracking/breadth_voting.js` | **Stage C2-C4 driver.** N_voters × K_voter × N_targets vote tensor → per-target consensus partition. Bruteforce as designed. |

Stage-4 exit point: per-target `{consensus, voteRecords, n_voters}` + summary counts.

### Stage orchestrator

| File | Role |
|------|------|
| `band_tracking/banding_pipeline.js` | **Stages 1-4 entry point.** `runBandingPipeline(ctx, opts)`. The page already calls this; it's not the only path the page should call. |

Exports: `runStage1`, `runStage2`, `runStage3`, `runStage4`, `runBandingPipeline`, `BANDING_PIPELINE_DEFAULTS`.
**Currently called from**: `haplotype_regimes.js` line 367 (long-range "Run pipeline" button).

---

## Layer 3 — long-range haplotype regime refinement

| File | Role |
|------|------|
| `band_tracking/haplotype_regime.js` | Consumes het-skeleton intervals + HOM consensus. Pairwise interval relationships via Jaccard scoring: `EXTENSION / NESTED / SHARED_HET / SWAPPED / UNRELATED`. Union-find clustering of EXTENSION + SWAPPED edges → REGIMES (chains of related intervals across a larger range than any single skeleton). Per-regime consensus cores. |

Exports: `HAPLOTYPE_REGIME_RELATIONSHIPS`, `HAPLOTYPE_REGIME_DEFAULTS`, `intervalSampleCore`, `relateIntervals`, `buildHaplotypeRegimeGraph`, `clusterHaplotypeRegimes`, `refineRegimesFromIntervals`.

**This is the entry point the user keeps gesturing at.** It does not currently get called by the page — that's the gap to close in the next-turn wiring.

---

## Layer 4 — cross-regime annotation

### 4a — Cross-regime topology (intra-chromosome)

| File | Role |
|------|------|
| `band_tracking/regime_topology.js` | Per-chrom cross-regime relationships: `NESTED / ADJACENT / CHAINED / OVERLAPPING_CONFLICT / INDEPENDENT`. Chromosome-scale chain walker (CHAINED edges → multi-inversion lineage chains). JSON serializer. |

Exports: `REGIME_TOPOLOGY_RELATIONSHIPS`, `REGIME_TOPOLOGY_DEFAULTS`, `regimeBpFootprint`, `regimePairwiseTopology`, `buildRegimeTopologyGraph`, `findChromosomeRegimeChains`, `serializeRegimesToJson`.

### 4b — Mendelian per regime

| File | Role |
|------|------|
| `band_tracking/regime_mendelian.js` | Method A (trio contradiction counting) + Method B (per-family χ² goodness-of-fit). Per-regime support_status + per-regime/per-family segregation_status + effect_direction. Runs both when inputs available. |

Exports: `REGIME_KARYOTYPE_STATES`, `REGIME_EXPECTED`, `TRIO_SUPPORT_STATUS`, `TRIO_SUPPORT_THRESHOLDS`, `REGIME_MENDELIAN_DEFAULTS`, `FAMILY_RELIABILITY_TIERS`, `FAMILY_RELIABILITY_DEFAULTS`, `regimeKaryotypeForSample`, `annotateRegimeWithTrios`, `annotateRegimeWithFamilies`, `annotateRegimesWithMendelian`, `computeFamilyReliabilityTier`, `rollupEffectDirection`, `annotateRegimeMendelianAll`.

### 4c — Inverse pedigree from regimes

| File | Role |
|------|------|
| `band_tracking/regime_pedigree.js` | "Scan genomes → find inversions → use regime co-membership to find who is parent/offspring." Pairwise same-class fraction across many regimes → `DUPLICATE / FIRST_DEGREE / SECOND_DEGREE / UNRELATED / INSUFFICIENT_DATA`. Cross-checks ngsPedigree. |

Exports: `REGIME_PEDIGREE_DEFAULTS`, `REGIME_PEDIGREE_VERDICTS`, `regimePairCoMembership`, `classifyRegimeRelatedness`, `inferRelatednessFromRegimes`, `crossCheckPedigreeWithRegimes`, `calibratePedigreeThresholdsFromKnownPairs`.

### 4c — Regime LD

| File | Role |
|------|------|
| `band_tracking/regime_linkage.js` | Cohort-level LD: 3×3 karyotype contingency + Cramér's V across all samples. Family-level recombination test: doubly-het parents → offspring ratio → r̂. Verdict: `LINKED / WEAKLY_LINKED / INDEPENDENT / INSUFFICIENT_DATA`. |

Exports: `buildSampleRegimeMatrix`, `pairwiseRegimeContingency`, `regimeLD`, `regimeLinkageMatrix`, `familyRegimeRecombination`, `REGIME_LINKAGE_VERDICTS`, `REGIME_LINKAGE_DEFAULTS`.

### 4d — Dyad Mendelian + meiotic drive

| File | Role |
|------|------|
| `band_tracking/regime_dyad_mendelian.js` | Dyad-level (single-parent) Mendelian check + pooled-dyad binomial transmission test + meiotic-drive verdict (`MENDELIAN / MILD_DRIVE / STRONG_DRIVE / INVIABILITY / INSUFFICIENT_DATA`). |

Exports: `estimateAlleleFrequency`, `expectedDyadPMF`, `assessDyadConsistency`, `estimateTransmissionRatio`, `classifyMeioticDrive`, `annotateRegimeWithDyads`, `MEIOTIC_DRIVE_VERDICTS`, `MEIOTIC_DRIVE_DEFAULTS`.

---

## Layer 5 — chromosome-scale wiring

| File | Role |
|------|------|
| `band_tracking/genome_scale.js` | Per-chrom regime maps → flat array with `chrom + regime_uid`. Cross-chrom CHAINED links (min_shared HOM_A/B samples). Genome-wide pedigree inference (many regimes → robust co-membership). Optional Mendelian + linkage + dyad annotation. **Integration hub for Layers 2-4.** |

Exports: `GENOME_SCALE_LINKS`, `GENOME_SCALE_DEFAULTS`, `mergePerChromosomeRegimes`, `crossChromosomeRegimeLinks`, `genomeWidePedigreeFromRegimes`, `genomeWideRegimeReport`.

---

## Post-detection annotation

### `band_tracking/dosage_overlay.js`

Stage C5-C6: mean polarized dosage per macro-band → `HOM_REF / HET / HOM_INV / AMBIGUOUS`. Polarity check (one HET per axis). HET-disjointness count (number of independent arrangement axes).
Exports: `DOSAGE_CLASS`, `POLARITY_CHECK`, `classifyDosageMean`, `macroBandDosage`, `checkPolarityAndGetAxes`, `DOSAGE_DEFAULTS`.

### `band_tracking/karyotype_caller.js`

Stage C7: per-axis per-sample state_pc1 vs state_dosage → concordance → final call `HOM_REF / HET / HOM_INV / FLAGGED / NA` + confidence.
Exports: `KARYOTYPE_STATE`, `CONCORDANCE`, `CONFIDENCE`, `dosageClassToKaryotype`, `resolveAxisMembership`, `callAxisKaryotype`.

### `band_tracking/regime_catalogue.js`

Serializer: in-memory output → on-disk JSON (manifest + knobs + catalogue). Content-addressed by knob_hash (SHA-1 prefix).
Exports: `buildCatalogue`, `computeKnobHash`, `serializeCatalogue`.

### `shared/regime_annotation/positional.js`

Per-regime positional context: `CENTROMERIC / PERICENTROMERIC / SUBTELOMERIC / ARM_SCALE / INTERSTITIAL`. Distance to centromere / telomeres / arm scale.

### `shared/regime_annotation/structure.js`

Per-regime structural label: `SIMPLE_HAPLOTYPE_SPLIT / INVERSION_DOSAGE_LIKE / NESTED_OR_COMPOUND / NOISE_OR_RECOMBINANT / ...`. Summarizes M, K, boundary sharpness, internal nesting.

### `shared/regime_annotation/index.js`

Public API for the post-detection annotation layer.

---

## Module API surfaces (entry-helpers, not pipeline stages)

### `band_tracking/index.js`

Public re-export aggregator. Imported by the haplotype_regimes page + tests. No execution.

### `band_tracking/index_min.js`

Diagnostic re-export for the Option-B `consensus_partition` driver (skips Layer 1). **Not production** — keep for legacy diagnostic harnesses.

---

## Flagged anomalies

### Files that look legacy / duplicate

| File | Status | Notes |
|------|--------|-------|
| `band_tracking/projection_STUB.js` | Stub — production `projection.js` overwrites this | Exists to satisfy vote_evidence imports during minimal Stage-4 tests. Verify the production projection.js lands on top in any deployment. |
| `band_tracking/index_min.js` | Diagnostic surface | Minimal re-export for Option-B drivers. Production uses `index.js`. |
| `band_tracking/_kmeans_imported.js` | Duplicate import artifact | Copy of `shared/kmeans.js` relocated into band_tracking/ during initial integration. Canonical file is `shared/kmeans.js`. One of these should be deleted in a cleanup pass. |

### Gaps in the connection graph

1. **`banding_pipeline.js` is not re-exported by `index.js`** — only reachable from outside band_tracking/, which is fine but worth noting.
2. **`iv.js` has no downstream consumer inside band_tracking/.** Its output feeds `regime_mendelian.js` indirectly (via an external call). Intentional separation of concerns, but means it's a leaf node unless explicitly invoked.
3. **`regime_catalogue.js` (the serializer) has no in-code consumer inside band_tracking/.** Outputs are written to disk for cross-cohort aggregation / paper data — that's by design.
4. **Page-side gap (the one the user is fixing).** The haplotype_regimes page currently calls only `runBandingPipeline` (Stages 1-4). The Layer 3 entry (`refineRegimesFromIntervals`) and Layer 5 entry (`genomeWideRegimeReport`) are not yet wired. Closing this is the next-turn task.

### Mislocations (cosmetic)

- `regimes_registry.js` is UI persistence, not pipeline logic. Lives in `shared/`. Could move under `shared/ui/` but it's defensible where it is because the page that consumes it (haplotype_regimes) is also under shared scope.
- L3 primitives (`contingency`, `hungarian`, `kmeans`, `per_l2_cluster`) live in `shared/`, not band_tracking. Correct, because they are reused by `pca_panel`, `dosage_chunks`, etc.

---

## Documented order vs. user's reconstructed order

- The `band_tracking/index.js` header lists a **logical-grouping** order (Layer 1a → 1b → … → Layer 5).
- The user's reconstructed-from-memory order is an **execution-flow** order ("per-window K-means → het.js → contingency/merge → 2-direction voting → long-range/short-range regimes").

These are not in conflict. The same chain viewed from two angles. The mapping doc above is organized by the layer order; the wiring doc (next turn) will be organized by the execution flow.

---

## Three load-bearing entry points (for the next-turn wiring)

The haplotype_regimes page should chain these:

1. **`banding_pipeline.runBandingPipeline(ctx, opts)`** — Stages 1-4 bruteforce. Currently the only entry the page calls. **Requires per-window K-means in `ctx.getLabels`**, not L2-broadcast.
2. **`haplotype_regime.refineRegimesFromIntervals(intervals, opts)`** — Layer 3. Consumes het-skeleton intervals (from Layer 1b `het_define_interval`) plus HOM consensus (from Layer 1c). Outputs per-chromosome regimes.
3. **`genome_scale.genomeWideRegimeReport(perChromMap, opts)`** — Layer 5 integration hub. Optionally runs Layers 4a-4d internally.

**Optional fourth**: `regime_topology.buildRegimeTopologyGraph(regimes, opts)` + `findChromosomeRegimeChains(...)` between (2) and (3) when the page wants intra-chromosome topology visible.

---

## Per-window K-means: the load-bearing rule

The band_tracking/index.js header is explicit:
> "per-window K-means labels via getLabels/getK callbacks, NEVER L2-broadcast — same per-window upgrade noted in anchor_signals.js header"

The current `haplotype_regimes.js::_wireCtxCallbacks` routes through `per_l2_cluster.clusterL2`, which returns the same labels for every window inside an L2 envelope. That's the L2-broadcast pattern the header forbids. Adjacent-window contingencies (the L3 table) become trivially 1.0 inside an L2 envelope, killing the V-signal.

**Fix is small and local**: compute `kmeans1D` (or `adaptiveK1D`) per window from `data.windows[w].pc1`, cache in arrays, return from `getLabels(w)`. `getK(w)` reads the cached K. Drop the `getL2Idx` routing (stub to `() => 0` per `STAGE_B_v3_NOTES.md §2`).

This single change unblocks every layer above — the V-walker (Layer 2), the het skeleton (Layer 1b), and the long-range regime (Layer 3) all consume per-window labels through the same callback.

---

## Next-turn wiring plan (preview, not yet implemented)

1. Replace `_wireCtxCallbacks` per-window K-means cache (per-window `kmeans1D`, drop L2 routing, stub `getL2Idx`). Keep band_quality computation against the new labels.
2. After `runBandingPipeline` returns, build het-skeleton intervals from Stage 3 loci (or invoke `het_define_interval` directly on the per-window labels).
3. Call `refineRegimesFromIntervals` (Layer 3) → per-chromosome regimes.
4. Call `buildRegimeTopologyGraph` + `findChromosomeRegimeChains` (Layer 4a) → cross-regime topology.
5. If trios/families/dyads are available, call the Mendelian + pedigree + linkage + dyad annotation passes (Layers 4b–4d).
6. Call `genomeWideRegimeReport` (Layer 5) once we have per-chrom maps — initially this will be single-chrom, but the entry point is the same.
7. Render the result into the existing regime panels.

The two prior commits on this branch (band_quality wiring, synthetic-L2 fallback) get superseded by step (1) — the per-window labels also drive band_quality correctly, and the synthetic L2 disappears entirely. Net change vs. current branch is a clean rewrite of `_wireCtxCallbacks` plus the Layer 3 → Layer 5 chain after the existing `runBandingPipeline` call.

---

*End of mapping doc. Wiring lives in the next commit.*
