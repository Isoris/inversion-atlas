# HANDOFF — local_pca_dosage LEGACY PARITY COMPLETE (4 stubs left, all forever-stubs); next is the SPLIT into sub-modules

**Date:** 2026-05-06 (chat ~34, eighth pass)
**Reads:** `AUDIT_LOG.md` top entry (chat ~34 eighth pass), then this
file, then `PAGE_MIGRATION_RECIPE.md` migration log tail.
**Project:** MS_Inversions_North_african_catfish — 226-sample pure
*C. gariepinus* hatchery cohort, LANTA HPC.

---

## 30-second orientation

**local_pca_dosage is now at full legacy parity.** Every legacy helper that has
a real body in `legacy/Inversion_atlas.html` is now defined in
`local_pca_dosage.js`. The only 4 stubs remaining (`_winNavBand`, `_wRowBand`,
`_drawWRow`, `_drawWinNavLane`) are referenced-but-never-defined in
legacy itself — keeping them stubbed IS parity.

**Stubs: 23 → 4.** **local_pca_dosage.js LOC: 5397 → 6684.**

The page now mounts end-to-end via index.html, populates state
correctly, and the entry-point chain (drawSim → drawZ → drawTracks
→ drawLinesPanel → drawPCA → updateWinLabel) runs without errors
when `setCur` triggers a re-render.

**Next round (round 4): split local_pca_dosage.js into 10 sub-modules** under
`pages/discovery/local_pca_dosage/`. The split was Quentin's explicit request
after parity. Plan in this file under "Open for next round".

---

## What this pass shipped

**local_pca_dosage.js (6684 LOC):**

1. **`_pageState` module-level reference** (a `let _pageState = null;`
   declaration at the top of the legacy-bodies block) plus
   `_setActiveState(state)` setter. The legacy bodies use `state`
   as a global; rather than refactoring every body to take state
   as first arg, every entry-point now sets `_pageState` on its
   first line via `_setActiveState(state)`, and every extracted
   helper has a `const state = _pageState;` (or `const _state =
   _pageState;`) injection at the top of its body.

2. **19 helpers extracted verbatim** from legacy:
   - **Color (8):** `trackedColor`, `_vColor`, `_lineageColor`,
     `familyColor`, `ancestryColor`, `manualGroupColor`,
     `getSampleColor`, `_resolveSampleScopeColor`.
   - **Misc (2):** `recomputeAnchorConcord`, `_refreshScreeInset`.
   - **Strip renderers (9):** `_drawSnpDensityStrip`,
     `_drawSnpDensityShade`, `_drawTransitionRateStrip`,
     `_drawRegimeBreadthStrip`, `_drawLineageStrip`,
     `_drawDiamondOverlay`, `_drawInheritanceLabelsStrip`,
     `_drawTrackedLinkageStrip`, `_drawBandTraceStrip`.
   - **Candidate / overlay (4):** `_assignCandidateLanes`,
     `_paintCandidateBands`, `_ensureCsOverlayIndex`,
     `drawCandidateBar`.

3. **4 helpers kept as forever-stubs** (`_winNavBand`, `_wRowBand`,
   `_drawWRow`, `_drawWinNavLane`) — never defined in legacy.

4. **`getActiveSimScale(state)` and `currentMbRange(state)` re-inserted**
   — they had been added in round-3-step-1 inside the old stubs
   block, were accidentally removed during this pass's splice, and
   are now restored.

5. **26 entry-point functions** patched to call `_setActiveState(state)`
   on their first line (drawSim, drawSimMini, drawZ, drawLinesPanel,
   drawPCA, drawAnchorStrip, renderL3Panel, renderL3PanelSlab,
   renderL3PanelScaleStability, updateWinLabel, setCur,
   autoPickRadial, applyData, onSimClick, onZClick, onPCAClick,
   togglePlay, cycleKAside, renderTrackedList, renderManualGroupsList,
   buildLinesPanelCheckboxes, buildLinesPanel, buildTrackPanels,
   drawTracks, refreshLinesColorMode, setLinesPanelCandidateBands).

## What this pass did NOT touch

- HTML (local_pca_dosage.html), CSS (inversion.css), manifest, registry,
  master_config, schemas, atlas-core engine, server. JS-only.

---

## Verification

