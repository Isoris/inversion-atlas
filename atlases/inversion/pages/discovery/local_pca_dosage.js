// pages/discovery/local_pca_dosage/local_pca_dosage.js
//
// Local PCA on dosage: sim_mat heatmap, robust |Z|, per-sample lines,
// K-means PCA, L3 contingency. THE big page (per HANDOFF_BATCH_1).
//
// Round 4 (2026-05-06): split from a 6684-LOC monolith into 10 cohesive
// sub-modules under ./local_pca_dosage/. This file is the entry point the manifest
// references (`module: "local_pca_dosage.js"`); it re-exports every public name
// from the panel sub-modules and owns the mount/unmount/applyData/
// _buildLegacyState/_wireCanvasHandlers wiring with the atlas-core shell.
//
// Sub-modules:
//   ./local_pca_dosage/_state.js        — _pageState + setter, color helpers, FAMILY_*
//   ./local_pca_dosage/_data.js         — schema, indexing, PC accessors, view controls
//   ./local_pca_dosage/sim_panel.js     — drawSim, drawSimMini
//   ./local_pca_dosage/z_panel.js       — drawZ + 9 strip renderers
//   ./local_pca_dosage/lines_panel.js   — drawLinesPanel and friends
//   ./local_pca_dosage/pca_panel.js     — drawPCA, drawAnchorStrip, anchor helpers
//   ./local_pca_dosage/l3_panel.js      — renderL3Panel + slab + scaleStability
//   ./local_pca_dosage/candidates.js    — candidate lanes/bands/overlay/bar (+ stubs)
//   ./local_pca_dosage/events.js        — onSimClick/onZClick/onPCAClick/setCur/etc.
//
// applyData lives here (in main) because it's the one function that
// orchestrates everything — it calls helpers from data/, candidates/,
// events/, lines/, pca/. Keeping it in main lets the panels stay
// concern-focused and avoids a module-import cycle through the panels.

import { escapeHtml } from '../../shared/page1_utils.js';
// Side-effect import: registers window._getMacrostripeColor /
// _getMacrostripeIdPerSample so getSampleColor in _state.js can
// resolve the Phase-1 macrostripe palette without a static import
// cycle.
import '../../shared/macrostripe.js';
import { resolve as _registryResolve, getState as _getState } from '../../../../core/atlas_api.js';
import { renderModeBBadge } from '../../../../core/mode_b_badge.js';
import { buildChromSummary } from '../../../../core/chrom_summary.js';

