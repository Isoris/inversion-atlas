// pages/discovery/haplotype_regimes/run_pipeline.js
//
// Pipeline orchestrator (2026-05-27 Part C extraction).
//
// Three exports:
//   runPipeline           — mode dispatcher (long / short / het) +
//                           shared post-seeding tail.
//   afterPipelineRun      — panel render + button enablement +
//                           cross-mount stash.
//   runPostSeedingTail    — Cluster 2 (breadth voting) + Cluster 3
//                           (regime refinement + topology + genome-
//                           scale + annotation + serialise).

import { runBandingPipeline, BANDING_PIPELINE_DEFAULTS }
  from '../../../shared/band_tracking/banding_pipeline.js';
import {
  runBreadthVoting,
  buildVotersFromSeedLoci,
  buildTargetsFromStage3Loci,
} from '../../../shared/band_tracking/breadth_voting.js';
import { refineRegimesFromIntervals }
  from '../../../shared/band_tracking/haplotype_regime.js';
import {
  buildRegimeTopologyGraph,
  findChromosomeRegimeChains,
  serializeRegimesToJson,
} from '../../../shared/band_tracking/regime_topology.js';
import {
  mergePerChromosomeRegimes,
  crossChromosomeRegimeLinks,
} from '../../../shared/band_tracking/genome_scale.js';
import { annotateRegimePositions }
  from '../../../shared/regime_annotation/positional.js';
import { annotateRegimeStructures }
  from '../../../shared/regime_annotation/structure.js';
import { classifyProjection }
  from '../../../shared/band_tracking/projection.js';

import { initRegimesPage } from './regimes_page.js';
import { buildHetSkeletonResult } from './het_skeleton.js';
import { buildShortRangeResult } from './short_range.js';
import { bandQualityStats, autoCalibrateAnchorBQ } from './band_quality_calibration.js';
import {
  renderSeedsStrip,
  pushFocalSeedGroups,
  wireSeedStripFocalSync,
} from './seeds_strip.js';
import { renderL3PairsTable } from './l3_pairs_table.js';
import { renderRegimesSummary, applyViewToggle } from './regimes_summary.js';
import { setStatus } from './util.js';

/**
 * Run the pipeline against the active chromosome's pre-wired ctx
 * (state._regimesCtx). Dispatches on state._regimesMode:
 *   'long'  — runBandingPipeline (V-walker, Stages 1-4)
 *   'short' — buildShortRangeResult (curated candidates as seeds)
 *   'het'   — buildHetSkeletonResult (Cluster 1 Path B)
 * All three modes then run the shared post-seeding tail (Cluster 2 +
 * Cluster 3 + topology + annotations + serialise).
 */
export async function runPipeline(root, state) {
  // 2026-05-20: status ping at entry so the user can confirm the click
  // landed even if a precondition fails immediately.
  setStatus(root, 'preparing pipeline run…');
  if (!state) {
    setStatus(root, 'pipeline: state is null — reload the page');
    return;
  }
  if (!state.data) {
    setStatus(root, 'pipeline: no chromosome loaded — pick one from the toolbar');
    return;
  }
  const ctx = state._regimesCtx;
  if (!ctx) {
    setStatus(root, 'pipeline ctx not wired — reload the page');
    return;
  }
  // Dispatch on mode.
  if (state._regimesMode === 'het') {
    setStatus(root, 'building het-skeleton seeds…');
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    let result = null;
    try { result = buildHetSkeletonResult(state); }
    catch (e) {
      console.error('het-skeleton build threw:', e);
      setStatus(root, `het-skeleton failed: ${e.message}`);
      return;
    }
    const ms = (performance.now() - t0).toFixed(0);
    if (!result || !result.stage3 || result.stage3.loci.length === 0) {
      setStatus(root,
        `het-skeleton: 0 intervals on this chrom. Check console for `
        + `per-window K-means + HET-detection diagnostics.`);
      return;
    }
    try { runPostSeedingTail(root, state, result, 'het', ms); }
    catch (e) {
      console.error('post-seeding tail (het) threw:', e);
      setStatus(root, `post-seeding failed: ${e.message}`);
    }
    return;
  }
  if (state._regimesMode === 'short') {
    setStatus(root, 'building short-range seeds from candidate list…');
    await new Promise(r => setTimeout(r, 0));
    const t0 = performance.now();
    let result = null;
    try { result = buildShortRangeResult(state); }
    catch (e) {
      console.error('short-range build threw:', e);
      setStatus(root, `short-range failed: ${e.message}`);
      return;
    }
    const ms = (performance.now() - t0).toFixed(0);
    if (!result || !result.stage3 || result.stage3.loci.length === 0) {
      setStatus(root,
        `short-range: 0 candidates on this chrom. Promote candidates in `
        + `local_pca_dosage first (lock colors → ★ promote).`);
      return;
    }
    state._regimesOpts = {};
    try { runPostSeedingTail(root, state, result, 'short', ms); }
    catch (e) {
      console.error('post-seeding tail (short) threw:', e);
      setStatus(root, `post-seeding failed: ${e.message}`);
    }
    return;
  }
  // Default mode: V-walker.
  setStatus(root, 'running pipeline…');
  await new Promise(r => setTimeout(r, 0));

  // Pre-flight: dump band_quality stats so 0-seeds runs are diagnosable.
  const bqStats = bandQualityStats(state);
  console.log('[haplotype_regimes] band_quality stats:', bqStats);

  // Adaptive seed-discovery threshold. Default 0.50; step down when <5
  // windows pass. STAGE_B_v3_NOTES §2.
  const minAnchorBQ = autoCalibrateAnchorBQ(bqStats);

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
    setStatus(root, `pipeline failed: ${e.message}`);
    return;
  }
  const ms = (performance.now() - t0).toFixed(0);

  state._regimesResult = result;
  state._regimesOpts   = opts;
  state._regimesBQStats = bqStats;

  const summary = result.summary || {};
  const nSeeds = summary.n_seeds_after_plateau || 0;
  if (nSeeds === 0) {
    setStatus(root,
      `pipeline ran in ${ms}ms · 0 seeds · `
      + `BQ: ${bqStats.n_pass_default}/${bqStats.n_windows} passed default 0.50 `
      + `(threshold used: ${minAnchorBQ.toFixed(2)}) · `
      + `BQ provenance: ${bqStats.provenance.n_computed} computed, `
      + `${bqStats.provenance.n_from_producer} producer-shipped, `
      + `${bqStats.provenance.n_zero} zero. See console for details.`);
    return;
  }
  state._regimesOpts = opts;
  try { runPostSeedingTail(root, state, result, 'long', ms); }
  catch (e) {
    console.error('post-seeding tail (long) threw:', e);
    setStatus(root, `post-seeding failed: ${e.message}`);
  }
}

