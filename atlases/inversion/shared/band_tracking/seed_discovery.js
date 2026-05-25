// shared/band_tracking/seed_discovery.js
// =====================================================================
// STAGE 1 — local seed discovery.
//
// Per chromosome:
//   1. Sweep provisional anchor positions on a coarse grid.
//   2. For each provisional anchor, pick the highest-band_quality
//      window in a small neighbourhood as the actual anchor.
//   3. Capture the anchor's labels (on the chosen tracked-sample subset).
//   4. Compute V(w) + H_off(w) outward from the anchor over a local
//      radius R (windows).
//   5. Walk left and right with hysteresis-and-skip rules over the
//      three-way classification (INTERIOR/CROSSOVER/REGIME_END/UNRELIABLE).
//   6. Emit a seed: anchor + boundary windows + tracked samples +
//      per-window classification.
//   7. Deduplicate overlapping seeds genome-wide.
//
// Outputs are independent of L1/L2 — those layers are visualisation
// scaffolding now. The seed catalogue is the operable unit consumed by
// Stage 2 (cross-seed voting) and Stage 3 (existing chain walk run
// inside each seed footprint).
// =====================================================================

import {
  classifyWindow,
  WINDOW_CLASS,
  WINDOW_CLASSIFICATION_DEFAULTS,
} from './window_classification.js';

import {
  captureAnchor,
  computeAnchorTracksRange,
} from './anchor_signals.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const SEED_DISCOVERY_DEFAULTS = Object.freeze({
  // Coarse-grid spacing for provisional anchor sweep, in windows.
  // Smaller = more candidate anchors = more dedup work later, but
  // better coverage of small inversions.
  anchor_stride:           25,
  // Window-radius around each provisional anchor in which to look for
  // the actual highest-band_quality window. Should be ≤ anchor_stride / 2
  // to keep neighbourhoods non-overlapping.
  anchor_search_radius:    10,
  // Local comparison radius: V/H_off computed over [anchor-R, anchor+R].
  // The walker terminates well inside R if a regime end is found; if
  // the walker reaches the edge of R, the seed is extended-and-re-walked
  // via local_radius_extend (see below).
  local_radius:            200,
  local_radius_extend:     200,   // how much to extend if walker hits edge
  // Walker hysteresis: how many consecutive REGIME_END windows are
  // required to terminate. UNRELIABLE windows do NOT reset the counter.
  termination_consecutive: 2,
  // Minimum seed footprint, in windows. Walkers that produce smaller
  // seeds are dropped.
  min_seed_n_windows:      5,
  // Minimum band_quality at the anchor itself. Anchors with
  // band_quality below this are rejected before any walking.
  min_anchor_band_quality: 0.50,
  // Dedup threshold: seeds whose footprints overlap by ≥ this fraction
  // of the smaller seed's window count are merged (higher-quality anchor
  // wins).
  dedup_overlap_frac:      0.50,
  // Window-classification thresholds (forwarded to classifyWindow).
  classification:          WINDOW_CLASSIFICATION_DEFAULTS,
});

// ---------------------------------------------------------------------
// pickAnchorInNeighborhood
//
// Within [center - radius, center + radius], find the window with the
// highest band_quality. Returns null if no window in the neighbourhood
// passes min_anchor_band_quality.
// ---------------------------------------------------------------------

function pickAnchorInNeighborhood(center, radius, getBandQuality, minBQ,
                                   chr_s_window, chr_e_window) {
  const lo = Math.max(chr_s_window, center - radius);
  const hi = Math.min(chr_e_window, center + radius);
  let best_w = -1, best_bq = -Infinity;
  for (let w = lo; w <= hi; w++) {
    const bq = getBandQuality(w);
    if (Number.isFinite(bq) && bq > best_bq) {
      best_bq = bq; best_w = w;
    }
  }
  if (best_w < 0 || best_bq < minBQ) return null;
  return { win_idx: best_w, band_quality: best_bq };
}

