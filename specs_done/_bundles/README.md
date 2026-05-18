# `specs_done/_bundles/` — verbatim drop museum

**Purpose**: each subfolder is a verbatim snapshot of a "drop bundle"
that was delivered to the project at some point in 2026-05. These
bundles contain the **bundle-level meta-docs** (pipeline diagrams,
audit checklists, drag-drop instructions) that explain how a set of
SPECs and modules fit together as a whole.

The individual SPECs from these bundles were imported into
`specs_todo/` / `specs_done/` and the code was imported into
`atlases/inversion/shared/` etc., but the bundle-level READMEs were
NOT carried over during import. That's the gap this museum fills.

**Do not edit** the files here — they are immutable snapshots,
historical record. If a bundle's content needs updating, file a new
SPEC against `specs_todo/`.

## Inventory

| bundle | date | what it shipped | key meta-docs preserved here |
|--------|------|-----------------|------------------------------|
| `inversion_atlas_v3.4_DROP/` | 2026-05-08 | v3.4 banding pipeline (Stage 1-4) + page22 (regimes) + dosage overlay | `README.md` (27 KB pipeline diagram), `HANDOFF.md` (37 KB audit checklist) |
| `banding_unified_v3.4_AUDIT_BUNDLE/` | 2026-05-08 (audit revision) | same code as the v3.4 DROP plus reference/ (lines_panel, pca_panel from legacy, lazy_windows_json, dosage_bridge) + plots/ | `README.md`, `HANDOFF.md`, `reference_SERVER_README.md` |
| `mgl_adapter_v22_dragdrop_fixed/` | 2026-05 | mgl_adapter library v22 (10 numbered HANDOFFs + SPEC_0_master + the implemented Beagle adapter in R/.sh) | full extracted tree — `README_DRAG_DROP.md`, `Specs_WIP_modules/mgl_adapter/specs/` (all 11 spec files), `catfish-population-analysis/MODULE_X_mgl_adapter/` (Beagle adapter scripts + `_STATUS.md`), `inversion-atlas/pages_*/_to_do/` markers |
| `HOW_TO_USE_page22.md` | (standalone) | user guide for page22 (haplotype regimes) — first end-user docs for any atlas page | — |
| `HOW_TO_USE_page1.md` | (standalone, authored 2026-05-15) | user guide for page1 (local PCA \|Z\| — the big page); walks the basic discovery workflow, 11 hotkeys, 10 color modes, L3 panel sub-views, L2-sweep, fish-set linkage, candidate band highlights, session restore, cross-page hand-offs, 5 common gotchas | — |
| `HOW_TO_USE_page2.md` | (standalone, authored 2026-05-15) | user guide for page2 (candidate focus deep-dive); ~15 sub-panels, candidate-list management, confirm/unconfirm flow, FIG_C07 ridgeline + FIG_C08 dosage heatmap, cross-page hand-offs, 5 common gotchas | — |
| `HOW_TO_USE_page4.md` | (standalone, authored 2026-05-15) | user guide for page4 (karyotype / tier — first review-stage page); 2 subviews (Karyotype rows + 14-axis Tier grid), K=3..K=6 label vocab + persistence, full 14-axis schema with all 6 sections + per-axis category enums, registry mismatch flagged (swap hypothesis with page11), 5 common gotchas | — |
| `HOW_TO_USE_page11.md` | (standalone, authored 2026-05-15) | user guide for page11 (boundaries); 9 scan radii table with verbatim button tooltips + bp values, status select 3 values, 11-track weighted score (full BOUNDARY_TRACK_WEIGHTS + POLARITY table), 5 hotkeys with guard rules, full BOUNDARY_DEFAULTS table, 12 public-entry functions from boundaries_ui.js, 5 common gotchas including the auto-only-sets-boundary_zone_only discipline. ALL FACTS VERIFIED against shipped code (page11.js lines 193-337 + boundaries.js lines 17-65 + boundaries_ui.js header). Registry mismatch with page4 noted but NOT auto-fixed. | — |
| `HOW_TO_USE_page_sv_evidence.md` | (standalone, authored 2026-05-15) | user guide for sv_evidence (SV evidence); thin-loader architecture (`window.AtlasSVEvidence` object with init/loadCandidate/destroy), exact fallback message when external module missing, lifecycle table with `__pageInitDone` + `__lastCid` double-guard, per-candidate JSON file location + schema highlights, all 6 pattern labels with rule summaries (full rules in SPEC §3.3), producer CLI example, 5 common gotchas, cross-refs to SPEC_sv_evidence_page.md. ALL FACTS VERIFIED against shipped code (sv_evidence.js lines 32-48, 120-191 + sv_evidence.html DOM ids + SPEC §3.3-3.4). | — |

## How this relates to the canonical locations

| canonical home | what's there | bundle source |
|----------------|--------------|---------------|
| `shared/band_tracking/` (32 modules) | the v3.4 pipeline code | `inversion_atlas_v3.4_DROP/*.js` + `banding_unified_v3.4_AUDIT_BUNDLE/*.js` |
| `pages/discovery/page22/` | regimes_panel, regimes_pc1_panel, regimes_page | same bundles |
| `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md` | the master SPEC | extracted/promoted before these bundles |
| `specs_todo/SPEC_regime_annotation_v34.md` | v3.4 annotation spec (Stage 5.5) | `inversion_atlas_v3.4_DROP/REGIME_ANNOTATION_SPEC.md` → renamed |
| `specs_todo/SPEC_fish_ancestry_scroller.md` | ancestry scroller spec (Stage 5.7) | `inversion_atlas_v3.4_DROP/FISH_ANCESTRY_SCROLLER_SPEC.md` → renamed |
| `specs_todo/SPEC_copy_origin_painting.md` | copy-origin painting spec (Stage 5.6) | `inversion_atlas_v3.4_DROP/COPY_ORIGIN_PAINTING_SPEC.md` → renamed |
| `specs_todo/mgl_adapter/` | full numbered mgl_adapter library (1-10 + SPEC_0_master) | `mgl_adapter_v22_dragdrop_fixed/Specs_WIP_modules/mgl_adapter/specs/` |
| `specs_todo/pages_*/_to_do/HANDOFF_N_*.md` | duplicates of 5 mgl_adapter HANDOFFs (2/4/5/6/10) keyed by page | `mgl_adapter_v22_dragdrop_fixed/inversion-atlas/pages_*/_to_do/` |
| `data/cohort/` cluster-side adapter | (NOT in this repo) — the `MODULE_X_mgl_adapter/` Beagle adapter belongs to the cluster-side `catfish-population-analysis` repo | `mgl_adapter_v22_dragdrop_fixed/catfish-population-analysis/MODULE_X_mgl_adapter/` |

## Why save the cluster-side files here

The `mgl_adapter_v22_dragdrop_fixed` bundle was a multi-repo drop —
its `catfish-population-analysis/MODULE_X_mgl_adapter/` folder
contains R + shell scripts that belong in the cluster-side data-prep
repo, NOT in this atlas repo. They're preserved here because:

1. The drop was delivered as a single bundle and we want the bundle
   intact for the historical record.
2. The atlas reads the output of those scripts (per-pair PCA matrices,
   Beagle GLs); knowing the producer-side contract is useful when
   debugging the data shape.
3. If the cluster-side repo also loses its history, this is the
   backup.

These scripts MUST NOT be run from this repo — they assume a SLURM
cluster environment and the `catfish-population-analysis` repo's data
layout. They live here as documentation, not as executable code.
