# polarize_synteny_vote — polarize · synteny — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active (lightweight cartridge)

## Purpose

**Outgroup-synteny polarization**. Light-weight: consumes
pre-computed per-species breakpoint-orientation votes (HOM_A /
HOM_B / unresolved). Renders a horizontal stacked bar + per-species
table, aggregated to an **arrangement verdict**.

## Capabilities

- Render horizontal stacked bar: A / B / unresolved fractions.
- Render per-species table: species, vote, confidence, notes.
- Surface the aggregated arrangement verdict.

## Input contract

```
atlasState.inversion.polarize_synteny_state = {
  votes: Array<{species, vote, confidence?, notes?}>,
  candidate_label?: string,
  opts?: { min_resolved_votes?, polarization_margin? },
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

- `shared/mgl_outgroup_synteny.js`

## Documents

- **Registry doc**: unknown
- **User guide**: unknown

**Confidence**: medium (only `_state.js` in subdir; renderers
inlined in entry — not deeply verified)
