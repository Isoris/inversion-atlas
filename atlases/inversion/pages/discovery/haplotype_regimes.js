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
import { runBandingPipelineAsync, BANDING_PIPELINE_DEFAULTS }
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
import { persistDebounced } from '../../shared/persist_debounced.js';

// 2026-05-27 file split (Part C of the audit): four sibling modules
// host code that used to live inline in this file. The aliases
// preserve the legacy `_setStatus` / `_esc` / `_exportCatalogue` /
// etc. call sites that pepper the remainder of the file — no need
// to touch every caller in this commit.
import { setStatus as _setStatus, escapeHtml as _esc }
  from './haplotype_regimes/util.js';
import { exportCatalogue as _exportCatalogue }
  from './haplotype_regimes/catalogue_export.js';
import {
  bandQualityStats as _bandQualityStats,
  autoCalibrateAnchorBQ as _autoCalibrateAnchorBQ,
} from './haplotype_regimes/band_quality_calibration.js';
import {
  applyViewToggle as _applyViewToggle,
  renderRegimesSummary as _renderRegimesSummary,
} from './haplotype_regimes/regimes_summary.js';
import { buildShortRangeResult as _buildShortRangeResult }
  from './haplotype_regimes/short_range.js';
import { buildHetSkeletonResult as _buildHetSkeletonResult }
  from './haplotype_regimes/het_skeleton.js';
import { renderL3PairsTable } from './haplotype_regimes/l3_pairs_table.js';
import { runAutoMerge } from './haplotype_regimes/auto_merge.js';

// Adapter: existing call sites pass (root, state) only; the new
// module accepts an optional onAfterMerge callback so the L3-pair
// "merge → candidate" button can re-run the pipeline. We wire the
// callback here once.
function _renderL3PairsTable(root, state) {
  renderL3PairsTable(root, state, {
    onAfterMerge: () => _runPipeline(root, state),
  });
}