import {
  _setActiveState,
  _linesCacheInvalidate,
  invalidateLineageCache,
  _bandTraceClearCache,
} from './local_pca_dosage/_state.js';
import { invalidateColorScales } from '../../shared/sample_color.js';
import {
  loadActiveSamples,
  refreshActiveSamplesBadge,
} from './local_pca_dosage/active_samples.js';
import { loadBandTraceState } from './local_pca_dosage/band_trace_state.js';
import {
  runL2SweepInheritance,
  invalidateL2SweepCache,
  autoPromoteFromSweep,
} from './local_pca_dosage/l2_sweep.js';
import { idbPersistChrom } from './local_pca_dosage/idb.js';
import { replayEnrichmentsFromIdb } from './local_pca_dosage/idb_restore.js';
import { buildFamilyPalette, buildIndexes, computePC1Signs, detectSchemaAndLayers, getActiveModeView, listLayers, loadViewControls, populateSimScales, rebuildIndexesFromView, reconcileViewControlsForData } from './local_pca_dosage/_data.js';
import { drawSim, drawSimMini } from './local_pca_dosage/sim_panel.js';
import { drawZ } from './local_pca_dosage/z_panel.js';
import { attachLinesLasso, buildLinesPanel, buildLinesPanelCheckboxes, drawLinesPanel, refreshLinesColorMode, setLinesPanelCandidateBands } from './local_pca_dosage/lines_panel.js';
import { autoPickRadial, cycleKAside, drawAnchorStrip, drawPCA, refreshColorModeBar, refreshLockBtn, refreshPcaAxisBar, renderManualGroupsList, renderTrackedList, togglePlay } from './local_pca_dosage/pca_panel.js';
// 2026-05-20: renderL3PanelSlab is no longer a separate public function.
// renderL3Panel dispatches internally to the slab body via its own
// state.compareUnit check, so callers only need the single entry point.
import { _l3CacheInvalidate, refreshPinUI, renderL3Panel, renderL3PanelScaleStability } from './local_pca_dosage/l3_panel.js';
import { loadCandidateList, refreshBandPickBar, refreshCandidateUI } from './local_pca_dosage/candidates.js';
import { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './local_pca_dosage/events.js';
import { attachSidebarHandlers } from './local_pca_dosage/sidebar.js';
import { attachHotkeys } from './local_pca_dosage/hotkeys.js';
import { attachPcaLasso } from './local_pca_dosage/pca_panel.js';
import { installDosageChunkFetcher, buildDosageDebugReport, resetDosageDiagnosticsForChromChange } from '../../shared/dosage_chunks.js';

// Theta-pi mirror (local_pca_theta_pi) and GHSL mirror (local_pca_ghsl) entry points. These are
// painted from local_pca_dosage's applyData() because the mirror panels share local_pca_dosage's
// data envelope (theta_pi_*, ghsl_panel) — they activate when those layers
// are present in the loaded JSON.
//
// 2026-05-26: the local_pca_theta_pi / local_pca_ghsl files used to also
// export mount/unmount + alias-wrapped renderers for a "directly mounted
// page" path that was never registered in manifest.json. That dead
// scaffolding was removed — the files now exist solely as panel-renderer
// modules consumed from this file (~257 LOC of unreachable code dropped).
import {
  _drawThAnchorStripPanel,
  _drawThCusumHero,
  _drawThLinesPanel,
  _drawThPcaPanel,
  _drawThSimMatPanel,
  _drawThZPanel,
  _refreshThetaPiLayerStatus,
  _refreshThetaPiPanelVisibility,
} from './local_pca_theta_pi.js';
import { _refreshGhslLayerStatus } from './local_pca_ghsl.js';
import { _mgRefreshOnDataLoad } from './local_pca_dosage/manual_groups.js';
import { attachPanelResize } from './local_pca_dosage/panel_resize.js';

// Re-export public entry points so the manifest's `module:` contract
// (atlas_router imports drawSim, applyData, etc. from this file) is
// preserved across the split.
export { drawSim, drawSimMini } from './local_pca_dosage/sim_panel.js';
export { drawZ } from './local_pca_dosage/z_panel.js';
export { buildLinesPanel, buildLinesPanelCheckboxes, drawLinesPanel, refreshLinesColorMode, setLinesPanelCandidateBands } from './local_pca_dosage/lines_panel.js';
export { autoPickRadial, cycleKAside, drawAnchorStrip, drawPCA, renderManualGroupsList, renderTrackedList, togglePlay } from './local_pca_dosage/pca_panel.js';
export { renderL3Panel, renderL3PanelScaleStability } from './local_pca_dosage/l3_panel.js';
export { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './local_pca_dosage/events.js';

// --- applyData() — legacy lines 54476-54690 ---
export function applyData(state, data) {
  _setActiveState(state);
  // Cross-chrom safety: candidate from a different chromosome is meaningless.
  // Clear it before swapping data so refreshes downstream see no stale state.
  if (state.candidate && state.candidate.chrom !== data.chrom) {
    state.candidate = null;
  }
  // Install the synthetic dosage_chunks bridge (atlas-side <-> server's
  // /api/dosage/chunk). The precomp atlas JSON does not carry dosage
  // (it would bloat the file with per-sample × per-site int8 matrices);
  // instead the server streams chunks per-region from the dosage TSVs in
  // master_config.roots.cohort_dosage (currently 02_dosage_sites/). We
  // attach a single-chunk index here with a templated URL so detectSchemaAndLayers
  // marks dosage_chunks as present, which unlocks the lines-panel
  // "color: dosage" and "color: het" modes plus the per-L2 het-rate
  // compute. Actual fetches are lazy — _fetchAndCacheChunk substitutes
  // __START__/__END__/__CAP__ at the moment the user requests data for
  // a window. See dosage_bridge.py for the server-side contract.
  _installSyntheticDosageChunks(data);
  // Schema detection (v3.20). state.layersPresent is the source of truth
  // for conditional UI rendering across the rest of the scrubber.
  // 2026-05-06 round 3: detectSchemaAndLayers extracted from legacy
  // (lines 52835-53039). The function is pure on `data`, so no state arg.
  const det = detectSchemaAndLayers(data);
  state.schemaVersion = det.schemaVersion;
  state.layersPresent = det.layers;
  console.log(`[scrubber] loaded ${data.chrom} · schema v${det.schemaVersion} · layers: [${Array.from(det.layers).sort().join(', ')}]`);
  state.data = data;
  // turn 130 Slice 2: lineage compute is per-chromosome (the concordance
  // matrix and lineage labels only mean something within one chrom). When
  // data swaps, drop the cached result so the next paint re-triggers
  // compute on the new chromosome's L2 inventory.
  invalidateLineageCache(state);
  // 2026-05-19: drop the per-mode color-scale cache (min/max for
  // theta_pi / ghsl / froh ramps). The cache keys on (mode, cur) so a
  // chrom swap means every entry is stale.
  invalidateColorScales(state);
  // turn 161: clear the band-trace cache (per-chromosome, per-fish-set)
  // and re-hydrate the on/off toggle + fish-set from localStorage. The
  // fish-set is cohort-wide so it survives chrom changes, but the
  // compute cache is per-chrom.
  _bandTraceClearCache(state);
  // 2026-05-26: clear dosage-side caches + one-shot diagnostic flags so
  // the user gets a fresh shape-validation / sample-id-match log on the
  // new chrom, and the bp-range-keyed het/dosage_mean caches don't alias
  // to stale values from the previous chrom. The chunk LRU itself is
  // intentionally kept — its keys are chrom-prefixed and the
  // covering-fallback filters by chrom, so chunks from a previously-
  // visited chrom stay available if the user navigates back.
  resetDosageDiagnosticsForChromChange(state);
  loadBandTraceState(state);
  state.bandTraceFishSet = null;
  state._lineageComputeScheduled = false;
  // v3.99 turn 14e: if simInMinimap was restored from localStorage at
  // startup but the visual .active class was held back (because data
  // wasn't loaded yet), reconcile now that data has landed.
  if (typeof _reapplyMinimapActiveOnDataLoad === 'function') {
    _reapplyMinimapActiveOnDataLoad();
  }
  // v3.99 t14e+ continue: refresh page 12 (θπ scrubber) layer-status
  // indicators in the empty-state. Each row's status flips from ⚪ to 🟢
  // when that layer is detected. Try/catch is kept because the mirror DOM
  // (theta-pi / GHSL panel hosts) may not be present under the new shell
  // when only local_pca_dosage is mounted; the renders bail safely.
  try { _refreshThetaPiLayerStatus(state); } catch (_) {}
  // v4 turn 132 Slice 2: also flip panel visibility — empty-state hides
  // and per-layer panels reveal as their required layers arrive.
  try { _refreshThetaPiPanelVisibility(state); } catch (_) {}
  // v4 turn 132 Slice 3: paint the CUSUM hero panel from cusum_theta if
  // present. Visibility wiring above already revealed/hid the panel; this
  // draws into its canvases. Other renderers (sim_mat, |Z|, lines, PCA,
  // L3) ship in later slices.
  try { _drawThCusumHero(state); } catch (_) {}
  // v4 turn 132 Slice 5: paint the per-sample θπ lines panel from
  // theta_pi_per_window if present. Single-source (no PC1/PC2/GHSL/het
  // stacking like page 1), no lasso, no caching — minimum viable mirror.
  try { _drawThLinesPanel(state); } catch (_) {}
  // v4 turn 132 Slice 6a/6b: paint sim_mat heatmap + |Z| waveform from
  // theta_pi_local_pca if present. Mirrors page 1's drawSim/drawZ
  // minimum-viable subset — no L1/L2 overlays (need theta_pi_envelopes),
  // no click-to-jump, no PDF-style triangle split.
  try { _drawThSimMatPanel(state); } catch (_) {}
  try { _drawThZPanel(state); } catch (_) {}
  // v4 turn 132 Slice 7a/7b: paint envelope anchor strip + PC1×PC2 scatter
  // from theta_pi_envelopes / theta_pi_local_pca.
  try { _drawThAnchorStripPanel(state); } catch (_) {}
  try { _drawThPcaPanel(state); } catch (_) {}
  try { _refreshGhslLayerStatus(state); } catch (_) {}
  // Load saved candidate list for this chromosome from localStorage.
  // Each chromosome has its own list (cross-chrom labels are meaningless).
  try { loadCandidateList(state); } catch (_) {}
  // turn 133 Slice 1 follow-up: chrom-load hook for L2-sweep.
  // Cache key is chrom-prefixed so the previous chrom's result wouldn't
  // re-serve, but explicit invalidation is cleaner. Then if the toggle
  // is on, run sweep + auto-promote against THIS chrom's L2 inventory
  // (which is now fresh in state.data, with candidates already loaded).
  // Order matters: candidates first → sweep can dedupe against them →
  // auto-promotes land in candidateList. Without this hook, switching
  // chrom with the toggle on would leave the sweep stale until the user
  // toggled it off-and-on.
  invalidateL2SweepCache(state);
  if (state.l2SweepEnabled) {
    try {
      const sweepRes = runL2SweepInheritance(state, { force: true });
      if (sweepRes) autoPromoteFromSweep(state, sweepRes);
    } catch (e) {
      console.warn('[l2sweep] applyData hook failed:', e && e.message);
    }
  }
  // turn 134 Slice 2: refresh inspector trigger-button availability after
  // the chrom-load sweep (or its absence). The button is disabled until
  // state.l2SweepResult is populated.
  if (typeof _refreshL2SweepInspectBtnAvailability === 'function') {
    try { _refreshL2SweepInspectBtnAvailability(); } catch (_) {}
  }
  // v3.99 turn 10: load saved catalogue favorites for this chromosome.
  // catState may not exist yet at very first call (it's defined later in the
  // file), so guard with typeof.
  if (typeof catState !== 'undefined' && typeof _loadCatFavorites === 'function') {
    catState.favorites = _loadCatFavorites();
  }
  // Load saved view controls (PCA axis selection etc.) and reconcile against
  // the data we just loaded — drops PC3/PC4 if not available, keeps PC1×PC2.
  loadViewControls(state);
  reconcileViewControlsForData(state);
  state.cur = 0;
  state.tracked = [];
  state.ancestryPalette = {};
  state.l2GroupCache = null;
  // 2026-05-19 mode-switch — preserve activeMode across applyData calls
  // (user toggled to θπ on LG02, scrubbed to LG06, expects θπ to stay).
  // Default to 'dosage' on first load. Restore from localStorage if the
  // user picked a non-default mode in a previous session AND the data
  // for that mode is available on the current chrom; otherwise fall back
  // to dosage.
  if (!state.activeMode) {
    try {
      const saved = localStorage.getItem(_ACTIVE_MODE_STORAGE_KEY);
      if (saved === 'theta_pi' && data.theta_pi_view) state.activeMode = 'theta_pi';
      else if (saved === 'ghsl' && data.ghsl_view)     state.activeMode = 'ghsl';
      else                                              state.activeMode = 'dosage';
    } catch (_) { state.activeMode = 'dosage'; }
  } else {
    // Subsequent chrom swaps: validate the previously-active mode still
    // has data on the new chrom. Fall back to dosage if not.
    if (state.activeMode === 'theta_pi' && !data.theta_pi_view) state.activeMode = 'dosage';
    if (state.activeMode === 'ghsl'     && !data.ghsl_view)     state.activeMode = 'dosage';
  }
  state.cacheKey = null;
  // v3.99 turn 7 perf: clear render caches whenever a new dataset loads
  _l3CacheInvalidate();
  _linesCacheInvalidate(state);
  // 2026-05-06 round 3: these helpers were extracted in step 3 and are now
  // imported at the top of this file — calling them directly is safe.
  // refreshColorModeBar / refreshPcaAxisBar / refreshPinUI are never-defined-
  // in-legacy hooks and stay try/caught (silent no-op).
  buildIndexes(state);
  computePC1Signs(state);
  populateSimScales(state);
  buildFamilyPalette(state);
  try { refreshColorModeBar(state); } catch (_) {}
  refreshBandPickBar(state);
  try { refreshPcaAxisBar(state); } catch (_) {}
  // Manual groups: reload from localStorage now that we know the chrom
  try { _mgRefreshOnDataLoad(); } catch (_) {}
  // v4 turn 128 (AS1): active samples — restore the saved CGA list for
  // this cohort and refresh the badge text. AS1 is purely scaffolding;
  // no other atlas function reads state.activeSampleSet yet.
  loadActiveSamples(state);
  refreshActiveSamplesBadge(state);
  buildLinesPanelCheckboxes(state);
  buildLinesPanel(state);
  // v3.99 turn 14e+ continue: revalidate the lines coloring mode against
  // the layers we just discovered. If the user previously selected, e.g.,
  // 'theta_pi' on a different JSON that had the layer, but this JSON
  // doesn't, the picker falls back to 'kmeans' silently.
  refreshLinesColorMode(state);
  state.secondaryL2 = null;
  try { refreshPinUI(state); } catch (_) {}
  state.lockedLabels = null;
  state.lockedRefL2 = null;
  try { refreshLockBtn(state); } catch (_) {}
  buildTrackPanels(state);
  const _scrubEl = document.getElementById('scrubber');
  if (_scrubEl) {
    _scrubEl.max = data.n_windows - 1;
    _scrubEl.disabled = false;
  }
  const l1c = (data.l1_envelopes || []).length;
  const l2c = (data.l2_envelopes || []).length;
  const bc  = (data.l2_boundaries || []).length;
  const scaleSummary = data.sim_scales && Object.keys(data.sim_scales).length > 0
    ? `<br><span class="dim">sim scales: ${Object.keys(data.sim_scales).join(', ')} (default: ${state.simScale})</span>`
    : '';
  let famSummary = '';
  if (data.family_source && data.family_source !== 'none') {
    const nHub = state.hubFamilies.length;
    const nSmall = state.smallFamilyIds.size;
    const nSing = state.singletonFamilyIds.size;
    const src = data.family_source === 'pairs' ? `pairs θ≥${data.theta_cutoff}` : 'natora --family';
    famSummary = `<br><span class="dim">families (${src}): ${nHub} hubs (n≥4), ${nSmall} small, ${nSing} singletons</span>`;
  }
  const sampleNames = data.samples && data.samples[0] && data.samples[0].cga !== data.samples[0].ind ? 'CGA' : 'Ind';
  const pc2Note = data.has_pc2 === false
    ? `<br><span class="dim" style="color: var(--accent);">PC2: jittered (slim precomp — no per-sample PC2)</span>`
    : '';
  const trackList = (data.tracks && Object.keys(data.tracks).length > 0)
    ? `<br><span class="dim">tracks: ${Object.keys(data.tracks).join(', ')}</span>`
    : '';
  // 2026-05-06 round 3 (parity step): #dataStatus, #headerMeta, #schemaBadge
  // are sidebar/topbar elements owned by the legacy monolith's chrome.
  // Under the new shell their hosts may not be on-screen when local_pca_dosage mounts
  // (the shell uses a different topbar; the sidebar isn't part of local_pca_dosage.html).
  // Null-check before innerHTML so a missing host doesn't crash mount().
  const _dataStatusEl = document.getElementById('dataStatus');
  if (_dataStatusEl) {
    _dataStatusEl.innerHTML =
      `<b>${data.chrom}</b><br>${data.n_windows} W · ${data.n_samples} samples (${sampleNames})<br>` +
      `<span class="dim">L1 envelopes: ${l1c}, L2 envelopes: ${l2c}, L2 peaks: ${bc}</span>` +
      scaleSummary + famSummary + pc2Note + trackList;
  }
  // v3.99 t14e+ continue: surface optional species name in header. Used by
  // the manuscript prompt template too. Italicized as a scientific name
  // when present. Falls back to omission when absent.
  const speciesPart = (typeof data.species === 'string' && data.species.trim())
    ? ` · <i>${data.species.trim()}</i>`
    : '';
  const _headerMetaEl = document.getElementById('headerMeta');
  if (_headerMetaEl) {
    _headerMetaEl.innerHTML =
      `<b>${data.chrom}</b>${speciesPart} · <b>${data.n_windows}</b> W · <b>${data.n_samples}</b> samples`;
  }
  // Schema badge. Two surfaces:
  //   1. badge text — count + version, shown inline in the topbar
  //   2. badge modal — opened on click; reads window.__atlasSchemaLayers
  //      ([shell_chrome.js _wireSchemaBadge]). The modal expects rows of
  //      { name, present, description }. Without writing the global the
  //      modal displays "No JSON loaded yet" even after a chrom loads.
  const schemaBadge = document.getElementById('schemaBadge');
  if (schemaBadge) {
    const layerNames = listLayers(state);
    schemaBadge.textContent = `schema v${state.schemaVersion} · ${layerNames.length} layer${layerNames.length === 1 ? '' : 's'}`;
    schemaBadge.title = `Schema version: v${state.schemaVersion}\nLayers: ${layerNames.join(', ')}\n\nUse + load enrichment to add layers from cluster phases 6+`;
    schemaBadge.className = 'v' + state.schemaVersion;
    schemaBadge.style.display = 'inline-block';
  }
  // Populate the modal-side schema layers list for shell_chrome.
  // We mark present-set explicitly; future work could enrich with the
  // absent-known-layer list pulled from the inversion layers registry
  // so users can see which fields the schema declares but this chrom's
  // pipeline didn't write. Per-layer description left blank for now —
  // the human-readable strings live in layers.registry.json > _doc fields.
  try {
    window.__atlasSchemaLayers = listLayers(state).map(name => ({
      name,
      present: true,
      description: '',
    }));
  } catch (_) { /* never fail applyData on a badge update */ }
  renderTrackedList(state);
  refreshCandidateUI(state);
  if (typeof refreshCandidateListUI === 'function') refreshCandidateListUI();
  // v3.90: activate (or hide) the marker page based on whether a phase-13
  // marker layer was loaded. Re-render its content after activation so it
  // reflects whatever subset of {summary, catalogue, primers} arrived.
  if (typeof _refreshMarkerPageActivation === 'function') _refreshMarkerPageActivation();
  if (typeof renderMarkerPage === 'function') renderMarkerPage();
  setCur(state, 0);
  // v4 turn 73f: persist this chromosome to IndexedDB so it survives page
  // reloads / cross-atlas navigation. Async, fire-and-forget; the helper
  // itself catches IDB errors and logs to console.warn.
  idbPersistChrom(data);
}

// =============================================================================
// MOUNT — integration with the new atlas-core shell
// =============================================================================
// This is the entry point the shell's atlas_router calls. It receives the
// new shell's atlasState + registry, hydrates the legacy `state` shape that
// the draw functions above expect, and wires up the canvas event handlers.
//
// Migration philosophy (per Quentin 2026-05-06): get the page rendering with
// the new shell as fast as possible, even if some draw paths still reference
// TODO_MISSING functions. Those paths will throw at runtime; we resolve them
// page-by-page from legacy. The goal is a working scrubber, not perfection.
// =============================================================================


/**
 * Mount local_pca_dosage into the given root element. Called by atlas_router on
 * navigation. The shell guarantees the fragment HTML has been injected
 * into root before this runs.
 */
export async function mount(root, atlasState, registry) {
  // Build a legacy-shaped state object. The draw functions all take state
  // as their first argument, so we just need to assemble one and pass it.
  const legacyState = _buildLegacyState(atlasState);

  // Legacy CSS rules for main#local_pca_dosage grid layout are gated on
  // body[data-layout-mode]. Without this attribute the PCA / lines / L3
  // grid rows collapse and the canvases get 0px height. Restore the
  // persisted mode if it exists; default to 'compact' (the user
  // explicitly asked for this on 2026-05-18 — fewer scrolls + 2×2 grid
  // shows everything at once). 'free' and 'fixed' still selectable via
  // the layoutModeBtn cycler.
  let restoredMode = 'compact';
  try {
    const v = localStorage.getItem('pca_scrubber_v3.layoutmode');
    if (v === 'fixed' || v === 'free' || v === 'compact') restoredMode = v;
  } catch (_) {}
  document.body.dataset.layoutMode = restoredMode;
  legacyState.layoutMode = restoredMode;
  try { localStorage.setItem('pca_scrubber_v3.layoutmode', restoredMode); } catch (_) {}

  // 2026-05-26: floating-sidebar wiring promoted to atlas-core
  // (core/sidebar_floating.js + shell.css). The shell auto-installs
  // on every shell.page_mount event — no per-page install call needed.
  // The body[data-active-mode] attribute is set AFTER applyData runs
  // (further below), because applyData is what restores state.activeMode
  // from localStorage — we'd be writing 'undefined' here.

  // Resolve the precomp data layer for the active chromosome.
  const chrom = atlasState.shared.activeChrom;
  if (!chrom) {
    root.innerHTML = '<div style="padding: 24px; color: #888;">' +
      '<h2>No chromosome selected</h2>' +
      '<p>Pick a chromosome from the toolbar.</p></div>';
    return;
  }

  // 2026-05-21 perf: kick the θπ + GHSL fetches BEFORE awaiting
  // scrubber_main. They share the network/disk pipe but the in-flight
  // Promise dedup means the prewarm-scheduler's chrom_change fetches
  // and these resolve to the same Promise. Starting both at the same
  // time saves the ~RTT we used to lose by awaiting scrubber_main first
  // and only then issuing the side fetches. We still await scrubber_main
  // before continuing (it's required), then await the side promises a
  // few lines down — by that point they've usually already settled.
  const tpPromise   = Promise.resolve(registry.resolve('scrubber_thetapi', { chrom }))
                        .catch(() => null);
  const ghslPromise = Promise.resolve(registry.resolve('scrubber_ghsl',    { chrom }))
                        .catch(() => null);

  let data;
  try {
    data = await registry.resolve('scrubber_main', { chrom });
  } catch (e) {
    root.innerHTML = `<div style="padding: 24px; color: #c00;">
      <h2>Failed to load chromosome data</h2>
      <pre>${escapeHtml(e.message)}</pre>
      <p>Layer: <code>scrubber_main</code> · chrom: <code>${escapeHtml(chrom)}</code></p>
    </div>`;
    return;
  }

  // 2026-05-19 — merge θπ + GHSL streams into the data envelope so the
  // PCA comparator's adapter (pca_comparator/renderer.js#_getLayerPoints)
  // and the eventual axis-toggle in this page can read all three axes
  // off a single state.data. Best-effort: each layer fetch returns null
  // on AUTO_INDEX_EMPTY / 404 (its pipeline output isn't on disk yet);
  // the comparator's adapter renders a "not loaded" stub in that case,
  // it doesn't error.
  //
  // Field merge: theta_pi and ghsl JSONs carry their top-level fields
  // (theta_pi_local_pca, ghsl_local_pca, …); we shallow-merge so those
  // become reachable from data.* without touching the z-blocks fields.
  // Rename theta_pi_cusum → cusum_theta to match the legacy schema's
  // canonical field name (page12 / theta-pi renderer reads cusum_theta).
  // 2026-05-19 — wrap with Promise.resolve(...) because registry.resolve()
  // returns the cached value SYNCHRONOUSLY when hot-tier cache hits
  // (which is the common case here — the prewarm scheduler fetches
  // scrubber_thetapi + scrubber_ghsl on chrom_change, populating the
  // cache before mount() runs). Calling .catch() on the bare return
  // value crashes when it's a plain object instead of a Promise; that
  // was the root cause of `TypeError: registry.resolve(...).catch is
  // not a function` blocking the entire mount, including the dataModeBar
  // availability check (which made GHSL look unavailable even when its
  // JSON was loaded). Promise.resolve flattens Promises and wraps values.
  const [tpData, ghslData] = await Promise.all([tpPromise, ghslPromise]);
  // 2026-05-19 SELECTIVE MERGE — earlier shallow `Object.assign(data, tpData)`
  // clobbered shared top-level fields (data.tracks, data.n_windows,
  // data.chrom, data.scale, etc.) with theta-pi's versions, breaking the
  // dosage panels because the right-side track strip painted theta-pi
  // tracks while the |z| panel + cursor were still on dosage coords.
  //
  // The right shape: only merge MODE-SPECIFIC top-level fields into the
  // dosage envelope (everything prefixed with `theta_pi_` / `ghsl_`).
  // Generic fields (tracks, windows, n_windows, chrom, sim_scales, etc.)
  // are namespaced under data.theta_pi_view / data.ghsl_view so the
  // future mode-switch can swap the whole panel inputs in one place.
  if (tpData) {
    for (const k of Object.keys(tpData)) {
      // Skip metadata + shared generics that would clobber the dosage view.
      if (k.startsWith('_')) continue;
      if (k === 'tracks' || k === 'windows' || k === 'chrom' ||
          k === 'n_samples' || k === 'scale' ||
          k.startsWith('n_windows')) continue;
      // Merge the mode-specific theta_pi_* blocks at top level so the
      // existing detectSchemaAndLayers + per-mode color resolvers see them.
      if (k.startsWith('theta_pi') || k === 'samples') {
        if (data[k] === undefined) data[k] = tpData[k];
      }
    }
    if (tpData.theta_pi_cusum && data.cusum_theta === undefined) {
      data.cusum_theta = tpData.theta_pi_cusum;
    }
    // Namespaced full envelope for the eventual mode-switch — keeps the
    // theta-pi tracks/windows/chrom/etc. addressable without polluting
    // the top-level dosage shape.
    data.theta_pi_view = tpData;
  }
  if (ghslData) {
    for (const k of Object.keys(ghslData)) {
      if (k.startsWith('_')) continue;
      if (k === 'tracks' || k === 'windows' || k === 'chrom' ||
          k === 'n_samples' || k === 'scale' ||
          k.startsWith('n_windows')) continue;
      if (k.startsWith('ghsl') || k === 'samples') {
        if (data[k] === undefined) data[k] = ghslData[k];
      }
    }
    data.ghsl_view = ghslData;
  }

  // 2026-05-26: write a per-chrom summary into AtlasState (SPEC
  // multichrom_load_orchestrator Slice 1). Cheap (~few KB), keeps a
  // metadata footprint for every chrom the user has visited so the
  // genome-wide ideogram + future cross-chrom views don't have to
  // rehydrate the full payload from IDB just to read counts. Fail-soft:
  // a malformed payload doesn't block the mount.
  try {
    if (typeof atlasState.setChromSummary === 'function') {
      atlasState.setChromSummary(chrom, buildChromSummary(data, { chrom }));
    }
  } catch (e) { console.warn('local_pca_dosage.mount: setChromSummary threw —', e); }

  // Mode-B freshness badge — surfaces which discovery axes are loaded
  // for this chrom. Non-blocking: `data` is already in hand (we'd have
  // bailed at line ~419 otherwise), so this is just a render call. The
  // probe shape ({ ok: true, n, sample_keys }) is mocked from the already-
  // resolved `data` to reuse renderModeBBadge's verdict path.
  try {
    const nWindows = Array.isArray(data && data.windows) ? data.windows.length : 0;
    const nSamples = Array.isArray(data && data.samples) ? data.samples.length : 0;
    const axesLoaded = ['z-blocks'];
    if (tpData)   axesLoaded.push('θπ');
    if (ghslData) axesLoaded.push('GHSL');
    renderModeBBadge('lpdModeBBadge',
      { ok: true, n: nWindows, sample_keys: ['chrom', 'windows', 'samples'], rows: data.windows || [], payload: data },
      {
        label:    'discovery axes',
        layerKey: 'scrubber_main',
        context:  chrom,
        compare:  () => ({
          pass: nWindows > 0 && nSamples > 0,
          summary: `${nWindows} windows · ${nSamples} samples · ` +
                   `axes: ${axesLoaded.join(' + ')}`,
        }),
      });
  } catch (e) {
    console.warn('local_pca_dosage.mount: Mode-B badge render threw —', e);
  }

  // 2026-05-18 — preserve cursor + tracked-samples across tab switches.
  // The unmount path keeps the stash alive (see unmount comment); on
  // re-mount, if the saved stash points at the SAME chromosome the
  // user is now viewing, replay its scrubber position + tracked list
  // onto the fresh legacyState BEFORE applyData (which would
  // otherwise reset cur to 0 — see local_pca_dosage.js:192). This is
  // what makes the cursor "stick" when the user tabs to
  // candidate_focus / pca_comparator / haplotype_regimes and back.
  const priorStash = atlasState.inversion._local_pca_dosage_state;
  let restoredCur = null;
  let restoredTracked = null;
  if (priorStash && priorStash.data && priorStash.data.chrom === chrom) {
    if (Number.isFinite(priorStash.cur)) restoredCur = priorStash.cur | 0;
    if (Array.isArray(priorStash.tracked)) restoredTracked = priorStash.tracked.slice();
  }

  // Apply data through the legacy entry point. This populates state.data,
  // state.tracks, state.windows, etc. — everything the draw functions need.
  applyData(legacyState, data);
  // Mode shade — body data-attribute mirrors state.activeMode so the
  // CSS wash on the PCA + tracked-samples panels reflects the restored
  // mode immediately on mount, not only after a user toggle.
  try { document.body.dataset.activeMode = legacyState.activeMode || 'dosage'; } catch (_) {}

  // Re-apply the preserved cursor / tracked-samples now that applyData's
  // defaults have been written.
  if (restoredCur != null && Number.isFinite(restoredCur)) {
    const nW = (legacyState.data && legacyState.data.n_windows) | 0;
    legacyState.cur = Math.max(0, Math.min(nW - 1, restoredCur));
  }
  if (restoredTracked && restoredTracked.length) {
    legacyState.tracked = restoredTracked;
  }

  // 2026-05-19 — install the dosage-chunk fetcher so that picking
  // "color: dosage" or "color: het" in the per-sample lines panel
  // actually triggers an HTTP fetch + repaint. The fetcher binds to
  // state._linesPanelGetCachedChunk, which computeDosageMeanForRange /
  // computeHetRateForRange both consult. onLoad re-renders the lines
  // panel when a chunk lands so the visual updates without a user
  // gesture. Idempotent: re-installs on each chrom remount because
  // the template URL is bound to the chrom inside state.data.
  try {
    installDosageChunkFetcher(legacyState, {
      onLoad: () => {
        try { drawLinesPanel(legacyState); } catch (_) {}
        // 2026-05-20: also re-render the L3 contingency panel so its
        // het chip picks up the freshly cached chunk. band_diagnostics.js
        // calls computeHetRateForRange with cacheKey, which now returns
        // real values instead of the NaN-filled placeholder.
        try { renderL3Panel(legacyState); } catch (_) {}
        // 2026-05-20 (later): when the user picked "het" or "dosage"
        // on the tracked-samples PCA color ramp, drawPCA pre-computes
        // a per-sample value array via computeHet/DosageMeanForRange.
        // On the first paint the chunk wasn't loaded yet → all-NaN →
        // every sample falls back to grey. After the chunk lands we
        // need to repaint the PCA scatter so the ramp colors show up.
        // Without this call, het / dosage stayed grey until the user
        // clicked the ramp button again. Quentin: "when we color by
        // het in the tracked samples can we have like the color. here
        // its all grey."
        try { drawPCA(legacyState); } catch (_) {}
      },
    });
  } catch (e) { console.warn('installDosageChunkFetcher:', e); }

  // 2026-05-26: wire the 🔬 dosage debug button (#dosageDebugBtn). Opens
  // a small overlay listing every tracked sample's computed dosage + het
  // for the active L2 range plus a one-line diagnosis. Helps debug the
  // recurring "PCA scatter stays grey under color: dosage / het" UX.
  try { _wireDosageDebugBtn(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: _wireDosageDebugBtn threw —', e); }

  // Replay any enrichments the user dropped in a prior session. Async,
  // fire-and-forget; matching enrichments merge onto state.data and
  // mark new layersPresent before the user touches anything. Failures
  // are logged inside the helper; we never block mount on this.
  replayEnrichmentsFromIdb(legacyState);

  // Initial render. Each call may throw if it hits a TODO_MISSING; we
  // catch and log so one broken panel doesn't hide the others.
  for (const [name, fn] of [
    ['drawSim',          () => drawSim(legacyState)],
    ['drawZ',            () => drawZ(legacyState)],
    ['drawLinesPanel',   () => drawLinesPanel(legacyState)],
    ['drawPCA',          () => drawPCA(legacyState)],
    ['drawTracks',       () => drawTracks(legacyState)],
    ['updateWinLabel',   () => updateWinLabel(legacyState)],
  ]) {
    try { fn(); }
    catch (e) {
      console.warn(`local_pca_dosage.mount: ${name} threw — likely a TODO_MISSING reference. Continuing.`, e);
    }
  }

  // Wire up canvas event handlers. The legacy code attached these to
  // document during applyData(); the new shell expects per-mount wiring
  // so old handlers don't accumulate when the user navigates between pages.
  _wireCanvasHandlers(root, legacyState);

  // Batch 1.5: wire every aside control (kSelect / aggMethod / mergeThr /
  // colorModeBar / lockColorsBtn / trailOn / flipPC1 / trailN / trackedN /
  // bandPickBar / jump / step-mode / sidebar toggle / etc.). Verbatim port
  // from the legacy monolith.
  try { attachSidebarHandlers(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: attachSidebarHandlers threw — continuing.', e); }

  // Batch 2: document-level keyboard surface. Stash the detach() function
  // on state so unmount can remove listeners and prevent accumulation
  // across page navigations.
  try { legacyState._hotkeyDetach = attachHotkeys(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: attachHotkeys threw — continuing.', e); }

  // Batch 3 (lasso): shift+drag on #pcaCanvas → manual group from enclosed
  // samples; with #pcaLassoToggle on, plain drag → replace state.tracked.
  // Idempotent — guards against double-attach on re-mount.
  try { attachPcaLasso(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: attachPcaLasso threw — continuing.', e); }

  // Panel resize handles: drag the bottom edge of sim / Z / lines / PCA / L3
  // to resize. Reads persisted heights from localStorage and applies the
  // grid template inline on main#local_pca_dosage.
  try { attachPanelResize(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: attachPanelResize threw — continuing.', e); }

  // Per-sample lines lasso: wires the checkbox + Confirm/Clear buttons in
  // the lines panel header bar. Without this, the lasso checkbox toggle
  // had no effect (state.linesLassoActive never flipped).
  try { attachLinesLasso(legacyState); }
  catch (e) { console.warn('local_pca_dosage.mount: attachLinesLasso threw — continuing.', e); }

  // Defer a follow-up redraw by two rAFs so the CSS grid (display: grid +
  // grid-template-rows) has time to resolve panel heights before fitCanvas
  // re-measures. Without this, sim_mat / Z / lines / PCA / L3 all paint
  // into 0×0 canvases on first mount in fixed mode (canvases stay blank
  // until a subsequent user gesture triggers a redraw). The compact-mode
  // path doesn't hit this because its grid resolves synchronously inside
  // the same task.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { drawSim(legacyState); }        catch (_) {}
    try { drawSimMini(legacyState); }    catch (_) {}
    try { drawZ(legacyState); }          catch (_) {}
    try { drawLinesPanel(legacyState); } catch (_) {}
    try { drawPCA(legacyState); }        catch (_) {}
    try { drawTracks(legacyState); }     catch (_) {}
    try { renderL3Panel(legacyState); }  catch (_) {}
  }));

  // Populate #chromSelect with the loaded chrom and enable it so the user
  // sees a real option instead of "— none loaded —". The full multi-chrom
  // cache lives in the atlas-core shell now; this is a minimal stand-in.
  try {
    const sel = document.getElementById('chromSelect');
    if (sel) {
      sel.innerHTML = `<option value="${chrom}" selected>${chrom}</option>`;
      sel.disabled = false;
    }
  } catch (_) {}

  // Stash the legacy state on the atlas bucket so it survives
  // unmount/mount across tab switches. pca_comparator + future
  // sibling pages read `inv._local_pca_dosage_state` to follow this
  // page's cursor + tracked-samples set; the `_page1State` alias is
  // retained for the legacy unmount cleanup path. 2026-05-18: the
  // stash now SURVIVES unmount (was deleted, see unmount comment).
  atlasState.inversion._local_pca_dosage_state = legacyState;
  atlasState.inversion._page1State = legacyState;   // legacy alias
}

/**
 * Unmount: called by atlas_router before navigating away.
 */
export async function unmount(root) {
  // The DOM gets replaced by the next mount; we just need to stop any
  // playback timer, detach document-level hotkeys, and unhook the local_pca_dosage
  // state.
  const state = _getState();
  const legacyState = state && state.inversion && state.inversion._page1State;
  if (legacyState && legacyState.playTimer) {
    clearInterval(legacyState.playTimer);
    legacyState.playTimer = null;
    legacyState.playing = false;
  }
  // Detach document-level keydown listeners — must run before page swap or
  // the listeners accumulate and a single key press triggers handlers for
  // every previous mount.
  if (legacyState && typeof legacyState._hotkeyDetach === 'function') {
    try { legacyState._hotkeyDetach(); } catch (_) {}
    legacyState._hotkeyDetach = null;
  }
  // 2026-05-18 — DON'T delete the stash on unmount. The stash carries
  // state.cur (scrubber position) + state.tracked across tab
  // switches; deleting it forced the next mount to start at cur=0
  // every time the user tabbed back from candidate_focus /
  // pca_comparator / haplotype_regimes (user-reported: "make sure
  // the cursor is correctly reassigned for all panels when we switch
  // discovery mode"). The mount path below now checks the stash and
  // restores cur+tracked when the same chrom is reloaded.
  // The playTimer + hotkey listeners ARE detached above because
  // they're per-mount DOM bindings; only the data + cursor stays.
}

// --- Helpers ---

function _buildLegacyState(atlasState) {
  // The legacy state is a flat object with ~84 slots. The new shell stores
  // these in two places: shared/ for cross-atlas slots, inversion/ for
  // private. We assemble a flat view for the draw functions, but write-
  // throughs go to the right bucket.
  const inv = atlasState.inversion || {};
  const sh = atlasState.shared || {};

  // Legacy state defaults — extracted verbatim from legacy lines 9344-9462
  // (`const state = { ... }`). The sidebar handlers read these (state.k,
  // state.colorMode, state.trailN, etc.); without defaults the controls
  // would read `undefined` on first paint and downstream code throws or
  // renders empty. Defaults applied first so per-atlas saved values
  // (`inv.*`) and per-mount overrides win.
  const defaults = {
    cur: 0,
    tracked: [],
    trailN: 15,
    trailOn: true,
    flipPC1: true,
    playing: false,
    playTimer: null,
    pc1Sign: null,
    activeSampleSet: null,
    activeSampleReasons: new Map(),
    activeSampleRules: [],
    // 2026-05-26: linked default flipped to false so changing PCA scatter
    // axes doesn't drag the per-sample lines panel along with it (the
    // auto-sync at setPcaXY was force-adding PC2 to linesYsources).
    // Quentin: "by default in per sample lines only PC1 is active."
    viewControls: { pcaXY: ['pc1', 'pc2'], linesYsources: ['pc1'], linked: false },
    // L3 / clustering
    k: 3,
    kMode: 'fixed',
    kRange: [2, 5],
    silThreshold: 0.45,
    aggMethod: 'mean_pc1',
    silScoreOn: 'pc1',
    tPanelOpen: false,
    pcaClusterLabelMode: null,    // 'none'|'g_index'|'h_system'|'h_pair' — cycle with N
    selectionMode: false,         // U key toggles; Shift+drag in selection mode writes to selectionGroup
    selectionGroup: null,         // { ids, source_atlas, source_page, source_window, ts } — see specs_todo/SPEC_cross_atlas_group_transfer.md
    cusumStripOn: false,          // toggle for the Σ CUSUM panel between tracks + lines
    useMacrostripeColors: false,  // SPEC_macrostripe_microgroup_hierarchy.md Phase 1 — when on AND state.bandingResult is present, color PCA/lines/L3 by macrostripe_id instead of per-window K-means microgroups
    cusumResidual: 'cohort_mean', // 'cohort_mean'|'band_mean'|'zero' — see shared/cusum.js
    cusumOp: 'mean',              // 'mean'|'median' — per-band aggregation
    cusumAxis: 'pc1',             // PC axis to walk; 'pc1' or 'pc2'

    mergeThr: 0.85,
    alpha: 0.05,
    minNGroup: 5,
    minNWin: 3,
    colorByL2: true,
    colorMode: 'cluster',
    manualGroups: null,
    lockedLabels: null,
    lockedRefL2: null,
    l3Layout: 'leftright',
    l3ColorMode: 'shared',
    l3KMode: 'k3',
    l3HetColoring: false,
    l2SweepEnabled: false,
    // Tracked samples
    trackedN: 10,
    // Display / navigation
    simScale: null,             // populated by populateSimScales at applyData time
    pdfStyle: true,
    candidateList: [],
    candidateMode: false,
    // mglCandidateMode — the multi-allelic candidate mode state slot
    // per HANDOFF_2 §"Component 1: candidate-mode state machine".
    // Distinct from the legacy `candidateMode` boolean above (which
    // governs the existing scrub-vs-candidate UI plumbing). The
    // MGL slot owns the new PCA + heatmap dual-panel + tree + etc.
    // controls + coordinated render state. Built lazily — `null`
    // here, populated by shared/mgl_candidate_mode.createMglCandidateModeSlot
    // on first activation.
    mglCandidateMode: null,
    travelMode: 'L2',
    stepMode: 'l2',
    stepModeN: 15,
    stepModeSync: true,
    labelVocab: 'legacy',
    activeMode: 'default',
    qDisplayMode: 'hard',
    qLegendMode: 'per_cluster',
    // Cache pointers
    l2GroupCache: null,
    cacheKey: null,
    secondaryL2: null,
    // Cross-species + family palette
    familyPalette: {},
    hubFamilies: [],
    smallFamilyIds: new Set(),
    singletonFamilyIds: new Set(),
    crossSpecies: null,
    // Panel heights (fixed-mode grid). Mutated by panel_resize.js drag
    // handles. Defaults match legacy v3.59 (sim 520 / Z 100 / lines 200
    // / PCA 280 / L3 360).
    simPanelH: 520,
    zPanelH: 100,
    linesPanelH: 200,
    pcaPanelH: 280,
    l3PanelH: 360,
    zCollapsed: false,
    simInMinimap: false,
  };

  const legacy = Object.assign(defaults, inv);

  // Cross-atlas slots that the legacy code reads as state.candidate etc.
  legacy.candidate              = sh.activeCandidate || null;
  legacy.candidateList          = inv.candidateList || legacy.candidateList;
  legacy.activeSampleSet        = sh.activeSampleSet || legacy.activeSampleSet;
  legacy.candidate_review_decisions = inv.candidate_review_decisions || {};
  legacy.locked_karyotype_groups    = inv.locked_karyotype_groups || {};

  return legacy;
}

/**
 * Build a single-chunk dosage_chunks index pointing at the server's
 * /api/dosage/chunk endpoint with templated region placeholders. The
 * atlas's _resolveChunkUrl substitutes __CHROM__/__START__/__END__/__CAP__
 * at fetch time, so one synthetic chunk covers the entire chromosome
 * and any region request lands the matching sub-slice.
 *
 * Idempotent: if data.dosage_chunks already exists (e.g. the user
 * drag-dropped an enrichment JSON with a real chunk index, or a
 * future pipeline pre-bakes static chunks), we leave it alone.
 *
 * Why an end_bp of 1e9 rather than the actual chrom length: the
 * placeholder is a sentinel for "covers the whole chrom" — the
 * server-side endpoint clips the request to the actual data extent
 * regardless. Computing the real end here would require either
 * reading the chrom_sizes.tsv on every applyData or walking
 * data.windows for max end_bp; neither is necessary because the
 * chunk is templated rather than addressed by extent.
 */
// ---------------------------------------------------------------------------
// Active mode (dosage / θπ / GHSL) — cycle helper used by the toolbar
// button and the 'M' hotkey. Each call advances to the next available
// mode (skipping modes whose data isn't loaded) and repaints every
// panel by reading getActiveModeView(state) at draw time.
// ---------------------------------------------------------------------------
const _MODE_ORDER = ['dosage', 'theta_pi', 'ghsl'];
const _ACTIVE_MODE_STORAGE_KEY = 'local_pca_dosage_active_mode';

export function setActiveMode(state, mode) {
  if (!state || !state.data) return;
  if (!_MODE_ORDER.includes(mode)) return;
  // Don't switch into a mode whose data isn't loaded.
  if (mode === 'theta_pi' && !state.data.theta_pi_view) return;
  if (mode === 'ghsl'     && !state.data.ghsl_view)     return;
  if (state.activeMode === mode) return;
  // Capture the bp position at the OLD mode's cur BEFORE swapping, so
  // we can remap to a matching window in the new mode's grid below.
  const oldCenterMb = _curCenterMb(state);
  state.activeMode = mode;
  // Clear render caches so panels re-paint from the new mode's data.
  try { _linesCacheInvalidate(state); } catch (_) {}
  try { _l3CacheInvalidate(); } catch (_) {}
  state.l2GroupCache = null;
  state.cacheKey = null;
  // Drop the per-mode color-scale cache and the lazy-synthesis flag
  // on the views so the next paint rebuilds for the new mode.
  try { invalidateColorScales(state); } catch (_) {}
  // Re-map cur to the window in the new mode's grid whose center_mb
  // is closest to the old position. Different modes have different
  // n_windows; a naive cur-preservation would jump to a wrong bp.
  // Fall back to 0 if remap fails.
  state.cur = _remapCurByMb(state, oldCenterMb);
  // Rebuild windowToL1 / windowToL2 indexes against the NEW mode's
  // view. Without this, drawZ's xOfWin crashes on `d.windows[wi]` when
  // wi is a window index from the old (dosage) grid pointing past the
  // end of the new (theta-pi / ghsl) windows array; the |Z| panel
  // either fails to paint or renders only a fragment of the span.
  try {
    const newView = getActiveModeView(state);
    if (newView) rebuildIndexesFromView(state, newView);
  } catch (e) { console.warn('rebuildIndexesFromView mode-swap:', e); }
  // Rebuild the track-panel DOM — each mode has a different set of
  // track names (dosage tracks vs theta_pi_* tracks vs ghsl_* tracks),
  // so we tear down the existing panels and re-render from view.tracks.
  try { buildTrackPanels(state); } catch (e) { console.warn('buildTrackPanels mode-swap:', e); }
  // Repaint every panel from the new view.
  try { drawSim(state); }          catch (e) { console.warn('drawSim mode-swap:', e); }
  try { drawZ(state); }            catch (e) { console.warn('drawZ mode-swap:', e); }
  try { drawLinesPanel(state); }   catch (e) { console.warn('drawLinesPanel mode-swap:', e); }
  try { drawPCA(state); }          catch (e) { console.warn('drawPCA mode-swap:', e); }
  try { drawTracks(state); }       catch (e) { console.warn('drawTracks mode-swap:', e); }
  try { renderL3Panel(state); }    catch (e) { console.warn('renderL3Panel mode-swap:', e); }
  try { updateWinLabel(state); }   catch (_) {}
  // Refresh the toolbar UI (highlight the active segment).
  try { _refreshModeToggleUI(state); } catch (_) {}
  // CSS shade: tint the PCA scatter + tracked-samples sidebar so the
  // user can tell at a glance which axis is active. inversion.css reads
  // `body[data-active-mode="…"]` to apply the wash.
  try { document.body.dataset.activeMode = mode; } catch (_) {}
  // Persist active mode to localStorage so it survives reload.
  try { localStorage.setItem(_ACTIVE_MODE_STORAGE_KEY, mode); } catch (_) {}
}

export function cycleActiveMode(state) {
  if (!state || !state.data) return;
  const cur = state.activeMode || 'dosage';
  const i = _MODE_ORDER.indexOf(cur);
  // Walk forward through the cycle, skipping modes whose data is missing.
  for (let step = 1; step <= _MODE_ORDER.length; step++) {
    const next = _MODE_ORDER[(i + step) % _MODE_ORDER.length];
    if (next === 'theta_pi' && !state.data.theta_pi_view) continue;
    if (next === 'ghsl'     && !state.data.ghsl_view)     continue;
    setActiveMode(state, next);
    return;
  }
}

// Read the center_mb at state.cur for the *current* active mode.
// Returns NaN if there's no resolvable view or window. Used to anchor
// the cur remap when swapping modes (different n_windows per mode).
function _curCenterMb(state) {
  try {
    const view = (state.activeMode === 'dosage' || !state.data.theta_pi_view && !state.data.ghsl_view)
      ? state.data
      : (state.activeMode === 'theta_pi' ? state.data.theta_pi_view : state.data.ghsl_view);
    if (!view || !Array.isArray(view.windows)) return NaN;
    const w = view.windows[state.cur | 0];
    return (w && Number.isFinite(w.center_mb)) ? w.center_mb : NaN;
  } catch (_) { return NaN; }
}

// Find the window in the NEW mode's grid whose center_mb is closest
// to `targetMb`. Linear scan; n_windows is at most ~5k so it's cheap.
function _remapCurByMb(state, targetMb) {
  if (!Number.isFinite(targetMb)) return 0;
  // Read the NEW mode's view directly (already switched to state.activeMode).
  let view;
  if (state.activeMode === 'theta_pi')      view = state.data.theta_pi_view;
  else if (state.activeMode === 'ghsl')     view = state.data.ghsl_view;
  else                                       view = state.data;
  if (!view || !Array.isArray(view.windows) || view.windows.length === 0) return 0;
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < view.windows.length; i++) {
    const m = view.windows[i] && view.windows[i].center_mb;
    if (!Number.isFinite(m)) continue;
    const d = Math.abs(m - targetMb);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
}

// Refresh the active-mode toolbar visual state. Idempotent; safe to
// call before the toolbar exists (returns silently).
function _refreshModeToggleUI(state) {
  if (typeof document === 'undefined') return;
  const bar = document.getElementById('dataModeBar');
  if (!bar) return;
  const mode = state.activeMode || 'dosage';
  const chrom = (state.data && state.data.chrom) || '—';
  for (const btn of bar.querySelectorAll('button[data-mode]')) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
    const m = btn.dataset.mode;
    const available =
      m === 'dosage' ||
      (m === 'theta_pi' && !!(state.data && state.data.theta_pi_view)) ||
      (m === 'ghsl'     && !!(state.data && state.data.ghsl_view));
    btn.disabled = !available;
    btn.style.opacity = available ? '' : '0.4';
    // 2026-05-19: explain WHY a mode is greyed out so the user doesn't
    // have to dig through the prewarm log. The precomp pipelines don't
    // produce every chrom every run — when GHSL or θπ is missing for
    // the active chrom, the button used to grey silently with no clue
    // ("for some reasons GHSL is not available in LG01 despite having
    // the JSON" — Quentin's report). The tooltip now points at the
    // precomp root and the fact that the JSON isn't on disk for this
    // chrom; restoring availability is a pipeline-side action.
    if (!available) {
      const layerName = m === 'theta_pi'
        ? 'scrubber_thetapi (precomp_thetapi)'
        : (m === 'ghsl' ? 'scrubber_ghsl (precomp_ghsl)' : m);
      btn.title = `${m} mode unavailable for ${chrom} — ${layerName} JSON not on disk for this chromosome. Run the corresponding pipeline (or pick a chrom that has it produced).`;
    } else {
      btn.title = '';
    }
  }
}

function _installSyntheticDosageChunks(data) {
  if (!data || data.dosage_chunks) return;
  if (!data.chrom) return;
  data.dosage_chunks = {
    schema_version: 1,
    chrom: data.chrom,
    cap_default: 1000,
    _source: 'synthetic_bridge',
    _endpoint: '/api/dosage/chunk',
    chunks: [
      {
        chrom: data.chrom,
        start_bp: 1,
        end_bp: 1_000_000_000,
        url: '/api/dosage/chunk?chrom=__CHROM__&start=__START__&end=__END__&cap=__CAP__',
      },
    ],
  };
}

// 2026-05-26: dosage-debug button. Click → modal listing each tracked
// sample's dosage + het for the active L2 range, plus a one-line
// diagnosis pointing at the most-likely failure mode (id mismatch,
// no chunk yet, no markers in range, all-NA dosage, etc.). Stateless;
// pulls a fresh report on every click.
function _wireDosageDebugBtn(state) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('dosageDebugBtn');
  if (!btn || btn.dataset.dosageDbgWired === '1') return;
  btn.dataset.dosageDbgWired = '1';
  btn.addEventListener('click', () => _openDosageDebugModal(state));
}

function _openDosageDebugModal(state) {
  const r = buildDosageDebugReport(state, state && state.tracked, null);
  // Build a minimal overlay (matches the shell modal look without
  // pulling shell_chrome._openModal cross-package).
  let overlay = document.getElementById('dosageDebugOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'dosageDebugOverlay';
    overlay.style.cssText = 'position: fixed; inset: 0; z-index: 9000;'
      + ' background: rgba(0,0,0,0.45); display: none;'
      + ' align-items: flex-start; justify-content: center; padding-top: 60px;';
    document.body.appendChild(overlay);
  }
  const rng = r.range || { startBp: '?', endBp: '?', startW: '?', endW: '?', chrom: '?' };
  const rangeMb = (Number.isFinite(rng.startBp) && Number.isFinite(rng.endBp))
    ? `${(rng.startBp / 1e6).toFixed(3)}–${(rng.endBp / 1e6).toFixed(3)} Mb`
    : `bp ${rng.startBp}–${rng.endBp}`;
  const rowsHtml = (r.trackedRows || []).map(row => {
    const dos = Number.isFinite(row.dosage) ? row.dosage.toFixed(3) : '<span style="color:#d94f4f">NaN</span>';
    const het = Number.isFinite(row.het)    ? row.het.toFixed(3)    : '<span style="color:#d94f4f">NaN</span>';
    return `<tr>
      <td style="padding: 2px 8px; font-family: var(--mono);">${row.sample_idx}</td>
      <td style="padding: 2px 8px; font-family: var(--mono);">${_escHtml(row.sample_id)}</td>
      <td style="padding: 2px 8px; font-family: var(--mono); text-align: right;">${dos}</td>
      <td style="padding: 2px 8px; font-family: var(--mono); text-align: right;">${het}</td>
    </tr>`;
  }).join('');
  const lruHtml = (r.lruKeys || []).length === 0
    ? '<span class="dim">none cached yet</span>'
    : r.lruKeys.map(k => `<code style="margin-right: 6px;">${_escHtml(k)}</code>`).join('');
  overlay.innerHTML = `
    <div role="dialog" aria-labelledby="dosageDebugTitle"
         style="background: var(--panel-2, #181d27); color: var(--ink, #e6edf6);
                border: 1px solid var(--rule, #2a3242); border-radius: 4px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                max-width: 760px; width: 92%; padding: 14px 18px;
                font-family: var(--serif); font-size: 12px; line-height: 1.5;
                max-height: 80vh; overflow-y: auto;">
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin: 0 0 10px;">
        <div id="dosageDebugTitle"
             style="font-size: 14px; font-weight: 600; font-family: var(--mono);">
          🔬 Dosage debug — chrom ${_escHtml(rng.chrom || '?')} · ${rangeMb}
          · windows ${rng.startW}–${rng.endW}
        </div>
        <button id="dosageDebugCloseBtn" type="button"
                style="background: transparent; border: 1px solid var(--rule);
                       color: var(--ink-dim); border-radius: 3px;
                       padding: 3px 10px; font-family: var(--mono); font-size: 11px;
                       cursor: pointer;">✕ close</button>
      </div>
      <div style="background: rgba(245,165,36,0.10); border-left: 2px solid var(--accent, #f5a524);
                  padding: 6px 10px; margin-bottom: 12px; font-size: 11.5px;">
        ${_escHtml(r.diagnosis)}
      </div>
      <div style="display: flex; align-items: center; gap: 10px;
                  padding: 6px 10px; margin-bottom: 12px;
                  background: var(--panel-3, #232a36);
                  border: 1px solid var(--rule); border-radius: 3px;">
        <label style="display: inline-flex; align-items: center; gap: 6px;
                      cursor: pointer; font-family: var(--mono); font-size: 11px;">
          <input type="checkbox" id="dosageForcePositionalToggle"
                 ${state && state.__forcePositionalDosage === true ? 'checked' : ''} />
          <span>Force positional binding (ignore chunk sample ids)</span>
        </label>
        <span class="dim" style="font-size: 10.5px;">
          Use when chunk ships placeholder ids (<code>Ind</code> / <code>Ind1</code>…) but
          you know the column order matches <code>data.samples</code>.
        </span>
      </div>
      <div style="margin-bottom: 8px; font-size: 11px; color: var(--ink-dim);">
        <b>Cached chunk keys (${(r.lruKeys || []).length}):</b> ${lruHtml}
      </div>
      ${_renderMarkerStats(r.markerStats, r.range)}
      ${_renderIdProjectionDetails(r.idProjection)}
      <table style="width: 100%; border-collapse: collapse; font-size: 11.5px;">
        <thead>
          <tr style="color: var(--ink-dim); text-transform: uppercase; font-size: 10px;
                     letter-spacing: 0.05em; border-bottom: 1px solid var(--rule);">
            <th style="padding: 4px 8px; text-align: left;">si</th>
            <th style="padding: 4px 8px; text-align: left;">sample id</th>
            <th style="padding: 4px 8px; text-align: right;">dosage mean</th>
            <th style="padding: 4px 8px; text-align: right;">het rate</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="4" style="padding: 8px; color: var(--ink-dim);">No tracked samples — lasso or click PCA points to track them first.</td></tr>'}</tbody>
      </table>
      <div class="dim" style="margin-top: 10px; font-size: 10.5px;">
        ${_renderNaNHint(r)}
      </div>
    </div>
  `;
  overlay.style.display = 'flex';
  const close = () => {
    overlay.style.display = 'none';
    document.removeEventListener('keydown', onKey);
    overlay.removeEventListener('click', onOverlay);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onOverlay = (e) => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', onOverlay);
  const closeBtn = overlay.querySelector('#dosageDebugCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', close);

  // Wire the Force-positional toggle. Flips a state flag the
  // _buildSampleIdMap path reads to install _byPos unconditionally.
  // Invalidate the cohort-alias cache + per-range dosage/het caches so
  // the next paint rebuilds the projection from scratch with positional
  // bindings, then redraw.
  const forceToggle = overlay.querySelector('#dosageForcePositionalToggle');
  if (forceToggle) {
    forceToggle.addEventListener('change', (e) => {
      state.__forcePositionalDosage = !!e.target.checked;
      // Invalidate caches so the next compute rebuilds with the new
      // _byPos table.
      try { state._cohortSampleAliasMap = null; } catch (_) {}
      try { if (state.__dosageMeanCache && state.__dosageMeanCache.clear) state.__dosageMeanCache.clear(); } catch (_) {}
      try { if (state.__hetRateCache    && state.__hetRateCache.clear)    state.__hetRateCache.clear();    } catch (_) {}
      // Repaint + re-open the modal with the new projection numbers.
      try { drawLinesPanel(state); } catch (_) {}
      try { drawPCA(state); } catch (_) {}
      setTimeout(() => _openDosageDebugModal(state), 100);
    });
  }
}

// Branch the hint shown under the tracked-sample table on the actual
// projection rate so users don't get sent chasing a sample-id mismatch
// when projection is 100% but every dosage cell is NaN (different
// failure mode — server returned no markers in range, or every cell is -1).
function _renderNaNHint(report) {
  if (!report) return '';
  const rows = Array.isArray(report.trackedRows) ? report.trackedRows : [];
  if (rows.length === 0) return '';
  const allNaN = rows.every(r => !Number.isFinite(r.dosage));
  if (!allNaN) return '';
  const proj = report.idProjection;
  const rate = proj && proj.match_rate != null ? proj.match_rate : null;
  if (rate == null) {
    return 'NaN dosage on every row + cached chunk present → check the '
         + '<code>[dosage_chunks] sample-id match:</code> line in the console '
         + 'for the projection rate.';
  }
  if (rate < 0.5) {
    return `NaN dosage on every row + projection only ${(rate * 100).toFixed(0)}% `
         + '→ <b>sample-id mismatch</b> between chunk.samples and data.samples. '
         + 'Open the projection table above; the unmatched rows show what chunk '
         + 'IDs the matcher couldn\'t resolve.';
  }
  // projection 50-100% → IDs are matching. Different failure.
  return `NaN dosage on every row but projection is ${(rate * 100).toFixed(0)}% — `
       + 'IDs are matching. The chunk is loaded but either '
       + '<b>(a)</b> no markers in this bp range (chunk\'s marker pos_bp values fall outside startBp/endBp), or '
       + '<b>(b)</b> every dosage cell is -1 (NA) for this region. '
       + 'Look in the console for <code>[dosage_chunks] computeHetRateForRange produced all-NaN</code> — '
       + 'it prints <code>markers in range: X/N</code> and <code>with non-NA calls: X/N</code> '
       + 'so you can tell (a) vs (b) at a glance.';
}

function _escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Render the chunk marker / non-NA forensic block. Tells the user
// whether the chunk for the active bp range has (a) any markers AT ALL,
// (b) markers but no non-NA dosage cells. Auto-open the <details> when
// something looks off so the user doesn't have to expand it.
function _renderMarkerStats(ms, range) {
  if (!ms) {
    return '<div class="dim" style="margin-bottom: 8px; font-size: 10.5px;">'
         + 'No chunk loaded — marker-range stats unavailable.</div>';
  }
  const startBp = range && Number.isFinite(range.startBp) ? range.startBp : null;
  const endBp   = range && Number.isFinite(range.endBp)   ? range.endBp   : null;
  const cspan = ms.chunk_bp_span;
  const inRangePct = ms.markers_total > 0
    ? (ms.markers_in_range / ms.markers_total * 100).toFixed(1) : '0';
  const nonNaPct = (ms.non_na_pct * 100).toFixed(1);
  const inRangeColour = ms.markers_in_range === 0
    ? '#d94f4f'
    : ms.markers_in_range < 5 ? 'var(--accent, #f5a524)'
    : 'var(--good, #3cc08a)';
  const nonNaColour = ms.cells_non_na === 0
    ? '#d94f4f'
    : ms.non_na_pct < 0.1 ? 'var(--accent, #f5a524)'
    : 'var(--good, #3cc08a)';
  const lowMarkers = ms.markers_in_range < 5;
  const lowNonNa   = ms.cells_non_na === 0 || ms.non_na_pct < 0.1;
  const openAttr = (lowMarkers || lowNonNa) ? ' open' : '';
  return `<details${openAttr} style="margin-bottom: 12px;">
    <summary style="cursor: pointer; font-size: 11px; color: var(--ink-dim);">
      <b>Chunk marker stats:</b>
      <span style="color: ${inRangeColour};">${ms.markers_in_range}/${ms.markers_total} markers in range</span>
      · <span style="color: ${nonNaColour};">${ms.cells_non_na}/${ms.cells_total} non-NA dosage cells (${nonNaPct}%)</span>
    </summary>
    <div style="margin-top: 6px; padding: 8px 10px;
                background: var(--panel-3, #232a36);
                border: 1px solid var(--rule); border-radius: 2px;
                font-family: var(--mono); font-size: 10.5px; line-height: 1.6;">
      ${cspan
        ? `<div><b>Chunk declared bp span:</b> ${cspan.start} – ${cspan.end}</div>`
        : ''}
      <div><b>Requested bp range:</b> ${startBp != null ? startBp : '?'} – ${endBp != null ? endBp : '?'}</div>
      <div><b>Markers (overall):</b> ${ms.first_marker_overall_bp ?? '?'} – ${ms.last_marker_overall_bp ?? '?'}
        (${ms.markers_total} total)</div>
      <div><b>Markers in requested range:</b>
        ${ms.markers_in_range > 0
          ? `${ms.first_marker_in_range_bp} – ${ms.last_marker_in_range_bp} (${ms.markers_in_range})`
          : '<span style="color:#d94f4f;">none</span>'}</div>
      <div><b>Dosage cells in range:</b>
        ${ms.cells_total} total, <span style="color: ${nonNaColour};">${ms.cells_non_na} non-NA (${nonNaPct}%)</span></div>
      ${lowMarkers
        ? '<div style="margin-top: 6px; color: var(--accent, #f5a524);">⚠ Few/no markers in this bp range — the chunk fetcher requested too narrow a region, or markers are sparser than the L2 envelope. Try moving the cursor to a different window.</div>'
        : ''}
      ${ms.markers_in_range > 0 && lowNonNa
        ? '<div style="margin-top: 6px; color: var(--accent, #f5a524);">⚠ Markers present but every dosage cell is -1 (NA) — server-side dosage TSV has no calls in this region. Pick a different range.</div>'
        : ''}
    </div>
  </details>`;
}

// Render the id-projection forensic block. Collapsed <details> when the
// match rate is healthy (≥80%), open by default when low (so the user
// SEES the mismatch). Caps the row list at 50 to keep the modal small;
// shows unmatched samples first since those are the actionable rows.
function _renderIdProjectionDetails(p) {
  if (!p || !Array.isArray(p.sample_map) || p.sample_map.length === 0) {
    return '<div class="dim" style="margin-bottom: 8px; font-size: 10.5px;">'
         + 'No chunk loaded — id-projection forensic unavailable.</div>';
  }
  const ratePct = (p.match_rate * 100).toFixed(1);
  const openAttr = (p.match_rate < 0.8) ? ' open' : '';
  // Order: unmatched rows first, then matched. Limits to first 50 each.
  const unmatched = p.sample_map.filter(s => !s.matched).slice(0, 50);
  const matched   = p.sample_map.filter(s =>  s.matched).slice(0, 50);
  const rows = unmatched.concat(matched);
  const rowHtml = rows.map(s => {
    const status = s.matched
      ? '<span style="color: var(--good, #3cc08a);">✓</span>'
      : '<span style="color: #d94f4f;">✗</span>';
    const cohort = s.matched
      ? `${s.cohort_idx} — ${_escHtml(s.cohort_id || '?')}`
      : '<span class="dim">no match</span>';
    return `<tr>
      <td style="padding: 1px 8px; font-family: var(--mono); text-align: center;">${status}</td>
      <td style="padding: 1px 8px; font-family: var(--mono);">${s.chunk_idx}</td>
      <td style="padding: 1px 8px; font-family: var(--mono);">${_escHtml(s.chunk_id)}</td>
      <td style="padding: 1px 8px; font-family: var(--mono);">${cohort}</td>
    </tr>`;
  }).join('');
  const cappedNote = (unmatched.length === 50 || matched.length === 50)
    ? '<div class="dim" style="font-size: 10px; padding: 4px 0;">(capped at 50 unmatched + 50 matched)</div>'
    : '';
  return `<details${openAttr} style="margin-bottom: 12px;">
    <summary style="cursor: pointer; font-size: 11px; color: var(--ink-dim);">
      <b>Sample-id projection:</b> ${p.matched}/${p.chunk_n} chunk samples matched
      (${ratePct}%) · ${p.cohort_n} cohort samples total
    </summary>
    <div style="max-height: 260px; overflow-y: auto; margin-top: 6px;
                border: 1px solid var(--rule); border-radius: 2px;
                background: var(--panel-3, #232a36);">
      <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
        <thead style="position: sticky; top: 0; background: var(--panel-3, #232a36);">
          <tr style="color: var(--ink-dim); text-transform: uppercase;
                     letter-spacing: 0.05em; font-size: 9.5px;
                     border-bottom: 1px solid var(--rule);">
            <th style="padding: 3px 8px;">match</th>
            <th style="padding: 3px 8px; text-align: left;">chunk_idx</th>
            <th style="padding: 3px 8px; text-align: left;">chunk_id</th>
            <th style="padding: 3px 8px; text-align: left;">cohort_idx — cohort_id</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
      ${cappedNote}
    </div>
  </details>`;
}

function _wireCanvasHandlers(root, state) {
  const sim = root.querySelector('#simCanvas');
  const z   = root.querySelector('#zCanvas');
  const pca = root.querySelector('#pcaCanvas');
  const playBtn = root.querySelector('#playBtn');
  const scrubber = root.querySelector('#scrubber');

  if (sim) sim.addEventListener('click', (e) => {
    try { onSimClick(state, e); } catch (err) { console.warn('onSimClick:', err); }
  });
  if (z) z.addEventListener('click', (e) => {
    try { onZClick(state, e); } catch (err) { console.warn('onZClick:', err); }
  });
  if (pca) pca.addEventListener('click', (e) => {
    try { onPCAClick(state, e); } catch (err) { console.warn('onPCAClick:', err); }
  });
  if (playBtn) playBtn.addEventListener('click', () => {
    try { togglePlay(state); } catch (err) { console.warn('togglePlay:', err); }
  });
  if (scrubber) scrubber.addEventListener('input', (e) => {
    try { setCur(state, parseInt(e.target.value, 10)); } catch (err) { console.warn('setCur:', err); }
  });
}
