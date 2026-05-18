# How to use page1 — local PCA |Z|

**Page**: `page1` · stage `discovery` · label "local PCA \|Z\|"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)
**Performance target**: **60 fps** — all required layers must be hot-tier.

## What this page does

The chromosome-wide PCA-based inversion scanner — referred to in
the repo as **the big page**. Six side-by-side panels walk every
window of the active chromosome at 60 fps. Click on any panel to
update `state.cur` (the central cursor). Per-window K-means labels
feed L3 concordance tables.

It is the entry point for the discovery workflow — most users open
this first.

## Where the pieces live

```
atlases/inversion/
├── manifest.json                                ← page1 entry
├── registries/data/pages.registry.json          ← page1 _doc
├── pages/discovery/
│   ├── page1.html                               ← the HTML shell + DOM ids
│   ├── page1.js                                 ← main entry (mount/unmount/applyData)
│   └── page1/                                   ← 28 sub-modules
│       ├── _state.js                              ← _pageState + cache invalidation
│       ├── _data.js                               ← schema detection + PC accessors
│       ├── sim_panel.js                           ← drawSim, drawSimMini
│       ├── z_panel.js                             ← drawZ + 9 strip renderers
│       ├── lines_panel.js                         ← drawLinesPanel + color modes
│       ├── pca_panel.js                           ← drawPCA + drawAnchorStrip + sidebars
│       ├── l3_panel.js                            ← renderL3Panel + slab + scaleStability
│       ├── candidates.js                          ← candidate overlay primitives
│       ├── events.js                              ← canvas clicks + central setCur
│       ├── hotkeys.js                             ← document-level keyboard shortcuts
│       ├── sidebar.js                             ← wires every aside control
│       ├── band_diagnostics.js + ..._html.js      ← per-band GHSL/θπ/ROH/FROH
│       ├── band_trace_state.js + ..._tooltip.js   ← per-fish-set trace
│       ├── active_samples.js                     ← cohort-wide exclude filter
│       ├── diag_residuals.js                      ← per-fish residual-Z + color mode
│       ├── inheritance.js + ..._tooltip.js        ← inheritance-group clustering
│       ├── lineage.js                             ← state-managed lineage compute
│       ├── l2_sweep.js                            ← L2-sweep auto-promote
│       ├── manual_groups.js                       ← user-defined sample groups
│       ├── chrom_cache.js                         ← per-session chromosome cache
│       ├── idb.js + idb_restore.js                ← IndexedDB persistence
│       ├── enrichment.js                          ← drag-drop layer merge
│       ├── panel_resize.js                        ← drag bottom edges
│       └── fish_inspect_popover.js                ← click-near-trace fish card
└── shared/
    ├── page1_utils.js              ← escapeHtml, withAlpha, _assignCandidateLanes
    ├── page1_data_helpers.js       ← groupColor + schema detection
    ├── per_l2_cluster.js           ← ClusterCache + contextFromState
    ├── kmeans.js                   ← kmeans1D / 2D / silhouette / adaptiveK
    ├── hungarian.js                ← alignLabels + hungarianChainProjection
    ├── contingency.js              ← buildContingency / ARI / NMI / Cramer's V
    ├── het_rate.js                 ← hetRateColor (L3 het toggle ramp)
    ├── clustering.js               ← lineage compute primitives
    ├── inheritance_groups.js       ← IGC clustering + IGC_MIN_BANDS_FOR_CLUSTERING
    ├── band_trace.js               ← fish-set trace compute
    ├── diamond_detection.js        ← diamond strip indicator
    └── color_helpers.js            ← simColor, palette helpers
```

## How to run

1. **Drop the atlas into the core shell.** Standard install.

2. **Start the shell** (e.g. `python -m http.server` from the
   atlas-core directory) and open `index.html`. The discovery tab
   shows **page1 — local PCA \|Z\|** as the first page.

3. **Pick a chromosome** in the topbar — the page reads
   `atlasState.shared.activeChrom`. Click the page1 tab.

4. **Drag-drop the precomp JSON** for the chromosome
   (e.g. `LG28.json`) into the page. Alternatively click `#fileInput`
   and pick the file from disk. The page autoloads on chrom switch
   from the `chrom_cache.js` in-memory cache + IndexedDB.

5. Six panels populate top-down (after `applyData()` runs):
   - **Sim panel** (top-left) — sim_mat heatmap with envelope overlays
   - **|Z| panel** (top-center) — robust-|Z| waveform + 9 strip overlays
   - **Lines panel** (top-right) — per-sample PC1 trajectories
   - **PCA panel** (bottom-left) — per-window PC1×PC2 scatter
   - **L3 panel** (bottom-center) — L3 contingency tables
   - **Sidebar** (bottom-right) — tracked samples + manual groups +
     candidate list + view controls

6. **Start scrubbing**.

## The basic workflow

