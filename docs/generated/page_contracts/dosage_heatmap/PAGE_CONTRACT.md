# dosage_heatmap — dosage heatmap — Page Capability Contract

**Atlas**: inversion · **Stage**: discovery_2 · **Phase 1 cartridge** · **Status**: active

## Purpose

Sample × marker dosage heatmap with K=3 group annotation track and
polarity stripe. Partner of the PCA panel. Implements SPEC_0 §11
(centering / polarity).

## Capabilities

- Sequential cream → deep red colour ramp (Reds).
- Left side K=3 group annotation track (+ optional K=6).
- Top polarity stripe (one cell per displayed marker; black = flipped).
- Sample ordering: `natural` | `by_group` | `by_k6`.
- Marker ordering: `natural` | `by_polarity`.
- Hover crosshair + right-panel cell summary.
- Click a cell to toggle either the sample **or** the marker in the
  selection set.

## Two input shapes

`adapters.js` normalises:

1. **New SPEC_0 shape** — `mgl_heatmap_result` from
   `shared/mgl_heatmap_json.js`
2. **Legacy candidate-chunk shape** — `{ samples, markers, dosage }`
   plus optional `selected_marker_indices`

Both render identically through the canonical painter.

## Required data

- **Slots**: `activeCandidate`
- **Input contract**: `atlasState.inversion.dosage_heatmap_state = { mgl_heatmap_result? | legacy_chunk?: {samples, markers, dosage}, selected_marker_indices?, ... }`

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `dosage_heatmap/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `adapters.js` | normalises the 2 input shapes |
| `renderer.js` | canvas painter (heatmap + group track + polarity stripe) |
| `selection.js` | hover crosshair + click-to-toggle sample / marker |

## Downstream consumer

- `page_evolution_polarize_msa` feeds stacked-consensus rows into
  this painter as a downstream tinted view.

## Documents

- **Specs (todo)**: `specs_todo/mgl_adapter/SPEC_0_master.md` §11
- **Registry doc**: unknown (not in `pages.registry.json`)
- **User guide**: unknown

**Confidence**: high
