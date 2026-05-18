# How to use page4 — karyotype / tier

**Page**: `page4` · stage `classification` · label "karyotype / tier"
**Atlas**: `inversion` (the C. gariepinus 226-cohort atlas)

## What this page does

Per-candidate review — two sub-views toggleable via
`#candKaryoSubviewBar`:

1. **Karyotype tab** — per-sample regime breakdown. Each row is one
   fish showing its locked K=3 label (HOMO_1 / HET / HOMO_2 in the
   operational H-system, ordered by median PC1). Two-track
   candidates get track-membership pills per `active_band`.
   Sortable, filterable, band-filterable.
2. **Tier tab** — 14-axis classification grid. Renders an empty
   card until the cluster-side R pipeline ships
   `final_classification.json` (per `SCHEMA.md` §19).

This is the **first real review-stage page** — it's where you
verify the karyotype assignment that page1's K-means produced.

## Where the pieces live

```
atlases/inversion/
├── pages/review/
│   ├── page4.html                              ← HTML shell
│   ├── page4.js                                ← main entry + 4 chat-33 exports
│   └── page4/
│       ├── _state.js                             ← _pageState + karyoState (page-local UI)
│       ├── karyo_body.js                         ← karyotype body renderer + toolbar
│       ├── karyo_labels.js                       ← K=3..K=6 label vocab (HOMO_1/HET/HOMO_2; legacy "band N")
│       ├── karyo_rows.js                         ← per-sample row builder + sort/filter
│       └── tier_axes.js                          ← 14-axis schema + color palette + grid renderer
├── registries/data/pages.registry.json         ← page4 _doc (notes 4 registry mismatches)
└── shared/
    ├── page1_data_helpers.js                   ← groupColor (shared with page1)
    └── (no other page4-private shared modules)
```

## How to run

1. **Pick a candidate** — page4 reads `state.candidate` (cross-atlas
   slot). Routes that populate this slot:
   - page1: click a candidate rectangle on the |Z| strip
   - page2: prev/next in candidate-list
   - catalogue: click a row's id in the catalogue table
   - annotation_cockpit: navigate the annotation cockpit cursor

2. **Open page4** — the tab is in the classification stage group.

3. The page renders:
   - **Left**: candidate-list pane (`#candListPane`) with the
     standard 5 actions (Import / Export / Registry /
     Manuscript bundle / Clear)
   - **Right**: subview toggle bar + active subview's body

4. **Default subview = Karyotype**. Click `#candSubviewTierBtn` to
   switch to Tier.

## The Karyotype subview

Renders one row per fish, ordered by median PC1 across the
candidate's windows. Each row carries:

| column | content |
|--------|---------|
| color swatch | matches the K-means band paint from `lines_panel.js` |
| sample id | CGA-prefix or `ind` |
| **K=3 label** | one of `HOMO_1` / `HET` / `HOMO_2` (per `karyo_labels.js`) |
| Sigma | the band's robust-|Z| value at the candidate's central window |
| family | hatchery family id |
| F_ROH | sample's runs-of-homozygosity fraction |
| (optional) regime-call | if `fish_regime_calls.tsv` is loaded |
| (optional) ancestry-Δ12 | if `ancestry_global_q` is loaded |

For **two-track candidates**: extra columns show per-`active_band`
pills (e.g. "track A: HOMO_1 / track B: HET" for a sample that's
HOMO_1 on one band of the candidate and HET on another).

### Sort / filter

- Click any column header to sort by that column.
- The `#karyoFilterInput` filters by substring on sample id / family.
- The `#karyoBandFilter` chips filter by band (`only HOMO_1`,
  `only HET`, `only HOMO_2`, or `all`).

### K=3..K=6 label vocabulary

The label vocab is selectable via `#karyoLabelVocabSel`:

| vocab | labels | use case |
|-------|--------|----------|
| `K=3 (H-system)` | HOMO_1 / HET / HOMO_2 | default; matches manuscript |
| `K=3 (band 0..2)` | band 0 / band 1 / band 2 | numeric, language-agnostic |
| `K=4..K=6` | per `karyo_labels.js` extended vocab | for nested substructure |

Persists to localStorage. Affects display only — the underlying
`candidate.locked_labels` array stays integer.

## The Tier subview

The 14-axis classification grid, grouped into 6 sections (per
`SCHEMA.md` §19 + `pages/review/page4/tier_axes.js#TIER_AXES`):

### Existence (4 independent layers)

Each layer pass / fail / unknown:

- **Layer A** — local PCA evidence (sim_mat triangle, robust |Z|,
  λ ratio)
- **Layer B** — SV callers (DELLY, Manta) breakpoint evidence
- **Layer C** — GHSL within-sample haplotype divergence
- **Layer D** — Fisher genotype × breakpoint association

### Boundary

- **Boundary quality** — sharp / fuzzy / unknown

### Groups (3 axes)

- **Group validation** — VALIDATED / SUPPORTED / UNCERTAIN /
  SUSPECT / NONE
- **Internal structure** — clean / gradient /
  composite_undecomposed / unknown
- **Recombinant class** — none / gene_conversion / double_crossover
  / mixed / unknown

