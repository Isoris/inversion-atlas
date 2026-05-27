// pages/discovery/haplotype_regimes/action_bar.js
//
// Action-bar wiring (2026-05-27 Part C extraction).
//
// Wires the bottom strip: mode toggle (long / short / het), view
// toggle (seeds / regimes), run-pipeline / export-catalogue /
// promote-seed / auto-merge buttons. All handlers either dispatch
// to a sibling module or call a callback the caller passed in.
// No business logic — pure UI plumbing.

import { runPipeline } from './run_pipeline.js';
import { exportCatalogue } from './catalogue_export.js';
import { promoteFocalSeed } from './promote_seed.js';
import { runAutoMerge } from './auto_merge.js';
import { renderL3PairsTable } from './l3_pairs_table.js';
import { renderSeedsStrip } from './seeds_strip.js';
import { applyViewToggle } from './regimes_summary.js';
import { setStatus } from './util.js';

/**
 * Idempotent action-bar wiring. The legacy implementation lived
 * inline in haplotype_regimes.js as `_wireActionBar(root, state,
 * atlasState)`; same signature here.
 *
 * Reads/writes localStorage keys:
 *   - haplotype_regimes.mode  → state._regimesMode
 *   - haplotype_regimes.view  → state._regimesView
 */
export function wireActionBar(root, state, atlasState) {
  const runBtn            = root.querySelector('#rgRunPipelineBtn');
  const exportBtn         = root.querySelector('#rgExportCatalogueBtn');
  const promoteBtn        = root.querySelector('#rgPromoteSeedBtn');
  const autoMergeBtn      = root.querySelector('#rgAutoMergeBtn');
  const autoMergeMacroBtn = root.querySelector('#rgAutoMergeMacroBtn');

  // -------------------------------------------------------------------
  // Mode toggle. Three modes:
  //   'long'  — V-walker (runBandingPipeline Stages 1-4)
  //   'short' — curated candidates from local_pca_dosage
  //   'het'   — het-skeleton (Cluster 1 Path B)
  //
  // 2026-05-27 Part A: the candidate_regimes page forces 'short' mode
  // (no mode toggle visible). The page sets state._regimesMode before
  // wiring; we only fall through to the default + localStorage restore
  // when the mode bar exists in the DOM (i.e., haplotype_regimes is
  // mounted).
  // -------------------------------------------------------------------
  const pageId = state._pageId || 'haplotype_regimes';
  const modeKey = pageId + '.mode';
  const hasModeBar = !!root.querySelector('#rgModeBar');
  if (hasModeBar) {
    state._regimesMode = state._regimesMode || 'long';
    try {
      const saved = localStorage.getItem(modeKey);
      if (saved === 'short' || saved === 'long' || saved === 'het') {
        state._regimesMode = saved;
      }
    } catch (_) {}
  } else if (!state._regimesMode) {
    state._regimesMode = 'short';
  }
  const runBtnTooltip = (mode) => {
    if (mode === 'short') return "Build seeds from the local_pca_dosage candidate list (no auto-discovery — review what you've drafted).";
    if (mode === 'het')   return "Het-skeleton mode: per-window K-means → het_detect_candidate_band → het_track_skeleton → hom_anchor_to_het → cramers_v_merge. Then breadth voting + refineRegimesFromIntervals.";
    return "V-walker (Stage 1 + Stage 2 + Stage 3 + Stage 4) across the whole chromosome.";
  };
  const _renderL3 = () =>
    renderL3PairsTable(root, state, {
      onAfterMerge: () => runPipeline(root, state),
    });
  const modeBar = root.querySelector('#rgModeBar');
  if (modeBar) {
    modeBar.querySelectorAll('button[data-rg-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.rgMode === state._regimesMode);
      b.addEventListener('click', () => {
        state._regimesMode = b.dataset.rgMode;
        try { localStorage.setItem(modeKey, state._regimesMode); } catch (_) {}
        modeBar.querySelectorAll('button[data-rg-mode]').forEach(b2 => {
          b2.classList.toggle('active', b2 === b);
        });
        if (runBtn) runBtn.title = runBtnTooltip(state._regimesMode);
        try { _renderL3(); }
        catch (e) { console.warn('renderL3PairsTable on mode toggle:', e); }
      });
    });
    if (runBtn) runBtn.title = runBtnTooltip(state._regimesMode);
  }

  // -------------------------------------------------------------------
  // View toggle (independent of mode).
  // -------------------------------------------------------------------
  state._regimesView = state._regimesView || 'seeds';
  const viewKey = pageId + '.view';
  try {
    const savedView = localStorage.getItem(viewKey);
    if (savedView === 'seeds' || savedView === 'regimes') {
      state._regimesView = savedView;
    }
  } catch (_) {}
  const viewBar = root.querySelector('#rgViewBar');
  if (viewBar) {
    viewBar.querySelectorAll('button[data-rg-view]').forEach(b => {
      b.classList.toggle('active', b.dataset.rgView === state._regimesView);
      b.addEventListener('click', () => {
        state._regimesView = b.dataset.rgView;
        try { localStorage.setItem(viewKey, state._regimesView); } catch (_) {}
        viewBar.querySelectorAll('button[data-rg-view]').forEach(b2 => {
          b2.classList.toggle('active', b2 === b);
        });
        try { applyViewToggle(root, state); }
        catch (e) { console.warn('applyViewToggle:', e); }
      });
    });
  }
  // Initial visibility.
  try { applyViewToggle(root, state); }
  catch (e) { console.warn('applyViewToggle init:', e); }

  // -------------------------------------------------------------------
  // Button handlers.
  // -------------------------------------------------------------------
  const onRefresh = () => {
    try { renderSeedsStrip(root, state); } catch (_) {}
    try { _renderL3(); } catch (_) {}
  };

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      try { await runPipeline(root, state); }
      catch (e) {
        console.error('run-pipeline click failed:', e);
        setStatus(root, `run-pipeline failed: ${e && e.message ? e.message : e}`);
      }
    });
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportCatalogue(state, atlasState);
    });
  }
  if (promoteBtn) {
    promoteBtn.addEventListener('click', async () => {
      try { await promoteFocalSeed(root, state, atlasState); }
      catch (e) {
        console.error('promote-seed failed:', e);
        setStatus(root, `promote-seed failed: ${e.message}`);
      }
    });
  }
  if (autoMergeBtn) {
    autoMergeBtn.addEventListener('click', async () => {
      try { await runAutoMerge(root, state, atlasState, 'local', { onRefresh }); }
      catch (e) {
        console.error('auto-merge V failed:', e);
        setStatus(root, `auto-merge V failed: ${e.message}`);
      }
    });
  }
  if (autoMergeMacroBtn) {
    autoMergeMacroBtn.addEventListener('click', async () => {
      try { await runAutoMerge(root, state, atlasState, 'macrostripe', { onRefresh }); }
      catch (e) {
        console.error('auto-merge V macrostripe failed:', e);
        setStatus(root, `auto-merge V macrostripe failed: ${e.message}`);
      }
    });
  }
}
