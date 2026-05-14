// tests/test_shared_validators_json_schema_lite.js
//
// Minimal JSON Schema validator coverage. Only the keywords the
// inversion-atlas registries actually use.

import {
  validateAgainstSchema,
  validateOrThrow,
} from '../atlases/inversion/shared/validators/json_schema_lite.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('exports');
check('validateAgainstSchema fn',                typeof validateAgainstSchema === 'function');
check('validateOrThrow fn',                      typeof validateOrThrow === 'function');

// =====================================================================
group('type keyword');
check('object passes type=object',               validateAgainstSchema({}, {type:'object'}).ok);
check('array fails type=object',                 !validateAgainstSchema([], {type:'object'}).ok);
check('integer passes type=integer',             validateAgainstSchema(5, {type:'integer'}).ok);
check('float fails type=integer',                !validateAgainstSchema(5.5, {type:'integer'}).ok);
check('float passes type=number',                validateAgainstSchema(5.5, {type:'number'}).ok);
check('null passes type=null',                   validateAgainstSchema(null, {type:'null'}).ok);
check('boolean passes type=boolean',             validateAgainstSchema(true, {type:'boolean'}).ok);
// Union types
check('union [string, null] accepts string',     validateAgainstSchema('x', {type:['string','null']}).ok);
check('union [string, null] accepts null',       validateAgainstSchema(null, {type:['string','null']}).ok);
check('union [string, null] rejects number',     !validateAgainstSchema(5, {type:['string','null']}).ok);

// =====================================================================
group('required + properties');
const schema1 = {
  type: 'object',
  required: ['a', 'b'],
  properties: {
    a: { type: 'string' },
    b: { type: 'integer' },
    c: { type: 'boolean' },
  },
};
check('all required + valid types',
      validateAgainstSchema({a: 'x', b: 7}, schema1).ok);
check('missing required b → error',
      !validateAgainstSchema({a: 'x'}, schema1).ok);
check('error mentions missing property name',
      validateAgainstSchema({a: 'x'}, schema1).errors[0].message.indexOf('b') >= 0);
check('wrong type on a → error',
      !validateAgainstSchema({a: 5, b: 7}, schema1).ok);
check('optional c absent → ok',
      validateAgainstSchema({a: 'x', b: 7}, schema1).ok);
check('optional c wrong type → error',
      !validateAgainstSchema({a: 'x', b: 7, c: 'nope'}, schema1).ok);

// =====================================================================
group('items + minItems / maxItems');
const arr_schema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 1,
  maxItems: 3,
};
check('valid array',                             validateAgainstSchema([1, 2], arr_schema).ok);
check('empty array fails minItems',              !validateAgainstSchema([], arr_schema).ok);
check('too long array fails maxItems',           !validateAgainstSchema([1,2,3,4], arr_schema).ok);
check('mixed types fail items',                  !validateAgainstSchema([1, 'x'], arr_schema).ok);

// =====================================================================
group('minimum / maximum / exclusive bounds');
check('5 passes minimum 5',                      validateAgainstSchema(5, {minimum: 5}).ok);
check('4 fails minimum 5',                       !validateAgainstSchema(4, {minimum: 5}).ok);
check('5 passes maximum 5',                      validateAgainstSchema(5, {maximum: 5}).ok);
check('5 fails exclusiveMinimum 5',              !validateAgainstSchema(5, {exclusiveMinimum: 5}).ok);
check('5 fails exclusiveMaximum 5',              !validateAgainstSchema(5, {exclusiveMaximum: 5}).ok);

// =====================================================================
group('enum');
const enum_schema = { enum: ['low', 'mid', 'high'] };
check('value in enum → ok',                      validateAgainstSchema('mid', enum_schema).ok);
check('value not in enum → error',               !validateAgainstSchema('weird', enum_schema).ok);
check('enum with mixed types works',
      validateAgainstSchema(2, { enum: [1, 2, 'x'] }).ok);

