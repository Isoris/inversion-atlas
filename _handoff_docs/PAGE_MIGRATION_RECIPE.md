# Page migration recipe

How to migrate a page from `legacy/Inversion_atlas.html` to the new shell.

This is the playbook. The previous chat (2026-05-06 evening) used it
to migrate local_pca_dosage partially — see the migration log at the bottom. The
next chat picks up from where we left off.

---

## The recipe (per-page checklist)

For each page in `atlases/inversion/pages/<stage>/<pageN>.js`:

### Step 1 — fix the import paths

Pages were extracted from a flat layout. They import shared modules as
`../shared/<thing>.js`, but pages are now nested under
`pages/<stage>/`, so the correct path is `../../shared/<thing>.js`.

```bash
sed -i "s|'\.\./shared/|'\.\./\.\./shared/|g" pageN.js
```

(Already done in the 2026-05-06 sweep for all pages with shared imports.)

### Step 2 — list the TODO_MISSING markers

```bash
grep "TODO_MISSING(" pageN.js | sed 's/.*TODO_MISSING(\([^)]*\)).*/\1/' | sort -u
```

Categorize each name:

- **Pure utility** (`escapeHtml`, `niceTicks`, `withAlpha`, `formatTrackVal`,
  `themeColor`, `fitCanvas`, `drawRect`-like) → already in
  `shared/page1_utils.js`. Just import them.
- **Coordinate transform** (`toX`, `toY`, `xOfWin`, `mbAt`) → these are
  often closure-scoped per-panel in legacy, NOT module-level. Re-extract
  the parent function to capture the closure context.
- **Color helpers** (`getSampleColor`, `simColor`, `_vColor`) → these
  often depend on `state.linesColorMode` etc. Move to `shared/color_helpers.js`.
- **Subpanel renderers** (`_drawXxxStrip`, `_paintCandidateBands`) →
  re-extract from legacy verbatim, keeping closure context.
- **Data accessors** (`samples`, `families`, `dataset`, `allSampleIdx`) →
  these are usually `state.data.samples` etc. — replace the bare reference
  with `state.data.X` in the calling function body.
- **State-bound algorithmic** (`recomputeAnchorConcord`, `getL2Cluster`,
  `getPCRender`) → re-extract from legacy, keeping closure context. May
  need refactoring to take `state` as first arg.

### Step 2.5 — distinguish real misses from false positives

**Lesson from round 2.** The `TODO_MISSING(X)` markers were generated
mechanically during extraction; some are spurious. Before extracting
or stubbing anything, run a scope check:

```bash
# For each TODO name, check whether every call site is preceded by a
# local `const NAME = ...` in the same parent function. If yes, it's
# a closure-scoped false positive — just delete the marker.
```

Round 2 found two classes of false positive in local_pca_dosage.js:

1. **Closure-scoped** — every call site is covered by a local
   `const X = ...` defined earlier in the same parent function. The
   extractor produced a marker because it didn't model lexical scope.
   Delete the marker. Examples in local_pca_dosage: `toX, toY, xOfWin, mbAt,
   toPx, toPy, _buildJumpMask, flushRun, strokeSamplePath,
   strokeSamplePathStyled, drawRect`.
2. **Lexical** — the bare word appears only inside template literals,
   comment text, or DOM `el.dataset.foo` property access, never as
   a function call or unresolved identifier. Delete the marker.
   Examples in local_pca_dosage: `samples, dataset, hubs, jittered, layer`.

A 30-line Python script to do this check across a page is in the round
2 chat log (search for `scope_check.py`).

### Step 3 — extract or stub each TODO_MISSING

For each remaining (non-false-positive) name, choose:

- **(a) Extract from legacy.** Find the function body in
  `legacy/Inversion_atlas.html`. Copy verbatim. Add a comment noting
  the legacy line range. If the function references `state.X` as a
  global, change to `state.X` where state is the first arg.
- **(b) Hoist to shared/.** If 2+ pages reference the function, put it
  in `shared/<topic>.js` and import.
