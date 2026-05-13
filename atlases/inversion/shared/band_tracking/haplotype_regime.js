// shared/band_tracking/haplotype_regime.js
// =====================================================================
// LAYER 2 — long-range haplotype regime refinement.
//
// Consumes a set of het-skeleton intervals (output of
// het.js#het_track_skeleton + #het_define_interval, optionally
// pre-merged via iv_merge_het_tracks) PLUS the per-interval
// HOM_A / HOM_B / HET sample-core sets (output of
// hom.js#hom_anchor_to_het), and emits LONG-RANGE REGIMES —
// chains of intervals that share haplotype identity across a larger
// genomic range than any single skeleton spans.
//
// Why this matters: a single het-skeleton stops where its Jaccard
// chain breaks (e.g. when K-means re-labels at a strict envelope
// boundary, or when the inversion's recombination rate locally
// changes the band footprint). The same biological inversion can
// span MULTIPLE skeletons — they're broken by analysis artefacts,
// not by biology. Long-range regime refinement reconnects them.
//
// Five exports:
//
//   intervalSampleCore(interval, opts?)
//      Extract canonical sample-core sets {hom_a, hom_b, het} from
//      one interval. Defaults to interval.hom_a_consensus /
//      hom_b_consensus / het_core (from hom.js + skeleton).
//
//   relateIntervals(intervalA, intervalB, opts?)
//      Pairwise relationship between two intervals. Computes
//      Jaccard overlaps of {hom_a, hom_b, het} sample sets and
//      classifies the relationship as:
//        - EXTENSION    HOM_A and HOM_B sets ≈ identical
//        - NESTED       one interval's sample-core is a subset
//        - SHARED_HET   het cores overlap but homs differ
//        - SWAPPED      A.hom_a ≈ B.hom_b (orientation flip)
//        - UNRELATED    overlaps below threshold
//      Plus the bp gap and an overall affinity score [0, 1].
//
//   buildHaplotypeRegimeGraph(intervals, opts?)
//      All-pairs application of relateIntervals → edge list of
//      (i, j, relationship, affinity) plus N×N affinity matrix.
//
//   clusterHaplotypeRegimes(graph, opts?)
//      Union-find over EXTENSION + SWAPPED edges (each is the same
//      regime, possibly with sign flip). Returns regime_of[] +
//      regime_sign[] + regime metadata.
//
//   refineRegimesFromIntervals(intervals, opts?)
//      Top-level orchestrator: graph + clustering + per-regime
//      summary (bp span, n_intervals, member skeleton ids,
//      consensus sample-cores).

import { bandJaccard } from './single_band.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

export const HAPLOTYPE_REGIME_RELATIONSHIPS = Object.freeze({
  EXTENSION:  'extension',
  NESTED:     'nested',
  SHARED_HET: 'shared_het',
  SWAPPED:    'swapped',
  UNRELATED:  'unrelated',
});

export const HAPLOTYPE_REGIME_DEFAULTS = Object.freeze({
  // Minimum mean Jaccard across (hom_a, hom_b, het) for EXTENSION.
  extension_min_mean_jaccard: 0.70,
  // Minimum subset fraction for NESTED.
  nested_min_subset_frac: 0.85,
  // SHARED_HET when het Jaccard ≥ this AND homs don't qualify.
  shared_het_min_jaccard: 0.60,
  // SWAPPED when A.hom_a ↔ B.hom_b Jaccard AND A.hom_b ↔ B.hom_a
  // Jaccard both ≥ this (with the straight pair below it).
  swapped_min_cross_jaccard: 0.70,
  // Max bp gap (one-side) for EXTENSION / SWAPPED to be considered.
  max_gap_bp: 500_000,
  // Clustering threshold: minimum affinity to merge two intervals
  // into the same regime.
  cluster_min_affinity: 0.60,
});

// =====================================================================
// 1. intervalSampleCore — normalised view
// =====================================================================

