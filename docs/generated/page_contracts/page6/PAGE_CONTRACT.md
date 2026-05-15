# page6 — popstats — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active (thin loader)

## Purpose

Per-window **popstats track stack** for the active chromosome.
Vertical stack of population-genetic canvas tracks aligned to the
chromosome.

The track inventory:
- |Z| / score
- SNP density
- BEAGLE imputation uncertainty
- depth / coverage
- θπ (per-window Tajima π)
- F_ST (between karyotype groups)
- Hobs / Hexp (observed vs expected heterozygosity)
- ancestry Δ12 (top-1 minus top-2 Q)

## Architecture

page6 is a **thin loader stub**. The renderer
`window.renderPopstatsPage` is defined externally in
`js/atlas_page6_wiring.js`. The page-level `showPopstatsPage(state)`
tries `window.renderPopstatsPage` and falls back to a missing-renderer
empty-state message if absent.

Talks to a popstats **live server** via `POST /api/popstats/*`.

## Capabilities

- Display the popstats track stack.
- Toggle tracks via chip clicks in `#psChips`.
- Show track-discovery sidebar (`#psGalleryTray`).
- Empty state when no chromosome is loaded.

## Required data

- **Registry says**: `candidate_gene_cargo`, `activeCandidate`
  (FLAGGED — appears mismatched; see Known issues)
- **Actually consumed**: per-window popstats metrics keyed on
  `activeChrom` + `group_set_id`

## User interactions

- Chip toggles for track visibility.
- Track-discovery gallery tray (sidebar).

## Outputs

Preview-only — the page renders tracks but commits nothing.

## Sub-modules in `page6/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Connected analyses / adapters

- popstats live server (external) — `POST /api/popstats/*`
- `js/atlas_page6_wiring.js` (external, NOT inlined in legacy)

## Status and known issues

- **REGISTRY MISMATCH (flagged 2026-05-07 step 18)**: the page is
  chromosome-level but `requires_layers` / `requires_slots` declare
  candidate-level values (`candidate_gene_cargo` + `activeCandidate`).
  Should likely be `popstats_tracks` + `activeChrom`. Round-18 was
  migration-only and did not change the registry.
- External renderer absence falls back to an empty-state message.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page6._doc` (flags
  the registry mismatch)
- **Handoffs**: `atlases/inversion/pages/review/BATCH_2_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step18_done.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7647-7658
  (HTML shell) + 59626-59627 / 59729-59730 (dispatch sites). External
  renderer in `js/atlas_page6_wiring.js`.

**Confidence**: high
