// pages/classification/candidate_regimes.js
// =============================================================================
// candidate_regimes (2026-05-27 Part A extraction of the audit) —
//   Refine the local_pca_dosage candidate list into haplotype regimes.
//
// This page is the short-mode-only counterpart to haplotype_regimes
// (long-range / het-skeleton). The user has already promoted candidates
// in local_pca_dosage; this page wraps each candidate as a pipeline
// pseudo-locus and runs Cluster 2 (breadth voting) + Cluster 3
// (regime refinement + topology + genome-scale + annotation +
// serialise) against them.
//
// FLOW:
//   1. mount() resolves scrubber_main for atlasState.shared.activeChrom.
//   2. _buildLegacyState builds the legacy-shape state (sign-align
//      arrays warm-started from local_pca_dosage when present).
//   3. computePC1Signs + computePC2Signs ensure sign arrays match this
//      data pointer.
//   4. wireCtxCallbacks builds the per-window K-means cache + L2
//      envelope map + canonical state._regimesCtx.
//   5. state._regimesMode = 'short' is forced so wireActionBar wires
//      a single-mode page (no long/het toggle visible).
//   6. wireActionBar wires the buttons (build regimes / auto-merge /
//      export catalogue / focal seed).
//   7. Cross-mount stash slot is `inv._candidate_regimes_stash`
//      (namespaced by state._pageId) so it doesn't collide with
//      haplotype_regimes' own stash.
//
// Shares 13 sibling modules with haplotype_regimes via the
// haplotype_regimes/ folder. The shared modules are agnostic to which
// page is mounting them — they key off state._pageId and the absence
// or presence of #rgModeBar in the DOM.
// =============================================================================

import { computePC1Signs, computePC2Signs }
  from '../../shared/page1_data_helpers.js';

import { setStatus }
  from '../discovery/haplotype_regimes/util.js';
import { wireCtxCallbacks }
  from '../discovery/haplotype_regimes/pipeline_ctx.js';
import { wireActionBar }
  from '../discovery/haplotype_regimes/action_bar.js';
import { afterPipelineRun }
  from '../discovery/haplotype_regimes/run_pipeline.js';
import {
  applyViewToggle,
  renderRegimesSummary,
} from '../discovery/haplotype_regimes/regimes_summary.js';
import { loadPersistedCandidatesForChrom }
  from '../discovery/local_pca_dosage/candidates.js';

// ---------------------------------------------------------------------------
// Page-local state. Set on mount, cleared on unmount.
// ---------------------------------------------------------------------------

let _pageState = null;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------------

export async function mount(root, atlasState, registry) {
  const state = _buildLegacyState(atlasState);
  state._atlasState = atlasState;
  state._pageId = 'candidate_regimes';   // namespaces stash slot + localStorage
  state._regimesMode = 'short';           // forced — no mode toggle on this page
  _pageState = state;

  const chrom = atlasState.shared && atlasState.shared.activeChrom;
  if (!chrom) {
    setStatus(root, 'no chromosome selected — pick one from the toolbar');
    return;
  }

  // Resolve the per-window data for the active chromosome.
  let data;
  try {
    data = await registry.resolve('scrubber_main', { chrom });
  } catch (e) {
    setStatus(root, `failed to load scrubber_main: ${e.message}`);
    return;
  }
  state.data = data;
  state.activeChrom = chrom;

  // PC1/PC2 sign-align (chrom-swap-safe).
  if (!state.pc1Sign || state.pc1Sign.length !== data.windows.length) {
    computePC1Signs(state);
  }
  if (!state.pc2Sign || state.pc2Sign.length !== data.windows.length) {
    computePC2Signs(state);
  }

  // Per-window K-means + BQ caches + canonical ctx.
  wireCtxCallbacks(state, atlasState);

  // Wire the action bar. The bar will detect the absence of #rgModeBar
  // and skip mode-bar wiring; state._regimesMode is already set to
  // 'short' from above.
  wireActionBar(root, state, atlasState);

  // Cross-mount restore (namespaced slot).
  const inv = atlasState.inversion;
  const stash = inv && inv._candidate_regimes_stash;
  if (stash && stash.chrom === chrom && stash.result) {
    try {
      state._regimesResult = stash.result;
      state._regimesOpts   = stash.opts || {};
      afterPipelineRun(root, state, stash.result, stash.opts || {});
      setStatus(root,
        `restored ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples ` +
        `· cached candidate-regimes result (re-run to refresh)`);
      try { renderRegimesSummary(root, state); }
      catch (e) { console.warn('[remount] renderRegimesSummary:', e); }
      try { applyViewToggle(root, state); }
      catch (e) { console.warn('[remount] applyViewToggle:', e); }
      return;
    } catch (e) {
      console.warn('[remount] afterPipelineRun replay threw —', e);
    }
  }

  // Initial status: hint at the next action.
  let candList = (inv && inv._local_pca_dosage_state && inv._local_pca_dosage_state.candidateList)
    || [];
  // Cold-reload fallback: the in-memory bridge is only populated once
  // local_pca_dosage has mounted this session. Read persisted candidates
  // straight from localStorage (keyed by data.chrom) so the count is right
  // even when the user jumped straight here after a reload. See
  // candidates.js#loadPersistedCandidatesForChrom.
  if (candList.length === 0 && data && data.chrom) {
    candList = loadPersistedCandidatesForChrom(data.chrom);
  }
  const onChrom = candList.filter(c => c &&
    (!c.chrom || c.chrom === chrom || (data && c.chrom === data.chrom)));
  if (onChrom.length === 0) {
    setStatus(root,
      `loaded ${chrom} · ${data.n_windows} windows · 0 candidates yet. `
      + `Promote candidates in local_pca_dosage first (lock colors → ★ promote).`);
  } else {
    setStatus(root,
      `loaded ${chrom} · ${data.n_windows} windows · `
      + `${onChrom.length} candidate${onChrom.length === 1 ? '' : 's'} ready — click "build regimes".`);
  }
}

export async function unmount(root) {
  if (_pageState && typeof _pageState._regimesTeardownKeyboard === 'function') {
    try { _pageState._regimesTeardownKeyboard(); }
    catch (e) { console.warn('[candidate_regimes.unmount] keyboard teardown threw —', e); }
    _pageState._regimesTeardownKeyboard = null;
  }
  _pageState = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  legacy.shared = atlasState.shared || {};
  legacy.regimesPanel = null;
  legacy.tracked = inv.tracked || new Set();
  legacy.linesColorMode = inv.linesColorMode || 'kmeans';

  // Sign-align defaults aligned with state.js (both flips on).
  const stash = inv._local_pca_dosage_state || null;
  legacy.flipPC1 = (inv.flipPC1 !== undefined) ? !!inv.flipPC1 : true;
  legacy.flipPC2 = (inv.flipPC2 !== undefined) ? !!inv.flipPC2 : true;
  legacy.pc1Sign = (stash && stash.pc1Sign) || inv.pc1Sign || null;
  legacy.pc2Sign = (stash && stash.pc2Sign) || inv.pc2Sign || null;

  // Surface the candidate list at top-level for the renderer.
  legacy.candidateList = (stash && Array.isArray(stash.candidateList))
    ? stash.candidateList
    : (Array.isArray(inv.candidateList) ? inv.candidateList : []);
  return legacy;
}
