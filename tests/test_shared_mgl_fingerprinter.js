// tests/test_shared_mgl_fingerprinter.js
//
// Unit coverage for shared/mgl_fingerprinter.js — Stage 2 rank
// signatures + Stage 3 Method B regime IDs + switch detection +
// 4-scenario architecture classifier.

import {
  MGL_ARCHITECTURE_SCENARIOS,
  MGL_SWITCH_TYPES,
  MGL_FINGERPRINTER_DEFAULTS,
  ranksAscending,
  windowRankSignature,
  rankSignatureKey,
  regimeIdsByRankEquivalence,
  runLengthEncode,
  detectSwitches,
  classifyArchitectureScenario,
  fingerprintCandidate,
} from '../atlases/inversion/shared/mgl_fingerprinter.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('6 scenarios defined',          Object.keys(MGL_ARCHITECTURE_SCENARIOS).length === 6);
check('stable_inversion enum',        MGL_ARCHITECTURE_SCENARIOS.STABLE_INVERSION === 'stable_inversion');
check('3 switch types',               Object.keys(MGL_SWITCH_TYPES).length === 3);
check('min_run_windows default = 2',  MGL_FINGERPRINTER_DEFAULTS.min_run_windows === 2);

// =====================================================================
group('ranksAscending');

check('[0.3, 0.1, 0.2] → [3, 1, 2]',
      JSON.stringify(ranksAscending([0.3, 0.1, 0.2])) === '[3,1,2]');
check('ties share rank',
      JSON.stringify(ranksAscending([0.1, 0.1, 0.3])) === '[1,1,3]');
check('empty → []',                   ranksAscending([]).length === 0);
check('null → []',                    ranksAscending(null).length === 0);

// =====================================================================
group('windowRankSignature');

const profile_A = {
  theta_pi_A: 0.01, theta_pi_B: 0.02, theta_pi_C: 0.03,
  dXY_A_B: 0.005, dXY_A_C: 0.010, dXY_B_C: 0.008,
  Fst_A_B: 0.20,  Fst_A_C: 0.40,  Fst_B_C: 0.30,
};
const sig_A = windowRankSignature(profile_A, ['A', 'B', 'C']);
check('π ascending: A=1, B=2, C=3',
      JSON.stringify(sig_A.pi_rank) === '[1,2,3]');
check('dXY ranks correct',
      JSON.stringify(sig_A.dxy_rank) === '[1,3,2]');
check('Fst ranks correct',
      JSON.stringify(sig_A.fst_rank) === '[1,3,2]');

// Profile with permuted band order — same data, different keys
const profile_perm = {
  theta_pi_C: 0.03, theta_pi_B: 0.02, theta_pi_A: 0.01,
  dXY_B_A: 0.005,                                       // reverse order
  dXY_C_A: 0.010, dXY_C_B: 0.008,
  Fst_A_B: 0.20,  Fst_C_A: 0.40,  Fst_C_B: 0.30,
};
const sig_perm = windowRankSignature(profile_perm, ['A', 'B', 'C']);
check('reverse-key lookup works',
      JSON.stringify(sig_perm.pi_rank) === '[1,2,3]'
   && JSON.stringify(sig_perm.dxy_rank) === '[1,3,2]');

// Missing data
const profile_missing = { theta_pi_A: 0.01, theta_pi_B: 0.02 };
check('missing π for band C → null sig',
      windowRankSignature(profile_missing, ['A','B','C']) === null);

check('< 2 bands → null',             windowRankSignature(profile_A, ['A']) === null);
check('null profile → null',          windowRankSignature(null, ['A','B','C']) === null);

// =====================================================================
group('rankSignatureKey');

check('key is deterministic string',
      typeof rankSignatureKey(sig_A) === 'string'
   && rankSignatureKey(sig_A).indexOf('|') > 0);
check('null sig → empty key',         rankSignatureKey(null) === '');

// =====================================================================
group('regimeIdsByRankEquivalence');

