// Atlas/inversion_discovery/window_summary_table.js
// =============================================================================
// window_summary_table — Per-window summary table (|Z|, λ₁/λ₂, eigenvalue ratio, SNP counts)
// (`<div id="window_summary_table">` — toolbar, strip canvas, table, ANGSD bi-SNP info panel)
//
// Source: legacy/Inversion_atlas.html lines 7672-7774 (HTML shell only)
//
// IMPORTANT: window_summary_table's JS handlers do NOT exist in legacy/Inversion_atlas.html.
// The HTML shell is wired with IDs (#winSummaryToolbar, #winSumChips,
// #winSumStripCanvas, #winSumTable, #winSumZFilter, #winSumL2Filter,
// #winSumNoChrom, #winSumBisnpInfoBtn, #winSumBisnpInfoPanel, …) but no
// JavaScript file in the legacy drop populates or wires them. The page is
// effectively a stub even in the legacy build — pressing the window_summary_table tab
// shows the empty-state #winSumNoChrom message ("Load a precomp JSON to
// view the per-window summary.").
//
// Confirmed by:
//   $ grep -n 'winSum' legacy/Inversion_atlas.html
//   (all hits are HTML/CSS/comments — no JS handlers)
// And by chat-33 BATCH_1_NOTES.md row for window_summary_table: "0 functions extracted —
// pure HTML scaffold."
//
// What the page is supposed to do (per the toolbar copy at legacy lines
// 7672-7674 and the table headers + filters at 7720-7770):
//   - Display a sortable per-window summary table for the active chromosome
//     with columns: window range, |Z|, λ1/λ2, eigenvalue ratio, n bi-SNPs.
//   - Render a per-window strip canvas (#winSumStripCanvas) coloured by the
//     currently-clicked sortable column (default = |Z|), with L1/L2 zone
//     bars on top and tick-jump click-to-focus.
//   - Filter chips (#winSumChips) for L2 cluster + |Z| threshold.
//   - ANGSD bi-SNP discovery parameter panel (#winSumBisnpInfoBtn /
//     #winSumBisnpInfoPanel) — read-only doc-style panel describing the
//     gariepinus 226-cohort -GL/-minQ/-SNP_pval parameters.
//
// External dependencies (when wired up):
//   TODO_MISSING(_renderWinSumTable)     — table renderer (does not exist)
//   TODO_MISSING(_drawWinSumStripCanvas) — strip canvas renderer (does not exist)
//   TODO_MISSING(_wireWinSumFilters)     — filter chips wiring (does not exist)
//   TODO_MISSING(_wireWinSumBisnpInfo)   — info-panel toggle wiring (does not exist)
//   global `state`                       — will read state.activeChrom,
//                                          state.precomp, state.winSumFilters (new),
//                                          state.winSumColorMode (new).
//
// Decision for this round (chat 38 round 5 step 13, 2026-05-07): ship a
// no-op shell with the lifecycle (mount/unmount), matching the legacy
// behaviour. The merge chat — or a follow-up batch — implements the real
// renderers. This is the confirmed_carousel stub-preserving migration template
// (pattern 3 in CONTINUE_HERE).
// =============================================================================

import { contextFromState, clusterL2, ClusterCache } from '../../shared/per_l2_cluster.js';
import { hetRateColor } from '../../shared/het_rate.js';
import { alignLabels, hungarianChainProjection, concordanceMatrix } from '../../shared/hungarian.js';
import { buildContingency, computeARI, computeNMI, cramersV } from '../../shared/contingency.js';
import { kmeans1D, kmeans2D, silhouette1D, adaptiveK1D } from '../../shared/kmeans.js';

import { _pageState, _setActiveState } from './window_summary_table/_state.js';
import {
  renderPage8 as _renderPage8,
  wireWinSumToolbar,
  teardownWinSumToolbar,
} from './window_summary_table/window_summary.js';

/**
 * Public entry — state-aware wrapper. Sets _pageState before delegating.
 */
export function refreshWinSummary(state) {
  if (state) _setActiveState(state);
  return _renderPage8(_pageState);
}

/**
 * Wire toolbar filters + sortable header + go-button clicks. Idempotent.
 */
