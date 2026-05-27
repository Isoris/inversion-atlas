// pages/discovery/haplotype_regimes.js
// =============================================================================
// haplotype_regimes (was page22, renamed 2026-05-16) —
//   Long-range haplotype regimes (Stage 4 bruteforce projection)
//
// Wires the v3.4 banding pipeline into the atlas-core shell. Hosts the four-
// canvas regimes_page (chrom-lanes, chrom-PC1, genome-lanes, genome-PC1) plus
// the catalogue-export action bar.
//
// FLOW:
//   1. mount() resolves scrubber_main for atlasState.shared.activeChrom.
//   2. Builds a pipeline ctx that bridges atlas-side data:
//        getLabels(w)       — K-means labels at window w (per-L2 clustering,
//                              cached via ClusterCache)
//        getK(w)            — number of bands at w (= cl.K from clusterL2)
//        getBandQuality(w)  — band_quality at w (from data.windows[w])
//        getL2Idx(w)        — windowToL2[w] (built by buildIndexes)
//        isWindowValid(w)   — K(w) >= 2
//        n_samples          — data.n_samples
//        chromosomes        — single-chrom array; this page is per-chromosome
//
//   3. The "run pipeline" button calls runBandingPipeline(ctx, opts) and
//      pushes the result into state.regimesPanel via initRegimesPage().
//
//   4. The "export catalogue" button serializes the result via
//      buildCatalogue() and triggers a download of the three files.
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

import { contextFromState, ClusterCache } from '../../shared/per_l2_cluster.js';
import { computePC1Signs, computePC2Signs } from '../../shared/page1_data_helpers.js';
import { alignLabels } from '../../shared/hungarian.js';
import { buildContingency, cramersV } from '../../shared/contingency.js';
import { runCramersVMergeLocal, runCramersVMergeMacrostripe, computeAdjacentSeedMerges } from '../../shared/cramers_v_merge.js';

// Per-window K-means primitive (Cluster 1 Path B + foundation for all paths).
// The band_tracking/index.js header is explicit: per-window K-means via
// getLabels/getK callbacks, NEVER L2-broadcast. The previous wiring routed
// through clusterL2 which returned the same labels for every window in an
// L2 envelope — useless for the contingency walker because adjacent
// windows inside the same L2 trivially shared labels.
import { kmeans1D, adaptiveK1D } from '../../shared/kmeans.js';

// band_quality scorer — silhouette + size-balance + eig-ratio per window.
// Data producers don't ship band_quality; we derive it once per chromosome
// load against the per-window K-means labels. Without this, the V-walker's
// anchor gate (min_anchor_band_quality = 0.50) rejects every window → 0
// seeds detected in 20-50 ms.
// (BAND_QUALITY_DEFAULTS already imported above for the legacy band_quality
// wiring commit; not re-imported here.)

// Cluster 1 Path B (het-skeleton) — find HET bands per window, walk the
// skeleton, define bp intervals, HOM anchors per skeleton, fuse adjacent
// intervals via Cramér's V merge.
import {
  het_detect_candidate_band,
  het_track_skeleton,
  het_define_interval,
  HET_DEFAULTS,
} from '../../shared/band_tracking/het.js';
import { hom_anchor_to_het, HOM_DEFAULTS }
  from '../../shared/band_tracking/hom.js';

// Cluster 2 (voting orchestrator). Mode 1 (V-walker) already does this
// inside runBandingPipeline; Modes 2 + 3 call it explicitly.
import {
  runBreadthVoting,
  buildVotersFromSeedLoci,
  buildTargetsFromStage3Loci,
  BREADTH_VOTING_DEFAULTS,
} from '../../shared/band_tracking/breadth_voting.js';

// Cluster 3 (post-voting on this page).
import {
  refineRegimesFromIntervals,
  intervalSampleCore,
} from '../../shared/band_tracking/haplotype_regime.js';
import {
  buildRegimeTopologyGraph,
  findChromosomeRegimeChains,
  serializeRegimesToJson,
} from '../../shared/band_tracking/regime_topology.js';
import {
  mergePerChromosomeRegimes,
  crossChromosomeRegimeLinks,
} from '../../shared/band_tracking/genome_scale.js';
import { annotateRegimePositions }
  from '../../shared/regime_annotation/positional.js';
import { annotateRegimeStructures }
  from '../../shared/regime_annotation/structure.js';

// Sample-color resolution is now in shared/sample_color.js. The regimes
// panels pass their own state to resolveSampleScopeColor, so this
// module no longer needs to set local_pca_dosage's _pageState as a side effect.
// Page-isolation per specs_todo/SPEC_registry_write_and_page_isolation.md.

// Pipeline core (audited v3.4)
import { runBandingPipeline, BANDING_PIPELINE_DEFAULTS }
  from '../../shared/band_tracking/banding_pipeline.js';

// band_quality scorer — computes silhouette + size-balance + eig-ratio
// per window. Data producers do NOT ship band_quality on window objects;
// without this the chain walk + seed discovery see 0 for every window
// and the pipeline exits in 20-50 ms with "0 seeds detected". See
// STAGE_B_v3_NOTES §2 + PIPELINE_WIRING_NOTES §1.
import { bandQualityForWindow, BAND_QUALITY_DEFAULTS }
  from '../../shared/band_tracking/band_quality.js';

// Catalogue serializer
import { buildCatalogue, computeKnobHash }
  from '../../shared/band_tracking/regime_catalogue.js';

// Panel modules (sibling files in haplotype_regimes/)
import { initRegimesPage, computeGenomeView } from './haplotype_regimes/regimes_page.js';
import { regimeGroupsFromBands } from '../../shared/candidate_groups.js';
import { classifyProjection } from '../../shared/band_tracking/projection.js';
import { _dosageClassColour } from './haplotype_regimes/regimes_panel.js';

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
  state._atlasState = atlasState;       // ref so _afterPipelineRun can stash
  _pageState = state;

  const chrom = atlasState.shared && atlasState.shared.activeChrom;
  if (!chrom) {
    _setStatus(root, 'no chromosome selected — pick one from the toolbar');
    return;
  }

  // Resolve the per-window data for the active chromosome.
  let data;
  try {
    data = await registry.resolve('scrubber_main', { chrom });
  } catch (e) {
    _setStatus(root, `failed to load scrubber_main: ${e.message}`);
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

  // Build the per-window-labels bridge (clusterL2 backed by a cache).
  _wireCtxCallbacks(state, atlasState);

  // Wire the action bar buttons.
  _wireActionBar(root, state, atlasState);

  // 2026-05-20: restore pipeline result from the cross-mount stash so
  // tabbing away and back doesn't wipe the user's discovered seeds /
  // loci / regimes. The stash lives on atlasState.inversion (shared
  // across routes) and is keyed by chromosome. Mount → if a stash
  // matches the active chrom, replay _afterPipelineRun synchronously
  // with the stored result so all 4 panels + seed strip + L3 pairs
  // table reappear without re-running the (slow) pipeline.
  const stash = atlasState.inversion && atlasState.inversion._haplotype_regimes_stash;
  if (stash && stash.chrom === chrom && stash.result) {
    try {
      // _afterPipelineRun reads from state._regimesResult downstream
      // (seeds strip, promote-seed handler, L3 pairs table, regimes
      // summary). The replay path bypasses the pipeline-run handler
      // that normally sets this slot, so we must restore it here so
      // _renderSeedsStrip + _renderRegimesSummary see the stashed
      // seeds/loci/regimes instead of an empty result.
      state._regimesResult = stash.result;
      state._regimesOpts   = stash.opts || {};
      _afterPipelineRun(root, state, stash.result, stash.opts || {});
      _setStatus(root,
        `restored ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples ` +
        `· cached pipeline result (re-run to refresh)`);
      try { _renderRegimesSummary(root, state); }
      catch (e) { console.warn('[remount] _renderRegimesSummary:', e); }
      try { _applyViewToggle(root, state); }
      catch (e) { console.warn('[remount] _applyViewToggle:', e); }
      return;
    } catch (e) {
      console.warn('[remount] _afterPipelineRun replay threw —', e);
    }
  }

  _setStatus(root, `loaded ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples · ready`);
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

/**
 * Wire ctx_callbacks for the banding pipeline. The pipeline expects
 * per-window functions; the atlas stores labels per-L2 (one set of K-means
 * labels per L2 envelope, shared across all windows in that L2). The
 * bridge looks up the L2 for w, runs clusterL2 (cached), and returns the
 * shared label array.
 */
function _wireCtxCallbacks(state, atlasState) {
  const data = state.data;
  const N = data.n_windows;

  // ---------------------------------------------------------------------
  // Clustering knobs (per state, shared with downstream consumers).
  // ---------------------------------------------------------------------
  state.k            = state.k            != null ? state.k            : 3;
  state.aggMethod    = state.aggMethod    || 'mean_pc1';
  state.kMode        = state.kMode        || 'adaptive';
  state.kRange       = state.kRange       || [2, 6];
  state.silThreshold = state.silThreshold != null ? state.silThreshold : 0.5;
  state.minNGroup    = state.minNGroup    != null ? state.minNGroup    : 5;
  state.minNWin      = state.minNWin      != null ? state.minNWin      : 5;

  // ---------------------------------------------------------------------
  // PER-WINDOW K-means cache (the load-bearing change).
  //
  // The band_tracking/index.js header is explicit:
  //   "per-window K-means labels via getLabels/getK callbacks,
  //    NEVER L2-broadcast — same per-window upgrade noted in
  //    anchor_signals.js header"
  //
  // Previously we routed through per_l2_cluster.clusterL2 which returned
  // the same labels for every window inside one L2 envelope → adjacent-
  // window contingencies were trivially 1.0 → V-walker found nothing.
  // Now: kmeans1D (or adaptiveK1D) per window directly from
  // data.windows[w].pc1. ~226 samples × ~10k windows × adaptive K=2-6 is
  // ~1-2 seconds total on real data.
  // ---------------------------------------------------------------------
  const perWinLabels = new Array(N);
  const perWinK      = new Int8Array(N);
  const kRangeLo = (state.kRange && state.kRange[0]) || 2;
  const kRangeHi = (state.kRange && state.kRange[1]) || 6;
  const useAdaptiveK = state.kMode === 'adaptive';
  const fixedK = state.k;
  let perWinComputed = 0;
  let perWinSkipped  = 0;
  for (let w = 0; w < N; w++) {
    const win = data.windows && data.windows[w];
    if (!win || !win.pc1 || win.pc1.length === 0) {
      perWinLabels[w] = null;
      perWinK[w] = 0;
      perWinSkipped++;
      continue;
    }
    let labels, K;
    if (useAdaptiveK) {
      const ak = adaptiveK1D(win.pc1, kRangeLo, kRangeHi,
                             state.silThreshold, state.minNGroup);
      if (ak != null) {
        labels = ak.labels;
        K = ak.k;
      } else {
        const fit = kmeans1D(win.pc1, kRangeLo);
        labels = fit.labels;
        K = kRangeLo;
      }
    } else {
      const fit = kmeans1D(win.pc1, fixedK);
      labels = fit.labels;
      K = fixedK;
    }
    perWinLabels[w] = labels;
    perWinK[w] = K;
    perWinComputed++;
  }
  state._regimesPerWinLabels = perWinLabels;
  state._regimesPerWinK      = perWinK;
  state._regimesPerWinProvenance = {
    n_windows:  N,
    n_computed: perWinComputed,
    n_skipped:  perWinSkipped,
  };

  // ---------------------------------------------------------------------
  // L2-cluster cache: KEPT for backwards compat with the L3 pairs table
  // (_renderL3PairsTable / _computePairRow read it). The PIPELINE no
  // longer routes through it.
  // ---------------------------------------------------------------------
  const windowToL2 = new Int32Array(N).fill(-1);
  if (Array.isArray(data.l2_envelopes) && data.l2_envelopes.length > 0) {
    data.l2_envelopes.forEach((env, i) => {
      const s0 = env.start_w - 1, e0 = env.end_w - 1;
      env._s0 = env._s0 != null ? env._s0 : s0;
      env._e0 = env._e0 != null ? env._e0 : e0;
      for (let w = Math.max(0, s0); w <= Math.min(N - 1, e0); w++) {
        windowToL2[w] = i;
      }
    });
  }
  state.windowToL2 = windowToL2;
  const clCtx = contextFromState(state);
  const clCache = new ClusterCache();
  state._regimesClusterCache = clCache;
  state._regimesClusterCtx   = clCtx;

  // ---------------------------------------------------------------------
  // Per-window getLabels / getK callbacks — read from the per-window
  // K-means cache, NOT the L2 cluster cache.
  // ---------------------------------------------------------------------
  const labelsForWindow = (w) => (w >= 0 && w < N) ? perWinLabels[w] : null;
  const KForWindow      = (w) => (w >= 0 && w < N) ? (perWinK[w] | 0) : 0;

  // ---------------------------------------------------------------------
  // band_quality cache — computed against PER-WINDOW labels (not
  // L2-broadcast). Producer-shipped band_quality on the window still
  // wins when present.
  // ---------------------------------------------------------------------
  const bqCache = new Float32Array(N);
  let bqProducerCount = 0;
  let bqComputedCount = 0;
  let bqZeroCount     = 0;
  for (let w = 0; w < N; w++) {
    const win = data.windows && data.windows[w];
    if (!win) { bqCache[w] = 0; bqZeroCount++; continue; }
    const shipped = (win.band_quality != null) ? win.band_quality
                  : (win.bq           != null) ? win.bq
                  : null;
    if (shipped != null && Number.isFinite(+shipped)) {
      bqCache[w] = +shipped;
      bqProducerCount++;
      continue;
    }
    const labels = perWinLabels[w];
    const K      = perWinK[w] | 0;
    if (!labels || K < 2 || !win.pc1) { bqCache[w] = 0; bqZeroCount++; continue; }
    const r = bandQualityForWindow({
      pc1:    win.pc1,
      labels,
      K,
      eig1:   Number.isFinite(win.lam1) ? win.lam1 : 0,
      eig2:   Number.isFinite(win.lam2) ? win.lam2 : 0,
    });
    bqCache[w] = Number.isFinite(r.band_quality) ? r.band_quality : 0;
    bqComputedCount++;
  }
  state._regimesBandQualityCache = bqCache;
  state._regimesBandQualityProvenance = {
    n_windows:    N,
    n_from_producer: bqProducerCount,
    n_computed:   bqComputedCount,
    n_zero:       bqZeroCount,
  };

  const bandQualityForWindow_cb = (w) =>
    (w >= 0 && w < N) ? (bqCache[w] || 0) : 0;

  // ---------------------------------------------------------------------
  // bp accessor — needed by het_define_interval. Returns center_bp when
  // available, falling back to mid-window if only start_bp/end_bp are
  // shipped, else null.
  // ---------------------------------------------------------------------
  const getBpFor = (w) => {
    const win = data.windows && data.windows[w];
    if (!win) return null;
    if (Number.isFinite(win.center_bp)) return win.center_bp;
    if (Number.isFinite(win.center_mb)) return win.center_mb * 1e6;
    if (Number.isFinite(win.start_bp) && Number.isFinite(win.end_bp)) {
      return (win.start_bp + win.end_bp) / 2;
    }
    return null;
  };
  state._regimesGetBpFor = getBpFor;

  // ---------------------------------------------------------------------
  // Pipeline ctx. getL2Idx stubbed to 0 per STAGE_B_v3_NOTES §2 — the
  // chain walk's L2-hard-stop branch is unreachable in classifier mode
  // anyway; this just makes that explicit.
  // ---------------------------------------------------------------------
  state._regimesCtx = {
    chromosomes: [{ s_window: 0, e_window: N - 1, name: state.activeChrom }],
    getLabels:      labelsForWindow,
    getK:           KForWindow,
    getBandQuality: bandQualityForWindow_cb,
    getL2Idx:       (_w) => 0,
    isWindowValid:  (w) => KForWindow(w) >= 2,
    n_samples:      data.n_samples,
    getBpFor,
  };

  // PC1 accessor for the regimes_pc1_panel.
  state._regimesGetPC1 = (w) => {
    const win = data.windows && data.windows[w];
    return win ? win.pc1 : null;
  };
}

function _wireActionBar(root, state, atlasState) {
  const runBtn            = root.querySelector('#rgRunPipelineBtn');
  const exportBtn         = root.querySelector('#rgExportCatalogueBtn');
  const promoteBtn        = root.querySelector('#rgPromoteSeedBtn');
  const autoMergeBtn      = root.querySelector('#rgAutoMergeBtn');
  const autoMergeMacroBtn = root.querySelector('#rgAutoMergeMacroBtn');
  const statusEl          = root.querySelector('#rgStatus');

  // Mode toggle. Three modes:
  //   'long'  — V-walker (runBandingPipeline Stages 1-4)
  //   'short' — curated candidates from local_pca_dosage
  //   'het'   — het-skeleton (het.js → hom.js → cramers_v_merge), 2026-05-20
  state._regimesMode = state._regimesMode || 'long';
  try {
    const saved = localStorage.getItem('haplotype_regimes.mode');
    if (saved === 'short' || saved === 'long' || saved === 'het') {
      state._regimesMode = saved;
    }
  } catch (_) {}
  const runBtnTooltip = (mode) => {
    if (mode === 'short') return "Build seeds from the local_pca_dosage candidate list (no auto-discovery — review what you've drafted).";
    if (mode === 'het')   return "Het-skeleton mode: per-window K-means → het_detect_candidate_band → het_track_skeleton → hom_anchor_to_het → cramers_v_merge. Then breadth voting + refineRegimesFromIntervals.";
    return "V-walker (Stage 1 + Stage 2 + Stage 3 + Stage 4) across the whole chromosome.";
  };
  const modeBar = root.querySelector('#rgModeBar');
  if (modeBar) {
    modeBar.querySelectorAll('button[data-rg-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.rgMode === state._regimesMode);
      b.addEventListener('click', () => {
        state._regimesMode = b.dataset.rgMode;
        try { localStorage.setItem('haplotype_regimes.mode', state._regimesMode); } catch (_) {}
        modeBar.querySelectorAll('button[data-rg-mode]').forEach(b2 => {
          b2.classList.toggle('active', b2 === b);
        });
        if (runBtn) runBtn.title = runBtnTooltip(state._regimesMode);
        try { _renderL3PairsTable(root, state); }
        catch (e) { console.warn('_renderL3PairsTable on mode toggle:', e); }
      });
    });
    if (runBtn) runBtn.title = runBtnTooltip(state._regimesMode);
  }

  // View toggle (independent of mode/seed-source). Switches the
  // below-the-fold section between the seeds strip and the
  // long-range regimes summary table. The 4 canvases stay the
  // same in both views.
  state._regimesView = state._regimesView || 'seeds';
  try {
    const savedView = localStorage.getItem('haplotype_regimes.view');
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
        try { localStorage.setItem('haplotype_regimes.view', state._regimesView); } catch (_) {}
        viewBar.querySelectorAll('button[data-rg-view]').forEach(b2 => {
          b2.classList.toggle('active', b2 === b);
        });
        try { _applyViewToggle(root, state); }
        catch (e) { console.warn('_applyViewToggle:', e); }
      });
    });
  }
  // Initial visibility: hide regimes wrap until a pipeline run populates
  // it; the seeds strip starts hidden too and shows on pipeline run.
  try { _applyViewToggle(root, state); }
  catch (e) { console.warn('_applyViewToggle init:', e); }

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      // 2026-05-20: wrap in try/catch so a throw before _runPipeline's
      // first status update doesn't silently swallow the click. Without
      // this, the user reported "run pipeline does nothing" — any
      // throw upstream of the `_setStatus(root, 'running pipeline…')`
      // line became an unhandled rejection and the status bar stayed
      // on its prior text.
      try { await _runPipeline(root, state); }
      catch (e) {
        console.error('run-pipeline click failed:', e);
        _setStatus(root, `run-pipeline failed: ${e && e.message ? e.message : e}`);
      }
    });
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      _exportCatalogue(state, atlasState);
    });
  }
  // 2026-05-20: promote-focal-seed → candidate. The handler builds a
  // candidate object from state._regimesResult.stage1.seeds[focal_idx]
  // and pushes it through the same addCandidateToList + setCandidate
  // chain that local_pca_dosage's lock-promote button uses, then
  // hash-navigates to candidate_focus. Errors are surfaced via the
  // status bar — never silently swallowed.
  if (promoteBtn) {
    promoteBtn.addEventListener('click', async () => {
      try { await _promoteFocalSeed(root, state, atlasState); }
      catch (e) {
        console.error('promote-seed failed:', e);
        _setStatus(root, `promote-seed failed: ${e.message}`);
      }
    });
  }
  // 2026-05-20: auto-merge V button — walks adjacent Stage 1 seeds,
  // groups consecutive MERGE verdicts into chains, and promotes each
  // multi-seed chain as a candidate. See _runAutoMergeCramersV below.
  if (autoMergeBtn) {
    autoMergeBtn.addEventListener('click', async () => {
      try { await _runAutoMergeCramersV(root, state, atlasState); }
      catch (e) {
        console.error('auto-merge V failed:', e);
        _setStatus(root, `auto-merge V failed: ${e.message}`);
      }
    });
  }
  // 2026-05-20: auto-merge V macrostripe button (Mode 2,
  // post_long_range). Same chain-promote logic but the walker only
  // compares seeds WITHIN each Stage 3 macrostripe — never crosses
  // locus boundaries. See _runAutoMergeCramersVMacro below.
  if (autoMergeMacroBtn) {
    autoMergeMacroBtn.addEventListener('click', async () => {
      try { await _runAutoMergeCramersVMacro(root, state, atlasState); }
      catch (e) {
        console.error('auto-merge V macrostripe failed:', e);
        _setStatus(root, `auto-merge V macrostripe failed: ${e.message}`);
      }
    });
  }
}

