# PAGE_CONTRACT_INDEX — generated page capability contracts

**Generated**: 2026-05-15 (in progress — building up across multiple turns).

This index lists every page contract under `docs/generated/page_contracts/`.
Each row points to the per-page `page.manifest.json` (machine-readable)
and `PAGE_CONTRACT.md` (human-readable).

**Convention**: see `SPECS.md` at repo root for how this fits with the
canonical SPECs (`specs_done/` + `specs_todo/`).

## Rules followed when generating these

1. Only document what the page **currently** does, inferred from
   code (imports, DOM ids, top-of-file comments, state.X references,
   event handlers).
2. Mark `unknown` liberally rather than invent.
3. Cross-reference SPECs / handoffs but do not duplicate their
   content.
4. One folder per page: `docs/generated/page_contracts/<page_id>/`.

## Source files consulted per page

- `atlases/inversion/manifest.json` — id / label / stage / paths / tooltip
- `atlases/inversion/registries/data/pages.registry.json` — `_doc`
- `atlases/inversion/pages/<stage>/<page>.{html,js}` — entry files
- `atlases/inversion/pages/<stage>/<page>/*.js` — subdir modules
- `legacy/Inversion_atlas.html` — original source (referenced via
  legacy-line citations in each page's source)
- `specs_done/`, `specs_todo/` — SPEC cross-references
- `_handoff_docs/`, `handoff_docs/` — narrative provenance

## Inventory (in progress)

| stage | page_id | label | status | confidence | contract |
|-------|---------|-------|--------|-----------:|----------|
| discovery | page1 | local PCA \|Z\| | active | high | [page.manifest.json](page_contracts/page1/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page1/PAGE_CONTRACT.md) |
| discovery | page12 | local PCA θπ | active (empty-state until layers) | high | [page.manifest.json](page_contracts/page12/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page12/PAGE_CONTRACT.md) |
| discovery | page15 | local PCA GHSL | stub (renderers TODO) | high | [page.manifest.json](page_contracts/page15/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page15/PAGE_CONTRACT.md) |
| discovery_2 | page2 | candidate focus | active | high | [page.manifest.json](page_contracts/page2/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page2/PAGE_CONTRACT.md) |
| discovery_2 | haplotype_regimes | haplotype regimes | active (Phase 1) | high | [page.manifest.json](page_contracts/haplotype_regimes/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/haplotype_regimes/PAGE_CONTRACT.md) |
| discovery_2 | tree_panel | tree panel | active (Phase 1) | high | [page.manifest.json](page_contracts/tree_panel/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/tree_panel/PAGE_CONTRACT.md) |
| discovery_2 | fingerprint_track | fingerprint track | active (Phase 1) | high | [page.manifest.json](page_contracts/fingerprint_track/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/fingerprint_track/PAGE_CONTRACT.md) |
| discovery_2 | similarity_matrix | similarity matrix | active (Phase 1) | high | [page.manifest.json](page_contracts/similarity_matrix/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/similarity_matrix/PAGE_CONTRACT.md) |
| discovery_2 | pca_scatter_per_window | PCA scatter | active (Phase 1) | high | [page.manifest.json](page_contracts/pca_scatter_per_window/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/pca_scatter_per_window/PAGE_CONTRACT.md) |
| discovery_2 | dosage_heatmap | dosage heatmap | active (Phase 1) | high | [page.manifest.json](page_contracts/dosage_heatmap/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/dosage_heatmap/PAGE_CONTRACT.md) |
| discovery_2 | nested_inversion_detector | nested detector | active (Phase 1) | high | [page.manifest.json](page_contracts/nested_inversion_detector/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/nested_inversion_detector/PAGE_CONTRACT.md) |
| discovery_2 | dosage_cluster_adaptive_k | dosage cluster | active (Phase 1) | high | [page.manifest.json](page_contracts/dosage_cluster_adaptive_k/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/dosage_cluster_adaptive_k/PAGE_CONTRACT.md) |
| catalogue | page8 | per-window summary table | active (fresh) | high | [page.manifest.json](page_contracts/page8/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page8/PAGE_CONTRACT.md) |
| catalogue | page19 | negative regions catalogue | active (fresh) | high | [page.manifest.json](page_contracts/page19/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page19/PAGE_CONTRACT.md) |
| catalogue | catalogue | catalogue | active | high | [page.manifest.json](page_contracts/catalogue/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/catalogue/PAGE_CONTRACT.md) |
| catalogue | confirmed_carousel | confirmed carousel | active (fresh) | high | [page.manifest.json](page_contracts/confirmed_carousel/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/confirmed_carousel/PAGE_CONTRACT.md) |
| catalogue | marker_panels | marker panels | active | high | [page.manifest.json](page_contracts/marker_panels/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/marker_panels/PAGE_CONTRACT.md) |
| catalogue | annotation_cockpit | annotation cockpit | active | high | [page.manifest.json](page_contracts/annotation_cockpit/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/annotation_cockpit/PAGE_CONTRACT.md) |
| classification | stats_profile | stats profile | active | high | [page.manifest.json](page_contracts/stats_profile/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/stats_profile/PAGE_CONTRACT.md) |
| classification | marker_readiness | marker readiness panel | active | high | [page.manifest.json](page_contracts/marker_readiness/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/marker_readiness/PAGE_CONTRACT.md) |
| classification | overview | overview | empty stub | high | [page.manifest.json](page_contracts/overview/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/overview/PAGE_CONTRACT.md) |
| classification | karyotype_tier | karyotype / tier | active | high | [page.manifest.json](page_contracts/karyotype_tier/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/karyotype_tier/PAGE_CONTRACT.md) |
| classification | popstats | popstats | active (thin loader) | high | [page.manifest.json](page_contracts/popstats/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/popstats/PAGE_CONTRACT.md) |
| classification | ancestry_per_window | ancestry | active (thin loader) | high | [page.manifest.json](page_contracts/ancestry_per_window/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/ancestry_per_window/PAGE_CONTRACT.md) |
| classification | boundary_refinement | boundaries | active | high | [page.manifest.json](page_contracts/boundary_refinement/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/boundary_refinement/PAGE_CONTRACT.md) |
| classification | sv_evidence | SV evidence | active (thin loader) | high | [page.manifest.json](page_contracts/sv_evidence/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/sv_evidence/PAGE_CONTRACT.md) |
| evolution | polarize_msa_stacked | polarize · MSA | active | high | [page.manifest.json](page_contracts/polarize_msa_stacked/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/polarize_msa_stacked/PAGE_CONTRACT.md) |
| evolution | haplotype_network | haplotype network | active | high | [page.manifest.json](page_contracts/haplotype_network/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/haplotype_network/PAGE_CONTRACT.md) |
| evolution | polarize_synteny_vote | polarize · synteny | active | medium | [page.manifest.json](page_contracts/polarize_synteny_vote/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/polarize_synteny_vote/PAGE_CONTRACT.md) |
| evolution | age_divergence | age + divergence | active | medium | [page.manifest.json](page_contracts/age_divergence/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/age_divergence/PAGE_CONTRACT.md) |
| evolution | mosaicism_leakage | mosaicism | active | medium | [page.manifest.json](page_contracts/mosaicism_leakage/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/mosaicism_leakage/PAGE_CONTRACT.md) |
| evolution | inv_internal_substructure | internal history | active | medium | [page.manifest.json](page_contracts/inv_internal_substructure/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/inv_internal_substructure/PAGE_CONTRACT.md) |
| evolution | layer_cleaning | layer cleaning | active | high | [page.manifest.json](page_contracts/layer_cleaning/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/layer_cleaning/PAGE_CONTRACT.md) |
| evolution | event_tree_relative_ordering | event tree | active | medium | [page.manifest.json](page_contracts/event_tree_relative_ordering/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/event_tree_relative_ordering/PAGE_CONTRACT.md) |
| evolution | archaeology_synthesis_card | archaeology card | active | high | [page.manifest.json](page_contracts/archaeology_synthesis_card/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/archaeology_synthesis_card/PAGE_CONTRACT.md) |
| comparative | cross_species_breakpoints | cross-species breakpoints | active | high | [page.manifest.json](page_contracts/cross_species_breakpoints/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/cross_species_breakpoints/PAGE_CONTRACT.md) |
| comparative | multi_species_cockpit | multi-species cockpit | active | high | [page.manifest.json](page_contracts/multi_species_cockpit/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/multi_species_cockpit/PAGE_CONTRACT.md) |
| help | help | help | active (static) | high | [page.manifest.json](page_contracts/help/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/help/PAGE_CONTRACT.md) |
| classification | fish_ancestry_scroller | Fish Ancestry Scroller | active (registered 2026-05-15) | high | [page.manifest.json](page_contracts/fish_ancestry_scroller/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/fish_ancestry_scroller/PAGE_CONTRACT.md) |

**Progress**: 38 / 38 pages contracted. ✅ **Complete first pass.**
All 38 pages registered in `manifest.json` + `pages.registry.json`
(fish_ancestry_scroller registered 2026-05-15 — was on-disk-but-unregistered until then).

## Cross-cutting findings (rollup)

### Pages NOT in `pages.registry.json` (only in `manifest.json`)

**RESOLVED 2026-05-15** — all 16 missing entries added to
`pages.registry.json` by porting `_doc` from the page contracts.
Registry now covers all 38 manifest pages + 1 registry-only entry
(`popstats_demo`) = 39 entries total.

Closed entries:
- tree_panel, fingerprint_track, similarity_matrix,
  pca_scatter_per_window, dosage_heatmap, nested_inversion_detector,
  dosage_cluster_adaptive_k (7 cartridge pages — HANDOFF_5/6/7/8/10 + SPEC_0)
- polarize_msa_stacked, haplotype_network,
  polarize_synteny_vote, age_divergence,
  mosaicism_leakage, inv_internal_substructure,
  layer_cleaning, event_tree_relative_ordering,
  archaeology_synthesis_card (9 evolution pages)

### Directory / stage discrepancies

- **page8**, **page19** live under `pages/discovery/` but
  `manifest.json` says `stage: "catalogue"`.
- **stats_profile**, **marker_readiness**, **overview** live under
  `pages/catalogue/` but `manifest.json` says `stage:
  "classification"`.
- **help** lives under `pages/comparative/` but `manifest.json`
  says `stage: "help"`.

**Implication**: directory does not equal stage. The stage is
authoritative for the shell's tab grouping.

### Registry mismatches flagged in `pages.registry.json` `_doc`

1. **karyotype_tier** — declares `candidate_sv_counts + candidate_boundaries`
   but consumes `state.data.final_classification +
   state.data.classification`.
2. **popstats** — declares `candidate_gene_cargo + activeCandidate`
   but is chromosome-level (should be `popstats_tracks +
   activeChrom`).
3. **ancestry_per_window** — declares `candidate_marker_primers + activeCandidate`
   but is chromosome-level (should be `ancestry_phase4 +
   activeChrom`).
4. **boundary_refinement** — declares `candidate_final_class +
   candidate_breeding_card` but consumes boundaries.

**Swap hypothesis**: karyotype_tier's declared layers may have been swapped
with boundary_refinement's. Deferred to a future renumbering round.

### SPECs referenced from page sources but missing on disk

(From `_handoff_docs/SPECS_AUDIT.md`)

- `SPEC_g_panel_unified_groups.md` (page1)
- `SPEC_lines_panel_candidate_bands.md` (page1)
- `SPEC_l2_sweep_inheritance.md` (page1)
- `SPEC_l3_het_dosage_coloring.md` (page1)
- `SPEC_lasso_inheritance_backgrounds.md` (page1)
- `SPEC_sv_evidence_page.md` (sv_evidence + producer)
- `SPEC_DEFERRED.md` (general)
- `SPEC_distant_band_concordance_fish_trajectory.md` (band-track parent)
- `SPEC_review_surfaces_auto_and_lineages.md`

### Schema prose referenced but missing

- `SCHEMA.md` / `SCHEMA_V2.md` — referenced from
  `pages.registry.json` (e.g. karyotype_tier _doc cites `SCHEMA_V2.md §19`)
  and from marker_panels module header (`SCHEMA §10`) but no prose schema
  doc exists. The 26 JSON schemas in `registries/schemas/` cover
  layer formats but not the prose explanation.

### Thin-loader stubs (external renderers)

- **popstats** — `window.renderPopstatsPage` in `js/atlas_page6_wiring.js`
- **ancestry_per_window** — `window.renderAncestryPage` in sibling external file
- **sv_evidence** — `window.AtlasSVEvidence` object in
  `js/atlas_sv_evidence.js`

All 3 fall back to empty-state when their external module is absent.

### Fresh implementations (legacy shipped HTML shell only)

- **page8** — per-window summary table (legacy had `#winSumNoChrom`
  empty state only)
- **confirmed_carousel** — confirmed carousel (no JS in legacy; built from spec)
- **page19** — negative regions catalogue (legacy referenced
  `_nrRender` in HTML comment, never implemented)
- **catalogue** — catalogue rendering pipeline (legacy referenced
  `renderCatalogue` via typeof guards, never defined)

### User-guide documents

Only one page in the entire atlas has end-user documentation:
- **page22** — `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md` (13 KB)

The rest are `unknown` for user guide. **help itself is the
in-app help page** — it has ~1158 LOC of static HTML covering help,
vocabulary, hotkeys, pipeline reference. But this is the in-app
help, not a manual.

### Cross-page dependencies

- **stats_profile** → cross_species_breakpoints (`_csGetSyntenyBlocks`, `_csPermutationTest`
  — promoted to ES exports round 5 step 11; still imported via
  typeof guards)
- **multi_species_cockpit** → cross_species_breakpoints (`state.crossSpecies` — fragile coupling)
- **page12** + **page15** → page1 (`page1.applyData()` dispatches
  panel renderers when θπ / GHSL layers are present)
- **confirmed_carousel** → page2 (reuses `renderCandidateMetadata`)
- **polarize_msa_stacked** → dosage_heatmap (reuses
  painter)

## Statistics

- **Total pages contracted**: 38 (37 in manifest + 1 unregistered)
- **High confidence**: 25
- **Medium confidence**: 13
- **Low confidence**: 0
- **Active / shipped**: 32
- **Stubs / empty / Phase 1 with deferred work**: 5
  (page12, page15, overview, fish_ancestry_scroller; page22
  Phase 1 only)
- **Thin loaders**: 3 (popstats, ancestry_per_window, sv_evidence)
- **Fresh implementations (legacy was HTML shell)**: 4 (catalogue,
  page8, confirmed_carousel, page19)

## Next steps (for reviewer)

1. **Open each `PAGE_CONTRACT.md` and validate** — correct any
   capability that was inferred wrong. The `confidence: medium`
   pages are the priority (evolution stage).
2. **Reclassify each page** by `page_type` (core_page /
   utility_overlay / debug_page / experimental_page / export_page).
   Today's contracts all default to `core_page`.
3. **Resolve the 4 registry mismatches** (karyotype_tier/6/7/11) — confirm
   the swap hypothesis or correct the registry.
4. **Decide manifest.json vs pages.registry.json canonicity** —
   currently `pages.registry.json` lags. The 7 cartridge pages
   and 9 evolution pages are missing `_doc` entries.
5. **Author the 8 missing SPECs** (or retire the references). See
   `_handoff_docs/SPECS_AUDIT.md` for the list.
6. **Write `SCHEMA.md`** — consolidate the 26 JSON schemas in
   `registries/schemas/` into a prose document so the §N cross-refs
   resolve.
7. **Generate page user-guides** in the style of
   `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md`. Pair each with the
   per-page `PAGE_CONTRACT.md` to seed the manual.
