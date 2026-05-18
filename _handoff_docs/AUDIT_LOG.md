# AUDIT_LOG

Per `AUDIT_FIRST.md`: every chat that does substantial work writes
a one-line entry here recording what they audited and what they found.

The next chat reads this BEFORE starting and only re-audits things
that may have changed.

---

## 2026-05-07 (chat ~36, round 5 step 11) — cross_species_breakpoints cross-species breakpoints MIGRATED · stats_profile guard-resolution unblocked

**Context:**
Round 5 step 10 migrated local_pca_theta_pi (local-PCA-θπ). Round 5 step 11 (this
round) tackles **cross_species_breakpoints** — the comparative-stage cockpit for
chromosome-scale rearrangements between Cgar and Cmac. Strategic
value: cross_species_breakpoints owns `_csGetSyntenyBlocks` (legacy line 1488) and
`_csPermutationTest` (legacy line 1791), previously runtime-guarded
in stats_profile (synthesis stats profile). Round 5 step 5 noted these
would land naturally with cross_species_breakpoints migration. **This round makes them
explicit ES exports.** A follow-up round can promote stats_profile's runtime
guards to imports.

**Audited:**
- Initial pick: **multi_species_cockpit** (multi-species cockpit, 2417 LOC, 64
  functions). Audit immediately revealed multi_species_cockpit does NOT own the
  cs* helpers — cross_species_breakpoints does. **Switched to cross_species_breakpoints.**
- Legacy provenance: 50 helpers from lines 20971-21114 (constants +
  IO/state) + 23717-26025 (cross-species runtime: filter/sort,
  render*, ideograms, flank charts, synteny, dotplot, focal-vs-bg) +
  28367-28419 (`_csBuildPermResultHtml`).
- Pattern: 0 explicit exports, no top-level `state` declaration, all
  50 helpers use bare `state.X` references (would throw
  `ReferenceError: state is not defined` on any call). **Same shape
  as stats_profile/marker_readiness** — full AST-shim-injection refactor.
- TODO_MISSING analysis (9 distinct markers):
  - `_esc` (×61 unguarded) — RESOLVED via import from
    shared/page1_data_helpers.js (added round 5 step 2 for candidate_focus).
  - `_getRepeatDensity` (×3 sites) — KEPT as runtime guard. Lives at
    legacy line 14477 (candidate_focus/repeat_density territory). All sites are
    `(typeof _getRepeatDensity === 'function') ? _getRepeatDensity(chrom) : null`.
  - `setCur`, `drawZ`, `drawSim`, `drawLinesPanel` — KEPT as runtime
    guards. Page1 NOW exports all four, but promoting these to imports
    would couple cross_species_breakpoints to local_pca_dosage's module load order. Runtime guards
    preserve graceful degradation.
  - `drawWinSumStrip` — KEPT as runtime guard. Not defined in legacy
    at all (optional hook).
  - `window.popgenDotplot`, `window.popgenFocalVsBg` — KEPT as runtime
    guards. External vendor libs.
- State.X reads (18 distinct slots): state.crossSpecies (cross_species_breakpoints-owned),
  state.repeatDensity (boundaries-page TEfull JSONs), state.candidateList,
  state.dotplotMashmap (optional overlay), state.cur, state.data,
  state._crossSpeciesUI, state._csSyntenyCache, state._csSyntenyEdgesCache,
  state._csInversionContextCache, state._csOverlayIndex, state._focalVsBg,
  state._csDotplotPanel*, state._csHoverActive, state._csHoverRaf,
  state._csHeaderScrollWired, state._crossSpeciesKeysBound.
