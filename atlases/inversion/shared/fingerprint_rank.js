// shared/fingerprint_rank.js
//
// HANDOFF 6 atlas-side primitives — rank-based fingerprint + regime
// equivalence + run-length switch detector for the fragment-
// fingerprinter track (specs_todo/pages_fingerprint_track/_to_do/
// HANDOFF_6_fingerprinter.md §Stage 2 / §Stage 3). Pure JS; no DOM,
// no fetch.
//
// Three exports drive the per-window track:
//
//   windowRanking(perBand)        → {pi_rank, dXY_rank, Fst_rank}
//   regimeSignature(rank)         → '1,2,3|0,2,1|2,1,0'  (cache key)
//   sameRegime(a, b)              → boolean
//
// Plus the run-length walker that classifies the candidate-level
// pattern:
//
//   detectRegimeSwitches(regimeIds, opts) → [{type, regime_outer,
//                                              regime_inner,
//                                              window_idx_start,
//                                              window_idx_end}]
//
//   classifyArchitecture(regimeIds, switches) → verdict ∈
//     {stable_inversion, one_inversion_with_recombinant_tract,
//      two_adjacent_inversions, complex_architecture_check_alignment,
//      nested_rearrangement_candidate}

/** Verdict vocab from spec §Stage 3 (verdict table). */
export const FINGERPRINT_VERDICTS = Object.freeze({
  STABLE:               'stable_inversion',
  RECOMBINANT_TRACT:    'one_inversion_with_recombinant_tract',
  TWO_ADJACENT:         'two_adjacent_inversions',
  COMPLEX:              'complex_architecture_check_alignment',
  NESTED_CANDIDATE:     'nested_rearrangement_candidate',
});

/** Switch type vocab. */
export const SWITCH_TYPES = Object.freeze({
  RETURN:   'return_switch',
  TERMINAL: 'terminal_switch',
});

/**
 * Argsort: indices of `arr` in ascending order. Stable for equal
 * values (preserves input order). Returns Array<number>.
 *
 * @param {Array<number>|Float32Array|Float64Array} arr
 * @returns {Array<number>}
 */
export function rankAsc(arr) {
  if (!arr || typeof arr.length !== 'number') return [];
  const n = arr.length;
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => {
    const va = arr[a], vb = arr[b];
    const fa = Number.isFinite(va) ? va : Infinity;
    const fb = Number.isFinite(vb) ? vb : Infinity;
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return a - b;   // stable on ties
  });
  return idx;
}

/**
 * Compute the rank fingerprint for one window from per-band π, dXY,
 * and Fst measurements. Each input is a flat array indexed by some
 * caller-determined order (e.g. band id, or sorted band-pair).
 *
 *   windowRanking({pi: [0.01, 0.02, 0.005],
 *                  dXY: [0.04, 0.03, 0.05],
 *                  Fst: [0.1, 0.2, 0.15]})
 *   → {pi_rank: [2, 0, 1], dXY_rank: [1, 0, 2], Fst_rank: [0, 2, 1]}
 *
 * @param {{pi:Array<number>, dXY:Array<number>, Fst:Array<number>}} perBand
 * @returns {{pi_rank:Array<number>, dXY_rank:Array<number>, Fst_rank:Array<number>}}
 */
export function windowRanking(perBand) {
  const o = perBand || {};
  return {
    pi_rank:  rankAsc(o.pi  || []),
    dXY_rank: rankAsc(o.dXY || []),
    Fst_rank: rankAsc(o.Fst || []),
  };
}

/**
 * Compact stringified fingerprint for fast hashing / Map keys.
 * Three rank tuples separated by `|`; entries comma-joined.
 *
 * @param {{pi_rank:Array<number>, dXY_rank:Array<number>, Fst_rank:Array<number>}} ranking
 * @returns {string}
 */
export function regimeSignature(ranking) {
  if (!ranking) return '';
  const a = (ranking.pi_rank  || []).join(',');
  const b = (ranking.dXY_rank || []).join(',');
  const c = (ranking.Fst_rank || []).join(',');
  return a + '|' + b + '|' + c;
}

/**
 * Two windows are in the same regime iff all three rank tuples
 * match. Order-sensitive — `[1,2,3]` differs from `[1,3,2]`.
 *
 * @param {Object} rA
 * @param {Object} rB
 * @returns {boolean}
 */
export function sameRegime(rA, rB) {
  if (!rA || !rB) return false;
  return regimeSignature(rA) === regimeSignature(rB);
}

/**
 * Convert a window-array of rankings into a per-window dense regime
 * id (0..K-1) by grouping identical signatures.
 *
 * @param {Array<Object>} rankings  one per window
 * @returns {{regime_ids:Int32Array, n_regimes:number,
 *           signature_per_regime:Array<string>}}
 */
export function assignRegimeIds(rankings) {
  const n = rankings ? rankings.length : 0;
  const regime_ids = new Int32Array(n);
  const sigToId = new Map();
  const signature_per_regime = [];
  for (let i = 0; i < n; i++) {
    const sig = regimeSignature(rankings[i]);
    if (!sigToId.has(sig)) {
      sigToId.set(sig, signature_per_regime.length);
      signature_per_regime.push(sig);
    }
    regime_ids[i] = sigToId.get(sig);
  }
  return {
    regime_ids,
    n_regimes: signature_per_regime.length,
    signature_per_regime,
  };
}

