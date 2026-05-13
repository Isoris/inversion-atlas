// tests/test_shared_band_tracking_karyotype_model.js
//
// Unit coverage for shared/band_tracking/karyotype_model.js — Layer 1f.

import {
  KARYOTYPE_MODEL_VERDICTS,
  KT_AGREEMENT_FLAGS,
  KT_DEFAULTS,
  kt_combine_trajectory_and_projection_evidence,
  kt_infer_macro_band_groups,
  kt_resolve_karyotype_model,
} from '../atlases/inversion/shared/band_tracking/karyotype_model.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('VERDICTS frozen',                Object.isFrozen(KARYOTYPE_MODEL_VERDICTS));
check('AGREEMENT_FLAGS frozen',         Object.isFrozen(KT_AGREEMENT_FLAGS));
check('DEFAULTS frozen',                Object.isFrozen(KT_DEFAULTS));
check('BIALLELIC verdict',              KARYOTYPE_MODEL_VERDICTS.BIALLELIC === 'BIALLELIC');
check('MULTI_ALLELIC verdict',          KARYOTYPE_MODEL_VERDICTS.MULTI_ALLELIC === 'MULTI_ALLELIC');
check('COMPLEX verdict',                KARYOTYPE_MODEL_VERDICTS.COMPLEX === 'COMPLEX');
check('AMBIGUOUS verdict',              KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS === 'AMBIGUOUS');
check('min_bands default = 3',          KT_DEFAULTS.min_bands === 3);

// =====================================================================
group('kt_combine_trajectory_and_projection_evidence');

// 4 bands, all 3 streams agree → ALL_AGREE for each row.
const combined1 = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1', 'b2', 'b3'],
  trajectoryGroupOf:     [0, 0, 1, 1],
  trajectorySignOf:      [1, 1, 1, 1],
  projectionClassOf:     ['SINGLE', 'SINGLE', 'SINGLE', 'SINGLE'],
  voteConsensusClassOf:  ['STABLE', 'STABLE', 'STABLE', 'STABLE'],
});
check('4 combined rows',                combined1.length === 4);
check('first row band_id',              combined1[0].band_id === 'b0');
check('all rows ALL_AGREE',
      combined1.every(r => r.agreement === KT_AGREEMENT_FLAGS.ALL_AGREE));

// Mixed: traj present but projection is SPLIT → only traj_vote_agree
const combinedMix = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1'],
  trajectoryGroupOf:     [0, 0],
  trajectorySignOf:      [1, 1],
  projectionClassOf:     ['SPLIT', 'SPLIT'],
  voteConsensusClassOf:  ['STABLE', 'STABLE'],
});
check('SPLIT projection → TRAJ_VOTE_AGREE',
      combinedMix[0].agreement === KT_AGREEMENT_FLAGS.TRAJ_VOTE_AGREE);

// Projection EMPTY + vote CONFLICT → DISAGREE (only traj is populated)
const combinedDis = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0'],
  trajectoryGroupOf:     [0],
  trajectorySignOf:      [1],
  projectionClassOf:     ['EMPTY'],
  voteConsensusClassOf:  ['CONFLICT'],
});
check('EMPTY proj + CONFLICT vote → DISAGREE',
      combinedDis[0].agreement === KT_AGREEMENT_FLAGS.DISAGREE);

// No evidence at all → INSUFFICIENT
const combinedNone = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0'],
  trajectoryGroupOf:     [null],
  trajectorySignOf:      [1],
  projectionClassOf:     [null],
  voteConsensusClassOf:  [null],
});
check('all-null → INSUFFICIENT',
      combinedNone[0].agreement === KT_AGREEMENT_FLAGS.INSUFFICIENT);