- HTML: 6-panel layout (#csToolbar, #csCatalogue, #csFocus,
  #csSyntenyContent, #csDotplotContent, #csFocalVsBgContent).
- Confirmed during audit: `computeTrackedLinkageProjection` (stats_profile
  + annotation_cockpit runtime guard target) lives at legacy line 46751, inside
  candidate_focus-territory chunks. Will land when candidate_focus's missing helpers
  eventually surface. Not part of this round.

**Decision: AST-aware patcher (stats_profile/18 model).**
50 top-level `function NAME(args) { ... }` declarations. Wrote
`/home/claude/work/patch_page16.py` modeled on round 5 step 4/5
patcher. Reverse-walks matches; brace-matching with string/comment
awareness; injects `\n  const state = _pageState;` after `function
NAME(args) {` for bodies referencing bare state without local
declaration. Tightened "already patched" check after first run
triggered on docstring mention (the new docstring now describes the
shim text). Result: **28 of 50 functions got the shim** (the other
22 are pure utility helpers like `_isCrossSpeciesJSON(data)`,
`_csEventTypeOf(bp)`, etc., that don't reference `state`).

**Decision: 27 explicit ES exports.**
The chat-33 stub had 0 explicit exports (only a synthesized CJS
`default`). Added 27 named exports across 5 logical groups:
constants (4), render entries (7 — main + 6 panel-level), cross-page
helpers (6 — including `_csGetSyntenyBlocks` + `_csPermutationTest`
that stats_profile reads via runtime guards), IO helpers (5), hover/event-
wiring helpers (2). Plus `mount`, `unmount`, `renderCrossSpeciesPage`
(state-aware wrapper).

**Decision: keep underscore-prefixed bodies as exports.**
Same reason as stats_profile/18/21: legacy callers reference
`_renderCrossSpeciesPage()` etc. directly. Underscore-prefixed
exports stay; the new non-prefixed `renderCrossSpeciesPage(state)`
is purely additive.

**Decision: keep local_pca_dosage's drawZ/drawSim/drawLinesPanel/setCur as
runtime guards (don't promote to imports).**
Page1 now exports these 4 functions, but promoting them to imports
in cross_species_breakpoints would couple cross_species_breakpoints to local_pca_dosage's module load order. Runtime
guards preserve graceful degradation when local_pca_dosage isn't mounted, which
matches the chat-33 contract. The stats_profile guard-resolution mechanic
(this round) is one-directional only: stats_profile reads cross_species_breakpoints's
exports because stats_profile always runs after cross_species_breakpoints has been
referenced (synthesis page comes after the comparative page in the
nav order). The reverse direction (cross_species_breakpoints → local_pca_dosage) does not have
that guarantee.

**Shipped:**

1. **`cross_species_breakpoints.js` refactored in-place** (2556 → 2750 LOC):
   - **Header replaced**: rewrote TODO_MISSING block as
     "RESOLVED 2026-05-07 round 5 step 11" documenting each marker's
     resolution status. Added `import { _pageState, _setActiveState }
     from './cross_species_breakpoints/_state.js';` and `import { _esc } from
     '../../shared/page1_data_helpers.js';`.
   - **AST shim injected**: 28 of 50 top-level functions got
     `\n  const state = _pageState;` after their opening `{`.
     File grew by 784 chars.
   - **27 explicit ES exports appended at end** across 5 groups
     (constants, render entries, cross-page helpers, IO helpers,
     hover/event-wiring helpers).
   - **Lifecycle + state-aware wrapper appended**: `mount(root,
     atlasState, registry)`, `unmount(root)`, `_buildLegacyState(atlasState)`,
     and `renderCrossSpeciesPage(state)` (sets `_pageState`, delegates
     to `_renderCrossSpeciesPage()`). `_buildLegacyState` overlays
     cross-atlas slots (candidate, candidateList, cur), pulls cross_species_breakpoints-
     owned data slots (crossSpecies, repeatDensity, dotplotMashmap),
     resolves chrom precomp from inv.tracks[activeChrom], preserves
     identity of the cs* caches + UI flags across mounts.

2. **`cross_species_breakpoints/_state.js` (26 LOC, NEW)** — `_pageState` + `_setActiveState`.
   Includes documentation note about the strategic value (stats_profile
   guard-resolution).

3. **Registry + manifest fixes:**
   - `pages.registry.json` cross_species_breakpoints: added `_label` ("cross-species
     breakpoints") and detailed `_doc` documenting the cs_breakpoints_v1
     pipeline, six-panel layout, manuscript hook (Spalax-style all_TE
     enrichment), stats_profile guard-resolution context, three-cohort
     discipline reminder.
   - `manifest.json` cross_species_breakpoints: label "page 16" → **"cross-species
     breakpoints"**.

4. **Test extensions:**
   - `tests/test_comparative_page16.js`: replaced (was a 62-LOC
     parse-check + dynamic-import + content-scanning stub from
     chat-33 that imported from the wrong path
     `../inversion_comparative/cross_species_breakpoints.js`). New version: 40
     assertions covering ALL 27 explicit exports across 5 groups,
     `_state.js` live-binding, behavioural exercises:
     - `_isCrossSpeciesJSON` accept/reject paths.
     - `renderCrossSpeciesPage(state)` sets `_pageState` even when
       render throws on missing DOM.
     - `_csGetSyntenyBlocks` reads via `_pageState` (live-binding):
       null when crossSpecies missing, null when synteny_blocks not
       array, returns the actual array when present.
     **40/40**.
   - `tests/smoke_comparative_page16_round5.mjs`: NEW (~340 LOC).
     Full mount/render/unmount with FakeContext canvas shim +
     `insertAdjacentHTML` polyfill. Empty-crossSpecies mount runs
     without throwing. **Populated mount with synthetic
     cs_breakpoints_v1** (single inversion bp on LG12 5-12 Mb, with
     prev_block + next_block on CMA01, all_TE flanking density 0.45
     mean, plus 2 synteny_blocks): mount runs without throwing,
     post-mount `_csGetSyntenyBlocks()` returns the 2-block array
     (live-binding confirmed). **`_csComputeSynteny()` runs through
     the verbatim body via `_pageState` shim and produces a non-null
     result** — direct proof the AST-injected shim correctly threads
     state into the verbatim body. Unmount clears `_pageState`. **23/23**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_discovery_page12.js (unchanged)                       PASS (32/32)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page9.js (unchanged)                        PASS (14/14)
tests/test_catalogue_page10.js (unchanged)                       PASS (25/25)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (unchanged)                       PASS (41/41)
tests/test_catalogue_page_overview.js (unchanged)                PASS (18/18)
tests/test_comparative_page16.js (NEW: 40 assertions)            PASS (40/40)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_discovery_page12_round5.mjs                          PASS (29/29)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page9_round5.mjs                           PASS (22/22)
tests/smoke_catalogue_page10_round5.mjs                          PASS (26/26)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page_overview_round5.mjs                   PASS (15/15)
tests/smoke_comparative_page16_round5.mjs (NEW: 23 assertions)   PASS (23/23)
Total: 691/691 across all twenty-two test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- All 10 previously-migrated page modules.
- shared/page1_data_helpers.js (cross_species_breakpoints's `_esc` import resolves to
  the existing export).
- Other shared/ modules.
- The 50 verbatim helper bodies inside cross_species_breakpoints.js (only the
  AST-injected shim — 28 of 50 functions).
- multi_species_cockpit (audited but separate page; will be migrated later).
- stats_profile's runtime guards for `_csGetSyntenyBlocks` and
  `_csPermutationTest` (kept; promotion is a follow-up round task).
- Other pages (only parse-checked).

**Migration progress so far (11 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| local_pca_theta_pi | discovery | ✅ step 10 (verbatim + state-aware wrappers + lifecycle) | ~1189 | 32+29 |
| cross_species_breakpoints | comparative | ✅ step 11 (AST shim injection + explicit exports + lifecycle) | ~2776 | 40+23 |
| stats_profile | synthesis | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | synthesis | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 691/691 across 22 test runs.**

**Discovery group status:** 3 of 4 migrated (local_pca_dosage, candidate_focus, local_pca_theta_pi).
Only window_summary_table (23 LOC), local_pca_ghsl (42 LOC), negative_regions (23 LOC) remain — all
tiny stubs.

**Comparative group status:** 1 of 3 migrated (cross_species_breakpoints). Remaining:
help (34 LOC stub), multi_species_cockpit (2417 LOC, multi-species cockpit).

**Architectural note: cross-page guard resolution mechanic.**
Page16 → stats_profile is the FIRST migration that closes a cross-page
runtime guard. The pattern is repeatable: when page A's verbatim
helpers are runtime-guarded in page B, migrating A makes the helpers
explicit exports, and B can then promote its guards to imports.
Future candidates of the same shape will surface as more pages
migrate (e.g., candidate_focus's `computeTrackedLinkageProjection` will
eventually unblock something — confirmed during audit that the
function lives at legacy line 46751, candidate_focus-territory).

**Architectural note: AST shim injection at scale.**
Page16 is the largest AST-patched page so far (50 functions, 28
patched). The patcher is now mature; the only adjustment was
tightening the "already patched" check to look for the actual
injection (`)\s*\{\s*\n\s*const state = _pageState;`) rather than
substring matches, because the new docstring mentions the shim text.
Future migrations using this approach (multi_species_cockpit will need it too)
should reuse `/home/claude/work/patch_page16.py` as a template.

**Architectural note: render-path proof in smoke tests.**
Page16's smoke confirms that the AST shim works end-to-end:
`_csGetSyntenyBlocks()` and `_csComputeSynteny()` both run through
the verbatim body via `_pageState`, with the synteny_blocks array
threading correctly into the per-(gar,mac) tally logic. This is the
strongest proof yet that the AST injection preserves semantics.
Future migrations of substantial state-reading bodies should use the
same proof pattern.

**Next round candidates** (Quentin's call):
- **stats_profile guard promotion** — small, fast payoff round (~5 LOC delta).
  Promotes stats_profile's runtime guards for `_csGetSyntenyBlocks` +
  `_csPermutationTest` to imports. Demonstrates the cross-page
  guard-resolution mechanic end-to-end.
- **window_summary_table/15/19** (discovery, <50 LOC each) — close out discovery
  group entirely (3 quick rounds).
- **multi_species_cockpit** (comparative, 2417 LOC) — multi-species cockpit. Most
  ambitious remaining pre-cleanup migration.
- **help** (comparative, 34 LOC) — tiny help-page stub.
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 10) — local_pca_theta_pi local-PCA-θπ MIGRATED · 13 TODO_MISSING resolved as false positives

**Context:**
Round 5 step 9 closed out the catalogue + synthesis groups by
migrating marker_panels. Round 5 step 10 (this round) tackles **local_pca_theta_pi** —
the θπ sister of local_pca_dosage (same six-panel layout, but reads
theta_pi_* layers instead of dosage). Substantial round: the chat-33
stub had 1008 LOC of body extracted from legacy lines 53045-54168
with all 8 helpers exported as state-as-first-arg top-level functions,
and 13 TODO_MISSING markers that all turned out to be closure-scoped
false positives (same finding as local_pca_dosage round 2).

**Audited:**
- Legacy provenance: 8 helpers verbatim from lines 53045-54168
  (_refreshThetaPiLayerStatus, _refreshThetaPiPanelVisibility,
  _drawThCusumHero, _drawThLinesPanel, _drawThSimMatPanel,
  _drawThZPanel, _drawThAnchorStripPanel, _drawThPcaPanel).
- Pattern: state-as-first-arg, top-level exports. **Cleanest refactor
  target encountered so far** — chat-33 already migrated the
  legacy-global state pattern.
- TODO_MISSING analysis (13 markers): each name (showHide, xToPx,
  kColor, q, colorFor, palette, has, xAt, yAt, toX, toY, fillFor,
  yToPx) verified as closure-scoped via
  `grep -nE "const (NAME)\s*=" local_pca_theta_pi.js`. All 13 are local
  `const`/`let` declarations inside their calling function. Per
  local_pca_dosage round 2 finding (recipe step 2.5), the markers are deleted.
- State.X reads: state.layersPresent (Set with .has() semantics —
  helpers DEPEND on this), state.data (with sub-paths .cusum_theta,
  .theta_pi_per_window, .theta_pi_local_pca, .theta_pi_envelopes),
  state.candidate, state.cur, state._simGeom, state._thSimGeom,
  state._zGeom (last three are ad-hoc geometry caches the legacy
  added imperatively — TODO_MISSING_SLOT comments preserved).
- Existing imports: contextFromState/clusterL2/ClusterCache,
  hetRateColor, alignLabels/hungarianChainProjection/concordanceMatrix,
  buildContingency/computeARI/computeNMI/cramersV,
  kmeans1D/kmeans2D/silhouette1D/adaptiveK1D, simColor (from
  shared/color_helpers.js, hoisted in 2026-05-06 round 3). All
  correct.
- HTML: local_pca_theta_pi.html has the empty-state placeholder #thetaPiEmpty
  (visible by default) + 8 panels (#thCtrlBar, #thCusumHeroPanel,
  #thSimPanel, #thZPanel, #thLinesPanel, #thAnchorStripPanel,
  #thPcaPanel, #thTrackedSamplesPanelCompact, #thL3Panel) — all
  display:none until state.layersPresent.has(...) for their layer.

**Decision: keep the 8 verbatim helpers underscore-prefixed and add
state-aware wrappers alongside.**
The chat-33 underscore-prefix convention is preserved (any legacy
caller referencing _refreshThetaPiLayerStatus etc. directly keeps
working). The 8 new non-prefixed wrappers (refreshThetaPiLayerStatus
etc.) set _pageState then delegate to the verbatim, passing
`state || _pageState || {}` so the verbatim still gets a defined
argument. Plus a renderPage12(state) convenience that runs all 8 in
order with try/catch around each (graceful degradation — one panel
error doesn't block the others).

**Decision: layersPresent must be a Set.**
The verbatim helpers call `state.layersPresent.has(name)`. _buildLegacyState
normalizes whatever inv.layersPresent is (Set, Array, or undefined)
into a guaranteed Set. Without this, the helpers throw on the first
panel-visibility check.

**Decision: TODO_MISSING resolution is "delete the marker".**
All 13 are closure-scoped false positives. The markers were in header
comments only — the bodies were already correct (no actual missing
references). Replaced the TODO_MISSING block with a "RESOLVED
2026-05-07 round 5 step 10" comment block that documents each name
with line-number references to its local declaration. This way the
historical investigation is preserved without leaving stale TODOs.

**Decision: TODO_MISSING_SLOT comments stay.**
state._simGeom / state._thSimGeom / state._zGeom are ad-hoc geometry
caches the legacy added imperatively. They're write-through paths
from the renderers (computed once per draw, read by hit-test
handlers). Whether to formalize them in shared/state.js SLOT_REGISTRY
is a merge-chat decision — keep the TODO_MISSING_SLOT comments as
markers. _buildLegacyState passes them through correctly.

**Shipped:**

1. **`local_pca_theta_pi.js` refactored in-place** (1008 → 1171 LOC, all additions
   appended at end + header replaced):
   - Added `import { _pageState, _setActiveState } from
     './local_pca_theta_pi/_state.js';`.
   - **Did NOT modify** any of the 8 verbatim helper bodies.
   - Replaced TODO_MISSING block with "RESOLVED" comment block
     documenting each false-positive name with its local declaration
     line.
   - Added 8 state-aware wrapper exports (one per verbatim helper).
   - Added renderPage12(state) — runs all 8 in order with try/catch
     per call.
   - Added mount/unmount/_buildLegacyState lifecycle. _buildLegacyState
     overlays cross-atlas slots (candidate, candidateList, cur),
     normalizes layersPresent to a Set, pulls chrom precomp data
     from inv.tracks[activeChrom], passes geometry caches through.

2. **`local_pca_theta_pi/_state.js` (18 LOC, NEW)** — `_pageState` + `_setActiveState`.

3. **Registry + manifest fixes:**
   - `pages.registry.json` local_pca_theta_pi: added `_label` ("local PCA θπ")
     and detailed `_doc` documenting the six-panel layout, four
     theta_pi-driving layer types, panel visibility wiring, and
     orthogonal-validation rationale.
   - `manifest.json` local_pca_theta_pi: label "page 12" → **"local PCA θπ"**.

4. **Test extensions:**
   - `tests/test_discovery_page12.js`: replaced (was a stale chat-33
     test that imported from the wrong path
     `../inversion_discovery/local_pca_theta_pi.js`). New version: 32 assertions
     covering exports (8 verbatim + 8 wrappers + 3 lifecycle),
     `_state.js` live-binding, no-document tolerance for the 3
     helpers that early-return on missing document, null-data
     tolerance for `_drawThCusumHero`, wrapper side-effects on
     `_pageState`, no-arg-callable when `_pageState` is null. **32/32**.
   - `tests/smoke_discovery_page12_round5.mjs`: NEW (~290 LOC). Full
     mount/render/unmount lifecycle with FakeContext canvas shim
     and `document.querySelectorAll('[data-th-layer]')` polyfill.
     Empty-layers mount: #thetaPiEmpty visible, all panels hidden,
     indicators "not loaded". **Populated mount with synthetic
     cusum_theta (3 carriers, range 1-50 Mb, mixed karyotypes) +
     theta_pi_per_window**: #thetaPiEmpty hidden, #thCtrlBar shown
     (flex), #thCusumHeroPanel + #thLinesPanel shown (block),
     #thSimPanel still hidden (no theta_pi_local_pca), indicators
     "loaded", **and the verbatim ~225-line CUSUM hero render path
     executes — `#thCusumStripCanvas._ctx._ops > 0`**. This is the
     most ambitious render-path-confirmation assertion of any round
     so far. renderPage12(state) runs without throwing. Individual
     wrappers callable. Unmount clears `_pageState`. **29/29**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_discovery_page12.js (NEW: 32 assertions)              PASS (32/32)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page9.js (unchanged)                        PASS (14/14)
tests/test_catalogue_page10.js (unchanged)                       PASS (25/25)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (unchanged)                       PASS (41/41)
tests/test_catalogue_page_overview.js (unchanged)                PASS (18/18)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_discovery_page12_round5.mjs (NEW: 29 assertions)     PASS (29/29)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page9_round5.mjs                           PASS (22/22)
tests/smoke_catalogue_page10_round5.mjs                          PASS (26/26)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page_overview_round5.mjs                   PASS (15/15)
Total: 628/628 across all twenty test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- All 9 previously-migrated page modules.
- shared/ modules.
- The 8 verbatim ~1008-LOC helper bodies inside local_pca_theta_pi.js.
- TODO_MISSING_SLOT comments (kept as merge-chat markers).
- Other pages (only parse-checked).

**Migration progress so far (10 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| local_pca_theta_pi | discovery | ✅ step 10 (verbatim + state-aware wrappers + lifecycle) | ~1189 | 32+29 |
| stats_profile | synthesis | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | synthesis | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 628/628 across 20 test runs.**

**Discovery group status:** 3 of 4 migrated (local_pca_dosage, candidate_focus, local_pca_theta_pi).
Only window_summary_table (23 LOC), local_pca_ghsl (42 LOC), negative_regions (23 LOC) remain — all
tiny stubs.

**Architectural note on the third refactor pattern:**
Page12 introduced a third migration shape (alongside single-file
accessor and factory+new-lifecycle): **verbatim helpers + state-aware
wrappers**. The 8 chat-33 helpers each get a wrapper that sets
_pageState then delegates. This is the cleanest refactor when the
chat-33 stub already migrated to state-as-first-arg. Pattern
catalogue:
  - Single-file accessor (confirmed_carousel, annotation_cockpit): one accessor function
    rewired to read _pageState.
  - Factory + new lifecycle (marker_panels, overview): factory verbatim,
    add direct exports + lifecycle alongside. Closure-captured state.
  - Verbatim helpers + state-aware wrappers (local_pca_theta_pi): each top-level
    helper gets a wrapper that sets _pageState then delegates.
  - Sub-module split (local_pca_dosage, candidate_focus, catalogue): >3000 LOC + multiple
    concerns; modules under pageN/.

**Architectural note on TODO_MISSING false-positive resolution:**
Page1 round 2 first identified the closure-scoped false-positive
class. Page12 confirmed the pattern at scale (13 markers, all false
positives). The recipe step 2.5 scope check is a pre-extraction
must-do for any chat-33 stub: if every call site of NAME is preceded
by `const NAME = ...` or `let NAME` in the same parent function,
delete the marker, leave the body alone.

**Architectural note on render-path confirmation in smoke tests:**
Page12's smoke is the most ambitious yet — it confirms the verbatim
~225-line CUSUM hero render path EXECUTES (FakeContext draw ops > 0)
when given synthetic data through the new lifecycle. This proves the
new lifecycle is correctly threading state into the verbatim body,
not just doing a no-op shortcut. Future migrations of substantial
canvas-driven pages (cross_species_breakpoints, multi_species_cockpit) should do the same.

**Next round candidates** (Quentin's call):
- **window_summary_table, 15, 19** (discovery, <50 LOC each) — would close out the
  discovery group entirely.
- **cross_species_breakpoints/multi_species_cockpit** (comparative, 2400+ each) — would resolve cs*
  helpers + computeTrackedLinkageProjection.
- **help** (comparative, 34 LOC) — tiny help-page stub.
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 9) — marker_panels marker panels MIGRATED · CATALOGUE COMPLETE

**Context:**
Round 5 step 8 migrated overview (synthesis tab) using the
factory-preserving + new-lifecycle-alongside pattern. Round 5 step 9
(this round) tackles **marker_panels** — the marker panels page. Page10 uses
the same chat-33 factory pattern (`wirePage10(state) →
{ renderPage10, renderMarkerPage }`), so the same migration playbook
applies. With marker_panels done, **the entire catalogue + synthesis groups
are 100% migrated** — 6 pages total (catalogue, confirmed_carousel, marker_panels, stats_profile,
marker_readiness, annotation_cockpit, overview).

**Audited:**
- Legacy provenance: lines 57837-58043 (helper _markerPanelCardHtml at
  57837-57970, render at 57972-58043). Verbatim 137-LOC body inside
  the factory closure.
- Pattern: factory `wirePage10(state) → { renderPage10,
  renderMarkerPage }`. `renderMarkerPage` is the legacy name;
  `renderPage10` is an alias. Both reference the same function.
- State.X reads (inside closures): `state.data.chrom`,
  `state.data._layers_present`, `state.data.marker_panel_summary`,
  `state.data.marker_catalogue`, `state.data.marker_primers`,
  `state.candidateList`. All read-only. No mutations.
- DOM dependencies: `#page10Content` (innerHTML target),
  `#page10Subtitle` (textContent target). Empty-state handled inside
  the factory body; missing-DOM tolerated (early return when
  `#page10Content` not found).
- No external function dependencies. Fully self-contained.
- No TODO_MISSING markers.

**Decision: same playbook as overview round 5 step 8.**
Keep the factory verbatim (137 LOC of legacy render code unchanged),
add the standard atlas-router lifecycle alongside, share `_pageState`
between both surfaces. The factory now also calls
`_setActiveState(state)` on entry so any caller using the chat-33
surface keeps `_pageState` in sync.

**Decision: closure-re-creation per direct render.**
Unlike confirmed_carousel/17/18/21 (which read state once on render via
`_ackEnsureState()` or similar accessor), marker_panels's factory closures
capture state at factory-call time. The new `renderPage10(state)`
direct entry handles this by calling
`wirePage10(_pageState).renderPage10()` — re-creating closures with
the live state. One extra factory invocation per render is negligible
for HTML-only renders. The factory body is verbatim legacy; we don't
want to touch it.

**Decision: preserve `renderMarkerPage` as legacy alias.**
Legacy code references `renderMarkerPage()` directly. The chat-33
stub already aliased it; we keep both `renderPage10` and
`renderMarkerPage` as direct exports (both delegating to the same
internal path) plus the factory-handle alias.

**Shipped:**

1. **`marker_panels.js` refactored in-place** (244 → 326 LOC, all additions
   external to the verbatim factory body):
   - Added `import { _pageState, _setActiveState } from
     './marker_panels/_state.js';`.
   - Inside `wirePage10(state)`: prepended `if (state)
     _setActiveState(state);` so the factory's closure-captured state
     stays in sync with the module-level `_pageState`.
   - **Did NOT modify** the factory body itself (137 LOC of verbatim
     legacy render code is unchanged).
   - Added 4 new external exports:
     - `export function renderPage10(state)` — sets `_pageState`,
       invokes `wirePage10(_pageState).renderPage10()`.
     - `export function renderMarkerPage(state)` — legacy alias
       delegating to `renderPage10`.
     - `export async function mount(root, atlasState, registry)` —
       builds legacyState, sets `_pageState`, calls `renderPage10`,
       stashes `atlasState.inversion._page10State`.
     - `export async function unmount(root)` — clears `_pageState`.
   - **Kept** `export default wirePage10`.

2. **`marker_panels/_state.js` (18 LOC, NEW)** — `_pageState` + `_setActiveState`.

3. **Registry + manifest fixes:**
   - `pages.registry.json` marker_panels: added `_label` ("marker panels")
     and detailed `_doc` documenting tier badges + per-regime marker
     counts + Tm range + multiplex spread + per-marker table when
     marker_catalogue+marker_primers loaded + interpretation block.
   - `manifest.json` marker_panels: label "page 10" → **"marker panels"**.

4. **Test extensions:**
   - `tests/test_catalogue_page10.js`: replaced (was a stale chat-33
     test that imported from the wrong path
     `../inversion_catalogue/marker_panels.js`). New version: 25 assertions
     covering BOTH new + legacy surfaces. **All chat-33 behavioural
     cases preserved verbatim** (empty-layers subtitle + HTML,
     missing DOM tolerated, layer-present-but-zero-summaries empty
     state). New: direct-render assertions, factory propagates to
     `_pageState`. **25/25**.
   - `tests/smoke_catalogue_page10_round5.mjs`: NEW (~225 LOC). Full
     mount/render/unmount lifecycle. Empty-layers mount yields
     `#page10Subtitle` = "(no marker layer loaded)" + `#page10Content`
     contains "No marker panels loaded". **Populated mount with
     synthetic marker_panel_summary** (HIGH-tier candidate, 7 markers,
     94.5% accuracy, g0/g1/g2 split, Tm range 58.3-60.9°C) renders a
     real card whose innerHTML contains the candidate id, "HIGH"
     badge, "94.5%" accuracy, "LG12" chrom, and the
     "Marker catalogue not loaded" detail-block fallback. Subtitle
     contains "1 panel" + "HIGH 1". `renderPage10(state)` direct.
     Backward-compat factory smoke: `wirePage10` + `renderMarkerPage`
     alias. Unmount clears `_pageState`. **26/26**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page9.js (unchanged)                        PASS (14/14)
tests/test_catalogue_page10.js (NEW: 25 assertions)              PASS (25/25)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (unchanged)                       PASS (41/41)
tests/test_catalogue_page_overview.js (unchanged)                PASS (18/18)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page9_round5.mjs                           PASS (22/22)
tests/smoke_catalogue_page10_round5.mjs (NEW: 26 assertions)     PASS (26/26)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page_overview_round5.mjs                   PASS (15/15)
Total: 567/567 across all eighteen test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- local_pca_dosage/candidate_focus/catalogue/confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit/overview modules.
- shared/page1_data_helpers.js.
- The verbatim 137-LOC legacy render body inside `wirePage10`.
- Other pages (only parse-checked).

**Migration progress so far (9 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 | 14+22 |
| marker_panels | catalogue | ✅ step 9 (factory + new lifecycle) | ~344 | 25+26 |
| stats_profile | synthesis | ✅ step 5 (single file + state bridge) | ~1009 | 34+20 |
| marker_readiness | synthesis | ✅ step 4 (single file) | ~984 | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 | 18+15 |

**Total assertions: 567/567 across 18 test runs.**

🎉 **CATALOGUE + SYNTHESIS GROUPS COMPLETE.** All 6 catalogue/synthesis
pages migrated.

**Architectural note on factory + new lifecycle pattern:**
Page_overview (round 5 step 8) and marker_panels (this round) both used the
chat-33 factory pattern. Both migrations followed the same recipe:
prepend `_setActiveState(state)` at factory entry, add direct exports
+ mount/unmount alongside, share `_pageState` between surfaces. Cost:
~80 LOC of new lifecycle scaffolding; benefit: zero breakage for any
caller using the chat-33 surface. The pattern is now repeatable for
any future factory-style page (none remain in the unmigrated set).

**Architectural note on closure-captured state:**
Page10 and overview both use closure-captured state inside the
factory. `renderPage10(state)` direct entry handles this by calling
`wirePage10(_pageState).renderPage10()` — re-creating closures with
the live state. This is one extra factory invocation per direct
render, which is negligible for HTML-only renders. Pages that read
state via an accessor (`_ackEnsureState()` etc., as in
confirmed_carousel/17/18/21) don't need this trick — but for these two pages, the
factory body is verbatim legacy and we deliberately don't touch it.

**Next round candidates** (Quentin's call):
- **local_pca_theta_pi** (discovery, 1008 LOC, 18 TODOs) — substantial; next
  largest after local_pca_dosage/candidate_focus.
- **cross_species_breakpoints/multi_species_cockpit** (comparative, 2400+ each) — would resolve cs*
  helpers + computeTrackedLinkageProjection.
- **Tiny stubs** (window_summary_table, 15, 19, help) — quick router-wiring rounds.
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 8) — overview synthesis tab MIGRATED (factory preserved)

**Context:**
Round 5 step 7 migrated confirmed_carousel (confirmed carousel) using the
stub-preserving + accessor-shortcut patterns. Round 5 step 8 (this
round) tackles **overview** — the synthesis-stage overview tab.
Legacy is empty: `<div id="overview" class="page"></div>` at line
9322, no JS handlers anywhere. The chat-33 stub used a UNIQUE pattern
(factory `wirePageOverview(state) → { renderPageOverview }`) different
from every other migrated page. Migration preserves the factory
verbatim and ADDS the standard atlas-router lifecycle alongside.

**Audited:**
- Legacy line 5138 (page-tab): `<button data-page="overview"
  data-stage="synthesis">overview</button>`. **Stage is "synthesis"**,
  but the chat-33 manifest had it tagged "catalogue". Fixed during
  migration (data-stage mismatch is a bug, not a renumbering).
- Legacy line 9322: `<div id="overview" class="page"></div>` —
  empty.
- `grep -niE "(renderOverview|overview|renderPageOverview)" legacy/Inversion_atlas.html`:
  only the tab button + the empty div. Zero JS references.
- Existing chat-33 stub (35 LOC): factory pattern
  `wirePageOverview(state)` returning `{ renderPageOverview }`. The
  factory was the only chat-33 export besides default. State arg
  accepted but never used.
- State.X reads: ZERO. The stub never reads state.

**Decision: preserve the factory verbatim, add standard surface alongside.**
Page_overview is the only page using the factory pattern. Rewriting
to match siblings would break any caller still using `wirePageOverview`
or `default`. Adding the standard surface
(`mount`/`unmount`/`renderPageOverview`/`_pageState`) alongside the
factory gives everyone what they need with zero breakage. Both
surfaces share `_pageState` via `_setActiveState` so they're
consistent.

**Decision: stage correction is part of migration.**
Quentin's renumbering directive ("page renumbering at the complete
end") is about page IDs (renaming stats_profile → something else). A wrong
stage label is a bug fix — manifest had `"stage": "catalogue"` but
legacy clearly tags it `data-stage="synthesis"`. Fixed.

**Decision: passthrough _buildLegacyState.**
Page_overview reads no specific state slots in the current empty-stub
implementation. `_buildLegacyState` is `Object.assign({}, inv)` so
when the real overview lands (likely needing `candidateList` +
`layersPresent` + ancestry slots), it'll get them automatically
without a separate refactor.

**Shipped:**

1. **`overview.js` refactored in-place** (35 → 106 LOC):
   - Added `import { _pageState, _setActiveState } from './overview/_state.js';`.
   - Renamed factory's inner closure to top-level
     `function _renderPageOverview()` (no-op body, matches legacy).
   - Added `export function renderPageOverview(state)` wrapper that
     calls `_setActiveState(state)` before delegating.
   - **Kept** `export function wirePageOverview(state)` returning
     `{ renderPageOverview: _renderPageOverview }`. Now also calls
     `_setActiveState(state)` for consistency with the new lifecycle.
   - **Kept** `export default wirePageOverview`.
   - Added `mount(root, atlasState, registry)`, `unmount(root)`, and
     `_buildLegacyState(atlasState)` (passthrough).

2. **`overview/_state.js` (17 LOC, NEW)** — `_pageState` + `_setActiveState`.

3. **Registry + manifest fixes:**
   - `pages.registry.json` overview: added `_label` ("overview")
     and `_doc` documenting the legacy empty-stub status + the
     deferred design decision (drop tab vs populate with workflow
     summary).
   - `manifest.json` overview: stage **"catalogue" → "synthesis"**
     (fix to match legacy `data-stage="synthesis"`).

4. **Test extensions:**
   - `tests/test_catalogue_page_overview.js`: replaced (was a stale
     chat-33 test that imported from the wrong path
     `../inversion_catalogue/overview.js`). New version: 18
     assertions covering BOTH new + legacy surfaces — exports,
     factory + default + direct exports + mount/unmount, `_state.js`
     live-binding, no-op semantics, factory pattern still works,
     factory propagates state to `_pageState`. **18/18**.
   - `tests/smoke_catalogue_page_overview_round5.mjs`: NEW (~145 LOC).
     Full mount/render/unmount lifecycle. Empty atlasState mount runs
     without throwing. Populated atlasState mount carries
     `candidateList` + `layersPresent` through `_buildLegacyState`.
     Direct `renderPageOverview(state)` works. Backward-compat smoke
     verifies `wirePageOverview({...})` still returns a
     `{renderPageOverview}` handle. Unmount clears `_pageState`. **15/15**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page9.js (unchanged)                        PASS (14/14)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (unchanged)                       PASS (41/41)
tests/test_catalogue_page_overview.js (NEW: 18 assertions)       PASS (18/18)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page9_round5.mjs                           PASS (22/22)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page_overview_round5.mjs (NEW: 15 assert.) PASS (15/15)
Total: 516/516 across all sixteen test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- local_pca_dosage/candidate_focus/catalogue/confirmed_carousel/stats_profile/marker_readiness/annotation_cockpit modules.
- shared/page1_data_helpers.js.
- The TODO_MISSING(synthesis_overview_design) — kept as TODO since
  whether to drop the tab or populate it is a design decision.
- Other pages (only parse-checked).

**Migration progress so far (8 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 across main + _state | 14+22 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 across main + _state | 41+20 |
| overview | synthesis | ✅ step 8 (factory + new lifecycle) | ~123 across main + _state | 18+15 |

**Total assertions: 516/516 across 16 test runs.**

**Synthesis group status:** All 3 synthesis pages migrated (stats_profile,
marker_readiness, overview). Catalogue group: only marker_panels remains.

**Architectural note on backward-compat preservation:**
Page_overview is the only chat-33 factory-pattern page in the project.
Rewriting to match siblings would break any caller still using
`wirePageOverview` or `default`. Adding the standard
`mount`/`unmount`/`renderPageOverview` surface alongside the factory
gives everyone what they need with zero breakage. Both surfaces share
`_pageState` via `_setActiveState`. This is the right pattern when the
legacy API shape is hard to predict who depends on — it's a small
extra-LOC cost for guaranteed no-breakage.

**Architectural note on stub-preserving migration (continued):**
Round 5 step 7 (confirmed_carousel) and step 8 (overview) both follow the
same pattern for empty-stub-in-legacy pages: preserve the no-op
semantics exactly while wiring the lifecycle. Smoke tests verify
no-throw + correct empty-state behaviour. When the real
implementation lands, it goes in the renamed
`_renderConfirmedCarousel` / `_renderPageOverview` and existing tests
keep passing.

**Next round candidates** (Quentin's call):
- **marker_panels** (catalogue, 244 LOC) — closes out the catalogue group
  entirely (only catalogue page left).
- **local_pca_theta_pi** (discovery, 1008 LOC, 18 TODOs) — substantial.
- **cross_species_breakpoints/multi_species_cockpit** (comparative, 2400+ each) — would resolve
  cs* helpers + computeTrackedLinkageProjection.
- **Tiny stubs** (window_summary_table/15/19/help) — quick router-wiring rounds.
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 7) — confirmed_carousel confirmed carousel MIGRATED

**Context:**
Round 5 step 6 migrated annotation_cockpit (annotation cockpit) using the
accessor-shortcut pattern. Round 5 step 7 (this round) tackles **confirmed_carousel**
— the confirmed-candidates carousel. Page9 is a stub in legacy: HTML
shell exists but no JS handlers. Migration preserves the stub
semantics exactly while wiring the atlas-router lifecycle.

**Audited:**
- Legacy line ~5076 (page-tab tooltip): "Carousel walk-through of all
  candidates marked confirmed on page 2."
- Legacy lines 7782-7812: HTML shell with 6 IDs (#confirmedNavBar,
  #confirmedNavPrev, #confirmedNavNext, #confirmedNavInfo,
  #confirmedCandidateMeta, #confirmedEmpty).
- Existing chat-33 stub (105 LOC): legacy carousel JS doesn't exist
  (`grep -n confirmedNav legacy/Inversion_atlas.html` returns only HTML
  hits). The stub mirrors the legacy "show empty placeholder" behaviour
  with one minor enhancement (when `state.candidateList.filter(c =>
  c.confirmed === true).length > 0`, repopulate the empty element with
  a "carousel rendering not yet wired" message + count).
- State.X reads: only `state.candidateList`. Single bare read inside
  one function. Trivial.
- TODO_MISSING items: `_renderConfirmedCarousel`,
  `_wireConfirmedCarouselNav`, `renderCandidateFocus` (candidate_focus-owned).
  None of them exist in legacy; the full carousel is a fresh-write
  task, deferred.

**Decision: stub-preserving migration.**
The chat-33 stub already mirrors legacy stub behaviour. Migration just
adds atlas-router lifecycle + `_pageState` live-binding. The
TODO_MISSING items stay as TODOs in source comments — they will be
implemented when candidate_focus's candidate-focus renderer becomes accessible.

**Decision: no sub-module split.**
166 LOC total (153 main + 13 _state). Single concern (refresh +
init). Sub-module splits are justified at >3000 LOC.

**Decision: accessor-shortcut.**
Single bare `state.X` read in one function. Same trivial-refactor
pattern as annotation_cockpit (round 5 step 6) — `const state = _pageState || {};`
inside the renamed verbatim function, plus state-aware export wrapper.
No AST-walking patcher needed.

**Shipped:**

1. **`confirmed_carousel.js` refactored in-place** (105 → 153 LOC):
   - Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
     with `import { _pageState, _setActiveState } from './confirmed_carousel/_state.js';`.
   - Renamed verbatim `function refreshConfirmedCarousel()` →
     internal `function _refreshConfirmedCarousel()`. Single bare
     `state.candidateList` read becomes `(_pageState || {}).candidateList`
     via `const state = _pageState || {};` at function entry.
   - Added state-aware `export function refreshConfirmedCarousel(state)`
     wrapper that calls `_setActiveState(state)` before delegating.
   - Kept `export function initConfirmedCarousel()` as-is (no state reads).
   - Removed the chat-33 `__MODULE_ID__` export.
   - Added `mount(root, atlasState, registry)`, `unmount(root)`, and
     `_buildLegacyState(atlasState)`. Mount calls both
     `refreshConfirmedCarousel` and `initConfirmedCarousel` (legacy
     page-tab activation flow).

2. **`confirmed_carousel/_state.js` (13 LOC, NEW)** — `_pageState` + `_setActiveState`.

3. **Registry + manifest fixes:**
   - `pages.registry.json` confirmed_carousel: added `_label` ("confirmed carousel")
     and `_doc` documenting the legacy stub status + deferred TODOs.
   - `manifest.json` confirmed_carousel: label "page 9" → **"confirmed carousel"**.

4. **Test extensions:**
   - `tests/test_catalogue_page9.js`: replaced (was a stale chat-33
     test that imported from the wrong path
     `../inversion_catalogue/confirmed_carousel.js` and asserted removed
     `__MODULE_ID__`). New version: 14 assertions covering exports,
     lifecycle entry-points, `__MODULE_ID__` removal, `_state.js`
     live-binding, no-document early-return safety,
     `initConfirmedCarousel` no-throw, and the side-effect that
     `refreshConfirmedCarousel(state)` sets `_pageState`. **14/14**.
   - `tests/smoke_catalogue_page9_round5.mjs`: NEW (~165 LOC). Full
     mount/render/unmount lifecycle. Empty-state: `#confirmedEmpty`
     visible, `#confirmedNavBar` + `#confirmedCandidateMeta` hidden.
     Populated state (2 confirmed + 1 unconfirmed candidate):
     `#confirmedEmpty` repopulated with "2 confirmed candidates" +
     "Carousel rendering is not yet wired" placeholder text — this is
     the verbatim chat-33 stub behaviour preserved through migration.
     `refreshConfirmedCarousel(state)` callable directly. Unmount
     clears `_pageState`. **22/22**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page9.js (NEW: 14 assertions)               PASS (14/14)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (unchanged)                       PASS (41/41)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page9_round5.mjs (NEW: 22 assertions)      PASS (22/22)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs                          PASS (20/20)
Total: 483/483 across all fourteen test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- local_pca_dosage/candidate_focus/catalogue/stats_profile/marker_readiness/annotation_cockpit modules.
- shared/page1_data_helpers.js.
- The TODO_MISSING items (`_renderConfirmedCarousel` etc.) — kept as
  TODOs since the full carousel was never implemented in legacy.
- Other pages (only parse-checked).

**Migration progress so far (7 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| confirmed_carousel | catalogue | ✅ step 7 (single file, stub-preserving) | ~166 across main + _state | 14+22 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 across main + _state | 41+20 |

**Total assertions: 483/483 across 14 test runs.**

**Catalogue group status:** 5 of 6 migrated (catalogue, confirmed_carousel, stats_profile,
marker_readiness, annotation_cockpit). Only marker_panels + overview remain.

**Architectural note on stub-preserving migration:**
Page9 was always a stub in legacy. The refactor preserves stub
behaviour exactly — the smoke test verifies the populated-mount path
still shows the "Carousel rendering is not yet wired" placeholder.
This is the right approach for "scaffold present but never
implemented" pages: don't try to invent functionality during
migration, just preserve the legacy contract and atlas-router-wire it.
The full implementation lands when the dependent renderer (candidate_focus's
candidate-focus) becomes accessible.

**Next round candidates** (Quentin's call):
- **overview** (catalogue, 35 LOC, also-empty-in-legacy) — closes
  out catalogue group with one more trivial migration.
- **marker_panels** (catalogue, 244 LOC) — closes catalogue group with one
  more medium migration.
- **local_pca_theta_pi** (discovery, 1008 LOC, 18 TODOs) — substantial.
- **cross_species_breakpoints/multi_species_cockpit** (comparative, 2400+ each) — would resolve
  cs* helpers + computeTrackedLinkageProjection.
- **Tiny stubs** (window_summary_table/15/19/help) — quick router-wiring rounds.
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 6) — annotation_cockpit annotation cockpit MIGRATED

**Context:**
Round 5 step 5 migrated stats_profile (stats profile) with the first cross-page
state bridge. Round 5 step 6 (this round) tackles **annotation_cockpit** — the
annotation cockpit. Page21 is a catalogue-stage page (legacy
`data-page="annotation_cockpit"`) that renders a per-sample-lines canvas with
cursor-driven candidate selection (←/→ to step the cursor, Shift to jump
candidate boundaries, digit keys 0-9 to select a band of the candidate
under the cursor, Esc to clear). Standard single-file refactor pattern
matching stats_profile/marker_readiness (rounds 5 step 4 and step 5).

**Audited:**
- Legacy line ~5125 region: annotation_cockpit div in HTML shell at lines 7822-7859
  (verified by chat-33 extraction). Tab label was "page 21" — corrected
  to "annotation cockpit" per the actual content (the chat-33 docstring
  also explicitly notes that an earlier handoff doc mislabeled it as
  "Manual karyotype groups list").
- Existing chat-33 stub (722 LOC): already had ~683 verbatim LOC + 5
  constants extracted from legacy lines 46938-47616. Just needed state
  refactor + atlas-router lifecycle.
- Static analysis: 4 truly-external references, all already
  `typeof X === 'function'` runtime-guarded in the body:
  - `_gatherActiveCandidatesForInheritance` (3 sites — guarded
    indirectly via the call site's `if (items.length === 0)` early
    return; legacy line 41196).
  - `_wireCandidateHaplotypeAnnotations` (1 site, fully guarded).
  - `candidateHaplotypeAnnotationsHtml` (1 site, fully guarded).
  - `computeTrackedLinkageProjection` (2 sites, fully guarded).
  All four stay as runtime guards — same approach as stats_profile with
  `_csGetSyntenyBlocks` / `_csPermutationTest`. They land naturally
  with candidate_focus / cross_species_breakpoints / multi_species_cockpit migration.
- `state.X` reads: `state.data`, `state.tracked`, `state.cockpitCursor`
  (lazy-init via `_ackEnsureState`), `state.cockpitSelectedBand`,
  `state._cockpitLastHapCandId`, `state.activeMode`, `state.candidates`,
  `state.candidates_detailed`. All map to atlasState.inversion +
  atlasState.shared.activeChrom.

**Decision: keep annotation_cockpit as a single file (no sub-module split).**
Same rationale as stats_profile/marker_readiness: 720 LOC of cohesive single-concern
code (cockpit canvas + footer panels). Sub-module splits are justified
at >3000 LOC and multiple concerns.

**Decision: no per-function state shim injection.**
Unlike stats_profile/marker_readiness, annotation_cockpit's body was already written to access state
through a single accessor — `_ackEnsureState()` at the top of nearly
every function. Rewiring that accessor to read `_pageState` was
sufficient. The one other state read (in `_annoCockpitChromExtent`)
was rewired the same way. This is a useful shortcut for future pages
that already have an accessor pattern.

**Decision: no cross-page state bridge.**
Page21 doesn't import from any other migrated page. The 4 external
helpers it relies on are still legacy-globals / runtime-guarded, not
cross-module imports — so there's nothing to bridge.

**Shipped:**

1. **`annotation_cockpit.js` refactored in-place** (722 → 776 LOC):
   - Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
     with `import { _pageState, _setActiveState } from './annotation_cockpit/_state.js';`.
   - Rewrote `_ackEnsureState()` to read from `_pageState` (was
     reading from `window.state`). Lazy-init of `cockpitCursor`
     preserved. Falls back to a transient `{}` if no mount has
     happened — keeps pure helpers callable from tests without a mount.
   - Rewrote `_annoCockpitChromExtent()` similarly (the only other
     function reading state directly without going through
     `_ackEnsureState`).
   - Renamed verbatim `function refreshAnnotationCockpit()` →
     `function _refreshAnnotationCockpit()` (underscore-prefixed body,
     matching stats_profile/18 convention).
   - Added state-aware `export function refreshAnnotationCockpit(state)`
     wrapper that calls `_setActiveState(state)` then delegates.
   - Removed the chat-33 `__MODULE_ID__` export.
   - Added `mount(root, atlasState, registry)`, `unmount(root)`, and
     `_buildLegacyState(atlasState)` (mirrors stats_profile/18 lifecycle, but
     builds a wider state shape: tracked, cockpitCursor,
     cockpitSelectedBand, candidates, candidates_detailed, activeMode,
     data).

2. **`annotation_cockpit/_state.js` (16 LOC, NEW)** — `_pageState` + `_setActiveState`.
   Same shape as the other pages.

3. **Registry + manifest fixes:**
   - `pages.registry.json` annotation_cockpit: added `_label` ("annotation cockpit")
     and `_doc` documenting the legacy provenance + the cursor /
     digit-key / band-pick UX.
   - `manifest.json` annotation_cockpit: label "page 21" → **"annotation cockpit"**.
     (Stage stays "catalogue".)

4. **Test extensions:**
   - `tests/test_catalogue_page21.js`: replaced (was a stale chat-33
     test that imported from the wrong path
     `../inversion_catalogue/annotation_cockpit.js` and asserted removed
     `__MODULE_ID__`). New version: 41 assertions covering exports,
     11 helpers, 5 constants, `_state.js` live-binding, `_ackBandColor`
     purity (null/negative → grey, modulo wrap), cursor-lookup with
     hit / gap / multi-candidate paths, chrom-extent with chrom_len_bp /
     items-fallback / null paths, and `_ackEnsureState` lazy-init +
     idempotency. **41/41**.
   - `tests/smoke_catalogue_page21_round5.mjs`: NEW (~270 LOC). Full
     mount/render/unmount lifecycle with FakeContext canvas shim
     (annotation_cockpit's draw path uses canvas heavily). Empty-state mount yields
     empty placeholder shown + body hidden (with a global stub for
     `_gatherActiveCandidatesForInheritance` returning `[]`). Populated
     mount with synthetic K=3 candidate + 7 fish + 3 windows yields
     body shown, canvas.width/height set, FakeContext._ops > 0
     (per-band polylines + axis ticks executed).
     `refreshAnnotationCockpit(state)` callable directly. `_pageState`
     live-binding verified through `_annoCockpitChromExtent`. Unmount
     clears `_pageState`. **20/20**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page17.js (unchanged)                       PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/test_catalogue_page21.js (NEW: 41 assertions for exports +
    helpers + constants + _state + pure-helper exercises)        PASS (41/41)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page17_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
tests/smoke_catalogue_page21_round5.mjs (NEW: 20 assertions for
    mount/render/unmount + canvas draw path + _pageState
    live-binding through _annoCockpitChromExtent)                PASS (20/20)
Total: 447/447 across all twelve test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- local_pca_dosage/candidate_focus/catalogue/stats_profile/marker_readiness — completely unchanged.
- shared/page1_data_helpers.js (annotation_cockpit doesn't call _esc).
- Other pages (only parse-checked).

**Migration progress so far (6 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |
| annotation_cockpit | catalogue | ✅ step 6 (single file) | ~792 across main + _state | 41+20 |

**Total assertions: 447/447 across 12 test runs.**

**Architectural note on the accessor-pattern shortcut:**
Page21's body was written so every state read flows through one
function (`_ackEnsureState()`). Rewiring that single accessor was
sufficient — no per-function `const state = _pageState;` shim
injection needed, unlike stats_profile/marker_readiness which had bare `state.X` reads
scattered across 7+ functions. Future pages with an existing accessor
pattern can take this shortcut. Pages with scattered `state.X` reads
need the AST-walking shim injection.

**Next round candidates** (Quentin's call):
- **local_pca_theta_pi** (discovery, 1008 LOC, 18 TODOs) — substantial work.
- **cross_species_breakpoints/multi_species_cockpit** (comparative, 2400+ each) — multi-species cockpit;
  **would resolve `_csGetSyntenyBlocks` / `_csPermutationTest` (stats_profile)
  AND likely `computeTrackedLinkageProjection` (annotation_cockpit)**.
- **Tiny stubs** (window_summary_table/9/15/19/overview) — quick router-wiring
  rounds; could batch several in one round.
- **Catalogue completion** (confirmed_carousel, marker_panels, overview).
- **Review pages** (karyotype_tier, 6, 7, 11, sv_evidence) — review stage.

---


## 2026-05-07 (chat ~36, round 5 step 5) — stats_profile stats profile MIGRATED + cross-page state bridge

**Context:**
Round 5 step 4 migrated marker_readiness (marker readiness panel). Page17 (stats
profile) is the natural next: sibling synthesis page that reads
marker_readiness's `_mpDeriveAutoPanel` (was `typeof X === 'function'` guarded
in legacy). Round 5 step 5 (this round) migrates stats_profile with the same
refactor-in-place pattern as marker_readiness, AND introduces a cross-page state
bridge so stats_profile→marker_readiness calls see live data.

**Audited:**
- Legacy line ~5125 tab: `data-page="stats_profile" data-stage="synthesis"`
  titled *"Statistical profile of inversion-associated genomic
  features..."*. Display label: "14 stats profile". Manuscript-
  relevant: this is the synthesis figure "what is statistically
  special about inversion regions?".
- Legacy lines 8110-8127: stats_profile div containing `<div id="spBody">`.
- Existing chat-33 stub (939 LOC): already had ~25 verbatim functions
  + 3 constants extracted from legacy lines 28420-29306. Just needed
  state refactor + atlas-router lifecycle + cross-module imports.
- Static analysis: 4 truly unresolved external references after
  filtering false positives (`AF_STD`, `MODULE_3_ROH`, `Wilcoxon`,
  `manuscript_note`, etc. — all in comments/strings):
  - `_esc` (18 unguarded uses) — already in shared from round 5 step 2.
  - `_mpDeriveAutoPanel` (2 sites: 1 typeof guard, 1 call inside the
    guarded branch) — marker_readiness export, now properly imported.
  - `_csPermutationTest` (1 site, fully guarded with `typeof !== 'function'`
    early return) — cross-species cross_species_breakpoints/16b dependency, not migrated.
    Stays as runtime guard.
  - `_csGetSyntenyBlocks` (1 site, fully guarded) — same, stays.
- `state.X` reads: `state.candidateList`, `state.crossSpecies`,
  `state._statsProfile` (lazy-init via `_spEnsureState`),
  `state._markerPanel` (read-only — populated by marker_readiness's flow), and
  `state.data` (chromosome precomp).

**Decision: keep stats_profile as a single file (no sub-module split).**
Same rationale as marker_readiness: 939 LOC of cohesive single-concern code
(stats-profile rows + render). Sub-module splits are justified at
>3000 LOC and multiple concerns. Pattern parity isn't a goal in itself.

**Decision: bridge state to marker_readiness in stats_profile's lifecycle.**
Page17 calls marker_readiness's `_mpDeriveAutoPanel()` to compute the marker-tier
breakdown row in the stats table. `_mpDeriveAutoPanel` reads marker_readiness's
`_pageState` for `state.candidateList` etc. If stats_profile mounts but
marker_readiness doesn't, marker_readiness's `_pageState` is null and the call throws.
Solution: stats_profile's mount also calls marker_readiness's `_setActiveState(legacyState)`
with the same legacy state object. Both pages read the same shape
(`candidateList`, `crossSpecies`, `_markerPanel`); stats_profile doesn't
mutate either, so sharing the state object is safe. Page17's unmount
deliberately does NOT clear marker_readiness's state — if marker_readiness is currently
mounted (or is about to be), it manages its own state.

**Shipped:**

1. **`stats_profile.js` refactored in-place** (939 → 994 LOC):
   - Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
     with proper imports:
     - `import { _pageState, _setActiveState } from './stats_profile/_state.js';`
     - `import { _esc } from '../../shared/page1_data_helpers.js';`
     - `import { _mpDeriveAutoPanel } from './marker_readiness.js';`
     - `import { _setActiveState as _setPage18State } from './marker_readiness/_state.js';`
   - State shim injection: 7 functions got
     `const state = _pageState;` as their first statement
     (`_spDeriveCsPermutation`, `_spDeriveRepeatFlankSpalax`,
     `_spDeriveFusionFission`, `_spDeriveMarkerability`,
     `_spDeriveAllRows`, `_spPlaceholder`, `_spMergeUserJson`).
   - Replaced `export function renderStatsProfilePage()` with the
     state-aware variant that calls BOTH `_setActiveState(state)` AND
     `_setPage18State(state)` before delegating to the legacy
     `_renderStatsProfilePage()`.
   - Removed the chat-33 `__MODULE_ID__` export.
   - Added `mount(root, atlasState, registry)`, `unmount(root)`, and
     `_buildLegacyState(atlasState)` (mirrors marker_readiness pattern with the
     state-bridge addition).

2. **`stats_profile/_state.js` (15 LOC, NEW)** — `_pageState` + `_setActiveState`.
   Same shape as the other pages.

3. **Registry + manifest fixes:**
   - `pages.registry.json` stats_profile: added `_label` ("14 stats profile")
     and `_doc` documenting the legacy tab definition + manuscript role.
   - `manifest.json` stats_profile: label "page 17" → **"stats profile"**;
     stage "catalogue" → **"synthesis"** (matching legacy
     `data-stage="synthesis"`).

4. **Test extensions:**
   - `tests/test_catalogue_page17.js`: replaced (was a stale chat-33
     test that imported from the wrong path
     `../inversion_catalogue/stats_profile.js` and asserted removed
     `__MODULE_ID__`). New version: 34 assertions covering exports,
     constants (`SP_ALPHA`, `SP_EFFECT_COLORS`, `SP_DEFAULT_ROWS`),
     sub-module split, `_pageState` setter, cross-page import
     (`marker_readiness._mpDeriveAutoPanel`), and `_spIsValidProfileJson`
     schema validation. **34/34**.
   - `tests/smoke_catalogue_page17_round5.mjs`: NEW (~250 LOC). Full
     mount/render/unmount lifecycle. Empty-state mount yields
     `spBody.innerHTML > 500 chars` containing `<table` (the stats
     summary table). Populated mount with synthetic candidate yields
     `spBody.innerHTML > 1000 chars`. Direct
     `renderStatsProfilePage(state)` call works. `_spDeriveAllRows()`
     reads from `_pageState` and returns a non-empty array. Unmount
     clears `_pageState`. **20/20**.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page17.js (NEW: 34 assertions for exports +
    constants + sub-module split + cross-page import +
    _spIsValidProfileJson schema)                                PASS (34/34)
tests/test_catalogue_page18.js (unchanged)                       PASS (46/46)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page17_round5.mjs (NEW: 20 assertions for
    mount/render/unmount + populated-candidate stats table render +
    _spDeriveAllRows via _pageState + state bridge to marker_readiness)    PASS (20/20)
tests/smoke_catalogue_page18_round5.mjs                          PASS (20/20)
Total: 386/386 across all ten test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine.
- local_pca_dosage/candidate_focus/catalogue/marker_readiness — completely unchanged.
  (Note: marker_readiness wasn't touched but stats_profile IMPORTS from marker_readiness's
  `_state.js` — that's a new cross-page coupling. Adding the import
  doesn't modify marker_readiness itself.)
- shared/page1_data_helpers.js.
- Other pages (only parse-checked).

**Migration progress so far (5 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| stats_profile | catalogue (synthesis) | ✅ step 5 (single file + state bridge) | ~1009 across main + _state | 34+20 |
| marker_readiness | catalogue (synthesis) | ✅ step 4 (single file) | ~984 across main + _state | 46+20 |

**Total assertions: 386/386 across 10 test runs.**

**Architectural note on cross-page state bridges:**
Page17→marker_readiness is the first real example of one migrated page reading
another's state via direct import. The bridge pattern (stats_profile's mount
calls marker_readiness's `_setActiveState` with the same state object) works
because:
  a) stats_profile doesn't mutate `state.candidateList` or `state.crossSpecies`.
  b) marker_readiness's `_mpDeriveAutoPanel` reads only those + lazy-inits
     `state._markerPanel`.
This is appropriate for synthesis-stage siblings that share a domain.
For pages that mutate state, this pattern would need rethinking — but
that's a question for when we encounter it.

**Next round candidates** (Quentin's call):
- **annotation_cockpit** (catalogue, 721 LOC pre-extracted) — quick refactor.
- **local_pca_theta_pi** (discovery, 1008 LOC, 18 TODOs) — substantial work.
- **cross_species_breakpoints/16b** (comparative, 2400+ each) — multi-species cockpit; major.
- Tiny stubs (window_summary_table, 9, 15, 19, overview) — quick router-wiring rounds.
- **`_csGetSyntenyBlocks` / `_csPermutationTest`** would naturally land
  with cross_species_breakpoints/16b migration (they're cross-species cockpit helpers).

---


## 2026-05-07 (chat ~36, round 5 step 4) — marker_readiness marker readiness panel MIGRATED

**Context:**
Rounds 5 step 1-3 (earlier today) migrated local_pca_dosage/candidate_focus/catalogue. Round 5
step 4 (this round) tackles **marker_readiness** — the marker readiness panel.
Page18 is a synthesis-stage page (legacy `data-stage="synthesis"`, tab
label "15 marker panel") that classifies promoted inversion candidates
into 4 confidence tiers (Tier 1 = clean private indel/SNP tag, Tier 2
= multi-marker panel, Tier 3 = breakpoint PCR demoted, Tier 4 =
exploratory) for downstream PCR design.

This is one of the manuscript's key figures — the breeding-marker
deliverable bridging genomics → wet-lab pilot validation. Migrating it
makes the inversion atlas's marker-panel workflow accessible through
the modular shell.

**Audited:**
- Legacy line 5128 tab definition: `data-page="marker_readiness" data-stage="synthesis"`
  titled *"Marker readiness panel — private-indel architecture..."*.
  Display label: "15 marker panel".
- Legacy lines 8134-8157: marker_readiness div containing `<div id="mpBody">`.
- Existing chat-33 stub (920 LOC): already had ~30 verbatim functions
  + 6 constants extracted from legacy lines 29307-30160. Just needed
  state refactor + atlas-router lifecycle + cross-module imports.
- Static analysis: only ONE truly unresolved external reference, `_esc`,
  with 15 unguarded uses. `_esc` is already in `shared/page1_data_helpers.js`
  from round 5 step 2. The other "unresolved" names from the regex
  (`AF_STD`, `PCR`, `indel_size_bp`, `TODO_MISSING`) are all matches
  inside comments and strings (false positives).
- `state.X` reads: `state.candidateList`, `state.crossSpecies`,
  `state._markerPanel` (lazy-init), `state.markerThresholds`,
  `state.data` (the chromosome precomp). All map to the atlas-router's
  `atlasState.inversion` + `atlasState.shared.activeChrom`.

**Decision: keep marker_readiness as a single file, don't split into sub-modules.**
The 921 LOC body is cohesive (single concern: marker-panel domain
logic — score → tier → controls → render). The local_pca_dosage/candidate_focus splits
were justified at >3000 LOC across multiple concerns (state, data,
HTML builders, wires, panels, lists, draws). Page18 doesn't meet that
threshold. Sub-module pattern parity isn't a goal in itself.

**Shipped:**

1. **`marker_readiness.js` refactored in-place** (920 → 966 LOC):
   - Replaced `const state = (typeof window !== 'undefined' && window.state) ? window.state : {};`
     with proper imports from `./marker_readiness/_state.js` and shared.
   - Added `import { _esc } from '../../shared/page1_data_helpers.js';`
     to satisfy the 15 `_esc(...)` call sites that were previously
     unresolved globals.
   - State shim injection: a Python AST-aware patcher walked every
     top-level `function NAME(args) {...}` and injected
     `const state = _pageState;` as the first statement of any
     function whose body referenced bare `state` and didn't take
     `state` as first arg. Result: 4 functions got the shim
     (`_mpMinDistanceToCsBreakpoint`, `_mpDeriveAutoPanel`,
     `_mpEnsureState`, `_mpRenderToolbar`) — exactly the ones that
     read `state.candidateList`, `state.crossSpecies`, etc.
   - Replaced `export function renderMarkerPanelPage()` with the
     state-aware variant `renderMarkerPanelPage(state)` that calls
     `_setActiveState(state)` before delegating to the legacy
     `_renderMarkerPanelPage()`.
   - Removed the chat-33 `__MODULE_ID__` export (legacy artifact;
     no consumers).
   - Added `mount(root, atlasState, registry)`,
     `unmount(root)`, and `_buildLegacyState(atlasState)` (mirrors
     the local_pca_dosage/candidate_focus/catalogue pattern).

2. **`marker_readiness/_state.js` (18 LOC, NEW)** — `_pageState` + `_setActiveState`.
   Same shape as `local_pca_dosage/_state.js`, `candidate_focus/_state.js`, `catalogue/_state.js`.
   Page18 has its OWN _pageState (separate from the others).

3. **Registry + manifest fixes:**
   - `pages.registry.json` marker_readiness: added `_label` ("15 marker panel")
     and `_doc` documenting the legacy tab definition + tier hierarchy.
   - `manifest.json` marker_readiness: label "page 18" → **"marker panel"**;
     stage "catalogue" → **"synthesis"** (matching legacy
     `data-stage="synthesis"` at line 5128).

4. **Test extensions:**
   - `tests/test_catalogue_page18.js`: replaced (was a stale 30-LOC
     chat-33 test that imported from the wrong path
     `../inversion_catalogue/marker_readiness.js`, asserted removed
     `__MODULE_ID__`, and used wrong AF key casing). New version: 46
     assertions covering exports, sub-module split,
     `_pageState` setter, plus pure-helper exercises for
     `_mpScoreVariantAf` (Tier 1 clean / Tier 2 strong tag / Tier 4
     missing AFs), `_mpAnnotateGelVisibility` (20-300 bp indel /
     5 bp / SNP), JSON validators (markers array / variants_by_inversion
     object). **46/46**.
   - `tests/smoke_catalogue_page18_round5.mjs`: NEW (~250 LOC). Full
     mount/render/unmount lifecycle through atlas-router contract.
     Mirrors the local_pca_dosage/candidate_focus/catalogue fake-DOM pattern. Exercises:
     - module exports check
     - `mount()` empty-state DOM (`mpBody` filled with tier defs +
       methods card; >500 chars even with no candidates)
     - `_pageState` live-binding observed
     - `mount()` populated-state path: synthetic candidate with
       karyotype assignments triggers tier classification; `mpBody`
       contains candidate's chromosome string and >1000 chars total
     - direct `renderMarkerPanelPage(state)` call works
     - `_mpDeriveAutoPanel()` reads from `_pageState` correctly
     - `unmount()` clears `_pageState`
     **20/20**.

**What this round did NOT touch:**
- atlas-core engine — completely unchanged.
- Page1/candidate_focus/catalogue modules — completely unchanged.
- `shared/page1_data_helpers.js` — unchanged this round (marker_readiness's
  only shared dependency is `_esc`, which was already added in round
  5 step 2).
- The stats_profile stats-profile page (sibling synthesis page that reads
  marker_readiness's `_mpDeriveAutoPanel` via `typeof X === 'function'` guard).
  Migrating stats_profile will resolve that import properly. Until then the
  legacy `typeof` guard handles the absence gracefully.
- Toolkit-registry vs Atlas-state cache decisions — Quentin's plan:
  defer until all pages are migrated.
- Page renumbering — deferred per Quentin's directive.
- Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 19, 21,
  overview, sv_evidence — only parse-checked.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                  PASS
tests/test_discovery_page1.js (unchanged)                        PASS (103/103)
tests/test_discovery_page2.js (unchanged)                        PASS (58/58)
tests/test_catalogue_page3.js (unchanged)                        PASS (19/19)
tests/test_catalogue_page18.js (NEW: 46 assertions for sub-module
    + main coverage + pure-helper tier classification +
    gel-visibility + JSON validators)                            PASS (46/46)
tests/smoke_discovery_page1_round4.mjs                           PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                           PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs                           PASS (29/29)
tests/smoke_catalogue_page18_round5.mjs (NEW: 20 assertions for
    mount/render/unmount + _pageState live-binding +
    populated-candidate tier classification)                     PASS (20/20)
Total: 332/332 across all eight test runs (clean reassembly).
```

**Migration progress so far (4 of 22 pages):**
| Page | Folder | Status | LOC | Tests |
|---|---|---|---|---|
| local_pca_dosage | discovery | ✅ migrated rounds 4 + step 1 | ~3300 across 9 sub-modules | 103+33 |
| candidate_focus | discovery | ✅ migrated step 2 | ~3140 across 5 sub-modules | 58+24 |
| catalogue | catalogue | ✅ migrated step 3 (breeding-export only) | ~1308 across 2 sub-modules | 19+29 |
| marker_readiness | catalogue (synthesis) | ✅ migrated step 4 (single file) | ~984 across main + _state | 46+20 |

**Next round:** Quentin's call. Reasonable next candidates:
- **stats_profile** (stats profile) — synthesis sibling of marker_readiness; reads
  marker_readiness's `_mpDeriveAutoPanel`. Has 939 LOC of pre-extracted body.
  Same pattern as marker_readiness (refactor in-place, don't split). Cross-page
  dependencies: `_csGetSyntenyBlocks`, `_csPermutationTest` (likely
  in cross_species_breakpoints/16b multi-species cockpit; may degrade gracefully).
- **annotation_cockpit** — 721 LOC of pre-extracted body in catalogue/.
- **local_pca_theta_pi** — 1008 LOC, 18 TODOs (substantial work needed).
- **cross_species_breakpoints/multi_species_cockpit** — 2400+ LOC each (full multi-species cockpit;
  major undertaking).
- Smaller stubs (window_summary_table, confirmed_carousel, local_pca_ghsl, negative_regions, overview) — quick
  router-wiring rounds.

---


## 2026-05-07 (chat ~36, round 5 step 3) — catalogue catalogue page MIGRATED (breeding-export only)

**Context:**
Round 5 step 2 (earlier today) migrated candidate_focus candidate-detail. Round
5 step 3 (this round) tackles catalogue — the L2 catalogue page. Per
Quentin's chat-36 directive: catalogue lives in `pages/catalogue/`, NOT
`pages/discovery/`; page renumbering deferred to end-of-migration.

**Critical finding (chat-33 stub had documented this; verified independently):**

The catalogue's main rendering pipeline does NOT exist in the legacy
snapshot. `renderCatalogue` is referenced 9 times via `typeof X === 'function'`
guards (legacy lines 13750, 13963, 13974, 14055, 14084, 55642, 55853,
59551, 64293) — every site is `if (typeof renderCatalogue === 'function')
renderCatalogue();`. **No definition anywhere in legacy.** Same for:
`_buildCatalogueRows`, `_filterCatalogueRows`, `_sortCatalogueRows`,
`_paintCatalogueRow`, `_exportCatalogueTSV`, `_exportCatalogueMarkdown`,
`_exportCatalogueJSON`, the SVG/PNG/PDF gallery exports, and the
regime/candidate-promote toolbar handlers. The legacy build expected
an external script to install `window.renderCatalogue` at runtime, but
none does so in the JS we have.

Verification:
```
$ grep -nE 'function renderCatalogue|var renderCatalogue|let renderCatalogue|const renderCatalogue|renderCatalogue\s*=|window\.renderCatalogue' legacy/Inversion_atlas.html
(only the typeof guards above match)
```

**The ONE catalogue-domain feature that DOES exist in legacy:** the
Turn-146 bulk breeding-card export pipeline (legacy lines ~21484–23715).
That's what this round migrates.

**Audited:**
- Legacy line 5051 tab definition: `data-page="catalogue"` titled
  *"Sortable, filterable catalogue of all L2 envelopes (or L1-merged
  inversions). Hover any column header for definition. Export selected
  rows as TSV or Markdown."* Display label: "5 catalogue".
- Legacy line 7261-7368: catalogue div containing the toolbar + an empty
  `<table id="catTable">`. Current catalogue.html (108 LOC) byte-matches.
- 17 functions + 1 constant in the breeding-export closure (~1040 LOC):
  - 9 entry helpers from legacy 23290-23703
  - 8 closure helpers from legacy 21484-22291 (`_arrangementMAF`,
    `_brHtmlEsc`, `_breedingCardKaryotypePerSample`, `_carrierByK8Table`,
    `_generatePairingAdvice`, `_perArrangementFROH`,
    `_summarizeFROHGroup`, `_wilcoxonRankSumP`)
  - 1 constant table `_BREEDING_EXPORT_TIER_MODES` (legacy line 23269)
- Cross-page dependencies: ZERO. The breeding-export closure is fully
  self-contained — reads only `state.candidateList`, `state.cohortDiversity`,
  `state.data`, `state.k`. No imports needed from local_pca_dosage/candidate_focus/shared.

**Shipped:**

1. **2 catalogue sub-modules** under `atlases/inversion/pages/catalogue/catalogue/`:
   - `_state.js` (18 LOC) — `_pageState` + `_setActiveState`. Page3's
     own (separate from local_pca_dosage's and candidate_focus's).
   - `_breeding_export.js` (1106 LOC) — the 17-helper Turn-146 closure
     plus the `_BREEDING_EXPORT_TIER_MODES` constant. Bodies extracted
     byte-verbatim with the same patcher used for local_pca_dosage/candidate_focus:
     - The legacy `(typeof window !== 'undefined' && window.state) ?
       window.state : state` pattern rewritten to `_pageState`.
     - `const state = _pageState;` shim injected in bodies that read
       bare `state`.
     - `export function` prefix injected on the public set
       (`_exportBreedingCardsHTML`, `_exportBreedingCardsJSON`,
       `_wireCatalogueBreedingExportBtns`).

2. **`catalogue.js` main** (rewritten, 184 LOC) — replaces the 157-LOC
   chat-33 stub. Imports + public re-exports from `_breeding_export.js`.
   Implements `renderCataloguePage(state)`, `initCataloguePage(state)`,
   `mount(root, atlasState, registry)`, `unmount(root)`. The mount
   path:
   - Builds a legacy-shape state from atlasState (same pattern local_pca_dosage/2 use).
   - Calls `renderCataloguePage(state)` which currently shows the
     empty-state message (since the catalogue renderer doesn't exist
     in legacy).
   - Calls `initCataloguePage(state)` which calls
     `_wireCatalogueBreedingExportBtns()` — the only catalogue-toolbar
     action with a working legacy implementation.
   - Defensive `try/catch` around each step (mirrors candidate_focus's `_safeBuild`
     pattern).

3. **Registry + manifest fixes:**
   - `pages.registry.json` catalogue: added `_label` ("5 catalogue") and
     `_doc` documenting the legacy tab definition + the round-5-step-3
     migration scope (breeding-export only; catalogue rendering not
     yet migrated).
   - `manifest.json`: catalogue label "page 3" → **"catalogue"** (matching
     legacy line 5051's "5 catalogue" display label, minus the redundant
     prefix since the manifest's stage field already says "catalogue").

4. **Test extensions:**
   - `tests/test_catalogue_page3.js`: replaced (was a stale 21-LOC
     chat-33 test that imported from the wrong path
     `../inversion_catalogue/catalogue.js` and asserted `__MODULE_ID__` —
     a removed export). Now 19 assertions covering the sub-module
     splits, public re-exports, and `_pageState` setter behavior.
     **19/19**.
   - `tests/smoke_catalogue_page3_round5.mjs`: NEW (~270 LOC). Full
     mount/render/unmount lifecycle through atlas-router contract.
     Mirrors the local_pca_dosage round-4 / candidate_focus round-5-step-2 fake-DOM
     pattern; exercises:
     - mount() empty-state DOM (catEmpty visible with hint message,
       catHead/catBody/catSelInfo correctly empty)
     - `_pageState` live-binding observed across module boundaries
     - breeding-export wires bound after mount
       (`#catBreedingTierSel`, `#catExportBreedingHTML`,
       `#catExportBreedingJSON` all marked `dataset._wired = '1'`,
       all have correct event listeners)
     - localStorage tier round-trip (`pca_scrubber_v3.breeding_export_tier`
       persists when the user changes the dropdown)
     - mount-twice idempotency (no double event listeners)
     - direct `renderCataloguePage(state)` and `initCataloguePage(state)`
       calls
     - unmount() clears `_pageState`
     **29/29**.

**What this round did NOT migrate:**

The catalogue table renderer + 11 unimplemented toolbar handlers.
Inventory (preserved from chat-33 stub for the next round to consume):

| Function | Status | Wired to |
|---|---|---|
| `renderCatalogue` | TODO_MISSING — never defined in legacy | (everything) |
| `_buildCatalogueRows` | TODO_MISSING — never defined in legacy | (rendering) |
| `_filterCatalogueRows` | TODO_MISSING — never defined in legacy | (rendering) |
| `_sortCatalogueRows` | TODO_MISSING — never defined in legacy | (rendering) |
| `_paintCatalogueRow` | TODO_MISSING — never defined in legacy | (rendering) |
| `_exportCatalogueTSV` | TODO_MISSING — never defined in legacy | `#catExportTSV` |
| `_exportCatalogueMarkdown` | TODO_MISSING — never defined in legacy | `#catExportMD` |
| `_exportCatalogueJSON` | TODO_MISSING — never defined in legacy | `#catExportJSON` |
| `_exportCatalogueGallerySVG/PNG/PDF` | TODO_MISSING — never defined in legacy | `#catExportGallery*` |
| `_openRegimeRegistryDialog` | TODO_MISSING — never defined in legacy | `#catRegimeRegistry` |
| `_assignSelectedToRegime` | TODO_MISSING — never defined in legacy | `#catRegimeAssignSel` |
| `_promoteSelectedAsCandidate` | TODO_MISSING — never defined in legacy | `#catViewAsCandidate` |
| `makeShelfLDPanel` | TODO_MISSING — comment says "atlas_turn7.js" | `#page3_q09b_slot` |
| `makeLDSplitPanel` | TODO_MISSING — comment says "atlas_ld.js" | `#page3_ld_slot` |

These are **honest gaps**, not migration debt. The next round (or
Quentin himself) can either implement the catalogue renderer from
scratch (it's a domain-modeling decision: how should the L2 catalogue
present? what columns? what filter logic?), or re-acquire the missing
JS from a more complete legacy snapshot if one exists. Round-5-step-3's
job was to land what does exist (breeding-export pipeline + catalogue
mount lifecycle + registry/manifest correctness).

**Verification:**
```
node --check on every atlases/inversion/**/*.js                 PASS
tests/test_discovery_page1.js                                   PASS (103/103)
tests/test_discovery_page2.js                                   PASS (58/58)
tests/test_catalogue_page3.js (NEW: 19 assertions for
    sub-module split + main re-export coverage)                 PASS (19/19)
tests/smoke_discovery_page1_round4.mjs                          PASS (33/33)
tests/smoke_discovery_page2_round5.mjs                          PASS (24/24)
tests/smoke_catalogue_page3_round5.mjs (NEW: 29 assertions for
    full mount/render/unmount + breeding-export wire test +
    localStorage tier round-trip + idempotency)                 PASS (29/29)
Total: 266/266 across all six test runs (clean reassembly).
```

**What this round did NOT touch:**
- atlas-core engine — completely unchanged.
- Page1 / candidate_focus sub-modules — completely unchanged.
- The `shared/page1_data_helpers.js` — unchanged this round (catalogue's
  breeding-export closure is fully self-contained).
- Toolkit-registry vs Atlas-state cache decisions — Quentin's plan:
  defer until all pages are migrated.
- Page renumbering — deferred to end-of-migration per Quentin's directive.
- Pages 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
  overview, sv_evidence — only parse-checked.

**Next round (round 5 step 4):** Quentin's call. Reasonable next
candidates from the pages that exist in `atlases/inversion/pages/`:
- **confirmed_carousel** — likely diversity / cohort overview (review chat-33 batch notes).
- **marker_panels**, **stats_profile**, **marker_readiness**, **annotation_cockpit** — also in `pages/catalogue/`.
- **overview** — non-chromosome-scoped overview page.
- The 11 catalogue-rendering TODO_MISSING functions could also be
  designed and implemented as a separate "implementing what legacy
  should have had" task, distinct from migration.

---


## 2026-05-07 (chat ~36, round 5 step 2) — candidate_focus candidate-detail page MIGRATED

**Context:**
Round 5 step 1 (earlier today) hoisted the local_pca_dosage data helpers to
`shared/`. Round 5 step 2 (this round) executes the candidate_focus body
migration per `HANDOFF_2026-05-06_chat34_page2_plan.md`. The candidate_focus
candidate-detail page was previously a 251-line stub with 41
TODO_MISSING markers; it is now a fully-functional 5-sub-module
split that mounts cleanly through the atlas-router.

**Audited:**
- Legacy line 5049 tab definition: `data-page="candidate_focus"` titled
  *"Deep-dive on a single promoted candidate. Multi-panel grid
  (sim_mini, karyogram, dosage heatmap, ancestry strip, etc.)
  with prev/next navigation."* Display label: "3 candidate focus".
  This unambiguously confirms candidate_focus = candidate detail (NOT cohort
  overview as the chat-34 registry entry implied).
- Legacy line 7248 candidate_focus div: contains only `#candidateMeta` and
  `#candidateEmpty` containers — the page builds itself dynamically
  via renderCandidateMetadata. Current candidate_focus.html (12 LOC) matches
  exactly.
- Page1 manifest label was also wrong ("candidate focus" — that's
  candidate_focus's name in legacy). Page1 = "local PCA |z|" per legacy line 5028.
- 41 helpers from the candidate_focus plan: 40 found in legacy (2359 LOC,
  matching plan's prediction exactly), 1 expected forever-stub
  (`renderCatalogue` — page-4 territory).
- Plus 2 entry-point functions extracted (`renderCandidateMetadata`
  61 LOC, `wireCandidateNav` 105 LOC) — total 2525 LOC of legacy
  bodies migrated.
- Cross-module dependency analysis (43 helpers vs 5 buckets) revealed
  one cycle: `refreshCandidateUI` → `renderCandidateMetadata` (called
  from `_list.js`'s `addCandidateToList`). Resolved by keeping both
  orchestrators in main candidate_focus.js and using ES module live-binding
  for the back-import (`_list.js` imports `refreshCandidateUI` from
  `'../candidate_focus.js'`).
- ~219 transitively-reachable legacy globals found via closure walk
  starting from the 43 entry/sub-module functions — far more than
  the candidate_focus plan's 41-helper estimate, because the plan didn't model
  transitive helper calls. Resolved pragmatically (see "Defensive
  guards" below) rather than by chasing the closure.

**Shipped:**

1. **5 candidate_focus sub-modules** under `atlases/inversion/pages/discovery/candidate_focus/`:
   - `_state.js` (20 LOC) — `_pageState` + `_setActiveState` (candidate_focus's own;
     separate from local_pca_dosage's).
   - `_html_builders.js` (1283 LOC) — 16 candidate-detail HTML builders +
     2 candidate_focus-private support helpers (`candidateLocMiniHtml`,
     `candidatePanelStubHtml`) + candidate_focus-private constants
     (`_BLOCK_DISPLAY_ORDER`, `_BLOCKS_WITH_AXIS_DERIVATION`,
     `DOSAGE_HEATMAP_DEFAULTS`, `_ensureDosageHmState`).
   - `_wires.js` (366 LOC) — 7 wire functions (post-DOM event binding).
   - `_list.js` (565 LOC) — 8 list-management helpers + 4 candidate_focus-private
     helpers (`isInCandidateList`, `makeCandidateId`, `_defaultSingleTrack`,
     `_ensureTracks`, `_candStorageKey`) + 3 module constants
     (`_candIdCounter`, `MAX_TRACKS`, `_CAND_STORAGE_PREFIX`).
   - `_draw_panels.js` (429 LOC) — 7 draw functions + 2 candidate_focus-private
     helpers (`_candWindowRange`, `_candLockedLabels`).

2. **`candidate_focus.js` main** (rewritten, 432 LOC) — imports + public re-exports
   from the 5 sub-modules, the 4 orchestrator entry points
   (`renderCandidateMetadata`, `refreshCandidateUI`, `_navigateToCandidate`,
   `wireCandidateNav`), `mount`/`unmount` lifecycle, and a `_safeBuild()`
   defensive wrapper that lets a single broken sub-panel render empty
   instead of killing the whole page.

3. **`shared/page1_data_helpers.js` extended (665 → 753 LOC)** — added
   the 6 helpers that pages 1 and 2 both need:
   - `sampleSpreadL2(state, l2idx)` and `sampleSpreadRange(state, s, e)`
     (already refactored to take state as first arg).
   - `_esc(s)`, `_fmt4(x)`, `_fmtP(p)` — pure formatting helpers.
   - `groupColor(k)` — K-means cluster color palette.

4. **Registry + manifest fixes:**
   - `pages.registry.json` candidate_focus: `requires_layers` corrected from
     `[scrubber_main, cohort_sample_manifest]` to `[scrubber_main,
     candidate_tracks, cohort_sample_froh, ancestry_global_q,
     het_band_backbones, arrangement_calls]`. Added `activeCandidate`
     to `requires_slots`. Added `_label` and `_doc` documenting that
     candidate_focus is the candidate detail page.
   - `manifest.json`: local_pca_dosage label "candidate focus" → "local PCA |z|"
     (matching legacy tab); candidate_focus label "cohort overview" →
     "candidate focus" (also matching legacy tab).

5. **Test extensions:**
   - `tests/test_discovery_page1.js`: 103/103 — extended in step 1
     with shared/shim coverage; unchanged this step.
   - `tests/test_discovery_page2.js`: 3 → **58 assertions** (added
     coverage for all 38 public re-exports + the 5 sub-modules).
   - `tests/smoke_discovery_page2_round5.mjs`: NEW (~370 LOC) —
     full mount() lifecycle through atlas_api, populated-candidate
     render, _pageState live-binding, unmount cleanup. **24/24**.

**Defensive guards strategy (the "smoke green" decision):**

A closure walk from `renderCandidateMetadata` reaches ~219 transitively
needed legacy helpers — 8,105 LOC. Migrating the full closure in this
round would balloon the scope into many more rounds. Instead:

- **Page2-private helpers actually hit by the synth-candidate smoke
  path** (~10 helpers, ~150 LOC) were extracted and added to the
  appropriate sub-module: `isInCandidateList`, `makeCandidateId`,
  `_defaultSingleTrack`, `_ensureTracks`, `_candStorageKey`,
  `_candWindowRange`, `_candLockedLabels`, `candidateLocMiniHtml`,
  `candidatePanelStubHtml`, `_ensureDosageHmState` (+ constants).

- **Cross-page-1 helpers** (`getPC`, `getL2Cluster`, `sampleSpreadRange`,
  etc.) imported from `shared/page1_data_helpers.js`.

- **Pure formatting helpers** (`_esc`, `_fmt4`, `_fmtP`, `groupColor`)
  hoisted into `shared/page1_data_helpers.js` (used by local_pca_dosage too).

- **Everything else** (16 ancestry-confound helpers, 5 K-means lib
  helpers, ~30 local_pca_dosage panel helpers like `drawSlabMiniPCA` /
  `focalContentHtml`, etc.) is currently unmigrated. The
  `renderCandidateMetadata` orchestrator was wrapped in a `_safeBuild()`
  defensive wrapper (mirroring legacy's existing per-wire `try/catch`
  pattern) so a builder that hits an unresolved global degrades to an
  empty fragment with a warning, rather than killing the whole page.
  This matches what legacy does in browsers where the function is
  defined later in script-eval order.

  In smoke testing, **12 of the 16 sub-panels render their HTML
  successfully**; the 4 that warn-and-degrade are:
  - `candidateHaplotypeAnnotationsHtml` — needs `loadHaplotypeLabels`
    (sample storage layer).
  - `candidateAncestryConfoundHtml` — needs `_ancGetGlobalQ` (the
    16-helper `_anc*` family from legacy lines 58068-58289).
  - `candidateRegimeRowHtml` — needs `_candidateL2Ids` (extracted
    but not yet wired) and `_regimesForL2` (depends on
    `_ensureRegimeRegistry` not yet migrated).
  - `drawCandidateLocationStrip` — needs `drawCandSimMini`,
    `drawCandL1Mini`, `drawCandKaryoMini` (~130 LOC of canvas drawing).

  Total degraded: ~4 of 16 sub-panels = 75% of the candidate-detail
  view renders end-to-end on the smoke harness's synthetic data.

**Verification:**
```
node --check on every atlases/inversion/**/*.js                 PASS
tests/test_discovery_page1.js (extended round-5-step-1)         PASS (103/103)
tests/test_discovery_page2.js (sub-module coverage)             PASS (58/58)
tests/smoke_discovery_page1_round4.mjs                          PASS (33/33)
tests/smoke_discovery_page2_round5.mjs (NEW; mount/render/unmount) PASS (24/24)
Total: 218/218 across all four test runs (clean reassembly).
```

The smoke test exercises:
- Module loads cleanly (no parse-time cycle from `_wires.js → candidate_focus.js`).
- `mount(root, atlasState, registry)` empty-state path: candidateMeta
  hidden, candidateEmpty visible, no exceptions.
- `mount()` populated path with synthetic candidate (matching legacy's
  candidate{To,From}JSON schema): renders >1000 chars of HTML across
  12+ sub-panels; the 4 still-unresolved panels degrade cleanly.
- 4 orchestrators (`renderCandidateMetadata`, `refreshCandidateUI`,
  `_navigateToCandidate`, `wireCandidateNav`) called directly — all
  run without throwing.
- `_pageState` live-binding observed across `_state.js` boundary
  (`_setActiveState(stateA)` then `_setActiveState(stateB)` — both
  reads round-trip correctly).
- `unmount()` clears `state.inversion._page2State` and the
  `_pageState` reference (so post-unmount debounced rAF callbacks
  don't see stale state).

**What this round did NOT touch:**
- atlas-core engine — completely unchanged.
- Page1 sub-modules — only their `_data.js` shim got 6 new
  re-exported names; bodies untouched.
- Toolkit-registry vs Atlas-state cache decisions — Quentin's stated
  plan: defer until all pages are migrated. Round 5 step 2 is a
  page-by-page migration step.
- The 4 still-unresolved sub-panels (above). Future rounds will
  hoist the missing legacy helpers.
- Pages 3, 4, 6, 7, 8, 9, 10, 11, 12, 15, 16, 16b, 17, 18, 19, 21,
  overview, sv_evidence — only parse-checked.
- The 251-line `candidate_focus.js` stub — REPLACED, not preserved as `.bak`
  (the chat-33 stub was 251 LOC of TODO_MISSING markers — not
  reference-quality).

**Next round (round 5 step 3 = catalogue migration):**

Per Quentin's chat 36 guidance: catalogue is next, even though it's not
in `pages/discovery/`. Page3 is in `pages/catalogue/` (the sortable
catalogue of L2 envelopes). Page renumbering will happen at the
**complete end** of the migration, NOT incrementally.

Page3 path: `atlases/inversion/pages/catalogue/catalogue.js` +
`pages/catalogue/catalogue.html`. It's the L2 catalogue table —
sortable/filterable rows, TSV/Markdown export. Different shape from
candidate_focus (table-based, less dynamic HTML construction), so the migration
recipe will be similar but the buckets will differ. Likely buckets:
`_state.js`, `_table.js` (row rendering), `_filter.js` (sort/filter
state), `_export.js` (TSV/MD export), and the orchestrator in main
catalogue.js.

---


## 2026-05-07 (chat ~36, round 5 step 1) — local_pca_dosage data helpers HOISTED to shared/

**Context:**
Round 4 (chat 35) split local_pca_dosage into 10 sub-modules and flagged round-5
prep: hoist the pure-on-state helpers from `pages/discovery/local_pca_dosage/_data.js`
into `atlases/inversion/shared/` so candidate_focus's panel modules can import
them directly from day one. Quentin's chat-35 framing: "I feel like
using a shared/ if its for a function why not." This round executes
that hoist as a file-move-only operation (no body edits) before
starting the candidate_focus body migration.

**Audited:**
- All 21 declared names in `pages/discovery/local_pca_dosage/_data.js`
  (17 exported, 4 internal). Confirmed every function takes `state`
  as its first arg; zero references to `_pageState`. The module
  comment header from round 3 step 3 already calls out:
  *"All functions take `state` as first arg (no _pageState shim).
  DOM-free; these are pure or pure-from-state."* Verified by grep —
  only mention of `_pageState` is in that comment.
- Importers of `_data.js` across the local_pca_dosage split: 6 panel sub-modules
  (`sim_panel`, `z_panel`, `lines_panel`, `pca_panel`, `l3_panel`,
  `events`) plus `local_pca_dosage.js` itself (entry-point). Every imported name
  is in the public-export set.
- Importers of `FAMILY_PALETTE_BASE` from `_state.js`: only
  `_data.js`'s `buildFamilyPalette`. After hoisting `buildFamilyPalette`
  into shared, the constant has zero external consumers — safe to drop
  the export from `_state.js`.
- Pre-hoist baseline: `tests/test_discovery_page1.js` 61/61,
  `tests/smoke_discovery_page1_round4.mjs` 33/33, `node --check` clean
  on every JS file. Reproduced cleanly.

**Shipped:**
1. **New module `atlases/inversion/shared/page1_data_helpers.js`** (665
   LOC). Byte-verbatim bodies of all 21 functions/constants from
   `_data.js`, plus the `FAMILY_PALETTE_BASE` constant inlined locally.
   The only mutations vs. the source bodies: (a) header rewritten to
   document the hoist; (b) `import` of `per_l2_cluster.js` rewritten
   from `../../../shared/per_l2_cluster.js` to `./per_l2_cluster.js`
   (relative-path adjustment because the file moved); (c) the
   `import { FAMILY_PALETTE_BASE } from './_state.js'` line dropped
   (constant now lives in this file). Zero body-byte changes.

2. **`pages/discovery/local_pca_dosage/_data.js` reduced to a 38-LOC re-export
   shim**. Re-exports all 21 public names from the shared module so
   the 6 panel sub-modules' `import { ... } from './_data.js'`
   statements keep working unchanged. The 4 internal names
   (`VIEW_CONTROLS_STORAGE_KEY`, `inferLayersFromV1`, `getPCByAxis`,
   `saveViewControls`) stay private to the shared module — they were
   never re-exported from `_data.js` either.

3. **`pages/discovery/local_pca_dosage/_state.js`**: dropped `export` from
   `FAMILY_PALETTE_BASE` (constant moved to shared); kept the three
   small-cohort fallback colors (`FAMILY_COLOR_SMALL`/`SINGLETON`/
   `UNMATCHED`) here because they're only used by the in-module
   `familyColor()` helper. LOC unchanged at 185 (comment block grew
   while constant block shrunk by the same amount).

4. **`tests/test_discovery_page1.js`**: extended with 42 new
   assertions — for each of the 21 hoisted public names, check
   (a) `shared/page1_data_helpers.js` exports it, and (b) the
   `_data.js` shim's re-export points to the same identity (live
   re-export, not a copy). Now 103/103 (was 61/61).

5. **`tests/test_discovery_page2.js`**: stale path
   `../inversion_discovery/candidate_focus.js` corrected to
   `../atlases/inversion/pages/discovery/candidate_focus.js`. The chat-34
   round-4-done handoff flagged this as deferred to round 5; landed
   here because it's a one-line fix and the test now actually loads.
   Currently 3/3 (candidate_focus body migration is round 5 step 2).

**Verification:**
```
node --check on every atlases/inversion/**/*.js              PASS
tests/test_discovery_page1.js (103 assertions)               PASS (103/103)
tests/test_discovery_page2.js (3 assertions, path fixed)     PASS (3/3)
tests/smoke_discovery_page1_round4.mjs (33 assertions)       PASS (33/33)
Symbol-level identity check (shim===shared for all 21 names) PASS (70/70 incl. negative checks)
```

The smoke test is the strongest signal: `mount() → applyData → setCur(state, 25) → unmount` runs end-to-end through `atlas_api.bootstrap`, which exercises every public entry-point of every panel sub-module. The shim is fully transparent — no panel module knows the bodies moved.

**Why this matters for round 5 step 2 (candidate_focus migration):**
The candidate_focus plan (`HANDOFF_2026-05-06_chat34_page2_plan.md`) Step 5 "Cross-page imports" is now resolved. Page2's panel modules can `import { getPC, getL2Cluster, availablePCs, currentMbRange, ... } from '../../shared/page1_data_helpers.js'` — and since these helpers all take `state` as first arg, candidate_focus doesn't need the `_pageState` shim for them. Page2's own `_pageState` (for its candidate-detail-specific helpers) stays decoupled from local_pca_dosage's.

**What this round did NOT touch:**
- `atlas-core/` engine — completely unchanged.
- The other 9 local_pca_dosage sub-modules (`sim_panel`, `z_panel`, etc.) — only
  their `_data.js` import target changed under them, transparently.
- Page2 body migration — that is round 5 step 2.
- The candidate_focus registry-entry mismatch (Step 0 of the candidate_focus plan: candidate_focus's
  `requires_layers: [scrubber_main, cohort_sample_manifest]` is the
  cohort-overview shape, but the actual candidate_focus code is candidate-detail).
  Defer to round 5 step 2 — the chat doing that migration has the most
  context to resolve it.
- Other shared/ hoisting candidates flagged in the round-4-done handoff
  (the color helpers in `_state.js` that read `_pageState` via the
  shim — `trackedColor`, `_vColor`, etc.). Those need refactoring to
  take `state` as first arg before they can move. Defer until a page
  actually needs them shared.

**Round 5 step 2 entry point:**
A fresh handoff `HANDOFF_2026-05-07_chat36_round5_step1_done.md` documents
the candidate_focus migration's exact starting state, with import paths updated
to reference `shared/page1_data_helpers.js`. The 41-helper extraction
plan in the candidate_focus plan handoff is otherwise unchanged.

---


## 2026-05-06 (chat ~35, round 4) — local_pca_dosage SPLIT into 10 sub-modules

**Context:**
The eighth pass landed local_pca_dosage at full legacy parity in a 6684-LOC monolith.
Quentin's stated next step: "split the huge js into smaller like per type
of analysis or panel so it makes it so much easier to work with and
faster." The eighth-pass handoff documented a 10-module plan; this round
implements it.

**Audited:**
- The 6684-LOC `local_pca_dosage.js` at the close of pass 8. Mapped every named
  definition (88 `function|const|let NAME` symbols) to a line range and
  classified each into one of 10 buckets per the eighth-pass plan.
- The cross-module dependency graph: for every body, which other-bucket
  names it actually calls or references. Used a tight regex
  (`(?<![\w$.])NAME(?=\s*[\(\[.,;)\s])`) to avoid false positives from
  comments / string literals / property accesses on unrelated objects.
- The external imports (`shared/per_l2_cluster.js`, `shared/page1_utils.js`,
  `shared/color_helpers.js`, etc.) and which sub-module needs each.
- 4 module-private constants between FAMILY_PALETTE_BASE and
  inferLayersFromV1 that the eighth-pass DEFS table had missed
  (`FAMILY_COLOR_SMALL`, `FAMILY_COLOR_SINGLETON`, `FAMILY_COLOR_UNMATCHED`,
  `VIEW_CONTROLS_STORAGE_KEY`). Caught by the smoke test on the first
  pass, fixed before re-running.

**New work:**

- Created `atlases/inversion/pages/discovery/local_pca_dosage/` with 9 sub-modules:
  | File | LOC | Concern |
  |---|---|---|
  | `_state.js` | 185 | `_pageState` (export let), `_setActiveState`, color helpers, FAMILY_* constants |
  | `_data.js` | 643 | Schema/layer detection, PC accessors, indexing, view controls, line accessors, range/scale helpers |
  | `sim_panel.js` | 451 | drawSim, drawSimMini |
  | `z_panel.js` | 1375 | drawZ + 9 strip renderers (SnpDensity, TransitionRate, RegimeBreadth, Lineage, Diamond, InheritanceLabels, TrackedLinkage, BandTrace, SnpDensityShade) |
  | `lines_panel.js` | 1304 | drawLinesPanel, buildLinesPanel, buildLinesPanelCheckboxes, refreshLinesColorMode, setLinesPanelCandidateBands |
  | `pca_panel.js` | 626 | drawPCA, drawAnchorStrip, recomputeAnchorConcord, _refreshScreeInset, autoPickRadial, cycleKAside, togglePlay, renderTrackedList, renderManualGroupsList |
  | `l3_panel.js` | 883 | renderL3Panel, renderL3PanelSlab, renderL3PanelScaleStability |
  | `candidates.js` | 480 | _assignCandidateLanes, _paintCandidateBands, _ensureCsOverlayIndex, drawCandidateBar, refreshBandPickBar, refreshCandidateUI, the 4 forever-stubs (_winNavBand, _wRowBand, _drawWRow, _drawWinNavLane) |
  | `events.js` | 362 | onSimClick, onZClick, onPCAClick, setCur, updateWinLabel, buildTrackPanels, drawTracks |

- Replaced `pages/discovery/local_pca_dosage.js` with a **slim 431-LOC main module**
  that:
  - Imports the helpers `applyData` needs from sub-modules (8 from data,
    2 from candidates, 1 from state, plus public-export aliases).
  - Re-exports the 26 public entry points from their sub-modules so
    the manifest's `module: "local_pca_dosage.js"` contract is preserved (no
    manifest edits needed). Public exports still include `mount`/
    `unmount`/`applyData` defined in main.
  - Holds `applyData`, `mount`, `unmount`, `_buildLegacyState`, and
    `_wireCanvasHandlers`. `applyData` lives in main (not data) because
    it orchestrates calls into every sub-module — keeping it in main
    avoids creating a cycle through every panel.

- `_pageState` shared via ES module live-binding semantics.
  `_state.js` does `export let _pageState = null;` and
  `export function _setActiveState(s) { _pageState = s; }`. Every panel
  module imports `_pageState` (with `import { _pageState } from
  './_state.js'`); helper bodies that do `const state = _pageState;`
  see the latest written value because of ES-modules live-binding.
  Verified with a focused micro-test: state-A → state-B switching
  observed across 3 module boundaries.

- Bodies extracted **verbatim**: every comment, every blank line, every
  legacy-line annotation preserved. The only mutations are:
  - `export ` prefix added to every name imported by another module
    (computed from the dep graph; idempotent regex skips already-
    exported names).
  - Constants and color helpers split between `_state.js`, `_data.js`,
    and (none in panels — all panel functions are bodies, not new
    consts).

- Sub-module path discipline: `_state.js`/`_data.js`/etc. live one
  directory deeper than the original `local_pca_dosage.js`, so all
  `'../../shared/X.js'` imports become `'../../../shared/X.js'`. Done
  programmatically in the split tool.

**Verified:**

- `node --check` clean on all 10 modules (local_pca_dosage.js + 9 sub-modules).
- All other shared/*.js and pages/**/*.js still parse-clean.
- atlas-core engine: 9/9 parse-clean; engine untouched.
- **Symbol-level diff vs the pre-split `local_pca_dosage.js.bak`: 90 top-level names
  defined in both, 0 added, 0 removed.** No definitions lost or duplicated.
- Module load test (assembled workspace, dynamic import from
  `pages/discovery/local_pca_dosage.js`): all 28 expected exports
  (drawSim, drawSimMini, drawZ, drawLinesPanel, drawPCA, drawAnchorStrip,
  renderL3Panel/Slab/ScaleStability, updateWinLabel, setCur, autoPickRadial,
  applyData, onSimClick/onZClick/onPCAClick, togglePlay, cycleKAside,
  renderTrackedList, renderManualGroupsList, buildLinesPanelCheckboxes,
  buildLinesPanel, buildTrackPanels, drawTracks, refreshLinesColorMode,
  setLinesPanelCandidateBands, mount, unmount) resolve to functions.
- **Smoke test (assembled workspace + fake DOM + atlas_api bootstrap,
  N=100 windows, S=50 samples, 2 L1 envelopes, 2 L2 envelopes, 8 family IDs):**
  - applyData populates state correctly: schemaVersion=2, layersPresent
    has envelopes/samples/windows (a Set), pc1Sign has 100 entries,
    windowToL1[0]=-1/[20]=0/[50]=-1/[75]=1, windowToL2[20]=-1/[24]=0/
    [30]=0/[80]=1, all 8 family IDs become hubs, l2NeighborsInL1.size=2.
  - setCur(state, 25) sets state.cur=25 and exercises the full draw chain
    (drawSim/drawZ/drawTracks/drawLinesPanel/drawPCA/updateWinLabel)
    without errors.
  - Each public draw fn (drawSim, drawSimMini, drawZ, drawLinesPanel,
    drawPCA, drawAnchorStrip, drawTracks, updateWinLabel) called
    directly: no errors.
  - mount() through atlas-core's atlas_api.bootstrap → registry.resolve
    → applyData → initial-render loop: runs end-to-end without throwing.
    state.data populated, inversion._page1State stashed on the bucket.
  - unmount() clears inversion._page1State.
  - **_pageState live-binding micro-test across module boundaries:**
    setActiveState(A) then setActiveState(B) both observed in _state.js;
    sub-modules reading `_pageState` see live updates — verified by
    drawSimMini's setActiveState entry-point reaching helpers in z and
    candidates panels.
  - Final tally: **33/33 assertions pass.**
- `tests/test_discovery_page1.js`: updated stale path
  (`../inversion_discovery/local_pca_dosage.js` → `../atlases/inversion/pages/discovery/local_pca_dosage.js`)
  and extended with 33 more assertions covering each sub-module's
  expected exports. **61/61 assertions pass** when run against an
  assembled workspace.

**Did NOT touch this round:**
- HTML fragment (`local_pca_dosage.html`), CSS (`inversion.css`), manifest
  (`pages.registry.json` & friends), atlas-core engine, server,
  schemas, master_config. JS-only.
- Cross-page hoisting to `shared/` — that's a round-5 (candidate_focus prep)
  decision per the candidate_focus plan handoff.
- Sibling pages (candidate_focus, window_summary_table, local_pca_theta_pi, local_pca_ghsl, negative_regions) — only
  parse-checked.

**State of local_pca_dosage after round 4:**
- One slim entry-point file (local_pca_dosage.js, 431 LOC) + 9 sub-modules
  totaling 6309 LOC.
- 4 forever-stubbed helpers retained inside `candidates.js` (legacy
  parity; legacy itself runs them via `typeof === 'function'` guards).
- 0 TODO_MISSING markers. The TODO_MISSING_SLOT comments from pass 8
  are not carried forward into the split (they were pre-split
  documentation of unregistered slot names; the split tool only
  extracts function bodies and named-const blocks, so those comments
  don't survive). They remain in `local_pca_dosage.js.bak` for reference and as
  the inventory the SLOT_REGISTRY widening should target.
- 90 named definitions, all unique across the split.
- `local_pca_dosage.js.bak` preserved alongside the new `local_pca_dosage.js` as a reference
  copy of the pre-split monolith. Delete once round 5 is finished and
  the split has been exercised in a real browser.

**Round-4 split tool:**
- `/home/claude/work/split_page1.py` — the extraction script.
  Brace-matches function bodies, computes cross-module deps from a
  loose-pattern regex, computes which names need `export` (by union
  of "imported by another module" and "in PUBLIC_EXPORTS for re-export
  by main"), prefixes `export ` idempotently, writes the 10 module
  files. This script is not committed — it's a one-shot tool. Saved
  in case candidate_focus/3/4 want to crib from it.

**Suggested round 5: candidate_focus migration.**
Per `HANDOFF_2026-05-06_chat34_page2_plan.md`: 41 helpers, 40 found in
legacy with real bodies (2359 LOC). The recipe now generalizes from
local_pca_dosage since the panel-module pattern is proven. The candidate_focus plan flags
two cross-cutting decisions to make first:
1. Resolve the candidate_focus registry-entry mismatch (registry says "cohort
   overview" but the code is candidate-detail). Audit legacy line 7248.
2. Decide cross-page helper sharing strategy: hoist local_pca_dosage+candidate_focus shared
   helpers to `atlases/inversion/shared/` (Quentin in chat 35: "I feel
   like using a shared/ if its for a function why not"). Recommended
   path: when a helper is needed by both local_pca_dosage and candidate_focus, refactor it
   to take `state` as first arg (no `_pageState` shim) and move it to
   `shared/`. The `_data.js` module is the most likely donor — many of
   its functions (getPC*, getL2Cluster*, allSampleIdx, getLines*,
   listLayers, currentMbRange, getActiveSimScale, etc.) are pure-on-
   state and could move as-is.

---

## 2026-05-06 (chat ~34, eighth pass) — local_pca_dosage parity COMPLETE: all 19 extractable helpers landed

**Context:**
The seventh pass left 23 stubs in local_pca_dosage.js. Quentin's direction:
"finish page 1 fully" before splitting into smaller modules. This pass
extracts every legacy helper that has a real body (19 of them) and
keeps the 4 referenced-but-never-defined-in-legacy helpers stubbed
(`_winNavBand`, `_wRowBand`, `_drawWRow`, `_drawWinNavLane` — these
are stubbed in legacy too, every call site has a `typeof X ===
"function"` guard, so legacy itself ran with these as undefined).

**Audited:**
- The 23 stubs remaining after pass 7. For each, looked for
  `function NAME(` in legacy/Inversion_atlas.html.
- 19 found, total 1265 LOC across them. Largest: `drawCandidateBar`
  (213 LOC), `_drawBandTraceStrip` (128), `_drawInheritanceLabelsStrip`
  (127), `_drawDiamondOverlay` (95), `_drawLineageStrip` (99),
  `_ensureCsOverlayIndex` (78), `_drawSnpDensityStrip` (74).
- 4 not found in legacy at all (`_winNavBand`, `_wRowBand`, `_drawWRow`,
  `_drawWinNavLane`). Verified by searching every form (`function`,
  `const`, `let`, `var`, `=`). Legacy line 52173 explicitly has
  `(typeof _winNavBand === "function") ? ... : ...` — confirms legacy
  itself treated them as optional. Round-2 stubs preserve this
  semantic.
- The legacy bodies use `state` as a global. Under the new shell
  every entry-point takes `state` as first arg. Two strategies for
  reconciliation: refactor every body to take `state` first, or
  introduce a module-level `_pageState` reference set by every
  entry-point. The second was cheaper (no edits to 19 bodies, just
  add `const state = _pageState;` at the top of each body — done
  programmatically).

**New work:**

- `atlases/inversion/pages/discovery/local_pca_dosage.js`:
  - **19 helpers extracted verbatim** from legacy and inserted into
    a new "Legacy bodies (parity)" block. All take `_pageState` as
    their state source via a `const state = _pageState;` (or `const
    _state = _pageState;` for bodies that already used a `_state`
    alias) line at the top. Constants (`PALETTE`, `GROUP_COLORS`,
    etc.) are referenced — already defined in the existing helpers
    block from pass 7.
  - **4 helpers kept stubbed forever** (`_winNavBand`, `_wRowBand`,
    `_drawWRow`, `_drawWinNavLane`) — never defined in legacy, every
    call site has `typeof X === "function"` guard. This IS legacy
    parity.
  - **`_pageState` module-level reference** added at the top of the
    block. Every entry-point function sets it via
    `_setActiveState(state)` on its first line. 26 entry-points
    patched.
  - Re-inserted `getActiveSimScale(state)` and `currentMbRange(state)`
    bodies (these were in the prior stubs block and got accidentally
    removed during the splice; restored from the round-3-step-1
    extracts).

- `_handoff_docs/AUDIT_LOG.md`: this entry.
- `_handoff_docs/PAGE_MIGRATION_RECIPE.md`: round-3-step-4 entry
  appended.
- `_handoff_docs/HANDOFF_2026-05-06_chat34_eighth_page1_parity.md` (NEW).

**Verified:**

- `node --check` clean: local_pca_dosage.js (6684 LOC, was 5397 after pass 7),
  every other shared/*.js, every other pages/**/*.js.
- atlas-core engine unchanged: 9/9 parse-clean; 23/23 + 13/13 + 4/4
  test assertions pass.
- **Smoke test (assembled workspace + fake DOM with full canvas API):**
  module loads, 28 exports including mount/unmount.
- **Stronger smoke test** with N=100 windows, S=50 samples, 2 L1
  envelopes, 2 L2 envelopes, 8 family IDs, fake sim_thumb:
  - mount() runs end-to-end without errors.
  - applyData populates state correctly: pc1Sign has 100 entries,
    windowToL1=[−1,0,−1,1] (sample of 4 representative windows),
    windowToL2 same pattern, all 8 family IDs become hubs (each has
    ~6 samples, n≥4), l2NeighborsInL1.size=2.
  - setCur(25) works — exercises the full draw chain (drawSim, drawZ,
    drawTracks, drawLinesPanel, drawPCA, updateWinLabel) without
    throwing.
  - unmount() cleans up properly.

**Did NOT touch this round:**
- HTML fragment, CSS, registry, master_config, schemas, atlas-core
  engine, server. JS-only work.
- The 4 forever-stubbed helpers (intentional).

**State of local_pca_dosage.js after the eighth pass:**
- 6684 LOC (was 5397; +1287 from extracted helpers + _pageState
  scaffolding + setActiveState calls).
- 4 stubs remain (the forever-stubbed helpers; legacy parity).
- 0 TODO_MISSING markers. 29 TODO_MISSING_SLOT markers (unchanged —
  state slots, separate concern).
- Page1 is functionally at parity with legacy: every helper that
  legacy defined is now defined here.

**Open for next session:**
Phase B: split local_pca_dosage.js into 10 cohesive sub-modules under
`pages/discovery/local_pca_dosage/`. Proposed split:
- `local_pca_dosage.js` (main shell): mount/unmount, applyData, _buildLegacyState,
  _wireCanvasHandlers, exports — ~400 LOC.
- `local_pca_dosage/_state.js`: _pageState, _setActiveState, color helpers,
  PALETTE/GROUP_COLORS constants — ~300 LOC.
- `local_pca_dosage/_data.js`: detectSchemaAndLayers, buildIndexes, computePC1Signs,
  populateSimScales, buildFamilyPalette, getPC*, getLines*, allSampleIdx,
  getL2Cluster*, view-controls, listLayers, currentMbRange,
  getActiveSimScale — ~700 LOC.
- `local_pca_dosage/sim_panel.js`: drawSim, drawSimMini — ~430 LOC.
- `local_pca_dosage/z_panel.js`: drawZ + 9 strip renderers — ~1400 LOC.
- `local_pca_dosage/lines_panel.js`: drawLinesPanel, buildLinesPanel,
  buildLinesPanelCheckboxes, setLinesPanelCandidateBands,
  refreshLinesColorMode — ~1300 LOC.
- `local_pca_dosage/pca_panel.js`: drawPCA, drawAnchorStrip, renderTrackedList,
  renderManualGroupsList, recomputeAnchorConcord, _refreshScreeInset,
  autoPickRadial, cycleKAside, togglePlay — ~600 LOC.
- `local_pca_dosage/l3_panel.js`: renderL3Panel, renderL3PanelSlab,
  renderL3PanelScaleStability — ~870 LOC.
- `local_pca_dosage/candidates.js`: candidate/overlay helpers + 4 forever-stubs
  + refreshCandidateUI, refreshBandPickBar — ~470 LOC.
- `local_pca_dosage/events.js`: onSimClick, onZClick, onPCAClick, setCur,
  updateWinLabel, drawTracks, buildTrackPanels — ~330 LOC.

The split makes 6684 LOC navigable. Module-level `_pageState`
shared via the live-binding semantics of ES modules — `_state.js`
exports `_pageState` and `_setActiveState`; every panel module
imports both. Working on the split is the next session.

---

## 2026-05-06 (chat ~34, seventh pass) — local_pca_dosage mount works end-to-end (parity restoration + 18 helpers extracted)

**Context:**
After the sixth pass landed 5 stubs replaced with real bodies (round 3
step 1), Quentin pushed back: local_pca_dosage must be 100% similar in functions
and style to legacy local_pca_dosage, and must work the same when index.html
loads its fragment. Audited the actual mount path. Found two large
gaps: (a) ~17 unguarded helper calls inside `applyData` and entry-point
functions that would throw `ReferenceError` at mount time, plus 23
bare-form `drawX()/renderX()` calls that lacked the new-shell `state`
arg; (b) 16 helper functions referenced from migrated bodies but never
extracted from legacy. This pass closes both gaps.

**Audited:**
- local_pca_dosage.html: 1344 LOC. Verified byte-identical to legacy `<main
  id="local_pca_dosage">` extent (lines 5474-6817). Fragment is correct.
- inversion.css: 4316 LOC + _legacy_tabbar.css 140 LOC + atlas-core/
  css 455 LOC. Comment-stripped selector comparison: legacy `#local_pca_dosage`
  selectors = 49, inversion.css `#local_pca_dosage` selectors = 49, set difference
  = ∅ in both directions. CSS is correct.
- local_pca_dosage.js mount path (mount → resolve(scrubber_main) → applyData →
  draw entry-points). Found 17 unguarded helper calls in applyData,
  setCur, autoPickRadial, cycleKAside; 23 bare-form drawX()/renderX()
  calls without state arg; 7 element IDs referenced by JS but absent
  from local_pca_dosage.html (sidebar/topbar territory: trackedList,
  trackedCountInfo, trackedNInfo, manualGroupsList,
  manualGroupsListPopup, simMinimapCanvas, kSelect — most already
  null-guarded; dataStatus/headerMeta/schemaBadge were not).
- Legacy bodies for the 16 missing helpers (lines 9881-10007, 10020-
  10059, 10673-10679, 10770-10784, 33139-33159, 33626-33677,
  36259-36301, 47867-47874, 51976-51994, 52472-52530, 52588-52600,
  52835-53039, 54175-54177, 57582-57617). All clean extracts; only
  `getL2Cluster`/`getL2ClusterAt` need adapting because the shared
  module's `clusterL2(ctx, l2idx)` takes an explicit context (legacy
  used a global `state`).

**Found:**
- The HTML fragment and CSS were already correct; the gap was JS.
- 12 of 16 missing helpers have legacy bodies (extract verbatim,
  refactor to take `state` first arg). 3 are referenced-but-never-
  defined in legacy itself (`refreshColorModeBar`, `refreshPcaAxisBar`,
  `refreshPinUI`) — must stay as guarded calls forever (legacy was
  running with these as no-ops). 1 is shared-module-already
  (`sampleSpreadL2` etc. — just needs imports widened).
- The mount() error chain worked: each entry-point is wrapped in
  per-function try/catch in mount(), so individual entry-point
  failures don't block the others. But `applyData` failures DO break
  the mount because they happen before the entry-points run. That's
  why `applyData`'s unguarded calls were the highest-priority fix.
- A real-browser smoke test (assembled workspace + fake DOM with
  `setLineDash` etc. defined) confirms `mount()` runs end-to-end after
  the fixes; the only errors before adding `setLineDash` to the fake
  context were for that single missing canvas method, which real
  browsers do support.

**New work — JS only (no registry / master_config / schema changes):**

- `atlases/inversion/pages/discovery/local_pca_dosage.js`:
  - **18 helpers extracted verbatim from legacy** (refactored to take
    `state` first arg per round-2 convention), inserted as a labeled
    "Legacy helpers (parity)" block before "Extracted bodies":
    1. `inferLayersFromV1(data)` (legacy 52588-52600).
    2. `detectSchemaAndLayers(data)` (legacy 52835-53039 — 205 LOC,
       largest).
    3. `listLayers(state)` (54175-54177).
    4. `availablePCs(state)` (9980-9991).
    5. `getPCByAxis(state, winIdx, axis)` (9993-9998).
    6. `getPCRender(state, winIdx, axisX, axisY)` (10000-10007 —
       replaces the round-2 stub).
    7. `getPC(state, winIdx)` (9951-9955).
    8. `buildIndexes(state)` (9881-9927).
    9. `computePC1Signs(state)` (9932-9950).
    10. `populateSimScales(state)` (52472-52530).
    11. `buildFamilyPalette(state)` (36273-36301) + 4 constants
        (`FAMILY_PALETTE_BASE`, `FAMILY_COLOR_SMALL/SINGLETON/UNMATCHED`).
    12. `refreshBandPickBar(state)` (51976-51994).
    13. `refreshCandidateUI(state)` (57582-57617).
    14. `loadViewControls(state)` (10020-10038) + `saveViewControls(state)`
        (10011-10018) + `VIEW_CONTROLS_STORAGE_KEY` constant.
    15. `reconcileViewControlsForData(state)` (10043-10059).
    16. `getL2Cluster(state, l2idx)` (10673-10679 — adapted to
        ClusterCache + contextFromState).
    17. `getL2ClusterAt(state, l2idx, K)` (10770-10784 — adapted).
    18. `getLinesGrid(state, source)` (33660-33671), `getLinesSignAt(
        state, winIdx, source)` (33674-33677), `getLinesValuesAt(state,
        winIdx, source)` (33626-33655), `allSampleIdx(state)`
        (47867-47874), `_LINES_COLOR_MODES` constant + `_isLinesColor
        ModeAvailable(state, modeId)` (33139-33159).

  - **Removed 6 round-2 stubs** that are now real bodies:
    `getPCRender`, `getLinesGrid`, `getLinesSignAt`, `getLinesValuesAt`,
    `getL2Cluster`, `allSampleIdx`.

  - **Wrapped 17 unguarded helper calls** in `applyData`, `updateWinLabel`,
    `setCur`, `autoPickRadial`, `togglePlay`, `cycleKAside`,
    `onPCAClick` with `typeof === 'function'` guards (matching the
    round-2 convention) so a missing helper no-ops instead of throwing.

  - **Made 8 unguarded `document.getElementById(X).Y` accesses null-
    safe** for elements that aren't in the local_pca_dosage.html fragment
    (sidebar/topbar territory: `dataStatus`, `headerMeta`, `schemaBadge`,
    `winIdx`, `winBp`, `scrubber`, `playBtn`, `kSelect`).

  - **Sed-swept 23 bare-form `drawX()` / `renderX()` / `buildX()` calls
    to pass `state`** (round-2 convention required this; the migration
    extractor missed them). Verified zero remain after the sweep.

  - **Patched 5 `setCur(X)` and 2 `getPC(X)` calls** to pass `state`
    as first arg.

  - Widened the shared-module imports: added `clusterL2AtK`,
    `sampleSpreadL2`, `sigmaProfileL2`, `sampleSpreadRange`,
    `aggregateL2` from `shared/per_l2_cluster.js` (some are referenced
    by the migrated entry points).

- `atlases/inversion/pages/discovery/local_pca_theta_pi.js`: unchanged this pass
  (the round-3 step-1 import already added; nothing else to do here).

**Verified:**
- `node --check` clean: local_pca_dosage.js (5397 LOC), local_pca_theta_pi.js, color_helpers.js,
  every other shared/*.js and pages/**/*.js.
- atlas-core engine unchanged: 9/9 files parse-clean.
- 23/23 + 13/13 + 4/4 assertions still passing on the three engine
  test suites.
- **Real-browser smoke test of local_pca_dosage.js mount path** (assembled
  workspace + fake DOM + fake registry returning a minimal scrubber_main
  payload): module loads (28 exports), `applyData` populates state.data,
  state.layersPresent, state.pc1Sign, state.windowToL1/L2,
  state.l2NeighborsInL1, state.familyPalette, state.hubFamilies,
  state.smallFamilyIds, state.singletonFamilyIds correctly per legacy
  semantics; all entry points run; mount() and unmount() complete.
- A second smoke test exercising `applyData` against a synthetic
  precomp dataset (5 windows, 10 samples, 1 L1 envelope, 1 L2 envelope,
  3 family IDs) produces output matching legacy expectations:
  schemaVersion=2, layersPresent={envelopes,samples,tracks,windows},
  windowToL1=[0,0,0,-1,-1], windowToL2=[0,0,-1,-1,-1], hubFamilies=[0],
  smallFamilyIds=[1,2], l2NeighborsInL1.size=1.

**Did NOT touch this round:**
- HTML fragment (local_pca_dosage.html) — verified byte-identical to legacy and
  unchanged.
- CSS (inversion.css, _legacy_tabbar.css) — verified comment-stripped
  selector parity vs legacy and unchanged.
- inversion-atlas registry (no layer added/modified/removed).
- master_config.example.yaml — unchanged.
- Schemas — unchanged.
- atlas-core engine — no JS edits.

**State of local_pca_dosage.js after the seventh pass:**
- 5397 LOC (was 4672 after step 1; +725 from the legacy-helpers block).
- 23 stubs remain (was 29 after step 1). The 6 newly resolved are:
  getPCRender, getLinesGrid, getLinesSignAt, getLinesValuesAt,
  getL2Cluster, allSampleIdx.
- 0 TODO_MISSING markers. 29 TODO_MISSING_SLOT markers (unchanged —
  that's a future round).
- mount() runs end-to-end without throwing.

**Open for next session:**
The remaining 23 stubs split into:
- 4 state-bound color helpers (`_vColor`, `trackedColor`,
  `getSampleColor`, `_resolveSampleScopeColor`) — round 4 candidates,
  may need SLOT_REGISTRY additions.
- 9 strip renderers (`_drawBandTraceStrip` etc.) — blocked on
  band_trajectories / lineage / snp density / etc. data layers.
- 8 candidate/window-nav helpers (`_assignCandidateLanes`,
  `_paintCandidateBands`, `_winNavBand`, `_wRowBand`, `_drawWRow`,
  `_drawWinNavLane`, `_ensureCsOverlayIndex`, `drawCandidateBar`) —
  these touch the candidate registry layers.
- 2 misc (`recomputeAnchorConcord`, `_refreshScreeInset`).

Next-session priority is the 4 color helpers (round 4), THEN the 8
candidate helpers when their registry layers are wired. The 9 strip
renderers stay stubbed until their data layers land — don't force-
extract them.

---



**Context:**
Per the chat-34 handoff plan: "focus page by page... resolve all TODOs
and we upgrade our registry little by little based on the needs of the
page." Round 2 stubbed 34 truly-missing names in local_pca_dosage.js with safe
fallbacks. Round 3 starts replacing those stubs with real legacy bodies,
beginning with the easiest tier: pure functions and pure-state-reads,
no registry layer changes needed.

**Audited:**
- The 34 stubs that landed in local_pca_dosage.js in chat-31 round 2 (local_pca_dosage.js
  lines ~109-188 in the round-2 layout). Categorised by what each
  stub reads:
  - Pure (no state): simColor, simColorPDF, zColorPDF.
  - Pure-state-read: currentMbRange, getActiveSimScale.
  - State-bound color: _vColor, trackedColor, getSampleColor,
    _resolveSampleScopeColor (read state.linesColorMode, state.colorMode,
    state.ancestryPalette, state.hubFamilies — several are
    TODO_MISSING_SLOT names per the local_pca_dosage.js round-2 audit).
  - Stripe / candidate renderers (17 stubs total): need data layers
    that aren't wired yet — round 5+ work.
- Cross-page references: grep confirmed local_pca_theta_pi.js line 613 is the only
  call site for simColor outside local_pca_dosage. simColorPDF and zColorPDF are
  local_pca_dosage-only. currentMbRange and getActiveSimScale are local_pca_dosage-only.
- Legacy bodies for the 5 round-3 targets (legacy lines 31256-31263,
  31281-31294, 31299-31307, 31311-31329, 31781-31834). All clean
  extracts; no surprise globals beyond `state` itself.

**Found:**
- The 3 color helpers are genuinely pure — they don't even reference
  state. simColorPDF takes (v, q_lo, q_hi); the caller reads q_lo / q_hi
  from the active sim scale and passes them in. Hoist target:
  `shared/color_helpers.js` (NEW file; local_pca_theta_pi also references simColor).
- currentMbRange and getActiveSimScale read state.data, state.viewMode,
  state.cur, state.windowToL1, state.windowToL2, state.simScale
  exclusively. No DOM, no registry, no compute. The legacy globals
  become a `state` first arg cleanly. All 8 call sites are inside
  `function X(state) {...}` already, so no scope plumbing needed.
- No registry layer is gated by these 5 functions. No DATA_LIFECYCLE
  classification needed. No master_config edit needed. No schema edit.

**New work:**
- `atlases/inversion/shared/color_helpers.js` (NEW, ~95 LOC):
  - Exports simColor, simColorPDF, zColorPDF as verbatim legacy bodies.
  - Internals (hex, lerpRGB, SIM_PDF_COLORS, Z_LOW/MID/HIGH) kept
    module-private — exportable later if a caller needs them
    standalone, not now.
  - Header comment cites legacy line ranges per function and explains
    the [r,g,b] integer return contract callers depend on.
- `atlases/inversion/pages/discovery/local_pca_dosage.js`:
  - New import block for `shared/color_helpers.js`.
  - Removed 3 color-helper stubs (simColor, simColorPDF, zColorPDF).
  - Replaced 2 stubs with real bodies:
      function getActiveSimScale(state) { ... }   // verbatim legacy
      function currentMbRange(state) { ... }      // verbatim legacy
  - Updated 8 call sites: 2 × getActiveSimScale(), 6 × currentMbRange()
    → all now pass `state`. (One occurrence in a comment was also
    refreshed for accuracy; the comment described the call.)
  - Refreshed the "RESOLVED / FALSE POSITIVE / STUBBED" accounting
    comment at the top of the file to log round 3 progress.
- `atlases/inversion/pages/discovery/local_pca_theta_pi.js`:
  - Added `import { simColor } from '../../shared/color_helpers.js';`
    so the `(typeof simColor === 'function')` guard at line 613
    resolves against the shared module instead of relying on a legacy
    global. The guard pattern itself is left intact (harmless with an
    imported binding).

**Verified:**
- `node --check` clean: shared/color_helpers.js, local_pca_dosage.js, local_pca_theta_pi.js,
  every other file under `atlases/inversion/shared/`, every other file
  under `atlases/inversion/pages/**/`.
- `node --check` clean: 9/9 atlas-core engine files (no engine code
  changed this round).
- 23/23 assertions still pass on
  `atlas-core/tests/test_registry_write_and_versioning.js`.
- No registry, master_config, or schema files touched. The toolkit_registries
  state from the fifth pass is unchanged.

**Did NOT touch this round:**
- The 29 still-open stubs in local_pca_dosage.js (4 state-bound color helpers + 9
  subpanel strip renderers + 8 candidate/window-nav helpers + 1 PCA
  render + 5 grid accessors + 2 misc). Round 4 should pick the
  state-bound color helpers next; the strip renderers and candidate-nav
  helpers need data layers that aren't wired yet.
- The 29 `TODO_MISSING_SLOT(state.X)` markers in local_pca_dosage.js — slot
  registration is round 4 work, driven by what the next batch of
  extracted bodies actually reads.
- inversion-atlas registry files. No layer added, no layer modified,
  no operation changed. The round-3 names were all local compute.
- No popstats_server.py edits. No engine changes.

**State of local_pca_dosage.js after round 3:**
- 4672 LOC (was 4588 after round 2; +84 net from extracted bodies
  minus removed stubs).
- 29 stubs remain (was 34). 0 TODO_MISSING markers (round 2 cleared
  them all). 29 TODO_MISSING_SLOT markers (unchanged).
- All entry points and stubs parse-clean. The page renders fail-soft
  for the 29 not-yet-extracted helpers, exactly as in round 2.

**Open for next session:**
Round 4 of local_pca_dosage migration. Recommended order: state-bound color
helpers (trackedColor, getSampleColor, _vColor, _resolveSampleScopeColor)
next, then the simpler grid accessors (getLinesGrid, getLinesSignAt,
getLinesValuesAt — these likely read state.data.lines or similar),
then getL2Cluster (reads state.l2Cache or similar; may be a
shared/per_l2_cluster.js call), then allSampleIdx (likely state.data
.n_samples-driven). The 9 strip renderers and 8 candidate-nav helpers
remain blocked on their data layers and should NOT be force-extracted
until those layers land.

---

## 2026-05-06 (chat ~34, fifth pass) — hierarchy data model: species → genome → cohort → groups

**Context:**
After landing multi-species support in the previous pass, Quentin
pushed back on the design: flat "species_id everywhere" doesn't
work for the realities of the next 12 months — bighead catfish
arriving (different ecology: wild, not hatchery), F1 hybrid
genomes already exist, multiple cohorts per species are inevitable
(hatchery + wild collections), and population substructure inside a
cohort is the ongoing analytical work. The registry needs a real
hierarchy, not just a tag.

The exchange landed on the model:
- Species is taxonomic. Tag, not directory.
- Genome is the assembly file. Coordinates live here. F1 hybrid
  assemblies are one genome with multiple species in composition.
- Cohort is the operational unit: BAM list × genome × per-sample
  metadata.
- Group is the analytical lens: subset of one cohort, append-only.

Plus the combine rule, sharpened by Quentin: cohorts combinable
only if same genome_id AND same species_composition. Cross-species
work is comparative-layer work, not cohort-combine.

**Designed (with Quentin's pushback steering each step):**

- 4-level hierarchy (option A in earlier ask) — Quentin: "do as you
  want, can fix later"; the design handles pure species, hybrids,
  and mixed cohorts uniformly so no commitment is needed up front.
- All results, candidates, evidence go under
  `data/cohorts/{cohort_id}/...` (option A in Q2). Per-genome
  data (precomp, dosage) goes under `data/genomes/{genome_id}/...`.
  Comparative is flat (cross-species).
- Sample metadata in a separate TSV referenced by cohort.config
  (option C in Q3) — Quentin: "I don't know"; chose the lowest-debate
  answer. Editable in Excel, scales to thousands of rows.
- **Combine rule:** same genome_id AND same species_composition.
  Encoded as `_constraint_5_combine` in cohort.config schema; engine
  validates at write time. Cross-species comparison goes to
  comparative layer (separate concept, separate roots, no shared
  cohort).

**New work:**

- `toolkit_registries/HIERARCHY_SPEC.md` (NEW, 495 LOC): definitive
  data model. Sections: the four levels with diagram, cohort as
  operational unit, group as analytical subset, subset (cohort →
  smaller cohort), combine (multiple cohorts → one cohort) with the
  full rule and a worked compatibility table, why cross-species is
  NOT cohort-combine, hybrid F1 worked example with two cohort
  options, FK chain across the registry, where data physically
  lives (folder layout), what the hierarchy intentionally does NOT
  support (5-item list to prevent rabbit-hole expansion), migration
  path from current species_scoped state, schemas-this-round
  table, reading order.

- `toolkit_registries/schemas/registry_schemas/species.config.schema.json`
  (REWRITTEN as v2, ~80 LOC): now taxonomic identity ONLY.
  Required fields: species_id, label. Optional: scientific_name,
  ncbi_taxid, is_hybrid, parent_species_ids, notes. Cohort,
  populations, and reference fields removed (moved to cohort.config
  and genome.config). Two examples: pure_species and hybrid_tag.

- `toolkit_registries/schemas/registry_schemas/genome.config.schema.json`
  (NEW, ~150 LOC): assembly file. Required: genome_id, fasta, fai,
  species_composition[]. Carries per-chromosome metadata with
  `subgenome_of` for hybrid assemblies, optional annotation
  pointers (gff, repeat_masker, edta, busco). _constraints block
  documents 3 engine-validated invariants. Two examples: pure
  species assembly and hybrid assembly.

- `toolkit_registries/schemas/registry_schemas/cohort.config.schema.json`
  (NEW, ~210 LOC): BAM list × genome × metadata. Required:
  cohort_id, genome_id, samples_tsv, species_composition.
  parent_cohort_ids[] for lineage. derivation field:
  primary | subset | combine. _constraints block documents 6
  engine-validated invariants including the full combine rule.
  Four examples: primary pure cohort, subset cohort, combined
  cohort, hybrid cohort.

- `toolkit_registries/schemas/registry_schemas/sample_master.schema.json`
  (NEW, ~125 LOC): per-sample TSV row contract. Required:
  sample_id, species, bam. Recommended: origin, phenotype,
  family_id, sex. Optional: father_id, mother_id, collection_date,
  tissue, coverage, qc_status, qc_notes. additionalProperties
  allowed for project-specific columns (morphology_score,
  farmer_id, breeding_program, etc.). Two examples: pure_gariepinus
  row and f1_hybrid row.

- `toolkit_registries/schemas/registry_schemas/group_definition.schema.json`
  (NEW, ~190 LOC): analytical subset of one cohort. Required:
  group_id, cohort_id, members, dimension, status. Members can be
  inline list, members file path, or 'ALL'. Dimensions enum:
  trivial, karyotype, karyotype_subcluster, ancestry, family,
  phenotype, origin, intersect, manual, qc. parent_group_id for
  group-of-group. supersedes for append-only redefinition.
  _constraints block documents 6 engine-validated invariants.
  Five examples: trivial_all_group, karyotype_group,
  karyotype_subcluster, ancestry_cluster, intersect_group.

- `toolkit_registries/schemas/registry_schemas/sample_group.schema.json`
  (FLAGGED): title and description updated to mark this as the
  LANTA TSV-row form, superseded by group_definition.schema.json.
  Schema kept for back-compat with TSV-row callers. New code: write
  group_definition.json files under
  `data/cohorts/{cohort_id}/groups/{group_id}.json`.

- `toolkit_registries/README.md`:
  - Reading order updated: HIERARCHY_SPEC promoted to first entry.
  - "What's here" table: HIERARCHY_SPEC added.
  - registry_schemas/ breakdown table: 10 schemas listed with their
    role in the hierarchy.

**Verified:**
- 51 schemas valid JSON (was 47 before this pass; +4 net: cohort.config,
  sample_master, group_definition, genome.config; species.config v1
  replaced by species.config v2 in place).
- 9/9 engine files pass `node --check` (no engine code changed).
- 43/43 test assertions still pass.
- master_config.example.yaml + species.example.yaml still valid YAML.

**Did NOT touch this round (deliberate scope):**
- `master_config.example.yaml`: still uses `species_scoped` flag from
  the previous pass. The schemas above are written so that next
  session can refactor master_config onto cohort_scoped /
  genome_scoped / flat, but doing it now would risk mid-session
  breakage (option 3 hybrid: spec + schemas only).
- DATABASE_DESIGN.md: Multi-species section from previous pass still
  describes the flat species_id model. Refactor lands when local_pca_dosage
  migration touches a cohort/genome-aware layer; HIERARCHY_SPEC
  documents the future state in the meantime.
- core/registry_core.js: doesn't know about {cohort_id} or {genome_id}
  template slots yet. Refactor lands when local_pca_dosage migration touches a
  scoped layer.
- inversion-atlas: no edits this round.

**Three open decisions deferred to next session (local_pca_dosage migration):**

1. **Active-cohort resolution.** The atlas needs to know which cohort
   is currently active (so {cohort_id} resolves correctly). Options:
   (a) `master_config.atlas.active_cohort` field, (b) a UI-level
   selector that writes to `state.shared.activeCohort`, (c) URL
   parameter. Punt to the page that first needs it.

2. **`species_scoped` migration.** When does the existing flag get
   replaced by `cohort_scoped` / `genome_scoped`? Per-page basis,
   when a layer entry needs the new scoping. The existing
   master_config keeps working until then.

3. **sample_group.schema.json removal.** Once group_definition is
   the only form anyone writes, the old schema can be removed.
   Plan a single audit pass at the end of local_pca_dosage migration to verify
   no callers remain.

**State of toolkit_registries after fifth pass (chat ~34):**
- 5 top-level docs (HIERARCHY_SPEC, README, MASTER_CONFIG,
  DATABASE_DESIGN, SPEC_DEFERRED), all current and consistent.
- 10 registry schemas (5 hierarchy + 5 existing including
  back-compat sample_group).
- 41 structured-block schemas + BK_KEYS + INDEX.
- 3 deeper specs in schemas/specs/.
- Combine rule, hybrid case, subset semantics all formally
  documented and schema-validated.
- The toolkit can absorb bighead catfish (or any new species),
  re-assembled genomes, derived cohorts, and arbitrary group
  definitions without code changes, schema additions, or doc
  rewrites.

The "registry as bottleneck" problem Quentin flagged is genuinely
addressed: the model is small (5 schemas), composable (FK chain
threads everything), and has explicit safety nets (combine rule,
append-only groups, integrity_check contract).

**Ready for:** local_pca_dosage migration round 3, with the hierarchy schemas
in hand. When a page needs cohort-aware data resolution, the schema
is there; when a page needs genome-aware coordinates, the schema is
there; when a page wants to define a new group from a clustering
analysis, the schema is there.

---



**Context:**
Quentin: "we will have bighead catfish next, every folder will be
duplicated... the strategy is that it can work for any species."
The atlas needs to absorb species 2 without redesign — both species
already implied (gariepinus active, macrocephalus coming). Population
substructure is currently unresolved (mixed hatchery) but should be
addable later without invalidating prior results.

**Audited:**
- `master_config.example.yaml` (~225 LOC): 14 roots, 1 implicit
  species (gariepinus referenced via reference filenames), no
  per-species machinery.
- `master_config.schema.json`: required `atlas` + `roots`, no species.
- DATABASE_DESIGN.md: 4-role discussion is species-agnostic in spirit
  but doesn't say so anywhere.
- MASTER_CONFIG.md: same gap.

**Designed (with Quentin's pushback to keep it minimal):**

- **Q1 (multi-species in master_config):** option 1 (per-species
  subtree under each root via `{species_id}` slot) + option 4 (flat
  shared roots for candidates/working_dir/cache/comparative,
  species_id is a field inside the data) — combined.
- **Q2 (provenance table):** Quentin pushed back on building an
  infinite system; deferred. species_id + run_id + timestamp give
  enough provenance for now.
- **Q3 (drop-in manifest):** deferred for the same reason.

**New work:**

- `toolkit_registries/schemas/registry_schemas/species.config.schema.json`
  (NEW, ~150 LOC): per-species identity. Required: species_id, label,
  cohort. Optional: scientific_name, ncbi_taxid, populations[],
  reference, scoped_roots. Populations declared append-only:
  initial state is one entry (`mixed`, members `ALL`) when
  substructure is unresolved; resolving later appends new entries
  rather than overwriting.
- `atlas-core/species.example.yaml` (NEW, ~120 LOC): two filled
  species blocks — gariepinus active (226-sample hatchery cohort,
  fClaHyb_Gar_LG.fa reference, mixed population placeholder) and
  macrocephalus commented-out (placeholder for the future cohort).
  Closing notes section explicitly calls out 5 things the design
  does NOT support (mixed-species cohorts, species inference, etc.)
  to prevent rabbit-hole expansion.
- `master_config.example.yaml`:
  - New `species:` top-level array with one entry (gariepinus
    active=true) and a commented-out macrocephalus stub.
  - 8 roots converted to `species_scoped: true` with `{species_id}`
    in their paths: precomp, cohort, cohort_relatedness,
    cohort_ancestry, cohort_dosage, beagle, bams, reference.
  - 6 roots stay flat (NOT species-scoped): candidates,
    arrangement_calls, comparative, review_sessions, working_dir,
    cache. species_id lives inside the data files for these.
  - Updated descriptions to explain why each root is or isn't
    species-scoped.
- `master_config.schema.json`:
  - New top-level `species` array (each entry: `id`, `config`, `active`).
  - New `species_scoped: boolean` property on `root_entry`.
- `MASTER_CONFIG.md`:
  - New §"Multi-species support" section with the 5-point pattern,
    plug-and-play story for adding species 2, and explicit "what
    this does NOT do" list.
  - Updated top-level table: 5 → 6 sections (added species).
- `DATABASE_DESIGN.md`:
  - New §"Multi-species — one registry, many species" section
    inserted between FK discussion and group versioning. Covers how
    species_id appears in each of the 4 roles, where species_id
    comes from (path slot for species_scoped roots vs field inside
    data for shared roots), population substructure as append-only,
    and the same explicit "what this does NOT support" list.
- `toolkit_registries/README.md`:
  - Schema count updated 5 → 6 in the inventory table.

**Verified:**
- 9/9 engine files pass `node --check`.
- 43/43 test assertions still pass (no engine code changes this pass).
- 47 schemas valid JSON (was 46; +species.config.schema.json).
- Both YAML examples (master_config + species) valid.

**Did NOT touch this round:**
- The 41 structured-block schemas — still kept as draft.
- `core/registry_core.js` — `_fillTemplate` doesn't know about
  `{species_id}` yet. Refactor lands when local_pca_dosage migration touches
  a species_scoped layer.
- inversion-atlas registry — no edits this round.

**State after this pass:**
The master config is now genuinely species-agnostic. Adding species 2:
1. Drop a `species/macrocephalus.config.yaml`.
2. Append one entry to `master_config.species`.
3. Drop data into `data/macrocephalus/...` matching the species_scoped
   root patterns.
4. (Maybe) flip `active: true` on macrocephalus when ready to focus.

No layer entries change. No registry code change. No schema change.
This is the "plug-and-play for species 2" Quentin asked for —
codified before species 2 lands rather than after.

The toolkit_registries upgrade is now done in scope:
- Path-free atlas code (master_config codifies where data lives).
- Multi-species first-class.
- Population substructure append-only.
- 4-role organizing logic preserved as method namespaces.
- 0 LANTA-only loaders, tests, or wrong-framing docs.

**Open for next session:**
Page1 migration round 3, as planned. The registry can now absorb the
realities of the next 12 months (bighead catfish, resolved
populations, cross-species comparative analyses) without architecture
changes. Page migration drives layer-by-layer refactor onto the
master_config root model when each page actually needs it.

---



**Context:**
After landing master_config v1, Quentin asked to keep upgrading
toolkit_registries — work through the body of the inherited LANTA
docs section by section, not just the headers. Goal: every doc in
toolkit_registries either reflects current atlas-registry contracts
or is clearly framed as illustrative LANTA context.

**Audited:**
- `DATABASE_DESIGN.md` 870 LOC — section by section. 14 sections,
  most of the body content (group versioning, manifest schema, file
  naming, FK discipline, sample-group naming, segment carriers,
  flat-filesystem-tree-on-demand, "where TSVs live") is canonical
  scientific content; only 3 sections were LANTA-API-specific.
- `SPEC_DEFERRED.md` 380 LOC — 6 numbered specs. Each has a Status
  block written for the LANTA pipeline.
- `schemas/specs/` — 3 deeper specs (`INVERSION_REGISTRY_SPECIFICATION_v2.md`,
  `STRUCTURED_BLOCK_SCHEMAS.md`, `CHARACTERIZATION_CONVERGENCE_RULES.md`).
  Grep-checked for LANTA-API contamination.
- `schemas/structured_block_schemas/BK_KEYS_EXPLAINED.md` — references
  `reg$evidence$write_block()` in the intro; rest is per-key biology.

**Found:**
- DATABASE_DESIGN had 3 sections that were 100% LANTA-API: §"The query
  plane (`reg$ask()`)", §"Integrity check", §"Three-language bindings",
  plus a §"Migration notes (chat-15 → chat-16)" that was pure
  archaeology.
- DATABASE_DESIGN had ~5 sections with R-API code embedded in
  otherwise-canonical content: §"Sample group naming convention",
  §"Per-candidate folder layout", §"Where TSVs live", §"Why this is
  different from chat-15's stats_cache". The *content* was right,
  the *call shapes* were wrong.
- SPEC_DEFERRED's 6 specs had LANTA-pipeline Status blocks (R script
  names, SLURM blockers, "chat-17 dependency"). The scientific
  content underneath was still valid.
- The 3 specs in `schemas/specs/` are clean — pure scientific
  contracts, no API contamination. Zero edits needed.
- `BK_KEYS_EXPLAINED.md` had one R-API reference in the intro, rest
  is per-key biology.
- `data/sample_registry/backups/.gitkeep` and
  `data/sample_registry/groups/.gitkeep` — LANTA-era empty stubs;
  obsolete since master_config replaces the on-disk-tables concept.

**New work:**
- DATABASE_DESIGN — replaced 3 sections wholesale:
  - §"The query plane" — now describes the JS API in three layers:
    low-level `resolve()` / `write()` (today), mid-level 4-role
    namespaces `registry.samples.X()` etc. (forthcoming, lands
    per-page), high-level `registry.ask()` query operator (future).
  - §"Integrity check" — reframed as a 7-step contract the JS
    registry will implement (vs a `reg$integrity_check()` R command).
  - §"Bindings — JavaScript only" — replaced the three-language
    binding table; one binding now: `atlas-core/core/registry_core.js`.
- DATABASE_DESIGN — deleted §"Migration notes (chat-15 → chat-16)"
  outright (pure archaeology, atlas migration is the relevant frame
  now, not chat-15→16).
- DATABASE_DESIGN — added scoped banners to 3 sections that retain
  R-API illustrative code:
  - §"Sample group naming convention": one-paragraph banner noting
    R syntax is illustrative; in atlas, write via
    `registry.write('cohort_sample_groups', ...)` or the 4-role
    facade `registry.samples.addGroup(...)` once it lands.
  - §"Per-candidate folder layout": banner clarifying the flat-with-
    tree-on-demand principle survives in `data/candidates/{cid}/`
    and the atlas adds versioning on top via `lineage.json` +
    `{version_id}/` subfolders. Updated the example tree to show
    the lineage + version layout.
  - §"Where TSVs live": replaced the section header's intro with a
    redirect to MASTER_CONFIG.md and a clarification that the
    LANTA paths below are one valid deployment of the categories
    that master_config now formalizes.
- DATABASE_DESIGN — rewrote §"Why this is different from chat-15's
  stats_cache" closing to acknowledge the atlas-registry inheritance
  and add the server-cache extension (cache root = ephemeral tier of
  the `results` role).
- SPEC_DEFERRED — rewrote each of the 6 numbered specs' Status blocks
  in atlas-registry terms. The bodies are unchanged (scientific
  contracts stand; readers translate the R CLI flags themselves).
- BK_KEYS_EXPLAINED — added a banner mapping `reg$evidence$write_block(...)`
  to `registry.write('candidate_<aspect>', { candidate_id, version_id }, payload)`.

**Deletions:**
- `toolkit_registries/data/` — both `.gitkeep` stubs and the
  enclosing directory tree. Master config replaces the
  on-disk-tables-here concept entirely.

**README.md refresh:**
- Updated the "What's here" table: removed the obsolete `data/` row,
  marked DATABASE_DESIGN and SPEC_DEFERRED with their refresh notes,
  added an explicit row for `schemas/specs/` (3 deeper specs).

**Verified:**
- 9/9 engine files pass `node --check`.
- 43/43 test assertions still pass (engine code untouched).
- 46 schemas valid JSON.
- master_config example valid YAML.
- 0 cross-doc contradictions: no doc references the deleted loaders,
  no doc claims data lives in toolkit_registries/data/, no doc claims
  the registry exposes R/Python/bash bindings.

**Did NOT touch this round:**
- The 3 specs in `schemas/specs/` (`INVERSION_REGISTRY_SPECIFICATION_v2.md`,
  `STRUCTURED_BLOCK_SCHEMAS.md`, `CHARACTERIZATION_CONVERGENCE_RULES.md`)
  — already clean.
- The 41 structured-block schemas — kept as draft, polished per-page.
- The 5 registry_schemas (`sample_group`, `candidate_interval`,
  `evidence_key`, `result_row`, `master_config`) — they're contract
  schemas, audit per-need.
- Engine code — no path changes required this round.
- inversion-atlas — no edits this round.

**State of toolkit_registries after three passes (chat ~34):**
- 4 top-level docs: README, MASTER_CONFIG, DATABASE_DESIGN, SPEC_DEFERRED.
  All current, internally consistent, correctly framed.
- 5 registry_schemas + 41 structured_block_schemas + 4 spec/explainer
  docs in schemas/.
- 0 LANTA-only loaders or tests.
- 0 LANTA-data-folder stubs.
- 0 wrong-framing docs.

The librarian is ready. Page1 migration can begin in a fresh chat or
this same session — whatever the next message says.

---



**Context:**
After landing registry v2 plumbing earlier this session (Registry.write,
versioning, persist hook), Quentin clarified the architecture I had
been building toward was wrong. There aren't "two registries" — there's
ONE atlas registry that absorbs the LANTA-era toolkit's organizing
logic (4 roles: samples / intervals / evidence / results) and exposes
it as method namespaces. Data lives wherever a master config says it
lives — the registry is path-free.

**Audited:**
- All `*.md` files across atlas-core (10 docs) and toolkit_registries
  (4 top-level docs + 4 spec docs).
- The R / Python / bash loaders under `toolkit_registries/api/`
  (1054 + 3136 + 309 + 181 = ~4700 LOC of LANTA-pipeline code).
- The R / Python tests under `toolkit_registries/tests/` (~800 LOC).
- `atlas-core/docs/TWO_REGISTRIES.md` — codified the wrong "they're
  separate, we keep both" framing.

**Found:**
- `HOW_TO_USE.md` — written for `source("utils/registry_bridge.R")`
  inside the LANTA pipeline tree. The bridge file isn't even in this
  package. Dead doc.
- `API_CHEATSHEET.md` — opens with "the THREE registries" then lists
  four. Header out of date with body. Documents an R / Python API
  that no longer exists.
- `DATABASE_DESIGN.md` — accurate and canonical; described as "single
  source of truth for the registry system" and is.
- `SPEC_DEFERRED.md` — chat-16 forward-looking spec with R API
  examples (`reg$compute$X`); items are still scientifically valid
  but the API surface is gone.
- `TWO_REGISTRIES.md` — documents the architecture I was building
  toward, which Quentin then said was wrong (not "two registries
  layered together," ONE registry absorbing the LANTA logic).
- 41 structured-block schemas under
  `schemas/structured_block_schemas/` — draft, but the right shape;
  worth keeping as canonical-but-draft, polish per-page during
  migration.
- The 4-role mental model itself (`sample / interval / evidence /
  results`) is sound and survives intact — it just becomes method
  namespaces rather than directory names.

**New work:**
- `atlas-core/master_config.example.yaml` (NEW, 14 roots, 4 engines,
  5 top-level sections):
  - `atlas:` workspace identity (workspace_root, active_atlas, active_chrom)
  - `roots:` — 14 named root directories with role + writable +
    ephemeral flags. Three categories: read-only data roots (precomp,
    cohort_*, beagle, bams, reference, candidates, comparative, etc.),
    persistent working_dir, ephemeral cache (default `/mnt/e/inversion-atlas-cache/`).
  - `server:` — popstats_server.py settings folded in (bind, CORS,
    validation, popstats_cache, dosage). Replaces the old standalone
    `popstats_server.config.example.yaml` shape.
  - `engines:` — 4 binary paths (region_popstats, hobs_windower,
    angsd_patched, instant_q); null disables.
  - `defaults:` — popstats / hobs / angsd parameter defaults.
- `toolkit_registries/schemas/registry_schemas/master_config.schema.json`
  (NEW, ~150 LOC): JSON Schema for the master config. Required fields
  are `atlas` + `roots`; everything else is optional. Validated at
  engine startup.
- `toolkit_registries/MASTER_CONFIG.md` (NEW, ~280 LOC): the contract
  doc explaining the master config, file discovery, the three root
  categories (read-only / working_dir / cache), the 4-role mapping,
  variable substitution, validation, "adding a new data domain"
  walkthrough, "adding a new computer" walkthrough.
- `toolkit_registries/README.md` (NEW, ~80 LOC): orientation doc.
  Says toolkit_registries is the *librarian* (method specs, canonical
  schemas, 4-role logic), not data, not code. Reading order, what
  this folder does NOT contain, naming clarification.

**Rewrites:**
- `toolkit_registries/DATABASE_DESIGN.md` — intro and "four tables"
  section rewritten. The 4-role model is now framed as **method
  namespaces** the atlas registry exposes (or will expose, as the
  4-role facade lands during page migration). Old "four tables on
  disk" content kept as historical reference for the schemas. The
  rest of the doc (FK discipline, integrity contract, schemas) stays
  unchanged because it's still correct.
- `toolkit_registries/SPEC_DEFERRED.md` — added a status header at
  top: LANTA-era reference, R API examples are illustrative only;
  treat input/output contracts as authoritative for the algorithm
  but the call shape becomes registry.resolve()/write().

**Deletions:**
- `toolkit_registries/api/R/registry_loader.R` (3136 LOC, dead)
- `toolkit_registries/api/R/sample_registry.R` (309 LOC, dead)
- `toolkit_registries/api/python/registry_loader.py` (1054 LOC, dead)
- `toolkit_registries/api/bash/registry_loader.sh` (181 LOC, dead)
- `toolkit_registries/tests/test_interval_registry_extensions.R`
- `toolkit_registries/tests/test_results_registry.py`
- `toolkit_registries/tests/test_sample_registry_extensions.R`
- `toolkit_registries/HOW_TO_USE.md` (LANTA-only context)
- `toolkit_registries/API_CHEATSHEET.md` (LANTA-only API)
- `atlas-core/docs/TWO_REGISTRIES.md` (wrong framing)

Total deleted: ~5500 LOC of code + ~640 LOC of docs that documented
a runtime that no longer applies.

**Verified:**
- 9/9 engine files pass `node --check`.
- 43/43 test assertions still pass (engine code unchanged this round).
- All 47 schemas (5 registry + 41 structured-block + 1 master_config)
  parse as valid JSON.
- master_config.example.yaml parses as valid YAML.

**Did NOT touch this round:**
- Engine code (`atlas-core/core/*.js`) — works fine, no path changes
  required. The root-aware `_fillTemplate` refactor is deferred
  until local_pca_dosage migration drives a need.
- Layer entries in `inversion-atlas/registries/data/layers.registry.json`
  — paths still hardcoded. Per Quentin's discipline: refactor
  per-page, not all-at-once.
- `popstats_server.py` — still reads its own config. The server's
  `--master-config` parsing flag is a future task; for now it stays
  on the legacy `--config` path.
- 41 draft structured-block schemas — kept as-is, polished per-page
  during migration.

**Open for next session (local_pca_dosage migration round 3):**
The setup is now genuinely ready:
- Engine: write path + versioning + persist + tests.
- Registry config: 45 layers, 8 operations, schemas in place.
- Server: path allowlist, cache rewrite, version_id-aware paths.
- Master config: contract for path-free atlas code, ready to drive
  the per-layer refactor as local_pca_dosage stubs get migrated.
- Documentation: cleaned, accurate, no contradictions.

Per Quentin's plan: "we get a working registry and server then we go
back to merging page 1 or bringing it from legacy to the inversion
atlas. Resolve all TODOs and we upgrade our registry little by little
based on the needs of the page."

Page1 migration is the next focus. Each migrated stub either:
1. Uses an existing layer (most common), OR
2. Surfaces a real registry gap → add layer + schema + (if needed)
   add a new root to master_config.yaml, OR
3. Shows a layer is unused → delete it, audit-first.

No speculative additions. The discipline is: page needs it → add it.

---



**Audited:**
- Re-confirmed engine state from `FINAL_AUDIT_AND_HANDOFF.md`: 9 core
  files green, 20/20 existing test assertions passing.
- Layer registry: 44 real layers, 8 operations cross-referenced to real
  popstats_server.py routes — confirmed unchanged from chat ~33.
- Per-candidate path templates: 11 candidate-scoped layers identified;
  none had `{version_id}` in the path → versioning was Priority 1 in the
  handoff.
- Server `_safe_project_path` and `POST /file/{path}` handler — found
  the real attack surface for the write path.

**Found:**
- Engine ready, registry ready in shape, server `/file/{path}` write
  endpoint present but with no allowlist (any path under PROJECT_ROOT
  was writable).
- Operation results never persisted: every `resolve()` on
  `popstats_groupwise` etc. recomputed on the server every time.
- 7 candidate layers (boundaries / gene_cargo / sv_counts /
  marker_primers / breeding_card / final_class / arrangement_calls)
  needed `{version_id}` in their paths; the legacy
  `data/candidates/{cid}/<aspect>.json` would silently overwrite
  v1 when v2 was computed.

**Decisions taken (with Quentin in this chat):**
- No fallback default for `version_id` — versioning is mandatory; call
  sites without it throw a clear error before any fetch. (Legacy test
  data without version subfolders is disposable.)
- Server compute results persist to disk via Registry-side write hook.
- Server results live OUTSIDE the project tree, on
  `/mnt/e/inversion-atlas-cache/server_results/` by default,
  configurable per site, so test runs don't bloat tarballs.
- Per-layer opt-in (`persist: true`) — not every operation deserves
  persistence; cheap pings stay in-memory.
- Cache layout `content_addressed` by default (op_id + stableHashHex of
  args); `path_template` available as opt-in.

**New work:**
- ENGINE — `core/registry_core.js` 362 → 599 LOC:
  - `Registry.write(layer, args, payload)` — ~80 LOC, validates
    writable + source + path + payload, surfaces version_id requirement
    explicitly, POSTs to `/file/{path}`, refreshes the read-side cache.
  - `_persistOperationResult(...)` — fire-and-forget hook called from
    `_fetchFromSource` when `entry.persist === true`.
  - `_buildPersistPath(...)` — content-addressed path builder.
  - `version_id` requirement check on file-source layers whose path
    contains both `{candidate_id}` and `{version_id}`. Throws BEFORE
    `templateFill` so the error names the missing slot specifically.
  - `stableHashHex(value)` + `stableStringify(value)` — exported
    helpers for content-addressed cache paths and tests.
  - `serverBaseUrl` and `_serverResultsCachePrefix` on the Registry
    instance.
- ENGINE — `core/registry_core.schema.json`: extended `layer_entry`
  with `writable`, `persist`, `cache_layout` (default `content_addressed`).
- ENGINE — `tests/test_registry_write_and_versioning.js` (NEW, 23
  assertions): stableStringify/Hash determinism (8), Registry.write
  pre-flight (6), version_id requirement on resolve (3), persist path
  layouts (6).
- REGISTRY — `layers.registry.json`:
  - Added `candidate_lineage` layer (warm, file, writable, schema
    `candidate_lineage.schema.json`, NOT version-scoped: one
    lineage.json per candidate regardless of versions).
  - Inserted `{version_id}` into 7 path templates (candidate_boundaries,
    candidate_gene_cargo, candidate_sv_counts, candidate_marker_primers,
    candidate_breeding_card, candidate_final_class, arrangement_calls).
  - Added `writable: true` on those 7 + `candidate_lineage` (8 total).
  - Added `persist: true` on 5 expensive operation layers
    (fst_dxy_thetapi_groupwise, hobs_groupwise, ancestry_q_groupwise,
    ld_split_heatmap_layer, shelf_ld_test_layer); left `dosage_*` and
    `health` non-persisted on purpose.
  - Updated `_doc` with v2 change summary.
  - Layer count: 44 → 45.
- REGISTRY — `files.registry.json`:
  - Restructured `candidate_dir` for versioning (split
    expected_files into `_per_candidate` and `_per_version`).
  - Added new `server_results_cache` scope for the persist target.
  - Updated `arrangement_calls_session` to be per-candidate /
    per-version with writable: true.
- REGISTRY — `candidate_lineage.schema.json` (NEW): 220 LOC schema for
  the version-index file, with two worked examples (minimal,
  after_refinement).
- REGISTRY — `operations.registry.json`: documented the persist
  contract in `_persist_contract_v2`.
- SERVER — `popstats_server.py` 2109 → 2260 LOC:
  - New `_is_path_allowed_for_write(rel)` enforcing 5 canonical write
    prefixes (data/candidates/lineage, data/candidates/version-scoped,
    data/arrangement_calls/version-scoped, data/review/sessions, and
    _cache/server_results/op_id/hash.json).
  - New `_resolve_write_target(rel)` rewriting `_cache/server_results/*`
    paths to the configured filesystem root.
  - `POST /file/{path}` now calls allowlist first, returns 403 with a
    helpful message listing permitted prefixes if rejected.
  - `GET /file/{path}` rewrites the `_cache/server_results/*` prefix
    too so persist reads work.
  - New `SERVER_RESULTS_CACHE_ROOT: Optional[Path]` global, set in
    `_bootstrap` from the new YAML key, default
    `/mnt/e/inversion-atlas-cache/server_results/`.
- SERVER — `popstats_server.config.example.yaml`: documented the new
  `server_results_cache_root` setting (one paragraph + the YAML key).
- DOCS — `atlas-core/docs/SERVER_PERSIST_CACHE.md` (NEW, ~250 LOC):
  the full reference for the persist mechanism — when to use it, where
  results live, how to clear cache, how to tarball without bloat,
  debugging "my result is being recomputed".

**Verified:**
- `node --check` passes on all 9 engine files (engine total 1696 LOC).
- 43/43 test assertions pass: existing 20 (layer router fields,
  cache-key fields) + new 23 (write/versioning/persist).
- All 5 inversion-atlas registries valid JSON.
- popstats_server.py syntax-checks under Python 3.

**Did not touch:**
- `pages/` — page migration is the next phase. Per Quentin's plan:
  registry expands page-by-page driven by what each migrated page
  needs, not all-at-once upfront.
- The 6 ⚠ scaffolded layers (relatedness_ngsrelate etc.) — still
  pending real data files on LANTA.
- The 34 stubbed local_pca_dosage.js functions — round 3 is a separate lane.
- Any toolkit_registries — out of scope this session.

**Open for next session:**
1. Read `FINAL_AUDIT_AND_HANDOFF.md` (last session) and this entry.
2. Pick page 1 (the candidate-focus page, the big one) and start the
   page-by-page merge from `legacy/Inversion_atlas.html`.
3. Each function/feature migrated either uses an existing registry
   layer (most common), surfaces a real registry gap (then we add a
   layer with proper schema), or shows a layer is unused (then we
   delete it, audit-first).
4. Don't add registry layers speculatively. The discipline is: page
   needs it → add it. The 5 pending placeholders stay pending until
   the page that uses them is being migrated.

---



**Audited:**
- The 49 TODO_MISSING markers (47 unique names) remaining in
  `pages/discovery/local_pca_dosage.js` after round 1.
- For each name, ran a scope-check against local_pca_dosage.js: whether every
  call site is preceded by a local `const NAME = ...` in the same
  parent function (closure-scoped false positive), OR whether the
  name appears only in template literals / comments / DOM
  `el.dataset.foo` accesses (lexical false positive), OR is genuinely
  missing.
- Cross-referenced legacy line ranges in `legacy/Inversion_atlas.html`
  for the truly-missing names (so the round 3 extraction has its
  starting points).
- Confirmed that `samples`, `dataset`, `hubs`, `jittered`, `layer`
  are all lexical artefacts of template literals and DOM-property
  accesses, not unresolved identifiers.

**Findings:**
- **15 false-positive TODOs:**
  - Closure-scoped (10): `toX`, `toY`, `xOfWin`, `mbAt`, `toPx`,
    `toPy`, `_buildJumpMask`, `flushRun`, `strokeSamplePath`,
    `strokeSamplePathStyled`. Each call site is fully covered by a
    local `const X = ...` in the same parent function.
  - Lexical (5): `samples`, `dataset`, `hubs`, `jittered`, `layer`.
    All hits are template-literal text or `el.dataset.foo` property
    access — not function calls or unresolved identifiers.
- **34 truly-missing names** remain. All have legacy bodies that
  will be re-extracted in round 3.

**Action — round 2 patch to local_pca_dosage.js:**
- Replaced the 65-line `// TODO_MISSING(...)` comment block with an
  updated documentation header (categorizes false-positives by reason
  and lists the 34 still-open names with legacy line refs where known)
  + a single labeled "Stubs block" containing 34 module-level no-op
  stubs.
- Each stub returns a safe default that matches the shape consumed at
  the call site:
  - `[r,g,b]` arrays for `simColor` / `simColorPDF` / `zColorPDF`
  - CSS color strings for `_vColor` / `trackedColor` / `getSampleColor`
    / `_resolveSampleScopeColor`
  - `{x, y, signX, signY}` for `getPCRender` (call sites destructure)
  - `{mbMin, mbMax}` for `currentMbRange` (call sites read properties)
  - `null` for cluster/band lookups (call sites have `if (cl)` guards)
  - `[]` for `allSampleIdx` (call sites do `for...of`)
  - `void` for guarded renderers
- Each stub has an inline comment naming the legacy line range to
  extract from in round 3, plus a `// STUBBED: 2026-05-06 round 2.`
  marker so future rounds can grep them out.
- Verified: every stubbed name has exactly one top-level definition
  in the file (no duplicates, no collisions with existing exports).
- `node --check pages/discovery/local_pca_dosage.js` passes.
- File grew from 4513 → 4588 LOC (+75 LOC for the expanded header +
  34 single-line stubs).

**Did not change:**
- The 29 `TODO_MISSING_SLOT(state.X)` markers — those are state-slot
  registration tasks, not function-resolution tasks. Separate sweep
  recommended (recipe priority 4: complete slot extraction in
  `slots.registry.json`). Note: the previous handoff text approximated
  this as "27"; actual count is 29.
- The mount/unmount wrappers from round 1 — left as-is.
- Any other page (.js) file. Only local_pca_dosage.js was touched.
- `shared/page1_utils.js` — still has the round-1 utilities only.
  Round 3 should hoist the color helpers (`simColor`, `simColorPDF`,
  `zColorPDF`) to a new `shared/color_helpers.js` since candidate_focus will
  reuse them.
- The popstats server, engines, manifest, registries, CSS, or any
  other file in either tarball.

**Did not re-audit:**
- The 8 core JS engine files — assumed unchanged from previous round.
- The 19 MB `data/precomp/` — assumed unchanged.
- The toolkit_registries — assumed unchanged.
- The legacy 75k-line monolith content — referenced for line-range
  hints only; not re-validated.

**Open work for next chat (priority order updated):**
1. **Round 3 of local_pca_dosage**: extract real bodies for the 34 stubbed
   functions. Suggested order: hoist `simColor`, `simColorPDF`,
   `zColorPDF` to `shared/color_helpers.js` (they are small, pure,
   and candidate_focus will reuse); then extract `currentMbRange` and
   `getActiveSimScale` (state-read only, ~20 LOC each); then the
   heavier accessors (`getPCRender`, `getL2Cluster`,
   `recomputeAnchorConcord`).
2. Migrate candidate_focus (41 TODOs). Many overlap with local_pca_dosage's stubs; once
   color helpers are in `shared/`, candidate_focus just imports them.
3. The other open items from previous handoff are unchanged:
   inline `style="..."` cleanup (priority 3), slot extraction
   (priority 4), per-page CSS split (priority 5), end-to-end test
   (priority 6).

---

## 2026-05-06 (chat ~30, latest+1) — CSS extraction + per-atlas stylesheet wiring

**Audited:**
- Existing CSS in atlas-core/ and inversion-atlas/ — found NONE (zero `.css` files anywhere; styling was inline in index.html and HTML attributes only).
- Legacy `<style>` block in `legacy/Inversion_atlas.html` lines 7-4711 (4704 LOC, 448 unique selectors).
- Selector distribution: 272 page-scoped (`#pageN ...`), 158 widget-class (`.cli-*`, `.ck-*`, `#candKaryo*`, `#candList*`), 18 generic (header, body, html).
- Theme system: 3 themes (default dark, `data-theme=light`, `data-theme=academic`), full color/typography token palette in `:root`.

**Action — split the 4704 LOC of legacy CSS into a layered system:**

`atlas-core/css/`:
- `tokens.css` (101 LOC) — design tokens. `:root` + light + academic theme overrides. Verbatim from legacy 1-80, dedented, header comment added. Used by every atlas.
- `base.css` (233 LOC) — html/body reset, header chrome, generic typography, header buttons. Verbatim from legacy 81-300.
- `shell.css` (121 LOC) — NEW. Topbar (#topbar), app-root, boot overlay. Visually derived from legacy `#tabBar` styling but written for the new shell DOM. Uses tokens.

`inversion-atlas/atlases/inversion/css/`:
- `inversion.css` (4316 LOC) — bundle of everything else from legacy 415-4704. Includes #tabBar legacy styles (kept for reference), all widgets (`#candKaryoPane`, `#candListContainer`, `.cli-*`, `.ck-*`, `.cs-*`), all per-page sections (`#local_pca_dosage` through `#annotation_cockpit`), all light + academic theme overrides for those.
- `pages/` — empty directory, pre-created for the eventual per-page split (each page gets its own .css file when split).

**Wiring:**
- `atlas-core/index.html` — replaced inline `<style>` with three `<link>` tags for tokens/base/shell. Added `loadAtlasStylesheets(manifest)` helper that injects per-atlas `<link>` tags during atlas registration. Reads `manifest.stylesheets` (array of paths).
- `atlas-core/core/atlas_router.js` — added `_ensureStylesheet(href, atlas_id)` method called by `navigate()` when a page entry has a `stylesheet` field. Loads BEFORE injecting the fragment to avoid FOUC.
- `inversion-atlas/atlases/inversion/manifest.json` — added `"stylesheets": ["atlases/inversion/css/inversion.css"]` and `"css_dir": "atlases/inversion/css/"`. Added `_stylesheets_doc` explaining the future per-page split path.

**Smoke-tested in node:**
- Engine still imports cleanly with all 8 core JS files
- Hot-path proven: `setActiveChrom('LG28')` fires event → scheduler catches it → walks layers → finds chrom_data with preload_on:chrom_change → resolves inline → pins to `AtlasState.inv.tracks.LG28` via pin_to template. Page would read `state.inv.tracks.LG28` directly, no async, <1ms.

**Did not change:**
- Engine code (already complete from previous round)
- The 4316-LOC inversion.css contents — extracted verbatim, no rewriting. Future work splits it.
- Page HTML files — not converted to use external CSS yet (they have inline-style attrs from extraction). The legacy `<style>` block content is now linked, but the per-page `style="..."` attributes in the .html files remain inline. Those will be migrated as part of the page-by-page work.
- AUDIT_FIRST checklist — should be amended next chat to also list `find . -name "*.css"`.

**Open work for next chat:**
1. Continue local_pca_dosage migration (still 49 TODO_MISSINGs).
2. Test the boot path end-to-end with a real workspace assembly (rsync core + inversion, run server, open in browser).
3. Optionally: split inversion.css into per-page files and reference each from the page entries (`page.stylesheet: "atlases/inversion/css/pages/local_pca_dosage.css"`).
4. Convert inline-style attrs in HTML files to classes referencing the existing CSS where possible (213+ inline attrs in local_pca_dosage.html alone).

---

## 2026-05-06 (chat ~30, latest) — engine implementation + local_pca_dosage migration round 1

**Audited:**
- The 8 core JS files (skeletons with `throw` stubs)
- `inversion-atlas/atlases/inversion/pages/discovery/local_pca_dosage.js` (4361 LOC, 89 TODO_MISSING markers)
- TODO_MISSING distribution across all 19 page .js files (sum ~270 markers)
- Import paths in all page files (found systematic `'../shared/'` bug — should be `'../../shared/'`)

**Engine implementation (1387 LOC, all 8 files now functional):**
- `cache_store.js` (160 LOC): RAM Map + IndexedDB wrapper, LRU eviction soft-cap at 1000 entries, falls back to memory when indexedDB undefined.
- `layer_router.js` (110 LOC): fetch + format dispatch (json/tsv/csv/binary), pure `parseDelimited` helper that auto-coerces numeric columns.
- `operation_runner.js` (147 LOC): GET/POST dispatch, soft schema validation (skips `_status: pending`), error mapping with server-side detail surfaced.
- `registry_core.js` (328 LOC): full 5-method API, hot-tier sync return on cache hit, async otherwise. Conflict resolution implements the succession rule (provisional/owned_by). Analysis dispatcher does dynamic `import()`.
- `atlas_state.js`: completed persistence (savePersisted / loadPersisted) using localStorage; activeCandidate stores by ID and rehydrates from registry-resolved data.
- `atlas_router.js`: completed `_navigateFromHash` (parses `#/atlas/page` format with backward-compat for single-atlas `#/page`) and `_renderTopbar` (groups by stage, marks active).
- `prewarm_scheduler.js` (172 LOC): subscribes to 3 trigger events, walks layer registry, calls registry.resolve in parallel, AbortController-based generation cancellation, hot-tier `pin_to` writes value into AtlasState path.
- `atlas_discovery.js`: was already mostly complete; left alone.

**Smoke-tested in node:** templateFill, deepEqual, register_atlas, resolve, trace, cache hit, succession rule. All work.

**Page migration progress:**
- Created `shared/page1_utils.js` with 6 extracted utilities (escapeHtml, fitCanvas, formatTrackVal, niceTicks, themeColor, withAlpha). Each function's legacy line range documented.
- Fixed import paths in 9 page files via sed sweep.
- Appended `mount(root, atlasState, registry)` and `unmount(root)` wrappers to local_pca_dosage.js (~100 LOC). The mount: resolves `scrubber_main` for active chrom, builds legacy-shaped state, calls applyData + 6 draw functions defensively (catches throws so one broken panel doesn't break others), wires canvas event handlers.
- Resolved 7 of 89 TODOs in local_pca_dosage.js (89 → 82). Identified `drawRect` as a false-positive (closure-scoped at legacy line 35691).

**Wrote:**
- `PAGE_MIGRATION_RECIPE.md` — playbook for the next chat. Step-by-step recipe for migrating each page, anti-patterns to avoid, migration order with effort estimates, append-only migration log.

**Did not change:**
- The toolkit registries (read-only reference).
- The popstats server (working as-is).
- Any data files.
- The fast_ld engine.
- The 18 placeholder schemas.
- 17 of the 19 page files (local_pca_dosage + sweep-fix only).

**Open work (in priority order):**
1. Continue local_pca_dosage migration: 82 TODOs remaining. Next wave: extract closure-scoped helpers (toX/toY/xOfWin/mbAt for each panel) and the subpanel renderers (`_drawXxxStrip`).
2. Migrate candidate_focus (46 TODOs) — likely reuses many local_pca_dosage helpers.
3. Wire `popstats_demo` page to test the full HTTP path through `popstats_groupwise`.
4. Replace placeholder schemas with toolkit schema references.
5. Complete slot extraction in `slots.registry.json` (~60 slots remain).

**Engine is now ready to drive page mounts.** Next chat can just keep migrating. The core machinery does not need further work for v1.

---

## 2026-05-06 (later same evening) — toolkit registries recovery

**Audited:** `inversion-popgen-toolkit-main_1_.zip` (35 MB)

**Found:**
- `registries/` folder at toolkit root: 62 files, comprehensive
  4-table database system used by the manuscript pipeline.
  - 4 registry-table schemas (`registry_schemas/`) — sample, interval, evidence, results
  - 41 structured-block schemas (`structured_block_schemas/`) — one per evidence-block JSON type written by the pipeline
  - 3 language bindings: R (full API + queries + composites + live compute), Python (atomic reads + Tier-2 block writes), bash (SLURM gate-checks + path resolution)
  - Tests in R + Python
  - Key docs: `DATABASE_DESIGN.md`, `API_CHEATSHEET.md`, `HOW_TO_USE.md`, `SPEC_DEFERRED.md`
- The toolkit's registry is a **persistent file-based database** with FK discipline, group versioning, integrity checks, and a unified query plane (`reg$ask()`). It is NOT the same thing as the atlas's runtime resolver-registry.

**Action:**
- Copied the entire `registries/` folder wholesale into `atlas-core/toolkit_registries/` (per Quentin: "even if unperfect we arrange later").
- Wrote `atlas-core/docs/TWO_REGISTRIES.md` to disambiguate the toolkit-registry-as-database from the atlas-resolver-registry-as-router. They share the word "registry" but do completely different jobs and live in different places.
- Demonstrated wiring: updated `inversion-atlas/atlases/inversion/registries/data/layers.registry.json` so the `candidate_boundaries` layer's schema points at the real toolkit schema (`toolkit_registries/schemas/structured_block_schemas/boundary_refined.schema.json`) rather than the placeholder. Schema status flips from `pending` to `validated` for that one layer. The same upgrade can be done for any layer whose data file shape matches a toolkit evidence-block.

**Did not change:**
- The atlas resolver-registry's design (registry_core.js, the five JSON config files, the meta-schema). Those keep doing what they do — runtime data routing in the browser.
- The toolkit registry's API or contents. Copied verbatim.

**Open question for next chat:**
- Most placeholder schemas in `inversion-atlas/atlases/inversion/registries/schemas/` could be replaced with `../../../../toolkit_registries/schemas/structured_block_schemas/<type>.schema.json` references. Worth a sweep when validation tightening is on the agenda. Not urgent — placeholders accept any JSON, so nothing's currently broken.

---

## 2026-05-06 (late evening) — server + engine recovery

**Audited:** `Atlas_turn166_round2_2026-05-05_tar.gz` (10.5 MB upload)

**Found:**
- `Atlas/server_turn1/` — production-ready FastAPI server,
  2109 LOC main file + 987 LOC supporting modules. 12 real
  endpoints. Caching, content-addressable hashing, ANGSD patch
  support, SSH tunnel docs, integration tests.
- `Atlas/engine_fast_ld/` — 2516 LOC C + Python LD engine with
  Makefile, benchmarks, 10 tests.
- `Atlas/producers/` — SV evidence pipeline (4 Python scripts +
  shared IO module + sv_evidence subdirectory).
- `Atlas/changelogs/` — 14 changelogs through turn 127, last one
  at 62,023 LOC of legacy monolith with 762/762 tests green.
- `Atlas/specs_done/`, `specs_todo/`, `specs_new_turn131/` — spec
  inventory.

**Mistakes corrected from previous round:**
- Dropped invented `core/server/server.py` stub.
- Dropped invented `atlases/inversion/server-adapters/` directory.
- Dropped 9 invented operation names from `operations.registry.json`
  (`fst_hom1_hom2`, `theta_pi_by_invgt`, `dxy_by_invgt`,
  `coverage_extract`, `beagle_uncertainty`, `split_read_aggregate`,
  `lof_burden`, `pseudogenisation_scan`, `permutation_test`).

**Recovered into inversion-atlas:**
- `atlases/inversion/server/` — full popstats_server.py + dosage_bridge
  + ld_endpoint + lazy_windows_json + configs + tests + SERVER_README.md
- `atlases/inversion/engines/fast_ld/` — full C engine + wrapper + tests
- `atlases/inversion/engines/producers/` — full SV evidence pipeline

**Rewrote against real endpoints:**
- `operations.registry.json` — 9 operations, every endpoint
  cross-referenced to its line in `popstats_server.py`
- `layers.registry.json` §6 — replaced 9 fake operation-backed
  layers with 7 real ones (FST/dXY/θπ now share one operation,
  per how the server actually works)
- `pages.registry.json` — fixed `popstats_demo` and
  `sv_evidence` to reference real (or no) operations

**Did not re-audit:**
- The 75k-line `legacy/Inversion_atlas.html` — too large; grep on demand.
- The 19MB of `data/precomp/` — assumed unchanged from previous round.
- The page-split files in `pages/` — assumed unchanged.

---

## Template for next entries

```
## YYYY-MM-DD — short title

**Audited:** what you looked at

**Found:** what was there

**Mistakes corrected:** what previous chats got wrong

**New work:** what you added

**Did not re-audit:** what you trusted as unchanged
```
