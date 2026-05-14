// shared/validators/json_schema_lite.js
// =====================================================================
// Minimal JSON Schema (draft-07 subset) validator. Implements only
// the keywords the inversion-atlas registries actually use:
//
//   type            — 'object', 'array', 'string', 'number',
//                     'integer', 'boolean', 'null', or array of any
//                     of these (union types).
//   required        — array of required property names.
//   properties      — sub-schema per property.
//   items           — sub-schema for every array element.
//   minItems / maxItems
//   minLength / maxLength
//   minimum / maximum / exclusiveMinimum / exclusiveMaximum
//   enum            — value must equal one of the listed values.
//   additionalProperties (false → reject extras; schema → validate them)
//   oneOf / anyOf / allOf (subset: short-circuit on first match for
//                          anyOf/oneOf, all-match for allOf)
//   $ref            — only supports local refs of the form
//                     "#/definitions/X" against an in-document
//                     `definitions` block.
//
// NOT implemented (intentional): patternProperties, dependencies,
// not, conditionals (if/then/else), format, $id resolution beyond
// in-document.
//
// Pure JSON-in / JSON-out. No DOM, no fetch, no AJV dependency.
//
// Output:
//   { ok:boolean,
//     errors:   Array<{path:string, schema_path:string, message:string}>,
//     warnings: Array<{path:string, schema_path:string, message:string}>
//   }
//
// =====================================================================

/**
 * @param {*}      data       value to validate
 * @param {Object} schema     JSON Schema object
 * @param {Object} [opts]
 *   max_errors?: number      cap the error list (default 50)
 *   warn_on_unknown_keyword?: boolean   emit warnings for unrecognised
 *                                       JSON Schema keywords (default true)
 * @returns {{ok:boolean, errors:Array, warnings:Array}}
 */
export function validateAgainstSchema(data, schema, opts) {
  const o = opts || {};
  const max_errors = Number.isFinite(o.max_errors) ? o.max_errors : 50;
  const warn_unknown = (o.warn_on_unknown_keyword !== false);
  const ctx = {
    errors:        [],
    warnings:      [],
    max_errors,
    root_schema:   schema,
    warn_unknown,
  };
  _validate(data, schema, '', '', ctx);
  return {
    ok:       ctx.errors.length === 0,
    errors:   ctx.errors,
    warnings: ctx.warnings,
  };
}

// =====================================================================
// Internal: recursive validator
// =====================================================================

const KNOWN_KEYWORDS = new Set([
  '$id', '$schema', 'title', 'description', 'type', 'required',
  'properties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'enum', 'additionalProperties', 'oneOf', 'anyOf', 'allOf', '$ref',
  'definitions', 'default', '_doc', '_status',
]);

function _push(ctx, path, schemaPath, message) {
  if (ctx.errors.length < ctx.max_errors) {
    ctx.errors.push({ path, schema_path: schemaPath, message });
  }
}

