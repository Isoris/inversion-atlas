// tests/test_shared_fingerprint_rank.js
//
// Unit coverage for shared/fingerprint_rank.js — HANDOFF 6 rank
// fingerprint + switch detection + architecture classifier.

import {
  FINGERPRINT_VERDICTS,
  SWITCH_TYPES,
  rankAsc,
  windowRanking,
  regimeSignature,
  sameRegime,
  assignRegimeIds,
  regimeRunLength,
  detectRegimeSwitches,
  classifyArchitecture,
} from '../atlases/inversion/shared/fingerprint_rank.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('VERDICTS frozen',            Object.isFrozen(FINGERPRINT_VERDICTS));
check('SWITCH_TYPES frozen',        Object.isFrozen(SWITCH_TYPES));
check('STABLE verdict present',
      FINGERPRINT_VERDICTS.STABLE === 'stable_inversion');
check('RECOMBINANT_TRACT verdict',
      FINGERPRINT_VERDICTS.RECOMBINANT_TRACT === 'one_inversion_with_recombinant_tract');

// =====================================================================
group('rankAsc');

check('[3,1,2] → [1,2,0]',
      JSON.stringify(rankAsc([3, 1, 2])) === '[1,2,0]');
check('[1,2,3] → [0,1,2] (identity)',
      JSON.stringify(rankAsc([1, 2, 3])) === '[0,1,2]');
check('stable on ties: [1,1,2] → [0,1,2]',
      JSON.stringify(rankAsc([1, 1, 2])) === '[0,1,2]');
check('NaN sorts to end',
      rankAsc([1, NaN, 2, 0])[3] === 1);
check('empty → []',                rankAsc([]).length === 0);
check('null → []',                 rankAsc(null).length === 0);

// =====================================================================
group('windowRanking');

const r1 = windowRanking({
  pi:  [0.01, 0.02, 0.005],
  dXY: [0.04, 0.03, 0.05],
  Fst: [0.10, 0.20, 0.15],
});
check('pi_rank ascending order',
      JSON.stringify(r1.pi_rank) === '[2,0,1]');
check('dXY_rank ascending order',
      JSON.stringify(r1.dXY_rank) === '[1,0,2]');
check('Fst_rank ascending order',
      JSON.stringify(r1.Fst_rank) === '[0,2,1]');

// Missing pi → []
const rEmpty = windowRanking({});
check('empty inputs → empty ranks',
      rEmpty.pi_rank.length === 0
      && rEmpty.dXY_rank.length === 0
      && rEmpty.Fst_rank.length === 0);

// =====================================================================
group('regimeSignature + sameRegime');

const rA = windowRanking({ pi: [1, 2, 3], dXY: [3, 1, 2], Fst: [2, 3, 1] });
const rB = windowRanking({ pi: [1, 2, 3], dXY: [3, 1, 2], Fst: [2, 3, 1] });
const rC = windowRanking({ pi: [3, 2, 1], dXY: [3, 1, 2], Fst: [2, 3, 1] });

check('A signature is non-empty',     regimeSignature(rA).length > 0);
check('A === B signature',            regimeSignature(rA) === regimeSignature(rB));
check('A !== C signature',            regimeSignature(rA) !== regimeSignature(rC));
check('sameRegime(A, B) = true',      sameRegime(rA, rB) === true);
check('sameRegime(A, C) = false',     sameRegime(rA, rC) === false);
check('sameRegime(null, A) = false',  sameRegime(null, rA) === false);
check('sameRegime(A, null) = false',  sameRegime(rA, null) === false);

// =====================================================================
group('assignRegimeIds');

const rankings = [rA, rB, rC, rA, rC, rC];
const assign = assignRegimeIds(rankings);
check('n_regimes = 2',                assign.n_regimes === 2);
check('regime_ids length = 6',        assign.regime_ids.length === 6);
// rA, rB → same regime id (0); rC → different (1)
check('rA + rB share id',
      assign.regime_ids[0] === assign.regime_ids[1]);
check('rA != rC ids',
      assign.regime_ids[0] !== assign.regime_ids[2]);
check('signatures recorded',          assign.signature_per_regime.length === 2);

// Empty input
const aE = assignRegimeIds([]);
check('empty → n_regimes 0',          aE.n_regimes === 0);

// =====================================================================
group('regimeRunLength');

