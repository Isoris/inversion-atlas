// analysis/anchor_track_cache/compute.js
// =====================================================================
// Pure JSON-in / JSON-out. Precomputes the anchor-relative V / H_off /
// K_w tracks for a chromosome range and a set of anchor windows.
// Designed for two consumers:
//
//   1. window_chain_to_candidates (PR #14) — replaces its built-in
//      Cramérs V chain walker with the band-tracking V definition
//      shared with seed_discovery, removing the two-V-definitions
//      discrepancy flagged in the audit.
//   2. Future genome-scale scans that need to query V(anchor, w) at
//      many windows cheaply (memoisation lives in
//      shared/band_tracking/anchor_track_cache.js).
//
// Schema: ./schema_in.json + ./schema_out.json.
// =====================================================================

import { createAnchorTrackCache }
  from '../../shared/band_tracking/anchor_track_cache.js';

/**
 * @param {Object} input    conforms to ./schema_in.json
 * @returns {Object}        conforms to ./schema_out.json
 */
export function compute(input) {
  const out = _emptyResult();
  if (!input || !Array.isArray(input.windows) || input.windows.length === 0
      || !Array.isArray(input.anchors) || input.anchors.length === 0) {
    return out;
  }
  out.chrom = input.chrom || null;
  out.input_layer_ids = Array.isArray(input.input_layer_ids)
    ? input.input_layer_ids.slice() : [];

  // Resolve window-idx ⇄ data lookup.
  const winByIdx = new Map();
  let inferredS = Infinity, inferredE = -Infinity;
  for (const w of input.windows) {
    const idx = w.idx | 0;
    winByIdx.set(idx, w);
    if (idx < inferredS) inferredS = idx;
    if (idx > inferredE) inferredE = idx;
  }
  const params = input.params || {};
  const s_window = Number.isFinite(params.s_window) ? (params.s_window | 0) : inferredS;
  const e_window = Number.isFinite(params.e_window) ? (params.e_window | 0) : inferredE;
  out.s_window = s_window;
  out.e_window = e_window;
  out.n_windows = Math.max(0, e_window - s_window + 1);
  out.params_used = { s_window, e_window };

  const getLabels = (w) => {
    const row = winByIdx.get(w);
    if (!row || !Array.isArray(row.labels)) return null;
    return Int8Array.from(row.labels);
  };
  const getK = (w) => {
    const row = winByIdx.get(w);
    return (row && row.K > 0) ? (row.K | 0) : 0;
  };

  const cache = createAnchorTrackCache({
    getLabels, getK,
    chr_s_window: s_window,
    chr_e_window: e_window,
  });

  // Materialise one track per requested anchor.
  for (const anchor_w_raw of input.anchors) {
    const anchor_w = anchor_w_raw | 0;
    const tracks = cache.getTracks(anchor_w);
    if (!tracks || tracks.disabled) {
      out.tracks.push({
        anchor_w,
        K_a:          null,
        disabled:     true,
        v_track:      null,
        h_off_track:  null,
        k_w_track:    null,
      });
      continue;
    }
    const v_arr  = Array.from(tracks.v_track,     v => Number.isFinite(v) ? v : null);
    const h_arr  = Array.from(tracks.h_off_track, v => Number.isFinite(v) ? v : null);
    const k_arr  = Array.from(tracks.k_w_track);
    const anchorRow = winByIdx.get(anchor_w);
    out.tracks.push({
      anchor_w,
      K_a:          anchorRow ? (anchorRow.K | 0) : null,
      disabled:     false,
      v_track:      v_arr,
      h_off_track:  h_arr,
      k_w_track:    k_arr,
    });
  }
  out.n_anchors = out.tracks.length;
  out.source = out.tracks.some(t => !t.disabled) ? 'compute' : 'insufficient';
  return out;
}

// =====================================================================
// Helpers
// =====================================================================

function _emptyResult() {
  return {
    chrom: null,
    s_window: 0, e_window: 0,
    n_windows: 0, n_anchors: 0,
    source: 'insufficient',
    tracks: [],
    input_layer_ids: [],
    params_used: null,
  };
}
