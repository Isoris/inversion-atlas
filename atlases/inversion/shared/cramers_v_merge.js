// atlases/inversion/shared/cramers_v_merge.js
// =============================================================================
// Cramér's V seed-merge auto-promote — Mode 1 (insulated_local).
//
// Implements SPEC_cramers_v_seed_merge.md Phase 1 deliverable #1
// (the pure-compute driver). Walks adjacent-seed pairs, runs a
// Hungarian-aligned K×K contingency test (chi-square + Cramér's V),
// emits a MERGE / SEPARATE verdict per pair, then groups consecutive
// MERGEs into chains. Each chain → one candidate-shaped region.
//
// "Insulated_local" = the walker NEVER compares non-adjacent seeds. A
// spurious distant-window contingency match cannot pull two local
// regions together. Cost: misses long-range homology by design (that's
// what the long-range V-walker pipeline already handles).
//
// Mode 2 (post_long_range, bounded within macrostripes) shares the
// same `computeAdjacentSeedMerges` core — Mode 2's driver just filters
// the seed list to within-locus pairs before calling the walker.
//
// All compute is pure. Caller provides:
//   - `seeds`        : Array<{seed_id, anchor_w, s_window, e_window, K_a}>
//   - `getLabels(w)` : (w:number) → Int8Array|null    K-means labels at window w
//   - `getK(w)`      : (w:number) → number             K-bands used at w
//   - `opts.mergeThr`, `opts.alpha`, `opts.minSamples` — tuning knobs.
//
// The contingency math reuses shared/contingency.js + shared/hungarian.js
// — same kernel the L3 panel's pair-compare and the L3 adjacent-pair
// mini-table on haplotype_regimes use.
// =============================================================================

import { alignLabels }            from './hungarian.js';
import { buildContingency,
         cramersV, chiSquare,
         chiSqSurvival }          from './contingency.js';

export const CRAMERS_V_MERGE_DEFAULTS = Object.freeze({
  /** Cramér's V above this → MERGE. Same default as state.mergeThr. */
  mergeThr:    0.85,
  /** Chi-square p-value gate. */
  alpha:       0.05,
  /** Min samples present in BOTH seeds for a usable verdict. */
  minSamples:  4,
});

/**
 * Compute MERGE / SEPARATE verdicts for every adjacent seed pair.
 *
 * @param {Object} args
 * @param {Array<{seed_id?:number, anchor_w:number, s_window:number, e_window:number, K_a?:number}>} args.seeds
 * @param {(w:number) => ArrayLike<number>|null} args.getLabels
 * @param {(w:number) => number}                 args.getK
 * @param {Object} [args.opts]
 * @returns {Array<{
 *   iA:number, iB:number,
 *   seedA:Object, seedB:Object,
 *   v:number, chi2:number, df:number, p_value:number,
 *   K:number, n_samples:number,
 *   verdict:'MERGE'|'SEPARATE'|'INSUFFICIENT',
 *   reason?:string
 * }>}
 */