/**
 * Run the v3.4 banding pipeline against the active chromosome and
 * initialise the four regimes panels.
 */
async function _runPipeline(root, state) {
  // 2026-05-20: status ping at entry so the user can confirm the click
  // landed even if a precondition fails immediately. Without this, the
  // user reported "click does nothing" — debugging via the status bar
  // requires it to update on every click, not only after the first
  // _setStatus call inside a mode branch.
  _setStatus(root, 'preparing pipeline run…');
  if (!state) {
    _setStatus(root, 'pipeline: state is null — reload the page');
    return;
  }
  if (!state.data) {
    _setStatus(root, 'pipeline: no chromosome loaded — pick one from the toolbar');
    return;
  }
  const ctx = state._regimesCtx;
  if (!ctx) {
    _setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }
  // Dispatch on mode. Long = V-walker; Short = curated candidates;
  // Het = het-skeleton (per-window K-means → het → hom → cramers_v_merge).
  if (state._regimesMode === 'het') {
    _setStatus(root, 'building het-skeleton seeds…');
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    let result = null;
    try { result = _buildHetSkeletonResult(state); }
    catch (e) {
      console.error('het-skeleton build threw:', e);
      _setStatus(root, `het-skeleton failed: ${e.message}`);
      return;
    }
    const ms = (performance.now() - t0).toFixed(0);
    if (!result || !result.stage3 || result.stage3.loci.length === 0) {
      _setStatus(root,
        `het-skeleton: 0 intervals on this chrom. Check console for ` +
        `per-window K-means + HET-detection diagnostics.`);
      return;
    }
    // Cluster 2 + Cluster 3 tail.
    try { _runPostSeedingTail(root, state, result, 'het', ms); }
    catch (e) {
      console.error('post-seeding tail (het) threw:', e);
      _setStatus(root, `post-seeding failed: ${e.message}`);
    }
    return;
  }
  if (state._regimesMode === 'short') {
    _setStatus(root, 'building short-range seeds from candidate list…');
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    let result = null;
    try { result = _buildShortRangeResult(state); }
    catch (e) {
      console.error('short-range build threw:', e);
      _setStatus(root, `short-range failed: ${e.message}`);
      return;
    }
    const ms = (performance.now() - t0).toFixed(0);
    if (!result || !result.stage3 || result.stage3.loci.length === 0) {
      _setStatus(root,
        `short-range: 0 candidates on this chrom. Promote candidates in local_pca_dosage first (lock colors → ★ promote).`);
      return;
    }
    state._regimesOpts = {};
    try { _runPostSeedingTail(root, state, result, 'short', ms); }
    catch (e) {
      console.error('post-seeding tail (short) threw:', e);
      _setStatus(root, `post-seeding failed: ${e.message}`);
    }
    return;
  }
  _setStatus(root, 'running pipeline…');
  // The pipeline is synchronous and CPU-heavy; yield to the browser first
  // so the status update paints.
  await new Promise(r => setTimeout(r, 0));

  // Pre-flight diagnostic: dump band_quality distribution + a sample of
  // the first 10 values to the console. If every getBandQuality returns
  // 0 the chain walk + seed discovery exit instantly with 0 seeds; this
  // log lets the user (and us, when reading their console screenshot)
  // see exactly why.
  const bqStats = _bandQualityStats(state);
  console.log('[haplotype_regimes] band_quality stats:', bqStats);

  // Adaptive seed-discovery threshold. Default is 0.50; if fewer than
  // 5 windows pass that, lower it in steps until we have something to
  // work with. STAGE_B_v3_NOTES §2: "If band_quality is computed
  // correctly but every window is below the 0.4 default, lower the
  // threshold rather than rejecting the windows."
  const minAnchorBQ = _autoCalibrateAnchorBQ(bqStats);

  const opts = {
    stage4_scope: 'seeds_only',
    skip_stage4: false,
    seed_discovery: Object.assign({}, BANDING_PIPELINE_DEFAULTS.seed_discovery, {
      min_anchor_band_quality: minAnchorBQ,
    }),
  };

  let result;
  const t0 = performance.now();
  try {
    result = runBandingPipeline(ctx, opts);
  } catch (e) {
    console.error('runBandingPipeline threw:', e);
    _setStatus(root, `pipeline failed: ${e.message}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);

  state._regimesResult = result;
  state._regimesOpts   = opts;
  state._regimesBQStats = bqStats;

  const summary = result.summary || {};
  // Surface band_quality diagnostics in the status bar when 0 seeds —
  // otherwise the user has no way to tell whether the pipeline is
  // broken or the calibration is wrong.
  const nSeeds = summary.n_seeds_after_plateau || 0;
  if (nSeeds === 0) {
    _setStatus(root,
      `pipeline ran in ${ms}ms · 0 seeds · ` +
      `BQ: ${bqStats.n_pass_default}/${bqStats.n_windows} passed default 0.50 ` +
      `(threshold used: ${minAnchorBQ.toFixed(2)}) · ` +
      `BQ provenance: ${bqStats.provenance.n_computed} computed, ` +
      `${bqStats.provenance.n_from_producer} producer-shipped, ` +
      `${bqStats.provenance.n_zero} zero. See console for details.`);
    return;
  }
  // Seeds exist — chain through Cluster 3 (refineRegimesFromIntervals +
  // regime_topology + genome_scale aggregation + annotations + serialise).
  state._regimesOpts = opts;
  try { _runPostSeedingTail(root, state, result, 'long', ms); }
  catch (e) {
    console.error('post-seeding tail (long) threw:', e);
    _setStatus(root, `post-seeding failed: ${e.message}`);
  }
}

// 2026-05-20: shared post-pipeline render path. Both the long-range
// V-walker path and the short-range candidate-list path call this so
// the 4 panels + export/promote buttons + seeds strip all wire up the
// same way regardless of seed origin.
function _afterPipelineRun(root, state, result, opts) {
  const ctx = state._regimesCtx;
  initRegimesPage(state, {
    bandingResult:       result,
    getLabels:           ctx && ctx.getLabels,
    getK:                ctx && ctx.getK,
    getPC1:              state._regimesGetPC1,
    getMacroDosage:      null,
    classifyFn:          classifyProjection,
    classifyOpts:        (opts && opts.projection) || {},
    bandComboMode:       'additive',
    current_chromosome_idx: 0,
    enable_genome_view:  false,
  });

  const exportBtn = root.querySelector('#rgExportCatalogueBtn');
  if (exportBtn) exportBtn.disabled = false;
  const promoteBtn = root.querySelector('#rgPromoteSeedBtn');
  if (promoteBtn) {
    const nLoci = (result.stage3 && Array.isArray(result.stage3.loci))
      ? result.stage3.loci.length : 0;
    promoteBtn.disabled = nLoci === 0;
    promoteBtn.title = nLoci === 0
      ? 'No seeds discovered on this chromosome — nothing to promote.'
      : `Promote the focal seed (${nLoci} discovered) to a candidate inversion. Arrow keys cycle which seed is focal.`;
  }
  // 2026-05-20: auto-merge V button enable state. Needs ≥ 2 Stage 1
  // seeds since the walker compares adjacent pairs — a single seed has
  // no neighbour to merge with.
  const autoMergeBtn = root.querySelector('#rgAutoMergeBtn');
  const seedsArr = (result.stage1 && Array.isArray(result.stage1.seeds))
    ? result.stage1.seeds : [];
  if (autoMergeBtn) {
    autoMergeBtn.disabled = seedsArr.length < 2;
    autoMergeBtn.title = seedsArr.length < 2
      ? 'Need at least 2 Stage 1 seeds for adjacent-pair Cramér\'s V auto-merge.'
      : `Walk ${seedsArr.length - 1} adjacent seed pair${seedsArr.length - 1 === 1 ? '' : 's'}, auto-promote MERGE chains as candidates.`;
  }
  // 2026-05-20: auto-merge V macrostripe button enable state. Needs
  // ≥ 1 Stage 3 macrostripe that contains ≥ 2 Stage 1 seeds (anchor_w
  // ∈ [locus.s_window, locus.e_window]) — otherwise the within-locus
  // walker has nothing to compare.
  const autoMergeMacroBtn = root.querySelector('#rgAutoMergeMacroBtn');
  if (autoMergeMacroBtn) {
    const loci = (result.stage3 && Array.isArray(result.stage3.loci))
      ? result.stage3.loci : [];
    let nUsableLoci = 0;
    for (const locus of loci) {
      if (!locus) continue;
      const s = locus.s_window | 0;
      const e = locus.e_window | 0;
      let nInside = 0;
      for (const sd of seedsArr) {
        if (!sd) continue;
        const aw = sd.anchor_w | 0;
        if (aw >= s && aw <= e) { nInside++; if (nInside >= 2) break; }
      }
      if (nInside >= 2) nUsableLoci++;
    }
    autoMergeMacroBtn.disabled = nUsableLoci === 0;
    autoMergeMacroBtn.title = nUsableLoci === 0
      ? 'Need at least 1 Stage 3 macrostripe with ≥ 2 Stage 1 seeds inside it.'
      : `Run macrostripe-bounded V walker on ${nUsableLoci} usable locus${nUsableLoci === 1 ? '' : 'es'} (${loci.length} total).`;
  }
  try { _renderSeedsStrip(root, state); }
  catch (e) { console.warn('_renderSeedsStrip:', e); }
  _wireSeedStripFocalSync(root, state);

  // Push the initial focal seed's regime partition into shared.activeGroups
  // so popstats (and any other consumer of the groups slot) sees the
  // partition immediately, without waiting for a promote action.
  try { _pushFocalSeedGroups(state); } catch (_) {}
  // 2026-05-20: L3 adjacent-pair Cramér mini-table — visible only in
  // short-range mode. Computes V between every consecutive L2 pair
  // on the active chrom, then paints a table row per pair with a
  // [merge] action that builds a candidate spanning both L2s.
  try { _renderL3PairsTable(root, state); }
  catch (e) { console.warn('_renderL3PairsTable:', e); }

  // 2026-05-20: stash the pipeline result on atlasState so the user can
  // tab away and back without losing it. Keyed by chrom — switching
  // chroms invalidates the stash (pipeline must re-run on a new dataset).
  // result is plain JSON; getLabels/getK/getPC1 are rebuilt by
  // _wireCtxCallbacks on every mount so we don't need to stash them.
  try {
    const atlas = state && state._atlasState;
    if (atlas && atlas.inversion) {
      atlas.inversion._haplotype_regimes_stash = {
        chrom:  state.activeChrom,
        result: result,
        opts:   opts || {},
      };
    }
  } catch (e) { console.warn('[stash] write failed:', e); }
}

// =========================================================================
// L3 adjacent-L2 Cramér's V mini-table (2026-05-20)
// =========================================================================
// For each consecutive (L2_i, L2_{i+1}) on the active chromosome:
//   1. Cluster each L2 via the ClusterCache (already populated by the
//      pipeline ctx).
//   2. Hungarian-align L2_{i+1}'s labels to L2_i's K-band frame.
//   3. Build the K_a × K_b contingency table over samples present in
//      BOTH (defined-label intersect; some samples drop in some L2s).
//   4. Compute Cramér's V and render a row.
// Only painted in short-range mode (the long-range V-walker already
// surfaces the same idea via its own seed boundaries).

function _renderL3PairsTable(root, state) {
  if (!root || typeof document === 'undefined') return;
  const wrap = root.querySelector('#rgL3PairsWrap');
  const body = root.querySelector('#rgL3PairsBody');
  const countEl = root.querySelector('#rgL3PairsCount');
  if (!wrap || !body) return;
  if (state._regimesMode !== 'short') {
    wrap.style.display = 'none';
    body.innerHTML = '';
    return;
  }
  const data = state.data;
  if (!data || !Array.isArray(data.l2_envelopes) || data.l2_envelopes.length < 2) {
    wrap.style.display = 'flex';
    body.innerHTML =
      '<tr><td colspan="5" style="padding: 8px 10px; color: var(--ink-dimmer);">' +
      'Need at least 2 L2 envelopes on this chromosome to compute adjacent-pair V.' +
      '</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  wrap.style.display = 'flex';
  body.innerHTML = '';
  const envs = data.l2_envelopes;
  const cache = state._regimesClusterCache;
  const ctx   = state._regimesClusterCtx;
  if (!cache || !ctx) {
    body.innerHTML =
      '<tr><td colspan="5" style="padding: 8px 10px; color: var(--ink-dimmer);">' +
      'Cluster cache not wired — run the pipeline first.' +
      '</td></tr>';
    return;
  }
  const rows = [];
  for (let i = 0; i + 1 < envs.length; i++) {
    rows.push(_computePairRow(state, i, i + 1, envs, cache, ctx));
  }
  for (const r of rows) {
    body.appendChild(_renderPairRow(state, r));
  }
  if (countEl) countEl.textContent = `${rows.length} pair${rows.length === 1 ? '' : 's'}`;
}

function _computePairRow(state, iA, iB, envs, cache, ctx) {
  const envA = envs[iA], envB = envs[iB];
  const clA = cache.getOrCompute(ctx, iA);
  const clB = cache.getOrCompute(ctx, iB);
  if (!clA || !clA.ok || !clA.labels || !clB || !clB.ok || !clB.labels) {
    return {
      iA, iB, envA, envB,
      v: NaN, nSamples: 0, K: 0, reason: !clA?.ok ? `L2#${iA} cluster failed` : `L2#${iB} cluster failed`,
    };
  }
  // Align labelsB onto labelsA's K-band frame so cluster ids correspond.
  const K = Math.max(clA.usedK | 0, clB.usedK | 0);
  let alignedB = clB.labels;
  try {
    const aligned = alignLabels(clA.labels, clB.labels, K);
    if (aligned && aligned.aligned) alignedB = aligned.aligned;
    else if (aligned && Array.isArray(aligned)) alignedB = aligned;
  } catch (_) { /* fall through with raw labels */ }
  // Intersect samples that have valid labels in BOTH L2s. -1 = absent.
  const nS = state.data.n_samples | 0;
  const valid = [];
  for (let s = 0; s < nS; s++) {
    if (clA.labels[s] >= 0 && alignedB[s] >= 0) valid.push(s);
  }
  if (valid.length < 4) {
    return { iA, iB, envA, envB, v: NaN, nSamples: valid.length, K, reason: 'insufficient samples' };
  }
  const aSubset = new Int32Array(valid.length);
  const bSubset = new Int32Array(valid.length);
  for (let i = 0; i < valid.length; i++) {
    aSubset[i] = clA.labels[valid[i]];
    bSubset[i] = alignedB[valid[i]];
  }
  let v = NaN;
  try {
    const table = buildContingency(aSubset, bSubset, K, K);
    v = cramersV(table, K, K);
  } catch (_) {}
  return { iA, iB, envA, envB, v, nSamples: valid.length, K };
}

