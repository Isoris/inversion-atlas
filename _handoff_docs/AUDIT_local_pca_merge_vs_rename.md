# AUDIT — local-PCA pages merge & page-rename

**Date**: 2026-05-16
**User questions** (end-of-session):
1. Merge page1 (dosage) + page12 (θπ) + page15 (GHSL) into one
   local-PCA page with a toggle (normal / θπ / GHSL)?
2. Rename `page1`, `page2`, etc. to their actual names so navigation
   is easier?

---

## Q1: Merge the 3 local-PCA pages into one with a toggle?

### Recommendation: **No.** Build the 3-PCA comparator instead.

### Why not merge

- **The 3-PCA comparator is already specced** in
  `specs_todo/SPEC_local_pca_comparator.md` — Phase 1 ships 3
  side-by-side mini-panels with a shared cursor + hovered-sample
  state. That gives you cross-evidence comparison **without** losing
  the per-axis depth views. A toggle would let you see ONE axis at
  a time; side-by-side lets you see all THREE simultaneously, which
  is what you actually want for the manuscript ("region hit by all
  three is real biology" doctrine).
- **The 3 pages already share architecture**, but their painters are
  separate code paths:
  - page1: `drawSim` / `drawZ` / `drawLinesPanel` / `drawPCA` /
    `renderL3Panel` (per `pages/discovery/page1/{sim_panel, z_panel,
    lines_panel, pca_panel, l3_panel}.js`)
  - page12: `_drawThSimMatPanel` / `_drawThZPanel` /
    `_drawThLinesPanel` / `_drawThPcaPanel` / `_drawThAnchorStripPanel`
    + `_drawThCusumHero` (8 helpers in `page12.js`)
  - page15: layer-status chips + 4 new GHSL panels (shipped 56978ed)
  - A toggle would need a runtime dispatcher mapping the active
    layer to the right painter family — more code, more error
    surface, no functional gain over side-by-side
- **Empty-state visibility matters**. page12 + page15 currently
  render explicit "Required JSON layers from cluster-side R-pipeline"
  panels with chips showing which layers are loaded. If you merge,
  toggling to an unloaded layer would either:
  - Show the empty-state with chip indicators (defeats the
    "uncluttered" goal — you still see the layer-required panel)
  - Hide it entirely (now the user can't tell whether their R
    pipeline shipped the data — fails the "what's missing?"
    workflow)
- **Cross-page state pollution risk**: page1's `state.l2GroupCache`,
  `state.bandTraceFishSet`, `state.tracked`, etc. are tuned for
  dosage. θπ and GHSL might want different anchor windows, K modes,
  or per-L2 cluster caches. A toggle blurs those boundaries.
- **Migration cost**: every cross-ref to `page12` / `page15` in the
  registry / contracts / SPECs / HOW_TO_USE docs / handoffs breaks.
  ~25+ files touched for no clear win.
- **Three-cohort discipline**: each page currently declares its
  `requires_layers`. Merging means runtime dispatch decides what
  layers a "merged page" needs based on the toggle's current
  position — that erodes the static declared-requirements contract
  the registry depends on.

### What you actually want (likely)

A **prominent "compare 3" entry point** that lives on page1 /
page12 / page15 toolbars and routes to the comparator page. That
gives you the toggle-like brevity ("press one button to see the
other axes") without losing the per-axis depth pages.

### Phase 1 work to make this real

1. Ship the comparator page per `SPEC_local_pca_comparator.md` —
   new page `page_pca_comparator` in `discovery_2` stage. ~1-2 days.
2. Add a `[compare 3]` button to each of the 3 pages' toolbars
   that routes to the comparator. ~30 mins.
3. (Optional) Add a **stage-level pill** in the topbar that says
   "compare evidence axes" — visible only when on a local-PCA page.

If after Phase 1 you find yourself constantly toggling and the
comparator's side-by-side view isn't clearer than a per-page deep
dive, THEN consider the merge. Don't pre-commit to a merge before
knowing the comparator isn't enough.

---

## Q2: Rename `page1`, `page2`, etc. to their actual names?

### Recommendation: **Yes, eventually.** Stage as a slug migration starting with page22.

### Why renaming is right

- The numeric ids are opaque. You've said multiple times:
  - "I don't know what is what"
  - page21 was mislabelled "Manual karyotype groups" (corrected in
    its module header)
  - page5 was mislabelled "Multi-species comparison" (it's the help
    page; the actual multi-species cockpit is page16b)
  - The page4/6/7/11 swap-hypothesis registry mismatches partly
    come from the numeric confusion
- Self-documenting URLs reduce mental overhead: `/inversion#local_pca_z`
  is unambiguous; `/inversion#page1` requires lookup
- Easier code navigation: `pages/discovery/local_pca_z.js` beats
  `pages/discovery/page1.js` for grep + IDE jump

### Why this is HARD

Page IDs are everywhere. A `grep -rn "page1\|page2"` across the
repo would return thousands of hits. The high-impact surfaces:

| surface | what's keyed by `page<N>` | rename cost |
|---|---|---|
| **`manifest.json`** | 39 entries `id` field | 39 string edits |
| **`pages.registry.json`** | 40 entries (top-level keys) | 40 string edits + JSON re-validation |
| **Page directories** | `pages/discovery/page1.{html,js}` + `page1/` subdir | 39 dirs + 78 entry files renamed |
| **Page contracts** | `docs/generated/page_contracts/<id>/` | 38 dirs renamed |
| **SPECs** | cross-refs in `specs_done/` + `specs_todo/` | ~50+ references |
| **HOW_TO_USE docs** | `specs_done/_bundles/HOW_TO_USE_page<N>.md` (6) | 6 files renamed |
| **Per-stage READMEs** | `pages/<stage>/README.md` (6) + tables | ~50 table edits |
| **HANDOFFs** | `_handoff_docs/HANDOFF_*.md` (37 files) | hundreds of refs (leave most untouched; they're historical) |
| **CSS** | `#page1`, `main#page1`, `.page#page1.active` | ~30+ selectors per page |
| **DOM ids inside each page** | `#page1Header`, `#page1Content`, etc. | tens per page |
| **Tests** | `test_discovery_page<N>.js`, `smoke_discovery_page<N>_round5.mjs` | ~76 files renamed |
| **Atlas-core shell** | URL routing by `id` | needs alignment (separate repo) |
| **Legacy `Inversion_atlas.html`** | thousands of refs | **don't touch** — leave as historical |

### Staged migration plan (recommended)

Don't rename everything at once. Stage it:

**Stage 1: Add `slug` field to manifest, keep `id` as fallback** (1 day)

```json
{
  "id": "page1",
  "slug": "local_pca_dosage",
  "label": "local PCA |z|",
  "stage": "discovery",
  ...
}
```

- Atlas-core shell accepts both `#page1` and `#local_pca_dosage` for
  URL routing
- Per-page DOM, registry, contracts continue to use `id` internally
- New code uses `slug`; old code keeps working

**Stage 2: Per-page rename, one page at a time** (priority order)

User's stated priority: **page22 first** (haplotype regimes — "so
that we can work easily on the haplotype regime page later").

Per-page rename checklist:
1. Update `manifest.json` `id` + `slug` (keep slug as canonical)
2. Rename files: `pages/discovery/page22.{html,js}` →
   `pages/discovery/haplotype_regimes.{html,js}`; same for `page22/`
   subdir
3. Update CSS selectors: `#page22` → `#haplotype_regimes`
4. Update DOM ids inside the page
5. Rename `pages.registry.json` key
6. Rename `docs/generated/page_contracts/page22/` →
   `haplotype_regimes/`
7. Rename `tests/test_discovery_page22.js` → similar
8. Update `HOW_TO_USE_page22.md` references + filename
9. Update SPECs that reference `page22`
10. Update per-stage README tables

Per-page rename cost: ~2-4 hours of focused work, fully verifiable
via tests + grep.

**Stage 3: Bulk-rename remaining 37 pages** (~1-2 weeks gentle pace)

Same per-page recipe × 37. Done at the user's pace — no need to
rush. Each rename ships as its own PR for easy review + rollback.

**Stage 4: Drop `id` field, slug becomes canonical** (1 hour)

Remove the `id` fallback from atlas-core shell + manifest. Final
sweep of any remaining `page<N>` references.

### Suggested slug vocabulary

To keep migration consistent, the slug should match the page's
`label` (already in manifest.json) but lowercase + snake_case.
Examples:

| current id | label | proposed slug |
|---|---|---|
| `page1` | local PCA \|z\| | `local_pca_dosage` (more semantic than label) |
| `page12` | local PCA θπ | `local_pca_theta_pi` |
| `page15` | local PCA GHSL | `local_pca_ghsl` |
| `page2` | candidate focus | `candidate_focus` |
| `page22` | haplotype regimes | `haplotype_regimes` |
| `page4` | karyotype / tier | `karyotype_tier` |
| `page6` | popstats | `popstats` |
| `page7` | ancestry | `ancestry_per_window` |
| `page11` | boundaries | `boundary_refinement` |
| `page_sv_evidence` | SV evidence | `sv_evidence` (drop the `page_` prefix) |
| `page3` | catalogue | `catalogue` |
| `page9` | confirmed carousel | `confirmed_carousel` |
| `page10` | marker panels | `marker_panels` |
| `page17` | stats profile | `stats_profile` |
| `page18` | marker readiness panel | `marker_readiness` |
| `page21` | annotation cockpit | `annotation_cockpit` |
| `page8` | per-window summary table | `window_summary_table` |
| `page19` | negative regions catalogue | `negative_regions` |
| `page_overview` | overview | `overview` |
| `page16` | cross-species breakpoints | `cross_species_breakpoints` |
| `page16b` | multi-species | `multi_species_cockpit` |
| `page5` | help | `help` |
| `tree_panel` | tree panel | `tree_panel` |
| `fingerprint_track` | fingerprint track | `fingerprint_track` |
| `similarity_matrix` | similarity matrix | `similarity_matrix` |
| `pca_scatter_per_window` | PCA scatter | `pca_scatter_per_window` |
| `dosage_heatmap` | dosage heatmap | `dosage_heatmap` |
| `nested_inversion_detector` | nested detector | `nested_inversion_detector` |
| `dosage_cluster_adaptive_k` | dosage cluster | `dosage_cluster_adaptive_k` |
| `page_ancestry_scroller` | ancestry scroller | `fish_ancestry_scroller` |
| `polarize_msa_stacked` | polarize · MSA | `polarize_msa_stacked` |
| `haplotype_network` | haplotype network | `haplotype_network` |
| `polarize_synteny_vote` | polarize · synteny | `polarize_synteny_vote` |
| `age_divergence` | age + divergence | `age_divergence` |
| `mosaicism_leakage` | mosaicism / leakage | `mosaicism_leakage` |
| `inv_internal_substructure` | internal history | `inv_internal_substructure` |
| `layer_cleaning` | layer cleaning | `layer_cleaning` |
| `event_tree_relative_ordering` | event tree | `event_tree_relative_ordering` |
| `archaeology_synthesis_card` | archaeology card | `archaeology_synthesis_card` |

If you want different slug names, edit this table — the migration
recipe is the same regardless of slug choices.

### What to do tomorrow

If you want the page22 rename first (the haplotype-regimes page),
ship it as a single focused PR:
1. Stage-1 manifest slug field (small infrastructure change)
2. Page22 rename (one page at a time)

Both can land in the same PR as long as the slug field is
backward-compatible.

---

## TL;DR

| question | answer |
|---|---|
| Merge 3 local-PCA pages? | **No.** Build the comparator (Phase 1 of `SPEC_local_pca_comparator.md`) + add a "compare 3" button on each page. |
| Rename pages? | **Yes, eventually.** Add a `slug` field to manifest first; rename one page at a time. Start with page22 (haplotype regimes — your stated priority). |
| Add a Tooling tab (Q3)? | **Yes.** Add a `tooling` stage to `manifest.json` + re-stage the 7 utility cartridges (dosage_heatmap, tree_panel, fingerprint_track, similarity_panel, pca_scatter_per_window, nested_detector, dosage_cluster). Vertical-list UI needs atlas-core change. |

The three efforts are complementary — once renames are done, the
comparator page becomes `local_pca_comparator` (already that name
in its SPEC) and lives in the `tooling` stage alongside the other
utility cartridges.

---

## Q3: Add a Tooling tab containing utility pages?

### Recommendation: **Yes.** Re-stage 7 utility cartridges into a new `tooling` stage.

### Why this is right

The current `discovery_2` stage has **10 pages** (per
`pages/discovery/README.md` and the manifest):

- page2 — candidate focus (workflow / not a utility)
- page22 — haplotype regimes (workflow / not a utility)
- tree_panel — utility inspector
- fingerprint_track — utility inspector
- similarity_matrix — utility inspector
- pca_scatter_per_window — utility inspector
- dosage_heatmap — utility inspector
- nested_inversion_detector — utility inspector
- dosage_cluster_adaptive_k — utility inspector

The 7 cartridges are **side-inspector tools** the user opens when
they want to characterise a candidate, NOT primary discovery
workflow surfaces. page2 + page22 are real workflow steps
(per-candidate deep dive + the v3.4 banding pipeline runner).

Mixing them in one stage clutters the tab bar. The user identified
the same pain point with "per sample lines buttons must be more
compact" (2026-05-15) — the discovery stage already has too many
visual pills.

### The proposed Tooling stage

Stage definition (to add to `manifest.json` `stages[]`):

```json
{
  "id": "tooling",
  "label": "tooling",
  "order": 2.5,
  "_doc": "Utility / inspector cartridges. Open these to characterise a candidate, debug a layer, or compare evidence axes. Distinct from the discovery_2 workflow pages (candidate focus, haplotype regimes) which are primary review surfaces. Atlas-core shell may render this stage as a vertical list rather than horizontal pills if the stage label includes a layout hint (`tooling_vertical`?)."
}
```

Pages to re-stage from `discovery_2` → `tooling`:

| page id | label | reason it's a utility |
|---|---|---|
| `tree_panel` | tree panel | inspector — NJ tree on demand |
| `fingerprint_track` | fingerprint track | inspector — regime fingerprint on a focused candidate |
| `similarity_matrix` | similarity matrix | inspector — per-window sample×sample heatmap |
| `pca_scatter_per_window` | PCA scatter | inspector — per-window PC1×PC2 scatter |
| `dosage_heatmap` | dosage heatmap | inspector — sample × marker heatmap (this is what the user explicitly mentioned) |
| `nested_inversion_detector` | nested detector | inspector — 3-stratum nested inversion check |
| `dosage_cluster_adaptive_k` | dosage cluster | inspector — adaptive-K clustering inspection |

The remaining `discovery_2` pages stay where they are because they
ARE workflow:
- `page2` — candidate focus (the per-candidate deep dive)
- `page22` — haplotype regimes (the v3.4 banding pipeline runner)

### Vertical-list UI

The user asked for the Tooling tab to be a **vertical list**, not
horizontal pills. That's an atlas-core shell rendering change:

- Current: tab pills are horizontal in the topbar (per `atlas_chrome.css`)
- Proposed: when the active stage is `tooling`, render the page
  buttons as a vertical sidebar (similar to the discovery sidebar)

This requires:
- An atlas-core shell update — render different layouts per stage
- A stage-level hint in `manifest.json` `stages[]` entry — e.g.
  `"layout": "vertical_sidebar"`

**For TODAY's cartridge change**: re-stage the 7 utility pages into
a `tooling` stage. The shell will render them as standard horizontal
pills until the vertical-list UI ships (separate atlas-core PR).
Users still get the cleaner discovery_2 tab bar immediately.

### Migration cost

Small + safe:
1. Add `tooling` to `manifest.json` `stages[]` (1 line of JSON)
2. Update each of the 7 utility pages' `stage` field (7 edits)
3. Update `pages/discovery/README.md` to remove them from the
   `discovery_2` list + add a pointer to the new stage
4. Optionally create `pages/tooling/README.md` describing the
   utility-page convention

No directory renames, no DOM id changes, no SPEC re-writes — just
manifest re-staging.

### Future: the comparator + dosage-heatmap link

The 3-PCA comparator (per `SPEC_local_pca_comparator.md`, when it
ships) belongs in `tooling`:
- It's an inspector view, not a workflow page
- It's a "what does this window look like across all 3 evidence
  axes?" tool — exactly the utility-page pattern

Similarly, when we add a "show dosage heatmap for this candidate"
shortcut from page1 / page2 / page4 (per WIRE_AUDIT_page1.md
Group F), the destination is the Tooling stage's
`dosage_heatmap` page.

### What to do tomorrow

If you want all 3 audits to land together as the next PR:

1. **Q3** — re-stage the 7 utility pages into `tooling` (small,
   ~30 mins)
2. **Q2 (Stage 1)** — add the `slug` field to `manifest.json`
   schema, backwards-compat with `id` (~1 hour, infrastructure)
3. **Q2 (Stage 2.a)** — rename `page22` → `haplotype_regimes`
   (the page you said you want to work on next; ~2-4 hours of
   focused work)
4. **Q1 follow-up** — open a separate spec PR for the comparator
   if you want to add a "compare 3" button to each local-PCA page

Each one ships as its own commit on the same branch so they review
cleanly. The Tooling re-stage is the lowest-risk + immediate-visual-
improvement of the three, so I'd start there.

---

## References

- `specs_todo/SPEC_local_pca_comparator.md` — the 3-panel comparator design
- `_handoff_docs/WIRE_AUDIT_page1.md` — Group I lists the comparator
- `docs/generated/page_contracts/page1/PAGE_CONTRACT.md` — page1's
  panel architecture (the template the comparator clones)
- `atlases/inversion/manifest.json` — where the slug field would live
- `atlases/inversion/registries/data/pages.registry.json` — every
  page id keyed here too
