// tests/smoke_popstats_demo_request.js
// =====================================================================
// Smoke test: popstats_demo request-building + response-extraction logic.
//
// Verifies the page turns a registeredCandidates record into a valid
// /api/popstats/groupwise request body (matching
// registries/schemas/schema_in/run_popstats_v1.schema.json: target.groups
// minProperties 2, each array minItems 1, 'uncertain' dropped), and that
// the response extractors read θπ (per-group) + FST/dXY (pairwise) from
// the common server response shapes.
// =====================================================================

import { __test } from '../atlases/inversion/pages/review/popstats_demo.js';

let pass = 0, fail = 0;
function assertEq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else    { fail++; console.error(`  ✗ ${label}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`); }
}
function assert(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else      { fail++; console.error(`  ✗ ${label}`); }
}

// -------- 1. requestGroups: drops uncertain + empty -------------------

console.log('requestGroups tier — drops uncertain + empty, keeps karyotype groups');
{
  const cand = {
    candidate_id: 'cand_A',
    regime_groups: {
      'H1/H1': ['s1', 's2', 's3'],
      'H1/H2': ['s4', 's5'],
      'H2/H2': ['s6'],
      'uncertain': ['s7', 's8'],
    },
  };
  const groups = __test.requestGroups(cand, 'tier');
  assertEq('keeps H1/H1', groups['H1/H1'], ['s1', 's2', 's3']);
  assertEq('keeps H1/H2', groups['H1/H2'], ['s4', 's5']);
  assertEq('keeps H2/H2', groups['H2/H2'], ['s6']);
  assert('drops uncertain', !('uncertain' in groups));
  assertEq('group count = 3', Object.keys(groups).length, 3);

  // Schema contract: minProperties 2, each array minItems 1.
  assert('schema: ≥2 groups', Object.keys(groups).length >= 2);
  assert('schema: every group non-empty',
    Object.values(groups).every(a => Array.isArray(a) && a.length >= 1));
  assert('schema: every sample_id is string',
    Object.values(groups).every(a => a.every(s => typeof s === 'string')));
}

console.log('requestGroups tier — drops empty arrays');
{
  const cand = { regime_groups: { 'H1/H1': ['s1'], 'H1/H2': [], 'H2/H2': ['s2'] } };
  const groups = __test.requestGroups(cand, 'tier');
  assert('drops empty H1/H2', !('H1/H2' in groups));
  assertEq('count = 2', Object.keys(groups).length, 2);
}

console.log('requestGroups tier — single karyotype group → caller must reject (<2)');
{
  const cand = { regime_groups: { 'H1/H1': ['s1', 's2'], 'uncertain': ['s3'] } };
  const groups = __test.requestGroups(cand, 'tier');
  assertEq('only 1 usable group', Object.keys(groups).length, 1);
}

console.log('requestGroups band — keeps every non-empty band, no uncertain concept');
{
  const cand = {
    band_groups: {
      band_0: ['s1', 's2'],
      band_1: ['s3'],
      band_2: ['s4', 's5'],
      band_3: [],            // empty → dropped
    },
  };
  const groups = __test.requestGroups(cand, 'band');
  assertEq('band_0', groups['band_0'], ['s1', 's2']);
  assertEq('band_1', groups['band_1'], ['s3']);
  assertEq('band_2', groups['band_2'], ['s4', 's5']);
  assert('drops empty band_3', !('band_3' in groups));
  assertEq('count = 3', Object.keys(groups).length, 3);
  // band mode preserves K>3 structure that the 3-tier collapse would lose.
}

console.log('requestGroups band — default mode is band');
{
  const cand = {
    band_groups: { band_0: ['s1'], band_1: ['s2'] },
    regime_groups: { 'H1/H1': ['s1', 's2'] },   // tier would give 1 group
  };
  const groups = __test.requestGroups(cand);   // no mode → band default
  assertEq('default uses band_groups', Object.keys(groups).sort(), ['band_0', 'band_1']);
}

// -------- 2. extractPerGroup: θπ across response shapes ----------------

console.log('extractPerGroup — preferred {groups:{name:{metric}}}');
{
  const data = { groups: { 'H1/H1': { theta_pi: 0.0021 }, 'H2/H2': { theta_pi: 0.0008 } } };
  const per = __test.extractPerGroup(data, 'theta_pi');
  assertEq('H1/H1', per['H1/H1'], 0.0021);
  assertEq('H2/H2', per['H2/H2'], 0.0008);
}

console.log('extractPerGroup — older {per_group:{...}}');
{
  const data = { per_group: { 'H1/H1': { theta_pi: 0.003 } } };
  const per = __test.extractPerGroup(data, 'theta_pi');
  assertEq('H1/H1', per['H1/H1'], 0.003);
}

console.log('extractPerGroup — missing metric → null');
{
  const data = { groups: { 'H1/H1': { fst: 0.1 } } };
  assertEq('null when metric absent', __test.extractPerGroup(data, 'theta_pi'), null);
}

// -------- 3. extractPairwise: FST across response shapes ---------------

console.log('extractPairwise — {pairs:[{a,b,fst}]}');
{
  const data = { pairs: [{ a: 'H1/H1', b: 'H2/H2', fst: 0.42 }] };
  assertEq('forward order', __test.extractPairwise(data, 'fst', 'H1/H1', 'H2/H2'), 0.42);
  assertEq('reverse order', __test.extractPairwise(data, 'fst', 'H2/H2', 'H1/H1'), 0.42);
}

console.log('extractPairwise — {pairwise:[{group_a,group_b,fst}]}');
{
  const data = { pairwise: [{ group_a: 'H1/H1', group_b: 'H1/H2', fst: 0.11 }] };
  assertEq('reads group_a/group_b', __test.extractPairwise(data, 'fst', 'H1/H1', 'H1/H2'), 0.11);
}

console.log('extractPairwise — keyed-object {pairs:{"a:b":{fst}}}');
{
  const data = { pairs: { 'H1/H1:H2/H2': { fst: 0.33 } } };
  assertEq('keyed forward', __test.extractPairwise(data, 'fst', 'H1/H1', 'H2/H2'), 0.33);
  assertEq('keyed reverse', __test.extractPairwise(data, 'fst', 'H2/H2', 'H1/H1'), 0.33);
}

console.log('extractPairwise — absent → null');
{
  const data = { pairs: [{ a: 'H1/H1', b: 'H1/H2', fst: 0.1 }] };
  assertEq('null for missing pair', __test.extractPairwise(data, 'fst', 'H1/H1', 'H2/H2'), null);
}

// -------- 4. readRegistry tolerates missing slot ----------------------

console.log('readRegistry — empty / missing slot → []');
{
  assertEq('null atlasState', __test.readRegistry(null), []);
  assertEq('no shared', __test.readRegistry({}), []);
  assertEq('no registeredCandidates', __test.readRegistry({ shared: {} }), []);
  assertEq('passes through array',
    __test.readRegistry({ shared: { registeredCandidates: [{ candidate_id: 'x' }] } }),
    [{ candidate_id: 'x' }]);
}

console.log('=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
if (fail > 0) process.exit(1);
