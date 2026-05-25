// shared/mgl_fingerprinter.js
// =====================================================================
// Per-window diversity fingerprinter — the inversion-architecture
// diagnostic from HANDOFF_6 + SPEC_0 §11.6.
//
// Answers: "Does the diversity pattern stay the same across the
// candidate, or does it switch in places? Is this one inversion,
// two adjacent inversions, or one inversion with a recombinant
// tract?"
//
// Atlas-side scope (this module):
//   Stage 2 — rank-signature extraction per window
//   Stage 3 Method B — rank-equivalence regime IDs
//   Switch detection (return / terminal / brief switches)
//   4-scenario classifier (stable / recombinant_tract /
//                           two_adjacent / nested_rearrangement)
//
// Stage 1 (per-window π / dXY / Fst etc.) is upstream — this module
// consumes the already-computed profile vectors. The producer can
// be R/popstats (upstream) OR a future in-browser Beagle-based
// compute path (both feed the same schema).
//
// Pure compute. No DOM, no fetch.
// =====================================================================

// =====================================================================
// Vocab
// =====================================================================

/** 4 candidate-architecture scenarios + a fallback. */
export const MGL_ARCHITECTURE_SCENARIOS = Object.freeze({
  STABLE_INVERSION:                   'stable_inversion',
  ONE_INVERSION_WITH_RECOMBINANT:     'one_inversion_with_recombinant_tract',
  TWO_ADJACENT_INVERSIONS:            'two_adjacent_inversions',
  NESTED_REARRANGEMENT:               'nested_rearrangement',
  COMPLEX_OR_UNCLEAR:                 'complex_or_unclear',
  INSUFFICIENT_DATA:                  'insufficient_data',
});

/** Switch-type enum used in the switch-detection output. */
export const MGL_SWITCH_TYPES = Object.freeze({
  RETURN_SWITCH:    'return_switch',
  TERMINAL_SWITCH:  'terminal_switch',
  BRIEF_SWITCH:     'brief_switch',
});

/** Defaults for the algorithm. */
export const MGL_FINGERPRINTER_DEFAULTS = Object.freeze({
  /** Minimum run length (windows) for a switch to count as
   *  "sustained". Brief single-window switches in noisy regions are
   *  ignored. */
  min_run_windows:           2,
  /** Minimum number of distinct regimes for the multi-regime
   *  scenarios. */
  min_distinct_regimes:      2,
  /** Tolerance when comparing rank signatures (currently strict
   *  equality; reserved for future approximate matching). */
  rank_tolerance:            0,
});

// =====================================================================
// 1. Stage 2 — rank signatures per window
// =====================================================================

/**
 * Convert an array of values into an ascending-rank order vector.
 * Ties get the same rank.
 *
 * Example: [0.3, 0.1, 0.2]  →  ranks [3, 1, 2]
 *
 * @param {number[]|Float64Array} values
 * @returns {number[]}
 */
export function ranksAscending(values) {
  if (!values || values.length === 0) return [];
  const n = values.length;
  const indexed = new Array(n);
  for (let i = 0; i < n; i++) indexed[i] = { i, v: values[i] };
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  // Assign 1-based ranks; ties share the same rank.
  let rank = 1;
  for (let k = 0; k < n; k++) {
    if (k > 0 && indexed[k].v !== indexed[k - 1].v) rank = k + 1;
    ranks[indexed[k].i] = rank;
  }
  return ranks;
}

/**
 * Build the rank signature for one window from a per-window profile
 * object. The signature consists of three rank vectors:
 *   - pi_rank   — per-band π ascending
 *   - dxy_rank  — pairwise dXY ascending
 *   - fst_rank  — pairwise Fst ascending
 *
 * Pair order follows `_pairsOf(bands)` — alphabetical by sorted
 * band names — so the signature is deterministic and comparable
 * across windows.
 *
 * @param {Object} profile        per-window metrics keyed
 *                                 (theta_pi_<band>, dXY_<a>_<b>,
 *                                 Fst_<a>_<b>, ...)
 * @param {string[]} bands        sorted band IDs (e.g. ['A','B','C'])
 * @returns {{pi_rank:number[], dxy_rank:number[], fst_rank:number[]}|null}
 */
