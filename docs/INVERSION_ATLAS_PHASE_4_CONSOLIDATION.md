# Inversion atlas — Phase 4 consolidation (24 → 5 pages)

**Status**: proposal. Authored 2026-05-23 after Phase 3 (popstats
extract) in response to user feedback: *"the atlas is so crowded ...
local pca > short range haplotype blocs > long range > classification
> and maybe some small stuff. but not like 27 pages and 178 shared
modules."*

This doc proposes Phase 4: aggressive page-collapse of the slimmed
inversion atlas into the user's 5-page vision. Unlike Phases 1-3
which **extracted** content to new atlases, Phase 4 **consolidates**
within inversion-atlas.

**Open question for the user (called out at the top)**: which of the
two consolidation strategies in §3 to follow. Strategy A is faster
but heavier per-page; Strategy B is more refactor-intensive but each
page is smaller. Recommendation: **Strategy A** for momentum, with
Strategy B as a v2 follow-up.

---

## 1. Current state (after Phase 3)

24 pages remaining in inversion atlas, across 7 stages:

| stage | pages |
|---|---|
| discovery (6) | `local_pca_dosage`, `candidate_focus`, `haplotype_regimes`, `pca_comparator`, `boundary_refinement`, `sv_evidence` |
| tooling (7) | `tree_panel`, `fingerprint_track`, `similarity_matrix`, `pca_scatter_per_window`, `dosage_heatmap`, `nested_inversion_detector`, `dosage_cluster_adaptive_k` |
| catalogue (6) | `window_summary_table`, `negative_regions`, `catalogue`, `confirmed_carousel`, `marker_panels`, `annotation_cockpit` |
| classification (2) | `karyotype_tier`, `marker_readiness` |
| synthesis (2) | `stats_profile`, `overview` |
| help (1) | `help` |

Plus ~150 shared modules and the band_tracking pipeline (Clusters 1–3,
which stay).

The user's vision: **five user-facing pages**, mirroring the actual
analysis workflow:

```
1. Local PCA                        (the discovery workbench)
2. Short-range haplotype blocs      (per-window candidate detection)
3. Long-range haplotype regimes     (genome-scale arrangement chains)
4. Classification                   (per-sample karyotype calls)
5. Small stuff                      (help, tools, fallbacks)
```

---

## 2. Proposed 24 → 5 mapping

### Page 1: Local PCA (no consolidation — stays as `local_pca_dosage`)

**2026-05-23 user revision**: Page 1 is too crowded with 10 absorbed
panels. The 9 utility pages listed below stay STANDALONE, not folded
into Page 1.

| Current page | Status |
|---|---|
| `local_pca_dosage` | **Page 1** — already a big page on its own; no absorption |
| `pca_comparator` | **stays standalone** |
| `dosage_heatmap` | **stays standalone** |
| `pca_scatter_per_window` | **stays standalone** |
| `similarity_matrix` | **stays standalone** |
| `fingerprint_track` | **stays standalone** |
| `nested_inversion_detector` | **stays standalone** |
| `dosage_cluster_adaptive_k` | **stays standalone** |
| `candidate_focus` | **stays standalone** |
| `boundary_refinement` | **stays standalone** |

These 9 utility pages are kept as a separate `tools` stage in the
manifest — accessible from the chrome's top nav but not the main
5-page workflow. They're focused inspectors that benefit from being
their own page (no tab-clutter on Page 1).

### Page 2: Short-range haplotype blocs (3 current pages → 1)

Per-window candidate detection — the dosage cluster / haplotype
short-range mode + structural-variant evidence.

| Current page | Becomes |
|---|---|
| `haplotype_regimes` (short-range mode) | **HOST** — already split via mode toggle |
| `sv_evidence` | inline tab: "structural-variant evidence" |
| `negative_regions` | inline tab: "negative regions" (counter-evidence) |

### Page 3: Long-range haplotype regimes (2 current pages → 1)

Genome-scale arrangement chains — the existing `haplotype_regimes`
long-range mode + the regime-level tree panel.

| Current page | Becomes |
|---|---|
| `haplotype_regimes` (long-range mode) | **HOST** — keeps the long-range view |
| `tree_panel` | inline tab: "per-regime tree" |

### Page 4: Classification (4 current pages → 1)

