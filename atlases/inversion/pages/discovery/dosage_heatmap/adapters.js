// pages/discovery/dosage_heatmap/adapters.js
// =====================================================================
// Two data shapes feed the same canonical painter:
//
//   1. New SPEC_0 shape — output of
//      shared/mgl_heatmap_json.buildHeatmapFromDosage:
//         { n_samples, samples, n_markers,
//           markers: [ { marker, dosage_centered, polarity_flipped, ... } ],
//           ... }
//
//   2. Legacy chunk shape (the candidate dosage-heatmap in page2):
//         { samples, markers, dosage }
//      with row-major `dosage[marker_idx][sample_idx]`, plus the
//      caller-provided selection of marker indices + per-sample
//      lookups (group / k6 / quality), plus a per-marker polarity
//      lookup.
//
// Both adapters emit:
//   {
//     n_samples, n_markers,
//     cellValue:        (m, s) => number|null,
//     sample_group?:    Array<*>,
//     sample_k6?:       Int32Array,
//     marker_polarity?: Array<boolean>,
//     sample_labels?:   Array<string>,
//     marker_labels?:   Array<string>,
//     _source?:         'mgl_heatmap_json' | 'legacy_chunk',
//   }
//
// Pure compute. No DOM.
// =====================================================================

// =====================================================================
// 1. mgl_heatmap_json adapter
// =====================================================================

/**
 * Adapt the output of `shared/mgl_heatmap_json.buildHeatmapFromDosage`
 * (or `fromPrecomputedJson`) to the canonical heatmap shape.
 *
 * @param {Object} result
 * @param {Object} [opts]
 *   use_centered?:  boolean   default true  (display dosage_centered)
 *   sample_group?:  Array<*>            per-sample annotation
 *   sample_k6?:     Int32Array          per-sample cluster id
 * @returns {Object|null}
 */
export function adaptMglHeatmapJson(result, opts) {
  const o = opts || {};
  if (!result || !Array.isArray(result.markers) || result.markers.length === 0) {
    return null;
  }
  const useCentered = (o.use_centered !== false);
  const n_samples = (result.n_samples != null) ? result.n_samples
    : (result.samples && result.samples.length) || 0;
  const n_markers = result.n_markers || result.markers.length;
  if (n_samples === 0 || n_markers === 0) return null;

  // Resolve the per-marker arrays once.
  const rows = new Array(n_markers);
  const polarity = new Array(n_markers);
  const mlabels = new Array(n_markers);
  // 2026-05-16: per-marker role-pair sidecar track. SPEC_0 §1 defines
  // role_a / role_b ∈ {MAJOR, MINOR1, MINOR2, MINOR3}. For tri- and
  // quad-allelic markers the producer emits multiple pair rows
  // (MAJOR_MINOR1, MAJOR_MINOR2, MINOR1_MINOR2, etc.); the heatmap
  // can show all of them but the colour stripe lets the user spot
  // which pair each column is at a glance.
  const role_pair = new Array(n_markers);
  for (let i = 0; i < n_markers; i++) {
    const m = result.markers[i] || {};
    rows[i] = useCentered ? (m.dosage_centered || m.dosage || null)
                          : (m.dosage || m.dosage_centered || null);
    polarity[i] = !!m.polarity_flipped;
    mlabels[i] = String(m.marker || ('M' + i));
    // role_a / role_b absent on bi-allelic legacy precomp → null.
    role_pair[i] = (m.role_a && m.role_b) ? (m.role_a + '_' + m.role_b) : null;
  }
  const cellValue = (m, s) => {
    const row = rows[m];
    if (!row) return null;
    const v = row[s];
    return Number.isFinite(v) ? v : null;
  };
  return {
    n_samples,
    n_markers,
    cellValue,
    sample_group:    o.sample_group || null,
    sample_k6:       o.sample_k6 || null,
    marker_polarity: polarity,
    marker_role_pair: role_pair,    // 2026-05-16 — null per-marker on bi-only data
    sample_labels:   (result.samples && result.samples.slice()) || null,
    marker_labels:   mlabels,
    _source:         'mgl_heatmap_json',
  };
}

