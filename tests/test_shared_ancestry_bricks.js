// tests/test_shared_ancestry_bricks.js
//
// Unit coverage for shared/ancestry_bricks.js — fish-ancestry
// scroller Layer-2 brick construction + metrics + status flags
// (SPEC_fish_ancestry_scroller.md §"Ancestry bricks — derived
// simplification layer (Layer 2 detail)").

import {
  ANCESTRY_BRICK_FLAGS,
  ANCESTRY_BRICK_DEFAULTS,
  dominantKFor,
  shannonEntropyOfQ,
  buildBricksForFish,
  attachBrickMetrics,
  buildAndAnnotateBricks,
} from '../atlases/inversion/shared/ancestry_bricks.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('FLAGS frozen',                   Object.isFrozen(ANCESTRY_BRICK_FLAGS));
check('DEFAULTS frozen',                Object.isFrozen(ANCESTRY_BRICK_DEFAULTS));
check('min_purity default = 0.6',       ANCESTRY_BRICK_DEFAULTS.min_purity === 0.6);
check('min_brick_length default = 3',   ANCESTRY_BRICK_DEFAULTS.min_brick_length === 3);
check('min_brick_bp default = 50 kb',   ANCESTRY_BRICK_DEFAULTS.min_brick_bp === 50_000);

// =====================================================================
group('dominantKFor');

check('argmax of [0.1, 0.8, 0.1] = 1',  dominantKFor([0.1, 0.8, 0.1]) === 1);
check('argmax of [0.4, 0.4, 0.2] = 0 (first max)',
      dominantKFor([0.4, 0.4, 0.2]) === 0);
check('empty → -1',                     dominantKFor([]) === -1);
check('null → -1',                      dominantKFor(null) === -1);
check('all NaN → -1',
      dominantKFor([NaN, NaN, NaN]) === -1);

// =====================================================================
group('shannonEntropyOfQ');

// Uniform Q over K=3 → H = log(3)
const H_uniform = shannonEntropyOfQ([1/3, 1/3, 1/3]);
check('uniform K=3: H = ln(3)',         approx(H_uniform, Math.log(3), 1e-6));
// One-hot → H = 0
check('one-hot: H = 0',                 shannonEntropyOfQ([1, 0, 0]) === 0);
// Empty → NaN
check('empty Q → NaN',                  Number.isNaN(shannonEntropyOfQ([])));
check('null → NaN',                     Number.isNaN(shannonEntropyOfQ(null)));
check('all-zero → NaN',                 Number.isNaN(shannonEntropyOfQ([0, 0, 0])));

// =====================================================================
group('buildBricksForFish — clean run');

// 10 RFs, all PASS, all K1-dominant with purity 0.8
const clean_rfs = [];
for (let i = 0; i < 10; i++) {
  clean_rfs.push({
    Q: [0.1, 0.8, 0.1],
    alignment_status: 'PASS',
    align_score: 0.92,
    start_bp: i * 100_000,
    end_bp: (i + 1) * 100_000,
    chrom: 'chr1',
  });
}
const bricks_clean = buildBricksForFish(clean_rfs, { fish_id: 'F1' });
check('1 brick for 10 coherent RFs',   bricks_clean.length === 1);
check('brick n_RF_windows = 10',        bricks_clean[0].n_RF_windows === 10);
check('dominant_K = 1',                 bricks_clean[0].dominant_K === 1);
check('start_bp = 0',                   bricks_clean[0].start_bp === 0);
check('end_bp = 1 Mb',                  bricks_clean[0].end_bp === 1_000_000);
check('length_bp = 1 Mb',               bricks_clean[0].length_bp === 1_000_000);
check('mean_local_Q[1] = 0.8',          approx(bricks_clean[0].mean_local_Q[1], 0.8));
check('alignment_confidence = 0.92',    bricks_clean[0].alignment_confidence === 0.92);
check('brick_id includes fish_id',      bricks_clean[0].brick_id.indexOf('F1') >= 0);

// =====================================================================
group('buildBricksForFish — dominant-K switch breaks brick');

