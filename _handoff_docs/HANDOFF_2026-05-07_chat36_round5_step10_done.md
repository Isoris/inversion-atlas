# HANDOFF — page12 local-PCA-θπ MIGRATED; 10 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 10)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-10 section. Earlier handoffs
(rounds 5 step 1-9) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page12 (local-PCA-θπ chromosome-wide diversity scanner) is migrated.**
The θπ sister of page1: same six-panel layout, but reads
`theta_pi_*` layers from `state.data` instead of dosage. Empty-state
placeholder visible until the R pipeline ships at least one
`theta_pi_per_window` / `theta_pi_local_pca` / `theta_pi_envelopes`
/ `cusum_theta` layer; first layer landing hides the placeholder and
reveals the relevant panels (`#thCusumHeroPanel`, `#thSimPanel`,
`#thZPanel`, `#thLinesPanel`, `#thAnchorStripPanel`, `#thPcaPanel`,
`#thTrackedSamplesPanelCompact`, `#thL3Panel`).

The chat-33 stub already had ~1008 LOC of body extracted from legacy
(lines 53045-54168), with all 8 helpers exported as state-as-first-arg
top-level functions. **All 13 TODO_MISSING markers were closure-scoped
false positives** (same finding as page1 round 2): every name
(`showHide`, `xToPx`, `kColor`, `q`, `colorFor`, `palette`, `has`,
`xAt`, `yAt`, `toX`, `toY`, `fillFor`, `yToPx`) has a local
`const`/`let` declaration inside its calling function. The chat-33
extractor produced the markers because it didn't model lexical scope.
This round resolved all 13 markers by deletion (header comments only;
bodies were already correct).

```
atlases/inversion/pages/discovery/
├── page12.js              1171 LOC ← refactored (was 1008)
└── page12/
    └── _state.js            18 LOC ← _pageState + setter
```

