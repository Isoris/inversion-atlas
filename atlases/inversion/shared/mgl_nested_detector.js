// shared/mgl_nested_detector.js
// =====================================================================
// Nested-inversion detector — HANDOFF_7 + SPEC_0 §11.7.
//
// The fundamental question this module answers:
//   "Inside this candidate inversion, is there *another* karyotype
//    axis?"
//
// The diagnostic rule (spec §"conceptual core"):
//   A true nested inversion should appear within ONE PARENT
//   arrangement background, not only when all samples are mixed.
//
// Methods implemented (atlas-side scope — Stage 2 + 4 + run-finder):
//   - Stratify samples by parent karyotype (HOM1 / HET / HOM2)
//   - Per-stratum per-window per-PC 3-band test via K-means + mean
//     silhouette
//   - Contiguous-run finder grouping inner-band candidates by
//     (stratum × PC index) to define inner-interval candidates
//   - Peel-method helper: indices of samples NOT in a dropped
//     stratum (the rescan input)
//
// What the caller supplies:
//   per_stratum_per_window_pcs   — a map { stratum → array<window>
//                                  with PC scores per stratum's samples }
//     The caller is responsible for actually running PCA on each
//     stratum's dosage subset (use mgl_pca_compute.pcaForWindow with
//     the stratum's sample indices). This module only does the
//     3-band test + interval grouping.
//   parent_karyotype_per_sample  — Array<'HOM1'|'HET'|'HOM2'|null>
//
// Pure compute. No DOM, no fetch.
// =====================================================================

import { kmeansNDim, silhouetteNDim } from './mgl_dosage_clustering.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Detection verdicts. */
export const MGL_NESTED_VERDICTS = Object.freeze({
  NESTED_DETECTED:     'nested_detected',
  NO_NESTED_STRUCTURE: 'no_nested_structure',
  INSUFFICIENT_DATA:   'insufficient_data',
});

/** Defaults per HANDOFF_7 §"What to look for". */
export const MGL_NESTED_DEFAULTS = Object.freeze({
  /** Silhouette score threshold for a single window-PC to count as
   *  showing 3-band structure (default 0.5). */
  silhouette_threshold:   0.5,
  /** Minimum contiguous-window run to count as an inner interval
   *  (default 3 = roughly 75-150 kb of sustained signal). */
  min_run_windows:        3,
  /** K used for the 3-band test (always 3 per spec). */
  K_bands:                3,
  /** Minimum stratum size for reliable conditional PCA. */
  min_stratum_size:       10,
  /** Number of PCs to scan (PC1-PC5 per spec). */
  n_pcs_to_scan:          5,
});

// =====================================================================
// 1. Stratification helpers
// =====================================================================

/**
 * Build per-stratum sample-index lists from a parent-karyotype
 * vector.
 *
 * Strata names: 'HOM1' / 'HET' / 'HOM2'. Samples with null /
 * undefined karyotype are dropped.
 *
 * @param {Array<string|null>} parent_karyotype
 * @returns {{HOM1:number[], HET:number[], HOM2:number[]}}
 */
export function stratifyByParentKaryotype(parent_karyotype) {
  const out = { HOM1: [], HET: [], HOM2: [] };
  if (!Array.isArray(parent_karyotype)) return out;
  for (let i = 0; i < parent_karyotype.length; i++) {
    const k = parent_karyotype[i];
    if (k === 'HOM1' || k === 'HET' || k === 'HOM2') out[k].push(i);
  }
  return out;
}

/**
 * Peel method (Stage 4): return the sample indices that are NOT in
 * the supplied dropped stratum. The caller re-runs whole-cohort
 * PCA on this filtered set and checks whether the parent signal
 * disappears (= a real parent inversion) or persists (= the
 * "parent" was a confounder).
 *
 * @param {Array<string|null>} parent_karyotype
 * @param {string} dropped_stratum    'HOM1' / 'HET' / 'HOM2'
 * @returns {number[]}                indices to keep
 */
export function peelStratum(parent_karyotype, dropped_stratum) {
  const out = [];
  if (!Array.isArray(parent_karyotype)) return out;
  for (let i = 0; i < parent_karyotype.length; i++) {
    const k = parent_karyotype[i];
    if (k !== dropped_stratum && k != null) out.push(i);
  }
  return out;
}

