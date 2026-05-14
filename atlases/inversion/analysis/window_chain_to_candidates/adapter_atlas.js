// analysis/window_chain_to_candidates/adapter_atlas.js
// =====================================================================
// Adapter bridging compute() and the atlas runtime. Responsibilities:
//
//   buildInput(request, ctx) → input_json
//     Pulls per-window labels / PC1 / dosage / band_quality from
//     atlasState.data.windows (or from aplr.resolveLayer when wired).
//
//   saveOutput(result, request, ctx) → { layer_id, layer_status,
//                                         candidates_promoted }
//     Writes the chains as a `candidate_chain_set` layer (via
//     aplr.commitLayer when available; local stash fallback). When
//     `request.promote === true`, also calls
//     shared/candidate_promote.makeCandidateFromL2Merge for each
//     chain and pushes onto atlasState.candidateList.
//
// =====================================================================

import { compute } from './compute.js';

// =====================================================================
// 1. Input adapter
// =====================================================================

/**
 * @param {Object} request
 *   {
 *     chrom?:                  string,
 *     window_layer_id?:        string,    // atlas-core layer
 *     seed_windows?:           number[],
 *     params?:                 Object,
 *   }
 * @param {Object} ctx
 *   {
 *     atlasState?:             Object,
 *     aplr?:                   Object,
 *   }
 * @returns {Promise<Object>}   input_json
 */
export async function buildInput(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  let windows = null;
  let n_samples = 0;
  let chrom = r.chrom || null;

  // Path A: aplr resolver.
  if (c.aplr && r.window_layer_id && typeof c.aplr.resolveLayer === 'function') {
    try {
      const layer = await c.aplr.resolveLayer(r.window_layer_id);
      if (layer && Array.isArray(layer.windows)) windows = layer.windows;
      if (layer && layer.n_samples > 0) n_samples = layer.n_samples;
      if (layer && layer.chrom) chrom = chrom || layer.chrom;
    } catch (_) { /* fall through */ }
  }

  // Path B: atlasState.data.windows.
  if (!windows && c.atlasState && c.atlasState.data) {
    const d = c.atlasState.data;
    if (Array.isArray(d.windows)) windows = d.windows;
    if (d.n_samples > 0) n_samples = d.n_samples;
    if (d.chrom) chrom = chrom || d.chrom;
  }

  if (!windows) windows = [];

  // Normalise window rows into the schema_in shape.
  const norm = windows.map((w, idx) => ({
    idx:          (w && Number.isFinite(w.idx))   ? (w.idx | 0)   : idx,
    start_bp:     w && w.start_bp != null ? w.start_bp : null,
    end_bp:       w && w.end_bp   != null ? w.end_bp   : null,
    K:            (w && (w.K || w.k))             ? ((w.K || w.k) | 0) : 0,
    labels:       _toLabelArray(w && (w.labels || w.cluster_labels || w.kmeans_labels)),
    pc1:          _toFloatArray(w && (w.pc1 || w.samplePC1 || w.pca_pc1)),
    dosage:       _toFloatArray(w && w.dosage),
    band_quality: (w && Number.isFinite(w.band_quality)) ? w.band_quality : null,
  }));

  return {
    chrom,
    n_samples: n_samples || _inferNSamples(norm),
    windows: norm,
    seed_windows: Array.isArray(r.seed_windows) ? r.seed_windows.slice() : null,
    params: r.params || {},
    input_layer_ids: r.window_layer_id ? [r.window_layer_id] : [],
  };
}

function _inferNSamples(windows) {
  for (const w of windows) {
    if (Array.isArray(w.labels) && w.labels.length > 0) return w.labels.length;
  }
  return 0;
}

function _toLabelArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Int8Array || v instanceof Int16Array || v instanceof Int32Array
      || v instanceof Uint8Array) {
    return Array.from(v);
  }
  return [];
}

function _toFloatArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.slice();
  if (v instanceof Float32Array || v instanceof Float64Array) return Array.from(v);
  return null;
}

// =====================================================================
// 2. Output adapter
// =====================================================================

/**
 * Persist the result + optionally promote each chain to a candidate.
 *
 * @param {Object} result          compute() output
 * @param {Object} request
 *   { promote?: boolean, ... }
 * @param {Object} ctx
 *   { atlasState?, aplr?, makeCandidate? }
 *   makeCandidate(chain, ctx) → candidate-row; falls back to a built-in
 *   shape when omitted.
 * @returns {Promise<{
 *   layer_id:string, layer_status:string, candidates_promoted:number
 * }>}
 */
export async function saveOutput(result, request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const layer_type = 'candidate_chain_set';
  const scope = r.scope || { chrom: result && result.chrom };

  // Layer write.
  let sink = { layer_id: null, layer_status: 'no_sink' };
  if (c.aplr && typeof c.aplr.commitLayer === 'function') {
    try {
      const layer = await c.aplr.commitLayer({
        layer_type, scope,
        input_layer_ids: (result && result.input_layer_ids) || [],
        params:          (result && result.params_used) || {},
        payload:         result,
      });
      sink = {
        layer_id:     (layer && (layer.layer_id || layer.id)) || '(unknown)',
        layer_status: 'committed_via_aplr',
      };
    } catch (e) {
      try { console.warn('[window_chain_to_candidates] aplr.commitLayer failed:', e); }
      catch (_) {}
    }
  }
  if (sink.layer_status === 'no_sink' && c.atlasState) {
    if (!c.atlasState.inversion) c.atlasState.inversion = {};
    if (!c.atlasState.inversion._chain_sets) {
      c.atlasState.inversion._chain_sets = Object.create(null);
    }
    const key = (result && result.chrom) || '_no_chrom';
    c.atlasState.inversion._chain_sets[key] = result;
    sink = { layer_id: `local:${layer_type}:${key}`, layer_status: 'local_stash' };
  }

  // Optional candidate promotion.
  let promoted = 0;
  if (r.promote && result && Array.isArray(result.chains) && c.atlasState) {
    const makeFn = (typeof c.makeCandidate === 'function') ? c.makeCandidate : _defaultMakeCandidate;
    if (!Array.isArray(c.atlasState.candidateList)) c.atlasState.candidateList = [];
    for (const ch of result.chains) {
      const cand = makeFn(ch, { chrom: result.chrom });
      if (!cand) continue;
      c.atlasState.candidateList.push(cand);
      promoted++;
    }
  }

  return {
    layer_id:            sink.layer_id,
    layer_status:        sink.layer_status,
    candidates_promoted: promoted,
  };
}

function _defaultMakeCandidate(chain, env) {
  if (!chain) return null;
  return {
    id:              `chain_${chain.chain_type}_${chain.anchor_w}`,
    chrom:           env && env.chrom || null,
    start_bp:        chain.start_bp,
    end_bp:          chain.end_bp,
    start_w:         chain.start_w,
    end_w:           chain.end_w,
    anchor_w:        chain.anchor_w,
    chain_type:      chain.chain_type,
    source:          'window_chain',
    confirmed:       false,
    samples_per_arrangement: chain.samples_per_arrangement || null,
    evidence:        chain.evidence || null,
    cramers_v_mean:  chain.cramers_v_mean,
  };
}

// =====================================================================
// 3. One-shot
// =====================================================================

export async function runWindowChainToCandidates(request, ctx) {
  const input = await buildInput(request, ctx);
  const result = compute(input);
  const sink = await saveOutput(result, request, ctx);
  return { result, sink };
}
