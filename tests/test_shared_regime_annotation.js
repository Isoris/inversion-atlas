// tests/test_shared_regime_annotation.js
//
// Unit coverage for shared/regime_annotation/ — Layer 1 (positional)
// and Layer 2 (structure) of SPEC_regime_annotation_v34.md.

import {
  REGIME_POSITIONAL_LABELS,
  REGIME_POSITIONAL_DEFAULTS,
  annotateRegimePosition,
  annotateRegimePositions,
} from '../atlases/inversion/shared/regime_annotation/positional.js';
import {
  REGIME_STRUCTURE_LABELS,
  REGIME_STRUCTURE_DEFAULTS,
  annotateRegimeStructure,
  annotateRegimeStructures,
} from '../atlases/inversion/shared/regime_annotation/structure.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Chromosome fixture: 100 Mb chrom, centromere at 40-44 Mb
// =====================================================================
const chrom = {
  length_bp:           100_000_000,
  centromere_start_bp: 40_000_000,
  centromere_end_bp:   44_000_000,
};

// =====================================================================
group('vocab + defaults');

check('positional labels frozen',     Object.isFrozen(REGIME_POSITIONAL_LABELS));
check('positional defaults frozen',    Object.isFrozen(REGIME_POSITIONAL_DEFAULTS));
check('CENTROMERIC label',
      REGIME_POSITIONAL_LABELS.CENTROMERIC === 'centromeric');
check('pericentromeric_window_bp = 5 Mb',
      REGIME_POSITIONAL_DEFAULTS.pericentromeric_window_bp === 5_000_000);
check('subtelomeric_window_bp = 2 Mb',
      REGIME_POSITIONAL_DEFAULTS.subtelomeric_window_bp === 2_000_000);

check('structure labels frozen',       Object.isFrozen(REGIME_STRUCTURE_LABELS));
check('structure defaults frozen',     Object.isFrozen(REGIME_STRUCTURE_DEFAULTS));
check('SIMPLE_HAPLOTYPE_SPLIT label',
      REGIME_STRUCTURE_LABELS.SIMPLE_HAPLOTYPE_SPLIT === 'simple_haplotype_split');

// =====================================================================
group('annotateRegimePosition — centromeric');

// Regime at 41-43 Mb sits inside the centromere (40-44 Mb)
const r_cent = annotateRegimePosition({
  chrom: 'chr1', start_bp: 41_000_000, end_bp: 43_000_000,
}, chrom);
check('label = centromeric',           r_cent.label === REGIME_POSITIONAL_LABELS.CENTROMERIC);
check('overlaps_inferred_centromere',  r_cent.overlaps_inferred_centromere === true);
check('nearest_centromere_distance = 0', r_cent.nearest_centromere_distance_bp === 0);
check('length_bp = 2 Mb',              r_cent.length_bp === 2_000_000);

// =====================================================================
group('annotateRegimePosition — pericentromeric');

// Regime at 35-38 Mb sits 2 Mb LEFT of centromere → within 5 Mb window
const r_peri = annotateRegimePosition({
  chrom: 'chr1', start_bp: 35_000_000, end_bp: 38_000_000,
}, chrom);
check('label = pericentromeric',       r_peri.label === REGIME_POSITIONAL_LABELS.PERICENTROMERIC);
check('overlaps_pericentromeric_window', r_peri.overlaps_pericentromeric_window === true);
check('nearest_centromere_distance = 2 Mb',
      r_peri.nearest_centromere_distance_bp === 2_000_000);
check('not centromeric',               r_peri.overlaps_inferred_centromere === false);

// =====================================================================
group('annotateRegimePosition — subtelomeric');

// Regime at 0-1 Mb sits within 2 Mb of LEFT telomere
const r_sub = annotateRegimePosition({
  chrom: 'chr1', start_bp: 0, end_bp: 1_000_000,
}, chrom);
check('label = subtelomeric (left)',   r_sub.label === REGIME_POSITIONAL_LABELS.SUBTELOMERIC);
check('subtelomeric = true',           r_sub.subtelomeric === true);
check('distance_to_telomere_left = 0', r_sub.distance_to_telomere_left_bp === 0);

// Right-end subtelomeric
const r_sub_r = annotateRegimePosition({
  chrom: 'chr1', start_bp: 99_000_000, end_bp: 100_000_000,
}, chrom);
check('label = subtelomeric (right)',  r_sub_r.label === REGIME_POSITIONAL_LABELS.SUBTELOMERIC);
check('distance_to_telomere_right = 0', r_sub_r.distance_to_telomere_right_bp === 0);

