// shared/band_tracking/locus_construction.js
// =====================================================================
// Stage B — Locus construction (v2 — three-way classification break rule).
//
// Walks per-window K-means bands in chromosomal order. Chain extension
// is gated by an OPTIONAL classifier callback that returns one of the
// WINDOW_CLASS values (INTERIOR / CROSSOVER / REGIME_END / UNRELIABLE)
// per window. When the callback is supplied:
//   - INTERIOR / CROSSOVER → chain extends (CROSSOVER absorbed silently;
//                            this is the "real recombination but same
//                            arrangement" case the legacy min_jaccard
//                            rule would have broken on).
//   - REGIME_END           → chain breaks here.
//   - UNRELIABLE           → window is SKIPPED but the chain HOLDS state
//                            (this is the change relative to the legacy
//                            band_quality close-on-fail behaviour).
// When no classifier is supplied, the LEGACY rule applies (band_quality
// gate + min_jaccard < chainJaccard breaks the chain). Existing callers
// keep working.
//
// Output: list of LOCI, each a maximal continuous chain. A locus is the
// operable unit of breadth voting (Stage C). The mergeChainsAcrossGaps
// step is preserved for legacy callers but is a no-op (or near no-op)
// when the classifier is supplied — UNRELIABLE windows are absorbed
// in-walk, so there are no gaps to merge.
//
// Key inputs:
//   - per-window K-means labels (from per_l2_cluster.js)
//   - per-window band_quality (from band_quality.js)
//   - L2 envelope assignment per window
//
// Key constants:
//   - chainJaccard       0.7   (min Jaccard for chain extension)
//   - bandQualityThr     0.4   (windows below = chain breaks)
//   - mergeThr           0.85  (existing — controls L2-join merging)
//   - nearMergeBand      0.05  (mergeThr-0.05 .. mergeThr → NEAR_MERGE/warn)
//   - minNWin            5     (drop chains shorter than this)
//
// L2 boundaries are NOT hard stops in the chain walk. The chain walk
// runs over all windows regardless of L2 membership; L2 information
// is used only by the merge step (B3) to decide whether a chain gap
// should be bridged.
//
// Rationale: L2 is sometimes wrong (under-split or over-merged).
// Treating L2 as hard stops would propagate L2 errors into chain
// boundaries. Treating L2 as a hint for merging (via existing mergeThr
// machinery) makes the algorithm robust to local L2 errors while still
// using the L2 segmentation when it agrees with the data.
// =====================================================================

import { alignLabels } from '../hungarian.js';
import { WINDOW_CLASS } from './window_classification.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const LOCUS_CONSTRUCTION_DEFAULTS = Object.freeze({
  chainJaccard:    0.7,
  bandQualityThr:  0.4,
  mergeThr:        0.85,
  nearMergeBand:   0.05,
  minNWin:         5,
  maxL2GapForMerge: 1,   // only bridge across at most this many L2 boundaries
});

// ---------------------------------------------------------------------
// Per-band Jaccard from a Hungarian-aligned contingency table.
//
// alignLabels returns:
//   table[r][c]    = count of samples with g1=r AND aligned-g2=c
// After alignment, the diagonal is the maximum-overlap matching.
//
// For each row r (cluster r in window 1), the Jaccard with its
// matched cluster in window 2 is:
//   jaccard(r) = table[r][r] / (size_g1[r] + size_g2_aligned[r] - table[r][r])
//
// Returns {min_jaccard, per_band: [j0, j1, ..., jK-1]}
// ---------------------------------------------------------------------

/**
 * @param {ReturnType<typeof alignLabels>} hungarian
 * @returns {{ min_jaccard: number, per_band: number[], K_eff: number }}
 */
export function jaccardFromHungarian(hungarian) {
  const T = hungarian.table;
  const K = T.length;
  const sizeR = new Int32Array(K);
  const sizeC = new Int32Array(K);
  for (let r = 0; r < K; r++) {
    for (let c = 0; c < K; c++) {
      sizeR[r] += T[r][c];
      sizeC[c] += T[r][c];
    }
  }
  const per_band = [];
  let min_j = 1, K_eff = 0;
  for (let r = 0; r < K; r++) {
    const inter = T[r][r];
    const union = sizeR[r] + sizeC[r] - inter;
    if (sizeR[r] === 0 && sizeC[r] === 0) {
      per_band.push(NaN);
      continue;
    }
    K_eff++;
    const j = union > 0 ? inter / union : 0;
    per_band.push(j);
    if (j < min_j) min_j = j;
  }
  return { min_jaccard: K_eff > 0 ? min_j : 0, per_band, K_eff };
}

