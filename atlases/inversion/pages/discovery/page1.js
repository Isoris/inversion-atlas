// pages/discovery/page1/page1.js
//
// Local PCA on dosage: sim_mat heatmap, robust |Z|, per-sample lines,
// K-means PCA, L3 contingency. THE big page (per HANDOFF_BATCH_1).
//
// Round 4 (2026-05-06): split from a 6684-LOC monolith into 10 cohesive
// sub-modules under ./page1/. This file is the entry point the manifest
// references (`module: "page1.js"`); it re-exports every public name
// from the panel sub-modules and owns the mount/unmount/applyData/
// _buildLegacyState/_wireCanvasHandlers wiring with the atlas-core shell.
//
// Sub-modules:
//   ./page1/_state.js        — _pageState + setter, color helpers, FAMILY_*
//   ./page1/_data.js         — schema, indexing, PC accessors, view controls
//   ./page1/sim_panel.js     — drawSim, drawSimMini
//   ./page1/z_panel.js       — drawZ + 9 strip renderers
//   ./page1/lines_panel.js   — drawLinesPanel and friends
//   ./page1/pca_panel.js     — drawPCA, drawAnchorStrip, anchor helpers
//   ./page1/l3_panel.js      — renderL3Panel + slab + scaleStability
//   ./page1/candidates.js    — candidate lanes/bands/overlay/bar (+ stubs)
//   ./page1/events.js        — onSimClick/onZClick/onPCAClick/setCur/etc.
//
// applyData lives here (in main) because it's the one function that
// orchestrates everything — it calls helpers from data/, candidates/,
// events/, lines/, pca/. Keeping it in main lets the panels stay
// concern-focused and avoids a module-import cycle through the panels.

import { escapeHtml } from '../../shared/page1_utils.js';
import { resolve as _registryResolve, getState as _getState } from '../../../../core/atlas_api.js';

