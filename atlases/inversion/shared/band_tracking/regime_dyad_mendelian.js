// shared/band_tracking/regime_dyad_mendelian.js
// =====================================================================
// LAYER 4d — DYAD-aware Mendelian annotation + meiotic-drive
// classification.
//
// Per the user's framing:
//
//   "we can also annotate regime with dyads (duos) because
//   sometimes we don't have trio … we want to know if the
//   inversion is like in 30 families behaving mendelian like dad
//   INV/INV mom non-INV/non-INV then kid is 100% INV/non-INV …
//   so basically you can annotate from trio but also from
//   duo(dyads) and so on. not be 'so strict' and also allow
//   meiotic drive like yeah sometimes its not 50/50 its a bit
//   different"
//
// What this module adds:
//
//   1. DYAD CONSISTENCY
//      A parent-offspring pair (just one parent + the child) is
//      still informative. Given the known parent's karyotype, the
//      child's karyotype is either "possible" (the parent could
//      have transmitted an allele consistent with the observed
//      child) or "impossible" (a contradiction). At population
//      level we can also score by marginal PMF using the cohort
//      allele frequency.
//
//   2. POOLED-DYAD POPULATION TEST
//      Across many dyads where parents are AB (heterozygous), the
//      offspring should be ~50 % A-bearing + 50 % B-bearing if
//      transmission is Mendelian. Pool across all such dyads in
//      the regime and run a binomial test on the transmission
//      ratio.
//
//   3. MEIOTIC-DRIVE CLASSIFICATION
//      Instead of the binary mendelian / non-mendelian flag of
//      Method A, classify the distortion type:
//        MENDELIAN           50/50 within tolerance
//        MILD_DRIVE          transmission ratio 55–65 % toward one allele
//        STRONG_DRIVE        transmission ratio ≥ 65 %
//        INVIABILITY         one class essentially absent (≥ 90 % skew)
//        INSUFFICIENT_DATA   fewer than min_dyads informative pairs
//
// Trios remain fully supported via Layer 4a — this is the dyad
// complement, not a replacement.
//
// Pure JS — no DOM, no fetch.

import { chiSqSurvival } from '../contingency.js';
import { percentile } from '../stats_helpers.js';
import { regimeKaryotypeForSample } from './regime_mendelian.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Meiotic-drive classification verdicts. */
export const MEIOTIC_DRIVE_VERDICTS = Object.freeze({
  MENDELIAN:         'mendelian',
  MILD_DRIVE:        'mild_drive',
  STRONG_DRIVE:      'strong_drive',
  INVIABILITY:       'inviability',
  INSUFFICIENT_DATA: 'insufficient_data',
});

/** Tolerance bands for the verdict (fraction of A-bearing offspring
 *  from AB parents — symmetric around 0.5). */
export const MEIOTIC_DRIVE_DEFAULTS = Object.freeze({
  mendelian_band:   [0.45, 0.55],   // within → MENDELIAN
  mild_drive_band:  [0.35, 0.65],   // outside mendelian, within mild → MILD_DRIVE
  strong_drive_band:[0.10, 0.90],   // outside mild, within strong → STRONG_DRIVE
                                     // beyond strong (≥ 90 % skew) → INVIABILITY
  min_dyads:        10,             // min informative dyads
  alpha:            0.05,
});

// =====================================================================
// 1. Allele-frequency estimation per regime
// =====================================================================

/**
 * Estimate the population allele frequency `p_A` from a regime's
 * sample-core sets. Counts use 2 alleles per homozygote and 1
 * per heterozygote.
 *
 *   p_A = (2 * n_AA + n_AB) / (2 * n_total)
 *
 * Returns NaN if no called samples.
 *
 * @param {Object} regime
 * @returns {{p_A:number, p_B:number, n_total:number, n_AA:number,
 *           n_AB:number, n_BB:number}}
 */
export function estimateAlleleFrequency(regime) {
  if (!regime) return { p_A: NaN, p_B: NaN, n_total: 0,
                         n_AA: 0, n_AB: 0, n_BB: 0 };
  const nAA = regime.hom_a_intersect ? regime.hom_a_intersect.size : 0;
  const nBB = regime.hom_b_intersect ? regime.hom_b_intersect.size : 0;
  const nAB = regime.het_union       ? regime.het_union.size       : 0;
  const nTotal = nAA + nAB + nBB;
  if (nTotal === 0) {
    return { p_A: NaN, p_B: NaN, n_total: 0, n_AA: 0, n_AB: 0, n_BB: 0 };
  }
  const p_A = (2 * nAA + nAB) / (2 * nTotal);
  return { p_A, p_B: 1 - p_A, n_total: nTotal,
            n_AA: nAA, n_AB: nAB, n_BB: nBB };
}