export function initWinSummaryToolbar() {
  wireWinSumToolbar(_pageState, {
    onChange: () => _renderPage8(_pageState),
  });
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle.
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to window_summary_table.
 *
 * Builds a legacy-shape state with activeChrom + precomp + filter slots
 * (winSumFilters, winSumColorMode, winSumSortKey, winSumSortDir), renders
 * the table + strip canvas, and wires toolbar handlers.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  // 2026-05-20: actually populate state.precomp. The page renderer
  // (renderPage8) gates on state.precomp.windows being a non-empty array
  // — without this resolve the table just rendered the empty "Load a
  // precomp JSON" stub. Quentin's report: "now nothing appears but
  // before in the legacy atlas that page was very good".
  //
  // Mode-aware: pull the active-mode view from the local_pca_dosage stash
  // when present so dosage / θπ / GHSL each yield their own window table
  // ("must now accommodate with all 3 precomps"). Falls back to a fresh
  // registry resolve when the user lands here without visiting page 1
  // first. Mode-specific resolves run lazily on a mode toggle; for now
  // dosage / θπ / GHSL all use the same windows[] array (they're aligned
  // window-by-window) so the cohort-wide |Z| / λ values are dosage-frame.
  const chrom = atlasState.shared && atlasState.shared.activeChrom;
  legacyState.activeChrom = chrom || legacyState.activeChrom;
  const inv = atlasState.inversion || {};
  const stash = inv._local_pca_dosage_state;
  let data = (stash && stash.data) || null;
  if (!data && chrom && registry) {
    try { data = await registry.resolve('scrubber_main', { chrom }); }
    catch (e) { console.warn('window_summary_table.mount: scrubber_main resolve threw —', e); }
  }
  // 2026-05-26: contribute to the chrom-summary cache so a user who
  // lands directly here populates the shell chip (SPEC_multichrom Slice 1).
  if (data && chrom && atlasState && typeof atlasState.setChromSummary === 'function') {
    try {
      const cs = await import('../../../../core/chrom_summary.js');
      atlasState.setChromSummary(chrom, cs.buildChromSummary(data, { chrom }));
    } catch (_) { /* non-essential cache write */ }
  }
  // 2026-05-19: cache the resolved `data` envelope + activeMode on the
  // legacyState so the toolbar mode-toggle (#winSumModeBar) can re-derive
  // legacyState.precomp on click without paying a fresh registry resolve
  // each time the user flips between dosage / θπ / GHSL.
  legacyState._rawData    = data || null;
  legacyState._atlasState = atlasState;
  // Pre-seed _mode from the dosage page's stash so the user's prior
  // choice carries over when they navigate here.
  legacyState._mode = (stash && stash.activeMode) || 'dosage';
  if (data) {
    legacyState.precomp = _precompFromDataMode(data, legacyState._mode, atlasState);
  }

  try { refreshWinSummary(legacyState); }
  catch (e) { console.warn('window_summary_table.mount: refreshWinSummary threw —', e); }

  try { initWinSummaryToolbar(); }
  catch (e) { console.warn('window_summary_table.mount: initWinSummaryToolbar threw —', e); }

  try { _wireModeToggle(legacyState); }
  catch (e) { console.warn('window_summary_table.mount: _wireModeToggle threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page8State = legacyState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode toggle (#winSumModeBar) — dosage / θπ / GHSL.
// Disables buttons whose corresponding *_view block isn't present in the
// loaded JSON, marks the active button .active, and on click re-derives
// state.precomp from the cached envelope + re-renders.
// ─────────────────────────────────────────────────────────────────────────────
function _wireModeToggle(state) {
  const bar = document.getElementById('winSumModeBar');
  if (!bar) return;
  const data = state._rawData;

  // Mark availability + active class up-front.
  const has = {
    dosage:   !!data,
    theta_pi: !!(data && data.theta_pi_view),
    ghsl:     !!(data && data.ghsl_view),
  };
  const cur = state._mode || 'dosage';
  bar.querySelectorAll('button[data-winsum-mode]').forEach(btn => {
    const m = btn.getAttribute('data-winsum-mode');
    btn.disabled = !has[m];
    btn.classList.toggle('active', m === cur);
    btn.title = has[m] ? btn.title.replace(/ \(no .* view in this JSON\)$/, '')
                       : (btn.title + ' (no ' + m + ' view in this JSON)');
  });

  // Single delegated click handler.
  bar.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('button[data-winsum-mode]');
    if (!btn || btn.disabled) return;
    const m = btn.getAttribute('data-winsum-mode');
    if (!m || m === state._mode) return;
    state._mode = m;
    bar.querySelectorAll('button[data-winsum-mode]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-winsum-mode') === m);
    });
    if (state._rawData) {
      state.precomp = _precompFromDataMode(state._rawData, m, state._atlasState);
    }
    try { refreshWinSummary(state); }
    catch (err) { console.warn('window_summary_table mode-toggle: refresh threw —', err); }
  });
}

