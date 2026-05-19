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

// Sample-color resolution is now in shared/sample_color.js. The regimes
// panels pass their own state to resolveSampleScopeColor, so this
// module no longer needs to set local_pca_dosage's _pageState as a side effect.
// Page-isolation per specs_todo/SPEC_registry_write_and_page_isolation.md.

// Pipeline core (audited v3.4)
import { runBandingPipeline, BANDING_PIPELINE_DEFAULTS }
  from '../../shared/band_tracking/banding_pipeline.js';

// Catalogue serializer
import { buildCatalogue, computeKnobHash }
  from '../../shared/band_tracking/regime_catalogue.js';

// Panel modules (sibling files in haplotype_regimes/)
import { initRegimesPage, computeGenomeView } from './haplotype_regimes/regimes_page.js';
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
  // local_pca_dosage; we replicate here so this page works without local_pca_dosage having mounted.)
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
  const runBtn     = root.querySelector('#rgRunPipelineBtn');
  const exportBtn  = root.querySelector('#rgExportCatalogueBtn');
  const promoteBtn = root.querySelector('#rgPromoteSeedBtn');
  const statusEl   = root.querySelector('#rgStatus');

  // 2026-05-20: mode toggle (long-range V-walker vs short-range
  // user-curated candidate list). Restored from localStorage; click
  // updates state._regimesMode and changes the run-pipeline button's
  // tooltip so the user knows what'll run.
  state._regimesMode = state._regimesMode || 'long';
  try {
    const saved = localStorage.getItem('haplotype_regimes.mode');
    if (saved === 'short' || saved === 'long') state._regimesMode = saved;
  } catch (_) {}
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
        if (runBtn) {
          runBtn.title = state._regimesMode === 'short'
            ? "Build seeds from the local_pca_dosage candidate list (no auto-discovery — review what you've drafted)."
            : "Run the V-walker Stage 1 + Stage 3 locus construction across the whole chromosome.";
        }
      });
    });
    if (runBtn) {
      runBtn.title = state._regimesMode === 'short'
        ? "Build seeds from the local_pca_dosage candidate list (no auto-discovery — review what you've drafted)."
        : "Run the V-walker Stage 1 + Stage 3 locus construction across the whole chromosome.";
    }
  }

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
  // 2026-05-20: dispatch on mode. Short-range builds seeds from the
  // local_pca_dosage candidate list (no V-walker). Long-range = the
  // original V-walker pipeline.
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
    _setStatus(root,
      `short-range ran in ${ms}ms · ` +
      `${result.stage3.loci.length} candidate${result.stage3.loci.length === 1 ? '' : 's'} as seeds`);
    state._regimesResult = result;
    state._regimesOpts   = {};
    _afterPipelineRun(root, state, result);
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

  _afterPipelineRun(root, state, result, opts);
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
  try { _renderSeedsStrip(root, state); }
  catch (e) { console.warn('_renderSeedsStrip:', e); }
  _wireSeedStripFocalSync(root, state);
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
  if (!wrap || !list) return;
  const result = state && state._regimesResult;
  const loci   = result && result.stage3 && Array.isArray(result.stage3.loci)
    ? result.stage3.loci : [];
  const seeds  = result && result.stage1 && Array.isArray(result.stage1.seeds)
    ? result.stage1.seeds : [];
  if (loci.length === 0) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  wrap.style.display = 'flex';
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

function _focusSeedFromChip(state, idx) {
  if (!state || !state.regimesPanel || !state.regimesPanel.focal) return;
  const loci = state._regimesResult && state._regimesResult.stage3
            && state._regimesResult.stage3.loci;
  if (!Array.isArray(loci) || idx < 0 || idx >= loci.length) return;
  const rp = state.regimesPanel;
  rp.focal.seed_index = idx;
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
