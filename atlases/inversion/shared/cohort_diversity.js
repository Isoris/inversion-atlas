// shared/cohort_diversity.js
//
// Cohort diversity stats (F_ROH, π, F_HOM, ROH segments, callable_bp).
// One row per CGA sample. Source data is either the wrapped
// "cohort_diversity_v1" JSON or a raw-array dt_S1 paste from the
// Diversity workspace. Loaded once for the whole cohort (not per-chrom)
// and indexed by upper-cased CGA id for O(1) sample → diversity lookups.
//
// Consumers:
//   - breeding-readiness card builder (legacy lines 21421+) — per-
//     candidate per-arrangement F_ROH comparison + pairing advice
//   - catalogue / candidate summary widgets — "F_ROH available for
//     N/M samples" coverage indicator
//
// Legacy origin: lines 21184-21419 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

/** Schema tool tag for the wrapped form. */
export const COHORT_DIVERSITY_TOOL = 'cohort_diversity_v1';

/** localStorage key (single blob — one entry, not per-chrom). */
export const COHORT_DIVERSITY_LS_KEY = 'inversion_atlas.cohort_diversity';

/**
 * Numeric columns the loader reads. Anything else on a row is
 * preserved (defensive copy) but not validated.
 */
export const COHORT_DIVERSITY_NUMERIC_COLS = Object.freeze([
  'h', 'f_hom', 'f_roh',
  'roh_total_bp', 'roh_n', 'roh_longest_bp', 'roh_mean_bp',
  'th_in', 'th_out', 'th_ratio', 'callable_bp',
]);

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

/**
 * Detect a cohort-diversity JSON. Accepts:
 *   - Wrapped: { tool: 'cohort_diversity_v1', schema_version: int,
 *               samples: [...], ... }
 *   - Raw-array (dt_S1 paste): [{ sample_id|sample, f_roh, ... }, ...]
 *     — shape-discriminated by a CGA-like sample id + a numeric f_roh
 *     on the first row, to avoid claiming bare-array dosage / theta
 *     / NGSadmix JSONs.
 */
export function isCohortDiversityJSON(data) {
  if (!data) return false;
  if (typeof data === 'object' && !Array.isArray(data)) {
    if (data.tool === COHORT_DIVERSITY_TOOL
        && typeof data.schema_version === 'number'
        && Array.isArray(data.samples)) {
      return true;
    }
    return false;
  }
  if (Array.isArray(data) && data.length > 0) {
    const r = data[0];
    if (!r || typeof r !== 'object') return false;
    const hasSampleId = typeof r.sample_id === 'string' || typeof r.sample === 'string';
    const hasFRoh = Number.isFinite(r.f_roh);
    return hasSampleId && hasFRoh;
  }
  return false;
}

// =====================================================================
// Row normalization
// =====================================================================

/**
 * Normalize a single row into the canonical wrapped-row shape:
 *   { sample_id, k8, pruned81, h, f_hom, f_roh, roh_total_bp, ...,
 *     callable_bp }
 * NaNs / undefined / wrong types coerce to null so downstream code
 * can gate computation with Number.isFinite(). Drops rows with no
 * sample_id.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
export function normalizeCohortDiversityRow(row) {
  if (!row || typeof row !== 'object') return null;
  const sampleId = (typeof row.sample_id === 'string' && row.sample_id)
                || (typeof row.sample === 'string' && row.sample)
                || null;
  if (!sampleId) return null;
  const out = {
    sample_id: sampleId.trim(),
    k8: (row.k8 != null) ? String(row.k8) : null,
    pruned81: (row.pruned81 === true || row.pruned81 === 'true' || row.pruned81 === 1)
              ? true
              : (row.pruned81 === false || row.pruned81 === 'false' || row.pruned81 === 0)
                ? false
                : null,
  };
  for (const col of COHORT_DIVERSITY_NUMERIC_COLS) {
    const v = row[col];
    out[col] = (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  }
  return out;
}

// =====================================================================
// Store / accessors
// =====================================================================

/**
 * Validate, normalize, and attach to state.cohortDiversity. Builds
 * the upper-cased byCGA Map for O(1) lookup. Returns true on success,
 * false if the input failed detection. On success: invalidates the
 * breeding-card cache so it rebuilds on next read.
 *
 * Diagnostics (.diagnostics) record n_input, n_loaded,
 * n_dropped_no_id, n_duplicate_id for the loader UI.
 */
export function storeCohortDiversity(state, parsed) {
  if (!state || !isCohortDiversityJSON(parsed)) return false;
  const rawRows = Array.isArray(parsed) ? parsed : parsed.samples;
  if (!Array.isArray(rawRows) || rawRows.length === 0) return false;

  const samples = [];
  let n_dropped_no_id = 0;
  for (const r of rawRows) {
    const norm = normalizeCohortDiversityRow(r);
    if (norm) samples.push(norm);
    else n_dropped_no_id++;
  }
  if (samples.length === 0) return false;

  const byCGA = new Map();
  let n_duplicate = 0;
  for (const s of samples) {
    const key = s.sample_id.toUpperCase();
    if (byCGA.has(key)) n_duplicate++;
    byCGA.set(key, s);
  }

  state.cohortDiversity = {
    schema_version: (typeof parsed.schema_version === 'number') ? parsed.schema_version : 1,
    tool: COHORT_DIVERSITY_TOOL,
    generated_at: (parsed && parsed.generated_at) || null,
    cohort: (parsed && parsed.cohort && typeof parsed.cohort === 'object')
            ? JSON.parse(JSON.stringify(parsed.cohort))
            : { n_samples: samples.length },
    samples,
    byCGA,
    loaded_at: new Date().toISOString(),
    diagnostics: {
      n_input:        rawRows.length,
      n_loaded:       samples.length,
      n_dropped_no_id,
      n_duplicate_id: n_duplicate,
    },
  };
  state._breedingCardCache = null;
  return true;
}

