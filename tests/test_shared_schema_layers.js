// tests/test_shared_schema_layers.js

import {
  LAYER_CHECKS,
  V1_INFERABLE_LAYERS,
  inferLayersFromV1,
  detectSchemaAndLayers,
} from '../atlases/inversion/shared/schema_layers.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('LAYER_CHECKS frozen',                   Object.isFrozen(LAYER_CHECKS));
check('LAYER_CHECKS has ≥40 entries',          LAYER_CHECKS.length >= 40);
check('V1_INFERABLE_LAYERS frozen',            Object.isFrozen(V1_INFERABLE_LAYERS));
check('V1_INFERABLE 4 entries',                V1_INFERABLE_LAYERS.length === 4);
check('V1_INFERABLE includes windows',         V1_INFERABLE_LAYERS.includes('windows'));
check('V1_INFERABLE doesn\'t include sv_evidence',
      !V1_INFERABLE_LAYERS.includes('sv_evidence'));

// Sanity: every entry is [name, fn]
{
  const ok = LAYER_CHECKS.every(e => Array.isArray(e) && typeof e[0] === 'string'
                                     && typeof e[1] === 'function');
  check('every LAYER_CHECKS entry is [name, fn]',  ok);
}

// =====================================================================
group('inferLayersFromV1');
check('null → []',                             inferLayersFromV1(null).length === 0);
check('empty data → []',                       inferLayersFromV1({}).length === 0);
{
  const r = inferLayersFromV1({
    windows: [{ pos: 0 }], n_windows: 1,
    l1_envelopes: [{ id: 'l1_1' }],
    tracks: { het: { values: [1] } },
    samples: ['s1', 's2'],
  });
  check('all 4 core layers detected',           r.length === 4);
  check('includes windows',                     r.includes('windows'));
  check('includes envelopes',                   r.includes('envelopes'));
  check('includes tracks',                      r.includes('tracks'));
  check('includes samples',                     r.includes('samples'));
}
{
  const r = inferLayersFromV1({
    windows: [], n_windows: 0,
    l2_envelopes: [{ id: 'l2_1' }],
    tracks: {},
    samples: [],
  });
  check('zero n_windows → no windows',          !r.includes('windows'));
  check('l2_envelopes alone → envelopes',       r.includes('envelopes'));
  check('empty tracks {} → no tracks',          !r.includes('tracks'));
  check('empty samples [] → no samples',        !r.includes('samples'));
}
{
  // V1 must NOT infer v2-only layers, even if they're present
  const r = inferLayersFromV1({
    windows: [{}], n_windows: 1,
    sv_evidence: { something: true },
    candidates: [{ id: 'c1' }],
    groups_validated: { x: 1 },
    classification: { y: 1 },
  });
  check('v1 doesn\'t emit sv_evidence',         !r.includes('sv_evidence'));
  check('v1 doesn\'t emit candidates_registry', !r.includes('candidates_registry'));
  check('v1 doesn\'t emit groups_validated',    !r.includes('groups_validated'));
  check('v1 doesn\'t emit classification',      !r.includes('classification'));
  check('v1 still emits the core layer',        r.includes('windows'));
}

// =====================================================================
group('detectSchemaAndLayers — null / empty');
{
  const r = detectSchemaAndLayers(null);
  check('null → schemaVersion 0',                r.schemaVersion === 0);
  check('null → empty Set',                      r.layers.size === 0);
}
{
  const r = detectSchemaAndLayers({});
  check('empty data → schemaVersion 1 (v1 path)', r.schemaVersion === 1);
  check('empty data → empty Set',                 r.layers.size === 0);
}

// =====================================================================
group('detectSchemaAndLayers — v1 dispatch');
{
  // No schema_version → v1
  const r = detectSchemaAndLayers({
    windows: [{}], n_windows: 1,
    samples: ['s1'],
  });
  check('no schema_version → v1',                r.schemaVersion === 1);
  check('v1 detects windows',                    r.layers.has('windows'));
  check('v1 detects samples',                    r.layers.has('samples'));
  check('v1 doesn\'t detect tracks',             !r.layers.has('tracks'));
}
{
  // schema_version 1 → v1
  const r = detectSchemaAndLayers({ schema_version: 1, windows: [{}], n_windows: 1 });
  check('schema_version=1 → v1',                 r.schemaVersion === 1);
}

// =====================================================================
group('detectSchemaAndLayers — v2 declared + verified');
{
  const data = {
    schema_version: 2,
    _layers_present: ['windows', 'samples', 'sv_evidence', 'candidates_registry'],
    windows: [{}], n_windows: 1,
    samples: ['s1'],
    sv_evidence: { something: true },
    candidates: [{ id: 'c1' }],
  };
  const r = detectSchemaAndLayers(data);
  check('v2 (numeric)',                          r.schemaVersion === 2);
  check('declared windows verified',             r.layers.has('windows'));
  check('declared samples verified',             r.layers.has('samples'));
  check('declared sv_evidence verified',         r.layers.has('sv_evidence'));
  check('declared candidates_registry verified', r.layers.has('candidates_registry'));
}
{
  // schema_version='2' string also accepted
  const data = {
    schema_version: '2',
    _layers_present: ['windows'],
    windows: [{}], n_windows: 1,
  };
  const r = detectSchemaAndLayers(data);
  check('schema_version="2" → v2',               r.schemaVersion === 2);
}
{
  // schema_version 3 → also v2 path
  const r = detectSchemaAndLayers({ schema_version: 3, _layers_present: [],
                                    windows: [{}], n_windows: 1 });
  check('schema_version=3 → v2 path',            r.schemaVersion === 2);
}

