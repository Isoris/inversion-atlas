// shared/candidate_io.js
//
// Candidate JSON IO (legacy lines 56789-57300). Round-trippable
// serialisation for the candidate registry — used by persistCandidateList,
// the catalogue JSON export, and by `_navigateToCandidate` to clone
// candidates without sharing references.
//
// Pure: no state reach-ins. The legacy reached for `_bndCloneRecord`
// and `_recomputePerTrackAssignments` as module-scope fallbacks; the
// cartridge port imports bndCloneRecord from page11/boundaries.js and
// makes _recomputePerTrackAssignments injectable via opts.

import { bndCloneRecord } from '../pages/review/page11/boundaries.js';

/** Maximum tracks per candidate (legacy cap). */
export const MAX_TRACKS = 2;

// =====================================================================
// Candidate id minter
// =====================================================================

let _candIdCounter = 0;

/**
 * Mint a fresh candidate id. Format: 'cand_<ts36>_<counter36>_<rand4>'.
 * Pure-ish: the counter is module-scope (matches legacy behavior).
 *
 * @returns {string}
 */
export function makeCandidateId() {
  _candIdCounter++;
  return 'cand_' + Date.now().toString(36)
    + '_' + _candIdCounter.toString(36)
    + '_' + Math.random().toString(36).slice(2, 6);
}

/** Reset the in-module counter (for deterministic tests). */
export function _resetCandIdCounter(n) {
  _candIdCounter = Number.isFinite(n) ? n : 0;
}

// =====================================================================
// Default single track
// =====================================================================

/**
 * Build a default single-track entry from a candidate's top-level
 * fields. Active bands default to [0..K-1] so an old single-track
 * candidate looks like "one track that contains all bands".
 *
 * @param {Object?} cand
 * @returns {Object}
 */
export function defaultSingleTrack(cand) {
  const K = (cand && Number.isInteger(cand.K) && cand.K > 0) ? cand.K : 3;
  const active_bands = [];
  for (let i = 0; i < K; i++) active_bands.push(i);
  return {
    track_idx: 0,
    active_bands,
    regime_id: (cand && cand.regime_id) || null,
    confirmed: !!(cand && cand.confirmed),
    notes:     (cand && cand.notes) || '',
    aggregate_concordance:   (cand && Number.isFinite(cand.aggregate_concordance))
                              ? cand.aggregate_concordance : null,
    band_continuity_pct:     (cand && Number.isFinite(cand.band_continuity_pct))
                              ? cand.band_continuity_pct : null,
    band_continuity_verdict: (cand && cand.band_continuity_verdict) || null,
    regime_counts:           (cand && Array.isArray(cand.regime_counts))
                              ? cand.regime_counts.slice() : null,
    fish_calls:              (cand && Array.isArray(cand.fish_calls))
                              ? cand.fish_calls : null,
  };
}

/**
 * Idempotent track-array normaliser. Mutates `cand.tracks` to a
 * canonical 1..MAX_TRACKS-length array with cleaned per-track fields.
 *
 * @param {Object} cand
 * @returns {Array<Object>|null}
 */
export function ensureTracks(cand) {
  if (!cand) return null;
  const K = Number.isInteger(cand.K) ? cand.K : 3;
  let tracks = Array.isArray(cand.tracks) ? cand.tracks : null;

  if (!tracks || tracks.length === 0) {
    cand.tracks = [defaultSingleTrack(cand)];
    return cand.tracks;
  }
  if (tracks.length > MAX_TRACKS) {
    tracks = tracks.slice(0, MAX_TRACKS);
  }
  const cleaned = tracks.map((t, idx) => {
    if (!t || typeof t !== 'object') t = {};
    let bands = Array.isArray(t.active_bands) ? t.active_bands : null;
    if (!bands) bands = [];
    bands = bands.filter(b => Number.isInteger(b) && b >= 0 && b < K);
    return {
      track_idx: Number.isInteger(t.track_idx) ? t.track_idx : idx,
      active_bands: bands,
      regime_id: t.regime_id || null,
      confirmed: !!t.confirmed,
      notes: typeof t.notes === 'string' ? t.notes : '',
      aggregate_concordance:   Number.isFinite(t.aggregate_concordance) ? t.aggregate_concordance : null,
      band_continuity_pct:     Number.isFinite(t.band_continuity_pct)   ? t.band_continuity_pct   : null,
      band_continuity_verdict: t.band_continuity_verdict || null,
      regime_counts:           Array.isArray(t.regime_counts) ? t.regime_counts.slice() : null,
      fish_calls:              Array.isArray(t.fish_calls)    ? t.fish_calls            : null,
    };
  });
  cand.tracks = cleaned;
  return cand.tracks;
}

