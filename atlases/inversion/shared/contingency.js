// shared/contingency.js
// =====================================================================
// Pure-compute primitives for K×K contingency tables and the metrics
// the atlas computes on top of them.
//
// Extracted from legacy Inversion_atlas.html (turn 165 close binary).
// All functions are pure: no `state`, no DOM, no globals.
//
// Source line refs in the legacy file (for traceability):
//   _buildContingency         line 12250
//   _detectFuseEvents         line 12274
//   _computeARI               line 12320
//   _computeNMI               line 12353
//   _scaleStabilityVerdict    line 12408
//   _cramersV                 line 36046
//   _chiSqSurvival            line 38443
//   _lnGamma                  line 38482
// =====================================================================

/**
 * Build a K_a × K_b contingency table from two label arrays of equal
 * length. Returns null on bad inputs.
 *
 * @param {number[]|Int8Array} labelsA  Label array for partition A
 * @param {number[]|Int8Array} labelsB  Label array for partition B (same length)
 * @param {number} KA                   Cardinality of A's labels (0..KA-1 valid)
 * @param {number} KB                   Cardinality of B's labels
 * @returns {{ M: number[][], KA: number, KB: number, n: number } | null}
 */
export function buildContingency(labelsA, labelsB, KA, KB) {
  if (!isArrayLike(labelsA) || !isArrayLike(labelsB)) return null;
  if (labelsA.length !== labelsB.length) return null;
  if (!(KA > 0) || !(KB > 0)) return null;
  const M = Array.from({ length: KA }, () => new Array(KB).fill(0));
  let n = 0;
  for (let i = 0; i < labelsA.length; i++) {
    const a = labelsA[i], b = labelsB[i];
    if (a < 0 || a >= KA || b < 0 || b >= KB) continue;
    M[a][b]++; n++;
  }
  return { M, KA, KB, n };
}

/**
 * Fuse-event detection: for each coarse cluster c, find all fine
 * clusters f where ≥thresh fraction of f's samples land in c. If two
 * or more such fine clusters exist for one coarse cluster, that's a
 * fuse event.
 *
 * Convention: rows of `ct.M` = fine clusters; cols = coarse clusters.
 *
 * @param {{ M: number[][], KA: number, KB: number }} ct
 * @param {{ thresh?: number }} [opts]
 * @returns {{ fine_clusters: number[], coarse_cluster: number }[]}
 */
export function detectFuseEvents(ct, opts) {
  if (!ct || !ct.M) return [];
  const t = (opts && opts.thresh != null) ? +opts.thresh : 0.80;
  const { M, KA, KB } = ct;
  const rowSum = new Array(KA).fill(0);
  for (let a = 0; a < KA; a++) for (let b = 0; b < KB; b++) rowSum[a] += M[a][b];
  const fuses = [];
  for (let b = 0; b < KB; b++) {
    const fineList = [];
    for (let a = 0; a < KA; a++) {
      if (rowSum[a] === 0) continue;
      if (M[a][b] / rowSum[a] >= t) fineList.push(a);
    }
    if (fineList.length >= 2) fuses.push({ fine_clusters: fineList, coarse_cluster: b });
  }
  return fuses;
}

/**
 * Symmetric counterpart to detectFuseEvents: a 1→many SPLIT event,
 * where one fine cluster `a` distributes its samples across ≥2
 * coarse clusters, each receiving ≥ thresh fraction of f's samples.
 *
 * Returns array of { fine_cluster: int, coarse_clusters: int[] }.
 * Empty array on null/invalid ct.
 *
 * Default thresh = 0.20 (a coarse cluster receiving ≥20% of a fine
 * cluster's samples is a "destination" for the split). Tune via
 * `opts.thresh`.
 *
 * Legacy origin: _detectSplitEvents at line 12299 of legacy/
 * Inversion_atlas.html.
 *
 * @param {{M:number[][], KA:number, KB:number}} ct
 * @param {{thresh?:number}} [opts]
 * @returns {Array<{fine_cluster:number, coarse_clusters:number[]}>}
 */
