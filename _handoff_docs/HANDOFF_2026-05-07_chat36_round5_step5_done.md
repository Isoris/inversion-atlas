# HANDOFF — page17 stats profile MIGRATED + cross-page state bridge; 5 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 5)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-5 section. Earlier handoffs
(rounds 5 step 1-4) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page17 (stats profile) is migrated.** A synthesis-stage page that
auto-derives ~7 statistical rows about inversion-associated genomic
features (cross-species permutation test, repeat-flank Spalax check,
fusion-fission, markerability, etc.) from the candidate list +
cross-species data. **The synthesis figure for the manuscript:** "what
is statistically special about inversion regions?"

The chat-33 stub already had ~939 LOC of body extracted from legacy
(lines 28420-29306). This round refactored it for atlas-router
compatibility AND introduced the **first cross-page state bridge**
(page17→page18) so page17 can call page18's `_mpDeriveAutoPanel()` to
compute the marker-tier breakdown row of the stats table.

```
atlases/inversion/pages/catalogue/
├── page17.js                       994 LOC ← refactored in-place + state bridge
└── page17/
    └── _state.js                    15 LOC ← _pageState + setter (page17's own)
```

**Verifications passed (386/386 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- `tests/test_discovery_page1.js`: **103/103** unchanged.
- `tests/test_discovery_page2.js`: **58/58** unchanged.
- `tests/test_catalogue_page3.js`: **19/19** unchanged.
- `tests/test_catalogue_page17.js`: **34/34** — NEW (replaces stale chat-33 test).
- `tests/test_catalogue_page18.js`: **46/46** unchanged.
- `tests/smoke_discovery_page1_round4.mjs`: **33/33** unchanged.
- `tests/smoke_discovery_page2_round5.mjs`: **24/24** unchanged.
- `tests/smoke_catalogue_page3_round5.mjs`: **29/29** unchanged.
- `tests/smoke_catalogue_page17_round5.mjs`: **20/20** — NEW. Mount
  empty + populated, `_pageState` live-binding, `_spDeriveAllRows()`
  via `_pageState`, state bridge to page18 verified.
- `tests/smoke_catalogue_page18_round5.mjs`: **20/20** unchanged.

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` page17: added `_label` ("14 stats profile") + `_doc`.
- `manifest.json` page17: label "page 17" → **"stats profile"**;
  stage "catalogue" → **"synthesis"** (matching legacy `data-stage="synthesis"`).

### Step 1 — page17.js refactored in-place

Same Python AST-aware patcher as page18 round-5-step-4:
- Replaced `const state = window.state ?? {}` with proper imports.
- Added 4 imports:
  - `_pageState`, `_setActiveState` from `./page17/_state.js`
  - `_esc` from `../../shared/page1_data_helpers.js` (18 sites)
  - `_mpDeriveAutoPanel` from `./page18.js` (was typeof-guarded)
  - `_setActiveState as _setPage18State` from `./page18/_state.js`
    (for the cross-page state bridge)
- State shim injection: 7 functions got `const state = _pageState;`.
- Replaced `renderStatsProfilePage()` with state-aware variant that
  calls BOTH `_setActiveState(state)` AND `_setPage18State(state)`.
- Added `mount`/`unmount`/`_buildLegacyState`.

### Step 2 — Cross-page state bridge (NEW pattern)

Page17 calls page18's `_mpDeriveAutoPanel()` to compute the marker-tier
breakdown. `_mpDeriveAutoPanel` reads page18's `_pageState`. If page17
mounts but page18 doesn't, page18's `_pageState` is null and the call
throws (caught gracefully but degrades the row).

**Solution:** page17's mount also calls page18's `_setActiveState(legacyState)`
with the SAME legacy state object. Both pages read the same shape
(`candidateList`, `crossSpecies`, `_markerPanel`); page17 doesn't
mutate either, so sharing is safe.

Page17's unmount deliberately does NOT clear page18's state — if page18
is currently mounted (or will be), it manages its own state.

### Step 3 — page17/_state.js (NEW, 15 LOC)

Same shape as the other pages.

### Step 4 — Tests

- `tests/test_catalogue_page17.js`: 34 assertions including
  cross-page import verification (`page18._mpDeriveAutoPanel` is callable).
- `tests/smoke_catalogue_page17_round5.mjs`: 20 assertions including
  populated-candidate stats table render and `_spDeriveAllRows()` via `_pageState`.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **page1/page2/page3/page18 modules** — completely unchanged (page17
  IMPORTS from page18 but doesn't modify page18's source).
- **`shared/page1_data_helpers.js`** — unchanged (`_esc` was added in
  round 5 step 2).
- **`_csGetSyntenyBlocks` / `_csPermutationTest`** — runtime-guarded
  cross-species helpers; will land naturally with page16/16b migration.
- **Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 19, 21,
  page_overview, page_sv_evidence** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.

---

## Migration progress so far (5 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| page3 | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| page17 | catalogue (synthesis) | ✅ step 5 (single file + bridge) | ~1009 | 34+20 |
| page18 | catalogue (synthesis) | ✅ step 4 (single file) | ~984 | 46+20 |

**Total assertions: 386/386 across 10 test runs.**

**Pages remaining (17 of 22):** page4, 5, 6, 7, 8, 9, 10, 11, 12, 15,
16, 16b, 19, 21, page_overview, page_sv_evidence.

---

## Architectural note: cross-page state bridges

Page17→page18 is the first migrated example of one page reading
another's state. The pattern (`page17.mount` calls `page18._setActiveState`
with the same state object) works because both pages read the same
shape and page17 doesn't mutate.

For pages that mutate state, this pattern would need rethinking —
probably a shared registry-managed state slot rather than per-page
`_pageState`. That decision is part of the toolkit-registry-vs-cache
question Quentin deferred to end-of-migration.

---

## What to do NEXT

**Quentin's call.** Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **page21** | catalogue | 721 | pre-extracted body — same refactor pattern as 17/18 |
| **page12** | discovery | 1008 | 18 TODOs — substantial work |
| **page16, page16b** | comparative | 2400+ each | multi-species cockpit; **would resolve `_csGetSyntenyBlocks` and `_csPermutationTest`** |
| **page8, 9, 15, 19, page_overview** | various | <105 each | tiny stubs; quick router-wiring rounds |
| **page4, 6, 7, 11** | review | 122-301 | review-stage pages |
| **page_sv_evidence** | review | 148 | SV evidence review |

The **page17/18 pair is now properly wired** — synthesis-stage
manuscript figures are accessible through the modular shell. Logical
next priorities depending on goal:

- **Manuscript figure completeness** — page16/16b (multi-species
  cockpit) is the most synthesis-relevant remaining; landing it would
  also resolve the cross-species cs* helpers.
- **Quick wins / coverage** — tiny stubs (8/9/15/19/page_overview)
  can be batched in a single round.
- **Catalogue completion** — page21, page9 if you want the catalogue
  group fully migrated before moving to discovery/comparative/review.

---

## Three-cohort discipline (CRITICAL — never violate)

Quentin's standing instruction:

1. **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome
   assembly paper only.
2. **226-sample pure *C. gariepinus* hatchery cohort on LANTA** —
   current inversion atlas work.
3. **Pure *C. macrocephalus* wild cohort** — future paper.

---

## Communication preferences

Terse, direct, signal-not-flattery. Pushes back precisely when wrong.
PhD on LANTA HPC, manuscript v19→v20 targeting Nature Communications.

Quentin's chat-36 strategic guidance:
- *"Migrate page by page and only then make sure everything is wired
  to the toolkit registry vs Atlas state because we will have to
  decide what will be kept in cache versus in data from registry."*
- *"For the next page its maybe page 3 but it is not in the discovery
  folder we will renumber the page indexes at the complete end."*