// 4 windows. Two pairs share signatures; one window has no sig.
const records = [
  { rank_signature: sig_A },             // regime 1
  { rank_signature: sig_A },             // regime 1
  { rank_signature: null },              // regime 0 (missing)
  { rank_signature: { pi_rank: [3,1,2], dxy_rank: [1,2,3], fst_rank: [2,1,3] } }, // regime 2
];
const rg = regimeIdsByRankEquivalence(records);
check('regime_ids length 4',           rg.regime_ids.length === 4);
check('w0 and w1 share regime',        rg.regime_ids[0] === rg.regime_ids[1]);
check('w2 has regime 0 (missing)',     rg.regime_ids[2] === 0);
check('w3 is a new regime',            rg.regime_ids[3] !== rg.regime_ids[0]);
check('n_regimes = 2 (real)',          rg.n_regimes === 2);

check('empty input → empty',
      regimeIdsByRankEquivalence([]).regime_ids.length === 0);

// =====================================================================
group('runLengthEncode');

const rle = runLengthEncode([1, 1, 1, 2, 2, 1, 1]);
check('3 runs',                        rle.length === 3);
check('first run: value=1, length=3',  rle[0].value === 1 && rle[0].length === 3);
check('second run starts at 3',        rle[1].start === 3);
check('third run starts at 5',         rle[2].start === 5);
check('empty → []',                    runLengthEncode([]).length === 0);

// =====================================================================
group('detectSwitches — RETURN_SWITCH (recombinant tract)');

// Classic R1-R1-R1-R2-R2-R1-R1-R1
const ids_return = new Int32Array([1, 1, 1, 2, 2, 1, 1, 1]);
const sw_return = detectSwitches(ids_return);
const returns = sw_return.filter(s => s.type === MGL_SWITCH_TYPES.RETURN_SWITCH);
check('return: 1 return-switch found',   returns.length === 1);
check('return: regime_outer=1, inner=2',
      returns[0].regime_outer === 1 && returns[0].regime_inner === 2);
check('return: spans windows 3-4',
      returns[0].window_start === 3 && returns[0].window_end === 4);

// Brief switch (inner run length 1) → BRIEF, not RETURN, by default
const ids_brief = new Int32Array([1, 1, 1, 2, 1, 1, 1]);
const sw_brief = detectSwitches(ids_brief);
const briefs = sw_brief.filter(s => s.type === MGL_SWITCH_TYPES.BRIEF_SWITCH);
check('brief: brief-switch flagged',   briefs.length >= 1);
check('brief: no return-switch (min_run filter)',
      sw_brief.filter(s => s.type === MGL_SWITCH_TYPES.RETURN_SWITCH).length === 0);

// With min_run=1, the brief becomes a return
const sw_brief_loose = detectSwitches(ids_brief, { min_run_windows: 1 });
check('brief with min_run=1: now counts as return',
      sw_brief_loose.filter(s => s.type === MGL_SWITCH_TYPES.RETURN_SWITCH).length === 1);

// =====================================================================
group('detectSwitches — TERMINAL_SWITCH (adjacent inversions)');

const ids_terminal = new Int32Array([1, 1, 1, 1, 2, 2, 2, 2]);
const sw_terminal = detectSwitches(ids_terminal);
const terminals = sw_terminal.filter(s => s.type === MGL_SWITCH_TYPES.TERMINAL_SWITCH);
check('terminal: 1 terminal-switch found',   terminals.length === 1);
check('terminal: outer=1, inner=2',
      terminals[0].regime_outer === 1 && terminals[0].regime_inner === 2);

// =====================================================================
group('classifyArchitectureScenario');

// Scenario 1 — stable inversion
const stable = classifyArchitectureScenario(
  { regime_ids: new Int32Array([1,1,1,1,1]), n_regimes: 1 },
  [],
);
check('stable inversion',
      stable === MGL_ARCHITECTURE_SCENARIOS.STABLE_INVERSION);

