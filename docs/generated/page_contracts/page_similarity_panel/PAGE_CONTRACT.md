# page_similarity_panel — similarity matrix — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery_2
**Page type**: core_page (Phase 1 cartridge)
**Status**: active (Phase 1)

## Purpose

Per-window sample × sample similarity heatmap with block detection
and an adjacent-window ARI transition strip on top. Cartridge
implementation of HANDOFF_10 / SPEC_0 §11.9.

## Capabilities

- Render an ARI gap row + transition strip across all windows.
- Scrub a window by clicking a strip cell → loads its similarity
  matrix into the heatmap canvas.
- Render n_samples × n_samples similarity heatmap per window.
- Toggle block-overlay outlines.
- Toggle diagonal hide/show.
- Sample ordering: `natural` | `by_block`.
- Hover crosshair on the heatmap + right-panel detail.
- Click a matrix cell to toggle a sample in the selection set.

## Deferred (not in Phase 1)

- Sample labels on row / column axes (large-n redesign).
- Multi-metric switcher in-panel (pearson / l1 / l2) — metric is
  fixed at load time upstream.
- Cross-panel linkage with tree / fingerprint / PCA.

## Required data

- **Slots**: `activeCandidate`
- **Input contract**:
  `atlasState.inversion.similarity_panel_state = { similarity_results, adjacent_aris, blocks_per_window, n_windows, n_samples, ... }`

## User interactions

- Click strip cell → scrub window.
- Click matrix cell → toggle sample selection.
- Hover cell → crosshair + right-panel detail.
- Toggle: block overlay, diagonal, sample order.

## Outputs

**Preview-only**:
- per-window similarity matrix
- block detection outlines
- adjacent-window ARI transition strip

**Committable**: none.

## Connected analyses / adapters

- `shared/mgl_window_similarity.js` (producer that fills
  `similarity_results`)

## Sub-modules in `page_similarity_panel/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas painter (transition strip + heatmap) |
| `selection.js` | hover crosshair + click-to-toggle sample selection set |

## Status and known issues

- Phase 1 only.
- Not in `pages.registry.json` (only `manifest.json`).

## Documents

- **Registry doc**: unknown
- **Specs (todo)**:
  - `specs_todo/mgl_adapter/HANDOFF_10_atlas_similarity.md` (canonical)
  - `specs_todo/pages_similarity_panel/_to_do/HANDOFF_10_atlas_similarity.md` (duplicate)
  - `specs_todo/mgl_adapter/SPEC_0_master.md` §11.9
- **User guide**: unknown
- **Legacy source**: n/a

**Confidence**: high
