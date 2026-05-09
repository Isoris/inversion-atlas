// tests/smoke_qopt_wiring.mjs
//
// Wiring-validation smoke test for the qopt loader integration.
//
// Scope: this test verifies that the layer entry points at the right
// adapter export, the adapter has the correct calling convention,
// and the adapter delegates to the loader correctly. It does NOT
// instantiate the Registry engine — the engine assumes a browser
// context for analysis-source modules (it resolves them via
// import('/' + path) which works in browsers but not Node), and the
// existing test convention here is to mock the registry rather than
// instantiate the real engine.
//
// What this test verifies:
//   - The layers.registry.json entry for ancestry_global_q points at
//     the adapter export.
//   - The adapter export exists and is callable.
//   - Default path generation (from K + run_id) matches the layer
//     entry's documented convention.
//   - Caller-provided paths override defaults.
//   - The adapter forwards the fetcher and produces the same
//     artifact shape as the direct loader call.
//
// This complements smoke_qopt_loader.mjs (loader in isolation) and
// would-be future engine-integration tests (which need an engine
// change to work in Node).

import { readFileSync } from 'node:fs';

const WS = process.env.WORKSPACE || '/home/claude/workspace/atlas-workspace';
const { loadQopt, registryAdapter } = await import(
  `${WS}/atlases/inversion/shared/loaders/qopt_loader.js`
);

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
// Synthesize K=3 N=4 .qopt + samples.txt for the test.
const QOPT = [
  '0.91 0.05 0.04',
  '0.85\t0.10\t0.05',
  '0.20  0.70  0.10',
  '0.05 0.10 0.85',
].join('\n') + '\n';
const SAMPLES = ['s1','s2','s3','s4'].join('\n') + '\n';
const fetcher = {
  text: async (p) => p.endsWith('.qopt') ? QOPT : SAMPLES,
};

// -----------------------------------------------------------------------------
group('Layer-entry wiring (config inspection)');

const layersConfig = JSON.parse(readFileSync(
  `${WS}/atlases/inversion/registries/data/layers.registry.json`, 'utf-8'
));

const entry = layersConfig.layers.ancestry_global_q;
check('layer entry exists',                     entry !== undefined);
check('source === "analysis"',                  entry.source === 'analysis');
check('analysis points at qopt_loader.js',
      typeof entry.analysis === 'string' &&
      entry.analysis.includes('shared/loaders/qopt_loader.js'),
      entry.analysis);
check('analysis export name === "registryAdapter"',
      entry.analysis && entry.analysis.endsWith('#registryAdapter'),
      entry.analysis);
check('schema points at v1 extract-schema',
      entry.schema === 'schemas/ancestry_global_q_v1.schema.json',
      entry.schema);
check('schema_status === "validated"',          entry.schema_status === 'validated');
check('cache_key includes K and run_id',
      typeof entry.cache_key === 'string' &&
      entry.cache_key.includes('{K}') &&
      entry.cache_key.includes('{run_id}'),
      entry.cache_key);
check('legacy_v0 stub preserved for traceability',
      entry._legacy_v0 !== undefined);

// -----------------------------------------------------------------------------
group('Activate-schema exists and is well-formed');

const activateSchema = JSON.parse(readFileSync(
  `${WS}/atlases/inversion/registries/producers/load_ngsadmix_qopt.activate.json`,
  'utf-8'
));
check('activate-schema parses',                 activateSchema !== null);
check('activate-schema has _kind: activate',    activateSchema._kind === 'activate');
check('activate-schema declares producer block',
      typeof activateSchema.producer === 'object' && activateSchema.producer !== null);
check('activate-schema producer.name matches loader',
      activateSchema.producer.name === 'load_ngsadmix_qopt');
check('activate-schema producer.module matches loader path',
      activateSchema.producer.module === 'shared/loaders/qopt_loader.js');
check('activate-schema producer.function === "loadQopt"',
      activateSchema.producer.function === 'loadQopt');
check('activate-schema producer.emits === extract-schema id',
      activateSchema.producer.emits === 'ancestry_global_q_v1');
check('activate-schema declares K, qopt_path, samples_path required',
      Array.isArray(activateSchema.required) &&
      activateSchema.required.includes('qopt_path') &&
      activateSchema.required.includes('samples_path') &&
      activateSchema.required.includes('params'));

// -----------------------------------------------------------------------------
group('Extract-schema exists and is well-formed');

const extractSchema = JSON.parse(readFileSync(
  `${WS}/atlases/inversion/registries/schemas/ancestry_global_q_v1.schema.json`,
  'utf-8'
));
check('extract-schema parses',                  extractSchema !== null);
check('extract-schema has _kind: extract',      extractSchema._kind === 'extract');
check('extract-schema $id matches activate.emits',
      extractSchema.$id === 'ancestry_global_q_v1.schema.json');
check('extract-schema schema field is const ancestry_global_q_v1',
      extractSchema.properties.schema.const === 'ancestry_global_q_v1');
