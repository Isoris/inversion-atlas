// atlases/inversion/shared/active_candidate.js
//
// Cohort-wide persistence of the "active candidate" id (legacy line
// 57399). The user can pick a candidate from page1's bar or page2's
// list; we stash the selection in localStorage so it survives page
// reloads and so navigating between page1↔page2 lands on the same
// candidate.
//
// Three tiny helpers; all are headless-tolerant (no-op when
// localStorage is undefined).

export const ACTIVE_CANDIDATE_LS_KEY = 'pca_scrubber_v3.activeCandidateId';

/**
 * Save the id (empty string / null / undefined → clear). Fail-soft on
 * localStorage exceptions (quota, private-mode, etc.).
 */
export function persistActiveCandidateId(candId) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (candId) {
      localStorage.setItem(ACTIVE_CANDIDATE_LS_KEY, String(candId));
    } else {
      localStorage.removeItem(ACTIVE_CANDIDATE_LS_KEY);
    }
  } catch (_) { /* fail-soft */ }
}

/**
 * Read the persisted id, or null when none is stored. Fail-soft.
 */
export function loadActiveCandidateId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_CANDIDATE_LS_KEY) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Drop the persisted id. Convenience wrapper around the clear-path of
 * persistActiveCandidateId for callers that want an explicit name.
 */
export function clearActiveCandidateId() {
  persistActiveCandidateId(null);
}
