# Atlas split — migration plan from 1 atlas to 4

**Status**: planning doc (no code changes). Authored 2026-05-23 from a survey of:
- Current `atlases/inversion/` tree (33 pages, ~250 shared modules, 6 stages)
- `legacy/Inversion_atlas.html` (75 617 lines — partial port via `mgl_adapter` pattern)
- The new `COMPARATIVE_BREAKPOINTS_MASTER_20260522` bundle (cross-species BP_ATLAS workflow, 300+ breakpoints across 18 species)
- `README_PAIRING.md` (atlas-core/atlas-package contract)

**Goal**: split the single `inversion` atlas — which is overloaded with discovery + review + catalogue + comparative + evolution + tooling — into **four** cartridges that share atlas-core, plus integrate the new BP_ATLAS workflow into the right cartridge.

Per the user's vision, the final pages add up to roughly three "pages-the-user-actually-uses" per atlas, with all data layers registered through the core meta-schema.

---

## 1. Target architecture (the four atlases)

```
atlas-workspace/
├── index.html         ← from atlas-core (biology-neutral shell)
├── core/              ← from atlas-core
├── server/            ← from atlas-core + per-atlas adapters
└── atlases/
    ├── inversion/         ← stays, slimmed down
    ├── evolution/         ← new
    ├── cross-species/     ← new (gets the BP_ATLAS workflow)
    └── popstats/          ← new
```

### 1.1 `atlases/inversion/` — the discovery + per-individual review atlas

**Scope**: detect inversions in *one* cohort, characterise per-sample karyotypes, manage candidates.

| Disk dir | What stays |
|---|---|
| `pages/discovery/` | local_pca_dosage, pca_comparator, haplotype_regimes, dosage_heatmap, candidate_focus, nested_inversion_detector, fingerprint_track, negative_regions, dosage_cluster_adaptive_k, local_pca_ghsl, local_pca_theta_pi |
| `pages/catalogue/` | catalogue, candidates_catalogue, overview, marker_panels, confirmed_carousel, stats_profile, marker_readiness, annotation_cockpit |
| `pages/review/` (subset) | candidate_focus, candidates_workbench (the per-sample inversion review pages) |
| `shared/band_tracking/` | the 33-script band-tracking pipeline (Clusters 1-3 from `PIPELINE_ANALYSIS_ORDER.md`) |
| `shared/` core | kmeans, hungarian, contingency, per_l2_cluster, candidate_*, kbands, k6_parent_map, cramers_v_merge, sample_color, page1_data_helpers |
| `shared/regime_annotation/` | positional + structure (post-detection annotation) |
| `data/precomp/`, `candidates/`, `cohort/`, `arrangement_calls/` | per-cohort discovery data |
| `engines/fast_ld`, `engines/producers/` | inversion-side compute engines |

**Final pages count (post-collapse target)**: 3 user-facing pages
- Page 1: Local PCA + inversions (collapse of local_pca_dosage + pca_comparator + dosage panels)
- Page 2: Haplotype regimes (already exists, current state at `haplotype_regimes`)
- Page 3: Candidates + catalogue + export (collapse of catalogue + candidates_workbench + annotation_cockpit)

### 1.2 `atlases/evolution/` — new

**Scope**: *when* and *where on the phylogeny* did inversions arise? Age, ancestral state, polarisation, internal substructure, ancestry layer cleaning.

| From inversion-atlas | Migrates to evolution |
|---|---|
| `pages/evolution/age_divergence` | yes |
| `pages/evolution/archaeology_synthesis_card` | yes |
| `pages/evolution/event_tree_relative_ordering` | yes |
| `pages/evolution/haplotype_network` | yes |
| `pages/evolution/inv_internal_substructure` | yes |
| `pages/evolution/layer_cleaning` | yes |
| `pages/evolution/mosaicism_leakage` | yes |
| `pages/evolution/polarize_msa_stacked` | yes |
| `pages/evolution/polarize_synteny_vote` | yes |
| `shared/age_model_suggester.js` | yes |
| `shared/busco_4d_age.js` | yes |
| `shared/inversion_age_*.js` (if any) | yes |
| `shared/event_tree_*.js` | yes |
| `shared/copy_origin_painting.js` | yes (Layer 1e from SPEC) |
| `shared/mgl_archaeology_classifier.js` | yes |
| `shared/mgl_event_tree.js` | yes |
| `data/precomp/<chrom>/age_brackets_v1.json` (per layer) | yes (layers move to evolution registry) |
| `data/comparative/cross_species/` ancestral-state subset | partial — `karyotype_lineage_v1` may stay in cross-species |

**Cross-atlas dependencies** (read-only):
- `inversion.candidates_v1` — to know which inversions to age
- `crossSpecies.synteny_multispecies_v1` — to feed polarize_synteny_vote

**Final pages count target**: 3 — age & polarisation, internal substructure & ancestry, event-tree ordering.

