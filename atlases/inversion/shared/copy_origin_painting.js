// shared/copy_origin_painting.js
// =====================================================================
// Copy-origin / paralogue-painting primitives for the SD-breakpoint
// classifier (specs_todo/SPEC_copy_origin_painting.md Steps D + E).
//
// Steps A-C of the spec are upstream data prep (define paralogue
// copies, find paralogue-informative markers, paint reads/windows).
// Those depend on the PSV-calling pipeline, which is data-bound.
//
// Steps D + E are pure compute over the per-window paint output:
//
//   Step D — classify the breakpoint MECHANISM from the sequence
//   of per-window copy calls (NAHR / NHEJ / complex / no mosaic).
//
//   Step E — partition the sample painting by arrangement group
//   (HOM_A / HET / HOM_B from the existing dosage + karyotype
//   machinery) and emit a per-group dominant-copy summary plus
//   the interpretation table (arrangement-specific SD mosaic /
//   no copy-origin difference / complex rearrangement /
//   low-PSV-density uncallable).
//
// Pure JS — no DOM, no fetch.

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Mechanism-classification labels (spec §"Step D — classify
 *  breakpoint mechanism" table). */
export const COPY_ORIGIN_MECHANISMS = Object.freeze({
  NAHR:             'NAHR-compatible',
  NHEJ_MMEJ:        'NHEJ/MMEJ-compatible',
  COMPLEX_MOSAIC:   'complex paralogue mosaic',
  NO_MOSAIC:        'no mosaic evidence',
});

/** Arrangement-group integration verdicts (spec §"Step E"
 *  Interpretation table). */
export const ARRANGEMENT_COPY_VERDICTS = Object.freeze({
  ARRANGEMENT_SPECIFIC: 'arrangement-specific SD mosaic',
  NO_COPY_DIFFERENCE:   'no copy-origin difference',
  COMPLEX_REARRANGEMENT: 'complex rearrangement',
  UNCALLABLE_LOW_PSV:   'low PSV density — uncallable',
});

/** Default thresholds per SPEC §"Step E" Expected-pattern table. */
export const COPY_ORIGIN_DEFAULTS = Object.freeze({
  // A HOM group needs ≥ this dominant-copy share to qualify
  // as "uniform" per spec table.
  hom_dominant_share_min:    0.85,
  // A HET group needs ≥ this share on BOTH expected copies (sum).
  het_dual_share_min:        0.40,
  // Per-copy minimum for HET to count as "mixed".
  het_per_copy_min:          0.20,
  // Below this dominant share for a group → 'ambiguous' origin.
  ambiguous_below:           0.50,
  // Step-D transition scar window (windows with 'unknown' call
  // adjacent to the transition count as scar).
  scar_window:               1,
});

/** Sentinel for an uncalled / ambiguous window. */
export const COPY_UNKNOWN = 'unknown';

// =====================================================================
// 1. Step D — classifyBreakpointMechanism
// =====================================================================

/**
 * Classify the breakpoint mechanism from a sequence of per-window
 * dominant-copy calls (in genomic order).
 *
 * `calls` is an array of strings: each entry is the dominant copy
 * id at that window (e.g. 'copy1', 'copy2', 'copy3'), or the
 * sentinel 'unknown' for windows below the call threshold.
 *
 * Returns:
 *   {
 *     label:               COPY_ORIGIN_MECHANISMS.*,
 *     n_transitions:       int   transitions between distinct copies
 *                                (unknowns are NOT transitions on their own)
 *     distinct_copies:     int   distinct copy ids observed (excl unknowns)
 *     has_scar:            bool  any unknown windows ADJACENT to a
 *                                transition (within scar_window distance)
 *     transition_indices:  Array<int>  call indices at which transitions occur
 *     n_unknowns:          int
 *   }
 *
 * Empty / all-unknown input → NO_MOSAIC (no evidence).
 *
 * @param {Array<string>} calls
 * @param {{scar_window?:number}} [opts]
 * @returns {Object}
 */
export function classifyBreakpointMechanism(calls, opts) {
  const o = opts || {};
  const scarWin = Number.isFinite(o.scar_window)
    ? o.scar_window : COPY_ORIGIN_DEFAULTS.scar_window;
  if (!Array.isArray(calls) || calls.length === 0) {
    return {
      label: COPY_ORIGIN_MECHANISMS.NO_MOSAIC,
      n_transitions: 0, distinct_copies: 0,
      has_scar: false, transition_indices: [], n_unknowns: 0,
    };
  }
  // Build the sequence of NON-unknown calls (with their original indices)
  // so we can count true copy↔copy transitions independently of unknowns.
  const knownCalls = [];
  let n_unknowns = 0;
  for (let i = 0; i < calls.length; i++) {
    const v = calls[i];
    if (v == null || v === COPY_UNKNOWN) { n_unknowns++; continue; }
    knownCalls.push({ idx: i, copy: v });
  }
  if (knownCalls.length === 0) {
    return {
      label: COPY_ORIGIN_MECHANISMS.NO_MOSAIC,
      n_transitions: 0, distinct_copies: 0,
      has_scar: false, transition_indices: [], n_unknowns,
    };
  }
  const distinct = new Set();
  for (const c of knownCalls) distinct.add(c.copy);
  const transitions = [];
  let has_scar = false;
  for (let i = 1; i < knownCalls.length; i++) {
    if (knownCalls[i].copy !== knownCalls[i - 1].copy) {
      const oldIdx = knownCalls[i - 1].idx;
      const newIdx = knownCalls[i].idx;
      transitions.push(newIdx);
      // Scar = unknown call(s) at or near this breakpoint:
      //   (a) one or more unknown windows BETWEEN oldIdx and newIdx
      //   (b) an unknown within scarWin windows before oldIdx
      //   (c) an unknown within scarWin windows after newIdx
      if (newIdx - oldIdx > 1) has_scar = true;
      for (let d = 1; d <= scarWin && !has_scar; d++) {
        if (oldIdx - d >= 0 && calls[oldIdx - d] === COPY_UNKNOWN) {
          has_scar = true; break;
        }
        if (newIdx + d < calls.length && calls[newIdx + d] === COPY_UNKNOWN) {
          has_scar = true; break;
        }
      }
    }
  }
  // Resolve label per spec §"Step D" table.
  let label;
  if (transitions.length === 0) {
    label = COPY_ORIGIN_MECHANISMS.NO_MOSAIC;
  } else if (transitions.length >= 2 || distinct.size >= 3) {
    label = COPY_ORIGIN_MECHANISMS.COMPLEX_MOSAIC;
  } else if (has_scar) {
    label = COPY_ORIGIN_MECHANISMS.NHEJ_MMEJ;
  } else {
    label = COPY_ORIGIN_MECHANISMS.NAHR;
  }
  return {
    label,
    n_transitions: transitions.length,
    distinct_copies: distinct.size,
    has_scar,
    transition_indices: transitions,
    n_unknowns,
  };
}

// =====================================================================
// 2. dominantCopyShare / aggregateCopyShares
// =====================================================================

/**
 * argmax of a copy_shares object (e.g. {copy1: 0.95, copy2: 0.03,
 * copy3: 0.0, unknown: 0.02}). Returns null when all shares are
 * non-finite OR every copy other than `unknown` is zero.
 *
 * `unknown` is excluded from the argmax — it's the sentinel for
 * uncallable mass, not a paralogue.
 *
 * @param {Object} copy_shares
 * @returns {{copy:string, share:number}|null}
 */
export function dominantCopyShare(copy_shares) {
  if (!copy_shares || typeof copy_shares !== 'object') return null;
  let bestCopy = null, bestShare = -Infinity;
  for (const [copy, share] of Object.entries(copy_shares)) {
    if (copy === COPY_UNKNOWN) continue;
    if (!Number.isFinite(share)) continue;
    if (share > bestShare) { bestShare = share; bestCopy = copy; }
  }
  if (bestCopy == null || bestShare <= 0) return null;
  return { copy: bestCopy, share: bestShare };
}

/**
 * Mean copy_shares across a list of samples. Each sample carries a
 * `copy_shares` object; the returned object averages each key
 * independently. Missing keys count as 0 for the average.
 *
 * @param {Array<{copy_shares:Object}>} samples
 * @returns {Object}
 */
export function aggregateCopyShares(samples) {
  const out = Object.create(null);
  if (!Array.isArray(samples) || samples.length === 0) return out;
  const n = samples.length;
  for (const s of samples) {
    if (!s || !s.copy_shares) continue;
    for (const [copy, share] of Object.entries(s.copy_shares)) {
      if (!Number.isFinite(share)) continue;
      out[copy] = (out[copy] || 0) + share / n;
    }
  }
  return out;
}

// =====================================================================
// 3. Step E — partitionPaintingByArrangement
// =====================================================================

/**
 * Partition the per-sample painting by arrangement group
 * (HOM_A / HET / HOM_B) and emit a per-group dominant-copy summary
 * + uniformity check.
 *
 * `samples` shape: array of
 *   {sample_id, arrangement_group: 'HOM_A'|'HET'|'HOM_B'|...,
 *    copy_shares: {copy1, copy2, copy3, unknown, ...}}
 *
 * Returns:
 *   {
 *     by_group: {
 *       HOM_A: {n_samples, mean_shares, dominant: {copy, share},
 *               is_uniform_dominant: bool,
 *               status: 'uniform' | 'mixed' | 'ambiguous'},
 *       HET:   {... + het_dual_share, is_het_mixed: bool},
 *       HOM_B: {...}
 *     },
 *     n_samples_total
 *   }
 *
 * The `is_uniform_dominant` flag is true for HOM groups when the
 * mean dominant share ≥ `hom_dominant_share_min` (default 0.85);
 * the `is_het_mixed` flag is true for HET when the top-2 dominant
 * copies together cover ≥ `het_dual_share_min` (default 0.40) AND
 * each carries ≥ `het_per_copy_min` (default 0.20).
 *
 * @param {Array<Object>} samples
 * @param {Object} [opts]
 * @returns {Object}
 */
export function partitionPaintingByArrangement(samples, opts) {
  const o = opts || {};
  const homMin = Number.isFinite(o.hom_dominant_share_min)
    ? o.hom_dominant_share_min : COPY_ORIGIN_DEFAULTS.hom_dominant_share_min;
  const hetDual = Number.isFinite(o.het_dual_share_min)
    ? o.het_dual_share_min : COPY_ORIGIN_DEFAULTS.het_dual_share_min;
  const hetEach = Number.isFinite(o.het_per_copy_min)
    ? o.het_per_copy_min : COPY_ORIGIN_DEFAULTS.het_per_copy_min;
  const ambBelow = Number.isFinite(o.ambiguous_below)
    ? o.ambiguous_below : COPY_ORIGIN_DEFAULTS.ambiguous_below;

  const grouped = Object.create(null);
  const total = Array.isArray(samples) ? samples.length : 0;
  for (const s of samples || []) {
    if (!s || !s.arrangement_group) continue;
    const g = s.arrangement_group;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(s);
  }
  const by_group = Object.create(null);
  for (const [g, gSamples] of Object.entries(grouped)) {
    const mean_shares = aggregateCopyShares(gSamples);
    const dominant = dominantCopyShare(mean_shares);
    const isHet = g === 'HET' || g === 'AB';
    let is_uniform_dominant = false;
    let is_het_mixed = false;
    let status = 'ambiguous';
    if (dominant) {
      if (!isHet) {
        // HOM groups: check uniform-dominant threshold.
        is_uniform_dominant = dominant.share >= homMin;
        status = is_uniform_dominant
          ? 'uniform'
          : (dominant.share >= ambBelow ? 'mixed' : 'ambiguous');
      } else {
        // HET group: check top-2 dual mix.
        const sorted = Object.entries(mean_shares)
          .filter(([k]) => k !== COPY_UNKNOWN)
          .sort((a, b) => b[1] - a[1]);
        const top1 = sorted[0] ? sorted[0][1] : 0;
        const top2 = sorted[1] ? sorted[1][1] : 0;
        is_het_mixed = (top1 + top2) >= hetDual
          && top1 >= hetEach && top2 >= hetEach;
        status = is_het_mixed
          ? 'mixed'
          : (top1 >= homMin ? 'uniform' : 'ambiguous');
      }
    }
    by_group[g] = {
      n_samples: gSamples.length,
      mean_shares,
      dominant,
      is_uniform_dominant,
      is_het_mixed,
      status,
    };
  }
  return {
    by_group,
    n_samples_total: total,
  };
}

// =====================================================================
// 4. Interpretation table — spec §"Step E"
// =====================================================================

/**
 * Classify the cross-group pattern per spec's interpretation table.
 *
 * Inputs (each is the dominant copy for that group, or `null` /
 * `ambiguous`):
 *   - hom_a_origin: dominant copy id for HOM_A samples
 *   - hom_b_origin: dominant copy id for HOM_B samples
 *   - het_signal:   'mixed' | 'single' | 'ambiguous'
 *
 * Returns one of ARRANGEMENT_COPY_VERDICTS.
 *
 * @param {{hom_a_origin:string|null, hom_b_origin:string|null,
 *          het_signal:string}} args
 * @returns {string}
 */
export function interpretCopyOriginPattern(args) {
  const a = args || {};
  const aO = a.hom_a_origin;
  const bO = a.hom_b_origin;
  const hetS = a.het_signal;
  const isAmbig = (x) => x == null || x === 'ambiguous';
  if (isAmbig(aO) && isAmbig(bO) && (hetS == null || hetS === 'ambiguous')) {
    return ARRANGEMENT_COPY_VERDICTS.UNCALLABLE_LOW_PSV;
  }
  if (!isAmbig(aO) && !isAmbig(bO) && aO !== bO && hetS === 'mixed') {
    return ARRANGEMENT_COPY_VERDICTS.ARRANGEMENT_SPECIFIC;
  }
  if (!isAmbig(aO) && !isAmbig(bO) && aO === bO) {
    return ARRANGEMENT_COPY_VERDICTS.NO_COPY_DIFFERENCE;
  }
  return ARRANGEMENT_COPY_VERDICTS.COMPLEX_REARRANGEMENT;
}

// =====================================================================
// 5. summarizeArrangementCopyOrigin — convenience wrapper
// =====================================================================

/**
 * Convenience: take per-sample painting + arrangement group, run
 * partitionPaintingByArrangement, then interpret the cross-group
 * pattern. Returns the by_group summary + the cohort-level verdict.
 *
 * @param {Array<Object>} samples
 * @param {Object} [opts]
 * @returns {{by_group:Object, verdict:string,
 *           hom_a_origin:string|null, hom_b_origin:string|null,
 *           het_signal:string|null}}
 */
export function summarizeArrangementCopyOrigin(samples, opts) {
  const parts = partitionPaintingByArrangement(samples, opts);
  const homA = parts.by_group.HOM_A;
  const homB = parts.by_group.HOM_B;
  const het  = parts.by_group.HET || parts.by_group.AB;

  const homOrigin = (g) =>
    g && g.dominant && g.is_uniform_dominant ? g.dominant.copy
    : g && g.dominant ? 'ambiguous'
    : null;

  const hetSignal = het ? (het.is_het_mixed ? 'mixed'
    : het.dominant ? 'single' : 'ambiguous') : null;

  const verdict = interpretCopyOriginPattern({
    hom_a_origin: homOrigin(homA),
    hom_b_origin: homOrigin(homB),
    het_signal:   hetSignal,
  });
  return {
    by_group: parts.by_group,
    verdict,
    hom_a_origin: homOrigin(homA),
    hom_b_origin: homOrigin(homB),
    het_signal:   hetSignal,
  };
}
