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

import { getPC } from './pc_accessors.js';

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