const rle1 = regimeRunLength([0, 0, 0, 1, 1, 0, 0, 0]);
check('3 runs',                        rle1.length === 3);
check('run 0: value=0, length=3, start=0',
      rle1[0].value === 0 && rle1[0].length === 3 && rle1[0].start === 0);
check('run 1: value=1, length=2, start=3',
      rle1[1].value === 1 && rle1[1].length === 2 && rle1[1].start === 3);
check('run 2: value=0, length=3, start=5',
      rle1[2].value === 0 && rle1[2].length === 3 && rle1[2].start === 5);

check('empty → []',                    regimeRunLength([]).length === 0);

const rle2 = regimeRunLength([5]);
check('single value: one run length 1',
      rle2.length === 1 && rle2[0].length === 1);

// =====================================================================
group('detectRegimeSwitches — return switch (default min_run=2)');

const ids1 = [1, 1, 1, 2, 2, 1, 1, 1];
const sw1 = detectRegimeSwitches(ids1);
check('1 return switch detected',     sw1.length === 1);
check('type = return_switch',
      sw1[0].type === SWITCH_TYPES.RETURN);
check('regime_outer = 1',             sw1[0].regime_outer === 1);
check('regime_inner = 2',             sw1[0].regime_inner === 2);
check('inner span 3..4',
      sw1[0].window_idx_start === 3 && sw1[0].window_idx_end === 4);

// Brief switch (length 1) suppressed by default min_run=2
const ids2 = [1, 1, 1, 2, 1, 1, 1];
const sw2 = detectRegimeSwitches(ids2);
const ret2 = sw2.filter(s => s.type === SWITCH_TYPES.RETURN);
check('brief (len 1) return suppressed', ret2.length === 0);

// With min_run=1, the brief switch IS detected
const sw2b = detectRegimeSwitches(ids2, { min_run: 1 });
const ret2b = sw2b.filter(s => s.type === SWITCH_TYPES.RETURN);
check('min_run=1: brief return detected', ret2b.length === 1);

// =====================================================================
group('detectRegimeSwitches — terminal switch (no return)');

const ids3 = [1, 1, 1, 1, 2, 2, 2, 2];
const sw3 = detectRegimeSwitches(ids3);
const term3 = sw3.filter(s => s.type === SWITCH_TYPES.TERMINAL);
check('1 terminal switch detected',   term3.length === 1);
check('terminal regime_outer = 1',    term3[0].regime_outer === 1);
check('terminal regime_inner = 2',    term3[0].regime_inner === 2);

// =====================================================================
group('detectRegimeSwitches — empty / single regime');

check('empty → no switches',          detectRegimeSwitches([]).length === 0);
check('all same regime → no switches',
      detectRegimeSwitches([1, 1, 1, 1]).length === 0);

// =====================================================================
group('classifyArchitecture');

// Stable: all same
check('all same → stable',
      classifyArchitecture([1, 1, 1, 1], []) === FINGERPRINT_VERDICTS.STABLE);

// Recombinant tract: one return, zero terminal
{
  const ids = [1, 1, 1, 2, 2, 1, 1, 1];
  const sw = detectRegimeSwitches(ids);
  check('one return switch → recombinant_tract',
        classifyArchitecture(ids, sw) === FINGERPRINT_VERDICTS.RECOMBINANT_TRACT);
}

// Two adjacent: one terminal, zero return
{
  const ids = [1, 1, 1, 1, 2, 2, 2, 2];
  const sw = detectRegimeSwitches(ids);
  check('one terminal switch → two_adjacent',
        classifyArchitecture(ids, sw) === FINGERPRINT_VERDICTS.TWO_ADJACENT);
}

// Nested candidate: many returns
{
  const ids = [1, 1, 2, 2, 1, 1, 2, 2, 1, 1];
  const sw = detectRegimeSwitches(ids);
  check('multiple returns → nested_rearrangement_candidate',
        classifyArchitecture(ids, sw) === FINGERPRINT_VERDICTS.NESTED_CANDIDATE);
}

// Complex: return + terminal mix
{
  const ids = [1, 1, 2, 2, 1, 1, 3, 3];
  const sw = detectRegimeSwitches(ids);
  check('return + terminal → complex',
        classifyArchitecture(ids, sw) === FINGERPRINT_VERDICTS.COMPLEX);
}

// Empty → stable
check('empty → stable',
      classifyArchitecture([], []) === FINGERPRINT_VERDICTS.STABLE);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
