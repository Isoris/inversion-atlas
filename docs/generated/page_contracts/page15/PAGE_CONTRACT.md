# page15 — local PCA GHSL — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery (round 1 — local-PCA scanners)
**Page type**: core_page (stub today — third evidence axis)
**Status**: stub / empty-state (only layer-status chips wired)
**Also known as**: page_ghsl, "GHSL scanner"

## Purpose

Designed as the **third evidence axis** alongside page1 (dosage) and
page12 (θπ). A six-panel chromosome-wide scanner driven by **GHSL
haplotype-pair sequence divergence**. Same orthogonal-validation
rationale: regions hit by all three scrubbers (dosage + θπ + GHSL)
are near-certainly real biology; regions hit by GHSL only are
haplotype-specific divergence invisible to dosage-or-diversity scans.

Currently only the layer-status indicator chips ship — six-panel
renderers are TODO_MISSING.

## Capabilities

**Today**:
- Display 5 `[data-gh-layer]` indicator chips toggling between
  "🟢 loaded" and "⚪ not loaded" based on `state.layersPresent`.
- Mount-time refresh of those chips (via `refreshGhslLayerStatus`).

**Planned** (TODO_MISSING):
- GHSL-driven |Z| panel (`_drawGhslZPanel`)
- GHSL sim_mat heatmap
- GHSL per-sample lines
- GHSL anchor strip
- GHSL PCA scatter
- L3 contingency mirror
- Empty-state ↔ panels visibility toggle (`_refreshGhslPanelVisibility`)

## Required data

- **Layers**: `scrubber_main`
- **Slots**: `activeChrom`

## Optional layers (drive panel visibility once wired)

- `ghsl_panel`
- `ghsl_kstripes`
- `ghsl_karyotype_runs`
- `ghsl_d17_envelopes`
- `cusum_ghsl`

## User interactions

- Layer status chips — visual only.
- (When fully wired: scrubber cursor shared with page1.)

## Outputs

- None yet (six-panel renderers TODO).
- Will be read-only divergence scanner — no committable outputs.

## Connected analyses / adapters

Not yet wired. When implemented, expected to reuse the same
primitives as page12:
- `shared/per_l2_cluster.js`, `hungarian.js`, `contingency.js`,
  `kmeans.js`, `color_helpers.js`.

## Sub-modules in `page15/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter — mirrors page1 / page12 lifecycle pattern |

## Status and known issues

- Six-panel renderers TODO_MISSING (only chip status wired).
- GHSL data layers haven't shipped from the R pipeline yet, so the
  renderers can't be authored against real data.
- Round-5-step-15 status: stub-preserving + one wired entry pattern
  applied; `_refreshGhslLayerStatus` preserved verbatim, public
  `refreshGhslLayerStatus` wrapper added (mirrors confirmed_carousel's
  `refreshConfirmedCarousel` pattern), `mount()` calls the wrapper.

## Documents

- **Registry doc**: `atlases/inversion/registries/data/pages.registry.json` → `pages.page15._doc`
- **Specs**: none directly
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-07_chat36_round5_step10_done.md`
- **User guide**: unknown
- **Legacy source**: `legacy/Inversion_atlas.html` lines 7180-7247 (HTML shell) + 53065-53081 (the one extracted helper)

**Confidence**: high