// =====================================================================
// 2. Single-parent offspring PMF
// =====================================================================

/**
 * Expected offspring karyotype PMF given the known parent's
 * karyotype AND the population allele frequency for the unknown
 * mate. Used by dyad consistency scoring.
 *
 *   parent AA:  P(AA) = p_A, P(AB) = p_B, P(BB) = 0
 *   parent AB:  P(AA) = 0.5*p_A, P(AB) = 0.5, P(BB) = 0.5*p_B
 *   parent BB:  P(AA) = 0,        P(AB) = p_A, P(BB) = p_B
 *
 * @param {string} parent_kar  'AA' | 'AB' | 'BB'
 * @param {number} p_A         allele frequency of A in the population
 * @returns {{AA:number, AB:number, BB:number}|null}
 */
export function expectedDyadPMF(parent_kar, p_A) {
  if (!Number.isFinite(p_A) || p_A < 0 || p_A > 1) return null;
  const p_B = 1 - p_A;
  if (parent_kar === 'AA') return { AA: p_A, AB: p_B, BB: 0 };
  if (parent_kar === 'AB') return { AA: 0.5 * p_A, AB: 0.5, BB: 0.5 * p_B };
  if (parent_kar === 'BB') return { AA: 0, AB: p_A, BB: p_B };
  return null;
}

// =====================================================================
// 3. Per-dyad consistency
// =====================================================================

/**
 * Assess one parent-offspring dyad. Returns:
 *   {
 *     parent_kar, off_kar,
 *     expected_pmf:  {AA, AB, BB},
 *     is_impossible: bool  offspring sits where expected = 0
 *     log_likelihood:number log P(off | parent, p_A)
 *   }
 *
 * @param {string} parent_kar
 * @param {string} off_kar
 * @param {number} p_A
 * @returns {Object|null}
 */
export function assessDyadConsistency(parent_kar, off_kar, p_A) {
  const pmf = expectedDyadPMF(parent_kar, p_A);
  if (!pmf || !off_kar) return null;
  const p = pmf[off_kar];
  return {
    parent_kar, off_kar,
    expected_pmf: pmf,
    is_impossible: p === 0,
    log_likelihood: p > 0 ? Math.log(p) : -Infinity,
  };
}

// =====================================================================
// 4. Population-level transmission-ratio estimator
//    (AB-parent dyads, treats each as a "haploid transmission")
// =====================================================================

/**
 * From all dyads with an AB-heterozygous parent, count how many
 * offspring carry an A-bearing genotype (AA or AB) vs B-bearing
 * (AB or BB). Each AB-parent dyad contributes one transmission to
 * the count of each side based on which allele the parent
 * MUST HAVE transmitted given the offspring's genotype + the
 * other-mate allele assumption.
 *
 * Simplification: when the AB parent passes A → offspring is
 * AA (if mate gave A) OR AB (if mate gave B). When parent passes
 * B → offspring is AB or BB. So:
 *
 *   parent AB × offspring AA → parent transmitted A
 *   parent AB × offspring BB → parent transmitted B
 *   parent AB × offspring AB → AMBIGUOUS (parent could have
 *                              transmitted either; either way the
 *                              other-mate allele balanced it)
 *
 * Returns:
 *   {
 *     n_AB_parent_dyads:  total dyads with AB parent
 *     n_A_transmitted:    parent passed A (offspring AA)
 *     n_B_transmitted:    parent passed B (offspring BB)
 *     n_ambiguous:        offspring AB (could be either)
 *     transmission_ratio_A:  n_A_transmitted /
 *                            (n_A_transmitted + n_B_transmitted)
 *     binomial_p_value:    against null of 0.5/0.5
 *   }
 *
 * @param {Object} regime
 * @param {Array<{parent:number, offspring:number}>} dyads
 * @returns {Object}
 */
export function estimateTransmissionRatio(regime, dyads) {
  let n_AB = 0, n_A_t = 0, n_B_t = 0, n_amb = 0;
  for (const d of dyads || []) {
    if (!d) continue;
    const p_k = regimeKaryotypeForSample(regime, d.parent);
    const o_k = regimeKaryotypeForSample(regime, d.offspring);
    if (p_k !== 'AB' || !o_k) continue;
    n_AB++;
    if      (o_k === 'AA') n_A_t++;
    else if (o_k === 'BB') n_B_t++;
    else if (o_k === 'AB') n_amb++;
  }
  const informative = n_A_t + n_B_t;
  const ratio = informative > 0 ? n_A_t / informative : NaN;
  // Binomial 2-sided p-value against H0 = 0.5 using χ² (1 df) on
  // counts (good approximation for n ≥ 10; exact binomial requires
  // a lnGamma — chiSqSurvival is already imported).
  let p_value = NaN;
  if (informative > 0) {
    const expected = informative / 2;
    const chi2 = (n_A_t - expected) ** 2 / expected
                  + (n_B_t - expected) ** 2 / expected;
    p_value = chiSqSurvival(chi2, 1);
  }
  return {
    n_AB_parent_dyads: n_AB,
    n_A_transmitted: n_A_t,
    n_B_transmitted: n_B_t,
    n_ambiguous: n_amb,
    n_informative_transmissions: informative,
    transmission_ratio_A: ratio,
    binomial_p_value: p_value,
  };
}

