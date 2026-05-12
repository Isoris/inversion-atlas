// shared/lasso_linkage.js
//
// Lasso-inheritance / fish-set linkage diagnostic. For each user-
// selected fish-set (typically state.bandTraceFishSet), compute how
// "purely" the selected fish cluster into a single locked-label band
// for every confirmed candidate. The output is a table the user can
// scan to spot "these fish are linked across candidates X, Y, Z."
//
// Manuscript framing: observation, not interpretation. The table
// reports purity numbers; we do NOT label candidates as "linked" or
// "unlinked" in the UI — we sort by purity descending and let the
// eye do the work.
//
// Three entry points:
//
//   computeLassoLinkage(fishSet, candidateList, opts?)
//     Pure compute (legacy comment: "Headless-pure: takes both inputs
//     explicitly so tests don't need state.")
//
//   lassoLinkageCacheKey(chromFilter, fishSet, candidateList)
//     Pure FNV-style fingerprint. Cache invalidates on chrom switch,
//     candidate list mutation, or fish-set change.
//
//   lassoLinkageGetOrCompute(state, opts?)
//     State-aware wrapper. Reads state.bandTraceFishSet +
//     state.candidateList; reuses state.lassoLinkageCache when the
//     key matches.
//
// Legacy origin: lines 40587-40759 of legacy/Inversion_atlas.html.

// =====================================================================
// Constants
// =====================================================================

/** Default purity threshold for is_strong_link. */
export const LASSO_LINKAGE_DEFAULT_PURITY_THRESHOLD = 0.7;

/** Default minimum band size for is_strong_link. */
export const LASSO_LINKAGE_DEFAULT_MIN_BAND_SIZE = 5;

// =====================================================================
// Pure compute
// =====================================================================

/**
 * Compute per-candidate purity for a fish-set lasso. For each
 * confirmed candidate, count how many fish-set members fall into
 * each of its K locked-label bands; the band with the most members
 * is the "best" band, and purity = best_count / total_assignable.
 *
 *   fishSet:        Set<int> | int[] | array-like of sample indices
 *   candidateList:  the cohort candidate registry (state.candidateList)
 *   opts: {
 *     purity_threshold: 0.7         // is_strong_link gate
 *     min_band_size:    5           // is_strong_link gate
 *     chrom_filter:     null|string // restrict to one chrom
 *   }
 *
 * Returns:
 *   {
 *     n_fish_selected,
 *     n_candidates_seen,
 *     purity_threshold,
 *     min_band_size,
 *     per_candidate: { [cand_id]: { id, chrom, start_bp, end_bp, K,
 *                                   best_band, best_purity,
 *                                   n_in_best_band, n_lasso_seen,
 *                                   per_band: [{band, n_in_lasso,
 *                                               fraction}],
 *                                   is_strong_link: bool } },
 *     strong_links: [cand_id, ...]   // sorted purity desc, then
 *                                      n_in_best_band desc, then id asc
 *   }
 *   or null on invalid input / empty fish-set.
 *
 * Fish that are out of range or assigned to -1 (unassigned) in a
 * candidate's locked_labels are skipped — they don't contribute to
 * either numerator or denominator for that candidate.
 *
 * Candidates without confirmed=true OR without non-empty
 * locked_labels are skipped entirely.
 */
