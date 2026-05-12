// shared/schema_layers.js
//
// Per-chromosome JSON schema-version + layers-present detection. The
// data-status badge, the registry modal, the per-page empty-state
// indicators, and the recent-files n_layers field all read what this
// function returns.
//
// Two paths:
//   - schema v2+: trust the JSON's _layers_present[] declaration, but
//     verify each declared name actually has the corresponding top-level
//     key populated (defensive — exporters drift, declared ≠ present).
//   - schema v1 / legacy: best-effort inference from the small core
//     layer set (windows / envelopes / tracks / samples). V2 layers
//     like sv_evidence, candidates_registry, groups_validated, etc.
//     are NEVER inferred from v1 — they must be explicitly declared.
//
// A v2 "recovery sweep" infers any layers the producer forgot to
// declare in _layers_present[] by re-running each layer's verification
// check directly. This fixes "0 layers" badges on JSONs that were
// exported by older scripts before the _layers_present manifest
// convention was enforced.
//
// Legacy origin: lines 52588-53039 of legacy/Inversion_atlas.html.

// =====================================================================
// Helpers
// =====================================================================

function _isFiniteArrayView(v) {
  return Array.isArray(v) || ArrayBuffer.isView(v);
}

// =====================================================================
// The canonical per-layer check table.
//
// One entry per known layer. The check function is called with the
// parsed chromosome JSON; truthy means "this layer is actually present
// in the data" (regardless of whether it was declared). Both the v2
// declared-layer verify pass and the v2 recovery sweep use the same
// table, so per-layer detection logic is defined exactly once.
//
// 'windows' / 'envelopes' / 'tracks' / 'samples' are also used by the
// v1 inference path.
// =====================================================================

