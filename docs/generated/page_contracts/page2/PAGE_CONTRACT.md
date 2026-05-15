# page2 — candidate focus — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery_2 (round 2 — supplementary scanners / inspectors)
**Page type**: core_page (per-candidate deep-dive)
**Status**: active

## Purpose

Per-candidate detail deep-dive — multi-panel view of a single
promoted candidate inversion. ~15 sub-panels composed by the
orchestrator into a single innerHTML write in
`renderCandidateMetadata`. Reuses page1's cluster-cache and
per-window dosage_chunks for the candidate's L2 recompute.

This is the page2 in tab order; **NOT** "cohort overview" (an earlier
draft mislabelled it; see HANDOFF_2026-05-07_chat36_round5_step2).

## Capabilities

- Render the full candidate-detail page (`renderCandidateMetadata`).
- Navigate between candidates via prev/next.
- Maintain a candidate-list pane on the left with import / export /
  registry / manuscript-bundle / clear actions.
- Show ~15 sub-panels per candidate:
  - header
  - sigma profile
  - K=6 nesting cluster table
  - FIG_C07 ridgeline (uses `het_band_backbones`)
  - FIG_C08 dosage heatmap (uses `arrangement_calls`)
  - per-band composition
  - ancestry confound (uses `cohort_sample_froh` + `ancestry_global_q`)
  - regime row
  - age origin
  - notes editor
  - …and others composed via the 16 `*Html` builders
- Mark a candidate `confirmed` (drives page9's confirmed carousel).
- Edit candidate notes / regime / age_origin metadata.

## Required data

- **Layers**: `scrubber_main`, `candidate_tracks`,
  `cohort_sample_froh`, `ancestry_global_q`, `het_band_backbones`,
  `arrangement_calls`
- **Slots**: `activeChrom`, `activeCandidate`

## Optional overlays

- The candidate's own metadata blob (notes / age_origin / regime).
- page1's warmed cluster-cache (improves fidelity but page2 will
  recompute on cache miss).

## User interactions

- **Candidate nav**: prev/next buttons (`_navigateToCandidate`).
- **Candidate list pane**: click to select; import/export JSON.
- **Per-band wires**: clickable per-band controls (one of the 7
  `_wireCandidate*` handlers).
- **Drag-drop**: candidate-list JSON, candidate metadata.
- **Notes editor**: editable text fields, persisted via the
  registry write path.

## Outputs

**Preview-only (recomputed on candidate switch)**:
- per-candidate L2 recompute (cluster-cache hit when warm)
- sigma profile per band
- K=6 nesting cluster table
- ridgeline density
- dosage heatmap
- ancestry confound bar

**Committable (manual gesture)**:
- `candidate.confirmed` flag (drives page9)
- candidate metadata updates (notes, regime, age_origin)
- candidate list import / export via JSON

Commit policy: manual only.

## Connected analyses / adapters

Reused from `atlases/inversion/shared/`:
- `page1_utils.js` — `escapeHtml`
- `active_candidate.js` — `persistActiveCandidateId`
- `page1_data_helpers.js` — cluster-cache, per-window dosage_chunks
- `per_l2_cluster.js` — L2 recompute for the candidate

Adapters:
- `core/atlas_api.js` — `resolve()`, `getState()`

## Sub-modules in `page2/`

| file | purpose |
|------|---------|
| `_state.js` | page2's own `_pageState` (separate from page1's) |
| `_html_builders.js` | 16 `candidate*Html` HTML-builder functions composed by `renderCandidateMetadata` into the single innerHTML write |
| `_wires.js` | 7 `wireCandidate*` / `_wireCandidate*` event handlers attached after the innerHTML write |
| `_list.js` | 8 candidate-list management helpers (JSON serialization, position-sorted indexing, the list-pane DOM) |
| `_draw_panels.js` | 7 canvas painters for the analytic panels (local PCA, per-sample lines, etc.) |

The 4 orchestrator entry points (`renderCandidateMetadata`,
`refreshCandidateUI`, `_navigateToCandidate`, `wireCandidateNav`)
live in `page2.js` main because two of them call each other.

## Status and known issues

- **Status**: active, shipped.
- Layer set assumes page1's cluster-cache has been warmed; if page2
  is mounted cold on a chromosome the per-window L2 recompute can be
  slow on the first candidate.

## Documents

- **Registry doc**: `atlases/inversion/registries/data/pages.registry.json` → `pages.page2._doc`
- **Specs**: none directly
- **Handoffs**:
  - `_handoff_docs/HANDOFF_2026-05-06_chat34_page2_plan.md`
  - `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step1_done.md`
  - `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step2_done.md` (the chat-36 round-5 5-module split)
  - `atlases/inversion/pages/discovery/BATCH_1_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` (tab 3 "candidate focus")

**Confidence**: high