function _renderPairRow(state, r) {
  const tr = document.createElement('tr');
  const mbA = (r.envA && Number.isFinite(r.envA.start_bp))
    ? (r.envA.start_bp / 1e6).toFixed(2) : '—';
  const mbB = (r.envB && Number.isFinite(r.envB.end_bp))
    ? (r.envB.end_bp / 1e6).toFixed(2) : '—';
  const span = `${mbA}–${mbB} Mb`;
  let vCell, tier, vText;
  if (Number.isFinite(r.v)) {
    vText = r.v.toFixed(2);
    tier  = r.v >= 0.7 ? 'high' : r.v >= 0.4 ? 'mid' : 'low';
  } else {
    vText = '—'; tier = 'na';
  }
  const idA = (r.envA && r.envA.id) || ('L2_' + r.iA);
  const idB = (r.envB && r.envB.id) || ('L2_' + r.iB);
  tr.innerHTML =
    '<td><span style="color: var(--ink);">' + _esc(idA) + '</span> &rarr; <span style="color: var(--ink);">' + _esc(idB) + '</span></td>' +
    '<td style="color: var(--ink-dim);">' + span + '</td>' +
    '<td><span class="rg-l3-pair-v" data-tier="' + tier + '">' + vText + '</span></td>' +
    '<td style="color: var(--ink-dim);">' + (r.nSamples | 0) + '</td>' +
    '<td><button type="button" class="rg-l3-pair-merge" data-pair-a="' + r.iA +
      '" data-pair-b="' + r.iB + '" ' + (r.envA && r.envB ? '' : 'disabled') +
      ' title="Build a candidate inversion spanning both L2 envelopes. Lands in the local_pca_dosage candidate list + sets it active.">merge → candidate</button></td>';
  const btn = tr.querySelector('button.rg-l3-pair-merge');
  if (btn) {
    btn.addEventListener('click', () => _mergePairToCandidate(state, r).catch(e => {
      console.warn('merge pair failed:', e);
    }));
  }
  return tr;
}

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function _mergePairToCandidate(state, r) {
  const data = state.data;
  if (!data || !r || !r.envA || !r.envB) return;
  // The merged candidate's start_w/end_w span from envA's left edge to
  // envB's right edge. ref_window = midpoint window. K = larger of the
  // two L2s (Hungarian aligned to envA, so we use envA's K).
  const start_w = Number.isFinite(r.envA._s0) ? r.envA._s0
                : (Number.isFinite(r.envA.start_w) ? r.envA.start_w - 1 : 0);
  const end_w   = Number.isFinite(r.envB._e0) ? r.envB._e0
                : (Number.isFinite(r.envB.end_w) ? r.envB.end_w - 1 : (data.n_windows - 1));
  const start_bp = Number.isFinite(r.envA.start_bp) ? r.envA.start_bp : null;
  const end_bp   = Number.isFinite(r.envB.end_bp)   ? r.envB.end_bp   : null;
  const ref_window = Math.round((start_w + end_w) / 2);
  // Use the aligned labels at L2_A as locked_labels (the merge's
  // reference K-band assignment). The shared per_l2_cluster cache
  // already has them.
  const cl = state._regimesClusterCache && state._regimesClusterCache.getOrCompute
    ? state._regimesClusterCache.getOrCompute(state._regimesClusterCtx, r.iA)
    : null;
  const nS = data.n_samples | 0;
  const locked = new Int8Array(nS).fill(-1);
  if (cl && cl.labels) {
    for (let s = 0; s < nS; s++) {
      const k = cl.labels[s];
      if (k >= 0) locked[s] = k;
    }
  }
  const candMod = await import('./local_pca_dosage/candidates.js').catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function') {
    console.warn('candidates.js not available; cannot promote merge.');
    return;
  }
  const cand = {
    source:        'l3_pair_merge',
    chrom:         data.chrom || state.activeChrom,
    l2_indices:    [r.iA, r.iB],
    ref_l2:        r.iA,
    ref_window,
    K:             (cl && cl.usedK) || r.K || 3,
    locked_labels: locked,
    start_w, end_w,
    start_bp, end_bp,
    created_at:    Date.now(),
    notes: `Merged from L3 adjacent-pair V table (L2#${r.iA} → L2#${r.iB}, V=${
      Number.isFinite(r.v) ? r.v.toFixed(3) : '—'
    }, n=${r.nSamples}).`,
    id:            candMod.makeCandidateId(),
    _from_l3_pair: { iA: r.iA, iB: r.iB, v: r.v, n_samples: r.nSamples },
  };
  const inv = (typeof window !== 'undefined' && window.atlasState && window.atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || { data, candidate: null, candidateList: [] };
  try { candMod.addCandidateToList(page1State, cand); } catch (_) {}
  try { candMod.setCandidate(page1State, cand); } catch (_) {}
  inv._local_pca_dosage_state = page1State;
  // Re-run short-range pipeline so the new candidate shows up as a
  // seed chip in the same view.
  const rootEl = document.getElementById('haplotype_regimes');
  if (rootEl) { try { await _runPipeline(rootEl, state); } catch (_) {} }
}

