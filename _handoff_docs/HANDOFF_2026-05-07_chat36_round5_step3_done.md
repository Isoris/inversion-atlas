# HANDOFF — catalogue catalogue MIGRATED (breeding-export only); next round is Quentin's call

**Date:** 2026-05-07 (chat ~36, round 5 step 3)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-3 section. The
round-5-step-2 handoff (`HANDOFF_2026-05-07_chat36_round5_step2_done.md`)
is the prior round; only consult if you need candidate_focus context.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page3 (catalogue) is migrated AS FAR AS LEGACY ALLOWS.** The catalogue's
main rendering pipeline (`renderCatalogue`, `_buildCatalogueRows`,
`_filterCatalogueRows`, `_sortCatalogueRows`, `_paintCatalogueRow`,
TSV/MD/JSON/SVG/PNG/PDF gallery exports, regime-promote handlers) was
referenced 9 times in legacy via `typeof X === 'function'` guards but
**never defined**. Independently verified — there is no migration target
for those names.

The ONE catalogue-domain feature with real legacy implementation: the
**Turn-146 bulk breeding-card export** (1040 LOC closure across 17 helpers
+ 1 constant). That's what this round migrates.

```
atlases/inversion/pages/catalogue/
├── catalogue.js                       184 LOC ← entry: mount/unmount + render + init
└── catalogue/
    ├── _state.js                   18 LOC ← _pageState + setter (catalogue's own)
    └── _breeding_export.js       1106 LOC ← Turn-146 closure
                                            (17 helpers + _BREEDING_EXPORT_TIER_MODES)
```

