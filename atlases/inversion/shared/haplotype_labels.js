// shared/haplotype_labels.js
//
// Per-band haplotype-label load/save + auto-classification application
// (legacy lines 60625-60695 + 62303-62354). The cohort-wide vocab
// helpers (autoClassifyCandidate, getHaplotypeVocab) already live in
// shared/haplotype_vocab.js; this module ships:
//   - the localStorage round-trip for the per-band label map
//   - the suggestion-application logic that respects user input +
//     confidence thresholds
//
// The legacy IO writes to a state-coupled localStorage shape; the
// cartridge port keeps that contract behind a callback so headless
// callers (tests, atlas-core registry) can override.

import { autoClassifyCandidate } from './haplotype_vocab.js';

/** Default localStorage key prefix used by the legacy IO. */
export const HAP_LABEL_LS_KEY_PREFIX = 'inversion_atlas.hap_labels';

/**
 * Build the localStorage key for a candidate's haplotype-label map.
 * Mirrors the legacy `_hapLabelLSKey` convention: prefix.chrom.candId.
 *
 * @param {string|null|undefined} chrom
 * @param {string|null|undefined} candId
 * @returns {string}
 */
export function hapLabelLSKey(chrom, candId) {
  return HAP_LABEL_LS_KEY_PREFIX + '.' + (chrom || '?') + '.' + (candId || '?');
}

function _safeLocalStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

// =====================================================================
// Load / save
// =====================================================================

/**
 * Resolve the haplotype-label map for a candidate. Priority:
 *   1. `c.haplotype_labels` (in-memory cache)
 *   2. localStorage at hapLabelLSKey(c.chrom, c.id) (parsed JSON object)
 *   3. empty object (cached back on c.haplotype_labels)
 *
 * Side-effect: caches the loaded map on `c.haplotype_labels` so
 * subsequent reads avoid the localStorage hit.
 *
 * Pure for tests: pass `opts.localStorage` to use a custom store
 * (e.g. an in-memory mock).
 *
 * @param {Object} c
 * @param {{localStorage?:Storage}} opts
 * @returns {Object<string|number, string>}
 */
export function loadHaplotypeLabels(c, opts) {
  if (!c) return {};
  if (c.haplotype_labels && typeof c.haplotype_labels === 'object') {
    return c.haplotype_labels;
  }
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (ls) {
    try {
      const key = hapLabelLSKey(c.chrom, c.id);
      const raw = ls.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          c.haplotype_labels = parsed;
          return parsed;
        }
      }
    } catch (_) { /* swallow */ }
  }
  c.haplotype_labels = {};
  return c.haplotype_labels;
}

/**
 * Persist `c.haplotype_labels` to localStorage under the legacy key.
 * No-op when c is null, c.haplotype_labels is missing, or no
 * localStorage shim is available.
 *
 * @param {Object} c
 * @param {{localStorage?:Storage}} opts
 */
export function saveHaplotypeLabels(c, opts) {
  if (!c || !c.haplotype_labels) return;
  const ls = (opts && opts.localStorage) || _safeLocalStorage();
  if (!ls) return;
  try {
    const key = hapLabelLSKey(c.chrom, c.id);
    ls.setItem(key, JSON.stringify(c.haplotype_labels));
  } catch (_) { /* swallow */ }
}

/**
 * Set a single band's haplotype label. Empty / whitespace-only strings
 * delete the entry. Persists to localStorage after the mutation.
 *
 * @param {Object} c
 * @param {number|string} bandIdx
 * @param {string|null} label
 * @param {{localStorage?:Storage}} opts
 */
export function setHaplotypeLabel(c, bandIdx, label, opts) {
  if (!c) return;
  const labels = loadHaplotypeLabels(c, opts);
  const cleaned = (label == null) ? '' : String(label).trim();
  if (cleaned === '') {
    delete labels[bandIdx];
  } else {
    labels[bandIdx] = cleaned;
  }
  c.haplotype_labels = labels;
  saveHaplotypeLabels(c, opts);
}

// =====================================================================
// Apply auto-classification
// =====================================================================

const _CONFIDENCE_RANKS = { none: 0, low: 1, medium: 2, high: 3 };

/**
 * Apply autoClassifyCandidate's suggestions to a candidate's
 * haplotype-label map. Returns `{ applied, skipped, vocab }`.
 *
 * Options:
 *   - opts.overwriteUserInput (default false) — when true, existing
 *     non-empty labels are overwritten. When false, only empty bands
 *     are filled.
 *   - opts.confidenceFloor (default 'low') — only suggestions at or
 *     above this confidence ('none' | 'low' | 'medium' | 'high') get
 *     applied.
 *   - opts.state — passed to autoClassifyCandidate(state, c)
 *   - opts.localStorage — testable override of the LS shim
 *
 * @param {Object} c
 * @param {{state?:Object, overwriteUserInput?:boolean, confidenceFloor?:string, localStorage?:Storage}} opts
 * @returns {{applied:number, skipped:number, vocab?:string}}
 */
export function applyAutoClassificationToCandidate(c, opts) {
  if (!c) return { applied: 0, skipped: 0 };
  const o = opts || {};
  const r = autoClassifyCandidate(o.state, c);
  if (!r) return { applied: 0, skipped: 0 };

  const overwrite = !!o.overwriteUserInput;
  const floor = o.confidenceFloor || 'low';
  const floorRank = _CONFIDENCE_RANKS[floor] != null ? _CONFIDENCE_RANKS[floor] : 1;

  const existing = loadHaplotypeLabels(c, opts);
  let applied = 0, skipped = 0;
  for (const pb of r.per_band) {
    if (!pb || !pb.label) { skipped++; continue; }
    const rank = _CONFIDENCE_RANKS[pb.confidence];
    if (rank == null || rank < floorRank) { skipped++; continue; }
    if (!overwrite && existing[pb.k] && String(existing[pb.k]).trim() !== '') {
      skipped++;
      continue;
    }
    setHaplotypeLabel(c, pb.k, pb.label, opts);
    applied++;
  }
  return { applied, skipped, vocab: r.vocab };
}

/**
 * Apply autoclassification across a candidate registry. Iterates
 * over `state.candidates` (default mode) or
 * `state.candidates_detailed` (when state.activeMode === 'detailed').
 *
 * Returns `{ totalApplied, totalSkipped, perCandidate: { [id]: {...} } }`.
 *
 * @param {Object} state
 * @param {Object} opts  forwarded to applyAutoClassificationToCandidate
 * @returns {{totalApplied:number, totalSkipped:number, perCandidate:Object}}
 */
export function applyAutoClassificationToAllCandidates(state, opts) {
  const out = { totalApplied: 0, totalSkipped: 0, perCandidate: {} };
  if (!state) return out;
  const isDetailed = state.activeMode === 'detailed';
  const src = isDetailed ? state.candidates_detailed : state.candidates;
  if (!src || typeof src !== 'object') return out;
  const o = Object.assign({ state }, opts || {});
  for (const id of Object.keys(src)) {
    const c = src[id];
    if (!c) continue;
    const result = applyAutoClassificationToCandidate(c, o);
    out.perCandidate[id] = result;
    out.totalApplied += result.applied;
    out.totalSkipped += result.skipped;
  }
  return out;
}