// =========================================================================
// Short-range pipeline result builder (2026-05-20)
// =========================================================================
// Synthesizes a runBandingPipeline-shaped result from the local_pca_dosage
// candidate list. The 4 regime panels iterate stage3.loci, so we
// produce one locus per candidate on the active chrom; the rest of
// the result envelope (stage1.seeds, stage4 = null, summary) is
// filled in just enough for downstream renderers + the export
// catalogue to function.
//
// Each candidate → locus mapping:
//   cand.start_w, cand.end_w    → s_window, e_window
//   cand.K                       → K
//   cand.locked_labels            → per_band_samples (sample-idx Sets per band)
//   cand.ref_window               → seed.anchor_w (so the seeds strip
//                                    can anchor each chip at the cur
//                                    window the user promoted from)
//   1.0                           → min_internal_jaccard (user-defined,
//                                    perfect by construction)
//
// Filters to the active chrom so loci from other chromosomes don't
// appear when scrubbing a single chrom.
function _buildShortRangeResult(state) {
  if (!state || !state.data) return null;
  const data = state.data;
  const activeChrom = state.activeChrom || data.chrom || null;
  // Pull candidates from the local_pca_dosage stash. The stash is set
  // up at module load time via the cross-page bridge — see
  // candidates.js#setCandidate which also dual-writes to
  // inv._local_pca_dosage_state. Falls back to an empty list when no
  // candidates have been promoted yet.
  const inv = (typeof window !== 'undefined' && window.atlasState && window.atlasState.inversion)
            || {};
  const stash = inv._local_pca_dosage_state || {};
  const cands = Array.isArray(stash.candidateList) ? stash.candidateList
              : (Array.isArray(state.candidateList) ? state.candidateList : []);
  const onChrom = cands.filter(c => c && (!activeChrom || c.chrom === activeChrom));
  if (onChrom.length === 0) {
    return {
      stage1: { seeds: [], per_chrom_summary: [] },
      stage2: null,
      stage3: { loci: [] },
      stage4: null,
      summary: {
        n_seeds_after_plateau: 0,
        n_loci:                0,
        n_targets:             0,
        n_stability_upgraded:  0,
      },
    };
  }
  // Sort by start_w so the seeds strip + arrow-key navigation walk
  // left-to-right along the chromosome.
  onChrom.sort((a, b) => (a.start_w | 0) - (b.start_w | 0));
  const seeds = [];
  const loci  = [];
  for (let i = 0; i < onChrom.length; i++) {
    const c = onChrom[i];
    const s_window = c.start_w | 0;
    const e_window = c.end_w   | 0;
    const K = c.K | 0;
    // per_band_samples from locked_labels: group sample indices by band.
    const per_band_samples = [];
    const per_band_size    = new Array(K).fill(0);
    for (let b = 0; b < K; b++) per_band_samples.push(new Set());
    const labels = c.locked_labels;
    if (labels && labels.length) {
      for (let s = 0; s < labels.length; s++) {
        const k = labels[s];
        if (k >= 0 && k < K) {
          per_band_samples[k].add(s);
          per_band_size[k]++;
        }
      }
    }
    seeds.push({
      seed_id:               i,
      chromosome_idx:        0,
      anchor_w:              Number.isFinite(c.ref_window) ? c.ref_window | 0 : Math.round((s_window + e_window) / 2),
      anchor_band_quality:   1.0,    // user-curated
      K_a:                   K,
      anchor_labels:         null,
      n_tracked:             labels ? labels.length : 0,
      s_window,
      e_window,
      n_windows:             e_window - s_window + 1,
      classifications:       null,
      classifications_s_window: s_window,
      v_track:               null,
      h_off_track:           null,
      track_s_window:        s_window,
      track_e_window:        e_window,
      hit_left_edge:         false,
      hit_right_edge:        false,
    });
    loci.push({
      seed_id:                i,
      chromosome_idx:         0,
      s_window,
      e_window,
      K,
      chain:                  { s: s_window, e: e_window, K },
      per_band_samples,
      per_band_size,
      per_band_first_size:    per_band_size.slice(),
      n_samples_dropped:      0,
      band_set_aggregation:   'short_range_promote',
      n_unreliable_skipped:   0,
      min_internal_jaccard:   1.0,
      stage2_verdict:         null,
      stage2_linkage_group:   null,
    });
  }
  return {
    stage1: { seeds, per_chrom_summary: [{ chr: 0, n_seeds: seeds.length }] },
    stage2: null,
    stage3: { loci },
    stage4: null,
    summary: {
      n_seeds_after_plateau: seeds.length,
      n_loci:                loci.length,
      n_targets:             0,
      n_stability_upgraded:  0,
    },
  };
}

// =========================================================================
// Seeds inspector strip (2026-05-20)
// =========================================================================
// Horizontal scrollable chip list at the top of the page, one chip per
// Stage 3 locus (the panels iterate stage3.loci, so the chip indexes
// match what arrow keys + ★ promote target). Click a chip to set
// state.regimesPanel.focal.seed_index + repaint the 4 panels. Hover a
// chip to see the full anchor/span tooltip. The active chip is
// accent-filled; others are panel-2.
//
// Bonus columns on each chip:
//   #N     — seed list index (1-based for readability)
//   ●      — color-dot from band_quality / min_internal_jaccard
//            (greener = stronger structural signal)
//   X Mb   — anchor center in Mb (from data.windows[anchor_w].center_mb)
//   Nw     — n_windows the locus spans

function _renderSeedsStrip(root, state) {
  if (!root || typeof document === 'undefined') return;
  const wrap = root.querySelector('#rgSeedsStripWrap');
  const list = root.querySelector('#rgSeedsStripList');
  const interpret = root.querySelector('#rgInterpretDrawer');
  if (!wrap || !list) return;
  const result = state && state._regimesResult;
  const loci   = result && result.stage3 && Array.isArray(result.stage3.loci)
    ? result.stage3.loci : [];
  const seeds  = result && result.stage1 && Array.isArray(result.stage1.seeds)
    ? result.stage1.seeds : [];
  if (loci.length === 0) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    if (interpret) interpret.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  // 2026-05-20: surface the interpretation drawer alongside the seeds
  // strip — both appear/disappear in lock-step with pipeline results.
  if (interpret) interpret.style.display = '';
  const data = state.data;
  const wins = (data && Array.isArray(data.windows)) ? data.windows : null;
  const focal = (state.regimesPanel && state.regimesPanel.focal
                 && Number.isFinite(state.regimesPanel.focal.seed_index))
    ? state.regimesPanel.focal.seed_index | 0 : 0;
  // Rebuild the chip list.
  list.innerHTML = '';
  for (let i = 0; i < loci.length; i++) {
    const locus = loci[i];
    if (!locus) continue;
    const seed = (Number.isFinite(locus.seed_id) && seeds[locus.seed_id]) ? seeds[locus.seed_id] : null;
    const anchorW = seed && Number.isFinite(seed.anchor_w)
      ? seed.anchor_w | 0
      : Math.round((locus.s_window + locus.e_window) / 2);
    const mb = (wins && wins[anchorW] && Number.isFinite(wins[anchorW].center_mb))
      ? wins[anchorW].center_mb : null;
    const nw = (locus.e_window - locus.s_window + 1) | 0;
    const quality = seed && Number.isFinite(seed.anchor_band_quality)
      ? seed.anchor_band_quality
      : (Number.isFinite(locus.min_internal_jaccard) ? locus.min_internal_jaccard : 0.5);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rg-seed-chip' + (i === focal ? ' active' : '');
    chip.dataset.seedIdx = String(i);
    chip.title = [
      `seed #${i} (id=${locus.seed_id != null ? locus.seed_id : '?'})`,
      `anchor: window ${anchorW}${mb != null ? ` · ${mb.toFixed(3)} Mb` : ''}`,
      `span: ${nw} windows (${locus.s_window}–${locus.e_window})`,
      `K: ${locus.K | 0}`,
      `min internal jaccard: ${
        Number.isFinite(locus.min_internal_jaccard) ? locus.min_internal_jaccard.toFixed(3) : '—'
      }`,
      locus.stage2_verdict ? `stage2 verdict: ${locus.stage2_verdict}` : null,
      'Click to make this seed focal (arrow keys also navigate).',
    ].filter(Boolean).join('\n');
    chip.innerHTML =
      '<span class="rg-seed-dot" style="background:' + _qualityDotColor(quality) + ';"></span>' +
      '<span class="rg-seed-idx">#' + i + '</span>' +
      '<span class="rg-seed-meta">' +
        (mb != null ? mb.toFixed(2) + ' Mb · ' : '') +
        nw + 'w' +
      '</span>';
    chip.addEventListener('click', () => _focusSeedFromChip(state, i));
    list.appendChild(chip);
  }
}

function _qualityDotColor(q) {
  // 0..1 → red → amber → green. Anything ≥ 0.7 is green; ≥ 0.4 is amber; below is red.
  if (!Number.isFinite(q)) return '#5a6472';
  if (q >= 0.7) return '#3cc08a';
  if (q >= 0.4) return '#f5a524';
  return '#e0555c';
}

/**
 * Push the focal seed's per-band partition into atlasState.shared.activeGroups.
 *
 * The Stage 3 locus carries `per_band_samples` — `Array<Set<sample_idx>>` —
 * which is the canonical regime-band partition. We convert it to a flat
 * Int8Array of band-index-per-sample (same shape candidate.locked_labels
 * uses) and feed it through `regimeGroupsFromBands` so popstats and any
 * other consumer of `shared.activeGroups` picks up the partition without
 * needing to know about the regimes-pipeline internals.
 *
 * Fires on three entry points:
 *   - _afterPipelineRun (initial seed becomes focal after pipeline finishes)
 *   - _focusSeedFromChip (user clicks a different seed chip)
 *   - _wireSeedStripFocalSync (arrow-key cycle through seeds)
 *
 * No-op when nothing meaningful to push (no atlasState, no result, no
 * focal index, no per_band_samples on the locus).
 */
function _pushFocalSeedGroups(state) {
  const atlasState = state && state._atlasState;
  if (!atlasState || typeof atlasState.setActiveGroups !== 'function') return;
  const rp = state.regimesPanel;
  if (!rp || !rp.focal || !Number.isFinite(rp.focal.seed_index)) return;
  const focalIdx = rp.focal.seed_index | 0;
  const loci = state._regimesResult && state._regimesResult.stage3
            && state._regimesResult.stage3.loci;
  if (!Array.isArray(loci) || focalIdx < 0 || focalIdx >= loci.length) return;
  const locus = loci[focalIdx];
  if (!locus || !Array.isArray(locus.per_band_samples)) return;
  const data = state.data;
  if (!data || !Array.isArray(data.samples) || !Number.isFinite(data.n_samples)) return;

  // Flatten per_band_samples (Array<Set<sample_idx>>) → Int8Array per sample.
  // Same conversion the promote path uses (see _promoteFocalSeed); kept inline
  // here so this helper has no side effects on the promote module.
  const nS = data.n_samples | 0;
  const bandPerSample = new Array(nS).fill(-1);
  for (let b = 0; b < locus.per_band_samples.length; b++) {
    const set = locus.per_band_samples[b];
    if (!set || typeof set.forEach !== 'function') continue;
    set.forEach((si) => { if (si >= 0 && si < nS) bandPerSample[si] = b; });
  }

  const derived = regimeGroupsFromBands(bandPerSample, data, { labelStyle: 'server' });
  if (derived && derived.groups) {
    try { atlasState.setActiveGroups(derived.groups); }
    catch (e) { console.warn('haplotype_regimes: setActiveGroups threw —', e); }
  }
}

function _focusSeedFromChip(state, idx) {
  if (!state || !state.regimesPanel || !state.regimesPanel.focal) return;
  const loci = state._regimesResult && state._regimesResult.stage3
            && state._regimesResult.stage3.loci;
  if (!Array.isArray(loci) || idx < 0 || idx >= loci.length) return;
  const rp = state.regimesPanel;
  rp.focal.seed_index = idx;
  _pushFocalSeedGroups(state);
  // Reset band_mask to the first available subset for the new locus.
  rp.focal.band_mask = 1;
  // If the new seed lives on a different chromosome, snap chrom panels too.
  const newChr = loci[idx].chromosome_idx;
  if (newChr != null && newChr !== rp.current_chromosome_idx) {
    rp.current_chromosome_idx = newChr;
    if (state._regimesGenomeState) {
      state._regimesGenomeState.regimesPanel.current_chromosome_idx = newChr;
    }
    rp.track = null;
  }
  // Update active-chip styling synchronously so the visual feedback is
  // instant; the 4 panels repaint via window._refreshRegimesPanels which
  // initRegimesPage installs as a global re-render entry point.
  const list = document.getElementById('rgSeedsStripList');
  if (list) {
    list.querySelectorAll('.rg-seed-chip').forEach(c => {
      c.classList.toggle('active', (c.dataset.seedIdx | 0) === idx);
    });
  }
  // Re-paint by re-running initRegimesPage's draw chain — simplest
  // available API. The pipeline result + ctx are still cached on state
  // from the last _runPipeline.
  if (typeof window !== 'undefined' && typeof window._refreshRegimesPanels === 'function') {
    try { window._refreshRegimesPanels(state); } catch (_) {}
  } else {
    // Fallback: bump the focal & rely on the next user gesture to repaint.
    // The arrow-key handler also re-renders directly when fired; the
    // strip-click path mirrors that via the global hook above.
  }
}

// Sync the strip's active chip with arrow-key navigation. The keyboard
// handler in regimes_page.js mutates rp.focal.seed_index then triggers
// the panel repaint chain — we hook a MutationObserver-free poll by
// listening for keydown at document level and re-running the active-
// class update after the keydown handler runs (rAF defers us to AFTER).
function _wireSeedStripFocalSync(root, state) {
  if (!root || typeof document === 'undefined') return;
  if (document._rgSeedStripFocalSyncWired === '1') return;
  document._rgSeedStripFocalSyncWired = '1';
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'
        && e.key !== 'Home' && e.key !== 'End') return;
    // Defer so regimes_page.js's keyboard handler runs first.
    requestAnimationFrame(() => {
      const rp = state && state.regimesPanel;
      if (!rp || !rp.focal) return;
      const focal = rp.focal.seed_index | 0;
      const list = document.getElementById('rgSeedsStripList');
      if (!list) return;
      let target = null;
      list.querySelectorAll('.rg-seed-chip').forEach(c => {
        const isActive = (c.dataset.seedIdx | 0) === focal;
        c.classList.toggle('active', isActive);
        if (isActive) target = c;
      });
      // Scroll the active chip into view if it slid off-screen.
      if (target && typeof target.scrollIntoView === 'function') {
        try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        catch (_) {}
      }
      // Push the new focal seed's regime partition to shared.activeGroups.
      try { _pushFocalSeedGroups(state); } catch (_) {}
    });
  });
}

