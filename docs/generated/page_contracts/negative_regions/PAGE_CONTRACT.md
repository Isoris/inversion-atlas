# negative_regions — negative regions catalogue — Page Capability Contract

**Atlas**: inversion · **Stage**: catalogue (per manifest.json) · **Status**: active (fresh implementation)

## Purpose

Region-level catalogue of "no detectable inversion" calls —
**complement of the catalogue positive catalogue**. Each region carries
a `region_status` field (e.g. `no_detectable_inversion_high_confidence`)
— **NOT** a binary positive/negative. A static caution banner
explicitly warns against that misreading.

## Important caveat

The complement framing is deliberate: "no detectable inversion"
means **no signal above the study's resolution / sample size /
callability limits**. The following are all routinely missed:

- tiny inversions
- very rare inversions (1–2 fish)
- inversions in repetitive or low-callability regions
- inversions whose breakpoints fall outside short-read mappability

This is not a "this is definitely not an inversion" claim. The
banner enforces this framing.

## Capabilities

- Drag-drop or button-load `negative_regions.json` or `.tsv`.
- Render per-`region_status` summary cards.
- Render full per-region detail table.
- CSV export of the catalogue.
- Reset button to clear loaded data.

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Outputs

**Preview-only**:
- per-`region_status` summary cards
- full per-region detail table

**Committable**:
- CSV export

## Sub-modules in `negative_regions/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `negative_regions.js` | fresh implementation; legacy had only the HTML shell |

## Status and known issues

- Directory / stage discrepancy: `manifest.json` says
  `stage: "catalogue"` but file lives under `pages/discovery/`.
- Legacy had no JS implementation; the HTML shell referenced a
  planned `_nrRender` function that never shipped.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.negative_regions._doc`
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step14_done.md`,
  `atlases/inversion/pages/discovery/BATCH_1_NOTES.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7378-7572 (HTML shell ONLY)

**Confidence**: high
