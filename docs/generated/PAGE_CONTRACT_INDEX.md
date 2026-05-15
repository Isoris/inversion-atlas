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
| discovery_2 | page_similarity_panel | similarity matrix | _pending_ | _ | _ |
| discovery_2 | page_pca_panel | PCA scatter | _pending_ | _ | _ |
| discovery_2 | page_dosage_heatmap | dosage heatmap | _pending_ | _ | _ |
| discovery_2 | page_nested_detector | nested detector | _pending_ | _ | _ |
| discovery_2 | page_dosage_cluster | dosage cluster | _pending_ | _ | _ |
| catalogue | page8 | per-window summary table | _pending_ | _ | _ |
| catalogue | page19 | negative regions catalogue | _pending_ | _ | _ |
| catalogue | page3 | catalogue | _pending_ | _ | _ |
| catalogue | page9 | confirmed carousel | _pending_ | _ | _ |
| catalogue | page10 | marker panels | _pending_ | _ | _ |
| catalogue | page21 | annotation cockpit | _pending_ | _ | _ |
| classification | page17 | stats profile | _pending_ | _ | _ |
| classification | page18 | marker readiness panel | _pending_ | _ | _ |
| classification | page_overview | overview | _pending_ | _ | _ |
| classification | page4 | karyotype / tier | _pending_ | _ | _ |
| classification | page6 | popstats | _pending_ | _ | _ |
| classification | page7 | ancestry | _pending_ | _ | _ |
| classification | page11 | boundaries | _pending_ | _ | _ |
| classification | page_sv_evidence | SV evidence | _pending_ | _ | _ |
| evolution | page_evolution_polarize_msa | polarize · MSA | _pending_ | _ | _ |
| evolution | page_evolution_haplotype_network | haplotype network | _pending_ | _ | _ |
| evolution | page_evolution_polarize_synteny | polarize · synteny | _pending_ | _ | _ |
| evolution | page_evolution_age | age + divergence | _pending_ | _ | _ |
| evolution | page_evolution_mosaicism | mosaicism | _pending_ | _ | _ |
| evolution | page_evolution_internal_history | internal history | _pending_ | _ | _ |
| evolution | page_evolution_layer_cleaning | layer cleaning | _pending_ | _ | _ |
| evolution | page_evolution_event_tree | event tree | _pending_ | _ | _ |
| evolution | page_evolution_archaeology_card | archaeology card | _pending_ | _ | _ |
| comparative | page16 | cross-species breakpoints | _pending_ | _ | _ |
| comparative | page16b | multi-species cockpit | _pending_ | _ | _ |
| help | page5 | help | _pending_ | _ | _ |
| _unregistered_ | page_ancestry_scroller | ancestry scroller (not in manifest) | _pending_ | _ | _ |

**Progress**: 7 / 38 pages contracted.

## Next batches

- **Batch 2**: discovery_2 part 1 — page2, page22, page_tree_panel, page_fingerprint_track
- **Batch 3**: discovery_2 part 2 — page_similarity_panel, page_pca_panel, page_dosage_heatmap, page_nested_detector, page_dosage_cluster
- **Batch 4**: catalogue stage (8 pages: page8, page19, page3, page9, page10, page17, page18, page21, page_overview)
- **Batch 5**: classification (5 pages: page4, page6, page7, page11, page_sv_evidence)
- **Batch 6**: evolution (9 pages)
- **Batch 7**: comparative + help + unregistered (4 pages)
- **Final**: rollup table with confidence / required-layers / status / known-issues columns