// ---------------------------------------------------------------------
// walkFromAnchor
//
// Walk left and right from the anchor over a precomputed classification
// array. Returns { left_boundary, right_boundary, hit_left_edge,
//                  hit_right_edge, classifications }.
//
// Walking rules:
//   INTERIOR  → include, continue.
//   CROSSOVER → include, continue (consecutive counter resets).
//   REGIME_END → consecutive counter increments. When counter ≥
//                termination_consecutive, terminate; the boundary is
//                placed at the LAST INTERIOR/CROSSOVER window before
//                the run of REGIME_END.
//   UNRELIABLE → skip. Counter is NOT reset and NOT incremented.
//
// hit_*_edge indicates the walker reached the local-radius edge before
// terminating, signalling that local_radius_extend should be applied.
// ---------------------------------------------------------------------

function walkFromAnchor(anchor_local_idx, classifications, opts) {
  const N = classifications.length;
  const term = opts.termination_consecutive;
  // Walk right
  let right_last_kept = anchor_local_idx;
  let right_consec = 0;
  let hit_right_edge = false;
  for (let i = anchor_local_idx + 1; i < N; i++) {
    const cls = classifications[i];
    if (cls === WINDOW_CLASS.INTERIOR || cls === WINDOW_CLASS.CROSSOVER) {
      right_last_kept = i;
      right_consec = 0;
    } else if (cls === WINDOW_CLASS.REGIME_END) {
      right_consec++;
      if (right_consec >= term) break;
    } else {
      // UNRELIABLE: skip, hold state
    }
  }
  // Detect right-edge case: the walker reached i === N - 1 without
  // terminating, OR it terminated within `term` of the end (so the
  // termination might be edge-induced rather than real).
  if (right_consec < term && right_last_kept >= N - 1 - term) hit_right_edge = true;
  // Walk left
  let left_first_kept = anchor_local_idx;
  let left_consec = 0;
  let hit_left_edge = false;
  for (let i = anchor_local_idx - 1; i >= 0; i--) {
    const cls = classifications[i];
    if (cls === WINDOW_CLASS.INTERIOR || cls === WINDOW_CLASS.CROSSOVER) {
      left_first_kept = i;
      left_consec = 0;
    } else if (cls === WINDOW_CLASS.REGIME_END) {
      left_consec++;
      if (left_consec >= term) break;
    } else {
      // UNRELIABLE: skip, hold state
    }
  }
  if (left_consec < term && left_first_kept <= term) hit_left_edge = true;
  return {
    left_local: left_first_kept,
    right_local: right_last_kept,
    hit_left_edge,
    hit_right_edge,
    classifications,
  };
}

// ---------------------------------------------------------------------
// discoverSeedFromAnchor
//
// Given a provisional anchor center, capture the anchor at the highest-
// band_quality window in its neighbourhood, compute V/H_off tracks
// over [anchor-R, anchor+R], classify, walk, and (if the walker hit a
// local-radius edge) extend and re-walk. Returns null if no valid seed
// emerges; otherwise returns the seed record.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.center_w           provisional anchor center
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {(w:number) => number}    args.getBandQuality
 * @param {number} args.chr_s_window
 * @param {number} args.chr_e_window
 * @param {Iterable<number>} [args.tracked_sample_idx]   default: all valid
 * @param {object} [opts]
 * @returns {object|null}
 */
