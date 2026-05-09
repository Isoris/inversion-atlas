// Atlas/inversion_discovery/page15.js
// =============================================================================
// page15 — GHSL haplotype-divergence page (planned six-panel scanner; currently
//          empty-state with layer-status indicators only)
// (`<div id="page15">` — empty-state shell with five [data-gh-layer]
//  indicator chips: ghsl_panel, ghsl_kstripes, ghsl_karyotype_runs,
//  ghsl_d17_envelopes, cusum_ghsl)
//
// Source: legacy/Inversion_atlas.html lines 7180-7247 (HTML shell) + lines
// 53065-53081 (the one extracted helper _refreshGhslLayerStatus).
//
// Same orthogonal-validation rationale as page12 (θπ scanner): page15 is
// designed as a third evidence axis — GHSL haplotype divergence — that
// will eventually run the same six-panel pipeline (per-window analysis →
// window×window similarity → MDS → cluster → candidate intervals) but
// driven by haplotype-pair sequence divergence rather than dosage (page1)
// or per-sample θπ (page12). Regions hit by all three scrubbers are
// near-certainly real biology; regions hit by GHSL only are
// haplotype-specific divergence invisible to dosage-or-diversity scans.
//
// Round-5-step-15 status: page15 currently ships only the layer-status
// indicator wiring. The five [data-gh-layer] chips toggle between
// "🟢 loaded" and "⚪ not loaded" based on whether each GHSL layer is
// present in state.layersPresent (a Set). Empty-state placeholder visible
// until at least one of the GHSL layers ships from the R pipeline; full
// six-panel renderers (mirroring page1's drawZ/drawSim/drawLinesPanel/
// drawAnchorStrip/drawPca/drawL3) are TODO_MISSING — see CONTINUE_HERE
// "stub-preserving + one wired entry" pattern.
//
// External dependencies (when wired up):
//   TODO_MISSING(_drawGhslZPanel + 5 sibling panel renderers) — six-panel
//                                  pipeline mirroring page1 / page12.
//   TODO_MISSING(_refreshGhslPanelVisibility) — empty-state vs panels
//                                  visibility toggle (mirrors page12's
//                                  _refreshThetaPiPanelVisibility).
//   global `state`              — the chat-33 helper reads
//                                  state.layersPresent (Set<layerName>);
//                                  future panel renderers will read the
//                                  per-window GHSL data slots once they
//                                  ship from R.
//
// Decision for this round (chat 38 round 5 step 15, 2026-05-07): preserve
// the chat-33 _refreshGhslLayerStatus body VERBATIM (it already takes
// state as an explicit arg per HANDOFF_BATCH_1 convention), add a
// state-aware public wrapper refreshGhslLayerStatus that mirrors page9's
// refreshConfirmedCarousel pattern, and call it from mount() so the chips
// render at mount time. This is the "stub-preserving + one wired entry"
// hybrid pattern (pattern 4 in CONTINUE_HERE, first instance).
//
// **Closing the discovery group**: with this round, page1, page2, page8,
// page12, page15, page19 are all migrated — discovery group is COMPLETE
// (6 of 6).
// =============================================================================

import { contextFromState, clusterL2, ClusterCache } from '../../shared/per_l2_cluster.js';
import { hetRateColor } from '../../shared/het_rate.js';
import { alignLabels, hungarianChainProjection, concordanceMatrix } from '../../shared/hungarian.js';
import { buildContingency, computeARI, computeNMI, cramersV } from '../../shared/contingency.js';
import { kmeans1D, kmeans2D, silhouette1D, adaptiveK1D } from '../../shared/kmeans.js';

import { _pageState, _setActiveState } from './page15/_state.js';

// ---------------------------------------------------------------------------
// Extracted bodies (chat-33, preserved VERBATIM)
// ---------------------------------------------------------------------------

// --- _refreshGhslLayerStatus() — legacy lines 53065-53081 ---
//
// Refreshes the GHSL layer-status indicator chips. Reads
// state.layersPresent (a Set of layer-name strings); for each
// [data-gh-layer] node in the DOM, toggles textContent + style.color
// between "🟢 loaded" / var(--good) (when layer is present) and
// "⚪ not loaded" / var(--ink-dimmer) (when absent).
//
// Signature unchanged from chat-33 extraction: takes `state` as explicit
// first arg per HANDOFF_BATCH_1 convention.
export function _refreshGhslLayerStatus(state) {
  if (typeof document === 'undefined') return;
  const indicators = document.querySelectorAll('[data-gh-layer]');
  if (!indicators || indicators.length === 0) return;
  indicators.forEach(node => {
    const layerName = node.dataset && node.dataset.ghLayer;
    if (!layerName) return;
    const present = !!(state.layersPresent && state.layersPresent.has(layerName));
    if (present) {
      node.textContent = '🟢 loaded';
      node.style.color = 'var(--good)';
    } else {
      node.textContent = '⚪ not loaded';
      node.style.color = 'var(--ink-dimmer)';
    }
  });
}

// ---------------------------------------------------------------------------
// State-aware public wrapper
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around _refreshGhslLayerStatus.
 *
 * If `state` is passed, sets _pageState as a side effect before
 * delegating (mirrors page9's refreshConfirmedCarousel(state) pattern).
 * If called without args, falls back to _pageState set by mount().
 *
 * Returns the underlying call's return value (currently undefined).
 */
export function refreshGhslLayerStatus(state) {
  if (state) _setActiveState(state);
  const resolved = state || _pageState || {};
  return _refreshGhslLayerStatus(resolved);
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 15, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to page15.
 *
 * Builds a legacy-shape state with the slots the chat-33 helper needs
 * (layersPresent — a Set of GHSL layer names; activeChrom for any
 * future chrom-aware rendering). Calls refreshGhslLayerStatus to
 * populate the five [data-gh-layer] indicator chips at mount time.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshGhslLayerStatus(legacyState); }
  catch (e) { console.warn('page15.mount: refreshGhslLayerStatus threw —', e); }

  if (atlasState.inversion) atlasState.inversion._page15State = legacyState;
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
  // layersPresent: Set<layerName> — read by _refreshGhslLayerStatus.
  // Default to an empty Set so the chat-33 helper's `.has(layerName)`
  // call doesn't blow up on an undefined slot.
  legacy.layersPresent = inv.layersPresent || new Set();
  legacy.activeChrom   = inv.activeChrom   || null;
  return legacy;
}