- **(c) Stub it.** If the function is rarely called and has a clean
  no-op behavior (e.g. a strip renderer that just returns when its
  data isn't available), stub it with a one-line `function X() { return; }`
  and add a `// STUBBED:` comment.

**Round-2 stub conventions** (used in local_pca_dosage.js):
- Group all stubs into a single labeled "Stubs block" near the top.
- Match the return shape the call site actually uses:
  - `[r, g, b]` arrays for color helpers (`simColor`, `simColorPDF`, `zColorPDF`)
  - CSS color strings for sample-color helpers (`trackedColor`, `_vColor`, `getSampleColor`)
  - `{x, y, signX, signY}` for `getPCRender` — destructured at call sites
  - `{mbMin, mbMax}` for `currentMbRange` — properties read directly
  - `null` for cluster/band lookups that have `if (cl)` checks
  - `[]` for index accessors (`for...of` on the result)
  - `void` for guarded renderers
- Each stub has a one-line comment block above it explaining why this
  return shape and what the real legacy lines are. Example:

  ```js
  // STUBBED: 2026-05-06 round 2.
  //   simColor: legacy 31256-31263. Returns [r,g,b]. Stub returns mid-grey.
  function simColor(/* v */) { return [160, 160, 160]; }
  ```

### Step 4 — append the mount wrapper

Every page needs a `mount(root, atlasState, registry)` export. See
`pages/discovery/local_pca_dosage.js` for the canonical example. The wrapper:

1. Imports `resolve` and `getState` from `../../../../core/atlas_api.js`.
2. Builds a legacy-shaped state object from atlasState (`_buildLegacyState`).
3. Resolves the page's required layers via `registry.resolve(...)`.
4. Calls the legacy entry-point functions (`applyData`, `drawSim`, etc.).
5. Wires DOM event handlers to call `onSimClick`, `setCur`, etc.

If the page has no event handlers, the wrapper is just data → render.
If the page has many, factor the wiring into `_wireCanvasHandlers(root, state)`.

### Step 5 — also export an `unmount(root)` if needed

Pages that:
- Run a `playTimer` (local_pca_dosage) → must clear it.
- Subscribe to AtlasState events → must unsubscribe.
- Hold large RAM data → optionally drop it.

Otherwise, no unmount export is needed; the shell just replaces the DOM.

### Step 6 — syntax-check

```bash
node --check pages/<stage>/pageN.js
```

If it parses, ship. **No tests this round, per Quentin.**

### Step 7 — log progress in this file

Append a one-line entry to "Migration log" at the bottom:

```
2026-05-XX  pageN.js  — N TODOs resolved (M-K still open). Mount wrapper added.
```

---

## Anti-patterns (don't do these)

```js
// ❌ Don't import the legacy global state
import { state } from 'somewhere';

// ❌ Don't reach into window
const cur = window.state.cur;

// ❌ Don't add new state-mutating side effects in render functions
function drawSim(state) {
  state.cur = 0;  // NO — render functions read state, mount writes
  ...
}

// ❌ Don't try to fully migrate a page in one pass
// 4361 LOC + 89 TODOs is a multi-chat job. Resolve a batch, ship, log.
```

```js
// ✅ Take state as first arg, return values, don't mutate
function drawSim(state) {
  const ctx = state.simCtx;
  // ... read from state, draw to canvas ...
}

// ✅ Import shared utilities from shared/
import { themeColor } from '../../shared/page1_utils.js';

// ✅ Use the registry for cross-page data
const data = await registry.resolve('scrubber_main', { chrom });

// ✅ Stub clearly with a comment
function _drawSnpDensityStrip(state) {
  // STUBBED: 2026-05-XX. Re-extract from legacy lines NNNNN-NNNNN
  // when the SNP density layer is wired up.
  return;
}
```

---

## Migration order

The order matters because some pages share extracted helpers.

1. **local_pca_dosage** (4361 LOC, 89 TODOs originally) — THE big page. Discovery focus,
   sim_mat + Z + lines + PCA. Round 1 partial: 7 utility TODOs resolved
   via `shared/page1_utils.js`. Round 2: 15 false-positive TODOs removed
   + 34 truly-missing names stubbed. **0 TODO_MISSING markers remain
   (down from 89).** Real bodies still need to be extracted from legacy
   in future rounds; the page renders fail-soft until then.
2. **candidate_focus** (46 TODOs) — cohort overview. Probably reuses many of
   local_pca_dosage's helpers. When migrating candidate_focus, look at which local_pca_dosage stubs
   it would also call — those are the candidates for hoisting to
   `shared/color_helpers.js` etc. (recipe Step 3 option (b)).
3. **boundary_refinement** (31 TODOs) — review.
4. **catalogue** (26 TODOs) — catalogue.
5. **local_pca_theta_pi** (18 TODOs) — discovery.
6. **karyotype_tier** (12 TODOs) — review.
7. **cross_species_breakpoints** (11 TODOs) — comparative.
8. The smaller pages (1–7 TODOs each) — quick wins.

Approximate effort: local_pca_dosage needs 3–4 chats; the rest of the discovery
pages another 2–3; review + catalogue 2 chats; comparative 1 chat. So
8–10 chats to migrate everything. NOT one chat. Pace accordingly.

---

## Migration log

Append-only. One line per migration session.

```
2026-05-06 (chat ~30, late evening)
  local_pca_dosage.js round 1:
    - Fixed import paths (../shared/ → ../../shared/) across 9 page files.
    - Extracted 6 utilities into shared/page1_utils.js:
      escapeHtml, fitCanvas, formatTrackVal, niceTicks, themeColor, withAlpha
    - Identified drawRect as false-positive TODO (closure-scoped, line 35691).
    - Appended mount/unmount wrappers (~100 LOC).
    - 7 TODOs resolved (89 → 82). 82 still open.
    - local_pca_dosage.js parses (node --check).
    - NOT runtime-tested (no test suite this round).
```

```
2026-05-06 (chat ~31)
  local_pca_dosage.js round 2:
    - Audited all 47 unique remaining TODO_MISSING names (49 total markers
      including dupes) via scope_check.py: for each name, checked whether
      every call site is preceded by a local `const NAME = ...` in the same
      parent function, OR whether the name appears only in template literals
      / comments / DOM dataset accesses (lexical false positives).
    - Removed 15 false-positive markers:
        Closure-scoped (10): toX, toY, xOfWin, mbAt, toPx, toPy,
          _buildJumpMask, flushRun, strokeSamplePath, strokeSamplePathStyled
        Lexical (5): samples, dataset, hubs, jittered, layer
    - Stubbed the remaining 34 truly-missing names at module scope, in a
      single labeled "Stubs block" near the top. Each stub returns a safe
      default matching how the call site uses the value (array, object,
      scalar, or void). Each stub has a one-line comment naming the legacy
      line range to extract from in a future round.
    - Stubs added (34):
        9 strip renderers (_drawBandTraceStrip, _drawDiamondOverlay,
          _drawInheritanceLabelsStrip, _drawLineageStrip,
          _drawRegimeBreadthStrip, _drawSnpDensityShade, _drawSnpDensityStrip,
          _drawTrackedLinkageStrip, _drawTransitionRateStrip)
        8 candidate / window-nav (_assignCandidateLanes, _paintCandidateBands,
          _winNavBand, _wRowBand, _drawWRow, _drawWinNavLane,
          _ensureCsOverlayIndex, drawCandidateBar)
        6 color helpers (simColor, simColorPDF, zColorPDF, _vColor,
          trackedColor, getSampleColor)
        2 sim/PCA scale + render (getActiveSimScale, getPCRender)
        6 per-window/grid accessors (currentMbRange, getLinesGrid,
          getLinesSignAt, getLinesValuesAt, getL2Cluster, allSampleIdx)
        3 misc (recomputeAnchorConcord, _resolveSampleScopeColor,
          _refreshScreeInset)
    - 0 TODO_MISSING markers remain (down from 49).
    - local_pca_dosage.js parses (node --check). No new exports added; all stubs are
      module-private. No collision with existing top-level definitions
      (verified: every stubbed name has exactly one top-level definition).
    - File grew from 4513 LOC → 4588 LOC (+75 LOC: comment block expansion
      + 34 one-line stubs).
    - NOT runtime-tested (no test suite this round, per Quentin).
    - DID NOT extract real bodies from legacy — that is round 3 work.
      Recommended order for round 3: hoist the pure color helpers (simColor,
      simColorPDF, zColorPDF) to shared/color_helpers.js since candidate_focus will
      reuse them; then extract currentMbRange + getActiveSimScale (small,
      mostly state-read); then the heavier accessors.
```

```
2026-05-06 (chat ~34, round 3)
  local_pca_dosage.js round 3:
    - Hoisted 3 pure color helpers from legacy into a new shared module
      atlases/inversion/shared/color_helpers.js (~95 LOC):
        simColor       (legacy 31256-31263)
        simColorPDF    (legacy 31281-31294)
        zColorPDF      (legacy 31299-31307)
      Internals (hex, lerpRGB, SIM_PDF_COLORS, Z_LOW/MID/HIGH) kept module-
      private. Pure functions, no state, no DOM.
    - local_pca_dosage.js: imported the 3 helpers from shared/color_helpers.js;
      removed the 3 round-2 stubs.
    - local_pca_theta_pi.js: added the same import so its line-613 typeof-guard
      resolves to the shared module instead of relying on a legacy global.
      (local_pca_theta_pi was the reason for hoisting; local_pca_dosage alone would not have
      justified a new shared file.)
    - Replaced 2 module-scope stubs with verbatim legacy bodies, refactored
      to take `state` as first arg (round-2 convention):
        getActiveSimScale(state)  — legacy 31311-31329
        currentMbRange(state)     — legacy 31781-31834
      Updated all 8 call sites in local_pca_dosage.js (drawSim, drawSimMini, drawZ x2,
      drawLinesPanel, buildLinesPanel x3) to pass `state`. All call sites
      were already inside `function X(state) { ... }` so no scope work.
    - Updated the round-2 "RESOLVED / FALSE POSITIVE / STUBBED" accounting
      comment at the top of local_pca_dosage.js to reflect round 3 progress, and
      shrunk the "still open" list accordingly.
    - Stubs in local_pca_dosage.js: 34 → 29 (5 resolved: 3 imported, 2 promoted
      to real bodies in-place).
      Still open after round 3:
        Subpanel renderers (9): _drawBandTraceStrip, _drawDiamondOverlay,
          _drawInheritanceLabelsStrip, _drawLineageStrip,
          _drawRegimeBreadthStrip, _drawSnpDensityShade, _drawSnpDensityStrip,
          _drawTrackedLinkageStrip, _drawTransitionRateStrip
        Candidate / window-nav (8): _assignCandidateLanes, _paintCandidateBands,
          _winNavBand, _wRowBand, _drawWRow, _drawWinNavLane,
          _ensureCsOverlayIndex, drawCandidateBar
        State-bound color helpers (4): _vColor, trackedColor, getSampleColor,
          _resolveSampleScopeColor
        Sim/PCA render (1): getPCRender
        Per-window/grid accessors (5): getLinesGrid, getLinesSignAt,
          getLinesValuesAt, getL2Cluster, allSampleIdx
        Misc (2): recomputeAnchorConcord, _refreshScreeInset
    - Verified: local_pca_dosage.js, local_pca_theta_pi.js, color_helpers.js all parse-clean
      (node --check). All other shared/*.js and pages/**/*.js still parse-
      clean. atlas-core engine: 9/9 files parse-clean; 23/23 assertions
      passing on test_registry_write_and_versioning.js.
    - NO registry layers added, NO master_config edits, NO schema edits.
      The 5 round-3 names were all pure (color helpers) or pure-from-state
      (currentMbRange, getActiveSimScale read state.data only). No data
      lifecycle / DATA_LIFECYCLE.md classification needed yet.
    - Suggested order for round 4: state-bound color helpers next
      (trackedColor, getSampleColor, _vColor, _resolveSampleScopeColor)
      — they read state.linesColorMode, state.colorMode, state.ancestryPalette,
      state.hubFamilies, etc. Several of those are TODO_MISSING_SLOT names,
      so round 4 will likely need to register those slots in
      shared/state.js SLOT_REGISTRY before the bodies can be extracted.
```

```
2026-05-06 (chat ~34, round 3 step 3 — parity restoration)
  local_pca_dosage.js seventh-pass:
    - Audit found the previous "round 3 done" claim was wrong: local_pca_dosage.js
      had 17 unguarded helper calls in applyData/setCur/autoPickRadial/
      cycleKAside/onPCAClick that would throw ReferenceError at mount
      time, plus 23 bare-form drawX()/renderX() calls without state arg
      (the round-2-convention required state, but the extractor missed
      these), plus 8 unguarded document.getElementById(X).Y accesses
      for elements not in the local_pca_dosage.html fragment.
    - Verified local_pca_dosage.html is byte-identical to legacy <main id="local_pca_dosage">
      (1344 LOC, lines 5474-6817 of legacy).
    - Verified inversion.css has 49/49 #local_pca_dosage selectors matching legacy
      (comment-stripped set comparison: ∅ in both directions).
    - Extracted 18 helpers verbatim from legacy into a new "Legacy
      helpers (parity)" block in local_pca_dosage.js (725 LOC, before "Extracted
      bodies"):
        Constants: FAMILY_PALETTE_BASE, FAMILY_COLOR_SMALL/SINGLETON/
          UNMATCHED, VIEW_CONTROLS_STORAGE_KEY, _LINES_COLOR_MODES.
        data-pure: inferLayersFromV1, detectSchemaAndLayers (205 LOC,
          largest), listLayers.
        state+pure: availablePCs, getPCByAxis, getPCRender (replaces
          round-2 stub), getPC, _isLinesColorModeAvailable.
        state+mutate: buildIndexes, computePC1Signs, buildFamilyPalette.
        state+DOM: populateSimScales, refreshBandPickBar,
          refreshCandidateUI, loadViewControls, saveViewControls,
          reconcileViewControlsForData.
        state+cluster: getL2Cluster, getL2ClusterAt (both adapted to
          shared/per_l2_cluster.js's ctx-based API).
        accessors: getLinesGrid, getLinesSignAt, getLinesValuesAt,
          allSampleIdx (replaces 4 round-2 stubs).
    - Removed 6 round-2 stubs (now real bodies): getPCRender, getLinesGrid,
      getLinesSignAt, getLinesValuesAt, getL2Cluster, allSampleIdx.
    - Wrapped 17 unguarded calls with typeof === 'function' guards.
      14 of them now resolve to the newly-extracted helpers; 3 stay
      forever-guarded because legacy itself never defined them
      (refreshColorModeBar, refreshPcaAxisBar, refreshPinUI — the
      legacy was running with these as silent ReferenceErrors absorbed
      by some upstream try/catch).
    - Made 8 unguarded document.getElementById accesses null-safe for
      sidebar/topbar elements not in the local_pca_dosage.html fragment.
    - Sed-swept 23 bare-form drawX()/renderX()/buildX() calls to pass
      state. Patched 5 setCur(X) → setCur(state, X). Patched 2 getPC(X)
      → getPC(state, X). Verified 0 bare-form calls remain.
    - Widened shared/per_l2_cluster.js imports: added clusterL2AtK,
      sampleSpreadL2, sigmaProfileL2, sampleSpreadRange, aggregateL2.
    - Stubs in local_pca_dosage.js: 29 → 23 (6 resolved, all from real-body
      replacements).
    - local_pca_dosage.js LOC: 4672 → 5397 (+725 from the legacy-helpers block,
      net of stub deletions).
    - Real-browser-style smoke test (assembled workspace + fake DOM):
      module loads (28 exports), applyData populates state correctly
      against synthetic precomp data, all 6 entry points run, mount()
      and unmount() complete without throwing.
    - Helper-correctness verified: schemaVersion=2, layersPresent={
      envelopes,samples,tracks,windows}, windowToL1=[0,0,0,-1,-1],
      windowToL2=[0,0,-1,-1,-1], hubFamilies=[0], smallFamilyIds=[1,2],
      l2NeighborsInL1.size=1 — all matching legacy semantics.
    - NO registry layers added/modified/removed. NO master_config edits.
      NO schema edits. NO atlas-core engine edits. NO HTML/CSS edits.
    - Suggested round 4: state-bound color helpers (4 stubs:
      _vColor, trackedColor, getSampleColor, _resolveSampleScopeColor).
      May need SLOT_REGISTRY additions in shared/state.js. Then round 5
      tackles the 8 candidate/window-nav helpers when their registry
      layers are wired. The 9 strip renderers stay stubbed until their
      data layers land.
```

```
2026-05-06 (chat ~34, round 3 step 4 — full legacy parity)
  local_pca_dosage.js eighth-pass:
    - Per Quentin's direction: "finish page 1 fully... then split
      the huge js into smaller per-type-of-analysis files" — this
      pass closes the legacy-parity gap; the split is next session.
    - Audited the 23 stubs from pass 7. 19 found in legacy with real
      bodies (1265 LOC total). 4 not found in legacy in any form
      (_winNavBand, _wRowBand, _drawWRow, _drawWinNavLane); legacy
      itself runs with these as undefined (line 52173 has a
      `typeof _winNavBand === "function"` guard). Keeping them
      stubbed IS legacy parity.
    - Extracted all 19 verbatim. To reconcile their use of `state`
      as a global (legacy convention), introduced a module-level
      `_pageState` reference and a `_setActiveState(state)` setter.
      Every entry-point (26 functions) now sets _pageState on its
      first line. Every extracted body has `const state = _pageState;`
      (or `const _state = _pageState;` if the body already used a
      _state alias) injected at the top.
    - Re-inserted getActiveSimScale + currentMbRange (lost in the
      splice — they had been added during round-3-step-1 inside the
      old stubs block).
    - Stubs in local_pca_dosage.js: 23 → 4 (the forever-stubbed referenced-
      but-undefined-in-legacy quartet).
    - local_pca_dosage.js LOC: 5397 → 6684 (+1287 from extracted bodies +
      _pageState scaffolding).
    - Smoke tested with N=100 windows, S=50 samples, 2 L1 envelopes,
      2 L2 envelopes, 8 family IDs:
        mount() runs without throwing
        applyData populates state correctly (pc1Sign 100 entries,
          windowToL1/L2 indexed correctly, 8 hub families,
          l2NeighborsInL1.size=2)
        setCur(25) exercises drawSim/drawZ/drawTracks/drawLinesPanel/
          drawPCA/updateWinLabel chain without errors
        unmount() cleans up
    - NO registry / master_config / schema / engine / HTML / CSS edits.
    - NEXT (round 4): split local_pca_dosage.js into 10 cohesive sub-modules under
      pages/discovery/local_pca_dosage/. Each module ≤ 1400 LOC. _pageState
      shared via ES module live-binding semantics from local_pca_dosage/_state.js.
```

```
2026-05-06 (chat ~35, round 4 — split into sub-modules)
  local_pca_dosage.js round 4:
    - Per the eighth-pass plan: split the 6684-LOC monolith into 10
      cohesive sub-modules under pages/discovery/local_pca_dosage/. Quentin's
      criterion: "easier to work with and faster" — biggest sub-module
      is now z_panel.js at 1375 LOC.
    - Modules created (LOC, concerns):
        local_pca_dosage.js (main)        431  imports, mount/unmount/applyData,
                                    _buildLegacyState, _wireCanvasHandlers,
                                    public re-exports
        local_pca_dosage/_state.js        185  export let _pageState, _setActiveState,
                                    FAMILY_PALETTE_BASE + sibling FAMILY_COLOR_*
                                    constants, color helpers
        local_pca_dosage/_data.js         643  schema/layer detection, PC accessors,
                                    indexing, view controls, line accessors,
                                    range/scale helpers, _LINES_COLOR_MODES,
                                    VIEW_CONTROLS_STORAGE_KEY
        local_pca_dosage/sim_panel.js     451  drawSim, drawSimMini
        local_pca_dosage/z_panel.js      1375  drawZ + 9 strip renderers
        local_pca_dosage/lines_panel.js  1304  drawLinesPanel, buildLinesPanel,
                                    buildLinesPanelCheckboxes,
                                    refreshLinesColorMode,
                                    setLinesPanelCandidateBands
        local_pca_dosage/pca_panel.js     626  drawPCA, drawAnchorStrip,
                                    recomputeAnchorConcord, _refreshScreeInset,
                                    autoPickRadial, cycleKAside, togglePlay,
                                    renderTrackedList, renderManualGroupsList
        local_pca_dosage/l3_panel.js      883  renderL3Panel, renderL3PanelSlab,
                                    renderL3PanelScaleStability
        local_pca_dosage/candidates.js    480  _assignCandidateLanes, _paintCandidateBands,
                                    _ensureCsOverlayIndex, drawCandidateBar,
                                    refreshBandPickBar, refreshCandidateUI,
                                    + 4 forever-stubs
        local_pca_dosage/events.js        362  onSimClick/onZClick/onPCAClick, setCur,
                                    updateWinLabel, buildTrackPanels, drawTracks
    - _pageState shared via ES module live-binding semantics. _state.js
      exports `let _pageState` (live `let` binding) plus `_setActiveState`.
      Every panel module imports _pageState. When any public entry-point
      calls _setActiveState(state) on its first line, the binding updates
      and every importer sees the new value. Verified by micro-test:
      stateA → stateB switching observed across 3 module boundaries.
    - Bodies extracted byte-verbatim from local_pca_dosage.js.bak. The only
      programmatic mutation is `export ` prefix injection for names
      imported by another sub-module (idempotent regex skips
      already-exported names). No semantic edits, no cleanups.
    - Sub-module path discipline: local_pca_dosage/ is one directory deeper than
      local_pca_dosage.js itself, so all `'../../shared/X.js'` imports become
      `'../../../shared/X.js'`. Done programmatically.
    - applyData lives in main, not in _data.js. Reason: applyData
      orchestrates calls to detectSchemaAndLayers (data),
      buildIndexes/computePC1Signs/populateSimScales/buildFamilyPalette
      (data), refreshBandPickBar/refreshCandidateUI (candidates),
      buildLinesPanel/buildLinesPanelCheckboxes/refreshLinesColorMode
      (lines), buildTrackPanels/setCur (events), renderTrackedList (pca).
      Putting applyData in _data.js would mean _data.js imports from
      every panel — a cycle. Keeping it in main lets the panels stay
      concern-focused; main is the only module with cross-panel imports.
    - The manifest's `module: "local_pca_dosage.js"` import contract is preserved.
      local_pca_dosage.js re-exports the 26 public entry points from their
      sub-modules via `export {drawSim, ...} from './local_pca_dosage/sim_panel.js'`
      etc. plus mount/unmount/applyData defined locally.
    - local_pca_dosage.js LOC: 6684 (one file) → 6740 total across 10 files
      (the +56 LOC is module docstrings + import/export lines).
    - Symbol-level diff vs local_pca_dosage.js.bak: 90 named definitions present
      in both, 0 added, 0 removed. No definitions lost or duplicated.
    - tests/test_discovery_page1.js: stale path fixed
      (../inversion_discovery/local_pca_dosage.js → ../atlases/inversion/pages/
      discovery/local_pca_dosage.js) and extended with sub-module export-coverage
      checks. 61/61 assertions pass.
    - Smoke test (assembled workspace + fake DOM, N=100 windows,
      S=50 samples, 2 L1 envelopes, 2 L2 envelopes, 8 family IDs):
        applyData populates state correctly (schemaVersion=2,
          layersPresent has envelopes/samples/windows, pc1Sign 100
          entries, windowToL1/L2 indexed correctly, 8 hubs,
          l2NeighborsInL1.size=2)
        setCur(state, 25) exercises full draw chain without errors
        Each public draw fn called directly: no errors
        mount() through atlas_api.bootstrap → registry.resolve →
          applyData → initial-render loop: end-to-end, no errors
        unmount() clears inversion._page1State
        _pageState live-binding observed across module boundaries
        33/33 assertions pass.
    - NO registry / master_config / schema / engine / HTML / CSS edits.
      Sibling pages parse-checked but not modified.
    - local_pca_dosage.js.bak (the pre-split monolith, 6684 LOC) preserved
      alongside the new local_pca_dosage.js as a reference. Delete after round 5
      verifies the split in a real browser.
    - Round-4 split tool: /home/claude/work/split_page1.py (one-shot;
      saved for round 5 cribbing).
    - NEXT (round 5): candidate_focus migration. See
      HANDOFF_2026-05-06_chat34_page2_plan.md. Recipe is mature; one
      cross-cutting decision to make first — hoist local_pca_dosage+candidate_focus shared
      helpers from local_pca_dosage/_data.js to atlases/inversion/shared/ (Quentin
      chat 35: "I feel like using a shared/ if its for a function why
      not"). The pure-on-state helpers in _data.js (getPC*, getL2Cluster*,
      allSampleIdx, getLines*, listLayers, currentMbRange,
      getActiveSimScale, loadViewControls, etc.) are file-move + import-
      path-update only — they already take state as first arg.
```

---

# 2026-05-07 (chat 36 round 5 step 1) — local_pca_dosage data helpers HOISTED to shared/

```text
TODO: round-5 prep — hoist pure-on-state helpers from
    pages/discovery/local_pca_dosage/_data.js to atlases/inversion/shared/
    BEFORE starting the candidate_focus body migration. (Plan: round-4-done
    handoff "Round-5 prep" section + candidate_focus plan Step 5.)

DECISION (file-move-only, no body edits):
    - 21 names declared in _data.js — 17 exported, 4 internal
      (VIEW_CONTROLS_STORAGE_KEY, inferLayersFromV1, getPCByAxis,
      saveViewControls).
    - All take `state` as first arg already (round 3 step 3 prep work).
    - Zero `_pageState` references. DOM access only in
      `populateSimScales` (writes a <select>) and the load/save
      view-controls helpers (localStorage). All three keep working
      from shared/ — no shim needed because they don't read
      `_pageState`.

DO:
  1. Build atlases/inversion/shared/page1_data_helpers.js:
     - Header documenting the hoist (importers list, body-byte
       discipline note, pre-existing state-as-arg convention).
     - Verbatim bodies of all 21 names from _data.js (lines 27-643).
     - Import of `per_l2_cluster.js` rewritten from
       `../../../shared/per_l2_cluster.js` to `./per_l2_cluster.js`
       (the new file lives in shared/, not under local_pca_dosage/).
     - `import { FAMILY_PALETTE_BASE } from './_state.js'` line
       dropped — the constant moves into this file as a private const.

  2. Replace pages/discovery/local_pca_dosage/_data.js with a re-export shim
     (38 LOC):
        export { getActiveSimScale, currentMbRange, _LINES_COLOR_MODES,
                 _isLinesColorModeAvailable, detectSchemaAndLayers,
                 listLayers, availablePCs, getPCRender, getPC,
                 buildIndexes, computePC1Signs, populateSimScales,
                 buildFamilyPalette, loadViewControls,
                 reconcileViewControlsForData, getL2Cluster,
                 getL2ClusterAt, getLinesValuesAt, getLinesGrid,
                 getLinesSignAt, allSampleIdx,
        } from '../../../shared/page1_data_helpers.js';
     This preserves every existing `import { ... } from './_data.js'`
     in the 6 panel sub-modules. Live re-export — same identity.

  3. Drop `export` from pages/discovery/local_pca_dosage/_state.js's
     FAMILY_PALETTE_BASE declaration. After the hoist, _data.js's
     `buildFamilyPalette` reads it from its own module scope; nothing
     else in local_pca_dosage references it. Single source of truth in shared/.
     Keep FAMILY_COLOR_SMALL/SINGLETON/UNMATCHED in _state.js — they
     are only used by `familyColor()` in the same file.

DO NOT:
  - Edit any sub-module's import path. The shim handles compatibility.
    Panels still import from `./_data.js`; only NEW code (candidate_focus.js)
    imports directly from `../../shared/page1_data_helpers.js`.
  - Edit any function body. Bodies are byte-verbatim from _data.js.
    The whole point of this round is "no body edits."
  - Hoist the color helpers from _state.js (trackedColor, _vColor,
    _lineageColor, familyColor, ancestryColor, manualGroupColor,
    getSampleColor, _resolveSampleScopeColor). They read `_pageState`
    via the local_pca_dosage shim. Refactoring them to take `state` as first arg
    is round-N work, not round-5-step-1 work. Defer until a page
    actually needs them shared.
  - Touch atlas-core, registries, manifests, schemas, server, CSS,
    HTML. JS-only.
  - Remove `_data.js` outright. The shim's purpose is letting the
    panel modules' import paths stay stable across the hoist.

VERIFY:
  - node --check on all atlases/inversion/**/*.js                PASS
  - tests/test_discovery_page1.js                                PASS (103/103,
        was 61/61; +42 new shared/shim coverage assertions)
  - tests/test_discovery_page2.js (path fix landed too)          PASS (3/3)
  - tests/smoke_discovery_page1_round4.mjs                       PASS (33/33,
        unchanged — mount/unmount/applyData/draw chain end-to-end)
  - Symbol-level identity check (shim===shared, all 21 names)    PASS

WHY THIS UNBLOCKS PAGE2 STEP 5 ("Cross-page imports"):
  Page2's panel modules can now `import { getPC, getL2Cluster, ... }
  from '../../shared/page1_data_helpers.js'` from day one. Because
  these helpers all take `state` as first arg, candidate_focus never inherits
  local_pca_dosage's `_pageState` reference. Page2's own `_pageState` (for its
  candidate-detail-specific helpers) stays decoupled.

WHAT THIS DID NOT TOUCH:
  - atlas-core engine — completely unchanged.
  - The other 9 local_pca_dosage sub-modules — only their _data.js import target
    changed under them, transparently.
  - Page2 body migration — that is round 5 step 2.
  - The candidate_focus registry-entry mismatch (candidate_focus plan Step 0). Defer to
    round 5 step 2.
```

---

# 2026-05-07 (chat 36 round 5 step 2) — candidate_focus candidate-detail page MIGRATED

```text
TODO: migrate candidate_focus from chat-33 stub (251 LOC, 41 TODO_MISSING) to
    a working candidate-detail deep-dive following the local_pca_dosage round-4
    pattern. Plan: HANDOFF_2026-05-06_chat34_page2_plan.md.

DECISIONS:
  Step 0 — registry mismatch resolved.
    Legacy line 5049: candidate_focus tab title "Deep-dive on a single
    promoted candidate. Multi-panel grid... Toggle 'mark
    confirmed' here to populate page 9." Display label: "3
    candidate focus".
    pages.registry.json candidate_focus.requires_layers updated:
      OLD: [scrubber_main, cohort_sample_manifest]
      NEW: [scrubber_main, candidate_tracks, cohort_sample_froh,
            ancestry_global_q, het_band_backbones, arrangement_calls]
    pages.registry.json candidate_focus.requires_slots: added activeCandidate.
    manifest.json: local_pca_dosage label → "local PCA |z|"; candidate_focus label →
    "candidate focus" (both per legacy tab labels).

  5-bucket split (mirrors local_pca_dosage round-4 with adjustments):
    candidate_focus/_state.js          — _pageState + _setActiveState
    candidate_focus/_html_builders.js  — 16 candidate*Html builders
    candidate_focus/_wires.js          — 7 wire functions (post-DOM)
    candidate_focus/_list.js           — 8 list-management helpers
    candidate_focus/_draw_panels.js    — 7 draw functions (canvas)
    candidate_focus.js (main)          — orchestrators + lifecycle

  Cycle resolution: refreshCandidateUI ↔ renderCandidateMetadata ↔
  _list.js's addCandidateToList. Resolved by keeping both
  orchestrators in main candidate_focus.js and using ES module live-binding
  for the back-import (_list.js imports refreshCandidateUI from
  '../candidate_focus.js' — function reference, not parse-time value).

  Defensive _safeBuild() wrapper on each of the 16 sub-panel
  builders in renderCandidateMetadata. Mirrors legacy's existing
  per-wire try/catch pattern. Means a missing legacy global causes
  the affected sub-panel to render empty (with a warning), rather
  than aborting the whole page render.

DO:
  1. Audit legacy line 5049 + 7248 + manifest. Confirm candidate_focus = 
     candidate detail. Update registry + manifest.

  2. Audit candidate_focus.html (12 LOC, byte-matches legacy) and CSS
     selectors (49 .cand-* class rules in current; sufficient).

  3. Extract the 41 helpers per the candidate_focus plan + 2 entry points
     (renderCandidateMetadata, wireCandidateNav). Use a
     brace-matching extractor that handles destructured
     parameter lists (the naive matcher trips on
     `function f({x, y}) {...}` thinking the destructure brace
     opens the body).

  4. Run a cross-module dependency analyzer to assign helpers
     to buckets and determine each bucket's must-export set
     (names referenced from other buckets).

  5. Build the 5 sub-modules:
     - byte-verbatim helper bodies
     - state shim (`const state = _pageState;` injection where
       body uses bare `state` and the function doesn't take state
       as first arg)
     - export prefix injection on must-export names
     - module-private helpers and constants (e.g.
       _BLOCK_DISPLAY_ORDER, _ensureDosageHmState, isInCandidateList)
       inserted alongside their consumers

  6. Build the new candidate_focus.js main:
     - imports from sub-modules
     - public re-exports (preserves manifest's `module:` contract)
     - 4 orchestrators with state-arg signatures
     - `_safeBuild()` defensive wrapper for the innerHTML composition
     - mount/unmount lifecycle (simpler than local_pca_dosage; no chrom data
       load, just reads activeCandidate slot)

  7. Build smoke_discovery_page2_round5.mjs:
     - fake DOM (mirror local_pca_dosage's smoke harness)
     - synth candidate matching legacy's candidate{To,From}JSON schema
     - mount empty-state, mount populated-state, direct orchestrator
       calls, _pageState live-binding, unmount cleanup

  8. Extract candidate_focus-private helpers that the smoke path actually hits:
     isInCandidateList (3 LOC), _candWindowRange (9), _candLockedLabels
     (7), makeCandidateId (5), _defaultSingleTrack (24), _ensureTracks
     (47), _candStorageKey (3), candidateLocMiniHtml (11),
     candidatePanelStubHtml (25), _ensureDosageHmState (19),
     _BLOCK_DISPLAY_ORDER + _BLOCKS_WITH_AXIS_DERIVATION + 
     DOSAGE_HEATMAP_DEFAULTS constants. ~150 LOC total.

  9. Hoist cross-page utilities to shared/page1_data_helpers.js:
     sampleSpreadL2, sampleSpreadRange, _esc, _fmt4, _fmtP, groupColor.
     6 helpers, ~90 LOC. All take `state` as first arg.

DO NOT:
  - Migrate the full closure (~219 helpers, ~8K LOC). Defer to
    subsequent rounds. Use defensive _safeBuild() to make the smoke
    pass with degraded sub-panels.
  - Hoist the entire `_anc*` family (16 helpers from legacy 58068-58289)
    in this round. Wait until the ancestry-confound panel's
    page-vs-shared boundary is clearer.
  - Renumber pages. Quentin's directive: renumber at the COMPLETE
    end of the migration (after all 19+ pages are landed).
  - Rename anything in atlas-core. JS-only changes inside
    inversion-atlas/.

VERIFY:
  - node --check on all atlases/inversion/**/*.js               PASS
  - tests/test_discovery_page1.js (round-5-step-1 unchanged)   PASS (103/103)
  - tests/test_discovery_page2.js (NEW: 58 assertions for
      sub-module + main exports)                               PASS (58/58)
  - tests/smoke_discovery_page1_round4.mjs                     PASS (33/33)
  - tests/smoke_discovery_page2_round5.mjs (NEW: 24 assertions
      mount/render/unmount under fake DOM, _pageState live-binding,
      synth-candidate populated path with 12+ sub-panels rendering)
                                                               PASS (24/24)
  - Total: 218/218 across all 4 test runs (clean reassembly).

WHAT WAS NOT TOUCHED:
  - atlas-core engine — completely unchanged.
  - Page1 sub-modules — only their _data.js shim got 6 new re-exported
    names from shared/page1_data_helpers.js. Sub-module bodies unchanged.
  - 4 candidate-detail sub-panels still degraded (warn-and-continue):
    candidateHaplotypeAnnotationsHtml (needs loadHaplotypeLabels),
    candidateAncestryConfoundHtml (needs the 16-helper _anc* family),
    candidateRegimeRowHtml (needs _ensureRegimeRegistry, _regimesForL2
    with its dependencies), drawCandidateLocationStrip (needs
    drawCandSimMini, drawCandL1Mini, drawCandKaryoMini).
  - Toolkit-registry vs Atlas-state cache decisions. Quentin's plan:
    defer until all pages are migrated.
  - Pages 3, 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
    overview, sv_evidence.

NEXT (round 5 step 3): catalogue migration. Page3 is the L2 catalogue
(sortable/filterable table, TSV/Markdown export). Lives in
atlases/inversion/pages/catalogue/catalogue.js — NOT in pages/discovery/.
Page renumbering deferred to end-of-migration.
```

---

# 2026-05-07 (chat 36 round 5 step 3) — catalogue catalogue (breeding-export only) MIGRATED

```text
TODO: migrate catalogue (catalogue page) from chat-33 stub. Page3 lives in
    atlases/inversion/pages/catalogue/ — NOT pages/discovery/. Per
    Quentin chat-36: "we will renumber the page indexes at the
    complete end" (so catalogue stays catalogue for now).

DECISIONS:
  Step 0 — what's actually migratable.
    Verified independently of chat-33 stub note: `renderCatalogue`,
    `_buildCatalogueRows`, `_filterCatalogueRows`, `_sortCatalogueRows`,
    `_paintCatalogueRow`, the TSV/MD/JSON/SVG/PNG/PDF gallery exports,
    and the regime-promote handlers are REFERENCED in legacy via
    `typeof X === 'function'` guards but NEVER DEFINED. Round-5-step-3
    does not migrate ghosts.
    
    The ONE catalogue-domain feature with real legacy implementation:
    the Turn-146 bulk breeding-card export (lines ~21484–23715,
    1040 LOC closure across 17 helpers + 1 const).

  2-bucket split (smaller than local_pca_dosage/candidate_focus because the migratable
  surface is smaller):
    catalogue/_state.js            — _pageState + _setActiveState
    catalogue/_breeding_export.js  — 17 helpers + _BREEDING_EXPORT_TIER_MODES
    catalogue.js (main)            — mount/unmount + renderCataloguePage +
                                 initCataloguePage + atlasState builder

  Cross-page imports: ZERO. Self-contained. Reads only state.candidateList,
  state.cohortDiversity, state.data, state.k.

  Catalogue rendering = explicit TODO_MISSING. NOT migration debt —
  the legacy snapshot didn't contain those functions. A future round
  may design and implement them, or another legacy drop may surface
  them.

DO:
  1. Audit legacy line 5051 + 7261-7368 + manifest. Confirm catalogue
     identity ("5 catalogue", chromosome-scoped, no activeCandidate).
     Update registry _label / _doc and manifest label.

  2. Independently verify the chat-33 stub's claim that renderCatalogue
     is undefined:
       grep -nE 'function renderCatalogue|renderCatalogue\s*=|window\.renderCatalogue' \
         legacy/Inversion_atlas.html
     If only `typeof renderCatalogue === 'function'` matches: confirmed.

  3. Do a closure walk starting from _wireCatalogueBreedingExportBtns
     (the only catalogue-toolbar handler that exists). Use the smart
     brace-matching extractor (handles function f({x}) {...} param
     destructuring correctly). Closure: 17 functions + 1 constant,
     ~1040 LOC.

  4. Build _breeding_export.js using the same patcher as local_pca_dosage/candidate_focus:
     - byte-verbatim helper bodies in dependency order (leaves first)
     - rewrite legacy
         (typeof window !== 'undefined' && window.state) ? window.state : state
       → _pageState
     - inject `const state = _pageState;` shim where bodies use bare state
     - export prefix on the 3 public names

  5. Build the new catalogue.js main:
     - imports + public re-exports from _breeding_export.js
     - renderCataloguePage(state) — empty-state with hint message
     - initCataloguePage(state) — calls _wireCatalogueBreedingExportBtns,
       leaves the 11 unimplemented toolbar handlers as documented TODOs
     - mount(root, atlasState, registry) — same atlasState→legacyState
       builder pattern as local_pca_dosage/candidate_focus
     - unmount(root) — clears _pageState

  6. Build tests/test_catalogue_page3.js (sub-module + main re-export
     coverage; same shape as test_discovery_page2.js).

  7. Build tests/smoke_catalogue_page3_round5.mjs:
     - fake DOM (mirror local_pca_dosage/candidate_focus smoke harness)
     - localStorage stub (the wire reads/writes the tier pref)
     - mount empty-state, _pageState live-binding observed,
       breeding-export wires bound (#catBreedingTierSel +
       #catExportBreedingHTML + #catExportBreedingJSON marked
       `dataset._wired = '1'`), localStorage tier round-trip,
       mount-twice idempotency, direct entry-point calls,
       unmount cleanup

  8. Replace the existing tests/test_catalogue_page3.js — the chat-33
     version imports from the wrong path (../inversion_catalogue/...)
     and asserts a removed __MODULE_ID__ export.

DO NOT:
  - Implement renderCatalogue / _build/_filter/_sort/_paintCatalogueRow.
    These weren't in legacy. Implementing them would be new development,
    not migration. A separate task.
  - Implement TSV / MD / JSON / SVG / PNG / PDF gallery exports.
    Same reason.
  - Renumber pages. Quentin's directive: at the COMPLETE end.
  - Rename anything in atlas-core. JS-only changes inside
    inversion-atlas/.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - tests/test_discovery_page1.js (unchanged round-5)            PASS (103/103)
  - tests/test_discovery_page2.js (unchanged round-5)            PASS (58/58)
  - tests/test_catalogue_page3.js (NEW; 19 assertions)           PASS (19/19)
  - tests/smoke_discovery_page1_round4.mjs                       PASS (33/33)
  - tests/smoke_discovery_page2_round5.mjs                       PASS (24/24)
  - tests/smoke_catalogue_page3_round5.mjs (NEW; 29 assertions)  PASS (29/29)
  - Total: 266/266 across all 6 test runs (clean reassembly).

WHAT WAS NOT TOUCHED:
  - atlas-core engine — completely unchanged.
  - Page1/candidate_focus sub-modules — completely unchanged this round.
  - shared/page1_data_helpers.js — unchanged (catalogue's closure is
    self-contained, reads only state.candidateList /
    state.cohortDiversity / state.data / state.k).
  - 11 catalogue-toolbar handlers + the catalogue table renderer
    (catalogue-rendering pipeline). These were never in legacy.
  - Toolkit-registry vs Atlas-state cache decisions. Defer.
  - Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
    overview, sv_evidence — only parse-checked.

NEXT (round 5 step 4): Quentin's call. Candidates:
  - confirmed_carousel, marker_panels, stats_profile, marker_readiness, annotation_cockpit — also in pages/catalogue/.
  - overview — non-chromosome-scoped overview.
  - karyotype_tier — does karyotype_tier even have a stub yet? (Check inventory.)
  - Or: implement the 11 missing catalogue handlers as new development
    distinct from migration (not in scope as "migration" but useful
    if Quentin wants the catalogue table to actually work).
```

---

# 2026-05-07 (chat 36 round 5 step 4) — marker_readiness marker readiness panel MIGRATED

```text
TODO: refactor marker_readiness (marker readiness panel, synthesis stage) from
    chat-33 "single-file with const state = window.state || {}" pattern
    to atlas-router-compatible mount/unmount + _pageState live-binding.
    Page18 has ~921 LOC of cohesive body already extracted from legacy.

DECISIONS:
  Step 0 — what's actually migratable.
    Page18 is the second migration of this kind: prior body already
    extracted by an earlier batch, just needs router-integration and
    state-pattern refactor. Body lives at legacy lines 29307-30160
    (851 LOC) — already in chat-33 stub.

  Single file (NOT sub-module split):
    marker_readiness.js — 30 functions + 6 constants, all marker-panel-domain
    marker_readiness/_state.js — _pageState + _setActiveState (only sub-module)
    
    Threshold for splitting: ~3000 LOC AND multiple concerns. Page18
    is 921 LOC with one concern (marker tier classification + render).
    Splitting adds complexity without proportional benefit.

  Cross-page imports: _esc from shared/page1_data_helpers.js (added in
  round 5 step 2 for candidate_focus). 15 unguarded uses in marker_readiness.

  State.X reads: state.candidateList, state.crossSpecies,
  state._markerPanel (lazy-init via _mpEnsureState),
  state.markerThresholds, state.data (chromosome precomp). All map
  to atlasState.inversion + atlasState.shared.activeChrom.

DO:
  1. Audit legacy line 5128 + 8134-8157 + manifest. Confirm marker_readiness
     identity ("15 marker panel", synthesis stage). Update
     pages.registry.json _label/_doc and manifest.json
     label="marker panel" stage="synthesis".

  2. Static-analyze the chat-33 stub for unresolved external references:
       grep -nE "(?<![\w$.])\b[A-Za-z_$][\w$]*\s*\(" marker_readiness.js
     Filter against locally-defined functions. Find the real missing
     globals (in marker_readiness's case: only _esc).

  3. Identify state.X reads:
       grep -hoE "state\.[a-zA-Z_]+" marker_readiness.js | sort -u

  4. Refactor marker_readiness.js IN-PLACE using a Python AST-aware patcher:
     - Replace `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
       with `import { _pageState, _setActiveState } from './marker_readiness/_state.js';`
       and `import { _esc } from '../../shared/page1_data_helpers.js';`
     - For each top-level `function NAME(args) {...}`, inject
       `const state = _pageState;` as the first statement IFF:
         a) body references bare `state` (regex: `(?<![\w$.])\bstate\b`)
         b) body doesn't already declare `state` locally
         c) function doesn't take `state` as first arg
       Reverse-walk through matches so positions stay valid.
     - Replace public renderXPage() with state-aware variant
       that takes (state) and calls _setActiveState(state) before
       delegating.
     - Add mount/unmount/_buildLegacyState lifecycle.

  5. Create marker_readiness/_state.js (18 LOC, mirrors other pages').

  6. Build tests/test_catalogue_page18.js (mirrors test_catalogue_page3.js
     structure: exports + helpers + state + pure-helper exercises).

  7. Build tests/smoke_catalogue_page18_round5.mjs:
     - fake DOM (mirror local_pca_dosage/2/3 smoke harnesses)
     - localStorage stub, requestAnimationFrame stub, URL/Blob/FileReader stubs
     - mount empty-state, _pageState live-binding observed
     - mount populated-state (synthetic candidate with karyotype
       assignments to flex _mpDeriveAutoPanel + _mpSuggestControlsFromKaryotype)
     - direct renderMarkerPanelPage(state) call
     - _mpDeriveAutoPanel() exercise via _pageState
     - unmount cleanup

  8. Replace stale chat-33 test (wrong path, asserts removed
     __MODULE_ID__, wrong AF key casing).

DO NOT:
  - Split marker_readiness into sub-modules. 921 LOC of cohesive code doesn't
    need it. The local_pca_dosage/candidate_focus splits were justified at >3000 LOC and
    multi-concern.
  - Migrate stats_profile (stats profile) at the same time. Page17 reads
    marker_readiness's _mpDeriveAutoPanel, but only via `typeof X === 'function'`
    guard — graceful degradation. Migrating stats_profile in a separate
    round keeps scopes clean.
  - Renumber pages. Deferred to end-of-migration per Quentin.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 4 prior tests unchanged                                  PASS
  - tests/test_catalogue_page18.js (NEW; 46 assertions)          PASS (46/46)
  - All 3 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page18_round5.mjs (NEW; 20 assertions) PASS (20/20)
  - Total: 332/332 across 8 test runs (clean reassembly).

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue modules.
  - shared/page1_data_helpers.js.
  - Other pages (only parse-checked).

NEXT (round 5 step 5+): Quentin's call.
  - stats_profile (stats profile, sibling synthesis page; reads marker_readiness's
    _mpDeriveAutoPanel via typeof guard) — natural follow-up.
  - annotation_cockpit, local_pca_theta_pi — pre-extracted bodies in catalogue.
  - cross_species_breakpoints/16b — multi-species cockpit, much larger.
  - Quick router-wiring rounds for tiny stubs (window_summary_table, 9, 15, 19,
    overview).
```

---

# 2026-05-07 (chat 36 round 5 step 5) — stats_profile stats profile MIGRATED + cross-page state bridge

```text
TODO: refactor stats_profile (stats profile, synthesis stage) from chat-33
    "single-file with const state = window.state || {}" pattern to
    atlas-router-compatible mount/unmount + _pageState live-binding.
    Page17 is sibling synthesis page to marker_readiness; reads marker_readiness's
    _mpDeriveAutoPanel.

DECISIONS:
  Step 0 — Same shape as marker_readiness (round 5 step 4). Pre-extracted body
    (legacy lines 28420-29306, ~939 LOC), 25 functions + 3 constants.
    Single-file (NOT sub-module split) — same threshold rationale.

  Cross-page state bridge: stats_profile.mount calls marker_readiness._setActiveState
    with the SAME legacy state object. Pages share state because:
      a) stats_profile doesn't mutate state.candidateList / state.crossSpecies
      b) marker_readiness's _mpDeriveAutoPanel reads only those + lazy-inits
         state._markerPanel
    This pattern is appropriate for synthesis-stage siblings that
    share a domain. Future rounds may need different patterns for
    pages that mutate state.

  Cross-page imports:
    _esc                 from shared/page1_data_helpers.js (18 sites)
    _mpDeriveAutoPanel   from marker_readiness.js                    (1 site, was typeof-guarded)
    _setActiveState      from marker_readiness/_state.js (aliased as _setPage18State)

  Runtime guards kept (NOT promoted to imports):
    _csGetSyntenyBlocks, _csPermutationTest — cross_species_breakpoints/16b cross-species
    helpers, not yet migrated. Stay as `typeof X === 'function'`
    early-return guards in _spDeriveCsPermutation. When cross_species_breakpoints/16b
    lands these can be promoted to proper imports.

