// tests/test_shared_recombination_suppression.js
//
// Unit coverage for shared/recombination_suppression.js — the 5-state
// per-candidate suppression classifier. Inputs: long-range haplotype
// regime linkage + Mendelian inheritance + karyotype distribution.

import {
  RECOMBINATION_SUPPRESSION,
  RECOMBINATION_SUPPRESSION_DEFAULTS,
  heterokaryotypeFraction,
  mendelianCleanFraction,
  classifyRecombinationSuppression,
  summarizeRegimeLinkageMatrix,
} from '../atlases/inversion/shared/recombination_suppression.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('5-state vocab frozen',       Object.isFrozen(RECOMBINATION_SUPPRESSION));
check('defaults frozen',            Object.isFrozen(RECOMBINATION_SUPPRESSION_DEFAULTS));
check('v_strong = 0.50',            RECOMBINATION_SUPPRESSION_DEFAULTS.v_strong === 0.50);
check('v_eroded_below = 0.20',      RECOMBINATION_SUPPRESSION_DEFAULTS.v_eroded_below === 0.20);
check('clean fraction = 0.80',      RECOMBINATION_SUPPRESSION_DEFAULTS.mendelian_clean_fraction === 0.80);
check('min_het_fraction = 0.10',    RECOMBINATION_SUPPRESSION_DEFAULTS.min_het_fraction === 0.10);
check('STRONG/PARTIAL/ERODED labels',
      RECOMBINATION_SUPPRESSION.STRONG === 'strong'
   && RECOMBINATION_SUPPRESSION.PARTIAL === 'partial'
   && RECOMBINATION_SUPPRESSION.ERODED === 'eroded');
check('NO_SUPPRESSION_HOMOZYGOUS label',
      RECOMBINATION_SUPPRESSION.NO_SUPPRESSION_HOMOZYGOUS === 'no_suppression_homozygous');

// =====================================================================
group('heterokaryotypeFraction');

check('AA=80 AB=40 BB=20 → 40/140',
      Math.abs(heterokaryotypeFraction({n_AA:80, n_AB:40, n_BB:20}) - 40/140) < 1e-9);
check('all AA → 0',                 heterokaryotypeFraction({n_AA:100, n_AB:0, n_BB:0}) === 0);
check('all AB → 1',                 heterokaryotypeFraction({n_AA:0, n_AB:50, n_BB:0}) === 1);
check('empty cohort → NaN',         Number.isNaN(heterokaryotypeFraction({})));
check('null → NaN',                 Number.isNaN(heterokaryotypeFraction(null)));

// =====================================================================
group('mendelianCleanFraction');

check('10/12 → 10/12',
      Math.abs(mendelianCleanFraction({n_families:12, n_mendelian:10}) - 10/12) < 1e-9);
check('0 families → NaN',           Number.isNaN(mendelianCleanFraction({n_families:0})));
check('null → NaN',                 Number.isNaN(mendelianCleanFraction(null)));

// =====================================================================
group('classifyRecombinationSuppression — STRONG');

// max_v = 0.85 (≥ 0.50), clean Mendelian = 10/10, plenty of HET → strong
check('high V + all-Mendelian + sufficient HET → strong',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.85, n_pairs: 3 },
        mendelian_summary:      { n_families: 10, n_mendelian: 10 },
        karyotype_distribution: { n_AA: 50, n_AB: 50, n_BB: 50 },
      }) === RECOMBINATION_SUPPRESSION.STRONG);

// high V, no Mendelian data, sufficient HET → strong (Mendelian missing OK)
check('high V + no Mendelian + HET → strong',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.70 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.STRONG);

// =====================================================================
group('classifyRecombinationSuppression — PARTIAL');

// high V but Mendelian shows recombinants (clean fraction 5/10 = 0.50,
// below 0.80) → partial (LD is intact but recombinants slip through)
check('high V + many recombinants → partial',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.70 },
        mendelian_summary:      { n_families: 10, n_mendelian: 5, n_distorted: 5 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.PARTIAL);

// intermediate V (between 0.20 and 0.50) → partial
check('mid V (0.35) → partial',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.35 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.PARTIAL);