### 1.3 `atlases/cross-species/` — new, gets the BP_ATLAS workflow

**Scope**: detect breakpoints across many species, place them on the phylogeny, hand coordinates (never claims) to other atlases.

| From inversion-atlas | Migrates to cross-species |
|---|---|
| `pages/comparative/cross_species_breakpoints` | yes (current Cgar×Cmac dashboard) |
| `pages/comparative/multi_species_cockpit` | yes |
| `pages/comparative/help` | yes (or stays as a global help layer) |
| `shared/mgl_*` (10 of 22) cross-species ones | yes — `mgl_inversion_divergence`, `mgl_outgroup_synteny`, `mgl_pca_*`, `mgl_panel_linkage`, `mgl_haplotype_network`, `mgl_event_tree`, `mgl_doubleton_sfs_clusters`, `mgl_nested_detector`, `mgl_fingerprinter`, `mgl_archaeology_classifier` — some of these are evolution-flavoured, see §1.2 |
| `shared/synteny_multispecies.js`, `dotplot_mashmap.js`, `divergence_network.js`, `dxy_per_inversion.js`, `cross_species.js`, `cross_species_summary.js`, `phylogenetic_confound.js` | yes |
| `shared/busco_anchors.js` | yes |
| `shared/recombination_suppression.js` | partial (cross-species half) |
| `data/comparative/cross_species/` (entire tree) | yes |
| `engines/producers/` cross-species producers | yes |

**+ NEW from the BP_ATLAS bundle** (full integration target):

| New piece | Where it lives |
|---|---|
| `MODULE_BPATLAS_crossspecies/scripts/STEP_BP1..BP6` | `atlases/cross-species/engines/producers/bp_atlas/` |
| `scripts/STEP_CS01_extract_breakpoints.py` (the canonical CS caller) | `atlases/cross-species/engines/producers/cs/` |
| `scripts/build_evidence_matrix.py`, `cluster_breakpoints.py`, `wide_orthologs_to_breakpoints.py`, `verify_frame_from_karyotype.py`, `anchor_density.py`, `pairwise_all_species.py`, `rideogram_to_breakpoints.py`, `csbp_*_to_breakpoints.py` | `atlases/cross-species/engines/producers/gene_order/` |
| `SYNTENY_INVERSION_JOIN/` (deferred hatchery-join scaffold) | `atlases/cross-species/engines/producers/inversion_join/` |
| `haplotype_manifest_CROSSSPECIES.tsv` (18-genome manifest) | `atlases/cross-species/data/manifests/` |
| `00_bpatlas_config.sh` (run config) | `atlases/cross-species/engines/producers/bp_atlas/config/` |
| `run_bp_atlas_LAPTOP.sh`, `SLURM_run_bp_atlas_PARALLEL.sh` (driver scripts) | `atlases/cross-species/engines/producers/bp_atlas/runners/` |
| `run_fold_into_clusters_LAPTOP.sh` (post-run chainer) | same |
| `bp5_ribbon_lib.R`, `STEP_BP5*` (R figure builders) | `atlases/cross-species/engines/figures/bp_atlas/` |
| `HANDOFF_COMPLETE.md`, `CS_vs_BPATLAS_RELATIONSHIP.md`, `CHANGES_LAPTOP_FIXES.md` | `atlases/cross-species/docs/` |

**New atlas pages added** (consume the BP_ATLAS outputs):

| Page | Reads | Renders |
|---|---|---|
| `bp_catalogue` | `breakpoint_clusters_v1` + `pairwise_summary_v1` | tiered breakpoint table (Tier 1 cross-method / Tier 2 recurrent) with sortable columns + tolerance-sweep stability column |
| `bp_atlas_reciprocity` | `bp_atlas_reciprocity_v1` (`reciprocity_table.tsv`) | per-zone confidence tier + both-anchor support |
| `bp_atlas_arcs` | `bp_atlas_arcs_v1` (`atlas_paf_arcs.json` + `atlas_data.json`) | the BP5 figure-style PAF arc view |
| `gene_order_catalog` | `synteny_18sp_breakpoints_v1` + `synteny_5sp_breakpoints_v1` + `csbp_json_breakpoints_v1` | gene-order-only edges with ≥3 species support |
| `cross_method_consolidation` | the 4 tables above + cluster id mapping | the headline consolidated table; cross_method flag visualization |

**Final pages count target**: 3 — the BP catalogue (consolidated + tiered), the multi-species cockpit (existing, extended to 18 species), the inversion-join coordinate-handoff page.

**Cross-atlas exports** (Cluster 3-style, consumed by other atlases):
- `crossSpecies.breakpoints_consolidated_v1` — the headline catalogue, read by `evolution` and `inversion`
- `crossSpecies.bp_atlas_reciprocity_v1` — the both-anchor-validated zones
- `crossSpecies.synteny_18sp_v1` / `synteny_5sp_v1` — gene-order catalogues
- `crossSpecies.atlas_paf_arcs_v1` — figure-grade arc data