/**
 * Normalise a het-interval into {hom_a, hom_b, het, start_bp,
 * end_bp, id} — caller-agnostic shape consumed by every other
 * helper below.
 *
 * Accepted input shapes (in priority order):
 *   - { hom_a_consensus, hom_b_consensus, het_core,
 *       start_bp, end_bp, id? }
 *   - { hom_a, hom_b, het, start_bp, end_bp, id? }
 *   - { hom_anchor: { hom_a_consensus, hom_b_consensus, ...},
 *       skeleton, start_bp, end_bp, id? }
 *
 * Returns null when no usable sample sets are present.
 *
 * @param {Object} interval
 * @returns {{hom_a:Set<number>, hom_b:Set<number>, het:Set<number>,
 *           start_bp:number, end_bp:number, id:any}|null}
 */
export function intervalSampleCore(interval) {
  if (!interval) return null;
  const a = interval.hom_a_consensus || interval.hom_a
            || (interval.hom_anchor && interval.hom_anchor.hom_a_consensus);
  const b = interval.hom_b_consensus || interval.hom_b
            || (interval.hom_anchor && interval.hom_anchor.hom_b_consensus);
  const h = interval.het_core || interval.het
            || (interval.skeleton && interval.skeleton.het_core);
  if (!a && !b && !h) return null;
  return {
    hom_a: a instanceof Set ? a : new Set(a || []),
    hom_b: b instanceof Set ? b : new Set(b || []),
    het:   h instanceof Set ? h : new Set(h || []),
    start_bp: Number.isFinite(interval.start_bp) ? interval.start_bp : 0,
    end_bp:   Number.isFinite(interval.end_bp)   ? interval.end_bp   : 0,
    id: interval.id != null ? interval.id : null,
  };
}

// =====================================================================
// 2. relateIntervals — pairwise relationship + affinity
// =====================================================================

/**
 * Pairwise relationship between two intervals.
 *
 * @param {Object} a  raw interval (any shape intervalSampleCore accepts)
 * @param {Object} b
 * @param {Object} [opts]
 * @returns {{
 *   relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.*,
 *   affinity:     number ∈ [0, 1],
 *   gap_bp:       number,
 *   sign:         +1 | -1,    // SWAPPED → -1, otherwise +1
 *   jaccards:     {hom_a, hom_b, het, cross_a_b, cross_b_a},
 * }}
 */
