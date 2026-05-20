# SPECS — master index

Cross-cutting index of every specification in the repo. Pair with
`_handoff_docs/SPECS_AUDIT.md` (provenance) and
`_handoff_docs/ATLAS_PAGES_MAP.md` (consumer inventory).

## The folder convention (locked in 2026-05-15)

```
specs_todo/     — design backlog (authored, not yet implemented)
specs_done/     — shipped (implementation matches the SPEC)
specs_todo/mgl_adapter/  — self-contained spec sub-tree for the mgl
                           adapter library; has its own SPEC_0_master
                           + 5 numbered HANDOFFs + 2 READMEs
```

**Rule**: a SPEC never gets deleted. If the code ships, move the SPEC
from `specs_todo/` to `specs_done/`, update its status line, and add
an `Implemented in:` block at the top. See
`specs_done/README.md` for the workflow.

This rule exists because we lost a `specs_done/` folder at tarball
import time (see `_handoff_docs/SPECS_AUDIT.md` for the forensics).
That doesn't happen again.

## All SPECs at a glance

### Shipped — `specs_done/`

| SPEC | what it covers | implementation |
|------|----------------|----------------|
| `SPEC_registry_v2.md` | 9-item registry v2 design (versioning + write contract + cache invalidation) | `atlases/inversion/registries/data/*.registry.json` + atlas-core registry runtime |
| `SPEC_band_track_extraction_and_l3_single_band_rows.md` | het-anchored band-track skeleton + L3 single-band-rows contingency view | `shared/band_tracking/` (32 modules) + `pages/discovery/local_pca_dosage/l3_panel.js` + `local_pca_dosage/band_diagnostics.js` |
| `SPEC_sv_evidence_page.md` | SV evidence page + producer pipeline | `pages/review/sv_evidence.js` + `js/atlas_sv_evidence.js` + `engines/producers/sv_evidence/` |
| `SPEC_l2_sweep_inheritance.md` | L2-sweep auto-promote pipeline (local_pca_dosage candidate discovery: 6 gates) | `pages/discovery/local_pca_dosage/l2_sweep.js` |
| `SPEC_g_panel_unified_groups.md` | G-panel unified-groups popup (Karyotype / Inheritance / Manual tabs; Slice 1 shipped) | `pages/discovery/local_pca_dosage/{pca_panel.js, manual_groups.js}` + `local_pca_dosage.html#gPanelOpenBtn` |
| `SPEC_lines_panel_candidate_bands.md` | Per-candidate vertical band highlights on lines panel (confirmed-only, palette stable across zoom, default-ON) | `pages/discovery/local_pca_dosage/{lines_panel.js, candidates.js}` |
| `SPEC_lasso_inheritance_backgrounds.md` | Fish-set linkage table (Slices 1 + 3 shipped: pure compute + cache + TSV + modal; Slices 2/4/5 deferred) | legacy turn 164 (migration to modular tree TBD) |
| `SPEC_l3_het_dosage_coloring.md` | L3 mini-PCA dot fill by per-sample het rate (cold blue → warm red); halo stays K-coloured | `pages/discovery/local_pca_dosage/l3_panel.js` + `shared/het_rate.js` + `local_pca_dosage.html#l3HetToggle` |
| `SPEC_review_surfaces_auto_and_lineages.md` | Review surfaces for L2-sweep auto-promoted candidates (Slices 0-2 shipped: dashed CSS + filter pipelines + G-panel auto tab; Slice 3 lineages tab deferred) | `css/inversion.css` + legacy turn 130 + turn 165 (G-panel auto tab) |
| `SPEC_distant_band_concordance_fish_trajectory.md` | Fish-paths dual of band-track (Slices 1-5 shipped: lineage compute, lines color mode, \|Z\| strip, band-trace UI, TSV; Slice 6 cross-strip chaining deferred) | `pages/discovery/local_pca_dosage/{lineage.js, band_trace_*.js}` + `shared/{band_trace.js, clustering.js}` |
| `SCHEMA.md` | Prose schema reference — resolves all "SCHEMA §N" / "SCHEMA_V2.md §N" cross-refs from code; carries §9 cluster-emit, §10 marker columns, §13 evidence framework, §19 14-axis tier, §22 structural scaffold, §26 axis_topology vocab, §27 scale_stability verdicts; reserves §0-§30 for future | `registries/schemas/*.schema.json` (26 files) + `registries/data/*.registry.json` (5 files) + `pages/review/karyotype_tier/tier_axes.js#TIER_AXES` |
| `SPEC_inversion_divergence_network_v1.md` | Candidate-scoped node-link diagnostic: nodes = karyotype groups (STD/HET/INV or arr_0..N) labelled with within-group π, edges = pairwise FST (Nei for dosage, variance-ratio for pc1) or Euclidean distance; flagged weak/strong/low_power for renderer hints. Pure-data layer only (panel wiring deferred). | `shared/divergence_network.js` (compute + render hints with circular layout) + `tests/test_shared_divergence_network.js` (412-line smoke) + referenced from `pages/catalogue/stats_profile.js` |
| `SPEC_inversion_age_atlas_surface.md` | Reconstructed turn-117 parent of the `_AMENDMENT`: per-candidate age + divergence surface. Compute primitives ship; the AMENDMENT's row layout (Page-3 Rows A/B/C/D, Page-5 "rel age" column) carries per-slice shipped/deferred status. | `shared/mgl_inversion_divergence.js` (computeDivergence + age_class) + `shared/age_model_suggester.js` + `shared/busco_4d_age.js` (Method 3 brackets) + `pages/evolution/age_divergence.{html,js}` (four-bar surface + verdict) + `tests/smoke_evolution_age_divergence_round5.mjs` |
| `SPEC_arrangement_color_mode_and_arrangement_calls_v1.md` | Atlas-side decoder + palette + per-sample voting + JSON validator for `arrangement_calls_v1.json` + sample-color-mode dispatcher. Producer-side JSON emitter remains deferred (out-of-atlas scope per §6). Archived 2026-05-20 with per-slice status. | `shared/arrangement_calls.js` (9 exports: schema-version + palette + `decodeArrangementsFromPartition` + `assignArrangementPerSample` + `tabulateArrangementSizes` + `validateArrangementCallsJson`) + `shared/sample_color.js` (mode dispatcher) + `tests/test_shared_arrangement_calls.js` |
| `SPEC_busco_4d_age_brackets.md` | Method 3 absolute-age compute: 3 frozen μ values, dXY → age_my with CI propagation, `busco_4d_age_brackets` JSON block builder + validator + cross-check + Row-C formatters. LANTA producer `STEP_C01f_e_emit_busco_4d_age.py` remains a cluster-side deliverable; Row-C UI consumer remains a page task tracked by the age-surface SPEC §3. Archived 2026-05-20 with per-slice status. | `shared/busco_4d_age.js` (12 exports incl. `BUSCO_4D_MUS` + `computeAllThreeAges` + `buildBuscoAgeBracketsBlock` + `validateBuscoAgeBracketsBlock` + `verifyAgeMatchesDxy` + 2 formatters) + `tests/test_shared_busco_4d_age.js`; cited from the age-surface SPEC pair |
| `SPEC_busco_anchors_v1.md` | BUSCO single-copy cross-species anchors: schema validator, per-species indexing, homology-pair derivation, window count / density / depletion, synteny score, architecture-class auto-suggest. Page-16 ribbon-plot ticks + Page-14 architecture-class auto-suggest integrations remain deferred page tasks. Archived 2026-05-20 with per-slice status. | `shared/busco_anchors.js` (8 functions + 5 constants incl. `BUSCO_ARCHITECTURE_CLASSES` + `buscoCountInWindow` / `buscoDensityInWindow` / `buscoDepletionVsFlank` + `buscoSyntenyScore` + `suggestArchitectureClass`) + `tests/test_shared_busco_anchors.js` |
| `SPEC_mendelian_inheritance_para_vs_peri_v1.md` | Stage-1 per-family Mendelian goodness-of-fit + Stage-2 cohort 2×2 contingency comparing paracentric vs pericentric segregation distortion frequency. Generic family math in `mendelian_family_test.js`; type-aware contingency in `mendelian_para_vs_peri.js`. All v1 slices ship with page-side consumers. Archived 2026-05-20 — no deferred slices. | `shared/mendelian_family_test.js` (vocabulary + cross expectations + χ² + reliability tier + effect direction + `testFamilyCandidate`) + `shared/mendelian_para_vs_peri.js` (`cohortParaPeriContingency` + `cohortEffectDirectionBreakdown`) + `shared/mendelian_segregation.js` + 5 tests + 3 downstream consumers (`inversion_classification`, `inversion_classification_axes`, `recombination_suppression`) |

