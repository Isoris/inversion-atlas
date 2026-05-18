# HANDOFF — confirmed_carousel confirmed carousel MIGRATED; 7 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 7)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-7 section. Earlier handoffs
(rounds 5 step 1-6) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page9 (confirmed candidates carousel) is migrated.** A catalogue-stage
page that's a stub even in legacy: the HTML shell (#confirmedNavBar,
#confirmedNavPrev, #confirmedNavNext, #confirmedCandidateMeta,
#confirmedEmpty) has no JS handlers in legacy/Inversion_atlas.html. The
chat-33 stub preserved this no-op behaviour: empty-state placeholder
shown when no confirmed candidates; "carousel not yet wired" message
when there are confirmed candidates. This round refactored it for
atlas-router compatibility, preserving the verbatim stub semantics.

```
atlases/inversion/pages/catalogue/
├── confirmed_carousel.js              153 LOC ← refactored in-place
└── confirmed_carousel/
    └── _state.js          13 LOC ← _pageState + setter
```

**Verifications passed (483/483 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- 7 unit tests: page1 (103) + page2 (58) + catalogue (19) + confirmed_carousel (14) +
  stats_profile (34) + marker_readiness (46) + annotation_cockpit (41) = **315**.
- 7 smokes: page1 (33) + page2 (24) + catalogue (29) + confirmed_carousel (22) +
  stats_profile (20) + marker_readiness (20) + annotation_cockpit (20) = **168**.

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` confirmed_carousel: added `_label` ("confirmed carousel") +
  `_doc` documenting the legacy stub status (carousel JS does NOT exist
  in legacy/Inversion_atlas.html — confirmed by `grep confirmedNav`)
  and the deferred TODO_MISSING items for the full implementation.
- `manifest.json` confirmed_carousel: label "page 9" → **"confirmed carousel"**.
  Stage stays "catalogue".

### Step 1 — confirmed_carousel.js refactored in-place

Same accessor-shortcut pattern as annotation_cockpit (round 5 step 6):
- Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
  with `import { _pageState, _setActiveState } from './confirmed_carousel/_state.js';`.
- Renamed the legacy verbatim `function refreshConfirmedCarousel()` →
  internal `function _refreshConfirmedCarousel()`. Its single bare
  `state.candidateList` read becomes `(_pageState || {}).candidateList`
  via `const state = _pageState || {};` at function entry.
- Added state-aware `export function refreshConfirmedCarousel(state)`
  wrapper that calls `_setActiveState(state)` before delegating.
- Kept `export function initConfirmedCarousel()` as-is — it's a stub
  that does no state reads.
- Removed the chat-33 `__MODULE_ID__` export.
- Added `mount(root, atlasState, registry)`, `unmount(root)`, and
  `_buildLegacyState(atlasState)`. Mount calls both
  `refreshConfirmedCarousel` and `initConfirmedCarousel` (mirroring the
  legacy page-tab activation flow).

**Single bare state read** — the entire body had only one bare `state.X`
reference. Trivial refactor.

### Step 2 — confirmed_carousel/_state.js (NEW, 13 LOC)

Same shape as the other pages.

### Step 3 — Tests

- `tests/test_catalogue_page9.js`: replaced (was a stale chat-33 test
  that imported from the wrong path `../inversion_catalogue/confirmed_carousel.js`
  and asserted removed `__MODULE_ID__`). New version: 14 assertions
  covering exports, lifecycle entry-points, `__MODULE_ID__` removal,
  `_state.js` live-binding, no-document early-return safety,
  `initConfirmedCarousel` no-throw, and the side-effect that
  `refreshConfirmedCarousel(state)` sets `_pageState`. **14/14**.
- `tests/smoke_catalogue_page9_round5.mjs`: NEW (~165 LOC). Full
  mount/render/unmount lifecycle. Empty-state mount yields
  `#confirmedEmpty` visible, `#confirmedNavBar` + `#confirmedCandidateMeta`
  hidden. Populated mount with 2 confirmed + 1 unconfirmed candidate
  yields `#confirmedEmpty` repopulated with "2 confirmed candidates" +
  "Carousel rendering is not yet wired" placeholder text (verbatim
  legacy stub behaviour, the navBar stays hidden since the carousel
  isn't implemented). `refreshConfirmedCarousel(state)` callable
  directly. Unmount clears `_pageState`. **22/22**.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **page1/page2/catalogue/stats_profile/marker_readiness/annotation_cockpit modules** — completely unchanged.
- **`shared/page1_data_helpers.js`** — unchanged.
- **The TODO_MISSING items** (`_renderConfirmedCarousel`,
  `_wireConfirmedCarouselNav`, `renderCandidateFocus`) — kept as
  TODOs in the source comments. The full carousel was never
  implemented in legacy and is a fresh-write task, not a migration
  task. Will be picked up by a follow-up round once page2's
  candidate-focus renderer is more accessible.
- **Pages 4, 6, 7, 8, 10, 11, 12, 15, 16, 16b, 19,
  overview, sv_evidence** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.

---

## Migration progress so far (7 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 across main + _state | 14+22 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 across main + _state | 41+20 |

**Total assertions: 483/483 across 14 test runs.**

**Pages remaining (15 of 22):** karyotype_tier, 5, 6, 7, 8, 10, 11, 12, 15, 16,
16b, 19, overview, sv_evidence.

**Catalogue group status:** 5 of 6 catalogue pages migrated (catalogue,
confirmed_carousel, stats_profile, marker_readiness, annotation_cockpit). Only **marker_panels** + **overview**
remain in catalogue/synthesis. *(stats_profile and marker_readiness are tagged
"synthesis" in the manifest but still live under pages/catalogue/.)*

---

## Architectural notes

**Stub-preserving migration.** Page9 was always a stub in legacy. The
refactor preserves that stub behaviour exactly — the smoke test
verifies the populated-mount path still shows the "Carousel rendering
is not yet wired" placeholder. The full carousel is a fresh-write task
that requires page2's candidate-focus renderer to be exposed; that's a
separate decision deferred to a follow-up round.

**Accessor-shortcut continues to work for tiny pages.** Page9 had a
single bare `state.X` read inside one function. The refactor was
trivial: rename the verbatim function, prepend a `const state = _pageState || {};`
inside it, add the lifecycle. No AST-walking patcher needed.

---

## What to do NEXT

**Quentin's call.** Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **overview** | catalogue | 35 | Tiny stub — also empty in legacy. Pure router-wiring. **Would close out the catalogue group.** |
| **marker_panels** | catalogue | 244 | Substantial-but-quick. **Would close out the catalogue group.** |
| **page12** | discovery | 1008 | 18 TODOs — substantial work |
| **cross_species_breakpoints, multi_species_cockpit** | comparative | 2400+ each | multi-species cockpit; **would resolve `_csGetSyntenyBlocks`, `_csPermutationTest` (stats_profile), AND likely `computeTrackedLinkageProjection` (annotation_cockpit)** |
| **page8, 15, 19, help** | various | <50 each | tiny stubs; quick router-wiring rounds |
| **karyotype_tier, 6, 7, 11** | review | 122-301 | review-stage pages |
| **sv_evidence** | review | 148 | SV evidence review |

Logical next priorities:

- **Catalogue completion** — marker_panels + overview would finish the
  catalogue group entirely. overview is trivially small (legacy
  empty <div>), marker_panels is medium size.
- **Stub batch** — page8, 15, 19, help, overview are all
  sub-50 LOC; could batch in one round if Quentin's "one at a time"
  directive permits a stub batch.
- **Comparative cockpit** — cross_species_breakpoints/multi_species_cockpit is the most ambitious
  remaining; resolves the most runtime guards across stats_profile + annotation_cockpit.

---

## Three-cohort discipline (CRITICAL — never violate)

1. **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome assembly paper only.
2. **226-sample pure *C. gariepinus* hatchery cohort on LANTA** — current inversion atlas work.
3. **Pure *C. macrocephalus* wild cohort** — future paper.

---

## Communication preferences

Terse, direct, signal-not-flattery. PhD on LANTA, manuscript v19→v20
targeting Nature Communications. Quentin pushes back precisely when wrong.

Quentin's chat-36 directives:
- Migrate page by page; defer toolkit-registry-vs-cache decisions to end.
- Page renumbering at the complete end of all migrations.
