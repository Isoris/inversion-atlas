// tests/test_relatedness_schema.js
//
// Unit tests for atlases/inversion/registries/schemas/relatedness.schema.json
// — the SPEC_v2 §4 replacement for the empty placeholder.
//
// We don't ship a JSON-schema validator in the cartridge; tests verify
// the schema is well-formed JSON, exposes the required top-level
// structure, and accepts the canonical shape that mendelian.js
// _findTrios reads. The hand-validator below replays the structural
// invariants the schema declares (required fields, enum on
// relationship_class, type coercion on sample_a / sample_b) so future
// drift in either the schema or the consumer is caught.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolvePath(__dirname, '..',
  'atlases/inversion/registries/schemas/relatedness.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Hand-validator that mirrors the schema's structural rules. This is
// the minimum needed to assert the schema-consumer contract is honored.
// =====================================================================
function validateRow(row) {
  const errors = [];
  if (typeof row !== 'object' || row === null) {
    errors.push('row: not an object'); return errors;
  }
  for (const k of ['sample_a', 'sample_b', 'kinship', 'relationship_class']) {
    if (!(k in row)) errors.push(`row: missing required field '${k}'`);
  }
  for (const sk of ['sample_a', 'sample_b']) {
    if (sk in row) {
      const t = typeof row[sk];
      if (t !== 'number' && t !== 'string') {
        errors.push(`row.${sk}: must be integer or string, got ${t}`);
      } else if (t === 'number' && !Number.isInteger(row[sk])) {
        errors.push(`row.${sk}: number must be integer`);
      }
    }
  }
  if ('kinship' in row) {
    if (typeof row.kinship !== 'number' || !isFinite(row.kinship)) {
      errors.push('row.kinship: must be a finite number');
    } else if (row.kinship < -1 || row.kinship > 1) {
      errors.push('row.kinship: must be in [-1, 1]');
    }
  }
  const validClasses = schema.properties.pairs.items.properties
    .relationship_class.enum;
  if ('relationship_class' in row) {
    if (!validClasses.includes(row.relationship_class)) {
      errors.push(`row.relationship_class: '${row.relationship_class}' not in enum`);
    }
  }
  // Optional 0..1 fields
  for (const k of ['ibs0', 'ibs1', 'ibs2']) {
    if (k in row) {
      if (typeof row[k] !== 'number' || row[k] < 0 || row[k] > 1) {
        errors.push(`row.${k}: must be number in [0, 1]`);
      }
    }
  }
  return errors;
}
function validateRelatednessJson(json) {
  const errors = [];
  if (typeof json !== 'object' || json === null) {
    errors.push('root: not an object'); return errors;
  }
  if (!Array.isArray(json.pairs)) {
    errors.push('root.pairs: required, must be array'); return errors;
  }
  for (let i = 0; i < json.pairs.length; i++) {
    const rowErrs = validateRow(json.pairs[i]);
    for (const e of rowErrs) errors.push(`pairs[${i}].${e}`);
  }
  return errors;
}

// =====================================================================
group('schema file shape');
check('valid JSON-Schema draft-07 declaration',
      schema.$schema === 'http://json-schema.org/draft-07/schema#');
check('$id set to relatedness.schema.json',
      schema.$id === 'relatedness.schema.json');
check('title present',                                typeof schema.title === 'string');
check('version stamp present',                        typeof schema.version === 'string');
check('top-level type = object',                      schema.type === 'object');
check('requires pairs',                               schema.required.includes('pairs'));

// =====================================================================
group('pairs items: required fields');
{
  const itemReq = schema.properties.pairs.items.required;
  check('pairs item requires sample_a',               itemReq.includes('sample_a'));
  check('pairs item requires sample_b',               itemReq.includes('sample_b'));
  check('pairs item requires kinship',                itemReq.includes('kinship'));
  check('pairs item requires relationship_class',     itemReq.includes('relationship_class'));
}

// =====================================================================
group('relationship_class enum (legacy degree-based + finer)');
{
  const e = schema.properties.pairs.items.properties.relationship_class.enum;
  check('includes 1st_degree (mendelian.js gate)',    e.includes('1st_degree'));
  check('includes 2nd_degree',                        e.includes('2nd_degree'));
  check('includes 3rd_degree',                        e.includes('3rd_degree'));
  check('includes parent_offspring (finer)',          e.includes('parent_offspring'));
  check('includes full_sibling',                      e.includes('full_sibling'));
  check('includes half_sibling',                      e.includes('half_sibling'));
  check('includes unrelated',                         e.includes('unrelated'));
  check('includes unknown',                           e.includes('unknown'));
}

