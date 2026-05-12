// shared/inheritance_cache_key.js
//
// Cache-key + label-fingerprint helpers for the inheritance compute
// pipeline (legacy lines 41257-41304). The cache key folds in:
//   - mode (default | detailed)
//   - cosine-distance threshold (rounded to 4dp to absorb slider jitter)
//   - per-candidate fingerprint of (id, K, bp range, label hash)
//
// Pure: no state mutation, no globals. Caller passes items + mode +
// threshold explicitly.

import { IGC_DEFAULT_DIST_THRESHOLD } from './inheritance_groups.js';

/**
 * FNV-style 32-bit polynomial rolling hash of an Int8/regular labels
 * array. Labels are shifted by +2 so 0 and -1 (NA sentinel) are
 * distinct contributions to the hash.
 *
 * Pure: returns the same hash for the same input. Not cryptographic;
 * collisions on 32-bit are negligible (~10⁻¹⁵ per pair) for the typical
 * 200-fish × 200-candidate cohort.
 *
 * @param {ArrayLike<number>?} labels
 * @returns {number}  unsigned 32-bit hash
 */
export function hashLockedLabels(labels) {
  if (!labels || !labels.length) return 0;
  let h = 0x811c9dc5 | 0;
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    h = (h * 31 + (labels[i] + 2)) | 0;
  }
  return h >>> 0;
}

/**
 * Compute the inheritance-cache key for a candidate set + mode +
 * threshold. The key is invalidated when any of:
 *   - the candidate id list changes
 *   - any candidate's K changes (re-clustering at a new K)
 *   - any candidate's locked_labels change (re-cluster with same K)
 *   - any candidate's start_bp / end_bp shifts (boundary refinement)
 *   - the cosine-distance threshold changes
 *
 * Threshold is rounded to 4 decimals so floating-point jitter doesn't
 * fragment the cache. Falls back to IGC_DEFAULT_DIST_THRESHOLD when
 * threshold is nullish.
 *
 * @param {Array<{id, K?, start_bp?, end_bp?, labels:ArrayLike<number>}>} items
 * @param {string} mode  'default' | 'detailed'
 * @param {number?} threshold  cosine-distance threshold (defaults to 0.15)
 * @returns {string}
 */
export function inheritanceCacheKey(items, mode, threshold) {
  const t = (threshold == null || !Number.isFinite(threshold))
    ? IGC_DEFAULT_DIST_THRESHOLD : +threshold;
  const tStr = (Math.round(t * 1e4) / 1e4).toFixed(4);
  const safeItems = Array.isArray(items) ? items : [];
  const parts = safeItems.map(it => {
    if (!it) return '@K?@?-?@0';
    const fp = hashLockedLabels(it.labels);
    const bp = (it.start_bp || 0) + '-' + (it.end_bp || 0);
    const K = (it.K != null) ? it.K : '?';
    return (it.id != null ? it.id : '?') + '@K' + K + '@' + bp + '@' + fp.toString(36);
  });
  const m = (typeof mode === 'string' && mode) ? mode : 'default';
  return m + '@t' + tStr + '::' + parts.join('|');
}

/**
 * Compare two cache keys. Convenience wrapper for the stale-cache
 * guard in pages that consume state.inheritanceResult.
 *
 * @param {string?} cached
 * @param {string?} expected
 * @returns {boolean}  true when both are non-null and equal
 */
export function inheritanceCacheKeysMatch(cached, expected) {
  return cached != null && expected != null && cached === expected;
}