// =====================================================================
group('detectSchemaAndLayers — v2 declared-but-not-present is dropped');
{
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['windows', 'sv_evidence', 'gene_cargo'],
    windows: [{}], n_windows: 1,
    // sv_evidence and gene_cargo declared but NOT in data
  });
  check('windows still present',                 r.layers.has('windows'));
  check('declared-but-absent sv_evidence dropped', !r.layers.has('sv_evidence'));
  check('declared-but-absent gene_cargo dropped',  !r.layers.has('gene_cargo'));
}
{
  // Unknown declared name → trusted (passes through)
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['some_future_layer'],
  });
  check('unknown declared name trusted',         r.layers.has('some_future_layer'));
}

// =====================================================================
group('detectSchemaAndLayers — theta_pi_per_window Shape A');
{
  // Shape A: per-window-embedded `w.theta` array (older R-side --theta exports)
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['windows'],
    windows: [{ theta: [0.001, 0.002, 0.003] }], n_windows: 1,
  });
  check('Shape A: theta_pi_per_window detected', r.layers.has('theta_pi_per_window'));
  check('windows still detected',                r.layers.has('windows'));
}
{
  // Empty theta array → no Shape A detection
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['windows'],
    windows: [{ theta: [] }], n_windows: 1,
  });
  check('empty theta array → no Shape A',        !r.layers.has('theta_pi_per_window'));
}
{
  // No windows → no Shape A detection
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: [],
  });
  check('no windows → no Shape A',               !r.layers.has('theta_pi_per_window'));
}

// =====================================================================
group('detectSchemaAndLayers — recovery sweep');
{
  // Producer forgot to populate _layers_present[] but data is there
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: [],          // empty!
    windows: [{}], n_windows: 1,
    samples: ['s1', 's2'],
    sv_evidence: { x: 1 },
  });
  check('recovery: windows detected',            r.layers.has('windows'));
  check('recovery: samples detected',            r.layers.has('samples'));
  check('recovery: sv_evidence detected',        r.layers.has('sv_evidence'));
}
{
  // _layers_present missing entirely
  const r = detectSchemaAndLayers({
    schema_version: 2,
    windows: [{}], n_windows: 1,
    candidate_proposals: [{ id: 'p1' }],
  });
  check('no _layers_present: windows recovered', r.layers.has('windows'));
  check('no _layers_present: candidate_proposals recovered',
        r.layers.has('candidate_proposals'));
}

// =====================================================================
group('detectSchemaAndLayers — typed array layers (TypedArray detection)');
{
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['sample_froh', 'per_sample_theta_pi'],
    sample_froh: new Float32Array([0.1, 0.2]),
    per_sample_theta_pi: { samples: ['s1'], by_window: new Float32Array(2) },
  });
  check('TypedArray sample_froh detected',       r.layers.has('sample_froh'));
  check('TypedArray per_sample_theta_pi detected', r.layers.has('per_sample_theta_pi'));
}
{
  // Theta-pi per-window Shape B
  const r = detectSchemaAndLayers({
    schema_version: 2,
    _layers_present: ['theta_pi_per_window'],
    theta_pi_per_window: {
      samples: ['s1'], windows: [0, 1],
      values: new Float32Array(2),
    },
  });
  check('Shape B theta_pi_per_window with TypedArray', r.layers.has('theta_pi_per_window'));
}

// =====================================================================
group('detectSchemaAndLayers — broken check resilience');
{
  // Mangled data shouldn't crash the chain. Each check is try/catch-wrapped.
  let threw = false;
  try {
    detectSchemaAndLayers({ schema_version: 2, _layers_present: 'not an array', windows: 'x' });
    detectSchemaAndLayers({ schema_version: 2, _layers_present: [null, undefined, 42, ''] });
    detectSchemaAndLayers({ schema_version: 2 });
  } catch (_) { threw = true; }
  check('mangled inputs handled without throwing', !threw);
}

// =====================================================================
group('detectSchemaAndLayers — large multi-layer realistic example');
{
  const data = {
    schema_version: 2,
    _layers_present: [
      'windows', 'envelopes', 'tracks', 'samples',
      'cluster_labels_ghsl', 'cusum_ghsl', 'ghsl_panel',
      'sv_evidence', 'candidates_registry',
    ],
    windows: [{}, {}], n_windows: 2,
    l2_envelopes: [{ id: 'l2_1' }],
    tracks: { het: { values: [1, 2] } },
    samples: ['s1', 's2', 's3'],
    cluster_labels_ghsl: [0, 1, 2],
    cusum_ghsl: { values: [0.1, 0.2] },
    ghsl_panel: { samples: ['s1'], div_roll: [0.1] },
    sv_evidence: { count: 5 },
    candidates: [{ id: 'c1' }, { id: 'c2' }],
  };
  const r = detectSchemaAndLayers(data);
  check('schema_version 2',                      r.schemaVersion === 2);
  check('all 9 declared layers verified',        r.layers.size >= 9);
  check('windows present',                       r.layers.has('windows'));
  check('candidates_registry present',           r.layers.has('candidates_registry'));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