// =====================================================================
group('hand-validator: canonical mendelian.js shape passes');
{
  const canonical = {
    pairs: [
      { sample_a: 1, sample_b: 2,   kinship: 0.25,  relationship_class: '1st_degree' },
      { sample_a: 1, sample_b: 99,  kinship: 0.0,   relationship_class: 'unrelated' },
      { sample_a: 'CGA_001', sample_b: 'CGA_002',
        kinship: 0.12, relationship_class: '2nd_degree' },
    ],
  };
  const errs = validateRelatednessJson(canonical);
  check('mendelian.js shape passes (0 errors)',  errs.length === 0,
        errs.length > 0 ? errs.join('; ') : '');
}

// =====================================================================
group('hand-validator: rejects invalid inputs');
{
  // Missing pairs
  let errs = validateRelatednessJson({});
  check('missing pairs → error',                 errs.length > 0);

  // pairs not an array
  errs = validateRelatednessJson({ pairs: 'oops' });
  check('pairs not array → error',               errs.length > 0);

  // Missing required field
  errs = validateRelatednessJson({ pairs: [{ sample_a: 1, sample_b: 2, kinship: 0.1 }] });
  check('missing relationship_class → error',
        errs.some(e => e.includes('relationship_class')));

  // Invalid type
  errs = validateRelatednessJson({ pairs: [{
    sample_a: 1.5, sample_b: 2, kinship: 0.1, relationship_class: '1st_degree',
  }]});
  check('sample_a = 1.5 → error (must be integer)',
        errs.some(e => e.includes('sample_a')));

  // Kinship out of range
  errs = validateRelatednessJson({ pairs: [{
    sample_a: 1, sample_b: 2, kinship: 5.0, relationship_class: '1st_degree',
  }]});
  check('kinship = 5.0 → error',                 errs.some(e => e.includes('kinship')));

  // Bad enum
  errs = validateRelatednessJson({ pairs: [{
    sample_a: 1, sample_b: 2, kinship: 0.1, relationship_class: 'twin',
  }]});
  check('relationship_class = "twin" → error (not in enum)',
        errs.some(e => e.includes('relationship_class')));

  // IBS out of [0, 1]
  errs = validateRelatednessJson({ pairs: [{
    sample_a: 1, sample_b: 2, kinship: 0.1,
    relationship_class: '1st_degree', ibs0: 1.5,
  }]});
  check('ibs0 = 1.5 → error',                    errs.some(e => e.includes('ibs0')));
}

// =====================================================================
group('hand-validator: optional fields accepted');
{
  const withOptionals = {
    pairs: [
      { sample_a: 1, sample_b: 2, kinship: 0.25,
        relationship_class: '1st_degree',
        ibs0: 0.0, ibs1: 0.5, ibs2: 0.5, n_sites: 1_000_000,
        tool: 'ngsrelate', run_id: 'broodstock_qc_pass_v1' },
    ],
    samples: ['CGA_001', 'CGA_002'],
    schema_version: 'v1_2026-05-12',
    tool_default: 'ngsrelate',
    kinship_thresholds: {
      '1st_degree': 0.177, '2nd_degree': 0.0884, '3rd_degree': 0.0442,
    },
    _provenance: { aggregator: 'pop_atlas_v1' },
  };
  const errs = validateRelatednessJson(withOptionals);
  check('rich shape passes (0 errors)',          errs.length === 0,
        errs.length > 0 ? errs.join('; ') : '');
}

// =====================================================================
group('schema describes kinship_thresholds with KING defaults');
{
  const kt = schema.properties.kinship_thresholds.properties;
  check('1st_degree default = 0.177',            kt['1st_degree'].default === 0.177);
  check('2nd_degree default = 0.0884',           kt['2nd_degree'].default === 0.0884);
  check('3rd_degree default = 0.0442',           kt['3rd_degree'].default === 0.0442);
}

// =====================================================================
group('layers.registry.json points cohort_relatedness at this schema');
{
  const REG_PATH = resolvePath(__dirname, '..',
    'atlases/inversion/registries/data/layers.registry.json');
  const reg = JSON.parse(readFileSync(REG_PATH, 'utf-8'));
  const layers = reg.layers || reg;
  const entry = layers.cohort_relatedness;
  check('cohort_relatedness entry exists',       !!entry);
  check('schema points at relatedness.schema.json',
        entry.schema === 'schemas/relatedness.schema.json');
  check('layer doc explains aggregator distinction from ngsrelate raw',
        typeof entry._doc === 'string' && entry._doc.includes('relatedness_ngsrelate'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
