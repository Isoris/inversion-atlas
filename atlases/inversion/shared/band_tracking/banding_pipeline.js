// shared/band_tracking/banding_pipeline.js
// =====================================================================
// UNIFIED BANDING ALGORITHM — single entry point.
//
// This module ties together:
//   Stage 1 — seed_discovery.js   (V-driven local seeds per chromosome)
//   Stage 2 — cross_seed_voting   (N×N pattern_class voting + linkage)
//   Stage 3 — locus_construction  (chain walk INSIDE each seed in
//                                  classifier mode → per-band sample sets)
//
// Architectural choice that reconciles the previous two iterations:
//
//   - The PREVIOUS version (v2 locus_construction) walked the whole
//     chromosome and used min_jaccard < 0.7 as the chain break rule.
//     Crossovers broke chains, L2 boundaries leaked into calls, the
//     mergeChainsAcrossGaps pass tried to recover what the walker had
//     just shattered. L1/L2 carried weight in the call.
//
//   - The NEW design replaces that backbone. Cramer's V is the load-
//     bearing signal: it produces local SEEDS per chromosome (a "seed"
//     is the V-red plateau around an anchor, terminated only by genuine
//     regime-end). The chain walk is preserved but moves INSIDE each
//     seed footprint in classifier mode, where its only job is to give
//     stable per-band sample identity (via Hungarian-aligned Jaccard
//     tracking, NOT chain breaking). REGIME_END can no longer trigger
//     inside a seed because Stage 1 already excised those regions.
//     CROSSOVER windows are absorbed; UNRELIABLE windows are skipped
//     in-walk; the walker emits one chain per seed.
//
//   - L1 and L2 become pure visualisation. They are not consulted by
//     this module at all. The legacy mergeChainsAcrossGaps step is
//     unreachable in classifier mode (locus_construction.js skips it
//     when getClassification is supplied).
//
// Output of this module is the "seed catalogue" — a flat array of
// records, each describing one putative inversion arrangement system,
// ready to be consumed by Stage C (breadth voting / partition consensus
// from the existing pipeline) and Stage D (Mendelian gates).
// =====================================================================

import {
  discoverSeedsOnChromosome,
  discoverSeedsOnChromosomeAsync,
  SEED_DISCOVERY_DEFAULTS,
} from './seed_discovery.js';

import {
  runStage2,
  CROSS_SEED_VOTING_DEFAULTS,
} from './cross_seed_voting.js';

import {
  chainWalkOneChromosome,
  locusBandSampleSets,
  locusBandSampleSetsMajority,
  LOCUS_CONSTRUCTION_DEFAULTS,
} from './locus_construction.js';

import {
  classifyWindow,
  WINDOW_CLASS,
  WINDOW_CLASSIFICATION_DEFAULTS,
} from './window_classification.js';

import {
  runBreadthVoting,
  buildVotersFromSeedLoci,
  buildTargetsFromWindows,
  buildTargetsFromStage3Loci,
  BREADTH_VOTING_DEFAULTS,
} from './breadth_voting.js';

import { consensus_partition as _consensus_partition } from './partition_consensus.js';

// ---------------------------------------------------------------------
// Defaults (cascade through the three stages)
// ---------------------------------------------------------------------

