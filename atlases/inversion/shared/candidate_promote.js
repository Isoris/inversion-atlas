// shared/candidate_promote.js
//
// Candidate-builder helpers — the legacy "promote to candidate" entry
// points (lines 57469-57565). Each returns a fresh candidate object
// suitable for `addCandidateToList`:
//
//   - makeCandidateFromL2(state, l2idx, opts?)        — single L2 envelope
//   - makeCandidateFromL2Merge(state, l2idxs, opts?)  — merge ≥2 L2s
//   - makeCandidateFromLock(state, opts?)             — promote a lock-snapshot
//
// Every helper requires the caller to inject `opts.getCluster(l2idx)`
// to resolve the L2 cluster output (legacy reached `getL2Cluster` as
// a module-scope global). Pure: never mutates state.

import { makeCandidateId } from './candidate_io.js';

/**
 * Build a candidate from a single L2 envelope. Snapshots the
 * envelope's cluster labels so subsequent k-means cache flushes
 * don't change them.
 *
 * Returns null when:
 *   - state.data / state.data.l2_envelopes is missing
 *   - the L2 at l2idx is missing / lacks _s0+_e0
 *   - getCluster returns null / no labels
 *
 * @param {Object} state
 * @param {number} l2idx
 * @param {{getCluster:Function, defaultK?:number, now?:number}} opts
 * @returns {Object|null}
 */
export function makeCandidateFromL2(state, l2idx, opts) {
  if (!state || !state.data) return null;
  if (!Number.isInteger(l2idx)) return null;
  const o = opts || {};
  if (typeof o.getCluster !== 'function') return null;
  const envelopes = state.data.l2_envelopes;
  if (!Array.isArray(envelopes)) return null;
  const env = envelopes[l2idx];
  if (!env || !Number.isInteger(env._s0) || !Number.isInteger(env._e0)) return null;
  const cl = o.getCluster(l2idx);
  if (!cl || !cl.labels) return null;
  const defaultK = Number.isFinite(o.defaultK) ? o.defaultK
                  : (Number.isFinite(state.k) ? state.k : 3);
  const ref_window = Math.floor((env._s0 + env._e0) / 2);
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  return {
    source: 'l2_single',
    chrom: state.data.chrom || null,
    l2_indices: [l2idx],
    ref_l2: l2idx,
    ref_window,
    K: cl.usedK != null ? cl.usedK : defaultK,
    locked_labels: new Int8Array(cl.labels),
    start_w:  env._s0,
    end_w:    env._e0,
    start_bp: env.start_bp,
    end_bp:   env.end_bp,
    created_at: now,
    notes: '',
    id: makeCandidateId(),
  };
}

/**
 * Build a candidate from a merge of ≥2 L2 envelopes. The reference
 * L2 (used for label snapshot) is the middle one of the sorted set;
 * the start_w / end_w span is the union of all envelopes.
 *
 * Single-element l2idxs delegates to makeCandidateFromL2.
 *
 * @param {Object} state
 * @param {Array<number>} l2idxs
 * @param {{getCluster:Function, defaultK?:number, now?:number}} opts
 * @returns {Object|null}
 */
export function makeCandidateFromL2Merge(state, l2idxs, opts) {
  if (!state || !state.data) return null;
  if (!Array.isArray(l2idxs) || l2idxs.length === 0) return null;
  if (l2idxs.length === 1) return makeCandidateFromL2(state, l2idxs[0], opts);
  const o = opts || {};
  if (typeof o.getCluster !== 'function') return null;
  const envelopes = state.data.l2_envelopes;
  if (!Array.isArray(envelopes)) return null;

  const sortedIdxs = l2idxs.slice().sort((a, b) => {
    const ea = envelopes[a], eb = envelopes[b];
    if (!ea || !eb) return 0;
    return ea._s0 - eb._s0;
  });
  const envs = sortedIdxs.map(i => envelopes[i]).filter(Boolean);
  if (envs.length === 0) return null;

  const refIdx = sortedIdxs[Math.floor(sortedIdxs.length / 2)];
  const refEnv = envelopes[refIdx];
  if (!refEnv) return null;
  const refCl = o.getCluster(refIdx);
  if (!refCl || !refCl.labels) return null;

  const defaultK = Number.isFinite(o.defaultK) ? o.defaultK
                  : (Number.isFinite(state.k) ? state.k : 3);
  const ref_window = Math.floor((refEnv._s0 + refEnv._e0) / 2);
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  let startW = Infinity, endW = -Infinity;
  let startBp = Infinity, endBp = -Infinity;
  for (const e of envs) {
    if (e._s0 < startW) startW = e._s0;
    if (e._e0 > endW)   endW   = e._e0;
    if (e.start_bp < startBp) startBp = e.start_bp;
    if (e.end_bp   > endBp)   endBp   = e.end_bp;
  }
  return {
    source: 'l2_merge',
    chrom: state.data.chrom || null,
    l2_indices: sortedIdxs,
    ref_l2: refIdx,
    ref_window,
    K: refCl.usedK != null ? refCl.usedK : defaultK,
    locked_labels: new Int8Array(refCl.labels),
    start_w:  startW,
    end_w:    endW,
    start_bp: startBp,
    end_bp:   endBp,
    created_at: now,
    notes: '',
    id: makeCandidateId(),
  };
}

/**
 * Build a candidate from the current page1 lock snapshot. The user
 * locked colors at some L2 via the page1 toolbar; this helper
 * promotes that snapshot to a candidate.
 *
 * Requires:
 *   - state.lockedLabels   (Int8Array snapshot)
 *   - state.lockedRefL2    (the L2 idx the snapshot was taken at)
 *   - state.cur            (current focal window — used as ref_window)
 *
 * @param {Object} state
 * @param {{getCluster:Function, defaultK?:number, now?:number}} opts
 * @returns {Object|null}
 */
export function makeCandidateFromLock(state, opts) {
  if (!state || !state.data) return null;
  if (!state.lockedLabels || !Number.isInteger(state.lockedRefL2)) return null;
  const o = opts || {};
  const envelopes = state.data.l2_envelopes;
  if (!Array.isArray(envelopes)) return null;
  const refIdx = state.lockedRefL2;
  const env = envelopes[refIdx];
  if (!env || !Number.isInteger(env._s0) || !Number.isInteger(env._e0)) return null;

  const cl = (typeof o.getCluster === 'function') ? o.getCluster(refIdx) : null;
  const defaultK = Number.isFinite(o.defaultK) ? o.defaultK
                  : (Number.isFinite(state.k) ? state.k : 3);
  const K = (cl && cl.usedK != null) ? cl.usedK : defaultK;
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  return {
    source: 'lock_promote',
    chrom: state.data.chrom || null,
    l2_indices: [refIdx],
    ref_l2: refIdx,
    ref_window: Number.isInteger(state.cur) ? state.cur : null,
    K,
    locked_labels: new Int8Array(state.lockedLabels),
    start_w:  env._s0,
    end_w:    env._e0,
    start_bp: env.start_bp,
    end_bp:   env.end_bp,
    created_at: now,
    notes: '',
    id: makeCandidateId(),
  };
}
