// tests/test_analysis_mendelian_inheritance.js
//
// Unit tests for analysis/mendelian_inheritance.js — the SPEC_v2
// item 7 orchestrator. Verifies the four-step pipeline shape against
// a mock Registry, the dependency_hash determinism + sensitivity, the
// payload schema per SPEC_v2 §7, the cache-hit short-circuit, and the
// graceful degradation when atlas-core's Registry.write hasn't shipped.

import {
  RESULT_TYPE,
  ANALYSIS_VERSION,
  DEFAULT_THRESHOLDS,
  computeDependencyHash,
  runMendelianInheritance,
} from '../atlases/popstats/analysis/mendelian_inheritance.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Mock Registry — captures resolve / write calls for inspection
// =====================================================================
function makeRegistry(layers, opts) {
  opts = opts || {};
  return {
    _layers: layers,
    _resolveCalls: [],
    _writeCalls: [],
    async resolve(layerName, args) {
      this._resolveCalls.push({ layerName, args });
      if (layerName in layers) {
        const v = layers[layerName];
        return typeof v === 'function' ? v(args) : v;
      }
      // Mimic atlas-core registry: unknown layer throws.
      throw new Error('mock registry: unknown layer ' + layerName);
    },
    // write() optional — opts.noWrite simulates pre-v2 atlas-core
    write: opts.noWrite ? undefined : async function (layerName, args, payload) {
      this._writeCalls.push({ layerName, args, payload });
    },
  };
}

// =====================================================================
group('module exports + constants');
check('RESULT_TYPE = mendelian_inheritance',
      RESULT_TYPE === 'mendelian_inheritance');
check('ANALYSIS_VERSION = mendelian_inheritance_v1.0',
      ANALYSIS_VERSION === 'mendelian_inheritance_v1.0');
check('DEFAULT_THRESHOLDS frozen',
      Object.isFrozen(DEFAULT_THRESHOLDS));
check('DEFAULT_THRESHOLDS.theta_min = 0.0884',
      DEFAULT_THRESHOLDS.theta_min === 0.0884);
check('DEFAULT_THRESHOLDS.ibs0_max = 0.005',
      DEFAULT_THRESHOLDS.ibs0_max === 0.005);

// =====================================================================
group('computeDependencyHash — determinism + sensitivity');
{
  const fields = {
    candidate_version_id: 'v2_theta_refined',
    callset_id:           'thetaRefined_K3_v2',
    relatedness_result_id: 'ngsrelate_v1_broodstock_qc_pass',
    sample_set_id:        'natora_pruned_81',
    analysis_version:     ANALYSIS_VERSION,
    thresholds:           { theta_min: 0.0884, ibs0_max: 0.005 },
  };
  const h1 = computeDependencyHash(fields);
  const h2 = computeDependencyHash(fields);
  check('hash is hex string',                  /^[0-9a-f]+$/.test(h1));
  check('hash length is 8 (FNV-32)',           h1.length === 8);
  check('identical inputs → identical hash',   h1 === h2);

  // Threshold key order doesn't matter — keys are sorted before hashing.
  const reordered = Object.assign({}, fields, {
    thresholds: { ibs0_max: 0.005, theta_min: 0.0884 },
  });
  check('threshold key order does not matter', h1 === computeDependencyHash(reordered));

  // Sensitivity to each field:
  const v = (k, val) => Object.assign({}, fields, { [k]: val });
  check('different candidate_version_id → different hash',
        h1 !== computeDependencyHash(v('candidate_version_id', 'v1_localPCA')));
  check('different callset_id → different hash',
        h1 !== computeDependencyHash(v('callset_id', 'other_K3')));
  check('different relatedness_result_id → different hash',
        h1 !== computeDependencyHash(v('relatedness_result_id', 'king_v1')));
  check('different sample_set_id → different hash',
        h1 !== computeDependencyHash(v('sample_set_id', 'broodstock_only')));
  check('different analysis_version → different hash',
        h1 !== computeDependencyHash(v('analysis_version', 'v0.9_beta')));
  check('different threshold → different hash',
        h1 !== computeDependencyHash(Object.assign({}, fields,
          { thresholds: { theta_min: 0.1, ibs0_max: 0.005 } })));
}