export const BANDING_PIPELINE_DEFAULTS = Object.freeze({
  // Stage 1
  seed_discovery: SEED_DISCOVERY_DEFAULTS,
  // Stage 2
  cross_seed:     CROSS_SEED_VOTING_DEFAULTS,
  // Stage 3 (per-seed chain walk)
  locus_construction: LOCUS_CONSTRUCTION_DEFAULTS,
  // Window classification — shared across stages 1 & 3 so the same
  // thresholds drive both the seed walker and the chain-walk break
  // rule. Override here if needed.
  classification: WINDOW_CLASSIFICATION_DEFAULTS,
  // V-plateau quality gate applied AFTER seed discovery: a seed is
  // dropped if fewer than this fraction of its windows classify as
  // INTERIOR. This catches anchors that were band_quality-picked but
  // sit on a V-marginal region (the local V profile didn't actually
  // form a clear plateau). Default 0.50.
  min_seed_interior_frac: 0.50,
  // Drop NOISE-verdict seeds (Stage 2 reliability) before Stage 3?
  // Default true. Set false for diagnostic runs where you want band
  // sets even for low-reliability seeds.
  drop_noise_seeds: true,
  // How to aggregate per-band sample sets across the locus body:
  //   'majority'     — assign each sample to its majority band across
  //                    locus windows (DEFAULT — robust to per-window
  //                    noise and intra-locus crossovers)
  //   'intersection' — strict intersection across windows (legacy,
  //                    stricter — discards a sample the first time it
  //                    drops a band)
  band_set_aggregation:    'majority',
  // For majority aggregation: minimum fraction of windows where a
  // sample's majority band must hit before the sample is included.
  // Below this, the sample is dropped as "no stable band". 0.5 means
  // strict majority; 0.0 keeps every sample.
  band_set_min_majority_frac: 0.5,
  // Stage 4 — breadth voting (seeds → targets, bruteforced consensus).
  breadth_voting: BREADTH_VOTING_DEFAULTS,
  // Stage 4 scope — what targets the seed bands vote on:
  //   'seeds_only'      — voters and targets are both seed loci. Cheap.
  //   'every_window'    — voters are seed bands; targets are every
  //                        window in the genome (subsampled by stride).
  //                        This is the FULL BRUTEFORCE.
  //   'custom'          — caller passes opts.target_windows explicitly.
  stage4_scope: 'seeds_only',
  // For 'every_window' scope: subsample stride (1 = every window).
  stage4_target_stride: 5,
  // Skip Stage 4? Default false — Stage 4 is the heart of the algo.
  // Set true when only stages 1-3 are needed (e.g. quick seed survey).
  skip_stage4: false,
});

// ---------------------------------------------------------------------
// Stage 1 — genome-wide seed discovery
//
// Sweep every chromosome with discoverSeedsOnChromosome, concatenate
// seeds, attach a chromosome_idx tag, apply the V-plateau quality
// gate. The seed catalogue is what Stage 2 votes on.
// ---------------------------------------------------------------------

/**
 * @param {object} ctx
 * @param {Array<{s_window:number, e_window:number}>} ctx.chromosomes
 * @param {(w:number) => Int8Array} ctx.getLabels
 * @param {(w:number) => number}    ctx.getK
 * @param {(w:number) => number}    ctx.getBandQuality
 * @param {Iterable<number>} [ctx.tracked_sample_idx]  default: all
 * @param {object} [opts]
 * @returns {{
 *   seeds: object[],          // each seed augmented with chromosome_idx
 *   per_chrom_summary: Array<{chrom_idx, n_provisional, n_raw, n_seeded, n_kept}>,
 * }}
 */
export function runStage1(ctx, opts) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const seed_opts = Object.assign({}, o.seed_discovery,
                                  { classification: o.classification });
  const all_seeds = [];
  const per_chrom = [];
  for (let ci = 0; ci < ctx.chromosomes.length; ci++) {
    const chr = ctx.chromosomes[ci];
    const sweep = discoverSeedsOnChromosome({
      getLabels:      ctx.getLabels,
      getK:           ctx.getK,
      getBandQuality: ctx.getBandQuality,
      chr_s_window:   chr.s_window,
      chr_e_window:   chr.e_window,
      tracked_sample_idx: ctx.tracked_sample_idx,
    }, seed_opts);
    // V-plateau quality gate: count INTERIOR windows in seed footprint
    let n_kept = 0;
    for (const seed of sweep.seeds) {
      const interior_frac = seedInteriorFrac(seed);
      seed.chromosome_idx = ci;
      seed.interior_frac  = interior_frac;
      if (interior_frac >= o.min_seed_interior_frac) {
        all_seeds.push(seed);
        n_kept++;
      }
    }
    per_chrom.push({
      chrom_idx:     ci,
      n_provisional: sweep.n_provisional,
      n_raw:         sweep.n_raw,
      n_seeded:      sweep.n_seeded,
      n_kept,
    });
  }
  return { seeds: all_seeds, per_chrom_summary: per_chrom };
}

/**
 * Async chunked variant of runStage1. Same return shape; yields every
 * `opts.seed_discovery.chunk_anchors` anchors via
 * discoverSeedsOnChromosomeAsync. Reports fine-grained progress via
 * `onProgress({ chrom_idx, anchors_done, anchors_total, n_seeds })`
 * so the caller can render a per-chromosome progress bar.
 *
 * 2026-05-21 perf (HR8): Stage 1 dominates pipeline cost on dense
 * chroms (~1-2 seconds in the per-chrom anchor loop). Yielding every
 * 50 anchors gives ~20 paint opportunities per chrom instead of 0.
 */