/**
 * Promote the focal Stage 3 locus to a candidate inversion (2026-05-20).
 *
 * The four regime panels iterate `result.stage3.loci`, and the keyboard
 * navigation mutates `state.regimesPanel.focal.seed_index` against THAT
 * array (the variable is named seed_index for legacy reasons — it indexes
 * loci, not the upstream Stage 1 seeds). The Stage 3 locus also carries
 * the cleanest per-band sample assignment via `per_band_samples`, so we
 * use it directly to populate `locked_labels`.
 *
 * Locus → candidate field mapping:
 *   locus.chain.anchor_w?   → cand.ref_window (falls back to mid-window)
 *   locus.K                 → cand.K
 *   locus.per_band_samples  → cand.locked_labels (Set per band → Int8Array;
 *                                                  unassigned samples = -1)
 *   locus.s_window/e_window → cand.start_w/end_w
 *   data.windows[s/e].bp    → cand.start_bp/end_bp
 *   windowToL2[ref_window]  → cand.ref_l2
 *   unique L2s in footprint → cand.l2_indices
 */
async function _promoteFocalSeed(root, state, atlasState) {
  const result = state._regimesResult;
  if (!result || !result.stage3 || !Array.isArray(result.stage3.loci)) {
    _setStatus(root, 'no pipeline result — run the pipeline first');
    return;
  }
  const loci = result.stage3.loci;
  const focalIdx = (state.regimesPanel && state.regimesPanel.focal
                    && Number.isFinite(state.regimesPanel.focal.seed_index))
    ? (state.regimesPanel.focal.seed_index | 0) : 0;
  if (focalIdx < 0 || focalIdx >= loci.length) {
    _setStatus(root, `focal index ${focalIdx} is out of range (0..${loci.length - 1})`);
    return;
  }
  const locus = loci[focalIdx];
  const data = state.data;
  if (!data || !data.windows) {
    _setStatus(root, 'no scrubber data loaded');
    return;
  }

  const sw = locus.s_window | 0;
  const ew = locus.e_window | 0;
  // ref_window: prefer the originating Stage 1 seed's anchor_w (so the
  // candidate's "focal window" is the V-walker anchor, which is where the
  // band signal is strongest); fall back to the locus midpoint.
  let aw = Math.round((sw + ew) / 2);
  if (result.stage1 && Array.isArray(result.stage1.seeds) && locus.seed_id != null) {
    const matchedSeed = result.stage1.seeds.find(s => s && s.seed_id === locus.seed_id)
                     || result.stage1.seeds[locus.seed_id];
    if (matchedSeed && Number.isFinite(matchedSeed.anchor_w)) aw = matchedSeed.anchor_w | 0;
  }
  const winS = data.windows[sw];
  const winE = data.windows[ew];
  const start_bp = winS && Number.isFinite(winS.start_bp) ? winS.start_bp : null;
  const end_bp   = winE && Number.isFinite(winE.end_bp)   ? winE.end_bp   : null;

  // Convert per_band_samples (Array<Set<sample_idx>>) to a cohort-length
  // Int8Array. Samples not assigned to any band stay at -1.
  const nS = data.n_samples | 0;
  const locked = new Int8Array(nS).fill(-1);
  if (Array.isArray(locus.per_band_samples)) {
    for (let b = 0; b < locus.per_band_samples.length; b++) {
      const set = locus.per_band_samples[b];
      if (!set) continue;
      if (typeof set.forEach === 'function') {
        set.forEach((si) => {
          if (si >= 0 && si < nS) locked[si] = b;
        });
      }
    }
  }

  // ref_l2 + l2_indices from state.windowToL2 (built in _wireCtxCallbacks).
  const wToL2 = state.windowToL2;
  const ref_l2 = (wToL2 && aw >= 0 && aw < wToL2.length) ? wToL2[aw] : null;
  const l2_set = new Set();
  if (wToL2) {
    for (let w = sw; w <= ew; w++) {
      const li = wToL2[w];
      if (li >= 0) l2_set.add(li);
    }
  }
  const l2_indices = [...l2_set].sort((a, b) => a - b);

  // Lazy-import the local_pca_dosage candidates module so this page
  // doesn't carry the import at top-level.
  const candMod = await import('./local_pca_dosage/candidates.js')
    .catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function'
      || typeof candMod.addCandidateToList !== 'function'
      || typeof candMod.setCandidate !== 'function') {
    _setStatus(root, 'local_pca_dosage/candidates.js helpers not available');
    return;
  }

  const cand = {
    source:        'seed_promote',
    chrom:         data.chrom || state.activeChrom,
    l2_indices,
    ref_l2:        (ref_l2 != null && ref_l2 >= 0) ? ref_l2 : null,
    ref_window:    aw,
    K:             locus.K | 0,
    locked_labels: locked,
    start_w:       sw,
    end_w:         ew,
    start_bp,
    end_bp,
    created_at:    Date.now(),
    notes: `Promoted from haplotype_regimes Stage 3 locus (seed_id=${
      locus.seed_id != null ? locus.seed_id : '?'
    }, K=${locus.K | 0}, span=${(ew - sw + 1) | 0}w, min_jaccard=${
      (locus.min_internal_jaccard != null ? locus.min_internal_jaccard.toFixed(3) : '—')
    }, stage2=${locus.stage2_verdict || '?'}).`,
    id:            candMod.makeCandidateId(),
    _from_seed: {
      anchor_w:             aw,
      seed_id:              locus.seed_id,
      stage2_verdict:       locus.stage2_verdict,
      stage2_linkage_group: locus.stage2_linkage_group,
      min_internal_jaccard: locus.min_internal_jaccard,
      n_samples_dropped:    locus.n_samples_dropped,
    },
  };

  // Push through the local_pca_dosage candidates module so the candidate
  // lands in the same carousel + persistence the lock-promote path uses.
  // Falls back to a synthetic shim when local_pca_dosage hasn't mounted yet.
  const inv = (atlasState && atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || {
    data,
    candidate: null,
    candidateList: [],
  };
  try { candMod.addCandidateToList(page1State, cand); }
  catch (e) { console.warn('addCandidateToList threw:', e); }
  try { candMod.setCandidate(page1State, cand); }
  catch (e) { console.warn('setCandidate threw:', e); }
  inv._local_pca_dosage_state = page1State;

  _setStatus(root, `promoted locus #${focalIdx} (seed_id=${locus.seed_id}) → candidate ${cand.id}. Opening candidate focus…`);
  try { window.location.hash = '#/inversion/candidate_focus'; } catch (_) {}
}

/**
 * Auto-merge V — Mode 1 (insulated_local) driver (2026-05-20).
 *
 * SPEC_cramers_v_seed_merge.md Phase 1 deliverable #2 — the UI half of
 * the auto-promote walker. Compute lives in shared/cramers_v_merge.js.
 *
 * What it does:
 *   1. Pulls the Stage 1 seeds from state._regimesResult (the user must
 *      have run the pipeline first — button is disabled otherwise).
 *   2. Calls runCramersVMergeLocal({seeds, getLabels, getK}). The walker
 *      ONLY compares adjacent seeds (insulated_local — never matches a
 *      distant-window contingency to pull non-neighbours together).
 *   3. Groups consecutive MERGE verdicts into chains. A chain of length
 *      ≥ 2 represents a multi-seed regional inversion candidate. Chains
 *      of length 1 (no MERGE neighbour) are skipped — those seeds are
 *      already promotable individually via the ★ promote button.
 *   4. For each multi-seed chain, builds a candidate spanning
 *      seeds[start].s_window → seeds[end].e_window with source
 *      'auto_cramers_v_local', and pushes it through the same
 *      addCandidateToList + setCandidate plumbing the lock-promote +
 *      seed-promote paths use. The last chain's candidate becomes
 *      active (via setCandidate).
 *   5. Re-renders the seeds strip + L3 pairs table so the new
 *      candidates appear in the carousel immediately.
 *
 * locked_labels for the merged candidate come from the FIRST seed's
 * per_band_samples — that's the chain's anchor frame, and Hungarian
 * alignment downstream keeps subsequent seeds in the same K-band space.
 */
async function _runAutoMergeCramersV(root, state, atlasState) {
  const result = state._regimesResult;
  if (!result || !result.stage1 || !Array.isArray(result.stage1.seeds)) {
    _setStatus(root, 'no pipeline result — run the pipeline first');
    return;
  }
  const seeds = result.stage1.seeds;
  if (seeds.length < 2) {
    _setStatus(root, `auto-merge V: need ≥ 2 seeds, have ${seeds.length}`);
    return;
  }
  const ctx = state._regimesCtx;
  if (!ctx || typeof ctx.getLabels !== 'function') {
    _setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }

  _setStatus(root, `auto-merge V: walking ${seeds.length - 1} adjacent pair${seeds.length - 1 === 1 ? '' : 's'}…`);
  await new Promise(r => setTimeout(r, 0));
  const t0 = performance.now();

  let walker;
  try {
    walker = runCramersVMergeLocal({
      seeds,
      getLabels: ctx.getLabels,
      getK:      ctx.getK,
      opts:      { emitSingletons: false },
    });
  } catch (e) {
    console.error('runCramersVMergeLocal threw:', e);
    _setStatus(root, `auto-merge V failed: ${e.message}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  const sum = walker.summary || {};
  const multiChains = (walker.chains || []).filter(c => c && c.length > 1);
  if (multiChains.length === 0) {
    _setStatus(root,
      `auto-merge V ran in ${ms}ms · ${sum.n_pairs || 0} pairs · ` +
      `${sum.n_merge || 0} MERGE · ${sum.n_separate || 0} SEPARATE · ` +
      `${sum.n_insufficient || 0} INSUFFICIENT · no multi-seed chains to promote`);
    return;
  }

  // Promote each multi-seed chain as a candidate. Lazy-import the
  // candidates module so we don't pull it in at top-level.
  const candMod = await import('./local_pca_dosage/candidates.js').catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function'
      || typeof candMod.addCandidateToList !== 'function'
      || typeof candMod.setCandidate !== 'function') {
    _setStatus(root, 'local_pca_dosage/candidates.js helpers not available');
    return;
  }
  const data = state.data;
  const nS = data.n_samples | 0;
  const inv = (atlasState && atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || {
    data, candidate: null, candidateList: [],
  };

  let lastCand = null;
  let nPromoted = 0;
  for (const chain of multiChains) {
    const seedA = seeds[chain.start_i];
    const seedB = seeds[chain.end_i];
    if (!seedA || !seedB) continue;
    const start_w = seedA.s_window | 0;
    const end_w   = seedB.e_window | 0;
    const ref_window = Number.isFinite(seedA.anchor_w) ? seedA.anchor_w | 0
                     : Math.round((start_w + end_w) / 2);
    const winS = data.windows && data.windows[start_w];
    const winE = data.windows && data.windows[end_w];
    const start_bp = winS && Number.isFinite(winS.start_bp) ? winS.start_bp : null;
    const end_bp   = winE && Number.isFinite(winE.end_bp)   ? winE.end_bp   : null;

    // locked_labels: take the anchor seed's labels at its anchor_w
    // (the K-band frame the walker's contingency tests were aligned to).
    const labelsA = ctx.getLabels(seedA.anchor_w | 0);
    const K = (typeof ctx.getK === 'function' ? ctx.getK(seedA.anchor_w | 0) : 0)
           || seedA.K_a || 0;
    const locked = new Int8Array(nS).fill(-1);
    if (labelsA && labelsA.length) {
      for (let s = 0; s < Math.min(nS, labelsA.length); s++) {
        const k = labelsA[s];
        if (k >= 0 && k < K) locked[s] = k;
      }
    }

    // ref_l2 + l2_indices from windowToL2 over the chain footprint.
    const wToL2 = state.windowToL2;
    const ref_l2 = (wToL2 && ref_window >= 0 && ref_window < wToL2.length)
      ? wToL2[ref_window] : null;
    const l2_set = new Set();
    if (wToL2) {
      for (let w = start_w; w <= end_w; w++) {
        const li = wToL2[w];
        if (li >= 0) l2_set.add(li);
      }
    }
    const l2_indices = [...l2_set].sort((a, b) => a - b);

    // Per-pair Cramér V values within the chain (for the notes field).
    const chainV = [];
    for (let i = chain.start_i; i < chain.end_i; i++) {
      const ve = walker.verdicts[i];
      if (ve && Number.isFinite(ve.v)) chainV.push(ve.v.toFixed(3));
    }
    const cand = {
      source:        'auto_cramers_v_local',
      chrom:         data.chrom || state.activeChrom,
      l2_indices,
      ref_l2:        (ref_l2 != null && ref_l2 >= 0) ? ref_l2 : null,
      ref_window,
      K,
      locked_labels: locked,
      start_w, end_w,
      start_bp, end_bp,
      created_at:    Date.now(),
      notes: `Auto-merged from Cramér's V walker (Mode 1 insulated_local): ` +
             `seeds ${chain.start_i}..${chain.end_i} (${chain.length} seeds, ` +
             `V_chain=[${chainV.join(', ')}]).`,
      id:            candMod.makeCandidateId(),
      _from_cramers_v_local: {
        chain_start_i:  chain.start_i,
        chain_end_i:    chain.end_i,
        chain_length:   chain.length,
        chain_v_values: chainV.map(v => Number(v)),
        anchor_seed_id: seedA.seed_id,
      },
    };
    try { candMod.addCandidateToList(page1State, cand); nPromoted++; lastCand = cand; }
    catch (e) { console.warn('addCandidateToList threw for chain:', chain, e); }
  }
  if (lastCand) {
    try { candMod.setCandidate(page1State, lastCand); }
    catch (e) { console.warn('setCandidate threw:', e); }
  }
  inv._local_pca_dosage_state = page1State;

  _setStatus(root,
    `auto-merge V ran in ${ms}ms · ${sum.n_pairs} pairs · ` +
    `${sum.n_merge} MERGE · ${sum.n_separate} SEPARATE · ` +
    `${sum.n_insufficient} INSUFFICIENT · promoted ${nPromoted} ` +
    `chain${nPromoted === 1 ? '' : 's'} (${multiChains.reduce((a, c) => a + c.length, 0)} seeds → ${nPromoted} candidates)`);

  // Refresh seeds strip + L3 pairs table so the new candidates surface.
  try { _renderSeedsStrip(root, state); } catch (_) {}
  try { _renderL3PairsTable(root, state); } catch (_) {}
}

