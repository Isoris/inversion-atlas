// shared/synteny_multispecies.js
//
// Multi-species synteny data layer + companion phylo-tree layer +
// multi-species UI prefs. These three layers ship together as one
// module because they're consumed as a triple by the page16 comparative
// dashboard (active breakpoint × species list × tree topology).
//
// Layers:
//   - synteny_multispecies (catfish_synteny_toolkit_v1 /
//                            synteny_multispecies_v1)
//     Per-species manifest + synteny blocks + per-breakpoint
//     lineage_distribution (which species show boundary_present /
//     boundary_absent / fission / fusion).
//   - phylo_tree (phylo_tree_v1)
//     Species-set newick + optional calibration + support values for
//     the multi-species UI tree axis.
//   - multi_species_ui (state._multiSpeciesUI)
//     User-prefs blob: active_species selection.
//
// Legacy origin: lines 26090-26322 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant.

// =====================================================================
// Constants
// =====================================================================

export const SYNTENY_MULTISPECIES_TOOLS = Object.freeze([
  'catfish_synteny_toolkit_v1',
  'synteny_multispecies_v1',
]);

export const SYNTENY_MULTISPECIES_LS_KEY = 'inversion_atlas.syntenyMultispecies.v1';
export const PHYLO_TREE_LS_KEY = 'inversion_atlas.phyloTree.v1';
export const MULTI_SPECIES_UI_LS_KEY = 'inversion_atlas.multiSpeciesUI.v1';

/** Position-based match window for the lineage-distribution fallback. */
export const MS_POS_MATCH_BP = 100_000;

/**
 * Default reference species manifest. Used as the fallback when no
 * synteny_multispecies_v1.json is loaded so the page is functional
 * at first open. Mirrors catfish-synteny-toolkit/config/
 * species_manifest.tsv extended to the 9-species recommendation
 * from the pre-filtering work (Trichomycteridae outgroup, then
 * Bagridae/Ictaluridae/Siluridae deep outgroups, then Clarias
 * context, then the two focal species).
 */
export const MS_DEFAULT_SPECIES = Object.freeze([
  { id: 'Tros',  label: 'Trichomycterus rosablanca',  tier: 'deep_outgroup',   focal: false },
  { id: 'Smer',  label: 'Silurus meridionalis',       tier: 'far_outgroup',    focal: false },
  { id: 'Tfulv', label: 'Tachysurus fulvidraco',      tier: 'far_outgroup',    focal: false },
  { id: 'Ipun',  label: 'Ictalurus punctatus',        tier: 'far_outgroup',    focal: false },
  { id: 'Hwyc',  label: 'Hemibagrus wyckioides',      tier: 'far_outgroup',    focal: false },
  { id: 'Phyp',  label: 'Pangasianodon hypophthalmus', tier: 'mid_outgroup',   focal: false },
  { id: 'Capus', label: 'Channallabes apus',          tier: 'clarias_context', focal: false },
  { id: 'Cfus',  label: 'Clarias fuscus',             tier: 'clarias_context', focal: false },
  { id: 'Cmac',  label: 'Clarias macrocephalus',      tier: 'core',            focal: true  },
  { id: 'Cgar',  label: 'Clarias gariepinus',         tier: 'core',            focal: true  },
]);

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// Multi-species UI state
// =====================================================================

/**
 * Initialize state._multiSpeciesUI from localStorage if available.
 * Also ensures state.syntenyMultispecies / state.phyloTree slots exist
 * (null when no data loaded). Idempotent.
 */
export function msInitState(state) {
  if (!state) return null;
  if (!state._multiSpeciesUI || typeof state._multiSpeciesUI !== 'object') {
    state._multiSpeciesUI = { active_species: null };
    if (_hasLocalStorage()) {
      try {
        const raw = localStorage.getItem(MULTI_SPECIES_UI_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            state._multiSpeciesUI = {
              active_species: typeof parsed.active_species === 'string'
                ? parsed.active_species : null,
            };
          }
        }
      } catch (_) { /* fail-soft */ }
    }
  }
  if (!state.syntenyMultispecies) state.syntenyMultispecies = null;
  if (!state.phyloTree) state.phyloTree = null;
  return state._multiSpeciesUI;
}