export async function runStage1Async(ctx, opts, onProgress) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const seed_opts = Object.assign({}, o.seed_discovery,
                                  { classification: o.classification });
  const all_seeds = [];
  const per_chrom = [];
  for (let ci = 0; ci < ctx.chromosomes.length; ci++) {
    const chr = ctx.chromosomes[ci];
    const innerProgress = (done, total, nSeeds) => {
      if (typeof onProgress === 'function') {
        try {
          onProgress({
            chrom_idx:     ci,
            anchors_done:  done,
            anchors_total: total,
            n_seeds:       nSeeds,
          });
        } catch (_) {}
      }
    };
    const sweep = await discoverSeedsOnChromosomeAsync({
      getLabels:      ctx.getLabels,
      getK:           ctx.getK,
      getBandQuality: ctx.getBandQuality,
      chr_s_window:   chr.s_window,
      chr_e_window:   chr.e_window,
      tracked_sample_idx: ctx.tracked_sample_idx,
    }, seed_opts, innerProgress);
    let n_kept = 0;
    for (const seed of sweep.seeds) {
      const interior_frac = seedInteriorFrac(seed);
      seed.chromosome_idx = ci;
      seed.interior_frac  = interior_frac;
      if (interior_frac >= o.min_seed_interior_frac) {
        all_seeds.push(seed);
        n_kept++;
      }
    }
    per_chrom.push({
      chrom_idx:     ci,
      n_provisional: sweep.n_provisional,
      n_raw:         sweep.n_raw,
      n_seeded:      sweep.n_seeded,
      n_kept,
    });
  }
  return { seeds: all_seeds, per_chrom_summary: per_chrom };
}

// Compute fraction of seed windows classified as INTERIOR (vs
// CROSSOVER / UNRELIABLE / REGIME_END). High = strong V plateau.
function seedInteriorFrac(seed) {
  let interior = 0, total = 0;
  for (let w = seed.s_window; w <= seed.e_window; w++) {
    const i = w - seed.classifications_s_window;
    if (i < 0 || i >= seed.classifications.length) continue;
    total++;
    if (seed.classifications[i] === WINDOW_CLASS.INTERIOR) interior++;
  }
  return total > 0 ? interior / total : 0;
}

// ---------------------------------------------------------------------
// Stage 3 — per-seed chain walk (classifier mode) + band sample sets
//
// For each seed, run chainWalkOneChromosome restricted to the seed's
// footprint, with getClassification bound to the seed's per-window
// classification array. Because Stage 1 already excised REGIME_END
// boundaries, the chain walker should produce ONE chain per seed
// covering the full footprint (modulo UNRELIABLE skips). Compute
// per-band sample sets via locusBandSampleSets.
//
// The output of this stage is what downstream Stage C (breadth voting,
// partition consensus, karyotype calling) consumes, so the per-band
// sample sets must be stable and complete.
// ---------------------------------------------------------------------

/**
 * @param {object[]} seeds                      output of runStage1
 * @param {object} ctx                          same ctx as runStage1
 * @param {object} stage2                       output of runStage2 (optional)
 * @param {object} [opts]
 * @returns {{
 *   loci: object[]                             // length = #seeds (or fewer if dropped)
 * }}
 *
 * Each locus has:
 *   { seed_id, chromosome_idx, s_window, e_window, K,
 *     chain, per_band_samples (Set[]), per_band_sizes,
 *     n_unreliable_skipped, min_internal_jaccard }
 */
