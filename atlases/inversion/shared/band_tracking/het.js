// shared/band_tracking/het.js
// =====================================================================
// Het-band detection + skeleton stitching across windows.
//
// All helpers operate on PER-WINDOW K-means labels (the V-driven
// per-window contract from anchor_signals.js, not L2-envelope-broadcast).
//
// A "het band" is the band whose mean PC1 sits between the highest- and
// lowest-PC1 bands at one window — the geometric heterozygote candidate
// before any biological confirmation. Stitching het bands across windows
// gives a het skeleton; per-sample karyotype calls (iv.js) consume that
// skeleton.
//
// Five exports:
//
//   meanPc1PerBand(labels, pc1, K)
//      Float64Array(K) of per-band mean PC1.
//
//   het_detect_candidate_band(labels, pc1, K, opts?)
//      Per-window: pick the band whose mean PC1 is closest to the
//      midpoint of (min, max) band-means. Returns
//      {k_het, k_hom_low, k_hom_high, mean_pc1, het_span_frac} or null.
//
//   het_track_skeleton({getLabels, getPc1, getK, getBpFor, ...}, seed_w, opts?)
//      Detect the het band at the seed window, then walk forward +
//      backward via single_band_track_from_seed on the het identity.
//      Returns the het skeleton {ok, seed_w, s_window, e_window,
//      windows:[...], het_span_per_window_fracs, mean_continuity}.
//
//   het_define_interval(skeleton, getBpFor)
//      Convert the skeleton's [s_window, e_window] to a bp interval
//      via the supplied getBpFor(w) callback. Returns
//      {start_bp, end_bp, n_windows} or null.
//
//   iv_merge_het_tracks(intervals, opts?)
//      Optional post-call cleanup: merge nearby intervals whose
//      sample-cores overlap by ≥ `min_overlap_frac` (default 0.5).
//      Returns merged interval array.

import {
  single_band_track_from_seed,
  single_band_score_continuity,
  bandMembers,
} from './single_band.js';

/** Defaults for het detection + skeleton stitching. */
export const HET_DEFAULTS = Object.freeze({
  // Minimum span-fraction (k_het mean PC1 sits within central
  // [min + frac*range, max - frac*range] band of the PC1 range)
  // to call a band "het-like" rather than "homozygote-edge".
  min_span_frac: 0.20,
  // Forwarded to single_band_track_from_seed.
  min_jaccard: 0.5,
  // Default merge threshold for iv_merge_het_tracks.
  merge_min_overlap_frac: 0.5,
});

/**
 * Per-band mean PC1 at one window. Bands with zero members get NaN.
 *
 * @param {Int8Array|Array<number>} labels
 * @param {Float32Array|Array<number>} pc1
 * @param {number} K
 * @returns {Float64Array}
 */
export function meanPc1PerBand(labels, pc1, K) {
  const out = new Float64Array(K);
  const counts = new Int32Array(K);
  if (!labels || !pc1 || !(K > 0)) {
    for (let k = 0; k < K; k++) out[k] = NaN;
    return out;
  }
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0 || l >= K) continue;
    const v = pc1[i];
    if (!Number.isFinite(v)) continue;
    out[l] += v;
    counts[l]++;
  }
  for (let k = 0; k < K; k++) {
    out[k] = counts[k] > 0 ? out[k] / counts[k] : NaN;
  }
  return out;
}

/**
 * At one window, detect the band whose mean PC1 is closest to the
 * midpoint of (min-mean, max-mean). Returns
 *
 *   {
 *     k_het:          int   the candidate het band index
 *     k_hom_low:      int   band with lowest mean PC1 (HOM_A anchor)
 *     k_hom_high:     int   band with highest mean PC1 (HOM_B anchor)
 *     mean_pc1:       per-band mean PC1 (Float64Array)
 *     het_span_frac:  (k_het mean - min) / (max - min) ∈ [0, 1]
 *   }
 *
 * Returns null when K < 3, all bands have NaN means, or when the
 * candidate het band's `het_span_frac` is outside
 * `[min_span_frac, 1 - min_span_frac]` (i.e. it's actually a
 * homozygote edge).
 *
 * @param {Int8Array|Array<number>} labels
 * @param {Float32Array|Array<number>} pc1
 * @param {number} K
 * @param {{min_span_frac?:number}} [opts]
 * @returns {Object|null}
 */
