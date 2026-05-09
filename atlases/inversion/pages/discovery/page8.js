// Atlas/inversion_discovery/page8.js
// =============================================================================
// page8 — Per-window summary table (|Z|, λ₁/λ₂, eigenvalue ratio, SNP counts)
// (`<div id="page8">` — toolbar, strip canvas, table, ANGSD bi-SNP info panel)
//
// Source: legacy/Inversion_atlas.html lines 7672-7774 (HTML shell only)
//
// IMPORTANT: page8's JS handlers do NOT exist in legacy/Inversion_atlas.html.
// The HTML shell is wired with IDs (#winSummaryToolbar, #winSumChips,
// #winSumStripCanvas, #winSumTable, #winSumZFilter, #winSumL2Filter,
// #winSumNoChrom, #winSumBisnpInfoBtn, #winSumBisnpInfoPanel, …) but no
// JavaScript file in the legacy drop populates or wires them. The page is
// effectively a stub even in the legacy build — pressing the page8 tab
// shows the empty-state #winSumNoChrom message ("Load a precomp JSON to
// view the per-window summary.").
//
// Confirmed by:
//   $ grep -n 'winSum' legacy/Inversion_atlas.html
//   (all hits are HTML/CSS/comments — no JS handlers)
// And by chat-33 BATCH_1_NOTES.md row for page8: "0 functions extracted —
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
// renderers. This is the page9 stub-preserving migration template
// (pattern 3 in CONTINUE_HERE).
// =============================================================================

import { contextFromState, clusterL2, ClusterCache } from '../../shared/per_l2_cluster.js';
import { hetRateColor } from '../../shared/het_rate.js';
import { alignLabels, hungarianChainProjection, concordanceMatrix } from '../../shared/hungarian.js';
import { buildContingency, computeARI, computeNMI, cramersV } from '../../shared/contingency.js';
import { kmeans1D, kmeans2D, silhouette1D, adaptiveK1D } from '../../shared/kmeans.js';

import { _pageState, _setActiveState } from './page8/_state.js';

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 13, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page8.
 *
 * Builds a legacy-shape state with the slots page8 will eventually need
 * (activeChrom for "which chromosome are we summarising", precomp for the
 * per-window data source). No render call yet — the legacy page is pure
 * HTML scaffold; the empty-state #winSumNoChrom message remains visible
 * until renderers are authored.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  // No render. Page8 is a pure-HTML-scaffold stub even in legacy
  // (see header comment). Leaving _pageState set lets future renderers
  // observe a non-null state via the live-binding pattern.

  if (atlasState.inversion) atlasState.inversion._page8State = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  legacy.activeChrom = inv.activeChrom || null;
  legacy.precomp     = inv.precomp     || null;
  return legacy;
}
