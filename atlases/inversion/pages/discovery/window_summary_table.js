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

  try { refreshWinSummary(legacyState); }
  catch (e) { console.warn('window_summary_table.mount: refreshWinSummary threw —', e); }

  try { initWinSummaryToolbar(); }
  catch (e) { console.warn('window_summary_table.mount: initWinSummaryToolbar threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page8State = legacyState;
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