// ---------------------------------------------------------------------
// chainWalkOneChromosome
//
// Walks windows in order, emits raw chain fragments. Fragments are
// disjoint, non-overlapping, sorted by start window index.
//
// A chain extends from window w to window w+1 IFF:
//   - bandQuality[w]   >= bandQualityThr
//   - bandQuality[w+1] >= bandQualityThr
//   - alignLabels(labels[w], labels[w+1], K_common) gives min-Jaccard ≥ chainJaccard
//
// Otherwise the chain breaks at w (current chain ends at w; next chain
// candidate starts at w+1 if it passes band_quality).
//
// "K_common" is the K used for both windows. If they differ, the
// smaller is used (drops to the lower-resolution view). In practice
// the K is fixed across the chromosome (state.k).
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {(w:number) => Int8Array} args.getLabels    per-window K-means labels
 * @param {(w:number) => number}    args.getK        per-window K
 * @param {(w:number) => number}    args.getBandQuality
 * @param {(w:number) => number}    args.getL2Idx    L2 envelope index for window w
 * @param {(w:number) => string}    [args.getClassification]
 *   OPTIONAL three-way classification per window — one of WINDOW_CLASS
 *   values. When supplied, the walker uses the new break rule:
 *     INTERIOR / CROSSOVER  → extend
 *     REGIME_END            → break
 *     UNRELIABLE            → skip but hold state (chain does NOT close)
 *   When absent, the LEGACY rule applies (band_quality + min_jaccard).
 * @param {number}                  args.s_window    first window (inclusive)
 * @param {number}                  args.e_window    last window (inclusive)
 * @param {object} [opts]
 * @returns {{
 *   chains: Array<{
 *     s: number, e: number,
 *     n_windows: number,
 *     K: number,
 *     l2_indices: number[],
 *     min_internal_jaccard: number,
 *     per_join_jaccard: number[],
 *     classifications: string[],     // when getClassification supplied
 *     n_unreliable_skipped: number,  // when getClassification supplied
 *   }>,
 *   skipped_windows: number[],
 *   broken_at: Array<{w:number, reason:string, jaccard?:number, classification?:string}>,
 * }}
 */