### 1.4 `atlases/popstats/` — new

**Scope**: cohort-level population statistics, demographic inference, relatedness, Mendelian gates. This is where **Cluster 4** of the haplotype_regimes pipeline lives (`regime_mendelian`, `regime_dyad_mendelian`, `regime_pedigree`, `regime_linkage`, plus the off-page half of `genome_scale`).

| From inversion-atlas | Migrates to popstats |
|---|---|
| `pages/review/popstats/` (the existing popstats page + its 5 sub-modules `_data`, `_live`, `_render`, `_tooltip`, `_tracks`, `_view`) | yes |
| `pages/review/ancestry_per_window` | yes |
| `pages/review/fish_ancestry_scroller` | yes |
| `shared/band_tracking/regime_mendelian.js` | yes |
| `shared/band_tracking/regime_dyad_mendelian.js` | yes |
| `shared/band_tracking/regime_pedigree.js` | yes |
| `shared/band_tracking/regime_linkage.js` | yes |
| The relatedness exports of `shared/band_tracking/genome_scale.js` | yes (the rest stays in inversion-atlas) |
| `shared/cohort_diversity.js`, `cohort_export.js`, `relatedness.js`, `inheritance.js`, `inheritance_compute.js`, `inheritance_gather.js`, `inheritance_groups.js`, `inheritance_cache_key.js` | yes |
| `shared/mendelian_*.js` (3 files) | yes |
| `shared/q_ancestry.js`, `sample_spread.js` | yes |
| `shared/ancestry_alignment.js`, `ancestry_bricks.js`, `ancestry_confound.js`, `lineage_clustering.js`, `karyotype_lineage.js`, `karyotype_rows.js` | yes |
| `analysis/mendelian*.js` | yes |
| `specs_todo/SPEC_msmc_per_founder_background.md` | yes (the MSMC SPEC is popstats territory) |

**Final pages count target**: 3 — popstats (current), relatedness / ngsPedigree integration, demographic history (the MSMC SPEC implementation when it ships).

---

## 2. The BP_ATLAS workflow — what it is and how it fits

### 2.1 Pipeline summary (from the tarball handoff)

```
Inputs (cluster-side):
  - 18 catfish genome FASTAs + .fai
  - BUSCO single-copy ortholog tables (orthologs_18sp.tsv, orthologs_5sp.tsv)
  - macrosyntR synteny .RData → RIdeogram .txt files
  - haplotype_manifest_CROSSSPECIES.tsv (18 genomes + Cgar/Cmac haplotype subsets)

Producer stages (cluster-side, in MODULE_BPATLAS_crossspecies/):

  STEP_BP1  pairwise wfmash (two-pass: Pass A -s100k sensitive + Pass B -s500k
            backbone check) with per-pair divergence-tiered identity
            (p90 same-genus / p85 same-family / p80 mid-Siluriformes / skip
            deep ≥85My). PATCHED: --min-mapq 1 (wfmash MAPQ is 1-5, NOT 40).
  STEP_BP1b (optional) miniprot anchors as a second method on the same pairs.
  STEP_BP2  per-PAF event extraction → INVERSION / INTERCHROM /
            INVERTED_TRANSLOC / NONCOLLINEAR.
  STEP_BP3  cluster events across pairs into zones with confidence tiers
            (high/med/low); backbone_support flag from Pass B.
  STEP_BP3c reciprocity: anchor both Cgar AND Cmac frames; emit
            reciprocity_table.tsv (both-anchor validated zones).
  STEP_BP4  population overlap (226-cohort hatchery join) — DEFERRED, lives
            in atlases/inversion/ when wired.
  STEP_BP5  ribbons + dotplots + montages (R scripts) — figure layer.
  STEP_BP6  joint A-E classification (manuscript-ready table).

Gene-order parallel track (independent method family):
  wide_orthologs_to_breakpoints.py    extract edges from macrosyntR wide table
  cluster_breakpoints.py              tolerance-cluster consolidation
                                       (cross_method flag = TRUE only when
                                        gene_order AND sequence agree ≤ tol)
  STEP_CS01_extract_breakpoints.py    canonical CS caller (one PAF, Gar-anchored)

Headline outputs:
  results/breakpoint_clusters.tsv          consolidated with cross_method flag
  results/consolidated_large_inversions.tsv  POD coordinate handoff
  results/pairwise_summary_<focal>.tsv     per-pair edge + n_species + species_list
  results/sweep/summary_*_{500..1}kb.tsv   tolerance sweep stability proof
  results_bpatlas/03_breakpoints/reciprocity/reciprocity_table.tsv   both-anchor evidence
  results_bpatlas/05_atlas_data/atlas_data.json + atlas_paf_arcs.json   figure inputs
  results_bpatlas/06_joint/joint_candidates.tsv   BP6 A-E classification
```

