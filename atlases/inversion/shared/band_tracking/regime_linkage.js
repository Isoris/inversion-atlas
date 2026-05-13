// shared/band_tracking/regime_linkage.js
// =====================================================================
// LAYER 4c — cross-regime linkage detection (the missing Layer-4
// piece the user flagged: "these samples behave like this in many
// chromosomes so probably that they are linked, in terms of Mendelian").
//
// Two complementary tests:
//
//   COHORT-LEVEL LD: across all samples, do regime X's karyotype
//   calls correlate with regime Y's calls? Built on a 3 × 3
//   karyotype contingency table (AA/AB/BB at X × AA/AB/BB at Y);
//   χ² of independence + Cramér's V as effect size.
//
//   FAMILY-LEVEL RECOMBINATION: in families with doubly-heterozygous
//   parents at two regimes, offspring should be ~25 % double-het if
//   regimes segregate independently; skewed toward parental
//   haplotype combinations if regimes are linked. Estimates the
//   per-family recombination rate r̂ via the existing
//   shared/mendelian_segregation.js#estimateRecombinationRate
//   (testcross design fits this exactly).
//
// Three-way distinction:
//   - Linkage by physical proximity      (same chromosome arm)
//   - Linkage by shared ancestry         (related samples share both)
//   - Functional / selection-driven LD   (rare; needs explicit test)
//
// This module surfaces the LD signal; downstream consumers
// (Layer-4b pedigree + Layer-5 cross-chrom CHAINED edges) explain
// whether it's ancestry-driven or physical.
//
// Pure JS — no DOM, no fetch.

import { chiSquare, cramersV, chiSqSurvival } from '../contingency.js';
import { percentile } from '../stats_helpers.js';
import {
  estimateRecombinationRate,
} from '../mendelian_segregation.js';
import { regimeKaryotypeForSample } from './regime_mendelian.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

export const REGIME_LINKAGE_VERDICTS = Object.freeze({
  LINKED:            'linked',
  WEAKLY_LINKED:     'weakly_linked',
  INDEPENDENT:       'independent',
  INSUFFICIENT_DATA: 'insufficient_data',
});

export const REGIME_LINKAGE_DEFAULTS = Object.freeze({
  // Cramér's V thresholds for LINKED / WEAKLY_LINKED.
  linked_above:         0.50,
  weakly_linked_above:  0.20,
  // Minimum samples called at BOTH regimes for the LD test to fire.
  min_samples_called:   20,
  // Significance level for the χ² of independence.
  alpha:                0.05,
});

// =====================================================================
// 1. buildSampleRegimeMatrix
// =====================================================================

/**
 * Build the per-sample × per-regime karyotype matrix. Encoded:
 *   0  = AA (HOM_A homozygote)
 *   1  = AB (HET)
 *   2  = BB (HOM_B homozygote)
 *   -1 = uncalled
 *
 * Layout: row = sample, col = regime. Flat Int8Array length
 * n_samples * n_regimes.
 *
 * @param {Array<Object>} regimes
 * @param {Array<number>} sample_list  per-sample external indices
 * @returns {{matrix:Int8Array, n_samples:number, n_regimes:number,
 *           regime_uids:Array<string>}}
 */
export function buildSampleRegimeMatrix(regimes, sample_list) {
  const nR = Array.isArray(regimes) ? regimes.length : 0;
  const nS = Array.isArray(sample_list) ? sample_list.length : 0;
  const matrix = new Int8Array(nS * nR);
  const regime_uids = [];
  for (let j = 0; j < nR; j++) {
    const r = regimes[j];
    regime_uids.push(r && r.regime_uid ? r.regime_uid : String(j));
  }
  for (let i = 0; i < nS; i++) {
    const si = sample_list[i];
    for (let j = 0; j < nR; j++) {
      const r = regimes[j];
      const k = regimeKaryotypeForSample(r, si);
      let code = -1;
      if (k === 'AA') code = 0;
      else if (k === 'AB') code = 1;
      else if (k === 'BB') code = 2;
      matrix[i * nR + j] = code;
    }
  }
  return { matrix, n_samples: nS, n_regimes: nR, regime_uids };
}

// =====================================================================
// 2. pairwiseRegimeContingency
// =====================================================================