export function discoverSeedFromAnchor(args, opts) {
  const o = Object.assign({}, SEED_DISCOVERY_DEFAULTS, opts || {});
  const { center_w, getLabels, getK, getBandQuality,
          chr_s_window, chr_e_window, tracked_sample_idx } = args;
  // 1. Pick the actual anchor window
  const pick = pickAnchorInNeighborhood(
    center_w, o.anchor_search_radius, getBandQuality,
    o.min_anchor_band_quality, chr_s_window, chr_e_window);
  if (!pick) return null;
  const anchor_w = pick.win_idx;
  const anchor_labels_arr = getLabels(anchor_w);
  const K_a = getK(anchor_w);
  if (!anchor_labels_arr || K_a < 2) return null;
  const anchor = captureAnchor({
    win_idx: anchor_w,
    labels:  anchor_labels_arr,
    K:       K_a,
    tracked_sample_idx,
  });
  if (anchor.n_tracked < 5) return null;

  // 2. Compute V/H_off over [anchor - R, anchor + R]
  let radius = o.local_radius;
  let attempts = 0;
  let tracks, classes, walk;
  // The extend-on-edge loop: if the walker hits a local-radius edge,
  // extend the radius and re-walk. Cap at 3 attempts to avoid running
  // away when the entire chromosome looks V-elevated.
  while (attempts < 3) {
    const s = Math.max(chr_s_window, anchor_w - radius);
    const e = Math.min(chr_e_window, anchor_w + radius);
    tracks = computeAnchorTracksRange({
      anchor_labels: anchor.labels,
      K_a:           anchor.K,
      getLabels, getK,
      s_window: s,
      e_window: e,
    });
    // Build the classification array
    classes = new Array(e - s + 1);
    for (let i = 0; i <= e - s; i++) {
      classes[i] = classifyWindow({
        v_to_anchor:  tracks.v_track[i],
        h_off:        tracks.h_off_track[i],
        band_quality: getBandQuality(s + i),
      }, o.classification);
    }
    const anchor_local = anchor_w - s;
    walk = walkFromAnchor(anchor_local, classes, o);
    walk.s_window_local = s;
    walk.e_window_local = e;
    // Check if we need to extend
    const hit_chr_left = (s === chr_s_window);
    const hit_chr_right = (e === chr_e_window);
    const need_left  = walk.hit_left_edge  && !hit_chr_left;
    const need_right = walk.hit_right_edge && !hit_chr_right;
    if (!need_left && !need_right) break;
    radius += o.local_radius_extend;
    attempts++;
  }

  // 3. Convert local indices back to global
  const seed_s_window = walk.s_window_local + walk.left_local;
  const seed_e_window = walk.s_window_local + walk.right_local;
  const seed_n_windows = seed_e_window - seed_s_window + 1;
  if (seed_n_windows < o.min_seed_n_windows) return null;

  // 4. Emit the seed
  return {
    anchor_w,
    anchor_band_quality: pick.band_quality,
    K_a:               anchor.K,
    anchor_labels:     anchor.labels,
    n_tracked:         anchor.n_tracked,
    s_window:          seed_s_window,
    e_window:          seed_e_window,
    n_windows:         seed_n_windows,
    classifications:   classes,
    classifications_s_window: walk.s_window_local,
    v_track:           tracks.v_track,
    h_off_track:       tracks.h_off_track,
    track_s_window:    tracks.s_window,
    track_e_window:    tracks.e_window,
    hit_left_edge:     walk.hit_left_edge,
    hit_right_edge:    walk.hit_right_edge,
  };
}

// ---------------------------------------------------------------------
// dedupSeeds
//
// Merge seeds whose footprints overlap by ≥ overlap_frac of the smaller.
// "Merge" = keep the one with the higher-band_quality anchor; drop the
// other. Operates in-place on a sorted (by anchor_w) seed array.
// ---------------------------------------------------------------------

function overlapFrac(a, b) {
  const lo = Math.max(a.s_window, b.s_window);
  const hi = Math.min(a.e_window, b.e_window);
  if (hi < lo) return 0;
  const ov = hi - lo + 1;
  const minN = Math.min(a.n_windows, b.n_windows);
  return ov / minN;
}

export function dedupSeeds(seeds, opts) {
  const o = Object.assign({}, SEED_DISCOVERY_DEFAULTS, opts || {});
  if (seeds.length <= 1) return seeds.slice();
  // Sort by anchor_w
  const sorted = seeds.slice().sort((a, b) => a.anchor_w - b.anchor_w);
  const kept = [];
  for (const cand of sorted) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (overlapFrac(k, cand) >= o.dedup_overlap_frac) {
        // Keep the better anchor
        if (cand.anchor_band_quality > k.anchor_band_quality) {
          kept[i] = cand;
        }
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(cand);
  }
  return kept;
}

// ---------------------------------------------------------------------
// discoverSeedsOnChromosome
//
// Sweep the chromosome with the provisional-anchor grid, run
// discoverSeedFromAnchor at each grid point, dedup the results.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {(w:number) => Int8Array} args.getLabels
 * @param {(w:number) => number}    args.getK
 * @param {(w:number) => number}    args.getBandQuality
 * @param {number} args.chr_s_window
 * @param {number} args.chr_e_window
 * @param {Iterable<number>} [args.tracked_sample_idx]
 * @param {object} [opts]
 * @returns {{ seeds: object[], n_provisional: number, n_seeded: number }}
 */
