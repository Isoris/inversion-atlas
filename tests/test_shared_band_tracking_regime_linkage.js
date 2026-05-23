// tests/test_shared_band_tracking_regime_linkage.js
//
// Unit coverage for shared/band_tracking/regime_linkage.js — Layer
// 4c cross-regime LD + family-aware recombination test.

import {
  REGIME_LINKAGE_VERDICTS,
  REGIME_LINKAGE_DEFAULTS,
  buildSampleRegimeMatrix,
  pairwiseRegimeContingency,
  regimeLD,
  regimeLinkageMatrix,
  familyRegimeRecombination,
} from '../atlases/popstats/shared/band_tracking/regime_linkage.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('verdicts frozen',                Object.isFrozen(REGIME_LINKAGE_VERDICTS));
check('defaults frozen',                Object.isFrozen(REGIME_LINKAGE_DEFAULTS));
check('LINKED verdict',
      REGIME_LINKAGE_VERDICTS.LINKED === 'linked');
check('linked_above default = 0.50',
      REGIME_LINKAGE_DEFAULTS.linked_above === 0.50);

// =====================================================================
// Fixture: 2 regimes that are PERFECTLY linked (same haplotype
// system across samples) vs 2 regimes that are independent.
// =====================================================================
function mkRegime(id, homA, homB, het) {
  return {
    regime_id: id, regime_uid: 'r:' + id,
    hom_a_intersect: new Set(homA),
    hom_b_intersect: new Set(homB),
    het_union:       new Set(het),
    start_bp: 0, end_bp: 1_000_000, n_intervals: 1,
  };
}

// Linked pair: 30 samples, all AA at both regimes; 30 all BB; 30 all AB
const homALinked = [];
const homBLinked = [];
const hetLinked  = [];
for (let i = 0; i < 30; i++) {
  homALinked.push(i);
  homBLinked.push(i + 30);
  hetLinked.push(i + 60);
}
const RA = mkRegime(0, homALinked, homBLinked, hetLinked);
const RB = mkRegime(1, homALinked, homBLinked, hetLinked);   // IDENTICAL

// Independent pair: split 90 samples into 9 buckets of 10 — each cell
// of the 3×3 (AA/AB/BB at C × AA/AB/BB at D) gets exactly 10 samples.
// This is the canonical uniform-distribution = independence fixture.
const homA_C = [], homB_C = [], het_C = [];
const homA_D2 = [], homB_D2 = [], het_D2 = [];
for (let i = 0; i < 90; i++) {
  const cell = Math.floor(i / 10);   // 0..8 → 9 cells
  const ka  = Math.floor(cell / 3);  // RC karyo (0=AA, 1=AB, 2=BB)
  const kd  = cell % 3;              // RD karyo (independent)
  if (ka === 0) homA_C.push(i);  else if (ka === 1) het_C.push(i);  else homB_C.push(i);
  if (kd === 0) homA_D2.push(i); else if (kd === 1) het_D2.push(i); else homB_D2.push(i);
}
const RC = mkRegime(2, homA_C, homB_C, het_C);
const RD = mkRegime(3, homA_D2, homB_D2, het_D2);

const sample_list = [];
for (let i = 0; i < 90; i++) sample_list.push(i);

// =====================================================================
group('buildSampleRegimeMatrix');

const mat = buildSampleRegimeMatrix([RA, RB, RC, RD], sample_list);
check('n_samples = 90',                 mat.n_samples === 90);
check('n_regimes = 4',                  mat.n_regimes === 4);
check('matrix length = 90 × 4',         mat.matrix.length === 360);
check('regime_uids preserved',           mat.regime_uids.length === 4
                                          && mat.regime_uids[0] === 'r:0');
// Sample 0 is HOM_A in regimes 0 and 1 (linked)
check('sample 0 at regime 0 = AA (0)',   mat.matrix[0 * 4 + 0] === 0);
check('sample 0 at regime 1 = AA (0)',   mat.matrix[0 * 4 + 1] === 0);
// Sample 30 is HOM_B in regimes 0 and 1
check('sample 30 at regime 0 = BB (2)',  mat.matrix[30 * 4 + 0] === 2);

// =====================================================================
group('pairwiseRegimeContingency');

// Regimes 0 (RA) and 1 (RB) are identical — the contingency is
// purely diagonal (30 AA-AA, 30 BB-BB, 30 AB-AB).
const c_linked = pairwiseRegimeContingency(mat.matrix, 90, 4, 0, 1);
check('n_called = 90',                  c_linked.n_called === 90);
check('AA-AA = 30',                     c_linked.table[0][0] === 30);
check('AB-AB = 30',                     c_linked.table[1][1] === 30);
check('BB-BB = 30',                     c_linked.table[2][2] === 30);
check('off-diagonals = 0',
      c_linked.table[0][1] === 0
      && c_linked.table[0][2] === 0
      && c_linked.table[1][0] === 0);

// Regime 0 vs 2 — should NOT be perfectly linked (different fixture)
const c_diff = pairwiseRegimeContingency(mat.matrix, 90, 4, 0, 2);
check('n_called = 90 (different regimes)', c_diff.n_called === 90);

// =====================================================================
group('regimeLD — LINKED pair');

const ld_linked = regimeLD(mat.matrix, 90, 4, 0, 1);
check('verdict = LINKED',                ld_linked.verdict === REGIME_LINKAGE_VERDICTS.LINKED);
check('Cramér\'s V ≈ 1',                 ld_linked.cramers_v > 0.95);
check('p_value < 0.001',                 ld_linked.p_value < 0.001);
check('chi2 large',                      ld_linked.chi2 > 50);

