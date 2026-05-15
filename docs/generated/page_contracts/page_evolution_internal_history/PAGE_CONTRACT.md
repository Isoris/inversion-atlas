# page_evolution_internal_history — internal history — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

**Sub-PCA on derived-only samples**. Looks for haplotype clusters /
nested rearrangements / sublineages inside the INV class.

Exports:
- `refreshInternalHistory(state)` → calls `_renderHeader`,
  `_paintCanvas`, `_renderMetrics` on `_pageState`.

## Capabilities

- Compute PCA on INV-only samples for the active candidate's window.
- Paint the scatter; surface sublineage cluster structure.
- Show header + metrics block alongside the canvas.

## Required data

- **Slots**: `activeCandidate`

## Outputs

Preview-only.

## Sub-modules

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Connected analyses / adapters

- `shared/mgl_pca_compute.js` — `pcaForWindow`

## Documents

- **Registry doc**: unknown
- **Specs**: none directly
- **User guide**: unknown

**Confidence**: medium
