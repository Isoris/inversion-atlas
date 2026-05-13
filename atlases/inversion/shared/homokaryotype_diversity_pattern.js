// shared/homokaryotype_diversity_pattern.js
// =====================================================================
// Classify the JOINT pattern of (π_homA, π_homB, π_het, n_AA, n_AB,
// n_BB) into one of five biologically-distinct interpretations.
//
// This module captures the framework's correction to the naive
// reading of homokaryotype-mode π reductions: the strong clue for
// pseudo-overdominance / associative overdominance is NOT just
// "π_all drops by 40% in homokaryotypes". It's the COMBINATION of:
//
//   - asymmetric homokaryotype diversity (one arrangement much
//     more diverse than the other)
//   - heterozygote excess (n_AB above HWE expectation)
//   - depletion of one homozygous state
//
// The 5-pattern table comes from the framework note (paraphrase):
//
//   pattern                          | interpretation
//   ---------------------------------|------------------------------------
//   π_homA ≈ π_homB low              | two divergent low-diversity arrangements
//   π_homA >> π_homB                 | asymmetric haplotype history or fitness
//   π_homA high, π_homB low, AB high | possible deleterious/rare arrangement
//                                    | maintained in heterozygotes (POD-like)
//   π_homA low, π_homB low, AB high  | old divergent arrangements; selection
//                                    | not proven
//   π_homA high, π_homB high         | both arrangements internally diverse;
//                                    | old/persistent polymorphism
//
// Pure compute. Renders into the [evo] hover pill on page17's
// karyotype-aware stat cells.
// =====================================================================

// =====================================================================
// Vocab
// =====================================================================

/** 5 pattern labels + insufficient-data fallback. */
export const HOMOKARYOTYPE_DIVERSITY_PATTERNS = Object.freeze({
  BOTH_LOW_DIVERGENT:    'both_low_divergent',
  ASYMMETRIC:            'asymmetric',
  ASYMMETRIC_AB_EXCESS:  'asymmetric_ab_excess',
  BOTH_LOW_AB_EXCESS:    'both_low_ab_excess',
  BOTH_HIGH:             'both_high',
  INSUFFICIENT_DATA:     'insufficient_data',
});

/** Plain-language interpretations for the hover pill. The page17
 *  renderer reads this map to populate the tooltip. */
export const HOMOKARYOTYPE_PATTERN_INTERPRETATIONS = Object.freeze({
  both_low_divergent:
    'Two divergent low-diversity arrangements. Both haplotypes are ' +
    'internally constrained; the inversion separates them but neither ' +
    'carries much standing variation. Common for old, low-recombination ' +
    'inversions where drift has fixed most variation within each lineage.',
  asymmetric:
    'Asymmetric haplotype history or fitness. One arrangement is ' +
    'markedly more diverse than the other — could be the older haplotype, ' +
    'the larger-Ne haplotype, the one with more internal recombination, ' +
    'or the introgressed-from-a-diverse-source one. Asymmetry alone does ' +
    'NOT prove selection; it tells you the two arrangements are not ' +
    'evolutionarily equivalent.',
  asymmetric_ab_excess:
    'Possible deleterious/rare arrangement maintained in heterozygotes ' +
    '(pseudo-overdominance / associative-overdominance signature). ' +
    'One homokaryotype is diverse, the other is depleted and possibly ' +
    'rare, and heterozygotes are overrepresented — consistent with the ' +
    'rare arrangement carrying load that gets masked in heterozygotes ' +
    'but exposed in homozygotes. Strongest single-locus signal for POD-like ' +
    'dynamics this page surfaces.',
  both_low_ab_excess:
    'Old divergent arrangements; selection not proven. Both homokaryotypes ' +
    'are internally low-diversity (long divergence + drift within each ' +
    'haplotype), but heterozygotes are common — could be just the absence ' +
    'of strong negative selection against AB, not active overdominance. ' +
    'Compatible with neutral persistence of an old polymorphism.',
  both_high:
    'Both arrangements internally diverse; old/persistent polymorphism. ' +
    'Both haplotypes retain substantial standing variation, suggesting ' +
    'large Ne or ongoing gene conversion / rare double crossovers eroding ' +
    'LD within each arrangement. Often the signature of a balanced ' +
    'polymorphism that has been around long enough for diversity to ' +
    'accumulate but not so long that drift fixed each lineage.',
  insufficient_data:
    'Insufficient data to call a pattern (e.g. one homokaryotype is ' +
    'missing from the cohort, or π estimates are below the reliability ' +
    'gate). Need n_AA ≥ min_n AND n_BB ≥ min_n with finite π values.',
});

/** Default thresholds for the pattern classifier. */
export const HOMOKARYOTYPE_PATTERN_DEFAULTS = Object.freeze({
  /** π below this = "low" (typical neutral π ≈ 0.005-0.015 in
   *  vertebrates; below 0.005 is low for most cohorts). */
  low_pi_below:      0.005,
  /** π above this = "high". */
  high_pi_above:     0.015,
  /** Asymmetry threshold: max(π_homA, π_homB) / min > this → asymmetric. */
  asymmetry_ratio:   2.0,
  /** Heterozygote-excess threshold: observed n_AB / expected (HWE) > this
   *  → excess. */
  ab_excess_factor:  1.20,
  /** Minimum sample count per group for a confident call. Below →
   *  insufficient_data. */
  min_n_per_homozygote: 5,
});

