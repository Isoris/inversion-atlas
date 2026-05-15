# Drag-drop layout for mgl_adapter spec implementation

Extract this archive. You get FOUR top-level folders matching your repos:

```
Specs_WIP_modules/             → drop into Specs_WIP_modules/   [canonical spec docs]
catfish-population-analysis/   → drop into catfish-population-analysis/  [IMPLEMENTED Beagle adapter]
catfish-inversion-analysis/    → drop into catfish-inversion-analysis/  [_to_do/ markers]
inversion-atlas/               → drop into inversion-atlas/  [_to_do/ markers]
```

## Why mgl_adapter lives in catfish-population-analysis

Beagle GLs are population-level data, used downstream by diversity
analysis, inversion analysis, etc. The "variant analysis" repo is for
variant types (SNP, INDEL, INS, DEL, DUP, INV) — not GL infrastructure.

## Data flow

```
catfish-population-analysis/MODULE_X_mgl_adapter/    (IMPLEMENTED, v5)
   │ produces: bi_baseline.beagle.gz, all_pairs.beagle.gz, sidecars
   ▼
catfish-inversion-analysis/MODULE_*/                 (TO BE IMPLEMENTED)
   │ produces: pca_*.json, heatmap_*.json, tree_*.nwk, contrast_*.tsv
   ▼
inversion-atlas/pages_*/                             (TO BE IMPLEMENTED)
   │ consumes JSONs, renders panels
   ▼
User in browser

Also consumed by:
catfish-diversity-analysis/  ← het, θπ, ROH on Beagle GLs
```

## Priority for MS_Inversions 2026 submission

Implement four modules in catfish-inversion-analysis/:

1. MODULE_5_anchored_pca/   (HANDOFF 1 — foundation)
2. MODULE_5_validation/     (HANDOFF 3 — LG28 sanity check)
3. MODULE_7_fingerprinter/  (HANDOFF 6 — architecture diagnosis)
4. MODULE_6_tree/           (HANDOFF 5 — paper figure)

Total ~3-4 weeks of focused work. Then write the paper.

## Atlas integration (optional, after paper)

In inversion-atlas/:
- pages_candidate_mode/     (HANDOFF 2)
- pages_tree_panel/         (HANDOFF 5 atlas side)
- pages_fingerprint_track/  (HANDOFF 6 atlas side)
- pages_custom_views/       (HANDOFF 4)

## Future work (2-3 years out)

For nested-inversion follow-up paper:
- catfish-inversion-analysis/MODULE_8_nested/         (HANDOFF 7)
- catfish-inversion-analysis/MODULE_9_dosage_clustering/  (HANDOFF 8)
- catfish-inversion-analysis/MODULE_10_dosage_similarity/ (HANDOFF 9)
- catfish-inversion-analysis/MODULE_11_atlas_export/      (HANDOFF 10 Stage 1)
- inversion-atlas/pages_similarity_panel/             (HANDOFF 10 atlas)

## Asking Claude Code to implement

For each module:
1. Open module folder in VS Code
2. Point Claude Code at `_to_do/HANDOFF_*.md`
3. "Implement this spec; reference Specs_WIP_modules/mgl_adapter/specs/SPEC_0_master.md
    for cross-cutting concerns and catfish-population-analysis/MODULE_X_mgl_adapter/
    for the upstream Beagle producer."

After implementation, move spec from `_to_do/` to `done/` or delete it.

## Module numbering

MODULE_X / MODULE_5 / etc are placeholders. Adjust to your existing
numbering convention.