// =====================================================================
// 5. Meiotic-drive classification
// =====================================================================

/**
 * Classify the population-level meiotic-drive verdict from the
 * transmission-ratio estimate. Symmetric around 0.5: an extreme
 * shift toward EITHER allele matters.
 *
 * @param {{transmission_ratio_A:number, n_informative_transmissions:number}} t
 * @param {Object} [opts]
 * @returns {{verdict:string, deviation_from_half:number,
 *           binomial_p_value:number, drive_direction:'A'|'B'|null}}
 */
export function classifyMeioticDrive(t, opts) {
  const o = opts || {};
  const minDyads = Number.isFinite(o.min_dyads)
    ? o.min_dyads : MEIOTIC_DRIVE_DEFAULTS.min_dyads;
  const mendBand   = o.mendelian_band   || MEIOTIC_DRIVE_DEFAULTS.mendelian_band;
  const mildBand   = o.mild_drive_band  || MEIOTIC_DRIVE_DEFAULTS.mild_drive_band;
  const strongBand = o.strong_drive_band|| MEIOTIC_DRIVE_DEFAULTS.strong_drive_band;
  if (!t || t.n_informative_transmissions < minDyads
      || !Number.isFinite(t.transmission_ratio_A)) {
    return {
      verdict: MEIOTIC_DRIVE_VERDICTS.INSUFFICIENT_DATA,
      deviation_from_half: NaN,
      binomial_p_value: NaN,
      drive_direction: null,
    };
  }
  const f = t.transmission_ratio_A;
  const dev = Math.abs(f - 0.5);
  let verdict;
  if (f >= mendBand[0] && f <= mendBand[1]) {
    verdict = MEIOTIC_DRIVE_VERDICTS.MENDELIAN;
  } else if (f >= mildBand[0] && f <= mildBand[1]) {
    verdict = MEIOTIC_DRIVE_VERDICTS.MILD_DRIVE;
  } else if (f >= strongBand[0] && f <= strongBand[1]) {
    verdict = MEIOTIC_DRIVE_VERDICTS.STRONG_DRIVE;
  } else {
    verdict = MEIOTIC_DRIVE_VERDICTS.INVIABILITY;
  }
  return {
    verdict,
    deviation_from_half: dev,
    binomial_p_value: t.binomial_p_value,
    drive_direction: f > 0.5 ? 'A' : (f < 0.5 ? 'B' : null),
  };
}

// =====================================================================
// 6. annotateRegimeWithDyads — orchestrator
// =====================================================================

/**
 * Run the full dyad-aware annotation for one regime. Combines
 * per-dyad consistency checks + population-level transmission-ratio
 * estimation + meiotic-drive classification.
 *
 * `dyads` is `[{parent, offspring, family_id?}, ...]` — same shape
 * as a trio minus the second parent. A list mixing dyads + trios
 * is acceptable; trios are auto-split into two dyads (father-child
 * and mother-child) when `opts.split_trios = true`.
 *
 * Returns:
 *   {
 *     method: '4d_dyad',
 *     allele_freq:     output of estimateAlleleFrequency
 *     n_dyads:         total dyads supplied
 *     n_informative:   dyads with both parent & offspring called
 *     n_impossible:    dyads where offspring sits in expected-zero state
 *     dyad_rows:       [{parent, offspring, parent_kar, off_kar,
 *                       is_impossible, log_likelihood}],
 *     transmission:    output of estimateTransmissionRatio
 *     meiotic_drive:   output of classifyMeioticDrive
 *   }
 *
 * @param {Object} regime
 * @param {Array<{parent:number, offspring:number}>} dyads
 * @param {Object} [opts]
 * @returns {Object}
 */
