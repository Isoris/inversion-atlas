// shared/mendelian_segregation.js
//
// Mendelian segregation statistics for inversion karyotype crosses
// (SPEC_mendelian_inheritance_para_vs_peri_v1 §2 / §5 / §6). Pure
// helpers used by analysis/mendelian.js (parent-trio Mendelian) and
// any per-family per-candidate segregation table.
//
// Three math primitives + one orchestrator:
//
//   1. mendelianChiSquare(obs, ratio)         goodness-of-fit
//   2. estimateRecombinationRate(counts, cross)  test-cross / F2 recombination
//   3. effectDirection(obs, expCounts)        7-tag direction enum
//   4. assessSegregation(obs, opts)           composes the three into
//                                              a per-row verdict matching
//                                              the SPEC §7 output schema
//
// All helpers are headless-tolerant. No DOM, no localStorage. State is
// passed explicitly. p-values use chiSqSurvival() from contingency.js
// (Lanczos gamma, ~10-digit accuracy for df up to ~200).

import { chiSqSurvival } from '../../inversion/shared/contingency.js';

// =====================================================================
// Vocab — Mendelian ratios + segregation-status enum
// =====================================================================

/**
 * Canonical Mendelian expected-ratio vocab. Keys are display strings;
 * values are numeric proportion arrays (sum to 1, indexed in
 * label order). For 3-state crosses the label order is
 * `[AA, AB, BB]`; for 2-state crosses it's `[class_a, class_b]`.
 */
export const MENDELIAN_RATIOS = Object.freeze({
  '1:1':     Object.freeze([0.5, 0.5]),
  '3:1':     Object.freeze([0.75, 0.25]),
  '1:2:1':   Object.freeze([0.25, 0.5, 0.25]),
  '9:3:3:1': Object.freeze([9 / 16, 3 / 16, 3 / 16, 1 / 16]),
});

/**
 * Map (parent1_call, parent2_call) → expected ratio label. Parent
 * calls follow SPEC §2 (AA / AB / BB). Symmetric — (AA,AB) and (AB,AA)
 * resolve to the same row. Returns null for uninformative crosses
 * (`AA × AA`, `BB × BB`).
 */
export const CROSS_TO_RATIO = Object.freeze({
  'AA_x_AA': null,
  'AA_x_AB': '1:1',
  'AA_x_BB': '0:1:0',    // 100% AB — special, handled separately
  'AB_x_AB': '1:2:1',
  'AB_x_BB': '1:1',
  'BB_x_BB': null,
});

/**
 * SPEC §5 6-state segregation-status enum.
 */
export const SEGREGATION_STATUS = Object.freeze({
  MENDELIAN:        'MENDELIAN',
  DISTORTED:        'DISTORTED',
  AMBIGUOUS:        'AMBIGUOUS',
  UNDERPOWERED:     'UNDERPOWERED',
  COMPLEX_MODEL:    'COMPLEX_MODEL',
  PARENT_UNCERTAIN: 'PARENT_UNCERTAIN',
});

/**
 * SPEC §6 7-tag effect-direction enum.
 */
export const EFFECT_DIRECTION = Object.freeze({
  NONE:                  'none',
  AA_DEFICIT:            'AA_deficit',
  AB_DEFICIT:            'AB_deficit',
  BB_DEFICIT:            'BB_deficit',
  HETEROZYGOTE_EXCESS:   'heterozygote_excess',
  HETEROZYGOTE_DEFICIT:  'heterozygote_deficit',
  ONE_PARENT_BIAS:       'one_parent_transmission_bias',
});

/** Default α for the goodness-of-fit decision (SPEC §5 / §7.1). */
export const DEFAULT_ALPHA = 0.05;

/** Minimum offspring n below which we tag UNDERPOWERED. */
export const DEFAULT_MIN_OFFSPRING = 10;

// =====================================================================
// 1. mendelianChiSquare(observed, ratio)
// =====================================================================

/**
 * Resolve a ratio argument to a numeric proportion array.
 * Accepts either a label key from MENDELIAN_RATIOS or an explicit
 * Array<number>. Returns null when unresolvable.
 *
 * @param {string|Array<number>} ratio
 * @returns {Array<number>|null}
 */
