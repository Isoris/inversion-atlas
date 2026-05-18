# Batch 1 notes

**Author**: parallel-chat-1 (inversion_discovery extraction).
**Scope**: pages 1, 2, 8, 12, 15, 19 — extracted LITERALLY from `legacy/Inversion_atlas.html`.
**Status**: 6 modules + 6 HTML fragments + 6 minimal tests shipped. All 455 baseline
shared/ tests still pass; the 6 new module-load tests add 45 checks (all green).

## What was extracted

| Page | Tab name | Stage | HTML lines | Functions extracted | Notes |
|---|---|---|---|---|---|
| local_pca_dosage  | "1 local PCA \|z\|"  | discovery  | 5474–6817 | 26 | The big one. All canonical renderers (drawSim/drawZ/drawLinesPanel/drawPCA/drawAnchorStrip/renderL3Panel + state mutators) extracted. |
| local_pca_theta_pi | "2 local PCA θπ"     | discovery  | 6831–7173 | 8  | All `_drawTh*` panel renderers + θπ status helpers. |
| local_pca_ghsl | "2b local PCA GHSL"  | discovery  | 7180–7246 | 1  | Only `_refreshGhslLayerStatus` exists in legacy; the panel renderers are not yet authored. |
| candidate_focus  | "3 candidate focus"  | discovery  | 7248–7259 | 2  | `renderCandidateMetadata` (composes ~15 sub-panels via helpers) + `wireCandidateNav`. |
| window_summary_table  | "10 windows"         | refinement | 7672–7774 | 0  | **No JS handlers in legacy yet** — pure HTML scaffold. winSumTable / winSumStripCanvas / winSumZFilter handlers will be authored fresh. |
| negative_regions | "6 negative regions" | discovery  | 7378–7571 | 0  | **No JS handlers in legacy yet** — pure HTML scaffold. nrLoadBtn / nrExportCsvBtn / nrTableSlot handlers will be authored fresh. |

## TODO_MISSING summary

### Functions referenced but not extracted

Sorted by frequency (most-referenced first). Frequency = number of pages each
function is called from. Suggested location is a heuristic — merge chat decides.

