# HANDOFF — page2 candidate-detail page MIGRATED; next is catalogue (catalogue)

**Date:** 2026-05-07 (chat ~36, round 5 step 2)
**Reads:** This file FIRST, then the audit log top entry, then
`PAGE_MIGRATION_RECIPE.md` round-5-step-2 section, then
`HANDOFF_2026-05-07_chat36_round5_step1_done.md` (the shared/ hoist that
unblocked this round) only if needed for context.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**Page2 (candidate detail) is migrated.** It was a 251-line stub with
41 TODO_MISSING markers; it is now a 5-sub-module split (~2700 LOC
across page2.js + 5 modules under `pages/discovery/page2/`) that
mounts cleanly through the atlas-router and renders the candidate
deep-dive HTML for synthetic candidate data.

**Verifications (all from a clean tarball reassembly, 218/218):**
- `tests/test_discovery_page1.js`: **103/103** unchanged.
- `tests/test_discovery_page2.js`: **58/58** — sub-module + main re-export coverage (new this round).
- `tests/smoke_discovery_page1_round4.mjs`: **33/33** unchanged.
- `tests/smoke_discovery_page2_round5.mjs`: **24/24** new — full mount/render/unmount lifecycle under a fake DOM with a synthetic candidate matching legacy's `candidate{To,From}JSON` schema. 12 of 16 candidate-detail sub-panels render their HTML (>1000 chars total); 4 sub-panels degrade cleanly via `_safeBuild()` because they reference legacy globals that haven't been migrated yet (clearly named in the warning output for future migration rounds).

```
atlases/inversion/pages/discovery/
├── page2.js                432 LOC   ← entry: mount/unmount + 4 orchestrators
└── page2/
    ├── _state.js            20 LOC   ← _pageState + setter (page2's own, separate from page1's)
    ├── _html_builders.js  1283 LOC   ← 16 candidate*Html builders + page2-private support
    ├── _wires.js           366 LOC   ← 7 wire functions (post-DOM)
    ├── _list.js            565 LOC   ← 8 list-management helpers + module-private extras
    └── _draw_panels.js     429 LOC   ← 7 draw functions + 2 page2-private helpers
```

---

## What this round shipped

### Step 0 — page2 registry mismatch resolved

Legacy line 5049 (`<button data-page="page2">`) confirms page2 is
"candidate focus" deep-dive, NOT "cohort overview". Updated:

- **`pages.registry.json` page2 entry:**
  - `requires_layers`: `[scrubber_main, cohort_sample_manifest]` →
    `[scrubber_main, candidate_tracks, cohort_sample_froh,
    ancestry_global_q, het_band_backbones, arrangement_calls]`.
  - `requires_slots`: added `activeCandidate`.
  - Added `_label` and `_doc` documenting the legacy tab name.

- **`manifest.json`:**
  - page1 label: "candidate focus" → **"local PCA |z|"**.
  - page2 label: "cohort overview" → **"candidate focus"**.

(Legacy line 5049 = page2 = "Deep-dive on a single promoted candidate.";
legacy line 5028 = page1 = "Local PCA scrubber on dosage".)

### Step 3 — page2 body migration (5 sub-modules + main)

42 helpers extracted byte-verbatim from legacy (40 from the page2 plan
+ 2 entry points, 2525 LOC). Plus ~10 page2-private support helpers
hit by the smoke path (~150 LOC), and 6 cross-page utilities hoisted
to `shared/page1_data_helpers.js` (~90 LOC).

**Cross-page imports**: page2 sub-modules import from
`../../../shared/page1_data_helpers.js` (the round-5-step-1 hoist) for
`getPC`, `getL2Cluster`, `sampleSpreadRange`, `groupColor`, `_esc`,
`_fmt4`, `_fmtP`. These all take `state` as first arg, so page2 never
inherits page1's `_pageState` reference.