### Pending — `specs_todo/`

See `specs_todo/README.md` for the per-SPEC status table.
Highlights:
- 3 SPECs explicitly marked "SPEC ONLY — awaiting audit": `SPEC_copy_origin_painting.md`, `SPEC_regime_annotation_v34.md`, `SPEC_fish_ancestry_scroller.md`
- 1 partial: `SPEC_registry_write_and_page_isolation.md` (page-isolation half shipped, Registry.write half pending — see `specs_done/SPEC_registry_v2.md` for the canonical Registry.write design)
- 1 superseded: `SPEC_registry_v1.md` (superseded by `specs_done/SPEC_registry_v2.md`; kept for historical reference)
- Audit-sweep 2026-05-20 archived 4 atlas-side-complete SPECs into `specs_done/` with per-slice status matrices (arrangement_color_mode, busco_4d_age_brackets, busco_anchors_v1, mendelian_inheritance_para_vs_peri_v1). Their producer/page-integration follow-ups are tracked in the archived SPECs themselves.

### Sub-library — `specs_todo/mgl_adapter/`

- `SPEC_0_master.md` — the master MGL adapter spec
- `README.md`, `README_specs.md` — entry points
- 10 numbered HANDOFFs (1, 2, 3, 4, 5, 6, 7, 8, 9, 10) — completed 2026-05-15 from the `mgl_adapter_v22_dragdrop_fixed` bundle
- The same 5 page-keyed HANDOFFs are duplicated at `specs_todo/pages_{candidate_mode,custom_views,fingerprint_track,similarity_panel,tree_panel}/_to_do/HANDOFF_*.md` (these duplicates are byte-identical to the canonical mgl_adapter copies)