// =====================================================================
// 2. Legacy-chunk adapter
// =====================================================================

/**
 * Adapt the legacy candidate dosage-heatmap chunk shape to the
 * canonical heatmap shape. The legacy chunk indexes dosage by
 * (marker_idx, sample_idx), and the caller provides a list of
 * `selected_marker_indices` (a subset of chunk.markers to display).
 *
 * @param {Object} chunk
 *   { samples: string[],
 *     markers: Array<{ marker_id?, pos_bp?, ... }>,
 *     dosage:  Array<Int8Array|Int16Array|Array<number>>   row per marker }
 * @param {Object} [opts]
 *   selected_marker_indices?: number[]      default: all markers
 *   sample_group?:            Array<*>      per sample (length = chunk.samples.length)
 *   sample_k6?:               Int32Array
 *   marker_polarity?:         Array<boolean>|((col_in_selection:number) => boolean)
 *                                          per displayed marker (in selection order)
 * @returns {Object|null}
 */
export function adaptLegacyChunk(chunk, opts) {
  const o = opts || {};
  if (!chunk || !Array.isArray(chunk.samples) || !Array.isArray(chunk.markers)
      || !chunk.dosage) {
    return null;
  }
  const n_samples = chunk.samples.length;
  const sel = (Array.isArray(o.selected_marker_indices) && o.selected_marker_indices.length > 0)
    ? o.selected_marker_indices.slice()
    : null;
  const n_markers = sel ? sel.length : chunk.markers.length;
  if (n_samples === 0 || n_markers === 0) return null;

  // Build per-column polarity bool[].
  let polarity = null;
  if (Array.isArray(o.marker_polarity)) {
    polarity = o.marker_polarity.slice(0, n_markers).map(Boolean);
  } else if (typeof o.marker_polarity === 'function') {
    polarity = new Array(n_markers);
    for (let i = 0; i < n_markers; i++) polarity[i] = !!o.marker_polarity(i);
  }

  // Marker labels.
  const marker_labels = new Array(n_markers);
  for (let i = 0; i < n_markers; i++) {
    const mi = sel ? sel[i] : i;
    const m = chunk.markers[mi] || {};
    marker_labels[i] = String(m.marker_id || ('pos' + (m.pos_bp != null ? m.pos_bp : mi)));
  }

  // Display canonical-marker → chunk-marker index map.
  const cellValue = (m, s) => {
    const mi = sel ? sel[m] : m;
    const row = chunk.dosage[mi];
    if (!row) return null;
    const v = row[s];
    // Legacy uses -1 sentinel for NA.
    if (v == null || !Number.isFinite(v) || v < 0) return null;
    // Apply per-display polarity flip if requested.
    if (polarity && polarity[m]) return 2 - v;
    return v;
  };

  // 2026-05-16: legacy-chunk shape pre-dates the SPEC_0 role-pair
  // convention. Best-effort extract role_a/role_b from the chunk's
  // markers[mi] when present; otherwise leave null (the renderer's
  // role-pair track will simply not appear).
  const role_pair = new Array(n_markers);
  for (let i = 0; i < n_markers; i++) {
    const mi = sel ? sel[i] : i;
    const m = chunk.markers[mi] || {};
    role_pair[i] = (m.role_a && m.role_b) ? (m.role_a + '_' + m.role_b) : null;
  }

  return {
    n_samples,
    n_markers,
    cellValue,
    sample_group:    o.sample_group || null,
    sample_k6:       o.sample_k6 || null,
    marker_polarity: polarity,
    marker_role_pair: role_pair,    // 2026-05-16 — null per-marker on legacy bi-only chunks
    sample_labels:   chunk.samples.slice(),
    marker_labels,
    _source:         'legacy_chunk',
  };
}