DO:
  1. Audit legacy line ~5125 + 8110-8127 + manifest. Confirm stats_profile
     identity ("14 stats profile", synthesis stage). Update
     pages.registry.json _label/_doc and manifest.json
     label="stats profile" stage="synthesis".

  2. Static-analyze the chat-33 stub. Filter false positives from
     comments/strings (TODO_MISSING, AF_STD, MODULE_3_ROH, Wilcoxon,
     manuscript_note, GLM, N, Repeat, many_to_many).

  3. Use the same Python AST-aware patcher as marker_readiness round-5-step-4:
     - Replace state line with imports
     - Inject `const state = _pageState;` shim into top-level functions
       that read bare `state` and don't take `state` as first arg.
       Reverse-walk through matches. Result: 7 functions get the shim.
     - Replace public renderXPage() with state-aware variant
     - Add mount/unmount/_buildLegacyState

  4. Bridge state to marker_readiness in stats_profile's lifecycle:
     - import { _setActiveState as _setPage18State } from './marker_readiness/_state.js';
     - In renderStatsProfilePage(state), call BOTH _setActiveState
       and _setPage18State.
     - In mount(), call BOTH after building legacyState.
     - In unmount(), do NOT clear marker_readiness's state (marker_readiness may have
       its own mount).

  5. Create stats_profile/_state.js (15 LOC).

  6. Build tests/test_catalogue_page17.js (34 assertions).

  7. Build tests/smoke_catalogue_page17_round5.mjs (20 assertions).

  8. Replace stale chat-33 test.