export function resolveRatio(ratio) {
  if (Array.isArray(ratio)) {
    if (!ratio.length) return null;
    const all = ratio.every(p => Number.isFinite(p) && p >= 0);
    if (!all) return null;
    const total = ratio.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    return ratio.map(p => p / total);
  }
  if (typeof ratio === 'string' && MENDELIAN_RATIOS[ratio]) {
    return MENDELIAN_RATIOS[ratio].slice();
  }
  return null;
}

/**
 * Goodness-of-fit chi-square for observed counts vs an expected
 * Mendelian ratio.
 *
 * Returns `{ok:false, reason}` when inputs don't line up; otherwise
 * returns `{ok:true, chi2, df, p_value, expected, observed,
 * n_total, ratio}` matching the SPEC §7 row schema.
 *
 * Cells with expected count < 1 are flagged but kept in the chi2
 * sum — caller can decide to downgrade reliability when
 * `expected_low_cells > 0`.
 *
 * @param {Array<number>} observed
 * @param {string|Array<number>} ratio
 * @param {{alpha?:number}} opts
 * @returns {Object}
 */
export function mendelianChiSquare(observed, ratio, opts) {
  const o = opts || {};
  const alpha = Number.isFinite(o.alpha) ? o.alpha : DEFAULT_ALPHA;

  if (!Array.isArray(observed) || !observed.length) {
    return { ok: false, reason: 'observed_empty' };
  }
  const p = resolveRatio(ratio);
  if (!p) return { ok: false, reason: 'unresolved_ratio' };
  if (p.length !== observed.length) {
    return { ok: false, reason: 'shape_mismatch',
             n_observed: observed.length, n_expected: p.length };
  }
  let n = 0;
  for (let i = 0; i < observed.length; i++) {
    const v = observed[i];
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, reason: 'invalid_observed_cell', index: i };
    }
    n += v;
  }
  if (n <= 0) return { ok: false, reason: 'zero_total' };

  const expected = p.map(pi => pi * n);
  let chi2 = 0, low = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i];
    if (e < 1) low++;
    if (e > 0) chi2 += (observed[i] - e) ** 2 / e;
  }
  const df = observed.length - 1;
  const p_value = chiSqSurvival(chi2, df);

  return {
    ok: true,
    chi2, df, p_value,
    expected, observed: observed.slice(),
    n_total: n,
    ratio: p,
    expected_low_cells: low,
    significant: Number.isFinite(p_value) && p_value < alpha,
    alpha,
  };
}

// =====================================================================
// 2. estimateRecombinationRate(counts, crossType)
// =====================================================================

/**
 * Estimate recombination rate from offspring genotype counts.
 *
 * Two designs supported:
 *
 *   - `testcross`: parental cross AB × aa. Recombinants are the
 *     minority haplotype combination. counts = {parental, recombinant}
 *     OR a 2-element array [parental, recombinant]. r_hat = R / N.
 *     Variance = r(1-r)/N; CI via normal approx (Wilson is more
 *     accurate near boundaries — caller can swap).
 *
 *   - `f2`: AB × AB cross between two loci. counts = {AABB, AAbb,
 *     aaBB, aabb, AABb, aaBb, AaBB, Aabb, AaBb} or similar 4-class
 *     genotype counts. Returns linkage-based estimate via maximum
 *     likelihood (closed-form for the simplest model:
 *     r_hat ≈ sqrt(observed_recombinant_fraction) for a 2-locus F2).
 *
 *   - `backcross`: F1 × parental, 2-class output. Identical formulae
 *     to testcross — alias.
 *
 * Returns `{ok:true, r_hat, se, ci_low, ci_high, n_total, design,
 * lod?}` or `{ok:false, reason}`.
 *
 * @param {Object|Array<number>} counts
 * @param {string} design  'testcross' | 'backcross' | 'f2'
 * @param {{z?:number}} opts  z=1.96 by default (95% CI)
 * @returns {Object}
 */