// trajectory_sign defaults to +1 when not -1
const combinedSign = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1'],
  trajectoryGroupOf:     [0, 0],
  trajectorySignOf:      [undefined, -1],
  projectionClassOf:     ['SINGLE', 'SINGLE'],
  voteConsensusClassOf:  ['STABLE', 'STABLE'],
});
check('sign defaults to +1',            combinedSign[0].trajectory_sign === 1);
check('sign = -1 preserved',            combinedSign[1].trajectory_sign === -1);

// =====================================================================
group('kt_infer_macro_band_groups');

// 4 bands, 2 trajectory groups (0, 1), all same sign → 2 macro groups
const macro1 = kt_infer_macro_band_groups(combined1);
check('2 macro groups (no sign split)', macro1.n_groups === 2);
check('macro_group_of length 4',        macro1.macro_group_of.length === 4);
check('bands 0/1 same macro',           macro1.macro_group_of[0] === macro1.macro_group_of[1]);
check('bands 2/3 same macro',           macro1.macro_group_of[2] === macro1.macro_group_of[3]);
check('bands 0/2 different macro',      macro1.macro_group_of[0] !== macro1.macro_group_of[2]);
check('group_meta has 2 entries',       macro1.group_meta.length === 2);
check('group_meta n_bands sums to 4',
      macro1.group_meta.reduce((s, g) => s + g.n_bands, 0) === 4);

// Sign split: trajectory group 0 has 2 positive + 2 negative bands →
// splits into 2 macro groups via sign.
const combinedSplit = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1', 'b2', 'b3'],
  trajectoryGroupOf:     [0, 0, 0, 0],
  trajectorySignOf:      [1, 1, -1, -1],
  projectionClassOf:     ['SINGLE', 'SINGLE', 'SINGLE', 'SINGLE'],
  voteConsensusClassOf:  ['STABLE', 'STABLE', 'STABLE', 'STABLE'],
});
const macroSplit = kt_infer_macro_band_groups(combinedSplit,
  { max_sign_split_frac: 0.20 });
check('sign-split: 2 macro groups',     macroSplit.n_groups === 2);
check('positives in one macro',
      macroSplit.macro_group_of[0] === macroSplit.macro_group_of[1]);
check('negatives in other macro',
      macroSplit.macro_group_of[2] === macroSplit.macro_group_of[3]);

// max_sign_split_frac higher than minor-fraction → no split
const macroNoSplit = kt_infer_macro_band_groups(combinedSplit,
  { max_sign_split_frac: 0.99 });
check('high split-threshold → single macro',
      macroNoSplit.n_groups === 1);

// Bands with null trajectory_group → excluded from macros
const combinedExcl = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1'],
  trajectoryGroupOf:     [0, null],
  trajectorySignOf:      [1, 1],
  projectionClassOf:     ['SINGLE', 'SINGLE'],
  voteConsensusClassOf:  ['STABLE', 'STABLE'],
});
const macroExcl = kt_infer_macro_band_groups(combinedExcl);
check('null traj_group excluded',
      macroExcl.macro_group_of[1] === -1);
check('still 1 macro group',            macroExcl.n_groups === 1);

// Empty input
const macroEmpty = kt_infer_macro_band_groups([]);
check('empty → 0 groups',               macroEmpty.n_groups === 0);

// =====================================================================
group('kt_resolve_karyotype_model — BIALLELIC');

const ivBiallelic = {
  n_std_std: 30, n_het: 50, n_inv_inv: 20,
  n_ambiguous: 0, n_uncalled: 0,
};
const verBi = kt_resolve_karyotype_model({
  combinedRows: combined1,
  macroGroups: macro1,
  ivCallSummary: ivBiallelic,
});
check('all-agree + 2 macros + 3 IV classes → BIALLELIC',
      verBi.verdict === KARYOTYPE_MODEL_VERDICTS.BIALLELIC);
check('agreement_frac = 1',             verBi.agreement_frac === 1);
check('reasons populated',              verBi.reasons.length > 0);

// =====================================================================
group('kt_resolve_karyotype_model — MULTI_ALLELIC');

