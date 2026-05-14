// analysis/window_chain_to_candidates/compute.js
// =====================================================================
// Pure JSON-in / JSON-out compute. Promotes per-window K-means
// partitions into candidate intervals via two parallel branches:
//
//   1. HET-CHAIN BRANCH    (K=3-ish windows)
//      Detects a HET band per window (PC1 midpoint between the two
//      HOMO bands, or biological dosage≈1 when dosage is supplied),
//      then walks the HET identity left + right from each seed using
//      single-band tracking semantics.
//
//   2. HOM-SEPARATION-CHAIN BRANCH    (K=2 — or K=3 with no HET band)
//      For fixed-different inversions where the cohort splits cleanly
//      into HOMO_1 ↔ HOMO_2 with no heterozygotes. For each candidate
//      window, builds the L3 contingency table against the anchor
//      and chains windows where Cramér's V stays above threshold.
//
// Both branches emit `{anchor_w, start_w, end_w, chain_type, ...}`.
// Overlapping chains are deduplicated per `params.dedupe_prefer`.
//
// Reuses shipped primitives (no new algorithms here):
//   shared/band_tracking/het.js     het_detect_candidate_band,
//                                   het_track_skeleton,
//                                   het_define_interval,
//                                   iv_merge_het_tracks
//   shared/band_tracking/anchor_track_cache.js
//                                   createAnchorTrackCache  — the
//                                   memoised band-tracking V(anchor,w)
//                                   shared with discoverSeedFromAnchor.
//                                   Replaces the chi²-based Cramér's V
//                                   we used to build inline (so both
//                                   modules consult one signal scale).
//
// No DOM, no fetch, no registry, no state. Same JSON runs in browser,
// Node, or batch CLI.
// =====================================================================

import {
  het_detect_candidate_band,
  het_track_skeleton,
  het_define_interval,
  iv_merge_het_tracks,
} from '../../shared/band_tracking/het.js';
import { createAnchorTrackCache }
  from '../../shared/band_tracking/anchor_track_cache.js';

const DEFAULT_PARAMS = Object.freeze({
  branches:            ['het', 'hom_separation'],
  cramers_v_threshold: 0.70,
  min_chain_length:    3,
  max_chain_skip:      1,
  het_signal:          'pc1_midpoint',
  het_span_min:        0.20,
  merge_overlap_bp:    0,
  dedupe_prefer:       'het',
});

// =====================================================================
// 1. Public entry
// =====================================================================

/**
 * @param {Object} input     conforms to ./schema_in.json
 * @returns {Object}         conforms to ./schema_out.json
 */
export function compute(input) {
  const out = _emptyResult();
  if (!input || !Array.isArray(input.windows) || input.windows.length === 0
      || !(input.n_samples > 0)) return out;
  const params = _resolveParams(input.params);
  const branches_run = params.branches.slice();
  out.chrom        = input.chrom || null;
  out.params_used  = params;
  out.branches_run = branches_run;
  out.input_layer_ids = Array.isArray(input.input_layer_ids)
    ? input.input_layer_ids.slice() : [];

  // Build a window index ⇄ position lookup so chain seeds can use idx
  // directly. We keep the original windows array immutable.
  const winByIdx = new Map();
  for (const w of input.windows) winByIdx.set(w.idx | 0, w);
  const orderedIdx = input.windows.map(w => w.idx | 0).sort((a, b) => a - b);

  // Seed windows: caller-supplied, or every window when omitted.
  const seedSet = Array.isArray(input.seed_windows) && input.seed_windows.length > 0
    ? new Set(input.seed_windows.map(i => i | 0))
    : new Set(orderedIdx);

  // -------------------------------------------------------- het branch
  const hetChains = (branches_run.indexOf('het') >= 0)
    ? _runHetBranch(input, winByIdx, orderedIdx, seedSet, params)
    : [];

  // ----------------------------------------------- hom_separation branch
  const homChains = (branches_run.indexOf('hom_separation') >= 0)
    ? _runHomSeparationBranch(input, winByIdx, orderedIdx, seedSet, params)
    : [];

  // ----------------------------------------------------- merge + dedupe
  const merged = _mergeAndDedupe(hetChains.concat(homChains), params);

  // Filter out chains shorter than min_chain_length.
  out.chains = merged.filter(c => c.n_windows >= params.min_chain_length);
  out.n_chains = out.chains.length;
  out.source = out.n_chains > 0 ? 'compute' : 'insufficient';
  return out;
}