// Scenario 2 — one inversion + recombinant tract
const ids2 = new Int32Array([1,1,1,2,2,1,1,1]);
const sw2  = detectSwitches(ids2);
const recomb = classifyArchitectureScenario(
  { regime_ids: ids2, n_regimes: 2 },
  sw2,
);
check('recombinant tract',
      recomb === MGL_ARCHITECTURE_SCENARIOS.ONE_INVERSION_WITH_RECOMBINANT);

// Scenario 3 — two adjacent inversions
const ids3 = new Int32Array([1,1,1,1,2,2,2,2]);
const sw3  = detectSwitches(ids3);
const adjacent = classifyArchitectureScenario(
  { regime_ids: ids3, n_regimes: 2 },
  sw3,
);
check('two adjacent inversions',
      adjacent === MGL_ARCHITECTURE_SCENARIOS.TWO_ADJACENT_INVERSIONS);

// Scenario 4 — nested rearrangement (symmetric palindrome of regimes)
const ids4 = new Int32Array([1,1,2,2,3,3,2,2,1,1]);
const sw4  = detectSwitches(ids4);
const nested = classifyArchitectureScenario(
  { regime_ids: ids4, n_regimes: 3 },
  sw4,
);
check('nested rearrangement (palindrome)',
      nested === MGL_ARCHITECTURE_SCENARIOS.NESTED_REARRANGEMENT);

// Insufficient
check('empty regime_ids → insufficient_data',
      classifyArchitectureScenario({ regime_ids: new Int32Array(0), n_regimes: 0 }, [])
   === MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA);

// =====================================================================
group('fingerprintCandidate — end-to-end');

// Build 8 per-window profiles. Outer 6 share fingerprint A, inner 2
// (windows 3,4) have a different fingerprint → expect RECOMBINANT.
function mkA() { return { theta_pi_A: 0.01, theta_pi_B: 0.02, theta_pi_C: 0.03,
                          dXY_A_B: 0.005, dXY_A_C: 0.010, dXY_B_C: 0.008,
                          Fst_A_B: 0.20, Fst_A_C: 0.40, Fst_B_C: 0.30 }; }
function mkB() { return { theta_pi_A: 0.03, theta_pi_B: 0.02, theta_pi_C: 0.01,
                          dXY_A_B: 0.008, dXY_A_C: 0.010, dXY_B_C: 0.005,
                          Fst_A_B: 0.30, Fst_A_C: 0.40, Fst_B_C: 0.20 }; }
const profiles = [mkA(), mkA(), mkA(), mkB(), mkB(), mkA(), mkA(), mkA()];
const fp = fingerprintCandidate(profiles, ['A', 'B', 'C']);
check('e2e: 8 windows reported',       fp.windows.length === 8);
check('e2e: n_regimes = 2',            fp.n_regimes === 2);
check('e2e: w0 and w7 share regime',
      fp.windows[0].regime_id === fp.windows[7].regime_id);
check('e2e: w3 != w0 regime',
      fp.windows[3].regime_id !== fp.windows[0].regime_id);
check('e2e: at least one switch',      fp.switches.length >= 1);
check('e2e: scenario = recombinant',
      fp.scenario === MGL_ARCHITECTURE_SCENARIOS.ONE_INVERSION_WITH_RECOMBINANT);

// All-same fingerprint → stable
const stable_profiles = [mkA(), mkA(), mkA(), mkA(), mkA()];
const fp_stable = fingerprintCandidate(stable_profiles, ['A','B','C']);
check('e2e stable: scenario',          fp_stable.scenario === MGL_ARCHITECTURE_SCENARIOS.STABLE_INVERSION);
check('e2e stable: n_regimes = 1',     fp_stable.n_regimes === 1);

// Edge cases
check('e2e empty → insufficient_data', fingerprintCandidate([], ['A','B','C']).scenario === MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA);
check('e2e no bands → insufficient_data', fingerprintCandidate(profiles, []).scenario === MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
