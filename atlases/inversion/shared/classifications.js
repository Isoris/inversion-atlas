// shared/classifications.js
//
// Per-breakpoint manual classification overrides. The page16 multi-
// species UI auto-suggests both an architecture class (A-F) and an
// age model (YOUNG-POP / OLD-POLY / OLD-BP-YOUNG-INV / LINEAGE-KARYO
// / MULTI-AGE-HOTSPOT) for every cross-species breakpoint; this
// layer lets the user override either with a manual label + notes.
//
// Override always trumps auto-suggest when shown in chips / exports.
//
// Stored on state.classifications keyed by bp_id. Persisted as one
// JSON blob (most cohorts have <100 overrides, so per-bp keys would
// be wasteful).
//
// Legacy origin: lines 26737-26790 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

export const CLASSIFICATIONS_LS_KEY = 'inversion_atlas.classifications.v1';

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Initialization (legacy 26739-26753)
// =====================================================================

/**
 * Ensure state.classifications exists. Lazily restores from localStorage
 * the first time it's called. Idempotent — subsequent calls return the
 * existing dict in place. Returns the classifications dict.
 *
 * @param {Object} state
 * @returns {Object|null}
 */
export function initClassifications(state) {
  if (!state) return null;
  if (!state.classifications || typeof state.classifications !== 'object') {
    state.classifications = {};
    if (_hasLocalStorage()) {
      try {
        const raw = localStorage.getItem(CLASSIFICATIONS_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            state.classifications = parsed;
          }
        }
      } catch (_) { /* fail-soft */ }
    }
  }
  return state.classifications;
}

/**
 * Persist state.classifications as a single JSON blob. Stores `{}`
 * when state.classifications is missing so the LS key doesn't go
 * stale. Returns true on success.
 */
export function persistClassifications(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    localStorage.setItem(CLASSIFICATIONS_LS_KEY,
      JSON.stringify(state.classifications || {}));
    return true;
  } catch (_) {
    return false;
  }
}

// =====================================================================
// Per-bp accessors
// =====================================================================

/**
 * Merge `fields` into the override for `bpId`. Stamps updated_at on
 * write. Auto-initializes the classifications dict, auto-persists.
 * Returns false when bpId is missing / falsy.
 *
 * Typical `fields` shape:
 *   { architecture_class: 'A'..'F',
 *     age_model: 'YOUNG-POP'|...|'MULTI-AGE-HOTSPOT',
 *     confidence: 'low'|'medium'|'high',
 *     notes: string }
 */
export function setClassification(state, bpId, fields) {
  if (!state || !bpId) return false;
  const dict = initClassifications(state);
  if (!dict) return false;
  const prev = dict[bpId] || {};
  dict[bpId] = {
    ...prev,
    ...fields,
    updated_at: new Date().toISOString(),
  };
  persistClassifications(state);
  return true;
}

/**
 * Get the override for `bpId`. Returns null when no override has
 * been set. Auto-initializes the dict (so first-read after page
 * load rehydrates from LS).
 */
export function getClassification(state, bpId) {
  if (!state || !bpId) return null;
  initClassifications(state);
  return state.classifications[bpId] || null;
}

/**
 * Drop the override for `bpId`. Returns true when an override was
 * removed (auto-persists on success), false when none existed.
 */
export function clearClassification(state, bpId) {
  if (!state || !bpId) return false;
  initClassifications(state);
  if (state.classifications[bpId]) {
    delete state.classifications[bpId];
    persistClassifications(state);
    return true;
  }
  return false;
}
