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
| discovery_2 | page22 | haplotype regimes | active (Phase 1) | high | [page.manifest.json](page_contracts/page22/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page22/PAGE_CONTRACT.md) |
| discovery_2 | page_tree_panel | tree panel | active (Phase 1) | high | [page.manifest.json](page_contracts/page_tree_panel/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_tree_panel/PAGE_CONTRACT.md) |
| discovery_2 | page_fingerprint_track | fingerprint track | active (Phase 1) | high | [page.manifest.json](page_contracts/page_fingerprint_track/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_fingerprint_track/PAGE_CONTRACT.md) |
| discovery_2 | page_similarity_panel | similarity matrix | active (Phase 1) | high | [page.manifest.json](page_contracts/page_similarity_panel/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_similarity_panel/PAGE_CONTRACT.md) |
| discovery_2 | page_pca_panel | PCA scatter | active (Phase 1) | high | [page.manifest.json](page_contracts/page_pca_panel/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_pca_panel/PAGE_CONTRACT.md) |
| discovery_2 | page_dosage_heatmap | dosage heatmap | active (Phase 1) | high | [page.manifest.json](page_contracts/page_dosage_heatmap/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_dosage_heatmap/PAGE_CONTRACT.md) |
| discovery_2 | page_nested_detector | nested detector | active (Phase 1) | high | [page.manifest.json](page_contracts/page_nested_detector/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_nested_detector/PAGE_CONTRACT.md) |
| discovery_2 | page_dosage_cluster | dosage cluster | active (Phase 1) | high | [page.manifest.json](page_contracts/page_dosage_cluster/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_dosage_cluster/PAGE_CONTRACT.md) |
| catalogue | page8 | per-window summary table | active (fresh) | high | [page.manifest.json](page_contracts/page8/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page8/PAGE_CONTRACT.md) |
| catalogue | page19 | negative regions catalogue | active (fresh) | high | [page.manifest.json](page_contracts/page19/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page19/PAGE_CONTRACT.md) |
| catalogue | page3 | catalogue | active | high | [page.manifest.json](page_contracts/page3/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page3/PAGE_CONTRACT.md) |
| catalogue | page9 | confirmed carousel | active (fresh) | high | [page.manifest.json](page_contracts/page9/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page9/PAGE_CONTRACT.md) |
| catalogue | page10 | marker panels | active | high | [page.manifest.json](page_contracts/page10/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page10/PAGE_CONTRACT.md) |
| catalogue | page21 | annotation cockpit | active | high | [page.manifest.json](page_contracts/page21/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page21/PAGE_CONTRACT.md) |
| classification | page17 | stats profile | active | high | [page.manifest.json](page_contracts/page17/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page17/PAGE_CONTRACT.md) |
| classification | page18 | marker readiness panel | active | high | [page.manifest.json](page_contracts/page18/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page18/PAGE_CONTRACT.md) |
| classification | page_overview | overview | empty stub | high | [page.manifest.json](page_contracts/page_overview/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_overview/PAGE_CONTRACT.md) |
| classification | page4 | karyotype / tier | active | high | [page.manifest.json](page_contracts/page4/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page4/PAGE_CONTRACT.md) |
| classification | page6 | popstats | active (thin loader) | high | [page.manifest.json](page_contracts/page6/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page6/PAGE_CONTRACT.md) |
| classification | page7 | ancestry | active (thin loader) | high | [page.manifest.json](page_contracts/page7/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page7/PAGE_CONTRACT.md) |
| classification | page11 | boundaries | active | high | [page.manifest.json](page_contracts/page11/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page11/PAGE_CONTRACT.md) |
| classification | page_sv_evidence | SV evidence | active (thin loader) | high | [page.manifest.json](page_contracts/page_sv_evidence/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_sv_evidence/PAGE_CONTRACT.md) |
| evolution | page_evolution_polarize_msa | polarize · MSA | active | high | [page.manifest.json](page_contracts/page_evolution_polarize_msa/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_polarize_msa/PAGE_CONTRACT.md) |
| evolution | page_evolution_haplotype_network | haplotype network | active | high | [page.manifest.json](page_contracts/page_evolution_haplotype_network/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_haplotype_network/PAGE_CONTRACT.md) |
| evolution | page_evolution_polarize_synteny | polarize · synteny | active | medium | [page.manifest.json](page_contracts/page_evolution_polarize_synteny/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_polarize_synteny/PAGE_CONTRACT.md) |
| evolution | page_evolution_age | age + divergence | active | medium | [page.manifest.json](page_contracts/page_evolution_age/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_age/PAGE_CONTRACT.md) |
| evolution | page_evolution_mosaicism | mosaicism | active | medium | [page.manifest.json](page_contracts/page_evolution_mosaicism/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_mosaicism/PAGE_CONTRACT.md) |
| evolution | page_evolution_internal_history | internal history | active | medium | [page.manifest.json](page_contracts/page_evolution_internal_history/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_internal_history/PAGE_CONTRACT.md) |
| evolution | page_evolution_layer_cleaning | layer cleaning | active | high | [page.manifest.json](page_contracts/page_evolution_layer_cleaning/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_layer_cleaning/PAGE_CONTRACT.md) |
| evolution | page_evolution_event_tree | event tree | active | medium | [page.manifest.json](page_contracts/page_evolution_event_tree/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_event_tree/PAGE_CONTRACT.md) |
| evolution | page_evolution_archaeology_card | archaeology card | active | high | [page.manifest.json](page_contracts/page_evolution_archaeology_card/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_evolution_archaeology_card/PAGE_CONTRACT.md) |
| comparative | page16 | cross-species breakpoints | active | high | [page.manifest.json](page_contracts/page16/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page16/PAGE_CONTRACT.md) |
| comparative | page16b | multi-species cockpit | active | high | [page.manifest.json](page_contracts/page16b/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page16b/PAGE_CONTRACT.md) |
| help | page5 | help | active (static) | high | [page.manifest.json](page_contracts/page5/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page5/PAGE_CONTRACT.md) |
| _unregistered_ | page_ancestry_scroller | Fish Ancestry Scroller | unregistered | high | [page.manifest.json](page_contracts/page_ancestry_scroller/page.manifest.json) · [PAGE_CONTRACT.md](page_contracts/page_ancestry_scroller/PAGE_CONTRACT.md) |

