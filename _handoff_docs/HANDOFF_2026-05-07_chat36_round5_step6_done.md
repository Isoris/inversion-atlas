# HANDOFF — annotation_cockpit annotation cockpit MIGRATED; 6 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 6)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-6 section. Earlier handoffs
(rounds 5 step 1-5) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page21 (annotation cockpit) is migrated.** A catalogue-stage page that
renders a per-sample-lines canvas with cursor-driven candidate selection.
Each promoted candidate appears as a faint rectangle in mb-space; per-
sample PC1 trajectories drawn beneath, optionally colored by the active
candidate's K-means band assignment. ←/→ steps the cursor (Shift jumps
boundaries, Esc clears); digit keys 0-9 select a band of the candidate
under the cursor (state.tracked → linkage shading + linkage table panel
+ haplotype-annotation panel).

The chat-33 stub already had ~720 LOC of body extracted from legacy
(lines 46938–47616). This round refactored it for atlas-router
compatibility — same single-file refactor pattern as stats_profile (round 5
step 5) and marker_readiness (round 5 step 4).

```
atlases/inversion/pages/catalogue/
├── annotation_cockpit.js                       776 LOC ← refactored in-place
└── annotation_cockpit/
    └── _state.js                    16 LOC ← _pageState + setter (annotation_cockpit's own)
```

