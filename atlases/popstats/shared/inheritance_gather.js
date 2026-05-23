// shared/inheritance_gather.js
//
// Collect the active candidate set for inheritance compute (legacy
// lines 41196-41245 _gatherActiveCandidatesForInheritance). Reads
// state.candidates (or state.candidates_detailed when active mode is
// 'detailed'), drops unconfirmed auto-promotions + candidates without
// valid locked_labels, sorts by start_bp ascending, and assigns
// sequence numbers (I1, I2, ...).
//
// The output shape feeds inheritanceGroupClustering, the tracked-
// linkage projection, the I·g pills on candidate_focus, and the
// inheritance-cache-key hashing pipeline.

import { isAutoCandidate } from '../../inversion/shared/candidate_predicates.js';

/**
 * Gather candidates eligible for inheritance compute. Returns
 * Array<{id, labels, K, start_bp, end_bp, seq_num, meta}>:
 *
 *   - mode='detailed' reads state.candidates_detailed
 *   - mode='default' (or anything else) reads state.candidates
 *   - drops entries without locked_labels / valid bp range
 *   - drops unconfirmed auto-promotions (isAutoCandidate)
 *   - sorts ascending by start_bp; assigns 1-indexed seq_num
 *
 * `meta` carries source + parent_l2 for downstream uses (the
 * tracked-linkage strip uses seq_num for the "I3·b2 · 96%" label;
 * other consumers may want parent_l2 context).
 *
 * Pure: caller passes state explicitly. Falls back to the default K
 * (via state.k) when a candidate is missing its own K / K_used.
 *
 * @param {Object} state
 * @param {{mode?:string, defaultK?:number}} opts
 * @returns {Array<Object>}
 */
export function gatherActiveCandidatesForInheritance(state, opts) {
  if (!state) return [];
  const o = opts || {};
  const mode = (typeof o.mode === 'string' && o.mode) ? o.mode
             : (typeof state.activeMode === 'string' ? state.activeMode : 'default');
  const src = (mode === 'detailed') ? state.candidates_detailed : state.candidates;
  if (!src || typeof src !== 'object') return [];

  const defaultK = Number.isFinite(o.defaultK) ? o.defaultK
                  : (Number.isFinite(state.k) ? state.k : 3);

  const out = [];
  for (const id of Object.keys(src)) {
    const c = src[id];
    if (!c) continue;
    if (!c.locked_labels || !c.locked_labels.length) continue;
    if (typeof c.start_bp !== 'number' || typeof c.end_bp !== 'number') continue;
    if (isAutoCandidate(c)) continue;
    out.push({
      id: String(id),
      labels: c.locked_labels,
      K: c.K || c.K_used || defaultK,
      start_bp: c.start_bp,
      end_bp: c.end_bp,
      meta: { source: c.source, parent_l2: c.parent_l2 },
    });
  }
  out.sort((a, b) => a.start_bp - b.start_bp);
  for (let i = 0; i < out.length; i++) out[i].seq_num = i + 1;
  return out;
}