export function runStage3(seeds, ctx, stage2, opts) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const loci = [];
  for (let sid = 0; sid < seeds.length; sid++) {
    if (o.drop_noise_seeds && stage2 &&
        stage2.reliability && stage2.reliability.verdict[sid] === 'NOISE') {
      continue;
    }
    const seed = seeds[sid];
    // getClassification callback bound to this seed's classifications
    const cls_arr = seed.classifications;
    const cls_s = seed.classifications_s_window;
    const getCls = (w) => {
      const i = w - cls_s;
      if (i < 0 || i >= cls_arr.length) return WINDOW_CLASS.UNRELIABLE;
      return cls_arr[i];
    };
    const walk = chainWalkOneChromosome({
      getLabels:      ctx.getLabels,
      getK:           ctx.getK,
      getBandQuality: ctx.getBandQuality,
      getL2Idx:       ctx.getL2Idx ? ctx.getL2Idx : (() => 0),
      getClassification: getCls,
      s_window:       seed.s_window,
      e_window:       seed.e_window,
    }, o.locus_construction);
    if (walk.chains.length === 0) continue;
    // Pick the longest chain (typically there's one; if Stage 1 was
    // imperfect there may be 2 fragments — take the dominant one).
    let primary = walk.chains[0];
    for (const c of walk.chains) if (c.n_windows > primary.n_windows) primary = c;
    let sets;
    if (o.band_set_aggregation === 'intersection') {
      sets = locusBandSampleSets(primary, ctx.getLabels, ctx.n_samples);
    } else {
      sets = locusBandSampleSetsMajority(primary, ctx.getLabels, ctx.n_samples,
        { min_majority_frac: o.band_set_min_majority_frac });
    }
    // Normalize size field: both functions report per_band_*_size with
    // a method-specific suffix; expose a unified per_band_size below.
    const per_band_size = sets.per_band_majority_size || sets.per_band_intersection_size;
    loci.push({
      seed_id:                 sid,
      chromosome_idx:          seed.chromosome_idx,
      s_window:                primary.s,
      e_window:                primary.e,
      K:                       primary.K,
      chain:                   primary,
      per_band_samples:        sets.per_band_samples,
      per_band_size,
      per_band_first_size:     sets.per_band_first_size,
      n_samples_dropped:       sets.n_samples_dropped || 0,
      band_set_aggregation:    o.band_set_aggregation,
      n_unreliable_skipped:    primary.n_unreliable_skipped || 0,
      min_internal_jaccard:    primary.min_internal_jaccard,
      // Forward Stage 2 metadata for downstream consumers
      stage2_verdict:          stage2 ? stage2.reliability.verdict[sid] : null,
      stage2_linkage_group:    stage2 ? stage2.linkage.group_id[sid] : null,
    });
  }
  return { loci };
}

// ---------------------------------------------------------------------
// Stage 4 — BREADTH VOTING (the bruteforce: seeds → all targets)
//
// Each seed contributes K_seed voters (one per band) carrying that
// band's stable sample-set. Voters project onto every target locus or
// every target window, producing voteRecords. Per target, the
// bruteforce consensus_partition runs over all set-partitions of the
// target's K bands — finding the partition best supported by all
// genome-wide voters.
//
// Returns the per-target consensus + classification, plus the raw
// vote tensor.
// ---------------------------------------------------------------------

/**
 * @param {Array} stage1_seeds
 * @param {Array} stage3_loci
 * @param {object} ctx
 * @param {object} [opts]
 * @returns {{
 *   per_target: Array,
 *   summary: object,
 *   voters: Array,
 *   targets: Array,
 * }}
 */
export function runStage4(stage1_seeds, stage3_loci, ctx, opts) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const voters = buildVotersFromSeedLoci(stage1_seeds, stage3_loci);
  let targets;
  if (o.stage4_scope === 'every_window') {
    const target_windows = [];
    for (const chr of ctx.chromosomes) {
      for (let w = chr.s_window; w <= chr.e_window; w += o.stage4_target_stride) {
        target_windows.push(w);
      }
    }
    targets = buildTargetsFromWindows({
      target_windows,
      getLabels:     ctx.getLabels,
      getK:          ctx.getK,
      isWindowValid: ctx.isWindowValid,
    });
  } else if (o.stage4_scope === 'custom' && opts && opts.target_windows) {
    targets = buildTargetsFromWindows({
      target_windows: opts.target_windows,
      getLabels:      ctx.getLabels,
      getK:           ctx.getK,
      isWindowValid:  ctx.isWindowValid,
    });
  } else {
    targets = buildTargetsFromStage3Loci(stage3_loci, ctx.getLabels, ctx.getK);
    for (let i = 0; i < targets.length; i++) {
      targets[i].source_seed_id = stage3_loci[i].seed_id;
    }
  }
  const result = runBreadthVoting({ voters, targets }, o.breadth_voting);
  // For seeds-only scope, drop same-seed self-votes from each target's
  // voteRecords, then re-run consensus on the filtered list.
  if (o.stage4_scope === 'seeds_only') {
    for (let i = 0; i < result.per_target.length; i++) {
      const T = result.per_target[i];
      const target_seed_id = targets[i].source_seed_id;
      if (target_seed_id == null) continue;
      const filtered = T.voteRecords.filter(v => {
        const voter = voters.find(vv =>
          vv.source_w === v.source_w && vv.source_k === v.source_k);
        return !voter || voter.source_seed_id !== target_seed_id;
      });
      T.voteRecords = filtered;
      T.n_voters = filtered.length;
      T.consensus = filtered.length > 0 ? _consensus_partition(filtered) : null;
    }
  }
  return { ...result, voters, targets };
}