export function chainWalkOneChromosome(args, opts) {
  opts = Object.assign({}, LOCUS_CONSTRUCTION_DEFAULTS, opts || {});
  const { getLabels, getK, getBandQuality, getL2Idx,
          getClassification, s_window, e_window } = args;
  const useClassifier = typeof getClassification === 'function';
  const chains = [];
  const skipped = [];
  const broken = [];
  let cur_s = -1, cur_e = -1, cur_K = -1;
  let cur_min_j = 1;
  let cur_joins = [];
  let cur_classifications = [];
  let cur_n_unreliable = 0;

  const closeChain = () => {
    if (cur_s < 0) return;
    const n = cur_e - cur_s + 1;
    if (n >= opts.minNWin) {
      // Collect L2 indices spanned, in order, deduplicated
      const l2s = [];
      let prev_l2 = -1;
      for (let w = cur_s; w <= cur_e; w++) {
        const l2 = getL2Idx ? getL2Idx(w) : -1;
        if (l2 !== prev_l2) { l2s.push(l2); prev_l2 = l2; }
      }
      const chain = {
        s: cur_s, e: cur_e, n_windows: n,
        K: cur_K,
        l2_indices: l2s,
        min_internal_jaccard: cur_min_j,
        per_join_jaccard: cur_joins.slice(),
      };
      if (useClassifier) {
        chain.classifications = cur_classifications.slice();
        chain.n_unreliable_skipped = cur_n_unreliable;
      }
      chains.push(chain);
    }
    cur_s = -1; cur_e = -1; cur_K = -1; cur_min_j = 1;
    cur_joins = []; cur_classifications = []; cur_n_unreliable = 0;
  };

  for (let w = s_window; w <= e_window; w++) {
    // -----------------------------------------------------------------
    // PATH A — three-way classification mode (preferred when supplied)
    // -----------------------------------------------------------------
    if (useClassifier) {
      const cls = getClassification(w);
      // UNRELIABLE: skip but hold state — chain does NOT close.
      // This is the key behaviour change from the legacy walker:
      // band_quality-fail no longer breaks chains; it just removes the
      // window from chain decisions and lets the next reliable window
      // be evaluated against the previous reliable one.
      if (cls === WINDOW_CLASS.UNRELIABLE) {
        skipped.push(w);
        if (cur_s >= 0) cur_n_unreliable++;
        continue;
      }
      // REGIME_END: break the chain (close current, start nothing).
      if (cls === WINDOW_CLASS.REGIME_END) {
        broken.push({ w, reason: 'regime_end', classification: cls });
        closeChain();
        continue;
      }
      // INTERIOR / CROSSOVER: extend.
      const lab = getLabels(w);
      const K = getK(w);
      if (!lab || lab.length === 0 || K <= 0) {
        skipped.push(w);
        if (cur_s >= 0) cur_n_unreliable++;
        continue;
      }
      if (cur_s < 0) {
        cur_s = w; cur_e = w; cur_K = K;
        cur_min_j = 1; cur_joins = [];
        cur_classifications = [cls]; cur_n_unreliable = 0;
        continue;
      }
      // Compute Jaccard for tracking purposes (not break-deciding).
      // CROSSOVER windows naturally have lower Jaccard; that's expected
      // and acceptable now. Only REGIME_END (which is what classifyWindow
      // uses to detect "low V + high H_off") breaks the chain.
      const prevLab = getLabels(cur_e);
      const K_use = Math.min(cur_K, K);
      const aligned = alignLabels(prevLab, lab, K_use);
      const { min_jaccard } = jaccardFromHungarian(aligned);
      cur_e = w;
      cur_joins.push(min_jaccard);
      cur_classifications.push(cls);
      if (min_jaccard < cur_min_j) cur_min_j = min_jaccard;
      continue;
    }

    // -----------------------------------------------------------------
    // PATH B — legacy mode (band_quality + min_jaccard rule). Preserved
    // verbatim for callers that don't supply getClassification.
    // -----------------------------------------------------------------
    const bq = getBandQuality(w);
    if (bq < opts.bandQualityThr) {
      closeChain();
      skipped.push(w);
      continue;
    }
    const lab = getLabels(w);
    const K = getK(w);
    if (!lab || lab.length === 0 || K <= 0) {
      closeChain();
      skipped.push(w);
      continue;
    }
    if (cur_s < 0) {
      cur_s = w; cur_e = w; cur_K = K;
      cur_min_j = 1; cur_joins = [];
      continue;
    }
    const prevLab = getLabels(cur_e);
    const K_use = Math.min(cur_K, K);
    const aligned = alignLabels(prevLab, lab, K_use);
    const { min_jaccard } = jaccardFromHungarian(aligned);
    if (min_jaccard >= opts.chainJaccard) {
      cur_e = w;
      cur_joins.push(min_jaccard);
      if (min_jaccard < cur_min_j) cur_min_j = min_jaccard;
    } else {
      broken.push({ w, jaccard: min_jaccard, reason: 'low_jaccard' });
      closeChain();
      cur_s = w; cur_e = w; cur_K = K;
      cur_min_j = 1; cur_joins = [];
    }
  }
  closeChain();

  return { chains, skipped_windows: skipped, broken_at: broken };
}

// ---------------------------------------------------------------------
// l2JoinVerdict
//
// For two adjacent chain fragments F_left (ending at window w_e) and
// F_right (starting at window w_s), compute whether their bands match
// across the gap. The gap may include skipped windows but should span
// at most maxL2GapForMerge L2 boundaries.
//
// Verdict returns one of:
//   MERGE       — min Jaccard ≥ mergeThr, bridge with no warning
//   NEAR_MERGE  — min Jaccard ∈ [mergeThr - nearMergeBand, mergeThr),
//                 bridge with warning flag
//   NO_MERGE    — min Jaccard < mergeThr - nearMergeBand, do not bridge
//
// The Jaccard is computed from labels at the LAST window of F_left and
// the FIRST window of F_right (the two windows immediately bounding
// the gap, both of which passed band_quality at chain-walk time).
// ---------------------------------------------------------------------

