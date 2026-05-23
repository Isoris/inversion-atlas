// tests/test_shared_band_tracking_auto_calibrate.js
//
// Unit coverage for the auto_calibrate wiring on:
//   regimeLinkageMatrix (Layer 4c)
//   inferRelatednessFromRegimes (Layer 4b)
//   annotateRegimesWithDyadsAuto (Layer 4d, new orchestrator)

import {
  regimeLinkageMatrix,
} from '../atlases/popstats/shared/band_tracking/regime_linkage.js';
import {
  inferRelatednessFromRegimes,
} from '../atlases/popstats/shared/band_tracking/regime_pedigree.js';
import {
  annotateRegimesWithDyadsAuto,
  MEIOTIC_DRIVE_VERDICTS,
} from '../atlases/popstats/shared/band_tracking/regime_dyad_mendelian.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Shared fixture builder
// =====================================================================
function mkRegime(id, chrom, homA, homB, het) {
  return {
    regime_id: id, regime_uid: chrom + ':' + id, chrom,
    hom_a_intersect: new Set(homA),
    hom_b_intersect: new Set(homB),
    het_union:       new Set(het),
    start_bp: 0, end_bp: 1e6, n_intervals: 1,
  };
}

// 12 regimes (6 on chr1, 6 on chr2). Cross-chrom pairs = 36 → enough
// to calibrate. Within-chrom regimes share assignments; cross-chrom
// regimes have permuted assignments.
const regimes_link = [];
for (let r = 0; r < 6; r++) {
  const a = [], b = [], h = [];
  for (let i = 0; i < 60; i++) {
    if (i < 20) a.push(i); else if (i < 40) h.push(i); else b.push(i);
  }
  regimes_link.push(mkRegime(r, 'chr1', a, b, h));
}
for (let r = 6; r < 12; r++) {
  const a = [], b = [], h = [];
  for (let i = 0; i < 60; i++) {
    const code = ((i * 7 + (r - 6) * 13) % 60) % 3;
    if (code === 0) a.push(i);
    else if (code === 1) h.push(i);
    else b.push(i);
  }
  regimes_link.push(mkRegime(r, 'chr2', a, b, h));
}
const sample_list = Array.from({ length: 60 }, (_, i) => i);

// =====================================================================
group('regimeLinkageMatrix — auto_calibrate path');

const result_default = regimeLinkageMatrix(regimes_link, sample_list);
check('default: calibration field = null',
      result_default.calibration === null);

const result_auto = regimeLinkageMatrix(regimes_link, sample_list,
  { auto_calibrate: true });
check('auto_calibrate: calibration populated',
      result_auto.calibration !== null);
check('auto_calibrate: calibration.ok = true',
      result_auto.calibration.ok === true);
check('auto: linked_above derived from cross-chrom V',
      Number.isFinite(result_auto.calibration.linked_above));
check('auto: weakly_linked_above <= linked_above',
      result_auto.calibration.weakly_linked_above
        <= result_auto.calibration.linked_above);

// Auto with insufficient data → calibration records failure but
// matrix still produced with default thresholds
const result_short = regimeLinkageMatrix(
  [regimes_link[0], regimes_link[6]],   // only 1 cross-chrom pair
  sample_list, { auto_calibrate: true });
check('insufficient: calibration.ok = false',
      result_short.calibration && result_short.calibration.ok === false);
check('insufficient: matrix still produced',
      result_short.cramers_v_matrix.length === 4);

// =====================================================================
group('inferRelatednessFromRegimes — auto_calibrate path');

// Build regimes where samples 0..9 form a clear first-degree cluster
// (all HOM_A across many regimes), samples 100..109 are unrelated.
const regimes_ped = [];
for (let r = 0; r < 20; r++) {
  const a = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const b = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const h = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  for (let i = 100; i < 110; i++) {
    const code = ((i * 7 + r * 13) % 60) % 3;
    if (code === 0) a.push(i);
    else if (code === 1) h.push(i);
    else b.push(i);
  }
  regimes_ped.push({
    regime_id: r,
    hom_a_intersect: new Set(a),
    hom_b_intersect: new Set(b),
    het_union:       new Set(h),
  });
}

