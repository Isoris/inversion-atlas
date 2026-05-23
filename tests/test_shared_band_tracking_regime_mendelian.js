// tests/test_shared_band_tracking_regime_mendelian.js
//
// Unit coverage for shared/band_tracking/regime_mendelian.js — Layer 4a.

import {
  REGIME_KARYOTYPE_STATES,
  REGIME_EXPECTED,
  TRIO_SUPPORT_STATUS,
  TRIO_SUPPORT_THRESHOLDS,
  REGIME_MENDELIAN_DEFAULTS,
  regimeKaryotypeForSample,
  annotateRegimeWithTrios,
  annotateRegimeWithFamilies,
  annotateRegimesWithMendelian,
} from '../atlases/popstats/shared/band_tracking/regime_mendelian.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('states frozen',                   Object.isFrozen(REGIME_KARYOTYPE_STATES));
check('expected PMF frozen',             Object.isFrozen(REGIME_EXPECTED));
check('TRIO_SUPPORT_STATUS frozen',      Object.isFrozen(TRIO_SUPPORT_STATUS));
check('AA × AA PMF (1, 0, 0)',
      REGIME_EXPECTED.AA.AA.AA === 1.0
      && REGIME_EXPECTED.AA.AA.AB === 0.0
      && REGIME_EXPECTED.AA.AA.BB === 0.0);
check('AB × AB PMF (0.25, 0.5, 0.25)',
      REGIME_EXPECTED.AB.AB.AA === 0.25
      && REGIME_EXPECTED.AB.AB.AB === 0.5
      && REGIME_EXPECTED.AB.AB.BB === 0.25);
check('AA × BB PMF (0, 1, 0)',
      REGIME_EXPECTED.AA.BB.AB === 1.0);
check('min_trios default = 5',
      REGIME_MENDELIAN_DEFAULTS.min_trios === 5);

// =====================================================================
// Fixture regime: samples 0..5 = AA; 6..11 = BB; 12..14 = AB; 15+ uncalled
// =====================================================================
const regime = {
  regime_id: 0,
  hom_a_intersect: new Set([0, 1, 2, 3, 4, 5]),
  hom_b_intersect: new Set([6, 7, 8, 9, 10, 11]),
  het_union:       new Set([12, 13, 14]),
  start_bp: 1_000_000, end_bp: 5_000_000,
  member_ids: [], n_intervals: 1, sign_split: false,
};

// =====================================================================
group('regimeKaryotypeForSample');

check('AA sample → AA',                regimeKaryotypeForSample(regime, 0) === 'AA');
check('BB sample → BB',                regimeKaryotypeForSample(regime, 9) === 'BB');
check('HET sample → AB',               regimeKaryotypeForSample(regime, 13) === 'AB');
check('uncalled sample → null',        regimeKaryotypeForSample(regime, 100) === null);
check('null regime → null',            regimeKaryotypeForSample(null, 0) === null);

// =====================================================================
group('annotateRegimeWithTrios — clean Mendelian (no contradictions)');

// Build 5 trios where every offspring is biologically consistent.
// AA × AB → 1:1 AA:AB; AB × AB → 1:2:1; AA × BB → 100% AB.
const trios_clean = [
  { father: 0, mother: 12, offspring: 1 },   // AA × AB → child AA: OK
  { father: 1, mother: 13, offspring: 14 },  // AA × AB → child AB: OK
  { father: 12, mother: 13, offspring: 14 }, // AB × AB → child AB: OK
  { father: 12, mother: 13, offspring: 2 },  // AB × AB → child AA: OK
  { father: 0, mother: 6, offspring: 14 },   // AA × BB → child AB: OK
];
const rA1 = annotateRegimeWithTrios(regime, trios_clean);
check('method = A',                      rA1.method === 'A');
check('n_trios = 5',                     rA1.n_trios === 5);
check('n_informative = 5',               rA1.n_informative === 5);
check('n_contradictions = 0',            rA1.n_contradictions === 0);
check('contradiction_rate = 0',          rA1.contradiction_rate === 0);
check('support_status = SUPPORTED',
      rA1.support_status === TRIO_SUPPORT_STATUS.SUPPORTED);
