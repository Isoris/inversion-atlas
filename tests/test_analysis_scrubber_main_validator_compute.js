// tests/test_analysis_scrubber_main_validator_compute.js
//
// Pure JSON-in / JSON-out compute() coverage for the scrubber_main
// validator. Loads the real schema from registries/schemas/.

import { compute } from '../atlases/inversion/analysis/scrubber_main_validator/compute.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const SCHEMA = JSON.parse(readFileSync(
  '/home/user/inversion-atlas/atlases/inversion/registries/schemas/scrubber_main.schema.json',
  'utf8'));
const FIXTURE = JSON.parse(readFileSync(
  '/home/user/inversion-atlas/atlases/inversion/analysis/scrubber_main_validator/example_input.json',
  'utf8'));

// =====================================================================
group('compute — empty / null inputs');
const empty = compute(null);
check('null input → safe empty result',
      empty && empty.ok === false && Array.isArray(empty.errors));
check('null input → schema_supplied = false',
      empty.summary.schema_supplied === false);

const noSchema = compute({ payload: FIXTURE.payload });
check('no schema → schema_supplied = false',
      noSchema.summary.schema_supplied === false);

// =====================================================================
group('compute — valid scrubber_main payload');
const ok = compute({ payload: FIXTURE.payload, schema: SCHEMA });
check('valid fixture → ok=true',                  ok.ok === true);
check('valid fixture → 0 errors',                 ok.errors.length === 0);
check('summary.validated_chrom = LG28',           ok.summary.validated_chrom === 'LG28');
check('summary.validated_n_windows = 3',          ok.summary.validated_n_windows === 3);
check('summary.validated_n_samples = 4',          ok.summary.validated_n_samples === 4);
check('summary.schema_id propagated',
      ok.summary.schema_id === SCHEMA.$id);

// =====================================================================
group('compute — missing required field');
const noChrom = compute({
  payload: { ...FIXTURE.payload, chrom: undefined },
  schema: SCHEMA,
});
delete noChrom.payload;  // drop the leftover input
const badChrom = compute({
  payload: (() => { const p = JSON.parse(JSON.stringify(FIXTURE.payload)); delete p.chrom; return p; })(),
  schema: SCHEMA,
});
check('missing chrom → ok=false',                 badChrom.ok === false);
check('error mentions missing chrom',
      badChrom.errors.some(e => e.message.indexOf('chrom') >= 0));

// =====================================================================
group('compute — wrong types');
const wrongTypes = compute({
  payload: { ...FIXTURE.payload, n_windows: 'not_an_integer' },
  schema: SCHEMA,
});
check('non-integer n_windows → error',            wrongTypes.ok === false);
check('error path mentions n_windows',
      wrongTypes.errors.some(e => e.path.indexOf('n_windows') >= 0));

// Empty samples array fails minItems.
const noSamples = compute({
  payload: { ...FIXTURE.payload, samples: [] },
  schema: SCHEMA,
});
check('empty samples → minItems error',           noSamples.ok === false);

// Window without idx fails required.
const badWindow = compute({
  payload: {
    ...FIXTURE.payload,
    windows: [{ start_bp: 100, end_bp: 200 }],
  },
  schema: SCHEMA,
});
check('window without idx → error',               badWindow.ok === false);
check('error path mentions windows[0]',
      badWindow.errors.some(e => e.path.indexOf('windows[0]') >= 0));

// =====================================================================
group('compute — band_quality bounds');
const badBQ = compute({
  payload: {
    ...FIXTURE.payload,
    windows: [{ idx: 0, band_quality: 1.5 }],
  },
  schema: SCHEMA,
});
check('band_quality > 1.0 → error',               badBQ.ok === false);

// =====================================================================
group('compute — max_errors caps the list');
const lots_of_errors_payload = {
  chrom: 'LG28', n_windows: 3, n_samples: 4,
  samples: [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }, { id: 'S4' }],
  // Many bad windows → many errors.
  windows: Array.from({ length: 30 }, () => ({ start_bp: 'not_a_number' })),
};
const capped = compute({
  payload: lots_of_errors_payload,
  schema: SCHEMA,
  params: { max_errors: 5 },
});
check('max_errors caps errors[]',                 capped.errors.length <= 5);
check('params_used reflects override',            capped.params_used.max_errors === 5);

// =====================================================================
group('compute — strict mode upgrades warnings to errors');
// Use a schema with an unknown keyword to force a warning.
const unknown_kw_schema = {
  type: 'object',
  some_made_up_keyword: 'banana',
};
const lax = compute({ payload: {}, schema: unknown_kw_schema, params: { strict: false } });
check('non-strict: warnings present, ok=true',    lax.warnings.length > 0 && lax.ok === true);
const strict = compute({ payload: {}, schema: unknown_kw_schema, params: { strict: true } });
check('strict: warnings upgraded to errors',      strict.errors.length > 0 && strict.ok === false);
check('strict: warnings list cleared',            strict.warnings.length === 0);
check('strict error message prefixed STRICT:',
      strict.errors[0].message.startsWith('STRICT:'));

// =====================================================================
group('compute — provenance round-tripping');
const prov = compute({
  payload: FIXTURE.payload,
  schema: SCHEMA,
  input_layer_ids: ['scrubber_main:LG28', 'precomp:v3'],
});
check('input_layer_ids round-tripped',
      prov.input_layer_ids.length === 2
   && prov.input_layer_ids.includes('precomp:v3'));

// =====================================================================
group('compute — output is JSON-serialisable');
let s;
try { s = JSON.stringify(ok); } catch (_) { s = null; }
check('output is JSON-serialisable',              typeof s === 'string');
check('round-trip preserves ok flag',             JSON.parse(s).ok === true);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
