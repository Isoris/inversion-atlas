# page_evolution_event_tree — event tree — Page Capability Contract

**Atlas**: inversion · **Stage**: evolution · **Status**: active

## Purpose

**Relative-ordering cartridge** across multiple inversion candidates
on the same chromosome. Renders a per-candidate × per-candidate
overlap matrix coloured by relationship: nested / sister /
independent / mutual_exclusive.

Inference axes: carrier-overlap nesting, internal diversity ranking,
outgroup presence, age class chaining.

## Capabilities

- Build and render the n_candidates × n_candidates relationship
  matrix.
- Colour cells by relationship class.

## Input contract

```
atlasState.inversion.event_tree_state = {
  carriers: Uint8Array | number[],  n_samples × n_candidates row-major
  n_samples, n_candidates,
  per_candidate?: Array<{
    id, label?, pi_inv?, dxy?, fst?,
    private_inv?, outgroup_present?, ...
  }>,
  chrom_label?, opts?
}
```

## Required data

- **Slots**: multi-candidate context (reads carrier matrix)

## Outputs

Preview-only.

## Sub-modules

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |

## Connected analyses / adapters

- `shared/mgl_event_tree.js`

## Documents

- **Registry doc**: unknown
- **Specs**: none directly
- **User guide**: unknown

**Confidence**: medium
