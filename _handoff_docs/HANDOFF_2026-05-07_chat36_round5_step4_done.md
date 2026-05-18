# HANDOFF — marker_readiness marker readiness panel MIGRATED; stats_profile is the natural next

**Date:** 2026-05-07 (chat ~36, round 5 step 4)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-4 section. Earlier handoffs
(rounds 5 step 1-3) only as reference.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page18 (marker readiness panel) is migrated.** A synthesis-stage page
that classifies promoted inversion candidates into 4 confidence tiers
for downstream PCR design — manuscript-relevant deliverable. Body was
already extracted by an earlier batch (~921 LOC, 30 functions, 6
constants); this round added the atlas-router lifecycle, refactored
the state pattern, and resolved the only cross-module dependency
(`_esc` from shared).

**Decision:** kept marker_readiness as a single file (no sub-module split). The
921 LOC body is cohesive (single concern: marker tier classification +
HTML render). Sub-module splits are justified at >3000 LOC across
multiple concerns (local_pca_dosage/candidate_focus). Page18 doesn't meet that threshold.
Pattern parity isn't a goal in itself.

```
atlases/inversion/pages/catalogue/
├── marker_readiness.js                       966 LOC ← refactored in-place from chat-33 stub
└── marker_readiness/
    └── _state.js                    18 LOC ← _pageState + setter (marker_readiness's own)
```

**Verifications passed (332/332 from a clean tarball reassembly):**
- `node --check` clean on every JS file under `atlases/inversion/`.
- `tests/test_discovery_page1.js`: **103/103** unchanged.
- `tests/test_discovery_page2.js`: **58/58** unchanged.
- `tests/test_catalogue_page3.js`: **19/19** unchanged.
- `tests/test_catalogue_page18.js`: **46/46** — NEW (replaces stale
  chat-33 test). Covers exports + helpers + state + pure-helper
  tier classification + gel-visibility + JSON validators.
- `tests/smoke_discovery_page1_round4.mjs`: **33/33** unchanged.
- `tests/smoke_discovery_page2_round5.mjs`: **24/24** unchanged.
- `tests/smoke_catalogue_page3_round5.mjs`: **29/29** unchanged.
- `tests/smoke_catalogue_page18_round5.mjs`: **20/20** — NEW. Mount
  empty-state, mount populated-state (synthetic candidate with
  karyotype assignments triggering tier classification), `_pageState`
  live-binding, direct `renderMarkerPanelPage(state)` call,
  `_mpDeriveAutoPanel()` via `_pageState`, unmount cleanup.

---

## What this round shipped

### Step 0 — registry + manifest fix

- `pages.registry.json` marker_readiness: added `_label` ("15 marker panel") and
  `_doc` documenting the legacy tab definition + tier hierarchy
  (Tier 1 private indel/SNP tag clean dosage; Tier 2 multi-marker or
  strong tag; Tier 3 breakpoint PCR demoted; Tier 4 exploratory).
- `manifest.json` marker_readiness: label "page 18" → **"marker panel"**;
  stage "catalogue" → **"synthesis"** (matching legacy
  `data-stage="synthesis"` at line 5128).

### Step 1 — marker_readiness.js refactored in-place

The chat-33 stub already had the body extracted. This round refactored
it for atlas-router compatibility:

- Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
  with proper imports.
- Added `import { _esc } from '../../shared/page1_data_helpers.js';`
  to satisfy the 15 `_esc(...)` calls (was an unresolved global before).
- State shim injection: a Python patcher walked every top-level
  `function NAME(args) {...}` and injected `const state = _pageState;`
  as the first statement of any function whose body referenced bare
  `state` and didn't take `state` as first arg. Result: 4 functions
  got the shim (`_mpMinDistanceToCsBreakpoint`, `_mpDeriveAutoPanel`,
  `_mpEnsureState`, `_mpRenderToolbar`).
- Replaced `export function renderMarkerPanelPage()` with the
  state-aware variant `renderMarkerPanelPage(state)`.
- Added `mount(root, atlasState, registry)`, `unmount(root)`, and
  `_buildLegacyState(atlasState)` (mirrors local_pca_dosage/candidate_focus/catalogue pattern).
- Removed the chat-33 `__MODULE_ID__` export (no consumers).

### Step 2 — marker_readiness/_state.js (NEW, 18 LOC)

Same shape as `local_pca_dosage/_state.js`, `candidate_focus/_state.js`, `catalogue/_state.js`.
Page18 has its OWN `_pageState`.

### Step 3 — tests

