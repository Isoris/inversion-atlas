// analysis/karyotype_assignment/adapter_atlas.js
// =====================================================================
// Adapter: bridges between the registry-agnostic compute() function
// and the inversion-atlas runtime (atlas-core registry, atlasState
// slots, ngsPedigree consumers).
//
// Two flow directions:
//
//   buildInput(request, ctx) → input_json
//     Pulls candidate.locked_labels, candidate.samplePC1,
//     candidate.per_sample_het from atlasState (or — when wired —
//     from atlas-core registry layer ids declared in `request`).
//     Output is a portable JSON conforming to schema_in.json.
//
//   saveOutput(result, request, ctx) → { layer_id, layer_status }
//     Writes the result back as a `candidate_karyotype_per_sample`
//     layer. When the atlas-core registry is wired through `ctx.aplr`,
//     calls `aplr.commitLayer({...})`. When it isn't, falls back to
//     a local-only stash on atlasState.inversion._karyotype_assignments
//     and emits a console hint so it shows up in dev logs.
//
// The compute function never sees the adapter or the registry. The
// adapter never sees the algorithm internals. Either side can be
// reimplemented independently.
// =====================================================================

import { compute } from './compute.js';

// =====================================================================
// 1. Input adapter
// =====================================================================

/**
 * Build a schema_in.json-conforming input from the active candidate
 * + (optional) per_sample_het layer.
 *
 * @param {Object} request
 *   {
 *     candidate_id?: string,                  // when omitted, reads
 *                                              // atlasState.candidate
 *     candidate_layer_id?: string,            // atlas-core layer id
 *     per_sample_het_layer_id?: string,       // atlas-core layer id
 *     params?: Object,                        // forwarded to compute
 *   }
 * @param {Object} ctx
 *   {
 *     atlasState?: Object,                    // direct state access
 *     aplr?: { resolveLayer, commitLayer },   // atlas-core registry
 *     candidate?: Object,                     // pre-resolved candidate
 *   }
 * @returns {Promise<Object>}  input_json
 */
export async function buildInput(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  // Resolve candidate.
  let candidate = c.candidate || null;
  if (!candidate && c.aplr && r.candidate_layer_id
      && typeof c.aplr.resolveLayer === 'function') {
    try {
      candidate = await c.aplr.resolveLayer(r.candidate_layer_id);
    } catch (_) { candidate = null; }
  }
  if (!candidate && c.atlasState) {
    // Fallback: read the active candidate from atlasState directly.
    // Hooks for several places the atlas has stashed it historically.
    candidate =
         (c.atlasState.candidate
       || (c.atlasState.inversion && c.atlasState.inversion.candidate)
       || (c.atlasState.shared    && c.atlasState.shared.candidate));
  }
  if (!candidate) {
    return { candidate: { K: 0, labels: [] }, params: r.params || {} };
  }

  // Resolve per_sample_het.
  let per_sample_het = candidate.per_sample_het || null;
  if (!per_sample_het && c.aplr && r.per_sample_het_layer_id
      && typeof c.aplr.resolveLayer === 'function') {
    try {
      const layer = await c.aplr.resolveLayer(r.per_sample_het_layer_id);
      if (layer && Array.isArray(layer.values)) per_sample_het = layer.values;
    } catch (_) { /* fall through to proxy path */ }
  }

  // Schema-conforming input.
  return {
    candidate: {
      id:               candidate.id || candidate.candidate_id || r.candidate_id || null,
      K:                candidate.K || candidate.k || 0,
      labels:           _toLabelArray(candidate.locked_labels || candidate.labels),
      pc1:              _toFloatArray(candidate.samplePC1 || candidate.pc1),
      per_sample_het:   per_sample_het ? _toFloatArray(per_sample_het) : null,
      samples:          _resolveSampleIds(candidate, c.atlasState),
    },
    params: r.params || {},
    input_layer_ids: _collectInputLayerIds(r),
  };
}

// =====================================================================
// 2. Output adapter
// =====================================================================

/**
 * Persist the compute() result back into the atlas runtime. Tries the
 * atlas-core registry first; falls back to a local atlasState stash.
 *
 * @returns {Promise<{layer_id:string, layer_status:string}>}
 */
export async function saveOutput(result, request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const layer_type = 'candidate_karyotype_per_sample';
  const scope = r.scope || { candidate_id: result && result.candidate_id };

  // Path A: atlas-core registry write.
  if (c.aplr && typeof c.aplr.commitLayer === 'function') {
    try {
      const layer = await c.aplr.commitLayer({
        layer_type,
        scope,
        input_layer_ids: (result && result.input_layer_ids) || [],
        params:          (result && result.params_used) || {},
        payload:         result,
      });
      return {
        layer_id:     layer && (layer.layer_id || layer.id) || '(unknown)',
        layer_status: 'committed_via_aplr',
      };
    } catch (e) {
      // Fall through to local-stash path; we don't want to lose the
      // result just because the registry isn't reachable in this
      // session.
      try { console.warn('[karyotype_assignment] aplr.commitLayer failed:', e); }
      catch (_) {}
    }
  }

  // Path B: local stash on atlasState. Keyed by candidate_id so
  // multiple candidates can coexist.
  if (c.atlasState) {
    if (!c.atlasState.inversion) c.atlasState.inversion = {};
    if (!c.atlasState.inversion._karyotype_assignments) {
      c.atlasState.inversion._karyotype_assignments = Object.create(null);
    }
    const cid = (result && result.candidate_id) || '_no_id';
    c.atlasState.inversion._karyotype_assignments[cid] = result;
    return { layer_id: `local:${layer_type}:${cid}`, layer_status: 'local_stash' };
  }

  return { layer_id: null, layer_status: 'no_sink' };
}

// =====================================================================
// 3. One-shot orchestrator
// =====================================================================

/**
 * Convenience: build input → compute → save output.
 *
 * @returns {Promise<{result:Object, sink:{layer_id, layer_status}}>}
 */
export async function runKaryotypeAssignment(request, ctx) {
  const input = await buildInput(request, ctx);
  const result = compute(input);
  const sink = await saveOutput(result, request, ctx);
  return { result, sink };
}

// =====================================================================
// 4. Helpers
// =====================================================================

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
  if (v.values && Array.isArray(v.values)) return v.values.slice();
  return null;
}

function _resolveSampleIds(candidate, atlasState) {
  if (Array.isArray(candidate.samples)) return candidate.samples.map(String);
  if (atlasState && atlasState.data && Array.isArray(atlasState.data.samples)) {
    return atlasState.data.samples.map(s =>
      String(s && (s.id || s.cga || s.ind || s.sample || s)));
  }
  return null;
}

function _collectInputLayerIds(request) {
  const out = [];
  if (request) {
    if (request.candidate_layer_id) out.push(request.candidate_layer_id);
    if (request.per_sample_het_layer_id) out.push(request.per_sample_het_layer_id);
    if (Array.isArray(request.input_layer_ids)) out.push(...request.input_layer_ids);
  }
  return out;
}