// =====================================================================
// 2. Per-window per-PC 3-band test
// =====================================================================

/**
 * Test a 1-dim score vector for 3-band structure via K-means + mean
 * silhouette. Returns the silhouette score (0 if degenerate).
 *
 * @param {Float64Array|number[]} scores   length n_samples_stratum
 * @returns {{silhouette:number, assignment:Int32Array|null}}
 */
export function testThreeBandStructure(scores) {
  if (!scores || scores.length < MGL_NESTED_DEFAULTS.K_bands * 2) {
    return { silhouette: 0, assignment: null };
  }
  const n = scores.length;
  const D = new Float64Array(n);
  for (let i = 0; i < n; i++) D[i] = scores[i];
  // K-means on 1-dim scores (n_dim = 1) with K=3.
  const km = kmeansNDim(D, n, 1, MGL_NESTED_DEFAULTS.K_bands, { n_init: 10 });
  // Silhouette (needs Euclidean distances).
  const sil = silhouetteNDim(D, n, 1, km.labels, MGL_NESTED_DEFAULTS.K_bands);
  return { silhouette: sil, assignment: km.labels };
}

/**
 * For one stratum, scan every (window × PC) pair and flag those
 * showing 3-band structure (silhouette > threshold).
 *
 * @param {Array<{idx:number, pcs:Array<Float64Array|number[]>}>}
 *                                       per_window      one entry per window;
 *   `pcs[k]` is the per-sample-in-stratum scores on PC(k+1).
 * @param {Object} [opts]
 * @returns {Array<{stratum:string, window_idx:number, pc_index:number,
 *                   silhouette:number, assignment:Int32Array}>}
 *
 *   stratum is left null on each row; the caller adds it.
 */
export function scanStratumForInnerBands(per_window, opts) {
  const o = opts || {};
  const silThr = Number.isFinite(o.silhouette_threshold)
    ? o.silhouette_threshold : MGL_NESTED_DEFAULTS.silhouette_threshold;
  const n_pcs = Number.isFinite(o.n_pcs_to_scan)
    ? o.n_pcs_to_scan : MGL_NESTED_DEFAULTS.n_pcs_to_scan;
  const out = [];
  if (!Array.isArray(per_window)) return out;
  for (const w of per_window) {
    if (!w || !Array.isArray(w.pcs)) continue;
    const wi = Number.isFinite(w.idx) ? w.idx : 0;
    for (let pc = 0; pc < Math.min(n_pcs, w.pcs.length); pc++) {
      const scores = w.pcs[pc];
      if (!scores) continue;
      const r = testThreeBandStructure(scores);
      if (r.silhouette > silThr) {
        out.push({
          stratum:    null,
          window_idx: wi,
          pc_index:   pc + 1,
          silhouette: r.silhouette,
          assignment: r.assignment,
        });
      }
    }
  }
  return out;
}

// =====================================================================
// 3. Contiguous-run finder → inner-interval candidates
// =====================================================================

/**
 * Group inner-band candidates by (stratum, pc_index) and find
 * contiguous runs of windows ≥ min_run_windows.
 *
 * Run definition: a sequence of consecutive `window_idx` values
 * with no gap > 1. The caller's window_idx must be monotonically
 * comparable (typically the per-window-array position).
 *
 * @param {Array<Object>} candidates    output of scanStratumForInnerBands
 *                                       (with `stratum` filled in)
 * @param {Object} [opts]
 * @returns {Array<{stratum:string, pc_index:number,
 *                   window_start:number, window_end:number,
 *                   n_windows:number, mean_silhouette:number}>}
 */
