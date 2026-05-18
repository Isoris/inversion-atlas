# `tooling/` (stage) — utility / inspector cartridges

This stage was added 2026-05-16 to declutter `discovery_2`. The
seven cartridges below moved from `discovery_2` → `tooling` per
`_handoff_docs/AUDIT_local_pca_merge_vs_rename.md` §Q3.

**Note on layout**: pages in this stage still LIVE on disk under
`pages/discovery/<page_id>/`. The move was a **manifest re-staging
only** — no file paths changed, no DOM ids changed, no cross-page
references broke. The `stage` field in `manifest.json` is the
authoritative routing key; directory location is historical.

## Pages

| page id | label | what it inspects |
|---------|-------|------------------|
| `tree_panel` | tree panel | NJ sample tree on dosage distances + ARI badge |
| `fingerprint_track` | fingerprint track | per-window diversity-regime fingerprint + switch markers + scenario badge |
| `similarity_matrix` | similarity matrix | per-window sample × sample similarity heatmap with block detection + adjacent-window ARI transition strip |
| `pca_scatter_per_window` | PCA scatter | per-window PC1 × PC2 scatter with λ-magnitude scrubber |
| `dosage_heatmap` | dosage heatmap | sample × marker dosage heatmap with K=3 group track, polarity stripe, and MINOR2/MINOR3 role-pair sidecar (per SPEC_0 §1) |
| `nested_inversion_detector` | nested detector | 3 stratum tracks (HOM1 / HET / HOMO_2) + contiguous inner-interval overlays |
| `dosage_cluster_adaptive_k` | dosage cluster | adaptive-K sample clustering on per-window dosage profiles |

## What qualifies as "tooling"

A page belongs here if it is an **inspector** — opened ad-hoc to
characterise a candidate or debug a layer — rather than a
**workflow step** users walk through in order.

- ✅ `discovery_2` (workflow): page2 candidate focus, page22 haplotype regimes
- ✅ `tooling` (inspector): the 7 above

A future addition should ship here too: `page_pca_comparator` per
`specs_todo/SPEC_local_pca_comparator.md` — a side-by-side view of
dosage / θπ / GHSL local PCAs.

## Vertical-list UI (atlas-core shell change, separate concern)

The user's vision (2026-05-16) is for this stage to render as a
**vertical list** in a sidebar rather than horizontal pills in the
topbar. That layout is an atlas-core shell change — the
`atlas_chrome.css` + `atlas_chrome.js` machinery currently renders
all stages as horizontal pills. When the shell ships per-stage
layout hints, this stage's manifest entry can carry e.g.
`"layout": "vertical_sidebar"`.

In the meantime, the shell renders `tooling` as standard horizontal
pills — same as the other stages. The visual grouping is still an
improvement over the cluttered all-in-one `discovery_2`.

## Documents

- Stage definition: `atlases/inversion/manifest.json` `stages[]`
  entry `tooling` (order 2.5)
- Audit: `_handoff_docs/AUDIT_local_pca_merge_vs_rename.md` §Q3
- Per-page contracts: `docs/generated/page_contracts/<id>/`
- SPEC for the future comparator: `specs_todo/SPEC_local_pca_comparator.md`