// =====================================================================
// 2. Het-chain branch
// =====================================================================

function _runHetBranch(input, winByIdx, orderedIdx, seedSet, params) {
  const out = [];

  // Build the {getLabels, getPc1, getK, getBpFor} accessors expected by
  // shared/band_tracking/het.js. We honour the window-idx order, not
  // dense array indices.
  const idxToOrder = new Map();
  for (let i = 0; i < orderedIdx.length; i++) idxToOrder.set(orderedIdx[i], i);

  const accessors = {
    getLabels(w_idx) {
      const w = winByIdx.get(w_idx);
      if (!w || !Array.isArray(w.labels)) return null;
      return Int8Array.from(w.labels);
    },
    getPc1(w_idx) {
      const w = winByIdx.get(w_idx);
      if (!w || !Array.isArray(w.pc1)) return null;
      return Float32Array.from(w.pc1);
    },
    getDosage(w_idx) {
      const w = winByIdx.get(w_idx);
      if (!w || !Array.isArray(w.dosage)) return null;
      return Float32Array.from(w.dosage);
    },
    getK(w_idx) {
      const w = winByIdx.get(w_idx);
      return (w && w.K > 0) ? (w.K | 0) : 0;
    },
    getBpFor(w_idx) {
      const w = winByIdx.get(w_idx);
      if (!w) return null;
      return { start_bp: w.start_bp != null ? w.start_bp : null,
               end_bp:   w.end_bp   != null ? w.end_bp   : null };
    },
  };

  // For each seed window: detect a candidate het band and (if present)
  // walk the skeleton.
  for (const seed_w of seedSet) {
    const w = winByIdx.get(seed_w);
    if (!w) continue;
    const labels = accessors.getLabels(seed_w);
    const pc1    = accessors.getPc1(seed_w);
    const K      = accessors.getK(seed_w);
    if (!labels || !pc1 || K < 2) continue;

    const hetCand = het_detect_candidate_band(labels, pc1, K, {
      het_span_min: params.het_span_min,
    });
    if (!hetCand || hetCand.k_het == null) continue;
    if (Number.isFinite(hetCand.het_span_frac)
        && hetCand.het_span_frac < params.het_span_min) continue;

    let skeleton;
    try {
      const chr_s_window = orderedIdx[0];
      const chr_e_window = orderedIdx[orderedIdx.length - 1];
      const args = Object.assign({}, accessors, {
        seed_w, chr_s_window, chr_e_window,
      });
      skeleton = het_track_skeleton(args, {
        max_skip: params.max_chain_skip,
      });
    } catch (_) { skeleton = null; }
    if (!skeleton || !skeleton.ok) continue;
    const span = (Number.isFinite(skeleton.e_window) && Number.isFinite(skeleton.s_window))
      ? skeleton.e_window - skeleton.s_window + 1
      : 1;
    if (span < params.min_chain_length) continue;

    const iv = het_define_interval(skeleton, accessors.getBpFor) || {};
    const homKeys = _identifyHomBandsByPc1(labels, pc1, K);
    out.push({
      chain_type: 'het',
      anchor_w:   seed_w,
      start_w:    skeleton.s_window,
      end_w:      skeleton.e_window,
      start_bp:   iv.start_bp != null ? iv.start_bp : null,
      end_bp:     iv.end_bp   != null ? iv.end_bp   : null,
      n_windows:  span,
      cramers_v_mean: null,
      cramers_v_min:  null,
      het_span_mean:  Number.isFinite(skeleton.mean_continuity) ? skeleton.mean_continuity : null,
      samples_per_arrangement: _samplesPerArrangementHet(labels, hetCand, homKeys),
      evidence: {
        het_band_present: true,
        n_het_windows:    span,
        n_homo_only_windows: 0,
        min_window_K:     K,
        max_window_K:     K,
        anchor_K:         K,
        reason:           'het_chain ok; het band span ' + (Number.isFinite(hetCand.het_span_frac) ? hetCand.het_span_frac.toFixed(2) : '?'),
      },
    });
  }
  return out;
}

