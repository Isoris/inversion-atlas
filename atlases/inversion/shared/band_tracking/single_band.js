// shared/band_tracking/single_band.js
// =====================================================================
// LAYER A primitives — single-band trajectory across windows.
//
// All four helpers operate on PER-WINDOW K-means labels (NOT per-L2
// envelope — see anchor_signals.js header for the same upgrade note:
// per-window resolution is the cartridge default; legacy L2-broadcast
// is bypassed). Inputs are injected via `getLabels(w)` / `getK(w)`
// callbacks identical in shape to seed_discovery.js's contract.
//
// Pure JS — no DOM, no state. Headless-tolerant.
//
// Four exports:
//
//   bandMembers(labels, k)
//      Set<sampleIdx> of samples assigned to label `k` at one window.
//
//   bandJaccard(setA, setB)
//      |A ∩ B| / |A ∪ B| ∈ [0, 1]. 1 = identical; 0 = disjoint.
//
//   single_band_track_from_seed({getLabels, getK, ...}, seed_w, seed_k, opts)
//      Walk forward + backward from a (seed_w, seed_k) anchor. At each
//      step, pick the next window's band whose member-set has the
//      highest Jaccard with the previous step's members. Stops when
//      Jaccard < `min_jaccard` (default 0.5) — the band "fades out" or
//      mixes too much to track.
//
//   single_band_score_continuity(track)
//      Per-step retained / lost / gained sample counts + Jaccard between
//      consecutive members. Diagnostic of HOW a band's identity evolves
//      across windows (used by the het/hom skeleton stitchers).

/** Default Jaccard threshold below which a track terminates. */
export const SINGLE_BAND_DEFAULTS = Object.freeze({
  min_jaccard: 0.5,
  max_steps: 1_000_000,   // safety cap; real walks bounded by window range
});

/**
 * Sample indices assigned to label `k` at one window's labels array.
 * Returns an empty Set when labels is null/missing.
 *
 * @param {Int8Array|Array<number>} labels
 * @param {number} k
 * @returns {Set<number>}
 */
export function bandMembers(labels, k) {
  const out = new Set();
  if (!labels || typeof labels.length !== 'number') return out;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === k) out.add(i);
  }
  return out;
}

/**
 * Jaccard similarity between two Set<number>. Empty-vs-empty → 0
 * (not undefined) so callers don't need to special-case.
 *
 * @param {Set<number>} a
 * @param {Set<number>} b
 * @returns {number}
 */
export function bandJaccard(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of smaller) if (larger.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
}

/**
 * Track a single band from a seed (seed_w, seed_k) outwards.
 *
 * At each step, the next window's K bands are scored by Jaccard against
 * the previous step's member set; the highest-Jaccard band is the
 * extension. Stops when Jaccard < `min_jaccard` OR a window's labels
 * are missing OR the walk hits the window range boundary.
 *
 * Returns:
 *   {
 *     ok:          boolean,
 *     seed_w, seed_k,
 *     s_window, e_window,          inclusive window range covered
 *     windows: [{w, k, members, jaccard_from_prev}],
 *     stop_reason_left, stop_reason_right ∈ {
 *       'reached_boundary' | 'low_jaccard' | 'no_labels' | 'max_steps'
 *     }
 *   }
 *
 * @param {Object} args
 * @param {(w:number) => Int8Array|null} args.getLabels
 * @param {(w:number) => number}         args.getK
 * @param {number} args.chr_s_window
 * @param {number} args.chr_e_window
 * @param {number} args.seed_w
 * @param {number} args.seed_k
 * @param {{min_jaccard?:number, max_steps?:number}} [opts]
 * @returns {Object}
 */