export function detectSplitEvents(ct, opts) {
  if (!ct || !ct.M) return [];
  const t = (opts && opts.thresh != null) ? +opts.thresh : 0.20;
  const { M, KA, KB } = ct;
  const splits = [];
  for (let a = 0; a < KA; a++) {
    let rowS = 0;
    for (let b = 0; b < KB; b++) rowS += M[a][b];
    if (rowS === 0) continue;
    const coarseList = [];
    for (let b = 0; b < KB; b++) if (M[a][b] / rowS >= t) coarseList.push(b);
    if (coarseList.length >= 2) splits.push({ fine_cluster: a, coarse_clusters: coarseList });
  }
  return splits;
}

/**
 * Adjusted Rand Index between two label arrays. Returns NaN on bad
 * input, 1 on identical partitions.
 *
 * @param {number[]|Int8Array} labelsA
 * @param {number[]|Int8Array} labelsB
 * @returns {number}
 */
export function computeARI(labelsA, labelsB) {
  if (!isArrayLike(labelsA) || labelsA.length !== labelsB.length) return NaN;
  const n = labelsA.length;
  if (n < 2) return NaN;
  const cellByKey = new Map();
  const rowByA = new Map();
  const colByB = new Map();
  for (let i = 0; i < n; i++) {
    const a = labelsA[i], b = labelsB[i];
    const key = a + '|' + b;
    cellByKey.set(key, (cellByKey.get(key) || 0) + 1);
    rowByA.set(a, (rowByA.get(a) || 0) + 1);
    colByB.set(b, (colByB.get(b) || 0) + 1);
  }
  const C2 = (k) => k * (k - 1) / 2;
  let sumCellPairs = 0;
  for (const v of cellByKey.values()) sumCellPairs += C2(v);
  let sumRowPairs = 0;
  for (const v of rowByA.values()) sumRowPairs += C2(v);
  let sumColPairs = 0;
  for (const v of colByB.values()) sumColPairs += C2(v);
  const totalPairs = C2(n);
  if (totalPairs === 0) return NaN;
  const expected = (sumRowPairs * sumColPairs) / totalPairs;
  const max = (sumRowPairs + sumColPairs) / 2;
  if (max === expected) return 1;
  return (sumCellPairs - expected) / (max - expected);
}

/**
 * Normalized Mutual Information (symmetric, log base e). Range [0, 1].
 *
 * @param {number[]|Int8Array} labelsA
 * @param {number[]|Int8Array} labelsB
 * @returns {number}
 */
export function computeNMI(labelsA, labelsB) {
  if (!isArrayLike(labelsA) || labelsA.length !== labelsB.length) return NaN;
  const n = labelsA.length;
  if (n < 2) return NaN;
  const cellByKey = new Map();
  const rowByA = new Map();
  const colByB = new Map();
  for (let i = 0; i < n; i++) {
    const a = labelsA[i], b = labelsB[i];
    cellByKey.set(a + '|' + b, (cellByKey.get(a + '|' + b) || 0) + 1);
    rowByA.set(a, (rowByA.get(a) || 0) + 1);
    colByB.set(b, (colByB.get(b) || 0) + 1);
  }
  let HA = 0, HB = 0, I = 0;
  for (const ca of rowByA.values()) {
    const p = ca / n;
    if (p > 0) HA -= p * Math.log(p);
  }
  for (const cb of colByB.values()) {
    const p = cb / n;
    if (p > 0) HB -= p * Math.log(p);
  }
  for (const [key, cab] of cellByKey) {
    const [aStr, bStr] = key.split('|');
    const ca = rowByA.get(+aStr) || rowByA.get(aStr);
    const cb = colByB.get(+bStr) || colByB.get(bStr);
    const pab = cab / n;
    const pa  = ca / n;
    const pb  = cb / n;
    if (pab > 0 && pa > 0 && pb > 0) I += pab * Math.log(pab / (pa * pb));
  }
  if (HA + HB === 0) return 1;
  return (2 * I) / (HA + HB);
}