// 4 bands in 4 distinct macro groups
const combined4 = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1', 'b2', 'b3'],
  trajectoryGroupOf:     [0, 1, 2, 3],
  trajectorySignOf:      [1, 1, 1, 1],
  projectionClassOf:     ['SINGLE', 'SINGLE', 'SINGLE', 'SINGLE'],
  voteConsensusClassOf:  ['STABLE', 'STABLE', 'STABLE', 'STABLE'],
});
const macro4 = kt_infer_macro_band_groups(combined4);
check('4 trajectory groups → 4 macros', macro4.n_groups === 4);
const verMulti = kt_resolve_karyotype_model({
  combinedRows: combined4,
  macroGroups: macro4,
  ivCallSummary: ivBiallelic,
});
check('>2 macro groups → MULTI_ALLELIC',
      verMulti.verdict === KARYOTYPE_MODEL_VERDICTS.MULTI_ALLELIC);

// =====================================================================
group('kt_resolve_karyotype_model — COMPLEX (high disagreement)');

// 4 bands all DISAGREE → high disagree fraction
const combinedAllDis = kt_combine_trajectory_and_projection_evidence({
  bandIds:               ['b0', 'b1', 'b2', 'b3'],
  trajectoryGroupOf:     [0, 0, 1, 1],
  trajectorySignOf:      [1, 1, 1, 1],
  projectionClassOf:     ['EMPTY', 'EMPTY', 'EMPTY', 'EMPTY'],
  voteConsensusClassOf:  ['CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT'],
});
check('all rows DISAGREE',
      combinedAllDis.every(r => r.agreement === KT_AGREEMENT_FLAGS.DISAGREE));
const macroDis = kt_infer_macro_band_groups(combinedAllDis);
const verCx = kt_resolve_karyotype_model({
  combinedRows: combinedAllDis,
  macroGroups: macroDis,
  ivCallSummary: ivBiallelic,
}, { min_agreement_frac: 0.66 });
check('all DISAGREE → COMPLEX',
      verCx.verdict === KARYOTYPE_MODEL_VERDICTS.COMPLEX);

// =====================================================================
group('kt_resolve_karyotype_model — AMBIGUOUS paths');

// Too few bands
const combined2 = kt_combine_trajectory_and_projection_evidence({
  bandIds: ['b0', 'b1'],
  trajectoryGroupOf: [0, 0],
  trajectorySignOf: [1, 1],
  projectionClassOf: ['SINGLE', 'SINGLE'],
  voteConsensusClassOf: ['STABLE', 'STABLE'],
});
const macro2 = kt_infer_macro_band_groups(combined2);
const verShort = kt_resolve_karyotype_model({
  combinedRows: combined2,
  macroGroups: macro2,
  ivCallSummary: ivBiallelic,
});
check('< min_bands → AMBIGUOUS',
      verShort.verdict === KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS);
check('reason: too_few_bands',
      verShort.reasons.indexOf('too_few_bands') >= 0);

// No IV summary
const verNoIv = kt_resolve_karyotype_model({
  combinedRows: combined1,
  macroGroups: macro1,
  ivCallSummary: null,
});
check('no IV summary → AMBIGUOUS',
      verNoIv.verdict === KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS);
check('reason: no_iv_summary',
      verNoIv.reasons.indexOf('no_iv_summary') >= 0);

// IV summary with only one class populated → AMBIGUOUS
const ivSparse = {
  n_std_std: 100, n_het: 0, n_inv_inv: 0, n_ambiguous: 0, n_uncalled: 0,
};
const verSparse = kt_resolve_karyotype_model({
  combinedRows: combined1,
  macroGroups: macro1,
  ivCallSummary: ivSparse,
});
check('sparse IV → AMBIGUOUS',
      verSparse.verdict === KARYOTYPE_MODEL_VERDICTS.AMBIGUOUS);
check('reason: iv_classes_too_sparse',
      verSparse.reasons.indexOf('iv_classes_too_sparse') >= 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
