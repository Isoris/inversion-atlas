// shared/band_tracking/genome_scale.js
// =====================================================================
// LAYER 5 — chromosome-scale wiring.
//
// Layer 2 (refineRegimesFromIntervals) runs per chromosome. Layer 3
// (regime_topology) handles intra-chromosome relationships. Layer 4
// (regime_mendelian + regime_pedigree) consumes regimes one at a time
// or a flat array.
//
// Layer 5 unifies per-chromosome Layer-2 outputs into one
// genome-wide regime collection and adds the cross-chromosome
// relationships that intra-chromosome topology can't express —
// most importantly the CHAINED relationship via shared HOM_A / HOM_B
// samples, which is meaningful across any pair of chromosomes
// (multi-inversion lineage spanning the genome).
//
// Per user framing: this is the "scan genomes > find inversions >
// use inversion haplotype regimes to find pedigree" loop closure —
// once regimes are pooled across all chromosomes, the regime_pedigree
// inference has many more cells to evaluate co-membership against,
// and the resulting pairwise classification is much more robust
// than per-chromosome inference.
//
// Four exports:
//
//   mergePerChromosomeRegimes(perChromMap, opts?)
//     Take a Map<chrom_id, Layer-2_refined_output> and produce a
//     single flat array of regimes, each augmented with a `chrom`
//     field + a globally unique `regime_uid` ('chrom:regime_id').
//
//   crossChromosomeRegimeLinks(mergedRegimes, opts?)
//     All-pairs scan that ONLY considers regimes on different
//     chromosomes (intra-chromosome links are Layer 3's job).
//     Emits CHAINED edges between any pair sharing ≥
//     `chained_min_shared` HOM_A or HOM_B samples — multi-
//     inversion lineage map across the genome.
//
//   genomeWidePedigreeFromRegimes(mergedRegimes, sample_list, opts?)
//     Thin wrapper around regime_pedigree.js
//     inferRelatednessFromRegimes, applied to the merged
//     whole-genome regime collection. Much more robust than
//     per-chromosome inference because of the larger n_regimes.
//
//   genomeWideRegimeReport(perChromMap, opts?)
//     Top-level orchestrator: merge → cross-chrom links →
//     optional Mendelian + pedigree → JSON-friendly summary.
//
// Pure JS — no DOM, no fetch.

import {
  inferRelatednessFromRegimes,
} from '../../../popstats/shared/band_tracking/regime_pedigree.js';
import {
  annotateRegimesWithMendelian,
} from '../../../popstats/shared/band_tracking/regime_mendelian.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** Cross-chromosome link types. Only CHAINED and INDEPENDENT apply
 *  across chromosomes — bp geometry (NESTED, ADJACENT, OVERLAPPING)
 *  is meaningless when chromosomes differ. */
export const GENOME_SCALE_LINKS = Object.freeze({
  CHAINED:     'cross_chrom_chained',
  INDEPENDENT: 'cross_chrom_independent',
});

export const GENOME_SCALE_DEFAULTS = Object.freeze({
  // Min shared HOM_A or HOM_B samples for a cross-chromosome CHAINED
  // link. Higher than the intra-chromosome threshold because random
  // sharing increases when comparing across more regimes.
  chained_min_shared:  5,
  // Min Jaccard on the same homozygote side for a cross-chromosome
  // CHAINED link.
  chained_min_jaccard: 0.50,
});

// =====================================================================
// 1. mergePerChromosomeRegimes
// =====================================================================

/**
 * Flatten a per-chromosome regime map into a single annotated array.
 *
 * Input: `perChromMap` = `Map<chrom_id, refinedOutput>` where each
 * refinedOutput is the result of `refineRegimesFromIntervals` for
 * that chromosome.
 *
 * Returns `{ok, n_chroms, n_regimes, regimes, by_chrom}` where
 * `regimes` is a flat array with each entry carrying:
 *   - `chrom`        the chromosome id (key from the map)
 *   - `regime_uid`   stable globally-unique id 'chrom:regime_id'
 *   - everything from the original regime (start_bp, end_bp,
 *     hom_a_intersect, ...)
 *
 * `by_chrom` is `Map<chrom_id, Array<merged_regime_index>>` for
 * fast intra-chrom slicing.
 *
 * @param {Map<string, Object>|Object} perChromMap
 * @param {Object} [opts]
 * @returns {Object}
 */
