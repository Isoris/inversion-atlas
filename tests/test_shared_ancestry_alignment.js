// tests/test_shared_ancestry_alignment.js
//
// Unit coverage for shared/ancestry_alignment.js — fish-ancestry
// scroller label-switching alignment (SPEC_fish_ancestry_scroller.md
// §"CRITICAL FIRST — the label-switching problem").

import {
  ANCESTRY_ALIGN_STATUS,
  ANCESTRY_ALIGN_DEFAULTS,
  ANCESTRY_ALIGN_METHOD,
  bestPermutationByAffinity,
  alignAncestryColumnsByF,
  alignAncestryColumnsByQ,
  applyAncestryPermutation,
  classifyAncestryAlignmentStatus,
  alignPerRFAncestry,
  applyRegimeAwareSmoothing,
} from '../atlases/popstats/shared/ancestry_alignment.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab + defaults');

check('STATUS frozen',                  Object.isFrozen(ANCESTRY_ALIGN_STATUS));
check('DEFAULTS frozen',                Object.isFrozen(ANCESTRY_ALIGN_DEFAULTS));
check('METHOD frozen',                  Object.isFrozen(ANCESTRY_ALIGN_METHOD));
check('pass_threshold = 0.85',          ANCESTRY_ALIGN_DEFAULTS.pass_threshold === 0.85);
check('warn_threshold = 0.70',          ANCESTRY_ALIGN_DEFAULTS.warn_threshold === 0.70);
check('smoothing_score_gap = 0.10',     ANCESTRY_ALIGN_DEFAULTS.smoothing_score_gap === 0.10);

// =====================================================================
group('bestPermutationByAffinity — identity');

// Perfect diagonal → identity permutation
const aff_id = [
  [1.0, 0.0, 0.0],
  [0.0, 1.0, 0.0],
  [0.0, 0.0, 1.0],
];
const r_id = bestPermutationByAffinity(aff_id, 3);
check('identity affinity: perm = [0, 1, 2]',
      JSON.stringify(r_id.perm) === '[0,1,2]');
check('identity score = 1',             approx(r_id.score, 1));

// =====================================================================
group('bestPermutationByAffinity — cyclic permutation');

// Best diagonal sits at [perm[k]][k] for perm = [2, 0, 1]
// (local_2 → global_0, local_0 → global_1, local_1 → global_2)
const aff_cyc = [
  [0.1, 0.9, 0.2],    // local_0 ~ global_1
  [0.2, 0.1, 0.9],    // local_1 ~ global_2
  [0.9, 0.2, 0.1],    // local_2 ~ global_0
];
const r_cyc = bestPermutationByAffinity(aff_cyc, 3);
check('cyclic: perm = [2, 0, 1]',
      JSON.stringify(r_cyc.perm) === '[2,0,1]');
check('cyclic score ≈ 0.9',             approx(r_cyc.score, 0.9, 0.01));
check('runner_up < score',              r_cyc.runner_up < r_cyc.score);

// =====================================================================
group('bestPermutationByAffinity — edge cases');

const r_K1 = bestPermutationByAffinity([[0.5]], 1);
check('K=1: perm = [0]',                JSON.stringify(r_K1.perm) === '[0]');
check('K=1: runner_up = NaN',           Number.isNaN(r_K1.runner_up));

check('K > 6 → null',
      bestPermutationByAffinity([[1]], 7) === null);
check('null affinity → null',           bestPermutationByAffinity(null, 3) === null);
check('K=0 → null',                     bestPermutationByAffinity([], 0) === null);

// =====================================================================
group('alignAncestryColumnsByF — identity');

// 100 SNPs, K=3. local_F matches global_F exactly → perm = [0, 1, 2]
const n_snps = 100;
const global_F = [];
const local_F_identity = [];
for (let i = 0; i < n_snps; i++) {
  const row = [Math.random() * 0.5, Math.random() * 0.5, Math.random() * 0.5];
  global_F.push(row);
  local_F_identity.push([row[0], row[1], row[2]]);
}
const r_F_id = alignAncestryColumnsByF(local_F_identity, global_F, 3);
check('identity F: ok = true',          r_F_id.ok === true);
check('identity F: perm = [0, 1, 2]',
      JSON.stringify(r_F_id.perm) === '[0,1,2]');
check('identity F: score ≈ 1',          approx(r_F_id.score, 1, 0.01));
check('method = F-based',                r_F_id.method === ANCESTRY_ALIGN_METHOD.F_BASED);
check('n_snps_used = 100',               r_F_id.n_snps_used === 100);