### 2.2 Already in atlas / already not in atlas

- **In atlas**: `cs_breakpoints_v1` schema (`cross_species_breakpoints` page reads it). The CS pipeline produced the existing 3-event JSON the page already renders.
- **Not in atlas**: BP_ATLAS multi-pair outputs, gene-order catalogues, cross-method consolidated table, reciprocity table, atlas_paf_arcs figure layer. None of these have registry entries yet.

### 2.3 What atlas-core needs (the workflow integration ask)

The user said *"give the details for atlas core to fill the workflow with what we already have in cross species"*. Atlas-core is supposed to be biology-neutral, so the BP_ATLAS workflow itself lives in `atlases/cross-species/engines/`. What atlas-core needs is **generic mechanism** to support cross-atlas workflows of this shape:

| Atlas-core need | Why |
|---|---|
| **Workflow registry** (new): `workflows.registry.json` per atlas, listing cluster-side producer pipelines + their declared outputs (TSV / JSON / PAF) | Today an atlas can declare *layers* but not the *workflow* that produces them. The BP_ATLAS is multi-stage, has SLURM and laptop drivers, and runs offline — atlas-core needs to register it so other atlases can declare consumption dependencies. |
| **Producer-output layer family**: a layer family that points at a directory tree (e.g. `results_bpatlas/`) rather than a single file. Current `data/` registry assumes one-file-per-layer in many places. | BP_ATLAS produces a tree (`02_paf_passA/`, `03_breakpoints/reciprocity/`, `05_atlas_data/`, `06_joint/`) and pages need typed access to sub-dirs without each page implementing its own globber. |
| **Cross-atlas import contract**: a way for `evolution` to declare `import: crossSpecies.breakpoints_consolidated_v1` and get type-checked, cohort-aware data. Today cross-page deps inside one atlas are JS imports; cross-*atlas* deps need to route through the registry. | The 3-cohort discipline (F1 hybrid / 226-Cgar hatchery / Cmac wild) must be enforceable across atlases. If `evolution` reads BP coordinates from `cross-species`, the cohort tag must travel with the data. |
| **Manifest schema extension**: `cohort_id`, `reference_id`, `pipeline_version`, `knob_hash` as required fields on every produced artifact. | Already implicit in `regime_catalogue.js` (knob_hash) and three-cohort discipline; promote to first-class atlas-core schema field. |
| **Run-status badges**: per-workflow "last successful run" + "needs rerun" UI affordance, surfaced in the atlas chrome. | The BP_ATLAS laptop run takes hours-days; users need to see *whether the catalogue they're reading is current*. Today nothing carries this. |
| **Three-cohort cohort registry**: `cohorts.registry.json` in atlas-core listing the 3 catfish cohorts (or N cohorts in general) with their reference genome, lab metadata, and which atlases they appear in. | The discipline is currently enforced by comment policing. A registry plus a lint catches accidental conflation at config time. |

Concretely, atlas-core would gain:

```
atlas-core/
├── core/
│   ├── workflows_registry.js        ← NEW: validate workflows.registry.json
│   ├── cohorts_registry.js          ← NEW: validate cohorts.registry.json
│   ├── cross_atlas_imports.js       ← NEW: declared inter-atlas dep resolver
│   └── layer_router.js              ← existing, extended for tree-layer family
├── core/schemas/
│   ├── workflows.schema.json        ← NEW
│   ├── cohorts.schema.json          ← NEW
│   └── tree_layer.schema.json       ← NEW
└── docs/
    └── SPEC_workflows_v1.md         ← NEW
```

None of this is fish-specific; all of it generalises to any comparative-genomics workflow.

---

## 3. Migration steps — in order

### 3.1 Phase 0 — atlas-core extensions (prep)

1. Author `SPEC_workflows_v1.md` in `docs/`.
2. Add `workflows.schema.json` + `cohorts.schema.json` + `tree_layer.schema.json` to atlas-core meta-schemas.
3. Add `workflows_registry.js` + `cohorts_registry.js` + `cross_atlas_imports.js` modules.
4. Extend `layer_router.js` to handle tree-shaped producer outputs.
5. Add `tests/mock-atlas/` examples covering each new schema.

No atlas-side changes yet. Atlas-core is independently shippable.

### 3.2 Phase 1 — extract `cross-species` (the BP_ATLAS landing pad)