/**
 * Auto-merge V — Mode 2 (post_long_range) driver (2026-05-20).
 *
 * SPEC_cramers_v_seed_merge.md Phase 1 deliverable #2 (Mode 2 UI half).
 * Pure-compute lives in shared/cramers_v_merge.js#runCramersVMergeMacrostripe.
 *
 * Differences from Mode 1 (`_runAutoMergeCramersV`):
 *   - Mode 1 walks the FULL Stage 1 seed list, calls the walker once,
 *     gets one chain list. Insulated_local but unbounded.
 *   - Mode 2 partitions the seed list per Stage 3 macrostripe (seed is
 *     "inside" a locus if its anchor_w ∈ [locus.s_window, locus.e_window]),
 *     calls the walker once per macrostripe. Chains never cross locus
 *     boundaries — the long-range Stage 2 voting that built the
 *     macrostripes is treated as ground truth for "where regimes split".
 *     Mode 2 just refines the WITHIN-macrostripe boundary.
 *
 * Promoted candidates are tagged `source: 'auto_cramers_v_macrostripe'`
 * so they're visually distinct from Mode 1's `auto_cramers_v_local`
 * (different chip colour — see candidate_focus _html_builders.js).
 */
async function _runAutoMergeCramersVMacro(root, state, atlasState) {
  const result = state._regimesResult;
  if (!result || !result.stage1 || !Array.isArray(result.stage1.seeds)) {
    _setStatus(root, 'no pipeline result — run the pipeline first');
    return;
  }
  if (!result.stage3 || !Array.isArray(result.stage3.loci) || result.stage3.loci.length === 0) {
    _setStatus(root, 'no Stage 3 macrostripes — pipeline did not produce loci');
    return;
  }
  const seeds = result.stage1.seeds;
  const loci  = result.stage3.loci;
  const ctx = state._regimesCtx;
  if (!ctx || typeof ctx.getLabels !== 'function') {
    _setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }

  _setStatus(root, `auto-merge V macrostripe: walking ${loci.length} macrostripe${loci.length === 1 ? '' : 's'}…`);
  await new Promise(r => setTimeout(r, 0));
  const t0 = performance.now();

  let walker;
  try {
    walker = runCramersVMergeMacrostripe({
      seeds, loci,
      getLabels: ctx.getLabels,
      getK:      ctx.getK,
      opts:      { emitSingletons: false },
    });
  } catch (e) {
    console.error('runCramersVMergeMacrostripe threw:', e);
    _setStatus(root, `auto-merge V macrostripe failed: ${e.message}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);
  const sum = walker.summary || {};
  const multiChains = (walker.chains || []).filter(c => c && c.length > 1);
  if (multiChains.length === 0) {
    _setStatus(root,
      `auto-merge V macrostripe ran in ${ms}ms · ${sum.n_loci || 0} loci · ` +
      `${sum.n_seeds_total || 0} seeds inside · ${sum.n_pairs || 0} pairs · ` +
      `${sum.n_merge || 0} MERGE · ${sum.n_separate || 0} SEPARATE · ` +
      `${sum.n_insufficient || 0} INSUFFICIENT · no multi-seed chains to promote`);
    return;
  }

  const candMod = await import('./local_pca_dosage/candidates.js').catch(() => null);
  if (!candMod || typeof candMod.makeCandidateId !== 'function'
      || typeof candMod.addCandidateToList !== 'function'
      || typeof candMod.setCandidate !== 'function') {
    _setStatus(root, 'local_pca_dosage/candidates.js helpers not available');
    return;
  }
  const data = state.data;
  const nS = data.n_samples | 0;
  const inv = (atlasState && atlasState.inversion) || {};
  const page1State = inv._local_pca_dosage_state || {
    data, candidate: null, candidateList: [],
  };

  // For each flat chain, the per-locus seed indices (start_i, end_i) are
  // INTO the inside-locus filtered seed list. Reconstruct them by
  // walking the per_locus entry so we can pull the actual seed objects.
  let lastCand = null;
  let nPromoted = 0;
  for (const chain of multiChains) {
    const perLocusEntry = walker.per_locus[chain.locus_idx];
    if (!perLocusEntry) continue;
    // The walker filtered seeds by anchor_w containment; reconstruct
    // the same filter to map start_i/end_i back to actual seeds.
    const locus = perLocusEntry.locus;
    const lS = locus.s_window | 0;
    const lE = locus.e_window | 0;
    const insideSeeds = [];
    for (const sd of seeds) {
      if (!sd) continue;
      const aw = sd.anchor_w | 0;
      if (aw >= lS && aw <= lE) insideSeeds.push(sd);
    }
    const seedA = insideSeeds[chain.seed_start_i];
    const seedB = insideSeeds[chain.seed_end_i];
    if (!seedA || !seedB) continue;
    const start_w = seedA.s_window | 0;
    const end_w   = seedB.e_window | 0;
    const ref_window = Number.isFinite(seedA.anchor_w) ? seedA.anchor_w | 0
                     : Math.round((start_w + end_w) / 2);
    const winS = data.windows && data.windows[start_w];
    const winE = data.windows && data.windows[end_w];
    const start_bp = winS && Number.isFinite(winS.start_bp) ? winS.start_bp : null;
    const end_bp   = winE && Number.isFinite(winE.end_bp)   ? winE.end_bp   : null;

    const labelsA = ctx.getLabels(seedA.anchor_w | 0);
    const K = (typeof ctx.getK === 'function' ? ctx.getK(seedA.anchor_w | 0) : 0)
           || seedA.K_a || 0;
    const locked = new Int8Array(nS).fill(-1);
    if (labelsA && labelsA.length) {
      for (let s = 0; s < Math.min(nS, labelsA.length); s++) {
        const k = labelsA[s];
        if (k >= 0 && k < K) locked[s] = k;
      }
    }

    const wToL2 = state.windowToL2;
    const ref_l2 = (wToL2 && ref_window >= 0 && ref_window < wToL2.length)
      ? wToL2[ref_window] : null;
    const l2_set = new Set();
    if (wToL2) {
      for (let w = start_w; w <= end_w; w++) {
        const li = wToL2[w];
        if (li >= 0) l2_set.add(li);
      }
    }
    const l2_indices = [...l2_set].sort((a, b) => a - b);

    // Per-pair V values within this chain (from the per-locus verdicts).
    const chainV = [];
    const vs = perLocusEntry.verdicts || [];
    for (let i = chain.seed_start_i; i < chain.seed_end_i; i++) {
      const ve = vs[i];
      if (ve && Number.isFinite(ve.v)) chainV.push(ve.v.toFixed(3));
    }
    const cand = {
      source:        'auto_cramers_v_macrostripe',
      chrom:         data.chrom || state.activeChrom,
      l2_indices,
      ref_l2:        (ref_l2 != null && ref_l2 >= 0) ? ref_l2 : null,
      ref_window,
      K,
      locked_labels: locked,
      start_w, end_w,
      start_bp, end_bp,
      created_at:    Date.now(),
      notes: `Auto-merged from Cramér's V walker (Mode 2 post_long_range): ` +
             `locus ${chain.locus_idx}, seeds ${chain.seed_start_i}..${chain.seed_end_i} ` +
             `(${chain.length} seeds, V_chain=[${chainV.join(', ')}]).`,
      id:            candMod.makeCandidateId(),
      _from_cramers_v_macrostripe: {
        locus_idx:      chain.locus_idx,
        chain_start_i:  chain.seed_start_i,
        chain_end_i:    chain.seed_end_i,
        chain_length:   chain.length,
        chain_v_values: chainV.map(v => Number(v)),
        anchor_seed_id: seedA.seed_id,
      },
    };
    try { candMod.addCandidateToList(page1State, cand); nPromoted++; lastCand = cand; }
    catch (e) { console.warn('addCandidateToList threw for chain:', chain, e); }
  }
  if (lastCand) {
    try { candMod.setCandidate(page1State, lastCand); }
    catch (e) { console.warn('setCandidate threw:', e); }
  }
  inv._local_pca_dosage_state = page1State;

  _setStatus(root,
    `auto-merge V macrostripe ran in ${ms}ms · ${sum.n_loci} loci · ` +
    `${sum.n_loci_with_chains} with chains · ${sum.n_pairs} pairs · ` +
    `${sum.n_merge} MERGE · promoted ${nPromoted} chain${nPromoted === 1 ? '' : 's'} ` +
    `(${multiChains.reduce((a, c) => a + c.length, 0)} seeds → ${nPromoted} candidates)`);

  try { _renderSeedsStrip(root, state); } catch (_) {}
  try { _renderL3PairsTable(root, state); } catch (_) {}
}

/**
 * Serialize the in-memory pipeline result to a regime catalogue (manifest +
 * knobs + catalogue.json) and trigger a browser download for each.
 *
 * Cohort id, reference id, pipeline version, and sample IDs come from the
 * atlas data/manifest. Window→bp mapping uses the per-window
 * `start_bp` / `end_bp` fields written by the scrubber_main JSON.
 */
function _exportCatalogue(state, atlasState) {
  const result = state._regimesResult;
  if (!result) {
    alert('Run the pipeline first.');
    return;
  }
  const data = state.data;
  if (!data || !data.windows) {
    alert('No data loaded.');
    return;
  }

  // Sample IDs from the data file. Fallback to integer-strings if absent.
  const sample_ids = (Array.isArray(data.samples)
    ? data.samples.map(s => (s && (s.sample_id || s.id || s.name)) || `S${s}`)
    : Array.from({ length: data.n_samples }, (_, i) => `S${i}`));

  // Per-window bp mapping. We use the start_bp of the window for s_window
  // and end_bp of the window for e_window — these are the canonical
  // single-chromosome coordinates carried by scrubber_main.
  const windowToBp = (chr_idx, w_idx) => {
    const win = data.windows[w_idx];
    if (!win) return NaN;
    // For s_window query, return start; for e_window query, return end.
    // The serializer calls windowToBp(chr, s_window) and (chr, e_window)
    // separately, so we need a way to disambiguate. Use a heuristic:
    // s_window of a locus is always called first (visit order in
    // buildLocusRecord), so we cannot distinguish here. Solution: track
    // both bp endpoints by always returning the window's centre when
    // called with a single integer. Better: serializer should be told
    // bp endpoints separately. Compromise for now: return start_bp.
    // The result is conservative (slightly under-counts span_bp by the
    // last window's width); document this in HOW_TO_USE.md.
    return win.start_bp != null ? win.start_bp
         : win.center_bp != null ? win.center_bp
         : (win.center_mb != null ? Math.round(win.center_mb * 1e6) : NaN);
  };
  // Better alternative: pass both endpoints. We patch the catalogue
  // post-build to fix e_bp from end_bp instead of start_bp.

  const cohort_id = (data.cohort_id || 'cohort_unset');
  const reference_id = (data.reference_id || 'fClaHyb_Gar_LG');
  const pipeline_version = '3.4.0';
  const opts = state._regimesOpts || {};

  // Resolve full opts dict (the BUILT-IN defaults aren't reflected in opts
  // since the pipeline uses Object.assign({}, DEFAULTS, opts) internally).
  // For the catalogue we serialise the user-supplied opts; the knob_hash
  // therefore reflects the OVERRIDE set, not the full merged set. If a
  // future round needs the full effective config, walk BANDING_PIPELINE_DEFAULTS
  // and merge here.
  const resolved_opts = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts);

  let built;
  try {
    built = buildCatalogue(result, {
      cohort_id, reference_id, pipeline_version,
      sample_ids,
      chromName: (idx) => state.activeChrom,   // single-chrom run
      windowToBp,
      resolved_opts,
      include_full_votes: false,
    });
  } catch (e) {
    console.error('buildCatalogue threw:', e);
    alert(`Catalogue build failed: ${e.message}`);
    return;
  }

  // Patch e_bp using end_bp (windowToBp returned start_bp for both).
  for (const rec of built.catalogue) {
    const w = data.windows[rec.e_window];
    const e_bp = (w && w.end_bp != null) ? w.end_bp
               : (w && w.start_bp != null && w.start_bp >= rec.s_bp) ? w.start_bp
               : rec.e_bp;
    if (e_bp !== rec.e_bp) {
      rec.e_bp = e_bp;
      rec.span_bp = rec.e_bp - rec.s_bp + 1;
      rec.interval_id = `${rec.chrom_name}:${rec.s_bp}-${rec.e_bp}`;
    }
  }

  // Trigger downloads.
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__manifest.json`,
                built.manifest);
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__knobs.json`,
                built.knobs);
  _downloadJson(`${cohort_id}__${built.manifest.knob_hash}__catalogue.json`,
                built.catalogue);
}

