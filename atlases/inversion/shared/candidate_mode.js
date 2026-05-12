// shared/candidate_mode.js
//
// The Parallel Candidate Registry (PCR) mode system (legacy lines
// 37094-37410). Candidates can belong to either the 'default' system
// or the parallel 'detailed' system. Slots are kept strictly separate:
//
//   default:  state.candidate / state.candidates / state.candidateList
//   detailed: state.candidate_detailed / state.candidates_detailed /
//             state.candidateList_detailed
//
// The mode-system invariant: a candidate's `_system` tag must match
// the slot it lives in. Pre-turn-88 default candidates lack the tag
// and are treated as 'default'. This module ships the guards +
// state-init + cleanup helpers that enforce the invariant.

/** Frozen list of valid mode names. */
export const PCR_VALID_MODES = Object.freeze(['default', 'detailed']);

/** localStorage key for the persisted active mode. */
export const PCR_MODE_STORAGE_KEY = 'inversion_atlas.activeMode';

function _safeLocalStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

// =====================================================================
// State init + getters / setters
// =====================================================================

/**
 * Ensure the parallel-state slots exist on `state`. Idempotent.
 * Initialises `state.activeMode` from localStorage (falling back to
 * 'default') and creates the three detailed-system slots when missing.
 *
 * @param {Object} state
 * @param {{localStorage?:Storage}} opts
 * @returns {Object}  the same state, post-init
 */
export function pcrEnsureState(state, opts) {
  if (!state) return state;
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!state.activeMode) {
    let stored = null;
    if (ls) {
      try { stored = ls.getItem(PCR_MODE_STORAGE_KEY); }
      catch (_) { /* swallow */ }
    }
    state.activeMode = (PCR_VALID_MODES.indexOf(stored) >= 0) ? stored : 'default';
  }
  if (state.candidate_detailed === undefined) state.candidate_detailed = null;
  if (!Array.isArray(state.candidateList_detailed)) state.candidateList_detailed = [];
  if (typeof state.candidates_detailed !== 'object' || state.candidates_detailed === null) {
    state.candidates_detailed = {};
  }
  return state;
}

/**
 * Return the currently-active mode. Reads (and initialises) state via
 * pcrEnsureState.
 */
export function getActiveMode(state, opts) {
  pcrEnsureState(state, opts);
  return state ? state.activeMode : 'default';
}

/**
 * Switch the active mode. Persists to localStorage. Returns true on
 * success, false on an invalid mode value. Does NOT clear data —
 * default + detailed candidates coexist in their own slots.
 *
 * @param {Object} state
 * @param {string} mode
 * @param {{localStorage?:Storage}} opts
 * @returns {boolean}
 */
export function setActiveMode(state, mode, opts) {
  if (PCR_VALID_MODES.indexOf(mode) < 0) return false;
  pcrEnsureState(state, opts);
  state.activeMode = mode;
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (ls) {
    try { ls.setItem(PCR_MODE_STORAGE_KEY, mode); }
    catch (_) { /* swallow */ }
  }
  return true;
}

/**
 * Return the active candidate for the current mode. Routes default vs
 * detailed slot. Returns null when neither side has one.
 */
export function getActiveCandidate(state, opts) {
  pcrEnsureState(state, opts);
  if (!state) return null;
  return state.activeMode === 'detailed' ? state.candidate_detailed : state.candidate;
}

/**
 * Write the active candidate for the current mode. NEVER cross-writes
 * to the other mode's slot. Pass null to clear.
 */
export function setActiveCandidate(state, cand, opts) {
  pcrEnsureState(state, opts);
  if (!state) return cand;
  if (state.activeMode === 'detailed') {
    state.candidate_detailed = cand;
  } else {
    state.candidate = cand;
  }
  return cand;
}

/**
 * Return the saved-candidate list for the current mode. Returns the
 * actual array (not a copy) so callers can mutate directly.
 */
export function getActiveCandidateList(state, opts) {
  pcrEnsureState(state, opts);
  if (!state) return [];
  if (state.activeMode === 'detailed') {
    return Array.isArray(state.candidateList_detailed)
      ? state.candidateList_detailed : [];
  }
  return Array.isArray(state.candidateList) ? state.candidateList : [];
}

/**
 * Return the candidates map (object keyed by id) for the current mode.
 */
export function getActiveCandidatesMap(state, opts) {
  pcrEnsureState(state, opts);
  if (!state) return {};
  if (state.activeMode === 'detailed') {
    return state.candidates_detailed || {};
  }
  return state.candidates || {};
}

/**
 * Clear all detailed-system slots. Used when reloading a JSON or
 * switching chromosomes. Default-system slots are unaffected.
 */
export function clearDetailedState(state) {
  if (!state) return;
  state.candidate_detailed = null;
  state.candidateList_detailed = [];
  state.candidates_detailed = {};
}

// =====================================================================
// Deep-clone
// =====================================================================

/**
 * Cross-realm-safe deep clone for candidate objects. Handles typed
 * arrays (Int8/16/32, Uint8/32, Float32/64), regular arrays, and
 * plain-object recursion. Non-object scalars pass through unchanged.
 *
 * @param {*} c
 * @returns {*}
 */
