// tests/test_shared_band_tracking_regime_dyad_mendelian.js
//
// Unit coverage for shared/band_tracking/regime_dyad_mendelian.js —
// Layer 4d (dyad-aware annotation + meiotic-drive classification).

import {
  MEIOTIC_DRIVE_VERDICTS,
  MEIOTIC_DRIVE_DEFAULTS,
  estimateAlleleFrequency,
  expectedDyadPMF,
  assessDyadConsistency,
  estimateTransmissionRatio,
  classifyMeioticDrive,
  annotateRegimeWithDyads,
} from '../atlases/inversion/shared/band_tracking/regime_dyad_mendelian.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('verdicts frozen',                Object.isFrozen(MEIOTIC_DRIVE_VERDICTS));
check('defaults frozen',                Object.isFrozen(MEIOTIC_DRIVE_DEFAULTS));
check('MENDELIAN verdict',              MEIOTIC_DRIVE_VERDICTS.MENDELIAN === 'mendelian');
check('mendelian_band = [0.45, 0.55]',
      MEIOTIC_DRIVE_DEFAULTS.mendelian_band[0] === 0.45
      && MEIOTIC_DRIVE_DEFAULTS.mendelian_band[1] === 0.55);

// =====================================================================
// Fixture regime: 50 AA + 50 AB + 50 BB = 150 samples
//   p_A = (2*50 + 50) / (2*150) = 150/300 = 0.5
// =====================================================================
function mkAASet(start, n) { const s = new Set(); for (let i = 0; i < n; i++) s.add(start + i); return s; }
const regime = {
  regime_id: 0,
  hom_a_intersect: mkAASet(0, 50),
  hom_b_intersect: mkAASet(50, 50),
  het_union:       mkAASet(100, 50),
};

// =====================================================================
group('estimateAlleleFrequency');

const af = estimateAlleleFrequency(regime);
check('n_total = 150',                  af.n_total === 150);
check('n_AA = 50',                       af.n_AA === 50);
check('n_AB = 50',                       af.n_AB === 50);
check('n_BB = 50',                       af.n_BB === 50);
check('p_A = 0.5',                       approx(af.p_A, 0.5));
check('p_B = 0.5',                       approx(af.p_B, 0.5));

// Skewed regime: 80 AA + 20 BB → p_A = 0.8
const regimeSkew = {
  regime_id: 1,
  hom_a_intersect: mkAASet(0, 80),
  hom_b_intersect: mkAASet(80, 20),
  het_union:       new Set(),
};
const afS = estimateAlleleFrequency(regimeSkew);
check('skewed: p_A = 0.8',               approx(afS.p_A, 0.8));

check('null regime → NaN p_A',
      Number.isNaN(estimateAlleleFrequency(null).p_A));

// =====================================================================
group('expectedDyadPMF');

const pmfAA = expectedDyadPMF('AA', 0.5);
check('AA parent: P(AA) = 0.5',         approx(pmfAA.AA, 0.5));
check('AA parent: P(AB) = 0.5',         approx(pmfAA.AB, 0.5));
check('AA parent: P(BB) = 0',           pmfAA.BB === 0);

const pmfAB = expectedDyadPMF('AB', 0.5);
check('AB parent: P(AA) = 0.25',        approx(pmfAB.AA, 0.25));
check('AB parent: P(AB) = 0.5',         approx(pmfAB.AB, 0.5));
check('AB parent: P(BB) = 0.25',        approx(pmfAB.BB, 0.25));

const pmfBB = expectedDyadPMF('BB', 0.5);
check('BB parent: P(AA) = 0',           pmfBB.AA === 0);
check('BB parent: P(BB) = 0.5',         approx(pmfBB.BB, 0.5));

// Skewed p
const pmfAA_skew = expectedDyadPMF('AA', 0.8);
check('AA parent + p_A=0.8: P(AA) = 0.8',  approx(pmfAA_skew.AA, 0.8));
check('AA parent + p_A=0.8: P(AB) = 0.2',  approx(pmfAA_skew.AB, 0.2));

