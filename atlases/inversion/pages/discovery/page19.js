// Atlas/inversion_discovery/page19.js
// =============================================================================
// page19 — Negative regions catalogue (complement of page3 catalogue)
// (`<div id="page19">` — toolbar with load/export/reset buttons,
//  caution banner, summary cards, region table)
//
// Source: legacy/Inversion_atlas.html lines 7378-7572 (HTML shell only)
//
// IMPORTANT: page19's JS handlers do NOT exist in legacy/Inversion_atlas.html.
// The HTML shell is wired with IDs (#nrLoadBtn, #nrLoadInput, #nrExportCsvBtn,
// #nrResetBtn, #nrSummaryCards, #nrTableSlot, #nrTableBadge) and an inline
// HTML comment that references "_nrRender()" as the planned future renderer
// name, but no JavaScript file in the legacy drop populates or wires them.
// The page is effectively a stub even in the legacy build — pressing the
// page19 tab shows the static caution banner + empty summary cards.
//
// Confirmed by:
//   $ grep -n 'nrLoadBtn\|nrSummaryCards\|_nrRender' legacy/Inversion_atlas.html
//   (all hits are HTML/CSS/comments — no JS handlers)
// And by chat-33 BATCH_1_NOTES.md row for page19: "0 functions extracted —
// pure HTML scaffold."
//
// What the page is supposed to do (per the title at legacy line 7382 and
// the caution banner copy at 7389-7402):
//   - Display a region-level catalogue of "no detectable inversion" calls,
//     i.e. the complement of page3's positive catalogue.
//   - Each region carries a region_status field (e.g.
//     no_detectable_inversion_high_confidence) — NOT a binary positive/
//     negative; the banner explicitly warns against that misreading.
//   - Loaded from negative_regions.json or .tsv via #nrLoadBtn / #nrLoadInput.
//   - Summary cards (#nrSummaryCards) show per-region_status counts.
//   - Region table (#nrTableSlot) shows the full per-region detail.
//   - Export CSV via #nrExportCsvBtn; reset via #nrResetBtn.
//
// External dependencies (when wired up):
//   TODO_MISSING(_nrRender)        — main renderer (does not exist)
//   TODO_MISSING(_nrLoadFile)      — file loader for json/tsv (does not exist)
//   TODO_MISSING(_nrExportCsv)     — CSV exporter (does not exist)
//   TODO_MISSING(_nrReset)         — clear loaded regions (does not exist)
//   global `state`                 — will read state.negativeRegions (new),
//                                    state.activeChrom for any chrom-filtered
//                                    summary cards.
//
// Decision for this round (chat 38 round 5 step 14, 2026-05-07): ship a
// no-op shell with the lifecycle (mount/unmount), matching the legacy
// behaviour. The merge chat — or a follow-up batch — implements the real
// renderers. This is the page8 stub-preserving migration template
// (round 5 step 13) applied to its exact twin (pattern 3 in CONTINUE_HERE).
// =============================================================================

import { contextFromState, clusterL2, ClusterCache } from '../../shared/per_l2_cluster.js';
import { hetRateColor } from '../../shared/het_rate.js';
import { alignLabels, hungarianChainProjection, concordanceMatrix } from '../../shared/hungarian.js';
import { buildContingency, computeARI, computeNMI, cramersV } from '../../shared/contingency.js';
import { kmeans1D, kmeans2D, silhouette1D, adaptiveK1D } from '../../shared/kmeans.js';

import { _pageState, _setActiveState } from './page19/_state.js';

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 14, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page19.
 *
 * Builds a legacy-shape state with the slots page19 will eventually need
 * (negativeRegions for the loaded region list, activeChrom for any
 * chrom-filtered summary cards). No render call yet — the legacy page is
 * pure HTML scaffold; the static caution banner + empty summary cards
 * remain visible until renderers are authored.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  // No render. Page19 is a pure-HTML-scaffold stub even in legacy
  // (see header comment). Leaving _pageState set lets future renderers
  // observe a non-null state via the live-binding pattern.

  if (atlasState.inversion) atlasState.inversion._page19State = legacyState;
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
  legacy.negativeRegions = inv.negativeRegions || [];
  legacy.activeChrom     = inv.activeChrom     || null;
  return legacy;
}