export function relateIntervals(a, b, opts) {
  const A = intervalSampleCore(a);
  const B = intervalSampleCore(b);
  if (!A || !B) {
    return {
      relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED,
      affinity: 0, gap_bp: Infinity, sign: 1,
      jaccards: { hom_a: 0, hom_b: 0, het: 0, cross_a_b: 0, cross_b_a: 0 },
    };
  }
  const o = opts || {};
  const extThr   = Number.isFinite(o.extension_min_mean_jaccard)
    ? o.extension_min_mean_jaccard
    : HAPLOTYPE_REGIME_DEFAULTS.extension_min_mean_jaccard;
  const nestThr  = Number.isFinite(o.nested_min_subset_frac)
    ? o.nested_min_subset_frac
    : HAPLOTYPE_REGIME_DEFAULTS.nested_min_subset_frac;
  const hetThr   = Number.isFinite(o.shared_het_min_jaccard)
    ? o.shared_het_min_jaccard
    : HAPLOTYPE_REGIME_DEFAULTS.shared_het_min_jaccard;
  const swapThr  = Number.isFinite(o.swapped_min_cross_jaccard)
    ? o.swapped_min_cross_jaccard
    : HAPLOTYPE_REGIME_DEFAULTS.swapped_min_cross_jaccard;
  const maxGap   = Number.isFinite(o.max_gap_bp)
    ? o.max_gap_bp
    : HAPLOTYPE_REGIME_DEFAULTS.max_gap_bp;

  const jHa = bandJaccard(A.hom_a, B.hom_a);
  const jHb = bandJaccard(A.hom_b, B.hom_b);
  const jHet = bandJaccard(A.het, B.het);
  const jCrossAb = bandJaccard(A.hom_a, B.hom_b);
  const jCrossBa = bandJaccard(A.hom_b, B.hom_a);
  const jaccards = {
    hom_a: jHa, hom_b: jHb, het: jHet,
    cross_a_b: jCrossAb, cross_b_a: jCrossBa,
  };
  const meanStraight = (jHa + jHb + jHet) / 3;
  const meanSwapped  = (jCrossAb + jCrossBa + jHet) / 3;
  // bp gap: 0 if overlapping, else (later.start - earlier.end).
  const earlier_end = Math.min(A.end_bp, B.end_bp);
  const later_start = Math.max(A.start_bp, B.start_bp);
  const gap_bp = Math.max(0, later_start - earlier_end);

  // SWAPPED check first: only when cross-pair clearly beats straight.
  if (jCrossAb >= swapThr && jCrossBa >= swapThr
      && meanSwapped > meanStraight && gap_bp <= maxGap) {
    return {
      relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.SWAPPED,
      affinity: meanSwapped,
      gap_bp, sign: -1, jaccards,
    };
  }
  if (meanStraight >= extThr && gap_bp <= maxGap) {
    return {
      relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION,
      affinity: meanStraight,
      gap_bp, sign: 1, jaccards,
    };
  }
  // NESTED: one interval's sample-core ⊆ the other's. Test the
  // smaller side's content fraction inside the larger.
  function subsetFrac(small, large) {
    if (!small || small.size === 0) return 0;
    let inSmall = 0;
    for (const x of small) if (large.has(x)) inSmall++;
    return inSmall / small.size;
  }
  const aHomAll = new Set(A.hom_a); for (const x of A.hom_b) aHomAll.add(x);
  const bHomAll = new Set(B.hom_a); for (const x of B.hom_b) bHomAll.add(x);
  const subAB = aHomAll.size > 0 && bHomAll.size > 0
    ? subsetFrac(aHomAll.size <= bHomAll.size ? aHomAll : bHomAll,
                 aHomAll.size <= bHomAll.size ? bHomAll : aHomAll)
    : 0;
  if (subAB >= nestThr && gap_bp <= maxGap) {
    return {
      relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.NESTED,
      affinity: subAB,
      gap_bp, sign: 1, jaccards,
    };
  }
  if (jHet >= hetThr && gap_bp <= maxGap) {
    return {
      relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.SHARED_HET,
      affinity: jHet,
      gap_bp, sign: 1, jaccards,
    };
  }
  return {
    relationship: HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED,
    affinity: Math.max(meanStraight, meanSwapped),
    gap_bp, sign: 1, jaccards,
  };
}

// =====================================================================
// 3. buildHaplotypeRegimeGraph
// =====================================================================

/**
 * All-pairs application of relateIntervals.
 *
 * Returns:
 *   {
 *     n_intervals,
 *     edges: [{i, j, relationship, affinity, gap_bp, sign, jaccards}],
 *     affinity_matrix: Float64Array(N*N),
 *     relationship_matrix: Array<Array<string>>,
 *   }
 *
 * Edges include only non-UNRELATED relationships. Self-edges
 * excluded. `edges` is sorted by affinity desc for downstream
 * clustering.
 *
 * @param {Array<Object>} intervals
 * @param {Object} [opts]
 * @returns {Object}
 */
export function buildHaplotypeRegimeGraph(intervals, opts) {
  const N = Array.isArray(intervals) ? intervals.length : 0;
  const edges = [];
  const affinity_matrix = new Float64Array(N * N);
  const relationship_matrix = Array.from({ length: N }, () => new Array(N).fill(
    HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED));
  for (let i = 0; i < N; i++) {
    affinity_matrix[i * N + i] = 1;
    relationship_matrix[i][i] = HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION;
    for (let j = i + 1; j < N; j++) {
      const r = relateIntervals(intervals[i], intervals[j], opts);
      affinity_matrix[i * N + j] = r.affinity;
      affinity_matrix[j * N + i] = r.affinity;
      relationship_matrix[i][j] = r.relationship;
      relationship_matrix[j][i] = r.relationship;
      if (r.relationship !== HAPLOTYPE_REGIME_RELATIONSHIPS.UNRELATED) {
        edges.push({
          i, j,
          relationship: r.relationship,
          affinity: r.affinity,
          gap_bp: r.gap_bp,
          sign: r.sign,
          jaccards: r.jaccards,
        });
      }
    }
  }
  edges.sort((x, y) => y.affinity - x.affinity);
  return {
    n_intervals: N,
    edges,
    affinity_matrix,
    relationship_matrix,
  };
}