// Mendelian data only — clean → partial (no LD evidence to upgrade)
check('Mendelian-only clean → partial',
      classifyRecombinationSuppression({
        mendelian_summary:      { n_families: 10, n_mendelian: 9 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.PARTIAL);

// =====================================================================
group('classifyRecombinationSuppression — ERODED');

// low V (below 0.20) with the inversion still polymorphic → eroded
check('low V + polymorphic → eroded',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.10 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.ERODED);

// =====================================================================
group('classifyRecombinationSuppression — NO_SUPPRESSION_HOMOZYGOUS');

// almost all samples are HOM → no heterokaryotype substrate
check('all-HOM cohort → no_suppression_homozygous',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.90 },   // doesn't matter
        karyotype_distribution: { n_AA: 200, n_AB: 0, n_BB: 0 },
      }) === RECOMBINATION_SUPPRESSION.NO_SUPPRESSION_HOMOZYGOUS);

// het fraction = 5% < 10% default → no_suppression
check('het fraction 5% < min → no_suppression_homozygous',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.80 },
        karyotype_distribution: { n_AA: 95, n_AB: 5, n_BB: 0 },
      }) === RECOMBINATION_SUPPRESSION.NO_SUPPRESSION_HOMOZYGOUS);

// =====================================================================
group('classifyRecombinationSuppression — NO_DATA');

check('all inputs missing → no_data',
      classifyRecombinationSuppression({}) === RECOMBINATION_SUPPRESSION.NO_DATA);

check('null args → no_data',
      classifyRecombinationSuppression(null) === RECOMBINATION_SUPPRESSION.NO_DATA);

// Insufficient family count (< min_n_families = 3) AND no other inputs → no_data
check('2 families only + no linkage / karyo → no_data',
      classifyRecombinationSuppression({
        mendelian_summary: { n_families: 2, n_mendelian: 2 },
      }) === RECOMBINATION_SUPPRESSION.NO_DATA);

// =====================================================================
group('classifyRecombinationSuppression — opts overrides');

// custom v_strong=0.70 — same fixture with max_v=0.65 used to be strong
// at default 0.50, now should be partial.
check('v_strong=0.70: max_v=0.65 → partial',
      classifyRecombinationSuppression({
        regime_linkage_summary: { max_v: 0.65 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }, { v_strong: 0.70 }) === RECOMBINATION_SUPPRESSION.PARTIAL);

// =====================================================================
group('summarizeRegimeLinkageMatrix');

const linkMatrix = {
  pairs: [
    { cramers_v: 0.85, verdict: 'linked' },
    { cramers_v: 0.72, verdict: 'linked' },
    { cramers_v: 0.30, verdict: 'weakly_linked' },
    { cramers_v: 0.10, verdict: 'independent' },
  ],
};
const sum = summarizeRegimeLinkageMatrix(linkMatrix);
check('summary: max_v = 0.85',      sum.max_v === 0.85);
check('summary: mean_v = ~0.493',   Math.abs(sum.mean_v - 0.4925) < 1e-3);
check('summary: n_pairs = 4',       sum.n_pairs === 4);
check('summary: n_linked = 2',      sum.n_linked === 2);
check('summary: n_weakly_linked = 1', sum.n_weakly_linked === 1);
check('summary: n_independent = 1', sum.n_independent === 1);

check('null matrix → null',         summarizeRegimeLinkageMatrix(null) === null);
check('empty pairs → null',         summarizeRegimeLinkageMatrix({ pairs: [] }) === null);

// =====================================================================
group('integration — summary → classifier round-trip');

const built = summarizeRegimeLinkageMatrix({
  pairs: [
    { cramers_v: 0.82, verdict: 'linked' },
    { cramers_v: 0.75, verdict: 'linked' },
  ],
});
check('round-trip: strong linkage detected',
      classifyRecombinationSuppression({
        regime_linkage_summary: built,
        mendelian_summary:      { n_families: 8, n_mendelian: 7 },
        karyotype_distribution: { n_AA: 30, n_AB: 30, n_BB: 30 },
      }) === RECOMBINATION_SUPPRESSION.STRONG);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