const switch_rfs = [];
for (let i = 0; i < 5; i++) switch_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000, chrom: 'chr1',
});
for (let i = 5; i < 10; i++) switch_rfs.push({
  Q: [0.8, 0.1, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000, chrom: 'chr1',
});
const bricks_switch = buildBricksForFish(switch_rfs);
check('K switch → 2 bricks',           bricks_switch.length === 2);
check('first brick K=1',                bricks_switch[0].dominant_K === 1);
check('second brick K=0',               bricks_switch[1].dominant_K === 0);

// =====================================================================
group('buildBricksForFish — purity gate');

// 10 RFs: 3 high-purity, 1 low-purity (gap), 6 high-purity → 2 bricks
const gap_rfs = [];
for (let i = 0; i < 3; i++) gap_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
// Low-purity RF (purity = 0.4 < default 0.6) → broken
gap_rfs.push({
  Q: [0.3, 0.4, 0.3], alignment_status: 'PASS', align_score: 0.9,
  start_bp: 300_000, end_bp: 400_000,
});
for (let i = 4; i < 10; i++) gap_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
const bricks_gap = buildBricksForFish(gap_rfs);
check('low-purity RF breaks: 2 bricks',  bricks_gap.length === 2);
check('low-purity RF excluded from both',
      bricks_gap[0].n_RF_windows === 3 && bricks_gap[1].n_RF_windows === 6);

// Custom min_purity = 0.3 → all 10 RFs join one brick
const bricks_lax = buildBricksForFish(gap_rfs, { min_purity: 0.3 });
check('lax min_purity: 1 brick',         bricks_lax.length === 1
                                          && bricks_lax[0].n_RF_windows === 10);

// =====================================================================
group('buildBricksForFish — FAIL alignment breaks brick');

const fail_rfs = [];
for (let i = 0; i < 5; i++) fail_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
fail_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'FAIL', align_score: 0.3,
  start_bp: 500_000, end_bp: 600_000,
});
for (let i = 6; i < 10; i++) fail_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
const bricks_fail = buildBricksForFish(fail_rfs);
check('FAIL → 2 bricks',                 bricks_fail.length === 2);

// =====================================================================
group('buildBricksForFish — regime-aware merging');

// All RFs same K, all PASS, but regime_id changes mid-stream
const reg_rfs = [];
for (let i = 0; i < 5; i++) reg_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
  regime_id: 'R1',
});
for (let i = 5; i < 10; i++) reg_rfs.push({
  Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
  regime_id: 'R2',
});
const bricks_reg = buildBricksForFish(reg_rfs);
check('regime boundary → 2 bricks',      bricks_reg.length === 2);
check('first brick regime = R1',         bricks_reg[0].regime_id === 'R1');
check('second brick regime = R2',        bricks_reg[1].regime_id === 'R2');

// =====================================================================
group('buildBricksForFish — empty / null');

check('empty array → []',                buildBricksForFish([]).length === 0);
check('null → []',                       buildBricksForFish(null).length === 0);

// =====================================================================
group('attachBrickMetrics — delta_Q + entropy');

const bricks_for_metrics = buildBricksForFish(clean_rfs, { fish_id: 'F1' });
attachBrickMetrics(bricks_for_metrics, {
  fish_global_Q: [0.3, 0.3, 0.4],   // global differs from mean_local_Q
});
const m = bricks_for_metrics[0];
check('mean_delta_Q populated',          Number.isFinite(m.mean_delta_Q));
// mean_local_Q = [0.1, 0.8, 0.1]; global = [0.3, 0.3, 0.4]
//   |Δ| per K: 0.2, 0.5, 0.3 → mean = 1.0 / 3
check('mean_delta_Q ≈ 0.333',            approx(m.mean_delta_Q, 1 / 3, 0.01));
check('mean_entropy populated',          Number.isFinite(m.mean_entropy));
check('global_Q copied',                 Array.isArray(m.global_Q) && m.global_Q.length === 3);

// =====================================================================
group('attachBrickMetrics — flags');

