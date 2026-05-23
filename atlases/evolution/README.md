# evolution atlas

Per `docs/MIGRATION_4_ATLASES.md` §1.2 + §3.3. Phase 2 of the
4-atlas split.

**Scope**: when and where on the catfish phylogeny did each
inversion arise? Age (BUSCO 4D substitutions + age-model
suggester), polarisation (synteny outgroup vote + MSA stacked +
founder consensus + doubleton SFS clusters), ancestry layer
cleaning, mosaicism leakage, internal substructure, haplotype
networks, event-tree relative ordering, archaeology synthesis.

**Cohort**: `cgar_hatchery_226` (the 226-sample pure
*C. gariepinus* hatchery cohort, the inversion-atlas main cohort —
evolution is a *follow-up* on inversions discovered there).

**Cross-atlas reads** (declared in atlas-core's
`cohorts.registry.json` as the appropriate handoffs):
- `inversion.candidates_v1` (read-only) — which inversions to age
- `crossSpecies.synteny_18sp_v1` (read-only, F1-hybrid cohort →
  hatchery handoff) — outgroup polarisation evidence
- `crossSpecies.breakpoints_consolidated_v1` (read-only, same
  handoff) — breakpoint context for event-tree ordering
- One concrete already-active cross-atlas import:
  `inv_internal_substructure.js` reads
  `crossSpecies.mgl_pca_compute.pcaForWindow` (relative import for
  now; Phase 1d/5 will switch to
  `cross_atlas_imports.resolveCrossAtlasRead()`)
- One read into inversion: `polarize_msa_stacked/renderer.js`
  reads inversion's dosage_heatmap renderer (cross-atlas relative
  for now — same Phase 1d/5 follow-up)

## Layout

```
atlases/evolution/
├── manifest.json                        9 pages declared
├── README.md                            this file
├── pages/
│   └── evolution/                       (mirrors inversion's pages/evolution/)
│       ├── age_divergence.{html,js}            + age_divergence/_state.js
│       ├── archaeology_synthesis_card.{html,js} + sub-state
│       ├── event_tree_relative_ordering.{html,js} + sub-state
│       ├── haplotype_network.{html,js}         + haplotype_network/{_state,renderer,selection}.js
│       ├── inv_internal_substructure.{html,js} + sub-state
│       ├── layer_cleaning.{html,js}            + sub-state
│       ├── mosaicism_leakage.{html,js}         + sub-state
│       ├── polarize_msa_stacked.{html,js}      + polarize_msa_stacked/{_state,builder,renderer,selection}.js
│       └── polarize_synteny_vote.{html,js}     + sub-state
├── shared/
│   ├── mgl_inversion_divergence.js      (Phase 2 from inversion/shared)
│   ├── mgl_outgroup_synteny.js          (Phase 2)
│   ├── mgl_haplotype_network.js         (Phase 2)
│   ├── mgl_doubleton_sfs_clusters.js    (Phase 2)
│   ├── mgl_archaeology_classifier.js    (Phase 2)
│   ├── mgl_event_tree.js                (Phase 2)
│   ├── mgl_founder_consensus.js         (Phase 2)
│   ├── mgl_kinship_downweight.js        (Phase 2)
│   ├── mgl_mosaicism_detector.js        (Phase 2)
│   ├── age_model_suggester.js           (Phase 2)
│   ├── busco_4d_age.js                  (Phase 2)
│   └── copy_origin_painting.js          (Phase 2)
├── registries/
│   └── data/
│       ├── layers.registry.json         (Phase 2: stub — full layers in Phase 5)
│       ├── pages.registry.json          9 pages with reads declarations
│       ├── operations.registry.json     stub
│       ├── files.registry.json          stub
│       ├── slots.registry.json          stub
│       └── workflows.registry.json      stub (no producer workflows yet — age
│                                          inference is in-page; producers are
│                                          out of scope for Phase 2)
├── data/                                empty (per-candidate age + polarity
│                                          outputs land here when the page UIs
│                                          export them)
├── server-adapters/                     empty
├── engines/                             empty
├── docs/                                empty
└── tests/
    └── test_atlas_mount.js              mount smoke
```

## Phase 2 audit results

The audit before the move (grep of every importer of every moving
file) found:
- 9 pages moving wholesale, no external page-import dependencies.
- 9 `mgl_*` modules moving, each imported by exactly ONE evolution
  page (1:1 mgl ↔ page mapping).
- 3 age/polarisation modules moving, ZERO external importers.
- Cross-atlas imports introduced: 2 (one to cross-species
  mgl_pca_compute, one to inversion's dosage_heatmap renderer).
  Both flagged with comments for the eventual
  `cross_atlas_imports.resolveCrossAtlasRead()` switch.

This is the cleanest possible extract — no inversion-side import
paths needed updating (the audit showed no inversion-side files
importing any of the moving modules).

## Naming + cohort discipline

Evolution work uses the 226-Cgar hatchery cohort for ages /
polarities, but reads outgroup data from the F1 comparative
cohort via the registered handoffs. Never conflate; never write
"comparative cohort evidence proves a hatchery individual is
X". Page UI text must distinguish "evidence FROM the comparative
cohort INFORMS hatchery inference" from "hatchery individual
claims".
