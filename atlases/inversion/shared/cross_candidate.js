// shared/cross_candidate.js
//
// Pairwise cross-candidate contingency analysis. Given two K-means
// label arrays (one per candidate), build a KA × KB contingency table
// and emit:
//   - Cramér's V (chi-square effect size)
//   - per-source-band fingerprints (P(target_band | source_band)
//     distributions with entropy + concentration + mode)
//   - dominant joint patterns (cells holding ≥ max(5, 5%) of the cohort)
//   - low-expected-count warning when many cells violate the χ²
//     approximation's ≥5-expected-count rule
//
// Plus an items[] → N×N Cramér's V matrix builder that runs every
// pairwise contingency in one pass.
//
// Used by the "inheritance group" / cross-candidate-linkage UI to
// identify which candidate bands are "the same haplotype system."
//
// Legacy origin:
//   - _bandFingerprintFor         line 38497
//   - crossCandidateContingency   line 38542
//   - crossCandidateMatrix        line 38653
//
// All three are pure (no state). chiSqSurvival is imported from
// shared/contingency.js — the existing home for the χ² distribution.

import { chiSqSurvival } from './contingency.js';

// =====================================================================
// Constants
// =====================================================================

/** Default minimum cohort size; below this the contingency returns NaN stats. */
export const CROSS_CANDIDATE_MIN_N_DEFAULT = 10;

/**
 * Below-5 expected-count cell fraction above which the contingency
 * sets low_count_warning. The χ² approximation breaks down when too
 * many expected cells are < 5.
 */
export const CROSS_CANDIDATE_LOW_COUNT_FRACTION = 0.20;

// =====================================================================
// Per-band fingerprint
// =====================================================================

/**
 * Per-source-band fingerprint: the conditional distribution
 * P(target_band | source_band = band_a) plus its mode, entropy
 * (nats) and concentration = 1 − H/log(K_target).
 *
 * Returns:
 *   {
 *     source_id, source_band, source_K,
 *     target_id, target_K,
 *     n,                       // count of samples in source band with valid target
 *     dist: Float32Array[KB],  // P(target | source) — sums to 1 when n > 0
 *     mode_band, mode_share,
 *     entropy, concentration   // both NaN when n === 0
 *   }
 * or null when band_a is out of range.
 */
export function bandFingerprintFor(labelsA, labelsB, KA, KB, band_a, srcId, tgtId) {
  if (band_a < 0 || band_a >= KA) return null;
  const dist = new Float32Array(KB);
  let n = 0;
  for (let i = 0; i < labelsA.length; i++) {
    const a = labelsA[i], b = labelsB[i];
    if (a !== band_a) continue;
    if (b < 0 || b >= KB) continue;
    dist[b]++;
    n++;
  }
  if (n === 0) {
    return {
      source_id: srcId || null, source_band: band_a, source_K: KA,
      target_id: tgtId || null, target_K: KB,
      n: 0, dist, mode_band: -1, mode_share: 0,
      entropy: NaN, concentration: NaN,
    };
  }
  let mode_band = 0, mode_count = -1;
  for (let k = 0; k < KB; k++) {
    if (dist[k] > mode_count) { mode_count = dist[k]; mode_band = k; }
    dist[k] /= n;
  }
  let H = 0;
  for (let k = 0; k < KB; k++) {
    if (dist[k] > 0) H -= dist[k] * Math.log(dist[k]);
  }
  const Hmax = (KB > 1) ? Math.log(KB) : 1;
  const concentration = (Hmax > 0) ? 1 - H / Hmax : 1;
  return {
    source_id: srcId || null, source_band: band_a, source_K: KA,
    target_id: tgtId || null, target_K: KB,
    n,
    dist,
    mode_band,
    mode_share: dist[mode_band],
    entropy: H,
    concentration,
  };
}

// =====================================================================
// Pairwise contingency
// =====================================================================

/**
 * Pairwise contingency between two K-means label arrays.
 *
 * Out-of-range labels (e.g. -1 sentinels) are silently dropped from
 * both numerator and denominator. When n < min_n, the result has
 * NaN stats and `reason` set; this is NOT a fatal error — UI can
 * still show the table.
 *
 * Returns:
 *   {
 *     M: number[KA][KB], KA, KB, n,
 *     cramer_v, chi2, df, p_value,
 *     low_count_warning, cells_below_5,
 *     dominant_patterns: [{source_band, target_band, count,
 *                          row_share, col_share}, ...],
 *     band_fingerprints: [<bandFingerprintFor result>, ...],  // length KA
 *     source_id, target_id,
 *     reason?  // present when low_n short-circuited
 *   }
 * or null when inputs are missing / unequal length / KA<=0 / KB<=0.
 *
 * @param {Int8Array|number[]} labelsA
 * @param {Int8Array|number[]} labelsB
 * @param {number} KA
 * @param {number} KB
 * @param {{min_n?:number, source_id?:string, target_id?:string}} [opts]
 */