| Function | Frequency | Pages referring | Suggested location |
|---|---|---|---|
| `toX` | 2 | local_pca_dosage, local_pca_theta_pi | ?? — let merge chat decide |
| `toY` | 2 | local_pca_dosage, local_pca_theta_pi | ?? — let merge chat decide |
| `_assignCandidateLanes` | 1 | local_pca_dosage | shared/candidate_helpers.js |
| `_buildJumpMask` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_drawBandTraceStrip` | 1 | local_pca_dosage | shared/band_trace.js |
| `_drawDiamondOverlay` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_drawInheritanceLabelsStrip` | 1 | local_pca_dosage | shared/band_trace.js |
| `_drawLineageStrip` | 1 | local_pca_dosage | shared/lines_panel.js |
| `_drawRegimeBreadthStrip` | 1 | local_pca_dosage | shared/band_trace.js |
| `_drawSnpDensityShade` | 1 | local_pca_dosage | shared/density_overlays.js |
| `_drawSnpDensityStrip` | 1 | local_pca_dosage | shared/density_overlays.js |
| `_drawTrackedLinkageStrip` | 1 | local_pca_dosage | shared/tracked_panel.js |
| `_drawTransitionRateStrip` | 1 | local_pca_dosage | shared/density_overlays.js |
| `_drawWRow` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_drawWinNavLane` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_ensureCsOverlayIndex` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_navigateToCandidate` | 1 | candidate_focus | shared/candidate_helpers.js |
| `_paintCandidateBands` | 1 | local_pca_dosage | shared/candidate_helpers.js |
| `_refreshScreeInset` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_resolveSampleScopeColor` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_vColor` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_wRowBand` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_winNavBand` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `_wireCandidateBandClicks` | 1 | candidate_focus | shared/candidate_helpers.js |
| `_wireCandidateBlockChips` | 1 | candidate_focus | shared/candidate_helpers.js |
| `_wireCandidateDosageHeatmap` | 1 | candidate_focus | shared/candidate_helpers.js |
| `_wireCandidateHaplotypeAnnotations` | 1 | candidate_focus | shared/candidate_helpers.js |
| `_wireCandidateRegimeRow` | 1 | candidate_focus | shared/candidate_helpers.js |
| `addCandidateToList` | 1 | candidate_focus | shared/candidate_helpers.js |
| `allSampleIdx` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `candidateAgeOriginHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateAncestryConfoundHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateBandComposition` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateBandsHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateBlockChipsHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateDosageHeatmapHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateFromJSON` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateHaplotypeAnnotationsHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateHeaderHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateHetShapeHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateListClosestIndex` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateListIndexOf` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateListSortedByPos` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateNavHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateNotesHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateProfileHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateRegimeRowHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateRichCardHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateSigmaChartHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateSubbandHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateSummaryHtml` | 1 | candidate_focus | shared/candidate_helpers.js |
| `candidateToJSON` | 1 | candidate_focus | shared/candidate_helpers.js |
| `colorFor` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `currentMbRange` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `dataset` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `drawCandGHSLPerBand` | 1 | candidate_focus | shared/ghsl.js |
| `drawCandLinesPanel` | 1 | candidate_focus | shared/lines_panel.js |
| `drawCandLocalPCA` | 1 | candidate_focus | shared/pca_panel.js |
| `drawCandidateBar` | 1 | local_pca_dosage | shared/candidate_helpers.js |
| `drawCandidateLocationStrip` | 1 | candidate_focus | shared/candidate_helpers.js |
| `drawCandidateSigmaChart` | 1 | candidate_focus | shared/candidate_helpers.js |
| `drawRect` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `escapeHtml` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `families` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `fillFor` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `fitCanvas` | 1 | local_pca_dosage | shared/draw_utils.js |
| `flushRun` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `formatTrackVal` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `getActiveSimScale` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `getL2Cluster` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `getLinesGrid` | 1 | local_pca_dosage | shared/lines_panel.js |
| `getLinesSignAt` | 1 | local_pca_dosage | shared/lines_panel.js |
| `getLinesValuesAt` | 1 | local_pca_dosage | shared/lines_panel.js |
| `getPCRender` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `getSampleColor` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `has` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `hubs` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `jittered` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `kColor` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `layer` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `mbAt` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `niceTicks` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `palette` | 1 | local_pca_theta_pi | shared/draw_utils.js |
| `persistCandidateList` | 1 | candidate_focus | shared/candidate_helpers.js |
| `q` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `recomputeAnchorConcord` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `refreshCandidateListUI` | 1 | candidate_focus | shared/candidate_helpers.js |
| `refreshCandidateUI` | 1 | candidate_focus | shared/candidate_helpers.js |
| `renderCatalogue` | 1 | candidate_focus | ?? — let merge chat decide |
| `samples` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `showHide` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `sigmaProfileCandidate` | 1 | candidate_focus | shared/candidate_helpers.js |
| `simColor` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `simColorPDF` | 1 | local_pca_dosage | shared/draw_utils.js |
| `strokeSamplePath` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `strokeSamplePathStyled` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `themeColor` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `toPx` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `toPy` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `trackedColor` | 1 | local_pca_dosage | shared/tracked_panel.js |
| `wireCandidateAncestryConfound` | 1 | candidate_focus | shared/candidate_helpers.js |
| `wireCandidateButtons` | 1 | candidate_focus | shared/candidate_helpers.js |
| `withAlpha` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `xAt` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `xOfWin` | 1 | local_pca_dosage | ?? — let merge chat decide |
| `xToPx` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `yAt` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `yToPx` | 1 | local_pca_theta_pi | ?? — let merge chat decide |
| `zColorPDF` | 1 | local_pca_dosage | shared/draw_utils.js |

**Total unique missing functions: 109.**

Regenerate this list any time with:
```bash
grep -rh 'TODO_MISSING(' inversion_discovery/page*.js | sort | uniq -c | sort -rn
```

### State slots referenced but not in shared/state.js SLOT_REGISTRY