/**
 * Cramér's V for a flat row-major K_a × K_c contingency table. Returns
 * a value in [0, 1] (0 = independent, 1 = perfect association).
 *
 * Note: this primitive uses a flat array rather than a {M, KA, KB}
 * object — it's the form the legacy code used at line 36046, kept as
 * the canonical input contract.
 *
 * @param {number[]|Int32Array|Float32Array} table  Length K_a*K_c, row-major
 * @param {number} K_a
 * @param {number} K_c
 * @returns {number}
 */
export function cramersV(table, K_a, K_c) {
  let n = 0;
  const rowSums = new Array(K_a).fill(0);
  const colSums = new Array(K_c).fill(0);
  for (let i = 0; i < K_a; i++) {
    for (let j = 0; j < K_c; j++) {
      const v = table[i * K_c + j];
      n += v; rowSums[i] += v; colSums[j] += v;
    }
  }
  if (n < 2) return NaN;
  let nzR = 0, nzC = 0;
  for (let i = 0; i < K_a; i++) if (rowSums[i] > 0) nzR++;
  for (let j = 0; j < K_c; j++) if (colSums[j] > 0) nzC++;
  if (nzR < 2 || nzC < 2) return 0;
  let chi2 = 0;
  for (let i = 0; i < K_a; i++) {
    for (let j = 0; j < K_c; j++) {
      const exp = (rowSums[i] * colSums[j]) / n;
      if (exp > 0) {
        const o = table[i * K_c + j];
        const d = o - exp;
        chi2 += d * d / exp;
      }
    }
  }
  const minDim = Math.min(nzR, nzC) - 1;
  if (minDim < 1) return 0;
  const v = Math.sqrt(chi2 / (n * minDim));
  return Math.max(0, Math.min(1, v));
}

/**
 * Chi-squared survival function (1 - CDF). Numerically stable for
 * df up to ~200. Used in conjunction with cramersV() chi2 outputs.
 *
 * @param {number} chi2
 * @param {number} df
 * @returns {number}
 */
export function chiSqSurvival(chi2, df) {
  if (!isFinite(chi2) || !isFinite(df)) return NaN;
  if (chi2 <= 0) return 1;
  if (df <= 0) return NaN;
  const s = df / 2, x = chi2 / 2;
  if (x < s + 1) {
    let term = 1 / s, sum = term;
    for (let k = 1; k < 200; k++) {
      term *= x / (s + k);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
    }
    const lnGammaS = lnGamma(s);
    const P = sum * Math.exp(-x + s * Math.log(x) - lnGammaS);
    return Math.max(0, Math.min(1, 1 - P));
  } else {
    const TINY = 1e-300;
    let b = x + 1 - s, c = 1 / TINY, d = 1 / b, h = d;
    for (let k = 1; k < 200; k++) {
      const an = -k * (k - s);
      b += 2;
      d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-12) break;
    }
    const lnGammaS = lnGamma(s);
    const Q = Math.exp(-x + s * Math.log(x) - lnGammaS) * h;
    return Math.max(0, Math.min(1, Q));
  }
}

/**
 * Stirling-based log Gamma (Lanczos approximation, ~10 digits for x≥0.5).
 *
 * @param {number} x
 * @returns {number}
 */