export function mergePerChromosomeRegimes(perChromMap, opts) {
  if (!perChromMap) {
    return { ok: false, n_chroms: 0, n_regimes: 0,
              regimes: [], by_chrom: new Map() };
  }
  const entries = perChromMap instanceof Map
    ? Array.from(perChromMap.entries())
    : Object.entries(perChromMap);
  const regimes = [];
  const by_chrom = new Map();
  for (const [chrom, refined] of entries) {
    if (!refined || !Array.isArray(refined.regimes)) continue;
    const idxs = [];
    for (const r of refined.regimes) {
      if (!r) continue;
      const merged = Object.assign({}, r, {
        chrom,
        regime_uid: chrom + ':' + r.regime_id,
      });
      idxs.push(regimes.length);
      regimes.push(merged);
    }
    by_chrom.set(chrom, idxs);
  }
  return {
    ok: true,
    n_chroms: by_chrom.size,
    n_regimes: regimes.length,
    regimes,
    by_chrom,
  };
}

// =====================================================================
// 2. crossChromosomeRegimeLinks
// =====================================================================

/**
 * Pairwise scan across regime pairs on DIFFERENT chromosomes. Emits
 * CHAINED edges where ≥ chained_min_shared HOM_A or HOM_B samples
 * coincide AND Jaccard ≥ chained_min_jaccard. Intra-chromosome
 * pairs are skipped — Layer 3 (regime_topology.js) handles those.
 *
 * Returns:
 *   {
 *     edges: [{
 *       i, j,
 *       chrom_a, chrom_b,
 *       regime_uid_a, regime_uid_b,
 *       n_shared_hom_a, n_shared_hom_b, n_shared_max,
 *       hom_a_jaccard, hom_b_jaccard,
 *       link_type: GENOME_SCALE_LINKS.CHAINED
 *     }, ...],
 *     n_edges, n_intra_skipped, n_pairs_evaluated
 *   }
 *
 * Edges sorted by n_shared_max desc.
 *
 * @param {Array<Object>} mergedRegimes  output of mergePerChromosomeRegimes
 * @param {Object} [opts]
 * @returns {Object}
 */
export function crossChromosomeRegimeLinks(mergedRegimes, opts) {
  const o = opts || {};
  const minShared = Number.isFinite(o.chained_min_shared)
    ? o.chained_min_shared : GENOME_SCALE_DEFAULTS.chained_min_shared;
  const minJac = Number.isFinite(o.chained_min_jaccard)
    ? o.chained_min_jaccard : GENOME_SCALE_DEFAULTS.chained_min_jaccard;
  const N = Array.isArray(mergedRegimes) ? mergedRegimes.length : 0;
  const edges = [];
  let nIntraSkipped = 0, nEvaluated = 0;
  for (let i = 0; i < N; i++) {
    const A = mergedRegimes[i];
    for (let j = i + 1; j < N; j++) {
      const B = mergedRegimes[j];
      if (!A || !B) continue;
      if (A.chrom === B.chrom) { nIntraSkipped++; continue; }
      nEvaluated++;
      const aHomA = A.hom_a_intersect, aHomB = A.hom_b_intersect;
      const bHomA = B.hom_a_intersect, bHomB = B.hom_b_intersect;
      // Straight pairing
      const nA  = _intersect(aHomA, bHomA);
      const nB  = _intersect(aHomB, bHomB);
      const jA  = _jac(aHomA, bHomA);
      const jB  = _jac(aHomB, bHomB);
      // Swapped pairing (orientation flip on one side — meaningful
      // cross-chrom because K-means may emit either band first)
      const nAB = _intersect(aHomA, bHomB);
      const nBA = _intersect(aHomB, bHomA);
      const jAB = _jac(aHomA, bHomB);
      const jBA = _jac(aHomB, bHomA);
      const straight_max = Math.max(nA, nB);
      const swapped_max  = Math.max(nAB, nBA);
      const straight_jac = Math.max(jA, jB);
      const swapped_jac  = Math.max(jAB, jBA);
      const useSwap = swapped_max > straight_max
        || (swapped_max === straight_max && swapped_jac > straight_jac);
      const nMax = useSwap ? swapped_max : straight_max;
      const jMax = useSwap ? swapped_jac : straight_jac;
      if (nMax < minShared || jMax < minJac) continue;
      edges.push({
        i, j,
        chrom_a: A.chrom, chrom_b: B.chrom,
        regime_uid_a: A.regime_uid, regime_uid_b: B.regime_uid,
        n_shared_hom_a: useSwap ? nAB : nA,
        n_shared_hom_b: useSwap ? nBA : nB,
        n_shared_max: nMax,
        hom_a_jaccard: useSwap ? jAB : jA,
        hom_b_jaccard: useSwap ? jBA : jB,
        sign: useSwap ? -1 : 1,
        link_type: GENOME_SCALE_LINKS.CHAINED,
      });
    }
  }
  edges.sort((a, b) => b.n_shared_max - a.n_shared_max);
  return {
    edges, n_edges: edges.length,
    n_intra_skipped: nIntraSkipped,
    n_pairs_evaluated: nEvaluated,
  };
}