**Progress**: 38 / 38 pages contracted. ✅ **Complete first pass.**

## Cross-cutting findings (rollup)

### Pages NOT in `pages.registry.json` (only in `manifest.json`)

- page_tree_panel, page_fingerprint_track, page_similarity_panel,
  page_pca_panel, page_dosage_heatmap, page_nested_detector,
  page_dosage_cluster
- all 9 evolution pages
- (i.e. every cartridge page from HANDOFF_5 / 6 / 7 / 8 / 10 / SPEC_0,
  and every evolution-stage page)

**Implication**: `pages.registry.json` lags behind `manifest.json`.
Either add `_doc` entries to `pages.registry.json` for these, or
declare `manifest.json` as the canonical page registry and migrate
the `_doc` field there.

### Directory / stage discrepancies

- **page8**, **page19** live under `pages/discovery/` but
  `manifest.json` says `stage: "catalogue"`.
- **page17**, **page18**, **page_overview** live under
  `pages/catalogue/` but `manifest.json` says `stage:
  "classification"`.
- **page5** lives under `pages/comparative/` but `manifest.json`
  says `stage: "help"`.

**Implication**: directory does not equal stage. The stage is
authoritative for the shell's tab grouping.

### Registry mismatches flagged in `pages.registry.json` `_doc`

1. **page4** — declares `candidate_sv_counts + candidate_boundaries`
   but consumes `state.data.final_classification +
   state.data.classification`.
2. **page6** — declares `candidate_gene_cargo + activeCandidate`
   but is chromosome-level (should be `popstats_tracks +
   activeChrom`).
3. **page7** — declares `candidate_marker_primers + activeCandidate`
   but is chromosome-level (should be `ancestry_phase4 +
   activeChrom`).
4. **page11** — declares `candidate_final_class +
   candidate_breeding_card` but consumes boundaries.