// =====================================================================
// candidateToJSON
// =====================================================================

/**
 * Serialise a candidate to a plain-object JSON payload. Returns null
 * for nullish input.
 *
 * Round-trippable with candidateFromJSON for every field the legacy
 * round-trips. Boundary records are deep-cloned via bndCloneRecord
 * so the serialised payload never shares references with the live
 * candidate.
 *
 * @param {Object?} cand
 * @returns {Object|null}
 */
export function candidateToJSON(cand) {
  if (!cand) return null;
  return {
    id:            cand.id,
    source:        cand.source,
    chrom:         cand.chrom,
    l2_indices:    Array.from(cand.l2_indices || []),
    ref_l2:        cand.ref_l2,
    ref_window:    cand.ref_window,
    K:             cand.K,
    locked_labels: cand.locked_labels ? Array.from(cand.locked_labels) : null,
    start_w:       cand.start_w,
    end_w:         cand.end_w,
    start_bp:      cand.start_bp,
    end_bp:        cand.end_bp,
    created_at:    cand.created_at,
    notes:         cand.notes || '',
    confirmed:     !!cand.confirmed,
    resolution:    cand.resolution || 'L2',
    l3_cuts:       Array.isArray(cand.l3_cuts) ? cand.l3_cuts.slice() : [],
    parent_split_id: cand.parent_split_id || null,
    aggregate_concordance:   Number.isFinite(cand.aggregate_concordance)
                                ? cand.aggregate_concordance : null,
    band_continuity_pct:     Number.isFinite(cand.band_continuity_pct)
                                ? cand.band_continuity_pct : null,
    band_continuity_verdict: cand.band_continuity_verdict || null,
    regime_counts:           Array.isArray(cand.regime_counts)
                                ? cand.regime_counts.slice() : null,
    fish_calls:              Array.isArray(cand.fish_calls)
                                ? cand.fish_calls.slice() : null,
    qc_status:               cand.qc_status || null,
    interval_roles:    Array.isArray(cand.interval_roles)
                          ? cand.interval_roles.map(r => Object.assign({}, r)) : null,
    band_diagnostics:  (cand.band_diagnostics && typeof cand.band_diagnostics === 'object')
                          ? cand.band_diagnostics : null,
    k6_substructure:   (cand.k6_substructure && typeof cand.k6_substructure === 'object')
                          ? cand.k6_substructure : null,
    boundary_left:     bndCloneRecord(cand.boundary_left),
    boundary_right:    bndCloneRecord(cand.boundary_right),
    breakpoint_status: cand.breakpoint_status || null,
    boundary_notes:    cand.boundary_notes || null,
    tracks: (Array.isArray(cand.tracks) && cand.tracks.length > 0)
              ? cand.tracks.map(t => ({
                  track_idx: t.track_idx,
                  active_bands: Array.isArray(t.active_bands) ? t.active_bands.slice() : [],
                  regime_id: t.regime_id || null,
                  confirmed: !!t.confirmed,
                  notes: t.notes || '',
                  aggregate_concordance:   Number.isFinite(t.aggregate_concordance) ? t.aggregate_concordance : null,
                  band_continuity_pct:     Number.isFinite(t.band_continuity_pct)   ? t.band_continuity_pct   : null,
                  band_continuity_verdict: t.band_continuity_verdict || null,
                  regime_counts:           Array.isArray(t.regime_counts) ? t.regime_counts.slice() : null,
                  fish_calls:              Array.isArray(t.fish_calls)    ? t.fish_calls.slice()    : null,
                }))
              : [defaultSingleTrack(cand)],
  };
}