function _intersect(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let n = 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) n++;
  return n;
}
function _jac(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

// =====================================================================
// 3. genomeWidePedigreeFromRegimes
// =====================================================================

/**
 * Whole-genome pairwise relatedness inference. Thin wrapper around
 * regime_pedigree.js#inferRelatednessFromRegimes — but applied to
 * the merged regime collection, which has many more regimes than
 * any single chromosome, so the same_class_frac estimate is much
 * more stable.
 *
 * Use this rather than calling inferRelatednessFromRegimes per
 * chromosome and trying to average — the merged-genome call IS the
 * correct unit of analysis for IBD-block-style relatedness.
 *
 * @param {Array<Object>} mergedRegimes  output of mergePerChromosomeRegimes
 * @param {Array<number>} sample_list
 * @param {Object} [opts]
 * @returns {Object}  same shape as inferRelatednessFromRegimes
 */
export function genomeWidePedigreeFromRegimes(mergedRegimes, sample_list, opts) {
  return inferRelatednessFromRegimes(sample_list, mergedRegimes || [], opts);
}

// =====================================================================
// 4. genomeWideRegimeReport — orchestrator
// =====================================================================

/**
 * Top-level orchestrator. Merges per-chromosome regimes, finds
 * cross-chromosome CHAINED links, and optionally runs Layer-4
 * Mendelian annotation + Layer-4b pedigree inference.
 *
 * Options:
 *   - opts.trios            forwards to regime_mendelian Method A
 *   - opts.families         forwards to regime_mendelian Method B
 *   - opts.sample_list      forwards to regime_pedigree
 *   - opts.para_peri_rollup forwards to regime_mendelian
 *
 * Returns a JSON-friendly summary (Sets are NOT serialised here —
 * caller can pass the regimes array through serializeRegimesToJson
 * separately to keep this function focused).
 *
 * @param {Map<string, Object>|Object} perChromMap
 * @param {Object} [opts]
 * @returns {Object}
 */
export function genomeWideRegimeReport(perChromMap, opts) {
  const o = opts || {};
  const merged = mergePerChromosomeRegimes(perChromMap, o);
  if (!merged.ok) {
    return { ok: false, n_chroms: 0, n_regimes: 0,
              merged: null, cross_chrom_links: null,
              mendelian: null, pedigree: null };
  }
  const cross = crossChromosomeRegimeLinks(merged.regimes, o);
  const out = {
    ok: true,
    n_chroms: merged.n_chroms,
    n_regimes: merged.n_regimes,
    merged,
    cross_chrom_links: cross,
    mendelian: null,
    pedigree: null,
  };
  if (Array.isArray(o.trios) || Array.isArray(o.families)) {
    out.mendelian = annotateRegimesWithMendelian(merged.regimes, o);
  }
  if (Array.isArray(o.sample_list) && o.sample_list.length > 0) {
    out.pedigree = genomeWidePedigreeFromRegimes(
      merged.regimes, o.sample_list, o);
  }
  return out;
}