```
   load chromosome
        ↓
   scroll the cursor with ←/→ arrows OR click any panel
        ↓
   spot a region where the sim_mat shows a clear triangle
   AND |Z| spikes
   AND per-sample lines split cleanly into bands
        ↓
   click in the |Z| panel near the spike → cursor lands there
        ↓
   examine the L3 contingency (K=2..K=6 K-means concordance)
        ↓
   if it looks like a candidate: enter candidate mode
   (#candidateModeBtn or 'c' hotkey) and draft the boundaries
   (f/b for prev/next L2; the new candidate's
   start_bp / end_bp populate from the L2 envelope under cursor)
        ↓
   commit the candidate → it joins state.candidateList
   with source='manual', confirmed=true
        ↓
   move to page2 to deep-dive, karyotype_tier to karyotype-review,
   boundary_refinement to refine boundaries, etc.
```

## Key hotkeys

| key | action |
|-----|--------|
| `←` / `→` | step cursor by `state.stepMode` (default 1 window) |
| `Shift+←` / `Shift+→` | jump 20 windows |
| `n` / `p` | prev/next L2 (or L1 if `state.travelMode === 'L1'`) |
| `g` | toggle G-panel popup (Karyotype / Inheritance / Manual / auto / lineages tabs) — see `specs_done/SPEC_g_panel_unified_groups.md` |
| `f` / `b` | candidate-mode: flip resolution / nudge boundary |
| `c` | candidate-mode toggle / commit |
| `j` | jump-to prompt (enter bp or window index) |
| `E` / `F` | (in boundary_refinement boundaries) override left / right boundary |
| `B` / `R` / `A` | (in boundary_refinement) save / reset / auto-propose |

See `page1/hotkeys.js` for the canonical list.

## Color modes (lines panel)

Click the `#linesColorModeSelect` (or open the G-panel) to change
the per-sample color:

| mode | source | when to use |
|------|--------|------------|
| `family` | hatchery family id | spot family-confounded bands |
| `regime` | per-sample regime call (g0/g1/g2) | once a candidate is karyotype-locked |
| `kmeans` | per-L2 K-means labels | exploration default |
| `theta_pi` | θπ per sample | needs `per_sample_theta_pi` layer |
| `ghsl` | GHSL haplotype divergence | needs `ghsl_panel` layer |
| `het_rate` | per-sample heterozygosity | needs `dosage_chunks` layer |
| `residual` | per-fish residual-Z | spot outlier samples |
| `manual_group` | user-defined manual group | after lasso / click-tracking |
| `candidate` | active candidate's K-means | when a candidate is focused |
| `lineage` | per-L2 dominant lineage (golden-angle palette) | always available; see `specs_done/SPEC_distant_band_concordance_fish_trajectory.md` |

## L3 panel — the three render modes

Three sub-views accessible via `data-l3k` buttons + the `K=3+6`
button:

| mode | what it shows |
|------|---------------|
| `K=3` | coarse split into {REF, HET, INV}-like bands |
| `K=6 ⚠` | sub-resolves into nested haplotype clusters — **⚠ do NOT interpret as six biological regimes by default**; use as diagnostic/substructure layer |
| `K=3+6` | both stacked side-by-side — useful for spotting whether K=6 sub-clusters are coherent (real substructure) or noise |

Plus an orthogonal toggle (the `het` checkbox per
`specs_done/SPEC_l3_het_dosage_coloring.md`): when on, the L3
mini-PCA dot fills come from per-sample het rate (cold blue →
neutral → warm red) instead of K-means band color. The K-cluster
**halo** on tracked dots stays K-cluster-coloured so you can spot
"fill ≠ halo" = K-means / het disagreement.

## L2-sweep auto-promote

Toggle the `#l2SweepToggle` checkbox in the toolbar. When ON, every
chromosome load runs `runL2SweepInheritance(state)` over every
usable L2 envelope and auto-promotes the L2s that pass **6 gates**
(see `specs_done/SPEC_l2_sweep_inheritance.md` for the full rule):

1. NOT DISMISSED (per-chrom localStorage dismissed-set)
2. NOT ALREADY in another candidate
3. silhouette ≥ 0.30
4. min band size ≥ 5 samples
5. ≥ 2 inheritance groups touching
6. ≥ 100 kb away from any existing candidate

Auto-promoted candidates land in `state.candidateList` with
`source='auto_l2_sweep'`, `confirmed=false`. They appear in the
review UI with a dashed outline + 🤖 prefix; they do NOT
participate in inheritance pills until confirmed. See
`specs_done/SPEC_review_surfaces_auto_and_lineages.md` for the
review surfaces.

## Fish-set linkage modal

Pick a fish-set (via `🔍 trace` button or the upcoming lasso) then
click `🔗 linkage` in the lines header to open the modal. Shows
per-candidate purity:

- **`best_purity`** — fraction of fish-set members in the dominant
  K-band of each candidate
- **`is_strong_link`** — `best_purity ≥ 0.7 AND n_in_best_band ≥ 5`
- Strong-link candidates sorted to top; export-TSV button