/**
 * @param {{s:number,e:number,K:number}} F_left
 * @param {{s:number,e:number,K:number}} F_right
 * @param {(w:number) => Int8Array} getLabels
 * @param {object} [opts]
 * @returns {{verdict:'MERGE'|'NEAR_MERGE'|'NO_MERGE',
 *           min_jaccard:number, per_band:number[], K_eff:number}}
 */
export function l2JoinVerdict(F_left, F_right, getLabels, opts) {
  opts = Object.assign({}, LOCUS_CONSTRUCTION_DEFAULTS, opts || {});
  const labL = getLabels(F_left.e);
  const labR = getLabels(F_right.s);
  const K_use = Math.min(F_left.K, F_right.K);
  const aligned = alignLabels(labL, labR, K_use);
  const { min_jaccard, per_band, K_eff } = jaccardFromHungarian(aligned);
  let verdict;
  if (min_jaccard >= opts.mergeThr) verdict = 'MERGE';
  else if (min_jaccard >= opts.mergeThr - opts.nearMergeBand) verdict = 'NEAR_MERGE';
  else verdict = 'NO_MERGE';
  return { verdict, min_jaccard, per_band, K_eff };
}

// ---------------------------------------------------------------------
// mergeChainsAcrossGaps
//
// Given chains in order, walk adjacent pairs and merge across single-
// L2 gaps using l2JoinVerdict. Output: loci (each locus = one or more
// merged chains).
//
// "Single-L2 gap" means: the windows between F_left.e and F_right.s
// span at most opts.maxL2GapForMerge L2 boundaries. Wider gaps are
// not bridged.
// ---------------------------------------------------------------------

/**
 * @param {Array<{s:number,e:number,K:number,l2_indices:number[]}>} chains
 * @param {(w:number) => Int8Array} getLabels
 * @param {(w:number) => number}    getL2Idx
 * @param {object} [opts]
 * @returns {Array<{
 *   chains: object[],            // input chains aggregated into this locus
 *   s: number, e: number,        // window span (first chain.s to last chain.e)
 *   K: number,
 *   l2_indices: number[],
 *   merge_warning: boolean,
 *   gap_verdicts: Array<{between:[number,number], verdict:string, min_jaccard:number}>
 * }>}
 */
export function mergeChainsAcrossGaps(chains, getLabels, getL2Idx, opts) {
  opts = Object.assign({}, LOCUS_CONSTRUCTION_DEFAULTS, opts || {});
  if (chains.length === 0) return [];

  const loci = [];
  let cur = {
    chains: [chains[0]],
    s: chains[0].s, e: chains[0].e,
    K: chains[0].K,
    l2_indices: chains[0].l2_indices.slice(),
    merge_warning: false,
    gap_verdicts: [],
  };

  for (let i = 1; i < chains.length; i++) {
    const prev = chains[i - 1];
    const next = chains[i];
    // Gap L2 span: number of distinct L2s strictly between prev.e and next.s
    const l2_left  = getL2Idx(prev.e);
    const l2_right = getL2Idx(next.s);
    // Walk windows between prev.e+1 .. next.s-1 collecting unique L2s
    const interL2 = new Set();
    for (let w = prev.e + 1; w < next.s; w++) {
      const l2 = getL2Idx(w);
      if (l2 !== l2_left && l2 !== l2_right) interL2.add(l2);
    }
    // L2 boundaries crossed = number of L2 transitions between prev.e and next.s
    // (= 0 if same L2; = 1 if directly adjacent L2; = 1 + |interL2| otherwise)
    const l2_crossings = (l2_left !== l2_right ? 1 : 0) + interL2.size;
    if (l2_crossings > opts.maxL2GapForMerge) {
      // Gap too wide — don't try to bridge
      loci.push(cur);
      cur = {
        chains: [next], s: next.s, e: next.e, K: next.K,
        l2_indices: next.l2_indices.slice(),
        merge_warning: false, gap_verdicts: [],
      };
      continue;
    }
    // Probe the join
    const v = l2JoinVerdict(prev, next, getLabels, opts);
    if (v.verdict === 'MERGE' || v.verdict === 'NEAR_MERGE') {
      cur.chains.push(next);
      cur.e = next.e;
      // Aggregate L2 indices
      for (const l2 of next.l2_indices)
        if (!cur.l2_indices.includes(l2)) cur.l2_indices.push(l2);
      if (v.verdict === 'NEAR_MERGE') cur.merge_warning = true;
      cur.gap_verdicts.push({
        between: [prev.e, next.s],
        verdict: v.verdict,
        min_jaccard: v.min_jaccard,
      });
    } else {
      // NO_MERGE — close current locus, start new
      cur.gap_verdicts.push({
        between: [prev.e, next.s],
        verdict: v.verdict,
        min_jaccard: v.min_jaccard,
      });
      loci.push(cur);
      cur = {
        chains: [next], s: next.s, e: next.e, K: next.K,
        l2_indices: next.l2_indices.slice(),
        merge_warning: false, gap_verdicts: [],
      };
    }
  }
  loci.push(cur);
  return loci;
}