export function estimateRecombinationRate(counts, design, opts) {
  const o = opts || {};
  const z = Number.isFinite(o.z) ? o.z : 1.96;
  const d = (design || 'testcross').toLowerCase();

  if (d === 'testcross' || d === 'backcross') {
    let parental, recombinant;
    if (Array.isArray(counts)) {
      if (counts.length !== 2) {
        return { ok: false, reason: 'testcross_expects_2_classes',
                 n_classes: counts.length };
      }
      parental = counts[0]; recombinant = counts[1];
    } else if (counts && typeof counts === 'object') {
      parental = counts.parental;
      recombinant = counts.recombinant;
    } else {
      return { ok: false, reason: 'invalid_counts' };
    }
    if (!Number.isFinite(parental) || !Number.isFinite(recombinant)
        || parental < 0 || recombinant < 0) {
      return { ok: false, reason: 'invalid_counts' };
    }
    const n = parental + recombinant;
    if (n <= 0) return { ok: false, reason: 'zero_total' };

    const r = recombinant / n;
    const se = Math.sqrt(r * (1 - r) / n);
    const ci_low = Math.max(0, r - z * se);
    const ci_high = Math.min(0.5, r + z * se);

    return {
      ok: true,
      r_hat: r, se,
      ci_low, ci_high,
      n_total: n,
      n_parental: parental,
      n_recombinant: recombinant,
      design: d,
    };
  }

  if (d === 'f2') {
    // F2 (AB × AB) two-locus design. Closed-form ML estimate from
    // the four phenotypic classes A_B_ / A_bb / aaB_ / aabb (Allard
    // 1956). Caller passes either:
    //   - {AABB, AABb, AaBB, AaBb, AAbb, Aabb, aaBB, aaBb, aabb}
    //     full 9 genotypes, OR
    //   - {AB, Ab, aB, ab} four phenotypic classes.
    let n_AB, n_Ab, n_aB, n_ab;
    if (counts && Number.isFinite(counts.AB)) {
      n_AB = counts.AB; n_Ab = counts.Ab;
      n_aB = counts.aB; n_ab = counts.ab;
    } else if (Array.isArray(counts) && counts.length === 4) {
      [n_AB, n_Ab, n_aB, n_ab] = counts;
    } else {
      return { ok: false, reason: 'f2_expects_4_phenotype_classes' };
    }
    if (![n_AB, n_Ab, n_aB, n_ab].every(v =>
        Number.isFinite(v) && v >= 0)) {
      return { ok: false, reason: 'invalid_counts' };
    }
    const n = n_AB + n_Ab + n_aB + n_ab;
    if (n <= 0) return { ok: false, reason: 'zero_total' };
    // Method-of-moments estimate: under coupling phase,
    // P(aabb) = (1-r)^2 / 4. Solve for r:
    //   r = 1 - 2 * sqrt(n_ab / n)
    // Bounded to [0, 0.5].
    const f_ab = n_ab / n;
    let r = 1 - 2 * Math.sqrt(f_ab);
    if (!Number.isFinite(r)) r = 0.5;
    r = Math.max(0, Math.min(0.5, r));
    // SE from Fisher info for f_ab estimate (delta method):
    //   Var(r) ≈ Var(sqrt(f_ab) * 2) = (1/f_ab) * f_ab*(1-f_ab)/n
    //   = (1 - f_ab) / n
    // Skip when f_ab=0 (r at boundary).
    const se = f_ab > 0 ? Math.sqrt((1 - f_ab) / n) : NaN;
    const ci_low = Number.isFinite(se) ? Math.max(0, r - z * se) : 0;
    const ci_high = Number.isFinite(se) ? Math.min(0.5, r + z * se) : 0.5;
    return {
      ok: true,
      r_hat: r, se,
      ci_low, ci_high,
      n_total: n,
      classes: { AB: n_AB, Ab: n_Ab, aB: n_aB, ab: n_ab },
      design: 'f2',
    };
  }

  return { ok: false, reason: 'unknown_design', design };
}

// =====================================================================
// 3. effectDirection(observed, expected)
// =====================================================================

/**
 * Tag the dominant deviation pattern for a 3-class (AA/AB/BB)
 * goodness-of-fit. Per SPEC §6 the tag is qualitative — we pick the
 * largest-magnitude residual and emit its semantic name.
 *
 * one_parent_transmission_bias requires phased data and is not
 * inferrable from offspring counts alone — caller passes
 * opts.phased=true to get that tag instead.
 *
 * @param {Array<number>} observed  [AA, AB, BB]
 * @param {Array<number>} expected  [AA, AB, BB]
 * @param {{labels?:Array<string>, phased?:boolean}} opts
 * @returns {string}                one of EFFECT_DIRECTION values
 */
