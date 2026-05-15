# page_nested_detector — nested detector — Page Capability Contract

**Atlas**: inversion · **Stage**: discovery_2 · **Phase 1 cartridge** · **Status**: active

## Purpose

Nested-inversion detector. Shows 3 horizontal stratum tracks (HOM1
/ HET / HOM2) with one coloured bar per per-stratum inner-band
candidate (bar height = silhouette quality). Highlighted overlays
for contiguous inner intervals. Cartridge implementation of
HANDOFF_7 / SPEC_0 §11.7.

## Capabilities

- Render 3 horizontal stratum tracks (HOM1 / HET / HOM2).
- Per-stratum inner-band candidate bars, height = silhouette quality.
- Highlighted overlays for contiguous inner intervals.
- Verdict badge (NESTED / NOT_NESTED / INSUFFICIENT_DATA) +
  strata-scanned indicator.
- Hover crosshair + right-panel interval summary.
- Click an interval to toggle it in selection.

## Required data

- **Slots**: `activeCandidate`
- **Input contract**: `atlasState.inversion.nested_detector_state = { detector_result: mgl_nested_detector.detectNestedInversion output, candidate_label?, n_windows? }`

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `page_nested_detector/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas painter (3 strata tracks + overlays + verdict) |
| `selection.js` | hover crosshair + click-to-toggle interval |

## Connected analyses / adapters

- `shared/mgl_nested_detector.js` — `detectNestedInversion`

## Documents

- **Specs (todo)**:
  `specs_todo/mgl_adapter/HANDOFF_7_nested_inversion.md`,
  `specs_todo/mgl_adapter/SPEC_0_master.md` §11.7
- **Registry doc**: unknown (not in `pages.registry.json`)
- **User guide**: unknown

**Confidence**: high
