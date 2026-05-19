// pages/discovery/local_pca_dosage/enrichment.js
//
// Enrichment-layer merge (legacy lines 54182-54286). When the user
// drops an enrichment JSON file onto the page (or when the IDB
// restore path replays cached enrichments at startup), this merges
// the new file's layers into the active chromosome's state.data
// without overwriting anything that's already present.
//
// Behaviour rules:
//   - Chromosome mismatch: refuse the merge (return
//     rejected_chrom_mismatch: true). Enrichments are per-chrom.
//   - tracks: merge by key — new track names are appended, existing
//     ones are left untouched.
//   - All other named layers: copy the payload onto state.data only
//     if the layer isn't already in state.layersPresent. Unknown
//     layer names are dropped.
//   - state.layersPresent + state.data._layers_present are kept in
//     sync so layer-conditional UI sees the additions.
//
// Pure-ish: takes state explicitly, no DOM, no globals. The two
// cache-invalidation hooks at the end of the legacy version
// (_invalidateHetRateCache, _refreshL3HetToggleAvailability) were
// never-defined-in-cartridge typeof guards — preserved here so
// future extractions can wire them in by just defining the function.

import { detectSchemaAndLayers } from '../../../shared/page1_data_helpers.js';

// =====================================================================
// Layer registry (legacy switch cases)
// =====================================================================
// The legacy implementation enumerated every known layer name in a
// switch. We keep the same canonical set as a frozen list so other
// modules can iterate it (e.g. a "what enrichment did the user just
// drop?" diagnostic). Layer names not in this set are silently dropped
// during merge.

export const ENRICHMENT_LAYER_NAMES = Object.freeze([
  // Phase 3 cluster proposals
  'candidate_proposals',
  // Phase 4a — GHSL family
  'cluster_labels_ghsl', 'cusum_ghsl', 'ghsl_karyotype_runs',
  'ghsl_heatmap', 'ghsl_panel', 'ghsl_kstripes',
  // ancestry
  'ancestry_window', 'ancestry_sample', 'ancestry_q_means',
  'ancestry_q_global', 'ancestry_q_chrom', 'snp_q_support', 'relatedness',
  // Phase 4b — θπ
  'cluster_labels_theta', 'cusum_theta',
  // Phase 4c
  'dosage_dip',
  // Phase 4d
  'concordance_tables', 'cusum_concordance',
  // Phase 4e
  'subcandidates_emitted',
  // Phase 5 — SV
  'sv_evidence', 'bnd_rescue', 'boundaries_refined', 'qc_flags', 'groups_validated',
  // Phase 9 + 12
  'classification', 'gene_cargo',
  // Phase 13 — markers
  'marker_panel_summary', 'marker_catalogue', 'marker_primers',
  // v3.92 — band diagnostics source layers
  'theta_pi_panel', 'roh_intervals', 'sample_froh',
  // v3.94 — dosage heatmap
  'candidate_sample_coherence', 'candidate_marker_polarity', 'dosage_chunks',
]);

// Lookup set for fast membership tests
const ENRICHMENT_LAYER_SET = new Set(ENRICHMENT_LAYER_NAMES);

// =====================================================================
// Merge function
// =====================================================================

/**
 * Merge an enrichment JSON onto the active chromosome's state.data.
 * Mutates state.data and state.layersPresent in place. Returns
 * { added, rejected_chrom_mismatch } so the caller can surface a
 * diagnostic to the UI.
 *
 * @param {Object} state                local_pca_dosage _pageState (mutated)
 * @param {Object} enrichmentData       parsed enrichment JSON
 * @returns {{added: string[], rejected_chrom_mismatch: boolean}}
 */
export function mergeEnrichmentLayers(state, enrichmentData) {
  if (!state || !enrichmentData || !state.data) {
    return { added: [], rejected_chrom_mismatch: false };
  }
  if (enrichmentData.chrom && state.data.chrom &&
      enrichmentData.chrom !== state.data.chrom) {
    return { added: [], rejected_chrom_mismatch: true };
  }
  if (!state.layersPresent) state.layersPresent = new Set();
  const { layers } = detectSchemaAndLayers(enrichmentData);
  const added = [];

  // Tracks layer: merge by key (new names appended; existing untouched).
  if (layers.has('tracks') && enrichmentData.tracks) {
    if (!state.data.tracks) state.data.tracks = {};
    let mergedAny = false;
    for (const trkName of Object.keys(enrichmentData.tracks)) {
      if (state.data.tracks[trkName]) continue;   // don't overwrite
      state.data.tracks[trkName] = enrichmentData.tracks[trkName];
      mergedAny = true;
    }
    if (!state.layersPresent.has('tracks')) {
      state.layersPresent.add('tracks');
      added.push('tracks');
    }
    // mergedAny without prior absence: tracks already in layersPresent;
    // side-effect on state.data.tracks is enough for callers to re-render.
  }

  for (const name of layers) {
    if (name === 'tracks') continue;
    if (state.layersPresent.has(name)) continue;
    if (!ENRICHMENT_LAYER_SET.has(name)) continue;   // unknown → drop
    const payload = enrichmentData[name];
    if (payload == null) continue;
    state.data[name] = payload;
    state.layersPresent.add(name);
    added.push(name);
  }

  // Keep state.data._layers_present in sync with state.layersPresent
  // so layer-conditional UI sees the additions without us remembering
  // to update both.
  state.data._layers_present = Array.from(state.layersPresent);

  // Cache-invalidation hooks for dosage_chunks. Both functions are
  // never-defined-in-cartridge today; the typeof guards stay so a
  // future round can wire them in by just defining the function.
  if (added.indexOf('dosage_chunks') >= 0) {
    if (typeof _invalidateHetRateCache === 'function') {
      try { _invalidateHetRateCache(); } catch (_) {}
    }
    if (typeof _refreshL3HetToggleAvailability === 'function') {
      try { _refreshL3HetToggleAvailability(); } catch (_) {}
    }
  }

  return { added, rejected_chrom_mismatch: false };
}