**Verifications passed (628/628 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- 10 unit tests: 103+58+**32**+19+14+25+34+46+41+18 = **390**
- 10 smokes: 33+24+**29**+29+22+26+20+20+20+15 = **238**

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` page12: added `_label` ("local PCA θπ") +
  long `_doc` documenting the six-panel layout, the four θπ-driving
  layer types, panel visibility wiring, the orthogonal-validation
  rationale (regions hit by BOTH dosage + θπ scrubbers are ~certainly
  real; θπ-only regions are sweeps / balancing selection invisible to
  genotype-based scrubbers), and the SCHEMA §22 reference.
- `manifest.json` page12: label "page 12" → **"local PCA θπ"**.
  Stage stays "discovery" (correct).

### Step 1 — page12.js refactored in-place (1008 → 1171 LOC, all additions appended at end)

- Added `import { _pageState, _setActiveState } from './page12/_state.js';`.
- **Did NOT modify** any of the 8 verbatim helpers (`_refreshThetaPiLayerStatus`
  through `_drawThPcaPanel`). Their bodies are unchanged from chat-33.
- **TODO_MISSING block**: replaced with a "RESOLVED" comment block
  documenting that all 13 markers are closure-scoped false positives
  with line-number references to the local declarations. Same lesson
  as page1 round 2.
- Added 8 state-aware wrapper exports (one per verbatim helper):
  `refreshThetaPiLayerStatus(state)`, `refreshThetaPiPanelVisibility(state)`,
  `drawThCusumHero(state)`, `drawThLinesPanel(state)`,
  `drawThSimMatPanel(state)`, `drawThZPanel(state)`,
  `drawThAnchorStripPanel(state)`, `drawThPcaPanel(state)`. Each sets
  `_pageState` then delegates to the underscore-prefixed verbatim,
  passing `state || _pageState || {}` so the verbatim still gets a
  defined argument.
- Added `renderPage12(state)` — convenience wrapper that runs all 8
  helpers in order (refresh layer status → refresh panel visibility →
  draw the 6 panels). Each helper call is wrapped in a try/catch with
  a console.warn fallback so one panel's render error doesn't block
  the others (matches the "graceful degradation" pattern from stats_profile/18).
- Added `mount(root, atlasState, registry)`, `unmount(root)`, and
  `_buildLegacyState(atlasState)`. `_buildLegacyState` uses page1's
  pattern as reference: cross-atlas slots (`candidate`, `candidateList`,
  `cur`) overlay onto `inv`; `layersPresent` is normalized to a `Set`
  (it must support `.has(name)` calls — the helpers depend on this);
  `data` is the chrom precomp from `inv.tracks[activeChrom]`; geometry
  caches (`_simGeom`, `_thSimGeom`, `_zGeom`) pass through.

**Why preserve the underscore-prefixed verbatim?** Same reason as
stats_profile/18: legacy callers reference `_refreshThetaPiLayerStatus()`
etc. directly. The underscore-prefixed exports stay; the new
non-prefixed wrappers are purely additive.

### Step 2 — page12/_state.js (NEW, 18 LOC)

Same shape as the other pages.

### Step 3 — Tests

- `tests/test_discovery_page12.js`: replaced (was a stale chat-33
  test that imported from the wrong path
  `../inversion_discovery/page12.js`). New version: 32 assertions
  covering exports (8 verbatim + 8 wrappers + 3 lifecycle), `_state.js`
  live-binding, no-document tolerance for the 3 helpers that check
  `typeof document === 'undefined'`, null-data tolerance for
  `_drawThCusumHero` (early return when `state.data.cusum_theta` is
  null), wrapper side-effects on `_pageState`, and graceful no-arg
  callable when `_pageState` is null. **32/32**.
- `tests/smoke_discovery_page12_round5.mjs`: NEW (~290 LOC). Full
  mount/render/unmount lifecycle with FakeContext canvas shim plus
  `document.querySelectorAll('[data-th-layer]')` polyfill (page12's
  `_refreshThetaPiLayerStatus` queries layer-status indicators by
  data-attribute). Empty-layers mount yields `#thetaPiEmpty` visible,
  all panels hidden, indicators marked "not loaded". **Populated mount
  with synthetic `cusum_theta` (3 carriers, range 1-50 Mb, mixed
  karyotypes) + `theta_pi_per_window`** yields `#thetaPiEmpty` hidden,
  `#thCtrlBar` shown (flex), `#thCusumHeroPanel` + `#thLinesPanel`
  shown (block), `#thSimPanel` still hidden (no `theta_pi_local_pca`),
  layer indicators marked "loaded", **and the verbatim ~225-line CUSUM
  hero render path executes — `#thCusumStripCanvas._ctx._ops > 0`**.
  This is the most ambitious render-path-confirmation assertion of
  any round so far. `renderPage12(state)` runs without throwing.
  Individual wrappers callable. Unmount clears `_pageState`. **29/29**.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **page1/page2/catalogue/confirmed_carousel/marker_panels/stats_profile/marker_readiness/annotation_cockpit/overview modules** — completely unchanged.
- **`shared/page1_data_helpers.js` / `shared/per_l2_cluster.js` /
  `shared/het_rate.js` / `shared/hungarian.js` / `shared/contingency.js`
  / `shared/kmeans.js` / `shared/color_helpers.js`** — unchanged.
  Page12's existing imports of these are correct.
- **The 8 verbatim ~1008-LOC helper bodies inside page12.js** —
  zero changes. Only the file header and the appended lifecycle
  block are new.
- **The TODO_MISSING_SLOT markers** (`state._simGeom`, `state._thSimGeom`)
  — kept as comments. These are ad-hoc geometry caches the legacy
  added imperatively, write-through paths from the renderers; the
  merge chat decides whether to formalize them in
  `shared/state.js` SLOT_REGISTRY. `_buildLegacyState` passes them
  through correctly.
- **Pages 4, 5, 6, 7, 8, 11, 15, 16, 16b, 19, sv_evidence** —
  only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.

---

## Migration progress so far (10 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| page12 | discovery | ✅ step 10 (verbatim + state-aware wrappers + lifecycle) | ~1189 | 32+29 |
| stats_profile | synthesis | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | synthesis | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 628/628 across 20 test runs.**

**Pages remaining (12 of 22):** page4, 5, 6, 7, 8, 11, 15, 16, 16b,
19, sv_evidence.

**Discovery group status:** 3 of 4 migrated (page1, page2, page12).
Only **page8, page15, page19** remain in discovery — all are tiny
stubs (<50 LOC each).

---

## Architectural notes

**State-as-first-arg + state-aware-wrappers pattern.** Page12's chat-33
shape — top-level exports each taking `state` as first argument — is
the cleanest refactor target encountered so far. The migration just
adds wrappers (one per verbatim helper) that set `_pageState` then
delegate. This is a third migration shape alongside:
- **single-file accessor** (confirmed_carousel/annotation_cockpit — single accessor function
  rewired to read `_pageState`)
- **factory + new lifecycle** (marker_panels/overview — factory verbatim,
  add direct exports alongside)
- **verbatim helpers + state-aware wrappers** (page12 — 8 helpers each
  get a wrapper)

**TODO_MISSING false-positive resolution.** Page12 had 13 TODO_MISSING
markers, all closure-scoped false positives (same as page1 round 2).
Always run the scope check before extracting/stubbing: a name flagged
in the header that has a local `const`/`let` declaration in every call
site is a false positive — delete the marker, leave the body alone.

**Canvas-shim test pattern.** Page12's smoke test uses the same
FakeContext shim as annotation_cockpit (round 5 step 6) and marker_panels (round 5 step 9),
extended with `document.querySelectorAll('[data-th-layer]')` for the
layer-status indicator query. The pattern is now reusable across any
canvas-rendering page.

**Render-path confirmation in smoke tests.** Page12's smoke is the
most ambitious yet: it doesn't just check that mount-then-unmount
runs cleanly, it confirms that **the verbatim ~225-line CUSUM hero
render path actually executes** by counting FakeContext draw ops on
`#thCusumStripCanvas`. This proves the new lifecycle is correctly
threading state into the verbatim body, not just doing a no-op
shortcut. Future migrations of substantial canvas-driven pages should
do the same.

---

## What to do NEXT

**Quentin's call.** Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **page8, 15, 19** | discovery | <50 each | tiny stubs; would close out the discovery group entirely (page8 + page15 + page19 in 1-3 quick rounds) |
| **cross_species_breakpoints, multi_species_cockpit** | comparative | 2400+ each | multi-species cockpit; **would resolve `_csGetSyntenyBlocks`, `_csPermutationTest` (stats_profile), AND likely `computeTrackedLinkageProjection` (annotation_cockpit)** |
| **help** | comparative | 34 | tiny help-page stub |
| **page4, 6, 7, 11** | review | 122-301 | review-stage pages |
| **sv_evidence** | review | 148 | SV evidence review |

Logical next priorities:

- **Discovery group completion** — page8, 15, 19 are all sub-50 LOC
  stubs. Closing them out (in 1-3 rounds depending on Quentin's
  one-page-at-a-time tempo) would mean the entire discovery group is
  migrated.
- **Comparative cockpit** — cross_species_breakpoints/multi_species_cockpit is the most ambitious
  remaining; resolves the most runtime guards across stats_profile + annotation_cockpit.
  Each is 2400+ LOC, so each gets its own round.
- **Review pages** — 5 pages, manageable in a few rounds.

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
