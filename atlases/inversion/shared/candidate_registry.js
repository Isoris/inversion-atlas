// shared/candidate_registry.js
//
// In-memory candidate registry CRUD + localStorage persistence
// (legacy lines 57304-57435). Wraps state.candidateList mutations
// with persistence + optional caller notifications (re-render hooks,
// inheritance-cache invalidation).
//
// Pure: caller passes state explicitly and supplies callbacks for
// downstream side-effects (registry rebuild, inheritance recompute,
// UI re-renders). The legacy reached for module-scope state + global
// `_rebuildCandidateRegistries` / `_autoRegisterInheritanceOnCandidateChange`
// / `refreshCandidateListUI` etc. — the cartridge port keeps those
// behind opts so headless callers + atlas-core consumers can wire
// their own observers.

import { candidateToJSON } from './candidate_io.js';

/** localStorage key prefix for the per-chromosome candidate list. */
export const CAND_STORAGE_PREFIX = 'pca_scrubber_v3.candidates.';

/** localStorage key for the persisted active-candidate id. */
export const ACTIVE_CAND_STORAGE_KEY = 'pca_scrubber_v3.activeCandidateId';

function _safeLocalStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

/**
 * Build the localStorage key for a chromosome's candidate list.
 *
 * @param {string?} chrom
 * @returns {string}
 */
export function candStorageKey(chrom) {
  return CAND_STORAGE_PREFIX + (chrom || '_unknown');
}

// =====================================================================
// Predicates
// =====================================================================

/**
 * True when a candidate with the given id is already in
 * state.candidateList.
 *
 * @param {Object} state
 * @param {string} id
 * @returns {boolean}
 */
export function isInCandidateList(state, id) {
  if (!state || !Array.isArray(state.candidateList)) return false;
  return state.candidateList.some(c => c && c.id === id);
}

// =====================================================================
// CRUD
// =====================================================================

/**
 * Add a candidate to state.candidateList. No-ops when:
 *   - cand is null / missing id
 *   - id already present (idempotent)
 *
 * Returns true if the candidate was newly added.
 *
 * @param {Object} state
 * @param {Object} cand
 * @param {{onPersist?:Function, onChange?:Function}} opts
 * @returns {boolean}
 */
export function addCandidateToList(state, cand, opts) {
  if (!state || !cand || !cand.id) return false;
  if (!Array.isArray(state.candidateList)) state.candidateList = [];
  if (isInCandidateList(state, cand.id)) return false;
  state.candidateList.push(cand);
  _runPersist(state, opts);
  return true;
}

/**
 * Remove the candidate with the given id from state.candidateList.
 * Returns true if an entry was removed.
 *
 * Replaces state.candidateList with a new filtered array (matches the
 * legacy convention so consumers holding the old array reference see
 * the unfiltered version — by-design for snapshot reads).
 *
 * @param {Object} state
 * @param {string} id
 * @param {{onPersist?:Function, onChange?:Function}} opts
 * @returns {boolean}
 */
export function removeCandidateFromList(state, id, opts) {
  if (!state || !Array.isArray(state.candidateList)) return false;
  if (!isInCandidateList(state, id)) return false;
  state.candidateList = state.candidateList.filter(c => c && c.id !== id);
  _runPersist(state, opts);
  return true;
}

// =====================================================================
// Persistence
// =====================================================================

function _runPersist(state, opts) {
  const o = opts || {};
  // The persistence write itself
  try { persistCandidateList(state, opts); } catch (_) { /* swallow */ }
  // Caller hooks for downstream notifications
  if (typeof o.onPersist === 'function') {
    try { o.onPersist(state); } catch (_) { /* swallow */ }
  }
  if (typeof o.onChange === 'function') {
    try { o.onChange(state); } catch (_) { /* swallow */ }
  }
}

/**
 * Persist state.candidateList to localStorage under the legacy key.
 * No-op when state.data / chrom is missing or localStorage shim is
 * absent.
 *
 * The legacy run also called `_rebuildCandidateRegistries` (sync
 * state.candidates dict) and `_autoRegisterInheritanceOnCandidateChange`
 * (invalidate inheritance cache). These are caller-owned in the
 * cartridge port; supply them via opts.rebuildRegistries /
 * opts.invalidateInheritance for the same behaviour.
 *
 * @param {Object} state
 * @param {{rebuildRegistries?:Function, invalidateInheritance?:Function, localStorage?:Storage}} opts
 */