Per-sample karyotyping + marker QC + per-candidate stats.

| Current page | Becomes |
|---|---|
| `karyotype_tier` | **HOST** |
| `marker_readiness` | inline tab |
| `marker_panels` | inline tab |
| `stats_profile` | inline tab: "per-candidate cohort stats" |

### Page 5: Catalogue / export / small stuff (4 current pages → 1)

The master list + export + browse + help.

| Current page | Becomes |
|---|---|
| `catalogue` | **HOST** |
| `confirmed_carousel` | inline tab: "confirmed browser" |
| `annotation_cockpit` | inline tab: "annotation" |
| `overview` | inline tab: "overview dashboard" |
| `window_summary_table` | inline tab: "window summary" |
| `help` | side drawer (always available) |

**Note on `haplotype_regimes`**: appears in both Page 2 and Page 3.
The simplest implementation is *one route* for `haplotype_regimes`
with its existing mode toggle. The Page 2 / Page 3 split lives in
the toolbar header — pick "short" or "long" mode, the page renders
accordingly. From the user's mental model these are two pages; from
the implementation they're one page with a state slot. **Decision
needed**: should the mode-toggle stay one URL, or split into
`/short-range` and `/long-range` routes? Recommendation: **one URL,
mode toggle**, with the chrome treating them as two "pages" in the
top-bar nav for navigability.

---

## 3. Two consolidation strategies

### Strategy A — toolbar-tab collapse (fast, recommended)

Each host page gains a top-bar of tabs. Clicking a tab swaps the
content area to that subpage's render. The subpage modules **stay
where they are on disk** — they just become tabs instead of routes.

Pros:
- ~1 day per host page (5 days total).
- Existing tests, smoke checks, code paths all keep working.
- Easy to reverse if a tab really should be its own page after all.
- No JS module deletion / rewriting.

Cons:
- Each host page becomes BIG (multi-tab pages are conceptually heavier).
- Lazy-loading must be done per-tab or initial page-load gets slow.
- "Tab" UX != native page navigation — back button etc need attention.

### Strategy B — true page merge (slow, cleaner per-page)

Each host page is **rewritten** as one cohesive page that absorbs
its sub-pages' functionality directly. Sub-page modules get deleted
or refactored into shared helpers under the host.

Pros:
- Each final page is a tight, cohesive unit.
- Smaller codebase overall (no per-tab boilerplate).
- Better mental model for newcomers — one file per page.

Cons:
- ~1-2 weeks per host page (5-10 weeks total).
- Lots of test/code refactoring.
- High risk of breaking subtle functionality during merges.
- Pages 1 and 5 would each absorb 10+ pages — risk of accidental drop.

**Recommendation**: Strategy A this round. Promote Strategy B to "v2
polish" once the 5-page architecture is in active use and we can see
which tabs are actually used vs. which are dead weight (and should
be cut entirely, not merged).

---

## 4. Implementation plan (Strategy A, week-by-week)

### Week 1 — Page 1 (Local PCA)

1. Add a tab-bar component to `local_pca_dosage.html` (extends
   existing toolbar).
2. Lazy-mount each of the 9 sub-page modules when their tab is
   clicked.
3. Cross-link: clicking a candidate in the catalogue (Page 5) opens
   Page 1 in "candidate-focus" mode (just sets a state slot).
4. Update `manifest.json` — remove 9 entries, leave only
   `local_pca_dosage` as the public route.
5. Tests: existing per-page smokes keep running (modules still
   exist); add 1 host-page tab-switching smoke.

### Week 2 — Page 2 + Page 3 (Short / Long range)

Already mostly done — `haplotype_regimes` has a mode toggle. This
week:
1. Add `sv_evidence` and `negative_regions` as tabs under Page 2.
2. Add `tree_panel` as a tab under Page 3.
3. Top-bar nav shows two entries (Short / Long) but both route to
   `haplotype_regimes`; the route handler sets the mode slot.
4. Update `manifest.json` — 3 page entries collapse to 1
   (`haplotype_regimes`), with top-bar nav declaring the two
   user-facing entries.

### Week 3 — Page 4 (Classification)

1. `karyotype_tier` becomes the host.
2. Add `marker_readiness`, `marker_panels`, `stats_profile` as tabs.
3. Cross-link from Page 1's candidate-focus mode → "View
   classification" link to Page 4 + candidate slot.
