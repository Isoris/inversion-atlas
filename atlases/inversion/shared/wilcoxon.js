// shared/wilcoxon.js
//
// Wilcoxon rank-sum (Mann-Whitney U) two-sided p-value with continuity
// correction and tie-corrected variance.
//
// Pure function, no state access. Imports normalCDF from
// shared/contingency.js (the central home for distribution-tail
// approximations).
//
// Validation: §13 of test_turn143_breeding_card_compute.js (legacy)
// compares hand-computed values against documented R behaviour at
// n=5+5, 10+10, and tied scenarios. For the manuscript-relevant
// n=60+60 case (REF vs INV carrier counts) the normal approximation
// is well within its validity range.
//
// Legacy origin: lines 21647-21748 of legacy/Inversion_atlas.html
// (_wilcoxonRankSumP). Also previously duplicated in
// pages/catalogue/page3/_breeding_export.js — this hoist eliminates
// that copy AND fixes a latent bug: the page3 copy guarded normalCDF
// with `typeof normalCDF === 'function'` but never imported it, so in
// the cartridge it always fell through to NaN. With this module,
// normalCDF is resolved at module load time.

import { normalCDF } from './contingency.js';

/**
 * Two-sided Wilcoxon rank-sum (Mann-Whitney U) test.
 *
 * Filters non-finite values from each input array, pools, sorts,
 * assigns average ranks for ties, computes U and its tie-corrected
 * variance, then converts to a two-sided p-value via the normal
 * approximation with continuity correction.
 *
 * Returns:
 *   {
 *     n_a, n_b,                                  // finite-value counts
 *     R_a,                                       // sum of ranks in group a
 *     U_a,                                       // Mann-Whitney U statistic
 *     mu, sigma2, sigma,                         // null-distribution moments
 *     n_tie_groups, tie_correction_factor,       // tie diagnostics
 *     z, p_two_sided,                            // continuity-corrected
 *     direction: 'a_higher' | 'a_lower' | 'equal',
 *   }
 *
 * Returns null when either input is not an array or has zero finite
 * values. p_two_sided is NaN for the all-tied degenerate case (sigma=0)
 * and 1.0 when |U − μ| ≤ 0.5 (continuity correction lands on zero).
 *
 * @param {Array<number>} a
 * @param {Array<number>} b
 * @returns {Object|null}
 */
export function wilcoxonRankSumP(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;

  // Pool finite values, tagging by group
  const pooled = [];
  for (const v of a) {
    if (typeof v === 'number' && Number.isFinite(v)) pooled.push({ v, g: 0 });
  }
  const n_a = pooled.length;
  for (const v of b) {
    if (typeof v === 'number' && Number.isFinite(v)) pooled.push({ v, g: 1 });
  }
  const n_b = pooled.length - n_a;
  if (n_a < 1 || n_b < 1) return null;
  const N = n_a + n_b;

  // Sort by value, then assign ranks with average-rank tie handling
  pooled.sort((x, y) => x.v - y.v);
  const ranks = new Array(N);
  const tieSizes = [];
  let i = 0;
  while (i < N) {
    let j = i;
    while (j < N && pooled[j].v === pooled[i].v) j++;
    const runLen = j - i;
    // Ranks are 1-based. The run pooled[i..j-1] gets the average of
    // ranks (i+1) through j inclusive, which is (i+1 + j) / 2.
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    if (runLen > 1) tieSizes.push(runLen);
    i = j;
  }

  // Sum of ranks in group a
  let R_a = 0;
  for (let k = 0; k < N; k++) {
    if (pooled[k].g === 0) R_a += ranks[k];
  }

  const U_a = R_a - n_a * (n_a + 1) / 2;
  const mu = (n_a * n_b) / 2;

  // Variance with tie correction. The standard (no-tie) formula is
  // n_a · n_b · (N + 1) / 12. The tie-corrected form replaces (N+1)
  // with (N+1) − Σ(t³−t) / (N(N−1)).
  let tieSumCubed = 0;
  for (const t of tieSizes) tieSumCubed += (t * t * t - t);
  const tie_correction_factor = (N > 1) ? tieSumCubed / (N * (N - 1)) : 0;
  let sigma2;
  if (N > 1) {
    sigma2 = (n_a * n_b / 12) * ((N + 1) - tie_correction_factor);
  } else {
    sigma2 = 0;
  }
  if (sigma2 < 0) sigma2 = 0;   // numerical guard (full-tie case)
  const sigma = Math.sqrt(sigma2);

  // Continuity-corrected two-sided z
  const diff = U_a - mu;
  const absDiff = Math.abs(diff);
  let z, p_two_sided;
  if (sigma === 0) {
    z = NaN;
    p_two_sided = NaN;
  } else if (absDiff <= 0.5) {
    // Continuity correction lands on 0 — null result
    z = 0;
    p_two_sided = 1;
  } else {
    z = (absDiff - 0.5) / sigma;
    p_two_sided = 2 * (1 - normalCDF(z));
    // Clamp into [0, 1] — normalCDF approximation can return slightly
    // outside this range for very large |z|.
    if (p_two_sided < 0) p_two_sided = 0;
    if (p_two_sided > 1) p_two_sided = 1;
  }

  // Direction tag (by rank sum)
  let direction;
  if (U_a > mu) direction = 'a_higher';
  else if (U_a < mu) direction = 'a_lower';
  else direction = 'equal';

  return {
    n_a, n_b,
    R_a, U_a, mu, sigma2, sigma,
    n_tie_groups: tieSizes.length,
    tie_correction_factor,
    z, p_two_sided, direction,
  };
}
