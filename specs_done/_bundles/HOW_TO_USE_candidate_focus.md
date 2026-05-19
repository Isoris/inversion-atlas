# How to use candidate_focus — candidate focus

**Page**: `candidate_focus` · stage `discovery_2` · label "candidate focus"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)
**Naming**: this is tab 3 "candidate focus", **NOT** "cohort overview"
(an earlier draft mislabelled it — see
HANDOFF_2026-05-07_chat36_round5_step2).

## What this page does

Per-candidate detail deep-dive. Renders the full
**candidate metadata** page for one selected candidate — ~15
sub-panels composed by `renderCandidateMetadata` into a single
innerHTML write:

- Header
- Sigma profile
- K=6 nesting cluster table
- FIG_C07 ridgeline (`het_band_backbones` layer)
- FIG_C08 dosage heatmap (`arrangement_calls` layer)
- Per-band composition
- Ancestry confound (`cohort_sample_froh` + `ancestry_global_q`)
- Regime row
- Age origin
- Editable notes
- …and others composed via the 16 `*Html` builders

This is the second page most users open after local_pca_dosage — they pick a
candidate from local_pca_dosage's catalogue strip, then open candidate_focus to
characterize it.

## Where the pieces live

```
atlases/inversion/
├── pages/discovery/
│   ├── candidate_focus.html                          ← HTML shell + ~50 DOM ids
│   ├── candidate_focus.js                            ← main entry (4 orchestrators)
│   └── candidate_focus/
│       ├── _state.js                         ← _pageState (separate from local_pca_dosage's)
│       ├── _html_builders.js                 ← 16 candidate*Html functions
│       ├── _wires.js                         ← 7 wireCandidate* handlers
│       ├── _list.js                          ← 8 candidate-list helpers
│       └── _draw_panels.js                   ← 7 canvas painters
└── shared/
    ├── page1_data_helpers.js               ← cluster-cache + per-window dosage_chunks (shared with local_pca_dosage)
    ├── per_l2_cluster.js                   ← L2 recompute for active candidate
    ├── active_candidate.js                 ← persistActiveCandidateId
    └── page1_utils.js                      ← escapeHtml
```

## How to run

1. **Open local_pca_dosage first** (recommended) — local_pca_dosage warms the
   cluster-cache (`shared/per_l2_cluster.js`'s `ClusterCache`) for
   the active chromosome. Page2's per-window L2 recompute reads
   that cache; cold cache means slower first render but candidate_focus will
   recompute on miss.

2. **Pick a candidate** in one of these ways:
   - On local_pca_dosage, click a candidate rectangle on the |Z| strip
   - On catalogue's catalogue table, click a row's candidate id
   - Drag-drop a `candidates.json` to load a full list
   - The candidate list pane in the candidate_focus left sidebar
     (`#candListPane`) — click a row

3. The page renders the candidate-detail card. Status:
   `candidate {id} · {chrom} {start_bp..end_bp} Mb · K={K} · {n_samples} fish`.

4. The card is composed by `renderCandidateMetadata` —
   `innerHTML` is written **once** with all 16 builder outputs
   joined. Then `_wires.js` walks the DOM and attaches the 7
   `wireCandidate*` handlers.

5. **Navigate** between candidates:
   - Prev/Next buttons (`_navigateToCandidate`)
   - Click another row in the list pane

## Candidate-list management

The left sidebar (`#candListPane`) is the candidate-list inspector:

| action | what it does |
|--------|--------------|
| **Import** | drag-drop or pick a `candidates.json` to load |
| **Export** | download `state.candidateList` as JSON |
| **Registry** | (if wired) push to a registry-backed candidate registry |
| **Manuscript bundle** | bundle confirmed candidates + their metadata for the manuscript |
| **Clear** | wipe `state.candidateList` (with confirmation) |

Auto-promoted candidates (`source: 'auto_l2_sweep'`, `confirmed: false`)
appear in the list with a **dashed outline + 🤖 prefix**, sorted to
the bottom. Per
`specs_done/SPEC_review_surfaces_auto_and_lineages.md` — the
"machine output is gated until human confirmation" pattern.

## Confirm / unconfirm

The header carries a **Confirm** button. Click it to flip
`candidate.confirmed = true`. This:

- Drops the dashed outline / 🤖 prefix
- Adds the candidate to confirmed_carousel's confirmed carousel
- Makes the candidate visible in local_pca_dosage's inheritance pills strip
- Makes the candidate visible in local_pca_dosage's lines-panel vertical
  band highlights (per
  `specs_done/SPEC_lines_panel_candidate_bands.md`)

Unconfirm is symmetric.

## The 14-axis classification grid (karyotype_tier)

Page2 does NOT show the 14-axis tier grid — that's karyotype_tier's job.
The header has a `→ karyotype_tier (karyotype/tier)` button to jump.

But candidate_focus's `characterization` block (read from
`candidate.characterization` per SCHEMA §13) populates several of
those axes:

