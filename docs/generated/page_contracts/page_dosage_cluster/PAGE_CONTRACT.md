# page_dosage_cluster — dosage cluster — Page Capability Contract

**Atlas**: inversion · **Stage**: discovery_2 · **Phase 1 cartridge** · **Status**: active

## Purpose

Adaptive-K sample clustering on per-window dosage profiles. Shows
per-K scoring table + cluster mean-curve display + verdict badge.
Cartridge implementation of HANDOFF_8 / SPEC_0 §11.8.

## Capabilities

- Render per-cluster mean dosage curves on a single canvas
  (`paintClusterCurves`).
- Verdict badge: `structure_detected` / `no_structure` /
  `insufficient_data` + `K_chosen` badge.
- Per-K table in the right panel: silhouette, stability, min_size,
  spatial_coherence, Δsil, passes — click a row to focus that K's
  curves.
- Cluster-size legend below curves.

## Required data

- **Slots**: `activeCandidate`
- **Input contract**: `atlasState.inversion.dosage_cluster_state = { cluster_result: mgl_dosage_clustering.adaptiveKDosageClustering output, candidate_label? }`

## Outputs

Preview-only. No committable outputs.

## Sub-modules in `page_dosage_cluster/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | `paintClusterCurves` canvas painter |
| `selection.js` | click per-K table row → focus that K |

## Connected analyses / adapters

- `shared/mgl_dosage_clustering.js` — `adaptiveKDosageClustering`

## Documents

- **Specs (todo)**:
  `specs_todo/mgl_adapter/HANDOFF_8_dosage_clustering.md`,
  `specs_todo/mgl_adapter/SPEC_0_master.md` §11.8
- **Registry doc**: unknown (not in `pages.registry.json`)
- **User guide**: unknown

**Confidence**: high