**Cycle resolution**: `refreshCandidateUI` ↔ `renderCandidateMetadata`
↔ `_list.js`'s `addCandidateToList`. Resolved by keeping both
orchestrators in main page2.js and letting `_list.js` import
`refreshCandidateUI` from `'../page2.js'` — ES module live-binding
resolves the cycle at call time, not parse time.

### `_safeBuild()` defensive wrapper

A closure walk from `renderCandidateMetadata` reaches ~219 transitively
needed legacy helpers (~8K LOC). Migrating the full closure was out of
scope for this round. Instead, the orchestrator wraps each of the 16
sub-panel builder calls in `_safeBuild(name, () => candidateXHtml(c))`
which catches exceptions and returns `''`, mirroring legacy's existing
per-wire `try/catch` pattern. **12 of 16 sub-panels render their HTML
in the smoke harness; 4 degrade cleanly with named warnings** so future
migration rounds know which legacy globals to extract:

| Sub-panel | Missing legacy global(s) | Cost to migrate |
|---|---|---|
| `candidateHaplotypeAnnotationsHtml` | `loadHaplotypeLabels` (+ persistence layer) | ~30 LOC |
| `candidateAncestryConfoundHtml` | the 16-helper `_anc*` family (legacy 58068-58289) | ~270 LOC |
| `candidateRegimeRowHtml` | `_candidateL2Ids`, `_ensureRegimeRegistry`, `_regimesForL2` | ~100 LOC |
| `drawCandidateLocationStrip` | `drawCandSimMini`, `drawCandL1Mini`, `drawCandKaryoMini` (canvas drawing) | ~130 LOC |

Total degraded: ~530 LOC of legacy helpers across 4 sub-panels =
**75% of the candidate-detail view renders end-to-end on synth data**.
Subsequent rounds can extract these incrementally (any order; each
panel is independent).

### Tests

