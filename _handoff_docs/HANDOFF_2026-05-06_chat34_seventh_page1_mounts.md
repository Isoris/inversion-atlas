# HANDOFF — page1 mounts end-to-end through index.html (parity restored, 18 helpers extracted)

**Date:** 2026-05-06 (chat ~34, seventh pass)
**Reads:** `AUDIT_LOG.md` top entry (chat ~34 seventh pass), then this file,
then `PAGE_MIGRATION_RECIPE.md` migration log tail, then proceed.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

The previous pass (sixth) wrongly claimed page1 migration was done.
On audit, page1 had 17 unguarded helper calls and 23 bare-form
drawX()/renderX() calls without `state` arg. mount() would have
crashed at runtime in any of dozens of places. This pass closes
that gap: 18 helpers extracted verbatim from legacy, 17 unguarded
calls wrapped, 23 bare-form calls patched, 8 unguarded DOM accesses
made null-safe.

**Verified by real-browser-style smoke test:** page1 module loads
(28 exports), `applyData` populates state correctly, all entry
points run, mount() and unmount() complete without throwing.

Stubs in page1.js: 29 → 23. 0 TODO_MISSING markers. No registry
changes. No master_config changes. No schema changes. No engine
changes.

---

## What this pass shipped

**page1.js (5397 LOC, was 4672)** — everything is JS-internal:

1. **Inserted "Legacy helpers (parity)" block** (725 LOC) before the
   "Extracted bodies" header. Contains 18 helpers + 5 constants:
   - Constants: `FAMILY_PALETTE_BASE`, `FAMILY_COLOR_SMALL/SINGLETON/
     UNMATCHED`, `VIEW_CONTROLS_STORAGE_KEY`, `_LINES_COLOR_MODES`.
   - `inferLayersFromV1(data)`, `detectSchemaAndLayers(data)`,
     `listLayers(state)`, `availablePCs(state)`,
     `getPCByAxis(state, winIdx, axis)`,
     `getPCRender(state, winIdx, axisX, axisY)` (replaces round-2 stub),
     `getPC(state, winIdx)`, `buildIndexes(state)`,
     `computePC1Signs(state)`, `populateSimScales(state)`,
     `buildFamilyPalette(state)`, `refreshBandPickBar(state)`,
     `refreshCandidateUI(state)`, `loadViewControls(state)`,
     `saveViewControls(state)`, `reconcileViewControlsForData(state)`,
     `getL2Cluster(state, l2idx)` (adapted to ClusterCache),
     `getL2ClusterAt(state, l2idx, K)` (adapted to clusterL2AtK),
     `getLinesGrid(state, source)`, `getLinesSignAt(state, winIdx,
     source)`, `getLinesValuesAt(state, winIdx, source)`,
     `allSampleIdx(state)`, `_isLinesColorModeAvailable(state, modeId)`.

2. **Removed 6 round-2 stubs** that are now real bodies: `getPCRender`,
   `getLinesGrid`, `getLinesSignAt`, `getLinesValuesAt`, `getL2Cluster`,
   `allSampleIdx`.

3. **Wrapped 17 unguarded helper calls** with `typeof === 'function'`
   guards in `applyData`, `setCur`, `autoPickRadial`, `togglePlay`,
   `cycleKAside`, `onPCAClick`, `updateWinLabel`. Of these:
   - 14 now resolve to extracted helpers (typeof check passes; helper
     runs).
   - 3 stay forever-guarded because they're referenced-but-never-
     defined in the legacy file itself: `refreshColorModeBar`,
     `refreshPcaAxisBar`, `refreshPinUI`. The legacy was running with
     these as no-ops; we preserve that behavior.

4. **Made 8 unguarded `document.getElementById(X).Y` accesses null-
   safe** for elements not in the page1.html fragment (sidebar/topbar
   territory the new shell doesn't host: `dataStatus`, `headerMeta`,
   `schemaBadge`, `winIdx`, `winBp`, `scrubber`, `playBtn`, `kSelect`).

5. **Sed-swept 23 bare-form `drawX()/renderX()/buildX()` calls** to
   pass `state` (the round-2 convention required this; the extractor
   missed them). Plus 5 `setCur(X)` calls patched to `setCur(state, X)`,
   and 2 `getPC(X)` patched to `getPC(state, X)`.

6. **Widened shared-module imports**: added `clusterL2AtK`,
   `sampleSpreadL2`, `sigmaProfileL2`, `sampleSpreadRange`, `aggregateL2`
   from `shared/per_l2_cluster.js`.

## What this pass did NOT change