/**
 * 3×3 karyotype contingency table for one pair of regimes.
 * Indexed by [karyotypeA][karyotypeB] where karyotype ∈ {0=AA, 1=AB,
 * 2=BB}. Samples uncalled at EITHER regime are skipped.
 *
 * Returns:
 *   {
 *     table:     int[3][3]
 *     n_called:  number,
 *     n_skipped: number
 *   }
 *
 * @param {Int8Array} matrix
 * @param {number} n_samples
 * @param {number} n_regimes
 * @param {number} a_idx  column index of regime A
 * @param {number} b_idx  column index of regime B
 * @returns {Object}
 */
export function pairwiseRegimeContingency(matrix, n_samples, n_regimes, a_idx, b_idx) {
  const table = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let n_called = 0, n_skipped = 0;
  for (let i = 0; i < n_samples; i++) {
    const ka = matrix[i * n_regimes + a_idx];
    const kb = matrix[i * n_regimes + b_idx];
    if (ka < 0 || kb < 0) { n_skipped++; continue; }
    table[ka][kb]++;
    n_called++;
  }
  return { table, n_called, n_skipped };
}

// =====================================================================
// 3. regimeLD — full LD test for one regime pair
// =====================================================================

/**
 * Run the LD test for one pair of regimes.
 *
 * Returns:
 *   {
 *     contingency:  3×3 table,
 *     n_called, n_skipped,
 *     chi2, df, p_value,
 *     cramers_v,    [0, 1] effect size
 *     verdict:      LINKED | WEAKLY_LINKED | INDEPENDENT |
 *                   INSUFFICIENT_DATA
 *   }
 *
 * @param {Int8Array} matrix
 * @param {number} n_samples
 * @param {number} n_regimes
 * @param {number} a_idx
 * @param {number} b_idx
 * @param {Object} [opts]
 * @returns {Object}
 */
export function regimeLD(matrix, n_samples, n_regimes, a_idx, b_idx, opts) {
  const o = opts || {};
  const minCalled = Number.isFinite(o.min_samples_called)
    ? o.min_samples_called : REGIME_LINKAGE_DEFAULTS.min_samples_called;
  const linked = Number.isFinite(o.linked_above)
    ? o.linked_above : REGIME_LINKAGE_DEFAULTS.linked_above;
  const weak   = Number.isFinite(o.weakly_linked_above)
    ? o.weakly_linked_above : REGIME_LINKAGE_DEFAULTS.weakly_linked_above;
  const alpha  = Number.isFinite(o.alpha)
    ? o.alpha : REGIME_LINKAGE_DEFAULTS.alpha;

  const c = pairwiseRegimeContingency(matrix, n_samples, n_regimes, a_idx, b_idx);
  if (c.n_called < minCalled) {
    return {
      contingency: c.table, n_called: c.n_called, n_skipped: c.n_skipped,
      chi2: NaN, df: 4, p_value: NaN, cramers_v: NaN,
      verdict: REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA,
    };
  }
  const cs = chiSquare(c.table, 3);
  const p_value = chiSqSurvival(cs.chi2, cs.df);
  // cramersV takes a flat row-major table; flatten the 3×3.
  const flat = new Int32Array(9);
  for (let r = 0; r < 3; r++) {
    for (let cc = 0; cc < 3; cc++) flat[r * 3 + cc] = c.table[r][cc];
  }
  const v = cramersV(flat, 3, 3);
  let verdict;
  if (!Number.isFinite(p_value) || p_value >= alpha) {
    verdict = REGIME_LINKAGE_VERDICTS.INDEPENDENT;
  } else if (v >= linked) {
    verdict = REGIME_LINKAGE_VERDICTS.LINKED;
  } else if (v >= weak) {
    verdict = REGIME_LINKAGE_VERDICTS.WEAKLY_LINKED;
  } else {
    verdict = REGIME_LINKAGE_VERDICTS.INDEPENDENT;
  }
  return {
    contingency: c.table,
    n_called: c.n_called, n_skipped: c.n_skipped,
    chi2: cs.chi2, df: cs.df, p_value, cramers_v: v,
    verdict,
  };
}

