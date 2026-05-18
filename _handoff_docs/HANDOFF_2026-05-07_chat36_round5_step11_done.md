# HANDOFF — cross_species_breakpoints cross-species breakpoints MIGRATED; stats_profile guard-resolution unblocked; 11 of 22 pages done

**Date:** 2026-05-07 (chat ~36, round 5 step 11)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-11 section. Earlier handoffs
(rounds 5 step 1-10) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page16 (cross-species breakpoints) is migrated.** Comparative-stage
cockpit for chromosome-scale rearrangements between Cgar and Cmac,
derived from a wfmash 1-to-1 alignment of the two haplotypes
(cs_breakpoints_v1 schema, output of STEP_CS01_extract_breakpoints.py).
Each breakpoint renders both species' coordinates, a syntenic-block
linking line, and the flanking repeat-element density on both species
(drawing from boundaries-page TEfull JSONs already loaded into
`state.repeatDensity`). Spalax-style enrichment of all_TE at
breakpoints is the manuscript hook.

**Strategic value: stats_profile guard-resolution unblocked.** Page16 owns
`_csGetSyntenyBlocks` (legacy line 1488) and `_csPermutationTest`
(legacy line 1791), previously runtime-guarded in stats_profile (synthesis
stats profile) via `typeof X === 'function'`. Round 5 step 5 noted
these would land naturally with cross_species_breakpoints migration. **This round makes
them explicit ES exports.** A follow-up round can promote stats_profile's
runtime guards to imports.

The chat-33 stub had ~2556 LOC of body extracted from legacy lines
20971-21114 (constants + IO/state) + 23717-26025 (cross-species
runtime) + 28367-28419 (`_csBuildPermResultHtml`). **0 explicit
exports**, 50 top-level helpers using bare `state.X` references
(no top-level `state` declaration; no first-arg pattern). Same
shape as stats_profile/marker_readiness — full AST-shim-injection refactor.

```
atlases/inversion/pages/comparative/
├── cross_species_breakpoints.js              2750 LOC ← refactored (was 2556)
└── cross_species_breakpoints/
    └── _state.js            26 LOC ← _pageState + setter
```

