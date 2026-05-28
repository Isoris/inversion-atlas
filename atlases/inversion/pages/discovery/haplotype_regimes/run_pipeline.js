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
import { buildRegimeTables, lengthBinAggregate }
  from '../../../shared/mgl_regime_consistency.js';

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

  // Build + render the 4-table regime summary bundle. Pure compute on
  // top of the banding result + ctx — dosage_per_sample omitted in v1
  // (homA/het/homB will read 0); a follow-up wires per-locus dosage in.
  // The render is candidate_regimes-only for now: the panel HTML only
  // exists on that page; haplotype_regimes will get its own panel in
  // a follow-up.
  // Build the regime-summary bundle + write the cross-atlas registry on
  // BOTH producer pages (haplotype_regimes + candidate_regimes). The
  // panel RENDER inside is gated to candidate_regimes (only that page has
  // the panel HTML), but the bundle build + registeredCandidates write
  // must run regardless so downstream atlases (popstats_demo, …) see the
  // candidates no matter which page launched the pipeline.
  try {
    _renderRegimeSummaryBundle(root, state, result, opts);
  } catch (e) {
    console.warn('[regime-summary] build/render threw —', e);
  }
}

// Lazy-loaded so haplotype_regimes (which doesn't have the panel HTML)
// doesn't pull the renderer + palette modules at all.
async function _renderRegimeSummaryBundle(root, state, result, opts) {
  const ctx = state._regimesCtx;
  if (!ctx || !result || !result.stage3) return;
  // Map stage3 loci back to candidates from the local_pca_dosage stash
  // (short-mode 1:1 — each candidate is one locus).
  const atlas = state._atlasState;
  const lpd = atlas && atlas.inversion && atlas.inversion._local_pca_dosage_state;
  const candList = (lpd && Array.isArray(lpd.candidateList)) ? lpd.candidateList : [];
  const chrom = state.activeChrom;
  const onChrom = candList.filter(c => c && (!c.chrom || c.chrom === chrom));
  // Resolve canonical sample-id STRINGS (not the sample objects). The
  // bundle stores sample_ids[idx] verbatim into sample_regime_calls[].sample_id
  // → regime_groups → the popstats request body, where the schema demands
  // strings. data.samples[i] is an object ({cga, ind, id, …}); map it to
  // the canonical id the VCF / popstats server uses (cga first, matching
  // shared/candidate_groups.js + candidate_focus/_popstats_panels.js).
  const sample_ids = (state.data && Array.isArray(state.data.samples))
    ? state.data.samples.map(_canonicalSampleId) : null;
  // Pull per-sample mean dosage from the candidate (when present) — used
  // for homA/het/homB tier counts. Each candidate's mean_dosage_per_sample
  // covers its own marker range, so we average over the candidates the
  // sample is assigned to. v1 keeps it simple: pick the first candidate's
  // array as the global reference. Follow-up: per-locus dosage.
  let dosage_per_sample = null;
  for (const c of onChrom) {
    if (c && c.mean_dosage_per_sample && c.mean_dosage_per_sample.length > 0) {
      dosage_per_sample = c.mean_dosage_per_sample;
      break;
    }
  }
  const bundle = buildRegimeTables({
    result,
    ctx,
    dosage_per_sample,
    candidates: onChrom,
    sample_ids,
    chromName: () => chrom,
    opts: opts || {},
  });
  bundle.length_binned_aggregate = lengthBinAggregate(bundle.candidate_regime_summary);
  state._regimeSummaryBundle = bundle;

  // 2026-05-27: auto-register confirmed candidates into the cross-atlas
  // shared registry. Other atlases (popstats, gene annotation, age
  // inference) read from atlasState.shared.registeredCandidates without
  // having to re-run any compute or watch for export events.
  try { _registerCandidatesIntoSharedState(state, bundle, onChrom); }
  catch (e) { console.warn('[regime-summary] shared registry write threw —', e); }

  // Render via the page's panel module — candidate_regimes only (the
  // panel HTML lives on that page; haplotype_regimes will get its own
  // panel in a follow-up). The bundle build + registry write above ran
  // regardless of page, so popstats_demo is fed either way.
  if (state._pageId !== 'candidate_regimes') return;
  try {
    const mod = await import('../../classification/candidate_regimes/regime_summary_panel.js');
    mod.renderRegimeSummaryPanel(root, bundle, {
      downloadPrefix: `${chrom || 'chr'}_regime_`,
    });
  } catch (e) {
    console.warn('[regime-summary] panel render threw —', e);
  }
}

// Canonical sample-id resolver. data.samples[i] may be an object
// ({cga, ind, sample_id, id}) or already a bare string; either way
// return the string the VCF / popstats server keys on. Mirrors
// shared/candidate_groups.js _sampleId + candidate_focus _sampleId.
function _canonicalSampleId(s) {
  if (s == null) return null;
  if (typeof s === 'string') return s;
  return s.cga || s.ind || s.sample_id || s.id || null;
}

