# HANDOFF — local_pca_dosage SPLIT done (10 sub-modules); next is candidate_focus migration

**Date:** 2026-05-06 (chat ~35, round 4)
**Reads:** This file FIRST, then `HANDOFF_2026-05-06_chat34_page2_plan.md`
(round 5 plan), then `PAGE_MIGRATION_RECIPE.md` migration log tail, then
`AUDIT_LOG.md` top entry for the full chat-35 round-4 record.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**local_pca_dosage is split.** The 6684-LOC monolith from chat 34 (eighth pass) is
now a slim entry-point module plus 9 cohesive sub-modules under
`atlases/inversion/pages/discovery/local_pca_dosage/`. **Every public export is
preserved** (the manifest's `module: "local_pca_dosage.js"` contract is unchanged).
**Every named definition from the pre-split file is still present** —
verified by a 90-name symbol-level diff (0 added, 0 removed).

```
atlases/inversion/pages/discovery/
├── local_pca_dosage.js                       431 LOC ← entry point, mount/unmount/applyData
├── local_pca_dosage.js.bak                  6684 LOC ← pre-split reference (delete after round 5)
└── local_pca_dosage/
    ├── _state.js                  185 LOC ← _pageState (export let), color helpers
    ├── _data.js                   643 LOC ← schema, indexing, accessors, view ctrl
    ├── sim_panel.js               451 LOC ← drawSim, drawSimMini
    ├── z_panel.js                1375 LOC ← drawZ + 9 strip renderers
    ├── lines_panel.js            1304 LOC ← drawLinesPanel and friends
    ├── pca_panel.js               626 LOC ← drawPCA, drawAnchorStrip, anchor helpers
    ├── l3_panel.js                883 LOC ← renderL3Panel + slab + scaleStability
    ├── candidates.js              480 LOC ← bands, lanes, overlay, bar, 4 forever-stubs
    └── events.js                  362 LOC ← onClick handlers, setCur, drawTracks
```

**Smoke test: 33/33 assertions pass.** Includes mount() lifecycle through
atlas-core's `atlas_api.bootstrap`, applyData state population, full draw
chain via setCur(state, 25), per-fn direct calls, unmount cleanup, and a
`_pageState` live-binding micro-test across module boundaries.

**`tests/test_discovery_page1.js` updated**: stale path fixed
(`../inversion_discovery/local_pca_dosage.js` → `../atlases/inversion/pages/discovery/local_pca_dosage.js`)
and extended with sub-module export-coverage checks. **61/61 assertions
pass** when run against an assembled workspace.

**Next round (round 5): candidate_focus migration.** Plan in
`HANDOFF_2026-05-06_chat34_page2_plan.md`. Recipe is the same as local_pca_dosage's
eighth pass + this round's split, with a **new cross-cutting question
to answer first**: helpers shared between local_pca_dosage and candidate_focus should move
to `shared/`. See "Round-5 prep" below.

---

## What this round shipped

### 9 new sub-modules under `pages/discovery/local_pca_dosage/`

| File | LOC | Concerns |
|---|---|---|
| `_state.js` | 185 | `export let _pageState`, `_setActiveState(state)`, FAMILY_PALETTE_BASE + sibling FAMILY_COLOR_* constants, color helpers (trackedColor, _vColor, _lineageColor, familyColor, ancestryColor, manualGroupColor, getSampleColor, _resolveSampleScopeColor) |
| `_data.js` | 643 | detectSchemaAndLayers, inferLayersFromV1, listLayers, availablePCs, getPC, getPCByAxis, getPCRender, buildIndexes, computePC1Signs, populateSimScales, buildFamilyPalette, loadViewControls, saveViewControls, reconcileViewControlsForData, getL2Cluster, getL2ClusterAt, getLinesValuesAt, getLinesGrid, getLinesSignAt, allSampleIdx, currentMbRange, getActiveSimScale, _LINES_COLOR_MODES, _isLinesColorModeAvailable, VIEW_CONTROLS_STORAGE_KEY |
| `sim_panel.js` | 451 | drawSim (309 LOC), drawSimMini (119 LOC) |
| `z_panel.js` | 1375 | drawZ (623 LOC) + 9 strips: _drawSnpDensityStrip, _drawSnpDensityShade, _drawTransitionRateStrip, _drawRegimeBreadthStrip, _drawLineageStrip, _drawDiamondOverlay, _drawInheritanceLabelsStrip, _drawTrackedLinkageStrip, _drawBandTraceStrip |
| `lines_panel.js` | 1304 | drawLinesPanel (852 LOC), buildLinesPanel (278), buildLinesPanelCheckboxes (103), refreshLinesColorMode, setLinesPanelCandidateBands |
| `pca_panel.js` | 626 | drawPCA, drawAnchorStrip, recomputeAnchorConcord, _refreshScreeInset, autoPickRadial, cycleKAside, togglePlay, renderTrackedList, renderManualGroupsList |
| `l3_panel.js` | 883 | renderL3Panel (510), renderL3PanelSlab (271), renderL3PanelScaleStability (81) |
| `candidates.js` | 480 | _assignCandidateLanes, _paintCandidateBands, _ensureCsOverlayIndex, drawCandidateBar (214 LOC), refreshBandPickBar, refreshCandidateUI, the 4 forever-stubs (_winNavBand, _wRowBand, _drawWRow, _drawWinNavLane) |
| `events.js` | 362 | onSimClick, onZClick, onPCAClick, setCur, updateWinLabel, buildTrackPanels, drawTracks |

Largest file (z_panel.js) is 1375 LOC — fits Quentin's "easier to work
with" criterion (down from 6684).

### Slim main `local_pca_dosage.js` (431 LOC)

Holds:
1. **All cross-shell external imports** (`escapeHtml` from page1_utils,
   `resolve as _registryResolve, getState as _getState` from atlas_api).
2. **Sub-module imports** for the helpers `applyData` calls into
   (8 from `_data`, 2 from `candidates`, 1 from `_state`, plus the public
   set used by `mount`).
3. **Public re-exports** (`export {drawSim, ...} from './local_pca_dosage/sim_panel.js'`
   etc.) so the manifest's `module: "local_pca_dosage.js"` import contract is
   preserved with zero manifest edits.
4. **`applyData` body** — kept in main because it orchestrates calls
   across every sub-module. Putting it in `_data.js` would mean `_data`
   imports from every panel, creating a cycle.
5. **`mount` / `unmount` / `_buildLegacyState` / `_wireCanvasHandlers`**
   — verbatim from pre-split file's tail.

### `_pageState` shared via ES module live-binding

`_state.js` does:
```js
export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }
```

Every panel module imports `_pageState` (`import { _pageState } from
'./_state.js'`). When any public entry-point's first line calls
`_setActiveState(state)`, the `let` binding is updated, and **every
importing module's reference now points at the new state**. This is
ES2015 live-binding semantics, not a hack — it works because `import` for
a `let` export is a name reference, not a value snapshot.

**Verified by micro-test**: `_setActiveState(stateA)` then
`_setActiveState(stateB)` both observed in `_state.js`. Sub-module
helpers (e.g. `_lineageColor` in `_state.js`, `_drawSnpDensityStrip` in
`z_panel.js`) read the latest value via their `const state = _pageState;`
top-of-body injection.

This works **because only one page is mounted at a time** (the
atlas-router's unmount-old → mount-new pattern). Cross-page contamination
is impossible. For round 5 (candidate_focus), helpers shared between pages will
need a different strategy — see "Round-5 prep" below.

### Body extraction discipline

Bodies are extracted **byte-verbatim** from `local_pca_dosage.js.bak`:
- Every comment, every blank line, every legacy-line annotation preserved.
- The only programmatic mutation is `export ` prefix injection: each
  name imported by another sub-module gets `export` prepended once
  (idempotent regex skips already-exported names).
- No semantic edits. No "while we're here" cleanups. Round 4 is a
  refactor, not a fix.

The split was done by `/home/claude/work/split_page1.py` — a one-shot
extraction tool. Brace-matches function bodies, computes cross-module
deps via tight regex, computes the `must_export` set as the union of
"imported by another module" and "in PUBLIC_EXPORTS for re-export by
main", writes the 10 files. ~930 LOC. Saved in case candidate_focus/3/4 want to
crib from it.

---

## What this round did NOT touch

- **HTML fragment** (`local_pca_dosage.html`) — unchanged.
- **CSS** (`inversion.css`) — unchanged.
- **Manifest** (`pages.registry.json` & friends) — unchanged. The split
  preserves the `module: "local_pca_dosage.js"` contract exactly.
- **atlas-core engine** — unchanged (9/9 parse-clean; engine tests not
  re-run this round, but no atlas-core file was modified).
- **Server, schemas, master_config** — unchanged. JS-only.
- **Cross-page `shared/` hoisting** — explicitly deferred to round 5
  per the candidate_focus plan. The pure-on-state helpers in `_data.js` are
  the prime candidates.
- **Sibling pages** (candidate_focus, window_summary_table, local_pca_theta_pi, local_pca_ghsl, negative_regions) — only
  parse-checked, not modified.

---

## Verification — what passes

```
node --check on all 10 modules:                               PASS (10/10)
Symbol-level diff vs local_pca_dosage.js.bak:                            PASS (90 names, 0 added, 0 removed)
Module load (dynamic import of local_pca_dosage.js, all 28 exports):     PASS (28/28)
Smoke test (mount → applyData → setCur → unmount):            PASS (33/33)
tests/test_discovery_page1.js (path fixed + sub-module checks): PASS (61/61)
```

The 33-assertion smoke test verifies, against synthetic data
(N=100 windows, S=50 samples, 2 L1 envelopes, 2 L2 envelopes,
8 family IDs):

- `applyData` populates `state.schemaVersion = 2`, `state.layersPresent`
  is a Set with `{envelopes, samples, windows}`, `state.pc1Sign` has
  100 entries.
- `state.windowToL1[0] = -1`, `[20] = 0`, `[50] = -1`, `[75] = 1`
  (matches eighth-pass expectations exactly).
- `state.windowToL2[20] = -1`, `[24] = 0`, `[30] = 0`, `[80] = 1`.
- `state.hubFamilies.length === 8` (every family with n=6 ≥ 4 threshold).
- `state.l2NeighborsInL1.size === 2`.
- `setCur(state, 25)` sets state.cur=25 and exercises drawSim → drawZ →
  drawTracks → drawLinesPanel → drawPCA → updateWinLabel without
  throwing.
- mount() through atlas_api.bootstrap → registry.resolve("scrubber_main")
  → applyData → initial-render loop runs end-to-end.
- unmount() clears `inversion._page1State`.
- `_pageState` live-binding observed across module boundaries.

---

## Round-5 prep (read before starting candidate_focus)

The candidate_focus plan (`HANDOFF_2026-05-06_chat34_page2_plan.md`) flags **Step 5
— Cross-page imports** as a key decision. After round 4, the answer is
much clearer:

**Recommended strategy: hoist shared-by-multiple-pages helpers into
`atlases/inversion/shared/`. Refactor those helpers to take `state` as
first arg. Drop the `_pageState` shim only on the hoisted helpers.**

Quentin's chat-35 framing: *"I feel like using a shared/ if its for a
function why not."*

**Why not just keep them in `local_pca_dosage/_data.js` and have candidate_focus import them?**
Because every helper in `local_pca_dosage/_data.js` reads `_pageState` from
`local_pca_dosage/_state.js`. If candidate_focus's `lines_panel` (or wherever) imports
`getPC` from `local_pca_dosage/_data.js`, then candidate_focus's mount sets local_pca_dosage's
`_pageState` — but local_pca_dosage isn't mounted, so the chain works by accident
(only because the atlas-router unmounts old pages first). It's safer
to make hoisted helpers state-explicit.

**Helpers that are good candidates for `shared/` hoisting:**

From `local_pca_dosage/_data.js`:
- `getPC(state, winIdx)`, `getPCByAxis(state, winIdx, axis)`,
  `getPCRender(state, winIdx, axisX, axisY)`, `availablePCs(state)`
- `getL2Cluster(state, l2idx)`, `getL2ClusterAt(state, l2idx, K)`
- `allSampleIdx(state)`
- `getLinesValuesAt(state, winIdx, source)`, `getLinesGrid(state, source)`,
  `getLinesSignAt(state, winIdx, source)`
- `currentMbRange(state)`, `getActiveSimScale(state)`
- `listLayers(state)`, `_isLinesColorModeAvailable(state, modeId)`
- `loadViewControls(state)`, `saveViewControls(state)`,
  `reconcileViewControlsForData(state)`
- `detectSchemaAndLayers(data)` (already takes `data` arg, no `_pageState`
  involvement — pure)
- `inferLayersFromV1(data)` (pure)
- Constants: `_LINES_COLOR_MODES`, `VIEW_CONTROLS_STORAGE_KEY`

These are **already state-aware first-arg helpers** — they don't read
`_pageState` at all (they were extracted in round 3 step 3, before the
shim was added). So hoisting them is just a **file move + import path
update** — no body edits.

From `local_pca_dosage/_state.js`:
- `FAMILY_PALETTE_BASE`, `FAMILY_COLOR_*` constants — these are pure
  data, can move to `shared/state_constants.js` or similar.
- The color helpers (`trackedColor`, `_vColor`, `_lineageColor`, etc.)
  read `_pageState` via the shim. To hoist them, they'd need to be
  refactored to take `state` (or `(state, si)`) as first arg. Defer.

**Recommended round-5 ordering:**
1. Resolve the candidate_focus registry-entry mismatch (Step 0 in candidate_focus plan).
2. Move the pure-on-state helpers from `local_pca_dosage/_data.js` to
   `shared/page1_data_helpers.js` (or similar). Update `local_pca_dosage/_data.js`
   to re-export them so existing local_pca_dosage panel modules don't break. Verify
   smoke test still 33/33.
3. THEN start the candidate_focus migration following the same recipe used for
   local_pca_dosage's eighth pass + this round's split.

The candidate_focus plan suggests this exact sequence and the recipe is now mature.

---

## Files NOT to drop / what's in this handoff bundle

This handoff bundle includes everything the next chat needs to pick up
where round 4 ended:

- `0_READ_ME_FIRST.md` — entry point
- `HANDOFF_2026-05-06_chat34_round4_done.md` (THIS FILE)
- `HANDOFF_2026-05-06_chat34_page2_plan.md` — round 5 plan
- `HANDOFF_2026-05-06_chat34_eighth_page1_parity.md` — round 4 plan
  (now executed; kept for reference)
- `PAGE_MIGRATION_RECIPE.md` — full migration log, all rounds
- `AUDIT_LOG.md` — top entry is chat-35 round-4
- (older chat-34 handoffs kept for historical reference only)

Plus the two project tarballs:
- `atlas-core_2026-05-06_chat35_round4.tar.gz` — engine (unchanged this round)
- `inversion-atlas_2026-05-06_chat35_round4.tar.gz` — atlas tree with
  the split applied

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back precisely when
outputs are wrong.

**Three-cohort discipline (NEVER violate):**
- F₁ hybrid (*C. gariepinus* × *C. macrocephalus*) — genome assembly
  paper only.
- 226-sample pure *C. gariepinus* hatchery cohort on LANTA — current
  inversion atlas work; K clusters reflect hatchery broodline structure,
  NOT species admixture.
- Pure *C. macrocephalus* wild cohort — future paper.