export function windowRankSignature(profile, bands) {
  if (!profile || !Array.isArray(bands) || bands.length < 2) return null;
  // π per band
  const piVals = bands.map(b => _pickPi(profile, b));
  if (piVals.some(v => !Number.isFinite(v))) return null;
  const pi_rank = ranksAscending(piVals);
  // dXY / Fst pairwise
  const pairs = _pairsOf(bands);
  const dxyVals = pairs.map(([a, b]) => _pickPair(profile, 'dXY', a, b));
  const fstVals = pairs.map(([a, b]) => _pickPair(profile, 'Fst', a, b));
  if (dxyVals.some(v => !Number.isFinite(v))) return null;
  if (fstVals.some(v => !Number.isFinite(v))) return null;
  const dxy_rank = ranksAscending(dxyVals);
  const fst_rank = ranksAscending(fstVals);
  return { pi_rank, dxy_rank, fst_rank };
}

function _pickPi(profile, band) {
  const candidates = ['theta_pi_' + band, 'pi_' + band, 'theta_pi' + band];
  for (const k of candidates) {
    if (k in profile && Number.isFinite(profile[k])) return profile[k];
  }
  return NaN;
}

function _pickPair(profile, prefix, a, b) {
  // Try a few naming conventions, including reverse ordering.
  const keys = [
    `${prefix}_${a}_${b}`, `${prefix}_${b}_${a}`,
    `${prefix.toLowerCase()}_${a}_${b}`, `${prefix.toLowerCase()}_${b}_${a}`,
  ];
  for (const k of keys) {
    if (k in profile && Number.isFinite(profile[k])) return profile[k];
  }
  return NaN;
}

function _pairsOf(bands) {
  // 2026-05-21 perf (Tier-D): the JSDoc contract on windowRankSignature
  // promises `bands` is already sorted (callers always pass the canonical
  // band-id array). The previous defensive `.slice().sort()` was a
  // per-window allocation we can skip — trust the contract. If a future
  // caller passes unsorted bands the pair order shifts but no crash
  // occurs; the smoke tests catch that case explicitly.
  const out = [];
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      out.push([bands[i], bands[j]]);
    }
  }
  return out;
}

/**
 * Stringify a rank signature into a canonical key string. Two
 * windows have the same regime when their signature strings match.
 *
 * @param {Object} sig   output of windowRankSignature
 * @returns {string}     'pi|dxy|fst' rank tuples joined
 */
export function rankSignatureKey(sig) {
  if (!sig) return '';
  return sig.pi_rank.join(',')
    + '|' + sig.dxy_rank.join(',')
    + '|' + sig.fst_rank.join(',');
}

// =====================================================================
// 2. Stage 3 Method B — rank-equivalence regime IDs
// =====================================================================

/**
 * Assign one regime ID per window using rank-equivalence: windows
 * with identical rank signatures share a regime.
 *
 * Regime IDs are assigned in order of first appearance (1, 2, 3, ...).
 * Windows whose signature is null (missing profile data) get
 * `regime_id = 0`.
 *
 * @param {Array<{rank_signature:Object|null}>} window_records
 *   one entry per window with a `rank_signature` field (output of
 *   windowRankSignature)
 * @returns {{regime_ids:Int32Array, n_regimes:number,
 *            keyToRegime: Map<string,number>}}
 */
export function regimeIdsByRankEquivalence(window_records) {
  const n = Array.isArray(window_records) ? window_records.length : 0;
  const ids = new Int32Array(n);
  const keyToRegime = new Map();
  let next = 1;
  for (let i = 0; i < n; i++) {
    const sig = window_records[i] && window_records[i].rank_signature;
    if (!sig) { ids[i] = 0; continue; }
    const k = rankSignatureKey(sig);
    let r = keyToRegime.get(k);
    if (r === undefined) {
      r = next++;
      keyToRegime.set(k, r);
    }
    ids[i] = r;
  }
  return {
    regime_ids: ids,
    n_regimes:  next - 1,
    keyToRegime,
  };
}