// Build a fixture brick that should trip multiple flags.
const trip_bricks = buildBricksForFish([
  { Q: [0.05, 0.05, 0.9], alignment_status: 'PASS', align_score: 0.65,
    start_bp: 0, end_bp: 100_000 },
  { Q: [0.05, 0.05, 0.9], alignment_status: 'PASS', align_score: 0.65,
    start_bp: 100_000, end_bp: 200_000 },
  { Q: [0.05, 0.05, 0.9], alignment_status: 'PASS', align_score: 0.65,
    start_bp: 200_000, end_bp: 300_000 },
]);
attachBrickMetrics(trip_bricks, {
  fish_global_Q: [0.5, 0.4, 0.1],   // local K=2-dominant vs global K=0-dominant → HIGH_DELTA_Q
  cohort_context: {
    rarityScoreForBrick:    () => 0.85,   // RARE_ANCESTRY
    hetForBrick:            () => 0.10,
    hetCohortMedianForBrick: () => 0.30,
    hetCohortSdForBrick:    () => 0.05,
    rohOverlapForBrick:     () => 0.7,    // ROH_LIKE w/ low_het
    cohortMajorityKForBrick: () => 0,
    regimeStateFishForBrick: () => 'B',
    cohortConsensusRegimeForBrick: () => 'A',  // REGIME_DISCORDANT
    dosageStateForBrick:    () => 'HOM_INV',
    expectedKForDosageState: () => 0,    // expected K=0 but brick K=2 → DOSAGE_DISCORDANT
    inversionBlockRangeForBrick: () => null,
  },
});
const tb = trip_bricks[0];
check('RARE_ANCESTRY flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.RARE_ANCESTRY));
check('LOW_HET flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.LOW_HET));
check('ROH_LIKE flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.ROH_LIKE));
check('HIGH_DELTA_Q flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.HIGH_DELTA_Q));
check('LOW_CONFIDENCE flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.LOW_CONFIDENCE));
check('REGIME_DISCORDANT flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.REGIME_DISCORDANT));
check('DOSAGE_DISCORDANT flagged',
      tb.status_flags.includes(ANCESTRY_BRICK_FLAGS.DOSAGE_DISCORDANT));

// =====================================================================
group('attachBrickMetrics — FRAGMENT flag');

// 2 RFs of 30 kb → length 60 kb (above min_brick_bp) but only 2 RFs
// (below min_brick_length=3) → FRAGMENT
const frag_bricks = buildBricksForFish([
  { Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
    start_bp: 0, end_bp: 30_000 },
  { Q: [0.1, 0.8, 0.1], alignment_status: 'PASS', align_score: 0.9,
    start_bp: 30_000, end_bp: 60_000 },
]);
attachBrickMetrics(frag_bricks, { fish_global_Q: [0.33, 0.33, 0.34] });
check('< min_brick_length → FRAGMENT',
      frag_bricks[0].status_flags.includes(ANCESTRY_BRICK_FLAGS.FRAGMENT));

// =====================================================================
group('attachBrickMetrics — RECOMBINANT_LIKE');

// Build 3 bricks: K=0 brick → K=2 brick (inside inversion) → K=0 brick
// → RECOMBINANT_LIKE on the middle
const rec_rfs = [];
for (let i = 0; i < 3; i++) rec_rfs.push({
  Q: [0.8, 0.1, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
for (let i = 3; i < 6; i++) rec_rfs.push({
  Q: [0.1, 0.1, 0.8], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
for (let i = 6; i < 9; i++) rec_rfs.push({
  Q: [0.8, 0.1, 0.1], alignment_status: 'PASS', align_score: 0.9,
  start_bp: i * 100_000, end_bp: (i + 1) * 100_000,
});
const rec_bricks = buildBricksForFish(rec_rfs);
attachBrickMetrics(rec_bricks, {
  fish_global_Q: [0.5, 0.25, 0.25],
  cohort_context: {
    inversionBlockRangeForBrick: () => ({ start_bp: 0, end_bp: 900_000 }),
  },
});
check('3 bricks built',                  rec_bricks.length === 3);
check('middle brick RECOMBINANT_LIKE',
      rec_bricks[1].status_flags.includes(ANCESTRY_BRICK_FLAGS.RECOMBINANT_LIKE));
check('flanking bricks NOT RECOMBINANT_LIKE',
      !rec_bricks[0].status_flags.includes(ANCESTRY_BRICK_FLAGS.RECOMBINANT_LIKE)
      && !rec_bricks[2].status_flags.includes(ANCESTRY_BRICK_FLAGS.RECOMBINANT_LIKE));

// =====================================================================
group('buildAndAnnotateBricks — convenience wrapper');

const bb = buildAndAnnotateBricks(clean_rfs, {
  fish_id: 'F1',
  fish_global_Q: [0.33, 0.33, 0.34],
});
check('one-call wrapper returns bricks', Array.isArray(bb) && bb.length === 1);
check('wrapper attaches status_flags',   Array.isArray(bb[0].status_flags));

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