1. Create `atlases/cross-species/` with the standard layout (`manifest.json`, `pages/`, `shared/`, `registries/`, `data/`, `server-adapters/`, `engines/`).
2. Move from `atlases/inversion/`:
   - `pages/comparative/cross_species_breakpoints` → `pages/breakpoints/cs_pair_dashboard` (renamed for clarity)
   - `pages/comparative/multi_species_cockpit` → `pages/breakpoints/multi_species_cockpit`
   - `pages/comparative/help` → `pages/help/` (or push to atlas-core if generic)
   - `shared/mgl_inversion_divergence.js`, `mgl_outgroup_synteny.js`, `mgl_pca_*.js`, `mgl_panel_linkage.js`, `mgl_haplotype_network.js`, `mgl_event_tree.js`, `mgl_doubleton_sfs_clusters.js`, `mgl_nested_detector.js`, `mgl_fingerprinter.js`, `mgl_archaeology_classifier.js`
   - `shared/synteny_multispecies.js`, `dotplot_mashmap.js`, `divergence_network.js`, `dxy_per_inversion.js`, `cross_species.js`, `cross_species_summary.js`, `phylogenetic_confound.js`, `busco_anchors.js`, `recombination_suppression.js`
   - `data/comparative/cross_species/` → `data/breakpoints/` and `data/synteny/`
3. Import the BP_ATLAS tarball:
   - `MODULE_BPATLAS_crossspecies/scripts/` → `engines/producers/bp_atlas/scripts/`
   - `scripts/STEP_CS01_extract_breakpoints.py` → `engines/producers/cs/`
   - Top-level `scripts/` (gene-order producers) → `engines/producers/gene_order/`
   - `SYNTENY_INVERSION_JOIN/` → `engines/producers/inversion_join/`
   - `haplotype_manifest_CROSSSPECIES.tsv` → `data/manifests/`
   - Three HANDOFF/RELATIONSHIP/CHANGES docs → `docs/`
4. Author the new registry entries:
   - `registries/data/layers.registry.json`: `breakpoints_consolidated_v1`, `pairwise_summary_v1`, `bp_atlas_reciprocity_v1`, `bp_atlas_arcs_v1`, `synteny_18sp_v1`, `synteny_5sp_v1`, `csbp_json_v1`, `joint_candidates_v1`, `gene_order_catalog_v1`, `tolerance_sweep_v1`
   - `registries/data/operations.registry.json`: tolerance-sweep recompute, reciprocity recompute, BP_ATLAS run trigger
   - `registries/data/workflows.registry.json` (NEW per phase 0): `bp_atlas_pipeline`, `cs_caller`, `gene_order_consolidation`, `inversion_join`
   - `registries/data/pages.registry.json`: 3 new pages (`bp_catalogue`, `bp_atlas_reciprocity`, `bp_atlas_arcs`) plus the two migrated ones
5. Build the 3 new pages:
   - `bp_catalogue`: tiered headline table (Tier 1 cross-method / Tier 2 recurrent) with sortable columns, tolerance-sweep stability column, click-to-drill to per-pair detail.
   - `bp_atlas_reciprocity`: per-zone confidence tier + both-anchor support, sortable.
   - `bp_atlas_arcs`: BP5-style arc visualisation reading `atlas_paf_arcs.json`.
6. Add `tests/test_cross_species_*.js` smokes for each new page + each new layer schema.

### 3.3 Phase 2 — extract `evolution`

1. Create `atlases/evolution/` with the standard layout.
2. Move from `atlases/inversion/`:
   - All 9 pages in `pages/evolution/` (age_divergence, archaeology_synthesis_card, event_tree_relative_ordering, haplotype_network, inv_internal_substructure, layer_cleaning, mosaicism_leakage, polarize_msa_stacked, polarize_synteny_vote)
   - `shared/age_model_suggester.js`, `busco_4d_age.js`, `event_tree_*` helpers (if standalone)
   - `shared/copy_origin_painting.js`
   - `shared/mgl_archaeology_classifier.js`, `mgl_event_tree.js` (or these stay in cross-species — decide based on which atlas reads them more)
   - Any age/polarisation-specific layers from `data/precomp/` and `data/comparative/`
3. Cross-atlas declared imports:
   - `inversion.candidates_v1` (read-only)
   - `crossSpecies.breakpoints_consolidated_v1` (read-only)
   - `crossSpecies.synteny_18sp_v1` (read-only — for polarize_synteny_vote)
4. Registry entries for layers + pages.
5. Smoke tests.

### 3.4 Phase 3 — extract `popstats`

1. Create `atlases/popstats/`.
2. Move from `atlases/inversion/`:
   - `pages/review/popstats/` + its 5 sub-modules
   - `pages/review/ancestry_per_window/`, `fish_ancestry_scroller/`
   - `shared/band_tracking/regime_mendelian.js`, `regime_dyad_mendelian.js`, `regime_pedigree.js`, `regime_linkage.js`
   - The relatedness exports of `shared/band_tracking/genome_scale.js` (split the file)
   - `shared/cohort_diversity.js`, `cohort_export.js`, `relatedness.js`, `inheritance*.js`
   - `shared/mendelian_*.js`
   - `analysis/mendelian*.js`
3. Cross-atlas imports:
   - `inversion.candidates_v1` + `inversion.regime_catalogue_v1` (read-only)
4. Author the relatedness atlas / ngsPedigree page (the Cluster 4 work from `PIPELINE_ANALYSIS_ORDER.md`).
5. Implement `SPEC_msmc_per_founder_background.md` in this atlas (was authored under inversion atlas; move now).
6. Registry entries + smoke tests.