4. Update `manifest.json`.

### Week 4 — Page 5 (Catalogue / export / small stuff)

1. `catalogue` becomes the host.
2. Tabs: `confirmed_carousel`, `annotation_cockpit`, `overview`,
   `window_summary_table`.
3. `help` becomes a side drawer (slide-in from right) available on
   every page.
4. Update `manifest.json` — `help` entry removed from pages array,
   added to a new `chrome.drawers` array.

### Week 5 — assembly + smoke

1. Re-run all atlas tests (4 atlases × N pages each).
2. Update `docs/MIGRATION_4_ATLASES.md` Phase 4 section.
3. Update `docs/ATLAS_PAGES_MAP.md`.
4. Browser smoke each of the 5 final pages.

**Total**: ~5 weeks for Strategy A on calendar; ~3-4 days of focused
work if uninterrupted.

---

## 5. Shared modules don't move in Phase 4

Shared modules in `inversion/shared/` stay where they are. The 24
current page modules also stay where they are on disk — they just
stop being routed as standalone pages.

If a sub-page is genuinely dead (no longer reachable through any
tab), delete the JS + HTML in Phase 5 cleanup.

---

## 6. Open questions for the user

1. **Strategy A vs B**: which? Recommendation: A.
2. **Page 2 / Page 3 routing**: one URL with mode toggle, or two URLs?
   Recommendation: one URL, two top-bar nav entries that both route
   to the same module.
3. **`sv_evidence` and `negative_regions`**: do they really belong
   under Page 2 (short-range blocs), or are they actually catalogue-
   level (Page 5)? Worth a 15-minute review before Week 2.
4. **`tree_panel`**: per-regime trees or per-candidate trees? If the
   former, it's Page 3. If the latter, Page 1's "candidate focus"
   mode.
5. **`stats_profile`**: belongs under Page 4 (classification, since
   stats inform calling) or Page 5 (catalogue, since stats describe
   each catalogue entry)? Recommendation: **Page 4**, because
   stats_profile is candidate-specific not corpus-wide.
6. **Phase 4 ordering after Phase 3**: should it run in parallel with
   Phase 5 (cross-atlas integration tests + replace relative imports
   with `cross_atlas_imports.resolveCrossAtlasRead()`)? They don't
   touch the same files. Both could ship in any order.
7. **Final final cleanup**: once Phase 4 ships, the 19 absorbed page
   `*.js` files are still on disk but unrouted. Delete? Or keep as
   "panels" that the host page imports? Recommendation: keep, with
   a one-line header comment explaining they're now sub-panels not
   standalone pages.

---

## 7. After Phase 4 — atlas summary (revised 2026-05-23)

```
atlases/
├── inversion/       5 main workflow pages + 9 standalone tools
│                     = 14 pages, ~150 shared modules
├── cross-species/   5 pages, 14 shared
├── evolution/       9 pages → 3 user-facing after its own future
│                     consolidation, 12 shared
└── popstats/        3 pages, 22 shared + 2 analysis
```

The total atlas is then:
- inversion: **5 main + 9 tools = 14 pages** (was 38; the 9 tools
  cluster under their own "tools" nav, separate from the main
  workflow nav)
- cross-species: 5 pages (may itself collapse to 3 after its own
  Phase-4-style review)
- evolution: 9 pages (may collapse to 3 — already partitioned by topic)
- popstats: 3 pages (already tight)

= 31 → ~25 user-facing pages across 4 atlases. The main-workflow
total is 5+5+3+3 = 16; the rest are standalone tools/utilities.

---

## 8. What this proposal does NOT do

- Decide whether `pca_comparator` (currently a separate page with
  good independent value) should genuinely fold into Page 1 or stay
  as a sibling. Recommendation in this doc is to fold; the user may
  feel differently.
- Decide the final UI/UX of each host page (tab bar vs. dropdown vs.
  segmented control). Visual design is downstream of structural
  collapse.
- Delete any module. Phase 4 is route-collapse, not file-delete.
- Move anything across atlas boundaries. All Phase 4 work is
  intra-inversion.

---

*End of proposal. Awaiting user decision on Strategy A vs B, and the
6 open questions in §6 before implementation begins.*
