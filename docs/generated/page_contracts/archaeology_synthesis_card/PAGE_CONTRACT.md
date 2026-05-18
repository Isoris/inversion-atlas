# archaeology_synthesis_card — archaeology card — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

**Step-6 synthesis card** — pulls together polarity, age class,
integrity, mosaicism, frequency, π/dXY/F_ST, private/fixed counts,
and confidence into a single screen. The Step-6 verdict.

Consumes a pre-computed metrics bag (or computes one inline from
the standard inputs) and renders a single verdict + reason +
interpretation + per-metric numeric table.

## Capabilities

- Render the verdict block.
- Render the reason / interpretation prose.
- Render the per-metric numeric table.

## Input contract

```
atlasState.inversion.archaeology_card_state = {
  metrics: {
    pi_inv, pi_std, dxy, fst_hudson,
    private_inv, private_std, fixed_differences,
    arrangement_frequency?, leakage_score?, n_regimes?,
    outgroup_present?, polarity_verdict?, age_class?,
  },
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

- `shared/mgl_archaeology_classifier.js`

## Documents

- **Registry doc**: unknown
- **Specs**: none directly
- **User guide**: unknown

**Confidence**: high