- `node --check` clean: local_pca_dosage.js (6684 LOC), all other shared/*.js
  and pages/**/*.js, all atlas-core/core/*.js (9/9).
- 23/23 + 13/13 + 4/4 atlas-core engine test assertions still pass.
- **Smoke test (assembled workspace + fake DOM, N=100 windows, S=50
  samples, 2 L1 envelopes, 2 L2 envelopes, 8 family IDs, sim_thumb):**
  - mount() runs without throwing.
  - applyData populates state: pc1Sign has 100 entries, windowToL1
    correctly indexes envelope coverage (e.g. windowToL1[0]=-1,
    windowToL1[20]=0, windowToL1[50]=-1, windowToL1[75]=1), all 8
    family IDs become hubs (each has ~6 samples ≥ n=4 threshold),
    l2NeighborsInL1.size=2.
  - setCur(state, 25) updates state.cur to 25 and exercises the
    full draw chain (drawSim, drawZ, drawTracks, drawLinesPanel,
    drawPCA, updateWinLabel) without errors.
  - unmount() cleans up.

---

## Open for next round (round 4): SPLIT local_pca_dosage.js into sub-modules

Quentin's direction: "if possible split the huge js into smaller
like per type of analysis or panel so it makes it so much easier to
work with and faster."

**Proposed 10-module split** under `atlases/inversion/pages/discovery/local_pca_dosage/`:

| File | Concerns | LOC est |
|---|---|---|
| `local_pca_dosage.js` (main) | Imports, mount/unmount, applyData, _buildLegacyState, _wireCanvasHandlers, exports | ~400 |
| `local_pca_dosage/_state.js` | _pageState, _setActiveState, color helpers (trackedColor, _vColor, _lineageColor, familyColor, ancestryColor, manualGroupColor, getSampleColor, _resolveSampleScopeColor), constants (PALETTE, GROUP_COLORS, FAMILY_PALETTE_BASE, FAMILY_COLOR_*) | ~300 |
| `local_pca_dosage/_data.js` | detectSchemaAndLayers, inferLayersFromV1, buildIndexes, computePC1Signs, populateSimScales, buildFamilyPalette, getPC, getPCByAxis, getPCRender, availablePCs, getLinesValuesAt, getLinesGrid, getLinesSignAt, allSampleIdx, getL2Cluster, getL2ClusterAt, loadViewControls, saveViewControls, reconcileViewControlsForData, listLayers, _isLinesColorModeAvailable, currentMbRange, getActiveSimScale | ~700 |
| `local_pca_dosage/sim_panel.js` | drawSim + drawSimMini | ~430 |
| `local_pca_dosage/z_panel.js` | drawZ + 9 strip renderers | ~1400 |
| `local_pca_dosage/lines_panel.js` | drawLinesPanel, buildLinesPanel, buildLinesPanelCheckboxes, setLinesPanelCandidateBands, refreshLinesColorMode | ~1300 |
| `local_pca_dosage/pca_panel.js` | drawPCA, drawAnchorStrip, renderTrackedList, renderManualGroupsList, recomputeAnchorConcord, _refreshScreeInset, autoPickRadial, cycleKAside, togglePlay | ~600 |
| `local_pca_dosage/l3_panel.js` | renderL3Panel, renderL3PanelSlab, renderL3PanelScaleStability | ~870 |
| `local_pca_dosage/candidates.js` | _assignCandidateLanes, _paintCandidateBands, _ensureCsOverlayIndex, drawCandidateBar, refreshCandidateUI, refreshBandPickBar, _winNavBand/_wRowBand/_drawWRow/_drawWinNavLane (forever-stubs) | ~470 |
| `local_pca_dosage/events.js` | onSimClick, onZClick, onPCAClick, setCur, updateWinLabel, drawTracks, buildTrackPanels | ~330 |

Largest file ≤ 1400 LOC. Each module is a cohesive concern.

**Module-level `_pageState` shared via ES live-binding:**
`local_pca_dosage/_state.js` exports both `_pageState` (a `let` binding — the
exported binding sees the latest written value) and `_setActiveState`.
Every other panel module does `import { _pageState, _setActiveState }
from './_state.js';`. The entry-point in each panel module sets
`_setActiveState(state)` on entry. The bodies read `_pageState` (or
the local `state` alias) and see the latest value because of how
ES modules' live bindings work.

**Order of work (recommended):**
1. Create `local_pca_dosage/_state.js` with `_pageState`, `_setActiveState`,
   color helpers, constants. Verify parse + smoke test still passes
   when `local_pca_dosage.js` imports from it.
2. Create `local_pca_dosage/_data.js`. Same verify.
3. Move panels one at a time: sim, z, lines, pca, l3, candidates, events.
4. After each move, run the smoke test; if it breaks, the module
   you just split has a missing import or a binding issue.
5. After all 10 modules exist, `local_pca_dosage.js` is just imports + mount/
   unmount + applyData + _buildLegacyState + _wireCanvasHandlers.

**Split discipline:**
- Each panel module is a black box: imports `_pageState`, imports
  any shared helpers it needs, exports its public entry points
  (`drawSim`, `drawSimMini`, etc.).
- The main local_pca_dosage.js re-exports the entry points so the manifest's
  `module: "local_pca_dosage.js"` import contract stays unchanged.
- No DOM access in `_state.js` or `_data.js` (these are pure /
  cache layers). DOM access is panel-module territory.
- `_setActiveState` is called by the public entry-points, NOT by
  helpers. Helpers read `_pageState`.

---

## Reading order for next chat

1. `AUDIT_FIRST.md` — pre-flight checklist.
2. `AUDIT_LOG.md` top entry (chat ~34 eighth pass) — what just shipped.
3. This file — for the split plan.
4. `PAGE_MIGRATION_RECIPE.md` — recipe + migration log tail.
5. `atlases/inversion/pages/discovery/local_pca_dosage.js` — the 6684-LOC
   monolith to split. Read by section (the file has section headers).

---

## Communication preferences (unchanged)

Quentin is French-native, fluent English, based in Bangkok. PhD on
LANTA HPC. Manuscript v19→v20 targeting Nature Communications. Terse
and direct. Wants signal not flattery. Pushes back precisely when
outputs are wrong (this whole sequence of round-3-step-1/2/3/4
exists because the sixth-pass shipped a half-done local_pca_dosage; subsequent
passes closed the actual gap step by step).
