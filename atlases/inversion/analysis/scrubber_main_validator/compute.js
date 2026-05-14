// analysis/scrubber_main_validator/compute.js
// =====================================================================
// Pure JSON-in / JSON-out compute. Validates a candidate scrubber_main
// payload against the supplied JSON Schema and returns a structured
// validation result.
//
// Wraps shared/validators/json_schema_lite.js. No DOM, no fetch, no
// registry, no state. The adapter is responsible for resolving the
// schema (atlases/inversion/registries/schemas/scrubber_main.schema.json)
// and injecting it via input.schema.
//
// When `params.strict === true`, warnings are upgraded to errors
// (useful in tests or in producer CI; the runtime atlas can stay
// non-strict so unknown-keyword warnings don't kill page loads).
// =====================================================================

import { validateAgainstSchema } from '../../shared/validators/json_schema_lite.js';

/**
 * @param {Object} input    conforms to ./schema_in.json
 * @returns {Object}        conforms to ./schema_out.json
 */
export function compute(input) {
  const out = _emptyResult();
  if (!input) return out;
  out.input_layer_ids = Array.isArray(input.input_layer_ids)
    ? input.input_layer_ids.slice() : [];
  const params = _resolveParams(input.params);
  out.params_used = params;

  // No schema supplied → no-op informational result.
  if (!input.schema || typeof input.schema !== 'object') {
    out.summary.schema_supplied = false;
    out.summary.schema_id = null;
    return out;
  }
  out.summary.schema_supplied = true;
  out.summary.schema_id = (input.schema && input.schema.$id) || null;

  const r = validateAgainstSchema(input.payload, input.schema, {
    max_errors: params.max_errors,
  });

  let errors   = r.errors.slice();
  let warnings = r.warnings.slice();
  if (params.strict && warnings.length > 0) {
    // Upgrade warnings to errors in strict mode.
    errors = errors.concat(warnings.map(w => Object.assign({}, w,
      { message: 'STRICT: ' + w.message })));
    warnings = [];
  }

  out.ok                = errors.length === 0;
  out.errors            = errors;
  out.warnings          = warnings;
  out.summary.n_errors  = errors.length;
  out.summary.n_warnings= warnings.length;

  // Best-effort metadata extraction from the payload (useful in summaries).
  const p = input.payload;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    if (typeof p.chrom === 'string') out.summary.validated_chrom = p.chrom;
    if (Number.isInteger(p.n_windows)) out.summary.validated_n_windows = p.n_windows;
    if (Number.isInteger(p.n_samples)) out.summary.validated_n_samples = p.n_samples;
  }

  return out;
}

// =====================================================================
// Helpers
// =====================================================================

function _emptyResult() {
  return {
    ok: false,
    errors: [],
    warnings: [],
    summary: {
      n_errors: 0,
      n_warnings: 0,
      schema_id: null,
      validated_chrom: null,
      validated_n_windows: null,
      validated_n_samples: null,
      schema_supplied: false,
    },
    params_used: null,
    input_layer_ids: [],
  };
}

function _resolveParams(p) {
  const q = (p && typeof p === 'object') ? p : {};
  return {
    max_errors: Number.isFinite(q.max_errors) ? (q.max_errors | 0) : 50,
    strict:     !!q.strict,
  };
}
