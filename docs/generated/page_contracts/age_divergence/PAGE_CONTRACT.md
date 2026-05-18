# age_divergence — age + divergence — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

**Deep-divergence + age-class cartridge**. Per-candidate age
estimate: dXY between arrangements, private variant density on the
derived class, MRCA depth, segregating-sites summary.

## Capabilities

- Render 4 sparkline-style summary bars: π_inv, π_std, dXY, F_ST.
- Display private / fixed counts.
- Surface the age-class verdict.

## Input contract

```
atlasState.inversion.age_state = {
  dosage, n_markers, n_samples,
  inv_idx, std_idx,
  candidate_label?, opts?
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

- `shared/mgl_inversion_divergence.js` — `computeDivergence`

## Documents

- **Registry doc**: unknown
- **Specs (todo)**: `specs_todo/SPEC_inversion_age_atlas_surface_AMENDMENT.md` (amendment; parent SPEC not on disk)
- **User guide**: unknown

**Confidence**: medium