**Verifications passed (266/266 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- `tests/test_discovery_page1.js`: **103/103** unchanged.
- `tests/test_discovery_page2.js`: **58/58** unchanged.
- `tests/test_catalogue_page3.js`: **19/19** — NEW (replaces the
  stale chat-33 21-LOC test that imported from a wrong path).
- `tests/smoke_discovery_page1_round4.mjs`: **33/33** unchanged.
- `tests/smoke_discovery_page2_round5.mjs`: **24/24** unchanged.
- `tests/smoke_catalogue_page3_round5.mjs`: **29/29** — NEW. Full
  mount/render/unmount lifecycle, `_pageState` live-binding,
  breeding-export wires bound, localStorage tier round-trip,
  mount-twice idempotency.

---

## What this round shipped

### Step 0 — confirmed catalogue-render functions don't exist in legacy

```
$ grep -nE 'function renderCatalogue|var renderCatalogue|let renderCatalogue|const renderCatalogue|renderCatalogue\s*=|window\.renderCatalogue' legacy/Inversion_atlas.html
(only `typeof renderCatalogue === 'function'` guards match)
```

Same outcome for `_buildCatalogueRows`, `_filterCatalogueRows`,
`_sortCatalogueRows`, `_paintCatalogueRow`,
`_exportCatalogueTSV/Markdown/JSON`, gallery exports, regime/promote
handlers. **Honest migration: don't pretend to migrate code that
doesn't exist.**

### Step 1 — registry + manifest fix

- `pages.registry.json` catalogue: added `_label` ("5 catalogue") and
  `_doc` documenting the legacy tab definition + this round's
  scope (breeding-export only).
- `manifest.json`: catalogue label "page 3" → **"catalogue"**.

### Step 2 — catalogue split into 2 sub-modules + new main

- `catalogue/_state.js` (18 LOC) — same `_pageState`/`_setActiveState`
  pattern as local_pca_dosage/candidate_focus, catalogue's own.
- `catalogue/_breeding_export.js` (1106 LOC) — 17 helpers + 1 constant.
  Bodies extracted byte-verbatim with the same patcher used for
  local_pca_dosage/candidate_focus:
  - Legacy `(typeof window !== 'undefined' && window.state) ?
    window.state : state` rewritten to `_pageState`.
  - `const state = _pageState;` shim injected in bodies that read
    bare `state`.
  - `export function` prefix on the 3 public names.
- `catalogue.js` main (184 LOC) — replaces 157-LOC chat-33 stub.
  - Re-exports breeding-export public set.
  - `renderCataloguePage(state)`: empty-state with hint message
    (since the catalogue renderer doesn't exist).
  - `initCataloguePage(state)`: calls `_wireCatalogueBreedingExportBtns`
    — the only catalogue-toolbar action with a working legacy
    implementation.
  - `mount(root, atlasState, registry)`: builds a legacy-shape state
    via `_buildLegacyState` (mirrors local_pca_dosage/candidate_focus), calls render +
    init.
  - `unmount(root)`: clears `_pageState`.

### Step 3 — tests

- `tests/test_catalogue_page3.js`: replaced the stale chat-33 stub
  (21 LOC, wrong import path, asserts removed `__MODULE_ID__` export).
  New version: 19 assertions covering sub-module split + main
  re-export identity (`catalogue.X === breeding.X`) + `_pageState` setter.
- `tests/smoke_catalogue_page3_round5.mjs`: NEW, 270 LOC, 29 assertions:
  - Module exports check
  - `mount()` empty-state DOM (`catEmpty` visible with hint,
    `catHead`/`catBody`/`catSelInfo` correctly empty)
  - `_pageState` live-binding observed across module boundaries
  - Breeding-export wires bound (3 buttons marked
    `dataset._wired = '1'`, correct event listeners)
  - localStorage tier round-trip (`pca_scrubber_v3.breeding_export_tier`
    persists when the user changes the tier dropdown)
  - Mount-twice idempotency (no double event listeners)
  - Direct `renderCataloguePage(state)` and `initCataloguePage(state)`
    calls
  - `unmount()` clears `_pageState`

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **local_pca_dosage / candidate_focus sub-modules** — completely unchanged this round.
- **`shared/page1_data_helpers.js`** — unchanged (catalogue's breeding-export
  closure is fully self-contained).
- **The catalogue table renderer + 11 unimplemented toolbar handlers**
  — these don't exist in legacy. See the audit log entry's "What this
  round did NOT migrate" table for the full inventory.
- **Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
  overview, sv_evidence** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — Quentin's
  workflow: defer until all pages are migrated.

---

## What to do NEXT

**Quentin's call.** Reasonable candidates from `atlases/inversion/pages/`:

| Page | Folder | Likely complexity | Notes |
|---|---|---|---|
| **confirmed_carousel** | catalogue | medium | Diversity / cohort overview; check chat-33 BATCH_3_NOTES.md |
| **marker_panels** | catalogue | unknown | check chat-33 BATCH notes |
| **stats_profile, 18, 21** | catalogue | unknown | check chat-33 BATCH notes |
| **overview** | catalogue | low? | non-chromosome-scoped overview |
| **karyotype_tier** | discovery? | unknown | does karyotype_tier even have a stub? |
| **sv_evidence** | ? | unknown | uncategorized |

Or: **separate task** — design and implement the 11 missing catalogue
handlers (catalogue table renderer, TSV/MD/JSON/gallery exports,
regime/promote). This is new development, not migration. Useful if
the catalogue table needs to actually work for the manuscript figures
or for daily workflow.

The migration recipe (round-5-step-3 section in
`PAGE_MIGRATION_RECIPE.md`) covers the catalogue pattern. The same shape
applies to any subsequent page: audit legacy lines, identify what's
real vs ghost, do a closure walk from the meaningful entry points,
split into sub-modules, build tests + smoke. The smart brace-matching
extractor at `/home/claude/work/build_page3_breeding.py` is reusable
(adapt the ORDER + EXPORT lists for the new page).

---

## Three-cohort discipline (CRITICAL — never violate)

Quentin's standing instruction:

1. **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome
   assembly paper only. NOT the inversion atlas's data.
2. **226-sample pure *C. gariepinus* hatchery cohort on LANTA** —
   current inversion atlas work. K-means clusters reflect hatchery
   broodline structure, NOT species admixture.
3. **Pure *C. macrocephalus* wild cohort** — future paper.

The inversion atlas mounts the 226-sample cohort. Anyone reading
this who treats the cohort as F₁ hybrids is wrong.

---

## Communication preferences

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications.
Terse and direct. Wants signal not flattery. Pushes back precisely
when outputs are wrong.

Quentin's chat-36 strategic guidance (controlling for the rest of the migration):
- *"Migrate page by page and only then make sure everything is wired
  to the toolkit registry vs Atlas state because we will have to
  decide what will be kept in cache versus in data from registry."*
  → Stay in the page-migration phase. Defer registry-vs-cache
    decisions until all pages are landed.
- *"For the next page its maybe page 3 but it is not in the discovery
  folder we will renumber the page indexes at the complete end."*
  → Page renumbering = final cleanup phase. Page3 is in
    `pages/catalogue/` — confirmed and migrated this round.