check('invalid p_A → null',
      expectedDyadPMF('AA', -0.1) === null
      && expectedDyadPMF('AA', NaN) === null);
check('unknown parent_kar → null',       expectedDyadPMF('XX', 0.5) === null);

// =====================================================================
group('assessDyadConsistency');

// AA parent + AA offspring + p_A=0.5 → possible, log P = log 0.5
const c1 = assessDyadConsistency('AA', 'AA', 0.5);
check('AA × AA: possible',              c1.is_impossible === false);
check('AA × AA: log_likelihood = ln 0.5',
      approx(c1.log_likelihood, Math.log(0.5)));

// AA parent + BB offspring → IMPOSSIBLE
const c2 = assessDyadConsistency('AA', 'BB', 0.5);
check('AA × BB: impossible',            c2.is_impossible === true);
check('AA × BB: log_likelihood = -Inf', c2.log_likelihood === -Infinity);

// AB parent + AB offspring → possible (most likely outcome)
const c3 = assessDyadConsistency('AB', 'AB', 0.5);
check('AB × AB: possible',              c3.is_impossible === false);

// Invalid p_A → null
check('invalid p_A → null',             assessDyadConsistency('AA', 'AA', NaN) === null);
// Missing parent_kar → null
check('null parent_kar → null',         assessDyadConsistency(null, 'AA', 0.5) === null);

// =====================================================================
group('estimateTransmissionRatio — Mendelian AB parents');

// 100 dyads, parent is sample 100 (HET / AB), offspring distribute:
//   50 → AA (parent transmitted A)
//   50 → BB (parent transmitted B)
// → transmission ratio = 0.5
const dyads_mend = [];
for (let i = 0; i < 50; i++) {
  dyads_mend.push({ parent: 100, offspring: i });             // AA offspring (samples 0..49)
}
for (let i = 0; i < 50; i++) {
  dyads_mend.push({ parent: 100, offspring: 50 + i });        // BB offspring (samples 50..99)
}
const tr_mend = estimateTransmissionRatio(regime, dyads_mend);
check('n_AB_parent_dyads = 100',         tr_mend.n_AB_parent_dyads === 100);
check('n_A_transmitted = 50',            tr_mend.n_A_transmitted === 50);
check('n_B_transmitted = 50',            tr_mend.n_B_transmitted === 50);
check('transmission ratio = 0.5',        tr_mend.transmission_ratio_A === 0.5);
check('binomial p_value = 1 (perfect Mendelian)',
      approx(tr_mend.binomial_p_value, 1, 1e-9));

// =====================================================================
group('estimateTransmissionRatio — strong drive');

// 100 dyads, all from AB parent, 80 → AA, 20 → BB → ratio 0.8.
// Re-use AA / BB sample indices since only the offspring's karyotype
// matters (each dyad is an independent observation).
const dyads_drive = [];
for (let i = 0; i < 80; i++) dyads_drive.push({ parent: 100, offspring: i % 50 });        // AA
for (let i = 0; i < 20; i++) dyads_drive.push({ parent: 100, offspring: 50 + (i % 50) }); // BB
const tr_drive = estimateTransmissionRatio(regime, dyads_drive);
check('drive: ratio = 0.8',              tr_drive.transmission_ratio_A === 0.8);
check('drive: p_value tiny',             tr_drive.binomial_p_value < 1e-6);

// =====================================================================
group('estimateTransmissionRatio — ambiguous AB offspring');

const dyads_amb = [];
for (let i = 0; i < 50; i++) dyads_amb.push({ parent: 100, offspring: 100 + i });
const tr_amb = estimateTransmissionRatio(regime, dyads_amb);
check('AB offspring → ambiguous',        tr_amb.n_ambiguous === 50);
check('ambiguous: ratio = NaN',          Number.isNaN(tr_amb.transmission_ratio_A));

// Non-AB parent dyads filtered
const dyads_aa = [{ parent: 0, offspring: 1 }];   // parent 0 is AA, not AB
const tr_aa = estimateTransmissionRatio(regime, dyads_aa);
check('non-AB parent filtered',          tr_aa.n_AB_parent_dyads === 0);

