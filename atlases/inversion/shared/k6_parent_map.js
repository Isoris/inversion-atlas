// shared/k6_parent_map.js
//
// K=6 → K=3 nesting map for the dual-pass K-bands pipeline
// (legacy lines 30465-30555: _computeK6ParentMap). Given the two
// `_computeKBands` pass results at K=3 and K=6, build the K6 → K3
// parent map by max-overlap. Each K6 group's parent is the K3 group
// it overlaps the most; purity = overlap_count / group_size.
//
// Returns the verdict NESTED (all groups pure) / CROSS_CUTTING
// (none pure) / MIXED (some pure) / NO_DATA, plus the per-K6
// purity vector and a subband-label helper:
//
//   subband_label(k6) → 'g{parentIndex}{ordinalLetter}'
//
// where the ordinal letter ('a', 'b', …) ranks K6 children within
// each parent by their K6 rank (which is itself the PC1 rank
// implicit in `_computeKBands`).
//
// Pure: no DOM, no state. Inputs `k3Pass` / `k6Pass` are pass
// objects with `.K, .n_samples, .n_intervals, .votes` (votes[si][p]).
// Headless-tolerant.

/** Default purity threshold (legacy default 0.80). */
export const K6_PURITY_DEFAULT = 0.80;

/** Verdicts emitted by computeK6ParentMap. */
export const K6_VERDICTS = Object.freeze({
  NESTED:        'NESTED',
  MIXED:         'MIXED',
  CROSS_CUTTING: 'CROSS_CUTTING',
  NO_DATA:       'NO_DATA',
});

/**
 * Compute the K6 → K3 parent map.
 *
 * `k3Pass` and `k6Pass` each carry:
 *   - K               number of clusters (3 vs 6)
 *   - n_samples       number of samples (must match across passes)
 *   - n_intervals     number of L2 intervals
 *   - votes           votes[si][p] = cluster label (0..K-1) or -1 (NA)
 *
 * @param {Object} k3Pass
 * @param {Object} k6Pass
 * @param {number} [purity_threshold=K6_PURITY_DEFAULT]
 * @returns {Object}
 */
export function computeK6ParentMap(k3Pass, k6Pass, purity_threshold) {
  if (!k3Pass || !k6Pass) {
    return {
      verdict: K6_VERDICTS.NO_DATA,
      reason: 'missing_pass',
    };
  }
  const K3 = k3Pass.K, K6 = k6Pass.K;
  const n_samples = k3Pass.n_samples;
  const n_intervals = k3Pass.n_intervals;
  const thr = (purity_threshold == null) ? K6_PURITY_DEFAULT : +purity_threshold;
  if (!(K3 > 0) || !(K6 > 0) || !(n_samples > 0) || !(n_intervals > 0)
      || !Array.isArray(k3Pass.votes) || !Array.isArray(k6Pass.votes)) {
    return {
      verdict: K6_VERDICTS.NO_DATA,
      reason: 'invalid_pass_shape',
    };
  }
  // Build overlap table: rows = K6 groups, cols = K3 groups
  const overlap = new Int32Array(K6 * K3);
  for (let si = 0; si < n_samples; si++) {
    const v3 = k3Pass.votes[si];
    const v6 = k6Pass.votes[si];
    if (!v3 || !v6) continue;
    for (let p = 0; p < n_intervals; p++) {
      const lk3 = v3[p], lk6 = v6[p];
      if (lk3 < 0 || lk3 >= K3 || lk6 < 0 || lk6 >= K6) continue;
      overlap[lk6 * K3 + lk3]++;
    }
  }
  const parent_of_k6 = new Int8Array(K6);
  const purity = new Float64Array(K6);
  let n_pure = 0, n_with_data = 0;
  for (let r = 0; r < K6; r++) {
    let total = 0, maxc = 0, parent = -1;
    for (let c = 0; c < K3; c++) {
      const v = overlap[r * K3 + c];
      total += v;
      if (v > maxc) { maxc = v; parent = c; }
    }
    parent_of_k6[r] = parent;
    purity[r] = total > 0 ? maxc / total : 0;
    if (total > 0) {
      n_with_data++;
      if (purity[r] >= thr) n_pure++;
    }
  }
  let verdict;
  if (n_with_data === 0)                   verdict = K6_VERDICTS.NO_DATA;
  else if (n_pure === n_with_data)         verdict = K6_VERDICTS.NESTED;
  else if (n_pure === 0)                   verdict = K6_VERDICTS.CROSS_CUTTING;
  else                                     verdict = K6_VERDICTS.MIXED;
  // Per-parent ordinal letters. childrenOfParent[c] is already in
  // K6-rank order because we iterate r ascending; r already encodes
  // PC1 rank from _computeKBands' ranked-label convention.
  const childrenOfParent = Array.from({ length: K3 }, () => []);
  for (let r = 0; r < K6; r++) {
    if (parent_of_k6[r] >= 0) childrenOfParent[parent_of_k6[r]].push(r);
  }
  const subband_letter = new Array(K6).fill('?');
  for (let c = 0; c < K3; c++) {
    const kids = childrenOfParent[c];
    for (let i = 0; i < kids.length; i++) {
      subband_letter[kids[i]] = String.fromCharCode(97 + i);
    }
  }
  function subband_label(k6) {
    if (k6 < 0 || k6 >= K6) return null;
    const parent = parent_of_k6[k6];
    if (parent < 0) return null;
    return 'g' + parent + subband_letter[k6];
  }
  return {
    K3, K6,
    parent_of_k6,
    purity,
    overlap_table: overlap,
    n_pure, n_with_data,
    verdict,
    purity_threshold: thr,
    subband_letter,
    subband_label,
  };
}
