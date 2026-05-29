# haplotype_regimes/

Sibling modules shared by three pages, one per seed-discovery method:
**haplotype_regimes** (long-range V-walker, discovery), **het_skeletons**
(het-skeleton / Cluster 1 Path B, discovery — split out 2026-05-29), and
**candidate_regimes** (short-range curated list, classification).
Extracted from the formerly 2615-LoC `pages/discovery/haplotype_regimes.js`
during the 2026-05-27 audit refactor (PR #28). Each page mounts the same
stack with a forced `state._regimesMode` (`long` / `het` / `short`) and,
for the two split pages, no `#rgModeBar`.

The parent page files are now thin lifecycle wrappers that compose
these modules:

  - `pages/discovery/haplotype_regimes.js`           (176 LoC)
  - `pages/classification/candidate_regimes.js`     (170 LoC)

Both pages share 13 of the 15 modules in this folder. The shared
modules are parameterised by `state._pageId` (and the absence /
presence of `#rgModeBar` in the DOM) so the two pages namespace
their cross-mount stash slot and localStorage keys cleanly:

  haplotype_regimes  →  inv._haplotype_regimes_stash + "haplotype_regimes.{mode,view}"
  candidate_regimes  →  inv._candidate_regimes_stash + "candidate_regimes.{mode,view}"


## Module index

### Compute (pure functions, no DOM)

| Module | LoC | Owns |
|---|---:|---|
| `short_range.js`               | 134 | Mode 2 seed builder — wraps the local_pca_dosage candidate list as pipeline pseudo-loci. Used by candidate_regimes. |
| `het_skeleton.js`              | 308 | Mode 3 seed builder — Cluster 1 Path B. Per-window K-means → het detect → skeleton walk → HOM anchor → adjacent-V merge. **User flagged as having "much potential."** |
| `band_quality_calibration.js`  |  87 | `bandQualityStats(state)` + `autoCalibrateAnchorBQ(stats)` — surfaces the BQ cache distribution and picks an adaptive anchor threshold. |

### Pipeline orchestration

| Module | LoC | Owns |
|---|---:|---|
| `pipeline_ctx.js`              | 232 | `wireCtxCallbacks(state, atlasState)` — builds the per-window K-means cache, band-quality cache, L2 envelope map, and the canonical `state._regimesCtx` the pipeline reads through. The load-bearing setup. |
| `run_pipeline.js`              | 501 | Three exports: `runPipeline` (mode dispatcher: long / short / het), `afterPipelineRun` (panel render + button enable + stash), `runPostSeedingTail` (Cluster 2 breadth voting + Cluster 3 refinement + topology + genome-scale + annotation + serialise). |

### UI

| Module | LoC | Owns |
|---|---:|---|
| `action_bar.js`                | 154 | `wireActionBar(root, state, atlasState)` — mode/view toggle pills, run-pipeline/export/auto-merge button handlers. Pure UI plumbing; every handler dispatches to a sibling module. |
| `seeds_strip.js`               | 234 | `renderSeedsStrip(root, state)`, `pushFocalSeedGroups(state)`, `wireSeedStripFocalSync(root, state)` — chip strip + focal sync + arrow-key cycle. |
| `l3_pairs_table.js`            | 217 | `renderL3PairsTable(root, state, opts)` — adjacent-L2 Cramér's V mini-table with per-row "merge → candidate" button. Calls `opts.onAfterMerge()` after a successful promote (caller uses this to re-run the pipeline). |
| `regimes_summary.js`           | 114 | `renderRegimesSummary(root, state)` + `applyViewToggle(root, state)` — the refined-regimes table that's the alternative view to the seeds chip strip. |
| `promote_seed.js`              | 155 | `promoteFocalSeed` (focal locus → candidate) + `promoteAllSeeds` (bulk: every Stage 3 locus → candidate, added 2026-05-29) sharing a `_locusToCandidate` helper. Wired on haplotype_regimes + het_skeletons (the ★/★★ buttons); candidate_regimes omits both. |
| `auto_merge.js`                | 242 | `runAutoMerge(root, state, atlasState, granularity, opts)` — single Cramér's V auto-merge driver with `granularity: 'local' \| 'macrostripe'`. Replaced two 150-LoC near-duplicates. |
| `catalogue_export.js`          | 128 | `exportCatalogue(state, atlasState)` — serialises the pipeline result to the catalogue triple (manifest + knobs + catalogue.json) and triggers 3 JSON downloads. |
| `util.js`                      |  29 | `setStatus(root, msg)` + `escapeHtml(s)` — tiny shared helpers, no dependencies. |

### Panel paint (pre-existing)

| Module | Owns |
|---|---|
| `regimes_page.js`          | 4-canvas init + render + keyboard nav. |
| `regimes_panel.js`         | Per-band target-band lane paint. |
| `regimes_pc1_panel.js`     | Per-sample PC1 trace paint. |


## Dependency direction

All cross-module calls are **one-directional** (no cycles):

```
            haplotype_regimes.js  /  candidate_regimes.js
                   │
                   ├──→ pipeline_ctx.js   (wires state)
                   │
                   ├──→ action_bar.js
                   │       │
                   │       ├──→ run_pipeline.js
                   │       │       │
                   │       │       ├──→ pipeline_ctx (via state._regimesCtx)
                   │       │       ├──→ het_skeleton.js  /  short_range.js
                   │       │       ├──→ band_quality_calibration.js
                   │       │       ├──→ seeds_strip.js
                   │       │       ├──→ l3_pairs_table.js
                   │       │       ├──→ regimes_summary.js
                   │       │       └──→ shared/band_tracking/* + regime_annotation/*
                   │       │
                   │       ├──→ catalogue_export.js
                   │       ├──→ promote_seed.js     (haplotype_regimes only)
                   │       ├──→ auto_merge.js
                   │       └──→ regimes_summary.js
                   │
                   └──→ run_pipeline.afterPipelineRun  (cross-mount restore)
```

Modules that need to call back UP the tree pass callbacks via `opts`
— e.g. `l3_pairs_table.renderL3PairsTable(root, state, { onAfterMerge })`
takes the re-run-pipeline closure from the caller instead of importing
`run_pipeline.js`. Same pattern in `auto_merge.runAutoMerge(...,
{ onRefresh })`.


## Adding a new feature

- **New panel** → new module in this folder + import from `run_pipeline.afterPipelineRun`.
- **New compute mode** → new builder module (mirror `het_skeleton.js` or `short_range.js`) + new dispatch branch in `run_pipeline.runPipeline` + new button in `action_bar.wireActionBar`.
- **New page sharing this stack** → mount script in `pages/<stage>/<page>.js` that sets `state._pageId = '<page>'` and `state._regimesMode = 'short' | 'long' | 'het'` before calling `wireActionBar`. The HTML can omit `#rgModeBar` to skip the mode toggle entirely.


## Test coverage

| Suite | Asserts | Notes |
|---|---:|---|
| `tests/test_discovery_haplotype_regimes.js`  | 37 | Pre-existing; covers compute + mount lifecycle. Still 37/37 green after every Part C extraction. |
| `tests/test_classification_candidate_regimes.js` | 8 | New (PR #28). Smoke-level: module loads, mount/unmount degrade gracefully, mount with valid data runs through. |
| `tests/test_shared_atlas_chrome.js`          | 64 | Parses every manifest entry — fails if a stage / fragment / module path is broken. Catches the candidate_regimes entry. |


## Migration provenance

This folder was created by the 2026-05-27 haplotype_regimes audit
(PR #28). The audit was prompted by user feedback that the page
"felt like it was mixing goals" — 9 distinct user-visible capabilities
shared one 2615-LoC file. The refactor proceeded in 7 commits:

1. **Part B**  merge two Cramér's V auto-merge functions into one dispatcher
2. **Part C** (5 commits) split out 13 sibling modules
3. **Part A**  extract short-range mode into a new `candidate_regimes` page

No behaviour change at any commit checkpoint; the 37-assertion
regression test passed after every move.