export function findContiguousInnerIntervals(candidates, opts) {
  const o = opts || {};
  const minRun = Number.isFinite(o.min_run_windows)
    ? o.min_run_windows : MGL_NESTED_DEFAULTS.min_run_windows;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  // Group by (stratum, pc_index)
  const groups = new Map();
  for (const c of candidates) {
    const k = (c.stratum || 'null') + '|' + c.pc_index;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const out = [];
  for (const [key, list] of groups) {
    // Sort by window_idx ascending.
    list.sort((a, b) => a.window_idx - b.window_idx);
    // Walk and emit runs.
    let runStart = 0;
    for (let i = 1; i <= list.length; i++) {
      const last = list[i - 1];
      const next = list[i];
      const broken = !next || (next.window_idx - last.window_idx > 1);
      if (broken) {
        const run = list.slice(runStart, i);
        if (run.length >= minRun) {
          const meanSil = run.reduce((s, r) => s + r.silhouette, 0) / run.length;
          out.push({
            stratum:        run[0].stratum,
            pc_index:       run[0].pc_index,
            window_start:   run[0].window_idx,
            window_end:     run[run.length - 1].window_idx,
            n_windows:      run.length,
            mean_silhouette: meanSil,
          });
        }
        runStart = i;
      }
    }
  }
  // Sort intervals by mean_silhouette descending — strongest signals
  // first for downstream rendering.
  out.sort((a, b) => b.mean_silhouette - a.mean_silhouette);
  return out;
}

// =====================================================================
// 4. End-to-end orchestrator
// =====================================================================

/**
 * Run the nested-detection pipeline given pre-computed per-stratum
 * per-window PCA scores.
 *
 * @param {Object} args
 * @param {Object} args.per_stratum_per_window_pcs
 *   { HOM1: Array<{idx, pcs}>, HET: Array<{idx, pcs}>, HOM2: ... }
 * @param {Array<string|null>} [args.parent_karyotype]   for size gating
 *                                                        + verdict context
 * @param {Object} [args.opts]
 * @returns {{
 *   inner_intervals: Array<Object>,
 *   per_stratum_candidates: Object,    // {stratum → Array<candidate>}
 *   verdict: string,
 *   strata_scanned: string[],
 * }}
 */
export function detectNestedInversion(args) {
  const a = args || {};
  const o = a.opts || {};
  const minStratum = Number.isFinite(o.min_stratum_size)
    ? o.min_stratum_size : MGL_NESTED_DEFAULTS.min_stratum_size;

  const psw = a.per_stratum_per_window_pcs || {};
  const strata = ['HOM1', 'HET', 'HOM2'];
  const strata_scanned = [];
  const per_stratum_candidates = Object.create(null);
  const all_candidates = [];

  // Compute per-stratum stratum sizes from parent_karyotype if given,
  // else infer from PCA payload's first-window pc1 length.
  const strataSizes = a.parent_karyotype
    ? _stratumSizes(a.parent_karyotype)
    : null;

  for (const stratum of strata) {
    const per_window = psw[stratum];
    if (!Array.isArray(per_window) || per_window.length === 0) {
      per_stratum_candidates[stratum] = [];
      continue;
    }
    const size = strataSizes
      ? (strataSizes[stratum] || 0)
      : ((per_window[0] && per_window[0].pcs && per_window[0].pcs[0])
          ? per_window[0].pcs[0].length : 0);
    if (size < minStratum) {
      per_stratum_candidates[stratum] = [];
      continue;
    }
    strata_scanned.push(stratum);
    const candidates = scanStratumForInnerBands(per_window, o);
    // Stamp stratum on each candidate.
    for (const c of candidates) c.stratum = stratum;
    per_stratum_candidates[stratum] = candidates;
    for (const c of candidates) all_candidates.push(c);
  }

  const inner_intervals = findContiguousInnerIntervals(all_candidates, o);
  let verdict;
  if (strata_scanned.length === 0) {
    verdict = MGL_NESTED_VERDICTS.INSUFFICIENT_DATA;
  } else if (inner_intervals.length === 0) {
    verdict = MGL_NESTED_VERDICTS.NO_NESTED_STRUCTURE;
  } else {
    verdict = MGL_NESTED_VERDICTS.NESTED_DETECTED;
  }
  return {
    inner_intervals,
    per_stratum_candidates,
    verdict,
    strata_scanned,
  };
}

function _stratumSizes(parent_karyotype) {
  const out = { HOM1: 0, HET: 0, HOM2: 0 };
  for (const k of parent_karyotype) {
    if (k === 'HOM1' || k === 'HET' || k === 'HOM2') out[k]++;
  }
  return out;
}
