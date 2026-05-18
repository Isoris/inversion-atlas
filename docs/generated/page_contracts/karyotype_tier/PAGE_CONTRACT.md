# karyotype_tier — karyotype / tier — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active

## Purpose

Karyotype/Tier candidate-level review page. Two sub-views toggleable
via `#candKaryoSubviewBar`:

1. **Karyotype** — per-sample regime breakdown. Each row is one fish
   showing its locked K=3 label (HOMO_1 / HET / HOMO_2 in the
   operational H-system, ordered by median PC1). Two-track candidates
   get track-membership pills per `active_band`.
2. **Tier** — 14-axis classification view (empty-state until the
   cluster-side R pipeline ships `final_classification.json`).

## Capabilities

- Render the candidate-list pane on the left (`#candListPane`) with
  import / export / registry / manuscript-bundle / clear actions.
- Toggle between Karyotype and Tier sub-views.
- **Karyotype tab**:
  - Per-sample rows with K=3 locked label
  - Sortable / filterable / band-filterable
  - Two-track candidates: per-`active_band` membership pills
  - K=3..K=6 label vocab choice persisted in localStorage
- **Tier tab**:
  - 14-axis classification grid (empty-state until layer ships)
  - Layer-status indicator (`#candTierLayerStatus`)

## Required data

- **Slots**: `activeCandidate`
- **Actually consumed**: `state.data.final_classification` +
  `state.data.classification` + the candidate's own
  completion/characterization blocks
- **Registry says (but appears mismatched)**: `candidate_sv_counts`,
  `candidate_boundaries` (see Known issues)

## User interactions

- Sub-view toggle: Karyotype / Tier
- Sort / filter rows
- Band filter (two-track candidates)
- Candidate-list import / export
- Manuscript bundle export
- Registry button
- Clear button

## Outputs

**Preview-only**:
- per-sample karyotype rows
- two-track membership pills
- 14-axis tier classification grid (when layer present)

**Committable**:
- candidate list JSON import / export
- manuscript bundle export
- karyotype label vocab choice (localStorage)

Commit policy: manual only.

## Sub-modules in `karyotype_tier/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter + `karyoState` page-local UI state |
| `karyo_body.js` | karyotype body renderer + toolbar wiring |
| `karyo_labels.js` | K=3..K=6 label vocab (HOMO_1 / HET / HOMO_2 etc.) — localStorage persisted |
| `karyo_rows.js` | per-sample row builder + sort/filter pure helpers |
| `tier_axes.js` | 14-axis tier classification schema + color palette + grid renderer (pure HTML builder) |

## Connected analyses / adapters

- `shared/page1_data_helpers.js` — `groupColor`

## Status and known issues

- **REGISTRY MISMATCH (flagged 2026-05-07 step 21)**:
  `requires_layers` declared as `candidate_sv_counts` +
  `candidate_boundaries` but the page actually consumes
  `state.data.final_classification` + `state.data.classification`.
  May be **swapped** with boundary_refinement's declared `candidate_final_class` +
  `candidate_breeding_card`. Round-21 did not change the registry per
  architectural-discipline rule (deferred to renumbering round).
- **TODO_MISSING helpers**: `_renderCandidateKaryotypeBody`,
  `_renderTierAxesGrid` — mount-time render is wrapped in try/catch
  because the populated path hits these.
- **SCHEMA_V2.md §19** cross-referenced but the prose SCHEMA doc
  does not exist on disk.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.karyotype_tier._doc` (long,
  flags 4 known registry mismatches)
- **Schema doc referenced but missing**: SCHEMA_V2.md §19
- **Handoffs**: `atlases/inversion/pages/review/BATCH_2_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step21_done.md`
  (the first review-stage migration; AST-shim methodology)
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7573-7645
  (HTML shell) + 62800-62836 + 63091-63289 + 63411-63492 + 62840-62861

**Confidence**: high