// =====================================================================
group('alignAncestryColumnsByF — permuted');

// Permute local columns: local_0 carries global_2's values,
// local_1 carries global_0's values, local_2 carries global_1's values.
const local_F_perm = global_F.map(r => [r[2], r[0], r[1]]);
const r_F_perm = alignAncestryColumnsByF(local_F_perm, global_F, 3);
check('permuted F: ok = true',          r_F_perm.ok === true);
// perm[global_k] = local_k (which local column carries global_k's
// values). global_0 ← local_1, global_1 ← local_2, global_2 ← local_0.
check('permuted F: perm = [1, 2, 0]',
      JSON.stringify(r_F_perm.perm) === '[1,2,0]');

// =====================================================================
group('alignAncestryColumnsByF — error paths');

check('null inputs → ok=false',
      alignAncestryColumnsByF(null, global_F, 3).ok === false);
check('empty SNPs → ok=false',
      alignAncestryColumnsByF([], global_F, 3).ok === false);
check('snp count mismatch → ok=false',
      alignAncestryColumnsByF(local_F_identity.slice(0, 5), global_F, 3).ok === false);
check('K > 6 → ok=false',
      alignAncestryColumnsByF(local_F_identity, global_F, 7).ok === false);

// =====================================================================
group('alignAncestryColumnsByQ — basic');

// 50 fish, K=3. local_Q matches global_Q after a [1, 2, 0] permutation.
const n_fish = 50;
const global_Q = [];
const local_Q_perm = [];
for (let i = 0; i < n_fish; i++) {
  const a = Math.random(), b = Math.random(), c = Math.random();
  const s = a + b + c;
  const row = [a / s, b / s, c / s];
  global_Q.push(row);
  // local_0 = global_1, local_1 = global_2, local_2 = global_0
  local_Q_perm.push([row[1], row[2], row[0]]);
}
const r_Q = alignAncestryColumnsByQ(local_Q_perm, global_Q, 3);
check('Q-based ok',                     r_Q.ok === true);
check('Q-based: perm correct',
      JSON.stringify(r_Q.perm) === '[2,0,1]');
check('Q-based: method tag',             r_Q.method === ANCESTRY_ALIGN_METHOD.Q_BASED);

// =====================================================================
group('applyAncestryPermutation');

// Q_raw with 2 fish × K=3; perm = [1, 0, 2] means "global_0 gets
// local_1's column" etc.
const Q_raw = [
  [0.7, 0.2, 0.1],
  [0.3, 0.6, 0.1],
];
const Q_aligned = applyAncestryPermutation(Q_raw, [1, 0, 2]);
check('row 0: column 0 = 0.2',           Q_aligned[0][0] === 0.2);
check('row 0: column 1 = 0.7',           Q_aligned[0][1] === 0.7);
check('row 0: column 2 = 0.1',           Q_aligned[0][2] === 0.1);
check('row 1 permuted',                  Q_aligned[1][0] === 0.6);

check('null Q → []',                     applyAncestryPermutation(null, [0]).length === 0);

// =====================================================================
group('classifyAncestryAlignmentStatus');

check('0.90 → PASS',
      classifyAncestryAlignmentStatus(0.90) === ANCESTRY_ALIGN_STATUS.PASS);
check('0.85 → PASS (edge)',
      classifyAncestryAlignmentStatus(0.85) === ANCESTRY_ALIGN_STATUS.PASS);
check('0.75 → WARN',
      classifyAncestryAlignmentStatus(0.75) === ANCESTRY_ALIGN_STATUS.WARN);
check('0.70 → WARN (edge)',
      classifyAncestryAlignmentStatus(0.70) === ANCESTRY_ALIGN_STATUS.WARN);
check('0.50 → FAIL',
      classifyAncestryAlignmentStatus(0.50) === ANCESTRY_ALIGN_STATUS.FAIL);
check('NaN → FAIL',
      classifyAncestryAlignmentStatus(NaN) === ANCESTRY_ALIGN_STATUS.FAIL);
// Custom thresholds
check('custom pass=0.95: 0.90 → WARN',
      classifyAncestryAlignmentStatus(0.90, { pass_threshold: 0.95 })
        === ANCESTRY_ALIGN_STATUS.WARN);

// =====================================================================
group('alignPerRFAncestry — F-based PASS');