// ---------------------------------------------------------------------
// runBandingPipeline — top-level driver
//
// Runs Stage 1 → Stage 2 → Stage 3 → Stage 4 and returns one bundle.
// ---------------------------------------------------------------------

/**
 * @param {object} ctx
 *   ctx.chromosomes:        Array<{s_window, e_window}>
 *   ctx.getLabels:          (w) => Int8Array
 *   ctx.getK:               (w) => number
 *   ctx.getBandQuality:     (w) => number
 *   ctx.getL2Idx?:          (w) => number  (default () => 0; only used
 *                                            for legacy diagnostics)
 *   ctx.isWindowValid?:     (w) => boolean (used by Stage 4 for stability
 *                                            classifier when set)
 *   ctx.n_samples:          number
 *   ctx.tracked_sample_idx?: Iterable<number>
 * @param {object} [opts]
 * @returns {{
 *   stage1: object,
 *   stage2: object,
 *   stage3: object,
 *   stage4: object,           // null if skip_stage4 was set
 *   summary: object,
 * }}
 */
export function runBandingPipeline(ctx, opts) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const stage1 = runStage1(ctx, o);
  const stage2 = runStage2(stage1.seeds, o.cross_seed);
  const stage3 = runStage3(stage1.seeds, ctx, stage2, o);

  let stage4 = null;
  if (!o.skip_stage4 && stage3.loci.length > 0) {
    stage4 = runStage4(stage1.seeds, stage3.loci, ctx, o);
  }

  // Rollups
  let n_raw = 0;
  for (const r of stage1.per_chrom_summary) n_raw += r.n_raw;
  const n_valid = stage2.valid_seed_ids.length;
  let n_target_clean = 0, n_target_soft = 0, n_target_other = 0;
  let n_stability_upgraded = 0;
  if (stage4) {
    for (const T of stage4.per_target) {
      if (!T.consensus) continue;
      const c = T.consensus.consensus_class;
      if (c === 'CLEAN_PARTITION') n_target_clean++;
      else if (c === 'SOFT_PARTITION') n_target_soft++;
      else n_target_other++;
    }
    n_stability_upgraded = stage4.summary.n_stability_upgraded;
  }

  return {
    stage1, stage2, stage3, stage4,
    summary: {
      n_seeds_raw:               n_raw,
      n_seeds_after_plateau:     stage1.seeds.length,
      n_seeds_valid:             n_valid,
      n_loci:                    stage3.loci.length,
      n_linkage_groups:          stage2.linkage.n_groups,
      n_targets:                 stage4 ? stage4.summary.n_targets : 0,
      n_target_clean_partitions: n_target_clean,
      n_target_soft_partitions:  n_target_soft,
      n_target_other:            n_target_other,
      n_stability_upgraded:      n_stability_upgraded,
      per_chrom:                 stage1.per_chrom_summary,
    },
  };
}

