// shared/cross_species.js
//
// cross_species_breakpoints_v1 data layer. The primary backing store
// for page16 (comparative): per-breakpoint records from a wfmash 1-to-1
// alignment between the focal species (Cgar) and one comparison species
// (Cmac) — flanking syntenic blocks, event-type classification
// (inversion / translocation / fission-or-fusion / mixed), flanking
// repeat density, and optional candidate_overlap to atlas candidates.
//
// Each breakpoint:
//   { id, event_type, event_type_refined?, gar_chr, gar_pos_start,
//     gar_pos_end, gar_pos_mb, n_member_breakpoints?,
//     prev_block: { mac_chr, mac_start_bp, mac_end_bp, strand,
//                   block_size_bp, mapping_quality },
//     next_block: { ... },
//     flanking_repeat_density_gar: { <class>: { mean, max, n_windows } },
//     flanking_repeat_density_mac: { prev: { mac_chr, anchor_bp,
//                                            by_class }, next: { ... } },
//     candidate_overlap?: [<candidate_id>, ...],
//     manuscript_note?: <string> }
//
// Schema v2 additionally ships synteny_blocks[] + chrom_lengths_{query,
// target} for the dotplot panel; v1 JSONs are still accepted (the
// fields are simply absent and the UI falls back to "no synteny
// analysis available").
//
// Legacy origin: lines 20985-21114 of legacy/Inversion_atlas.html.
//
// State-as-first-arg, headless-tolerant LS access.

// =====================================================================
// Constants
// =====================================================================

export const CROSS_SPECIES_TOOL = 'cross_species_breakpoints_v1';
export const CROSS_SPECIES_LS_KEY = 'pca_scrubber_v3.crossSpecies.v1';

/** Default flank window used when computing flanking_repeat_density. */
export const CROSS_SPECIES_FLANK_DEFAULT_BP = 100_000;

/**
 * Event-type label / colour map. Keys match both event_type and
 * event_type_refined fields on a breakpoint. Renderers look up by
 * the breakpoint's effective event_type and pull label / cls / icon.
 * Frozen because it's a presentation contract — adding new types
 * requires renderer changes.
 */
export const CS_EVENT_DEF = Object.freeze({
  inversion:                { label: 'inversion',         cls: 'cs-evt-inv',   icon: '◆' },
  translocation:            { label: 'translocation',     cls: 'cs-evt-trans', icon: '↦' },
  fission_or_fusion:        { label: 'fission/fusion',    cls: 'cs-evt-fis',   icon: '✂' },
  translocation_or_fission: { label: 'transloc.|fission', cls: 'cs-evt-trans', icon: '↦' },
  mixed:                    { label: 'mixed',             cls: 'cs-evt-mixed', icon: '◧' },
});

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

export function isCrossSpeciesJSON(data) {
  return !!(
    data &&
    data.tool === CROSS_SPECIES_TOOL &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.breakpoints)
  );
}

// =====================================================================
// UI state lifecycle
// =====================================================================

/**
 * Ensure state._crossSpeciesUI exists with the canonical shape:
 *   { active_id, filter: {events, search}, sort, flank_bp }
 * UI state is NOT persisted across reloads (intentional — the filter +
 * sort are session-scoped). Idempotent. Also ensures state.crossSpecies
 * is null (not undefined) when no data is loaded yet.
 */
export function ensureCrossSpeciesState(state) {
  if (!state) return null;
  if (!state.crossSpecies || typeof state.crossSpecies !== 'object') {
    state.crossSpecies = null;
  }
  if (!state._crossSpeciesUI) {
    state._crossSpeciesUI = {
      active_id: null,
      filter: { events: null, search: '' },
      sort: 'gar_pos',
      flank_bp: CROSS_SPECIES_FLANK_DEFAULT_BP,
    };
  }
  return state._crossSpeciesUI;
}

// =====================================================================
// Store / accessors
// =====================================================================