export function pcrDeepCloneCandidate(c) {
  if (!c || typeof c !== 'object') return c;
  const ctorName = c.constructor && c.constructor.name;
  if (ctorName === 'Int8Array')    return new Int8Array(c);
  if (ctorName === 'Uint8Array')   return new Uint8Array(c);
  if (ctorName === 'Int16Array')   return new Int16Array(c);
  if (ctorName === 'Int32Array')   return new Int32Array(c);
  if (ctorName === 'Uint32Array')  return new Uint32Array(c);
  if (ctorName === 'Float32Array') return new Float32Array(c);
  if (ctorName === 'Float64Array') return new Float64Array(c);
  if (Array.isArray(c)) {
    return c.map(item => pcrDeepCloneCandidate(item));
  }
  const out = {};
  for (const key of Object.keys(c)) {
    out[key] = pcrDeepCloneCandidate(c[key]);
  }
  return out;
}

// =====================================================================
// Detailed-system initialiser
// =====================================================================

/**
 * Populate the detailed-system slots by cloning the default-system
 * candidates 1:1. Each clone is tagged with `_system='detailed'`.
 * Idempotent — running again on a state with existing detailed
 * candidates overwrites them with fresh clones (the legacy behavior).
 *
 * Returns the number of candidates duplicated into
 * state.candidates_detailed.
 *
 * @param {Object} state
 * @returns {number}
 */
export function initDetailedFromDefault(state) {
  pcrEnsureState(state);
  if (!state) return 0;
  let count = 0;

  if (state.candidates && typeof state.candidates === 'object') {
    for (const id of Object.keys(state.candidates)) {
      const c = state.candidates[id];
      if (!c) continue;
      const cloned = pcrDeepCloneCandidate(c);
      cloned._system = 'detailed';
      state.candidates_detailed[id] = cloned;
      count++;
    }
  }
  if (Array.isArray(state.candidateList)) {
    state.candidateList_detailed = state.candidateList.map(c => {
      const cloned = pcrDeepCloneCandidate(c);
      cloned._system = 'detailed';
      return cloned;
    });
  }
  if (state.candidate) {
    state.candidate_detailed = pcrDeepCloneCandidate(state.candidate);
    state.candidate_detailed._system = 'detailed';
  }
  return count;
}

// =====================================================================
// Mode guards
// =====================================================================

/**
 * Pass when `cand._system` (defaulting to 'default') matches the
 * requested mode. Null candidates pass (no-op). Pre-turn-88
 * candidates without a `_system` tag are treated as 'default'.
 *
 * @param {Object?} cand
 * @param {string} mode
 * @returns {boolean}
 */
export function assertCandidateMode(cand, mode) {
  if (!cand || typeof cand !== 'object') return true;
  const sys = cand._system || 'default';
  return sys === mode;
}

/**
 * Guard: pass when two candidates belong to the same mode (both
 * default or both detailed). Returns false on cross-mode comparisons.
 * Either candidate being null is treated as a no-op pass.
 *
 * @param {Object?} candA
 * @param {Object?} candB
 * @returns {boolean}
 */
export function assertSameMode(candA, candB) {
  if (!candA || !candB) return true;
  const sysA = candA._system || 'default';
  const sysB = candB._system || 'default';
  return sysA === sysB;
}

/**
 * Walk the parallel-state slots and verify the mode-system invariant.
 * Returns `{ ok, violations: [...] }`.
 *
 * Each violation row is shaped:
 *   { slot, expected, actual, id }
 *
 * @param {Object} state
 * @returns {{ok:boolean, violations:Array<Object>}}
 */
export function mergeIsolationAudit(state) {
  const violations = [];
  if (!state) return { ok: true, violations };

  // Default-system slots: NO _system='detailed' anywhere
  if (state.candidate && state.candidate._system === 'detailed') {
    violations.push({
      slot: 'state.candidate', expected: 'default', actual: 'detailed',
      id: state.candidate.id,
    });
  }
  if (Array.isArray(state.candidateList)) {
    for (const c of state.candidateList) {
      if (c && c._system === 'detailed') {
        violations.push({
          slot: 'candidateList', expected: 'default', actual: 'detailed',
          id: c.id,
        });
      }
    }
  }
  if (state.candidates && typeof state.candidates === 'object') {
    for (const id of Object.keys(state.candidates)) {
      const c = state.candidates[id];
      if (c && c._system === 'detailed') {
        violations.push({
          slot: 'candidates[' + id + ']', expected: 'default', actual: 'detailed',
          id,
        });
      }
    }
  }

  // Detailed-system slots: ALL must have _system='detailed'
  if (state.candidate_detailed && state.candidate_detailed._system !== 'detailed') {
    violations.push({
      slot: 'state.candidate_detailed', expected: 'detailed',
      actual: state.candidate_detailed._system || 'default',
      id: state.candidate_detailed.id,
    });
  }
  if (Array.isArray(state.candidateList_detailed)) {
    for (const c of state.candidateList_detailed) {
      if (c && c._system !== 'detailed') {
        violations.push({
          slot: 'candidateList_detailed', expected: 'detailed',
          actual: c._system || 'default', id: c.id,
        });
      }
    }
  }
  if (state.candidates_detailed && typeof state.candidates_detailed === 'object') {
    for (const id of Object.keys(state.candidates_detailed)) {
      const c = state.candidates_detailed[id];
      if (c && c._system !== 'detailed') {
        violations.push({
          slot: 'candidates_detailed[' + id + ']', expected: 'detailed',
          actual: c._system || 'default', id,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