See `specs_done/SPEC_lasso_inheritance_backgrounds.md` for the
purity formula and TSV format.

## Candidate vertical band highlights

Default ON. Each confirmed candidate paints a faint vertical
rectangle on the lines panel in mb-space (palette stable across
zoom; toggle persists to localStorage). See
`specs_done/SPEC_lines_panel_candidate_bands.md`.

Auto-promoted (unconfirmed) candidates are NOT painted — that's
the `confirmed: true` discipline.

## Panel resizing

Drag the bottom edge of any panel (sim / Z / lines / PCA / L3) to
resize. Heights persist to localStorage. Useful for focusing on a
particular panel (e.g. drag L3 to take 60% of the screen when
inspecting cluster concordance).

## Session restore

Reload the page — page1 replays everything cached in IndexedDB:
- Chromosome JSONs you previously dragged in
- Enrichment files
- The last-active chromosome marker
- The active candidate's id (if it was confirmed)

So you can close the browser tab mid-session and pick up exactly
where you left off.

## Cross-page hand-offs

When you commit a candidate or change `state.candidate`:

- **page2** shows the per-candidate deep-dive (~15 sub-panels)
- **karyotype_tier** shows the karyotype rows + 14-axis tier grid
- **boundary_refinement** lets you refine the boundary zones
- **sv_evidence** loads SV calls clustered around boundaries
- **annotation_cockpit** annotation cockpit highlights this candidate on the
  chromosome strip

All of these read `state.candidate` from the cross-atlas slot.

## Common gotchas

1. **Empty cluster cache.** If page2 / karyotype_tier / boundary_refinement feel slow on
   first open, it's because page1's cluster-cache hasn't been
   warmed for this chromosome yet. Just open page1 first; the
   cache fills as you scrub.

2. **Layer-status indicator chips.** The `[data-th-layer]` chips
   (θπ) and `[data-gh-layer]` chips (GHSL) only turn 🟢 when the
   matching layer is in `state.layersPresent`. If you've loaded
   the precomp but a chip is still ⚪, drag-drop the missing
   enrichment file.

3. **"K=6 ⚠ shows 6 biological regimes!"** No it doesn't. K=6 is a
   diagnostic substructure layer. Real biology lives at K=3 unless
   you have explicit independent evidence for higher-K structure
   (e.g. nested inversion detection on nested_inversion_detector).

4. **Drag-drop doesn't work.** Check that you're dragging into the
   page1 main area, not the topbar. The topbar's drop handler is
   different (it handles scope picker changes, not file uploads).

5. **"Color by family doesn't color the lines."** Per the
   `linesColorMode` validator, if the active mode's source layer is
   absent, the mode falls back to `kmeans`. Check the
   `linesColorModeSelect`'s disabled-option states.

## What page1 does NOT do

- **It does NOT classify** — the 14-axis Tier classification grid
  lives on `karyotype_tier` and reads `state.data.final_classification`
  (cluster-side, R-pipeline output).
- **It does NOT call breakpoints to base-pair resolution** — boundary_refinement
  refines into **boundary zones** (the default verdict); exact
  breakpoints require junction-level evidence and aren't claimed
  here.
- **It does NOT compute popstats live** — popstats's track stack uses
  a live server (POST /api/popstats/*). Page1 only reads the
  precomp.
- **It does NOT run the v3.4 banding pipeline** — that's page22's
  job. Page1 is the discovery scrubber; page22 ships the regime
  catalogue.

## Related specs

In `specs_done/`:
- `SPEC_band_track_extraction_and_l3_single_band_rows.md` (parent
  band-track spec; L1/L2 envelope construction + K-means band
  semantics)
- `SPEC_l2_sweep_inheritance.md` (the 6-gate auto-promote)
- `SPEC_g_panel_unified_groups.md` (the `g` hotkey popup)
- `SPEC_lines_panel_candidate_bands.md` (vertical highlights)
- `SPEC_lasso_inheritance_backgrounds.md` (linkage modal)
- `SPEC_l3_het_dosage_coloring.md` (the het toggle)
- `SPEC_distant_band_concordance_fish_trajectory.md` (lineage +
  band-trace duo)
- `SCHEMA.md` (the schema reference for `state.data` envelope, all
  loaded layers)

In `specs_todo/`:
- `SPEC_page1_candidate_mode_ui.md` (HANDOFF 2 detailed mode —
  pending)

## Per-page contract

`docs/generated/page_contracts/page1/PAGE_CONTRACT.md` has the
machine-readable + human-readable contract — capabilities,
required layers, interactions, hotkeys, outputs, commit policy.

## Cohort discipline

This page operates on the **226-sample pure C. gariepinus hatchery
cohort**. Do NOT load F1 hybrid data, do NOT load C. macrocephalus
wild data into the same atlas instance — three cohorts never
conflate. Use the comparative pages (cross_species_breakpoints / multi_species_cockpit) for
cross-species comparisons.
