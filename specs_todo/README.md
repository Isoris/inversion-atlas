# `specs_todo/` — pending specifications

**Purpose**: SPECs that have been authored but whose described system
has not fully shipped. The "design backlog".

## Workflow

```
write SPEC here  →  implement  →  move file to specs_done/
                                  (update Status line + add
                                   Implemented in: pointer)
```

**Critical rule** (see `specs_done/README.md`): **never delete a SPEC**.
When the system ships, move the file to `specs_done/`. That's the
single source of truth for what the system was designed to do, and
the seed material for the manual.

## Current contents (audited 2026-05-15)

Each row shows the **shipped half** (atlas-side JS already in
`shared/` or `analysis/`) vs the **pending half** (producer pipeline
NOT yet built, OR page integration NOT yet wired).

A SPEC stays here as long as ANY required half is pending. Once
fully shipped: move to `specs_done/` with an `Implemented in:` block.

| SPEC | shipped half | pending half | net status |
|------|--------------|--------------|-----------|
| ~~`SPEC_arrangement_color_mode_and_arrangement_calls_v1.md`~~ | atlas-side: `shared/arrangement_calls.js` (decoder, palette, per-sample voting, JSON validator); `shared/sample_color.js` arrangement mode dispatcher | producer (`arrangement_calls_v1.json` emitter) — tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; atlas-side surface complete |
| ~~`SPEC_busco_4d_age_brackets.md`~~ | atlas-side: `shared/busco_4d_age.js` (3 frozen μ values, dxy→age_my, block builder, JSON validator, formatters) | LANTA producer (`STEP_C01f_e_emit_busco_4d_age.py`) + Row-C UI consumer — both tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; atlas-side compute surface complete |
| ~~`SPEC_busco_anchors_v1.md`~~ | atlas-side: `shared/busco_anchors.js` (validator, indexing, density / depletion / synteny / architecture-class helpers) | page-16 ribbon-plot ticks + page-14 architecture-class auto-suggest integrations — tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; atlas-side compute surface complete |
| `SPEC_copy_origin_painting.md` | none | full implementation — explicitly SPEC ONLY per its own status line ("awaiting audit before implementation"). Stage 5.6 of the v3.4 pipeline. | **SPEC ONLY** |
| ~~`SPEC_fish_ancestry_scroller.md`~~ | atlas-side full: page + 4-module subdir + `shared/ancestry_alignment.js` (10 exports) + `shared/ancestry_bricks.js` (6+ exports) + manifest.json + pages.registry.json + 4 tests | cluster-side `instant_q` (Engine B) producer — out of atlas scope | **ARCHIVED 2026-05-20** — moved to `specs_done/`; manifest IS registered (older "unregistered" status was stale) |
| ~~`SPEC_functional_burden_per_candidate_v1.md`~~ | compute layer full: `shared/functional_burden.js` (15 exports incl. version stamp `functional_burden_per_candidate_v1.0`) + `shared/wilcoxon.js` + `shared/sigma_profile.js` + `shared/inheritance_compute.js` + 3 tests + 7 `derive_from:` references on `stats_profile.js` | per-candidate overlay panel UI + cluster-side producer JSON schema — both tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; compute surface complete |
| `SPEC_inversion_age_atlas_surface_AMENDMENT.md` | parent SPEC authored 2026-05-20 at `specs_done/SPEC_inversion_age_atlas_surface.md` (per-candidate four-bar age_divergence surface + compute primitives ship); various age-class JS pieces ship (`shared/age_model_suggester.js`, `shared/busco_4d_age.js`, `shared/mgl_inversion_divergence.js`) | the AMENDMENT's prescribed row layout (Page-3 Rows A/B/C/D + Page-5 "rel age" column + JSON loaders for `inversion_age_v1.json` / `region_popstats_v1.json`) — most slices still deferred (see parent SPEC §3 for per-slice status) | **AMENDMENT — most slices deferred** |
| ~~`SPEC_inversion_divergence_network_v1.md`~~ (archived earlier) | atlas-side compute + render-hints ship at `shared/divergence_network.js` with 412-line smoke | per-candidate overlay panel wiring; cluster-side dxy-by-arrangement producer | **ARCHIVED 2026-05-20** — moved to `specs_done/`; pure-data layer complete (§6 explicit scope) |
| ~~`SPEC_local_pca_comparator.md`~~ | Phase 1 (side-by-side) + Phase 2 (per-sample trajectory + concordance score) ship at `pca_comparator.{html,js}` + `pca_comparator/{_state,renderer,heatmap}.js`; 1 test; page contract docs ship | Phase 3 (Procrustes overlay) deferred-by-design per SPEC's own gating rule | **ARCHIVED 2026-05-20** — moved to `specs_done/`; Phases 1+2 complete |
| ~~`SPEC_cross_atlas_group_transfer.md`~~ | Phase 1 selection-mode primitives (`U` key + Shift+drag → `state.selectionGroup`) ship with 4 page-side consumers | Phase 2 CTRL lateral bar + cross-atlas transfer — deferred-by-design (gated on atlas-family infrastructure that doesn't exist yet) | **ARCHIVED 2026-05-20** — moved to `specs_done/`; Phase 1 complete |
| ~~`SPEC_macrostripe_microgroup_hierarchy.md`~~ | three-level label scheme ships first-class: `shared/macrostripe.js` (4 exports) + `lineage_clustering.js` (5 exports + 4 constants) + `karyotype_lineage.js` (persistence); 7 page-side consumers; 4 tests | co-travel badge polish + cohort-wide TSV export (companion `SPEC_haplotype_burden_coloring` Phase 2) — both tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; the SPEC's "Not yet implemented" status was stale by the time the audit ran |
| ~~`SPEC_cramers_v_seed_merge.md`~~ | both operating modes ship in `shared/cramers_v_merge.js` (`runCramersVMergeLocal` + `runCramersVMergeMacrostripe` + `computeAdjacentSeedMerges` + `chainsFromMergeVerdicts` + defaults); side-by-side comparison view ships in `haplotype_regimes.{html,js}` | dedicated unit test deferred (page-level smoke covers integration) | **ARCHIVED 2026-05-20** — moved to `specs_done/`; the SPEC's "Not implemented" status was stale by the time the audit ran |
| ~~`SPEC_haplotype_burden_coloring.md`~~ | Phase 1 deliverable #3 (per-sample group-label TSV with microgroup_id + macrostripe_id) shipped 2026-05-20 with explicit dated inline citation in `candidate_focus.js` line 367 + `_html_builders.js` line 157; companion `macrostripe.js` supplies the label vocabulary | Phase 1 deliverables #1/#2 (schema validators + dedicated burden-color mode), all Phase 2 (per-candidate burden-join TSV + cohort-wide group export) + Phase 3 deliverables — deferred per SPEC's own staging | **ARCHIVED 2026-05-20** — moved to `specs_done/`; Phase 1 ship anchored by inline code citation; later phases tracked in archived SPEC |
| ~~`SPEC_mendelian_inheritance_para_vs_peri_v1.md`~~ | full v1: `shared/mendelian_family_test.js` (Stage-1 per-family) + `shared/mendelian_para_vs_peri.js` (Stage-2 cohort 2×2) + `shared/mendelian_segregation.js` + 3 downstream consumers + 5 tests | none — all v1 slices ship | **ARCHIVED 2026-05-20** — moved to `specs_done/`; no deferred slices |
| `SPEC_msmc_per_founder_background.md` | none — depends on `pca_comparator/heatmap.js`'s per-(sample × window) band labels (shipped) for the regime-sharing matrix input | full implementation — explicitly SPEC ONLY per its own status line ("awaiting audit before implementation"). New page `founder_background_panel` + 7 producer JSON schemas + neutral-region mask + MSMC2 + diversity-validation runs (cluster-side). | **SPEC ONLY** |
| ~~`SPEC_page1_candidate_mode_ui.md`~~ | default-mode atlas-side full: `shared/candidate_mode.js` (9 exports — Parallel Candidate Registry) + `shared/mgl_candidate_mode.js` (9 exports) + 6 page-side consumers in `local_pca_dosage/` + 3 tests | HANDOFF-1 cluster producer (16 PCA + 4 heatmap JSONs per candidate) + detailed-mode UI — both tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; default-mode infrastructure complete with 6 consumers |
| `SPEC_regime_annotation_v34.md` | none | full annotation layer (Stage 5.5) — explicitly SPEC ONLY per its own status line ("awaiting audit before implementation") | **SPEC ONLY** |
| `SPEC_registry_v1.md` | n/a — superseded | use `specs_done/SPEC_registry_v2.md` | **SUPERSEDED** |
| ~~`SPEC_registry_write_and_page_isolation.md`~~ | page-isolation discipline (zero cross-page imports as of commit `4e695f7`; re-grep-confirmed 2026-05-20) | none — the SPEC is companion-not-parallel to `SPEC_registry_v2.md` which already lives in `specs_done/`; both halves accounted for | **ARCHIVED 2026-05-20** — moved to `specs_done/`; mis-categorised as HALF SHIPPED previously |
| ~~`SPEC_xpehh_per_window_track.md`~~ | `shared/xpehh_per_window.js` (15 exports — schema validator, state I/O, query helpers, outliers, track-header, alignment check) + 1 test + downstream `inversion_classification_axes.js` (XPEHH_SELECTION_SIGNAL axis) | page-8 popstats / ancestry track UI + cluster-side producer — both tracked in the archived SPEC | **ARCHIVED 2026-05-20** — moved to `specs_done/`; compute surface complete with real consumer |
| `mgl_adapter/` | self-contained spec sub-tree (SPEC_0_master + 10 numbered HANDOFFs + 2 READMEs); per-page consumer pages all ship (HANDOFF_5 → tree_panel, HANDOFF_6 → fingerprint_track, etc. — see page contracts) | full cluster-side producer pipeline + atlas-core promotion | **PARTIAL — library complete, integration in flight** |
| `SPEC_catalogue_gallery_exports.md` | none | full implementation — 3 dead toolbar buttons (`catExportGallerySVG/PNG/PDF` in `catalogue.html`); SPEC authored 2026-05-21 from dead-button audit Group 3. Reuses `manuscript_bundle.js` candidate-filter pattern. v1 ships Option A summary cards; v1.1 adds sigma chart; v2 adds mini-PCA. | **SPEC ONLY** |
| `SPEC_catalogue_regime_registry.md` | partial — data layer exists (`shared/regimes_registry.js` + `regime_topology.js`); annotation Layers 1+2 archived as `SPEC_regime_annotation_v34.md`. Pure-compute infrastructure complete. | catalogue-side modal editor + bulk-assign flow — 2 dead toolbar buttons (`catRegimeRegistry`, `catRegimeAssignSel`). SPEC authored 2026-05-21 from dead-button audit Group 3. | **PARTIAL** |
| `SPEC_catalogue_view_modes.md` | none | 2 dead view-mode buttons (`catViewL1`, `catViewL3` in `catalogue.html`); SPEC authored 2026-05-21 from dead-button audit Group 3. L1 = concord-merged chains; L3 = per-band rows. Reuses existing per-L2 cluster cache + concord helpers. | **SPEC ONLY** |

### Net audit summary

- **5 SPEC ONLY** (explicit in their status lines): `SPEC_copy_origin_painting`, `SPEC_regime_annotation_v34`, `SPEC_msmc_per_founder_background`, `SPEC_catalogue_gallery_exports`, `SPEC_catalogue_view_modes`
- **1 PARTIAL** (data layer ships, UI surface needed): `SPEC_catalogue_regime_registry`
- **1 AMENDMENT to a parent at `specs_done/`** (`SPEC_inversion_age_atlas_surface_AMENDMENT`) — most prescribed slices still deferred per the parent SPEC's §3 status matrix; AMENDMENT stays in `specs_todo/` until those slices land
- **1 SUPERSEDED** (`SPEC_registry_v1`)
- **1 self-contained sub-library** (`mgl_adapter/`) — moves between todo/done as a unit
- **14 ARCHIVED 2026-05-20 to `specs_done/`** (atlas-side surface complete, producer / page-integration follow-ups tracked inside the archived SPECs; bodies preserved verbatim per the "don't delete the SPEC, archive it" rule):
  - Morning round (4): `SPEC_arrangement_color_mode_and_arrangement_calls_v1`, `SPEC_busco_4d_age_brackets`, `SPEC_busco_anchors_v1`, `SPEC_mendelian_inheritance_para_vs_peri_v1`
  - Afternoon round 1 (5): `SPEC_fish_ancestry_scroller`, `SPEC_functional_burden_per_candidate_v1`, `SPEC_page1_candidate_mode_ui`, `SPEC_xpehh_per_window_track`, `SPEC_registry_write_and_page_isolation`
  - Afternoon round 2 (5): `SPEC_local_pca_comparator`, `SPEC_cross_atlas_group_transfer`, `SPEC_macrostripe_microgroup_hierarchy`, `SPEC_cramers_v_seed_merge`, `SPEC_haplotype_burden_coloring`

### Decision when a SPEC reaches "fully shipped"

When both halves ship for a PARTIAL SPEC:
1. Move the file from `specs_todo/` to `specs_done/`.
2. Replace its top status block with:
   ```
   **Status**: SHIPPED — was PARTIAL until <commit-sha> / <date>.
   **Implemented in**: <list of file paths>
   ```
3. Update both `specs_todo/README.md` (this file) and
   `specs_done/README.md` to move the row.
4. Audit any cross-references (in code comments, in other SPECs)
   and update paths if needed.

## Cross-references

- **Completed specs**: `specs_done/`
- **Master index**: `SPECS.md` at repo root
- **Missing SPEC names** (referenced in code but not on disk anywhere): see the *referenced but missing* table in `_handoff_docs/SPECS_AUDIT.md`