// =====================================================================
// 4. regimeLinkageMatrix — all-pairs LD
// =====================================================================

/**
 * All-pairs LD scan across the regimes. Returns a Cramér's V
 * matrix + a sorted edge list of LINKED / WEAKLY_LINKED pairs.
 *
 * O(n_regimes² × n_samples).
 *
 * @param {Array<Object>} regimes
 * @param {Array<number>} sample_list
 * @param {Object} [opts]
 * @returns {Object}
 */
export function regimeLinkageMatrix(regimes, sample_list, opts) {
  let o = opts || {};
  let calibration = null;
  // Auto-calibration short-circuit: derive linked_above /
  // weakly_linked_above from the cross-chromosome V distribution
  // BEFORE running the full all-pairs scan.
  if (o.auto_calibrate) {
    const cal = calibrateLinkageThresholdsFromCrossChrom(
      regimes, sample_list, o);
    if (cal.ok) {
      o = Object.assign({}, o, {
        linked_above: cal.linked_above,
        weakly_linked_above: cal.weakly_linked_above,
      });
      calibration = cal;
    } else {
      calibration = cal;   // record the failure reason for the caller
    }
  }
  const m = buildSampleRegimeMatrix(regimes, sample_list);
  const N = m.n_regimes;
  const cramers_v_matrix = new Float32Array(N * N);
  const p_value_matrix = new Float32Array(N * N);
  const edges = [];
  for (let i = 0; i < N; i++) {
    cramers_v_matrix[i * N + i] = 1;
    p_value_matrix[i * N + i] = 0;
    for (let j = i + 1; j < N; j++) {
      const r = regimeLD(m.matrix, m.n_samples, N, i, j, opts);
      cramers_v_matrix[i * N + j] = r.cramers_v;
      cramers_v_matrix[j * N + i] = r.cramers_v;
      p_value_matrix[i * N + j] = r.p_value;
      p_value_matrix[j * N + i] = r.p_value;
      if (r.verdict === REGIME_LINKAGE_VERDICTS.LINKED
          || r.verdict === REGIME_LINKAGE_VERDICTS.WEAKLY_LINKED) {
        edges.push({
          i, j,
          regime_uid_a: m.regime_uids[i],
          regime_uid_b: m.regime_uids[j],
          cramers_v: r.cramers_v,
          chi2: r.chi2, df: r.df, p_value: r.p_value,
          n_called: r.n_called,
          verdict: r.verdict,
        });
      }
    }
  }
  edges.sort((a, b) => (b.cramers_v || 0) - (a.cramers_v || 0));
  return {
    n_regimes: N,
    cramers_v_matrix,
    p_value_matrix,
    edges,
    regime_uids: m.regime_uids,
    calibration,           // null when auto_calibrate not requested
  };
}

// =====================================================================
// 5. familyRegimeRecombination — Mendelian-aware test
// =====================================================================

/**
 * Family-aware recombination test for one regime pair. Considers
 * each family with BOTH parents heterozygous at both regimes (the
 * informative cross — AB at A × AB at B → offspring can be one of
 * 4 gametic combinations; recombinant fraction depends on linkage).
 *
 * For testcross-style informativity, treat the family as:
 *   parental-type combination = the combination dominant in the
 *                                family's offspring (whichever it
 *                                turns out to be)
 *   recombinant-type combination = the OTHER non-parental combos
 *
 * Returns per-family records:
 *   {
 *     family_id,
 *     parent1_kar_a, parent1_kar_b, parent2_kar_a, parent2_kar_b,
 *     informative:  bool   (both parents AB at both regimes)
 *     n_offspring:  int    in this family
 *     counts:       {AA_AA, AA_AB, AA_BB, AB_AA, ..., BB_BB}
 *     parental_count, recombinant_count,
 *     r_hat:        recombination rate via estimateRecombinationRate
 *     se, ci_low, ci_high,
 *     verdict:      LINKED (r<0.2) | WEAKLY_LINKED (r<0.4) |
 *                   INDEPENDENT (r∈[0.4, 0.5])
 *   }
 *
 * Plus a cohort-level pooled rate across all informative families.
 *
 * @param {Object} regimeA
 * @param {Object} regimeB
 * @param {Array<Object>} families   [{family_id, parents, offspring}]
 * @param {Object} [opts]
 * @returns {Object}
 */