// =====================================================================
group('input validation');
{
  let threw = false;
  try { await runMendelianInheritance({}); } catch (_) { threw = true; }
  check('missing registry → throws', threw);

  threw = false;
  try { await runMendelianInheritance({ registry: makeRegistry({}) }); }
  catch (_) { threw = true; }
  check('missing candidate_id → throws', threw);
}

// =====================================================================
group('full pipeline — happy path');
{
  // Registry surface: provides karyotype + relatedness (for mendelian.js),
  // active version pointer, version row, and a "not yet computed" cached
  // block (returns null so we hit the compute path).
  const reg = makeRegistry({
    candidate_active_version: { active_version_id: 'v2_theta_refined' },
    candidate_version: { active_callset_id: 'thetaRefined_K3_v2' },
    candidate_karyotype_per_sample: { s1: 'HET', s2: 'HOM_REF' },
    cohort_relatedness: { pairs: [] },
    mendelian_inheritance_block: null,    // cache miss
  });

  const payload = await runMendelianInheritance({
    registry: reg,
    candidate_id: 'LG28_INV_001',
  });

  // Schema (SPEC_v2 §7)
  check('result_type = mendelian_inheritance',
        payload.result_type === RESULT_TYPE);
  check('candidate_id carried',
        payload.candidate_id === 'LG28_INV_001');
  check('candidate_version_id from active pointer',
        payload.candidate_version_id === 'v2_theta_refined');
  check('callset_id from version row',
        payload.callset_id === 'thetaRefined_K3_v2');
  check('default analysis_version',
        payload.analysis_version === ANALYSIS_VERSION);
  check('dependency_hash present + 8 hex chars',
        /^[0-9a-f]{8}$/.test(payload.dependency_hash));
  check('thresholds carry defaults',
        payload.thresholds.theta_min === 0.0884
        && payload.thresholds.ibs0_max === 0.005);
  check('metrics block populated',
        payload.metrics
        && payload.metrics.n_pairs_tested === 0
        && payload.metrics.support_status === 'inconclusive');
  check('per_family is array (placeholder for v2 trio resolver)',
        Array.isArray(payload.per_family));
  check('per_pair is array',                Array.isArray(payload.per_pair));
  check('warnings is array',                Array.isArray(payload.warnings));
  check('created_at is ISO timestamp',
        typeof payload.created_at === 'string'
        && payload.created_at.includes('T')
        && payload.created_at.endsWith('Z'));
  check('_core carryover present',
        payload._core && payload._core.verdict === 'insufficient_data');

  // Side effects on the mock registry
  const wroteBlock = reg._writeCalls.some(w =>
    w.layerName === 'mendelian_inheritance_block');
  check('called registry.write on mendelian_inheritance_block', wroteBlock);
  const writeCall = reg._writeCalls.find(w =>
    w.layerName === 'mendelian_inheritance_block');
  check('write args carry candidate_id',
        writeCall.args.candidate_id === 'LG28_INV_001');
  check('write args carry version_id',
        writeCall.args.version_id === 'v2_theta_refined');
  check('written payload === returned payload',
        writeCall.payload === payload);
}

// =====================================================================
group('version_id override skips active-version resolve');
{
  let activeFetched = false;
  const reg = {
    async resolve(layerName) {
      if (layerName === 'candidate_active_version') {
        activeFetched = true;
        return { active_version_id: 'should_not_be_used' };
      }
      if (layerName === 'candidate_version')
        return { active_callset_id: 'cs_x' };
      if (layerName === 'candidate_karyotype_per_sample') return {};
      if (layerName === 'cohort_relatedness') return { pairs: [] };
      if (layerName === 'mendelian_inheritance_block') return null;
      throw new Error('unknown layer ' + layerName);
    },
    async write() {},
  };
  const payload = await runMendelianInheritance({
    registry: reg, candidate_id: 'X', version_id: 'v_explicit',
  });
  check('explicit version_id used',
        payload.candidate_version_id === 'v_explicit');
  check('candidate_active_version NOT fetched',
        activeFetched === false);
}