- `mechanism_class` (NAHR / NHEJ / MMBIR / unknown)
- `age_class` (young / intermediate / ancient / unknown)
- `burden_class` (enriched / neutral / depleted / unknown)
- ...

Edit them on karyotype_tier; they persist back to the candidate.

## Editable fields

| field | mechanism |
|-------|-----------|
| `candidate.notes` | textarea on the page; saves on blur |
| `candidate.age_origin` | dropdown |
| `candidate.regime` (when overriding the auto call) | dropdown |
| `candidate.completion.*` / `.characterization.*` | edit on karyotype_tier |

All edits mutate `state.candidateList` in-place and trigger
re-render. Persistence depends on which registry you're wired to
(localStorage, atlas-core resolver, or external registry).

## FIG_C07 ridgeline + FIG_C08 dosage heatmap

Two big "figure-quality" sub-panels:

- **FIG_C07** (ridgeline) — per-sample density traces stacked by
  K-means band, showing where each sample lands on PC1 across all
  windows in the candidate. Reads `het_band_backbones` layer.
- **FIG_C08** (dosage heatmap) — sample × marker dosage view
  scoped to the candidate's windows + markers. Reads
  `arrangement_calls` layer.

Both are canvas-rendered with the same painters used elsewhere in
the atlas:
- FIG_C07 → `fingerprint_track`-style strip
- FIG_C08 → `dosage_heatmap` painter (per
  `pages/discovery/dosage_heatmap/renderer.js`)

## Cross-page hand-offs

| destination | reason |
|-------------|--------|
| **local_pca_dosage** | inspect the candidate in context of the rest of the chromosome |
| **karyotype_tier** | karyotype rows + 14-axis tier grid |
| **boundary_refinement** | refine the boundary zones (E/F/B/R/A hotkeys; 9 scan radii) |
| **sv_evidence** | SV calls clustered around the breakpoints |
| **annotation_cockpit** | annotation cockpit shows this candidate's mb-strip |
| **confirmed_carousel** | (if confirmed) prev/next walk through confirmed candidates |

## Common gotchas

1. **"Page2 is slow on first open after chrom switch."** Page1
   hasn't been mounted yet → cluster-cache cold. Open local_pca_dosage first
   (just the tab; you don't have to interact with it). Cache fills
   in milliseconds.

2. **"FIG_C07 / FIG_C08 are blank."** The corresponding layers
   (`het_band_backbones`, `arrangement_calls`) aren't loaded.
   Drag-drop them. The page shows empty-state for each missing
   layer.

3. **"Notes I edit don't persist."** Persistence depends on the
   registry you're wired to. localStorage works out of the box.
   Atlas-core resolver-backed registries need the `Registry.write`
   half (see `specs_todo/SPEC_registry_write_and_page_isolation.md`)
   which is pending.

4. **"I confirmed a candidate but local_pca_dosage's lines don't show its
   band."** Refresh local_pca_dosage's lines panel by re-mounting (chrom switch
   or any cursor move triggers a redraw). Verify
   `candidate.confirmed === true` in the candidate-list pane.

5. **"Per-band counts are wrong for two-track candidates."** A
   two-track candidate has separate K=3 bandings per track
   (`active_band` per track). Make sure you've focused the right
   track via the `band filter` chip (karyotype_tier carries this UI).

## What candidate_focus does NOT do

- **It does NOT compute live** — every panel reads either
  pre-computed layer data OR local_pca_dosage's cluster-cache. No live
  recompute beyond the L2 cache hit/miss.
- **It does NOT auto-confirm candidates.** Confirmation is always
  a manual gesture (per `specs_done/SPEC_l2_sweep_inheritance §6`).
- **It does NOT classify on the 14 axes** — that's `karyotype_tier`'s Tier
  sub-view.
- **It does NOT show cohort-wide stats** — that's `stats_profile` (stats
  profile).

## Related specs

In `specs_done/`:
- `SCHEMA.md` §6 (the candidate JSON shape) + §13 (evidence
  framework — completion + characterization blocks) + §19 (14-axis
  tier classification carried in `final_classification.json`)
- `SPEC_l2_sweep_inheritance.md` §6 (the `confirmed: false`
  discipline)
- `SPEC_review_surfaces_auto_and_lineages.md` (the auto-candidate
  display rules)

In `specs_todo/`:
- `SPEC_page1_candidate_mode_ui.md` (HANDOFF 2 detailed mode would
  ship a "detailed" tab on candidate_focus alongside the current "default"
  tab — not yet wired)
- `SPEC_mendelian_inheritance_para_vs_peri_v1.md` (would add a
  Mendelian goodness-of-fit row to candidate_focus)

## Per-page contract

`docs/generated/page_contracts/candidate_focus/PAGE_CONTRACT.md`

## Cohort discipline

This page operates on the 226-sample pure C. gariepinus hatchery
cohort. Three cohorts never conflate.