This sub-tree is treated as a single self-contained library — moves
between `specs_todo/` and `specs_done/` would happen as a unit, not
file-by-file.

### Bundle museum — `specs_done/_bundles/`

Verbatim drop-bundle snapshots that preserve **bundle-level meta-docs**
(pipeline diagrams, audit checklists, drag-drop instructions). The
individual SPECs from these bundles were imported into the canonical
locations above; the bundle READMEs / HANDOFFs were not, and would
otherwise be lost. See `specs_done/_bundles/README.md` for the
per-bundle inventory.

Current contents:
- `inversion_atlas_v3.4_DROP/` — 2026-05-08 v3.4 banding-pipeline drop (README + HANDOFF only; code already shipped to `shared/band_tracking/`)
- `banding_unified_v3.4_AUDIT_BUNDLE/` — 2026-05-08 audit-revision of same (README + HANDOFF + SERVER_README)
- `mgl_adapter_v22_dragdrop_fixed/` — full extracted tree (mgl_adapter v22 multi-repo drop)
- `HOW_TO_USE_haplotype_regimes.md` — user guide for page22 (only end-user docs for any page right now)

## SPECs **referenced in shipping code but missing from disk**

**RESOLVED 2026-05-20.** Detail at `_handoff_docs/SPECS_AUDIT.md` (§"STATUS UPDATE 2026-05-20"). Summary:
- The 8 SPECs missing as of the original audit (2026-05-15) were authored from shipped code → `specs_done/SPEC_<name>.md`. See `SPECS_AUDIT.md` for the full status table.
- The 9th — `SPEC_inversion_age_atlas_surface.md` (turn-117 parent of the `_AMENDMENT`) — was authored 2026-05-20 from `shared/mgl_inversion_divergence.js` + `busco_4d_age.js` + `age_model_suggester.js` + `pages/evolution/age_divergence.{html,js}` → `specs_done/SPEC_inversion_age_atlas_surface.md`.
- `SPEC_DEFERRED.md` is **retired** as a target — it was a register of deferred decisions, now expressed inline via per-slice `Status: deferred` annotations on the individual SPECs (see e.g. `SPEC_inversion_age_atlas_surface.md` §3).
- `HANDOFF_BATCH_3.md` / `HANDOFF_BATCH_5.md` references are **retired by design** — phantom handoffs that were never authored; the citations are corrective notes flagging mislabels (canonical record is the on-disk `pages/<stage>/BATCH_*_NOTES.md` files).

## Working-doc folders (NOT specs — handoffs, audits, plans)

| folder | purpose |
|--------|---------|
| `_handoff_docs/` | newer turn-by-turn handoffs + audits + plans (chat 34/35/36/2026-05-12..14) |
| `handoff_docs/` | older Atlas_round166-era handoffs (pre-import) |
| `docs/` | migration tracking + family roadmap + TODO inventories |
| `atlases/inversion/*/README.md` | per-subsystem READMEs (10 of them: analysis/, data/, engines/, etc.) |

These are deliberately distinct from the SPEC folders. A SPEC is a
*design contract*; a handoff is a *narrative of a session*. Don't
collapse them — but do make sure each handoff that introduces a new
SPEC files the SPEC under `specs_todo/`.

## Building the manual from this material

Eventually we'll write a user-facing manual. The plan:

1. **Source of truth = `specs_done/`** + per-page `_doc` fields in
   `atlases/inversion/registries/data/pages.registry.json`
2. **Page chapter** = `ATLAS_PAGES_MAP.md` (per-page narrative)
3. **Layer chapter** = the 26 schemas in `atlases/inversion/registries/schemas/` + a prose `SCHEMA.md` to be written
4. **Pipeline chapter** = stage-by-stage walkthrough from the SPECs in `specs_done/` (band-tracking SPEC has the v3.4 pipeline diagram; we should also recover the `inversion_atlas_v3.4_DROP` README which had the full diagram — currently not in the repo)

When the manual gets written, it cites SPECs by their canonical path
(`specs_done/SPEC_*.md`) — so don't rename or move them after that.
