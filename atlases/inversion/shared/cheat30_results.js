// shared/cheat30_results.js
//
// cheat30 GDS-by-genotype results — age & origin atlas surface.
// Reads `cheat30_gds_results_<chrom>.json` (per Quentin's
// cheat30_gds_by_genotype.R HPC pipeline, Porubsky-style). The JSON
// shape is one chrom per file with a per-candidate dict of GDS
// results + pre-computed KDE densities for the ridgeline plot.
//
// Per-candidate fields (under .candidates[<cand_id>]):
//   n_ref, n_het, n_inv          - integer sample counts per class
//   separation_p                 - Wilcoxon p (same-genotype > diff-genotype)
//   separation_effect            - mean GDS gap (same minus diff)
//   age_proxy                    - mean(REF/REF) - mean(REF/INV); ordinal
//   dip_p, dip_stat, is_bimodal  - Hartigan dip on I/I distribution
//   origin_class                 - "single_origin"/"recurrent"/"weak_signal"/"inconclusive"
//   mean_ibs_same, mean_ibs_diff - cohort-level GDS means by genotype-pair scope
//   pair_summaries               - per pair-type: { n, mean, sd, quantiles[5] }
//   pair_density                 - per pair-type: { x[], y[] } KDE points
//
// Legacy origin: lines 14764-14852 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

/** Schema tool tag for cheat30 GDS-by-genotype results. */
export const CHEAT30_TOOL = 'cheat30_gds_by_genotype';

/** localStorage key prefix; one key per chromosome. */
export const CHEAT30_LS_PREFIX = 'inversion_atlas.cheat30Results.';

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
 * Detect a cheat30 results JSON. Discriminates by schema_version
 * prefix "cheat30_v" + non-empty chrom + candidates dict.
 */
export function isCheat30JSON(data) {
  return !!(
    data &&
    typeof data === 'object' &&
    typeof data.schema_version === 'string' &&
    data.schema_version.indexOf('cheat30_v') === 0 &&
    typeof data.chrom === 'string' && data.chrom &&
    data.candidates && typeof data.candidates === 'object'
  );
}

// =====================================================================
// Store / accessors
// =====================================================================

/**
 * Store a parsed JSON onto state.cheat30Results, indexed by chrom.
 * Returns the chrom name on success, null on validation failure.
 */
export function storeCheat30Results(state, parsed) {
  if (!state || !isCheat30JSON(parsed)) return null;
  const chrom = parsed.chrom;
  if (!state.cheat30Results || typeof state.cheat30Results !== 'object') {
    state.cheat30Results = {};
  }
  state.cheat30Results[chrom] = {
    schema_version: parsed.schema_version,
    tool:           parsed.tool || CHEAT30_TOOL,
    species:        parsed.species || 'unknown',
    generated_at:   parsed.generated_at || null,
    chrom:          chrom,
    candidates:     parsed.candidates,
  };
  return chrom;
}

/**
 * Persist one chrom's results to localStorage. Stored under
 * CHEAT30_LS_PREFIX + chrom so each chrom round-trips independently.
 * Fail-soft on quota / serialization errors.
 */
export function persistCheat30Results(state, chrom) {
  if (!state || !state.cheat30Results || !state.cheat30Results[chrom]) return false;
  if (!_hasLocalStorage()) return false;
  try {
    const obj = state.cheat30Results[chrom];
    localStorage.setItem(CHEAT30_LS_PREFIX + chrom, JSON.stringify(obj));
    return true;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[cheat30] persist failed:', e && e.message);
    }
    return false;
  }
}

/**
 * Restore all chroms from localStorage. Walks keys with the CHEAT30
 * prefix. Per-key fail-soft. Returns the number of chroms restored.
 *
 * Note: the legacy restore bypasses storeCheat30Results — it stashes
 * the parsed object directly. We preserve that behavior because the
 * persisted shape already matches the in-memory entry shape.
 */
export function restoreCheat30Results(state) {
  if (!state) return 0;
  if (!state.cheat30Results || typeof state.cheat30Results !== 'object') {
    state.cheat30Results = {};
  }
  if (!_hasLocalStorage()) return 0;
  let n = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(CHEAT30_LS_PREFIX) !== 0) continue;
      const chrom = k.substring(CHEAT30_LS_PREFIX.length);
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.chrom === chrom && parsed.candidates) {
          state.cheat30Results[chrom] = parsed;
          n++;
        }
      } catch (_) { /* skip individual failures */ }
    }
  } catch (_) { /* localStorage might be disabled */ }
  return n;
}

/** Drop one chrom's cheat30 results (in-memory + localStorage). */
export function clearCheat30Results(state, chrom) {
  if (!state) return;
  if (state.cheat30Results && state.cheat30Results[chrom]) {
    delete state.cheat30Results[chrom];
  }
  if (_hasLocalStorage()) {
    try { localStorage.removeItem(CHEAT30_LS_PREFIX + chrom); } catch (_) {}
  }
}

/** Look up the entry for a chrom. Returns null if not loaded. */
export function getCheat30Results(state, chrom) {
  if (!state || !state.cheat30Results) return null;
  return state.cheat30Results[chrom] || null;
}

/**
 * Per-candidate accessor. Returns the cheat30 result block for this
 * candidate or null if not loaded / not in the file. Used by both
 * the candidate-focus panel renderer and the manuscript bundle
 * exporter. Accepts either {id} or {candidate_id} (legacy compat).
 *
 * @param {Object} state
 * @param {{chrom:string, id?:string, candidate_id?:string}} c
 */
export function cheat30ForCandidate(state, c) {
  if (!state || !c || !state.cheat30Results) return null;
  const block = state.cheat30Results[c.chrom];
  if (!block || !block.candidates) return null;
  const cid = (c.id != null) ? c.id : c.candidate_id;
  return block.candidates[cid] || null;
}