export function msPersistUI(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state._multiSpeciesUI) {
      localStorage.setItem(MULTI_SPECIES_UI_LS_KEY,
        JSON.stringify(state._multiSpeciesUI));
    } else {
      localStorage.removeItem(MULTI_SPECIES_UI_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

// =====================================================================
// synteny_multispecies layer
// =====================================================================

export function isSyntenyMultispeciesJSON(data) {
  return !!(
    data &&
    SYNTENY_MULTISPECIES_TOOLS.includes(data.tool) &&
    typeof data.schema_version === 'number' &&
    Array.isArray(data.species) &&
    Array.isArray(data.synteny_blocks)
  );
}

export function storeSyntenyMultispecies(state, parsed) {
  if (!state || !isSyntenyMultispeciesJSON(parsed)) return false;
  state.syntenyMultispecies = {
    schema_version: parsed.schema_version,
    tool: parsed.tool,
    generated_at: parsed.generated_at || null,
    species: JSON.parse(JSON.stringify(parsed.species)),
    synteny_blocks: JSON.parse(JSON.stringify(parsed.synteny_blocks)),
    breakpoints_multilineage: Array.isArray(parsed.breakpoints_multilineage)
      ? JSON.parse(JSON.stringify(parsed.breakpoints_multilineage)) : [],
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistSyntenyMultispecies(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.syntenyMultispecies) {
      localStorage.setItem(SYNTENY_MULTISPECIES_LS_KEY,
        JSON.stringify(state.syntenyMultispecies));
    } else {
      localStorage.removeItem(SYNTENY_MULTISPECIES_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restoreSyntenyMultispecies(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(SYNTENY_MULTISPECIES_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeSyntenyMultispecies(state, parsed);
  } catch (_) {
    return false;
  }
}

export function clearSyntenyMultispecies(state) {
  if (!state) return;
  state.syntenyMultispecies = null;
  persistSyntenyMultispecies(state);
}

// =====================================================================
// phylo_tree layer
// =====================================================================

export function isPhyloTreeJSON(data) {
  return !!(
    data &&
    data.tool === 'phylo_tree_v1' &&
    typeof data.schema_version === 'number' &&
    typeof data.newick === 'string' &&
    Array.isArray(data.species_set)
  );
}

export function storePhyloTree(state, parsed) {
  if (!state || !isPhyloTreeJSON(parsed)) return false;
  state.phyloTree = {
    schema_version: parsed.schema_version,
    tool: parsed.tool,
    species_set: JSON.parse(JSON.stringify(parsed.species_set)),
    newick: parsed.newick,
    calibration: parsed.calibration || null,
    support_values: parsed.support_values || null,
    provenance: parsed.provenance || null,
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistPhyloTree(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.phyloTree) {
      localStorage.setItem(PHYLO_TREE_LS_KEY, JSON.stringify(state.phyloTree));
    } else {
      localStorage.removeItem(PHYLO_TREE_LS_KEY);
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function restorePhyloTree(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(PHYLO_TREE_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storePhyloTree(state, parsed);
  } catch (_) {
    return false;
  }
}

export function clearPhyloTree(state) {
  if (!state) return;
  state.phyloTree = null;
  persistPhyloTree(state);
}

// =====================================================================
// Lookups
// =====================================================================

/**
 * Active breakpoint helper — pulls the page-16 selected breakpoint
 * object from state.crossSpecies.breakpoints by state._crossSpeciesUI.
 * active_id. Returns null if no breakpoint is selected or no cross-
 * species data is loaded.
 */
export function msGetActiveBreakpoint(state) {
  if (!state || !state.crossSpecies || !state._crossSpeciesUI) return null;
  const id = state._crossSpeciesUI.active_id;
  if (!id) return null;
  const bps = state.crossSpecies.breakpoints || [];
  for (let i = 0; i < bps.length; i++) {
    if (bps[i] && bps[i].id === id) return bps[i];
  }
  return null;
}

/**
 * Get the currently-effective species list. Precedence:
 *   1. synteny_multispecies.species (if loaded)
 *   2. MS_DEFAULT_SPECIES fallback
 * Returned list is shaped uniformly: [{id, label, tier, focal}].
 */
export function msGetEffectiveSpeciesList(state) {
  const sm = state && state.syntenyMultispecies;
  if (sm && Array.isArray(sm.species) && sm.species.length > 0) {
    return sm.species.map(sp => ({
      id:    sp.id || sp.name || '',
      label: sp.label || sp.name || sp.id || '',
      tier:  sp.tier || sp.role || null,
      focal: sp.focal === true || sp.role === 'focal'
          || sp.role === 'sister' || sp.id === 'Cgar' || sp.id === 'Cmac',
    })).filter(sp => sp.id);
  }
  return MS_DEFAULT_SPECIES.map(sp => ({ ...sp }));
}

/**
 * Lineage distribution lookup for a breakpoint. Reads
 * synteny_multispecies.breakpoints_multilineage when present.
 *
 * Match priority:
 *   1. exact bp_id match → mlbp.lineage_distribution
 *   2. gar_chr + gar_pos (mb or start/end midpoint) within
 *      MS_POS_MATCH_BP (100 kb) of mlbp.position.pos_bp
 *
 * Returns the lineage_distribution dict (species → status string)
 * or null when no match or no layer loaded.
 */
export function msGetLineageDistribution(state, bp) {
  if (!state || !bp) return null;
  const sm = state.syntenyMultispecies;
  if (!sm || !Array.isArray(sm.breakpoints_multilineage)) return null;
  const bpId = bp.id;
  const garChr = bp.gar_chr;
  const garMid = bp.gar_pos_mb != null ? bp.gar_pos_mb * 1e6
               : (bp.gar_start && bp.gar_end ? (bp.gar_start + bp.gar_end) / 2 : null);
  for (const mlbp of sm.breakpoints_multilineage) {
    if (!mlbp) continue;
    if (mlbp.bp_id && mlbp.bp_id === bpId) return mlbp.lineage_distribution || null;
    if (garChr && garMid != null && mlbp.position) {
      const matchChr = mlbp.position.chrom === garChr
                    || mlbp.position.chrom === ('C_gar_' + garChr)
                    || ('C_gar_' + mlbp.position.chrom) === garChr;
      if (matchChr && mlbp.position.pos_bp != null
          && Math.abs(mlbp.position.pos_bp - garMid) < MS_POS_MATCH_BP) {
        return mlbp.lineage_distribution || null;
      }
    }
  }
  return null;
}