export function familyRegimeRecombination(regimeA, regimeB, families, opts) {
  const o = opts || {};
  const per_family = [];
  let totalParental = 0, totalRecombinant = 0, nInformative = 0;
  for (const fam of families || []) {
    if (!fam || !Array.isArray(fam.parents) || fam.parents.length < 2
        || !Array.isArray(fam.offspring) || fam.offspring.length === 0) {
      continue;
    }
    const p1A = regimeKaryotypeForSample(regimeA, fam.parents[0]);
    const p1B = regimeKaryotypeForSample(regimeB, fam.parents[0]);
    const p2A = regimeKaryotypeForSample(regimeA, fam.parents[1]);
    const p2B = regimeKaryotypeForSample(regimeB, fam.parents[1]);
    const informative = p1A === 'AB' && p1B === 'AB'
                         && p2A === 'AB' && p2B === 'AB';
    // 9 offspring genotype cells
    const counts = {
      AA_AA: 0, AA_AB: 0, AA_BB: 0,
      AB_AA: 0, AB_AB: 0, AB_BB: 0,
      BB_AA: 0, BB_AB: 0, BB_BB: 0,
    };
    let nCalled = 0;
    for (const offIdx of fam.offspring) {
      const oA = regimeKaryotypeForSample(regimeA, offIdx);
      const oB = regimeKaryotypeForSample(regimeB, offIdx);
      if (!oA || !oB) continue;
      const key = oA + '_' + oB;
      counts[key]++;
      nCalled++;
    }
    let parental_count = null, recombinant_count = null;
    let r_hat = null, se = null, ci_low = null, ci_high = null;
    let verdict = REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA;
    if (informative && nCalled >= 8) {
      // For AB×AB × AB×AB, expected proportions under independence:
      //   AA_AA = 1/16, AA_AB = 2/16, AA_BB = 1/16,
      //   AB_AA = 2/16, AB_AB = 4/16, AB_BB = 2/16,
      //   BB_AA = 1/16, BB_AB = 2/16, BB_BB = 1/16
      // Under tight linkage (r=0), most offspring are AA_AA or BB_BB
      // (parental haplotypes preserved). Recombinants enrich the
      // off-diagonal cells (AA_BB, BB_AA).
      //
      // Rough method-of-moments r̂: pool the four "homozygote-at-both"
      // corners.
      //   p_double_homo_parental    = (AA_AA + BB_BB) / n
      //   p_double_homo_recombinant = (AA_BB + BB_AA) / n
      // Under independence at r=0.5, both fractions = 2/16 = 0.125
      // (so their ratio = 1). Under r=0, parental >> recombinant.
      // We use estimateRecombinationRate(testcross) on
      // [parental, recombinant] = [AA_AA+BB_BB, AA_BB+BB_AA].
      const pHom = counts.AA_AA + counts.BB_BB;
      const rHom = counts.AA_BB + counts.BB_AA;
      const est = estimateRecombinationRate(
        { parental: pHom, recombinant: rHom }, 'testcross', o);
      if (est && est.ok) {
        parental_count = pHom;
        recombinant_count = rHom;
        r_hat = est.r_hat;
        se = est.se;
        ci_low = est.ci_low;
        ci_high = est.ci_high;
        if (r_hat < 0.20)      verdict = REGIME_LINKAGE_VERDICTS.LINKED;
        else if (r_hat < 0.40) verdict = REGIME_LINKAGE_VERDICTS.WEAKLY_LINKED;
        else                   verdict = REGIME_LINKAGE_VERDICTS.INDEPENDENT;
        totalParental += pHom;
        totalRecombinant += rHom;
        nInformative++;
      }
    }
    per_family.push({
      family_id: fam.family_id,
      parent1_kar_a: p1A, parent1_kar_b: p1B,
      parent2_kar_a: p2A, parent2_kar_b: p2B,
      informative,
      n_offspring: nCalled,
      counts,
      parental_count, recombinant_count,
      r_hat, se, ci_low, ci_high,
      verdict,
    });
  }
  // Cohort-level pooled estimate
  let pooled = null;
  if (totalParental + totalRecombinant > 0) {
    pooled = estimateRecombinationRate(
      { parental: totalParental, recombinant: totalRecombinant },
      'testcross', o);
  }
  let cohortVerdict = REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA;
  if (pooled && pooled.ok) {
    if      (pooled.r_hat < 0.20) cohortVerdict = REGIME_LINKAGE_VERDICTS.LINKED;
    else if (pooled.r_hat < 0.40) cohortVerdict = REGIME_LINKAGE_VERDICTS.WEAKLY_LINKED;
    else                          cohortVerdict = REGIME_LINKAGE_VERDICTS.INDEPENDENT;
  }
  return {
    per_family,
    n_informative_families: nInformative,
    pooled_parental: totalParental,
    pooled_recombinant: totalRecombinant,
    pooled_r_hat: pooled && pooled.ok ? pooled.r_hat : null,
    pooled_se:    pooled && pooled.ok ? pooled.se    : null,
    pooled_verdict: cohortVerdict,
  };
}