| Slot | Pages | Likely class |
|---|---|---|
| `state._simGeom` | local_pca_dosage, local_pca_theta_pi | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state._l3CacheFp` | local_pca_dosage | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state._l3CacheRendered` | local_pca_dosage | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state._lineageComputeScheduled` | local_pca_dosage | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state._simMinimapGeom` | local_pca_dosage | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state._thSimGeom` | local_pca_theta_pi | ad-hoc geometry / cache (legacy added imperatively at first use) |
| `state.ancestryPalette` | local_pca_dosage | ? |
| `state.cacheKey` | local_pca_dosage | transient cache |
| `state.candidateMode` | local_pca_dosage | persisted UI mode (probably needs to be registered) |
| `state.candidatePageMode` | candidate_focus | ? |
| `state.colorMode` | local_pca_dosage | persisted UI mode (probably needs to be registered) |
| `state.compareUnit` | local_pca_dosage | persisted UI mode (probably needs to be registered) |
| `state.crossSpecies` | local_pca_dosage | ? |
| `state.hubFamilies` | local_pca_dosage | ? |
| `state.l2GroupCache` | local_pca_dosage | transient cache |
| `state.l3Draft` | local_pca_dosage | ? |
| `state.l3Mode` | local_pca_dosage | ? |
| `state.l3ReclusterMode` | local_pca_dosage | ? |
| `state.l3SecondaryMetric` | local_pca_dosage | ? |
| `state.scaleStabilityPanes` | local_pca_dosage | ? |
| `state.schemaVersion` | local_pca_dosage | ? |
| `state.secondaryL2` | local_pca_dosage | ? |
| `state.simInMinimap` | local_pca_dosage | ? |
| `state.singletonFamilyIds` | local_pca_dosage | ? |
| `state.smallFamilyIds` | local_pca_dosage | ? |
| `state.trackedN` | local_pca_dosage | persisted limit (probably needs to be registered) |
| `state.windowToL1` | local_pca_dosage | ? |
| `state.windowToL2` | local_pca_dosage | ? |
| `state.zColorMode` | local_pca_dosage | ? |
| `state.zHighlightThr` | local_pca_dosage | ? |
| `state.zValueMode` | local_pca_dosage | ? |

**Total unique missing slots: 31.**

Slots prefixed with `_` (e.g. `_simGeom`, `_l3CacheFp`) are ad-hoc geometry/cache
writes the legacy added at first use; merge chat should either register them in
SLOT_REGISTRY (with `tag: 'transient'`) or refactor the writers to keep them off
the state object.

## Decisions made

- **Brace-matched function slicing.** A naïve "next function start" slicer pulled
  in inter-function IIFEs (e.g. the PCA-lasso wiring block between `onPCAClick`
  and `togglePlay`), which then ran at module-import time and threw
  `ReferenceError: document is not defined` under Node. Switched to a brace-
  counter that respects strings, template literals, and comments. Net effect:
  module bodies are tighter and TODO_MISSING dropped by ~14 in local_pca_dosage.

- **`state` as first parameter.** Every extracted function takes `state` as its
  first arg, matching the `shared/per_l2_cluster.js` `contextFromState(state)`
  pattern. Function bodies are otherwise LITERAL — no body refactoring.

- **Shared imports declared in every page header**, even when unused. ESM is
  fine with unused named imports, and it lets the merge chat add references
  without re-touching the import line.

- **Page8 + negative_regions have NO extracted JS.** Confirmed by full-file grep that
  `winSum*` and `nr*` IDs are referenced ONLY from CSS / HTML / comments in
  legacy — no `getElementById` calls, no event wiring. They are pure scaffold.
  Their renderers will be authored fresh by the merge chat or a follow-up batch.

- **Page15 has only `_refreshGhslLayerStatus`.** The page is mostly empty-state
  documentation about layers that don't yet exist; only the layer-pill badge
  has live JS.

- **Did not extract candidate_focus's ~25 helper functions** (`candidateNavHtml`, `candidateBandsHtml`,
  `sigmaProfileCandidate`, `wireCandidateButtons`, etc). Per Rule 4, these are
  flagged TODO_MISSING and left for the merge chat (most are likely reused by
  other discovery / catalogue pages and belong in `shared/candidate_helpers.js`).

## What's NOT done

- **Tab routing** (which page activates when, how state.activePage flows) —
  left for merge chat.
- **CSS** — left for merge chat. The HTML fragments still reference legacy
  CSS variables (`var(--ink)`, `var(--rule)`, etc) which assume a global
  stylesheet.
- **The 57 + slot-level TODO_MISSING references.** Some will resolve once
  batches 2–5 land; the rest need to be hoisted into `shared/` or authored
  fresh.
- **No behavioural tests.** The new tests only verify that modules load and
  exports are present. Behavioural tests need DOM + state and depend on the
  merge chat's wiring decisions.
- **Page8 and negative_regions renderers** — pure scaffold in legacy; need fresh
  authoring.
