# HANDOFF — marker_panels marker panels MIGRATED; CATALOGUE GROUP 100% COMPLETE; 9 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 9)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-9 section. Earlier handoffs
(rounds 5 step 1-8) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page10 (marker panels) is migrated.** A catalogue-stage page that
renders one card per candidate inversion regime, showing tier
(HIGH/MEDIUM/LOW), expected accuracy, per-regime marker counts
(g0/g1/g2), Tm range + multiplex spread, and (when marker_catalogue +
marker_primers layers also loaded) a per-marker table. Source: legacy
lines 57837-58043 (verbatim helper + render).

The chat-33 stub used the **same factory pattern as overview**
(`wirePage10(state) → { renderPage10, renderMarkerPage }`) with
closure-captured state. Migration follows the round-5-step-8
playbook: keep the factory verbatim, add the standard atlas-router
lifecycle alongside, share `_pageState` between both surfaces.

```
atlases/inversion/pages/catalogue/
├── marker_panels.js              326 LOC ← refactored in-place (was 244)
└── marker_panels/
    └── _state.js           18 LOC ← _pageState + setter
```

**Verifications passed (567/567 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- 9 unit tests: 103+58+19+14+**25**+34+46+41+18 = **358**
- 9 smokes: 33+24+29+22+**26**+20+20+20+15 = **209**

🎉 **CATALOGUE GROUP IS 100% MIGRATED.** All 6 catalogue/synthesis
pages are done: catalogue, confirmed_carousel, marker_panels, stats_profile, marker_readiness, annotation_cockpit,
overview (stats_profile/18/overview live under pages/catalogue/
but the manifest tags them synthesis-stage).

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` marker_panels: added `_label` ("marker panels") +
  long `_doc` documenting the full render contract (tier badges,
  per-regime marker counts, Tm range, multiplex spread, per-marker
  table when catalogue+primers loaded, interpretation block).
- `manifest.json` marker_panels: label "page 10" → **"marker panels"**.
  Stage stays "catalogue" (correct).

### Step 1 — marker_panels.js refactored in-place (244 → 326 LOC)

Same playbook as overview round 5 step 8 (factory + new lifecycle
alongside):
- Added `import { _pageState, _setActiveState } from './marker_panels/_state.js';`.
- Inside `wirePage10(state)`: prepended `if (state) _setActiveState(state);`
  so the factory's closure-captured state stays in sync with the
  module-level `_pageState`.
- **Did NOT modify** the factory body itself (137 LOC of verbatim
  legacy render code is unchanged).
- Added new direct exports:
  - `export function renderPage10(state)` — sets `_pageState` then
    invokes `wirePage10(_pageState).renderPage10()`. The pattern
    re-creates closures per render, which matches what cross-module
    callers do anyway, and keeps the verbatim legacy semantics.
  - `export function renderMarkerPage(state)` — legacy alias delegating
    to `renderPage10`.
  - `export async function mount(root, atlasState, registry)` — builds
    legacyState (with chrom-precomp data + candidateList), sets
    `_pageState`, calls `renderPage10`, stashes
    `atlasState.inversion._page10State`.
  - `export async function unmount(root)` — clears `_pageState`.
- **Kept** `export default wirePage10` (chat-33 default export).

**Why preserve the factory?** Same reason as overview: the chat-33
factory contract is the only API some callers may use. The factory
body (137 LOC of verbatim legacy render) is unchanged, so any
behavioural test that worked before keeps working.

### Step 2 — marker_panels/_state.js (NEW, 18 LOC)

Same shape as the other pages.

### Step 3 — Tests

- `tests/test_catalogue_page10.js`: replaced (was a stale chat-33
  test that imported from the wrong path
  `../inversion_catalogue/marker_panels.js`). New version: 25 assertions
  covering BOTH new + legacy surfaces. **All chat-33 behavioural
  cases preserved verbatim** (empty-layers subtitle + HTML, missing
  DOM tolerated, layer-present-but-zero-summaries empty state). Plus
  new direct-render assertions, factory propagates to `_pageState`.
  **25/25**.
- `tests/smoke_catalogue_page10_round5.mjs`: NEW (~225 LOC). Full
  mount/render/unmount lifecycle. Empty-layers mount yields
  `#page10Subtitle` = "(no marker layer loaded)" + `#page10Content`
  innerHTML contains "No marker panels loaded". **Populated mount
  with synthetic marker_panel_summary** (single HIGH-tier candidate
  with 7 markers, 94.5% accuracy, g0/g1/g2 split, Tm range
  58.3-60.9°C) renders a real card whose innerHTML contains the
  candidate id, "HIGH" badge, "94.5%" accuracy, "LG12" chrom, and the
  "Marker catalogue not loaded" detail-block fallback. Subtitle
  contains "1 panel" + "HIGH 1". `renderPage10(state)` callable
  directly. Backward-compat factory smoke verifies
  `wirePage10({...}).renderPage10` and `renderMarkerPage` alias still
  work. Unmount clears `_pageState`. **26/26**.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **page1/page2/catalogue/confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/overview modules** — completely unchanged.
- **`shared/page1_data_helpers.js`** — unchanged.
- **The verbatim legacy render body** (137 LOC inside `wirePage10`) —
  zero changes. Only the factory header (`_setActiveState(state)` injection)
  and the new external exports are added.
- **Pages 4, 6, 7, 8, 11, 12, 15, 16, 16b, 19, sv_evidence,
  help** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.

---

## Migration progress so far (9 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 567/567 across 18 test runs.**

**Pages remaining (13 of 22):** page4, 5, 6, 7, 8, 11, 12, 15, 16,
16b, 19, sv_evidence.

🎉 **CATALOGUE GROUP COMPLETE.** All catalogue + synthesis pages
migrated. The remaining work is split across:
- **Discovery** (4 pages remaining): page8, 12, 15, 19
- **Comparative** (3 pages remaining): help, 16, 16b
- **Review** (5 pages remaining): page4, 6, 7, 11, sv_evidence

---

## Architectural notes

**Factory + new lifecycle pattern is now repeatable.** Page_overview
(round 5 step 8) and marker_panels (this round) both used the chat-33 factory
pattern. Both migrations followed the same recipe: prepend
`_setActiveState(state)` at factory entry, add direct exports +
mount/unmount alongside, share `_pageState` between surfaces. Cost:
~80 LOC of new lifecycle scaffolding; benefit: zero breakage for any
caller using the chat-33 surface.

**Closure-captured-state pages need closure re-creation per render.**
Unlike confirmed_carousel/17/18/21 (which read state once on render via
`_ackEnsureState()` or similar accessor), marker_panels and overview's
factory closures capture state at factory-call time. The new
`renderPage10(state)` direct entry handles this by calling
`wirePage10(_pageState).renderPage10()` — re-creating closures with
the live state. This is one extra factory invocation per render,
which is negligible for HTML-only renders. If a future closure-based
page does heavy per-render work, an alternative would be to refactor
the body to accept state as an arg — but for these two pages, the
factory body is verbatim legacy and we don't want to touch it.

---

## What to do NEXT

**Quentin's call.** Catalogue is done; the remaining frontier is
discovery, comparative, and review. Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **page12** | discovery | 1008 | 18 TODOs — substantial; closes the next-largest discovery page |
| **cross_species_breakpoints, multi_species_cockpit** | comparative | 2400+ each | multi-species cockpit; **would resolve `_csGetSyntenyBlocks`, `_csPermutationTest` (stats_profile), AND likely `computeTrackedLinkageProjection` (annotation_cockpit)** |
| **page8, 15, 19** | discovery | <50 each | tiny stubs; quick router-wiring rounds |
| **help** | comparative | 34 | tiny help-page stub |
| **page4, 6, 7, 11** | review | 122-301 | review-stage pages |
| **sv_evidence** | review | 148 | SV evidence review |

Logical next priorities:

- **Discovery group completion** — page12 is the substantial discovery
  page; page8, 15, 19 are tiny. Tackling page12 first leaves the
  stubs as a single quick batch.
- **Comparative cockpit** — cross_species_breakpoints/multi_species_cockpit is the most ambitious
  remaining; resolves the most runtime guards across stats_profile + annotation_cockpit.
- **Stub batch** — help, 8, 15, 19 are all tiny. Could batch in one
  round if Quentin's "one at a time" directive permits.
- **Review group** — 5 pages, all 122-301 LOC. Manageable in a few rounds.

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