// Build the `precomp` envelope renderPage8 expects from atlas data.
// Picks the active mode's view (dosage / θπ / GHSL) so the table reflects
// whichever axis the user is on. Adds l1_id / l2_id back-references on
// each window so the "L1" / "L2" columns + the in_l2 / in_focal filters
// work — the legacy schema baked these in but the modern scrubber JSON
// stores them only in the l1_envelopes / l2_envelopes arrays.
//
// `modeOverride` (added 2026-05-19): when set, picks the view by name
// instead of by stash.activeMode. The #winSumModeBar toggle uses this to
// flip dosage / θπ / GHSL on the page itself, independent of whichever
// mode local_pca_dosage is showing.
function _precompFromDataMode(data, modeOverride, atlasState) {
  if (!data || !Array.isArray(data.windows)) return null;
  const inv = (atlasState && atlasState.inversion) || {};
  const stash = inv._local_pca_dosage_state;
  // Mode-pick precedence: explicit override > stash.activeMode > 'dosage'.
  const activeMode = modeOverride
                   || (stash && stash.activeMode)
                   || 'dosage';
  let view = data;
  if (activeMode === 'theta_pi' && data.theta_pi_view) view = data.theta_pi_view;
  else if (activeMode === 'ghsl' && data.ghsl_view)    view = data.ghsl_view;
  // Decorate windows with l1_id / l2_id derived from the envelope arrays
  // so the table's L1/L2 columns + L2 filter resolve. Done on a shallow
  // copy to avoid mutating the cached registry value.
  const decorated = view.windows.map((w, i) => Object.assign({}, w, { idx: i }));
  const l1Env = Array.isArray(view.l1_envelopes) ? view.l1_envelopes : null;
  const l2Env = Array.isArray(view.l2_envelopes) ? view.l2_envelopes : null;
  if (l1Env) {
    l1Env.forEach((e, i) => {
      const s = Number.isFinite(e.start_w) ? (e.start_w - 1)
              : (Number.isFinite(e._s0) ? e._s0 : null);
      const ee = Number.isFinite(e.end_w) ? (e.end_w - 1)
              : (Number.isFinite(e._e0) ? e._e0 : null);
      if (s == null || ee == null) return;
      const lo = Math.max(0, s);
      const hi = Math.min(decorated.length - 1, ee);
      const id = e.id || `L1_${i}`;
      for (let w = lo; w <= hi; w++) decorated[w].l1_id = id;
    });
  }
  if (l2Env) {
    l2Env.forEach((e, i) => {
      const s = Number.isFinite(e.start_w) ? (e.start_w - 1)
              : (Number.isFinite(e._s0) ? e._s0 : null);
      const ee = Number.isFinite(e.end_w) ? (e.end_w - 1)
              : (Number.isFinite(e._e0) ? e._e0 : null);
      if (s == null || ee == null) return;
      const lo = Math.max(0, s);
      const hi = Math.min(decorated.length - 1, ee);
      const id = e.id || `L2_${i}`;
      for (let w = lo; w <= hi; w++) decorated[w].l2_id = id;
    });
  }
  // Forward the focal L2 id (current cursor's L2) so the 'in_focal'
  // filter can resolve. We read from the page1 stash's windowToL2 +
  // cur if available, else leave null.
  let focalL2Id = null;
  if (stash && stash.windowToL2 && Number.isFinite(stash.cur)) {
    const li = stash.windowToL2[stash.cur];
    if (li >= 0 && l2Env && l2Env[li]) {
      focalL2Id = l2Env[li].id || `L2_${li}`;
    }
  }
  return {
    windows:      decorated,
    l1:           l1Env || [],
    l2:           l2Env || [],
    focal_l2_id:  focalL2Id,
    _mode:        activeMode,
    _chrom:       view.chrom || data.chrom || null,
  };
}

// Back-compat alias so any external caller still using _precompFromData
// keeps working (resolves mode from the stash, same as before).
function _precompFromData(data, atlasState) {
  return _precompFromDataMode(data, null, atlasState);
}

/**
 * Unmount: remove wired handlers, clear _pageState so post-unmount
 * callbacks see null.
 */
export async function unmount(root) {
  try { teardownWinSumToolbar(); }
  catch (e) { console.warn('window_summary_table.unmount: teardown threw —', e); }
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  legacy.activeChrom      = inv.activeChrom      || null;
  legacy.precomp          = inv.precomp          || null;
  legacy.winSumFilters    = inv.winSumFilters    || { l2: '', zMin: 0 };
  legacy.winSumColorMode  = inv.winSumColorMode  || 'z';
  legacy.winSumSortKey    = inv.winSumSortKey    || 'idx';
  legacy.winSumSortDir    = inv.winSumSortDir    || 'asc';
  return legacy;
}
