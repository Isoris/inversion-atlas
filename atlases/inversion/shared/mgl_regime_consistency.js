// shared/mgl_regime_consistency.js
// =====================================================================
// Per-candidate long-range haplotype-regime summary statistics.
//
// Inputs (pure compute — no DOM, no IO):
//   - locus: stage3 locus object from runBandingPipeline (per_band_samples
//     of length K, s_window/e_window, K, seed_id, chromosome_idx)
//   - ctx: pipeline context exposing getLabels(w) -> Int32Array of length
//     n_samples with sample -> K-band label in [-1, K), n_samples,
//     n_windows, optional getK(w) for variable-K windows
//   - dosage_per_sample: Float64Array | number[] of mean dosage per sample
//     across the locus (already centered to STD = 0 / INV = 2 convention)
//   - candidate (optional): for candidate_id / start_bp / end_bp / chrom
//
// Outputs (one row per locus, columns picked to mirror the manuscript-
// table schema requested 2026-05-27):
//   candidate_id, chrom, start, end, seed_window,
//   n_samples, n_bands, major_band_pattern,
//   long_range_support_windows, support_span_mb,
//   mean_contingency_agreement, mean_cramers_v,
//   heterozygote_band_present, homA_count, het_count, homB_count,
//   regime_class, confidence, notes
//
// All sample tallies and Cramér's V work for ARBITRARY K — no biallelic
// assumption. homA / het / homB counts come from per-sample dosage
// (tier thresholds in DEFAULTS), so they remain meaningful even when
// K > 3 (a few bands may share a dosage tier).
// =====================================================================

import { buildContingency, cramersV } from './contingency.js';
import { alignLabels }                 from './hungarian.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const MGL_REGIME_CONSISTENCY_DEFAULTS = Object.freeze({
  het_dosage_lo:        0.6,   // [lo, hi] = het range
  het_dosage_hi:        1.4,
  hom_a_dosage_max:     0.4,   // STD-like
  hom_b_dosage_min:     1.6,   // INV-like
  het_band_mean_lo:     0.6,   // band qualifies as het when its mean
  het_band_mean_hi:     1.4,   // dosage sits in [lo, hi]
  cramers_v_step:       1,     // adjacent-window pairing step (1 = neighbor)
});

export const DEFAULT_LENGTH_BINS_BP = Object.freeze([
  { name: '<100kb',   lo:           0, hi:     100_000 },
  { name: '100kb-1Mb', lo:    100_000, hi:   1_000_000 },
  { name: '1-10Mb',   lo:   1_000_000, hi:  10_000_000 },
  { name: '>10Mb',    lo:  10_000_000, hi:   Infinity },
]);

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function _isNum(x) { return typeof x === 'number' && Number.isFinite(x); }

/** Flatten the contingency object returned by buildContingency into the
 *  row-major flat array cramersV expects. */
function _flattenContingency(ct) {
  if (!ct || !ct.M) return null;
  const { M, KA, KB } = ct;
  const out = new Float64Array(KA * KB);
  for (let i = 0; i < KA; i++) {
    const row = M[i];
    for (let j = 0; j < KB; j++) out[i * KB + j] = row[j];
  }
  return out;
}

function _toIndexArray(perBandSamples, b) {
  const s = perBandSamples && perBandSamples[b];
  if (!s) return [];
  if (s instanceof Set) return Array.from(s);
  if (Array.isArray(s) || ArrayBuffer.isView(s)) return Array.from(s);
  return [];
}

/**
 * Resolve the reference grouping used for contingency, sample calls,
 * and seed-agreement. Once a regime is discovered, K-bands may be
 * MERGED (e.g. K=3 bands → 2 regimes when one band collapses into a
 * homozygote tier). Callers pass `regime_assignment` to opt into the
 * merged grouping; without it we fall back to per_band_samples.
 *
 * `regime_assignment` is sample→group_id (Int32Array length n_samples,
 * -1 = unassigned). `n_groups` is required when regime_assignment is
 * provided (used as K for contingency tables).
 *
 * Also accepts `regime_merger`: a length-K array mapping band_id →
 * group_id, which derives regime_assignment from per_band_samples.
 *
 * @returns {{assign:Int32Array, K_eff:number, group_samples:Array<number[]>}}
 */
export function resolveRegimeGrouping(locus, opts, nS) {
  if (!locus) return { assign: new Int32Array(nS || 0), K_eff: 0, group_samples: [] };
  const o = opts || {};
  // (a) explicit regime_assignment
  if (o.regime_assignment && (o.regime_assignment instanceof Int32Array
                              || Array.isArray(o.regime_assignment))
      && (o.regime_assignment.length === (nS | 0))) {
    const K_eff = (Number.isFinite(o.n_groups) ? (o.n_groups | 0)
                   : _maxPlusOne(o.regime_assignment));
    const buckets = Array.from({ length: K_eff }, () => []);
    const assign = (o.regime_assignment instanceof Int32Array)
                   ? o.regime_assignment : Int32Array.from(o.regime_assignment);
    for (let sid = 0; sid < nS; sid++) {
      const g = assign[sid];
      if (g >= 0 && g < K_eff) buckets[g].push(sid);
    }
    return { assign, K_eff, group_samples: buckets };
  }
  // (b) regime_merger: maps band → group
  if (o.regime_merger && (Array.isArray(o.regime_merger) || ArrayBuffer.isView(o.regime_merger))
      && o.regime_merger.length === (locus.K | 0)) {
    const merger = o.regime_merger;
    let K_eff = 0;
    for (let i = 0; i < merger.length; i++) {
      const g = merger[i] | 0;
      if (g + 1 > K_eff) K_eff = g + 1;
    }
    const buckets = Array.from({ length: K_eff }, () => []);
    const assign = new Int32Array(nS).fill(-1);
    for (let b = 0; b < locus.K; b++) {
      const g = merger[b] | 0;
      for (const sid of _toIndexArray(locus.per_band_samples, b)) {
        if (sid >= 0 && sid < nS && g >= 0 && g < K_eff) {
          assign[sid] = g;
          buckets[g].push(sid);
        }
      }
    }
    return { assign, K_eff, group_samples: buckets };
  }
  // (c) default: K-bands from per_band_samples (legacy behaviour)
  const K_eff = locus.K | 0;
  const buckets = Array.from({ length: K_eff }, () => []);
  const assign = new Int32Array(nS).fill(-1);
  for (let b = 0; b < K_eff; b++) {
    const ids = _toIndexArray(locus.per_band_samples, b);
    buckets[b] = ids.slice();
    for (const sid of ids) if (sid >= 0 && sid < nS) assign[sid] = b;
  }
  return { assign, K_eff, group_samples: buckets };
}