check('by_parent_cross AA_x_AB',
      rA1.by_parent_cross['AA_x_AB']
      && rA1.by_parent_cross['AA_x_AB'].n_trios === 2);

// =====================================================================
group('annotateRegimeWithTrios — contradictions (impossible offspring)');

// AA × AA → child must be AA. Make 5 trios where every offspring is BB.
const trios_bad = [
  { father: 0, mother: 1, offspring: 6 },   // AA × AA → child BB: BAD
  { father: 0, mother: 1, offspring: 7 },   // BAD
  { father: 0, mother: 1, offspring: 8 },   // BAD
  { father: 0, mother: 1, offspring: 9 },   // BAD
  { father: 0, mother: 1, offspring: 10 },  // BAD
];
const rA2 = annotateRegimeWithTrios(regime, trios_bad);
check('all 5 trios are contradictions',  rA2.n_contradictions === 5);
check('contradiction_rate = 1',          rA2.contradiction_rate === 1);
check('support_status = CONTRADICTED',
      rA2.support_status === TRIO_SUPPORT_STATUS.CONTRADICTED);

// Mixed: 4 clean + 1 contradiction = 20% contradiction → CONTRADICTED
// (default threshold > 10%)
const trios_mixed = trios_clean.concat([
  { father: 0, mother: 1, offspring: 6 },   // AA × AA → child BB: BAD
]);
const rA3 = annotateRegimeWithTrios(regime, trios_mixed);
check('mixed 1/6 = 16.7% → CONTRADICTED',
      rA3.support_status === TRIO_SUPPORT_STATUS.CONTRADICTED);

// =====================================================================
group('annotateRegimeWithTrios — insufficient_data');

const trios_short = [{ father: 0, mother: 12, offspring: 1 }];
const rAshort = annotateRegimeWithTrios(regime, trios_short);
check('< min_trios → insufficient_data',
      rAshort.support_status === 'insufficient_data');

// Override min_trios = 1
const rAshortOk = annotateRegimeWithTrios(regime, trios_short, { min_trios: 1 });
check('min_trios=1: not insufficient',
      rAshortOk.support_status === TRIO_SUPPORT_STATUS.SUPPORTED);

// Trios with uncalled members → not informative
const trios_uncalled = [
  { father: 0, mother: 12, offspring: 100 }, // offspring uncalled
];
const rAunc = annotateRegimeWithTrios(regime, trios_uncalled, { min_trios: 1 });
check('uncalled offspring → not informative',
      rAunc.n_informative === 0);

// =====================================================================
group('annotateRegimeWithFamilies — Mendelian AB × AB family');

// Family with AB × AB parents and 1:2:1 offspring (8 AA, 16 AB, 8 BB
// — clean 1:2:1).
const fam_clean = {
  family_id: 'FAM_clean',
  parents: [12, 13],   // both AB
  offspring: [
    // 8 AA, 16 AB, 8 BB — need 32 distinct sample indices in regime.
    // Use placeholders; we'll just assert n_offspring sums match.
  ],
  reliability: 'high',
};
// Populate offspring with members already in regime so tallies sum.
// 8 in AA (indices 0..5 + 0..1 repeated is fine as long as we don't
// check uniqueness — we're tallying observed counts).
const offs = [];
for (let i = 0; i < 8; i++)  offs.push(i % 6);           // AA samples
for (let i = 0; i < 16; i++) offs.push(12 + (i % 3));    // AB samples
for (let i = 0; i < 8; i++)  offs.push(6 + (i % 6));     // BB samples
fam_clean.offspring = offs;

