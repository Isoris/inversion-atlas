// pages/discovery/page1/inheritance.js
//
// State-managed inheritance-group orchestrator (legacy lines
// 41184-41435 + 41536-41541). Wraps the pure
// inheritanceGroupClustering compute (shared/inheritance_groups.js)
// with:
//
//   - Item gathering from state.candidates / state.candidates_detailed
//     (filtering out auto-only candidates that haven't been confirmed
//     yet — they're displayed in the review tab but excluded from the
//     I·g pills until the user confirms).
//   - Cache management on state.inheritanceResult +
//     state.inheritanceCacheKey, keyed on a fingerprint of (mode,
//     threshold, per-candidate locked_labels hash, bp boundaries).
//   - Last-compute status surfaced on state.inheritanceLastStatus so
//     the G-panel inheritance tab can show "this is what happened" when
//     the user toggles the labels.
//
// All entry points take `state` as their first argument. Legacy used
// `window.state` / global `state` fallbacks; we drop those.

import {
  inheritanceGroupClustering,
  IGC_DEFAULT_DIST_THRESHOLD,
} from '../../../shared/inheritance_groups.js';
import { isAutoCandidate } from '../../../shared/candidate_predicates.js';

// Re-export the shared predicate at this module's URL too, so the
// existing test (tests/test_page1_inheritance.js) keeps working without
// edits. New callers should import from shared directly.
export { isAutoCandidate };

// =====================================================================
// Constants (legacy lines 41064-41069)
// =====================================================================

export const INH_LABEL_KEY              = 'inversion_atlas.linesInheritanceLabelsOn';
export const INH_LABELS_DEFAULT_ON      = true;
export const INH_LABEL_STRIP_HEIGHT     = 11;
export const INH_LABEL_STRIP_GAP_BELOW  = 1;
export const INH_LABEL_FONT_PX          = 9;
export const INH_LABEL_MIN_BAND_PX      = 12;   // skip labels in regions < 12px wide

// isAutoCandidate is now in shared/candidate_predicates.js (one-line
// pure predicate, library-shaped, page-independent). Re-exported at
// the top of this module for backward compat with callers that
// already imported it from here.

// =====================================================================
// Label fingerprint hash (legacy lines 41252-41261)
// =====================================================================

/**
 * FNV-ish 32-bit polynomial rolling hash over an array of label ints.
 * Returns an unsigned 32-bit integer. Not cryptographic — just enough
 * to disambiguate same-array vs different-array for cache keying.
 */
export function hashLockedLabels(labels) {
  if (!labels || !labels.length) return 0;
  let h = 0x811c9dc5 | 0;
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    // labels are int8 in [-1, K-1]; +2 keeps everything positive
    h = (h * 31 + (labels[i] + 2)) | 0;
  }
  return h >>> 0;
}

// =====================================================================
// Item gathering (legacy lines 41196-41237)
// =====================================================================

/**
 * Pull active candidates (with locked labels) from state for inheritance
 * compute. Filters out auto-only candidates per isAutoCandidate. Sorts
 * by start_bp and assigns seq_num (I1, I2, …) in chromosome order.
 */
export function gatherActiveCandidatesForInheritance(state) {
  if (!state) return [];
  const isDetailed = state.activeMode === 'detailed';
  const src = isDetailed ? state.candidates_detailed : state.candidates;
  if (!src || typeof src !== 'object') return [];
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
      K: c.K || (c.K_used) || state.k || 3,
      start_bp: c.start_bp,
      end_bp: c.end_bp,
      meta: { source: c.source, parent_l2: c.parent_l2 },
    });
  }
  out.sort((a, b) => a.start_bp - b.start_bp);
  for (let i = 0; i < out.length; i++) out[i].seq_num = i + 1;
  return out;
}

// =====================================================================
// Cache key (legacy lines 41279-41303)
// =====================================================================

/**
 * Build the cache fingerprint for an inheritance-compute call. Folds in
 * the threshold (rounded to 4 decimals so slider-induced floating-point
 * jitter doesn't fragment the cache), the activeMode, and a per-
 * candidate fingerprint of (id, K, bp range, locked_labels hash).
 *
 * @param {Array<{id, K, labels, start_bp, end_bp}>} items
 * @param {string} mode
 * @param {number} [threshold]  Override; falls back to default.
 * @returns {string}
 */
