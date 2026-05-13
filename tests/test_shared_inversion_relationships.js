// tests/test_shared_inversion_relationships.js
//
// Unit coverage for shared/inversion_relationships.js — pair-level
// inversion-to-inversion relationships (intersecting vs co-occurring).

import {
  INVERSION_RELATIONSHIP_TYPES,
  CO_OCCURRENCE_STRENGTH,
  INVERSION_RELATIONSHIP_DEFAULTS,
  classifyIntersection,
  classifyCoOccurrence,
  classifyInversionRelationship,
  buildRelationshipMatrix,
  topCoOccurringPairs,
  intersectingPairs,
} from '../atlases/inversion/shared/inversion_relationships.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('relationship types frozen',    Object.isFrozen(INVERSION_RELATIONSHIP_TYPES));
check('co-occurrence strength frozen', Object.isFrozen(CO_OCCURRENCE_STRENGTH));
check('defaults frozen',              Object.isFrozen(INVERSION_RELATIONSHIP_DEFAULTS));
check('4 relationship states',        Object.keys(INVERSION_RELATIONSHIP_TYPES).length === 4);
check('v_strong_above = 0.50',        INVERSION_RELATIONSHIP_DEFAULTS.v_strong_above === 0.50);
check('min_n_both_called = 20',       INVERSION_RELATIONSHIP_DEFAULTS.min_n_both_called === 20);

// =====================================================================
group('classifyIntersection — geometry');

const a = { chrom: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000 };
const b = { chrom: 'LG28', start_bp: 1_500_000, end_bp: 2_500_000 };

const ab = classifyIntersection(a, b);
check('overlapping pair: intersect',  ab.intersect === true);
check('overlap_bp = 500k',            ab.overlap_bp === 500_000);
check('same_chrom',                   ab.same_chrom === true);

const c = { chrom: 'LG28', start_bp: 3_000_000, end_bp: 4_000_000 };
const ac = classifyIntersection(a, c);
check('non-overlapping same chrom: no intersect',
      ac.intersect === false && ac.overlap_bp === 0);
check('non-overlapping same chrom: same_chrom = true',
      ac.same_chrom === true);

const d = { chrom: 'LG14', start_bp: 1_000_000, end_bp: 2_000_000 };
const ad = classifyIntersection(a, d);
check('different chrom: no intersect', ad.intersect === false);
check('different chrom: same_chrom = false', ad.same_chrom === false);

// containment
const inner = { chrom: 'LG28', start_bp: 1_200_000, end_bp: 1_500_000 };
const ai = classifyIntersection(a, inner);
check('containment: a contains inner', ai.b_inside_a === true);
check('containment: not a_inside_b',   ai.a_inside_b === false);

// touching but not overlapping (half-open)
const touch = { chrom: 'LG28', start_bp: 2_000_000, end_bp: 3_000_000 };
const at = classifyIntersection(a, touch);
check('touching endpoints: no intersect', at.intersect === false);

// null inputs
check('null a → no intersect',         classifyIntersection(null, b).intersect === false);
check('null b → no intersect',         classifyIntersection(a, null).intersect === false);

// =====================================================================
group('classifyCoOccurrence — strong association');

// 30 samples, all carry AA at A iff they carry AA at B (perfect
// concordance). 10 each of (AA,AA), (AB,AB), (BB,BB).
const ka_perfect = new Int8Array(30);
const kb_perfect = new Int8Array(30);
for (let i = 0; i < 10; i++) { ka_perfect[i] = 0; kb_perfect[i] = 0; }
for (let i = 10; i < 20; i++) { ka_perfect[i] = 1; kb_perfect[i] = 1; }
for (let i = 20; i < 30; i++) { ka_perfect[i] = 2; kb_perfect[i] = 2; }

const co_perfect = classifyCoOccurrence(ka_perfect, kb_perfect);
check('perfect concordance: cramers_v = 1', Math.abs(co_perfect.cramers_v - 1) < 1e-9);
check('perfect concordance: strength = strong',
      co_perfect.strength === CO_OCCURRENCE_STRENGTH.STRONG);
check('perfect concordance: p tiny',  co_perfect.p_value < 1e-6);
check('perfect concordance: n_both_called = 30',
      co_perfect.n_both_called === 30);

// =====================================================================
group('classifyCoOccurrence — independent');

// 60 samples, uniform 3×3 distribution — independent.
const ka_indep = new Int8Array(60);
const kb_indep = new Int8Array(60);
for (let i = 0; i < 60; i++) {
  ka_indep[i] = i % 3;
  kb_indep[i] = Math.floor(i / 3) % 3;
}
const co_indep = classifyCoOccurrence(ka_indep, kb_indep);
check('uniform 3×3: independent',
      co_indep.strength === CO_OCCURRENCE_STRENGTH.INDEPENDENT);
check('uniform 3×3: p ≥ alpha',       co_indep.p_value >= 0.05);

// =====================================================================
group('classifyCoOccurrence — insufficient data');

// only 10 samples — below min_n_both_called=20
const small_a = new Int8Array([0, 0, 1, 1, 2, 2, 0, 1, 2, 0]);
const small_b = new Int8Array([0, 1, 0, 1, 2, 0, 1, 2, 1, 0]);
const co_small = classifyCoOccurrence(small_a, small_b);
check('n < 20: insufficient_data',
      co_small.strength === CO_OCCURRENCE_STRENGTH.INSUFFICIENT_DATA);
check('insufficient: NaN p',          !Number.isFinite(co_small.p_value));