export function computeAdjacentSeedMerges(args) {
  const seeds = (args && Array.isArray(args.seeds)) ? args.seeds.slice() : [];
  const getLabels = args && args.getLabels;
  const getK = args && args.getK;
  const o = Object.assign({}, CRAMERS_V_MERGE_DEFAULTS, (args && args.opts) || {});
  if (seeds.length < 2 || typeof getLabels !== 'function') return [];
  // Sort by anchor_w so "adjacent" means "next in genomic order".
  seeds.sort((a, b) => (a.anchor_w | 0) - (b.anchor_w | 0));
  const out = [];
  for (let i = 0; i + 1 < seeds.length; i++) {
    const seedA = seeds[i];
    const seedB = seeds[i + 1];
    const labelsA = getLabels(seedA.anchor_w | 0);
    const labelsB = getLabels(seedB.anchor_w | 0);
    if (!labelsA || !labelsB) {
      out.push({
        iA: i, iB: i + 1, seedA, seedB,
        v: NaN, chi2: NaN, df: 0, p_value: NaN,
        K: 0, n_samples: 0,
        verdict: 'INSUFFICIENT',
        reason: !labelsA ? `no labels at seed ${i}` : `no labels at seed ${i + 1}`,
      });
      continue;
    }
    const KA = (typeof getK === 'function' ? getK(seedA.anchor_w | 0) : 0)
            || seedA.K_a || 0;
    const KB = (typeof getK === 'function' ? getK(seedB.anchor_w | 0) : 0)
            || seedB.K_a || 0;
    const K = Math.max(KA | 0, KB | 0);
    if (K < 2) {
      out.push({
        iA: i, iB: i + 1, seedA, seedB,
        v: NaN, chi2: NaN, df: 0, p_value: NaN,
        K, n_samples: 0,
        verdict: 'INSUFFICIENT',
        reason: 'K < 2',
      });
      continue;
    }
    // Hungarian-align B onto A's K-band frame so cluster ids correspond.
    let alignedB = labelsB;
    try {
      const r = alignLabels(labelsA, labelsB, K);
      if (r && r.aligned) alignedB = r.aligned;
      else if (r && Array.isArray(r)) alignedB = r;
    } catch (_) { /* fall through with raw B */ }
    // Restrict to samples that have valid labels in BOTH seeds.
    const nS = Math.max(labelsA.length | 0, alignedB.length | 0);
    const aSub = [];
    const bSub = [];
    for (let s = 0; s < nS; s++) {
      const ka = labelsA[s];
      const kb = alignedB[s];
      if (ka >= 0 && ka < K && kb >= 0 && kb < K) {
        aSub.push(ka | 0);
        bSub.push(kb | 0);
      }
    }
    if (aSub.length < (o.minSamples | 0)) {
      out.push({
        iA: i, iB: i + 1, seedA, seedB,
        v: NaN, chi2: NaN, df: 0, p_value: NaN,
        K, n_samples: aSub.length,
        verdict: 'INSUFFICIENT',
        reason: `n=${aSub.length} < min=${o.minSamples}`,
      });
      continue;
    }
    let v = NaN, chi2 = NaN, df = (K - 1) * (K - 1), p_value = NaN;
    try {
      const table = buildContingency(
        Int32Array.from(aSub),
        Int32Array.from(bSub),
        K, K
      );
      v = cramersV(table, K, K);
      const cs = chiSquare(table, K);
      if (cs) {
        chi2 = cs.chi2;
        if (Number.isFinite(cs.df)) df = cs.df;
      }
      if (Number.isFinite(chi2)) p_value = chiSqSurvival(chi2, df);
    } catch (_) { /* leave NaN; verdict falls to INSUFFICIENT below */ }
    let verdict = 'SEPARATE';
    let reason = null;
    if (!Number.isFinite(v) || !Number.isFinite(p_value)) {
      verdict = 'INSUFFICIENT';
      reason = 'contingency compute returned NaN';
    } else if (v >= (o.mergeThr || 0) && p_value <= (o.alpha || 1)) {
      verdict = 'MERGE';
    }
    out.push({
      iA: i, iB: i + 1, seedA, seedB,
      v, chi2, df, p_value,
      K, n_samples: aSub.length,
      verdict, reason,
    });
  }
  return out;
}

/**
 * Group consecutive MERGE verdicts into chains. Each chain is a
 * sequence of seed indices [start_i, ..., end_i] (inclusive on both
 * ends) where every adjacent pair (start_i..end_i-1) was MERGE.
 * Single seeds with no MERGE neighbour are emitted as length-1 chains
 * iff `opts.emitSingletons` is true; otherwise dropped.
 *
 * @param {Array<{iA:number, iB:number, verdict:string}>} verdicts
 * @param {number} nSeeds   total seed count (so the final seed gets a
 *                          chance to emit as a singleton)
 * @param {{emitSingletons?:boolean}} [opts]
 * @returns {Array<{start_i:number, end_i:number, length:number}>}
 */
export function chainsFromMergeVerdicts(verdicts, nSeeds, opts) {
  const o = opts || {};
  const chains = [];
  if (!Array.isArray(verdicts) || verdicts.length === 0 || nSeeds < 1) return chains;
  let curStart = 0;
  let curEnd   = 0;
  for (let i = 0; i + 1 < nSeeds; i++) {
    // Find the verdict between seed i and seed i+1.
    const ve = verdicts[i];
    if (ve && ve.verdict === 'MERGE') {
      curEnd = i + 1;
    } else {
      if (o.emitSingletons || curEnd > curStart) {
        chains.push({ start_i: curStart, end_i: curEnd, length: curEnd - curStart + 1 });
      }
      curStart = i + 1;
      curEnd   = i + 1;
    }
  }
  if (o.emitSingletons || curEnd > curStart) {
    chains.push({ start_i: curStart, end_i: curEnd, length: curEnd - curStart + 1 });
  }
  return chains;
}

/**
 * Mode 1 driver — `insulated_local`. Walks adjacent-seed verdicts
 * across the entire chrom (no macrostripe filtering), groups MERGE
 * runs into chains, and returns chain ranges suitable for direct
 * conversion into candidate inversions.
 *
 * Caller (the page) does the candidate-list addition + persistence —
 * this driver is pure compute. See haplotype_regimes.js#_runCramersVAutoMerge.
 *
 * @param {Object} args  same as computeAdjacentSeedMerges + nothing extra
 * @returns {{
 *   mode: 'insulated_local',
 *   verdicts: Array,
 *   chains:   Array<{start_i:number, end_i:number, length:number}>,
 *   summary:  { n_seeds:number, n_pairs:number, n_merge:number,
 *               n_separate:number, n_insufficient:number,
 *               n_chains:number, n_chains_multi:number }
 * }}
 */