export function annotateRegimeWithDyads(regime, dyads, opts) {
  const o = opts || {};
  const af = estimateAlleleFrequency(regime);
  const dyad_rows = [];
  let n_informative = 0, n_impossible = 0;
  for (const d of dyads || []) {
    if (!d) continue;
    const p_k = regimeKaryotypeForSample(regime, d.parent);
    const o_k = regimeKaryotypeForSample(regime, d.offspring);
    if (!p_k || !o_k) {
      dyad_rows.push({
        parent: d.parent, offspring: d.offspring,
        parent_kar: p_k, off_kar: o_k,
        is_impossible: null, log_likelihood: NaN,
      });
      continue;
    }
    const r = assessDyadConsistency(p_k, o_k, af.p_A);
    n_informative++;
    if (r && r.is_impossible) n_impossible++;
    dyad_rows.push({
      parent: d.parent, offspring: d.offspring,
      parent_kar: p_k, off_kar: o_k,
      is_impossible: r ? r.is_impossible : null,
      log_likelihood: r ? r.log_likelihood : NaN,
      expected_pmf: r ? r.expected_pmf : null,
    });
  }
  const transmission = estimateTransmissionRatio(regime, dyads);
  const meiotic_drive = classifyMeioticDrive(transmission, o);
  return {
    method: '4d_dyad',
    allele_freq: af,
    n_dyads: Array.isArray(dyads) ? dyads.length : 0,
    n_informative, n_impossible,
    dyad_rows,
    transmission,
    meiotic_drive,
  };
}

// =====================================================================
// 7. Auto-calibration of meiotic-drive bands from regime data
// =====================================================================

/**
 * Calibrate the meiotic-drive band thresholds from the cohort's
 * empirical regime-ratio distribution. Assumes most regimes are
 * Mendelian noise — the central 95 % of the ratio distribution
 * defines `mendelian_band`; the central 99 % defines the outer edge
 * of `mild_drive_band`. Beyond the central 99 % → STRONG_DRIVE.
 * INVIABILITY band stays fixed at [0.10, 0.90] since "one karyotype
 * class essentially absent" is biology-deterministic, not noise.
 *
 * Why this matters: with a 5-fish-per-family cohort the per-regime
 * ratio has wide binomial noise (a single regime could land at 0.4
 * by pure chance). The HARDCODED defaults assume ~100 dyads — way
 * more than typical. Calibration on YOUR data makes the bands
 * appropriate for YOUR sample sizes.
 *
 * Inputs:
 *   - perRegimeAnnotations: array of `annotateRegimeWithDyads`
 *     outputs from many regimes (one per regime).
 *   - opts.min_regimes: minimum regimes with informative
 *     transmission for calibration to run (default 20).
 *
 * Returns:
 *   {
 *     ok:            boolean,
 *     n_regimes_used: int   (only those with
 *                            n_informative_transmissions ≥ min_dyads)
 *     mendelian_band:    [lo, hi]   (empirical 2.5%-97.5%)
 *     mild_drive_band:   [lo, hi]   (empirical 0.5%-99.5%)
 *     strong_drive_band: [0.10, 0.90]   (fixed)
 *     median_ratio:      number     (sanity check — should be ~0.5)
 *   }
 *
 * Returns `{ok: false, reason}` when there aren't enough regimes;
 * caller falls back to MEIOTIC_DRIVE_DEFAULTS.
 *
 * @param {Array<Object>} perRegimeAnnotations
 * @param {{min_regimes?:number, min_dyads_per_regime?:number}} [opts]
 * @returns {Object}
 */
export function calibrateMeioticDriveBands(perRegimeAnnotations, opts) {
  const o = opts || {};
  const minRegimes = Number.isFinite(o.min_regimes) ? o.min_regimes : 20;
  const minDyads = Number.isFinite(o.min_dyads_per_regime)
    ? o.min_dyads_per_regime : MEIOTIC_DRIVE_DEFAULTS.min_dyads;
  if (!Array.isArray(perRegimeAnnotations)) {
    return { ok: false, reason: 'invalid_input' };
  }
  const ratios = [];
  for (const ann of perRegimeAnnotations) {
    if (!ann || !ann.transmission) continue;
    const t = ann.transmission;
    if (!Number.isFinite(t.transmission_ratio_A)) continue;
    if (t.n_informative_transmissions < minDyads) continue;
    ratios.push(t.transmission_ratio_A);
  }
  if (ratios.length < minRegimes) {
    return {
      ok: false,
      reason: 'insufficient_regimes',
      n_regimes_with_data: ratios.length,
      required: minRegimes,
    };
  }
  const lo95 = percentile(ratios, 0.025);
  const hi95 = percentile(ratios, 0.975);
  const lo99 = percentile(ratios, 0.005);
  const hi99 = percentile(ratios, 0.995);
  const median = percentile(ratios, 0.5);
  return {
    ok: true,
    n_regimes_used: ratios.length,
    mendelian_band:    [lo95, hi95],
    mild_drive_band:   [lo99, hi99],
    strong_drive_band: [0.10, 0.90],
    median_ratio: median,
  };
}
