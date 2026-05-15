# page3 — catalogue — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue · **Status**: active

## Purpose

Sortable / filterable catalogue of all L2 envelopes (or L1-merged
inversions). Hover any column header for definition. Export selected
rows as TSV or Markdown. Bulk breeding-card export (HTML + JSON) via
the Turn-146 pipeline.

## Capabilities

- Render a sortable / filterable table of L2 envelopes.
- Sortable columns; filter chips.
- Hover column header → definition tooltip.
- Row selection.
- Export selected rows as TSV.
- Export selected rows as Markdown.
- Bulk breeding-card export — HTML bundle per candidate (tier-gated).
- Bulk breeding-card export — JSON bundle.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Outputs

**Preview-only**:
- sortable catalogue view
- filtered view

**Committable**:
- TSV / Markdown row exports
- breeding-card HTML / JSON bundles (Turn-146 pipeline)

Commit policy: manual only.

## Connected analyses / adapters

- `shared/diamond_detection.js` — `diamondCountFor`

## Sub-modules in `page3/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `_breeding_export.js` | Turn-146 bulk breeding-card exports (HTML, JSON; tier-gated; 17 functions + 1 constant table, 1106 LOC) |
| `catalogue.js` | the rendering pipeline legacy never shipped — fresh implementation |

## Status and known issues

- `renderCatalogue` was referenced via typeof guards in legacy but
  never defined. Implementation here is fresh, not a verbatim port.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.page3._doc`
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step3_done.md`,
  `atlases/inversion/pages/catalogue/BATCH_3_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` line 5051+ (typeof-guarded references only)

**Confidence**: high
