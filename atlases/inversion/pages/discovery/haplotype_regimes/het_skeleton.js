// pages/discovery/haplotype_regimes/het_skeleton.js
//
// Mode 3 — het-skeleton seed builder (Cluster 1 Path B).
// Extracted from haplotype_regimes.js as part of the file split
// (2026-05-27). The user flagged this mode as "has much potential"
// during the audit — kept as a first-class discovery mode parallel
// to the V-walker (Mode 1) and the user-curated short-range mode
// (Mode 2, now extracted to candidate_regimes).
//
// Per-window K-means (already cached on state) → het_detect_candidate_band
// → het_track_skeleton (forward+backward via Jaccard) → het_define_interval
// → hom_anchor_to_het per skeleton → computeAdjacentSeedMerges to fuse
// adjacent intervals into multi-skeleton seeds. Produces the same
// {stage1, stage3, summary} shape that buildShortRangeResult emits so
// the downstream Cluster 2 + Cluster 3 tail is identical across modes.
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

import {
  het_detect_candidate_band,
  het_track_skeleton,
  het_define_interval,
  HET_DEFAULTS,
} from '../../../shared/band_tracking/het.js';
import { hom_anchor_to_het } from '../../../shared/band_tracking/hom.js';
import { runCramersVMergeLocal } from '../../../shared/cramers_v_merge.js';

/**
 * Build the het-skeleton pipeline result from page state.
 *
 * @param {Object} state    haplotype_regimes legacy state. Reads
 *                          state.data, state._regimesCtx,
 *                          state._regimesGetPC1, state.hetMaxSeeds.
 * @returns {Object|null}   pipeline-result-shaped envelope, or null
 *                          when state isn't wired or ctx is missing.
 */
export function buildHetSkeletonResult(state) {
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
