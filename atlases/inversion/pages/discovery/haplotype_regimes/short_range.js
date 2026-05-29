// pages/discovery/haplotype_regimes/short_range.js
//
// Short-range pipeline result builder (2026-05-20).
// Extracted from haplotype_regimes.js as part of the file split
// (2026-05-27). The function synthesises a runBandingPipeline-shaped
// result from the user-curated local_pca_dosage candidate list — no
// V-walker, no auto-discovery — so the same downstream Cluster 2/3
// tail + 4-panel render + catalogue exporter can serialise the
// user's hand-flagged regions.
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

/**
 * @param {Object} state   haplotype_regimes legacy state — reads
 *                         state.data, state.activeChrom, state.candidateList,
 *                         and window.atlasState.inversion._local_pca_dosage_state
 * @returns {Object|null}  pipeline-result-shaped object, or null
 *                         when no chrom data is loaded
 */
export function buildShortRangeResult(state) {
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