export function persistCandidateList(state, opts) {
  if (!state) return;
  const o = opts || {};
  // 1. Sync state.candidates dict (caller-owned bridge)
  if (typeof o.rebuildRegistries === 'function') {
    try { o.rebuildRegistries(state); } catch (_) { /* swallow */ }
  }
  // 2. Invalidate inheritance cache when candidate set changed
  if (typeof o.invalidateInheritance === 'function') {
    try { o.invalidateInheritance(state); } catch (_) { /* swallow */ }
  }
  // 3. localStorage write
  if (!state.data) return;
  const ls = o.localStorage || _safeLocalStorage();
  if (!ls) return;
  try {
    const key = candStorageKey(state.data.chrom);
    const arr = (state.candidateList || []).map(c => candidateToJSON(c));
    ls.setItem(key, JSON.stringify(arr));
  } catch (_) {
    // localStorage may be unavailable (private mode, quota); list
    // still works in memory. Fail-soft.
  }
}

/**
 * Restore state.candidateList from localStorage. Returns the restored
 * array (and assigns it to state.candidateList). When no entry exists,
 * leaves state.candidateList untouched and returns the current value.
 *
 * `fromJSON` is the deserialiser callback (typically candidateFromJSON
 * from candidate_io.js); injected so callers can decide whether to
 * also recompute per-track assignments.
 *
 * @param {Object} state
 * @param {{fromJSON:Function, localStorage?:Storage}} opts
 * @returns {Array<Object>}
 */
export function restoreCandidateList(state, opts) {
  if (!state) return [];
  const o = opts || {};
  if (typeof o.fromJSON !== 'function') {
    return Array.isArray(state.candidateList) ? state.candidateList : [];
  }
  const ls = o.localStorage || _safeLocalStorage();
  if (!ls || !state.data) {
    return Array.isArray(state.candidateList) ? state.candidateList : [];
  }
  try {
    const key = candStorageKey(state.data.chrom);
    const raw = ls.getItem(key);
    if (!raw) return Array.isArray(state.candidateList) ? state.candidateList : [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return state.candidateList || [];
    state.candidateList = parsed.map(obj => o.fromJSON(obj)).filter(c => c != null);
    return state.candidateList;
  } catch (_) {
    return Array.isArray(state.candidateList) ? state.candidateList : [];
  }
}

// =====================================================================
// Active-candidate id persistence
// =====================================================================

/**
 * Persist the active-candidate id so a reload can restore focus.
 * Passing null / empty / undefined clears the saved id.
 *
 * @param {string|null} candId
 * @param {{localStorage?:Storage}} opts
 */
export function persistActiveCandidateId(candId, opts) {
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls) return;
  try {
    if (candId) {
      ls.setItem(ACTIVE_CAND_STORAGE_KEY, String(candId));
    } else {
      ls.removeItem(ACTIVE_CAND_STORAGE_KEY);
    }
  } catch (_) { /* fail-soft */ }
}

/**
 * Restore the previously-persisted active-candidate id. Returns null
 * when no id is saved or localStorage is unavailable.
 *
 * @param {{localStorage?:Storage}} opts
 * @returns {string|null}
 */
export function restoreActiveCandidateId(opts) {
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls) return null;
  try {
    const v = ls.getItem(ACTIVE_CAND_STORAGE_KEY);
    return v || null;
  } catch (_) {
    return null;
  }
}

/**
 * Clear all candidates for a chromosome — both in memory and in
 * localStorage. Used by full-reset paths.
 *
 * @param {Object} state
 * @param {{localStorage?:Storage}} opts
 */
export function clearCandidateList(state, opts) {
  if (!state) return;
  state.candidateList = [];
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls || !state.data) return;
  try {
    const key = candStorageKey(state.data.chrom);
    ls.removeItem(key);
  } catch (_) { /* swallow */ }
}