export function runCramersVMergeLocal(args) {
  const seeds = (args && Array.isArray(args.seeds)) ? args.seeds : [];
  const verdicts = computeAdjacentSeedMerges(args);
  const chains = chainsFromMergeVerdicts(verdicts, seeds.length, {
    emitSingletons: !!(args && args.opts && args.opts.emitSingletons),
  });
  let nM = 0, nS = 0, nI = 0;
  for (const v of verdicts) {
    if (v.verdict === 'MERGE') nM++;
    else if (v.verdict === 'SEPARATE') nS++;
    else nI++;
  }
  return {
    mode: 'insulated_local',
    verdicts,
    chains,
    summary: {
      n_seeds:        seeds.length,
      n_pairs:        verdicts.length,
      n_merge:        nM,
      n_separate:     nS,
      n_insufficient: nI,
      n_chains:       chains.length,
      n_chains_multi: chains.filter(c => c.length > 1).length,
    },
  };
}

/**
 * Mode 2 driver — `post_long_range`. Same Cramér's V seed-pair merging
 * as Mode 1, but operates ONLY within each Stage 3 macrostripe so the
 * walker never compares seeds across loci. Long-range Stage 2 voting
 * has already established macrostripe identity; this mode does the
 * finer-grained "where does the macrostripe START and STOP" boundary
 * refinement using the same local contingency test.
 *
 * Seed-to-macrostripe assignment uses spatial containment: a seed is
 * "inside" a locus when its anchor_w ∈ [locus.s_window, locus.e_window].
 * The seed list is filtered per-locus, then computeAdjacentSeedMerges +
 * chainsFromMergeVerdicts run on the filtered list. Each locus
 * contributes 0..N chains; chains are tagged with `locus_idx` so the
 * caller can trace each chain back to its parent macrostripe.
 *
 * @param {Object} args  same as computeAdjacentSeedMerges +
 *                       args.loci — Array<{s_window, e_window, ...}>
 *                       (from runBandingPipeline.stage3.loci)
 * @returns {{
 *   mode: 'post_long_range',
 *   per_locus: Array<{
 *     locus_idx:number, locus:Object, n_seeds:number,
 *     verdicts:Array, chains:Array<{start_i, end_i, length}>
 *   }>,
 *   chains:   Array<{locus_idx:number, seed_start_i:number,
 *                    seed_end_i:number, length:number}>,
 *   summary:  { n_loci:number, n_seeds_total:number, n_pairs:number,
 *               n_merge:number, n_separate:number, n_insufficient:number,
 *               n_chains:number, n_chains_multi:number,
 *               n_loci_with_chains:number }
 * }}
 */
export function runCramersVMergeMacrostripe(args) {
  const seeds = (args && Array.isArray(args.seeds)) ? args.seeds : [];
  const loci  = (args && Array.isArray(args.loci))  ? args.loci  : [];
  const getLabels = args && args.getLabels;
  const getK      = args && args.getK;
  const opts      = (args && args.opts) || {};
  const emitSingletons = !!opts.emitSingletons;
  const perLocus = [];
  const flatChains = [];
  let nPairs = 0, nM = 0, nS = 0, nI = 0;
  let nSeedsTotal = 0;
  let nLociWithChains = 0;
  for (let li = 0; li < loci.length; li++) {
    const locus = loci[li];
    if (!locus) continue;
    const s = locus.s_window | 0;
    const e = locus.e_window | 0;
    // Filter seeds whose anchor falls inside the locus footprint. The
    // SPEC also mentions Stage-2 voting affinity as an alternative
    // assignment rule — spatial containment is the default per the
    // SPEC's open question #1 (simpler; matches "insulated" intent).
    const inside = [];
    for (const sd of seeds) {
      if (!sd) continue;
      const aw = sd.anchor_w | 0;
      if (aw >= s && aw <= e) inside.push(sd);
    }
    nSeedsTotal += inside.length;
    if (inside.length < 2) {
      perLocus.push({
        locus_idx: li, locus,
        n_seeds: inside.length,
        verdicts: [], chains: [],
      });
      continue;
    }
    const verdicts = computeAdjacentSeedMerges({
      seeds: inside, getLabels, getK, opts,
    });
    const chains = chainsFromMergeVerdicts(verdicts, inside.length, {
      emitSingletons,
    });
    nPairs += verdicts.length;
    for (const v of verdicts) {
      if (v.verdict === 'MERGE') nM++;
      else if (v.verdict === 'SEPARATE') nS++;
      else nI++;
    }
    let multiInThisLocus = 0;
    for (const c of chains) {
      if (c.length > 1) multiInThisLocus++;
      flatChains.push({
        locus_idx:    li,
        seed_start_i: c.start_i,
        seed_end_i:   c.end_i,
        length:       c.length,
      });
    }
    if (multiInThisLocus > 0) nLociWithChains++;
    perLocus.push({
      locus_idx: li, locus,
      n_seeds:   inside.length,
      verdicts,  chains,
    });
  }
  return {
    mode: 'post_long_range',
    per_locus: perLocus,
    chains:    flatChains,
    summary: {
      n_loci:              loci.length,
      n_seeds_total:       nSeedsTotal,
      n_pairs:             nPairs,
      n_merge:             nM,
      n_separate:          nS,
      n_insufficient:      nI,
      n_chains:            flatChains.length,
      n_chains_multi:      flatChains.filter(c => c.length > 1).length,
      n_loci_with_chains:  nLociWithChains,
    },
  };
}