// =====================================================================
// 3. Switch detection along the genome
// =====================================================================

/**
 * Run-length encode an Int32Array / regime-id list.
 *
 * @param {Int32Array|number[]} ids
 * @returns {Array<{value:number, length:number, start:number}>}
 */
export function runLengthEncode(ids) {
  if (!ids || ids.length === 0) return [];
  const out = [];
  let cur = ids[0], len = 1, start = 0;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] === cur) { len++; continue; }
    out.push({ value: cur, length: len, start });
    cur = ids[i]; len = 1; start = i;
  }
  out.push({ value: cur, length: len, start });
  return out;
}

/**
 * Detect switches along the regime-id sequence.
 *
 *   RETURN_SWITCH:    R1 ... R2 ... R1 (the same outer regime
 *                     comes back). Inner run length ≥ min_run.
 *                     Signature of one_inversion_with_recombinant_tract.
 *   TERMINAL_SWITCH:  Two distinct regimes adjacent with NO return.
 *                     Signature of two_adjacent_inversions.
 *   BRIEF_SWITCH:     Single-window deviation that the min_run
 *                     filter would normally suppress. Returned
 *                     separately so the renderer can grey them out.
 *
 * @param {Int32Array|number[]} regime_ids
 * @param {Object} [opts]
 * @returns {Array<{type:string, regime_outer:number,
 *                   regime_inner:number, window_start:number,
 *                   window_end:number}>}
 */
export function detectSwitches(regime_ids, opts) {
  const o = opts || {};
  const minRun = Number.isFinite(o.min_run_windows)
    ? o.min_run_windows : MGL_FINGERPRINTER_DEFAULTS.min_run_windows;
  const runs = runLengthEncode(regime_ids);
  if (runs.length < 2) return [];
  const switches = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (i + 2 < runs.length
        && runs[i + 2].value === r.value
        && runs[i + 1].value !== r.value
        && runs[i + 1].length >= minRun) {
      switches.push({
        type:        MGL_SWITCH_TYPES.RETURN_SWITCH,
        regime_outer: r.value,
        regime_inner: runs[i + 1].value,
        window_start: runs[i + 1].start,
        window_end:   runs[i + 1].start + runs[i + 1].length - 1,
      });
    } else if (i + 1 < runs.length
               && runs[i + 1].value !== r.value
               && runs[i + 1].length >= minRun
               && r.length >= minRun) {
      // Terminal switch is only meaningful once. Avoid duplicating
      // when the next iteration would emit the symmetric pair.
      if (switches.length === 0
          || switches[switches.length - 1].window_end < r.start) {
        switches.push({
          type:        MGL_SWITCH_TYPES.TERMINAL_SWITCH,
          regime_outer: r.value,
          regime_inner: runs[i + 1].value,
          window_start: runs[i + 1].start,
          window_end:   runs[i + 1].start + runs[i + 1].length - 1,
        });
      }
    } else if (i + 1 < runs.length
               && runs[i + 1].value !== r.value
               && runs[i + 1].length < minRun) {
      switches.push({
        type:        MGL_SWITCH_TYPES.BRIEF_SWITCH,
        regime_outer: r.value,
        regime_inner: runs[i + 1].value,
        window_start: runs[i + 1].start,
        window_end:   runs[i + 1].start + runs[i + 1].length - 1,
      });
    }
  }
  return switches;
}

// =====================================================================
// 4. Scenario classifier
// =====================================================================

/**
 * Map the regime sequence + switch list to one of the 4 scenarios.
 *
 *   stable_inversion         → 1 sustained regime end-to-end
 *   one_inv_with_recombinant → at least one RETURN_SWITCH; outer
 *                              regime spans most of the candidate
 *   two_adjacent_inversions  → exactly 2 regimes split into 2
 *                              halves with no return
 *   nested_rearrangement     → 3+ regimes with a symmetric repeat
 *                              pattern (R1-R2-R2-R1 or finer)
 *
 * @param {{regime_ids:Int32Array, n_regimes:number}} rg
 * @param {Array<Object>} switches    output of detectSwitches
 * @param {Object} [opts]
 * @returns {string}                  one of MGL_ARCHITECTURE_SCENARIOS values
 */
