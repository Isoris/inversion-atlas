// tests/test_analysis_scrubber_main_validator_adapter.js
//
// Adapter coverage. Exercises gateLoad, schema resolution (fs +
// aplr), and the atlasState fallback sink.

import {
  resolveSchema,
  buildInput,
  saveOutput,
  gateLoad,
} from '../atlases/inversion/analysis/scrubber_main_validator/adapter_atlas.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

const FIXTURE = JSON.parse(readFileSync(
  '/home/user/inversion-atlas/atlases/inversion/analysis/scrubber_main_validator/example_input.json',
  'utf8'));

// =====================================================================
group('resolveSchema — ctx.schema wins');
{
  const fakeSchema = { type: 'object', $id: 'fake' };
  const r = await resolveSchema({ schema: fakeSchema });
  check('ctx.schema returned as-is',                r === fakeSchema);
}

// =====================================================================
group('resolveSchema — aplr.resolveSchema');
{
  let asked = null;
  const fakeAplr = {
    async resolveSchema(path) { asked = path; return { $id: 'from_aplr' }; },
  };
  const r = await resolveSchema({ aplr: fakeAplr });
  check('aplr called with default path',
        asked === 'atlases/inversion/registries/schemas/scrubber_main.schema.json');
  check('aplr-returned schema used',                r.$id === 'from_aplr');
}

// =====================================================================
group('resolveSchema — Node fs fallback (testing env)');
{
  const r = await resolveSchema({});
  check('fs fallback resolves the registry schema',
        r && r.$id === 'atlases/inversion/registries/schemas/scrubber_main.schema.json');
}

// =====================================================================
group('buildInput — payload + schema attached');
{
  const r = await buildInput({ payload: FIXTURE.payload }, {});
  check('input.payload === fixture payload',
        r.payload === FIXTURE.payload);
  check('input.schema resolved',                    r.schema && r.schema.$id);
  check('params object present',                    typeof r.params === 'object');
}

// =====================================================================
group('saveOutput — local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeResult = {
    ok: true, errors: [], warnings: [],
    summary: { n_errors: 0, n_warnings: 0, validated_chrom: 'LG28',
               validated_n_windows: 3, validated_n_samples: 4,
               schema_supplied: true, schema_id: 'fake' },
    params_used: {}, input_layer_ids: [],
  };
  const sink = await saveOutput(fakeResult, {}, { atlasState: localState });
  check('local-stash path used',                    sink.layer_status === 'local_stash');
  check('layer_id encodes chrom',                   sink.layer_id.indexOf('LG28') >= 0);
  check('stash present',
        localState.inversion._scrubber_main_validation
     && localState.inversion._scrubber_main_validation.LG28 === fakeResult);
}

// =====================================================================
group('saveOutput — aplr commit path');
{
  let committed = null;
  const fakeAplr = {
    async commitLayer(layer) { committed = layer; return { layer_id: 'lay:42' }; },
  };
  const sink = await saveOutput({
    ok: false, errors: [{path:'',schema_path:'',message:'x'}], warnings: [],
    summary: { n_errors: 1, n_warnings: 0, schema_supplied: true },
    params_used: {}, input_layer_ids: [],
  }, {}, { aplr: fakeAplr });
  check('aplr.commitLayer called',                  committed !== null);
  check('layer_type = scrubber_main_validation',
        committed.layer_type === 'scrubber_main_validation');
  check('layer_id returned by aplr',                sink.layer_id === 'lay:42');
}

// =====================================================================
group('saveOutput — aplr throws → local-stash fallback');
{
  const localState = { inversion: {} };
  const fakeAplr = {
    async commitLayer() { throw new Error('boom'); },
  };
  const sink = await saveOutput({
    ok: true, errors: [], warnings: [],
    summary: { n_errors: 0, n_warnings: 0, validated_chrom: 'LG28',
               schema_supplied: true },
    params_used: {}, input_layer_ids: [],
  }, {}, { aplr: fakeAplr, atlasState: localState });
  check('aplr failure → local-stash',               sink.layer_status === 'local_stash');
  check('stash key encodes chrom',
        localState.inversion._scrubber_main_validation.LG28 !== undefined);
}

// =====================================================================
group('gateLoad — happy path');
{
  const localState = { inversion: {} };
  const { result, sink } = await gateLoad(FIXTURE.payload, { atlasState: localState });
  check('result.ok = true',                         result.ok === true);
  check('sink emitted',                             sink && typeof sink.layer_status === 'string');
}

// =====================================================================
group('gateLoad — throw_on_error');
{
  const broken_payload = { ...FIXTURE.payload };
  delete broken_payload.chrom;
  let threw = false, err;
  try {
    await gateLoad(broken_payload, {
      atlasState: { inversion: {} },
      throw_on_error: true,
    });
  } catch (e) { threw = true; err = e; }
  check('throws on error',                          threw);
  check('error carries errors[]',                   err && Array.isArray(err.errors) && err.errors.length > 0);
  check('error carries sink (already persisted)',   err && err.sink);
}

// =====================================================================
group('gateLoad — strict mode');
{
  const result = (await gateLoad(FIXTURE.payload, {
    atlasState: { inversion: {} },
    schema: { type: 'object', mystery_keyword: 'banana' },
    strict: true,
  })).result;
  check('strict: unknown-keyword warnings upgraded to errors',
        result.ok === false && result.errors.length > 0);
  check('strict error message marked STRICT:',
        result.errors[0].message.startsWith('STRICT:'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