/**
 * Drive the panel re-render + enable the right action-bar buttons +
 * stash the pipeline result for cross-mount restore.
 */
export function afterPipelineRun(root, state, result, opts) {
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
  // Auto-merge V (local) — needs ≥ 2 Stage 1 seeds.
  const autoMergeBtn = root.querySelector('#rgAutoMergeBtn');
  const seedsArr = (result.stage1 && Array.isArray(result.stage1.seeds))
    ? result.stage1.seeds : [];
  if (autoMergeBtn) {
    autoMergeBtn.disabled = seedsArr.length < 2;
    autoMergeBtn.title = seedsArr.length < 2
      ? 'Need at least 2 Stage 1 seeds for adjacent-pair Cramér\'s V auto-merge.'
      : `Walk ${seedsArr.length - 1} adjacent seed pair${seedsArr.length - 1 === 1 ? '' : 's'}, auto-promote MERGE chains as candidates.`;
  }
  // Auto-merge V (macrostripe) — needs ≥ 1 locus with ≥ 2 seeds.
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
  try { renderSeedsStrip(root, state); }
  catch (e) { console.warn('renderSeedsStrip:', e); }
  wireSeedStripFocalSync(root, state);

  // Push the initial focal seed's regime partition into shared.activeGroups.
  try { pushFocalSeedGroups(state); } catch (_) {}
  // L3 adjacent-pair Cramér mini-table — short-mode only inside the
  // function itself, but we always trigger it so the table updates on
  // mode switches.
  try {
    renderL3PairsTable(root, state, {
      onAfterMerge: () => runPipeline(root, state),
    });
  } catch (e) { console.warn('renderL3PairsTable:', e); }

  // Stash on atlasState for cross-mount restore. Slot is namespaced by
  // state._pageId so haplotype_regimes (long/het modes) and
  // candidate_regimes (short mode) don't overwrite each other's
  // cached result when the user tabs between them.
  try {
    const atlas = state && state._atlasState;
    if (atlas && atlas.inversion) {
      const pageId = state._pageId || 'haplotype_regimes';
      atlas.inversion['_' + pageId + '_stash'] = {
        chrom:  state.activeChrom,
        result: result,
        opts:   opts || {},
      };
    }
  } catch (e) { console.warn('[stash] write failed:', e); }
}

/**
 * Cluster 2 (breadth voting) + Cluster 3 (regime refinement,
 * topology, genome-scale aggregation, positional + structural
 * annotation, serialise). Drives panel re-render via
 * afterPipelineRun.
 */
export function runPostSeedingTail(root, state, result, modeLabel, msSoFar) {
  const ctx = state._regimesCtx;
  if (!ctx) return;
  const data = state.data;
  const timing = {};

  // Cluster 2 — breadth voting (V-walker already did it inside
  // runBandingPipeline, so this fires for short + het only).
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

  // Cluster 3 — convert loci into intervals (with HOM cores).
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

  // Genome-scale (single-chrom on this page).
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

  // Annotation. Positional needs chrom_meta; structural synthesises
  // per-regime structure_meta from band/interval counts.
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

  // Cross-page payload (catalogue triple is generated on demand).
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
  let capNote = '';
  const sm = result.summary || {};
  if (Number.isFinite(sm.n_chains_capped) && sm.n_chains_capped > 0) {
    capNote = ` · capped ${sm.n_chains_before_cap} chains → top ${sm.het_max_seeds} by span`;
  }
  setStatus(root,
    `${modeLabel} mode ran in ${msSoFar}ms · `
    + `${nSeeds} seeds · ${nLoci} loci · ${nRegimes} regimes · ${nChains} chains`
    + capNote
    + (timingStr ? ` · ${timingStr}` : ''));

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

  // Drive panel render.
  try { afterPipelineRun(root, state, result, {}); }
  catch (e) { console.warn('[post-seeding] afterPipelineRun threw —', e); }

  // Populate the long-range regimes summary table + apply the
  // current view toggle so the right section is visible.
  try { renderRegimesSummary(root, state); }
  catch (e) { console.warn('[post-seeding] renderRegimesSummary threw —', e); }
  try { applyViewToggle(root, state); }
  catch (e) { console.warn('[post-seeding] applyViewToggle threw —', e); }
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