export function discoverSeedsOnChromosome(args, opts) {
  const o = Object.assign({}, SEED_DISCOVERY_DEFAULTS, opts || {});
  const { getLabels, getK, getBandQuality,
          chr_s_window, chr_e_window, tracked_sample_idx } = args;
  const raw_seeds = [];
  let n_provisional = 0;
  for (let center = chr_s_window; center <= chr_e_window; center += o.anchor_stride) {
    n_provisional++;
    const seed = discoverSeedFromAnchor({
      center_w: center,
      getLabels, getK, getBandQuality,
      chr_s_window, chr_e_window,
      tracked_sample_idx,
    }, o);
    if (seed) raw_seeds.push(seed);
  }
  const seeds = dedupSeeds(raw_seeds, o);
  return { seeds, n_provisional, n_seeded: seeds.length, n_raw: raw_seeds.length };
}

/**
 * Async chunked variant of discoverSeedsOnChromosome. Same algorithm +
 * same return shape — but yields control to the event loop every
 * `opts.chunk_anchors` anchors (default 50), and reports progress via
 * `onProgress(done, total, n_seeds_so_far)` before each chunk.
 *
 * 2026-05-21 perf (HR8 haplotype audit): the sync version dominates
 * pipeline Stage 1 (~1-2 seconds frozen on a 10k-window chrom). The
 * anchor loop is naturally chunkable — each iteration is independent
 * up to the final `dedupSeeds` pass. Yielding every 50 anchors gives
 * ~20 progress paints across the typical run with negligible overhead
 * per yield (~0.1ms each at 60Hz).
 *
 * @param {object} args   same as discoverSeedsOnChromosome
 * @param {object} opts   adds `chunk_anchors` (number, default 50)
 * @param {(done:number, total:number, nSeeds:number)=>void} [onProgress]
 * @returns {Promise<object>}   same shape as discoverSeedsOnChromosome
 */
export async function discoverSeedsOnChromosomeAsync(args, opts, onProgress) {
  const o = Object.assign({}, SEED_DISCOVERY_DEFAULTS, opts || {});
  const chunkAnchors = Math.max(1, (opts && opts.chunk_anchors) || 50);
  const { getLabels, getK, getBandQuality,
          chr_s_window, chr_e_window, tracked_sample_idx } = args;
  const raw_seeds = [];
  let n_provisional = 0;
  let anchorCount = 0;
  // Pre-compute total for progress reporting.
  const total = Math.max(1,
    Math.ceil((chr_e_window - chr_s_window + 1) / o.anchor_stride));
  for (let center = chr_s_window; center <= chr_e_window; center += o.anchor_stride) {
    n_provisional++;
    anchorCount++;
    const seed = discoverSeedFromAnchor({
      center_w: center,
      getLabels, getK, getBandQuality,
      chr_s_window, chr_e_window,
      tracked_sample_idx,
    }, o);
    if (seed) raw_seeds.push(seed);
    if (anchorCount % chunkAnchors === 0) {
      if (typeof onProgress === 'function') {
        try { onProgress(anchorCount, total, raw_seeds.length); } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (typeof onProgress === 'function') {
    try { onProgress(anchorCount, total, raw_seeds.length); } catch (_) {}
  }
  const seeds = dedupSeeds(raw_seeds, o);
  return { seeds, n_provisional, n_seeded: seeds.length, n_raw: raw_seeds.length };
}

// Console-debug
if (typeof window !== 'undefined') {
  window._discoverSeedFromAnchor         = discoverSeedFromAnchor;
  window._discoverSeedsOnChromosome      = discoverSeedsOnChromosome;
  window._discoverSeedsOnChromosomeAsync = discoverSeedsOnChromosomeAsync;
  window._dedupSeeds                     = dedupSeeds;
  window._SEED_DISCOVERY_DEFAULTS        = SEED_DISCOVERY_DEFAULTS;
}