- `tests/test_discovery_page1.js`: **103/103** (unchanged from step 1).
- `tests/test_discovery_page2.js`: **3 → 58 assertions** (covers all
  38 public re-exports + the 5 sub-modules' core exports).
- `tests/smoke_discovery_page2_round5.mjs`: **NEW**, 24/24. Mirrors
  the round-4 page1 smoke pattern: fake DOM, synthetic candidate
  matching `candidate{To,From}JSON` schema, mount empty-state, mount
  populated-state, 4 orchestrators called directly, `_pageState`
  live-binding observed across module boundaries, unmount cleanup.

---

## What this round did NOT touch

- **atlas-core engine** — completely unchanged.
- **Page1 sub-modules** — only their `_data.js` shim got 6 new
  re-exported names from the shared module's expansion. Bodies untouched.
- **The 4 still-degraded sub-panels.** Future rounds.
- **Pages 3, 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
  overview, sv_evidence** — only parse-checked.
- **Page renumbering**. Quentin's directive: defer to the COMPLETE END
  of all migrations. Pages keep their current "page1, page2, catalogue, ..."
  IDs throughout the migration; the renumbering is a final
  reorganization pass.
- **Toolkit-registry vs Atlas-state cache decisions.** Quentin's stated
  workflow: migrate page-by-page, THEN decide what gets registry-served
  vs what stays in cache. Round 5 is the page-migration phase.

---

## What to do NEXT (round 5 step 3: catalogue migration)

**Page3 is the catalogue page** — sortable/filterable table of L2
envelopes (or L1-merged inversions). Different shape from page2:

- **Location: `atlases/inversion/pages/catalogue/catalogue.js`**
  (NOT `pages/discovery/`).
- Legacy line 5051: `<button data-page="catalogue">` titled *"Sortable,
  filterable catalogue of all L2 envelopes (or L1-merged inversions).
  Hover any column header for definition. Export selected rows as
  TSV or Markdown."*
- Display label: "5 catalogue".
- Page3 is what the round-2 stub already names. The
  `pages.registry.json` entry says `requires_layers: [scrubber_main]`,
  `requires_slots: [activeChrom]` — no `activeCandidate` (catalogue is
  a chromosome-scope view).

**Recipe (mirrors round-5-step-2 with adjustments for table rendering):**

1. **Step 0 — registry sanity check.** Page3's registry entry looks
   right (chromosome-scoped, no active candidate). Verify against
   legacy line 7263+ (`<div id="catalogue"`).

2. **Step 1 — Audit catalogue.html fragment.** Currently in `pages/catalogue/catalogue.html`.
   Compare with legacy. Likely contains a toolbar (view-mode buttons,
   simple/detailed toggle) plus an empty `<table id="catTable">` that
   gets filled by the renderer.

3. **Step 2 — Audit CSS.** Look for `#catalogue table.cat`-prefixed selectors.
   Round-5-step-2 audit showed plenty already (49 `.cand-*` rules; the
   `#catalogue table.cat` is its own family).

4. **Step 3 — Extract helpers.** Run the smart brace-matching extractor
   from `/home/claude/work/extract_page2.py` (renamed for catalogue) over
   the catalogue functions. Likely targets:
   - `renderCatalogue()` — the main render entry point (legacy line ~62700+; the page2 plan flagged this as "page-4 territory" but it's actually page-3).
   - `renderCatalogueRow(env, mode)` — per-row HTML.
   - `sortCatalogueBy(col)` — column sort.
   - `filterCatalogueRows(state)` — filter chain.
   - `exportCatalogueTSV()`, `exportCatalogueMarkdown()` — export functions.
   - View-mode toggles: L2 raw / L1 merged / favorites / L3.
   - Hover-tooltip column-definition logic.

5. **Step 4 — Bucket.** Likely 4 buckets:
   - `_state.js` — `_pageState` + setter (catalogue owns its own).
   - `_table.js` — row rendering, column definitions, sort logic.
   - `_filter.js` — favorites filter, simple/detailed display toggle, filter state.
   - `_export.js` — TSV + Markdown export.
   - Main `catalogue.js` — `renderCatalogue` orchestrator + mount/unmount.

6. **Step 5 — Cross-page imports.** Page3 reads `state.data` (the chromosome precomp). Imports from `shared/page1_data_helpers.js`:
   - `getL2Cluster`, `getActiveSimScale`, `currentMbRange` for L2 row metrics.
   - `_esc` for HTML escaping.
   - Possibly `groupColor` for per-band tinting.

7. **Step 6 — Use the same `_safeBuild()` defensive wrapper** approach
   if `renderCatalogue` composes >5 sub-panels. Probably less needed
   here than for page2 — the catalogue is more uniform (one row template
   repeated N times) and likely fewer cross-cutting helpers.

8. **Step 7 — Smoke test.** Build `tests/smoke_catalogue_page3_round5.mjs`
   on the same fake-DOM pattern. Synthetic state should have
   `state.data.l1_envelopes` and `state.data.l2_envelopes` populated
   (the page1 smoke harness already does this; copy-paste).

9. **Step 8 — Update audit log + recipe + handoff.** Same pattern this round used.

**Estimate**: catalogue should be smaller than page2 because it's table-based
(less HTML construction variance). Maybe 1500-2500 LOC of bodies
distributed across 4 sub-modules + main. Legacy line range to scan:
`grep -n "function renderCatalogue\|function.*Catalogue" legacy/Inversion_atlas.html`.

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back precisely when
outputs are wrong.

Quentin's chat-36 guidance:
- *"Migrate page by page and only then make sure everything is wired
  to the toolkit registry vs Atlas state because we will have to
  decide what will be kept in cache versus in data from registry."*
- *"For the next page its maybe page 3 but it is not in the discovery
  folder we will renumber the page indexes at the complete end."*

**Three-cohort discipline (NEVER violate):**
- F₁ hybrid (*C. gariepinus* × *C. macrocephalus*) — genome assembly
  paper only.
- 226-sample pure *C. gariepinus* hatchery cohort on LANTA — current
  inversion atlas work; K clusters reflect hatchery broodline structure,
  NOT species admixture.
- Pure *C. macrocephalus* wild cohort — future paper.