function _identifyHomBandsByPc1(labels, pc1, K) {
  // Mean PC1 per band; the band with smallest mean PC1 → H1,
  // the band with largest mean PC1 → H2. Returns {H1: band_id, H2: band_id, HET: band_id|null}.
  const sums = new Float64Array(K), counts = new Int32Array(K);
  for (let i = 0; i < labels.length; i++) {
    const b = labels[i];
    if (b < 0 || b >= K) continue;
    sums[b] += pc1[i]; counts[b]++;
  }
  const means = new Array(K);
  for (let k = 0; k < K; k++) means[k] = counts[k] > 0 ? sums[k] / counts[k] : NaN;
  let h1 = -1, h2 = -1, minM = Infinity, maxM = -Infinity;
  for (let k = 0; k < K; k++) {
    if (!Number.isFinite(means[k])) continue;
    if (means[k] < minM) { minM = means[k]; h1 = k; }
    if (means[k] > maxM) { maxM = means[k]; h2 = k; }
  }
  let het = null;
  if (K >= 3) {
    for (let k = 0; k < K; k++) if (k !== h1 && k !== h2) { het = k; break; }
  }
  return { H1: h1, H2: h2, HET: het };
}

function _samplesPerArrangementHet(labels, hetCand, homKeys) {
  const out = { H1: [], H2: [], HET: [] };
  for (let i = 0; i < labels.length; i++) {
    const b = labels[i];
    if (b === homKeys.H1)        out.H1.push(i);
    else if (b === homKeys.H2)   out.H2.push(i);
    else if (b === homKeys.HET || (hetCand && b === hetCand.k_het)) out.HET.push(i);
  }
  return out;
}

// =====================================================================
// 3. Hom-separation-chain branch
// =====================================================================