// =====================================================================
// 4. clusterHaplotypeRegimes
// =====================================================================

/**
 * Union-find over EXTENSION + SWAPPED edges (each merges two
 * intervals into the same regime; SWAPPED carries a sign flip).
 * NESTED edges DO NOT auto-merge (they're a structural relationship,
 * not a regime identity) — caller can opt into merging nested with
 * `opts.merge_nested = true`.
 *
 * SHARED_HET edges also stay separate by default — a shared het
 * core can still mean different homozygote backgrounds (different
 * inversions sharing one HET phenotype). Caller can opt in via
 * `opts.merge_shared_het = true`.
 *
 * Returns:
 *   {
 *     n_regimes,
 *     regime_of:    Int32Array(N),
 *     regime_sign:  Int8Array(N),    // +1 or -1 relative to root
 *     regime_meta:  Array<{
 *       regime_id, n_intervals, member_ids[], sign_split,
 *     }>,
 *   }
 *
 * @param {Object} graph  output of buildHaplotypeRegimeGraph
 * @param {{merge_nested?:boolean, merge_shared_het?:boolean,
 *          cluster_min_affinity?:number}} [opts]
 * @returns {Object}
 */
export function clusterHaplotypeRegimes(graph, opts) {
  const o = opts || {};
  const minAff = Number.isFinite(o.cluster_min_affinity)
    ? o.cluster_min_affinity
    : HAPLOTYPE_REGIME_DEFAULTS.cluster_min_affinity;
  const mergeNested = !!o.merge_nested;
  const mergeShared = !!o.merge_shared_het;
  const N = graph ? graph.n_intervals : 0;
  const regime_of = new Int32Array(N);
  const regime_sign = new Int8Array(N);
  if (N === 0) {
    return {
      n_regimes: 0,
      regime_of, regime_sign,
      regime_meta: [],
    };
  }
  // Union-find with sign propagation.
  const parent = new Int32Array(N);
  const sign = new Int8Array(N);
  for (let i = 0; i < N; i++) { parent[i] = i; sign[i] = 1; }
  function find(x) {
    let acc = 1;
    while (parent[x] !== x) { acc *= sign[x]; x = parent[x]; }
    return { root: x, sign: acc };
  }
  function union(a, b, relSign) {
    const fa = find(a), fb = find(b);
    if (fa.root === fb.root) return;
    parent[fb.root] = fa.root;
    sign[fb.root] = (fa.sign * relSign * fb.sign) > 0 ? 1 : -1;
  }
  for (const e of graph.edges) {
    if (e.affinity < minAff) continue;
    const r = e.relationship;
    if (r === HAPLOTYPE_REGIME_RELATIONSHIPS.EXTENSION
        || r === HAPLOTYPE_REGIME_RELATIONSHIPS.SWAPPED) {
      union(e.i, e.j, e.sign);
    } else if (r === HAPLOTYPE_REGIME_RELATIONSHIPS.NESTED && mergeNested) {
      union(e.i, e.j, 1);
    } else if (r === HAPLOTYPE_REGIME_RELATIONSHIPS.SHARED_HET && mergeShared) {
      union(e.i, e.j, 1);
    }
  }
  // Compact regime ids and record meta.
  const remap = new Map();
  let next = 0;
  const memberLists = [];
  for (let i = 0; i < N; i++) {
    const f = find(i);
    if (!remap.has(f.root)) {
      remap.set(f.root, next);
      memberLists.push([]);
      next++;
    }
    const rid = remap.get(f.root);
    regime_of[i] = rid;
    regime_sign[i] = f.sign;
    memberLists[rid].push({ idx: i, sign: f.sign });
  }
  const regime_meta = memberLists.map((members, rid) => {
    const ids = members.map(m => m.idx);
    let nPos = 0, nNeg = 0;
    for (const m of members) {
      if (m.sign === -1) nNeg++; else nPos++;
    }
    return {
      regime_id: rid,
      n_intervals: members.length,
      member_ids: ids,
      sign_split: nNeg > 0 && nPos > 0,
    };
  });
  return { n_regimes: next, regime_of, regime_sign, regime_meta };
}

