// shared/mgl_archaeology_classifier.js
// =====================================================================
// Step-6 synthesis classifier. Maps the union of all per-candidate
// metrics (from age divergence, mosaicism, polarization, frequency)
// to a single archaeology verdict + interpretation table entry.
//
// Verdicts (frozen):
//   young_clean            recent expansion, clean haplotype
//   old_divergent          old, internally diverse, deeply diverged
//   old_swept              old but bottlenecked / swept (low pi_inv)
//   old_leaky              old, contaminated by recombination/conv.
//   complex_nested         3+ regimes / nested rearrangement
//   recently_swept         high frequency today + low pi (looks fresh
//                          but driven by recent expansion)
//   unresolved             metrics don't add up to a canonical class
//   insufficient           missing inputs
//
// Pure compute. No DOM.
// =====================================================================

export const MGL_ARCHAEOLOGY_VERDICTS = Object.freeze([
  'young_clean', 'old_divergent', 'old_swept', 'old_leaky',
  'complex_nested', 'recently_swept', 'unresolved', 'insufficient',
]);

export const MGL_ARCHAEOLOGY_DEFAULTS = Object.freeze({
  pi_high:        0.008,
  pi_low:         0.002,
  dxy_high:       0.012,
  dxy_low:        0.003,
  fst_high:       0.40,
  many_private:   30,
  some_fixed:     5,
  freq_high:      0.40,
  freq_low:       0.05,
  leakage_high:   0.30,
});

/**
 * Validate + normalise an input metrics bag.
 *
 * Required: pi_inv, dxy, fst_hudson, private_inv, fixed_differences
 * Optional: arrangement_frequency, leakage_score, n_regimes,
 *            outgroup_present, age_class (from upstream)
 *
 * @param {Object} metrics
 * @returns {Object} normalised
 */
export function normaliseMetrics(metrics) {
  if (!metrics) return null;
  const numOrNull = (v) => Number.isFinite(v) ? v : null;
  return {
    pi_inv:                  numOrNull(metrics.pi_inv),
    pi_std:                  numOrNull(metrics.pi_std),
    dxy:                     numOrNull(metrics.dxy),
    fst_hudson:              numOrNull(metrics.fst_hudson),
    private_inv:             numOrNull(metrics.private_inv),
    private_std:             numOrNull(metrics.private_std),
    fixed_differences:       numOrNull(metrics.fixed_differences),
    arrangement_frequency:   numOrNull(metrics.arrangement_frequency),
    leakage_score:           numOrNull(metrics.leakage_score),
    n_regimes:               numOrNull(metrics.n_regimes),
    outgroup_present:        !!metrics.outgroup_present,
    polarity_verdict:        metrics.polarity_verdict || null,
    age_class:               metrics.age_class || null,
  };
}

/**
 * Classify into a verdict + reason + confidence.
 *
 * @param {Object} metrics    normaliseMetrics output
 * @param {Object} [opts]     thresholds
 * @returns {{verdict:string, reason:string, confidence:number,
 *            interpretation:string}}
 */
