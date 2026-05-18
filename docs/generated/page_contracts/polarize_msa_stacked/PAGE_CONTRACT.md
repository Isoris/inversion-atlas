# polarize_msa_stacked — polarize · MSA — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active (Phase 1 cartridge)

## Purpose

**Stacked-consensus MSA viewer** for inversion polarization. First
cartridge of the evolution stage. Reuses the dosage-heatmap painter —
each "sample" is one consensus row:

1. Outgroup
2. INV founder-like
3. INV subgroups (from 2D-SFS doubleton clustering)
4. STD consensus

Plus a **tier-confidence stripe** across the top showing per-site
confidence + reason tier.

## Capabilities

- Build the consensus-row stack (`builder.js`).
- Feed it to the dosage-heatmap painter (`renderer.js`).
- Paint a tier-confidence stripe across the top.
- Hover-cell crosshair: `{row, col, marker_idx, sample_idx}` where
  `sample_idx` is the row-stack position (0 = outgroup, 1 = INV
  founder-like, ...).

## Input contract

```
atlasState.inversion.polarize_msa_state = {
  dosage:           Float64Array (row-major) | Array<Float64Array>,
  n_markers, n_samples,
  inv_idx:          number[]   INV-class sample indices
  std_idx?:         number[]   STD-class sample indices
  outgroup_idx?:    number[]   outgroup sample indices
  marker_labels?:   string[],
}
```

## Required data

- **Slots**: `activeCandidate`

## Outputs

Preview-only — no committable outputs.

## Sub-modules

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `builder.js` | build the consensus-row stack |
| `renderer.js` | thin adapter feeding row-stack into dosage-heatmap painter + tier stripe |
| `selection.js` | hover store |

## Connected analyses / adapters

- `shared/mgl_founder_consensus.js`
- `shared/mgl_doubleton_sfs_clusters.js`
- **dosage_heatmap painter** (reused as downstream renderer)

## Documents

- **Registry doc**: unknown (not in `pages.registry.json`)
- **Specs**: unknown — no top-level SPEC file for this cartridge
- **User guide**: unknown

**Confidence**: high
