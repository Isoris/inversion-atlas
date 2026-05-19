# `pages/discovery/` — discovery-stage pages

This directory hosts pages for the **discovery** workflow stage —
where the user finds candidate inversions before classifying or
refining them.

Two sub-stages share this directory:

- **`discovery` (round 1)** — local-PCA detection scanners
- **`discovery_2` (round 2)** — supplementary detection /
  inspection cartridges

(Plus 2 pages whose `manifest.json` stage is `catalogue` but who
live on disk here for historical reasons — see the dir/stage
discrepancy table below.)

## What discovery is for

> "We need to find candidate inversions in a fish cohort without
> labels."

The discovery stage answers that. The user loads a chromosome's
precomp, scrolls through the windows, looks for regions where the
sim_mat shows a clear triangle structure / |Z| spikes / per-sample
PC1 traces split cleanly — i.e. where the population is structured
along a hidden axis that an inversion would produce.

Three orthogonal evidence axes drive the round-1 scanners:

| axis | page | input | rationale |
|------|------|-------|-----------|
| genotype-based | **local_pca_dosage** | dosage | the workhorse — clearest signal when an inversion is present and frequent |
| diversity-based | **local_pca_theta_pi** | θπ (per-sample nucleotide diversity) | catches sweeps + balancing selection invisible to genotype |
| haplotype-based | **local_pca_ghsl** | GHSL (haplotype-pair sequence divergence) | catches haplotype-specific divergence invisible to dosage-or-diversity |

Regions hit by all three are near-certainly real biology. Regions
hit by only one are worth investigating with that axis's specific
strengths.

Round-2 pages are inspection / refinement tools. They consume the
output of round 1 (or load pre-computed cartridge state per the
HANDOFF_5 / 6 / 7 / 8 / 10 SPECs).

## Pages in this directory (by stage)

### Stage `discovery` (round 1)

| page | label | summary |
|------|-------|---------|
| `local_pca_dosage` | local PCA \|Z\| | **the big page** — six-panel scrubber (sim_mat, \|Z\|, lines, PCA, L3 contingency, sidebar). 60 fps target. Most-used page in the atlas. |
| `local_pca_theta_pi` | local PCA θπ | sister to local_pca_dosage driven by per-sample θπ; empty-state until R pipeline ships θπ layers |
| `local_pca_ghsl` | local PCA GHSL | third evidence axis (GHSL haplotype divergence); stub — only layer-status chips wired |

### Stage `discovery_2` (round 2 — workflow surfaces only)

| page | label | summary |
|------|-------|---------|
| `candidate_focus` | candidate focus | per-candidate deep-dive (~15 sub-panels); reads `state.candidate` |
| `haplotype_regimes` | haplotype regimes | wires the v3.4 banding pipeline (Stage 1-4) into the atlas-core shell; has end-user docs at `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md` |
| `pca_comparator` | PCA comparator (dosage · θπ · GHSL) | side-by-side mini-PCA of all 3 evidence axes at the active window; shared cursor + hover; K-band coloring from the anchor (default dosage). Phase 1 per `specs_todo/SPEC_local_pca_comparator.md`. |

### Stage `tooling` — utility / inspector cartridges (re-staged 2026-05-16)

The cartridges below moved from `discovery_2` to a dedicated
`tooling` stage on 2026-05-16 (per
`_handoff_docs/AUDIT_local_pca_merge_vs_rename.md` §Q3). They still
LIVE on disk in `pages/discovery/<page_id>/` but their manifest
stage is now `tooling`. The shell groups them into a separate tab.

| page | label | summary |
|------|-------|---------|
| `tree_panel` | tree panel | NJ sample tree on dosage distances + ARI badge (HANDOFF_5) |
| `fingerprint_track` | fingerprint track | per-window diversity-regime fingerprint + switch markers + scenario badge (HANDOFF_6) |
| `similarity_matrix` | similarity matrix | per-window sample×sample heatmap + ARI transition strip (HANDOFF_10 / SPEC_0 §11.9) |
| `pca_scatter_per_window` | PCA scatter | per-window PC1×PC2 scatter with λ-magnitude scrubber (SPEC_0 §10) |
| `dosage_heatmap` | dosage heatmap | sample × marker dosage heatmap with K=3 group track + polarity stripe + role-pair sidecar (SPEC_0 §11 / role-pair sidecar shipped 47ce1bc) |
| `nested_inversion_detector` | nested detector | 3 stratum tracks (HOM1/HET/HOM2) + inner-interval overlays (HANDOFF_7 / SPEC_0 §11.7) |
| `dosage_cluster_adaptive_k` | dosage cluster | adaptive-K sample clustering on per-window dosage profiles (HANDOFF_8 / SPEC_0 §11.8) |

### Pages whose manifest stage ≠ this dir

