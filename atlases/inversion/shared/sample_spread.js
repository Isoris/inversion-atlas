// shared/sample_spread.js
//
// Per-sample σ of sign-aligned PC1 across an arbitrary window range
// (legacy lines 10294-10330: sampleSpreadL2 + sampleSpreadRange).
// Used by candidate page2 (σ across a candidate's full span, possibly
// multiple L2s), the karyotype subview's high-σ marker, and the
// sigma-profile classifier.
//
// Pure: caller passes state explicitly. Uses the shared getPC accessor
// from pc_accessors.js, which respects state.flipPC1 + state.pc1Sign.

import { getPC, getPCByAxis } from './pc_accessors.js';

/**
 * Compute per-sample σ of sign-aligned PC1 across the inclusive
 * window range [startW, endW]. Returns Float64Array(n_samples) of σ
 * values, or null when the inputs aren't usable.
 *
 * Algorithm:
 *   1. mean[si] = mean over [startW..endW] of (pc1[si] × sign)
 *   2. sd[si] = sqrt( sum((pc1[si]×sign - mean[si])²) / (nW - 1) )
 *
 * Returns null when:
 *   - state / state.data is missing
 *   - nW < 2 (need at least 2 windows for sample variance)
 *   - n_samples is not finite
 *   - getPC returns null for any window in the range
 *
 * @param {Object} state
 * @param {number} startW   inclusive start window index
 * @param {number} endW     inclusive end window index
 * @returns {Float64Array|null}
 */
export function sampleSpreadRange(state, startW, endW) {
  if (!state || !state.data) return null;
  if (!Number.isInteger(startW) || !Number.isInteger(endW)) return null;
  const nW = endW - startW + 1;
  if (nW < 2) return null;
  const nS = state.data.n_samples;
  if (!Number.isFinite(nS) || nS <= 0) return null;

  const mean = new Float64Array(nS);
  const sumSq = new Float64Array(nS);

  for (let w = 0; w < nW; w++) {
    const pc = getPC(state, startW + w);
    if (!pc || !pc.pc1) return null;
    const { pc1, sign } = pc;
    for (let si = 0; si < nS; si++) mean[si] += pc1[si] * sign;
  }
  for (let si = 0; si < nS; si++) mean[si] /= nW;
  for (let w = 0; w < nW; w++) {
    const pc = getPC(state, startW + w);
    if (!pc || !pc.pc1) return null;
    const { pc1, sign } = pc;
    for (let si = 0; si < nS; si++) {
      const v = pc1[si] * sign - mean[si];
      sumSq[si] += v * v;
    }
  }
  const sd = new Float64Array(nS);
  for (let si = 0; si < nS; si++) sd[si] = Math.sqrt(sumSq[si] / (nW - 1));
  return sd;
}

/**
 * Per-sample σ on an arbitrary single PC axis (pc1/pc2/pc3/pc4).
 * Default is PC1 (matching legacy sampleSpreadRange). Sign-flip
 * only applies to PC1 — PC2/3/4 have no canonical orientation rule
 * (consistent with pc_accessors.getPCRender).
 *
 * Returns Float64Array(n_samples) of σ values, or null on usable-
 * input failure.
 *
 * @param {Object} state
 * @param {number} startW   inclusive start window index
 * @param {number} endW     inclusive end window index
 * @param {string?} axis    one of 'pc1' | 'pc2' | 'pc3' | 'pc4'
 *                          (defaults to 'pc1')
 * @returns {Float64Array|null}
 */
export function sampleSpreadRangeAxis(state, startW, endW, axis) {
  if (!state || !state.data) return null;
  if (!Number.isInteger(startW) || !Number.isInteger(endW)) return null;
  const nW = endW - startW + 1;
  if (nW < 2) return null;
  const nS = state.data.n_samples;
  if (!Number.isFinite(nS) || nS <= 0) return null;
  const ax = axis || 'pc1';

  const mean = new Float64Array(nS);
  const sumSq = new Float64Array(nS);

  for (let w = 0; w < nW; w++) {
    const wi = startW + w;
    const arr = getPCByAxis(state, wi, ax);
    if (!arr) return null;
    // Sign-flip applies to PC1 only
    const sign = (ax === 'pc1' && state.flipPC1 && state.pc1Sign
                  && Number.isInteger(wi))
      ? (state.pc1Sign[wi] || 1) : 1;
    for (let si = 0; si < nS; si++) mean[si] += arr[si] * sign;
  }
  for (let si = 0; si < nS; si++) mean[si] /= nW;
  for (let w = 0; w < nW; w++) {
    const wi = startW + w;
    const arr = getPCByAxis(state, wi, ax);
    if (!arr) return null;
    const sign = (ax === 'pc1' && state.flipPC1 && state.pc1Sign
                  && Number.isInteger(wi))
      ? (state.pc1Sign[wi] || 1) : 1;
    for (let si = 0; si < nS; si++) {
      const v = arr[si] * sign - mean[si];
      sumSq[si] += v * v;
    }
  }
  const sd = new Float64Array(nS);
  for (let si = 0; si < nS; si++) sd[si] = Math.sqrt(sumSq[si] / (nW - 1));
  return sd;
}

/**
 * Per-sample σ aggregated across multiple PC axes via Euclidean
 * combine: sqrt(sum_axes(σ_axis²)). Useful when projecting drift
 * across the full PCA subspace (e.g. NPC=4 PC1+PC2+PC3+PC4).
 *
 * Each axis's σ is computed independently via sampleSpreadRangeAxis.
 * Returns null when any axis returns null.
 *
 * @param {Object} state
 * @param {number} startW
 * @param {number} endW
 * @param {Array<string>?} axes  defaults to ['pc1']
 * @returns {Float64Array|null}
 */
export function sampleSpreadRangeAxes(state, startW, endW, axes) {
  const axList = (Array.isArray(axes) && axes.length > 0) ? axes : ['pc1'];
  const perAxis = [];
  for (const ax of axList) {
    const sd = sampleSpreadRangeAxis(state, startW, endW, ax);
    if (!sd) return null;
    perAxis.push(sd);
  }
  const nS = perAxis[0].length;
  const combined = new Float64Array(nS);
  for (let si = 0; si < nS; si++) {
    let sumSq = 0;
    for (const sd of perAxis) sumSq += sd[si] * sd[si];
    combined[si] = Math.sqrt(sumSq);
  }
  return combined;
}

/**
 * Per-sample σ across an L2 envelope's window range. Convenience
 * wrapper over sampleSpreadRange that pulls `_s0` / `_e0` (the
 * window indices) off the envelope.
 *
 * Returns null when the envelope is missing or doesn't carry the
 * `_s0` / `_e0` indices.
 *
 * @param {Object} state
 * @param {number} l2idx
 * @returns {Float64Array|null}
 */
export function sampleSpreadL2(state, l2idx) {
  if (!state || !state.data) return null;
  if (!Array.isArray(state.data.l2_envelopes)) return null;
  const env = state.data.l2_envelopes[l2idx];
  if (!env || !Number.isInteger(env._s0) || !Number.isInteger(env._e0)) return null;
  return sampleSpreadRange(state, env._s0, env._e0);
}