- `tests/test_catalogue_page18.js`: replaced stale chat-33 test (wrong
  path, asserts removed `__MODULE_ID__`, wrong AF key casing). New
  version: 46 assertions covering:
  - Lifecycle entry-point exports (mount/unmount/renderMarkerPanelPage).
  - All 16 marker-panel domain helpers exported.
  - `_pageState` setter behavior.
  - **Pure-helper exercises:**
    - `_mpScoreVariantAf` for Tier 1 clean (`af_std=0.01, af_het=0.50,
      af_inv=0.95` → `private_score=0.94, dosage_score=1.0,
      tier_from_af=1`), Tier 2 strong tag, Tier 4 missing AFs.
    - `_mpAnnotateGelVisibility` for 50 bp indel (gel_visible=true),
      5 bp indel (false), SNP (null).
    - `_mpIsValidPanelJson` (requires `markers` array),
      `_mpIsValidVariantAfsJson` (requires `variants_by_inversion`
      object).

- `tests/smoke_catalogue_page18_round5.mjs`: NEW, 250 LOC, 20 assertions.
  Full mount/render/unmount lifecycle. Empty-state mount yields
  `mpBody.innerHTML > 500 chars` (tier defs card + methods).
  Populated mount with synthetic candidate (with karyotype assignments
  for `_mpSuggestControlsFromKaryotype`) yields `mpBody.innerHTML > 1000
  chars` containing the candidate's chrom string.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **local_pca_dosage/candidate_focus/catalogue modules** — completely unchanged.
- **`shared/page1_data_helpers.js`** — unchanged this round (marker_readiness's
  only shared dependency is `_esc`, already added in round 5 step 2
  for candidate_focus).
- **stats_profile (stats profile)** — sibling synthesis page that reads
  marker_readiness's `_mpDeriveAutoPanel` via `typeof X === 'function'` guard.
  Migrating stats_profile (likely next round) will resolve the import properly.
- **Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 19, 21,
  overview, sv_evidence** — only parse-checked.
- **Page renumbering** — deferred per Quentin's directive.
- **Toolkit-registry vs Atlas-state cache decisions** — Quentin's
  workflow: defer until all pages are migrated.

---

## Migration progress so far (4 of 22 pages)

| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ migrated rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ migrated step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ migrated step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| marker_readiness | catalogue (synthesis) | ✅ migrated step 4 (single file) | ~984 across main + _state | 46+20 |

**Total assertions passing across all migrated pages: 332/332.**

---

## What to do NEXT

**Quentin's call.** Most natural follow-up: **stats_profile** (stats profile).
Reasons:

1. Sibling synthesis page (legacy `data-stage="synthesis"`, tab "14 stats profile").
2. **Reads marker_readiness's `_mpDeriveAutoPanel`** via `typeof X === 'function'`
   guard — migrating stats_profile lets us properly resolve the import.
3. Same pattern as marker_readiness: pre-extracted body (~939 LOC), refactor
   in-place rather than split (single concern: stats-profile rows
   + render).
4. Manuscript-relevant: stats_profile = "stats profile" = the synthesis figure
   "what is statistically special about inversion regions?"
5. Cross-page dependencies (legacy stub note): `_csGetSyntenyBlocks`,
   `_csPermutationTest`, `_mpDeriveAutoPanel`. The first two are
   likely in cross_species_breakpoints/16b multi-species cockpit (not migrated); they
   may have to stay as `typeof X === 'function'` guards. The third
   is now in marker_readiness — proper import.

**Other reasonable candidates:**

| Page | Folder | LOC | Notes |
|---|---|---|---|
| stats_profile | catalogue (synthesis) | 939 | sibling of marker_readiness; pre-extracted body |
| annotation_cockpit | catalogue | 721 | pre-extracted body |
| local_pca_theta_pi | discovery | 1008 | 18 TODOs flagged |
| cross_species_breakpoints, multi_species_cockpit | comparative | 2400+ | multi-species cockpit, large |
| window_summary_table/9/15/19 | discovery/catalogue | <105 | tiny stubs, quick router-wiring |
| overview | catalogue | 35 | empty stub (legacy is empty too) |

---

## Three-cohort discipline (CRITICAL — never violate)

Quentin's standing instruction:

1. **F₁ hybrid** (*C. gariepinus* × *C. macrocephalus*) — genome
   assembly paper only. NOT the inversion atlas's data.
2. **226-sample pure *C. gariepinus* hatchery cohort on LANTA** —
   current inversion atlas work. K-means clusters reflect hatchery
   broodline structure, NOT species admixture.
3. **Pure *C. macrocephalus* wild cohort** — future paper.

The inversion atlas mounts the 226-sample cohort.

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
- *"For the next page its maybe page 3 but it is not in the discovery
  folder we will renumber the page indexes at the complete end."*