// =====================================================================
// 6. Auto-calibration of LD thresholds from cross-chromosome pairs
// =====================================================================

/**
 * Calibrate the `linked_above` + `weakly_linked_above` thresholds
 * from the EMPIRICAL Cramér's V distribution of cross-chromosome
 * regime pairs.
 *
 * Why this matters: two regimes on DIFFERENT chromosomes are
 * physically unlinked, so any positive Cramér's V they show
 * reflects cohort-level confounding (relatedness, population
 * structure, ancestry stratification). That distribution is the
 * empirical "no-physical-linkage" null. Same-chromosome pairs
 * should have higher V if physical linkage exists; the calibrated
 * thresholds say "above THIS V, the signal is stronger than the
 * cross-chrom baseline."
 *
 *   linked_above        = 99th percentile of cross-chrom V
 *   weakly_linked_above = 95th percentile of cross-chrom V
 *
 * Requires regimes to carry a `chrom` field (e.g. from
 * mergePerChromosomeRegimes — Layer 5). Falls back to defaults
 * when fewer than `min_cross_chrom_pairs` qualifying pairs.
 *
 * @param {Array<Object>} regimes        with `chrom` field per regime
 * @param {Array<number>} sample_list
 * @param {Object} [opts]
 * @returns {Object}
 */
export function calibrateLinkageThresholdsFromCrossChrom(regimes, sample_list, opts) {
  const o = opts || {};
  const minPairs = Number.isFinite(o.min_cross_chrom_pairs)
    ? o.min_cross_chrom_pairs : 10;
  const minSamples = Number.isFinite(o.min_samples_called)
    ? o.min_samples_called : REGIME_LINKAGE_DEFAULTS.min_samples_called;
  if (!Array.isArray(regimes) || !Array.isArray(sample_list)) {
    return { ok: false, reason: 'invalid_input' };
  }
  // Build the per-sample matrix once.
  const m = buildSampleRegimeMatrix(regimes, sample_list);
  const N = m.n_regimes;
  const cross_v = [];
  for (let i = 0; i < N; i++) {
    const chromI = regimes[i] && regimes[i].chrom;
    if (chromI == null) continue;
    for (let j = i + 1; j < N; j++) {
      const chromJ = regimes[j] && regimes[j].chrom;
      if (chromJ == null) continue;
      if (chromI === chromJ) continue;     // skip intra-chrom
      const r = regimeLD(m.matrix, m.n_samples, N, i, j,
        Object.assign({}, o, { linked_above: 1.1, weakly_linked_above: 1.1 }));
      if (r.n_called < minSamples) continue;
      if (Number.isFinite(r.cramers_v)) cross_v.push(r.cramers_v);
    }
  }
  if (cross_v.length < minPairs) {
    return {
      ok: false, reason: 'insufficient_cross_chrom_pairs',
      n_pairs_evaluated: cross_v.length, required: minPairs,
    };
  }
  const v95 = percentile(cross_v, 0.95);
  const v99 = percentile(cross_v, 0.99);
  return {
    ok: true,
    n_cross_chrom_pairs_used: cross_v.length,
    linked_above:        v99,
    weakly_linked_above: v95,
    median_cross_chrom_v: percentile(cross_v, 0.5),
  };
}