// =====================================================================
group('cache hit short-circuits compute + write');
{
  const cachedPayload = {
    result_type: RESULT_TYPE,
    candidate_id: 'cand_X',
    candidate_version_id: 'v1',
    callset_id: 'cs_1',
    relatedness_result_id: 'ngsrelate_default',
    sample_set_id: 'cohort_default',
    analysis_version: ANALYSIS_VERSION,
    // Hash must match what the orchestrator will compute for the same
    // inputs — we precompute it here.
    dependency_hash: computeDependencyHash({
      candidate_version_id: 'v1', callset_id: 'cs_1',
      relatedness_result_id: 'ngsrelate_default',
      sample_set_id: 'cohort_default',
      analysis_version: ANALYSIS_VERSION,
      thresholds: DEFAULT_THRESHOLDS,
    }),
    thresholds: DEFAULT_THRESHOLDS,
    metrics: { stale: 'value' },
    per_family: [], per_pair: [], warnings: [],
    created_at: '2026-05-01T00:00:00.000Z',
  };
  const reg = makeRegistry({
    candidate_active_version: { active_version_id: 'v1' },
    candidate_version: { active_callset_id: 'cs_1' },
    mendelian_inheritance_block: cachedPayload,
    // Should NEVER be hit on a cache hit:
    candidate_karyotype_per_sample: () => {
      throw new Error('compute should not run on cache hit');
    },
    cohort_relatedness: () => {
      throw new Error('compute should not run on cache hit');
    },
  });
  const result = await runMendelianInheritance({
    registry: reg, candidate_id: 'cand_X',
  });
  check('cached payload returned verbatim',  result === cachedPayload);
  check('no write fired on cache hit',
        reg._writeCalls.length === 0);
}

// =====================================================================
group('recompute=true bypasses cache');
{
  const reg = makeRegistry({
    candidate_active_version: { active_version_id: 'v1' },
    candidate_version: { active_callset_id: 'cs_1' },
    mendelian_inheritance_block: { dependency_hash: 'WHATEVER' },   // pretend hit
    candidate_karyotype_per_sample: {},
    cohort_relatedness: { pairs: [] },
  });
  const result = await runMendelianInheritance({
    registry: reg, candidate_id: 'cand_X', recompute: true,
  });
  check('result is freshly computed, not the cache entry',
        result.dependency_hash !== 'WHATEVER');
  check('recompute fired a write',
        reg._writeCalls.length === 1);
}

// =====================================================================
group('graceful degradation when registry has no .write() (pre-v2)');
{
  const reg = makeRegistry({
    candidate_active_version: null,
    candidate_version: null,
    candidate_karyotype_per_sample: {},
    cohort_relatedness: { pairs: [] },
    mendelian_inheritance_block: null,
  }, { noWrite: true });

  let result;
  let threw = false;
  try {
    result = await runMendelianInheritance({
      registry: reg, candidate_id: 'cand_X',
    });
  } catch (_) { threw = true; }
  check('orchestrator does not throw when .write is undefined', !threw);
  check('payload still returned',  result && result.candidate_id === 'cand_X');
}

// =====================================================================
group('graceful degradation when registry.write throws');
{
  const reg = {
    async resolve(layerName) {
      if (layerName === 'candidate_active_version') return null;
      if (layerName === 'candidate_karyotype_per_sample') return {};
      if (layerName === 'cohort_relatedness') return { pairs: [] };
      if (layerName === 'mendelian_inheritance_block') return null;
      throw new Error('unknown layer ' + layerName);
    },
    async write() { throw new Error('server down'); },
  };
  const result = await runMendelianInheritance({
    registry: reg, candidate_id: 'cand_X',
  });
  check('compute completes despite write error',
        result && result.candidate_id === 'cand_X');
  check('warning surfaces the failed write',
        result.warnings.some(w => w.includes('[registry.write]'))
        && result.warnings.some(w => w.includes('server down')));
}

// =====================================================================
group('missing version layers degrade gracefully (pre-v2 state)');
{
  // candidate_active_version layer not yet defined — orchestrator falls
  // back to a null version_id and continues. This is the cartridge's
  // state today.
  const reg = makeRegistry({
    candidate_karyotype_per_sample: {},
    cohort_relatedness: { pairs: [] },
    mendelian_inheritance_block: null,
  });
  // candidate_active_version + candidate_version layers throw "unknown".
  const result = await runMendelianInheritance({
    registry: reg, candidate_id: 'cand_X',
  });
  check('version_id resolves to null (no active version layer)',
        result.candidate_version_id === null);
  check('callset_id resolves to null',  result.callset_id === null);
  check('dependency_hash still computed',
        /^[0-9a-f]{8}$/.test(result.dependency_hash));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
