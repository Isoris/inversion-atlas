// shared/regimes_registry.js
//
// User-authored regime registry. A "regime" is a user-defined claim
// that some L2 envelopes + candidate tracks belong to the same
// inversion / haplotype system, with a hand-picked axis topology.
//
// Persisted in localStorage (single blob) and surfaced cross-page in
// the catalogue's "regimes" column + page1's candidate-focus tab.
//
// State shape:
//   state.regimeRegistry = {
//     regimes: [
//       { id: 'R1', label: '', axis_topology: 'unspecified',
//         l2_ids: [...], candidate_ids: [...],
//         notes: '', created_at: ISO, updated_at: ISO },
//       ...
//     ],
//     next_id: 1, version: 1,
//   }
//
// Track-scoped candidate references: candidate_ids[] entries are
//   - bare:    'cand_abc'      → applies to track 0 (preferred)
//   - scoped:  'cand_abc#t1'   → applies specifically to track 1
//   Track 0 may be written as either form; the helpers emit bare.
//
// Legacy origin: lines 12942-13252 of legacy/Inversion_atlas.html
// (_ensureRegimeRegistry, _persistRegimeRegistry, _restoreRegimeRegistry,
// _nextRegimeId, _createRegime, _updateRegime, _deleteRegime,
// _addL2ToRegime, _removeL2FromRegime, _regimesForL2,
// _parseTrackScopedCandRef, _formatCandTrackRef,
// _addCandTrackToRegime, _removeCandTrackFromRegime,
// _regimesForCandTrack).
//
// The legacy _regimeColor helper (UI palette + var(--rule) fallback)
// stays in legacy — that's a UI concern.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant. Both candidate-track helpers accept an
// optional onCandidateListChanged callback so callers can wire
// page1's persistCandidateList() without this module importing it.

// =====================================================================
// Constants
// =====================================================================

export const REGIMES_LS_KEY = 'pca_scrubber_v3.regimeRegistry';

/**
 * SCHEMA §26 axis_topology vocabulary. User-chosen; never auto-assigned
 * by the scale-stability verdict (which only suggests). Listed in
 * display order for the dropdown. Frozen.
 */
export const REGIME_AXIS_TOPOLOGY = Object.freeze([
  Object.freeze({
    value: 'unspecified',
    label: 'Unspecified',
    tooltip: 'Default. The user has not yet assigned a topology to this regime.',
  }),
  Object.freeze({
    value: 'one_axis_3band',
    label: 'One axis · 3 bands',
    tooltip: 'Single inversion axis with the canonical 3-band signature (homo1 / het / homo2). Most common for confirmed inversions.',
  }),
  Object.freeze({
    value: 'one_axis_nested',
    label: 'One axis · nested',
    tooltip: 'Single inversion axis with internal substructure visible at fine scale (K=6 collapses cleanly to K=3 at coarse scale, NESTED_3IN6 from scale-stability test).',
  }),
  Object.freeze({
    value: 'two_axes_independent',
    label: 'Two axes · independent',
    tooltip: 'Two overlapping inversions on independent axes. Edges show one axis each, the overlap region shows reshuffled clusters (OVERLAP_BREAKS_3 from scale-stability).',
  }),
  Object.freeze({
    value: 'two_axes_correlated',
    label: 'Two axes · correlated',
    tooltip: 'Two inversions on the same chromosome that co-segregate (e.g. via a tagging haplotype). Distinguish from one_axis_nested by absence of clean K=6→K=3 collapse.',
  }),
  Object.freeze({
    value: 'multiband_stable',
    label: 'Multi-band · stable',
    tooltip: 'K=6 holds across all scales (STABLE_6BAND from scale-stability). May be one inversion with many haplotype groups, or compound architecture; needs band-tree to discriminate.',
  }),
  Object.freeze({
    value: 'artifact_suspect',
    label: 'Artifact-suspect',
    tooltip: 'Low ARI across scales, crossing/braided ribbons (UNSTABLE from scale-stability). Likely artifact — recombination breakdown, family structure, or technical noise.',
  }),
]);

/** Vocab value-list, used for validation. Derived from the constant above. */
export const REGIME_AXIS_VALUES = Object.freeze(
  REGIME_AXIS_TOPOLOGY.map(a => a.value),
);

// =====================================================================
// Headless-tolerant localStorage
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// State lifecycle
// =====================================================================