// =====================================================================
// candidateFromJSON
// =====================================================================

/**
 * Deserialise a candidate from a plain-object JSON payload. Returns
 * null for nullish input. `locked_labels` is wrapped in Int8Array so
 * it matches the in-memory shape used by clustering.
 *
 * Old saves that lack newer fields read those fields back as
 * undefined (graceful back-compat for pre-turn-47 / pre-turn-51 saves).
 *
 * Optional `opts.recomputePerTrackAssignments(cand)` callback is run
 * after track normalisation when supplied.
 *
 * @param {Object?} obj
 * @param {{recomputePerTrackAssignments?:Function}} opts
 * @returns {Object|null}
 */
export function candidateFromJSON(obj, opts) {
  if (!obj) return null;
  const cand = {
    id:            obj.id || makeCandidateId(),
    source:        obj.source,
    chrom:         obj.chrom,
    l2_indices:    Array.isArray(obj.l2_indices) ? obj.l2_indices : [],
    ref_l2:        obj.ref_l2,
    ref_window:    obj.ref_window,
    K:             obj.K,
    locked_labels: obj.locked_labels ? new Int8Array(obj.locked_labels) : null,
    start_w:       obj.start_w,
    end_w:         obj.end_w,
    start_bp:      obj.start_bp,
    end_bp:        obj.end_bp,
    created_at:    obj.created_at || Date.now(),
    notes:         obj.notes || '',
    confirmed:     !!obj.confirmed,
    resolution:    (obj.resolution === 'W') ? 'W' : 'L2',
    l3_cuts:       Array.isArray(obj.l3_cuts) ? obj.l3_cuts.slice() : [],
    parent_split_id: obj.parent_split_id || null,
    aggregate_concordance:   Number.isFinite(obj.aggregate_concordance)
                                ? obj.aggregate_concordance : undefined,
    band_continuity_pct:     Number.isFinite(obj.band_continuity_pct)
                                ? obj.band_continuity_pct : undefined,
    band_continuity_verdict: obj.band_continuity_verdict || undefined,
    regime_counts:           Array.isArray(obj.regime_counts)
                                ? obj.regime_counts.slice() : undefined,
    fish_calls:              Array.isArray(obj.fish_calls)
                                ? obj.fish_calls.slice() : undefined,
    qc_status:               obj.qc_status || undefined,
    interval_roles:    Array.isArray(obj.interval_roles)
                          ? obj.interval_roles.map(r => Object.assign({}, r)) : undefined,
    band_diagnostics:  (obj.band_diagnostics && typeof obj.band_diagnostics === 'object')
                          ? obj.band_diagnostics : undefined,
    k6_substructure:   (obj.k6_substructure && typeof obj.k6_substructure === 'object')
                          ? obj.k6_substructure : undefined,
    boundary_left:     (obj.boundary_left && typeof obj.boundary_left === 'object')
                          ? obj.boundary_left : undefined,
    boundary_right:    (obj.boundary_right && typeof obj.boundary_right === 'object')
                          ? obj.boundary_right : undefined,
    breakpoint_status: obj.breakpoint_status || undefined,
    boundary_notes:    obj.boundary_notes || undefined,
    tracks: Array.isArray(obj.tracks) ? obj.tracks : null,
  };
  ensureTracks(cand);
  const recompute = opts && opts.recomputePerTrackAssignments;
  if (typeof recompute === 'function') {
    try { recompute(cand); } catch (_) { /* swallow */ }
  }
  return cand;
}