const known_pairs = [
  { sample_a: 0, sample_b: 1, relationship_class: '1st_degree' },
  { sample_a: 2, sample_b: 3, relationship_class: '1st_degree' },
  { sample_a: 4, sample_b: 5, relationship_class: '1st_degree' },
  { sample_a: 6, sample_b: 7, relationship_class: '1st_degree' },
  { sample_a: 8, sample_b: 9, relationship_class: '1st_degree' },
  { sample_a: 100, sample_b: 101, relationship_class: 'unrelated' },
  { sample_a: 102, sample_b: 103, relationship_class: 'unrelated' },
  { sample_a: 104, sample_b: 105, relationship_class: 'unrelated' },
  { sample_a: 106, sample_b: 107, relationship_class: 'unrelated' },
  { sample_a: 108, sample_b: 109, relationship_class: 'unrelated' },
];

const sample_list_ped = [0, 2, 4, 100, 102, 104];

const inferred_default = inferRelatednessFromRegimes(
  sample_list_ped, regimes_ped);
check('default: calibration null',
      inferred_default.calibration === null);

const inferred_auto = inferRelatednessFromRegimes(
  sample_list_ped, regimes_ped,
  { auto_calibrate: true, known_pairs });
check('auto: calibration populated',
      inferred_auto.calibration !== null
      && inferred_auto.calibration.ok === true);
check('auto: thresholds derived from known pairs',
      Number.isFinite(inferred_auto.calibration.first_degree_above));

// No known_pairs → calibration not attempted
const inferred_no_known = inferRelatednessFromRegimes(
  sample_list_ped, regimes_ped, { auto_calibrate: true });
check('no known_pairs: calibration null',
      inferred_no_known.calibration === null);

// =====================================================================
group('annotateRegimesWithDyadsAuto — orchestrator');

// 30 regimes; mostly-Mendelian transmission (ratio ~0.5) with a few
// drivers.
const regimes_dy = [];
for (let r = 0; r < 30; r++) {
  // All regimes share the same HOM_A / HOM_B / HET sets.
  regimes_dy.push({
    regime_id: r,
    hom_a_intersect: new Set([0, 1, 2, 3, 4]),
    hom_b_intersect: new Set([5, 6, 7, 8, 9]),
    het_union:       new Set([10, 11, 12, 13, 14]),
  });
}
// 100 dyads, AB parent (sample 10), ~50/50 offspring (samples 0..9)
const dyads = [];
for (let i = 0; i < 50; i++) dyads.push({ parent: 10, offspring: i % 5 });        // AA
for (let i = 0; i < 50; i++) dyads.push({ parent: 10, offspring: 5 + (i % 5) });  // BB

const r_default = annotateRegimesWithDyadsAuto(regimes_dy, dyads);
check('default mode: used_defaults = true',
      r_default.used_defaults === true);
check('default mode: calibration null',  r_default.calibration === null);
check('per_regime length = 30',           r_default.per_regime.length === 30);

const r_auto = annotateRegimesWithDyadsAuto(regimes_dy, dyads,
  { auto_calibrate: true });
check('auto: used_defaults = false',     r_auto.used_defaults === false);
check('auto: calibration.ok = true',     r_auto.calibration.ok === true);
check('auto: n_regimes_used = 30',
      r_auto.calibration.n_regimes_used === 30);
// All regimes Mendelian under both default and calibrated bands
check('auto: every regime → MENDELIAN',
      r_auto.per_regime.every(p =>
        p.meiotic_drive.verdict === MEIOTIC_DRIVE_VERDICTS.MENDELIAN));

// Auto with too few regimes → calibration fails, used_defaults = true
const r_short = annotateRegimesWithDyadsAuto(
  regimes_dy.slice(0, 3), dyads, { auto_calibrate: true });
check('insufficient regimes: used_defaults = true',
      r_short.used_defaults === true);
check('insufficient: calibration.ok = false',
      r_short.calibration && r_short.calibration.ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