// missing data dropped: half-uncalled cohort
const half = new Int8Array(40);
const halfb = new Int8Array(40);
for (let i = 0; i < 40; i++) {
  if (i < 20) { half[i] = i % 3; halfb[i] = i % 3; }
  else        { half[i] = -1;     halfb[i] = -1; }   // uncalled
}
const co_half = classifyCoOccurrence(half, halfb);
check('uncalled dropped: n_both_called = 20',
      co_half.n_both_called === 20);

// empty / null
check('null a → insufficient',
      classifyCoOccurrence(null, kb_perfect).strength === CO_OCCURRENCE_STRENGTH.INSUFFICIENT_DATA);

// =====================================================================
group('classifyCoOccurrence — strength bands');

// Build a moderate-association fixture (Cramér's V between 0.2 and 0.5)
// 30 (AA,AA), 30 (AB,AB), 30 (BB,BB), 15 (AA,AB) noise
const ka_weak = new Int8Array(105);
const kb_weak = new Int8Array(105);
let p = 0;
for (let i = 0; i < 30; i++) { ka_weak[p] = 0; kb_weak[p] = 0; p++; }
for (let i = 0; i < 30; i++) { ka_weak[p] = 1; kb_weak[p] = 1; p++; }
for (let i = 0; i < 30; i++) { ka_weak[p] = 2; kb_weak[p] = 2; p++; }
// Now add noise so the association weakens — 15 (AA,AB)
for (let i = 0; i < 15; i++) { ka_weak[p] = 0; kb_weak[p] = 1; p++; }
const co_weak = classifyCoOccurrence(ka_weak, kb_weak);
check('weak/strong fixture: significant p',  co_weak.p_value < 0.05);
check('weak/strong fixture: Cramér V in (0, 1)',
      co_weak.cramers_v > 0 && co_weak.cramers_v < 1);

// =====================================================================
group('classifyInversionRelationship — combined');

// Same chromosome, overlapping, strong co-occurrence → BOTH
const candA = { candidate_id: 'A', chrom: 'LG28', start_bp: 1_000_000, end_bp: 2_000_000, karyo: ka_perfect };
const candB = { candidate_id: 'B', chrom: 'LG28', start_bp: 1_500_000, end_bp: 2_500_000, karyo: kb_perfect };
const both = classifyInversionRelationship(candA, candB);
check('overlap + strong co-occurrence → BOTH',
      both.relationship === INVERSION_RELATIONSHIP_TYPES.BOTH);

// Different chromosome, strong co-occurrence → CO_OCCURRING only
const candC = { candidate_id: 'C', chrom: 'LG14', start_bp: 5_000_000, end_bp: 6_000_000, karyo: kb_perfect };
const coOnly = classifyInversionRelationship(candA, candC);
check('different chrom + strong co-occurrence → CO_OCCURRING',
      coOnly.relationship === INVERSION_RELATIONSHIP_TYPES.CO_OCCURRING);
check('different chrom → not intersecting',
      coOnly.intersection.intersect === false);

// Same chromosome, overlapping, independent karyotypes → INTERSECTING only
const candD = { candidate_id: 'D', chrom: 'LG28', start_bp: 1_800_000, end_bp: 2_400_000, karyo: ka_indep };
const candE = { candidate_id: 'E', chrom: 'LG28', start_bp: 1_900_000, end_bp: 2_400_000, karyo: kb_indep };
const interOnly = classifyInversionRelationship(candD, candE);
check('overlap + independent karyo → INTERSECTING',
      interOnly.relationship === INVERSION_RELATIONSHIP_TYPES.INTERSECTING);

// Non-overlapping + independent → NONE
const candF = { candidate_id: 'F', chrom: 'LG28', start_bp: 5_000_000, end_bp: 6_000_000, karyo: ka_indep };
const candG = { candidate_id: 'G', chrom: 'LG14', start_bp: 7_000_000, end_bp: 8_000_000, karyo: kb_indep };
const none = classifyInversionRelationship(candF, candG);
check('non-overlap + independent → NONE',
      none.relationship === INVERSION_RELATIONSHIP_TYPES.NONE);

// =====================================================================
group('buildRelationshipMatrix + filters');

const inversions = [
  candA, candB, candC, candD, candE,
];
const matrix = buildRelationshipMatrix(inversions);
// 5 inversions → 5*4/2 = 10 pairs
check('matrix: 10 pairs',             matrix.length === 10);
check('matrix: a_id / b_id preserved', matrix[0].a_id && matrix[0].b_id);

const topPairs = topCoOccurringPairs(matrix, 3);
check('topCoOccurringPairs: 3 returned', topPairs.length === 3);
check('topCoOccurringPairs: sorted desc',
      topPairs[0].co_occurrence.cramers_v >= topPairs[1].co_occurrence.cramers_v
   && topPairs[1].co_occurrence.cramers_v >= topPairs[2].co_occurrence.cramers_v);

const interList = intersectingPairs(matrix);
check('intersectingPairs: at least 1 pair', interList.length >= 1);
check('intersectingPairs: all on same chrom',
      interList.every(p => p.intersection.same_chrom));

// Edge cases for the bulk helpers
check('buildRelationshipMatrix([]) = []',     buildRelationshipMatrix([]).length === 0);
check('buildRelationshipMatrix([single]) = []', buildRelationshipMatrix([candA]).length === 0);
check('topCoOccurringPairs(null) = []',       topCoOccurringPairs(null).length === 0);
check('intersectingPairs(null) = []',         intersectingPairs(null).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
