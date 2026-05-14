// analysis/anchor_track_cache/adapter_atlas.js
// =====================================================================
// Adapter bridging compute() and the atlas runtime. Pulls window
// labels + K from atlasState.data.windows (or aplr.resolveLayer when
// wired) and emits a precomputed track set ready for downstream
// caching.
//
// saveOutput stashes the result on atlasState.inversion._anchor_tracks
// (keyed by chrom) — the chain-walking modules read from there in
// preference to recomputing.
// =====================================================================

import { compute } from './compute.js';
import { createAnchorTrackCache }
  from '../../shared/band_tracking/anchor_track_cache.js';

// =====================================================================
// 1. Input adapter
// =====================================================================

export async function buildInput(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  let windows = null;
  let chrom = r.chrom || null;
  if (c.aplr && r.window_layer_id && typeof c.aplr.resolveLayer === 'function') {
    try {
      const layer = await c.aplr.resolveLayer(r.window_layer_id);
      if (layer && Array.isArray(layer.windows)) windows = layer.windows;
      if (layer && layer.chrom) chrom = chrom || layer.chrom;
    } catch (_) { /* fall through */ }
  }
  if (!windows && c.atlasState && c.atlasState.data) {
    const d = c.atlasState.data;
    if (Array.isArray(d.windows)) windows = d.windows;
    if (d.chrom) chrom = chrom || d.chrom;
  }
  if (!windows) windows = [];

  // Normalise window rows.
  const norm = windows.map((w, idx) => ({
    idx:    (w && Number.isFinite(w.idx)) ? (w.idx | 0) : idx,
    K:      (w && (w.K || w.k)) ? ((w.K || w.k) | 0) : 0,
    labels: _toArray(w && (w.labels || w.cluster_labels || w.kmeans_labels)),
  }));

  // Resolve anchor list: request.anchors > all valid windows.
  const anchors = Array.isArray(r.anchors) && r.anchors.length > 0
    ? r.anchors.slice()
    : norm.filter(w => w.K >= 2).map(w => w.idx);

  return {
    chrom,
    windows: norm,
    anchors,
    params: r.params || {},
    input_layer_ids: r.window_layer_id ? [r.window_layer_id] : [],
  };
}

function _toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Int8Array || v instanceof Int16Array || v instanceof Int32Array
      || v instanceof Uint8Array) return Array.from(v);
  return [];
}

// =====================================================================
// 2. Output adapter
// =====================================================================

export async function saveOutput(result, request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const layer_type = 'anchor_track_cache';
  const scope = r.scope || { chrom: result && result.chrom };

  if (c.aplr && typeof c.aplr.commitLayer === 'function') {
    try {
      const layer = await c.aplr.commitLayer({
        layer_type, scope,
        input_layer_ids: (result && result.input_layer_ids) || [],
        params:          (result && result.params_used) || {},
        payload:         result,
      });
      return {
        layer_id:     (layer && (layer.layer_id || layer.id)) || '(unknown)',
        layer_status: 'committed_via_aplr',
      };
    } catch (e) {
      try { console.warn('[anchor_track_cache] aplr.commitLayer failed:', e); }
      catch (_) {}
    }
  }
  if (c.atlasState) {
    if (!c.atlasState.inversion) c.atlasState.inversion = {};
    if (!c.atlasState.inversion._anchor_tracks) {
      c.atlasState.inversion._anchor_tracks = Object.create(null);
    }
    const key = (result && result.chrom) || '_no_chrom';
    c.atlasState.inversion._anchor_tracks[key] = result;
    return { layer_id: `local:${layer_type}:${key}`, layer_status: 'local_stash' };
  }
  return { layer_id: null, layer_status: 'no_sink' };
}

// =====================================================================
// 3. Live cache builder (skips JSON serialisation step)
// =====================================================================

/**
 * Build a live in-memory cache (createAnchorTrackCache) directly from
 * atlasState.data.windows. This is the path page22 + window_chain_to_
 * candidates should use when they want fast getV/getHoff queries
 * without round-tripping through JSON.
 *
 * @param {Object} atlasState
 * @returns {Object}    cache API from createAnchorTrackCache, or a
 *                       disabled cache when atlasState lacks windows.
 */
export function buildLiveCache(atlasState) {
  const d = atlasState && atlasState.data;
  if (!d || !Array.isArray(d.windows) || d.windows.length === 0) {
    return createAnchorTrackCache({});  // returns the disabled cache
  }
  const winByIdx = new Map();
  let s_window = Infinity, e_window = -Infinity;
  for (let i = 0; i < d.windows.length; i++) {
    const w = d.windows[i];
    const idx = (w && Number.isFinite(w.idx)) ? (w.idx | 0) : i;
    winByIdx.set(idx, w);
    if (idx < s_window) s_window = idx;
    if (idx > e_window) e_window = idx;
  }
  return createAnchorTrackCache({
    getLabels: (w) => {
      const row = winByIdx.get(w);
      if (!row) return null;
      const lbl = row.labels || row.cluster_labels || row.kmeans_labels;
      return Array.isArray(lbl) || ArrayBuffer.isView(lbl) ? Int8Array.from(lbl) : null;
    },
    getK: (w) => {
      const row = winByIdx.get(w);
      if (!row) return 0;
      const K = row.K || row.k || 0;
      return K | 0;
    },
    chr_s_window: s_window,
    chr_e_window: e_window,
  });
}

// =====================================================================
// 4. One-shot
// =====================================================================

export async function runAnchorTrackCache(request, ctx) {
  const input = await buildInput(request, ctx);
  const result = compute(input);
  const sink = await saveOutput(result, request, ctx);
  return { result, sink };
}