function _maxPlusOne(arr) {
  let m = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m + 1;
}

// ---------------------------------------------------------------------
// Per-band dosage means (any K)
// ---------------------------------------------------------------------

/**
 * For each of the K bands in this locus, mean dosage over its samples.
 * NaN for empty bands.
 *
 * @param {Object} locus               must have per_band_samples + K
 * @param {Float64Array|number[]} dos  mean dosage per sample over locus
 * @returns {Float64Array}             length K
 */
export function perBandDosageMean(locus, dos) {
  const K = locus.K | 0;
  const out = new Float64Array(K);
  for (let b = 0; b < K; b++) {
    const ids = _toIndexArray(locus.per_band_samples, b);
    if (ids.length === 0) { out[b] = NaN; continue; }
    let sum = 0, n = 0;
    for (const sid of ids) {
      const v = dos && dos[sid];
      if (_isNum(v)) { sum += v; n++; }
    }
    out[b] = n > 0 ? sum / n : NaN;
  }
  return out;
}

/**
 * Same as perBandDosageMean but takes a precomputed array of group →
 * sample-id lists (e.g. from resolveRegimeGrouping).
 */
function _groupDosageMean(groupSamples, dos) {
  const out = new Float64Array(groupSamples.length);
  for (let g = 0; g < groupSamples.length; g++) {
    const ids = groupSamples[g] || [];
    let sum = 0, n = 0;
    for (const sid of ids) {
      const v = dos && dos[sid];
      if (_isNum(v)) { sum += v; n++; }
    }
    out[g] = n > 0 ? sum / n : NaN;
  }
  return out;
}

/**
 * Is there a band whose mean dosage falls in the het range
 * [het_band_mean_lo, het_band_mean_hi]? Works for any K.
 */
export function heterozygoteBandPresent(perBandDosage, opts) {
  const D = MGL_REGIME_CONSISTENCY_DEFAULTS;
  const lo = (opts && _isNum(opts.het_band_mean_lo)) ? opts.het_band_mean_lo : D.het_band_mean_lo;
  const hi = (opts && _isNum(opts.het_band_mean_hi)) ? opts.het_band_mean_hi : D.het_band_mean_hi;
  if (!perBandDosage) return false;
  for (let b = 0; b < perBandDosage.length; b++) {
    const v = perBandDosage[b];
    if (_isNum(v) && v >= lo && v <= hi) return true;
  }
  return false;
}

// ---------------------------------------------------------------------
// Per-sample dosage tier counts (any K — derived from dosage not labels)
// ---------------------------------------------------------------------

/**
 * Stratify samples by dosage tier. Works for any K because tiers come
 * from dosage thresholds, not band labels.
 *
 * @param {Float64Array|number[]} dos
 * @param {Iterable<number>}      [sampleIds] subset of indices; default = all
 * @returns {{homA:number, het:number, homB:number, n_eval:number}}
 */
export function dosageTierCounts(dos, sampleIds, opts) {
  const D = MGL_REGIME_CONSISTENCY_DEFAULTS;
  const tA = (opts && _isNum(opts.hom_a_dosage_max)) ? opts.hom_a_dosage_max : D.hom_a_dosage_max;
  const tHL = (opts && _isNum(opts.het_dosage_lo))   ? opts.het_dosage_lo    : D.het_dosage_lo;
  const tHH = (opts && _isNum(opts.het_dosage_hi))   ? opts.het_dosage_hi    : D.het_dosage_hi;
  const tB = (opts && _isNum(opts.hom_b_dosage_min)) ? opts.hom_b_dosage_min : D.hom_b_dosage_min;
  let homA = 0, het = 0, homB = 0, n_eval = 0;
  const iter = sampleIds || (dos ? dos.keys() : []);
  for (const sid of iter) {
    const v = dos && dos[sid];
    if (!_isNum(v)) continue;
    n_eval++;
    if (v <= tA)                          homA++;
    else if (v >= tHL && v <= tHH)        het++;
    else if (v >= tB)                     homB++;
    // values in (tA, tHL) or (tHH, tB) intentionally drop out — they
    // sit between tiers and shouldn't inflate any single tier.
  }
  return { homA, het, homB, n_eval };
}

// ---------------------------------------------------------------------
// Major band pattern (any K)
// ---------------------------------------------------------------------

/**
 * Compact representation of how samples partition across the K bands.
 * Returned as "b0=N0|b1=N1|..." with bands sorted by descending count.
 *
 * @param {Object} locus
 * @returns {{pattern:string, sorted:Array<{band_id:number, n:number}>, total:number}}
 */