/**
 * Store a parsed cs_breakpoints_v1 JSON onto state.crossSpecies.
 * Deep-copies breakpoints + synteny_blocks (defensive guard against
 * shared-reference mutation paths). Invalidates the derived synteny
 * + per-window overlay caches so they recompute against the new data.
 *
 * Schema v2 fields (synteny_blocks + chrom_lengths_{query,target})
 * stored as-is when present; absent on v1 JSONs.
 */
export function storeCrossSpecies(state, parsed) {
  if (!state || !isCrossSpeciesJSON(parsed)) return false;
  state.crossSpecies = {
    schema_version:  parsed.schema_version,
    tool:            parsed.tool,
    generated_at:    parsed.generated_at || null,
    species_query:   parsed.species_query  || { name: 'unknown', haplotype: '?' },
    species_target:  parsed.species_target || { name: 'unknown', haplotype: '?' },
    input_paf:       parsed.input_paf || null,
    params:          parsed.params || {},
    n_breakpoints:   typeof parsed.n_breakpoints === 'number'
                      ? parsed.n_breakpoints : parsed.breakpoints.length,
    n_by_event_type: parsed.n_by_event_type || {},
    breakpoints:     JSON.parse(JSON.stringify(parsed.breakpoints)),
    loaded_at:       new Date().toISOString(),
    synteny_blocks:        Array.isArray(parsed.synteny_blocks)
                            ? JSON.parse(JSON.stringify(parsed.synteny_blocks)) : null,
    n_synteny_blocks:      typeof parsed.n_synteny_blocks === 'number'
                            ? parsed.n_synteny_blocks
                            : (Array.isArray(parsed.synteny_blocks)
                                ? parsed.synteny_blocks.length : 0),
    chrom_lengths_query:   parsed.chrom_lengths_query  || {},
    chrom_lengths_target:  parsed.chrom_lengths_target || {},
  };
  state._csSyntenyCache = null;
  state._csSyntenyEdgesCache = null;
  state._csInversionContextCache = null;
  state._csOverlayIndex = null;
  return true;
}

export function persistCrossSpecies(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.crossSpecies) {
      localStorage.setItem(CROSS_SPECIES_LS_KEY, JSON.stringify(state.crossSpecies));
    } else {
      localStorage.removeItem(CROSS_SPECIES_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreCrossSpecies(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(CROSS_SPECIES_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeCrossSpecies(state, parsed);
  } catch (_) {
    return false;
  }
}

/**
 * Clear cross_species data. Drops in-memory + LS, clears the UI
 * active_id, and invalidates all derived caches.
 */
export function clearCrossSpecies(state) {
  if (!state) return;
  state.crossSpecies = null;
  if (state._crossSpeciesUI) state._crossSpeciesUI.active_id = null;
  state._csSyntenyCache = null;
  state._csSyntenyEdgesCache = null;
  state._csInversionContextCache = null;
  state._csOverlayIndex = null;
  persistCrossSpecies(state);
}

// =====================================================================
// Pure helpers
// =====================================================================

/**
 * Look up a breakpoint by id. Returns null when no cross-species data
 * is loaded or the id isn't present.
 */
export function getCrossSpeciesBreakpointById(state, bpId) {
  if (!state || !bpId) return null;
  const cs = state.crossSpecies;
  if (!cs || !Array.isArray(cs.breakpoints)) return null;
  for (let i = 0; i < cs.breakpoints.length; i++) {
    if (cs.breakpoints[i] && cs.breakpoints[i].id === bpId) return cs.breakpoints[i];
  }
  return null;
}

/**
 * Look up the event-type definition (label / cls / icon) for a
 * breakpoint. Prefers event_type_refined, falls back to event_type.
 * Returns null when neither is set or the type isn't in CS_EVENT_DEF.
 */
export function getCsEventDef(bp) {
  if (!bp) return null;
  const t = bp.event_type_refined || bp.event_type;
  if (!t) return null;
  return CS_EVENT_DEF[t] || null;
}
