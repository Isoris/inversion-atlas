// analysis/scrubber_main_validator/adapter_atlas.js
// =====================================================================
// Adapter bridging compute() and the atlas runtime. Responsibilities:
//
//   buildInput(request, ctx) → input_json
//     Resolves the scrubber_main schema (default:
//     atlases/inversion/registries/schemas/scrubber_main.schema.json)
//     and pairs it with the supplied payload.
//
//   saveOutput(result, request, ctx) → { layer_id, layer_status }
//     Writes the validation result back as a `scrubber_main_validation`
//     side-channel layer via aplr.commitLayer (or local stash).
//
//   gateLoad(payload, ctx) → result   (convenience wrapper)
//     One-shot: build → compute → optionally throw on error. Designed
//     for page1's load path so it can call:
//        validate.gateLoad(json, { aplr, strict: false }).then(...)
//
// =====================================================================

import { compute } from './compute.js';

const DEFAULT_SCHEMA_PATH =
  'atlases/inversion/registries/schemas/scrubber_main.schema.json';

/**
 * Resolve the scrubber_main JSON Schema. Three resolution paths in
 * priority order:
 *   1. ctx.schema           — caller-supplied; wins.
 *   2. ctx.aplr.resolveSchema(schema_path) when available.
 *   3. Node fs read (when running under Node tests / CLI batch).
 *   4. null (compute returns schema_supplied=false).
 *
 * @param {Object} ctx
 * @param {string} [schema_path]
 * @returns {Promise<Object|null>}
 */
export async function resolveSchema(ctx, schema_path) {
  const path = schema_path || DEFAULT_SCHEMA_PATH;
  const c = ctx || {};
  if (c.schema && typeof c.schema === 'object') return c.schema;
  if (c.aplr && typeof c.aplr.resolveSchema === 'function') {
    try { return await c.aplr.resolveSchema(path); } catch (_) { /* fall through */ }
  }
  // Node fs fallback — only useful in tests / CLI; not in the browser.
  try {
    const fs = await import('fs');
    const buf = fs.readFileSync(path, 'utf8');
    return JSON.parse(buf);
  } catch (_) { /* not available in browser */ }
  return null;
}

/**
 * Build a schema_in.json-conforming input.
 *
 * @param {Object} request   { payload, schema?, schema_path?, params? }
 * @param {Object} ctx
 * @returns {Promise<Object>}
 */
export async function buildInput(request, ctx) {
  const r = request || {};
  const c = ctx || {};
  // Resolution priority: explicit request.schema → ctx.schema →
  // aplr.resolveSchema → fs fallback.
  let schema = null;
  if (r.schema && typeof r.schema === 'object') schema = r.schema;
  else if (c.schema && typeof c.schema === 'object') schema = c.schema;
  else schema = await resolveSchema(c, r.schema_path);
  return {
    payload: r.payload,
    schema,
    params: r.params || {},
    input_layer_ids: r.payload_layer_id ? [r.payload_layer_id] : [],
  };
}

/**
 * Persist the validation result. Writes via aplr.commitLayer when
 * available, falls back to atlasState.inversion._scrubber_main_validation.
 *
 * @returns {Promise<{layer_id:string|null, layer_status:string}>}
 */
export async function saveOutput(result, request, ctx) {
  const r = request || {};
  const c = ctx || {};
  const layer_type = 'scrubber_main_validation';
  const scope = r.scope
    || { chrom: result && result.summary && result.summary.validated_chrom };

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
      try { console.warn('[scrubber_main_validator] aplr.commitLayer failed:', e); }
      catch (_) {}
    }
  }
  if (c.atlasState) {
    if (!c.atlasState.inversion) c.atlasState.inversion = {};
    if (!c.atlasState.inversion._scrubber_main_validation) {
      c.atlasState.inversion._scrubber_main_validation = Object.create(null);
    }
    const key = (result && result.summary && result.summary.validated_chrom) || '_no_chrom';
    c.atlasState.inversion._scrubber_main_validation[key] = result;
    return { layer_id: `local:${layer_type}:${key}`, layer_status: 'local_stash' };
  }
  return { layer_id: null, layer_status: 'no_sink' };
}

/**
 * One-shot: build → compute → (optionally throw) → save. Designed
 * for the page1 load path.
 *
 * @param {*} payload     the just-loaded scrubber_main JSON
 * @param {Object} [ctx]
 *   throw_on_error?:    boolean (default false)
 *   strict?:            boolean (default false)
 *   atlasState?, aplr?, schema?, schema_path?
 * @returns {Promise<{result:Object, sink:Object}>}
 */
export async function gateLoad(payload, ctx) {
  const c = ctx || {};
  const input = await buildInput({
    payload,
    schema_path: c.schema_path,
    params: { strict: !!c.strict, max_errors: c.max_errors },
  }, c);
  const result = compute(input);
  const sink = await saveOutput(result, {}, c);
  if (!result.ok && c.throw_on_error) {
    const first = result.errors[0];
    const err = new Error(
      `scrubber_main validation failed: ${first ? first.message : 'no message'}`
      + (first && first.path ? ` (at ${first.path})` : '')
      + ` (${result.summary.n_errors} error${result.summary.n_errors === 1 ? '' : 's'} total)`);
    err.errors = result.errors;
    err.warnings = result.warnings;
    err.sink = sink;
    throw err;
  }
  return { result, sink };
}
