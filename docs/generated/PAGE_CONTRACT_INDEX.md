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
| comparative | page16 | cross-species breakpoints | _pending_ | _ | _ |
| comparative | page16b | multi-species cockpit | _pending_ | _ | _ |
| help | page5 | help | _pending_ | _ | _ |
| _unregistered_ | page_ancestry_scroller | ancestry scroller (not in manifest) | _pending_ | _ | _ |

**Progress**: 35 / 38 pages contracted.

## Next batches

- **Batch 2**: discovery_2 part 1 — page2, page22, page_tree_panel, page_fingerprint_track
- **Batch 3**: discovery_2 part 2 — page_similarity_panel, page_pca_panel, page_dosage_heatmap, page_nested_detector, page_dosage_cluster
- **Batch 4**: catalogue stage (8 pages: page8, page19, page3, page9, page10, page17, page18, page21, page_overview)
- **Batch 5**: classification (5 pages: page4, page6, page7, page11, page_sv_evidence)
- **Batch 6**: evolution (9 pages)
- **Batch 7**: comparative + help + unregistered (4 pages)
- **Final**: rollup table with confidence / required-layers / status / known-issues columns
