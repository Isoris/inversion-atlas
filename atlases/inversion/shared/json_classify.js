// shared/json_classify.js
//
// Central JSON-kind classifier. The file picker / drag-drop handler
// calls classifyJSONKind(parsed) to route every dropped file to the
// right loader. The dispatch is a fixed order — the first detector
// that says "yes" wins.
//
// Legacy origin: _classifyJSONKind at lines 55281-55325 of
// legacy/Inversion_atlas.html. The legacy version did runtime
// typeof-probing of window globals; this version imports the
// detectors directly from shared/ (cleaner, statically resolvable).
//
// Order matters — earlier detectors win when shapes overlap. The
// chromosome detector is intentionally last among the structured
// schemas so any tool-tagged JSON wins over the generic
// {n_windows, windows[]} chromosome shape.

import { isCrossSpeciesJSON }       from './cross_species.js';
import { isCohortDiversityJSON }    from './cohort_diversity.js';
import { isDotplotMashmapJSON }     from './dotplot_mashmap.js';
import {
  isSyntenyMultispeciesJSON,
  isPhyloTreeJSON,
}                                   from './synteny_multispecies.js';
import { isDxyPerInversionJSON }    from './dxy_per_inversion.js';
import { isTEFragilityJSON }        from './te_fragility.js';
import { isKaryotypeLineageJSON }   from './karyotype_lineage.js';
import { isNcRNADensityJSON }       from './ncrna_density.js';
import { isRepeatDensityJSON }      from './repeat_density.js';
import { isCheat30JSON }            from './cheat30_results.js';

// =====================================================================
// Constants
// =====================================================================

/**
 * All known JSON kind tags. The classifier returns one of these
 * strings; 'unknown' is the universal fallback.
 */
export const JSON_KINDS = Object.freeze([
  'cross_species',
  'cohort_diversity',
  'dotplot_mashmap',
  'synteny_multispecies',
  'phylo_tree',
  'dxy_per_inversion',
  'comp_te_fragility',
  'karyotype_lineage',
  'cheat30_results',
  'ncrna_density',
  'repeat_density',
  'chromosome',
  'enrichment',
  'unknown',
]);

/**
 * Per-tag classification info: human-readable label + state slot path.
 * `state_path` is the dotted accessor where this layer's data lives
 * after a successful store (e.g. 'crossSpecies' → state.crossSpecies).
 */
export const JSON_KIND_INFO = Object.freeze({
  cross_species:        { label: 'Cross-species breakpoints',  state_path: 'crossSpecies' },
  cohort_diversity:     { label: 'Cohort diversity',           state_path: 'cohortDiversity' },
  dotplot_mashmap:      { label: 'Dotplot (mashmap)',          state_path: 'dotplotMashmap' },
  synteny_multispecies: { label: 'Multi-species synteny',      state_path: 'syntenyMultispecies' },
  phylo_tree:           { label: 'Phylogenetic tree',          state_path: 'phyloTree' },
  dxy_per_inversion:    { label: 'dXY per inversion',          state_path: 'dxyPerInversion' },
  comp_te_fragility:    { label: 'Comparative TE fragility',   state_path: 'teFragility' },
  karyotype_lineage:    { label: 'Karyotype lineage',          state_path: 'karyotypeLineage' },
  cheat30_results:      { label: 'cheat30 GDS results',        state_path: 'cheat30Results' },
  ncrna_density:        { label: 'ncRNA density',              state_path: 'ncRNADensity' },
  repeat_density:       { label: 'TE / repeat density',        state_path: 'repeatDensity' },
  chromosome:           { label: 'Chromosome JSON',            state_path: 'data' },
  enrichment:           { label: 'Enrichment / aux layers',    state_path: null },
  unknown:              { label: 'Unknown shape',              state_path: null },
});

// =====================================================================
// Detectors
// =====================================================================

/**
 * Chromosome JSONs: the main per-chrom data file consumed by page1.
 * MUST have a positive integer n_windows AND a non-empty windows[]
 * array. Auxiliaries (relatedness, etc.) lack one or both — without
 * this guard the dropdown would show entries like "catfish_226_
 * relatedness (undefined W)" that can't be loaded as chromosomes.
 *
 * Legacy origin: lines 55206-55214.
 */
export function isChromosomeJSON(data) {
  return !!(
    data &&
    typeof data.n_windows === 'number' &&
    data.n_windows > 0 &&
    Array.isArray(data.windows) &&
    data.windows.length > 0
  );
}

/**
 * Generic enrichment JSON detector. Used as a catch-all for
 * auxiliary files (relatedness, etc.) that ship a _layers_present[]
 * array but don't match any of the structured-tool detectors.
 */
export function isEnrichmentJSON(data) {
  return !!(
    data &&
    typeof data === 'object' &&
    Array.isArray(data._layers_present)
  );
}

// =====================================================================
// Dispatch
// =====================================================================

/**
 * Run every detector in priority order. The first detector that
 * returns true wins; subsequent detectors don't run. Each detector
 * call is wrapped in try/catch so a malformed JSON that crashes one
 * detector doesn't abort the chain.
 *
 *   classifyJSONKind(parsed) → 'cross_species' | 'cohort_diversity'
 *                            | ... | 'enrichment' | 'unknown'
 *
 * @param {*} data
 * @returns {string}  a value from JSON_KINDS
 */
export function classifyJSONKind(data) {
  if (data == null) return 'unknown';
  // Detector chain. Order matters — see header comment.
  const chain = [
    ['cross_species',        isCrossSpeciesJSON],
    ['cohort_diversity',     isCohortDiversityJSON],
    ['dotplot_mashmap',      isDotplotMashmapJSON],
    ['synteny_multispecies', isSyntenyMultispeciesJSON],
    ['phylo_tree',           isPhyloTreeJSON],
    ['dxy_per_inversion',    isDxyPerInversionJSON],
    ['comp_te_fragility',    isTEFragilityJSON],
    ['karyotype_lineage',    isKaryotypeLineageJSON],
    ['cheat30_results',      isCheat30JSON],
    ['ncrna_density',        isNcRNADensityJSON],
    ['repeat_density',       isRepeatDensityJSON],
    ['chromosome',           isChromosomeJSON],
  ];
  for (const [kind, fn] of chain) {
    try { if (fn(data)) return kind; } catch (_) { /* skip broken detector */ }
  }
  if (isEnrichmentJSON(data)) return 'enrichment';
  return 'unknown';
}