function _runHomSeparationBranch(input, winByIdx, orderedIdx, seedSet, params) {
  const out = [];
  const n_samples = input.n_samples | 0;
  const thrV = params.cramers_v_threshold;
  const maxSkip = params.max_chain_skip | 0;

  // Index → position in ordered list for left/right walks.
  const orderPos = new Map();
  for (let i = 0; i < orderedIdx.length; i++) orderPos.set(orderedIdx[i], i);

  // Build a memoised V(anchor_w, w) cache. Same band-tracking V
  // definition that discoverSeedFromAnchor uses — replaces the
  // separate chi²-based Cramérs V we used to build inline so the two
  // modules consult ONE signal scale.
  const vCache = createAnchorTrackCache({
    getLabels(w_idx) {
      const w = winByIdx.get(w_idx);
      if (!w || !Array.isArray(w.labels)) return null;
      return Int8Array.from(w.labels);
    },
    getK(w_idx) {
      const w = winByIdx.get(w_idx);
      return (w && w.K > 0) ? (w.K | 0) : 0;
    },
    chr_s_window: orderedIdx[0],
    chr_e_window: orderedIdx[orderedIdx.length - 1],
  });

  for (const seed_w of seedSet) {
    const anchor = winByIdx.get(seed_w);
    if (!anchor) continue;
    const anchorLabels = anchor.labels;
    const anchorK = anchor.K | 0;
    if (!Array.isArray(anchorLabels) || anchorK < 2) continue;
    // Only chain when the seed is a clean 2-band split (or a K=3 with
    // an absent HET band — caller can detect that and pass the seed
    // anyway; we infer band sizes here).
    const anchorBandSizes = _bandSizes(anchorLabels, anchorK);
    const populatedBands = anchorBandSizes.filter(s => s > 0).length;
    // Require at least two populated bands at the anchor.
    if (populatedBands < 2) continue;
    // If anchor K === 3 AND the middle band is well populated, the het
    // branch is the right consumer for this seed — skip.
    if (anchorK === 3) {
      const pc1 = anchor.pc1;
      if (Array.isArray(pc1)) {
        const hetCand = het_detect_candidate_band(
          Int8Array.from(anchorLabels),
          Float32Array.from(pc1),
          anchorK,
          { het_span_min: params.het_span_min });
        if (hetCand && hetCand.k_het != null) continue;   // het branch handles it
      }
    }

    // Walk left + right with hysteresis.
    const anchorPos = orderPos.get(seed_w);
    if (anchorPos == null) continue;
    const vSeries = []; // accumulated V values per accepted window
    let lo = anchorPos, hi = anchorPos;

    // Right walk. K-match guard + shared band-tracking V.
    let skips = 0;
    for (let p = anchorPos + 1; p < orderedIdx.length; p++) {
      const wIdx = orderedIdx[p];
      const w = winByIdx.get(wIdx);
      // K-match guard: hom-separation requires same partition
      // cardinality across windows. K mismatch terminates the walk.
      if (!w || !Array.isArray(w.labels) || w.K !== anchorK) { if (++skips > maxSkip) break; continue; }
      const v = vCache.getV(seed_w, wIdx);
      if (!Number.isFinite(v) || v < thrV) { if (++skips > maxSkip) break; continue; }
      hi = p; vSeries.push(v); skips = 0;
    }
    // Left walk.
    skips = 0;
    for (let p = anchorPos - 1; p >= 0; p--) {
      const wIdx = orderedIdx[p];
      const w = winByIdx.get(wIdx);
      if (!w || !Array.isArray(w.labels) || w.K !== anchorK) { if (++skips > maxSkip) break; continue; }
      const v = vCache.getV(seed_w, wIdx);
      if (!Number.isFinite(v) || v < thrV) { if (++skips > maxSkip) break; continue; }
      lo = p; vSeries.push(v); skips = 0;
    }

    const start_w = orderedIdx[lo];
    const end_w   = orderedIdx[hi];
    const n_windows = hi - lo + 1;
    if (n_windows < params.min_chain_length) continue;

    // Pull bp span from start / end windows.
    const startW = winByIdx.get(start_w);
    const endW   = winByIdx.get(end_w);
    const start_bp = (startW && startW.start_bp != null) ? startW.start_bp : null;
    const end_bp   = (endW   && endW.end_bp     != null) ? endW.end_bp     : null;

    // Identify H1 / H2 by PC1 at the anchor (mean PC1 per anchor band).
    const homKeys = anchor.pc1 && Array.isArray(anchor.pc1)
      ? _identifyHomBandsByPc1(Int8Array.from(anchorLabels), Float32Array.from(anchor.pc1), anchorK)
      : { H1: 0, H2: anchorK - 1, HET: null };
    const samples_per_arrangement = { H1: [], H2: [] };
    for (let i = 0; i < anchorLabels.length; i++) {
      const b = anchorLabels[i];
      if (b === homKeys.H1)      samples_per_arrangement.H1.push(i);
      else if (b === homKeys.H2) samples_per_arrangement.H2.push(i);
    }

    let vMean = null, vMin = null;
    if (vSeries.length > 0) {
      vMean = vSeries.reduce((s, x) => s + x, 0) / vSeries.length;
      vMin  = vSeries.reduce((m, x) => x < m ? x : m, Infinity);
    }

    out.push({
      chain_type: 'hom_separation',
      anchor_w:   seed_w,
      start_w, end_w,
      start_bp, end_bp,
      n_windows,
      cramers_v_mean: vMean,
      cramers_v_min:  vMin,
      het_span_mean:  null,
      samples_per_arrangement,
      evidence: {
        het_band_present: false,
        n_het_windows:    0,
        n_homo_only_windows: n_windows,
        min_window_K:     2,
        max_window_K:     anchorK,
        anchor_K:         anchorK,
        reason:           'hom_separation chained on Cramérs V; mean V ' + (vMean != null ? vMean.toFixed(2) : '?'),
      },
    });
  }
  return out;
}

function _bandSizes(labels, K) {
  const sizes = new Array(K).fill(0);
  for (let i = 0; i < labels.length; i++) {
    const b = labels[i];
    if (b >= 0 && b < K) sizes[b]++;
  }
  return sizes;
}

// =====================================================================
// 4. Merge + dedupe
// =====================================================================