| page | manifest stage | lives here because |
|------|---------------|--------------------|
| `window_summary_table` | `catalogue` | per-window summary table — discovery-side metrics (\|Z\|, λ, eigen, ANGSD bi-SNP) historically grouped near local_pca_dosage |
| `negative_regions` | `catalogue` | negative regions catalogue — complement of catalogue's positive catalogue; historically grouped near the scanners |

## Key shared modules consumed by discovery pages

- **`shared/per_l2_cluster.js`** — `ClusterCache`, `contextFromState`,
  `clusterL2` — per-window K-means cache that bridges atlas-side
  state to pipeline ctx (used by local_pca_dosage, candidate_focus, haplotype_regimes)
- **`shared/band_tracking/`** (32 modules) — the v3.4 banding pipeline
  (Stage 1-4 + dosage overlay); page22 wires the orchestrator
- **`shared/kmeans.js`** — `kmeans1D`, `kmeans2D`, `silhouette1D`,
  `adaptiveK1D` — used by local_pca_dosage's clustering, dosage_cluster_adaptive_k
- **`shared/hungarian.js`** — `alignLabels`, `hungarianChainProjection`,
  `concordanceMatrix` — used by local_pca_dosage's L3 contingency, lineage
  compute (per `specs_done/SPEC_distant_band_concordance_fish_trajectory.md`)
- **`shared/contingency.js`** — `buildContingency`, `computeARI`,
  `computeNMI`, `cramersV` — used by local_pca_dosage, local_pca_theta_pi, page22
- **`shared/het_rate.js`** — `hetRateColor` — used by local_pca_dosage's L3
  het-coloring (per `specs_done/SPEC_l3_het_dosage_coloring.md`)
- **`shared/page1_data_helpers.js`** — `groupColor`, schema
  detection, indexing — used by local_pca_dosage, candidate_focus, karyotype_tier (cross-stage)
- **`shared/inheritance_groups.js`** — `inheritanceGroupClustering`,
  `IGC_MIN_BANDS_FOR_CLUSTERING` — used by local_pca_dosage's lineage compute
  + L2-sweep (per `specs_done/SPEC_l2_sweep_inheritance.md`)
- **`shared/mgl_*.js`** family — the HANDOFF_5/6/7/8/10 producers
  (`mgl_nj_tree`, `mgl_fingerprinter`, `mgl_window_similarity`,
  `mgl_pca`, `mgl_nested_detector`, `mgl_dosage_clustering`,
  `mgl_heatmap_json`)

## Cross-page dependencies

- **local_pca_theta_pi + local_pca_ghsl** receive panel-render dispatches from
  local_pca_dosage's `applyData()` when θπ / GHSL layers are present in the
  loaded chromosome JSON. This means local_pca_theta_pi's θπ panels paint
  alongside local_pca_dosage on shared data.
- **candidate_focus** reuses local_pca_dosage's cluster-cache for the L2 recompute on
  the active candidate.

## SPECs relevant to discovery

In `specs_done/`:
- `SPEC_band_track_extraction_and_l3_single_band_rows.md` (parent
  band-track spec)
- `SPEC_l2_sweep_inheritance.md` (local_pca_dosage's auto-promote pipeline)
- `SPEC_g_panel_unified_groups.md` (local_pca_dosage's G-panel popup)
- `SPEC_lines_panel_candidate_bands.md` (local_pca_dosage's lines vertical
  highlights)
- `SPEC_lasso_inheritance_backgrounds.md` (local_pca_dosage's linkage modal)
- `SPEC_l3_het_dosage_coloring.md` (local_pca_dosage's L3 het-coloring)
- `SPEC_distant_band_concordance_fish_trajectory.md` (local_pca_dosage's
  lineage + band-trace duo)

In `specs_todo/`:
- `SPEC_page1_candidate_mode_ui.md` (local_pca_dosage detailed mode — HANDOFF 2)
- `mgl_adapter/` (the HANDOFF_5/6/7/8/10 + SPEC_0 family that drives
  all 7 discovery_2 cartridges)
- The Stage 5.5/5.6/5.7 specs of the v3.4 pipeline:
  `SPEC_regime_annotation_v34.md`, `SPEC_copy_origin_painting.md`,
  `SPEC_fish_ancestry_scroller.md`

## Per-page contracts

`docs/generated/page_contracts/<page_id>/` — every discovery page
has a `page.manifest.json` (machine-readable capabilities) and a
`PAGE_CONTRACT.md` (human-readable narrative).

## Notes for new contributors

- **Read local_pca_dosage first.** The other pages mostly follow its patterns
  (state.cur cursor, _pageState live binding, _setActiveState in
  mount, panel sub-modules under page<X>/).
- **page22 has a user guide** — `specs_done/_bundles/HOW_TO_USE_haplotype_regimes.md`.
  It's the only end-user-facing docs in the repo. Use it as the
  template for future user guides.
- **The dir ≠ stage discrepancies (window_summary_table, negative_regions) are intentional**
  — don't move the files. The stage is authoritative for shell
  routing; the dir reflects historical grouping.