export const LAYER_CHECKS = Object.freeze([
  // Phase 1+2 core layers (also inferred from v1)
  ['windows',                     d => !!d.windows && d.n_windows > 0],
  ['envelopes',                   d => (d.l1_envelopes && d.l1_envelopes.length > 0)
                                       || (d.l2_envelopes && d.l2_envelopes.length > 0)],
  ['tracks',                      d => !!d.tracks && Object.keys(d.tracks).length > 0],
  ['samples',                     d => !!d.samples && d.samples.length > 0],
  // Phase 3 (cluster proposals)
  ['candidate_proposals',         d => Array.isArray(d.candidate_proposals)],
  // Phase 4a (GHSL)
  ['cluster_labels_ghsl',         d => !!d.cluster_labels_ghsl],
  ['cusum_ghsl',                  d => !!d.cusum_ghsl],
  ['ghsl_karyotype_runs',         d => Array.isArray(d.ghsl_karyotype_runs)],
  ['ghsl_heatmap',                d => !!d.ghsl_heatmap && Array.isArray(d.ghsl_heatmap.matrix)],
  ['ghsl_panel',                  d => !!d.ghsl_panel
                                       && Array.isArray(d.ghsl_panel.samples)
                                       && !!d.ghsl_panel.div_roll],
  ['ghsl_kstripes',               d => !!d.ghsl_kstripes && !!d.ghsl_kstripes.by_k],
  ['ancestry_window',             d => !!d.ancestry_window && Array.isArray(d.ancestry_window.start_bp)],
  ['ancestry_sample',             d => !!d.ancestry_sample && Array.isArray(d.ancestry_sample.samples)],
  ['ancestry_q_means',            d => !!d.ancestry_q_means && !!d.ancestry_q_means.q_means],
  // v4 turn 9: ancestry confound layers
  ['ancestry_q_global',           d => !!d.ancestry_q_global
                                       && Array.isArray(d.ancestry_q_global.samples)
                                       && Array.isArray(d.ancestry_q_global.q)],
  ['ancestry_q_chrom',            d => !!d.ancestry_q_chrom
                                       && Array.isArray(d.ancestry_q_chrom.samples)
                                       && Array.isArray(d.ancestry_q_chrom.q)],
  ['snp_q_support',               d => !!d.snp_q_support && Array.isArray(d.snp_q_support.snps)],
  ['relatedness',                 d => !!d.relatedness
                                       && Array.isArray(d.relatedness.samples)
                                       && Array.isArray(d.relatedness.hub_id_1st)],
  // Phase 4b (theta)
  ['cluster_labels_theta',        d => !!d.cluster_labels_theta],
  ['cusum_theta',                 d => !!d.cusum_theta],
  // Phase 4c (dosage)
  ['dosage_dip',                  d => !!d.dosage_dip],
  // Phase 4d (concordance)
  ['concordance_tables',          d => !!d.concordance_tables],
  ['cusum_concordance',           d => !!d.cusum_concordance],
  // Phase 4e
  ['subcandidates_emitted',       d => Array.isArray(d.subcandidates_emitted)],
  // User-authored
  ['candidates_registry',         d => Array.isArray(d.candidates)],
  // Phase 5
  ['sv_evidence',                 d => !!d.sv_evidence],
  ['bnd_rescue',                  d => !!d.bnd_rescue],
  ['boundaries_refined',          d => !!d.boundaries_refined],
  ['qc_flags',                    d => !!d.qc_flags],
  ['groups_validated',            d => !!d.groups_validated],
  // Phase 9 + 12
  ['classification',              d => !!d.classification],
  ['gene_cargo',                  d => !!d.gene_cargo],
  // Phase 13 (marker / PCR)
  ['marker_panel_summary',        d => Array.isArray(d.marker_panel_summary)],
  ['marker_catalogue',            d => Array.isArray(d.marker_catalogue)],
  ['marker_primers',              d => Array.isArray(d.marker_primers)],
  // v3.92 band diagnostics
  ['theta_pi_panel',              d => !!d.theta_pi_panel && !!d.theta_pi_panel.div_roll
                                       && Array.isArray(d.theta_pi_panel.start_bp)],
  ['roh_intervals',               d => Array.isArray(d.roh_intervals)],
  ['sample_froh',                 d => !!d.sample_froh && _isFiniteArrayView(d.sample_froh)],
  // v3.94 dosage heatmap layers
  ['candidate_sample_coherence',  d => Array.isArray(d.candidate_sample_coherence)],
  ['candidate_marker_polarity',   d => Array.isArray(d.candidate_marker_polarity)],
  // dosage_chunks: index of chunk URLs (not the chunks themselves)
  ['dosage_chunks',               d => !!d.dosage_chunks && Array.isArray(d.dosage_chunks.chunks)],
  // schema 2.14 §15: per-sample theta-pi
  ['per_sample_theta_pi',         d => !!d.per_sample_theta_pi
                                       && (Array.isArray(d.per_sample_theta_pi.samples)
                                           || _isFiniteArrayView(d.per_sample_theta_pi.by_window))],
  // schema 2.16 §19: 14-axis classification per candidate
  ['final_classification',        d => !!d.final_classification
                                       && typeof d.final_classification === 'object'
                                       && !Array.isArray(d.final_classification)],
  // schema 2.19 §22: theta-pi scrubber layers (Shape B + extras)
  ['theta_pi_per_window',         d => !!d.theta_pi_per_window
                                       && Array.isArray(d.theta_pi_per_window.samples)
                                       && Array.isArray(d.theta_pi_per_window.windows)
                                       && _isFiniteArrayView(d.theta_pi_per_window.values)],
  ['theta_pi_local_pca',          d => !!d.theta_pi_local_pca
                                       && _isFiniteArrayView(d.theta_pi_local_pca.z)],
  ['theta_pi_envelopes',          d => !!d.theta_pi_envelopes
                                       && (Array.isArray(d.theta_pi_envelopes.l1)
                                           || Array.isArray(d.theta_pi_envelopes.l2)
                                           || Array.isArray(d.theta_pi_envelopes.candidate_intervals))],
]);

