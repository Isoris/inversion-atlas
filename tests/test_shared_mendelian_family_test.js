// tests/test_shared_mendelian_family_test.js
//
// Direct-import coverage for shared/mendelian_family_test.js — the
// generic per-family Mendelian test (same math for paracentric /
// pericentric / unknown inversions). Verifies imports work directly
// from this module (not just via the para_vs_peri re-export).

import {
  SEGREGATION_STATUS,
  EFFECT_DIRECTIONS,
  INVERSION_TYPES,
  RELIABILITY_TIERS,
  RELIABILITY_DEFAULTS,
  MENDELIAN_TEST_DEFAULTS,
  expectedRatioForCross,
  formatExpectedRatio,
  chiSquareGoodnessOfFit,
  classifyEffectDirection,
  classifyReliabilityTier,
  classifySegregationStatus,
  testFamilyCandidate,
} from '../atlases/inversion/shared/mendelian_family_test.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('all vocab importable directly from mendelian_family_test');

check('SEGREGATION_STATUS frozen',     Object.isFrozen(SEGREGATION_STATUS));
check('EFFECT_DIRECTIONS frozen',      Object.isFrozen(EFFECT_DIRECTIONS));
check('INVERSION_TYPES frozen',        Object.isFrozen(INVERSION_TYPES));
check('RELIABILITY_TIERS frozen',      Object.isFrozen(RELIABILITY_TIERS));
check('RELIABILITY_DEFAULTS frozen',   Object.isFrozen(RELIABILITY_DEFAULTS));
check('MENDELIAN_TEST_DEFAULTS frozen', Object.isFrozen(MENDELIAN_TEST_DEFAULTS));
check('all 6 segregation states',      Object.keys(SEGREGATION_STATUS).length === 6);
check('all 7 effect direction tags',   Object.keys(EFFECT_DIRECTIONS).length === 7);

// =====================================================================
group('all primitives importable directly');

check('expectedRatioForCross fn',     typeof expectedRatioForCross === 'function');
check('formatExpectedRatio fn',       typeof formatExpectedRatio === 'function');
check('chiSquareGoodnessOfFit fn',    typeof chiSquareGoodnessOfFit === 'function');
check('classifyEffectDirection fn',   typeof classifyEffectDirection === 'function');
check('classifyReliabilityTier fn',   typeof classifyReliabilityTier === 'function');
check('classifySegregationStatus fn', typeof classifySegregationStatus === 'function');
check('testFamilyCandidate fn',       typeof testFamilyCandidate === 'function');

// =====================================================================
group('round-trip — inversion_type is pure passthrough');

// Same math, three different inversion_type labels — outputs identical
// except for the type label.
function runOne(invType) {
  return testFamilyCandidate({
    candidate_id:   'C',
    inversion_type: invType,
    family_id:      'F',
    parent1_call: 'AB', parent2_call: 'AB',
    offspring_counts: { AA: 12, AB: 30, BB: 1 },
    reliability_inputs: {
      both_parents_confident: true, call_rate: 0.95,
      karyotype_clarity: 'clear', confound: 'none',
    },
  });
}
const para = runOne(INVERSION_TYPES.PARACENTRIC);
const peri = runOne(INVERSION_TYPES.PERICENTRIC);
const unkn = runOne(INVERSION_TYPES.UNKNOWN);

check('para.p_value === peri.p_value',  para.p_value === peri.p_value);
check('peri.p_value === unkn.p_value',  peri.p_value === unkn.p_value);
check('para.segregation_status === peri.segregation_status',
      para.segregation_status === peri.segregation_status);
check('para.effect_direction === peri.effect_direction',
      para.effect_direction === peri.effect_direction);
check('para.reliability === peri.reliability',
      para.reliability === peri.reliability);
check('para.inversion_type = paracentric',
      para.inversion_type === INVERSION_TYPES.PARACENTRIC);
check('peri.inversion_type = pericentric',
      peri.inversion_type === INVERSION_TYPES.PERICENTRIC);
check('unkn.inversion_type = unknown',
      unkn.inversion_type === INVERSION_TYPES.UNKNOWN);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