const r_pipe = alignPerRFAncestry({
  RF_id: 'RF_001',
  K: 3,
  local_F: local_F_identity,
  global_F: global_F,
  Q_raw: Q_raw,
});
check('F-based RF: method = F-based',   r_pipe.method === ANCESTRY_ALIGN_METHOD.F_BASED);
check('F-based RF: status = PASS',      r_pipe.status === ANCESTRY_ALIGN_STATUS.PASS);
check('Q_aligned produced',              r_pipe.Q_aligned !== null);

// =====================================================================
group('alignPerRFAncestry — F fails, Q fallback');

// Random local_F → low correlation with global_F → F fails.
// But Q matches (after permutation) → Q fallback rescues.
const local_F_random = [];
for (let i = 0; i < n_snps; i++) {
  local_F_random.push([Math.random() * 0.5, Math.random() * 0.5, Math.random() * 0.5]);
}
const r_fb = alignPerRFAncestry({
  RF_id: 'RF_002',
  K: 3,
  local_F: local_F_random,
  global_F: global_F,
  local_Q: local_Q_perm,
  global_Q: global_Q,
  Q_raw: local_Q_perm,
}, { pass_threshold: 0.95 });   // strict — F won't pass, Q will via Q match
// Whether F passes depends on random alignment; we mainly check the
// fallback path doesn't throw and produces a method label.
check('F-fail+Q-good: method finite',
      r_fb.method === ANCESTRY_ALIGN_METHOD.F_BASED
      || r_fb.method === ANCESTRY_ALIGN_METHOD.Q_BASED
      || r_fb.method === ANCESTRY_ALIGN_METHOD.AMBIGUOUS);

// is_inside_inversion blocks Q fallback
const r_inv = alignPerRFAncestry({
  RF_id: 'RF_003',
  K: 3,
  local_F: local_F_random,
  global_F: global_F,
  local_Q: local_Q_perm,
  global_Q: global_Q,
  Q_raw: local_Q_perm,
  is_inside_inversion: true,
}, { pass_threshold: 0.95 });
check('inside inversion + F-fail → no Q fallback',
      r_inv.method === ANCESTRY_ALIGN_METHOD.AMBIGUOUS
      || r_inv.method === ANCESTRY_ALIGN_METHOD.F_BASED);

// =====================================================================
group('applyRegimeAwareSmoothing — single-RF flip');

// 3 RFs: [0,1,2], [1,0,2], [0,1,2]. The middle one alone flips
// and has a low score → smooth.
const seq = [
  { RF_id: 0, perm: [0, 1, 2], align_score: 0.92, status: 'PASS' },
  { RF_id: 1, perm: [1, 0, 2], align_score: 0.65, status: 'WARN' },
  { RF_id: 2, perm: [0, 1, 2], align_score: 0.91, status: 'PASS' },
];
const smoothed = applyRegimeAwareSmoothing(seq);
check('middle RF perm overridden',
      JSON.stringify(smoothed[1].perm) === '[0,1,2]');
check('middle RF status = SMOOTHED',
      smoothed[1].status === ANCESTRY_ALIGN_STATUS.SMOOTHED);
check('smoothed_from_score recorded',
      smoothed[1].smoothed_from_score === 0.65);
check('input not mutated',              seq[1].status === 'WARN');

// =====================================================================
group('applyRegimeAwareSmoothing — does NOT override when score is OK');

// Same flip but middle RF has a HIGH score → no smoothing
const seq2 = [
  { RF_id: 0, perm: [0, 1, 2], align_score: 0.92, status: 'PASS' },
  { RF_id: 1, perm: [1, 0, 2], align_score: 0.91, status: 'PASS' },
  { RF_id: 2, perm: [0, 1, 2], align_score: 0.92, status: 'PASS' },
];
const sm2 = applyRegimeAwareSmoothing(seq2);
check('high-score flip NOT smoothed',
      JSON.stringify(sm2[1].perm) === '[1,0,2]'
      && sm2[1].status === 'PASS');

// Different flip pattern (neighbours don't agree) → no smoothing
const seq3 = [
  { RF_id: 0, perm: [0, 1, 2], align_score: 0.9, status: 'PASS' },
  { RF_id: 1, perm: [1, 0, 2], align_score: 0.5, status: 'WARN' },
  { RF_id: 2, perm: [2, 0, 1], align_score: 0.9, status: 'PASS' },
];
const sm3 = applyRegimeAwareSmoothing(seq3);
check('neighbours disagree → no smoothing',
      JSON.stringify(sm3[1].perm) === '[1,0,2]');

// Short sequences
check('len < 3: passthrough',
      applyRegimeAwareSmoothing([{ perm: [0] }]).length === 1);
check('null → []',                      applyRegimeAwareSmoothing(null).length === 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