// =====================================================================
// 5. refineRegimesFromIntervals — top-level orchestrator
// =====================================================================

/**
 * Top-level: takes raw intervals, builds the affinity graph,
 * clusters into long-range regimes, and returns a structured
 * report with per-regime bp span + consensus sample-cores.
 *
 * Per-regime consensus sample-cores are computed as INTERSECTION of
 * member-interval sample-cores (samples that are HOM_A in EVERY
 * extension-linked interval count as the regime's HOM_A; samples
 * with SWAPPED links flip into HOM_B per their sign).
 *
 * @param {Array<Object>} intervals
 * @param {Object} [opts]
 * @returns {{
 *   ok:           boolean,
 *   n_intervals:  number,
 *   n_regimes:    number,
 *   graph:        ReturnType<typeof buildHaplotypeRegimeGraph>,
 *   regimes:      Array<{
 *     regime_id,
 *     member_ids[],
 *     sign_split,
 *     start_bp, end_bp,
 *     n_intervals,
 *     hom_a_intersect:Set<number>,
 *     hom_b_intersect:Set<number>,
 *     het_union:Set<number>,
 *   }>,
 *   regime_of:    Int32Array,
 *   regime_sign:  Int8Array,
 * }}
 */
export function refineRegimesFromIntervals(intervals, opts) {
  if (!Array.isArray(intervals)) {
    return {
      ok: false, n_intervals: 0, n_regimes: 0,
      graph: null, regimes: [],
      regime_of: new Int32Array(0), regime_sign: new Int8Array(0),
    };
  }
  const graph = buildHaplotypeRegimeGraph(intervals, opts);
  const clustering = clusterHaplotypeRegimes(graph, opts);
  const cores = intervals.map(intervalSampleCore);
  // Build per-regime intersections.
  const regimes = clustering.regime_meta.map(meta => {
    const members = meta.member_ids;
    let hom_a_int = null, hom_b_int = null;
    const het_union = new Set();
    let start_bp = Infinity, end_bp = -Infinity;
    for (const idx of members) {
      const c = cores[idx];
      if (!c) continue;
      // Apply sign flip: regime_sign[idx] = -1 → swap hom_a/hom_b.
      const sign = clustering.regime_sign[idx];
      const aSrc = sign === -1 ? c.hom_b : c.hom_a;
      const bSrc = sign === -1 ? c.hom_a : c.hom_b;
      if (hom_a_int === null) {
        hom_a_int = new Set(aSrc);
        hom_b_int = new Set(bSrc);
      } else {
        for (const x of hom_a_int) if (!aSrc.has(x)) hom_a_int.delete(x);
        for (const x of hom_b_int) if (!bSrc.has(x)) hom_b_int.delete(x);
      }
      for (const x of c.het) het_union.add(x);
      if (Number.isFinite(c.start_bp) && c.start_bp < start_bp) start_bp = c.start_bp;
      if (Number.isFinite(c.end_bp)   && c.end_bp   > end_bp)   end_bp   = c.end_bp;
    }
    return {
      regime_id: meta.regime_id,
      member_ids: members,
      sign_split: meta.sign_split,
      start_bp: Number.isFinite(start_bp) ? start_bp : 0,
      end_bp:   Number.isFinite(end_bp)   ? end_bp   : 0,
      n_intervals: meta.n_intervals,
      hom_a_intersect: hom_a_int || new Set(),
      hom_b_intersect: hom_b_int || new Set(),
      het_union,
    };
  });
  return {
    ok: true,
    n_intervals: intervals.length,
    n_regimes: clustering.n_regimes,
    graph,
    regimes,
    regime_of:   clustering.regime_of,
    regime_sign: clustering.regime_sign,
  };
}
