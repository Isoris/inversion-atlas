# cross-species atlas

Detects and curates breakpoints across catfish species. Per
`docs/MIGRATION_4_ATLASES.md` §1.3 this is one of three new atlases
extracted from the original monolithic `inversion-atlas`; this one
gets the BP_ATLAS workflow per `docs/MIGRATION_4_ATLASES.md` §2.

**Cohort**: `f1_hybrid_cga_cma` (the comparative cohort — 18 catfish
genomes + 5-haplotype Cgar/Cmac subset). Per the cross-cohort handoff
registered in atlas-core's `cohorts.registry.json`, this atlas hands
**coordinates** (not claims) to the `inversion` / `evolution` /
`popstats` atlases on the 226-Cgar hatchery cohort.

## Layout

```
atlases/cross-species/
├── manifest.json
├── README.md                                ← this file
├── pages/
│   └── breakpoints/
│       ├── bp_catalogue.{html,js}           ← Tier 1 / Tier 2 headline
│       ├── bp_atlas_reciprocity.{html,js}   ← BP3c both-anchor zones
│       └── bp_atlas_arcs.{html,js}          ← BP5 figure-style arcs
├── shared/                                  ← (empty in Phase 1a; populated
│                                              in Phase 1c when mgl_* + cross-
│                                              species shared modules migrate
│                                              from inversion-atlas)
├── registries/
│   └── data/
│       ├── layers.registry.json             ← 10 layers for BP_ATLAS outputs
│       ├── workflows.registry.json          ← bp_atlas_pipeline + gene_order_consolidation
│       ├── pages.registry.json              ← page declarations
│       ├── operations.registry.json         ← stub (no operations yet)
│       ├── files.registry.json              ← stub
│       └── slots.registry.json              ← stub
├── data/
│   ├── manifests/
│   │   ├── haplotype_manifest_CROSSSPECIES.tsv ← 18-genome manifest
│   │   └── haplotype_manifest_5hap.tsv          ← 5-haplotype Cgar/Cmac
│   ├── breakpoints/                          ← BP_ATLAS outputs land here
│   ├── synteny/                              ← gene-order outputs land here
│   └── multi_species/                        ← per-run multi-way comparisons
├── engines/
│   ├── producers/
│   │   ├── bp_atlas/                         ← STEP_BP1..BP6 + runners + config
│   │   │   ├── scripts/                      ← 8 stage scripts
│   │   │   ├── runners/                      ← LAPTOP + SLURM drivers
│   │   │   └── config/                       ← 00_bpatlas_config.sh
│   │   ├── cs/                               ← STEP_CS01 canonical caller
│   │   ├── gene_order/                       ← 16 gene-order scripts
│   │   └── inversion_join/                   ← deferred hatchery-join scaffold
│   └── figures/
│       └── bp_atlas/                         ← BP5 R figure builders
├── server-adapters/                          ← (empty)
├── docs/
│   ├── HANDOFF_COMPLETE.md                   ← master design document
│   ├── CS_vs_BPATLAS_RELATIONSHIP.md         ← scope of CS vs BP_ATLAS
│   ├── CHANGES_LAPTOP_FIXES.md               ← 2026-05-23 laptop run fixes
│   └── MASTER_BUNDLE_README.md               ← original bundle entry-point
└── tests/
    └── test_atlas_mount.js                   ← smoke: atlas mounts + registries validate
```

## Provenance — Phase 1a (this commit)

Imported from `COMPARATIVE_BREAKPOINTS_MASTER_20260522` tarball
(Quentin's laptop bundle, dated 2026-05-23). 54 files: 8 BP_ATLAS
stage scripts, 11 runners, 16 gene-order producers, 5 R figure
builders, 6 inversion-join scaffold files, 2 haplotype manifests,
4 docs, plus config + supporting scripts.

The atlas is **mounting-ready** but **page-empty** — the 3 declared
pages are stubs that render empty-state until real data lands in
`data/breakpoints/` / `data/synteny/`. The producer scripts run
cluster-side (LAPTOP runner is laptop-safe per `CHANGES_LAPTOP_FIXES.md`;
SLURM runner needs a missing `run_bp_atlas.sh` from Quentin's cluster
home before the SLURM driver works — flagged in §11 of HANDOFF).

## Not in Phase 1a (Phase 1c follow-up)

The migration plan also moves these from `inversion-atlas` to here:

- `pages/comparative/cross_species_breakpoints/` (Cgar × Cmac dashboard;
  currently in inversion-atlas, will become `pages/breakpoints/cs_pair_dashboard/`)
- `pages/comparative/multi_species_cockpit/` (cockpit; current 1-pair,
  will be extended to 18 species)
- 13 `mgl_*.js` modules (per `docs/MIGRATION_4_ATLASES.md` §4.2)
- 9 cross-species `shared/` modules (`synteny_multispecies.js`,
  `dotplot_mashmap.js`, `divergence_network.js`, `dxy_per_inversion.js`,
  `cross_species.js`, `cross_species_summary.js`,
  `phylogenetic_confound.js`, `busco_anchors.js`,
  `recombination_suppression.js`)
- `data/comparative/cross_species/` contents

These moves stay in inversion-atlas until Phase 1c so this commit
doesn't break the existing pages in the in-flight inversion atlas.

## Cohort discipline

Every layer produced by this atlas carries `cohort_id:
f1_hybrid_cga_cma` (per the workflow registry). Cross-atlas reads of
these layers from `inversion` / `evolution` / `popstats` (cohorts:
`cgar_hatchery_226`) go through the `bp_atlas_to_hatchery_join`
handoff in atlas-core's `cohorts.registry.json` — once Phase 0 is
merged into atlas-core. Until then, the cross-atlas reads run with
`allow_cohort_mismatch: true` and a logged banner.

## Running the BP_ATLAS workflow

```sh
cd atlases/cross-species/engines/producers/bp_atlas/runners
# Verify manifest paths first (catches silent pair-1 failure):
cut -f5 ../../../../data/manifests/haplotype_manifest_CROSSSPECIES.tsv \
  | tail -n +2 \
  | while read f; do [ -f "$f" ] && echo "OK $f" || echo "MISSING $f"; done
# Run laptop-safe (focal-only, 2 CPU, skip large targets → LANTA):
bash run_bp_atlas_LAPTOP.sh
# After it finishes:
bash run_fold_into_clusters_LAPTOP.sh
```

Outputs land in `data/breakpoints/results_bpatlas/` and are consumed
by the 3 atlas pages declared in `manifest.json`.

For LANTA / SLURM the driver needs `run_bp_atlas.sh` from Quentin's
cluster home (see `docs/CHANGES_LAPTOP_FIXES.md` §"KNOWN GAPS").
