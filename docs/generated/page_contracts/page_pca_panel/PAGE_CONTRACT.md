# page_pca_panel — PCA scatter — Page Capability Contract

**Atlas**: inversion · **Stage**: discovery_2 · **Phase 1 cartridge** · **Status**: active

## Purpose

Per-window PC1 × PC2 scatter with cluster colouring and a
λ-magnitude window scrubber. SPEC_0 §10 Phase 1.

## Capabilities

- Window scrubber strip (colour = λ1 + λ2 magnitude per window).
- Click a strip cell to load that window's PC1 × PC2 scatter.
- Cluster-coloured points (optional).
- Hover crosshair + right-panel detail (λ1, λ2, sample, cluster id,
  hovered coords).
- Click point → toggle sample selection.
- Toolbar: color-by (cluster | none), axis swap, labels.

## Deferred

- 4-view × 2-weighting × 2-anchor matrix browser (SPEC_0 §10 full
  grid). Phase 1 renders whichever variant upstream loaded.
- Sample-label overflow handling for very large n_samples.
- Cross-panel linkage with tree / fingerprint / similarity.

## Required data

- **Slots**: `activeCandidate`
- **Input contract**: `atlasState.inversion.pca_panel_state = { pca_results: Array<PCA result | null>, ... }`

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `page_pca_panel/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas painter (scrubber strip + scatter) |
| `selection.js` | hover + click-to-toggle sample |

## Documents

- **Specs (todo)**: `specs_todo/mgl_adapter/SPEC_0_master.md` §10
- **Registry doc**: unknown (not in `pages.registry.json`)
- **User guide**: unknown

**Confidence**: high