export function majorBandPattern(locus) {
  const K = locus.K | 0;
  const entries = [];
  let total = 0;
  for (let b = 0; b < K; b++) {
    const n = _toIndexArray(locus.per_band_samples, b).length;
    entries.push({ band_id: b, n });
    total += n;
  }
  entries.sort((a, b) => b.n - a.n);
  const pattern = entries.map(e => `b${e.band_id}=${e.n}`).join('|');
  return { pattern, sorted: entries, total };
}

// ---------------------------------------------------------------------
// Long-range support windows
// ---------------------------------------------------------------------

/**
 * Count of windows over [s_window, e_window] at which the locus's
 * band assignment remains consistent with the locus's per_band_samples
 * (Hungarian-aligned to the s_window labeling each step). The fraction
 * supportFraction = supportWindows / n_windows is the empirical long-
 * range support.
 *
 * @param {Object} locus
 * @param {{getLabels:(w:number)=>Int32Array, getK?:(w:number)=>number}} ctx
 * @param {Object} [opts]
 * @returns {{support_windows:number, n_windows:number,
 *           support_fraction:number}}
 */
export function longRangeSupportWindows(locus, ctx, opts) {
  if (!locus || !ctx || typeof ctx.getLabels !== 'function') {
    return { support_windows: 0, n_windows: 0, support_fraction: NaN };
  }
  const s = locus.s_window | 0;
  const e = locus.e_window | 0;
  if (e < s) return { support_windows: 0, n_windows: 0, support_fraction: NaN };
  const refLabels = ctx.getLabels(s);
  if (!refLabels) return { support_windows: 0, n_windows: 0, support_fraction: NaN };
  const nS = refLabels.length;
  // Honour regime_assignment / regime_merger overrides when provided —
  // makes the contingency operate on REGIME GROUPS rather than K-bands.
  const grouping = resolveRegimeGrouping(locus, opts, nS);
  const refAssign = grouping.assign;
  const K = grouping.K_eff;

  let support = 0, n_eval = 0;
  for (let w = s; w <= e; w++) {
    const lab = ctx.getLabels(w);
    if (!lab) continue;
    n_eval++;
    let alignedLab = lab;
    try {
      const al = alignLabels(refAssign, lab, K);
      if (al && al.aligned) alignedLab = al.aligned;
      else if (al && Array.isArray(al)) alignedLab = al;
    } catch (_) { /* keep raw */ }
    // Window "supports" the locus iff a majority of carriers match the
    // reference assignment. Threshold is 50% of the assigned samples.
    let match = 0, total = 0;
    for (let sid = 0; sid < nS; sid++) {
      const r = refAssign[sid];
      const l = alignedLab[sid];
      if (r < 0 || l < 0) continue;
      total++;
      if (r === l) match++;
    }
    if (total > 0 && match / total >= 0.5) support++;
  }
  const span = e - s + 1;
  return {
    support_windows: support,
    n_windows: span,
    support_fraction: span > 0 ? support / span : NaN,
  };
}

// ---------------------------------------------------------------------
// Mean Cramér's V across adjacent windows
// ---------------------------------------------------------------------

/**
 * Average Cramér's V between consecutive window-pairs across the
 * locus. Higher = the K-band partition is more stable across the span.
 *
 * @param {Object} locus
 * @param {{getLabels:(w:number)=>Int32Array}} ctx
 * @param {Object} [opts]
 * @returns {{mean_cramers_v:number, n_pairs:number, mean_agreement:number}}
 */
export function meanCramersVAcrossWindows(locus, ctx, opts) {
  if (!locus || !ctx || typeof ctx.getLabels !== 'function') {
    return { mean_cramers_v: NaN, n_pairs: 0, mean_agreement: NaN };
  }
  const o = opts || {};
  const step = (o.cramers_v_step | 0) || MGL_REGIME_CONSISTENCY_DEFAULTS.cramers_v_step;
  const K = locus.K | 0;
  const s = locus.s_window | 0;
  const e = locus.e_window | 0;
  let sumV = 0, sumAgr = 0, nV = 0;
  for (let w = s; w + step <= e; w += step) {
    const la = ctx.getLabels(w);
    const lb0 = ctx.getLabels(w + step);
    if (!la || !lb0) continue;
    // Align lb to la so cluster ids correspond.
    let lb = lb0;
    try {
      const al = alignLabels(la, lb0, K);
      if (al && al.aligned) lb = al.aligned;
      else if (al && Array.isArray(al)) lb = al;
    } catch (_) {}
    // Filter to samples present in both.
    const aBuf = [];
    const bBuf = [];
    let agree = 0;
    for (let sid = 0; sid < la.length; sid++) {
      const va = la[sid], vb = lb[sid];
      if (va < 0 || vb < 0) continue;
      aBuf.push(va); bBuf.push(vb);
      if (va === vb) agree++;
    }
    if (aBuf.length < 4) continue;
    try {
      const tbl = buildContingency(Int32Array.from(aBuf), Int32Array.from(bBuf), K, K);
      const flat = _flattenContingency(tbl); const V = flat ? cramersV(flat, K, K) : NaN;
      if (_isNum(V)) {
        sumV += V; nV++;
        sumAgr += agree / aBuf.length;
      }
    } catch (_) {}
  }
  return {
    mean_cramers_v: nV > 0 ? sumV   / nV : NaN,
    mean_agreement: nV > 0 ? sumAgr / nV : NaN,
    n_pairs:        nV,
  };
}

// ---------------------------------------------------------------------
// Per-window seed-agreement (reference-anchored)
// ---------------------------------------------------------------------