export function effectDirection(observed, expected, opts) {
  const o = opts || {};
  if (!Array.isArray(observed) || !Array.isArray(expected)) {
    return EFFECT_DIRECTION.NONE;
  }
  if (observed.length !== expected.length) return EFFECT_DIRECTION.NONE;
  if (observed.length !== 3) {
    // 2-class: pick which side is deficient.
    if (observed.length === 2) {
      const d0 = observed[0] - expected[0];
      const d1 = observed[1] - expected[1];
      if (Math.abs(d0) < 1e-9 && Math.abs(d1) < 1e-9) {
        return EFFECT_DIRECTION.NONE;
      }
      // 2-class crosses don't have AB; fall back to NONE for non-3-class
      // shapes per SPEC §6 (tags are 3-state).
      return EFFECT_DIRECTION.NONE;
    }
    return EFFECT_DIRECTION.NONE;
  }

  const [oAA, oAB, oBB] = observed;
  const [eAA, eAB, eBB] = expected;
  const dAA = oAA - eAA;
  const dAB = oAB - eAB;
  const dBB = oBB - eBB;
  const aAA = Math.abs(dAA), aAB = Math.abs(dAB), aBB = Math.abs(dBB);
  const maxRes = Math.max(aAA, aAB, aBB);

  if (maxRes < 1) return EFFECT_DIRECTION.NONE;

  // Heterozygote anomalies have priority (SPEC §6 reads them
  // separately from homozygote deficits).
  if (aAB >= aAA && aAB >= aBB) {
    return dAB > 0 ? EFFECT_DIRECTION.HETEROZYGOTE_EXCESS
                   : EFFECT_DIRECTION.HETEROZYGOTE_DEFICIT;
  }
  if (aAA >= aBB) return dAA < 0 ? EFFECT_DIRECTION.AA_DEFICIT
                                 : EFFECT_DIRECTION.BB_DEFICIT;
  return dBB < 0 ? EFFECT_DIRECTION.BB_DEFICIT
                 : EFFECT_DIRECTION.AA_DEFICIT;
}

// =====================================================================
// 4. assessSegregation(row, opts)
// =====================================================================

/**
 * Compose chi-square + effect-direction + reliability into the SPEC §7
 * per-family row.
 *
 * `row` is the raw per-(candidate × family) observation:
 *   { observed:[oAA,oAB,oBB], expected_ratio:'1:2:1',
 *     parent1_call:'AB', parent2_call:'AB',
 *     reliability:'high'|'medium'|'low',
 *     parent_uncertain?:bool, complex_model?:bool,
 *     candidate_id?, family_id?, inversion_type? }
 *
 * Returns the augmented row with chi2/p_value/effect_direction/
 * segregation_status fields. Pure: does not mutate `row`.
 *
 * @param {Object} row
 * @param {{alpha?:number, min_offspring?:number, ambiguousAlpha?:number}} opts
 * @returns {Object}
 */