// ---------------------------------------------------------------------
// constructLoci
//
// End-to-end Stage B: chain walk + merge → loci.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 *   getLabels, getK, getBandQuality, getL2Idx, s_window, e_window
 *   plus optional getClassification for classifier-mode walking.
 * @param {object} [opts]
 * @returns {{
 *   loci: object[],
 *   raw_chains: object[],
 *   skipped_windows: number[],
 *   broken_at: object[],
 *   merge_skipped: boolean,    // true when classifier mode skipped the merge step
 * }}
 */
export function constructLoci(args, opts) {
  const walk = chainWalkOneChromosome(args, opts);
  const useClassifier = typeof args.getClassification === 'function';
  // In classifier mode the walker absorbs UNRELIABLE windows in-walk, so
  // there are no "broken-by-noise then mergeable" gaps to bridge — every
  // chain is already a maximal real-arrangement run. Skipping merge
  // avoids the legacy mergeThr=0.85 second-pass and the L2-dependent
  // maxL2GapForMerge cap. Each chain becomes its own locus.
  let loci;
  if (useClassifier) {
    loci = walk.chains.map(c => ({
      chains: [c],
      s: c.s, e: c.e, K: c.K,
      l2_indices: c.l2_indices.slice(),
      merge_warning: false,
      gap_verdicts: [],
      classifier_mode: true,
    }));
  } else {
    loci = mergeChainsAcrossGaps(walk.chains, args.getLabels, args.getL2Idx, opts);
  }
  return {
    loci,
    raw_chains: walk.chains,
    skipped_windows: walk.skipped_windows,
    broken_at: walk.broken_at,
    merge_skipped: useClassifier,
  };
}

// ---------------------------------------------------------------------
// Per-locus sample-set construction
//
// For each locus, compute the per-band sample-set as the INTERSECTION
// of band sample-sets across the locus's windows after Hungarian
// alignment to the FIRST window's bands.
//
// This produces a stable per-band sample set that downstream voting
// (Stage C) consumes.
// ---------------------------------------------------------------------

/**
 * @param {object} locus                    output of constructLoci
 * @param {(w:number) => Int8Array} getLabels
 * @param {number} n_samples
 * @returns {{
 *   K: number,
 *   per_band_samples: Array<Set<number>>,
 *   per_band_intersection_size: number[],   // |∩| per band
 *   per_band_first_size: number[],          // |first window's band|
 * }}
 */
export function locusBandSampleSets(locus, getLabels, n_samples) {
  const K = locus.K;
  const firstLab = getLabels(locus.s);
  // Initialize each band as the set of samples in band b at the first window
  const per_band = Array.from({ length: K }, () => new Set());
  for (let i = 0; i < firstLab.length; i++) {
    if (firstLab[i] >= 0 && firstLab[i] < K) per_band[firstLab[i]].add(i);
  }
  const first_size = per_band.map(s => s.size);

  // For each subsequent window, align labels to first window and intersect
  let prevLab = firstLab;
  for (let w = locus.s + 1; w <= locus.e; w++) {
    const lab = getLabels(w);
    if (!lab) continue;
    const aligned = alignLabels(prevLab, lab, K);
    // Intersect per_band[r] with the set of samples having aligned label = r
    const newSets = Array.from({ length: K }, () => new Set());
    for (let i = 0; i < aligned.aligned.length; i++) {
      const r = aligned.aligned[i];
      if (r >= 0 && r < K && per_band[r].has(i)) newSets[r].add(i);
    }
    for (let r = 0; r < K; r++) per_band[r] = newSets[r];
    prevLab = aligned.aligned;
  }

  return {
    K,
    per_band_samples: per_band,
    per_band_intersection_size: per_band.map(s => s.size),
    per_band_first_size: first_size,
  };
}