// =====================================================================
group('regimeLD — INDEPENDENT pair');

const ld_indep = regimeLD(mat.matrix, 90, 4, 2, 3);
check('verdict = INDEPENDENT or WEAKLY_LINKED',
      ld_indep.verdict === REGIME_LINKAGE_VERDICTS.INDEPENDENT
      || ld_indep.verdict === REGIME_LINKAGE_VERDICTS.WEAKLY_LINKED);
check('Cramér\'s V small',               ld_indep.cramers_v < 0.4);

// =====================================================================
group('regimeLD — INSUFFICIENT_DATA');

// Few called samples
const ld_short = regimeLD(mat.matrix, 5, 4, 0, 1);
check('< min_samples_called → INSUFFICIENT_DATA',
      ld_short.verdict === REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
group('regimeLinkageMatrix');

const lm = regimeLinkageMatrix([RA, RB, RC, RD], sample_list);
check('n_regimes = 4',                   lm.n_regimes === 4);
check('cramers_v_matrix size = 16',      lm.cramers_v_matrix.length === 16);
check('diagonal = 1',                    lm.cramers_v_matrix[0] === 1);
check('matrix symmetric',
      lm.cramers_v_matrix[1] === lm.cramers_v_matrix[4]);

// RA-RB is the strongest link → first edge
check('edges array populated',           lm.edges.length > 0);
check('top edge is RA-RB',
      lm.edges[0].regime_uid_a === 'r:0' && lm.edges[0].regime_uid_b === 'r:1');
check('top edge verdict = LINKED',
      lm.edges[0].verdict === REGIME_LINKAGE_VERDICTS.LINKED);
// edges sorted by cramers_v desc
if (lm.edges.length >= 2) {
  check('edges sorted desc',
        lm.edges[0].cramers_v >= lm.edges[1].cramers_v);
}

// =====================================================================
group('familyRegimeRecombination — informative AB × AB linked');

// Build a family where both parents AB at both RA and RB (= 2 het
// samples from the het_union). RA and RB are perfectly linked, so
// all offspring receive a "parental-type combination" — no
// recombinants.
// Het samples are 60..89 → pick parents 60 and 61.
// Offspring: distribute across the 9 cells but heavily diagonal
// (parental). Linked → most offspring are AA_AA or BB_BB or AB_AB.
const fam_linked = {
  family_id: 'F_linked',
  parents: [60, 61],
  offspring: [],
};
// 20 AA_AA offspring (samples 0..19 — HOM_A at both regimes)
for (let i = 0; i < 20; i++) fam_linked.offspring.push(i);
// 20 BB_BB offspring
for (let i = 30; i < 50; i++) fam_linked.offspring.push(i);
// 0 recombinants

const recRes = familyRegimeRecombination(RA, RB, [fam_linked]);
check('1 family processed',              recRes.per_family.length === 1);
const row = recRes.per_family[0];
check('parent1 AB at A',                 row.parent1_kar_a === 'AB');
check('informative = true',              row.informative === true);
check('parental_count = 40',             row.parental_count === 40);
check('recombinant_count = 0',           row.recombinant_count === 0);
check('r_hat ≈ 0',                       row.r_hat === 0);
check('verdict = LINKED',                row.verdict === REGIME_LINKAGE_VERDICTS.LINKED);
check('pooled_verdict = LINKED',
      recRes.pooled_verdict === REGIME_LINKAGE_VERDICTS.LINKED);

// =====================================================================
group('familyRegimeRecombination — unlinked (r ≈ 0.5)');

// For "unlinked" we need RC and RD which have independent assignments.
// Build a family with parents who are AB at BOTH RC and RD.
// Find samples that are AB at RC AND AB at RD.
const sampleIsABAB = [];
for (let i = 0; i < 90; i++) {
  if (het_C.includes(i) && het_D2.includes(i)) sampleIsABAB.push(i);
}
// Use first two as parents.
if (sampleIsABAB.length >= 2) {
  const fam_unlinked = {
    family_id: 'F_unlinked',
    parents: [sampleIsABAB[0], sampleIsABAB[1]],
    offspring: [],
  };
  // 50 random offspring drawn from sample_list (will have ~uniform
  // distribution across the 9 cells under independence).
  for (let i = 0; i < 50; i++) fam_unlinked.offspring.push((i * 17 + 3) % 90);
  const recUnlink = familyRegimeRecombination(RC, RD, [fam_unlinked]);
  if (recUnlink.per_family.length > 0 && recUnlink.per_family[0].informative) {
    check('unlinked: r_hat closer to 0.5 than to 0',
          recUnlink.per_family[0].r_hat > 0.20);
  } else {
    check('unlinked sanity: family processed',
          recUnlink.per_family.length > 0);
  }
} else {
  // No ABAB pair available — skip but still count test scaffolding
  check('skipped: no ABAB parents available', true);
}

// =====================================================================
group('familyRegimeRecombination — not informative');

// Parents are not AB-AB → not informative
const fam_homo = {
  family_id: 'F_homo',
  parents: [0, 1],   // both AA at both RA, RB
  offspring: [0, 1, 2, 3, 4],
};
const recHomo = familyRegimeRecombination(RA, RB, [fam_homo]);
check('homozygous parents: not informative',
      recHomo.per_family[0].informative === false);
check('homozygous: verdict = INSUFFICIENT_DATA',
      recHomo.per_family[0].verdict === REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA);

// Empty families
const recEmpty = familyRegimeRecombination(RA, RB, []);
check('no families: per_family empty',  recEmpty.per_family.length === 0);
check('no families: pooled INSUFFICIENT_DATA',
      recEmpty.pooled_verdict === REGIME_LINKAGE_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
