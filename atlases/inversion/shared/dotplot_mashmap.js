// shared/dotplot_mashmap.js
//
// dotplot_mashmap_v1 data layer. Multi-resolution mashmap dotplot
// alignments between the focal species (Cgar) and one comparison
// species (Cmac). Each resolution is a different mashmap parameter
// sweep (segment size + percent-identity threshold). Consumed by
// page16's dotplot panel.
//
// Legacy origin: lines 26017-26078 of legacy/Inversion_atlas.html.
//
// State-as-first-arg, headless-tolerant LS access.

// =====================================================================
// Constants
// =====================================================================

export const DOTPLOT_MASHMAP_TOOL = 'dotplot_mashmap_v1';
export const DOTPLOT_MASHMAP_LS_KEY = 'inversion_atlas.dotplot_mashmap';

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Detection
// =====================================================================

export function isDotplotMashmapJSON(data) {
  return !!(
    data &&
    data.tool === DOTPLOT_MASHMAP_TOOL &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.resolutions)
  );
}

// =====================================================================
// Store / accessors
// =====================================================================

/**
 * Store a parsed dotplot_mashmap_v1 JSON. Deep-copies resolutions[]
 * (defensive against shared-reference mutation).
 */
export function storeDotplotMashmap(state, parsed) {
  if (!state || !isDotplotMashmapJSON(parsed)) return false;
  state.dotplotMashmap = {
    schema_version:       parsed.schema_version,
    tool:                 parsed.tool,
    generated_at:         parsed.generated_at || null,
    species_query:        parsed.species_query  || null,
    species_target:       parsed.species_target || null,
    chrom_lengths_query:  parsed.chrom_lengths_query  || {},
    chrom_lengths_target: parsed.chrom_lengths_target || {},
    resolutions:          JSON.parse(JSON.stringify(parsed.resolutions)),
    loaded_at:            new Date().toISOString(),
  };
  return true;
}

export function persistDotplotMashmap(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.dotplotMashmap) {
      localStorage.setItem(DOTPLOT_MASHMAP_LS_KEY,
        JSON.stringify(state.dotplotMashmap));
    } else {
      localStorage.removeItem(DOTPLOT_MASHMAP_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreDotplotMashmap(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(DOTPLOT_MASHMAP_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeDotplotMashmap(state, parsed);
  } catch (_) {
    return false;
  }
}

/**
 * Drop dotplot data. Also clears the derived panel + fingerprint
 * caches so the next render rebuilds from scratch.
 */
export function clearDotplotMashmap(state) {
  if (!state) return;
  state.dotplotMashmap = null;
  state._csDotplotPanel = null;
  state._csDotplotPanelFp = null;
  persistDotplotMashmap(state);
}