// =====================================================================
group('annotateRegimePosition — arm-scale');

// p-arm length = 40 Mb; 30% of arm = 12 Mb. A 15 Mb regime on the p arm
// (10-25 Mb) is arm-scale. It's >5 Mb from centromere (at 40 Mb) →
// not pericentromeric. → arm-scale.
const r_arm = annotateRegimePosition({
  chrom: 'chr1', start_bp: 10_000_000, end_bp: 25_000_000,
}, chrom);
check('label = arm-scale',             r_arm.label === REGIME_POSITIONAL_LABELS.ARM_SCALE);
check('arm_scale = true',              r_arm.arm_scale === true);

// =====================================================================
group('annotateRegimePosition — interstitial');

// 5 Mb regime in the middle of the q-arm (60-65 Mb), no overlap, not subtelomeric
const r_int = annotateRegimePosition({
  chrom: 'chr1', start_bp: 60_000_000, end_bp: 65_000_000,
}, chrom);
check('label = interstitial',          r_int.label === REGIME_POSITIONAL_LABELS.INTERSTITIAL);

// =====================================================================
group('annotateRegimePosition — no centromere info');

const chromNoCent = { length_bp: 100_000_000 };
const r_nc = annotateRegimePosition({
  chrom: 'chr1', start_bp: 10_000_000, end_bp: 15_000_000,
}, chromNoCent);
check('no centromere: distance = null',
      r_nc.nearest_centromere_distance_bp === null);
check('no centromere: overlaps_inferred_centromere = false',
      r_nc.overlaps_inferred_centromere === false);
check('label still resolved',          typeof r_nc.label === 'string');

// =====================================================================
group('annotateRegimePosition — custom thresholds');

// Override pericentromeric window to 1 Mb → regime at 38 Mb (2 Mb gap)
// would NOT be pericentromeric.
const r_custom = annotateRegimePosition({
  chrom: 'chr1', start_bp: 35_000_000, end_bp: 38_000_000,
}, chrom, { pericentromeric_window_bp: 1_000_000 });
check('custom periWin=1Mb: not pericentromeric',
      r_custom.label !== REGIME_POSITIONAL_LABELS.PERICENTROMERIC);

// =====================================================================
group('annotateRegimePosition — null inputs');

check('null regime → null',            annotateRegimePosition(null, chrom) === null);
check('null chrom_meta → null',        annotateRegimePosition({ start_bp: 1, end_bp: 2 }, null) === null);
check('missing bp → null',
      annotateRegimePosition({ chrom: 'X' }, chrom) === null);

// =====================================================================
group('annotateRegimePositions — batch');

const regimes = [
  { regime_id: 0, chrom: 'chr1', start_bp: 41_000_000, end_bp: 43_000_000 },
  { regime_id: 1, chrom: 'chr1', start_bp: 60_000_000, end_bp: 65_000_000 },
];
const chromMap = { chr1: chrom };
const batch = annotateRegimePositions(regimes, chromMap);
check('batch returns 2 results',        batch.length === 2);
check('batch[0] = centromeric',
      batch[0].label === REGIME_POSITIONAL_LABELS.CENTROMERIC);
check('batch[1] = interstitial',
      batch[1].label === REGIME_POSITIONAL_LABELS.INTERSTITIAL);

// Map source instead of object
const chromMapMap = new Map([['chr1', chrom]]);
const batchMap = annotateRegimePositions(regimes, chromMapMap);
check('Map source works',               batchMap[0].label === REGIME_POSITIONAL_LABELS.CENTROMERIC);

// Empty / null
check('null regimes → []',              annotateRegimePositions(null, chromMap).length === 0);

// =====================================================================
group('annotateRegimeStructure — M=2 / 3 / 4');

const regime = { regime_id: 0, start_bp: 10_000_000, end_bp: 12_000_000 };

const s_2 = annotateRegimeStructure(regime, { consensus_partition_M: 2, band_count: 2 });
check('M=2 → simple_haplotype_split',
      s_2.label === REGIME_STRUCTURE_LABELS.SIMPLE_HAPLOTYPE_SPLIT);
check('regime_length_bp = 2 Mb',        s_2.regime_length_bp === 2_000_000);