export function lnGamma(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
               -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Scale-stability verdict cascade for a 3-pane local-PCA window.
 *
 * Verdicts (legacy thresholds, all configurable via opts):
 *   STABLE_3BAND       all 3 panes K=3, no fuses, no splits, ARI≥0.85 pairwise
 *   STABLE_6BAND       all 3 panes K=6, no fuses, no splits, ARI≥0.85 pairwise
 *   NESTED_3IN6        K=6 fine, K=3 coarse, exactly 3 fuses, 0 splits, no
 *                      crossing fuses (each fine cluster maps to ONE coarse)
 *   OVERLAP_BREAKS_3   K=3 fine AND K=3 coarse, K=6 medium, fuses+splits at
 *                      the medium boundary (ribbons reshuffle middle, restore
 *                      at edges). Heuristic: pane1↔pane3 ARI≥0.7 (edges agree)
 *                      AND pane2 introduces fuses+splits relative to both
 *                      neighbors.
 *   UNSTABLE           otherwise (low ARI somewhere, or noisy / random)
 *
 * @param {Array} panes      [{K, ok, ...}, {K, ok, ...}, {K, ok, ...}]
 * @param {Array} pairwise   [{contingency, fuseEvents, splitEvents, ari, nmi}, …]
 * @param {{ari_stable?: number, ari_edge?: number}} [opts]
 * @returns {string}
 */
// scaleStabilityVerdict canonical implementation now lives in
// shared/scale_stability.js (matches legacy line 12408 exactly). The
// re-export below preserves contingency.js's export surface so
// existing imports keep working.
export { scaleStabilityVerdict } from './scale_stability.js';

// =====================================================================
// Table-based primitives (input: K×K contingency table)
// =====================================================================
// The functions below take a K×K array of arrays (table[r][c] = count)
// rather than two label arrays. They mirror the legacy entry points that
// the L3 panel computes directly off a precomputed contingency.
//
// Source line refs in the legacy file:
//   restrictedConcord     line 30915
//   logFact, logChoose    lines 30950, 30957
//   fisher2x2             line 30958
//   chiSquare             line 30978
//   normalCDF             line 30998
//   _miFromTable          line 31026
//   _entropyMarginal      line 31048
//   nmiFromTable          line 31061
//   amiFromTable          line 31089
//   ariFromTable          line 31148
// =====================================================================

/**
 * Restricted concord between two clusterings over a kept subset of rows.
 *
 * Given a comparison object `cmp` carrying a K×K contingency table, and
 * a `keep` array of row indices to include, compute the fraction of
 * kept-sample pairs whose left-label and right-label agree (diagonal /
 * total). Returns null on bad inputs.
 *
 * @param {{table: number[][]}} cmp
 * @param {number[]} keep
 * @param {number} [mergeThr=0.85]
 * @returns {{concord: number, n: number, n_kept_samples: number, kept_set: number[], verdict: string} | null}
 */
export function restrictedConcord(cmp, keep, mergeThr) {
  if (!cmp || !cmp.table || !Array.isArray(keep) || keep.length === 0) return null;
  const T = cmp.table;
  const K = T.length;
  if (K === 0) return null;
  const keepSet = new Set();
  for (const r of keep) {
    const ri = +r | 0;
    if (ri >= 0 && ri < K) keepSet.add(ri);
  }
  if (keepSet.size === 0) return null;
  let kept = 0, diag = 0;
  for (const r of keepSet) {
    if (!T[r]) continue;
    for (let c = 0; c < K; c++) {
      const v = T[r][c] | 0;
      kept += v;
      if (r === c) diag += v;
    }
  }
  if (kept === 0) {
    return { concord: 0, n: 0, n_kept_samples: 0, kept_set: Array.from(keepSet),
             verdict: 'LOW_POWER' };
  }
  const concord = diag / kept;
  const thr = (typeof mergeThr === 'number') ? mergeThr : 0.85;
  const verdict = (concord >= thr) ? 'MERGE' : 'SEPARATE';
  return { concord, n: kept, n_kept_samples: kept, kept_set: Array.from(keepSet), verdict };
}

/**
 * Log-factorial with internal cache. Pure helper for fisher2x2/AMI.
 */
export function logFact(n) {
  if (logFact._cache === undefined) logFact._cache = [0, 0];
  const c = logFact._cache;
  while (c.length <= n) c.push(c[c.length - 1] + Math.log(c.length));
  return c[n];
}

export function logChoose(n, k) {
  return logFact(n) - logFact(k) - logFact(n - k);
}

/**
 * Two-tailed Fisher's exact test for a 2×2 table.
 *
 * @param {number[][]} table  Shape [[a, b], [c, d]]
 * @returns {number}          Two-tailed p-value clamped to [0, 1]
 */
export function fisher2x2(table) {
  const a = table[0][0], b = table[0][1], cv = table[1][0], dv = table[1][1];
  const n = a + b + cv + dv;
  const r1 = a + b, r2 = cv + dv, c1 = a + cv;
  function lp(x) {
    return logChoose(r1, x) + logChoose(r2, c1 - x) - logChoose(n, c1);
  }
  const lpObs = lp(a);
  let p = 0;
  const lo = Math.max(0, c1 - r2), hi = Math.min(c1, r1);
  for (let x = lo; x <= hi; x++) {
    const lpx = lp(x);
    if (lpx <= lpObs + 1e-12) p += Math.exp(lpx);
  }
  return Math.min(1, p);
}

/**
 * Chi-square statistic for a K×K contingency table.
 * p_approx uses a Wilson–Hilferty approximation (no gamma lib needed).
 *
 * @param {number[][]} table
 * @param {number} K
 * @returns {{chi2: number, df: number, p_approx: number, n: number}}
 */
export function chiSquare(table, K) {
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += table[r][c];
  const rowSum = new Array(K).fill(0), colSum = new Array(K).fill(0);
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    rowSum[r] += table[r][c]; colSum[c] += table[r][c];
  }
  let chi2 = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    const E = (rowSum[r] * colSum[c]) / (n || 1);
    if (E > 0) chi2 += (table[r][c] - E) ** 2 / E;
  }
  const df = (K - 1) * (K - 1);
  const z = ((chi2 / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  const p_approx = 1 - normalCDF(z);
  return { chi2, df, p_approx, n };
}

/**
 * Standard-normal CDF via the Abramowitz & Stegun 7.1.26 approximation.
 */
export function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

// Mutual information from contingency table (raw, in nats). Internal
// helper shared by nmiFromTable / amiFromTable.
function _miFromTable(table, K) {
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += table[r][c];
  if (n <= 0) return 0;
  const rowSum = new Array(K).fill(0), colSum = new Array(K).fill(0);
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    rowSum[r] += table[r][c]; colSum[c] += table[r][c];
  }
  let mi = 0;
  for (let r = 0; r < K; r++) {
    for (let c = 0; c < K; c++) {
      const nij = table[r][c];
      if (nij > 0 && rowSum[r] > 0 && colSum[c] > 0) {
        mi += (nij / n) * Math.log((n * nij) / (rowSum[r] * colSum[c]));
      }
    }
  }
  return mi;
}

