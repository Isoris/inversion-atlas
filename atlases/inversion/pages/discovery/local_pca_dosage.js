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
import { resolve as _registryResolve, getState as _getState } from '../../../../core/atlas_api.js';

import {
  _setActiveState,
  _linesCacheInvalidate,
  invalidateLineageCache,
  _bandTraceClearCache,
} from './local_pca_dosage/_state.js';
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
import { buildFamilyPalette, buildIndexes, computePC1Signs, detectSchemaAndLayers, listLayers, loadViewControls, populateSimScales, reconcileViewControlsForData } from './local_pca_dosage/_data.js';
import { drawSim, drawSimMini } from './local_pca_dosage/sim_panel.js';
import { drawZ } from './local_pca_dosage/z_panel.js';
import { attachLinesLasso, buildLinesPanel, buildLinesPanelCheckboxes, drawLinesPanel, refreshLinesColorMode, setLinesPanelCandidateBands } from './local_pca_dosage/lines_panel.js';
import { autoPickRadial, cycleKAside, drawAnchorStrip, drawPCA, refreshColorModeBar, refreshLockBtn, refreshPcaAxisBar, renderManualGroupsList, renderTrackedList, togglePlay } from './local_pca_dosage/pca_panel.js';
import { _l3CacheInvalidate, refreshPinUI, renderL3Panel, renderL3PanelScaleStability, renderL3PanelSlab } from './local_pca_dosage/l3_panel.js';
import { loadCandidateList, refreshBandPickBar, refreshCandidateUI } from './local_pca_dosage/candidates.js';
import { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './local_pca_dosage/events.js';
import { attachSidebarHandlers } from './local_pca_dosage/sidebar.js';
import { attachHotkeys } from './local_pca_dosage/hotkeys.js';
import { attachPcaLasso } from './local_pca_dosage/pca_panel.js';

// Theta-pi mirror (local_pca_theta_pi) and GHSL mirror (local_pca_ghsl) entry points. These are
// painted from local_pca_dosage's applyData() because the mirror panels share local_pca_dosage's
// data envelope (theta_pi_*, ghsl_panel) — they activate when those layers
// are present in the loaded JSON. The local_pca_theta_pi/local_pca_ghsl modules also export
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
export { renderL3Panel, renderL3PanelScaleStability, renderL3PanelSlab } from './local_pca_dosage/l3_panel.js';
export { buildTrackPanels, drawTracks, onPCAClick, onSimClick, onZClick, setCur, updateWinLabel } from './local_pca_dosage/events.js';

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
  invalidateLineageCache(state);
  // turn 161: clear the band-trace cache (per-chromosome, per-fish-set)
  // and re-hydrate the on/off toggle + fish-set from localStorage. The
  // fish-set is cohort-wide so it survives chrom changes, but the
  // compute cache is per-chrom.
  _bandTraceClearCache(state);
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

  // Re-apply the preserved cursor / tracked-samples now that applyData's
  // defaults have been written.
  if (restoredCur != null && Number.isFinite(restoredCur)) {
    const nW = (legacyState.data && legacyState.data.n_windows) | 0;
    legacyState.cur = Math.max(0, Math.min(nW - 1, restoredCur));
  }
  if (restoredTracked && restoredTracked.length) {
    legacyState.tracked = restoredTracked;
  }

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
    viewControls: { pcaXY: ['pc1', 'pc2'], linesYsources: ['pc1'], linked: true },
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
