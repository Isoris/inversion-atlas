// shared/session_io.js
//
// User-authored session payload — the JSON the user downloads/uploads
// via the top-bar "save / load session" buttons. Stores ONLY the
// hand-curated state (saved candidates registry, favorites, regimes,
// confirmed candidates, key prefs). The chromosome data itself is
// drag-droppable separately.
//
// Two pure entry points:
//   - buildSessionPayload(state) → serializable object
//   - mergeSessionPayload(state, payload, opts) → { ok, applied, ...stats }
//
// The DOM-coupled IO around them (Blob, URL.createObjectURL, anchor
// click, FileReader, alert, confirm) stays in legacy — those are
// browser-only and not worth porting verbatim.
//
// Legacy origin: lines 55731-55865 of legacy/Inversion_atlas.html
// (the pure pieces of _buildSessionPayload + _loadSessionFromFile).
//
// All entry points take state as their first arg. No localStorage —
// the payload is a one-shot serialization, not a persistent cache.

// =====================================================================
// Constants
// =====================================================================

/** Required `schema` field for every session JSON. */
export const SESSION_SCHEMA = 'pca_scrubber_session_v1';

/** Prefs that round-trip. Anything else in payload.prefs is ignored. */
export const SESSION_PREF_KEYS = Object.freeze([
  'simScale', 'linesColorMode', 'kChoice', 'layoutMode', 'atlasMode',
]);

// =====================================================================
// Detection
// =====================================================================

/**
 * True iff the parsed object looks like a session payload (correct
 * schema tag).
 */
export function isSessionPayload(payload) {
  return !!(
    payload
    && typeof payload === 'object'
    && payload.schema === SESSION_SCHEMA
  );
}

// =====================================================================
// Build
// =====================================================================

/**
 * Serialize the user-authored slots of `state` into a JSON-able
 * payload. Sets are converted to arrays (Set is non-JSON-serializable).
 *
 * Layout-mode + atlasMode prefs come from the DOM (data-layout-mode
 * attribute) + localStorage in legacy; the cartridge accepts them via
 * `opts.prefs` (caller responsibility — keeps the module headless).
 *
 *   buildSessionPayload(state)
 *   buildSessionPayload(state, { prefs: { layoutMode, atlasMode } })
 *
 * @param {Object} state
 * @param {{prefs?: {layoutMode?: string, atlasMode?: string}}} [opts]
 * @returns {Object}
 */
export function buildSessionPayload(state, opts) {
  const extra = (opts && opts.prefs) || {};
  return {
    schema: SESSION_SCHEMA,
    saved_at: new Date().toISOString(),
    chrom: (state && state.data && state.data.chrom) || null,
    candidates: (state && typeof state.candidates === 'object' && state.candidates)
      ? state.candidates : null,
    activeCandidateId: (state && state.activeCandidateId) || null,
    favorites: _serializeFavorites(state && state.favorites),
    regimes: (state && state.regimes) || null,
    confirmedCandidates: (state && state.confirmedCandidates) || null,
    prefs: {
      simScale:       (state && state.simScale) || null,
      linesColorMode: (state && state.linesColorMode) || null,
      kChoice:        (state && state.kChoice) || null,
      layoutMode:     extra.layoutMode || null,
      atlasMode:      extra.atlasMode  || null,
    },
  };
}

function _serializeFavorites(favs) {
  if (favs instanceof Set) return Array.from(favs);
  if (Array.isArray(favs)) return favs.slice();
  return [];
}

// =====================================================================
// Merge
// =====================================================================