/**
 * Run-length encode `regimeIds` into `[{value, length, start}]`. Used
 * by the switch detector and the architecture classifier.
 *
 * @param {Int32Array|Array<number>} regimeIds
 * @returns {Array<{value:number, length:number, start:number}>}
 */
export function regimeRunLength(regimeIds) {
  if (!regimeIds || typeof regimeIds.length !== 'number') return [];
  const out = [];
  const n = regimeIds.length;
  if (n === 0) return out;
  let runValue = regimeIds[0], runStart = 0, runLen = 1;
  for (let i = 1; i < n; i++) {
    if (regimeIds[i] === runValue) { runLen++; continue; }
    out.push({ value: runValue, length: runLen, start: runStart });
    runValue = regimeIds[i];
    runStart = i;
    runLen = 1;
  }
  out.push({ value: runValue, length: runLen, start: runStart });
  return out;
}

/**
 * Find return-switches and terminal-switches along a regime-id
 * sequence (spec §Stage 3 `detect_switches`).
 *
 *   Return-switch: run pattern  R1 → R2 → R1   where the inner run
 *                  length ≥ `min_run` (default 2) — putative
 *                  double-crossover / recombinant tract.
 *   Terminal-switch: a single transition with no return — boundary
 *                    to a different inversion.
 *
 * @param {Int32Array|Array<number>} regimeIds
 * @param {{min_run?:number}} [opts]
 * @returns {Array<Object>}
 */
export function detectRegimeSwitches(regimeIds, opts) {
  const o = opts || {};
  const minRun = Number.isFinite(o.min_run) ? o.min_run : 2;
  const runs = regimeRunLength(regimeIds);
  const out = [];
  for (let i = 0; i < runs.length - 2; i++) {
    const a = runs[i], b = runs[i + 1], c = runs[i + 2];
    if (a.value === c.value && a.value !== b.value && b.length >= minRun) {
      out.push({
        type: SWITCH_TYPES.RETURN,
        regime_outer: a.value,
        regime_inner: b.value,
        window_idx_start: b.start,
        window_idx_end:   b.start + b.length - 1,
        run_length:       b.length,
      });
    }
  }
  // Terminal switches: transitions that aren't part of a return run.
  // Both the inner-start (R1→R2) AND the outer-return-start (R2→R1)
  // belong to the same return-switch event, so neither should also
  // count as a terminal switch.
  const returnTransitionStarts = new Set();
  for (const s of out) {
    returnTransitionStarts.add(s.window_idx_start);             // R1 → R2 transition
    returnTransitionStarts.add(s.window_idx_end + 1);           // R2 → R1 transition
  }
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1], cur = runs[i];
    if (prev.value === cur.value) continue;
    if (returnTransitionStarts.has(cur.start)) continue;
    out.push({
      type: SWITCH_TYPES.TERMINAL,
      regime_outer: prev.value,
      regime_inner: cur.value,
      window_idx_start: cur.start,
      window_idx_end:   cur.start + cur.length - 1,
      run_length:       cur.length,
    });
  }
  // Stable order by start index.
  out.sort((a, b) => a.window_idx_start - b.window_idx_start);
  return out;
}

/**
 * Classify the candidate-level architecture from the regime-id
 * sequence + switch list (spec §Stage 3 verdict table).
 *
 *   stable_inversion                       all windows same regime
 *   one_inversion_with_recombinant_tract   exactly one return switch
 *                                           and no terminal switches
 *   two_adjacent_inversions                exactly one terminal switch
 *                                           and no return switches
 *   complex_architecture_check_alignment   multiple non-returning
 *                                           switches
 *   nested_rearrangement_candidate         many return switches in
 *                                           close succession
 *
 * @param {Int32Array|Array<number>} regimeIds
 * @param {Array<Object>} switches  from detectRegimeSwitches
 * @returns {string}                FINGERPRINT_VERDICTS value
 */
export function classifyArchitecture(regimeIds, switches) {
  if (!regimeIds || regimeIds.length === 0) {
    return FINGERPRINT_VERDICTS.STABLE;
  }
  const runs = regimeRunLength(regimeIds);
  if (runs.length <= 1) return FINGERPRINT_VERDICTS.STABLE;
  const sw = switches || [];
  const nReturn = sw.filter(s => s.type === SWITCH_TYPES.RETURN).length;
  const nTerm   = sw.filter(s => s.type === SWITCH_TYPES.TERMINAL).length;
  if (nReturn === 0 && nTerm === 0) return FINGERPRINT_VERDICTS.STABLE;
  if (nReturn >= 2) return FINGERPRINT_VERDICTS.NESTED_CANDIDATE;
  if (nReturn === 1 && nTerm === 0) {
    return FINGERPRINT_VERDICTS.RECOMBINANT_TRACT;
  }
  if (nReturn === 0 && nTerm === 1) {
    return FINGERPRINT_VERDICTS.TWO_ADJACENT;
  }
  return FINGERPRINT_VERDICTS.COMPLEX;
}
