# page1 — local PCA |Z| — Page Capability Contract

**Atlas**: inversion
**Stage**: discovery (round 1 — local-PCA scanners)
**Page type**: core_page (performance-critical, 60 fps target)
**Status**: active

## Purpose

The chromosome-wide PCA-based inversion scanner — referred to in the
repo as **THE big page**. Six side-by-side panels walk every window
of the active chromosome; clicking on any panel updates `state.cur`
(the central cursor), and per-window K-means labels feed L3
concordance tables.

## Capabilities

- Walk a window cursor along the active chromosome at 60 fps.
- Show sim_mat heatmap (window × window similarity) with L1/L2
  envelope overlays and an anchor strip.
- Show robust-|Z| waveform with candidate lane/bar overlay, embedded
  sim_mat minimap, and 9 strip overlays (SNP density, transition
  rate, regime breadth, lineage, diamond, inheritance labels,
  tracked-linkage, band-trace).
- Show per-sample PC1/PC2 line traces across windows; color samples
  by family / regime / kmeans / theta_pi / GHSL / het_rate / residual
  / manual_group / candidate state.
- Run K-means on per-window PCA for K = 2..6; cycle K via aside
  buttons; produce L3 contingency in 3 render modes (primary
  Hungarian-aligned, per-K slab, scale-stability NN20/40/80).
- Lasso-select samples on the PCA scatter or on the lines panel.
- Show tracked-samples sidebar + manual-groups sidebar.
- L2-sweep auto-promote pipeline — when `state.l2SweepEnabled` is
  on, on chrom switch run inheritance-group clustering over every
  usable L2 envelope (treating each as a synthetic candidate) and
  auto-promote those that pass.
- Drag-drop chromosome JSONs + enrichment files (merged into
  state.data without overwrite).
- Session restore from IndexedDB (cached chrom JSONs + enrichments
  + last-active chrom).
- Resize panel heights by dragging the bottom edges.
- Fish-inspect popover — click near a tracked sample's trace to see
  its call data for the active candidate.

## Required data

- **Layers**: `scrubber_main`, `repeat_density`, `band_trajectories`,
  `candidate_tracks`
- **Slots**: `activeChrom` (required), `activeCandidate` (optional)
- **Preloads**: same as required plus `band_nodes`, `band_edges`

## Optional overlays

- `theta_pi_*` layers (drive page12 mirror — same panel architecture
  painted from the theta_pi envelope)
- `ghsl_panel` layer (drives page15 mirror — same panel architecture
  on GHSL haplotype divergence)
- `active_samples` exclusion list (cohort-wide, CGA-keyed)
- `band_trace` per-fish-set traces
- `inheritance_groups` and `lineage` clusterings
- `manual_groups` (user-defined sample sets)
- enrichment files dragged in at runtime

## User interactions

- **Cursor**: any canvas click sets `state.cur`; ←/→ arrows step
  by `state.stepMode` (1/5/10/N/L2); Shift+arrow = 20-window skip;
  n/p prev-next L2 or L1.
- **K selector**: 2, 3, 4, 5, 6 via aside / compact buttons.
- **Color-by**: family / regime / kmeans / theta_pi / GHSL / het_rate
  / residual / manual_group / candidate state — color-mode bar.
- **Tracked-samples**: click samples to track; persists to
  localStorage.
- **Manual groups**: lasso or click to build user-defined groups;
  persists to localStorage.
- **Anchor picker**: parameter control for `anchor_window` (drives
  anchor strip + concord badge).
- **Candidate mode**: toggle button; in candidate mode f/b/c hotkeys
  draft new candidate boundaries.
- **Lassos**: lasso on PCA (samples), lasso on lines (samples).
- **Panel resize**: drag bottom edge of sim / Z / lines / PCA / L3.
- **File input + drag-drop**: chromosome JSONs, enrichment files.
- **Fish inspect popover**: click near a tracked sample's PC1 trace.

See `page1/hotkeys.js` for the canonical hotkey list.

## Outputs

**Preview-only (recomputed every cursor move)**:
- per-window kmeans labels (K = 2..6)
- L3 contingency tables (Hungarian-aligned)
- PC1 line summaries
- sim_mat heatmap
- robust |Z| values
- band diagnostics rows (per L2 envelope)
- lineage cluster assignments
- inheritance group assignments

**Committable (manual gesture required)**:
- promoted **candidate** (added to `state.candidateList`, persisted
  via registry write path)
- **manual_groups** (localStorage)
- **active_samples** filter (localStorage)
- **band_trace** state (localStorage)
- **tracked samples** list (localStorage)

