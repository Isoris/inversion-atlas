// tests/test_shared_homokaryotype_diversity_pattern.js
//
// Unit coverage for shared/homokaryotype_diversity_pattern.js — the
// 5-pattern classifier (+ HWE-expected-het helper) for the [evo] hover
// pill on page17's karyotype-aware stat cells.

import {
  HOMOKARYOTYPE_DIVERSITY_PATTERNS,
  HOMOKARYOTYPE_PATTERN_INTERPRETATIONS,
  HOMOKARYOTYPE_PATTERN_DEFAULTS,
  expectedHetCountHWE,
  classifyHomokaryotypeDiversityPattern,
} from '../atlases/inversion/shared/homokaryotype_diversity_pattern.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('patterns frozen',         Object.isFrozen(HOMOKARYOTYPE_DIVERSITY_PATTERNS));
check('interpretations frozen',  Object.isFrozen(HOMOKARYOTYPE_PATTERN_INTERPRETATIONS));
check('defaults frozen',         Object.isFrozen(HOMOKARYOTYPE_PATTERN_DEFAULTS));
check('6 pattern labels (5 + insufficient_data)',
      Object.keys(HOMOKARYOTYPE_DIVERSITY_PATTERNS).length === 6);
check('every pattern has an interpretation',
      Object.values(HOMOKARYOTYPE_DIVERSITY_PATTERNS).every(
        p => typeof HOMOKARYOTYPE_PATTERN_INTERPRETATIONS[p] === 'string'));
check('low_pi_below = 0.005',    HOMOKARYOTYPE_PATTERN_DEFAULTS.low_pi_below === 0.005);
check('high_pi_above = 0.015',   HOMOKARYOTYPE_PATTERN_DEFAULTS.high_pi_above === 0.015);
check('asymmetry_ratio = 2.0',   HOMOKARYOTYPE_PATTERN_DEFAULTS.asymmetry_ratio === 2.0);

// =====================================================================
group('expectedHetCountHWE');

// 50 AA, 30 AB, 20 BB → p = (100+30)/200 = 0.65, q = 0.35, E[AB] = 2*0.65*0.35*100 = 45.5
check('50/30/20 → E[AB] = 45.5',
      Math.abs(expectedHetCountHWE(50, 30, 20) - 45.5) < 1e-9);
// Allele freq 0.5 (25/50/25) → E[AB] = 2*0.5*0.5*100 = 50
check('25/50/25 → E[AB] = 50',
      Math.abs(expectedHetCountHWE(25, 50, 25) - 50) < 1e-9);
check('empty cohort → NaN',      Number.isNaN(expectedHetCountHWE(0, 0, 0)));

// =====================================================================
group('classifyHomokaryotypeDiversityPattern — 5 canonical patterns');

// Pattern 1: π_homA ≈ π_homB low → BOTH_LOW_DIVERGENT
const r1 = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.003, pi_homB: 0.003,
  n_AA: 30, n_AB: 40, n_BB: 30,
});
check('low/low symmetric → BOTH_LOW_DIVERGENT',
      r1.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_LOW_DIVERGENT);
check('low/low: interpretation populated',  r1.interpretation.length > 20);
check('low/low: not asymmetric',            r1.asymmetric === false);

// Pattern 2: π_homA >> π_homB → ASYMMETRIC
const r2 = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.012, pi_homB: 0.003,
  n_AA: 30, n_AB: 40, n_BB: 30,
});
check('asymmetric mid/low → ASYMMETRIC',
      r2.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.ASYMMETRIC);
check('asymmetric: flag set',               r2.asymmetric === true);

// Pattern 3: π_homA high, π_homB low, AB excess → ASYMMETRIC_AB_EXCESS
// 10 AA / 60 AB / 10 BB at allele freq 0.5: expected AB = 2*0.5*0.5*80 = 40
// observed AB = 60 → ratio = 1.5 > 1.20 default → excess
const r3 = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.020, pi_homB: 0.003,
  n_AA: 10, n_AB: 60, n_BB: 10,
});
check('asymmetric + AB excess → ASYMMETRIC_AB_EXCESS',
      r3.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.ASYMMETRIC_AB_EXCESS);
check('ab_excess flag set',                 r3.ab_excess === true);
check('ab_excess_ratio > 1.20',             r3.ab_excess_ratio > 1.20);

// Pattern 4: π_homA low, π_homB low, AB excess → BOTH_LOW_AB_EXCESS
const r4 = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.003, pi_homB: 0.003,
  n_AA: 10, n_AB: 60, n_BB: 10,
});
check('low/low + AB excess → BOTH_LOW_AB_EXCESS',
      r4.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_LOW_AB_EXCESS);

// Pattern 5: π_homA high, π_homB high → BOTH_HIGH
const r5 = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.020, pi_homB: 0.022,
  n_AA: 30, n_AB: 40, n_BB: 30,
});
check('high/high → BOTH_HIGH',
      r5.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_HIGH);

// =====================================================================
group('classifyHomokaryotypeDiversityPattern — edge cases');

// Insufficient data: n_AA below min
check('n_AA < min_n → INSUFFICIENT_DATA',
      classifyHomokaryotypeDiversityPattern({
        pi_homA: 0.01, pi_homB: 0.01,
        n_AA: 2, n_AB: 20, n_BB: 30,
      }).pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.INSUFFICIENT_DATA);

check('NaN π → INSUFFICIENT_DATA',
      classifyHomokaryotypeDiversityPattern({
        pi_homA: NaN, pi_homB: 0.005,
        n_AA: 30, n_AB: 40, n_BB: 30,
      }).pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.INSUFFICIENT_DATA);

check('null args → INSUFFICIENT_DATA',
      classifyHomokaryotypeDiversityPattern(null).pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.INSUFFICIENT_DATA);

// Custom thresholds: raise low_pi_below so the asymmetric/low-low fixture
// re-classifies as both_high (since 0.003 no longer counts as low).
const r_custom = classifyHomokaryotypeDiversityPattern({
  pi_homA: 0.003, pi_homB: 0.003,
  n_AA: 30, n_AB: 40, n_BB: 30,
}, { low_pi_below: 0.001, high_pi_above: 0.002 });
check('custom thresholds: 0.003 → high band → BOTH_HIGH',
      r_custom.pattern === HOMOKARYOTYPE_DIVERSITY_PATTERNS.BOTH_HIGH);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