// =====================================================================
group('classifyMeioticDrive');

check('ratio 0.50 → MENDELIAN',
      classifyMeioticDrive({ transmission_ratio_A: 0.50, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.MENDELIAN);
check('ratio 0.55 → MENDELIAN (edge of band)',
      classifyMeioticDrive({ transmission_ratio_A: 0.55, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.MENDELIAN);
check('ratio 0.60 → MILD_DRIVE',
      classifyMeioticDrive({ transmission_ratio_A: 0.60, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.MILD_DRIVE);
check('ratio 0.80 → STRONG_DRIVE',
      classifyMeioticDrive({ transmission_ratio_A: 0.80, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.STRONG_DRIVE);
check('ratio 0.95 → INVIABILITY',
      classifyMeioticDrive({ transmission_ratio_A: 0.95, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.INVIABILITY);
check('ratio 0.05 → INVIABILITY (symmetric)',
      classifyMeioticDrive({ transmission_ratio_A: 0.05, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.INVIABILITY);

// drive_direction sign
check('ratio 0.60 → drive_direction A',
      classifyMeioticDrive({ transmission_ratio_A: 0.60, n_informative_transmissions: 100 })
        .drive_direction === 'A');
check('ratio 0.40 → drive_direction B',
      classifyMeioticDrive({ transmission_ratio_A: 0.40, n_informative_transmissions: 100 })
        .drive_direction === 'B');

// Insufficient data
check('< min_dyads → INSUFFICIENT_DATA',
      classifyMeioticDrive({ transmission_ratio_A: 0.50, n_informative_transmissions: 3 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.INSUFFICIENT_DATA);
check('NaN ratio → INSUFFICIENT_DATA',
      classifyMeioticDrive({ transmission_ratio_A: NaN, n_informative_transmissions: 100 }).verdict
        === MEIOTIC_DRIVE_VERDICTS.INSUFFICIENT_DATA);
check('null → INSUFFICIENT_DATA',
      classifyMeioticDrive(null).verdict
        === MEIOTIC_DRIVE_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
group('annotateRegimeWithDyads — orchestrator');

const ann = annotateRegimeWithDyads(regime, dyads_mend);
check('method = 4d_dyad',                ann.method === '4d_dyad');
check('allele_freq populated',           ann.allele_freq && ann.allele_freq.p_A === 0.5);
check('n_dyads = 100',                   ann.n_dyads === 100);
check('n_informative = 100',             ann.n_informative === 100);
check('n_impossible = 0',                ann.n_impossible === 0);
check('transmission populated',           ann.transmission.n_AB_parent_dyads === 100);
check('meiotic_drive verdict = MENDELIAN',
      ann.meiotic_drive.verdict === MEIOTIC_DRIVE_VERDICTS.MENDELIAN);

// Strong drive
const annDrive = annotateRegimeWithDyads(regime, dyads_drive);
check('drive: verdict = STRONG_DRIVE',
      annDrive.meiotic_drive.verdict === MEIOTIC_DRIVE_VERDICTS.STRONG_DRIVE);

// Impossible dyad: AA parent → BB offspring
const dyads_imp = [{ parent: 0, offspring: 50 }];   // sample 0 is AA, sample 50 is BB
const annImp = annotateRegimeWithDyads(regime, dyads_imp);
check('impossible dyad detected',        annImp.n_impossible === 1);

// Uncalled dyad (offspring uncalled)
const dyads_un = [{ parent: 0, offspring: 9999 }];
const annUn = annotateRegimeWithDyads(regime, dyads_un);
check('uncalled offspring: not informative', annUn.n_informative === 0);

// Empty dyads
const annE = annotateRegimeWithDyads(regime, []);
check('empty dyads: meiotic_drive INSUFFICIENT_DATA',
      annE.meiotic_drive.verdict === MEIOTIC_DRIVE_VERDICTS.INSUFFICIENT_DATA);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