**Verifications passed (691/691 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- 11 unit tests: 103+58+32+19+14+25+34+46+41+18+**40** = **430**
- 11 smokes: 33+24+29+29+22+26+20+20+20+15+**23** = **261**

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` cross_species_breakpoints: added `_label` ("cross-species
  breakpoints") + long `_doc` documenting the cs_breakpoints_v1
  pipeline, six-panel layout, manuscript hook (Spalax-style all_TE
  enrichment), stats_profile guard-resolution context, and the three-cohort
  discipline reminder.
- `manifest.json` cross_species_breakpoints: label "page 16" → **"cross-species breakpoints"**.
  Stage stays "comparative" (correct).

### Step 1 — cross_species_breakpoints.js refactored in-place (2556 → 2750 LOC)

Same playbook as stats_profile/18 (rounds 5 step 4-5):

1. **Header replaced**: rewrote the `TODO_MISSING markers` block as
   "RESOLVED 2026-05-07 round 5 step 11" documenting each marker's
   resolution status. Added imports for `_pageState`/`_setActiveState`
   from `./cross_species_breakpoints/_state.js` and `_esc` from
   `../../shared/page1_data_helpers.js`.

2. **AST shim injection** (`/home/claude/work/patch_page16.py`):
   reverse-walked all 50 top-level `function NAME(args) { ... }`
   declarations, brace-matched the body (string/comment-aware),
   and injected `\n  const state = _pageState;` after the opening
   `{` of each function whose body references bare `state` AND
   doesn't already declare `state` locally AND doesn't take `state`
   as its first arg. **28 of 50 functions got the shim**; the other
   22 are pure utility helpers that don't reference `state`
   (e.g., `_isCrossSpeciesJSON(data)`, `_csEventTypeOf(bp)`).
   File grew by 784 chars (28 × ~28 chars per shim).

3. **Explicit ES exports appended at end** (the chat-33 stub had 0
   explicit exports). 27 named exports across four logical groups:
   - **Constants**: `CROSS_SPECIES_LS_KEY`, `CROSS_SPECIES_TOOL`,
     `CROSS_SPECIES_FLANK_DEFAULT_BP`, `CS_EVENT_DEF`.
   - **Render entries**: `_renderCrossSpeciesPage` (main),
     `_renderCrossSpeciesToolbar/Catalogue/Focus/Synteny/Dotplot/FocalVsBg`.
   - **Cross-page helpers** (stats_profile guard targets):
     `_csGetSyntenyBlocks`, `_csPermutationTest`, `_csComputeSynteny`,
     `_csSyntenyEdgesByChrom`, `_csInversionContexts`,
     `_csBuildPermResultHtml`.
   - **IO helpers**: `_isCrossSpeciesJSON`, `_storeCrossSpecies`,
     `_persistCrossSpecies`, `_restoreCrossSpecies`, `_clearCrossSpecies`.
   - **Hover/event-wiring helpers**: `_wireCsBpHoverOnCanvas`,
     `_wireCrossSpeciesKeys`.

4. **Lifecycle + state-aware wrapper appended**: `mount(root, atlasState,
   registry)`, `unmount(root)`, `_buildLegacyState(atlasState)`, and
   `renderCrossSpeciesPage(state)` (sets `_pageState` then delegates
   to `_renderCrossSpeciesPage()`).

**TODO_MISSING resolution:**

- **`_esc`** (×61 unguarded uses) — RESOLVED via import from
  `shared/page1_data_helpers.js` (added round 5 step 2 for page2).
  All 61 uses now resolve to the shared helper.
- **`_getRepeatDensity`** (×3 sites at lines 494/826/1080) —
  KEPT as runtime guard (`typeof _getRepeatDensity === 'function' ?
  _getRepeatDensity(chrom) : null`). Lives at legacy line 14477
  (page2/repeat_density territory). Graceful degradation when not
  loaded.
- **`setCur`, `drawZ`, `drawSim`, `drawLinesPanel`, `drawWinSumStrip`** —
  KEPT as runtime guards. Each has a single typeof-guarded call site
  triggering a cross-panel re-render after a cs-bp click jumps the
  scrubber. Page1 NOW exports all four (`drawSim`, `drawZ`,
  `drawLinesPanel`, `setCur`), but promoting these to imports would
  couple cross_species_breakpoints to page1's module load order. Runtime guards preserve
  graceful degradation when page1 isn't mounted. (`drawWinSumStrip` is
  not defined in legacy at all — optional hook.)
- **`window.popgenDotplot`, `window.popgenFocalVsBg`** — KEPT as
  runtime guards. External vendor libs.

**Why preserve all the underscore-prefixed bodies?** Same reason as
stats_profile/18: legacy callers reference `_renderCrossSpeciesPage()` etc.
directly; the underscore-prefixed exports stay; the new non-prefixed
`renderCrossSpeciesPage(state)` is purely additive.

### Step 2 — cross_species_breakpoints/_state.js (NEW, 26 LOC)

Same shape as the other pages. Includes a documentation note about
the strategic value (stats_profile guard-resolution).

### Step 3 — Tests

- `tests/test_comparative_page16.js`: replaced (was a 62-LOC
  parse-check + dynamic-import + content-scanning stub from chat-33
  that imported from the wrong path
  `../inversion_comparative/cross_species_breakpoints.js`). New version: 40 assertions
  covering ALL 27 explicit exports (5 groups: lifecycle, render
  entries, cross-page helpers, IO helpers, hover/event-wiring,
  constants), `_state.js` live-binding, behavioural exercises:
  - `_isCrossSpeciesJSON` accept/reject paths (no state needed).
  - `renderCrossSpeciesPage(state)` sets `_pageState` as side effect
    even when render throws on missing DOM.
  - `_csGetSyntenyBlocks` reads via `_pageState` (live-binding):
    null when crossSpecies missing, null when synteny_blocks not
    array, returns the actual array when present.
  **40/40**.
- `tests/smoke_comparative_page16_round5.mjs`: NEW (~340 LOC). Full
  mount/render/unmount lifecycle with FakeContext canvas shim +
  insertAdjacentHTML polyfill (cross_species_breakpoints's ideogram building uses it).
  Empty-crossSpecies mount runs without throwing. **Populated mount
  with synthetic cs_breakpoints_v1** (single inversion bp on LG12,
  5-12 Mb, with prev_block + next_block on CMA01, all_TE flanking
  density 0.45 mean / 0.62 max, plus 2 synteny_blocks): mount runs
  without throwing, post-mount `_csGetSyntenyBlocks()` returns the
  2-block array (live-binding confirmed across module boundaries).
  **`_csComputeSynteny()` runs through verbatim body via `_pageState`
  shim and produces a non-null result** — direct proof that the
  AST-injected shim correctly threads state into the verbatim body.
  Unmount clears `_pageState`. **23/23**.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **All 10 previously-migrated page modules** — completely unchanged.
- **`shared/page1_data_helpers.js`** — unchanged. Page16's new
  `_esc` import resolves to the existing export.
- **Other shared/ modules** — unchanged.
- **The 50 verbatim helper bodies inside cross_species_breakpoints.js** — only the
  AST-injected `const state = _pageState;` shim was added (28 of
  50 functions). Everything else (constants, render bodies, IO
  helpers, etc.) is byte-identical to chat-33.
- **multi_species_cockpit** (multi-species cockpit, 2417 LOC) — separate page,
  separate _pageState. Will be migrated in a future round. Confirmed
  during audit: multi_species_cockpit does NOT own the cs* helpers — cross_species_breakpoints does.
- **stats_profile's runtime guards for `_csGetSyntenyBlocks` and
  `_csPermutationTest`** — kept in place. Promotion to imports is a
  follow-up task. The stats_profile unit/smoke tests still pass (stats_profile
  unchanged).
- **Pages 4, 5, 6, 7, 8, 11, 15, 19, sv_evidence, multi_species_cockpit** —
  only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — deferred.
- **`computeTrackedLinkageProjection`** — confirmed during audit:
  this function lives at legacy line 46751, inside page2-territory
  chunks (not cross_species_breakpoints/multi_species_cockpit). Will land when page2's missing
  helpers eventually surface. Not part of this round.

---

## Migration progress so far (11 of 22 pages)

| Page | Folder (logical stage) | Status | LOC | Tests |
|---|---|---|---|---|
| page1 | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| page2 | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| page12 | discovery | ✅ step 10 (verbatim + state-aware wrappers + lifecycle) | ~1189 | 32+29 |
| **cross_species_breakpoints** | **comparative** | **✅ step 11 (AST shim injection + explicit exports + lifecycle)** | **~2776** | **40+23** |
| stats_profile | synthesis | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | synthesis | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 691/691 across 22 test runs.**

**Pages remaining (11 of 22):** karyotype_tier, 5, 6, 7, 8, 11, 15, 16b, 19,
sv_evidence.

**Discovery group status:** 3 of 4 migrated (page1, page2, page12).
Only **page8 (23 LOC stub), page15 (42 LOC stub), page19 (23 LOC stub)**
remain in discovery — all sub-50-LOC stubs.

**Comparative group status:** 1 of 3 migrated (cross_species_breakpoints). Remaining:
**help (34 LOC stub), multi_species_cockpit (2417 LOC, multi-species cockpit)**.

---

## Architectural notes

**Cross-page guard resolution mechanic.** Page16 → stats_profile is the
first migration that closes a cross-page runtime-guard. The pattern
is repeatable: when page A's verbatim helpers are runtime-guarded
in page B, migrating A makes the helpers explicit exports, and B
can then promote its guards to imports. Future candidates of the
same shape will surface as more pages migrate (e.g., page2's
`computeTrackedLinkageProjection` will eventually unblock something).

**AST shim injection scaling.** The patcher used here (50 functions,
28 patched) is the same shape as stats_profile/18's (round 5 step 4/5).
Reverse-walk through matches keeps positions valid; brace-matching
with string/comment awareness handles JS quirks. The "already
patched" check needs to look for the actual injection (`)\s*\{\s*\n\s*const state = _pageState;`)
rather than substring matches because the docstring now mentions the
shim text.

**The "preserved underscore-prefix" pattern is mature.** Every
verbatim-body migration round (stats_profile, marker_readiness, annotation_cockpit, page12,
cross_species_breakpoints) keeps the chat-33 underscore-prefixed bodies AS exports for
backward compat with legacy direct callers, and adds non-prefixed
state-aware wrappers (`renderXxx(state)`) for the new lifecycle. Cost:
~5-30 LOC per page; benefit: zero breakage for any legacy caller.

**Render-path proof in smoke tests.** Page16's smoke confirms that
the AST shim works end-to-end: `_csGetSyntenyBlocks()` and
`_csComputeSynteny()` both run through the verbatim body via
`_pageState`, with the synteny_blocks array threading correctly into
the per-(gar,mac) tally logic. This is the strongest proof yet that
the AST injection preserves semantics. Future migrations of
substantial state-reading bodies (multi_species_cockpit, eventually) should use
the same proof pattern.

---

## What to do NEXT

**Quentin's call.** Reasonable next candidates:

| Page | Folder | LOC | Notes |
|---|---|---|---|
| **stats_profile guard promotion** | synthesis (post-migration cleanup) | ~5 LOC delta | promote stats_profile's runtime guards for `_csGetSyntenyBlocks` + `_csPermutationTest` to imports — payoff round for step 11 |
| **page8, 15, 19** | discovery | <50 each | tiny stubs; would close out discovery group entirely (3 quick rounds) |
| **multi_species_cockpit** | comparative | 2417 LOC | multi-species cockpit; no cross-page helper exposures, but second-largest unmigrated page |
| **help** | comparative | 34 LOC | tiny help-page stub |
| **karyotype_tier, 6, 7, 11** | review | 122-301 LOC | review-stage pages |
| **sv_evidence** | review | 148 LOC | SV evidence review |

Logical next priorities:

- **stats_profile guard promotion** — small, fast payoff round. Promotes 2
  runtime guards to imports, removes the `typeof X === 'function'`
  pattern in stats_profile, and demonstrates the cross-page guard-resolution
  mechanic end-to-end.
- **Discovery group completion** — page8, 15, 19 are all sub-50-LOC.
  Closing them out would mean the entire discovery group is migrated.
- **multi_species_cockpit** — most ambitious remaining pre-cleanup migration.
- **Review pages** — 5 pages, manageable.

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
