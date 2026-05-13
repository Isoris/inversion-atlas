// shared/band_tracking/regime_pedigree.js
// =====================================================================
// LAYER 4b — INVERSE-direction pedigree inference from cross-regime
// co-membership.
//
// Standard direction (regime_mendelian.js + analysis/mendelian.js):
//
//   ngsRelate / ngsPedigree  →  trios + families  →  Mendelian test
//                                                     per inversion
//
// Inverse direction (this module):
//
//   Cross-chromosome regime structure  →  pairwise co-membership
//                                          frequency  →  pedigree
//                                          relatedness inference
//
// Why this works: two samples that share haplotype identity across
// many independent regimes on different chromosomes are almost
// certainly related — full sibs share ~50 % of their genome, parents
// & offspring share exactly 50 %, second-degree relatives ~25 %, etc.
// Counting how often a sample-pair lands in the SAME karyotype class
// across many regimes is an IBD-block-style relatedness estimate
// tied directly to the inversion-regime stack we've already built.
//
// Useful as:
//   - A cross-check on ngsPedigree's pair calls
//   - A way to flag pedigree-ambiguous samples for ngsPedigree to
//     re-resolve with a different threshold
//   - A standalone relatedness estimate when ngsRelate / ngsPedigree
//     isn't available for the cohort
//
// Pure JS — no DOM, no fetch.

// =====================================================================
// Vocab + defaults
// =====================================================================

/**
 * Classification thresholds in `same_class_frac` (fraction of called
 * regimes where the pair sits in the same karyotype class).
 *
 * These are heuristic and need empirical calibration on each cohort
 * — they're exposed in opts so callers can override.
 */
export const REGIME_PEDIGREE_DEFAULTS = Object.freeze({
  // Identical / duplicate sample-pair (eg same individual sequenced
  // twice). Both samples should land in the same class at ≥ 95 %
  // of regimes.
  duplicate_above:           0.95,
  // First-degree relatives (parent–offspring or full sib): share
  // exactly 50 % of the genome → co-membership ≥ ~0.75 (depends on
  // arrangement frequencies; full sibs trend lower than P-O).
  first_degree_above:        0.70,
  // Second-degree (half-sibs, grandparent, avuncular).
  second_degree_above:       0.55,
  // Below `second_degree_above` → unrelated_or_distant.

  // Minimum number of CALLED regimes for a pair to be classified
  // (below this we emit 'insufficient_data').
  min_regimes_called:        5,
});

/** Pairwise classification verdicts. */
export const REGIME_PEDIGREE_VERDICTS = Object.freeze({
  DUPLICATE:            'duplicate_or_identical',
  FIRST_DEGREE:         'first_degree',
  SECOND_DEGREE:        'second_degree',
  UNRELATED:            'unrelated_or_distant',
  INSUFFICIENT_DATA:    'insufficient_data',
});

// =====================================================================
// 1. Pairwise co-membership scoring
// =====================================================================

/**
 * For one (sample_a, sample_b) pair, count across regimes how
 * often they land in the same karyotype class vs different vs
 * uncalled-in-at-least-one.
 *
 * Returns:
 *   {
 *     n_regimes:          int — total regimes scanned
 *     n_called:           int — regimes with both samples called
 *     n_same_class:       int — both AA, both AB, or both BB
 *     n_diff_class:       int — different called class
 *     same_class_frac:    float ∈ [0, 1] (NaN when n_called == 0)
 *     by_class:           {AA_AA, AB_AB, BB_BB, AA_AB, ...}
 *   }
 *
 * @param {number} sample_a
 * @param {number} sample_b
 * @param {Array<Object>} regimes  Layer-2 refined regimes
 * @returns {Object}
 */
export function regimePairCoMembership(sample_a, sample_b, regimes) {
  const by_class = Object.create(null);
  let n_called = 0, n_same_class = 0, n_diff_class = 0;
  const n_regimes = Array.isArray(regimes) ? regimes.length : 0;
  for (const r of regimes || []) {
    if (!r) continue;
    const homA = r.hom_a_intersect, homB = r.hom_b_intersect, het = r.het_union;
    const kA = (homA && homA.has(sample_a)) ? 'AA'
             : (homB && homB.has(sample_a)) ? 'BB'
             : (het  && het.has(sample_a))  ? 'AB' : null;
    const kB = (homA && homA.has(sample_b)) ? 'AA'
             : (homB && homB.has(sample_b)) ? 'BB'
             : (het  && het.has(sample_b))  ? 'AB' : null;
    if (kA == null || kB == null) continue;
    n_called++;
    const key = [kA, kB].sort().join('_');
    by_class[key] = (by_class[key] || 0) + 1;
    if (kA === kB) n_same_class++; else n_diff_class++;
  }
  return {
    n_regimes,
    n_called,
    n_same_class,
    n_diff_class,
    same_class_frac: n_called > 0 ? n_same_class / n_called : NaN,
    by_class,
  };
}

/**
 * Classify a co-membership score into a pedigree verdict.
 *
 * @param {{n_called:number, same_class_frac:number}} score
 * @param {Object} [opts]
 * @returns {string}  REGIME_PEDIGREE_VERDICTS value
 */