function _downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)],
                        { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _setStatus(root, msg) {
  const el = root.querySelector('#rgStatus');
  if (el) el.textContent = msg;
}

// ---------------------------------------------------------------------------
// band_quality diagnostics — surfaces the cache distribution so when
// the pipeline returns 0 seeds the user can see immediately whether
// it's because BQ wasn't computed (producer didn't ship it AND we
// couldn't derive it) or because every window's BQ is below the seed
// gate's 0.50 default.
// ---------------------------------------------------------------------------
function _bandQualityStats(state) {
  const bq = state._regimesBandQualityCache || new Float32Array(0);
  const prov = state._regimesBandQualityProvenance || {};
  let nNonZero = 0, nPass50 = 0, nPass40 = 0, nPass30 = 0;
  let sum = 0, max = -Infinity;
  for (let i = 0; i < bq.length; i++) {
    const v = bq[i];
    if (!Number.isFinite(v)) continue;
    if (v > 0)    nNonZero++;
    if (v >= 0.3) nPass30++;
    if (v >= 0.4) nPass40++;
    if (v >= 0.5) nPass50++;
    sum += v;
    if (v > max) max = v;
  }
  const first10 = [];
  for (let i = 0; i < Math.min(10, bq.length); i++) {
    first10.push(+bq[i].toFixed(3));
  }
  return {
    n_windows:        bq.length,
    n_nonzero:        nNonZero,
    n_pass_default:   nPass50,        // 0.50 = seed_discovery default
    n_pass_chain:     nPass40,        // 0.40 = chain-walk default
    n_pass_low:       nPass30,        // 0.30 = low fallback
    mean:             bq.length > 0 ? +(sum / bq.length).toFixed(3) : 0,
    max:              Number.isFinite(max) ? +max.toFixed(3) : 0,
    first_10:         first10,
    provenance:       prov,
    l2_synthesized:   !!state._regimesL2Synthesized,
  };
}

// Adaptive seed-discovery threshold. If the default 0.50 catches at
// least 5 windows, use it. Otherwise step down to 0.40, then 0.30, then
// 0.20. Below 0.20 we stop — at that point the data is too noisy for
// the seed-discovery walker to produce meaningful seeds, and the right
// answer is "no inversions detectable on this chromosome".
function _autoCalibrateAnchorBQ(stats) {
  if (!stats || !stats.n_windows) return 0.50;
  if (stats.n_pass_default >= 5) return 0.50;
  if (stats.n_pass_chain   >= 5) return 0.40;
  if (stats.n_pass_low     >= 5) return 0.30;
  // Last resort — pick anything above ~zero. This lets the walker
  // attempt seeds; if nothing real is in the data it'll still return 0
  // seeds, but at least we tried.
  return Math.max(0.20, Math.min(0.30, stats.max * 0.5));
}

// ---------------------------------------------------------------------------
// Mode 3 — het-skeleton seed builder (Cluster 1 Path B).
//
// Per-window K-means (already cached on state) → het_detect_candidate_band
// → het_track_skeleton (forward+backward via Jaccard) → het_define_interval
// → hom_anchor_to_het per skeleton → computeAdjacentSeedMerges to fuse
// adjacent intervals into multi-skeleton seeds. Produces the same
// {stage1, stage3, summary} shape that _buildShortRangeResult emits so the
// downstream Cluster 2 + Cluster 3 tail is identical across modes.
//
// Implementation notes:
//   - Anchor windows are picked by walking every window once and asking
//     het_detect_candidate_band whether the per-window K-means has a
//     plausible HET band (intermediate PC1, sufficient size). When yes,
//     try to extend a skeleton from that anchor.
//   - To avoid building hundreds of overlapping skeletons we dedupe:
//     once a window participates in a skeleton, skip it as a future
//     anchor (the skeleton already covers it).
//   - Output: each surviving skeleton (after the adjacent-V merge pass)
//     becomes one seed + one locus, with per_band_samples populated.
// ---------------------------------------------------------------------------
function _buildHetSkeletonResult(state) {
  if (!state || !state.data) return null;
  const data = state.data;
  const ctx  = state._regimesCtx;
  if (!ctx) {
    console.warn('[het-skeleton] _regimesCtx not wired');
    return null;
  }
  const N = data.n_windows | 0;
  const nSamples = data.n_samples | 0;
  const getLabels = ctx.getLabels;
  const getK      = ctx.getK;
  const getBpFor  = ctx.getBpFor;
  const getPc1    = state._regimesGetPC1;

  if (typeof getLabels !== 'function' || typeof getPc1 !== 'function') {
    console.warn('[het-skeleton] missing required callbacks');
    return null;
  }

  // Walk windows, find anchor windows with a candidate HET band, and
  // extend a skeleton from each. Dedupe by tracking covered windows.
  const covered = new Uint8Array(N);
  const skeletons = [];
  let nAnchorsTried = 0;
  let nSkeletonsAccepted = 0;
  let nNoHetBand = 0;
  let nTooShort = 0;
  for (let w = 0; w < N; w++) {
    if (covered[w]) continue;
    const labels = getLabels(w);
    const K = getK(w);
    const pc1 = getPc1(w);
    if (!labels || !pc1 || K < 2) continue;
    nAnchorsTried++;
    const het = het_detect_candidate_band(labels, pc1, K);
    // het_detect_candidate_band returns null on failure or
    // {k_het, k_hom_low, k_hom_high, mean_pc1, het_span_frac} on success —
    // there is no `ok` field. The earlier `!het.ok` check rejected every
    // successful detection, producing n_no_het_band == n_anchors_tried.
    if (!het) { nNoHetBand++; continue; }
    let sk;
    try {
      sk = het_track_skeleton({
        getLabels,
        getPc1,
        getK,
        getBpFor,
        chr_s_window: 0,
        chr_e_window: N - 1,
        seed_w: w,
      });
    } catch (e) {
      console.warn('[het-skeleton] track_skeleton threw at w=' + w, e);
      continue;
    }
    if (!sk || !sk.ok || !sk.windows || sk.windows.length < (HET_DEFAULTS.min_skeleton_windows || 3)) {
      nTooShort++;
      continue;
    }
    // Mark covered
    for (const ww of sk.windows) covered[ww.w | 0] = 1;
    // bp interval
    let interval = null;
    try { interval = het_define_interval(sk, getBpFor); }
    catch (e) { console.warn('[het-skeleton] define_interval threw', e); }
    // HOM anchors
    let homAnchor = null;
    try {
      homAnchor = hom_anchor_to_het({
        skeleton: sk,
        getLabels,
        getPc1,
        getK,
      });
    } catch (e) {
      console.warn('[het-skeleton] hom_anchor threw', e);
    }
    skeletons.push({
      anchor_w: w,
      skeleton: sk,
      interval,
      hom_anchor: homAnchor,
      het_seed_k: het.k_het,
    });
    nSkeletonsAccepted++;
  }

  console.log('[het-skeleton] anchor sweep:', {
    n_windows: N,
    n_anchors_tried: nAnchorsTried,
    n_no_het_band: nNoHetBand,
    n_too_short: nTooShort,
    n_skeletons_accepted: nSkeletonsAccepted,
  });

  if (skeletons.length === 0) {
    return {
      stage1: { seeds: [], per_chrom_summary: [] },
      stage2: null,
      stage3: { loci: [] },
      stage4: null,
      summary: {
        n_seeds_after_plateau: 0,
        n_loci: 0,
        n_targets: 0,
        n_stability_upgraded: 0,
      },
      _het_skeletons: skeletons,
    };
  }

  // Build seed-shaped objects so cramers_v_merge can compare adjacent
  // skeletons by their anchor labels.
  const skSeeds = skeletons.map((sk, i) => ({
    seed_id: i,
    anchor_w: sk.anchor_w,
    s_window: sk.skeleton.s_window,
    e_window: sk.skeleton.e_window,
    K: getK(sk.anchor_w),
    anchor_band_quality: 1.0,
  }));
  skSeeds.sort((a, b) => a.s_window - b.s_window);
  // Re-index after sort.
  skSeeds.forEach((s, i) => { s.seed_id = i; });

  // Adjacent-skeleton Cramér's V merge — fuse consecutive MERGE verdicts.
  let mergeResult = null;
  try {
    mergeResult = runCramersVMergeLocal({
      seeds: skSeeds,
      getLabels,
      getK,
      opts: { emitSingletons: true },
    });
  } catch (e) {
    console.warn('[het-skeleton] cramers_v_merge threw', e);
  }
  let chains = (mergeResult && Array.isArray(mergeResult.chains)) ? mergeResult.chains
                : skSeeds.map((s, i) => ({ start_i: i, end_i: i, length: 1 }));

  // 2026-05-21: cap the het-skeleton output to the top-N longest chains
  // (window-span). Quentin reported the page "computes and crashes
  // almost and its so slow" with 456 chains — each chain → seed chip in
  // the strip + locus row in initRegimesPage state, which inflates the
  // render budget linearly. Cap default 50. Tunable via state.hetMaxSeeds
  // so dev-console can bump it without a rebuild. Stash the original
  // count on summary so the user sees how many were dropped.
  const HET_MAX_SEEDS = (Number.isFinite(state.hetMaxSeeds) && state.hetMaxSeeds > 0)
    ? (state.hetMaxSeeds | 0) : 50;
  const n_chains_total = chains.length;
  if (chains.length > HET_MAX_SEEDS) {
    const enriched = chains.map((ch) => {
      const sStart = skSeeds[ch.start_i] ? skSeeds[ch.start_i].s_window : 0;
      const sEnd   = skSeeds[ch.end_i]   ? skSeeds[ch.end_i].e_window   : 0;
      return { ch, span: Math.max(0, sEnd - sStart + 1) };
    });
    enriched.sort((a, b) => b.span - a.span);
    chains = enriched.slice(0, HET_MAX_SEEDS).map(e => e.ch);
    // Re-sort the kept chains by start_w so the seed strip walks left
    // to right along the chromosome.
    chains.sort((a, b) => {
      const sa = skSeeds[a.start_i] ? skSeeds[a.start_i].s_window : 0;
      const sb = skSeeds[b.start_i] ? skSeeds[b.start_i].s_window : 0;
      return sa - sb;
    });
  }

  // Each chain becomes one seed + one locus. per_band_samples come from
  // the skeleton's anchor window's K-means labels (the canonical band
  // identity for the skeleton; per-window labels may permute within the
  // skeleton but the anchor's frame is the agreed reference).
  const finalSeeds = [];
  const finalLoci  = [];
  for (let ci = 0; ci < chains.length; ci++) {
    const ch = chains[ci];
    const startSeed = skSeeds[ch.start_i];
    const endSeed   = skSeeds[ch.end_i];
    const anchor_w  = startSeed.anchor_w;
    const labelsA   = getLabels(anchor_w);
    const K         = getK(anchor_w);
    const per_band_samples = [];
    const per_band_size    = new Array(K).fill(0);
    for (let b = 0; b < K; b++) per_band_samples.push(new Set());
    if (labelsA) {
      const lim = Math.min(nSamples, labelsA.length | 0);
      for (let si = 0; si < lim; si++) {
        const b = labelsA[si] | 0;
        if (b >= 0 && b < K) {
          per_band_samples[b].add(si);
          per_band_size[b]++;
        }
      }
    }
    const sk = skeletons[ch.start_i];
    finalSeeds.push({
      seed_id:               ci,
      chromosome_idx:        0,
      anchor_w,
      anchor_band_quality:   1.0,
      K_a:                   K,
      anchor_labels:         labelsA,
      n_tracked:             nSamples,
      s_window:              startSeed.s_window,
      e_window:              endSeed.e_window,
      n_windows:             endSeed.e_window - startSeed.s_window + 1,
      classifications:       null,
      classifications_s_window: startSeed.s_window,
      v_track:               null,
      h_off_track:           null,
      track_s_window:        startSeed.s_window,
      track_e_window:        endSeed.e_window,
      hit_left_edge:         false,
      hit_right_edge:        false,
      // Het-skeleton metadata for downstream interval building.
      _het_interval:         sk.interval || null,
      _het_skeleton:         sk.skeleton,
      _het_hom_anchor:       sk.hom_anchor,
      _het_het_band_k:       sk.het_seed_k,
    });
    finalLoci.push({
      seed_id:                ci,
      chromosome_idx:         0,
      s_window:               startSeed.s_window,
      e_window:               endSeed.e_window,
      K,
      chain:                  { s: startSeed.s_window, e: endSeed.e_window, K },
      per_band_samples,
      per_band_size,
      per_band_first_size:    per_band_size.slice(),
      n_samples_dropped:      0,
      band_set_aggregation:   'het_skeleton',
      n_unreliable_skipped:   0,
      min_internal_jaccard:   1.0,
      stage2_verdict:         null,
      stage2_linkage_group:   null,
      _het_interval:          sk.interval || null,
      _het_hom_anchor:        sk.hom_anchor,
      _het_het_band_k:        sk.het_seed_k,
    });
  }
  return {
    stage1: { seeds: finalSeeds, per_chrom_summary: [{ chr: 0, n_seeds: finalSeeds.length }] },
    stage2: null,
    stage3: { loci: finalLoci },
    stage4: null,
    summary: {
      n_seeds_after_plateau: finalSeeds.length,
      n_loci:                finalLoci.length,
      n_targets:             0,
      n_stability_upgraded:  0,
      n_anchors_tried:       nAnchorsTried,
      n_skeletons_raw:       nSkeletonsAccepted,
      n_chains:              chains.length,
      // 2026-05-21: pre/post-cap counts so the status bar can show
      // "456 chains → top 50 by span" when the user runs het-skeleton
      // on a busy chromosome.
      n_chains_before_cap:   n_chains_total,
      n_chains_capped:       Math.max(0, n_chains_total - chains.length),
      het_max_seeds:         HET_MAX_SEEDS,
    },
  };
}

// ---------------------------------------------------------------------------
// Cluster 2 + Cluster 3 tail — runs after Cluster 1 (any of the three
// modes) produces seeds + loci. Mode 1 (V-walker) already ran Cluster 2
// inside runBandingPipeline; Modes 2 (short-range curated) and 3 (het-
// skeleton) call breadth_voting explicitly here.
//
// Cluster 3 steps (on this page, ends at the catalogue serialiser):
//   - refineRegimesFromIntervals (haplotype_regime — arrangement identity)
//   - buildRegimeTopologyGraph + findChromosomeRegimeChains (regime_topology)
//   - mergePerChromosomeRegimes + crossChromosomeRegimeLinks (genome_scale —
//     on-page subset only)
//   - annotateRegimePositions + annotateRegimeStructures (regime_annotation)
//   - serializeRegimesToJson (the cross-page boundary; Cluster 4 consumes
//     this JSON on the relatedness-atlas page, NOT here)
//
// Mendelian / pedigree / linkage / dyad (Cluster 4) is NOT called here —
// that's the relatedness atlas page's job.
// ---------------------------------------------------------------------------
function _runPostSeedingTail(root, state, result, modeLabel, msSoFar) {
  const ctx = state._regimesCtx;
  if (!ctx) return;
  const data = state.data;
  const timing = {};

  // Cluster 2 — breadth voting (only for modes that didn't already do it).
  // Mode 1 (V-walker) already ran runStage4 inside runBandingPipeline.
  const modeNeedsExplicitVoting = (modeLabel === 'short' || modeLabel === 'het');
  let stage4 = result.stage4 || null;
  if (modeNeedsExplicitVoting && result.stage3 && result.stage3.loci.length > 0) {
    const t0 = performance.now();
    try {
      const voters  = buildVotersFromSeedLoci(result.stage1.seeds, result.stage3.loci);
      const targets = buildTargetsFromStage3Loci(result.stage3.loci, ctx.getLabels, ctx.getK);
      stage4 = runBreadthVoting({
        voters,
        targets,
        getLabels: ctx.getLabels,
        getK:      ctx.getK,
      }, {});
      result.stage4 = stage4;
      result.summary = result.summary || {};
      result.summary.n_targets = stage4 && stage4.summary
        ? (stage4.summary.n_targets | 0) : 0;
    } catch (e) {
      console.warn('[post-seeding] breadth_voting threw —', e);
    }
    timing.breadth_voting_ms = (performance.now() - t0).toFixed(0);
  }

  // Cluster 3 — convert loci into intervals (with HOM cores) for the
  // haplotype_regime refinement step.
  const intervals = [];
  for (const locus of (result.stage3 && result.stage3.loci) || []) {
    const iv = _locusToInterval(locus, data, ctx);
    if (iv) intervals.push(iv);
  }
  let refined = null;
  if (intervals.length >= 1) {
    const t0 = performance.now();
    try {
      refined = refineRegimesFromIntervals(intervals, {});
    } catch (e) {
      console.warn('[post-seeding] refineRegimesFromIntervals threw —', e);
    }
    timing.refine_regimes_ms = (performance.now() - t0).toFixed(0);
  }

  // Cross-regime topology.
  let topology = null;
  if (refined && Array.isArray(refined.regimes) && refined.regimes.length >= 1) {
    const t0 = performance.now();
    try {
      const graph = buildRegimeTopologyGraph(refined.regimes, {});
      const chains = findChromosomeRegimeChains(graph, refined.regimes);
      topology = { graph, chains };
    } catch (e) {
      console.warn('[post-seeding] regime_topology threw —', e);
    }
    timing.regime_topology_ms = (performance.now() - t0).toFixed(0);
  }

  // Genome-scale aggregation (single-chrom on this page; the cross-chrom
  // hub is reachable when the page later batches multiple chromosomes).
  let genomeWide = null;
  if (refined && Array.isArray(refined.regimes)) {
    const t0 = performance.now();
    try {
      const perChromMap = new Map();
      perChromMap.set(state.activeChrom || 0, refined);
      const merged = mergePerChromosomeRegimes(perChromMap);
      const crossChromLinks = crossChromosomeRegimeLinks(merged, {});
      genomeWide = { merged, crossChromLinks };
    } catch (e) {
      console.warn('[post-seeding] genome_scale aggregation threw —', e);
    }
    timing.genome_scale_ms = (performance.now() - t0).toFixed(0);
  }

  // Annotation passes. Positional needs chrom_meta — skip if not shipped
  // on data; structural needs per-regime structure_meta which we can
  // synthesise from each regime's macro-band count + the locus's K.
  let annotations = { positional: null, structural: null };
  if (refined && Array.isArray(refined.regimes)) {
    const t0 = performance.now();
    const chromMeta = (data.chrom_meta) || (data.chromosomes && data.chromosomes[0])
                      || { length_bp: null };
    if (chromMeta && Number.isFinite(chromMeta.length_bp)) {
      try {
        annotations.positional = annotateRegimePositions(refined.regimes, chromMeta, {});
      } catch (e) { console.warn('[post-seeding] positional annotation threw —', e); }
    }
    const structureMetaForRegime = (reg) => ({
      consensus_partition_M: reg.n_intervals,
      band_count:            reg.K || 3,
      regime_sharpness:      null,
      internal_nesting:      reg.has_nested === true,
      transition_width_bp:   null,
    });
    try {
      annotations.structural = annotateRegimeStructures(
        refined.regimes,
        refined.regimes.map(structureMetaForRegime),
        {});
    } catch (e) { console.warn('[post-seeding] structural annotation threw —', e); }
    timing.annotate_ms = (performance.now() - t0).toFixed(0);
  }

  // Cross-page payload (the catalogue triple is generated on demand by
  // the export button; here we just stash the serialisable view).
  let serialisedRegimes = null;
  if (refined) {
    try { serialisedRegimes = serializeRegimesToJson(refined, {
      chrom: state.activeChrom,
    }); }
    catch (e) { console.warn('[post-seeding] serialize regimes threw —', e); }
  }

  // Stash for inspection + export.
  state._regimesResult = result;
  state._regimesPostSeeding = {
    mode:        modeLabel,
    intervals,
    refined,
    topology,
    genomeWide,
    annotations,
    serialisedRegimes,
    timing,
  };

  // Status bar.
  const nSeeds  = (result.stage1 && result.stage1.seeds) ? result.stage1.seeds.length : 0;
  const nLoci   = (result.stage3 && result.stage3.loci)  ? result.stage3.loci.length  : 0;
  const nRegimes = refined && refined.regimes ? refined.regimes.length : 0;
  const nChains  = topology && topology.chains ? topology.chains.length : 0;
  const timingStr = Object.entries(timing).map(([k, v]) => `${k}=${v}`).join(' · ');
  // 2026-05-21: when het-skeleton's chain-cap kicked in, surface
  // "N → top M by span" so the user knows the strip isn't showing
  // everything the pipeline found.
  let capNote = '';
  const sm = result.summary || {};
  if (Number.isFinite(sm.n_chains_capped) && sm.n_chains_capped > 0) {
    capNote = ` · capped ${sm.n_chains_before_cap} chains → top ${sm.het_max_seeds} by span`;
  }
  _setStatus(root,
    `${modeLabel} mode ran in ${msSoFar}ms · ` +
    `${nSeeds} seeds · ${nLoci} loci · ${nRegimes} regimes · ${nChains} chains` +
    capNote +
    (timingStr ? ` · ${timingStr}` : ''));

  console.log('[post-seeding] cluster 2+3 summary:', {
    mode: modeLabel,
    n_seeds: nSeeds,
    n_loci: nLoci,
    n_regimes: nRegimes,
    n_chains: nChains,
    timing,
    annotations: {
      positional: annotations.positional ? annotations.positional.length : 0,
      structural: annotations.structural ? annotations.structural.length : 0,
    },
  });

  // Drive the existing panel render.
  try { _afterPipelineRun(root, state, result, {}); }
  catch (e) { console.warn('[post-seeding] _afterPipelineRun threw —', e); }

  // Populate the long-range regimes summary table + apply the
  // current view toggle so the right section is visible.
  try { _renderRegimesSummary(root, state); }
  catch (e) { console.warn('[post-seeding] _renderRegimesSummary threw —', e); }
  try { _applyViewToggle(root, state); }
  catch (e) { console.warn('[post-seeding] _applyViewToggle threw —', e); }
}

// Convert a stage3 locus into the interval shape refineRegimesFromIntervals
// expects: {hom_a, hom_b, het, start_bp, end_bp, id}. For het-skeleton
// loci, take HOM cores from the per-skeleton hom_anchor + the skeleton's
// het core. For V-walker / curated loci, fall back to the kmeans-ordered
// per_band_samples convention (band 0 = HOM_A, last band = HOM_B,
// middle = HET — matches kmeans1D's "label 0 = lowest center" guarantee).
function _locusToInterval(locus, data, ctx) {
  if (!locus) return null;
  const id = `chr${locus.chromosome_idx | 0}_w${locus.s_window}_${locus.e_window}`;
  // bp coords
  let start_bp = null, end_bp = null;
  if (locus._het_interval && Number.isFinite(locus._het_interval.start_bp)) {
    start_bp = locus._het_interval.start_bp;
    end_bp   = locus._het_interval.end_bp;
  } else if (ctx && typeof ctx.getBpFor === 'function') {
    const a = ctx.getBpFor(locus.s_window);
    const b = ctx.getBpFor(locus.e_window);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      start_bp = a; end_bp = b;
    }
  }
  // sample cores
  let hom_a = null, hom_b = null, het = null;
  if (locus._het_hom_anchor && locus._het_hom_anchor.ok) {
    hom_a = locus._het_hom_anchor.hom_a_consensus instanceof Set
          ? locus._het_hom_anchor.hom_a_consensus
          : new Set(locus._het_hom_anchor.hom_a_consensus || []);
    hom_b = locus._het_hom_anchor.hom_b_consensus instanceof Set
          ? locus._het_hom_anchor.hom_b_consensus
          : new Set(locus._het_hom_anchor.hom_b_consensus || []);
    const hk = locus._het_het_band_k | 0;
    if (locus.per_band_samples && locus.per_band_samples[hk]) {
      het = locus.per_band_samples[hk] instanceof Set
          ? locus.per_band_samples[hk]
          : new Set(locus.per_band_samples[hk]);
    }
  }
  // Fallback for non-het-mode loci.
  if ((!hom_a || !hom_b || !het) && locus.per_band_samples && locus.per_band_samples.length >= 2) {
    const K = locus.per_band_samples.length;
    const lo = locus.per_band_samples[0];
    const hi = locus.per_band_samples[K - 1];
    const mid = K >= 3 ? locus.per_band_samples[Math.floor(K / 2)] : new Set();
    hom_a = hom_a || (lo instanceof Set ? lo : new Set(lo));
    hom_b = hom_b || (hi instanceof Set ? hi : new Set(hi));
    het   = het   || (mid instanceof Set ? mid : new Set(mid));
  }
  if (!hom_a || !hom_b || !het) return null;
  return { id, start_bp, end_bp, hom_a, hom_b, het };
}