// =====================================================================
group('additionalProperties');
const ap_schema = {
  type: 'object',
  properties: { a: { type: 'string' } },
  additionalProperties: false,
};
check('only declared properties → ok',           validateAgainstSchema({a: 'x'}, ap_schema).ok);
check('extra property → error',                  !validateAgainstSchema({a: 'x', b: 5}, ap_schema).ok);
// With schema-typed additionalProperties: extras must match the sub-schema.
const ap_sub = {
  type: 'object',
  properties: { a: { type: 'string' } },
  additionalProperties: { type: 'integer' },
};
check('extra typed-property valid → ok',         validateAgainstSchema({a: 'x', b: 7}, ap_sub).ok);
check('extra typed-property invalid → error',    !validateAgainstSchema({a: 'x', b: 'no'}, ap_sub).ok);

// =====================================================================
group('$ref');
const ref_schema = {
  definitions: { positive_int: { type: 'integer', minimum: 1 } },
  type: 'object',
  properties: { count: { $ref: '#/definitions/positive_int' } },
};
check('$ref resolves',                           validateAgainstSchema({count: 3}, ref_schema).ok);
check('$ref enforces sub-rules',                 !validateAgainstSchema({count: 0}, ref_schema).ok);
check('unresolvable $ref → error',
      !validateAgainstSchema({ x: 7 },
        { properties: { x: { $ref: '#/definitions/missing' } } }).ok);

// =====================================================================
group('combinators (anyOf / oneOf / allOf)');
const anyOf_schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
check('anyOf accepts string',                    validateAgainstSchema('x', anyOf_schema).ok);
check('anyOf accepts integer',                   validateAgainstSchema(5, anyOf_schema).ok);
check('anyOf rejects boolean',                   !validateAgainstSchema(true, anyOf_schema).ok);

const allOf_schema = {
  allOf: [
    { type: 'integer' },
    { minimum: 0 },
  ],
};
check('allOf accepts when all match',            validateAgainstSchema(5, allOf_schema).ok);
check('allOf rejects when one fails',            !validateAgainstSchema(-1, allOf_schema).ok);

const oneOf_schema = { oneOf: [{ type: 'string' }, { type: 'integer' }] };
check('oneOf accepts exactly one match',         validateAgainstSchema('x', oneOf_schema).ok);
check('oneOf rejects when none match',           !validateAgainstSchema(true, oneOf_schema).ok);
// integer 5 would match both type:integer and not type:string → still ok (one)
check('oneOf rejects when both match',
      !validateAgainstSchema(5, { oneOf: [{ type: 'integer' }, { minimum: 0 }] }).ok);

// =====================================================================
group('error reporting');
const long_schema = {
  type: 'object',
  required: ['a', 'b', 'c'],
  properties: {
    a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' },
  },
};
const result = validateAgainstSchema({}, long_schema);
check('3 missing required → 3 errors',           result.errors.length === 3);
check('errors carry path',                       result.errors[0].path === '');
check('errors carry schema_path',                result.errors[0].schema_path.indexOf('required') >= 0);
const capped = validateAgainstSchema({}, long_schema, { max_errors: 1 });
check('max_errors caps list',                    capped.errors.length === 1);

// =====================================================================
group('unknown-keyword warnings');
const unk = validateAgainstSchema({}, {
  type: 'object', some_unknown_keyword: 'banana',
});
check('unknown keyword emits warning',           unk.warnings.length > 0);
check('warning mentions keyword',                unk.warnings[0].message.indexOf('some_unknown_keyword') >= 0);
check('warnings don\'t fail validation',         unk.ok);

// =====================================================================
group('validateOrThrow');
let threw = false, caught;
try { validateOrThrow({}, schema1); } catch (e) { threw = true; caught = e; }
check('throws on invalid input',                 threw);
check('error carries errors[]',                  caught && Array.isArray(caught.errors));
let result2;
try { result2 = validateOrThrow({a:'x',b:7}, schema1); } catch (e) { result2 = null; }
check('returns ok-result on valid input',        result2 && result2.ok);

// =====================================================================
group('nested object + nested array');
const nested = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer' } },
      },
    },
  },
};
check('valid nested input',
      validateAgainstSchema({items: [{id: 1}, {id: 2}]}, nested).ok);
check('invalid nested element → error',
      !validateAgainstSchema({items: [{id: 1}, {}]}, nested).ok);
const nestedErr = validateAgainstSchema({items: [{id: 1}, {}]}, nested);
check('nested error path includes index',
      nestedErr.errors[0].path.indexOf('[1]') >= 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