import { _setActiveState } from './page1/_state.js';
import { buildFamilyPalette, buildIndexes, computePC1Signs, detectSchemaAndLayers, listLayers, loadViewControls, populateSimScales, reconcileViewControlsForData } from './page1/_data.js';
import { drawSim, drawSimMini } from './page1/sim_panel.js';
import { drawZ } from './page1/z_panel.js';
import { attachLinesLasso, buildLinesPanel, buildLinesPanelCheckboxes, drawLinesPanel, refreshLinesColorMode, setLinesPanelCandidateBands } from './page1/lines_panel.js';
import { autoPickRadial, cycleKAside, drawAnchorStrip, drawPCA, refreshColorModeBar, refreshLockBtn, refreshPcaAxisBar, renderManualGroupsList, renderTrackedList, togglePlay } from './page1/pca_panel.js';
import { _l3CacheInvalidate, refreshPinUI, renderL3Panel, renderL3PanelScaleStability, renderL3PanelSlab } from './page1/l3_panel.js';
import { loadCandidateList, refreshBandPickBar, refreshCandidateUI } from './page1/candidates.js';
import { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './page1/events.js';
import { attachSidebarHandlers } from './page1/sidebar.js';
import { attachHotkeys } from './page1/hotkeys.js';
import { attachPcaLasso } from './page1/pca_panel.js';

// Theta-pi mirror (page12) and GHSL mirror (page15) entry points. These are
// painted from page1's applyData() because the mirror panels share page1's
// data envelope (theta_pi_*, ghsl_panel) — they activate when those layers
// are present in the loaded JSON. The page12/page15 modules also export
// their own atlas-router lifecycle for when those pages are mounted directly.
import {
  _drawThAnchorStripPanel,
  _drawThCusumHero,
  _drawThLinesPanel,
  _drawThPcaPanel,
  _drawThSimMatPanel,
  _drawThZPanel,
  _refreshThetaPiLayerStatus,
  _refreshThetaPiPanelVisibility,
} from './page12.js';
import { _refreshGhslLayerStatus } from './page15.js';
import { _mgRefreshOnDataLoad } from './page1/manual_groups.js';
import { attachPanelResize } from './page1/panel_resize.js';

// Re-export public entry points so the manifest's `module:` contract
// (atlas_router imports drawSim, applyData, etc. from this file) is
// preserved across the split.
export { drawSim, drawSimMini } from './page1/sim_panel.js';
export { drawZ } from './page1/z_panel.js';
export { buildLinesPanel, buildLinesPanelCheckboxes, drawLinesPanel, refreshLinesColorMode, setLinesPanelCandidateBands } from './page1/lines_panel.js';
export { autoPickRadial, cycleKAside, drawAnchorStrip, drawPCA, renderManualGroupsList, renderTrackedList, togglePlay } from './page1/pca_panel.js';
export { renderL3Panel, renderL3PanelScaleStability, renderL3PanelSlab } from './page1/l3_panel.js';
export { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './page1/events.js';

// --- applyData() — legacy lines 54476-54690 ---
export function applyData(state, data) {
  _setActiveState(state);
  // Cross-chrom safety: candidate from a different chromosome is meaningless.
  // Clear it before swapping data so refreshes downstream see no stale state.
  if (state.candidate && state.candidate.chrom !== data.chrom) {
    state.candidate = null;
  }
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
  if (typeof invalidateLineageCache === 'function') {
    try { invalidateLineageCache(); } catch (_) {}
  }
  // turn 161: same for the band-trace cache (per-chromosome, per-fish-set).
  // Also drop the fish-set itself — sample indices are per-chrom and
  // generally don't transfer to a new chromosome's data shape.
  if (typeof _bandTraceClearCache === 'function') {
    try { _bandTraceClearCache(); } catch (_) {}
  }
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
  // when only page1 is mounted; the renders bail safely.
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
  if (typeof invalidateL2SweepCache === 'function') {
    try { invalidateL2SweepCache(); } catch (_) {}
  }
  if (state.l2SweepEnabled
      && typeof runL2SweepInheritance === 'function'
      && typeof _autoPromoteFromSweep === 'function') {
    try {
      const sweepRes = runL2SweepInheritance({ force: true });
      if (sweepRes) _autoPromoteFromSweep(sweepRes);
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
  state.cacheKey = null;
  // v3.99 turn 7 perf: clear render caches whenever a new dataset loads
  _l3CacheInvalidate();
  if (typeof _linesCacheInvalidate === 'function') _linesCacheInvalidate();
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
  if (typeof loadActiveSamples === 'function') loadActiveSamples();
  if (typeof refreshActiveSamplesBadge === 'function') refreshActiveSamplesBadge();
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
  if (typeof buildTrackPanels === 'function')     buildTrackPanels(state);
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
  // Under the new shell their hosts may not be on-screen when page1 mounts
  // (the shell uses a different topbar; the sidebar isn't part of page1.html).
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
  // Schema badge
  const schemaBadge = document.getElementById('schemaBadge');
  if (schemaBadge) {
    const layerNames = listLayers(state);
    schemaBadge.textContent = `schema v${state.schemaVersion} · ${layerNames.length} layer${layerNames.length === 1 ? '' : 's'}`;
    schemaBadge.title = `Schema version: v${state.schemaVersion}\nLayers: ${layerNames.join(', ')}\n\nUse + load enrichment to add layers from cluster phases 6+`;
    schemaBadge.className = 'v' + state.schemaVersion;
    schemaBadge.style.display = 'inline-block';
  }
  renderTrackedList(state);
  refreshCandidateUI(state);
  if (typeof refreshCandidateListUI === 'function') refreshCandidateListUI();
  // v3.90: activate (or hide) the marker page based on whether a phase-13
  // marker layer was loaded. Re-render its content after activation so it
  // reflects whatever subset of {summary, catalogue, primers} arrived.
  if (typeof _refreshMarkerPageActivation === 'function') _refreshMarkerPageActivation();
  if (typeof renderMarkerPage === 'function') renderMarkerPage();
  if (typeof setCur === 'function') setCur(state, 0);
  // v4 turn 73f: persist this chromosome to IndexedDB so it survives page
  // reloads / cross-atlas navigation. Async, fire-and-forget; failures log
  // to console but don't block the UI.
  if (typeof _idbPersistChrom === 'function') {
    try { _idbPersistChrom(data); } catch (_) { /* fail-soft */ }
  }
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
 * Mount page1 into the given root element. Called by atlas_router on
 * navigation. The shell guarantees the fragment HTML has been injected
 * into root before this runs.
 */
export async function mount(root, atlasState, registry) {
  // Build a legacy-shaped state object. The draw functions all take state
  // as their first argument, so we just need to assemble one and pass it.
  const legacyState = _buildLegacyState(atlasState);

  // Legacy CSS rules for main#page1 grid layout are gated on
  // body[data-layout-mode]. Without this attribute the PCA / lines / L3
  // grid rows collapse and the canvases get 0px height. Restore the
  // persisted mode if it exists AND we trust the new shell with it; for
  // now we force 'fixed' on every mount to match legacy default and
  // because free/compact have layout quirks we haven't fully reproduced.
  document.body.dataset.layoutMode = 'fixed';
  legacyState.layoutMode = 'fixed';
  try { localStorage.setItem('pca_scrubber_v3.layoutmode', 'fixed'); } catch (_) {}

  // Resolve the precomp data layer for the active chromosome.
  const chrom = atlasState.shared.activeChrom;
  if (!chrom) {
    root.innerHTML = '<div style="padding: 24px; color: #888;">' +
      '<h2>No chromosome selected</h2>' +
      '<p>Pick a chromosome from the toolbar.</p></div>';
    return;
  }

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

  // Apply data through the legacy entry point. This populates state.data,
  // state.tracks, state.windows, etc. — everything the draw functions need.
  applyData(legacyState, data);

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
      console.warn(`page1.mount: ${name} threw — likely a TODO_MISSING reference. Continuing.`, e);
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
  catch (e) { console.warn('page1.mount: attachSidebarHandlers threw — continuing.', e); }

  // Batch 2: document-level keyboard surface. Stash the detach() function
  // on state so unmount can remove listeners and prevent accumulation
  // across page navigations.
  try { legacyState._hotkeyDetach = attachHotkeys(legacyState); }
  catch (e) { console.warn('page1.mount: attachHotkeys threw — continuing.', e); }

  // Batch 3 (lasso): shift+drag on #pcaCanvas → manual group from enclosed
  // samples; with #pcaLassoToggle on, plain drag → replace state.tracked.
  // Idempotent — guards against double-attach on re-mount.
  try { attachPcaLasso(legacyState); }
  catch (e) { console.warn('page1.mount: attachPcaLasso threw — continuing.', e); }

  // Panel resize handles: drag the bottom edge of sim / Z / lines / PCA / L3
  // to resize. Reads persisted heights from localStorage and applies the
  // grid template inline on main#page1.
  try { attachPanelResize(legacyState); }
  catch (e) { console.warn('page1.mount: attachPanelResize threw — continuing.', e); }

  // Per-sample lines lasso: wires the checkbox + Confirm/Clear buttons in
  // the lines panel header bar. Without this, the lasso checkbox toggle
  // had no effect (state.linesLassoActive never flipped).
  try { attachLinesLasso(legacyState); }
  catch (e) { console.warn('page1.mount: attachLinesLasso threw — continuing.', e); }

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

  // Stash the legacy state on the atlas bucket for inter-function access
  // during this mount lifetime. The unmount path clears it.
  atlasState.inversion._page1State = legacyState;
}

/**
 * Unmount: called by atlas_router before navigating away.
 */
export async function unmount(root) {
  // The DOM gets replaced by the next mount; we just need to stop any
  // playback timer, detach document-level hotkeys, and unhook the page1
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
  if (state && state.inversion) {
    delete state.inversion._page1State;
  }
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
    viewControls: { pcaXY: ['pc1', 'pc2'], linesYsources: ['pc1'], linked: true },
    // L3 / clustering
    k: 3,
    kMode: 'fixed',
    kRange: [2, 5],
    silThreshold: 0.45,
    aggMethod: 'mean_pc1',
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