/**
 * For every window in [s_window, e_window], compute Hungarian-aligned
 * agreement and Cramér's V against the SEED window's labels (locus.s_window).
 * Returns one row per window — input for window_regime_support.tsv.
 *
 * @returns {Array<{w:number, agreement:number, cramers_v:number,
 *                  is_supported:boolean, n_samples:number}>}
 */
export function perWindowSeedAgreement(locus, ctx, opts) {
  if (!locus || !ctx || typeof ctx.getLabels !== 'function') return [];
  const o = opts || {};
  const agrThr = _isNum(o.support_agreement_min) ? o.support_agreement_min : 0.6;
  const vThr   = _isNum(o.support_v_min)         ? o.support_v_min         : 0.4;
  const s      = locus.s_window | 0;
  const e      = locus.e_window | 0;
  const seedRaw = ctx.getLabels(s);
  if (!seedRaw) return [];
  const nS = seedRaw.length;
  // Resolve grouping ONCE — uses regime_assignment / regime_merger
  // override when provided so seed-agreement runs on REGIME GROUPS.
  const grouping = resolveRegimeGrouping(locus, o, nS);
  const seed = grouping.assign;
  const K    = grouping.K_eff;
  const rows = [];
  for (let w = s; w <= e; w++) {
    const raw = ctx.getLabels(w);
    if (!raw) {
      rows.push({ w, agreement: NaN, cramers_v: NaN, is_supported: false, n_samples: 0 });
      continue;
    }
    let lab = raw;
    try {
      const al = alignLabels(seed, raw, K);
      if (al && al.aligned) lab = al.aligned;
      else if (al && Array.isArray(al)) lab = al;
    } catch (_) {}
    let match = 0, total = 0;
    const aBuf = [];
    const bBuf = [];
    for (let sid = 0; sid < seed.length; sid++) {
      const va = seed[sid], vb = lab[sid];
      if (va < 0 || vb < 0) continue;
      total++;
      aBuf.push(va); bBuf.push(vb);
      if (va === vb) match++;
    }
    let V = NaN;
    if (aBuf.length >= 4) {
      try {
        const tbl = buildContingency(Int32Array.from(aBuf), Int32Array.from(bBuf), K, K);
        const flat = _flattenContingency(tbl); V = flat ? cramersV(flat, K, K) : NaN;
      } catch (_) {}
    }
    const agr = total > 0 ? match / total : NaN;
    const ok  = _isNum(agr) && _isNum(V) && agr >= agrThr && V >= vThr;
    rows.push({ w, agreement: agr, cramers_v: V, is_supported: ok, n_samples: total });
  }
  return rows;
}

// ---------------------------------------------------------------------
// Per-sample regime call (homA_like / het_like / homB_like / uncertain)
// ---------------------------------------------------------------------

const SAMPLE_REGIME_CALLS = Object.freeze([
  'homA_like', 'het_like', 'homB_like', 'uncertain',
]);
export { SAMPLE_REGIME_CALLS };

/**
 * For each sample in the cohort, call its regime within this locus.
 * Strategy:
 *   1. Use the sample's K-band assignment (from per_band_samples).
 *   2. Look up the band's mean dosage; bin to homA / het / homB.
 *   3. Compute fraction_windows_supporting_call = fraction of windows
 *      in [s_window, e_window] where the sample remains in the same
 *      Hungarian-aligned band as at the seed window.
 *   4. Mark uncertain when band mean dosage falls between tiers OR
 *      fraction_supporting < uncertain_support_max.
 *
 * @returns {Array<{sample_idx:number, regime_call:string,
 *                  band_id:number, call_confidence:number,
 *                  fraction_windows_supporting_call:number,
 *                  notes:string|null}>}
 */
