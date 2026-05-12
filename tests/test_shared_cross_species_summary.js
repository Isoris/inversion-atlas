// tests/test_shared_cross_species_summary.js
//
// Unit coverage for shared/cross_species_summary.js —
// fission/fusion summary + per-event-type counts.

import {
  FISSION_FUSION_EVENT_TYPES,
  deriveFusionFission,
  countByEventType,
} from '../atlases/inversion/shared/cross_species_summary.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('FISSION_FUSION_EVENT_TYPES frozen',
      Object.isFrozen(FISSION_FUSION_EVENT_TYPES));
check('includes fission_or_fusion',
      FISSION_FUSION_EVENT_TYPES.indexOf('fission_or_fusion') >= 0);
check('includes translocation_or_fission',
      FISSION_FUSION_EVENT_TYPES.indexOf('translocation_or_fission') >= 0);

// =====================================================================
group('deriveFusionFission — null / empty');

check('null → null',                 deriveFusionFission(null) === null);
check('undefined → null',            deriveFusionFission(undefined) === null);
check('[] → null',                   deriveFusionFission([]) === null);
check('non-array → null',            deriveFusionFission('foo') === null);

// =====================================================================
group('deriveFusionFission — counts + verdict');

const bps1 = [
  { event_type: 'fission_or_fusion' },
  { event_type: 'inversion' },
  { event_type: 'translocation_or_fission' },
  { event_type: 'inversion' },
  { event_type: 'unclassified' },
];
const r1 = deriveFusionFission(bps1);
check('observed = 2 (2 ff)',         r1.observed === 2);
check('n = 5 total',                 r1.n === 5);
check('state = "derived"',           r1.state === 'derived');
check('effect = "enriched"',         r1.effect === 'enriched');
check('unit = "breakpoints"',        r1.unit === 'breakpoints');
check('expected null',               r1.expected === null);
check('p_value null',                r1.p_value === null);
check('q_value null',                r1.q_value === null);
check('label mentions 2 / 5',
      r1.label.indexOf('2 / 5') >= 0);
check('label mentions 2 inversion (2 inv bps)',
      r1.label.indexOf('(2 inversion breakpoints)') >= 0);

// 0 fission/fusion → not_significant
const bps0 = [
  { event_type: 'inversion' }, { event_type: 'inversion' },
];
const r0 = deriveFusionFission(bps0);
check('0 ff → not_significant',      r0.effect === 'not_significant');
check('0 ff: observed = 0',          r0.observed === 0);

// event_type_refined takes precedence
const bpsRefined = [
  { event_type: 'inversion', event_type_refined: 'fission_or_fusion' },
  { event_type: 'inversion' },
];
const rR = deriveFusionFission(bpsRefined);
check('event_type_refined preferred',  rR.observed === 1);

// Empty event_type tolerated
const bpsBlank = [
  { event_type: '' }, { event_type: 'fission_or_fusion' },
];
const rB = deriveFusionFission(bpsBlank);
check('blank event_type tolerated', rB.observed === 1);

// =====================================================================
group('countByEventType');

const cb = countByEventType(bps1);
check('inversion count = 2',         cb.inversion === 2);
check('fission_or_fusion = 1',       cb.fission_or_fusion === 1);
check('translocation_or_fission = 1',
      cb.translocation_or_fission === 1);
check('unclassified = 1',            cb.unclassified === 1);

check('null → {}',
      Object.keys(countByEventType(null)).length === 0);
check('non-array → {}',
      Object.keys(countByEventType(42)).length === 0);

// blank event_type skipped
const cbBlank = countByEventType([
  { event_type: '' }, { event_type: null }, { event_type: 'inversion' },
]);
check('blank/null event_type skipped',
      Object.keys(cbBlank).length === 1 && cbBlank.inversion === 1);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