/**
 * Apply a session payload onto `state`. Best-effort: each field that
 * round-trips is applied, missing/null fields are skipped.
 *
 * Candidates are merged (not replaced): the loaded dict is folded into
 * state.candidates AND state.candidateList (deduped by id). Favorites
 * union into state.favorites (Set or Array — same shape preserved).
 *
 * Returns a diagnostics object:
 *   { ok: boolean,
 *     applied: { candidates, activeCandidateId, favorites, regimes,
 *                confirmedCandidates, prefs },
 *     n_candidates_added,   // how many fresh ids landed in candidateList
 *     n_favorites_added }   // how many fresh favorites
 *
 * `opts.onCandidatesMerged(state)` fires AFTER state.candidates +
 * state.candidateList have been written but before the function returns.
 * Used by page1 to call _rebuildCandidateRegistries() so the cross-page
 * registries stay in sync. Pure-data callers can omit this.
 *
 * @param {Object} state
 * @param {Object} payload
 * @param {{onCandidatesMerged?: (state:Object) => void}} [opts]
 */
export function mergeSessionPayload(state, payload, opts) {
  if (!state || !isSessionPayload(payload)) {
    return {
      ok: false,
      applied: {},
      n_candidates_added: 0,
      n_favorites_added: 0,
    };
  }
  const applied = {
    candidates: false, activeCandidateId: false, favorites: false,
    regimes: false, confirmedCandidates: false, prefs: false,
  };
  let n_candidates_added = 0;
  let n_favorites_added = 0;

  // Candidates: merge dict + array, dedup by id
  if (payload.candidates && typeof payload.candidates === 'object') {
    state.candidates = Object.assign({}, state.candidates || {}, payload.candidates);
    if (!Array.isArray(state.candidateList)) state.candidateList = [];
    const seenIds = new Set(state.candidateList.map(c => c && c.id).filter(Boolean));
    for (const id of Object.keys(payload.candidates)) {
      const c = payload.candidates[id];
      if (c && c.id && !seenIds.has(c.id)) {
        state.candidateList.push(c);
        seenIds.add(c.id);
        n_candidates_added++;
      }
    }
    applied.candidates = true;
    if (opts && typeof opts.onCandidatesMerged === 'function') {
      try { opts.onCandidatesMerged(state); } catch (_) { /* fail-soft */ }
    }
  }

  if (payload.activeCandidateId) {
    state.activeCandidateId = payload.activeCandidateId;
    applied.activeCandidateId = true;
  }

  if (Array.isArray(payload.favorites)) {
    if (state.favorites instanceof Set) {
      for (const x of payload.favorites) {
        if (!state.favorites.has(x)) {
          state.favorites.add(x);
          n_favorites_added++;
        }
      }
    } else if (Array.isArray(state.favorites)) {
      const have = new Set(state.favorites);
      for (const x of payload.favorites) {
        if (!have.has(x)) {
          state.favorites.push(x);
          have.add(x);
          n_favorites_added++;
        }
      }
    } else {
      state.favorites = payload.favorites.slice();
      n_favorites_added = state.favorites.length;
    }
    applied.favorites = true;
  }

  if (payload.regimes) {
    state.regimes = payload.regimes;
    applied.regimes = true;
  }
  if (payload.confirmedCandidates) {
    state.confirmedCandidates = payload.confirmedCandidates;
    applied.confirmedCandidates = true;
  }

  if (payload.prefs && typeof payload.prefs === 'object') {
    // simScale: only restore when the loaded chrom defines it
    if (payload.prefs.simScale && state.data && state.data.sim_scales
        && state.data.sim_scales[payload.prefs.simScale]) {
      state.simScale = payload.prefs.simScale;
    }
    if (payload.prefs.linesColorMode) state.linesColorMode = payload.prefs.linesColorMode;
    if (payload.prefs.kChoice)        state.kChoice = payload.prefs.kChoice;
    applied.prefs = true;
  }

  return {
    ok: true,
    applied,
    n_candidates_added,
    n_favorites_added,
  };
}

/**
 * Build a download filename for the payload:
 *   atlas_session{_chrom}_{YYYY-MM-DDTHH-MM-SS}.json
 *
 * @param {Object} payload   from buildSessionPayload
 * @param {Date}   [now]     for testability; defaults to new Date()
 * @returns {string}
 */
export function buildSessionFilename(payload, now) {
  const stamp = (now || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const chromTag = (payload && payload.chrom) ? `_${payload.chrom}` : '';
  return `atlas_session${chromTag}_${stamp}.json`;
}