const rB1 = annotateRegimeWithFamilies(regime, [fam_clean]);
check('method = B',                      rB1.method === 'B');
check('n_families = 1',                  rB1.n_families === 1);
check('family_rows length 1',            rB1.family_rows.length === 1);
const row1 = rB1.family_rows[0];
check('family_id preserved',             row1.family_id === 'FAM_clean');
check('parent1 = AB / parent2 = AB',     row1.parent1_call === 'AB' && row1.parent2_call === 'AB');
check('n_offspring = 32',                row1.n_offspring === 32);
check('1:2:1 → MENDELIAN',               row1.segregation_status === 'MENDELIAN');
check('summary n_MENDELIAN = 1',         rB1.summary.n_MENDELIAN === 1);

// =====================================================================
group('annotateRegimeWithFamilies — DISTORTED family');

// AB × AB with strongly skewed offspring (12 AA, 30 AB, 1 BB)
const fam_distorted = {
  family_id: 'FAM_dist',
  parents: [12, 13],
  offspring: [],
  reliability: 'high',
};
for (let i = 0; i < 12; i++) fam_distorted.offspring.push(i % 6);      // AA
for (let i = 0; i < 30; i++) fam_distorted.offspring.push(12 + (i % 3));  // AB
fam_distorted.offspring.push(6);  // BB (just one)

const rBdis = annotateRegimeWithFamilies(regime, [fam_distorted]);
const rowD = rBdis.family_rows[0];
check('skewed 12/30/1 → DISTORTED',
      rowD.segregation_status === 'DISTORTED');
check('effect_direction = BB_deficit',
      rowD.effect_direction === 'BB_deficit');

// =====================================================================
group('annotateRegimeWithFamilies — parent uncertain');

// One parent uncalled in this regime (sample 100)
const fam_pu = {
  family_id: 'FAM_pu',
  parents: [100, 13],
  offspring: [0, 1, 12, 6],
  reliability: 'high',
};
const rBpu = annotateRegimeWithFamilies(regime, [fam_pu]);
check('uncalled parent → PARENT_UNCERTAIN',
      rBpu.family_rows[0].segregation_status === 'PARENT_UNCERTAIN');

// =====================================================================
group('annotateRegimeWithFamilies — invalid input filtered');

const fam_bad = { family_id: 'F1', parents: [12], offspring: [] };
const rBbad = annotateRegimeWithFamilies(regime, [fam_bad]);
check('bad family skipped',              rBbad.n_families === 1
                                          && rBbad.family_rows.length === 0);

// =====================================================================
group('annotateRegimesWithMendelian — orchestrator');

const regimes_two = [regime, Object.assign({}, regime, { regime_id: 1 })];
const annAll = annotateRegimesWithMendelian(regimes_two, {
  trios: trios_clean,
  families: [fam_clean, fam_distorted],
});
check('ok = true',                       annAll.ok === true);
check('n_regimes = 2',                   annAll.n_regimes === 2);
check('every regime gets method_a',      annAll.per_regime.every(r => r.method_a));
check('every regime gets method_b',      annAll.per_regime.every(r => r.method_b));

// Para-vs-peri rollup (with inversion_type on each family)
const fam_para = Object.assign({}, fam_clean, { inversion_type: 'paracentric' });
const fam_peri = Object.assign({}, fam_distorted, { inversion_type: 'pericentric' });
const annRollup = annotateRegimesWithMendelian(regimes_two, {
  families: [fam_para, fam_peri],
  para_peri_rollup: true,
});
check('para_peri_table populated',
      annRollup.para_peri_table && annRollup.para_peri_table.ok === true);

// Method A only when trios supplied
const annNoFams = annotateRegimesWithMendelian([regime], { trios: trios_clean });
check('only trios → only method_a',
      annNoFams.per_regime[0].method_a && !annNoFams.per_regime[0].method_b);

// Neither method supplied → empty per-regime
const annEmpty = annotateRegimesWithMendelian([regime], {});
check('no inputs: empty per_regime entries',
      Object.keys(annEmpty.per_regime[0]).length === 1);   // just regime_id

check('null regimes → ok=false',
      annotateRegimesWithMendelian(null, {}).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