// =====================================================================
// Helper: HWE-expected AB count
// =====================================================================

/**
 * Expected n_AB under HWE given observed homozygote counts.
 *
 *   p = (2·n_AA + n_AB) / (2·N)    allele frequency of A
 *   q = 1 - p
 *   E[n_AB] = 2 · p · q · N
 *
 * Returns NaN when N == 0.
 */
export function expectedHetCountHWE(n_AA, n_AB, n_BB) {
  const N = (n_AA || 0) + (n_AB || 0) + (n_BB || 0);
  if (N === 0) return NaN;
  const p = (2 * (n_AA || 0) + (n_AB || 0)) / (2 * N);
  const q = 1 - p;
  return 2 * p * q * N;
}

// =====================================================================
// Classifier
// =====================================================================

/**
 * Map (per-karyotype π + counts) → one of the 5 pattern labels.
 *
 * @param {{
 *   pi_homA: number,   pi_homB: number,   pi_het?: number,
 *   n_AA:    number,   n_AB:    number,   n_BB:    number,
 * }} args
 * @param {Object} [opts]   threshold overrides
 * @returns {{
 *   pattern:         string,
 *   interpretation:  string,
 *   asymmetric:      boolean,
 *   pi_A_band:       'low'|'high'|'mid',
 *   pi_B_band:       'low'|'high'|'mid',
 *   ab_excess:       boolean,
 *   ab_excess_ratio: number,
 *   n_total:         number,
 * }}
 */
export function classifyHomokaryotypeDiversityPattern(args, opts) {
  const a = args || {};
  const o = opts || {};
  const D = HOMOKARYOTYPE_PATTERN_DEFAULTS;
  const lowBelow  = Number.isFinite(o.low_pi_below)         ? o.low_pi_below         : D.low_pi_below;
  const highAbove = Number.isFinite(o.high_pi_above)        ? o.high_pi_above        : D.high_pi_above;
  const asymRatio = Number.isFinite(o.asymmetry_ratio)      ? o.asymmetry_ratio      : D.asymmetry_ratio;
  const abFactor  = Number.isFinite(o.ab_excess_factor)     ? o.ab_excess_factor     : D.ab_excess_factor;
  const minN      = Number.isFinite(o.min_n_per_homozygote) ? o.min_n_per_homozygote : D.min_n_per_homozygote;

  const piA = a.pi_homA, piB = a.pi_homB;
  const nAA = a.n_AA || 0, nAB = a.n_AB || 0, nBB = a.n_BB || 0;
  const N = nAA + nAB + nBB;

  // Insufficient data: one homokaryotype too small OR π non-finite.
  if (nAA < minN || nBB < minN || !Number.isFinite(piA) || !Number.isFinite(piB)) {
    return _result(HOMOKARYOTYPE_DIVERSITY_PATTERNS.INSUFFICIENT_DATA, {
      pi_A_band: _bandOf(piA, lowBelow, highAbove),
      pi_B_band: _bandOf(piB, lowBelow, highAbove),
      asymmetric: false, ab_excess: false, ab_excess_ratio: NaN, n_total: N,
    });
  }

  const piAband = _bandOf(piA, lowBelow, highAbove);
  const piBband = _bandOf(piB, lowBelow, highAbove);
  const ratio = (piA > 0 && piB > 0)
    ? Math.max(piA, piB) / Math.min(piA, piB)
    : Infinity;
  const asymmetric = Number.isFinite(ratio) && ratio >= asymRatio;

  // Heterozygote excess vs HWE expectation.
  const expectedAB = expectedHetCountHWE(nAA, nAB, nBB);
  const abExcessRatio = (Number.isFinite(expectedAB) && expectedAB > 0)
    ? nAB / expectedAB : NaN;
  const abExcess = Number.isFinite(abExcessRatio) && abExcessRatio >= abFactor;

  // Decision tree (precedence: most specific patterns first).
  let pattern;
  if (asymmetric && piAband === 'high' && piBband === 'low' && abExcess) {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.ASYMMETRIC_AB_EXCESS;
  } else if (asymmetric && piBband === 'high' && piAband === 'low' && abExcess) {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.ASYMMETRIC_AB_EXCESS;
  } else if (asymmetric) {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.ASYMMETRIC;
  } else if (piAband === 'low' && piBband === 'low' && abExcess) {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_LOW_AB_EXCESS;
  } else if (piAband === 'low' && piBband === 'low') {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_LOW_DIVERGENT;
  } else if (piAband === 'high' && piBband === 'high') {
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_HIGH;
  } else {
    // Mid-bands or one-high-one-mid without strong asymmetry → fall
    // back to BOTH_LOW_DIVERGENT as the most conservative call (we
    // don't have a "mixed_intermediate" pattern label per spec).
    pattern = HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_LOW_DIVERGENT;
  }

  return _result(pattern, {
    pi_A_band: piAband, pi_B_band: piBband,
    asymmetric, ab_excess: abExcess,
    ab_excess_ratio: abExcessRatio,
    n_total: N,
  });
}

function _result(pattern, extras) {
  return Object.assign({
    pattern,
    interpretation: HOMOKARYOTYPE_PATTERN_INTERPRETATIONS[pattern] || '',
  }, extras);
}

function _bandOf(pi, lowBelow, highAbove) {
  if (!Number.isFinite(pi))    return 'low';   // missing → conservative
  if (pi < lowBelow)            return 'low';
  if (pi > highAbove)           return 'high';
  return 'mid';
}