/**
 * Async variant of runBandingPipeline that yields control to the event
 * loop between stages. Behaviourally identical to the sync version —
 * same inputs, same return shape — but rewrites the four stages as
 * `await`-separated steps so the browser can:
 *   1. paint the "running stage N…" status before the next stage starts
 *   2. process user input (clicks on cancel, tab away, etc.)
 *
 * 2026-05-21 perf (HR2 haplotype audit): the sync version blocks the
 * main thread for 2-5 seconds on dense chromosomes; this version
 * spreads the cost across 4 frames with no per-stage overhead.
 * `onProgress(stageName, partialResult)` is called BEFORE each stage
 * starts so the caller can update its status UI ("running stage 1…",
 * "running stage 2 — 12 seeds…", etc.); `partialResult` is the merged
 * result-so-far for any caller that wants to render an early preview.
 *
 * Each stage is still synchronous internally — chunking inside a stage
 * (e.g. per-chromosome iteration within stage 1) would need a deeper
 * refactor. Today the 4-stage split is enough: stage 1 dominates,
 * stages 2/3/4 finish in <500ms typically. If a real worker is needed
 * later, this async surface can wrap a postMessage call to a worker
 * without changing the caller.
 *
 * @param {object} ctx                           same as runBandingPipeline
 * @param {object} opts                          same as runBandingPipeline
 * @param {(stage:string, partial:object)=>void} [onProgress]
 * @returns {Promise<object>}                   same shape as runBandingPipeline
 */
export async function runBandingPipelineAsync(ctx, opts, onProgress) {
  const o = Object.assign({}, BANDING_PIPELINE_DEFAULTS, opts || {});
  const _yield = () => new Promise(r => setTimeout(r, 0));
  const _progress = (stage, partial) => {
    if (typeof onProgress === 'function') {
      try { onProgress(stage, partial); } catch (_) {}
    }
  };

  _progress('stage1', null);
  await _yield();
  // 2026-05-21 perf (HR8): use the chunked Stage 1 so progress updates
  // fire DURING the per-chromosome anchor sweep (every ~50 anchors,
  // ~20 progress paints per chrom on a typical run). The callback shape
  // for stage1 progress is { chrom_idx, anchors_done, anchors_total,
  // n_seeds } — distinct from the inter-stage `partial` shape so callers
  // can render a progress bar.
  const stage1ProgressForward = (info) => {
    _progress('stage1_progress', info);
  };
  const stage1 = await runStage1Async(ctx, o, stage1ProgressForward);

  _progress('stage2', { stage1 });
  await _yield();
  const stage2 = runStage2(stage1.seeds, o.cross_seed);

  _progress('stage3', { stage1, stage2 });
  await _yield();
  const stage3 = runStage3(stage1.seeds, ctx, stage2, o);

  let stage4 = null;
  if (!o.skip_stage4 && stage3.loci.length > 0) {
    _progress('stage4', { stage1, stage2, stage3 });
    await _yield();
    stage4 = runStage4(stage1.seeds, stage3.loci, ctx, o);
  }

  // Rollups (same as sync version)
  let n_raw = 0;
  for (const r of stage1.per_chrom_summary) n_raw += r.n_raw;
  const n_valid = stage2.valid_seed_ids.length;
  let n_target_clean = 0, n_target_soft = 0, n_target_other = 0;
  let n_stability_upgraded = 0;
  if (stage4) {
    for (const T of stage4.per_target) {
      if (!T.consensus) continue;
      const c = T.consensus.consensus_class;
      if (c === 'CLEAN_PARTITION') n_target_clean++;
      else if (c === 'SOFT_PARTITION') n_target_soft++;
      else n_target_other++;
    }
    n_stability_upgraded = stage4.summary.n_stability_upgraded;
  }

  return {
    stage1, stage2, stage3, stage4,
    summary: {
      n_seeds_raw:               n_raw,
      n_seeds_after_plateau:     stage1.seeds.length,
      n_seeds_valid:             n_valid,
      n_loci:                    stage3.loci.length,
      n_linkage_groups:          stage2.linkage.n_groups,
      n_targets:                 stage4 ? stage4.summary.n_targets : 0,
      n_target_clean_partitions: n_target_clean,
      n_target_soft_partitions:  n_target_soft,
      n_target_other:            n_target_other,
      n_stability_upgraded:      n_stability_upgraded,
      per_chrom:                 stage1.per_chrom_summary,
    },
  };
}

// Console-debug
if (typeof window !== 'undefined') {
  window._runStage1                = runStage1;
  window._runStage1Async           = runStage1Async;
  window._runStage3                = runStage3;
  window._runStage4                = runStage4;
  window._runBandingPipeline       = runBandingPipeline;
  window._runBandingPipelineAsync  = runBandingPipelineAsync;
  window._BANDING_PIPELINE_DEFAULTS = BANDING_PIPELINE_DEFAULTS;
}