export function het_detect_candidate_band(labels, pc1, K, opts) {
  const o = opts || {};
  const minSpanFrac = Number.isFinite(o.min_span_frac)
    ? o.min_span_frac : HET_DEFAULTS.min_span_frac;
  if (!(K >= 3)) return null;
  const means = meanPc1PerBand(labels, pc1, K);
  let minVal = Infinity, maxVal = -Infinity;
  let kLow = -1, kHigh = -1;
  for (let k = 0; k < K; k++) {
    const v = means[k];
    if (!Number.isFinite(v)) continue;
    if (v < minVal) { minVal = v; kLow = k; }
    if (v > maxVal) { maxVal = v; kHigh = k; }
  }
  if (kLow < 0 || kHigh < 0 || kLow === kHigh) return null;
  const range = maxVal - minVal;
  if (!(range > 0)) return null;
  const mid = 0.5 * (minVal + maxVal);
  // Pick the non-edge band with mean PC1 closest to mid.
  let kHet = -1, bestDist = Infinity;
  for (let k = 0; k < K; k++) {
    if (k === kLow || k === kHigh) continue;
    const v = means[k];
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(v - mid);
    if (d < bestDist) { bestDist = d; kHet = k; }
  }
  if (kHet < 0) return null;
  const spanFrac = (means[kHet] - minVal) / range;
  if (spanFrac < minSpanFrac || spanFrac > 1 - minSpanFrac) return null;
  return {
    k_het: kHet,
    k_hom_low: kLow,
    k_hom_high: kHigh,
    mean_pc1: means,
    het_span_frac: spanFrac,
  };
}

/**
 * Detect the het band at seed_w, then walk it forward + backward via
 * single_band_track_from_seed. Returns the stitched het skeleton.
 *
 * Inputs are per-window callbacks identical in shape to
 * single_band_track_from_seed.
 *
 *   {
 *     getLabels(w),  getPc1(w),  getK(w),
 *     chr_s_window, chr_e_window, seed_w,
 *   }
 *
 * The het identity is fixed at the seed window; the walk follows the
 * band whose member-set has the highest Jaccard against the previous
 * step's members. This is the cartridge default (not L2-broadcast).
 *
 * Returns:
 *   {
 *     ok, reason?,
 *     seed_w, s_window, e_window,
 *     windows: [{w, k, members, jaccard_from_prev, het_span_frac}],
 *     mean_continuity, min_continuity,
 *     k_hom_low_at_seed, k_hom_high_at_seed,
 *   }
 *
 * @param {Object} args
 * @returns {Object}
 */
export function het_track_skeleton(args, opts) {
  if (!args || typeof args.getLabels !== 'function'
      || typeof args.getPc1 !== 'function'
      || typeof args.getK !== 'function') {
    return { ok: false, reason: 'NO_CALLBACKS' };
  }
  const seedLabels = args.getLabels(args.seed_w);
  const seedPc1    = args.getPc1(args.seed_w);
  const seedK      = args.getK(args.seed_w);
  const det = het_detect_candidate_band(seedLabels, seedPc1, seedK, opts);
  if (!det) return { ok: false, reason: 'NO_HET_AT_SEED' };

  const track = single_band_track_from_seed({
    getLabels: args.getLabels,
    getK:      args.getK,
    chr_s_window: args.chr_s_window,
    chr_e_window: args.chr_e_window,
    seed_w: args.seed_w,
    seed_k: det.k_het,
  }, opts);
  if (!track.ok) return { ok: false, reason: track.reason || 'NO_TRACK' };

  // Annotate each window with its het_span_frac (the band's own
  // detection at that window — useful diagnostic).
  const windows = track.windows.map(rec => {
    const lbls = args.getLabels(rec.w);
    const pc1  = args.getPc1(rec.w);
    const K_w  = args.getK(rec.w);
    let spanFrac = NaN;
    if (lbls && pc1 && K_w >= 2) {
      const means = meanPc1PerBand(lbls, pc1, K_w);
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < K_w; k++) {
        const v = means[k];
        if (!Number.isFinite(v)) continue;
        if (v < mn) mn = v; if (v > mx) mx = v;
      }
      const range = mx - mn;
      if (range > 0) spanFrac = (means[rec.k] - mn) / range;
    }
    return Object.assign({}, rec, { het_span_frac: spanFrac });
  });
  const cont = single_band_score_continuity(track);

  return {
    ok: true,
    seed_w: args.seed_w,
    s_window: track.s_window,
    e_window: track.e_window,
    windows,
    mean_continuity: cont.mean_jaccard,
    min_continuity: cont.min_jaccard,
    k_hom_low_at_seed:  det.k_hom_low,
    k_hom_high_at_seed: det.k_hom_high,
  };
}