export function classifyArchitectureScenario(rg, switches, opts) {
  const o = opts || {};
  if (!rg || !rg.regime_ids || rg.regime_ids.length === 0) {
    return MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA;
  }
  const ids = rg.regime_ids;
  const n_windows = ids.length;
  // Drop zero-regime (missing-data) windows from the regime count.
  let n_real_regimes = 0;
  for (let r = 1; r <= rg.n_regimes; r++) {
    for (let i = 0; i < n_windows; i++) {
      if (ids[i] === r) { n_real_regimes++; break; }
    }
  }
  if (n_real_regimes <= 1) {
    return MGL_ARCHITECTURE_SCENARIOS.STABLE_INVERSION;
  }
  const subs = Array.isArray(switches) ? switches : [];
  const returns = subs.filter(s => s.type === MGL_SWITCH_TYPES.RETURN_SWITCH);
  const terminals = subs.filter(s => s.type === MGL_SWITCH_TYPES.TERMINAL_SWITCH);

  if (returns.length >= 1 && n_real_regimes === 2) {
    return MGL_ARCHITECTURE_SCENARIOS.ONE_INVERSION_WITH_RECOMBINANT;
  }
  if (terminals.length >= 1 && returns.length === 0 && n_real_regimes === 2) {
    return MGL_ARCHITECTURE_SCENARIOS.TWO_ADJACENT_INVERSIONS;
  }
  if (n_real_regimes >= 3 && _hasSymmetricRepeat(ids)) {
    return MGL_ARCHITECTURE_SCENARIOS.NESTED_REARRANGEMENT;
  }
  return MGL_ARCHITECTURE_SCENARIOS.COMPLEX_OR_UNCLEAR;
}

function _hasSymmetricRepeat(ids) {
  // Walk RLE runs and check whether the sequence of regime values
  // is a palindrome of length ≥ 4 (e.g. [R1, R2, R2, R1] or
  // [R1, R2, R3, R2, R1]).
  const runs = runLengthEncode(ids);
  const seq = runs.map(r => r.value);
  if (seq.length < 4) return false;
  let i = 0, j = seq.length - 1;
  while (i < j) {
    if (seq[i] !== seq[j]) return false;
    i++; j--;
  }
  return true;
}

// =====================================================================
// 5. End-to-end: profiles → fingerprint summary
// =====================================================================

/**
 * Top-level orchestrator. Given per-window profile rows + the band
 * list, produces the full fingerprinter output:
 *
 *   - per-window rank signatures + regime IDs
 *   - switch list
 *   - architecture scenario verdict
 *
 * @param {Array<Object>} window_profiles   per-window profiles
 * @param {string[]} bands                  sorted band IDs
 * @param {Object} [opts]
 * @returns {{
 *   windows: Array<{idx:number, regime_id:number,
 *                    rank_signature:Object|null,
 *                    signature_key:string}>,
 *   n_regimes: number,
 *   switches:  Array<Object>,
 *   scenario:  string,
 * }}
 */
export function fingerprintCandidate(window_profiles, bands, opts) {
  if (!Array.isArray(window_profiles) || window_profiles.length === 0
      || !Array.isArray(bands) || bands.length < 2) {
    return {
      windows: [], n_regimes: 0, switches: [],
      scenario: MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA,
    };
  }
  // Stage 2 — rank signatures.
  const records = window_profiles.map((p, idx) => {
    const sig = windowRankSignature(p, bands);
    return {
      idx,
      rank_signature: sig,
      signature_key: rankSignatureKey(sig),
    };
  });
  // Stage 3 Method B — regime IDs.
  const rg = regimeIdsByRankEquivalence(records);
  // Switch detection.
  const switches = detectSwitches(rg.regime_ids, opts);
  // Attach regime_id to each record.
  for (let i = 0; i < records.length; i++) {
    records[i].regime_id = rg.regime_ids[i];
  }
  // Scenario classification.
  const scenario = classifyArchitectureScenario(rg, switches, opts);
  return {
    windows:   records,
    n_regimes: rg.n_regimes,
    switches,
    scenario,
  };
}