export function assessSegregation(row, opts) {
  if (!row || typeof row !== 'object') return null;
  const o = opts || {};
  const alpha = Number.isFinite(o.alpha) ? o.alpha : DEFAULT_ALPHA;
  const minN = Number.isFinite(o.min_offspring)
    ? o.min_offspring : DEFAULT_MIN_OFFSPRING;
  // Borderline band for AMBIGUOUS: p between alpha and ambiguousAlpha.
  const ambiguousAlpha = Number.isFinite(o.ambiguousAlpha)
    ? o.ambiguousAlpha : 0.10;

  // Hard-tag short-circuits per SPEC §5.
  if (row.parent_uncertain === true) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.PARENT_UNCERTAIN,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: null, chi2: null, df: null,
    });
  }
  if (row.complex_model === true) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.COMPLEX_MODEL,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: null, chi2: null, df: null,
    });
  }

  const observed = Array.isArray(row.observed) ? row.observed
    : (row.obs_AA != null
        ? [row.obs_AA, row.obs_AB || 0, row.obs_BB || 0]
        : null);
  if (!observed) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.UNDERPOWERED,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: null, chi2: null, df: null,
      reason: 'no_observed',
    });
  }

  const ratio = row.expected_ratio
    || row.ratio
    || _inferRatio(row.parent1_call, row.parent2_call);
  if (!ratio) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.COMPLEX_MODEL,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: null, chi2: null, df: null,
      reason: 'no_ratio',
    });
  }

  const fit = mendelianChiSquare(observed, ratio, { alpha });
  if (!fit.ok) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.UNDERPOWERED,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: null, chi2: null, df: null,
      reason: fit.reason,
    });
  }

  // Underpower check (SPEC §5 row 4).
  if (fit.n_total < minN) {
    return Object.assign({}, row, {
      segregation_status: SEGREGATION_STATUS.UNDERPOWERED,
      effect_direction: EFFECT_DIRECTION.NONE,
      p_value: fit.p_value, chi2: fit.chi2, df: fit.df,
      expected: fit.expected,
      n_offspring: fit.n_total,
      reason: 'small_n',
    });
  }

  const direction = effectDirection(observed, fit.expected);
  const reliability = row.reliability || 'medium';

  // SPEC §5 decision table.
  let status;
  if (fit.p_value >= alpha) {
    status = SEGREGATION_STATUS.MENDELIAN;
  } else if (fit.p_value < alpha && reliability === 'low') {
    status = SEGREGATION_STATUS.AMBIGUOUS;
  } else if (fit.p_value >= alpha * 0.5 && fit.p_value < ambiguousAlpha
             && reliability !== 'high') {
    // Borderline distortion at medium reliability: tag AMBIGUOUS.
    status = SEGREGATION_STATUS.AMBIGUOUS;
  } else {
    status = SEGREGATION_STATUS.DISTORTED;
  }

  return Object.assign({}, row, {
    segregation_status: status,
    effect_direction: status === SEGREGATION_STATUS.MENDELIAN
      ? EFFECT_DIRECTION.NONE : direction,
    p_value: fit.p_value,
    chi2: fit.chi2,
    df: fit.df,
    expected: fit.expected,
    n_offspring: fit.n_total,
    ratio_used: ratio,
  });
}

function _inferRatio(p1, p2) {
  if (!p1 || !p2) return null;
  const key = [p1, p2].sort().join('_x_');
  const r = CROSS_TO_RATIO[key];
  return r === '0:1:0' ? null : (r || null);
}

// =====================================================================
// 5. para-vs-peri cohort aggregator (SPEC §3 / §8)
// =====================================================================

/**
 * Cohort-level 2×2 contingency: counts of {MENDELIAN, DISTORTED}
 * per inversion type. Rows with other statuses are excluded (per
 * SPEC §8.1 — `COMPLEX_MODEL` and underpowered drop out of the
 * formal para-vs-peri test).
 *
 * Returns `{ok:true, table, n_paracentric, n_pericentric,
 * n_excluded}`. Caller picks Fisher / chi-square per their own
 * cell-size threshold.
 *
 * @param {Array<Object>} rows  assessSegregation outputs
 * @returns {Object}
 */
export function buildParaPeriContingency(rows) {
  if (!Array.isArray(rows)) {
    return { ok: false, reason: 'invalid_rows' };
  }
  const M = SEGREGATION_STATUS.MENDELIAN;
  const D = SEGREGATION_STATUS.DISTORTED;
  let para_M = 0, para_D = 0, peri_M = 0, peri_D = 0, excluded = 0;
  for (const r of rows) {
    if (!r) { excluded++; continue; }
    const t = r.inversion_type;
    const s = r.segregation_status;
    if (s !== M && s !== D) { excluded++; continue; }
    if (t === 'paracentric') {
      if (s === M) para_M++; else para_D++;
    } else if (t === 'pericentric') {
      if (s === M) peri_M++; else peri_D++;
    } else {
      excluded++;
    }
  }
  return {
    ok: true,
    table: [[para_M, para_D], [peri_M, peri_D]],
    n_paracentric: para_M + para_D,
    n_pericentric: peri_M + peri_D,
    n_excluded: excluded,
  };
}