/**
 * Convert a het skeleton to a bp interval via `getBpFor(w)` →
 * {start_bp, end_bp}. Caller decides whether bp coordinates come
 * from a window-position table or precomp.
 *
 * @param {Object} skeleton  output of het_track_skeleton
 * @param {(w:number) => {start_bp:number, end_bp:number}|null} getBpFor
 * @returns {{start_bp:number, end_bp:number, n_windows:number}|null}
 */
export function het_define_interval(skeleton, getBpFor) {
  if (!skeleton || !skeleton.ok || typeof getBpFor !== 'function') return null;
  const s = getBpFor(skeleton.s_window);
  const e = getBpFor(skeleton.e_window);
  if (!s || !e || !Number.isFinite(s.start_bp) || !Number.isFinite(e.end_bp)) {
    return null;
  }
  const n_windows = (skeleton.e_window - skeleton.s_window) + 1;
  return {
    start_bp: s.start_bp,
    end_bp:   e.end_bp,
    n_windows,
  };
}

/**
 * Merge nearby het intervals whose sample-cores overlap by ≥
 * `min_overlap_frac`. Intervals are tuples of
 * `{start_bp, end_bp, sample_core: Set<number>, ...meta}`.
 *
 * Greedy left-to-right: sort by start_bp; for each interval, fold
 * into the previous accepted one when overlap (sample-core Jaccard)
 * ≥ threshold AND bp gap < max_gap_bp (default 100 kb).
 *
 * Returns the merged interval array; preserves the first interval's
 * metadata aside from start_bp/end_bp/sample_core fields, which are
 * recombined.
 *
 * @param {Array<Object>} intervals
 * @param {{min_overlap_frac?:number, max_gap_bp?:number}} [opts]
 * @returns {Array<Object>}
 */
export function iv_merge_het_tracks(intervals, opts) {
  if (!Array.isArray(intervals) || intervals.length === 0) return [];
  const o = opts || {};
  const minOv = Number.isFinite(o.min_overlap_frac)
    ? o.min_overlap_frac : HET_DEFAULTS.merge_min_overlap_frac;
  const maxGap = Number.isFinite(o.max_gap_bp) ? o.max_gap_bp : 100_000;
  const sorted = intervals.slice().sort((a, b) => {
    const A = a && Number.isFinite(a.start_bp) ? a.start_bp : 0;
    const B = b && Number.isFinite(b.start_bp) ? b.start_bp : 0;
    return A - B;
  });
  const out = [];
  for (const iv of sorted) {
    if (!iv) continue;
    if (out.length === 0) {
      out.push(_cloneIv(iv));
      continue;
    }
    const last = out[out.length - 1];
    const gap = iv.start_bp - last.end_bp;
    if (gap > maxGap) {
      out.push(_cloneIv(iv));
      continue;
    }
    const ov = _coreJaccard(last.sample_core, iv.sample_core);
    if (ov < minOv) {
      out.push(_cloneIv(iv));
      continue;
    }
    // Merge: extend bp range + union sample-core.
    last.end_bp = Math.max(last.end_bp, iv.end_bp);
    const merged = new Set(last.sample_core);
    if (iv.sample_core) for (const x of iv.sample_core) merged.add(x);
    last.sample_core = merged;
    last.merged_count = (last.merged_count || 1) + 1;
  }
  return out;
}

function _cloneIv(iv) {
  const out = Object.assign({}, iv);
  out.sample_core = iv.sample_core ? new Set(iv.sample_core) : new Set();
  out.merged_count = 1;
  return out;
}

function _coreJaccard(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of smaller) if (larger.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
}
