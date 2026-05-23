// shared/dxy_per_inversion.js
//
// dxy_per_inversion_v1 data layer. Provides per-candidate dXY (between
// standard and inverted haplotypes inside the inversion) +
// fold_elevation vs flank, which is the quantitative signal for the
// age-model auto-suggest. Computed by R/Python on cohort BEAGLE dosage
// matrices; atlas just consumes the JSON.
//
// Legacy origin: lines 26462-26543 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

export const DXY_PER_INVERSION_TOOL = 'dxy_per_inversion_v1';
export const DXY_PER_INVERSION_LS_KEY = 'inversion_atlas.dxyPerInversion.v1';

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

export function isDxyPerInversionJSON(data) {
  return !!(
    data &&
    data.tool === DXY_PER_INVERSION_TOOL &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.per_inversion)
  );
}

// =====================================================================
// Store / accessors
// =====================================================================

export function storeDxyPerInversion(state, parsed) {
  if (!state || !isDxyPerInversionJSON(parsed)) return false;
  state.dxyPerInversion = {
    schema_version: parsed.schema_version,
    tool: parsed.tool,
    generated_at: parsed.generated_at || null,
    params: parsed.params || null,
    per_inversion: JSON.parse(JSON.stringify(parsed.per_inversion)),
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistDxyPerInversion(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.dxyPerInversion) {
      localStorage.setItem(DXY_PER_INVERSION_LS_KEY,
        JSON.stringify(state.dxyPerInversion));
    } else {
      localStorage.removeItem(DXY_PER_INVERSION_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreDxyPerInversion(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(DXY_PER_INVERSION_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeDxyPerInversion(state, parsed);
  } catch (_) {
    return false;
  }
}

export function clearDxyPerInversion(state) {
  if (!state) return;
  state.dxyPerInversion = null;
  persistDxyPerInversion(state);
}

/**
 * Fetch dXY entry for a breakpoint/candidate. Match priority:
 *   1. candidate_overlap[] from bp matches e.candidate_id
 *   2. bp.id matches e.candidate_id
 *   3. position-based: bp.gar_chr + bp.gar_pos_mb/(gar_start+gar_end)
 *      falls within e.[start_bp, end_bp]
 * Returns null when no match.
 *
 * @param {Object} state
 * @param {Object} bp   cs_breakpoint object
 * @returns {Object|null}
 */
export function getDxyForBreakpoint(state, bp) {
  if (!state || !bp) return null;
  const dxy = state.dxyPerInversion;
  if (!dxy || !Array.isArray(dxy.per_inversion)) return null;
  const candIds = Array.isArray(bp.candidate_overlap) ? bp.candidate_overlap : [];
  for (const e of dxy.per_inversion) {
    if (!e) continue;
    if (e.candidate_id
        && (candIds.indexOf(e.candidate_id) >= 0 || e.candidate_id === bp.id)) {
      return e;
    }
  }
  const garChr = bp.gar_chr;
  const garMid = bp.gar_pos_mb != null ? bp.gar_pos_mb * 1e6
               : (bp.gar_start && bp.gar_end ? (bp.gar_start + bp.gar_end) / 2 : null);
  if (!garChr || garMid == null) return null;
  for (const e of dxy.per_inversion) {
    if (!e || !e.chrom) continue;
    const matchChr = e.chrom === garChr
                  || e.chrom === ('C_gar_' + garChr)
                  || ('C_gar_' + e.chrom) === garChr;
    if (!matchChr) continue;
    if (e.start_bp != null && e.end_bp != null) {
      if (garMid >= e.start_bp && garMid <= e.end_bp) return e;
    }
  }
  return null;
}