// Per-call → popstats-server label dict. Local copy (also lives in
// regime_catalogue.js + candidate_groups.js) so this file has no new
// cross-imports.
const _REGIME_CALL_TO_SERVER = Object.freeze({
  homA_like: 'H1/H1',
  het_like:  'H1/H2',
  homB_like: 'H2/H2',
  uncertain: 'uncertain',
});

/**
 * Write atlasState.shared.registeredCandidates with one record per
 * confirmed candidate on this chromosome. Records carry everything
 * downstream atlases need to run their analyses without re-running
 * the regime pipeline:
 *
 *   { candidate_id, chrom, start_bp, end_bp, span_bp,
 *     regime_class, confidence, support_score,
 *     regime_groups: {H1/H1:[sids], H1/H2:[sids], H2/H2:[sids], uncertain:[sids]},
 *     n_per_regime: {…},
 *     supported_windows: [w_idx, …],
 *     qc: { possible_ancestry_confounding, possible_family_confounding, missingness },
 *     registered_at: ISO8601,
 *     source_page: 'haplotype_regimes' | 'candidate_regimes' }
 *
 * Per-chromosome write: records from other chromosomes survive
 * (registry is global; pipeline run is per-chrom).
 */
function _registerCandidatesIntoSharedState(state, bundle, candList) {
  const atlas = state && state._atlasState;
  if (!atlas) return;
  if (!atlas.shared) atlas.shared = {};
  const chrom = state.activeChrom;
  const nowISO = new Date().toISOString();
  const sourcePage = state._pageId || 'haplotype_regimes';

  // Group sub-arrays by candidate_id for O(n) lookup.
  const samplesByCand = new Map();
  const windowsByCand = new Map();
  const qcByCand      = new Map();
  for (const r of bundle.sample_regime_calls || []) {
    if (!r) continue;
    const k = r.candidate_id;
    if (!samplesByCand.has(k)) samplesByCand.set(k, []);
    samplesByCand.get(k).push(r);
  }
  for (const r of bundle.window_regime_support || []) {
    if (!r) continue;
    const k = r.candidate_id;
    if (!windowsByCand.has(k)) windowsByCand.set(k, []);
    windowsByCand.get(k).push(r);
  }
  for (const r of bundle.regime_qc_summary || []) {
    if (r) qcByCand.set(r.candidate_id, r);
  }

  // Build records for THIS chromosome.
  const records = [];
  for (const cand of bundle.candidate_regime_summary || []) {
    if (!cand || !cand.candidate_id) continue;
    const sCalls = samplesByCand.get(cand.candidate_id) || [];
    const wRows  = windowsByCand.get(cand.candidate_id) || [];
    const qcRow  = qcByCand.get(cand.candidate_id) || null;
    const groups = Object.create(null);
    const nPer   = Object.create(null);
    for (const r of sCalls) {
      if (!r.sample_id || !r.regime_call) continue;
      const key = _REGIME_CALL_TO_SERVER[r.regime_call] || r.regime_call;
      if (!groups[key]) { groups[key] = []; nPer[key] = 0; }
      groups[key].push(r.sample_id);
      nPer[key]++;
    }
    records.push({
      candidate_id:     cand.candidate_id,
      chrom:            cand.chrom || chrom,
      start_bp:         cand.start,
      end_bp:           cand.end,
      span_bp:          (cand.end != null && cand.start != null) ? (cand.end - cand.start + 1) : null,
      regime_class:     cand.regime_class,
      confidence:       cand.confidence,
      support_score:    cand.support_score,
      heterozygote_band_present: !!cand.heterozygote_band_present,
      regime_groups:    groups,
      n_per_regime:     nPer,
      supported_windows: wRows.filter(w => w.is_supported).map(w => w.window_id),
      qc: qcRow ? {
        possible_ancestry_confounding: !!qcRow.possible_ancestry_confounding,
        possible_family_confounding:   !!qcRow.possible_family_confounding,
        missingness:                   qcRow.missingness,
      } : null,
      registered_at:    nowISO,
      source_page:      sourcePage,
    });
  }

  // Merge into the cross-chromosome registry: drop prior records for
  // this chrom (a re-run replaces them), keep records from others.
  const prior = Array.isArray(atlas.shared.registeredCandidates)
    ? atlas.shared.registeredCandidates : [];
  const kept = prior.filter(r => r && r.chrom !== chrom);
  atlas.shared.registeredCandidates = kept.concat(records);
  // Idempotent: dispatch a custom event so any listening atlas can
  // react without polling.
  try {
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      document.dispatchEvent(new CustomEvent('atlas:registeredCandidatesUpdated', {
        detail: { chrom, n_added: records.length, total: atlas.shared.registeredCandidates.length },
      }));
    }
  } catch (_) {}
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