### Population (2 axes)

- **Family linkage** — multi_family / few_family / single_family /
  pca_family_confounded / unknown
- **Polymorphism class** — cohort_wide / lineage_restricted /
  family_restricted / unclassified

### Biology (3 axes)

- **Mechanism class** — NAHR / NHEJ / MMBIR / unknown
- **Age class** — young / intermediate / ancient / unknown
- **Burden class** — enriched / neutral / depleted / unknown

### Tier (synthesis axis)

- **Confidence tier** — T1 / T2 / T3 / T4 / unknown

Each cell of the grid is colour-coded by category. Empty cells
render as a placeholder until the layer ships.

### Editing the Tier values

Click any cell to open a dropdown of allowed values for that axis.
Edits write back to `candidate.characterization[axis_id]` (per
`SCHEMA.md` §13) — persistence via the same write path as Karyotype
edits.

`confidence_tier` is recomputed automatically from the other 13
axes (decision tree in `tier_axes.js`); manually overriding it is
allowed but the override flag is recorded.

## Cross-page hand-offs

| destination | reason |
|-------------|--------|
| **page2** | edit notes, regime, age_origin (the "detail card" fields) |
| **page11** | refine boundary zones; the Tier grid's `boundary_quality` axis reads page11's output |
| **sv_evidence** | drives Layer B (SV callers) — open to inspect |
| **stats_profile** | stats profile across all candidates, cohort-wide |
| **page1** | back to the chromosome scrubber to verify in context |

## Critical: registry mismatch flagged

Per the page4 `_doc` in `pages.registry.json`: the registered
`requires_layers` for this page are
**`candidate_sv_counts + candidate_boundaries`**, which look
misplaced. The page actually consumes:

- `state.data.final_classification` (sub-field, NOT a top-level
  slot; keyed by candidate_id for the Tier view)
- `state.data.classification` (the §9 cluster-emit layer per
  `SCHEMA.md` §9)
- the candidate's own `completion` + `characterization` blocks
  (per §13)

A **swap hypothesis** has been raised: page4's declared layers may
have been swapped with page11's declared
`candidate_final_class + candidate_breeding_card`. The registry is
NOT changed here per the architectural-discipline rule (defer to a
renumbering round).

If you see a "missing layer" error on page4, it's likely from this
mismatch — try loading the actually-needed layers
(`final_classification.json`, `classification.json`) regardless of
what the layer-status indicator says.

## Common gotchas

1. **"Tier grid is empty."** That's the empty-state — wait for the
   R pipeline to ship `final_classification.json`. The axis schema
   IS visible (the headers), but no values until the layer loads.

2. **"K=3 label looks wrong — sample X says HOMO_1 but visually it
   should be HET."** Check `karyoLabelVocabSel` — you might be in
   K=4 or K=6 mode where the labels are different. Switch back to
   K=3 H-system.

3. **"Sort by Sigma works inconsistently across two-track
   candidates."** Two-track candidates have per-track Sigma values.
   The default sort uses the sample's "primary" band's Sigma; use
   the band filter to scope the sort to one track at a time.

4. **"My Tier-grid edits don't persist."** Same as page2 —
   persistence depends on the registry-write path. localStorage
   works out of the box; atlas-core resolver-backed writes need
   `SPEC_registry_v2`'s Registry.write half (currently pending in
   `specs_todo/SPEC_registry_write_and_page_isolation.md`).

5. **"I see TODO_MISSING errors."** Page4's populated path hits 2
   TODO_MISSING helpers (`_renderCandidateKaryotypeBody`,
   `_renderTierAxesGrid`) which throw ReferenceError until a
   follow-up extraction round lands them. mount() wraps render in
   try/catch so a cold mount works.

## What page4 does NOT do

- **It does NOT compute the 14 axes** — the cluster-side R pipeline
  computes them. Page4 just renders + edits.
- **It does NOT confirm candidates** — confirmation happens on
  page2.
- **It does NOT refine boundaries** — that's page11.
- **It does NOT call SV evidence** — that's sv_evidence.

## Related specs

In `specs_done/`:
- `SCHEMA.md` (§9 cluster-emit `classification` + §13 evidence
  framework + §19 14-axis tier grid)
- `SPEC_review_surfaces_auto_and_lineages.md` (auto-candidate
  display rules — page4's left list pane sorts auto candidates to
  the bottom with dashed outline)
- `SPEC_l2_sweep_inheritance.md` §6 (the `confirmed` discipline
  that determines what's visible)
- `SPEC_sv_evidence_page.md` (Layer B's data source — SV callers)

In `specs_todo/`:
- `SPEC_mendelian_inheritance_para_vs_peri_v1.md` (would add a
  Mendelian goodness-of-fit row to one of the population axes)
- `SPEC_busco_4d_age_brackets.md` (would replace the `age_class`
  axis's categorical-only output with an absolute-years bracket)

## Per-page contract

`docs/generated/page_contracts/page4/PAGE_CONTRACT.md`

## Cohort discipline

226-sample pure C. gariepinus hatchery only. Three cohorts never
conflate.