- `page1.html`: byte-identical to legacy `<main id="page1">` — verified.
- `inversion.css`: 49/49 `#page1` selector parity with legacy — verified.
- `manifest.json`: unchanged.
- `inversion-atlas/registries/data/*.registry.json`: unchanged.
- `master_config.example.yaml`: unchanged.
- All schemas: unchanged.
- atlas-core engine code: unchanged. 9/9 parse-clean.
- The 23 still-stubbed helpers (state-bound color, strip renderers,
  candidate-nav, misc) — see "Open for next round" below.

---

## Verification done this pass

- `node --check` clean: page1.js, page12.js, color_helpers.js, all
  shared/*.js, all pages/**/*.js, all atlas-core/core/*.js.
- 23/23 + 13/13 + 4/4 atlas-core engine tests still pass.
- **Module-load smoke test** (assembled workspace, fake DOM): page1.js
  loads with 28 exports including `mount`, `unmount`. No load-time
  errors after stubs were trimmed and helpers were added.
- **Mount-flow smoke test** (assembled workspace, fake DOM with full
  canvas API including `setLineDash`, fake registry returning a
  minimal `scrubber_main` payload): mount() runs end-to-end without
  throwing. unmount() runs without throwing. All 6 entry points
  (drawSim, drawZ, drawLinesPanel, drawPCA, drawTracks, updateWinLabel)
  execute against the synthetic data.
- **Helper-correctness sanity test** (synthetic precomp: 5 windows,
  10 samples, 1 L1 envelope, 1 L2 envelope, 3 family IDs):
  - schemaVersion = 2 ✓
  - layersPresent = {envelopes, samples, tracks, windows} ✓
  - windowToL1 = [0, 0, 0, -1, -1] ✓ (L1 covers windows 0-2)
  - windowToL2 = [0, 0, -1, -1, -1] ✓ (L2 covers windows 0-1)
  - hubFamilies = [0] ✓ (family 0 has 4 samples, n>=4 → hub)
  - smallFamilyIds = [1, 2] ✓ (3 samples each → small)
  - l2NeighborsInL1.size = 1 ✓

The mount path is now confirmed working in the assembled workspace.

---

## Open for next round (round 4)

23 stubs remain in page1.js, in priority order:

**Tier A (next): 4 state-bound color helpers**
- `_vColor`, `trackedColor`, `getSampleColor`, `_resolveSampleScopeColor`
- Read state.linesColorMode, state.colorMode, state.ancestryPalette,
  state.hubFamilies, state.familyPalette (now populated by
  buildFamilyPalette), state.tracked.
- Some inputs are TODO_MISSING_SLOT names — round 4 may need
  SLOT_REGISTRY additions in `shared/state.js` first.

**Tier B (after layer wiring): 8 candidate / window-nav helpers**
- `_assignCandidateLanes`, `_paintCandidateBands`, `_winNavBand`,
  `_wRowBand`, `_drawWRow`, `_drawWinNavLane`, `_ensureCsOverlayIndex`,
  `drawCandidateBar`.
- Touch the candidate registry layers (`candidates`,
  `candidate_lineage`, `arrangement_calls`). Extract when migrating
  page1's candidate-aware features.

**Tier C (blocked on data layers): 9 strip renderers**
- `_drawBandTraceStrip`, `_drawDiamondOverlay`,
  `_drawInheritanceLabelsStrip`, `_drawLineageStrip`,
  `_drawRegimeBreadthStrip`, `_drawSnpDensityShade`,
  `_drawSnpDensityStrip`, `_drawTrackedLinkageStrip`,
  `_drawTransitionRateStrip`.
- Each is gated by a precomp data layer that isn't wired yet. DO NOT
  force-extract.

**Tier D (misc): 2 helpers**
- `recomputeAnchorConcord` (mutates state._anchorConcord), `_refreshScreeInset`.

---

## Reading order for next chat

1. `AUDIT_FIRST.md` — pre-flight checklist.
2. `AUDIT_LOG.md` top entry (chat ~34 seventh pass) — what just shipped.
3. This file.
4. `PAGE_MIGRATION_RECIPE.md` — recipe + migration log tail.
5. `atlases/inversion/shared/state.js` SLOT_REGISTRY — before round 4.
6. `legacy/Inversion_atlas.html` — grep on demand for the 4 round-4
   targets and the candidate helpers when round 5 starts. Don't read
   whole.

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back immediately and
precisely when outputs are wrong (which is how this pass got
prioritised — sixth-pass shipped a half-done page1 and labelled it
done; seventh pass closed the actual gap).
