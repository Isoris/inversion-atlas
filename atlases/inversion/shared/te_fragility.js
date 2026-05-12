// shared/te_fragility.js
//
// Comparative TE fragility data layer
// (comparative_te_breakpoint_fragility_v1, alias te_fragility_v1).
// Per-(breakpoint, species) TE density at the homologous region —
// fold-enrichment vs chromosome background. The signal lets the user
// distinguish "confirmed polymorphic in Gar" from "candidate fragile
// region in species X" using the manuscript vocabulary.
//
// Legacy origin: lines 27560-27638 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

/** Accepted tool tags (primary + alias for backward compat). */
export const TE_FRAGILITY_TOOLS = Object.freeze([
  'comparative_te_breakpoint_fragility_v1',
  'te_fragility_v1',
]);

export const TE_FRAGILITY_LS_KEY = 'inversion_atlas.teFragility.v1';

/** Position-based match window for the (gar_chr, gar_pos_bp) fallback. */
export const TE_FRAGILITY_POS_MATCH_BP = 100_000;

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

export function isTEFragilityJSON(data) {
  return !!(
    data &&
    TE_FRAGILITY_TOOLS.includes(data.tool) &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.per_breakpoint_per_species)
  );
}

// =====================================================================
// Store / accessors
// =====================================================================

export function storeTEFragility(state, parsed) {
  if (!state || !isTEFragilityJSON(parsed)) return false;
  state.teFragility = {
    schema_version: parsed.schema_version,
    tool: parsed.tool,
    generated_at: parsed.generated_at || null,
    params: parsed.params ? JSON.parse(JSON.stringify(parsed.params)) : null,
    per_breakpoint_per_species: JSON.parse(JSON.stringify(parsed.per_breakpoint_per_species)),
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistTEFragility(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.teFragility) {
      localStorage.setItem(TE_FRAGILITY_LS_KEY, JSON.stringify(state.teFragility));
    } else {
      localStorage.removeItem(TE_FRAGILITY_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreTEFragility(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(TE_FRAGILITY_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeTEFragility(state, parsed);
  } catch (_) {
    return false;
  }
}

export function clearTEFragility(state) {
  if (!state) return;
  state.teFragility = null;
  persistTEFragility(state);
}

/**
 * Get TE fragility entry for an (active breakpoint, species) pair.
 * Returns the per-(bp, species) row or null when no entry matches.
 *
 * Match order:
 *   1. exact bp_id match
 *   2. gar_chr + gar_pos within TE_FRAGILITY_POS_MATCH_BP (100 kb)
 *
 * Per-row fields (typical): focal_te_density, bg_te_density_chrom,
 * fold_enrichment, percentile, homologous_chrom, focal_window_bp,
 * focal_lo_bp, focal_hi_bp.
 *
 * @param {Object} state
 * @param {Object} bp           cs_breakpoint object
 * @param {string} speciesId
 * @returns {Object|null}
 */
export function getTEFragilityForBreakpoint(state, bp, speciesId) {
  if (!state || !bp || !speciesId) return null;
  const tf = state.teFragility;
  if (!tf || !Array.isArray(tf.per_breakpoint_per_species)) return null;
  const bpId = bp.id;
  const garChr = bp.gar_chr;
  const garMid = bp.gar_pos_mb != null ? bp.gar_pos_mb * 1e6
               : (bp.gar_start && bp.gar_end ? (bp.gar_start + bp.gar_end) / 2 : null);
  for (const entry of tf.per_breakpoint_per_species) {
    if (!entry || entry.species !== speciesId) continue;
    if (entry.bp_id && entry.bp_id === bpId) return entry;
    if (garChr && garMid != null && entry.gar_chr) {
      const matchChr = entry.gar_chr === garChr
                    || entry.gar_chr === ('C_gar_' + garChr)
                    || ('C_gar_' + entry.gar_chr) === garChr;
      if (matchChr && entry.gar_pos_bp != null
          && Math.abs(entry.gar_pos_bp - garMid) < TE_FRAGILITY_POS_MATCH_BP) {
        return entry;
      }
    }
  }
  return null;
}