export function single_band_track_from_seed(args, opts) {
  const o = opts || {};
  const minJ = Number.isFinite(o.min_jaccard)
    ? o.min_jaccard : SINGLE_BAND_DEFAULTS.min_jaccard;
  const maxSteps = Number.isFinite(o.max_steps)
    ? o.max_steps : SINGLE_BAND_DEFAULTS.max_steps;

  const { getLabels, getK, chr_s_window, chr_e_window, seed_w, seed_k } = args;
  if (typeof getLabels !== 'function' || typeof getK !== 'function') {
    return { ok: false, reason: 'NO_CALLBACKS' };
  }
  const seedLabels = getLabels(seed_w);
  if (!seedLabels) return { ok: false, reason: 'NO_SEED_LABELS' };
  const seedK = getK(seed_w);
  if (!(seed_k >= 0) || !(seed_k < seedK)) {
    return { ok: false, reason: 'BAD_SEED_K' };
  }
  const seedMembers = bandMembers(seedLabels, seed_k);
  if (seedMembers.size === 0) {
    return { ok: false, reason: 'EMPTY_SEED_BAND' };
  }

  const seedRec = {
    w: seed_w, k: seed_k, members: seedMembers, jaccard_from_prev: 1.0,
  };

  // Walk one direction; returns { records, stopReason, end_w }
  function walk(direction) {
    const records = [];
    let prevMembers = seedMembers;
    let w = seed_w + direction;
    let stopReason = 'reached_boundary';
    let steps = 0;
    while (w >= chr_s_window && w <= chr_e_window && steps < maxSteps) {
      const labels = getLabels(w);
      if (!labels) { stopReason = 'no_labels'; break; }
      const K_w = getK(w);
      // Find the best-Jaccard band at window w.
      let bestK = -1, bestJ = -1, bestMembers = null;
      for (let k = 0; k < K_w; k++) {
        const m = bandMembers(labels, k);
        if (m.size === 0) continue;
        const j = bandJaccard(prevMembers, m);
        if (j > bestJ) { bestJ = j; bestK = k; bestMembers = m; }
      }
      if (bestK < 0 || bestJ < minJ) { stopReason = 'low_jaccard'; break; }
      records.push({ w, k: bestK, members: bestMembers, jaccard_from_prev: bestJ });
      prevMembers = bestMembers;
      w += direction;
      steps++;
    }
    if (steps >= maxSteps) stopReason = 'max_steps';
    return { records, stopReason };
  }

  const rightWalk = walk(+1);
  const leftWalk  = walk(-1);

  // Stitch: left walk emitted records in descending w order, reverse
  // them so the final windows[] is monotonic ascending in w.
  leftWalk.records.reverse();
  const windows = leftWalk.records.concat([seedRec], rightWalk.records);

  return {
    ok: true,
    seed_w, seed_k,
    s_window: windows[0].w,
    e_window: windows[windows.length - 1].w,
    windows,
    stop_reason_left: leftWalk.stopReason,
    stop_reason_right: rightWalk.stopReason,
  };
}

/**
 * Per-step continuity score along a single-band track. For each
 * consecutive pair (i, i+1) emit:
 *
 *   {
 *     w_from, w_to,
 *     jaccard,
 *     n_retained,   // samples in both
 *     n_lost,       // in i but not i+1
 *     n_gained,     // in i+1 but not i
 *     n_prev, n_next,
 *   }
 *
 * Plus aggregate {mean_jaccard, min_jaccard, n_steps}.
 *
 * @param {Object} track  output of single_band_track_from_seed
 * @returns {{steps:Array<Object>, mean_jaccard:number, min_jaccard:number, n_steps:number}}
 */
export function single_band_score_continuity(track) {
  if (!track || !track.ok || !Array.isArray(track.windows)) {
    return { steps: [], mean_jaccard: 0, min_jaccard: 0, n_steps: 0 };
  }
  const ws = track.windows;
  const steps = [];
  let sumJ = 0, minJ = Infinity;
  for (let i = 1; i < ws.length; i++) {
    const prev = ws[i - 1], cur = ws[i];
    let retained = 0, gained = 0;
    for (const x of cur.members) {
      if (prev.members.has(x)) retained++;
      else gained++;
    }
    let lost = 0;
    for (const x of prev.members) if (!cur.members.has(x)) lost++;
    const j = cur.jaccard_from_prev;
    sumJ += j;
    if (j < minJ) minJ = j;
    steps.push({
      w_from: prev.w, w_to: cur.w,
      jaccard: j,
      n_retained: retained, n_lost: lost, n_gained: gained,
      n_prev: prev.members.size, n_next: cur.members.size,
    });
  }
  return {
    steps,
    mean_jaccard: steps.length > 0 ? sumJ / steps.length : 0,
    min_jaccard: steps.length > 0 ? minJ : 0,
    n_steps: steps.length,
  };
}