DO NOT:
  - Split stats_profile into sub-modules.
  - Migrate cross_species_breakpoints/16b at the same time (cross-species cockpit, much
    larger; would push the cs* helpers properly into shared but
    that's a separate task).
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 5 prior tests unchanged                                  PASS
  - tests/test_catalogue_page17.js (NEW; 34 assertions)          PASS
  - All 4 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page17_round5.mjs (NEW; 20 assertions) PASS
  - Total: 386/386 across 10 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue/marker_readiness modules. (Page17 imports FROM marker_readiness but
    doesn't modify marker_readiness's source.)
  - shared/page1_data_helpers.js.
  - Other pages (only parse-checked).

NEXT (round 5 step 6+): Quentin's call.
  - annotation_cockpit (catalogue, 721 LOC pre-extracted) — quick.
  - local_pca_theta_pi (discovery, 1008 LOC, 18 TODOs) — substantial.
  - cross_species_breakpoints/16b (comparative, 2400+ each) — major; would resolve
    cs* cross-species helpers.
  - Tiny stubs (window_summary_table/9/15/19/overview) — quick router-wiring.
```

---

# 2026-05-07 (chat 36 round 5 step 6) — annotation_cockpit annotation cockpit MIGRATED

```text
TODO: refactor annotation_cockpit (annotation cockpit, catalogue stage) from chat-33
    "single-file with const state = window.state || {}" pattern to
    atlas-router-compatible mount/unmount + _pageState live-binding.
    Page21 is a catalogue-stage page that renders a per-sample-lines
    canvas with cursor-driven candidate selection.

DECISIONS:
  Step 0 — Same single-file shape as stats_profile/marker_readiness. Pre-extracted
    body (legacy lines 46938-47616, ~720 LOC), 5 constants + 11
    helpers + 1 public entry. Single-file (NOT sub-module split) —
    same threshold rationale.

  No cross-page state bridge: annotation_cockpit doesn't import from any other
    migrated page. Its 4 external helpers
    (_gatherActiveCandidatesForInheritance,
    _wireCandidateHaplotypeAnnotations,
    candidateHaplotypeAnnotationsHtml,
    computeTrackedLinkageProjection)
    stay as `typeof X === 'function'` runtime guards — same as stats_profile
    with _csGetSyntenyBlocks / _csPermutationTest. They land naturally
    with candidate_focus / cross_species_breakpoints / multi_species_cockpit migration.

  No per-function state shim injection. Page21's body was already
    written to access state through ONE accessor (_ackEnsureState()
    at the top of nearly every function). Rewiring that single
    accessor was sufficient. The one other state read (in
    _annoCockpitChromExtent) was rewired the same way. This is the
    accessor-pattern shortcut: future pages that already have an
    accessor pattern can use it; pages with scattered state.X reads
    need the AST-walking shim injection from stats_profile/18.

DO:
  1. Audit legacy line ~5125 region + 7822-7859 (HTML shell) +
     manifest. Confirm annotation_cockpit identity ("annotation cockpit",
     catalogue stage). Update pages.registry.json _label/_doc and
     manifest.json label="annotation cockpit".

  2. Static-analyze the chat-33 stub for unresolved external
     references. Filter false positives. Find the truly-external
     references (in annotation_cockpit's case: 4 helpers, all already
     runtime-guarded).

  3. Identify state.X reads:
       grep -hoE "state\.[a-zA-Z_]+" annotation_cockpit.js | sort -u

  4. Refactor annotation_cockpit.js IN-PLACE:
     - Replace `const state = (typeof window !== 'undefined'
       && window.state) ? window.state : {};` with
       `import { _pageState, _setActiveState } from './annotation_cockpit/_state.js';`.
     - Rewire _ackEnsureState() (the single state accessor) to read
       from _pageState. Lazy-init of cockpitCursor preserved.
     - Rewire _annoCockpitChromExtent() (the only function reading
       state directly without going through _ackEnsureState).
     - Rename verbatim function refreshAnnotationCockpit() →
       _refreshAnnotationCockpit() (underscore-prefixed body).
     - Add state-aware export function refreshAnnotationCockpit(state)
       wrapper that calls _setActiveState(state) then delegates.
     - Remove __MODULE_ID__ export.
     - Add mount/unmount/_buildLegacyState lifecycle.

  5. Create annotation_cockpit/_state.js (16 LOC, mirrors other pages').

  6. Build tests/test_catalogue_page21.js (41 assertions: exports +
     helpers + constants + _state + pure-helper exercises for
     _ackBandColor / _annoCockpitCandidateAtCursor /
     _annoCockpitChromExtent / _ackEnsureState).

  7. Build tests/smoke_catalogue_page21_round5.mjs:
     - fake DOM with FakeContext canvas shim (annotation_cockpit's draw path
       uses canvas heavily — getContext, setTransform, fillRect,
       strokeRect, fillText, beginPath/moveTo/lineTo/stroke).
     - localStorage stub, requestAnimationFrame stub, URL/Blob/FileReader stubs
     - global._gatherActiveCandidatesForInheritance stub returning
       [] for empty mount, [synthCand] for populated mount.
     - mount empty-state, _pageState live-binding observed.
     - mount populated-state (synthetic K=3 candidate + 7 fish + 3
       windows) → canvas draw path executes.
     - direct refreshAnnotationCockpit(state) call works.
     - _annoCockpitChromExtent reads from _pageState via state.data.
     - unmount clears _pageState.

  8. Replace stale chat-33 test (wrong path
     `../inversion_catalogue/annotation_cockpit.js`, asserts removed
     __MODULE_ID__).

DO NOT:
  - Split annotation_cockpit into sub-modules (~720 LOC, single concern).
  - Promote the 4 runtime-guarded helpers to imports yet
    (candidate_focus/cross_species_breakpoints don't have them migrated).
  - Migrate stats_profile/marker_readiness at the same time (already done in earlier
    rounds).
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 5 prior tests unchanged                                  PASS
  - tests/test_catalogue_page21.js (NEW; 41 assertions)          PASS (41/41)
  - All 5 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page21_round5.mjs (NEW; 20 assertions) PASS (20/20)
  - Total: 447/447 across 12 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue/stats_profile/marker_readiness modules.
  - shared/page1_data_helpers.js (annotation_cockpit doesn't call _esc).
  - Other pages (only parse-checked).

NEXT (round 5 step 7+): Quentin's call.
  - local_pca_theta_pi (discovery, 1008 LOC, 18 TODOs) — substantial.
  - cross_species_breakpoints/16b (comparative, 2400+ each) — would resolve cs*
    helpers AND likely computeTrackedLinkageProjection (annotation_cockpit).
  - Tiny stubs (window_summary_table/9/15/19/overview) — quick router-wiring,
    could batch several in one round.
  - Catalogue completion: confirmed_carousel, marker_panels, overview.
  - Review pages: karyotype_tier, 6, 7, 11, sv_evidence.
```

---

# 2026-05-07 (chat 36 round 5 step 7) — confirmed_carousel confirmed carousel MIGRATED (stub-preserving)

```text
TODO: refactor confirmed_carousel (confirmed candidates carousel, catalogue stage)
    from chat-33 "single-file with const state = window.state || {}"
    pattern to atlas-router-compatible mount/unmount + _pageState
    live-binding. Page9 is a stub even in legacy: HTML shell exists
    but the carousel JS does NOT exist in legacy/Inversion_atlas.html
    (verified by `grep -n confirmedNav legacy/Inversion_atlas.html` —
    only HTML hits, no JS handlers).

DECISIONS:
  Step 0 — Stub-preserving migration. Don't invent functionality
    during migration; preserve the legacy "show empty placeholder"
    contract exactly. The full carousel implementation lands when
    candidate_focus's candidate-focus renderer is accessible.

  Step 0b — Same single-file shape as annotation_cockpit (round 5 step 6).
    Pre-extracted body (105 LOC), 2 public entries, 1 bare state.X
    read. Single-file (NOT sub-module split).

  No cross-page state bridge: confirmed_carousel doesn't import from any other
    migrated page. Its 3 TODO_MISSING items
    (_renderConfirmedCarousel, _wireConfirmedCarouselNav,
    renderCandidateFocus) are NOT runtime-guarded yet — they're just
    TODOs in source comments. They will land naturally when the full
    carousel is implemented (separate task).

  Accessor-shortcut continues to apply (round 5 step 6 finding):
    confirmed_carousel has a single bare `state.candidateList` read inside one
    function. The refactor was trivial: rename the verbatim function,
    prepend `const state = _pageState || {};` inside it, add the
    state-aware export wrapper + lifecycle. No AST-walking patcher
    needed.

DO:
  1. Audit legacy line ~5076 (page-tab tooltip) + lines 7782-7812
     (HTML shell only). Confirm confirmed_carousel identity ("confirmed carousel",
     catalogue stage). Update pages.registry.json _label/_doc and
     manifest.json label="confirmed carousel".

  2. Static-analyze the chat-33 stub. State.X reads: only
     state.candidateList. Single bare read inside one function.
     TODO_MISSING items (3 of them) are NOT in the body — they're
     only mentioned in comments.

  3. Refactor confirmed_carousel.js IN-PLACE:
     - Replace `const state = (typeof window !== 'undefined'
       && window.state) ? window.state : {};` with
       `import { _pageState, _setActiveState } from './confirmed_carousel/_state.js';`.
     - Rename verbatim `function refreshConfirmedCarousel()` →
       internal `function _refreshConfirmedCarousel()`. Inside the
       function, prepend `const state = _pageState || {};` so the
       single bare `state.candidateList` read works.
     - Add state-aware `export function refreshConfirmedCarousel(state)`
       wrapper that calls `_setActiveState(state)` then delegates.
     - Keep `export function initConfirmedCarousel()` as-is (no
       state reads — pure stub).
     - Remove `__MODULE_ID__` export.
     - Add mount/unmount/_buildLegacyState lifecycle. Mount calls
       BOTH refreshConfirmedCarousel AND initConfirmedCarousel
       (legacy page-tab activation flow).

  4. Create confirmed_carousel/_state.js (13 LOC, mirrors other pages').

  5. Build tests/test_catalogue_page9.js (14 assertions: exports +
     lifecycle entry-points + __MODULE_ID__ removal + _state +
     no-doc early return + initConfirmedCarousel no-throw +
     side-effect of refreshConfirmedCarousel(state) on _pageState).

  6. Build tests/smoke_catalogue_page9_round5.mjs:
     - fake DOM (no canvas needed — confirmed_carousel is HTML-only).
     - mount empty-state: #confirmedEmpty visible, navBar + meta hidden.
     - mount populated-state (2 confirmed + 1 unconfirmed): verify
       verbatim legacy stub behaviour — empty element repopulated
       with "2 confirmed candidates" + "Carousel rendering is not
       yet wired" placeholder, navBar still hidden (carousel not
       implemented).
     - direct refreshConfirmedCarousel(state) call works.
     - unmount clears _pageState.

  7. Replace stale chat-33 test (wrong path
     `../inversion_catalogue/confirmed_carousel.js`, asserts removed
     __MODULE_ID__).

DO NOT:
  - Try to implement the actual carousel during migration. Page9 was
    always a stub in legacy; the full implementation requires candidate_focus's
    candidate-focus renderer to be exposed and is a separate task.
  - Promote the 3 TODO_MISSING items to runtime guards. They're not
    referenced in the body, only mentioned in source comments.
  - Migrate overview or marker_panels at the same time (catalogue
    completion is a multi-page task; one page at a time per Quentin's
    directive).
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 6 prior tests unchanged                                  PASS
  - tests/test_catalogue_page9.js (NEW; 14 assertions)           PASS (14/14)
  - All 6 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page9_round5.mjs (NEW; 22 assertions)  PASS (22/22)
  - Total: 483/483 across 14 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue/stats_profile/marker_readiness/annotation_cockpit modules.
  - shared/page1_data_helpers.js.
  - The 3 TODO_MISSING items (kept as comments — fresh-write task).
  - Other pages (only parse-checked).

NEXT (round 5 step 8+): Quentin's call.
  - overview (catalogue, 35 LOC) or marker_panels (catalogue, 244 LOC)
    — both close out the catalogue group.
  - local_pca_theta_pi (discovery, 1008 LOC, 18 TODOs) — substantial.
  - cross_species_breakpoints/16b (comparative, 2400+ each) — would resolve cs*
    helpers + computeTrackedLinkageProjection.
  - Tiny stubs (window_summary_table/15/19/help) — quick router-wiring.
  - Review pages (karyotype_tier, 6, 7, 11, sv_evidence).
```

---

# 2026-05-07 (chat 36 round 5 step 8) — overview synthesis tab MIGRATED (factory + new lifecycle)

```text
TODO: refactor overview (synthesis-stage overview tab) from chat-33
    factory pattern (wirePageOverview(state) → { renderPageOverview })
    to add the standard atlas-router lifecycle alongside. Page_overview
    is the only chat-33 factory-pattern page in the project. Page is
    EMPTY in legacy (legacy line 9322 is `<div id="overview"
    class="page"></div>`, no JS handlers anywhere — verified by grep).

DECISIONS:
  Step 0 — Preserve the factory verbatim, add standard surface alongside.
    Page_overview is the only page using the factory pattern. Rewriting
    to match siblings would break any caller still using
    `wirePageOverview` or the default export. Adding the standard
    surface (`mount`/`unmount`/`renderPageOverview`/`_pageState`)
    alongside the factory gives everyone what they need with zero
    breakage. Both surfaces share `_pageState` via `_setActiveState`.

  Step 0b — Stage correction is part of migration. Manifest had
    `"stage": "catalogue"` but legacy line 5138 clearly tags it
    `data-stage="synthesis"`. Fixed during migration. (Quentin's
    renumbering directive defers page-id renames to end-of-migration;
    fixing a wrong stage label is a bug fix, not a renumbering.)

  Step 0c — Passthrough _buildLegacyState. Page_overview reads no
    specific state slots in the empty-stub implementation.
    `_buildLegacyState` is `Object.assign({}, inv)` so the future
    real overview (likely needing candidateList + layersPresent +
    ancestry slots) gets them automatically without a separate
    refactor.

  Stub-preserving migration (continued from confirmed_carousel round 5 step 7):
    Both pages were empty in legacy. Migration preserves no-op
    semantics exactly while wiring the lifecycle. Smoke tests verify
    no-throw + correct empty-state behaviour. When the real
    implementation lands, it goes in the renamed `_renderXxx()` and
    existing tests keep passing.

DO:
  1. Audit legacy line 5138 (page-tab definition) + line 9322 (HTML
     body — empty <div>). Confirm overview identity ("overview",
     synthesis stage). Confirm via grep that NO JS handlers exist.
     Update pages.registry.json _label/_doc and manifest.json
     stage="synthesis" (was "catalogue").

  2. Static-analyze the chat-33 stub. State.X reads: ZERO. The stub
     never reads state. The factory pattern is the only thing
     different from siblings.

  3. Refactor overview.js IN-PLACE:
     - Add `import { _pageState, _setActiveState } from
       './overview/_state.js';`.
     - Rename the factory's inner closure to top-level
       `function _renderPageOverview()` (no-op body, matches legacy).
     - Add `export function renderPageOverview(state)` wrapper that
       calls `_setActiveState(state)` before delegating.
     - KEEP `export function wirePageOverview(state)` returning
       `{ renderPageOverview: _renderPageOverview }`. Now also calls
       `_setActiveState(state)` for consistency.
     - KEEP `export default wirePageOverview`.
     - Add mount/unmount/_buildLegacyState lifecycle (passthrough
       _buildLegacyState).

  4. Create overview/_state.js (17 LOC, mirrors other pages').

  5. Build tests/test_catalogue_page_overview.js (18 assertions:
     exports + factory + default + direct exports + mount/unmount +
     _state.js live-binding + no-op semantics + factory pattern
     still works + factory propagates state to _pageState).

  6. Build tests/smoke_catalogue_page_overview_round5.mjs (15
     assertions: lifecycle exports + empty + populated mount + render
     direct + factory backward-compat smoke + unmount).

  7. Replace stale chat-33 test (wrong path
     `../inversion_catalogue/overview.js`).

DO NOT:
  - Remove the factory wirePageOverview or the default export. Anyone
    using the chat-33 surface keeps working.
  - Try to implement the actual synthesis overview during migration.
    The design (drop tab vs populate with workflow summary) is a
    Quentin decision deferred to a follow-up round.
  - Migrate marker_panels at the same time.
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 7 prior tests unchanged                                  PASS
  - tests/test_catalogue_page_overview.js (NEW; 18 assertions)   PASS (18/18)
  - All 7 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page_overview_round5.mjs (NEW; 15)     PASS (15/15)
  - Total: 516/516 across 16 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue/confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit modules.
  - shared/page1_data_helpers.js.
  - The TODO_MISSING(synthesis_overview_design) — kept as TODO.
  - Other pages (only parse-checked).

NEXT (round 5 step 9+): Quentin's call.
  - marker_panels (catalogue, 244 LOC) — closes out the catalogue group
    entirely (only catalogue page left).
  - local_pca_theta_pi (discovery, 1008 LOC, 18 TODOs) — substantial.
  - cross_species_breakpoints/16b (comparative, 2400+ each) — would resolve cs*
    helpers + computeTrackedLinkageProjection.
  - Tiny stubs (window_summary_table/15/19/help) — quick router-wiring.
  - Review pages (karyotype_tier, 6, 7, 11, sv_evidence).
```

---

# 2026-05-07 (chat 36 round 5 step 9) — marker_panels marker panels MIGRATED · CATALOGUE COMPLETE

```text
TODO: refactor marker_panels (marker panels, catalogue stage) from chat-33
    factory pattern (`wirePage10(state) → { renderPage10,
    renderMarkerPage }`) to add the standard atlas-router lifecycle
    alongside. Page10 uses the same factory pattern as overview
    (round 5 step 8), so the same migration recipe applies.

DECISIONS:
  Step 0 — Same playbook as overview round 5 step 8 (factory +
    new lifecycle alongside). Page10 has 137 LOC of verbatim legacy
    render code inside the factory closure (legacy lines 57837-58043).
    Don't touch the body; add `_setActiveState(state)` at factory
    entry; add direct exports + mount/unmount alongside.

  Step 0b — Closure-re-creation per direct render. Page10's factory
    closures capture state at factory-call time. The new
    `renderPage10(state)` direct entry handles this by calling
    `wirePage10(_pageState).renderPage10()` — re-creating closures
    with the live state. One extra factory invocation per direct
    render is negligible for HTML-only renders.

  Step 0c — Preserve `renderMarkerPage` as legacy alias. Legacy code
    references `renderMarkerPage()` directly. The chat-33 stub already
    aliased it. Keep both `renderPage10` and `renderMarkerPage` as
    direct exports plus the factory-handle alias.

  Step 0d — Stub: marker_panels had no TODO_MISSING, no external function
    deps, no cross-page imports. Fully self-contained.

DO:
  1. Audit legacy lines 57837-58043 (verbatim 137-LOC body inside
     factory). Confirm marker_panels identity ("marker panels", catalogue
     stage). Update pages.registry.json _label/_doc and manifest.json
     label="marker panels".

  2. Static-analyze the chat-33 stub. State.X reads:
     state.data.{chrom, _layers_present, marker_panel_summary,
     marker_catalogue, marker_primers}, state.candidateList. All
     read-only. No mutations.

  3. Refactor marker_panels.js IN-PLACE:
     - Add `import { _pageState, _setActiveState } from
       './marker_panels/_state.js';`.
     - Inside `wirePage10(state)`: prepend `if (state)
       _setActiveState(state);`. **Do NOT touch the factory body.**
     - Add new external exports:
       - `export function renderPage10(state)` — sets _pageState,
         invokes `wirePage10(_pageState).renderPage10()`.
       - `export function renderMarkerPage(state)` — legacy alias.
       - `export async function mount(root, atlasState, registry)` —
         builds legacyState, sets _pageState, calls renderPage10,
         stashes atlasState.inversion._page10State.
       - `export async function unmount(root)` — clears _pageState.
     - KEEP `export default wirePage10`.

  4. Create marker_panels/_state.js (18 LOC, mirrors other pages').

  5. Build tests/test_catalogue_page10.js (25 assertions). PRESERVE
     all chat-33 behavioural cases verbatim (empty-layers subtitle +
     HTML, missing DOM tolerated, layer-present-but-zero-summaries
     empty state). Add new direct-render assertions, factory
     propagates to _pageState.

  6. Build tests/smoke_catalogue_page10_round5.mjs (26 assertions):
     - fake DOM (no canvas needed — marker_panels is HTML-only).
     - mount empty-layers: subtitle + slot innerHTML.
     - mount populated (synthetic HIGH-tier panel + matching
       candidate): card rendered with id, tier, accuracy, chrom,
       detail-block fallback ("Marker catalogue not loaded").
     - direct renderPage10(state) call works.
     - factory backward-compat: wirePage10 + renderMarkerPage alias.
     - unmount clears _pageState.

  7. Replace stale chat-33 test (wrong path
     `../inversion_catalogue/marker_panels.js`).

DO NOT:
  - Modify the factory body. The 137 LOC of verbatim legacy render
    code is unchanged.
  - Try to refactor the factory body to take state as an arg. The
    closure-re-creation approach in `renderPage10(state)` is fine.
  - Migrate any other page at the same time.
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 8 prior tests unchanged                                  PASS
  - tests/test_catalogue_page10.js (NEW; 25 assertions)          PASS (25/25)
  - All 8 prior smokes unchanged                                 PASS
  - tests/smoke_catalogue_page10_round5.mjs (NEW; 26)            PASS (26/26)
  - Total: 567/567 across 18 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - local_pca_dosage/candidate_focus/catalogue/confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/overview modules.
  - shared/page1_data_helpers.js.
  - The verbatim 137-LOC legacy render body inside wirePage10.
  - Other pages (only parse-checked).

🎉 CATALOGUE + SYNTHESIS GROUPS COMPLETE. All 6 catalogue/synthesis
pages migrated.

NEXT (round 5 step 10+): Quentin's call.
  - local_pca_theta_pi (discovery, 1008 LOC, 18 TODOs) — next-largest discovery
    page; substantial.
  - cross_species_breakpoints/16b (comparative, 2400+ each) — would resolve cs*
    helpers + computeTrackedLinkageProjection.
  - Tiny stubs (window_summary_table/15/19/help) — quick router-wiring rounds.
  - Review pages (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.
```

---

# 2026-05-07 (chat 36 round 5 step 10) — local_pca_theta_pi local-PCA-θπ MIGRATED · 13 TODO_MISSING resolved

```text
TODO: refactor local_pca_theta_pi (local-PCA-θπ chromosome-wide diversity scanner,
    discovery stage) from chat-33 "8 verbatim helpers, state-as-first-arg,
    no lifecycle" pattern to add the standard atlas-router lifecycle.
    Page12 is the θπ sister of local_pca_dosage (same six-panel layout, reads
    theta_pi_* layers instead of dosage). Substantial: 1008 LOC of
    verbatim body from legacy lines 53045-54168 + 13 TODO_MISSING
    markers needing scope-check resolution.

DECISIONS:
  Step 0 — THIRD migration shape introduced: verbatim helpers +
    state-aware wrappers. The chat-33 stub already migrated to
    state-as-first-arg, so each verbatim helper just gets a wrapper
    that sets _pageState then delegates. Cleanest refactor target
    encountered so far.

  Step 0b — TODO_MISSING is a false-positive class (continued from
    local_pca_dosage round 2). All 13 markers (showHide, xToPx, kColor, q,
    colorFor, palette, has, xAt, yAt, toX, toY, fillFor, yToPx)
    verified as closure-scoped via grep — each name has a local
    `const`/`let` declaration inside its calling function. The
    chat-33 extractor produced the markers because it didn't model
    lexical scope. Per recipe step 2.5: delete the markers, leave the
    body alone.

  Step 0c — layersPresent must be a Set. The verbatim helpers call
    `state.layersPresent.has(name)`. _buildLegacyState normalizes
    whatever inv.layersPresent is (Set, Array, or undefined) into a
    guaranteed Set. Without this, helpers throw on first
    panel-visibility check.

  Step 0d — TODO_MISSING_SLOT comments stay. state._simGeom /
    state._thSimGeom / state._zGeom are ad-hoc geometry caches. Their
    formalization in shared/state.js SLOT_REGISTRY is a merge-chat
    decision; keep the markers.

DO:
  1. Audit legacy lines 53045-54168 (8 helpers verbatim). Confirm
     local_pca_theta_pi identity ("local PCA θπ", discovery stage). Update
     pages.registry.json _label/_doc and manifest.json
     label="local PCA θπ".

  2. Run TODO_MISSING scope check (recipe step 2.5):
       grep -nE "const (NAME)\s*=|let NAME\b" local_pca_theta_pi.js
     Confirm every flagged name has a local declaration in its
     calling function. Replace TODO_MISSING block with "RESOLVED"
     comment block with line refs.

  3. Static-analyze state.X reads. Page12 reads: state.layersPresent
     (Set), state.data (sub-paths cusum_theta, theta_pi_per_window,
     theta_pi_local_pca, theta_pi_envelopes), state.candidate,
     state.cur, state._simGeom, state._thSimGeom, state._zGeom.

  4. Refactor local_pca_theta_pi.js IN-PLACE:
     - Add `import { _pageState, _setActiveState } from
       './local_pca_theta_pi/_state.js';`.
     - **Do NOT modify** any of the 8 verbatim helper bodies.
     - Replace TODO_MISSING block with RESOLVED comment block.
     - Keep TODO_MISSING_SLOT comments.
     - Append 8 state-aware wrappers (one per verbatim helper). Each
       wrapper takes `(state)`, calls `if (state) _setActiveState(state);`
       then delegates to `_xxx(state || _pageState || {})`.
     - Append `renderPage12(state)` — runs all 8 in order with
       try/catch per call (graceful degradation).
     - Append mount/unmount/_buildLegacyState. _buildLegacyState
       overlays cross-atlas slots (candidate, candidateList, cur),
       NORMALIZES inv.layersPresent to a Set (handle Set, Array,
       undefined), pulls chrom precomp from inv.tracks[activeChrom],
       passes geometry caches through.

  5. Create local_pca_theta_pi/_state.js (18 LOC, mirrors other pages').

  6. Build tests/test_discovery_page12.js (32 assertions: exports +
     wrappers + verbatim helpers + _state + no-document tolerance +
     null-data tolerance + wrapper side-effects on _pageState +
     no-arg-callable when _pageState is null).

  7. Build tests/smoke_discovery_page12_round5.mjs (29 assertions,
     ~290 LOC). FakeContext canvas shim + document.querySelectorAll
     polyfill for [data-th-layer]. Empty-layers + populated-layers
     paths. **Crucial: confirm verbatim CUSUM hero render executes**
     (FakeContext._ops > 0 on #thCusumStripCanvas).

  8. Replace stale chat-33 test (wrong path
     `../inversion_discovery/local_pca_theta_pi.js`).

DO NOT:
  - Touch the 8 verbatim helper bodies. They're correct; the
    TODO_MISSING markers were lies.
  - Skip the layersPresent Set normalization. The helpers depend on
    `.has(name)`.
  - Promote state._simGeom / state._thSimGeom / state._zGeom out of
    TODO_MISSING_SLOT. That's a merge-chat decision.
  - Migrate window_summary_table/15/19 at the same time.
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 9 prior tests unchanged                                  PASS
  - tests/test_discovery_page12.js (NEW; 32 assertions)          PASS (32/32)
  - All 9 prior smokes unchanged                                 PASS
  - tests/smoke_discovery_page12_round5.mjs (NEW; 29)            PASS (29/29)
  - Total: 628/628 across 20 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - All 9 previously-migrated page modules.
  - shared/ modules (local_pca_theta_pi's existing imports were correct).
  - The 8 verbatim ~1008-LOC helper bodies inside local_pca_theta_pi.js.
  - TODO_MISSING_SLOT comments.
  - Other pages (only parse-checked).

DISCOVERY GROUP STATUS: 3 of 4 migrated (local_pca_dosage, candidate_focus, local_pca_theta_pi). Only
window_summary_table/local_pca_ghsl/negative_regions remain — all tiny stubs.

NEXT (round 5 step 11+): Quentin's call.
  - window_summary_table/local_pca_ghsl/negative_regions (discovery, <50 LOC each) — close out
    discovery group entirely (1-3 quick rounds).
  - cross_species_breakpoints/multi_species_cockpit (comparative, 2400+ each) — would resolve cs*
    helpers + computeTrackedLinkageProjection.
  - help (comparative, 34 LOC) — tiny help-page stub.
  - Review pages (karyotype_tier, 6, 7, 11, sv_evidence).
```

---

# 2026-05-07 (chat 36 round 5 step 11) — cross_species_breakpoints cross-species breakpoints MIGRATED · stats_profile guard-resolution unblocked

```text
TODO: refactor cross_species_breakpoints (cross-species breakpoints, comparative stage)
    from chat-33 "0 explicit exports, bare-state, plain JS" pattern
    to atlas-router-compatible mount/unmount + _pageState live-binding.
    Page16 owns _csGetSyntenyBlocks (legacy line 1488) +
    _csPermutationTest (legacy line 1791), previously runtime-guarded
    in stats_profile. Migrating cross_species_breakpoints unblocks stats_profile guard promotion.

DECISIONS:
  Step 0 — Initial audit pick was multi_species_cockpit (multi-species cockpit,
    2417 LOC), but audit revealed multi_species_cockpit does NOT own the cs*
    helpers — cross_species_breakpoints does. **Switched to cross_species_breakpoints.**

  Step 0b — Same migration shape as stats_profile/marker_readiness (rounds 5 step 4-5):
    AST-aware patcher injects `const state = _pageState;` shim into
    every function body that reads bare `state`. 50 top-level
    functions; 28 got the shim (the other 22 are pure utility helpers
    not referencing state).

  Step 0c — TODO_MISSING resolution:
    - _esc (×61) → import from shared/page1_data_helpers.js (added
      round 5 step 2 for candidate_focus).
    - _getRepeatDensity (×3) → KEPT as runtime guard. Lives at legacy
      line 14477 (candidate_focus territory).
    - setCur, drawZ, drawSim, drawLinesPanel → KEPT as runtime guards.
      Page1 NOW exports all four, but promoting these to imports
      would couple cross_species_breakpoints to local_pca_dosage's module load order. Runtime
      guards preserve graceful degradation.
    - drawWinSumStrip → KEPT as runtime guard. Not defined in legacy.
    - window.popgenDotplot, window.popgenFocalVsBg → KEPT as runtime
      guards. External vendor libs.

  Step 0d — 27 explicit ES exports across 5 logical groups:
    constants (4), render entries (7), cross-page helpers (6 —
    INCLUDING _csGetSyntenyBlocks + _csPermutationTest that stats_profile
    reads via runtime guards), IO helpers (5), hover/event-wiring
    helpers (2). Plus mount, unmount, renderCrossSpeciesPage.

  Step 0e — keep underscore-prefixed bodies as exports. Legacy
    callers reference _renderCrossSpeciesPage() etc. directly. The
    new non-prefixed renderCrossSpeciesPage(state) is purely additive.

  Step 0f — confirmed during audit: computeTrackedLinkageProjection
    (stats_profile + annotation_cockpit runtime guard target) lives at legacy line 46751,
    inside candidate_focus-territory chunks. Will land when candidate_focus's missing
    helpers eventually surface. NOT part of this round.

DO:
  1. Audit. Confirm cross_species_breakpoints owns the cs* helpers (not multi_species_cockpit).
     Update pages.registry.json _label/_doc and manifest.json
     label="cross-species breakpoints".

  2. Static-analyze TODO_MISSING (9 distinct markers):
     - _esc → resolve via import from shared/page1_data_helpers.js.
     - All others → keep as runtime guards.
     Static-analyze state.X reads (18 distinct slots).

  3. Refactor cross_species_breakpoints.js IN-PLACE:
     - Rewrite header comment to document round 5 step 11 migration
       AND the TODO_MISSING resolution status (per-marker).
     - Add `import { _pageState, _setActiveState } from
       './cross_species_breakpoints/_state.js';` and `import { _esc } from
       '../../shared/page1_data_helpers.js';`.
     - Run AST patcher (`/home/claude/work/patch_page16.py`,
       modeled on stats_profile/18 patcher). Reverse-walk through all 50
       top-level function declarations; inject
       `\n  const state = _pageState;` after `function NAME(args) {`
       for bodies referencing bare state without local declaration.
       Tighten "already patched" check to look for actual injection
       (`)\s*\{\s*\n\s*const state = _pageState;`) — substring match
       triggers on docstring mention.
     - Append 27 explicit ES exports at end. Group by logical role.
     - Append mount/unmount/_buildLegacyState + state-aware wrapper
       renderCrossSpeciesPage(state).

  4. Create cross_species_breakpoints/_state.js (26 LOC; mirrors other pages').

  5. Build tests/test_comparative_page16.js (40 assertions: lifecycle
     entries + render entries + cross-page helpers + IO helpers +
     hover/event-wiring + constants + _state + behavioural exercises:
     _isCrossSpeciesJSON accept/reject, renderCrossSpeciesPage(state)
     side-effect on _pageState even when render throws,
     _csGetSyntenyBlocks live-binding via _pageState).

  6. Build tests/smoke_comparative_page16_round5.mjs (23 assertions,
     ~340 LOC). FakeContext + insertAdjacentHTML polyfill. Empty +
     populated mount paths. **Crucial: confirm verbatim
     _csGetSyntenyBlocks AND _csComputeSynteny run through the
     AST-injected shim** with synthetic cs_breakpoints_v1 data.

  7. Replace stale chat-33 test (62-LOC parse-check + dynamic-import
     stub that imports from wrong path
     `../inversion_comparative/cross_species_breakpoints.js`).

DO NOT:
  - Modify the 50 verbatim helper bodies. The only edit is the
    AST-injected `const state = _pageState;` shim into the 28
    functions that read bare state.
  - Promote setCur/drawZ/drawSim/drawLinesPanel to imports. Runtime
    guards preserve graceful degradation.
  - Touch multi_species_cockpit. Separate page; will migrate later.
  - Touch stats_profile's runtime guards. Promotion to imports is a
    follow-up round task.
  - Migrate any other page at the same time.
  - Renumber pages.

VERIFY:
  - node --check on every atlases/inversion/**/*.js              PASS
  - All 10 prior tests unchanged                                 PASS
  - tests/test_comparative_page16.js (NEW; 40 assertions)        PASS (40/40)
  - All 10 prior smokes unchanged                                PASS
  - tests/smoke_comparative_page16_round5.mjs (NEW; 23)          PASS (23/23)
  - Total: 691/691 across 22 test runs.

WHAT WAS NOT TOUCHED:
  - atlas-core engine.
  - All 10 previously-migrated page modules.
  - shared/page1_data_helpers.js (cross_species_breakpoints's _esc import resolves to
    the existing export).
  - Other shared/ modules.
  - The 50 verbatim helper bodies inside cross_species_breakpoints.js (only the
    AST-injected shim — 28 of 50 functions).
  - multi_species_cockpit (audited but separate page).
  - stats_profile's runtime guards for _csGetSyntenyBlocks +
    _csPermutationTest (kept; promotion is a follow-up round).
  - Other pages (only parse-checked).

STRATEGIC VALUE: stats_profile guard-resolution unblocked. cross_species_breakpoints now
exports _csGetSyntenyBlocks + _csPermutationTest as explicit ES
exports. A follow-up round can promote stats_profile's runtime guards
(typeof X === 'function' early-returns) to proper imports.

NEXT (round 5 step 12+): Quentin's call.
  - stats_profile guard promotion — small, fast payoff round (~5 LOC delta).
  - window_summary_table/15/19 (discovery, <50 LOC each) — close out discovery group.
  - multi_species_cockpit (comparative, 2417 LOC) — multi-species cockpit.
  - help (comparative, 34 LOC) — tiny help-page stub.
  - Review pages (karyotype_tier, 6, 7, 11, sv_evidence).
```
