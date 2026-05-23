# popstats atlas

Per `docs/MIGRATION_4_ATLASES.md` §1.4 + §3.4. Phase 3 of the
4-atlas split.

**Scope**: cohort-level population statistics + relatedness +
Mendelian gates + pedigree inference + ancestry painting. Hosts
Cluster 4 of the haplotype-regimes pipeline (per
`docs/PIPELINE_ANALYSIS_ORDER.md`) and the MSMC demographic
validation SPEC.

**Cohort**: `cgar_hatchery_226` (the inversion atlas main
cohort).

**Cross-atlas reads** (declared in atlas-core's
`cohorts.registry.json` once Phase 0 merges):
- `inversion.candidates_v1` — what to compute popstats on
- `inversion.regime_catalogue_v1` — Cluster 3 output that
  Cluster 4 (this atlas's regime_mendelian / regime_pedigree /
  regime_linkage / regime_dyad_mendelian) consumes

## What lives here

```
atlases/popstats/
├── manifest.json                      3 pages
├── README.md                          this file
├── pages/review/
│   ├── popstats.{html,js}             + popstats/{_canvas,_live,_render,
│   │                                     _state,_tooltip,_tracks,_view}.js
│   ├── ancestry_per_window.{html,js}  + ancestry_per_window/_state.js
│   └── fish_ancestry_scroller.{html,js} + fish_ancestry_scroller/{_state,
│                                          layers,right_panel,selection}.js
├── shared/
│   ├── band_tracking/                 Cluster 4 of the pipeline
│   │   ├── regime_mendelian.js        Method A trio + Method B family chi-sq
│   │   ├── regime_dyad_mendelian.js   Dyad gates + meiotic drive
│   │   ├── regime_pedigree.js         Inverse pedigree from regime co-membership
│   │   └── regime_linkage.js          Cohort LD + family recombination
│   ├── cohort_diversity.js            Per-window cohort metrics
│   ├── cohort_export.js               Catalogue + manuscript export
│   ├── relatedness.js                 KING / ngsRelate edge handling
│   ├── inheritance_cache_key.js       Cluster 4 cache invalidation
│   ├── inheritance_compute.js         Cluster 4 main compute
│   ├── inheritance_gather.js          Gather active candidates for inheritance
│   ├── inheritance_groups.js          Group samples by inheritance compatibility
│   ├── mendelian_family_test.js       Per-family chi-sq
│   ├── mendelian_para_vs_peri.js      Paracentric vs pericentric Mendelian
│   ├── mendelian_segregation.js       Per-regime segregation status
│   ├── q_ancestry.js                  Ancestry Q-matrix utilities
│   ├── sample_spread.js               Per-sample dispersion in PC space
│   ├── ancestry_alignment.js          F-based label-switching alignment
│   ├── ancestry_bricks.js             Per-fish bricks
│   ├── ancestry_confound.js           Per-regime ancestry confound
│   ├── lineage_clustering.js          Family-tree-based clustering
│   ├── karyotype_lineage.js           Per-lineage karyotype calls
│   └── karyotype_rows.js              Per-row karyotype display
├── analysis/
│   ├── mendelian.js                   3-state Mendelian compute primitive
│   └── mendelian_inheritance.js       Inheritance-table classifier
├── specs_todo/
│   └── SPEC_msmc_per_founder_background.md
│                                      Demographic validation SPEC
│                                      (authored on inversion branch,
│                                      moved here as canonical home)
├── registries/data/                   6 stub registries (full layers
│                                      land in Phase 5)
├── docs/                              empty
├── data/                              empty
└── tests/test_atlas_mount.js          mount smoke
```

## Audit summary (pre-move)

Extra-attentive audit was needed because popstats has many
moving-piece dependencies on inversion-side L3 primitives that
STAY in inversion:

- `inversion/shared/contingency.js` — used by 4 popstats modules
- `inversion/shared/stats_helpers.js` — used by 2 (band_tracking)
- `inversion/shared/clustering.js` — used by 2
- `inversion/shared/hungarian.js` — used by 1
- `inversion/shared/candidate_predicates.js` — used by 1
- `inversion/shared/pc_accessors.js` — used by 1
- `inversion/shared/candidate_nav.js` — used by 2 (pages)

All 12+ cross-atlas import paths inserted as `../../inversion/shared/...`
(or `../../../inversion/shared/...` from inside `band_tracking/`).
Phase 5 task: switch to
`cross_atlas_imports.resolveCrossAtlasRead()` once atlas-core
ships the proposal package.

Inversion-side files updated to point at popstats (3 files):
- `pages/discovery/local_pca_dosage/inheritance.js`  → popstats inheritance_groups
- `pages/discovery/local_pca_dosage/l2_sweep.js`     → popstats inheritance_groups
- `pages/discovery/local_pca_dosage/_state.js`       → popstats q_ancestry

## Cohort discipline

popstats works on `cgar_hatchery_226`. It reads cross-species
breakpoint coordinates ONLY through the
`bp_atlas_to_hatchery_join` handoff (declared in atlas-core's
`cohorts.registry.json` per `SPEC_cohorts_v1`). Per-individual
ancestry / kinship / Mendelian claims are scoped to the 226-Cgar
cohort. Never inherit cohort claims from comparative coordinates.

## What's NOT here

- `genome_scale.js` (Cluster 4 relatedness exports
  `genomeWidePedigreeFromRegimes` etc.) — stays in
  `inversion/shared/band_tracking/genome_scale.js` for now since
  inversion's haplotype_regimes page also uses its
  per-chromosome aggregation exports. Cross-atlas-import from
  popstats when popstats needs the relatedness half. Splitting
  the file is deferred until a real consumer demands it.

- `dosage_overlay.js`, `karyotype_caller.js`,
  `karyotype_model.js`, etc. — these stay in inversion's
  band_tracking/ because they're Cluster 3 (on-page) not Cluster
  4 (cross-page-to-popstats).
