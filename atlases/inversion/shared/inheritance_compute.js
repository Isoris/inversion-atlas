// shared/inheritance_compute.js
//
// Inheritance-compute orchestrator (legacy lines 41305-41435:
// runInheritanceCompute + invalidateInheritanceCache). Wires together
// the gather → cache-key → clustering → status pipeline.
//
// State slots written:
//   - state.inheritanceResult         the latest compute output
//   - state.inheritanceCacheKey       fingerprint that result matches
//   - state.inheritanceLastStatus     {ok, reason, message, ...} surfaced
//                                      to the UI for "what just happened"
//                                      pills
//
// Pure-ish: the helper does mutate state slots above, but only those
// — no DOM, no globals beyond what state explicitly carries. Caller
// passes state explicitly.

import { gatherActiveCandidatesForInheritance } from './inheritance_gather.js';
import { inheritanceCacheKey } from './inheritance_cache_key.js';
import {
  inheritanceGroupClustering,
  IGC_DEFAULT_DIST_THRESHOLD,
} from './inheritance_groups.js';

/**
 * Build the status payload + write it to state. Returns the status
 * object so callers (or tests) can assert on it directly.
 */
function _setStatus(state, payload) {
  payload.at = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
  if (state) state.inheritanceLastStatus = payload;
  return payload;
}

/**
 * Run the inheritance compute. Returns the result, or null when the
 * pipeline can't produce one. Always writes
 * state.inheritanceLastStatus with a structured diagnostic.
 *
 * Threshold resolution chain:
 *   1. opts.threshold (when finite)
 *   2. state.gPanelInheritanceThreshold (when finite)
 *   3. IGC_DEFAULT_DIST_THRESHOLD
 *
 * Cache-hit short-circuit fires when opts.force is falsy AND
 * state.inheritanceCacheKey matches the fingerprint of (items, mode,
 * threshold).
 *
 * @param {Object} state
 * @param {{threshold?:number, force?:boolean, mode?:string}} opts
 * @returns {Object|null}
 */
export function runInheritanceCompute(state, opts) {
  if (!state) return null;
  const o = opts || {};
  const items = gatherActiveCandidatesForInheritance(state, { mode: o.mode });

  if (items.length < 2) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    _setStatus(state, {
      ok: false,
      reason: 'insufficient_items',
      n_items: items.length,
      message: 'Need ≥2 candidates with locked labels (you have '
        + items.length + ').',
    });
    return null;
  }

  const mode = (typeof o.mode === 'string' && o.mode)
    ? o.mode : (state.activeMode || 'default');

  let threshold;
  if (o.threshold != null && Number.isFinite(+o.threshold)) {
    threshold = +o.threshold;
  } else if (Number.isFinite(state.gPanelInheritanceThreshold)) {
    threshold = state.gPanelInheritanceThreshold;
  } else {
    threshold = IGC_DEFAULT_DIST_THRESHOLD;
  }

  const cacheKey = inheritanceCacheKey(items, mode, threshold);

  if (!o.force) {
    if (state.inheritanceCacheKey === cacheKey && state.inheritanceResult) {
      const cached = state.inheritanceResult;
      const n_groups = (cached.rtab && Array.isArray(cached.rtab.group_ids))
        ? cached.rtab.group_ids.length : 0;
      _setStatus(state, {
        ok: true,
        reason: 'cached',
        n_items: items.length,
        n_groups,
        threshold,
        message: 'cache hit: ' + n_groups + ' group'
          + (n_groups === 1 ? '' : 's')
          + ' across ' + items.length + ' candidates',
      });
      return state.inheritanceResult;
    }
  }

  let result = null, computeErr = null;
  try {
    result = inheritanceGroupClustering(items,
      Object.assign({}, opts || {}, { threshold }));
  } catch (e) {
    computeErr = e;
  }
  if (computeErr) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    _setStatus(state, {
      ok: false,
      reason: 'exception',
      n_items: items.length,
      threshold,
      error: String((computeErr && computeErr.message) || computeErr),
      message: 'compute threw: '
        + ((computeErr && computeErr.message) || computeErr),
    });
    return null;
  }
  if (!result) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    _setStatus(state, {
      ok: false,
      reason: 'null_result',
      n_items: items.length,
      threshold,
      message: 'compute returned null (no usable bands; check K values)',
    });
    return null;
  }

  // Augment result with item-level metadata so downstream drawers can
  // map directly without re-resolving via state.candidates.
  result.items_meta = items.map(it => ({
    id: it.id, K: it.K, seq_num: it.seq_num,
    start_bp: it.start_bp, end_bp: it.end_bp,
  }));
  state.inheritanceResult = result;
  state.inheritanceCacheKey = cacheKey;
  const n_groups = (result.rtab && Array.isArray(result.rtab.group_ids))
    ? result.rtab.group_ids.length : 0;
  _setStatus(state, {
    ok: true,
    reason: 'computed',
    n_items: items.length,
    n_groups,
    threshold,
    message: 'computed: ' + n_groups + ' group'
      + (n_groups === 1 ? '' : 's')
      + ' across ' + items.length + ' candidates @ threshold '
      + threshold.toFixed(2),
  });
  return result;
}

/**
 * Drop the cached inheritance result + cache key + last-compute
 * status. Called by callers that mutate the candidate set (add /
 * remove / import) — the next runInheritanceCompute will recompute.
 *
 * @param {Object} state
 */
export function invalidateInheritanceCache(state) {
  if (!state) return;
  state.inheritanceResult = null;
  state.inheritanceCacheKey = null;
  state.inheritanceLastStatus = null;
}
