// shared/mgl_kinship_downweight.js
// =====================================================================
// Layer 0/1 noise removal: kinship-aware per-sample weights for use
// when computing population-level statistics (π, dXY, FST) so close
// relatives and hatchery duplicates don't double-count in deep
// inference.
//
// Inputs (whichever is available):
//   - kinship matrix (n × n, symmetric, diagonal = 1 for self-self)
//   - family ids (one per sample; samples in the same family
//     downweighted)
//   - hatchery_dup flags (bool per sample; true → suspected duplicate)
//
// Output: weight in [0..1] per sample. Aggregation rules:
//   final_weight = base_weight * kinship_weight * family_weight
//                  * (hatchery_dup ? duplicate_weight : 1)
//
// kinship_weight  = 1 - max(kinship[i, j]) for j ≠ i above threshold
// family_weight   = 1 / size_of_family
//
// Pure compute. No DOM.
// =====================================================================

export const MGL_KINSHIP_DEFAULTS = Object.freeze({
  kinship_threshold:   0.10,
  duplicate_weight:    0.0,
});

/**
 * Per-sample kinship-derived weight.
 *
 * @param {Float64Array|null} kinship   n × n symmetric
 * @param {number} n
 * @param {number} threshold
 * @returns {Float64Array}              length n
 */
export function kinshipWeights(kinship, n, threshold) {
  const w = new Float64Array(n).fill(1);
  if (!kinship || kinship.length !== n * n) return w;
  const thr = Number.isFinite(threshold) ? threshold : MGL_KINSHIP_DEFAULTS.kinship_threshold;
  for (let i = 0; i < n; i++) {
    let maxKin = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const k = kinship[i * n + j];
      if (!Number.isFinite(k)) continue;
      if (k > thr && k > maxKin) maxKin = k;
    }
    w[i] = Math.max(0, 1 - maxKin);
  }
  return w;
}

/**
 * Family-size-derived weight (1 / family_size).
 *
 * @param {Array<*>|null} family_ids   length n; null/undefined → singleton
 * @param {number} n
 * @returns {Float64Array}             length n
 */
export function familyWeights(family_ids, n) {
  const w = new Float64Array(n).fill(1);
  if (!Array.isArray(family_ids)) return w;
  const sizes = new Map();
  for (let i = 0; i < n; i++) {
    const f = family_ids[i];
    if (f == null) continue;
    sizes.set(f, (sizes.get(f) || 0) + 1);
  }
  for (let i = 0; i < n; i++) {
    const f = family_ids[i];
    if (f == null) continue;
    const sz = sizes.get(f) || 1;
    w[i] = sz > 0 ? 1 / sz : 1;
  }
  return w;
}

/**
 * Compose all weights into a final per-sample weight.
 *
 * @param {Object} args
 *   n_samples, kinship?, family_ids?, hatchery_dup?, threshold?
 * @returns {Float64Array}
 */
export function computeSampleWeights(args) {
  const a = args || {};
  const n = a.n_samples | 0;
  if (n === 0) return new Float64Array(0);
  const o = a.opts || {};
  const dupWeight = Number.isFinite(o.duplicate_weight) ? o.duplicate_weight
                                                        : MGL_KINSHIP_DEFAULTS.duplicate_weight;
  const wK = kinshipWeights(a.kinship, n, o.kinship_threshold);
  const wF = familyWeights(a.family_ids, n);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let w = wK[i] * wF[i];
    if (Array.isArray(a.hatchery_dup) && a.hatchery_dup[i]) w *= dupWeight;
    out[i] = w;
  }
  return out;
}

/**
 * Summary verdict counts.
 *
 * @param {Float64Array} weights
 * @returns {{n_clean:number, n_downweighted:number, n_excluded:number,
 *            n_total:number, mean_weight:number}}
 */
export function weightsSummary(weights) {
  const n = weights ? weights.length : 0;
  let n_clean = 0, n_dw = 0, n_ex = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    sum += w;
    if (w === 0)           n_ex++;
    else if (w >= 0.9)     n_clean++;
    else                   n_dw++;
  }
  return {
    n_clean, n_downweighted: n_dw, n_excluded: n_ex, n_total: n,
    mean_weight: n > 0 ? sum / n : NaN,
  };
}
