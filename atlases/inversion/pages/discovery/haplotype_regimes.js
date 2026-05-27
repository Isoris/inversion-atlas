// pages/discovery/haplotype_regimes.js
// =============================================================================
// haplotype_regimes (was page22, renamed 2026-05-16) —
//   Long-range haplotype regimes (Stage 4 bruteforce projection)
//
// Wires the v3.4 banding pipeline into the atlas-core shell. Hosts the four-
// canvas regimes_page (chrom-lanes, chrom-PC1, genome-lanes, genome-PC1) plus
// the catalogue-export action bar.
//
// FLOW (after 2026-05-27 Part C file split — see haplotype_regimes/):
//   1. mount() resolves scrubber_main for atlasState.shared.activeChrom.
//   2. _buildLegacyState builds the legacy-shape state, warm-starting
//      sign-align arrays from local_pca_dosage's stash when present.
//   3. computePC1Signs + computePC2Signs (page1_data_helpers) ensure
//      sign arrays match this data pointer (chrom-swap-safe).
//   4. wireCtxCallbacks (haplotype_regimes/pipeline_ctx.js) builds the
//      per-window K-means cache, band-quality cache, L2 envelope map,
//      and the canonical state._regimesCtx the pipeline reads through.
//   5. wireActionBar (haplotype_regimes/action_bar.js) wires every
//      button → handler. The handlers dispatch into sibling modules
//      (run_pipeline, catalogue_export, promote_seed, auto_merge).
//   6. If a cross-mount stash matches the active chrom, replay
//      afterPipelineRun synchronously so the 4 panels + strip
//      reappear without re-running the slow pipeline.
//
// SCOPE NOTE: this is Phase 1 of Quentin's empirical work plan — LG28 → LG28.
//   Genome-wide projection (Phase 2/3) requires the chromosomes manifest
//   and a registry-cached version of the catalogue; out of scope here.
//
// THREE-COHORT DISCIPLINE: the catalogue tags reference_id =
// 'fClaHyb_Gar_LG' (the F1 hybrid assembly used as the coordinate system)
// and cohort_id from the active scrubber dataset. C. macrocephalus data
// uses a different reference assembly and MUST NOT be aggregated against
// gariepinus catalogue rows by interval_id at this layer.
// =============================================================================

import { computePC1Signs, computePC2Signs } from '../../shared/page1_data_helpers.js';

// Sibling modules (haplotype_regimes/ folder — 2026-05-27 Part C split).
import { setStatus } from './haplotype_regimes/util.js';
import { wireCtxCallbacks } from './haplotype_regimes/pipeline_ctx.js';
import { wireActionBar } from './haplotype_regimes/action_bar.js';
import { afterPipelineRun } from './haplotype_regimes/run_pipeline.js';
import {
  applyViewToggle,
  renderRegimesSummary,
} from './haplotype_regimes/regimes_summary.js';

// ---------------------------------------------------------------------------
// Page-local state. Set on mount, cleared on unmount. The regime panels
// access this through state.regimesPanel.
// ---------------------------------------------------------------------------

let _pageState = null;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------------

export async function mount(root, atlasState, registry) {
  // Build the legacy-shape state object the panels expect.
  const state = _buildLegacyState(atlasState);
  state._atlasState = atlasState;       // ref so afterPipelineRun can stash
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

  // 2026-05-27: ensure PC1 + PC2 sign-align arrays exist on this
  // page's state regardless of whether local_pca_dosage was visited
  // first. If a stash from local_pca_dosage was used in
  // _buildLegacyState, computePCxSigns is still cheap (a few ms per
  // chrom) and replaces it with one keyed to this exact data
  // pointer — avoids stale-pc1Sign-from-other-chrom bugs.
  if (!state.pc1Sign || state.pc1Sign.length !== data.windows.length) {
    computePC1Signs(state);
  }
  if (!state.pc2Sign || state.pc2Sign.length !== data.windows.length) {
    computePC2Signs(state);
  }

  // Build the per-window-labels bridge + ctx + caches.
  wireCtxCallbacks(state, atlasState);

  // Wire the action bar buttons (mode toggle, view toggle, run /
  // export / promote / auto-merge).
  wireActionBar(root, state, atlasState);

  // 2026-05-20: restore pipeline result from the cross-mount stash so
  // tabbing away and back doesn't wipe the user's discovered seeds /
  // loci / regimes. The stash lives on atlasState.inversion (shared
  // across routes) and is keyed by chromosome. Mount → if a stash
  // matches the active chrom, replay afterPipelineRun synchronously
  // with the stored result so all 4 panels + seed strip + L3 pairs
  // table reappear without re-running the (slow) pipeline.
  const stash = atlasState.inversion && atlasState.inversion._haplotype_regimes_stash;
  if (stash && stash.chrom === chrom && stash.result) {
    try {
      // afterPipelineRun reads from state._regimesResult downstream
      // (seeds strip, promote-seed handler, L3 pairs table, regimes
      // summary). Restore the result + opts so the replay path sees
      // exactly what the pipeline-run handler would have set.
      state._regimesResult = stash.result;
      state._regimesOpts   = stash.opts || {};
      afterPipelineRun(root, state, stash.result, stash.opts || {});
      setStatus(root,
        `restored ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples ` +
        `· cached pipeline result (re-run to refresh)`);
      try { renderRegimesSummary(root, state); }
      catch (e) { console.warn('[remount] renderRegimesSummary:', e); }
      try { applyViewToggle(root, state); }
      catch (e) { console.warn('[remount] applyViewToggle:', e); }
      return;
    } catch (e) {
      console.warn('[remount] afterPipelineRun replay threw —', e);
    }
  }

  setStatus(root, `loaded ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples · ready`);
}

export async function unmount(root) {
  // 2026-05-20: tear down the document-level arrow-key handler that
  // initRegimesPage installs via _installPageKeyboardNav. Without this,
  // every mount stacks another keydown listener on document — after N
  // tab-outs each arrow press would advance the focal seed N times.
  // The teardown closure was stashed on state by initRegimesPage; we
  // captured the state ref on mount as _pageState.
  if (_pageState && typeof _pageState._regimesTeardownKeyboard === 'function') {
    try { _pageState._regimesTeardownKeyboard(); }
    catch (e) { console.warn('[haplotype_regimes.unmount] keyboard teardown threw —', e); }
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
  legacy.regimesPanel = null;        // populated when pipeline runs
  legacy.tracked = inv.tracked || new Set();
  legacy.linesColorMode = inv.linesColorMode || 'kmeans';

  // 2026-05-27: PC1/PC2 sign-align defaults aligned with state.js
  // (flipPC1, flipPC2 both true). Reuse the precomputed sign arrays
  // from local_pca_dosage if its mount has populated them — that
  // saves the O(N) pass when the user tabs between pages on the
  // same chromosome. computePCxSigns runs after mount loads data
  // and writes legacy.pc1Sign / legacy.pc2Sign anyway, so this is
  // just a warm-start.
  const stash = inv._local_pca_dosage_state || null;
  legacy.flipPC1 = (inv.flipPC1 !== undefined) ? !!inv.flipPC1 : true;
  legacy.flipPC2 = (inv.flipPC2 !== undefined) ? !!inv.flipPC2 : true;
  legacy.pc1Sign = (stash && stash.pc1Sign) || inv.pc1Sign || null;
  legacy.pc2Sign = (stash && stash.pc2Sign) || inv.pc2Sign || null;
  return legacy;
}