export function inheritanceCacheKey(items, mode, threshold) {
  const t = (threshold == null) ? IGC_DEFAULT_DIST_THRESHOLD : +threshold;
  const tStr = (Math.round(t * 1e4) / 1e4).toFixed(4);
  const parts = items.map(it => {
    const fp = hashLockedLabels(it.labels);
    const bp = `${it.start_bp || 0}-${it.end_bp || 0}`;
    return `${it.id}@K${it.K}@${bp}@${fp.toString(36)}`;
  });
  return `${mode}@t${tStr}::${parts.join('|')}`;
}

// =====================================================================
// Orchestrator (legacy lines 41305-41423)
// =====================================================================

/**
 * Compute (or fetch cached) inheritance-group clustering across the
 * active confirmed candidates. Mutates:
 *   state.inheritanceResult
 *   state.inheritanceCacheKey
 *   state.inheritanceLastStatus
 *
 * Returns the result object, or null when there are fewer than 2 items
 * or the compute throws / returns null.
 *
 * @param {object} state
 * @param {{force?: boolean, threshold?: number}} [opts]
 * @returns {object|null}
 */
export function runInheritanceCompute(state, opts) {
  if (!state) return null;
  const items = gatherActiveCandidatesForInheritance(state);
  const setStatus = (s) => {
    s.at = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    state.inheritanceLastStatus = s;
  };
  if (items.length < 2) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    setStatus({
      ok: false,
      reason: 'insufficient_items',
      n_items: items.length,
      message: 'Need ≥2 candidates with locked labels (you have ' + items.length + ').',
    });
    return null;
  }
  const mode = state.activeMode || 'default';
  let threshold;
  if (opts && opts.threshold != null) {
    threshold = +opts.threshold;
  } else if (Number.isFinite(state.gPanelInheritanceThreshold)) {
    threshold = state.gPanelInheritanceThreshold;
  } else {
    threshold = IGC_DEFAULT_DIST_THRESHOLD;
  }
  const cacheKey = inheritanceCacheKey(items, mode, threshold);
  if (!opts || !opts.force) {
    if (state.inheritanceCacheKey === cacheKey && state.inheritanceResult) {
      const cached = state.inheritanceResult;
      const n_groups = (cached.rtab && cached.rtab.group_ids)
                        ? cached.rtab.group_ids.length : 0;
      setStatus({
        ok: true,
        reason: 'cached',
        n_items: items.length,
        n_groups,
        threshold,
        message: 'cache hit: ' + n_groups + ' group' + (n_groups === 1 ? '' : 's')
                 + ' across ' + items.length + ' candidates',
      });
      return cached;
    }
  }
  let result = null;
  let computeErr = null;
  try {
    result = inheritanceGroupClustering(items, { threshold });
  } catch (e) {
    computeErr = e;
  }
  if (computeErr) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    setStatus({
      ok: false,
      reason: 'exception',
      n_items: items.length,
      threshold,
      error: String(computeErr && computeErr.message || computeErr),
      message: 'compute threw: ' + (computeErr && computeErr.message || computeErr),
    });
    return null;
  }
  if (!result) {
    state.inheritanceResult = null;
    state.inheritanceCacheKey = null;
    setStatus({
      ok: false,
      reason: 'null_result',
      n_items: items.length,
      threshold,
      message: 'compute returned null (no usable bands; check K values on items)',
    });
    return null;
  }
  // Augment with start_bp / end_bp / seq_num so the drawing code can
  // place pills without re-resolving via state.candidates.
  result.items_meta = items.map(it => ({
    id: it.id, K: it.K, seq_num: it.seq_num,
    start_bp: it.start_bp, end_bp: it.end_bp,
  }));
  state.inheritanceResult = result;
  state.inheritanceCacheKey = cacheKey;
  const n_groups = (result.rtab && result.rtab.group_ids)
                    ? result.rtab.group_ids.length : 0;
  setStatus({
    ok: true,
    reason: 'computed',
    n_items: items.length,
    n_groups,
    threshold,
    message: 'computed: ' + n_groups + ' group' + (n_groups === 1 ? '' : 's')
             + ' across ' + items.length + ' candidates @ threshold '
             + threshold.toFixed(2),
  });
  return result;
}

// =====================================================================
// Cache invalidation (legacy lines 41425-41435)
// =====================================================================

export function invalidateInheritanceCache(state) {
  if (!state) return;
  state.inheritanceResult = null;
  state.inheritanceCacheKey = null;
  state.inheritanceLastStatus = null;
}

// =====================================================================
// Label formatter (legacy lines 41536-41541)
// =====================================================================

export function formatInheritanceLabel(seq_num_lo, seq_num_hi, n_groups) {
  const range = (seq_num_lo === seq_num_hi)
    ? `I${seq_num_lo}`
    : `I${seq_num_lo}-${seq_num_hi}`;
  return `${range}·${n_groups}g`;
}
