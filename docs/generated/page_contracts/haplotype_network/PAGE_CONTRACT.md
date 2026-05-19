# haplotype_network — haplotype network — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active (Phase 1 cartridge)

## Purpose

**INV haplotype-network** cartridge. Minimum-spanning network of
INV chromosomes. Nodes are Hamming-radius clusters (sized by
chromosome count, coloured by 2D-SFS subgroup); edges are pairwise
mutational distance. Force-directed layout with a Mulberry32 PRNG.

## Capabilities

- Cluster INV chromosomes by Hamming radius.
- Compute pairwise mutational distance between cluster
  representatives.
- Lay out and paint a minimum-spanning network.
- Hover / click node selection.
- View controls: `hamming_radius`, `layout_seed`, `show_labels`.

## Input contract

```
atlasState.inversion.haplotype_network_state = {
  dosage:           Float64Array | Array<Float64Array | number[]>,
  n_markers, n_samples,
  inv_idx:          number[],
  sample_labels?:   string[],
  candidate_label?: string,
  view_state?:      { hamming_radius?, layout_seed?, show_labels? },
}
```

## Required data

- **Slots**: `activeCandidate`

## Outputs

Preview-only.

## Sub-modules

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas painter; force-directed via Mulberry32 PRNG |
| `selection.js` | `createHapNetSelection` — hovered node + selected set |

## Connected analyses / adapters

- `shared/mgl_haplotype_network.js`

## Documents

- **Registry doc**: unknown (not in `pages.registry.json`)
- **User guide**: unknown

**Confidence**: high