### 3.5 Phase 4 — finalise the slimmed `inversion`

After Phases 1-3, the inversion atlas has lost:
- 11 pages (2 comparative + 9 evolution + popstats sub-pages + ancestry pages)
- ~30 shared modules (mgl_*, age_*, mendelian_*, regime_mendelian, etc.)
- ~5 data dirs (comparative/cross_species, related parts of precomp)

What's left becomes the discovery + per-individual review atlas. Then:
1. Re-organise the remaining 16 pages into 3 user-facing pages per the Page 1 / Page 2 / Page 3 vision:
   - Page 1: local PCA + inversions (collapse local_pca_dosage + pca_comparator + dosage_heatmap + ghsl/theta_pi panels)
   - Page 2: haplotype regimes (already at `pages/discovery/haplotype_regimes`)
   - Page 3: candidates + catalogue + export (collapse catalogue + candidates_workbench + annotation_cockpit + marker_panels)
2. Drop the `pages/comparative/` and `pages/evolution/` dirs (now empty).
3. Update `manifest.json` to reflect the 3-stage final shape (discovery, regimes, catalogue).

### 3.6 Phase 5 — assembly + integration tests

1. Update `atlases/_index.json` to list all four atlases.
2. Atlas-core composition test: assemble all four into a single workspace + smoke each cross-atlas declared import.
3. Per-atlas browser smoke (Page 1 / Page 2 / Page 3 for each atlas).
4. Move the 3 PR-related docs (PIPELINE_ANALYSIS_ORDER.md, the MSMC SPEC, etc.) to whichever atlas owns them.

---

## 4. Legacy port status — audit

### 4.1 `legacy/Inversion_atlas.html` — 75 617 lines, partial port

The legacy monolithic HTML page has been ported in chunks via the **mgl_adapter pattern**: each major sub-system gets a `shared/mgl_<feature>.js` module that mirrors the legacy block, plus a sibling `*_panel.js` or page module that consumes it.

| Sub-system | Legacy lines (approx) | Ported to | Status |
|---|---|---|---|
| Per-window K-means + L2 envelopes | 10 092 – 10 800 | `shared/kmeans.js`, `shared/per_l2_cluster.js` | DONE |
| Local PCA scatter + lines panel | 11 000 – 13 000 | `pages/discovery/local_pca_dosage/` + `pca_panel.js`, `lines_panel.js` | DONE |
| L3 contingency panel | 13 000 – 14 000 | `pages/discovery/local_pca_dosage/l3_panel.js` + `shared/contingency.js` | DONE |
| Dosage heatmap | 14 477 (`_esc`) and surrounding | `pages/discovery/dosage_heatmap/` + `shared/dosage_chunks.js` | DONE |
| Candidates / catalogue | varies | `pages/catalogue/` + `shared/candidate_*.js` (10+ files) | DONE |
| Cross-species (Cgar × Cmac) | 1488 (`_csGetSyntenyBlocks`), 1791 (`_csPermutationTest`) | `pages/comparative/cross_species_breakpoints/` | DONE for 1-pair only |
| Multi-species cockpit | varies | `pages/comparative/multi_species_cockpit/` | DONE |
| Age & polarisation | varies | `pages/evolution/*` + `shared/age_model_suggester.js`, `busco_4d_age.js` | DONE (mgl_archaeology partial) |
| Stats profile | 20 971 – 21 114 (50 helpers) | `pages/catalogue/stats_profile/` | DONE |
| Per-sample popstats | varies | `pages/review/popstats/` | DONE |
| Window-sum strip (`drawWinSumStrip`) | unidentified | runtime guard kept; not in legacy | NOT PORTED — runtime stub only |
| MGL adapter v5 producer-side filter | 17 helpers in `shared/mgl_*.js` | `shared/mgl_beagle_parser.js`, `mgl_stripe_quality.js`, etc. | PARTIAL — see §4.2 |

**Net assessment**: ~85% of legacy is ported. Visible gaps:
1. `drawWinSumStrip` — runtime guard, never resolved to a real implementation. Page references it; nothing implements it. Either remove the guard or write the missing function from the legacy line range when found.
2. `mgl_archaeology_classifier` ↔ `mgl_event_tree` cross-references — both ported but their interaction is not test-covered.
3. 50 stats_profile helpers (legacy lines 20 971 – 21 114) — ported as constants + runtime guards on `stats_profile`. Promoting them to explicit ES imports is a follow-up audit.

### 4.2 `mgl_adapter` (22 files in `shared/mgl_*.js`)

Multi-genome-list adapter — the legacy data structure that flat-files 18 species into one panel. The 22 modules:

