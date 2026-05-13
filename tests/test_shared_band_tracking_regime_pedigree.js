// tests/test_shared_band_tracking_regime_pedigree.js
//
// Unit coverage for shared/band_tracking/regime_pedigree.js — Layer
// 4b INVERSE-direction pedigree inference from regime co-membership.

import {
  REGIME_PEDIGREE_DEFAULTS,
  REGIME_PEDIGREE_VERDICTS,
  regimePairCoMembership,
  classifyRegimeRelatedness,
  inferRelatednessFromRegimes,
  crossCheckPedigreeWithRegimes,
} from '../atlases/inversion/shared/band_tracking/regime_pedigree.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('defaults frozen',            Object.isFrozen(REGIME_PEDIGREE_DEFAULTS));
check('verdicts frozen',            Object.isFrozen(REGIME_PEDIGREE_VERDICTS));
check('duplicate_above = 0.95',     REGIME_PEDIGREE_DEFAULTS.duplicate_above === 0.95);
check('first_degree_above = 0.70',  REGIME_PEDIGREE_DEFAULTS.first_degree_above === 0.70);
check('min_regimes_called = 5',     REGIME_PEDIGREE_DEFAULTS.min_regimes_called === 5);

// =====================================================================
// Fixture regimes: 10 regimes. Build them so samples 0+1 always
// share class, samples 0+5 share class half the time, samples 0+99
// never share.
// =====================================================================
function mkRegime(id, aSet, bSet, hetSet, start) {
  return {
    regime_id: id,
    hom_a_intersect: new Set(aSet),
    hom_b_intersect: new Set(bSet),
    het_union:       new Set(hetSet),
    start_bp: start, end_bp: start + 1_000_000,
    member_ids: [], n_intervals: 1, sign_split: false,
  };
}

// 10 regimes; samples 0+1 are always together in HOM_A.
// Sample 5 is in HOM_A in regimes 0-4 (sharing with 0) and HET in 5-9.
// Sample 99 is in HOM_B everywhere (disjoint from sample 0).
const regimes = [];
for (let r = 0; r < 10; r++) {
  const homA = [0, 1, 2, 3, 4];
  const homB = [99, 100, 101];
  const het  = [50, 51, 52];
  if (r < 5) homA.push(5); else het.push(5);
  regimes.push(mkRegime(r, homA, homB, het, r * 1_000_000));
}

// =====================================================================
group('regimePairCoMembership — full co-membership');

const r01 = regimePairCoMembership(0, 1, regimes);
check('samples 0+1: n_called = 10',         r01.n_called === 10);
check('samples 0+1: n_same_class = 10',     r01.n_same_class === 10);
check('samples 0+1: same_class_frac = 1',   r01.same_class_frac === 1);
check('samples 0+1: by_class AA_AA = 10',   r01.by_class.AA_AA === 10);

// =====================================================================
group('regimePairCoMembership — half overlap');

const r05 = regimePairCoMembership(0, 5, regimes);
// Sample 0 = HOM_A all 10 regimes; sample 5 = HOM_A 5 regimes + HET 5 regimes
// same class = 5; diff class = 5
check('samples 0+5: n_called = 10',         r05.n_called === 10);
check('samples 0+5: n_same_class = 5',      r05.n_same_class === 5);
check('samples 0+5: same_class_frac = 0.5', r05.same_class_frac === 0.5);

// =====================================================================
group('regimePairCoMembership — disjoint cores');

const r0_99 = regimePairCoMembership(0, 99, regimes);
// Sample 0 = HOM_A; sample 99 = HOM_B everywhere → diff_class
check('samples 0+99: n_called = 10',        r0_99.n_called === 10);
check('samples 0+99: same_class_frac = 0',  r0_99.same_class_frac === 0);

// =====================================================================
group('regimePairCoMembership — uncalled');

const r0_x = regimePairCoMembership(0, 200, regimes);
check('uncalled sample: n_called = 0',      r0_x.n_called === 0);
check('uncalled sample: same_class_frac NaN',
      Number.isNaN(r0_x.same_class_frac));

// =====================================================================
group('classifyRegimeRelatedness');

check('frac=1 + 10 called → DUPLICATE',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: 1.0 })
        === REGIME_PEDIGREE_VERDICTS.DUPLICATE);
check('frac=0.85 → FIRST_DEGREE',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: 0.85 })
        === REGIME_PEDIGREE_VERDICTS.FIRST_DEGREE);
check('frac=0.60 → SECOND_DEGREE',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: 0.60 })
        === REGIME_PEDIGREE_VERDICTS.SECOND_DEGREE);
check('frac=0.10 → UNRELATED',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: 0.10 })
        === REGIME_PEDIGREE_VERDICTS.UNRELATED);
