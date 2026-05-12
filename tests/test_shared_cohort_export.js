// tests/test_shared_cohort_export.js
//
// Unit coverage for shared/cohort_export.js — cohort-level sample
// metadata helpers (legacy lines 61038-61108).

import * as CE from '../atlases/inversion/shared/cohort_export.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('exportSampleId');
const samples = [
  { id: 'CGA001', family_id: 1, ancestry: 'EU' },
  { id: 'CGA002', family_id: 2 },
  { id: null },                       // null id → fallback
  {},                                  // missing id → fallback
];
check('idx 0: CGA001',         CE.exportSampleId(0, samples) === 'CGA001');
check('idx 1: CGA002',         CE.exportSampleId(1, samples) === 'CGA002');
check('idx 2 null → fallback', CE.exportSampleId(2, samples) === 'sample_002');
check('idx 3 missing → fallback', CE.exportSampleId(3, samples) === 'sample_003');
check('out-of-range → fallback',  CE.exportSampleId(99, samples) === 'sample_099');
check('no samples array → fallback', CE.exportSampleId(5, null) === 'sample_005');
check('zero-pads to 3 digits',  CE.exportSampleId(7, []) === 'sample_007');

// Numeric id (non-string) → stringified
check('numeric id → stringified',
      CE.exportSampleId(0, [{ id: 42 }]) === '42');

// -----------------------------------------------------------------------------
group('buildSampleGroupsFromLabels');
const labels = [0, 1, 2, 0, 1, 2, -1, 0];
const hapLabels = { 0: 'H1/H1', 1: 'H1/H2', 2: 'H2/H2' };
const groups = CE.buildSampleGroupsFromLabels(labels, hapLabels, samples);
check('H1/H1: 3 samples',         groups['H1/H1'].length === 3);
check('H1/H2: 2 samples',         groups['H1/H2'].length === 2);
check('H2/H2: 2 samples',         groups['H2/H2'].length === 2);
check('NA samples dropped',        Object.values(groups).every(g => !g.includes('sample_006')));
check('uses exportSampleId',      groups['H1/H1'][0] === 'CGA001');

// Missing band label → band_<k> fallback
const partialLabels = { 0: 'H1/H1' };
const groupsPartial = CE.buildSampleGroupsFromLabels([0, 1, 2], partialLabels, samples);
check('missing label: band_1 fallback',  groupsPartial.band_1 && groupsPartial.band_1.length === 1);
check('missing label: band_2 fallback',  groupsPartial.band_2 && groupsPartial.band_2.length === 1);

// Empty / null labels
check('null labels → {}',         Object.keys(CE.buildSampleGroupsFromLabels(null, hapLabels, samples)).length === 0);
check('empty labels → {}',        Object.keys(CE.buildSampleGroupsFromLabels([], hapLabels, samples)).length === 0);

// No hapLabels: everything goes to band_<k>
const groupsNoLabels = CE.buildSampleGroupsFromLabels([0, 1, 0, 1], null, samples);
check('no hapLabels: keys are band_<k>',
      'band_0' in groupsNoLabels && 'band_1' in groupsNoLabels);

// -----------------------------------------------------------------------------
group('buildCohortSamplesBlock');
const block = CE.buildCohortSamplesBlock(samples);
check('4 entries',                block.length === 4);
check('entry 0: id + family_id + ancestry',
      block[0].id === 'CGA001' && block[0].family_id === '1' && block[0].ancestry === 'EU');
check('entry 1: missing ancestry → null',  block[1].ancestry === null);
check('entry 2: id fallback',     block[2].id === 'sample_002');

// family_id = -1 → null
const samplesWithBad = [{ id: 'X', family_id: -1, ancestry: '' }];
const blockBad = CE.buildCohortSamplesBlock(samplesWithBad);
check('family_id = -1 → null',    blockBad[0].family_id === null);
check('empty ancestry preserved as ""',  blockBad[0].ancestry === '');

// Empty / non-array input
check('null samples → []',        CE.buildCohortSamplesBlock(null).length === 0);
check('non-array → []',           CE.buildCohortSamplesBlock({}).length === 0);

// Idx preserved
check('idx matches array position',  block[3].idx === 3);

// -----------------------------------------------------------------------------
group('safeCall');
check('non-function → null',      CE.safeCall(null) === null);
check('non-function string → null', CE.safeCall('x') === null);

const ok = CE.safeCall((x) => x * 2, 5);
check('returns fn result',        ok === 10);

const threw = CE.safeCall(() => { throw new Error('boom'); });
check('throwing fn → null',       threw === null);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
