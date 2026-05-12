// pages/discovery/page1/active_samples.js
//
// Active-samples filter (legacy lines 46279-46417). A cohort-wide
// persistent subset that lets the user mark samples as inactive
// (excluded from rendering) with optional per-sample reasons. The
// filter is keyed on CGA (preferred) or `ind` so it survives JSON
// reloads even when sample indices shift.
//
// Storage: a single localStorage entry keyed by ACTIVE_SAMPLES_LS_KEY
// (cohort-wide, not per-chromosome). Schema-versioned for forward
// compat.
//
// State slots written:
//   state.activeSampleSet     — Set<sample_index> | null (null = all active)
//   state.activeSampleReasons — Map<sample_index, string>
//
// Legacy referenced `state` and `localStorage` as globals; the
// modern entry points take `state` as their first argument and probe
// for `typeof localStorage` so they're safe to call from Node tests
// (where neither global is bound).

// ---------------------------------------------------------------------
// Storage schema
// ---------------------------------------------------------------------

export const ACTIVE_SAMPLES_LS_KEY = 'pca_scrubber_v3.active_samples';
export const ACTIVE_SAMPLES_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------
// CGA <-> sample_index helpers
// ---------------------------------------------------------------------

/**
 * Resolve the canonical sample identifier (CGA preferred, ind fallback)
 * for a given sample slot. Returns null when the slot is missing or
 * carries neither.
 *
 * @param {object} state  page1 _pageState
 * @param {number} si     sample index
 * @returns {string | null}
 */
export function _activeSamplesCgaForSi(state, si) {
  if (!state || !state.data || !state.data.samples) return null;
  const s = state.data.samples[si];
  if (!s) return null;
  return s.cga || s.ind || null;
}

/**
 * Build a Set<sample_index> from a list of CGA strings + the currently-
 * loaded data. CGAs that don't match any loaded sample are silently
 * dropped. Returns null if data isn't loaded.
 */
export function _activeSamplesCgasToIndexSet(state, cgas) {
  if (!state || !state.data || !state.data.samples) return null;
  if (!Array.isArray(cgas)) return null;
  const wanted = new Set(cgas);
  const out = new Set();
  for (let si = 0; si < state.data.samples.length; si++) {
    const cga = _activeSamplesCgaForSi(state, si);
    if (cga && wanted.has(cga)) out.add(si);
  }
  return out;
}

/**
 * Inverse: dump the current activeSampleSet as a CGA list for storage.
 */
export function _activeSamplesIndexSetToCgas(state, indexSet) {
  if (!indexSet || !state || !state.data || !state.data.samples) return [];
  const out = [];
  for (const si of indexSet) {
    const cga = _activeSamplesCgaForSi(state, si);
    if (cga) out.push(cga);
  }
  return out;
}

// ---------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------

/**
 * Load active-samples state from localStorage and re-resolve CGAs
 * against the currently-loaded cohort. Called after every data load.
 * Fail-soft: any malformed JSON or schema mismatch leaves state at
 * "all active" (activeSampleSet === null).
 */
export function loadActiveSamples(state) {
  if (!state) return;
  state.activeSampleSet = null;
  state.activeSampleReasons = new Map();
  if (typeof localStorage === 'undefined') return;
  let parsed;
  try {
    const raw = localStorage.getItem(ACTIVE_SAMPLES_LS_KEY);
    if (!raw) return;
    parsed = JSON.parse(raw);
  } catch (e) { return; }
  if (!parsed || parsed.version !== ACTIVE_SAMPLES_SCHEMA_VERSION) return;
  if (Array.isArray(parsed.active_cgas)) {
    state.activeSampleSet = _activeSamplesCgasToIndexSet(state, parsed.active_cgas);
    // If all loaded samples are in the wanted CGA set, treat as "all active"
    // (don't carry around a Set the same size as the cohort).
    if (state.activeSampleSet &&
        state.data && state.data.samples &&
        state.activeSampleSet.size === state.data.samples.length) {
      state.activeSampleSet = null;
    }
  }
  if (parsed.reasons && typeof parsed.reasons === 'object') {
    // reasons keyed by CGA in storage; resolve back to indices for state
    for (const [cga, note] of Object.entries(parsed.reasons)) {
      for (let si = 0; si < (state.data ? state.data.samples.length : 0); si++) {
        if (_activeSamplesCgaForSi(state, si) === cga) {
          state.activeSampleReasons.set(si, String(note));
          break;
        }
      }
    }
  }
}

export function saveActiveSamples(state) {
  if (!state) return;
  if (typeof localStorage === 'undefined') return;
  const payload = { version: ACTIVE_SAMPLES_SCHEMA_VERSION };
  // Only persist a non-null set; null sentinel means "all active" → no entry
  if (state.activeSampleSet instanceof Set && state.activeSampleSet.size > 0) {
    payload.active_cgas = _activeSamplesIndexSetToCgas(state, state.activeSampleSet);
  } else {
    payload.active_cgas = null;
  }
  // Reasons: index-keyed Map → CGA-keyed plain object for storage
  const reasonsOut = {};
  if (state.activeSampleReasons instanceof Map) {
    for (const [si, note] of state.activeSampleReasons) {
      const cga = _activeSamplesCgaForSi(state, si);
      if (cga && note) reasonsOut[cga] = String(note);
    }
  }
  payload.reasons = reasonsOut;
  try {
    localStorage.setItem(ACTIVE_SAMPLES_LS_KEY, JSON.stringify(payload));
  } catch (_) {}
}

// ---------------------------------------------------------------------
// Predicates + UI badge
// ---------------------------------------------------------------------

/**
 * "Is this sample active?" — returns true for all samples when no
 * subset is defined. Safe to call from any panel renderer.
 */
export function isSampleActive(state, si) {
  if (!state || !(state.activeSampleSet instanceof Set)) return true;
  return state.activeSampleSet.has(si);
}

/**
 * Active count + total — used by the badge and the modal header.
 *
 * @returns {{active: number, total: number}}
 */
export function activeSampleCounts(state) {
  const total = (state && state.data && state.data.samples)
                ? state.data.samples.length : 0;
  let active = total;
  if (state && state.activeSampleSet instanceof Set) active = state.activeSampleSet.size;
  return { active, total };
}

/**
 * Update the header badge to reflect current state. No-op when the
 * badge element doesn't exist (e.g. headless tests, alternate shells
 * that don't include the active-samples chrome).
 */
export function refreshActiveSamplesBadge(state) {
  const btn = (typeof document !== 'undefined')
              ? document.getElementById('activeSamplesBadge') : null;
  if (!btn) return;
  const { active, total } = activeSampleCounts(state);
  if (total === 0) {
    btn.textContent = 'active: —';
    btn.style.color = '#e8edf6';
    btn.style.borderColor = '#2a3245';
    btn.style.background = '#1c2231';
    return;
  }
  btn.textContent = `active: ${active}/${total}`;
  if (active < total) {
    // Subset in effect — switch to amber to make it visually obvious
    btn.style.color = '#f5a524';
    btn.style.borderColor = 'rgba(245, 165, 36, 0.6)';
    btn.style.background = 'rgba(245, 165, 36, 0.10)';
  } else {
    btn.style.color = '#e8edf6';
    btn.style.borderColor = '#2a3245';
    btn.style.background = '#1c2231';
  }
}