/**
 * Persist to localStorage. byCGA is a Map (non-serializable), so we
 * drop it on the way out and rebuild on restore. When
 * state.cohortDiversity is null, this clears the LS key.
 */
export function persistCohortDiversity(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.cohortDiversity) {
      const persistable = {
        schema_version: state.cohortDiversity.schema_version,
        tool:           state.cohortDiversity.tool,
        generated_at:   state.cohortDiversity.generated_at,
        cohort:         state.cohortDiversity.cohort,
        samples:        state.cohortDiversity.samples,
        loaded_at:      state.cohortDiversity.loaded_at,
        diagnostics:    state.cohortDiversity.diagnostics,
      };
      localStorage.setItem(COHORT_DIVERSITY_LS_KEY, JSON.stringify(persistable));
    } else {
      localStorage.removeItem(COHORT_DIVERSITY_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Restore from localStorage. Routes through storeCohortDiversity so
 * the byCGA index gets rebuilt + diagnostics get re-derived.
 * Returns true on success.
 */
export function restoreCohortDiversity(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(COHORT_DIVERSITY_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeCohortDiversity(state, parsed);
  } catch (_) {
    return false;
  }
}

/** Drop cohort diversity data (in-memory + localStorage). */
export function clearCohortDiversity(state) {
  if (!state) return;
  state.cohortDiversity = null;
  state._breedingCardCache = null;
  persistCohortDiversity(state);
}

// =====================================================================
// Lookups
// =====================================================================

/**
 * Resolve sample index → diversity row by going through
 * state.data.samples[si].cga (the per-chrom sample roster) → upper-
 * cased → state.cohortDiversity.byCGA. Returns null if any link in
 * that chain is missing. All callers MUST handle null gracefully.
 *
 * @param {Object} state
 * @param {number} si
 * @returns {Object|null}
 */
export function diversityForSampleIdx(state, si) {
  if (!state || !state.data || !Array.isArray(state.data.samples)) return null;
  if (!state.cohortDiversity || !state.cohortDiversity.byCGA
      || typeof state.cohortDiversity.byCGA.get !== 'function') return null;
  if (typeof si !== 'number' || !Number.isInteger(si)) return null;
  if (si < 0 || si >= state.data.samples.length) return null;
  const samp = state.data.samples[si];
  if (!samp) return null;
  const cga = (typeof samp.cga === 'string' && samp.cga) ? samp.cga.toUpperCase() : null;
  if (!cga) return null;
  return state.cohortDiversity.byCGA.get(cga) || null;
}

/**
 * Resolve CGA id → diversity row directly, without going through
 * state.data.samples. Useful for tests, bulk-export paths, and
 * pre-chrom-load lookups.
 *
 * @param {Object} state
 * @param {string} cga
 * @returns {Object|null}
 */
export function diversityForCGA(state, cga) {
  if (!state || !state.cohortDiversity || !state.cohortDiversity.byCGA
      || typeof state.cohortDiversity.byCGA.get !== 'function') return null;
  if (typeof cga !== 'string' || !cga) return null;
  return state.cohortDiversity.byCGA.get(cga.toUpperCase()) || null;
}

/**
 * Diagnostic: how many of the loaded chrom's samples resolve to a
 * diversity row? Returns { n_total, n_resolved, n_unresolved,
 * unresolved_cgas[] } (unresolved list capped at 10 — callers needing
 * the full list walk samples themselves).
 *
 * @param {Object} state
 * @returns {{n_total:number, n_resolved:number, n_unresolved:number, unresolved_cgas:string[]}}
 */
export function cohortDiversityCoverageOnCurrentChrom(state) {
  const out = { n_total: 0, n_resolved: 0, n_unresolved: 0, unresolved_cgas: [] };
  if (!state || !state.data || !Array.isArray(state.data.samples)) return out;
  const samples = state.data.samples;
  out.n_total = samples.length;
  if (!state.cohortDiversity || !state.cohortDiversity.byCGA
      || typeof state.cohortDiversity.byCGA.has !== 'function') {
    out.n_unresolved = samples.length;
    return out;
  }
  for (const samp of samples) {
    const cga = (typeof samp.cga === 'string' && samp.cga) ? samp.cga.toUpperCase() : null;
    if (cga && state.cohortDiversity.byCGA.has(cga)) {
      out.n_resolved++;
    } else {
      out.n_unresolved++;
      if (out.unresolved_cgas.length < 10) {
        out.unresolved_cgas.push(samp.cga || samp.ind || '?');
      }
    }
  }
  return out;
}