check('n_called=2 → INSUFFICIENT_DATA',
      classifyRegimeRelatedness({ n_called: 2, same_class_frac: 1.0 })
        === REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA);
check('NaN frac → INSUFFICIENT_DATA',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: NaN })
        === REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA);
check('null → INSUFFICIENT_DATA',
      classifyRegimeRelatedness(null)
        === REGIME_PEDIGREE_VERDICTS.INSUFFICIENT_DATA);
// Override thresholds
check('custom first_degree_above=0.95: 0.85 → SECOND_DEGREE',
      classifyRegimeRelatedness({ n_called: 10, same_class_frac: 0.85 },
        { first_degree_above: 0.95 })
        === REGIME_PEDIGREE_VERDICTS.SECOND_DEGREE);

// =====================================================================
group('inferRelatednessFromRegimes — pairwise scan');

const sample_list = [0, 1, 5, 99];
const inferred = inferRelatednessFromRegimes(sample_list, regimes);
check('n_samples = 4',                inferred.n_samples === 4);
check('n_regimes = 10',               inferred.n_regimes === 10);
// 4 samples → 6 pairs
check('6 pairs',                       inferred.pairs.length === 6);

// Pairs sorted by same_class_frac desc → first pair should be (0, 1)
const top = inferred.pairs[0];
check('top pair = samples 0/1',
      top.sample_a === 0 && top.sample_b === 1);
check('top pair verdict = DUPLICATE',
      top.verdict === REGIME_PEDIGREE_VERDICTS.DUPLICATE);

// (0, 99) should be UNRELATED
const r0_99_pair = inferred.pairs.find(p =>
  (p.sample_a === 0 && p.sample_b === 99)
  || (p.sample_a === 99 && p.sample_b === 0));
check('(0, 99) → UNRELATED',
      r0_99_pair.verdict === REGIME_PEDIGREE_VERDICTS.UNRELATED);

// =====================================================================
group('inferRelatednessFromRegimes — empty');

const inferredEmpty = inferRelatednessFromRegimes([], regimes);
check('empty sample_list → no pairs',  inferredEmpty.pairs.length === 0);

// =====================================================================
group('crossCheckPedigreeWithRegimes');

// Provided pairs: (0, 1) as 1st_degree (matches DUPLICATE inferred —
// DUPLICATE is "tighter than 1st_degree" so we treat as strong disagreement
// only if direction is opposite; soft disagreement when verdict ≠ expected
// but in the related band).
//
// We'll match these carefully:
//   - (0, 1) provided='1st_degree', inferred='duplicate_or_identical' → soft
//   - (0, 5) provided='1st_degree', inferred=?  (0.5 frac → likely UNRELATED
//     or SECOND_DEGREE) → strong if UNRELATED, soft if SECOND_DEGREE
//   - (0, 99) provided='unrelated', inferred='unrelated_or_distant' → match!
const provided = [
  { sample_a: 0, sample_b: 1, relationship_class: '1st_degree' },
  { sample_a: 0, sample_b: 99, relationship_class: 'unrelated' },
];
const cross = crossCheckPedigreeWithRegimes(inferred, provided);
check('n_provided = 2',                cross.n_provided === 2);
check('agreement_rate finite',         Number.isFinite(cross.agreement_rate));
// (0, 99) is exact match
check('at least 1 match',              cross.n_matching >= 1);
// (0, 1) provided=1st but inferred=DUPLICATE → that's a soft disagreement
check('at least 1 disagreement recorded',
      cross.disagreements.length >= 1);

// Strong disagreement test: claim (0, 99) is 1st degree when inferred=UNRELATED
const providedWrong = [
  { sample_a: 0, sample_b: 99, relationship_class: '1st_degree' },
];
const crossWrong = crossCheckPedigreeWithRegimes(inferred, providedWrong);
check('1st claim vs UNRELATED inferred → strong disagreement',
      crossWrong.n_strong_disagreement >= 1);

// Pair not in inferred → soft disagreement
const providedMissing = [
  { sample_a: 500, sample_b: 501, relationship_class: '1st_degree' },
];
const crossMissing = crossCheckPedigreeWithRegimes(inferred, providedMissing);
check('pair not in inferred → soft disagreement',
      crossMissing.n_soft_disagreement >= 1);
check('disagreement notes "not_in_inferred"',
      crossMissing.disagreements[0].inferred_verdict === 'not_in_inferred');

// Empty provided
const crossEmpty = crossCheckPedigreeWithRegimes(inferred, []);
check('empty provided → n_provided 0',  crossEmpty.n_provided === 0);
check('empty provided: agreement_rate NaN',
      Number.isNaN(crossEmpty.agreement_rate));

// Null inferred
const crossNull = crossCheckPedigreeWithRegimes(null, provided);
check('null inferred: all disagreements',
      crossNull.n_matching === 0
      && crossNull.disagreements.length === provided.length);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