function _mergeAndDedupe(chains, params) {
  if (!chains || chains.length === 0) return [];
  // Sort by start_w to make overlap checks O(n).
  const sorted = chains.slice().sort((a, b) => a.start_w - b.start_w);
  const kept = [];
  for (const c of sorted) {
    // Find an existing kept chain that overlaps c.
    let overlapIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (_chainsOverlap(k, c, params.merge_overlap_bp)) { overlapIdx = i; break; }
    }
    if (overlapIdx < 0) { kept.push(c); continue; }
    // Resolve conflict per dedupe_prefer.
    const incumbent = kept[overlapIdx];
    const winner = _preferChain(incumbent, c, params.dedupe_prefer);
    if (winner === c) kept[overlapIdx] = c;
    // If neither is strictly preferred and they overlap, mark the kept
    // chain as 'mixed' so the user sees both branches agreed.
    else if (incumbent.chain_type !== c.chain_type) {
      kept[overlapIdx] = Object.assign({}, incumbent, {
        chain_type: 'mixed',
        evidence: Object.assign({}, incumbent.evidence,
                                { reason: incumbent.evidence.reason + ' + ' + c.evidence.reason }),
      });
    }
  }
  return kept;
}

function _chainsOverlap(a, b, slack_bp) {
  if (a.start_w <= b.end_w && b.start_w <= a.end_w) return true;
  if (slack_bp > 0
      && Number.isFinite(a.end_bp) && Number.isFinite(b.start_bp)
      && (b.start_bp - a.end_bp) <= slack_bp) return true;
  if (slack_bp > 0
      && Number.isFinite(b.end_bp) && Number.isFinite(a.start_bp)
      && (a.start_bp - b.end_bp) <= slack_bp) return true;
  return false;
}

function _preferChain(a, b, mode) {
  if (mode === 'het') {
    if (a.chain_type === 'het' && b.chain_type !== 'het') return a;
    if (b.chain_type === 'het' && a.chain_type !== 'het') return b;
  } else if (mode === 'hom_separation') {
    if (a.chain_type === 'hom_separation' && b.chain_type !== 'hom_separation') return a;
    if (b.chain_type === 'hom_separation' && a.chain_type !== 'hom_separation') return b;
  }
  return (a.n_windows >= b.n_windows) ? a : b;
}

// =====================================================================
// 5. Helpers
// =====================================================================

function _emptyResult() {
  return {
    chrom: null, chains: [], n_chains: 0, source: 'insufficient',
    branches_run: [], input_layer_ids: [], params_used: null,
  };
}

function _resolveParams(p) {
  const q = (p && typeof p === 'object') ? p : {};
  return Object.assign({}, DEFAULT_PARAMS, {
    branches:            Array.isArray(q.branches) && q.branches.length > 0
                            ? q.branches.slice() : DEFAULT_PARAMS.branches.slice(),
    cramers_v_threshold: Number.isFinite(q.cramers_v_threshold)
                            ? q.cramers_v_threshold : DEFAULT_PARAMS.cramers_v_threshold,
    min_chain_length:    Number.isFinite(q.min_chain_length)
                            ? (q.min_chain_length | 0) : DEFAULT_PARAMS.min_chain_length,
    max_chain_skip:      Number.isFinite(q.max_chain_skip)
                            ? (q.max_chain_skip | 0) : DEFAULT_PARAMS.max_chain_skip,
    het_signal:          (q.het_signal === 'dosage_one' || q.het_signal === 'pc1_midpoint')
                            ? q.het_signal : DEFAULT_PARAMS.het_signal,
    het_span_min:        Number.isFinite(q.het_span_min)
                            ? q.het_span_min : DEFAULT_PARAMS.het_span_min,
    merge_overlap_bp:    Number.isFinite(q.merge_overlap_bp)
                            ? q.merge_overlap_bp : DEFAULT_PARAMS.merge_overlap_bp,
    dedupe_prefer:       (q.dedupe_prefer === 'hom_separation' || q.dedupe_prefer === 'longer'
                          || q.dedupe_prefer === 'het')
                            ? q.dedupe_prefer : DEFAULT_PARAMS.dedupe_prefer,
  });
}
