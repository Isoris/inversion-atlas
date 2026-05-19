# ancestry_per_window — ancestry — Page Capability Contract

**Atlas**: inversion · **Stage**: classification · **Status**: active (thin loader)

## Purpose

Per-window **ancestry view** for the active chromosome. Reuses the
popstats stack architecture — canvas sections gated by chip toggles.

Three view chips:
- **K-cluster label** — per-window argmax-Q assignment
- **Q-value heatmap** — top-1 ancestry component intensity
- **Δ12** — top-1 minus top-2 Q (confidence)

Driven by a `<chrom>_phase4_ancestry.json` layer that the user
drag-drops into the page.

## Architecture

ancestry_per_window is a **thin loader stub**, sibling of popstats. The renderer
`window.renderAncestryPage` is defined externally (sibling of
`js/atlas_page6_wiring.js`). The page-level `showAncestryPage(state)`
tries that renderer and falls back to a missing-renderer empty state.

## Capabilities

- Toggle K-cluster label / Q-value heatmap / Δ12 chips.
- Render sample × window heatmaps per active chip.
- Empty state prompts user to load precomp + ancestry layer.
- Drag-drop `<chrom>_phase4_ancestry.json` to load.

## Required data

- **Registry says**: `candidate_marker_primers`, `activeCandidate`
  (FLAGGED — appears mismatched)
- **Actually consumed**: `<chrom>_phase4_ancestry.json` + `activeChrom`

## Outputs

Preview-only — no committable outputs.

## Sub-modules in `ancestry_per_window/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Status and known issues

- **REGISTRY MISMATCH (flagged 2026-05-07 step 17)**: page is
  chromosome-level but registry declares candidate-level values.
  Should be `ancestry_phase4` + `activeChrom`. Step 17 was
  migration-only and did not change the registry.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.ancestry_per_window._doc` (flags
  the mismatch)
- **Handoffs**: `atlases/inversion/pages/review/BATCH_2_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step17_done.md`
  (the FIRST review-stage migration)
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7660-7670
  (HTML shell) + 59629-59630 / 59732-59733 (dispatch sites)

**Confidence**: high