function _entropyMarginal(sums, n) {
  if (n <= 0) return 0;
  let h = 0;
  for (let i = 0; i < sums.length; i++) {
    const p = sums[i] / n;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

/**
 * Normalized Mutual Information (Strehl–Ghosh, geometric-mean variant).
 * Range [0, 1].
 *
 * @param {number[][]} table
 * @param {number} K
 * @returns {number}
 */
export function nmiFromTable(table, K) {
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += table[r][c];
  if (n <= 0) return 0;
  const rowSum = new Array(K).fill(0), colSum = new Array(K).fill(0);
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    rowSum[r] += table[r][c]; colSum[c] += table[r][c];
  }
  const mi = _miFromTable(table, K);
  const hX = _entropyMarginal(rowSum, n);
  const hY = _entropyMarginal(colSum, n);
  const denom = Math.sqrt(hX * hY);
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, mi / denom));
}

/**
 * Adjusted Mutual Information (Vinh, Epps & Bailey 2010).
 * Uses exact hypergeometric expectation — O(K²·N) per call. Adequate
 * for K≤6 and N a few hundred.
 *
 * @param {number[][]} table
 * @param {number} K
 * @returns {number}  approximately [0, 1]
 */
export function amiFromTable(table, K) {
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += table[r][c];
  if (n <= 0) return 0;
  const rowSum = new Array(K).fill(0), colSum = new Array(K).fill(0);
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    rowSum[r] += table[r][c]; colSum[c] += table[r][c];
  }
  const mi = _miFromTable(table, K);
  const hX = _entropyMarginal(rowSum, n);
  const hY = _entropyMarginal(colSum, n);

  const lgamma_cache = new Float64Array(n + 2);
  for (let v = 2; v <= n + 1; v++) {
    lgamma_cache[v] = lgamma_cache[v - 1] + Math.log(v - 1);
  }
  const lfact = (v) => (v <= 1) ? 0 : lgamma_cache[v];

  let emi = 0;
  for (let r = 0; r < K; r++) {
    const a = rowSum[r];
    if (a === 0) continue;
    for (let c = 0; c < K; c++) {
      const b = colSum[c];
      if (b === 0) continue;
      const nij_min = Math.max(1, a + b - n);
      const nij_max = Math.min(a, b);
      for (let nij = nij_min; nij <= nij_max; nij++) {
        const logP = lfact(a) - lfact(nij) - lfact(a - nij)
                   + lfact(n - a) - lfact(b - nij) - lfact(n - a - b + nij)
                   - lfact(n) + lfact(b) + lfact(n - b);
        const P = Math.exp(logP);
        const term = (nij / n) * Math.log((n * nij) / (a * b));
        emi += term * P;
      }
    }
  }

  const denom = Math.max(hX, hY) - emi;
  if (Math.abs(denom) < 1e-12) return 0;
  return Math.max(-1, Math.min(1, (mi - emi) / denom));
}