/** Layer names that the v1 inference path is allowed to emit. */
export const V1_INFERABLE_LAYERS = Object.freeze([
  'windows', 'envelopes', 'tracks', 'samples',
]);

/** Lookup: layer name → check function. Built once from LAYER_CHECKS. */
const _LAYER_CHECK_BY_NAME = (() => {
  const out = Object.create(null);
  for (const [name, fn] of LAYER_CHECKS) out[name] = fn;
  return Object.freeze(out);
})();

// =====================================================================
// Public API
// =====================================================================

/**
 * Best-effort v1 layer inference. Only the small core set (windows /
 * envelopes / tracks / samples) is reported — v2-only layers (sv_evidence,
 * candidates_registry, groups_validated, classification, gene_cargo, …)
 * are NEVER inferred from v1 and must be explicitly declared via
 * _layers_present[].
 *
 * @param {Object} data
 * @returns {Array<string>}
 */
export function inferLayersFromV1(data) {
  if (!data) return [];
  const out = [];
  for (const name of V1_INFERABLE_LAYERS) {
    const check = _LAYER_CHECK_BY_NAME[name];
    if (!check) continue;
    try { if (check(data)) out.push(name); } catch (_) {}
  }
  return out;
}

/**
 * Detect schema version + the set of layers that are actually present.
 * Returns { schemaVersion: number, layers: Set<string> }.
 *
 * v2+ path:
 *   1. Verify each name in data._layers_present[] against its check.
 *      Declared-but-not-present layers are dropped.
 *   2. Detect 'theta_pi_per_window' Shape A (per-window-embedded
 *      `w.theta` array) — this older shape predates the
 *      _layers_present manifest convention and would otherwise
 *      miss its dispatch.
 *   3. Recovery sweep: re-check every entry in LAYER_CHECKS that
 *      isn't already in the result. Catches cases where the exporter
 *      forgot to populate _layers_present[].
 *
 * v1 / legacy path:
 *   Returns inferLayersFromV1(data) wrapped in a Set.
 *
 * @param {Object} data
 * @returns {{schemaVersion:number, layers:Set<string>}}
 */
export function detectSchemaAndLayers(data) {
  if (!data) return { schemaVersion: 0, layers: new Set() };
  const v = data.schema_version;
  const isV2 = (v === 2 || v === '2' || (typeof v === 'number' && v >= 2));
  if (!isV2) {
    return { schemaVersion: 1, layers: new Set(inferLayersFromV1(data)) };
  }

  const actual = new Set();
  const declared = Array.isArray(data._layers_present) ? data._layers_present : [];

  // Pass 1: verify each declared name has its corresponding data.
  for (const name of declared) {
    if (typeof name !== 'string' || !name) continue;
    const check = _LAYER_CHECK_BY_NAME[name];
    if (check) {
      try { if (check(data)) actual.add(name); } catch (_) {}
    } else {
      // Unknown layer name: trust the declaration (the producer knows
      // what it's shipping; new layer names should never be silently
      // dropped just because this version of the atlas hasn't shipped
      // a check for them yet).
      actual.add(name);
    }
  }

  // theta_pi_per_window Shape A: per-window-embedded theta arrays.
  // Older R-side --theta exports ship this without declaring the layer.
  if (!actual.has('theta_pi_per_window')
      && data.windows && Array.isArray(data.windows) && data.windows.length > 0
      && data.windows[0] && Array.isArray(data.windows[0].theta)
      && data.windows[0].theta.length > 0) {
    actual.add('theta_pi_per_window');
  }

  // Pass 2: recovery sweep — infer any LAYER_CHECKS entry the
  // producer forgot to declare.
  for (const [name, check] of LAYER_CHECKS) {
    if (actual.has(name)) continue;
    try { if (check(data)) actual.add(name); } catch (_) {}
  }

  return { schemaVersion: 2, layers: actual };
}