function _validate(data, schema, path, schemaPath, ctx) {
  if (!schema || typeof schema !== 'object') return;

  // Resolve $ref before anything else.
  if (typeof schema.$ref === 'string') {
    const resolved = _resolveRef(schema.$ref, ctx.root_schema);
    if (!resolved) {
      _push(ctx, path, schemaPath + '/$ref', `cannot resolve $ref '${schema.$ref}'`);
      return;
    }
    return _validate(data, resolved, path, schemaPath + '/$ref', ctx);
  }

  // Unknown-keyword sweep (warn only).
  if (ctx.warn_unknown) {
    for (const k of Object.keys(schema)) {
      if (!KNOWN_KEYWORDS.has(k)) {
        ctx.warnings.push({
          path,
          schema_path: schemaPath + '/' + k,
          message: `unknown keyword '${k}' (ignored)`,
        });
      }
    }
  }

  // Type check.
  if (schema.type !== undefined) {
    if (!_matchesType(data, schema.type)) {
      const expected = Array.isArray(schema.type) ? schema.type.join('|') : schema.type;
      _push(ctx, path, schemaPath + '/type',
            `expected type ${expected}, got ${_jsType(data)}`);
      // Continue — type failure doesn't preclude collecting more errors.
    }
  }

  // enum check.
  if (Array.isArray(schema.enum)) {
    let found = false;
    for (const e of schema.enum) {
      if (_deepEqual(data, e)) { found = true; break; }
    }
    if (!found) {
      _push(ctx, path, schemaPath + '/enum',
            `value ${_short(data)} not in enum [${schema.enum.map(_short).join(', ')}]`);
    }
  }

  // String checks.
  if (typeof data === 'string') {
    if (Number.isFinite(schema.minLength) && data.length < schema.minLength) {
      _push(ctx, path, schemaPath + '/minLength',
            `string length ${data.length} < minLength ${schema.minLength}`);
    }
    if (Number.isFinite(schema.maxLength) && data.length > schema.maxLength) {
      _push(ctx, path, schemaPath + '/maxLength',
            `string length ${data.length} > maxLength ${schema.maxLength}`);
    }
  }

  // Number checks.
  if (typeof data === 'number') {
    if (Number.isFinite(schema.minimum) && data < schema.minimum) {
      _push(ctx, path, schemaPath + '/minimum',
            `${data} < minimum ${schema.minimum}`);
    }
    if (Number.isFinite(schema.maximum) && data > schema.maximum) {
      _push(ctx, path, schemaPath + '/maximum',
            `${data} > maximum ${schema.maximum}`);
    }
    if (Number.isFinite(schema.exclusiveMinimum) && data <= schema.exclusiveMinimum) {
      _push(ctx, path, schemaPath + '/exclusiveMinimum',
            `${data} ≤ exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
    if (Number.isFinite(schema.exclusiveMaximum) && data >= schema.exclusiveMaximum) {
      _push(ctx, path, schemaPath + '/exclusiveMaximum',
            `${data} ≥ exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
  }

  // Object checks.
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in data)) {
          _push(ctx, path, schemaPath + '/required',
                `missing required property '${key}'`);
        }
      }
    }
    if (schema.properties && typeof schema.properties === 'object') {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          _validate(data[key], subSchema,
            path ? path + '.' + key : key,
            schemaPath + '/properties/' + key, ctx);
        }
      }
    }
    if (schema.additionalProperties !== undefined) {
      const known = (schema.properties && typeof schema.properties === 'object')
        ? new Set(Object.keys(schema.properties)) : new Set();
      for (const key of Object.keys(data)) {
        if (known.has(key)) continue;
        if (schema.additionalProperties === false) {
          _push(ctx, path, schemaPath + '/additionalProperties',
                `unexpected property '${key}'`);
        } else if (typeof schema.additionalProperties === 'object'
                   && schema.additionalProperties !== null) {
          _validate(data[key], schema.additionalProperties,
            path ? path + '.' + key : key,
            schemaPath + '/additionalProperties', ctx);
        }
      }
    }
  }

  // Array checks.
  if (Array.isArray(data)) {
    if (Number.isFinite(schema.minItems) && data.length < schema.minItems) {
      _push(ctx, path, schemaPath + '/minItems',
            `array length ${data.length} < minItems ${schema.minItems}`);
    }
    if (Number.isFinite(schema.maxItems) && data.length > schema.maxItems) {
      _push(ctx, path, schemaPath + '/maxItems',
            `array length ${data.length} > maxItems ${schema.maxItems}`);
    }
    if (schema.items && typeof schema.items === 'object') {
      for (let i = 0; i < data.length; i++) {
        _validate(data[i], schema.items,
          path + '[' + i + ']',
          schemaPath + '/items', ctx);
      }
    }
  }

  // Combinators.
  if (Array.isArray(schema.allOf)) {
    for (let i = 0; i < schema.allOf.length; i++) {
      _validate(data, schema.allOf[i], path, schemaPath + '/allOf[' + i + ']', ctx);
    }
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    let anyMatched = false;
    for (let i = 0; i < schema.anyOf.length; i++) {
      const probe = { errors: [], warnings: [], max_errors: 1,
                       root_schema: ctx.root_schema, warn_unknown: false };
      _validate(data, schema.anyOf[i], path, schemaPath + '/anyOf[' + i + ']', probe);
      if (probe.errors.length === 0) { anyMatched = true; break; }
    }
    if (!anyMatched) {
      _push(ctx, path, schemaPath + '/anyOf',
            `value matched none of ${schema.anyOf.length} anyOf branches`);
    }
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    let nMatched = 0;
    for (let i = 0; i < schema.oneOf.length; i++) {
      const probe = { errors: [], warnings: [], max_errors: 1,
                       root_schema: ctx.root_schema, warn_unknown: false };
      _validate(data, schema.oneOf[i], path, schemaPath + '/oneOf[' + i + ']', probe);
      if (probe.errors.length === 0) nMatched++;
      if (nMatched > 1) break;
    }
    if (nMatched !== 1) {
      _push(ctx, path, schemaPath + '/oneOf',
            `value matched ${nMatched} of ${schema.oneOf.length} oneOf branches (exactly 1 required)`);
    }
  }
}

function _matchesType(data, type) {
  if (Array.isArray(type)) {
    for (const t of type) if (_matchesType(data, t)) return true;
    return false;
  }
  switch (type) {
    case 'object':   return data !== null && typeof data === 'object' && !Array.isArray(data);
    case 'array':    return Array.isArray(data);
    case 'string':   return typeof data === 'string';
    case 'number':   return typeof data === 'number' && Number.isFinite(data);
    case 'integer':  return typeof data === 'number' && Number.isFinite(data) && Math.floor(data) === data;
    case 'boolean':  return typeof data === 'boolean';
    case 'null':     return data === null;
    default:         return false;
  }
}

function _jsType(data) {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  if (typeof data === 'number' && Number.isFinite(data) && Math.floor(data) === data) return 'integer';
  return typeof data;
}

function _deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!_deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      if (!_deepEqual(a[ak[i]], b[bk[i]])) return false;
    }
    return true;
  }
  return false;
}

function _short(v) {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 40 ? s.slice(0, 37) + '...' : s;
  } catch (_) { return String(v); }
}

function _resolveRef(ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
  const path = ref.slice(1).split('/').filter(Boolean);
  let node = root;
  for (const seg of path) {
    if (node == null || typeof node !== 'object') return null;
    node = node[seg];
  }
  return node;
}

// =====================================================================
// 3. Convenience: throw-on-error variant
// =====================================================================

/**
 * Throws an Error when validation fails (first error included).
 * Returns the validator result on success.
 *
 * @param {*} data
 * @param {Object} schema
 * @param {Object} [opts]
 * @returns {{ok:boolean, errors:Array, warnings:Array}}
 */
export function validateOrThrow(data, schema, opts) {
  const r = validateAgainstSchema(data, schema, opts);
  if (!r.ok) {
    const first = r.errors[0];
    const e = new Error(
      `Validation failed: ${first ? first.message : 'no message'}`
      + (first && first.path ? ` (at ${first.path})` : '')
      + ` (${r.errors.length} error${r.errors.length === 1 ? '' : 's'} total)`,
    );
    e.errors = r.errors;
    e.warnings = r.warnings;
    throw e;
  }
  return r;
}