// ---------------------------------------------------------------------------
// View toggle (Cluster 3 surface — seeds-view vs long-range-regimes-view).
//
// Independent of the mode (seed source) toggle. The 4 canvases above
// stay identical in both views. The toggle only switches what's
// rendered below the canvas grid:
//   seeds view   — show the seeds strip (one chip per Stage 1 seed)
//   regimes view — show the long-range regime blocs table (one row
//                  per refined regime from Cluster 3)
// ---------------------------------------------------------------------------
function _applyViewToggle(root, state) {
  if (!root || typeof document === 'undefined') return;
  const seedsWrap   = root.querySelector('#rgSeedsStripWrap');
  const regimesWrap = root.querySelector('#rgRegimesWrap');
  const view = state._regimesView || 'seeds';
  const haveResult = !!(state && state._regimesResult);
  const havePost   = !!(state && state._regimesPostSeeding);
  if (seedsWrap) {
    // Show the seeds strip only when we have a result AND the view is
    // seeds. Until a run produces seeds, the strip stays hidden in
    // both views.
    seedsWrap.style.display = (view === 'seeds' && haveResult) ? 'flex' : 'none';
  }
  if (regimesWrap) {
    // Show regimes only when in regimes view AND a post-seeding tail
    // ran (i.e. we have refined regimes to display).
    regimesWrap.style.display = (view === 'regimes' && havePost) ? 'flex' : 'none';
  }
}

function _renderRegimesSummary(root, state) {
  if (!root || typeof document === 'undefined') return;
  const tbody = root.querySelector('#rgRegimesBody');
  const countEl = root.querySelector('#rgRegimesCount');
  if (!tbody) return;
  tbody.innerHTML = '';
  const post = state && state._regimesPostSeeding;
  const refined = post && post.refined;
  const regimes = refined && Array.isArray(refined.regimes) ? refined.regimes : [];
  if (regimes.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="8" style="padding: 6px 10px; color: var(--ink-dimmer, #5a6472);">' +
      'No refined regimes yet. Run the pipeline.' +
      '</td></tr>';
    if (countEl) countEl.textContent = '';
    return;
  }
  // Map regime → chain_id (when topology produced multi-regime chains).
  const chainOf = new Map();
  const chains = (post.topology && Array.isArray(post.topology.chains))
                 ? post.topology.chains : [];
  chains.forEach((ch, ci) => {
    if (!ch || !Array.isArray(ch)) return;
    for (const uid of ch) chainOf.set(String(uid), ci);
  });
  for (let i = 0; i < regimes.length; i++) {
    const r = regimes[i];
    const id = r.regime_id != null ? r.regime_id : (r.regime_uid != null ? r.regime_uid : ('reg_' + i));
    const chrom = r.chrom_idx != null
      ? `chr${r.chrom_idx}`
      : (state.activeChrom || '—');
    const bpStart = Number.isFinite(r.start_bp) ? (r.start_bp / 1e6).toFixed(2) + ' Mb' : '—';
    const bpEnd   = Number.isFinite(r.end_bp)   ? (r.end_bp   / 1e6).toFixed(2) + ' Mb' : '—';
    const nIv     = r.n_intervals != null ? r.n_intervals
                  : (r.member_interval_ids ? r.member_interval_ids.length : 0);
    const sizeOf = (s) => {
      if (s == null) return 0;
      if (s instanceof Set) return s.size;
      if (Array.isArray(s)) return s.length;
      return 0;
    };
    const nHomA = sizeOf(r.hom_a_intersect || r.hom_a);
    const nHomB = sizeOf(r.hom_b_intersect || r.hom_b);
    const nHet  = sizeOf(r.het_union || r.het);
    const chainKey = String(r.regime_uid != null ? r.regime_uid : id);
    const chainId  = chainOf.has(chainKey) ? `chain ${chainOf.get(chainKey)}` : '—';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--rule, #2a3242)';
    tr.innerHTML =
      `<td style="padding: 3px 6px; color: var(--ink, #e6edf6); font-weight: 600;">${_esc(String(id))}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${_esc(String(chrom))}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${bpStart} – ${bpEnd}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dim, #8895a8);">${nIv}</td>` +
      `<td style="padding: 3px 6px; color: #5fb3ff;">${nHomA}</td>` +
      `<td style="padding: 3px 6px; color: #c7d3e4;">${nHet}</td>` +
      `<td style="padding: 3px 6px; color: #e07b7b;">${nHomB}</td>` +
      `<td style="padding: 3px 6px; color: var(--ink-dimmer, #5a6472);">${_esc(chainId)}</td>`;
    tbody.appendChild(tr);
  }
  if (countEl) {
    const nReg = regimes.length;
    const nCh  = chains.length;
    countEl.textContent = `${nReg} regime${nReg === 1 ? '' : 's'}` +
                          (nCh > 0 ? ` · ${nCh} chain${nCh === 1 ? '' : 's'}` : '');
  }
}
