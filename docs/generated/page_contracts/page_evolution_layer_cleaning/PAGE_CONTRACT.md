# page_evolution_layer_cleaning — layer cleaning — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

**Per-sample weighting cartridge for Layer 0/1 cleaning**. Renders
a per-sample bar showing final weight ∈ [0, 1]. Kinship +
family-size downweighting + hatchery-duplicate exclusion so close
relatives don't double-count in deep-Layer-2 stats.

## Weight classes

| range | class |
|-------|-------|
| `w ≈ 1` | clean |
| `0 < w < 1` | downweighted |
| `w = 0` | excluded |

## Capabilities

- Compute final weight per sample from kinship + family_ids +
  hatchery_dup.
- Render a per-sample bar coloured by weight class.

## Input contract

```
atlasState.inversion.layer_cleaning_state = {
  n_samples,
  kinship?:      Float64Array  (n × n)
  family_ids?:   Array<*>      length n
  hatchery_dup?: boolean[]     length n
  sample_labels?: string[]
  candidate_label?: string,
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

## Connected analyses / adapters

- `shared/mgl_kinship_downweight.js`

## Documents

- **Registry doc**: unknown
- **Specs**: none directly
- **User guide**: unknown

**Confidence**: high