check('extract-schema requires {schema, produced_by, samples, Q}',
      ['schema','produced_by','samples','Q'].every(
        (f) => extractSchema.required.includes(f)
      ));

// -----------------------------------------------------------------------------
group('Adapter export is callable and has the registry calling convention');

check('registryAdapter is exported',            typeof registryAdapter === 'function');
check('loadQopt is exported',                   typeof loadQopt === 'function');

// -----------------------------------------------------------------------------
group('Adapter: default path generation');

// Without run_id, paths should be data/cohort/ancestry/global/K{K}/...
let r1OK = true; let r1Err = '';
let artifact1;
try {
  artifact1 = await registryAdapter(null /* registry, unused */, {
    K: 3,
    fetcher,
  });
} catch (e) { r1OK = false; r1Err = e.message; }
check('adapter call without run_id succeeded', r1OK, r1Err);
check('default qopt_path = global/K{K}/ngsadmix.qopt (no run_id)',
      r1OK && artifact1.inputs.qopt_path === 'data/cohort/ancestry/global/K3/ngsadmix.qopt',
      r1OK ? artifact1.inputs.qopt_path : '');
check('default samples_path = global/K{K}/samples.txt (no run_id)',
      r1OK && artifact1.inputs.samples_path === 'data/cohort/ancestry/global/K3/samples.txt',
      r1OK ? artifact1.inputs.samples_path : '');

// With run_id, run_id slots between 'global' and 'K{K}'.
const artifact2 = await registryAdapter(null, {
  K: 3, run_id: 'cohort_226_v1', fetcher,
});
check('with run_id, qopt_path embeds run_id',
      artifact2.inputs.qopt_path === 'data/cohort/ancestry/global/cohort_226_v1/K3/ngsadmix.qopt',
      artifact2.inputs.qopt_path);
check('with run_id, samples_path embeds run_id',
      artifact2.inputs.samples_path === 'data/cohort/ancestry/global/cohort_226_v1/K3/samples.txt',
      artifact2.inputs.samples_path);
check('with run_id, params.run_id propagated to artifact',
      artifact2.produced_by.params.run_id === 'cohort_226_v1');

// -----------------------------------------------------------------------------
group('Adapter: caller-provided paths override defaults');

const artifact3 = await registryAdapter(null, {
  K: 3,
  qopt_path:    '/custom/result.qopt',
  samples_path: '/custom/samples.txt',
  fetcher,
});
check('custom qopt_path used',
      artifact3.inputs.qopt_path === '/custom/result.qopt');
check('custom samples_path used',
      artifact3.inputs.samples_path === '/custom/samples.txt');

// -----------------------------------------------------------------------------
group('Adapter: producer params flow through to artifact');

const artifact4 = await registryAdapter(null, {
  K: 3,
  run_id: 'flow_test_v1',
  seed: 42,
  snp_set: 'pruned_r2_0.1',
  samples_subset: 'natora_81',
  scope: 'genome_wide',
  fetcher,
});
check('seed propagated',                artifact4.produced_by.params.seed === 42);
check('snp_set propagated',             artifact4.produced_by.params.snp_set === 'pruned_r2_0.1');
check('samples_subset propagated',      artifact4.produced_by.params.samples_subset === 'natora_81');
check('scope propagated',               artifact4.produced_by.params.scope === 'genome_wide');
check('K propagated',                   artifact4.produced_by.params.K === 3);
check('fetcher NOT in produced_by.params (should be filtered out)',
      artifact4.produced_by.params.fetcher === undefined);
check('qopt_path NOT in produced_by.params (path overrides not stored as params)',
      artifact4.produced_by.params.qopt_path === undefined);

// -----------------------------------------------------------------------------
group('Adapter: missing K is rejected');

let missingKThrew = false; let missingKMsg = '';
try {
  await registryAdapter(null, { run_id: 'no_K_test', fetcher });
} catch (e) { missingKThrew = true; missingKMsg = e.message; }
check('adapter threw on missing K', missingKThrew);
check('error mentions K is required',
      missingKThrew && /args\.K is required/.test(missingKMsg),
      missingKMsg);

// -----------------------------------------------------------------------------
group('Round-trip: adapter artifact ≡ direct loader artifact (same args)');

const directArtifact = await loadQopt({
  qopt_path:    'data/cohort/ancestry/global/cohort_226_v1/K3/ngsadmix.qopt',
  samples_path: 'data/cohort/ancestry/global/cohort_226_v1/K3/samples.txt',
  params:       { K: 3, run_id: 'cohort_226_v1' },
  fetcher,
});
const adapterArtifact = await registryAdapter(null, {
  K: 3, run_id: 'cohort_226_v1', fetcher,
});
check('adapter and direct loader produce equivalent envelopes',
      directArtifact.schema === adapterArtifact.schema &&
      JSON.stringify(directArtifact.samples) === JSON.stringify(adapterArtifact.samples) &&
      JSON.stringify(directArtifact.Q) === JSON.stringify(adapterArtifact.Q));

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