export function sampleRegimeCalls(args) {
  const a = args || {};
  const locus = a.locus;
  const ctx   = a.ctx;
  const dos   = a.dosage_per_sample;
  if (!locus || !ctx || typeof ctx.getLabels !== 'function') return [];
  const o = a.opts || {};
  const D = MGL_REGIME_CONSISTENCY_DEFAULTS;
  const tA  = _isNum(o.hom_a_dosage_max) ? o.hom_a_dosage_max : D.hom_a_dosage_max;
  const tHL = _isNum(o.het_dosage_lo)    ? o.het_dosage_lo    : D.het_dosage_lo;
  const tHH = _isNum(o.het_dosage_hi)    ? o.het_dosage_hi    : D.het_dosage_hi;
  const tB  = _isNum(o.hom_b_dosage_min) ? o.hom_b_dosage_min : D.hom_b_dosage_min;
  const uncSupMax = _isNum(o.uncertain_support_max) ? o.uncertain_support_max : 0.5;

  const s = locus.s_window | 0;
  const e = locus.e_window | 0;
  const seedRaw = ctx.getLabels(s);
  if (!seedRaw) return [];
  const nS = seedRaw.length;
  // Reference assignment honours regime override if provided.
  const grouping = resolveRegimeGrouping(locus, o, nS);
  const refAssign = grouping.assign;
  const K = grouping.K_eff;
  // Per-group dosage mean (over the resolved grouping, not the raw bands).
  const perBandDos = dos ? _groupDosageMean(grouping.group_samples, dos) : null;

  // Walk windows, counting per-sample matches to refAssign.
  const matches = new Int32Array(nS);
  const evals   = new Int32Array(nS);
  for (let w = s; w <= e; w++) {
    const raw = ctx.getLabels(w);
    if (!raw) continue;
    let lab = raw;
    try {
      const al = alignLabels(refAssign, raw, K);
      if (al && al.aligned) lab = al.aligned;
      else if (al && Array.isArray(al)) lab = al;
    } catch (_) {}
    for (let sid = 0; sid < nS; sid++) {
      const r = refAssign[sid], l = lab[sid];
      if (r < 0 || l < 0) continue;
      evals[sid]++;
      if (r === l) matches[sid]++;
    }
  }

  const out = [];
  for (let sid = 0; sid < nS; sid++) {
    const b = refAssign[sid];
    if (b < 0) continue;
    const supN = evals[sid];
    const supF = supN > 0 ? matches[sid] / supN : NaN;
    const bandMean = perBandDos ? perBandDos[b] : NaN;
    let call = 'uncertain';
    const notes = [];
    if (_isNum(bandMean)) {
      if (bandMean <= tA)                          call = 'homA_like';
      else if (bandMean >= tHL && bandMean <= tHH) call = 'het_like';
      else if (bandMean >= tB)                     call = 'homB_like';
      else                                         notes.push('band_dosage_between_tiers');
    } else {
      notes.push('no_band_dosage');
    }
    if (_isNum(supF) && supF < uncSupMax) {
      call = 'uncertain';
      notes.push('low_support_fraction');
    }
    // Confidence: support fraction × (band has clean dosage tier).
    const tierClean = (call !== 'uncertain' && _isNum(bandMean)) ? 1 : 0.5;
    const conf = _isNum(supF) ? supF * tierClean : NaN;
    out.push({
      sample_idx:                       sid,
      regime_call:                      call,
      band_id:                          b,
      call_confidence:                  conf,
      fraction_windows_supporting_call: supF,
      notes:                            notes.join(',') || null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Persistence bucket (local / regional / long_range / chromosome_scale)
// ---------------------------------------------------------------------

const PERSISTENCE_BUCKETS = Object.freeze([
  { name: 'local',             lo_bp:           0, hi_bp:   2_000_000 },
  { name: 'regional',          lo_bp:   2_000_000, hi_bp:  10_000_000 },
  { name: 'long_range',        lo_bp:  10_000_000, hi_bp:  50_000_000 },
  { name: 'chromosome_scale',  lo_bp:  50_000_000, hi_bp:    Infinity },
]);
export { PERSISTENCE_BUCKETS };

export function persistenceBucket(spanBp) {
  if (!_isNum(spanBp) || spanBp < 0) return null;
  for (const b of PERSISTENCE_BUCKETS) {
    if (spanBp >= b.lo_bp && spanBp < b.hi_bp) return b.name;
  }
  return null;
}

// ---------------------------------------------------------------------
// Regime class + confidence
// ---------------------------------------------------------------------

// Controlled vocabulary — DO NOT change without updating manuscript text.
// These describe long-range co-segregation patterns observed in band
// assignments; they do NOT make Mendelian / pedigree claims. Without
// ngsRelate or family annotation, the wording must remain "compatible
// with" rather than "proves".
export const REGIME_CLASSES = Object.freeze([
  'stable_three_band_regime',
  'stable_two_band_regime',
  'nested_multiband_regime',
  'split_regime',
  'diffuse_regime',
  'ancestry_confounded_regime',
  'low_confidence_regime',
]);

/**
 * Classify a candidate's regime from the consistency stats. Uses the
 * controlled vocabulary above; never claims Mendelian inheritance.
 *
 * Decision table (in order — first match wins):
 *   low_confidence_regime    — too few windows/pairs/samples
 *   diffuse_regime           — high noise (low V) regardless of support
 *   split_regime             — high V locally but low long-range support
 *   nested_multiband_regime  — K > 3 AND stable (≥ 3 active bands persist)
 *   stable_three_band_regime — K = 3, het band present, stable
 *   stable_two_band_regime   — K = 2, OR K = 3 with one collapsed band
 *   ancestry_confounded_regime
 *                            — flagged separately by qc.possible_ancestry,
 *                              else falls through
 */
export function regimeClass(stats) {
  if (!stats) return 'low_confidence_regime';
  const V        = _isNum(stats.mean_cramers_v)   ? stats.mean_cramers_v   : NaN;
  const sup      = _isNum(stats.support_fraction) ? stats.support_fraction : NaN;
  const nW       = _isNum(stats.n_windows)        ? stats.n_windows        : 0;
  const nPairs   = _isNum(stats.n_pairs)          ? stats.n_pairs          : 0;
  const nS       = _isNum(stats.n_samples)        ? stats.n_samples        : 0;
  const K        = _isNum(stats.n_bands)          ? stats.n_bands          : 0;
  const hetBand  = !!stats.heterozygote_band_present;
  const activeK  = _isNum(stats.active_band_count) ? stats.active_band_count : K;

  if (!_isNum(V) || nW < 4 || nPairs < 2 || nS < 8) return 'low_confidence_regime';
  if (stats.possible_ancestry_confounding === true)  return 'ancestry_confounded_regime';
  if (V < 0.25)                                      return 'diffuse_regime';
  if (V >= 0.5 && sup < 0.5)                         return 'split_regime';
  if (V >= 0.5 && sup >= 0.5) {
    if (activeK >= 3 && K >= 4)                      return 'nested_multiband_regime';
    if (K === 3 && hetBand && activeK === 3)         return 'stable_three_band_regime';
    return 'stable_two_band_regime';
  }
  // Borderline cases (mid V, mid support): fall through to low_confidence.
  return 'low_confidence_regime';
}

/**
 * Composite confidence ∈ [0, 1].
 *   span: log-scaled (more windows = more confidence, saturating at 50)
 *   V:    clipped at [0, 1]
 *   sup:  clipped at [0, 1]
 *   n:    sqrt-scaled (more samples = more confidence, saturating at 100)
 */
export function confidenceScore(stats) {
  if (!stats) return NaN;
  const V    = _isNum(stats.mean_cramers_v)   ? Math.max(0, Math.min(1, stats.mean_cramers_v)) : 0;
  const sup  = _isNum(stats.support_fraction) ? Math.max(0, Math.min(1, stats.support_fraction)) : 0;
  const nW   = _isNum(stats.n_windows)        ? stats.n_windows : 0;
  const nS   = _isNum(stats.n_samples)        ? stats.n_samples : 0;
  const wT   = Math.min(1, Math.log(1 + nW) / Math.log(1 + 50));
  const sT   = Math.min(1, Math.sqrt(nS) / 10);
  // Weights chosen so V + support dominate; span + n act as multipliers.
  const core = 0.45 * V + 0.45 * sup + 0.10;
  return Math.max(0, Math.min(1, core * (0.5 + 0.5 * wT) * (0.5 + 0.5 * sT)));
}

// ---------------------------------------------------------------------
// Per-locus summary row
// ---------------------------------------------------------------------

/**
 * @param {Object} args
 *   locus, ctx, dosage_per_sample, candidate?, chromName?, windowToBp?, opts?
 * @returns {Object} one summary-table row
 */
export function summarizeLocus(args) {
  const a = args || {};
  const locus = a.locus;
  const ctx   = a.ctx;
  const dos   = a.dosage_per_sample;
  const cand  = a.candidate || null;
  if (!locus || !ctx) return null;

  const K = locus.K | 0;
  const pattern = majorBandPattern(locus);
  const perBandDos = dos ? perBandDosageMean(locus, dos) : null;
  const hetPresent = perBandDos ? heterozygoteBandPresent(perBandDos, a.opts) : false;
  // Seed-anchored per-window agreement (drives support_windows).
  const perWindow = perWindowSeedAgreement(locus, ctx, a.opts);
  const supportWindows = perWindow.filter(r => r.is_supported).length;
  const nWindows = perWindow.length;
  const supportFraction = nWindows > 0 ? supportWindows / nWindows : NaN;
  // Window-to-window noise (adjacent V; complements seed-agreement).
  const vStats = meanCramersVAcrossWindows(locus, ctx, a.opts);
  // Active band count: bands that retain ≥ 2 samples (very small bands
  // are usually outliers / migrants / family artefacts).
  let activeBands = 0;
  for (const e of pattern.sorted) if (e.n >= 2) activeBands++;

  // homA / het / homB counts over ALL samples assigned to ANY band in this locus.
  const assignedIds = [];
  for (let b = 0; b < K; b++) {
    for (const sid of _toIndexArray(locus.per_band_samples, b)) assignedIds.push(sid);
  }
  const tier = dos
    ? dosageTierCounts(dos, assignedIds, a.opts)
    : { homA: 0, het: 0, homB: 0, n_eval: 0 };
  const uncertain = pattern.total - (tier.homA + tier.het + tier.homB);

  const s_bp = (cand && _isNum(cand.start_bp)) ? cand.start_bp
             : (typeof a.windowToBp === 'function'
                 ? a.windowToBp(locus.chromosome_idx, locus.s_window) : NaN);
  const e_bp = (cand && _isNum(cand.end_bp)) ? cand.end_bp
             : (typeof a.windowToBp === 'function'
                 ? a.windowToBp(locus.chromosome_idx, locus.e_window) : NaN);
  const chrom = (cand && cand.chrom) || (typeof a.chromName === 'function'
    ? a.chromName(locus.chromosome_idx) : null);

  // Mean seed-agreement across all evaluated windows.
  let agSum = 0, agN = 0;
  for (const r of perWindow) {
    if (_isNum(r.agreement)) { agSum += r.agreement; agN++; }
  }
  const meanSeedAgreement = agN > 0 ? agSum / agN : NaN;

  const stats = {
    mean_cramers_v:            vStats.mean_cramers_v,
    mean_agreement:            meanSeedAgreement,
    support_fraction:          supportFraction,
    n_windows:                 nWindows,
    n_pairs:                   vStats.n_pairs,
    n_samples:                 pattern.total,
    n_bands:                   K,
    active_band_count:         activeBands,
    heterozygote_band_present: hetPresent,
    // possible_ancestry_confounding: filled in by qc layer if available
    possible_ancestry_confounding: a.qc && a.qc.possible_ancestry_confounding,
  };
  const klass = regimeClass(stats);
  const conf  = confidenceScore(stats);
  const span_bp = (_isNum(s_bp) && _isNum(e_bp)) ? (e_bp - s_bp) : NaN;

  const notes = [];
  if (nWindows < 5)          notes.push('few_windows');
  if (vStats.n_pairs < 4)    notes.push('few_pairs');
  if (pattern.total < 8)     notes.push('few_samples');
  if (perBandDos && perBandDos.some(v => !_isNum(v))) notes.push('empty_band');
  if (uncertain > 0)         notes.push(`uncertain=${uncertain}`);

  return {
    candidate_id:               (cand && cand.id)                || locus.seed_id || null,
    chrom:                      chrom,
    start:                      _isNum(s_bp) ? s_bp : null,
    end:                        _isNum(e_bp) ? e_bp : null,
    seed_window:                locus.s_window | 0,
    n_samples:                  pattern.total,
    n_bands:                    K,
    active_band_count:          activeBands,
    major_band_pattern:         pattern.pattern,
    long_range_support_windows: supportWindows,
    support_span_mb:            _isNum(span_bp) ? span_bp / 1e6 : null,
    persistence_bucket:         persistenceBucket(span_bp),
    mean_contingency_agreement: meanSeedAgreement,
    mean_cramers_v:             vStats.mean_cramers_v,
    mean_pair_v:                vStats.mean_cramers_v,
    mean_pair_agreement:        vStats.mean_agreement,
    heterozygote_band_present:  hetPresent,
    homA_count:                 tier.homA,
    het_count:                  tier.het,
    homB_count:                 tier.homB,
    uncertain_count:            Math.max(0, uncertain),
    regime_class:               klass,
    confidence:                 conf,
    notes:                      notes.join(',') || null,
  };
}

// ---------------------------------------------------------------------
// Batch + length-bin aggregation
// ---------------------------------------------------------------------

/**
 * Summarize every locus in a banding-pipeline result. Candidates can
 * be passed in parallel so candidate_id / start_bp / end_bp / chrom
 * come from the candidate rather than ctx (more faithful to the
 * manuscript's interval definition).
 *
 * @param {Object} args
 *   result, ctx, dosage_per_sample, candidates?, chromName?, windowToBp?, opts?
 * @returns {Object[]}  summary rows, one per locus
 */
export function summarizeBandingResult(args) {
  const a = args || {};
  const result = a.result;
  if (!result || !result.stage3 || !Array.isArray(result.stage3.loci)) return [];
  const loci = result.stage3.loci;
  const cands = Array.isArray(a.candidates) ? a.candidates : null;
  const out = new Array(loci.length);
  for (let i = 0; i < loci.length; i++) {
    out[i] = summarizeLocus({
      locus:             loci[i],
      ctx:               a.ctx,
      dosage_per_sample: a.dosage_per_sample,
      candidate:         cands ? cands[i] : null,
      chromName:         a.chromName,
      windowToBp:        a.windowToBp,
      opts:              a.opts,
    });
  }
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------
// Transparent support score (manuscript-friendly, no magic single number)
// ---------------------------------------------------------------------

/**
 * Transparent linear blend of agreement / persistence / band-balance / qc.
 * Reported alongside the components — readers can recompute by hand.
 *
 *   support_score = 0.4 * agreement
 *                 + 0.3 * persistence
 *                 + 0.2 * band_balance
 *                 + 0.1 * qc
 *
 * where:
 *   agreement   = mean seed-agreement (clipped to [0, 1])
 *   persistence = min(1, n_supported_windows / 20)
 *   band_balance = 1 − Gini(per_band counts) [clipped to [0, 1]]
 *   qc          = 1 if no flags, else 0.5
 */
export function supportScore(row, opts) {
  if (!row) return NaN;
  const agr  = _isNum(row.mean_contingency_agreement)
    ? Math.max(0, Math.min(1, row.mean_contingency_agreement)) : 0;
  const sup  = Math.min(1, (row.long_range_support_windows | 0) / 20);
  const bal  = _bandBalance(row.major_band_pattern);
  const qc   = (row.notes && row.notes.length > 0) ? 0.5 : 1;
  return 0.4 * agr + 0.3 * sup + 0.2 * bal + 0.1 * qc;
}

function _bandBalance(patternStr) {
  if (!patternStr || typeof patternStr !== 'string') return 0;
  const counts = [];
  for (const part of patternStr.split('|')) {
    const m = /=(\d+)$/.exec(part);
    if (m) counts.push(+m[1]);
  }
  if (counts.length === 0) return 0;
  const total = counts.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  // 1 − normalised Gini. Even split = 1, single band = 0.
  const sorted = counts.slice().sort((a, b) => a - b);
  let gini = 0;
  const n = sorted.length;
  for (let i = 0; i < n; i++) gini += (2 * (i + 1) - n - 1) * sorted[i];
  gini = gini / (n * total);
  return Math.max(0, Math.min(1, 1 - gini));
}

// ---------------------------------------------------------------------
// 4-table bundle: candidate / sample / window / qc
// ---------------------------------------------------------------------

/**
 * Build all four manuscript tables in one call.
 *
 * @param {Object} args
 *   result, ctx, dosage_per_sample, candidates?, sample_ids?, chromName?,
 *   windowToBp?, opts?
 * @returns {{
 *   candidate_regime_summary: Array<Object>,
 *   sample_regime_calls:      Array<Object>,
 *   window_regime_support:    Array<Object>,
 *   regime_qc_summary:        Array<Object>,
 * }}
 */
export function buildRegimeTables(args) {
  const a = args || {};
  const result = a.result;
  if (!result || !result.stage3 || !Array.isArray(result.stage3.loci)) {
    return { candidate_regime_summary: [], sample_regime_calls: [],
             window_regime_support: [], regime_qc_summary: [] };
  }
  const loci = result.stage3.loci;
  const cands = Array.isArray(a.candidates) ? a.candidates : null;
  const sample_ids = Array.isArray(a.sample_ids) ? a.sample_ids : null;

  const candidate_regime_summary = [];
  const sample_regime_calls      = [];
  const window_regime_support    = [];
  const regime_qc_summary        = [];

  for (let i = 0; i < loci.length; i++) {
    const locus = loci[i];
    const cand  = cands ? cands[i] : null;
    const row = summarizeLocus({
      locus, ctx: a.ctx, dosage_per_sample: a.dosage_per_sample,
      candidate: cand, chromName: a.chromName, windowToBp: a.windowToBp,
      opts: a.opts, qc: cand && cand.qc,
    });
    if (!row) continue;
    row.support_score = supportScore(row, a.opts);
    candidate_regime_summary.push(row);

    // sample_regime_calls
    const calls = sampleRegimeCalls({
      locus, ctx: a.ctx, dosage_per_sample: a.dosage_per_sample, opts: a.opts,
    });
    for (const c of calls) {
      sample_regime_calls.push({
        candidate_id:                     row.candidate_id,
        sample_id:                        sample_ids ? sample_ids[c.sample_idx] : c.sample_idx,
        sample_idx:                       c.sample_idx,
        regime_call:                      c.regime_call,
        band_id:                          c.band_id,
        call_confidence:                  c.call_confidence,
        fraction_windows_supporting_call: c.fraction_windows_supporting_call,
        notes:                            c.notes,
      });
    }

    // window_regime_support
    const wRows = perWindowSeedAgreement(locus, a.ctx, a.opts);
    for (const wr of wRows) {
      window_regime_support.push({
        candidate_id:        row.candidate_id,
        window_id:           wr.w,
        chrom:               row.chrom,
        start:               (typeof a.windowToBp === 'function')
                                ? a.windowToBp(locus.chromosome_idx, wr.w) : null,
        end:                 null,        // window end_bp not always available
        n_bands:             row.n_bands,
        agreement_to_seed:   wr.agreement,
        cramers_v_to_seed:   wr.cramers_v,
        assigned_regime:     row.regime_class,
        is_supported:        wr.is_supported,
        n_samples:           wr.n_samples,
      });
    }

    // regime_qc_summary
    const qc = cand && cand.qc ? cand.qc : {};
    regime_qc_summary.push({
      candidate_id:                row.candidate_id,
      missingness:                 _isNum(qc.missingness)               ? qc.missingness               : null,
      n_samples_used:              row.n_samples,
      n_samples_excluded:          _isNum(qc.n_samples_excluded)        ? qc.n_samples_excluded        : null,
      n_windows_tested:            wRows.length,
      n_windows_supported:         row.long_range_support_windows,
      possible_ancestry_confounding: qc.possible_ancestry_confounding === true,
      possible_family_confounding:   qc.possible_family_confounding === true,
      confidence:                  row.confidence,
      regime_class:                row.regime_class,
      support_score:               row.support_score,
    });
  }

  return { candidate_regime_summary, sample_regime_calls,
           window_regime_support, regime_qc_summary };
}

// ---------------------------------------------------------------------
// TSV serializer (manuscript export-friendly)
// ---------------------------------------------------------------------

/**
 * Render a row[] to a TSV string. Header from row[0] keys (insertion
 * order). Nulls render as empty; non-finite numbers render as "NA".
 */
export function rowsToTsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join('\t')];
  for (const r of rows) {
    const cells = cols.map(k => {
      const v = r[k];
      if (v == null) return '';
      if (typeof v === 'number' && !Number.isFinite(v)) return 'NA';
      if (typeof v === 'number') {
        // Compact: integers as-is, floats to 6 sig figs.
        return Number.isInteger(v) ? String(v) : v.toPrecision(6);
      }
      return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    });
    lines.push(cells.join('\t'));
  }
  return lines.join('\n') + '\n';
}

/**
 * Length-binned aggregate. For each bin, count loci in that bin and
 * average the headline stats. Default bins in DEFAULT_LENGTH_BINS_BP.
 *
 * @param {Object[]} rows                 output of summarizeBandingResult
 * @param {Object}   [opts]               { bins, range_label } range_label
 *                                         flips bp scale to kb display
 * @returns {Array<{bin:string, n:number, mean_cramers_v:number,
 *                  mean_support:number, mean_confidence:number,
 *                  het_band_rate:number, regime_class_counts:Object}>}
 */
export function lengthBinAggregate(rows, opts) {
  const o = opts || {};
  const bins = Array.isArray(o.bins) && o.bins.length > 0
    ? o.bins : DEFAULT_LENGTH_BINS_BP;
  const out = bins.map(b => ({
    bin: b.name, lo_bp: b.lo, hi_bp: b.hi,
    n: 0,
    sum_v: 0, sum_sup: 0, sum_conf: 0,
    n_v: 0, n_sup: 0, n_conf: 0,
    het_band_n: 0,
    regime_class_counts: Object.create(null),
  }));
  for (const r of (rows || [])) {
    if (!r || !_isNum(r.start) || !_isNum(r.end)) continue;
    const span = r.end - r.start;
    let idx = -1;
    for (let i = 0; i < bins.length; i++) {
      if (span >= bins[i].lo && span < bins[i].hi) { idx = i; break; }
    }
    if (idx < 0) continue;
    const slot = out[idx];
    slot.n++;
    if (_isNum(r.mean_cramers_v))  { slot.sum_v   += r.mean_cramers_v;  slot.n_v++; }
    if (_isNum(r.long_range_support_windows) && _isNum(r.support_span_mb)) {
      // support fraction = support_windows / (support_span_mb implied n_windows)
      // We don't have n_windows here, so fall back to a normalised metric:
      // use confidence as a stand-in if support fraction not derivable.
    }
    if (_isNum(r.confidence))      { slot.sum_conf += r.confidence;     slot.n_conf++; }
    if (r.heterozygote_band_present) slot.het_band_n++;
    const cls = r.regime_class || 'unknown';
    slot.regime_class_counts[cls] = (slot.regime_class_counts[cls] || 0) + 1;
  }
  return out.map(s => ({
    bin:                s.bin,
    lo_bp:              s.lo_bp,
    hi_bp:              s.hi_bp,
    n:                  s.n,
    mean_cramers_v:     s.n_v    > 0 ? s.sum_v    / s.n_v    : NaN,
    mean_confidence:    s.n_conf > 0 ? s.sum_conf / s.n_conf : NaN,
    het_band_rate:      s.n > 0 ? s.het_band_n / s.n : NaN,
    regime_class_counts: s.regime_class_counts,
  }));
}
