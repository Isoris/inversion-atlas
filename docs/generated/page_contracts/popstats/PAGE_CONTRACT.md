# popstats — popstats — Page Capability Contract

**Atlas**: inversion · **Stage**: synthesis · **Status**: active (native port)

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

popstats is a **native ES-module port** (2026-05-20). The renderer lives in
`./popstats/_render.js`; `popstats.js` resolves the per-chrom precomp via
`registry.resolve('scrubber_main', { chrom })` and threads it into the
renderer. Sub-modules:

| file        | role                                                |
|-------------|-----------------------------------------------------|
| `_canvas.js`| fitCanvas / themeColor / drawIdeogram / drawLine    |
| `_tracks.js`| STATIC_TRACKS + auto-discover from `data.tracks`    |
| `_view.js`  | chip-toggle persistence (`scrubber_v3_popstats`)    |
| `_render.js`| top-level `renderPopstatsPage({ root, data, ... })` |
| `_live.js`  | `POST /api/popstats/groupwise` + `/hobs_groupwise`  |
| `_state.js` | `_pageState` handle                                 |

`_live.js` is staged for future group-aware overlays; the static paint path
runs entirely off the scrubber_main precomp.

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

## Sub-modules in `popstats/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Connected analyses / adapters

- popstats live server (external) — `POST /api/popstats/*`
- `js/atlas_page6_wiring.js` (external, NOT inlined in legacy)

## Status and known issues

- **REGISTRY MISMATCH (still open, flagged 2026-05-07 step 18)**: the
  page is chromosome-level but `pages.registry.json` still declares
  `requires_layers: ["candidate_gene_cargo"]` + `requires_slots:
  ["activeCandidate"]`. The native port (2026-05-20) consumes
  `scrubber_main` + `activeChrom` directly; the registry entry should
  be updated to match but was deferred to a registry-only round.
- Live-server overlays (FST/dxy/theta_pi via `POST /api/popstats/groupwise`,
  Hobs/Hexp via `POST /api/popstats/hobs_groupwise`) require a
  `groups` slot that is not yet seeded in the new atlas-core state
  shape. `_live.js` is wired and ready; the page paints from the
  precomp's auto-discovered `data.tracks` dict in the meantime.

## Documents

- **Registry doc**: `pages.registry.json` → `pages.popstats._doc` (flags
  the registry mismatch)
- **Handoffs**: `atlases/inversion/pages/review/BATCH_2_NOTES.md`,
  `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step18_done.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7647-7658
  (HTML shell) + 59626-59627 / 59729-59730 (dispatch sites). External
  renderer in `js/atlas_page6_wiring.js`.

**Confidence**: high