// ---------------------------------------------------------------------
// locusBandSampleSetsMajority
//
// Alternative (and usually preferred) per-locus aggregation. Instead of
// strict intersection (which discards a sample the first time it ever
// drops a band — too aggressive when there is per-window label noise or
// a real intra-locus crossover), assign each sample to its MAJORITY
// band across all locus windows. Hungarian-align every window's labels
// to the first window's labels before counting.
//
// Output shape matches locusBandSampleSets so callers can swap the two
// freely.
//
// Per-band sample sets here are DISJOINT (every sample assigned to its
// majority band, ties broken by lowest band id) — this is the right
// shape for Stage C breadth voting, where each sample contributes one
// vote per locus, not one vote per band.
//
// `min_majority_frac` (default 0.5): a sample whose majority band only
// reaches less than this fraction of windows is dropped (it never had
// a stable home in this locus). Setting it to 0 keeps every sample.
// ---------------------------------------------------------------------

/**
 * @param {object} locus
 * @param {(w:number) => Int8Array} getLabels
 * @param {number} n_samples
 * @param {{ min_majority_frac?: number }} [opts]
 * @returns {{
 *   K: number,
 *   per_band_samples:        Array<Set<number>>,
 *   per_band_majority_size:  number[],
 *   per_band_first_size:     number[],
 *   n_samples_dropped:       number,
 * }}
 */
export function locusBandSampleSetsMajority(locus, getLabels, n_samples, opts) {
  const o = Object.assign({ min_majority_frac: 0.5 }, opts || {});
  const K = locus.K;
  const firstLab = getLabels(locus.s);
  // Per-sample × per-band hit counter
  const counts = new Int32Array(n_samples * K);
  const first_size = new Array(K).fill(0);
  for (let i = 0; i < firstLab.length; i++) {
    const b = firstLab[i];
    if (b >= 0 && b < K) {
      counts[i * K + b]++;
      first_size[b]++;
    }
  }
  let prevLab = firstLab;
  let n_windows_used = 1;
  for (let w = locus.s + 1; w <= locus.e; w++) {
    const lab = getLabels(w);
    if (!lab) continue;
    const aligned = alignLabels(prevLab, lab, K);
    for (let i = 0; i < aligned.aligned.length; i++) {
      const r = aligned.aligned[i];
      if (r >= 0 && r < K) counts[i * K + r]++;
    }
    prevLab = aligned.aligned;
    n_windows_used++;
  }
  const min_count = Math.ceil(o.min_majority_frac * n_windows_used);
  const per_band = Array.from({ length: K }, () => new Set());
  let n_dropped = 0;
  for (let i = 0; i < n_samples; i++) {
    let best = -1, best_b = -1;
    for (let b = 0; b < K; b++) {
      const c = counts[i * K + b];
      if (c > best) { best = c; best_b = b; }
    }
    if (best_b < 0 || best < min_count) { n_dropped++; continue; }
    per_band[best_b].add(i);
  }
  return {
    K,
    per_band_samples:       per_band,
    per_band_majority_size: per_band.map(s => s.size),
    per_band_first_size:    first_size,
    n_samples_dropped:      n_dropped,
  };
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._jaccardFromHungarian   = jaccardFromHungarian;
  window._chainWalkOneChromosome = chainWalkOneChromosome;
  window._l2JoinVerdict          = l2JoinVerdict;
  window._mergeChainsAcrossGaps  = mergeChainsAcrossGaps;
  window._constructLoci          = constructLoci;
  window._locusBandSampleSets    = locusBandSampleSets;
  window._locusBandSampleSetsMajority = locusBandSampleSetsMajority;
  window._LOCUS_CONSTRUCTION_DEFAULTS = LOCUS_CONSTRUCTION_DEFAULTS;
}