```
mgl_archaeology_classifier.js     mgl_kinship_downweight.js
mgl_beagle_parser.js              mgl_mosaicism_detector.js
mgl_candidate_mode.js             mgl_nested_detector.js
mgl_dosage_clustering.js          mgl_nj_tree.js
mgl_doubleton_sfs_clusters.js     mgl_outgroup_synteny.js
mgl_event_tree.js                 mgl_panel_linkage.js
mgl_fingerprinter.js              mgl_pca_compute.js
mgl_founder_consensus.js          mgl_pca_json.js
mgl_haplotype_network.js          mgl_render_state.js
mgl_heatmap_json.js               mgl_similarity_matrix.js
mgl_inversion_divergence.js       mgl_stripe_quality.js
```

**Per-atlas allocation under the split**:

| Module | Goes to |
|---|---|
| `mgl_beagle_parser`, `mgl_dosage_clustering`, `mgl_render_state`, `mgl_heatmap_json` | inversion (discovery-side) |
| `mgl_archaeology_classifier`, `mgl_event_tree`, `mgl_founder_consensus`, `mgl_kinship_downweight`, `mgl_mosaicism_detector` | evolution |
| `mgl_inversion_divergence`, `mgl_outgroup_synteny`, `mgl_pca_compute`, `mgl_pca_json`, `mgl_panel_linkage`, `mgl_haplotype_network`, `mgl_doubleton_sfs_clusters`, `mgl_nested_detector`, `mgl_fingerprinter`, `mgl_nj_tree`, `mgl_similarity_matrix`, `mgl_outgroup_synteny`, `mgl_stripe_quality` | cross-species |
| `mgl_candidate_mode` | inversion or cross-species (depends on which atlas owns candidate_mode) |

That's the mgl audit done at the file level. Function-level audit (which functions inside each `mgl_*.js` are used by which page) is a follow-up before the move actually happens.

---

## 5. Cross-atlas data contracts (the registry-level glue)

After the split, cross-atlas reads must go through registry-declared imports rather than JS imports. The contracts:

### 5.1 cross-species → others

```
crossSpecies.breakpoints_consolidated_v1
  Format: TSV with columns: cluster_id, chrom_focal, start_bp_focal, end_bp_focal,
    n_methods, methods_csv, cross_method_flag, n_species, species_list_csv,
    confidence_tier (high|med|low), backbone_support (yes|partial|no),
    tolerance_kb_stable_at
  Cohort: comparative (18 genomes), reference: fClaHyb_Gar_LG or fClaHyb_Mac_LG
  Read by: inversion (candidate_focus), evolution (event_tree)

crossSpecies.bp_atlas_reciprocity_v1
  Format: TSV reciprocity_table.tsv from BP3c (both-anchor zones)
  Read by: same consumers + figure pages

crossSpecies.synteny_18sp_v1 / synteny_5sp_v1
  Format: TSV with edges + species support
  Read by: evolution (polarize_synteny_vote, age_divergence)

crossSpecies.atlas_paf_arcs_v1 + atlas_data_v1
  Format: JSON (BP5 figure inputs)
  Read by: cross-species own pages (arcs view, montage)

crossSpecies.joint_candidates_v1
  Format: TSV with A-E classification (BP6)
  Read by: cross-species own pages + manuscript export
```

### 5.2 inversion → others

```
inversion.candidates_v1
  Format: JSON catalogue from the haplotype_regimes catalogue serialiser
  Cohort: 226-Cgar hatchery
  Read by: popstats (Mendelian / pedigree), evolution (age), cross-species
    (the deferred BP4 inversion-join step in SYNTENY_INVERSION_JOIN/)

inversion.regime_catalogue_v1
  Format: JSON triple (manifest + knobs + catalogue) from regime_catalogue.js
  Read by: popstats (Cluster 4), evolution (event ordering)
```

### 5.3 Three-cohort discipline as a registry constraint

Every layer above must carry `cohort_id` and `reference_id`. Atlas-core's
cross-atlas import resolver must refuse a read where `consumer_cohort_id ≠
producer_cohort_id` unless the layer is explicitly tagged
`cohort: coordinate_handoff` (the BP_ATLAS coordinates-only handoff
pattern).

The 3 catfish cohorts (registered in `core/cohorts.registry.json`):

```jsonc
{
  "cohorts": [
    {
      "cohort_id": "f1_hybrid_cga_cma",
      "label": "F1 hybrid (C. gariepinus × C. macrocephalus)",
      "reference_id": "fClaHyb_Gar_LG",
      "scope": "assembly_paper_only",
      "atlases": ["cross-species"]
    },
    {
      "cohort_id": "cgar_hatchery_226",
      "label": "226-sample pure C. gariepinus hatchery",
      "reference_id": "fClaHyb_Gar_LG",
      "scope": "inversion_atlas_main_cohort",
      "atlases": ["inversion", "evolution", "popstats"]
    },
    {
      "cohort_id": "cmac_wild_future",
      "label": "Pure C. macrocephalus wild",
      "reference_id": "fClaHyb_Mac_LG",
      "scope": "future_paper",
      "atlases": []
    }
  ],
  "cross_reference_handoffs": [
    {
      "kind": "coordinate_handoff",
      "from_cohort": "f1_hybrid_cga_cma",
      "to_cohort": "cgar_hatchery_226",
      "via_layer_pattern": "crossSpecies.*_v1",
      "comment": "Cross-species breakpoints land coordinates in inversion atlas; never inherit cohort claims."
    }
  ]
}
```