Commit policy: manual only — no auto-save.

## Connected analyses / adapters

Primitives (in `atlases/inversion/shared/`):
- `kmeans.js`, `hungarian.js`, `contingency.js`, `het_rate.js`,
  `per_l2_cluster.js`, `clustering.js`, `band_trace.js`,
  `inheritance_groups.js`, `page1_data_helpers.js`,
  `page1_utils.js`, `diamond_detection.js`, `repeat_density.js`.

Adapters:
- `core/atlas_api.js` — `resolve()`, `getState()` (registry resolver
  + state read).

## Sub-modules in `page1/`

| file | purpose |
|------|---------|
| `_state.js` | `_pageState` ref + `_setActiveState` setter, cache invalidation helpers (`_linesCacheInvalidate`, `invalidateLineageCache`, `_bandTraceClearCache`) |
| `_data.js` | re-export shim → `shared/page1_data_helpers.js` (schema detection, indexing, PC accessors, view controls) |
| `chrom_cache.js` | in-memory cache of parsed chromosome JSONs + chrom dropdown refresher |
| `idb.js` / `idb_restore.js` | IndexedDB persistence + session replay |
| `enrichment.js` | merge dropped enrichment JSON into `state.data` |
| `sim_panel.js` | drawSim / drawSimMini |
| `z_panel.js` | drawZ + 9 strip renderers |
| `lines_panel.js` | drawLinesPanel + builders + lasso |
| `pca_panel.js` | drawPCA + drawAnchorStrip + sidebars + lasso |
| `l3_panel.js` | renderL3Panel + slab + scaleStability |
| `candidates.js` | candidate overlay primitives (lane layout, band paint, overlay index cache) |
| `band_diagnostics.js` + `..._html.js` | per-band GHSL/θπ/ROH/FROH summary |
| `band_trace_state.js` + `..._tooltip.js` | per-fish-set trace state + tooltips |
| `active_samples.js` | cohort-wide exclude filter |
| `diag_residuals.js` | per-fish residual-Z diagnostic + 'residual' color mode |
| `events.js` | onSimClick / onZClick / onPCAClick / setCur (central cursor setter) |
| `hotkeys.js` | document-level keyboard shortcuts |
| `inheritance.js` + `..._tooltip.js` | inheritance-group clustering wrapper |
| `lineage.js` | state-managed lineage compute |
| `l2_sweep.js` | L2-sweep auto-promote pipeline |
| `manual_groups.js` | user-defined sample groups |
| `sidebar.js` | wires every aside control |
| `panel_resize.js` | drag-handle resize on each panel's bottom edge |
| `fish_inspect_popover.js` | click-near-trace fish detail card |

## Status and known issues

- **Status**: active, shipped, performance-critical.
- The layer set is the heaviest of any page (4 required + 6
  preloads). All required layers must be hot-tier to keep 60 fps.
- 5 SPEC names referenced in this page's source (`page1.html`,
  `pca_panel.js`, `lines_panel.js`, `l2_sweep.js`) have no on-disk
  SPEC files: `SPEC_g_panel_unified_groups`,
  `SPEC_lines_panel_candidate_bands`, `SPEC_l2_sweep_inheritance`,
  `SPEC_l3_het_dosage_coloring`, `SPEC_lasso_inheritance_backgrounds`.
- `applyData()` orchestrates ~10 sub-modules; cross-chrom safety
  clears `state.candidate` on chrom switch, but the mid-state during
  the switch is a known fragile path (legacy lines 54476-54690).

## Documents

- **Registry doc**: `atlases/inversion/registries/data/pages.registry.json` → `pages.page1._doc`
- **Specs (done)**:
  - `specs_done/SPEC_band_track_extraction_and_l3_single_band_rows.md`
  - `specs_done/SPEC_l2_sweep_inheritance.md` (authored 2026-05-15 from `page1/l2_sweep.js`)
  - `specs_done/SPEC_g_panel_unified_groups.md` (Slice 1 shipped; Slices 2 + 3 pending)
- **Specs (todo)**: `specs_todo/SPEC_page1_candidate_mode_ui.md`
- **Handoffs**: `_handoff_docs/HANDOFF_2026-05-06_chat35_round4_done.md`,
  `atlases/inversion/pages/discovery/BATCH_1_NOTES.md`
- **User guide**: unknown (no per-page user-facing manual exists yet)
- **Legacy source**: `legacy/Inversion_atlas.html` (the big-page
  monolith; round 4 split moved it to this directory tree)

**Confidence**: high
