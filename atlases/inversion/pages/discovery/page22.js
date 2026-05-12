// pages/discovery/page22.js
// =============================================================================
// page22 — Long-range haplotype regimes (Stage 4 bruteforce projection)
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

// Sample-color resolution is now in shared/sample_color.js. The regimes
// panels pass their own page22 state to resolveSampleScopeColor, so this
// module no longer needs to set page1's _pageState as a side effect.
// Page-isolation per specs_todo/SPEC_registry_write_and_page_isolation.md.

// Pipeline core (audited v3.4)
import { runBandingPipeline, BANDING_PIPELINE_DEFAULTS }
  from '../../shared/band_tracking/banding_pipeline.js';

// Catalogue serializer
import { buildCatalogue, computeKnobHash }
  from '../../shared/band_tracking/regime_catalogue.js';

// Panel modules (sibling files in page22/)
import { initRegimesPage, computeGenomeView } from './page22/regimes_page.js';
import { classifyProjection } from '../../shared/band_tracking/projection.js';
import { _dosageClassColour } from './page22/regimes_panel.js';

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

  // Build the per-window-labels bridge (clusterL2 backed by a cache).
  _wireCtxCallbacks(state, atlasState);

  // Wire the action bar buttons.
  _wireActionBar(root, state, atlasState);

  _setStatus(root, `loaded ${chrom} · ${data.n_windows} windows · ${data.n_samples} samples · ready`);
}

export async function unmount(root) {
  _pageState = null;
  // Note: arrow-key handlers attached by initRegimesPage are document-level.
  // initRegimesPage returns a teardown closure but we don't currently
  // capture it — TODO: capture the unsubscribe and call it here.
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
  legacy.flipPC1 = inv.flipPC1 || false;
  legacy.pc1Sign = inv.pc1Sign || null;
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

  // Build window→L2 index. (Mirrors what _data.js buildIndexes does for
  // page1; we replicate here so this page works without page1 having mounted.)
  const N = data.n_windows;
  const windowToL2 = new Int32Array(N).fill(-1);
  if (Array.isArray(data.l2_envelopes)) {
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

  // Build a clusterL2 ctx. contextFromState reads clustering knobs from
  // `state` directly; set Quentin's defaults on state before the call
  // (k=3, adaptive, mergeThr 0.85, minNGroup 5, minNWin 5).
  state.k            = state.k            != null ? state.k            : 3;
  state.aggMethod    = state.aggMethod    || 'mean_pc1';
  state.kMode        = state.kMode        || 'adaptive';
  state.kRange       = state.kRange       || [2, 6];
  state.silThreshold = state.silThreshold != null ? state.silThreshold : 0.5;
  state.minNGroup    = state.minNGroup    != null ? state.minNGroup    : 5;
  state.minNWin      = state.minNWin      != null ? state.minNWin      : 5;
  const clCtx = contextFromState(state);
  const clCache = new ClusterCache();
  state._regimesClusterCache = clCache;
  state._regimesClusterCtx   = clCtx;

  // Per-window callbacks for the pipeline.
  const labelsForWindow = (w) => {
    const li = windowToL2[w];
    if (li < 0) return null;
    const cl = clCache.getOrCompute(clCtx, li);
    if (!cl || !cl.ok || !cl.labels) return null;
    // clusterL2 returns Int32Array; pipeline accepts any array-like.
    return cl.labels;
  };
  const KForWindow = (w) => {
    const li = windowToL2[w];
    if (li < 0) return 1;
    const cl = clCache.getOrCompute(clCtx, li);
    return (cl && cl.ok && cl.usedK) ? cl.usedK : 1;
  };
  const bandQualityForWindow = (w) => {
    const win = data.windows && data.windows[w];
    if (!win) return 0;
    return win.band_quality != null ? win.band_quality
         : win.bq != null           ? win.bq
         : 0;
  };

  state._regimesCtx = {
    chromosomes: [{ s_window: 0, e_window: N - 1, name: state.activeChrom }],
    getLabels:      labelsForWindow,
    getK:           KForWindow,
    getBandQuality: bandQualityForWindow,
    getL2Idx:       (w) => windowToL2[w],
    isWindowValid:  (w) => KForWindow(w) >= 2,
    n_samples:      data.n_samples,
  };

  // PC1 accessor for the regimes_pc1_panel.
  state._regimesGetPC1 = (w) => {
    const win = data.windows && data.windows[w];
    return win ? win.pc1 : null;
  };
}

function _wireActionBar(root, state, atlasState) {
  const runBtn    = root.querySelector('#rgRunPipelineBtn');
  const exportBtn = root.querySelector('#rgExportCatalogueBtn');
  const statusEl  = root.querySelector('#rgStatus');

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      await _runPipeline(root, state);
    });
  }
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      _exportCatalogue(state, atlasState);
    });
  }
}

/**
 * Run the v3.4 banding pipeline against the active chromosome and
 * initialise the four regimes panels.
 */
async function _runPipeline(root, state) {
  const ctx = state._regimesCtx;
  if (!ctx) {
    _setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }
  _setStatus(root, 'running pipeline…');
  // The pipeline is synchronous and CPU-heavy; yield to the browser first
  // so the status update paints.
  await new Promise(r => setTimeout(r, 0));

  const opts = {
    stage4_scope: 'seeds_only',
    skip_stage4: false,
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

  const summary = result.summary || {};
  _setStatus(root,
    `pipeline ran in ${ms}ms · ` +
    `${summary.n_seeds_after_plateau || 0} seeds · ` +
    `${summary.n_loci || 0} loci · ` +
    `${summary.n_targets || 0} targets · ` +
    `${summary.n_stability_upgraded || 0} COHERENT_SPLIT promotions`);

  // Initialise the regimes page (this builds state.regimesPanel and renders
  // the four panels). We pass classifyProjection as the static classifier;
  // the panels can override via classifyOpts.
  initRegimesPage(state, {
    bandingResult:       result,
    getLabels:           ctx.getLabels,
    getK:                ctx.getK,
    getPC1:              state._regimesGetPC1,
    getMacroDosage:      null,    // wire later when dosage chunks available
    classifyFn:          classifyProjection,
    classifyOpts:        opts.projection || {},
    bandComboMode:       'additive',
    current_chromosome_idx: 0,
    enable_genome_view:  false,    // single chromosome — genome-scope is degenerate
  });

  // Enable the export button now that there's something to serialize.
  const exportBtn = root.querySelector('#rgExportCatalogueBtn');
  if (exportBtn) exportBtn.disabled = false;
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