export function computeLassoLinkage(fishSet, candidateList, opts) {
  opts = opts || {};
  if (!fishSet) return null;
  if (!Array.isArray(candidateList)) return null;

  // Normalize fishSet to Set<int>
  let fishSetObj;
  if (fishSet instanceof Set) fishSetObj = fishSet;
  else if (Array.isArray(fishSet) || (fishSet && typeof fishSet.length === 'number')) {
    fishSetObj = new Set();
    for (let i = 0; i < fishSet.length; i++) fishSetObj.add(fishSet[i] | 0);
  } else {
    return null;
  }
  if (fishSetObj.size === 0) return null;

  const purityThreshold = (typeof opts.purity_threshold === 'number')
    ? opts.purity_threshold : LASSO_LINKAGE_DEFAULT_PURITY_THRESHOLD;
  const minBandSize = (typeof opts.min_band_size === 'number')
    ? opts.min_band_size : LASSO_LINKAGE_DEFAULT_MIN_BAND_SIZE;
  const chromFilter = (typeof opts.chrom_filter === 'string' && opts.chrom_filter.length > 0)
    ? opts.chrom_filter : null;

  const per_candidate = {};
  let n_seen = 0;

  for (let i = 0; i < candidateList.length; i++) {
    const c = candidateList[i];
    if (!c || !c.id) continue;
    if (!c.confirmed) continue;
    if (!c.locked_labels || !c.locked_labels.length) continue;
    if (chromFilter && c.chrom !== chromFilter) continue;
    n_seen++;
    const K = c.K || 3;
    const counts = new Int32Array(K);
    let total = 0;
    const labels = c.locked_labels;
    for (const si of fishSetObj) {
      if (si < 0 || si >= labels.length) continue;
      const lab = labels[si];
      if (lab < 0 || lab >= K) continue;
      counts[lab]++;
      total++;
    }
    let bestBand = -1, bestCount = -1;
    const per_band = [];
    for (let k = 0; k < K; k++) {
      if (counts[k] > bestCount) { bestCount = counts[k]; bestBand = k; }
      per_band.push({
        band: k,
        n_in_lasso: counts[k],
        fraction: total > 0 ? (counts[k] / total) : 0,
      });
    }
    const bestPurity = total > 0 ? (bestCount / total) : 0;
    const is_strong = (bestPurity >= purityThreshold) && (bestCount >= minBandSize);
    per_candidate[c.id] = {
      id: c.id,
      chrom: c.chrom || null,
      start_bp: (c.start_bp != null) ? (c.start_bp | 0) : null,
      end_bp:   (c.end_bp   != null) ? (c.end_bp   | 0) : null,
      K,
      best_band: bestBand,
      best_purity: bestPurity,
      n_in_best_band: bestCount,
      n_lasso_seen: total,
      per_band,
      is_strong_link: is_strong,
    };
  }

  // Sort strong links: by purity desc, then by n_in_best_band desc,
  // then by id asc (deterministic on ties).
  const strong_links = Object.values(per_candidate)
    .filter(r => r.is_strong_link)
    .sort((a, b) => {
      if (b.best_purity !== a.best_purity) return b.best_purity - a.best_purity;
      if (b.n_in_best_band !== a.n_in_best_band) return b.n_in_best_band - a.n_in_best_band;
      return String(a.id).localeCompare(String(b.id));
    })
    .map(r => r.id);

  return {
    n_fish_selected: fishSetObj.size,
    n_candidates_seen: n_seen,
    purity_threshold: purityThreshold,
    min_band_size: minBandSize,
    per_candidate,
    strong_links,
  };
}

// =====================================================================
// Cache key
// =====================================================================

/**
 * Fingerprint the (chromFilter, fishSet, candidateList) triple for
 * cache invalidation. Order-insensitive in the fish-set (sorted
 * before hashing); sensitive to candidate list size + the IDs +
 * K + locked_labels.length of confirmed candidates.
 *
 * Returns null on invalid input.
 */
export function lassoLinkageCacheKey(chromFilter, fishSet, candidateList) {
  if (!fishSet || !Array.isArray(candidateList)) return null;
  const sorted = (fishSet instanceof Set ? Array.from(fishSet) : fishSet.slice())
    .map(x => x | 0).sort((a, b) => a - b);
  let hF = 0x811c9dc5 | 0;
  for (let i = 0; i < sorted.length; i++) hF = (hF * 31 + (sorted[i] + 2)) | 0;
  const fpFish = (hF >>> 0).toString(16);
  let hC = 0x811c9dc5 | 0;
  let nConf = 0;
  for (const c of candidateList) {
    if (!c || !c.id || !c.confirmed || !c.locked_labels || !c.locked_labels.length) continue;
    nConf++;
    const idStr = String(c.id);
    for (let j = 0; j < idStr.length; j++) hC = (hC * 31 + idStr.charCodeAt(j)) | 0;
    hC = (hC * 31 + (c.K | 0) + 2) | 0;
    hC = (hC * 31 + (c.locked_labels.length | 0) + 2) | 0;
  }
  const fpCand = (hC >>> 0).toString(16);
  return (chromFilter || '*') + '|f' + sorted.length + ':' + fpFish + '|c' + nConf + ':' + fpCand;
}

// =====================================================================
// State-aware wrapper
// =====================================================================

/**
 * Read state.bandTraceFishSet + state.candidateList, return the
 * cached result when its key matches, otherwise compute fresh and
 * stash on state.lassoLinkageCache / .lassoLinkageCacheKey.
 *
 * Returns null when no fish-set is selected or no candidates loaded.
 *
 * @param {Object} state
 * @param {{purity_threshold?:number, min_band_size?:number, chrom_filter?:string}} [opts]
 */
export function lassoLinkageGetOrCompute(state, opts) {
  if (!state) return null;
  const fishSet = state.bandTraceFishSet;
  if (!fishSet || !fishSet.length) return null;
  const cl = state.candidateList || [];
  if (cl.length === 0) return null;
  opts = opts || {};
  const chromFilter = opts.chrom_filter || null;
  const key = lassoLinkageCacheKey(chromFilter, fishSet, cl);
  if (state.lassoLinkageCacheKey === key && state.lassoLinkageCache) {
    return state.lassoLinkageCache;
  }
  const result = computeLassoLinkage(fishSet, cl, {
    purity_threshold: opts.purity_threshold,
    min_band_size: opts.min_band_size,
    chrom_filter: chromFilter,
  });
  state.lassoLinkageCache = result;
  state.lassoLinkageCacheKey = key;
  return result;
}
