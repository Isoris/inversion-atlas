// shared/band_tracking/hom.js
// =====================================================================
// HOM-band anchoring for the het-skeleton karyotype-call pipeline.
//
// Given a het skeleton (output of het.js#het_track_skeleton), build
// per-window HOM_A (low-PC1 homozygote) and HOM_B (high-PC1
// homozygote) anchor sample sets, plus a cohort-level consensus
// anchor — the dominant sample set that's HOM_A across most het-
// skeleton windows.
//
// Per-window resolution throughout — never L2-broadcast (the cartridge
// upgrade vs legacy recomputeAnchorConcord).
//
// Two exports:
//
//   hom_anchor_in_window(labels, pc1, K, het_k?)
//      For one window, return {k_hom_low, k_hom_high, mean_pc1}.
//      When `het_k` is supplied, excludes it from the hom candidates
//      (so we don't pick the het band as HOM_A or HOM_B).
//
//   hom_anchor_to_het({skeleton, getLabels, getPc1, getK})
//      Walk every window of a het skeleton; accumulate the HOM_A /
//      HOM_B sample membership per window; emit
//      {hom_a_per_window, hom_b_per_window, hom_a_consensus,
//       hom_b_consensus, hom_a_score, hom_b_score} where the
//      consensus sets are samples that are HOM_A (or HOM_B) at ≥
//      `consensus_min_frac` of the skeleton's windows.

import { bandMembers } from './single_band.js';
import { meanPc1PerBand } from './het.js';

/** Defaults for hom anchoring + consensus voting. */
export const HOM_DEFAULTS = Object.freeze({
  // Minimum fraction of skeleton windows where a sample must be the
  // lowest/highest hom band to be in the consensus set.
  consensus_min_frac: 0.50,
});

/**
 * At one window, pick the lowest-PC1 and highest-PC1 bands. When
 * `het_k` is supplied, exclude it (so the het band can't be a HOM
 * anchor by accident).
 *
 * Returns {k_hom_low, k_hom_high, mean_pc1} or null when fewer than
 * two bands have a finite mean PC1.
 *
 * @param {Int8Array|Array<number>} labels
 * @param {Float32Array|Array<number>} pc1
 * @param {number} K
 * @param {number|null} [het_k]
 * @returns {Object|null}
 */
export function hom_anchor_in_window(labels, pc1, K, het_k) {
  if (!(K >= 2)) return null;
  const means = meanPc1PerBand(labels, pc1, K);
  let mnVal = Infinity, mxVal = -Infinity;
  let kLow = -1, kHigh = -1;
  for (let k = 0; k < K; k++) {
    if (het_k != null && k === het_k) continue;
    const v = means[k];
    if (!Number.isFinite(v)) continue;
    if (v < mnVal) { mnVal = v; kLow  = k; }
    if (v > mxVal) { mxVal = v; kHigh = k; }
  }
  if (kLow < 0 || kHigh < 0 || kLow === kHigh) return null;
  return { k_hom_low: kLow, k_hom_high: kHigh, mean_pc1: means };
}

/**
 * Across the windows of a het skeleton, accumulate HOM_A (low-PC1
 * hom) and HOM_B (high-PC1 hom) sample sets per window, then derive
 * the cohort-level consensus anchor sets.
 *
 * Returns:
 *   {
 *     ok: boolean,
 *     reason?: string,
 *     n_windows: int,
 *     hom_a_per_window: Array<Set<number>>,
 *     hom_b_per_window: Array<Set<number>>,
 *     hom_a_score: Map<sampleIdx, frac>,   // frac of skeleton wins
 *                                            sample sat in HOM_A
 *     hom_b_score: Map<sampleIdx, frac>,
 *     hom_a_consensus: Set<number>,        // hom_a_score ≥ thr
 *     hom_b_consensus: Set<number>,
 *   }
 *
 * @param {Object} args
 * @param {Object} args.skeleton            output of het_track_skeleton
 * @param {(w:number) => Int8Array|null} args.getLabels
 * @param {(w:number) => Array<number>|null} args.getPc1
 * @param {(w:number) => number}         args.getK
 * @param {{consensus_min_frac?:number}} [opts]
 * @returns {Object}
 */
export function hom_anchor_to_het(args, opts) {
  if (!args || !args.skeleton || !args.skeleton.ok) {
    return { ok: false, reason: 'NO_SKELETON' };
  }
  if (typeof args.getLabels !== 'function'
      || typeof args.getPc1 !== 'function'
      || typeof args.getK !== 'function') {
    return { ok: false, reason: 'NO_CALLBACKS' };
  }
  const o = opts || {};
  const thr = Number.isFinite(o.consensus_min_frac)
    ? o.consensus_min_frac : HOM_DEFAULTS.consensus_min_frac;

  const windows = args.skeleton.windows;
  const homA = [];
  const homB = [];
  const scoreA = new Map();
  const scoreB = new Map();

  for (const rec of windows) {
    const labels = args.getLabels(rec.w);
    const pc1    = args.getPc1(rec.w);
    const K_w    = args.getK(rec.w);
    if (!labels || !pc1 || !(K_w >= 3)) {
      homA.push(new Set());
      homB.push(new Set());
      continue;
    }
    const anchor = hom_anchor_in_window(labels, pc1, K_w, rec.k);
    if (!anchor) {
      homA.push(new Set());
      homB.push(new Set());
      continue;
    }
    const setA = bandMembers(labels, anchor.k_hom_low);
    const setB = bandMembers(labels, anchor.k_hom_high);
    homA.push(setA);
    homB.push(setB);
    for (const x of setA) scoreA.set(x, (scoreA.get(x) || 0) + 1);
    for (const x of setB) scoreB.set(x, (scoreB.get(x) || 0) + 1);
  }

  // Convert counts to fractions over n_windows; build consensus sets.
  const n_windows = windows.length;
  const fracA = new Map();
  const fracB = new Map();
  const consA = new Set();
  const consB = new Set();
  if (n_windows > 0) {
    for (const [si, c] of scoreA) {
      const f = c / n_windows;
      fracA.set(si, f);
      if (f >= thr) consA.add(si);
    }
    for (const [si, c] of scoreB) {
      const f = c / n_windows;
      fracB.set(si, f);
      if (f >= thr) consB.add(si);
    }
  }
  // Disambiguate: a sample in BOTH consensus sets is contradictory.
  // Drop it from the one where its score is lower.
  for (const si of consA) {
    if (!consB.has(si)) continue;
    const fa = fracA.get(si) || 0;
    const fb = fracB.get(si) || 0;
    if (fa >= fb) consB.delete(si);
    else          consA.delete(si);
  }

  return {
    ok: true,
    n_windows,
    hom_a_per_window: homA,
    hom_b_per_window: homB,
    hom_a_score: fracA,
    hom_b_score: fracB,
    hom_a_consensus: consA,
    hom_b_consensus: consB,
  };
}