**Verifications passed (447/447 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- `tests/test_discovery_page1.js`: **103/103** unchanged.
- `tests/test_discovery_page2.js`: **58/58** unchanged.
- `tests/test_catalogue_page3.js`: **19/19** unchanged.
- `tests/test_catalogue_page17.js`: **34/34** unchanged.
- `tests/test_catalogue_page18.js`: **46/46** unchanged.
- `tests/test_catalogue_page21.js`: **41/41** — NEW (replaces stale chat-33 test).
- `tests/smoke_discovery_page1_round4.mjs`: **33/33** unchanged.
- `tests/smoke_discovery_page2_round5.mjs`: **24/24** unchanged.
- `tests/smoke_catalogue_page3_round5.mjs`: **29/29** unchanged.
- `tests/smoke_catalogue_page17_round5.mjs`: **20/20** unchanged.
- `tests/smoke_catalogue_page18_round5.mjs`: **20/20** unchanged.
- `tests/smoke_catalogue_page21_round5.mjs`: **20/20** — NEW. Mount
  empty + populated, `_pageState` live-binding, canvas draw path
  exercised, `_annoCockpitChromExtent` via `_pageState` verified.

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` annotation_cockpit: added `_label` ("annotation cockpit") +
  `_doc` documenting the legacy tab definition + line range provenance
  + the cursor / digit-key / band-pick UX.
- `manifest.json` annotation_cockpit: label "page 21" → **"annotation cockpit"**.
  (Stage stays "catalogue".)

### Step 1 — annotation_cockpit.js refactored in-place

Same single-file pattern as stats_profile/marker_readiness:
- Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
  with `import { _pageState, _setActiveState } from './annotation_cockpit/_state.js';`.
- Rewrote `_ackEnsureState()` to read from `_pageState` (was reading from
  `window.state`). It still lazy-inits `cockpitCursor` and falls back to
  a transient `{}` if no mount has happened — keeps pure helpers callable
  from tests without a mount.
- Rewrote `_annoCockpitChromExtent()` similarly (was the only other
  function reading state directly without going through `_ackEnsureState`).
- Renamed verbatim `function refreshAnnotationCockpit()` →
  `function _refreshAnnotationCockpit()` (underscore-prefixed legacy
  body, matching stats_profile/18 convention).
- Added state-aware `export function refreshAnnotationCockpit(state)`
  wrapper that calls `_setActiveState(state)` then delegates.
- Removed the chat-33 `__MODULE_ID__` export.
- Added `mount(root, atlasState, registry)`, `unmount(root)`, and
  `_buildLegacyState(atlasState)` (mirrors stats_profile/18 lifecycle, but
  builds a wider state shape: tracked, cockpitCursor, cockpitSelectedBand,
  candidates, candidates_detailed, activeMode, data).

**No `const state = _pageState;` shim injection was needed.** Unlike
stats_profile/marker_readiness, annotation_cockpit's body was already written to access state through
the local accessor pattern (`const _state = _ackEnsureState();` at the
top of each function). Once `_ackEnsureState` was rewired to read
`_pageState`, every consumer flowed through correctly.

### Step 2 — annotation_cockpit/_state.js (NEW, 16 LOC)

Same shape as stats_profile/_state.js and marker_readiness/_state.js.

### Step 3 — Tests

- `tests/test_catalogue_page21.js`: replaced (was a stale chat-33 test
  that imported from the wrong path `../inversion_catalogue/annotation_cockpit.js`
  and asserted removed `__MODULE_ID__`). New version: 41 assertions
  covering exports, helpers, constants, `_state.js` live-binding,
  `_ackBandColor` purity, `_annoCockpitCandidateAtCursor` cursor lookup,
  `_annoCockpitChromExtent` with chrom_len_bp + items fallback +
  null path, and `_ackEnsureState` lazy-init + idempotency.
- `tests/smoke_catalogue_page21_round5.mjs`: NEW (~270 LOC). Full
  mount/render/unmount lifecycle. Empty-state mount yields empty
  placeholder shown + body hidden (with a global stub for
  `_gatherActiveCandidatesForInheritance` returning `[]`). Populated
  mount with synthetic K=3 candidate + 7 fish + 3 windows yields
  body shown, canvas.width/height set, FakeContext._ops > 0.
  `refreshAnnotationCockpit(state)` callable directly. `_pageState`
  live-binding verified through `_annoCockpitChromExtent`. Unmount
  clears `_pageState`. **20/20**.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **page1/page2/catalogue/stats_profile/marker_readiness modules** — completely unchanged.
- **`shared/page1_data_helpers.js`** — unchanged. Page21 doesn't call
  `_esc` (the one shared helper that stats_profile picked up).
- **The 4 external runtime-guarded helpers**
  (`_gatherActiveCandidatesForInheritance`,
  `_wireCandidateHaplotypeAnnotations`,
  `candidateHaplotypeAnnotationsHtml`,
  `computeTrackedLinkageProjection`) — kept as `typeof X === 'function'`
  guards in the body. They will land naturally when page2 (candidate
  focus) lands the first three, and when the linkage projection
  helper gets promoted to `shared/`.
- **Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 19,
  overview, sv_evidence** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.

---

## Migration progress so far (6 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 across main + _state | 41+20 |

**Total assertions: 447/447 across 12 test runs.**

**Pages remaining (16 of 22):** page4, 5, 6, 7, 8, 9, 10, 11, 12, 15,
16, 16b, 19, overview, sv_evidence.

---

## Architectural notes

**Single-file refactor pattern is now a routine.** Page21 was the third
page in a row (after marker_readiness round-5-step-4 and stats_profile round-5-step-5)
that used the "extract verbatim body + add `_pageState` live-binding +
add atlas-router lifecycle" pattern. The pattern works cleanly for
pages with cohesive single-concern code under ~3000 LOC.

**Page21 confirmed a useful shortcut.** When a page's body already
accesses state through a single accessor (`_ackEnsureState()` here),
the refactor only needs to rewire that accessor. No per-function shim
injection was needed — saving the AST-walking step from stats_profile/18.
For future pages, check the accessor pattern first; if it exists, the
refactor is shorter.

**Runtime guards stay runtime guards.** Page21's 4 external helpers
(`_gatherActiveCandidatesForInheritance` etc.) are kept as runtime
guards because each call site already handles the missing case
gracefully. Same approach as stats_profile with `_csGetSyntenyBlocks` /
`_csPermutationTest`. They'll land naturally with page2 / cross_species_breakpoints /
multi_species_cockpit migration.

---

## What to do NEXT

**Quentin's call.** Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **page12** | discovery | 1008 | 18 TODOs — substantial work |
| **cross_species_breakpoints, multi_species_cockpit** | comparative | 2400+ each | multi-species cockpit; **would resolve `_csGetSyntenyBlocks`, `_csPermutationTest`, AND likely `computeTrackedLinkageProjection`** |
| **page8, 9, 15, 19, overview** | various | <105 each | tiny stubs; quick router-wiring rounds — could batch several in one round |
| **page4, 6, 7, 11** | review | 122-301 | review-stage pages |
| **sv_evidence** | review | 148 | SV evidence review |
| **marker_panels** | catalogue | TBD | catalogue completion |
| **help** | comparative | small (stub) | help-page stub |

Logical next priorities depending on goal:

- **Catalogue completion** — confirmed_carousel, marker_panels, overview would round
  out the catalogue group. overview is the smallest, marker_panels/9
  are medium.
- **Resolve cross-page runtime guards** — page2 (candidate focus deep
  dive) is already migrated, but the 3 helpers annotation_cockpit stubs
  (`_gatherActiveCandidatesForInheritance` etc.) live somewhere page2
  hasn't surfaced yet — likely they need extraction from legacy line
  41196+ into `shared/`.
- **Quick wins / coverage** — tiny stubs (page8/9/15/19/overview)
  can be batched in a single round.
- **Comparative cockpit** — cross_species_breakpoints/multi_species_cockpit is the most ambitious
  remaining; landing it resolves the most runtime guards across
  stats_profile + annotation_cockpit.

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