/**
 * Ensure state.regimeRegistry exists with the canonical shape.
 * Idempotent. Returns the registry.
 */
export function ensureRegimeRegistry(state) {
  if (!state) return null;
  if (!state.regimeRegistry || typeof state.regimeRegistry !== 'object') {
    state.regimeRegistry = { regimes: [], next_id: 1, version: 1 };
  }
  if (!Array.isArray(state.regimeRegistry.regimes)) {
    state.regimeRegistry.regimes = [];
  }
  if (!(state.regimeRegistry.next_id > 0)) state.regimeRegistry.next_id = 1;
  if (state.regimeRegistry.version == null) state.regimeRegistry.version = 1;
  return state.regimeRegistry;
}

/**
 * Persist on every CRUD call. Fail-soft (LS quota / disabled).
 */
export function persistRegimeRegistry(state) {
  if (!state || !_hasLocalStorage()) return false;
  ensureRegimeRegistry(state);
  try {
    localStorage.setItem(REGIMES_LS_KEY, JSON.stringify(state.regimeRegistry));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Restore from localStorage. Validates each regime's shape; drops
 * malformed entries silently rather than restoring partial garbage.
 * Returns true when at least one valid regime was restored OR the
 * LS blob parsed successfully (even if no regimes); false when the
 * blob was missing / unparseable.
 */
export function restoreRegimeRegistry(state) {
  if (!state || !_hasLocalStorage()) return false;
  ensureRegimeRegistry(state);
  try {
    const raw = localStorage.getItem(REGIMES_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    if (!Array.isArray(parsed.regimes)) return false;
    const valid = [];
    for (const r of parsed.regimes) {
      if (!r || typeof r !== 'object') continue;
      if (!r.id || typeof r.id !== 'string') continue;
      if (!Array.isArray(r.l2_ids)) r.l2_ids = [];
      if (!Array.isArray(r.candidate_ids)) r.candidate_ids = [];
      if (!REGIME_AXIS_VALUES.includes(r.axis_topology)) {
        r.axis_topology = 'unspecified';
      }
      if (typeof r.label !== 'string') r.label = '';
      if (typeof r.notes !== 'string') r.notes = '';
      valid.push(r);
    }
    state.regimeRegistry.regimes = valid;
    state.regimeRegistry.next_id = (parsed.next_id > 0) ? parsed.next_id : 1;
    state.regimeRegistry.version = (parsed.version > 0) ? parsed.version : 1;
    return true;
  } catch (_) {
    return false;
  }
}

// =====================================================================
// Id generation
// =====================================================================

/**
 * Auto-id generator. Skips ids already in use (defensive: user might
 * have imported a registry with sparse ids). Guaranteed unique.
 */
export function nextRegimeId(state) {
  const reg = ensureRegimeRegistry(state);
  const used = new Set(reg.regimes.map(r => r.id));
  let n = reg.next_id | 0;
  while (used.has('R' + n)) n++;
  reg.next_id = n + 1;
  return 'R' + n;
}

// =====================================================================
// CRUD
// =====================================================================

/**
 * Create a regime. Accepts optional id / label / axis_topology /
 * l2_ids / candidate_ids / notes. Returns the new regime object.
 * Throws on duplicate id.
 */
export function createRegime(state, args) {
  const reg = ensureRegimeRegistry(state);
  args = args || {};
  let id = args.id;
  if (!id) id = nextRegimeId(state);
  if (typeof id !== 'string' || !id) throw new Error('regime id must be a non-empty string');
  if (reg.regimes.some(r => r.id === id)) throw new Error('duplicate regime id: ' + id);
  const now = new Date().toISOString();
  const regime = {
    id,
    label: typeof args.label === 'string' ? args.label : '',
    axis_topology: REGIME_AXIS_VALUES.includes(args.axis_topology)
      ? args.axis_topology : 'unspecified',
    l2_ids: Array.isArray(args.l2_ids) ? args.l2_ids.slice() : [],
    candidate_ids: Array.isArray(args.candidate_ids) ? args.candidate_ids.slice() : [],
    notes: typeof args.notes === 'string' ? args.notes : '',
    created_at: now,
    updated_at: now,
  };
  reg.regimes.push(regime);
  persistRegimeRegistry(state);
  return regime;
}

/**
 * Update a regime. Patches in place. Returns the updated regime, or
 * null if id not found. Bumps updated_at on any patch (even no-op).
 */
export function updateRegime(state, id, patch) {
  const reg = ensureRegimeRegistry(state);
  const idx = reg.regimes.findIndex(r => r.id === id);
  if (idx < 0) return null;
  const r = reg.regimes[idx];
  patch = patch || {};
  if (typeof patch.label === 'string') r.label = patch.label;
  if (typeof patch.notes === 'string') r.notes = patch.notes;
  if (REGIME_AXIS_VALUES.includes(patch.axis_topology)) {
    r.axis_topology = patch.axis_topology;
  }
  if (Array.isArray(patch.l2_ids)) r.l2_ids = patch.l2_ids.slice();
  if (Array.isArray(patch.candidate_ids)) r.candidate_ids = patch.candidate_ids.slice();
  r.updated_at = new Date().toISOString();
  persistRegimeRegistry(state);
  return r;
}

/**
 * Delete a regime. Returns true if removed, false if id not found.
 */
export function deleteRegime(state, id) {
  const reg = ensureRegimeRegistry(state);
  const idx = reg.regimes.findIndex(r => r.id === id);
  if (idx < 0) return false;
  reg.regimes.splice(idx, 1);
  persistRegimeRegistry(state);
  return true;
}

// =====================================================================
// L2 membership
// =====================================================================

/**
 * Add an L2 id to a regime. Idempotent — duplicates are dropped.
 * Returns true on success, false if regime not found OR invalid l2Id.
 * Bumps updated_at + persists on real changes only.
 */
export function addL2ToRegime(state, regimeId, l2Id) {
  const reg = ensureRegimeRegistry(state);
  const r = reg.regimes.find(x => x.id === regimeId);
  if (!r) return false;
  if (typeof l2Id !== 'string' || !l2Id) return false;
  if (r.l2_ids.indexOf(l2Id) < 0) {
    r.l2_ids.push(l2Id);
    r.updated_at = new Date().toISOString();
    persistRegimeRegistry(state);
  }
  return true;
}

/**
 * Remove an L2 id from a regime. Returns true if removed, false
 * if regime not found OR L2 not in regime.
 */
export function removeL2FromRegime(state, regimeId, l2Id) {
  const reg = ensureRegimeRegistry(state);
  const r = reg.regimes.find(x => x.id === regimeId);
  if (!r) return false;
  const idx = r.l2_ids.indexOf(l2Id);
  if (idx < 0) return false;
  r.l2_ids.splice(idx, 1);
  r.updated_at = new Date().toISOString();
  persistRegimeRegistry(state);
  return true;
}

/**
 * Reverse lookup: which regimes claim this L2 id? Returns array of
 * regime objects (could be empty). Used by the catalogue 'regimes'
 * column.
 */
export function regimesForL2(state, l2Id) {
  const reg = ensureRegimeRegistry(state);
  if (typeof l2Id !== 'string' || !l2Id) return [];
  return reg.regimes.filter(r => Array.isArray(r.l2_ids) && r.l2_ids.includes(l2Id));
}

// =====================================================================
// Track-scoped candidate references (pure parser + formatter)
// =====================================================================

/**
 * Parse a candidate-id-with-optional-track-suffix string:
 *
 *   'cand_abc'     → { candidate_id: 'cand_abc', track_idx: 0 }
 *   'cand_abc#t0'  → { candidate_id: 'cand_abc', track_idx: 0 }
 *   'cand_abc#t1'  → { candidate_id: 'cand_abc', track_idx: 1 }
 *   non-string / empty → null
 *
 * Malformed suffixes (non-int track index, missing prefix, negative)
 * fall back to the bare interpretation rather than throwing — keeps
 * legacy/manual edits robust.
 */
export function parseTrackScopedCandRef(s) {
  if (typeof s !== 'string' || !s) return null;
  const hashIdx = s.indexOf('#t');
  if (hashIdx < 0) return { candidate_id: s, track_idx: 0 };
  const cid = s.slice(0, hashIdx);
  const tStr = s.slice(hashIdx + 2);
  const ti = parseInt(tStr, 10);
  if (!cid || !Number.isInteger(ti) || ti < 0) {
    return { candidate_id: s, track_idx: 0 };
  }
  return { candidate_id: cid, track_idx: ti };
}

/**
 * Format a (candidate_id, track_idx) pair as a registry reference
 * string. Track 0 → bare form. Track 1+ → 'cand#t1' scoped form.
 * Returns null on invalid candId.
 */
export function formatCandTrackRef(candId, trackIdx) {
  if (typeof candId !== 'string' || !candId) return null;
  const ti = Number.isInteger(trackIdx) ? trackIdx : 0;
  return ti === 0 ? candId : `${candId}#t${ti}`;
}

// =====================================================================
// Candidate-track membership
// =====================================================================

/**
 * Add a (candidate, track) pair to a regime. Idempotent in both bare
 * and scoped forms (a candidate can't be in the same regime twice on
 * the same track). Mirrors `cand.tracks[trackIdx].regime_id` when the
 * candidate is in state.candidateList. Calls opts.onCandidateListChanged
 * after the mirror write (page1 wires this to persistCandidateList).
 *
 * Returns true on success, false if regime not found or candId invalid.
 */
export function addCandTrackToRegime(state, regimeId, candId, trackIdx, opts) {
  const reg = ensureRegimeRegistry(state);
  const r = reg.regimes.find(x => x.id === regimeId);
  if (!r) return false;
  if (typeof candId !== 'string' || !candId) return false;
  if (!Array.isArray(r.candidate_ids)) r.candidate_ids = [];
  const ti = Number.isInteger(trackIdx) ? trackIdx : 0;
  // Dedupe across both bare + scoped forms
  const existing = r.candidate_ids.find(s => {
    const p = parseTrackScopedCandRef(s);
    return p && p.candidate_id === candId && p.track_idx === ti;
  });
  if (!existing) {
    r.candidate_ids.push(formatCandTrackRef(candId, ti));
    r.updated_at = new Date().toISOString();
  }
  // Mirror onto the candidate's track payload (best-effort)
  if (state && Array.isArray(state.candidateList)) {
    const cand = state.candidateList.find(c => c && c.id === candId);
    if (cand && Array.isArray(cand.tracks) && cand.tracks[ti]) {
      cand.tracks[ti].regime_id = regimeId;
    }
  }
  persistRegimeRegistry(state);
  if (opts && typeof opts.onCandidateListChanged === 'function') {
    try { opts.onCandidateListChanged(state); } catch (_) { /* fail-soft */ }
  }
  return true;
}

/**
 * Remove a (candidate, track) pair from a regime. Returns true if
 * removed, false if regime not found or pair absent. Also clears
 * `cand.tracks[trackIdx].regime_id` when set.
 */
export function removeCandTrackFromRegime(state, regimeId, candId, trackIdx, opts) {
  const reg = ensureRegimeRegistry(state);
  const r = reg.regimes.find(x => x.id === regimeId);
  if (!r || !Array.isArray(r.candidate_ids)) return false;
  const ti = Number.isInteger(trackIdx) ? trackIdx : 0;
  const idx = r.candidate_ids.findIndex(s => {
    const p = parseTrackScopedCandRef(s);
    return p && p.candidate_id === candId && p.track_idx === ti;
  });
  if (idx < 0) return false;
  r.candidate_ids.splice(idx, 1);
  r.updated_at = new Date().toISOString();
  // Clear the mirrored field on the candidate
  if (state && Array.isArray(state.candidateList)) {
    const cand = state.candidateList.find(c => c && c.id === candId);
    if (cand && Array.isArray(cand.tracks) && cand.tracks[ti]
        && cand.tracks[ti].regime_id === regimeId) {
      cand.tracks[ti].regime_id = null;
    }
  }
  persistRegimeRegistry(state);
  if (opts && typeof opts.onCandidateListChanged === 'function') {
    try { opts.onCandidateListChanged(state); } catch (_) { /* fail-soft */ }
  }
  return true;
}

/**
 * Reverse lookup: which regimes claim this (candidate, track) pair?
 * Returns array of regime objects.
 */
export function regimesForCandTrack(state, candId, trackIdx) {
  const reg = ensureRegimeRegistry(state);
  if (typeof candId !== 'string' || !candId) return [];
  const ti = Number.isInteger(trackIdx) ? trackIdx : 0;
  return reg.regimes.filter(r => {
    if (!Array.isArray(r.candidate_ids)) return false;
    return r.candidate_ids.some(s => {
      const p = parseTrackScopedCandRef(s);
      return p && p.candidate_id === candId && p.track_idx === ti;
    });
  });
}