---

## 6. Risks + open questions

1. **Page-isolation discipline.** The current inversion atlas enforces page-isolation (`SPEC_registry_write_and_page_isolation.md`). Cross-atlas imports must extend that — no atlas may *write* to another atlas's state, only read declared imports. Atlas-core needs a runtime assertion.

2. **Test infrastructure.** Tests today (e.g. `tests/test_discovery_haplotype_regimes.js`) import from `atlases/inversion/...`. Post-split, they need to be re-rooted or moved into the right atlas's `tests/` dir. Plan: each atlas grows its own `tests/` and shared smoke-fixtures into atlas-core's `tests/mock-atlas/`.

3. **`SPEC_msmc_per_founder_background.md` ownership.** Authored on the inversion branch as a stop-gap. Should move to `atlases/popstats/specs_todo/` in Phase 3.

4. **`drawWinSumStrip` runtime guard.** Either find the missing function or strip the guard before the split (in any atlas it lands).

5. **BP_ATLAS LANTA paths.** `SLURM_run_bp_atlas_PARALLEL.sh` references `run_bp_atlas.sh` which is NOT in the bundle. The LAPTOP runner is self-contained, but the SLURM driver would break. Either stub it or supply it from Quentin's cluster home before the migration ships.

6. **Producer-output tree layers.** Today `data/cross_species/synteny/<ref>__vs__<query>/` works via "Mode B raw-folder interface" comment in the README. Promoting this to a first-class tree-layer family in atlas-core (Phase 0) is a real schema design — needs SPEC before code.

7. **mgl per-function audit.** The 22 `mgl_*.js` files are allocated to atlases above at the file level. Each module exports multiple functions; some functions may be consumed across atlas boundaries. A per-function audit is needed before physical move to identify the cross-atlas surface.

8. **`drawWinSumStrip`-class missing helpers across the legacy port.** A grep of runtime guards (`typeof X === 'function' ? X(...) : null`) returns ~12 sites. Treat each as a known port gap and either resolve or strip pre-split.

9. **Cohort-discipline enforcement at runtime.** Today it's policy-by-comment. Atlas-core needs the cohorts registry + a runtime check before declaring the discipline enforced — otherwise the split makes accidental conflation easier (because data flows across registry boundaries).

10. **Single-page-app shell vs. per-atlas shell.** Today one HTML shell mounts the inversion atlas. Multi-atlas mode needs a top-level atlas picker. README_PAIRING.md §2 already implies this exists in atlas-core; verify before relying on it.

---

## 7. Recommended order of operations

The doc above lays out 5 phases sequentially. For an actual 12-week migration plan, an order that minimises risk:

1. **Week 1**: Phase 0 (atlas-core extensions) + audit gaps (`drawWinSumStrip`, runtime guards, mgl per-function).
2. **Week 2-3**: Phase 1 (cross-species extract, BP_ATLAS import, 3 new pages). High value, low risk — no other atlas depends on what moves.
3. **Week 4-5**: Phase 2 (evolution extract). Depends on cross-species layers (Phase 1) for `synteny_18sp_v1` etc.
4. **Week 6-7**: Phase 3 (popstats extract + Cluster 4 wiring + MSMC SPEC implementation start).
5. **Week 8**: Phase 4 (slim inversion to 3 user-facing pages, drop emptied dirs).
6. **Week 9-10**: Phase 5 (assembly + integration tests). Likely surfaces cross-atlas-import bugs.
7. **Week 11**: BP_ATLAS LANTA full run on the 18-species manifest (the "days-long laptop grind" → cluster), feed back into `crossSpecies.bp_atlas_reciprocity_v1`.
8. **Week 12**: Buffer + the deferred SYNTENY_INVERSION_JOIN wiring (the hatchery-side BP4 join, which is the cross-atlas-import contract's first real consumer).

Phases 1, 2, 3 are independent and could parallelise across a small team.

---

## 8. What this doc does NOT cover

- The actual code patches for any phase (this is plan, not implementation).
- The fish-specific manuscript figure recipes (`STEP_BP5*` R scripts — those just move; their semantics are unchanged).
- The deferred POD-inside-inversion analysis (handoff §3, Tier 1 → POD chat — that's a future research chat, not a migration concern).
- The 3-cohort schema migration for cluster-side BAMs / VCFs (this doc handles only atlas-side data registry, not cluster-side data layout).

---

*End of migration plan. Implementation begins in Phase 0 when authorised.*
