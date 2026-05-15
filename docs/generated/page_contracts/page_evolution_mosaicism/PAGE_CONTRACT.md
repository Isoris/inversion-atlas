# page_evolution_mosaicism — mosaicism / leakage — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

Per-INV-sample × window **leakage heatmap**. Cells coloured by the
fraction of informative sites where the sample matches
STD-consensus rather than INV-consensus.

Recombinant-tract / polarity-switch detector on INV chromosomes.
Per-sample mosaic call + summary leakage score.

## Capabilities

- Render per-INV-sample × window heatmap.
- Surface per-sample summary leakage score.
- View control: `window_size_markers`.

## Input contract

```
atlasState.inversion.mosaicism_state = {
  dosage, n_markers, n_samples, inv_idx, std_idx,
  candidate_label?, sample_labels?,
  view_state?: { window_size_markers }
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

- `shared/mgl_mosaicism_detector.js`

## Documents

- **Registry doc**: unknown
- **Specs**: none directly
- **User guide**: unknown

**Confidence**: medium
