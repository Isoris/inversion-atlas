# tree_panel — tree panel — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery_2
**Page type**: core_page (Phase 1 cartridge)
**Status**: active (Phase 1)

## Purpose

Inversion-core **sample tree** — Neighbour-Joining on dosage
distances computed in the browser. Leaves coloured by candidate-mode
cluster labels. Shows an **ARI badge** indicating how well the
tree's clades (at K = cluster_count) agree with the cluster labels.

Cartridge implementation of HANDOFF_5 (Phase 1 scope).

## Capabilities (Phase 1)

- Render a single sample-tree canvas.
- Colour leaves by candidate-mode cluster labels.
- Hover / click selection linkage with the panel's selection store.
- Display ARI badge (tree clades at K=cluster_count vs cluster
  labels).

## Deferred (not in Phase 1)

- Band-tree (Path A) side-by-side with sample tree.
- Bootstrap support shown on internal nodes.
- Het-mode controls (iupac / hom_only / n / random) — only matter
  for IQ-TREE Path B (round-trip), which we don't do in the browser.
- Cross-panel hover linkage with PCA / heatmap (separate commit
  once those panels are wired).

## Required data

- **Slots**: `activeCandidate` (reads
  `atlasState.inversion.tree_panel_state`)

## Input contract

```
atlasState.inversion.tree_panel_state = {
  tree:                  mgl_nj_tree.buildNjTree output,
  leaf_cluster_labels:   Array<number|string> per leaf,
  leaf_colors_by_cluster: Array<string> color per cluster id,
  candidate_label?:      string for the header,
}
```

This object must be populated by an upstream producer (not yet
wired per HANDOFF_5).

## User interactions

- Hover a leaf — selection store updates.
- Click a leaf — selection store toggles.

## Outputs

**Preview-only**:
- Tree topology (NJ on dosage distances)
- Leaf colouring by cluster label
- ARI value (tree clades vs candidate-mode cluster labels)

**Committable**: none — this is a read-only inspector panel.

## Connected analyses / adapters

- `shared/mgl_nj_tree.js` — `buildNjTree`

## Sub-modules in `tree_panel/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` + setter |
| `renderer.js` | canvas tree painter |
| `selection.js` | hover / click selection store |

## Status and known issues

- Phase 1 only — see Deferred list above.
- Input contract requires `atlasState.inversion.tree_panel_state` to
  be pre-populated; producer not yet wired (per HANDOFF_5).

## Documents

- **Registry doc**: not in `pages.registry.json` (only registered in
  `manifest.json`). Status: unknown why the discrepancy.
- **Specs (todo)**:
  - `specs_todo/mgl_adapter/HANDOFF_5_tree.md` (canonical)
  - `specs_todo/pages_tree_panel/_to_do/HANDOFF_5_tree.md` (duplicate
    of the canonical mgl_adapter HANDOFF_5)
- **Handoffs**: HANDOFF_5 (above)
- **User guide**: unknown
- **Legacy source**: n/a — new cartridge

**Confidence**: high