/**
 * Adjusted Rand Index from a K×K contingency table (Hubert & Arabie 1985).
 * Range [-1, 1] (0 = chance, 1 = perfect agreement).
 *
 * @param {number[][]} table
 * @param {number} K
 * @returns {number}
 */
export function ariFromTable(table, K) {
  let n = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) n += table[r][c];
  if (n <= 1) return 0;
  const rowSum = new Array(K).fill(0), colSum = new Array(K).fill(0);
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    rowSum[r] += table[r][c]; colSum[c] += table[r][c];
  }
  let sumC2cells = 0;
  for (let r = 0; r < K; r++) for (let c = 0; c < K; c++) {
    const v = table[r][c];
    if (v >= 2) sumC2cells += (v * (v - 1)) / 2;
  }
  let sumC2rows = 0, sumC2cols = 0;
  for (let i = 0; i < K; i++) {
    if (rowSum[i] >= 2) sumC2rows += (rowSum[i] * (rowSum[i] - 1)) / 2;
    if (colSum[i] >= 2) sumC2cols += (colSum[i] * (colSum[i] - 1)) / 2;
  }
  const totalC2 = (n * (n - 1)) / 2;
  if (totalC2 <= 0) return 0;
  const expectedIdx = (sumC2rows * sumC2cols) / totalC2;
  const maxIdx = (sumC2rows + sumC2cols) / 2;
  const denom = maxIdx - expectedIdx;
  if (Math.abs(denom) < 1e-12) {
    return (sumC2cells === maxIdx) ? 1 : 0;
  }
  return Math.max(-1, Math.min(1, (sumC2cells - expectedIdx) / denom));
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------
function isArrayLike(x) {
  return Array.isArray(x) || (x && typeof x.length === 'number' && typeof x !== 'string');
}

// ---------------------------------------------------------------------
// Console-debug exposures (optional; preserves legacy `window._buildContingency`
// debugging convenience)
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._buildContingency      = buildContingency;
  window._detectFuseEvents      = detectFuseEvents;
  window._detectSplitEvents     = detectSplitEvents;
  window._computeARI            = computeARI;
  window._computeNMI            = computeNMI;
  window._cramersV              = cramersV;
  window._chiSqSurvival         = chiSqSurvival;
  window._lnGamma               = lnGamma;
  window._scaleStabilityVerdict = scaleStabilityVerdict;
  window._restrictedConcord     = restrictedConcord;
  window._chiSquare             = chiSquare;
  window._normalCDF             = normalCDF;
  window._nmiFromTable          = nmiFromTable;
  window._amiFromTable          = amiFromTable;
  window._ariFromTable          = ariFromTable;
  window._fisher2x2             = fisher2x2;
}