const s_3 = annotateRegimeStructure(regime, { consensus_partition_M: 3, band_count: 3 });
check('M=3 → inversion_dosage_like',
      s_3.label === REGIME_STRUCTURE_LABELS.INVERSION_DOSAGE_LIKE);

const s_4 = annotateRegimeStructure(regime, { consensus_partition_M: 4 });
check('M=4 → nested_or_compound',       s_4.label === REGIME_STRUCTURE_LABELS.NESTED_OR_COMPOUND);

const s_6 = annotateRegimeStructure(regime, { consensus_partition_M: 6 });
check('M=6 → nested_or_compound',       s_6.label === REGIME_STRUCTURE_LABELS.NESTED_OR_COMPOUND);

// =====================================================================
group('annotateRegimeStructure — nested takes priority over M');

// internal_nesting overrides the M-based label
const s_nested = annotateRegimeStructure(regime,
  { consensus_partition_M: 2, internal_nesting: true });
check('internal_nesting → compound_inversion_like',
      s_nested.label === REGIME_STRUCTURE_LABELS.COMPOUND_INVERSION_LIKE);

// =====================================================================
group('annotateRegimeStructure — RANDOM_FAN → noise');

const s_noise = annotateRegimeStructure(regime,
  { consensus_partition_M: 2, consensus_class: 'RANDOM_FAN' });
check('RANDOM_FAN → noise_or_recombinant',
      s_noise.label === REGIME_STRUCTURE_LABELS.NOISE_OR_RECOMBINANT);

// =====================================================================
group('annotateRegimeStructure — arm_scale');

// Regime 50 Mb long, arm 100 Mb → 50% ≥ 30% → arm_scale
const big_regime = { regime_id: 1, start_bp: 0, end_bp: 50_000_000 };
const s_arm = annotateRegimeStructure(big_regime,
  { consensus_partition_M: 2, arm_length_bp: 100_000_000 });
check('regime ≥ 30% arm → arm_scale_block',
      s_arm.label === REGIME_STRUCTURE_LABELS.ARM_SCALE_BLOCK);
check('arm_scale = true',               s_arm.arm_scale === true);

// =====================================================================
group('annotateRegimeStructure — diffuse / sharp boundaries');

const s_diffuse = annotateRegimeStructure(regime,
  { regime_sharpness: 0.20 });
check('low sharpness → boundary_kind = diffuse',
      s_diffuse.boundary_kind === 'diffuse');
check('low sharpness → recombination_gradient_like',
      s_diffuse.label === REGIME_STRUCTURE_LABELS.RECOMBINATION_GRADIENT_LIKE);

const s_sharp = annotateRegimeStructure(regime,
  { regime_sharpness: 0.85 });
check('high sharpness → boundary_kind = sharp',
      s_sharp.boundary_kind === 'sharp');
check('high sharpness + no M → structural_block_like',
      s_sharp.label === REGIME_STRUCTURE_LABELS.STRUCTURAL_BLOCK_LIKE);

// =====================================================================
group('annotateRegimeStructure — null inputs');

check('null regime → null',             annotateRegimeStructure(null, {}) === null);
check('null structure_meta tolerated',
      annotateRegimeStructure(regime, null) !== null);

// =====================================================================
group('annotateRegimeStructures — batch');

const regimes2 = [
  { regime_id: 0 }, { regime_id: 1 }, { regime_id: 2 },
];
const meta = {
  0: { consensus_partition_M: 2 },
  1: { consensus_partition_M: 3 },
  2: { consensus_partition_M: 4 },
};
const batch_s = annotateRegimeStructures(regimes2, meta);
check('batch length = 3',               batch_s.length === 3);
check('batch[0] = simple',
      batch_s[0].label === REGIME_STRUCTURE_LABELS.SIMPLE_HAPLOTYPE_SPLIT);
check('batch[1] = inversion_dosage_like',
      batch_s[1].label === REGIME_STRUCTURE_LABELS.INVERSION_DOSAGE_LIKE);
check('batch[2] = nested_or_compound',
      batch_s[2].label === REGIME_STRUCTURE_LABELS.NESTED_OR_COMPOUND);

// Function source
const batch_fn = annotateRegimeStructures(regimes2, (r) => meta[r.regime_id]);
check('function source works',
      batch_fn[0].label === REGIME_STRUCTURE_LABELS.SIMPLE_HAPLOTYPE_SPLIT);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