// Adapter for the two granularities. The shared driver lives in
// haplotype_regimes/auto_merge.js; the wrappers keep the action-bar
// wiring unchanged.
async function _runAutoMergeCramersV(root, state, atlasState) {
  return runAutoMerge(root, state, atlasState, 'local', {
    onRefresh: () => {
      try { _renderSeedsStrip(root, state); } catch (_) {}
      try { _renderL3PairsTable(root, state); } catch (_) {}
    },
  });
}
async function _runAutoMergeCramersVMacro(root, state, atlasState) {
  return runAutoMerge(root, state, atlasState, 'macrostripe', {
    onRefresh: () => {
      try { _renderSeedsStrip(root, state); } catch (_) {}
      try { _renderL3PairsTable(root, state); } catch (_) {}
    },
  });
}

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

  // Contribute a chrom summary so a user who lands directly here
  // (skipping local_pca_dosage) still populates the cross-chrom summary
  // cache (SPEC_multichrom_load_orchestrator Slice 1). Idempotent.
  try {
    const cs = await import('../../../../core/chrom_summary.js');
    if (typeof atlasState.setChromSummary === 'function') {
      atlasState.setChromSummary(chrom, cs.buildChromSummary(data, { chrom }));
    }
  } catch (_) { /* don't block the mount on a non-essential cache write */ }

  // Ensure PC1 + PC2 sign-align arrays exist on this page's state regardless
  // of whether local_pca_dosage was visited first.
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
  const kRangeLo = (state.kRange && state.kRange[0]) || 2;
  const kRangeHi = (state.kRange && state.kRange[1]) || 6;
  const useAdaptiveK = state.kMode === 'adaptive';
  const fixedK = state.k;

  // 2026-05-21 perf (HR1 #2): cache the per-window K-means result on
  // `data._regimesPerWinCache`, keyed by the knob tuple that determines
  // the output. Re-mounting the same chrom (very common — tabbing away
  // & back, switching modes between long/short/het, replay-from-stash)
  // skips the 1-2 second build entirely. Switching chroms invalidates
  // naturally (different `data` → no cache present). Tweaking knobs
  // invalidates via the key string. The cache lives ON the data object
  // because `data` IS the chrom identity; piggybacking here avoids a
  // separate eviction policy.
  const _knobKey = useAdaptiveK
    ? `adaptive|${kRangeLo}-${kRangeHi}|sil=${state.silThreshold}|minG=${state.minNGroup}`
    : `fixed|k=${fixedK}`;
  const _cached = data._regimesPerWinCache;
  let perWinLabels, perWinK;
  if (_cached && _cached.key === _knobKey) {
    perWinLabels = _cached.labels;
    perWinK      = _cached.K;
    state._regimesPerWinProvenance = _cached.provenance;
  } else {
    perWinLabels = new Array(N);
    perWinK      = new Int8Array(N);
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
        // adaptiveK1D pre-sorts once internally and threads to the inner
        // kmeans1D calls (HR1 #1 fix in shared/kmeans.js).
        const ak = adaptiveK1D(win.pc1, kRangeLo, kRangeHi,
                               state.silThreshold, state.minNGroup);
        if (ak != null) {
          labels = ak.labels;
          K = ak.k;
        } else {
          // 2026-05-21 perf: pre-sort once for the fallback kmeans1D.
          const sorted = Float64Array.from(win.pc1).sort();
          const fit = kmeans1D(win.pc1, kRangeLo, { presorted: sorted });
          labels = fit.labels;
          K = kRangeLo;
        }
      } else {
        const sorted = Float64Array.from(win.pc1).sort();
        const fit = kmeans1D(win.pc1, fixedK, { presorted: sorted });
        labels = fit.labels;
        K = fixedK;
      }
      perWinLabels[w] = labels;
      perWinK[w] = K;
      perWinComputed++;
    }
    state._regimesPerWinProvenance = {
      n_windows:  N,
      n_computed: perWinComputed,
      n_skipped:  perWinSkipped,
    };
    data._regimesPerWinCache = {
      key:        _knobKey,
      labels:     perWinLabels,
      K:          perWinK,
      provenance: state._regimesPerWinProvenance,
    };
  }
  state._regimesPerWinLabels = perWinLabels;
  state._regimesPerWinK      = perWinK;

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
  //
  // 2026-05-21 perf (HR1 #2): cached on `data._regimesBQCache` with the
  // same knob key as the per-window K-means cache. Re-mount on the same
  // chrom + knobs = skip the whole pass.
  // ---------------------------------------------------------------------
  let bqCache;
  const _bqCached = data._regimesBQCache;
  if (_bqCached && _bqCached.key === _knobKey) {
    bqCache = _bqCached.bq;
    state._regimesBandQualityProvenance = _bqCached.provenance;
  } else {
    bqCache = new Float32Array(N);
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
    state._regimesBandQualityProvenance = {
      n_windows:    N,
      n_from_producer: bqProducerCount,
      n_computed:   bqComputedCount,
      n_zero:       bqZeroCount,
    };
    data._regimesBQCache = {
      key:        _knobKey,
      bq:         bqCache,
      provenance: state._regimesBandQualityProvenance,
    };
  }
  state._regimesBandQualityCache = bqCache;

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
        persistDebounced('haplotype_regimes.mode', state._regimesMode);
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
        persistDebounced('haplotype_regimes.view', state._regimesView);
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
  // The pipeline is CPU-heavy; yield to the browser first so the status
  // update paints. (Still needed even with the async pipeline so the
  // first "running pipeline…" status renders before Stage 1 starts.)
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

  // 2026-05-21 perf (HR2 + HR8): async pipeline with per-stage AND
  // intra-Stage 1 (anchor-level) progress. Browser stays responsive
  // throughout — including DURING the long Stage 1 anchor sweep, which
  // yields every 50 anchors. The user sees a progress bar instead of a
  // 1-2 second freeze.
  const _STAGE_LABELS = {
    stage1: 'stage 1 (chain walk + seed discovery)',
    stage2: 'stage 2 (cross-seed linkage)',
    stage3: 'stage 3 (refine loci)',
    stage4: 'stage 4 (bruteforce voting)',
  };
  const onProgress = (stage, partial) => {
    if (stage === 'stage1_progress') {
      // Anchor-level update from runStage1Async — shape:
      //   { chrom_idx, anchors_done, anchors_total, n_seeds }
      const pct = Math.min(100,
        Math.round((partial.anchors_done / partial.anchors_total) * 100));
      _setStatus(root,
        `running pipeline — stage 1 · ${pct}% ` +
        `(${partial.anchors_done}/${partial.anchors_total} anchors, ${partial.n_seeds} seeds)…`);
      return;
    }
    const label = _STAGE_LABELS[stage] || stage;
    const seenSeeds = partial && partial.stage1
      ? ` · ${partial.stage1.seeds.length} seeds so far`
      : '';
    _setStatus(root, `running pipeline — ${label}${seenSeeds}…`);
  };

  let result;
  const t0 = performance.now();
  try {
    result = await runBandingPipelineAsync(ctx, opts, onProgress);
  } catch (e) {
    console.error('runBandingPipelineAsync threw:', e);
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
  try { window.location.hash = '#/inversion/candidate_focus'; }
  catch (e) { console.warn('[haplotype_regimes] hash navigation to candidate_focus failed:', e); }
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

/**
 * Serialize the in-memory pipeline result to a regime catalogue (manifest +
 * knobs + catalogue.json) and trigger a browser download for each.
 *
 * Cohort id, reference id, pipeline version, and sample IDs come from the
 * atlas data/manifest. Window→bp mapping uses the per-window
 * `start_bp` / `end_bp` fields written by the scrubber_main JSON.
 */



// ---------------------------------------------------------------------------
// band_quality diagnostics — surfaces the cache distribution so when
// the pipeline returns 0 seeds the user can see immediately whether
// it's because BQ wasn't computed (producer didn't ship it AND we
// couldn't derive it) or because every window's BQ is below the seed
// gate's 0.50 default.
// ---------------------------------------------------------------------------

// Adaptive seed-discovery threshold. If the default 0.50 catches at
// least 5 windows, use it. Otherwise step down to 0.40, then 0.30, then
// 0.20. Below 0.20 we stop — at that point the data is too noisy for
// the seed-discovery walker to produce meaningful seeds, and the right
// answer is "no inversions detectable on this chromosome".

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