export function classifyRegimeRelatedness(score, opts) {
  const o = opts || {};
  const minCalled = Number.isFinite(o.min_regimes_called)
    ? o.min_regimes_called : REGIME_PEDIGREE_DEFAULTS.min_regimes_called;
  if (!score || score.n_called < minCalled) {
    return REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA;
  }
  const f = score.same_class_frac;
  if (!Number.isFinite(f)) return REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA;
  const dup = Number.isFinite(o.duplicate_above)
    ? o.duplicate_above : REGIME_PEDIGREE_DEFAULTS.duplicate_above;
  const fd  = Number.isFinite(o.first_degree_above)
    ? o.first_degree_above : REGIME_PEDIGREE_DEFAULTS.first_degree_above;
  const sd  = Number.isFinite(o.second_degree_above)
    ? o.second_degree_above : REGIME_PEDIGREE_DEFAULTS.second_degree_above;
  if (f >= dup) return REGIME_PEDIGREE_VERDICTS.DUPLICATE;
  if (f >= fd)  return REGIME_PEDIGREE_VERDICTS.FIRST_DEGREE;
  if (f >= sd)  return REGIME_PEDIGREE_VERDICTS.SECOND_DEGREE;
  return REGIME_PEDIGREE_VERDICTS.UNRELATED;
}

// =====================================================================
// 2. All-pairs scan
// =====================================================================

/**
 * Pairwise scan: for every (i, j) sample pair in `sample_list`,
 * compute co-membership + classification. Returns a flat sorted
 * pair list (highest same_class_frac first) plus per-pair details.
 *
 * Note: O(n_samples^2 × n_regimes). For a 226-sample cohort × ~50
 * regimes ≈ 1.3M ops — fast in JS.
 *
 * Returns:
 *   {
 *     n_samples,  n_regimes,
 *     pairs: [{sample_a, sample_b, n_called, n_same_class,
 *              same_class_frac, verdict, by_class}, ...],
 *   }
 *
 * @param {Array<number>} sample_list  array of sample indices
 * @param {Array<Object>} regimes
 * @param {Object} [opts]
 * @returns {Object}
 */
export function inferRelatednessFromRegimes(sample_list, regimes, opts) {
  const o = opts || {};
  const n = Array.isArray(sample_list) ? sample_list.length : 0;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sa = sample_list[i], sb = sample_list[j];
      const score = regimePairCoMembership(sa, sb, regimes);
      const verdict = classifyRegimeRelatedness(score, o);
      pairs.push(Object.assign({ sample_a: sa, sample_b: sb, verdict },
                                score));
    }
  }
  pairs.sort((a, b) => (b.same_class_frac || 0) - (a.same_class_frac || 0));
  return {
    n_samples: n,
    n_regimes: Array.isArray(regimes) ? regimes.length : 0,
    pairs,
  };
}

// =====================================================================
// 3. Cross-check against an externally provided pair list
// =====================================================================

/**
 * Cross-check inferred pairs against an externally provided pair
 * list (typically the ngsRelate / ngsPedigree first-degree call).
 *
 * `provided_pairs` shape:
 *   [{sample_a, sample_b, relationship_class:'1st_degree'|'2nd_degree'|...}, ...]
 *
 * For each provided pair, look up its inferred verdict. Returns
 * agreement counts + a diff list.
 *
 *   {
 *     n_provided,
 *     n_matching:    inferred verdict matches the provided class
 *     n_strong_disagreement:   provided=1st but inferred=UNRELATED
 *                              (or vice-versa) — flag for re-check
 *     n_soft_disagreement:     adjacent-class disagreement (1st ↔ 2nd)
 *     agreement_rate,
 *     disagreements: [{sample_a, sample_b, provided_class,
 *                      inferred_verdict, same_class_frac, n_called}],
 *   }
 *
 * @param {Object} inferred              output of inferRelatednessFromRegimes
 * @param {Array<Object>} provided_pairs
 * @returns {Object}
 */
export function crossCheckPedigreeWithRegimes(inferred, provided_pairs) {
  const pp = Array.isArray(provided_pairs) ? provided_pairs : [];
  const inferredMap = new Map();
  if (inferred && Array.isArray(inferred.pairs)) {
    for (const p of inferred.pairs) {
      inferredMap.set(_pairKey(p.sample_a, p.sample_b), p);
    }
  }
  let n_matching = 0, n_strong = 0, n_soft = 0;
  const disagreements = [];
  for (const provided of pp) {
    if (!provided) continue;
    const key = _pairKey(provided.sample_a, provided.sample_b);
    const inf = inferredMap.get(key);
    if (!inf) {
      n_soft++;
      disagreements.push({
        sample_a: provided.sample_a, sample_b: provided.sample_b,
        provided_class: provided.relationship_class,
        inferred_verdict: 'not_in_inferred',
        same_class_frac: NaN, n_called: 0,
      });
      continue;
    }
    const providedClass = provided.relationship_class || '';
    // Map provided → expected inferred verdict.
    let expectedInferred = null;
    if (providedClass === '1st_degree') expectedInferred = 'first_degree';
    else if (providedClass === '2nd_degree') expectedInferred = 'second_degree';
    else if (providedClass === '3rd_degree'
             || providedClass === 'unrelated') expectedInferred = 'unrelated_or_distant';

    if (expectedInferred && inf.verdict === expectedInferred) {
      n_matching++;
      continue;
    }
    // Soft = adjacent-class slip; strong = 1st vs UNRELATED (or vice versa).
    if ((providedClass === '1st_degree'
         && inf.verdict === 'unrelated_or_distant')
        || (inf.verdict === 'first_degree'
            && providedClass === 'unrelated')) {
      n_strong++;
    } else {
      n_soft++;
    }
    disagreements.push({
      sample_a: provided.sample_a, sample_b: provided.sample_b,
      provided_class: providedClass,
      inferred_verdict: inf.verdict,
      same_class_frac: inf.same_class_frac,
      n_called: inf.n_called,
    });
  }
  const n_provided = pp.length;
  return {
    n_provided,
    n_matching,
    n_strong_disagreement: n_strong,
    n_soft_disagreement: n_soft,
    agreement_rate: n_provided > 0 ? n_matching / n_provided : NaN,
    disagreements,
  };
}

function _pairKey(a, b) {
  return a <= b ? a + '|' + b : b + '|' + a;
}