export function classifyArchaeology(metrics, opts) {
  if (!metrics) {
    return {
      verdict: 'insufficient', reason: 'no metrics supplied',
      confidence: 0, interpretation: 'no input',
    };
  }
  const o = opts || {};
  const D = MGL_ARCHAEOLOGY_DEFAULTS;
  const piH    = Number.isFinite(o.pi_high)   ? o.pi_high   : D.pi_high;
  const piL    = Number.isFinite(o.pi_low)    ? o.pi_low    : D.pi_low;
  const dxyH   = Number.isFinite(o.dxy_high)  ? o.dxy_high  : D.dxy_high;
  const dxyL   = Number.isFinite(o.dxy_low)   ? o.dxy_low   : D.dxy_low;
  const fstH   = Number.isFinite(o.fst_high)  ? o.fst_high  : D.fst_high;
  const manyP  = Number.isFinite(o.many_private) ? o.many_private : D.many_private;
  const fixN   = Number.isFinite(o.some_fixed)   ? o.some_fixed   : D.some_fixed;
  const freqH  = Number.isFinite(o.freq_high)    ? o.freq_high    : D.freq_high;
  const leakH  = Number.isFinite(o.leakage_high) ? o.leakage_high : D.leakage_high;

  // Need at least pi_inv + dxy to classify.
  if (metrics.pi_inv == null || metrics.dxy == null) {
    return {
      verdict: 'insufficient', reason: 'pi_inv or dxy missing',
      confidence: 0, interpretation: 'cannot classify without divergence inputs',
    };
  }

  // complex_nested: more than 2 regimes upstream.
  if (Number.isFinite(metrics.n_regimes) && metrics.n_regimes >= 3) {
    return {
      verdict: 'complex_nested',
      reason: `n_regimes=${metrics.n_regimes} ≥ 3 (multi-regime architecture)`,
      confidence: 0.8,
      interpretation: 'multiple historical events — nested or layered rearrangement',
    };
  }

  const high_pi  = metrics.pi_inv >= piH;
  const low_pi   = metrics.pi_inv <= piL;
  const high_dxy = metrics.dxy    >= dxyH;
  const low_dxy  = metrics.dxy    <= dxyL;
  const high_fst = Number.isFinite(metrics.fst_hudson) && metrics.fst_hudson >= fstH;
  const many_priv = Number.isFinite(metrics.private_inv) && metrics.private_inv >= manyP;
  const some_fixed = Number.isFinite(metrics.fixed_differences) && metrics.fixed_differences >= fixN;
  const high_freq  = Number.isFinite(metrics.arrangement_frequency)
                     && metrics.arrangement_frequency >= freqH;
  const high_leak  = Number.isFinite(metrics.leakage_score) && metrics.leakage_score >= leakH;

  // young_clean: low pi_inv + high FST + shallow dxy
  if (low_pi && high_fst && !high_dxy) {
    return {
      verdict: 'young_clean',
      reason: 'low pi_inv + high FST + shallow dxy',
      confidence: 0.8,
      interpretation: 'recent expansion of a single derived haplotype',
    };
  }

  // recently_swept: high frequency + low pi_inv
  if (high_freq && low_pi) {
    return {
      verdict: 'recently_swept',
      reason: 'high frequency but low diversity (recent expansion)',
      confidence: 0.7,
      interpretation: 'common today but driven by recent expansion / drift',
    };
  }

  // old_leaky: high pi_inv + shallow dxy (looks deep inside but mixes)
  if (high_pi && low_dxy) {
    return {
      verdict: 'old_leaky',
      reason: 'high pi_inv but shallow dxy (mosaicism / gene conversion)',
      confidence: 0.7,
      interpretation: 'old arrangement contaminated by recombination / gene conversion',
    };
  }

  // Mosaicism trumps when leakage is explicitly high.
  if (high_leak) {
    return {
      verdict: 'old_leaky',
      reason: `mosaicism leakage_score=${metrics.leakage_score.toFixed(2)} ≥ ${leakH}`,
      confidence: 0.7,
      interpretation: 'recombinant tracts / gene-conversion leakage detected',
    };
  }

  // old_divergent: high pi_inv + high dxy + many private
  if (high_pi && high_dxy && many_priv) {
    return {
      verdict: 'old_divergent',
      reason: 'high pi_inv + deep dxy + many private',
      confidence: 0.85,
      interpretation: 'old, internally diverse arrangement with long isolation',
    };
  }

  // Fixed differences only → old divergent subtype.
  if (some_fixed && metrics.dxy >= dxyL) {
    return {
      verdict: 'old_divergent',
      reason: `${metrics.fixed_differences} fixed differences`,
      confidence: 0.65,
      interpretation: 'long-term separation evidenced by fixed differences',
    };
  }

  // old_swept: high dxy but low pi_inv
  if (low_pi && high_dxy) {
    return {
      verdict: 'old_swept',
      reason: 'deep dxy but low pi_inv (sweep / bottleneck)',
      confidence: 0.7,
      interpretation: 'old arrangement that lost diversity to sweep or bottleneck',
    };
  }

  return {
    verdict: 'unresolved',
    reason: 'metric pattern does not match any canonical archaeology class',
    confidence: 0.3,
    interpretation: 'collect more sites / outgroup data to disambiguate',
  };
}

/**
 * Build the full archaeology card from a metrics bag.
 *
 * @param {Object} metrics
 * @param {Object} [opts]
 * @returns {Object} card
 */
export function buildArchaeologyCard(metrics, opts) {
  const norm = normaliseMetrics(metrics);
  const v = classifyArchaeology(norm, opts);
  return {
    verdict:        v.verdict,
    reason:         v.reason,
    confidence:     v.confidence,
    interpretation: v.interpretation,
    metrics:        norm,
  };
}