**Swap hypothesis**: page4's declared layers may have been swapped
with page11's. Deferred to a future renumbering round.

### SPECs referenced from page sources but missing on disk

(From `_handoff_docs/SPECS_AUDIT.md`)

- `SPEC_g_panel_unified_groups.md` (page1)
- `SPEC_lines_panel_candidate_bands.md` (page1)
- `SPEC_l2_sweep_inheritance.md` (page1)
- `SPEC_l3_het_dosage_coloring.md` (page1)
- `SPEC_lasso_inheritance_backgrounds.md` (page1)
- `SPEC_sv_evidence_page.md` (page_sv_evidence + producer)
- `SPEC_DEFERRED.md` (general)
- `SPEC_distant_band_concordance_fish_trajectory.md` (band-track parent)
- `SPEC_review_surfaces_auto_and_lineages.md`

### Schema prose referenced but missing

- `SCHEMA.md` / `SCHEMA_V2.md` — referenced from
  `pages.registry.json` (e.g. page4 _doc cites `SCHEMA_V2.md §19`)
  and from page10 module header (`SCHEMA §10`) but no prose schema
  doc exists. The 26 JSON schemas in `registries/schemas/` cover
  layer formats but not the prose explanation.

### Thin-loader stubs (external renderers)

- **page6** — `window.renderPopstatsPage` in `js/atlas_page6_wiring.js`
- **page7** — `window.renderAncestryPage` in sibling external file
- **page_sv_evidence** — `window.AtlasSVEvidence` object in
  `js/atlas_sv_evidence.js`

All 3 fall back to empty-state when their external module is absent.

### Fresh implementations (legacy shipped HTML shell only)

- **page8** — per-window summary table (legacy had `#winSumNoChrom`
  empty state only)
- **page9** — confirmed carousel (no JS in legacy; built from spec)
- **page19** — negative regions catalogue (legacy referenced
  `_nrRender` in HTML comment, never implemented)
- **page3** — catalogue rendering pipeline (legacy referenced
  `renderCatalogue` via typeof guards, never defined)

### User-guide documents

Only one page in the entire atlas has end-user documentation:
- **page22** — `specs_done/_bundles/HOW_TO_USE_page22.md` (13 KB)

The rest are `unknown` for user guide. **page5 itself is the
in-app help page** — it has ~1158 LOC of static HTML covering help,
vocabulary, hotkeys, pipeline reference. But this is the in-app
help, not a manual.

### Cross-page dependencies

- **page17** → page16 (`_csGetSyntenyBlocks`, `_csPermutationTest`
  — promoted to ES exports round 5 step 11; still imported via
  typeof guards)
- **page16b** → page16 (`state.crossSpecies` — fragile coupling)
- **page12** + **page15** → page1 (`page1.applyData()` dispatches
  panel renderers when θπ / GHSL layers are present)
- **page9** → page2 (reuses `renderCandidateMetadata`)
- **page_evolution_polarize_msa** → page_dosage_heatmap (reuses
  painter)

## Statistics

- **Total pages contracted**: 38 (37 in manifest + 1 unregistered)
- **High confidence**: 25
- **Medium confidence**: 13
- **Low confidence**: 0
- **Active / shipped**: 32
- **Stubs / empty / Phase 1 with deferred work**: 5
  (page12, page15, page_overview, page_ancestry_scroller; page22
  Phase 1 only)
- **Thin loaders**: 3 (page6, page7, page_sv_evidence)
- **Fresh implementations (legacy was HTML shell)**: 4 (page3,
  page8, page9, page19)

## Next steps (for reviewer)

1. **Open each `PAGE_CONTRACT.md` and validate** — correct any
   capability that was inferred wrong. The `confidence: medium`
   pages are the priority (evolution stage).
2. **Reclassify each page** by `page_type` (core_page /
   utility_overlay / debug_page / experimental_page / export_page).
   Today's contracts all default to `core_page`.
3. **Resolve the 4 registry mismatches** (page4/6/7/11) — confirm
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
   `specs_done/_bundles/HOW_TO_USE_page22.md`. Pair each with the
   per-page `PAGE_CONTRACT.md` to seed the manual.
