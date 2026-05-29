// pages/discovery/het_skeletons.js
// =============================================================================
// het_skeletons (2026-05-29 split from haplotype_regimes) —
//   Het-skeleton haplotype regimes (Cluster 1 Path B seed builder).
//
// This is the het-skeleton counterpart to haplotype_regimes (long-range
// V-walker) and candidate_regimes (short-range curated list). All three
// share the haplotype_regimes/ module stack; this page just forces
// state._regimesMode = 'het' and omits the #rgModeBar so the action bar
// wires a single-method page.
//
// FLOW mirrors haplotype_regimes.js:
//   1. mount() resolves scrubber_main for atlasState.shared.activeChrom.
//   2. _buildLegacyState builds the legacy-shape state.
//   3. computePC1Signs + computePC2Signs (chrom-swap-safe).
//   4. wireCtxCallbacks builds the per-window K-means + BQ caches + ctx.
//   5. state._regimesMode = 'het' forced before wireActionBar.
//   6. Cross-mount stash slot is inv._het_skeletons_stash (namespaced by
//      state._pageId) so it never collides with the other two pages.
// =============================================================================

import { computePC1Signs, computePC2Signs } from '../../shared/page1_data_helpers.js';

import { setStatus } from './haplotype_regimes/util.js';
import { wireCtxCallbacks } from './haplotype_regimes/pipeline_ctx.js';
import { wireActionBar } from './haplotype_regimes/action_bar.js';
import { afterPipelineRun } from './haplotype_regimes/run_pipeline.js';
import { wireRegimeFigureExportButtons } from './haplotype_regimes/figure_export_buttons.js';
import {
  applyViewToggle,
  renderRegimesSummary,
} from './haplotype_regimes/regimes_summary.js';
import { installDosageChunkFetcher } from '../../shared/dosage_chunks.js';
import {
  buildHetDosagePanel,
  drawHetDosagePanel,
  wireHetDosageToggle,
} from './haplotype_regimes/het_dosage_pc1_panel.js';

let _pageState = null;

export async function mount(root, atlasState, registry) {
  const state = _buildLegacyState(atlasState);
  state._atlasState = atlasState;
  state._pageId = 'het_skeletons';   // namespaces stash slot + localStorage keys
  state._regimesMode = 'het';        // forced — no mode toggle on this page
  _pageState = state;

  const chrom = atlasState.shared && atlasState.shared.activeChrom;
  if (!chrom) {
    setStatus(root, 'no chromosome selected — pick one from the toolbar');
    return;
  }

  let data;
  try {
    data = await registry.resolve('scrubber_main', { chrom });
  } catch (e) {
    setStatus(root, `failed to load scrubber_main: ${e.message}`);
    return;
  }
  state.data = data;
  state.activeChrom = chrom;

  if (!state.pc1Sign || state.pc1Sign.length !== data.windows.length) {
    computePC1Signs(state);
  }
  if (!state.pc2Sign || state.pc2Sign.length !== data.windows.length) {
    computePC2Signs(state);
  }

  wireCtxCallbacks(state, atlasState);
  wireActionBar(root, state, atlasState);

  try { wireRegimeFigureExportButtons(root, state); }
  catch (e) { console.warn('[mount] wireRegimeFigureExportButtons threw —', e); }

  // 2026-05-29: het-specific PC1-dosage panel. The regimes pages don't wire
  // the dosage-chunk fetcher (it lives on local_pca_dosage), so install it
  // here against this page's scrubber_main data (which carries the same
  // dosage_chunks layer). The fetcher is lazy: the first
  // perSampleValuesForMode('dosage') call inside drawHetDosagePanel triggers
  // a chrom-span fetch and returns NaN (grey lines); onLoad re-draws with the
  // page-1 ramp colours filled in. Focal-independent, so it runs once here
  // and survives the stash-restore early-returns below.
  try {
    buildHetDosagePanel(state);
    wireHetDosageToggle(root, state, { onChange: () => { try { drawHetDosagePanel(state); } catch (_) {} } });
    installDosageChunkFetcher(state, { onLoad: () => { try { drawHetDosagePanel(state); } catch (_) {} } });
    drawHetDosagePanel(state);
  } catch (e) { console.warn('[mount] het dosage panel wiring threw —', e); }

  // Cross-mount restore (namespaced slot).
  const stash = atlasState.inversion && atlasState.inversion._het_skeletons_stash;
  if (stash && stash.chrom === chrom && stash.result) {
    try {
      state._regimesResult = stash.result;
      state._regimesOpts   = stash.opts || {};
      afterPipelineRun(root, state, stash.result, stash.opts || {});
      setStatus(root,
        `restored ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples ` +
        `· cached het-skeleton result (re-run to refresh)`);
      try { renderRegimesSummary(root, state); }
      catch (e) { console.warn('[remount] renderRegimesSummary:', e); }
      try { applyViewToggle(root, state); }
      catch (e) { console.warn('[remount] applyViewToggle:', e); }
      return;
    } catch (e) {
      console.warn('[remount] afterPipelineRun replay threw —', e);
    }
  }

  setStatus(root, `loaded ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples · ready — run pipeline for het-skeleton seeds`);
}

export async function unmount(root) {
  if (_pageState && typeof _pageState._regimesTeardownKeyboard === 'function') {
    try { _pageState._regimesTeardownKeyboard(); }
    catch (e) { console.warn('[het_skeletons.unmount] keyboard teardown threw —', e); }
    _pageState._regimesTeardownKeyboard = null;
  }
  _pageState = null;
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  legacy.shared = atlasState.shared || {};
  legacy.regimesPanel = null;
  legacy.tracked = inv.tracked || new Set();
  legacy.linesColorMode = inv.linesColorMode || 'kmeans';

  const stash = inv._local_pca_dosage_state || null;
  legacy.flipPC1 = (inv.flipPC1 !== undefined) ? !!inv.flipPC1 : true;
  legacy.flipPC2 = (inv.flipPC2 !== undefined) ? !!inv.flipPC2 : true;
  legacy.pc1Sign = (stash && stash.pc1Sign) || inv.pc1Sign || null;
  legacy.pc2Sign = (stash && stash.pc2Sign) || inv.pc2Sign || null;
  return legacy;
}