export function crossCandidateContingency(labelsA, labelsB, KA, KB, opts) {
  if (!labelsA || !labelsB) return null;
  if (labelsA.length !== labelsB.length) return null;
  KA = (KA > 0) ? KA : 0;
  KB = (KB > 0) ? KB : 0;
  if (!KA || !KB) return null;
  const minN = (opts && opts.min_n != null) ? +opts.min_n : CROSS_CANDIDATE_MIN_N_DEFAULT;
  const srcId = (opts && opts.source_id) || null;
  const tgtId = (opts && opts.target_id) || null;

  const M = Array.from({ length: KA }, () => new Array(KB).fill(0));
  const rowSum = new Array(KA).fill(0);
  const colSum = new Array(KB).fill(0);
  let n = 0;
  for (let i = 0; i < labelsA.length; i++) {
    const a = labelsA[i], b = labelsB[i];
    if (a < 0 || a >= KA || b < 0 || b >= KB) continue;
    M[a][b]++;
    rowSum[a]++;
    colSum[b]++;
    n++;
  }
  if (n < minN) {
    return {
      M, KA, KB, n,
      cramer_v: NaN, chi2: NaN, df: 0, p_value: NaN,
      low_count_warning: true,
      cells_below_5: 0,
      dominant_patterns: [],
      band_fingerprints: [],
      source_id: srcId, target_id: tgtId,
      reason: `n=${n} < min_n=${minN}`,
    };
  }

  // Chi-square + expected-count guard
  let chi2 = 0;
  let cells_below_5 = 0;
  for (let a = 0; a < KA; a++) {
    for (let b = 0; b < KB; b++) {
      const E = (rowSum[a] * colSum[b]) / n;
      if (E < 5) cells_below_5++;
      if (E > 0) {
        const d = M[a][b] - E;
        chi2 += d * d / E;
      }
    }
  }
  const df = (KA - 1) * (KB - 1);
  const denom = n * Math.max(1, Math.min(KA - 1, KB - 1));
  const cramer_v = denom > 0 ? Math.sqrt(chi2 / denom) : NaN;
  const p_value = df > 0 ? chiSqSurvival(chi2, df) : NaN;
  const low_count_warning = (cells_below_5 / Math.max(1, KA * KB)) > CROSS_CANDIDATE_LOW_COUNT_FRACTION;

  // Dominant joint patterns: cells ≥ max(5, 5% of n)
  const cellThr = Math.max(5, Math.ceil(0.05 * n));
  const cells = [];
  for (let a = 0; a < KA; a++) {
    for (let b = 0; b < KB; b++) {
      if (M[a][b] >= cellThr) {
        cells.push({
          source_band: a, target_band: b,
          count: M[a][b],
          row_share: rowSum[a] > 0 ? M[a][b] / rowSum[a] : 0,
          col_share: colSum[b] > 0 ? M[a][b] / colSum[b] : 0,
        });
      }
    }
  }
  cells.sort((x, y) => y.count - x.count);
  const dominant_patterns = cells.slice(0, 6);

  // Per-source-band fingerprints
  const band_fingerprints = [];
  for (let a = 0; a < KA; a++) {
    band_fingerprints.push(bandFingerprintFor(labelsA, labelsB, KA, KB, a, srcId, tgtId));
  }

  return {
    M, KA, KB, n,
    cramer_v, chi2, df, p_value,
    low_count_warning, cells_below_5,
    dominant_patterns,
    band_fingerprints,
    source_id: srcId, target_id: tgtId,
  };
}

// =====================================================================
// Pairwise matrix
// =====================================================================

/**
 * Compute Cramér's V across every pair of items in the list. Diagonal
 * entries = 1.0 (a candidate is perfectly linked to itself). Off-
 * diagonal entries = Cramér's V from the pairwise contingency.
 *
 *   items = [{ id, labels, K, meta? }, ...]
 *
 * Returns:
 *   {
 *     n_items, ids: string[], K_per_item: number[],
 *     cramer_v: Float32Array[n_items × n_items],   // symmetric, diag=1
 *     pair_details: Map<"i:j", contingency_result>, // lazy (see opts.full_details)
 *     warnings: { count_below_5: [{i, j, frac}, ...] },
 *     items: ref-to-input,
 *   }
 * or null on empty / invalid input.
 *
 * `pair_details` is populated only when opts.full_details = true.
 * Default off to keep memory bounded for large item lists.
 *
 * @param {Array<{id:string, labels:Int8Array|number[], K:number}>} items
 * @param {{full_details?:boolean, min_n?:number}} [opts]
 */
export function crossCandidateMatrix(items, opts) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const n_items = items.length;
  const ids = items.map((it, i) => (it && it.id != null) ? String(it.id) : `_${i}`);
  const K_per_item = items.map(it => (it && it.K > 0) ? it.K : 0);
  const cramer_v = new Float32Array(n_items * n_items);
  const pair_details = new Map();
  const count_below_5 = [];
  const full_details = !!(opts && opts.full_details);
  const min_n = (opts && opts.min_n != null) ? +opts.min_n : CROSS_CANDIDATE_MIN_N_DEFAULT;

  for (let i = 0; i < n_items; i++) cramer_v[i * n_items + i] = 1.0;

  for (let i = 0; i < n_items; i++) {
    const a = items[i];
    for (let j = i + 1; j < n_items; j++) {
      const b = items[j];
      if (!a || !a.labels || !b || !b.labels) {
        cramer_v[i * n_items + j] = NaN;
        cramer_v[j * n_items + i] = NaN;
        continue;
      }
      const result = crossCandidateContingency(
        a.labels, b.labels, K_per_item[i], K_per_item[j],
        { min_n, source_id: ids[i], target_id: ids[j] }
      );
      if (!result) {
        cramer_v[i * n_items + j] = NaN;
        cramer_v[j * n_items + i] = NaN;
        continue;
      }
      const v = Number.isFinite(result.cramer_v) ? result.cramer_v : NaN;
      cramer_v[i * n_items + j] = v;
      cramer_v[j * n_items + i] = v;
      if (result.low_count_warning) {
        count_below_5.push({
          i, j,
          frac: result.cells_below_5 / (K_per_item[i] * K_per_item[j]),
        });
      }
      if (full_details) pair_details.set(`${i}:${j}`, result);
    }
  }

  return {
    n_items, ids, K_per_item,
    cramer_v, pair_details,
    warnings: { count_below_5 },
    items,
  };
}
