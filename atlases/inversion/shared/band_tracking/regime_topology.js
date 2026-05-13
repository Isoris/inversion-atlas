// shared/band_tracking/regime_topology.js
// =====================================================================
// LAYER 3 — cross-regime topology + chromosome-scale chains + JSON
// serialisation.
//
// Consumes a SET of long-range regimes (Layer 2 output) and infers
// their pairwise topology:
//
//   NESTED                A's bp footprint sits entirely inside B's
//                         AND their sample-cores are related.
//   ADJACENT              bp ranges abut (gap < threshold) with
//                         mostly-DISJOINT sample-cores — two distinct
//                         adjacent inversions.
//   CHAINED               adjacent regimes where a non-trivial sample
//                         set is HOM_A (or HOM_B) in BOTH — multi-
//                         inversion lineage chain.
//   OVERLAPPING_CONFLICT  bp ranges overlap with disjoint sample-cores
//                         — competing models that can't both be true.
//   INDEPENDENT           no bp overlap AND no sample relationship.
//
// Plus a chromosome-scale chain finder that walks CHAINED edges to
// emit multi-inversion lineage chains, and a JSON serialiser that
// turns the regime structure (with `Set` cores) into an export-
// ready shape.
//
// Pure JS — no DOM, no fetch. All inputs/outputs are plain data.

import { bandJaccard } from './single_band.js';

export const REGIME_TOPOLOGY_RELATIONSHIPS = Object.freeze({
  NESTED:               'nested',
  ADJACENT:             'adjacent',
  CHAINED:              'chained',
  OVERLAPPING_CONFLICT: 'overlapping_conflict',
  INDEPENDENT:          'independent',
});

export const REGIME_TOPOLOGY_DEFAULTS = Object.freeze({
  // Max bp gap for ADJACENT / CHAINED relationships (one-side).
  adjacent_max_gap_bp: 2_000_000,
  // Minimum Jaccard between regime cores to consider them "related".
  related_min_jaccard: 0.30,
  // Minimum fraction of A's bp inside B's bp for NESTED.
  nested_min_bp_frac:  0.80,
  // Minimum shared homozygote-set size to call a CHAINED link.
  chained_min_shared:  3,
  // Minimum HOM_A Jaccard between adjacent regimes for CHAINED.
  chained_min_jaccard: 0.50,
});

// =====================================================================
// 1. regimeBpFootprint — normalise a regime's bp range
// =====================================================================

/**
 * Extract the bp footprint of a regime. Accepts the Layer-2
 * `regime` shape from refineRegimesFromIntervals.
 *
 * @param {Object} regime
 * @returns {{start_bp:number, end_bp:number, length_bp:number}|null}
 */
export function regimeBpFootprint(regime) {
  if (!regime) return null;
  const start = Number.isFinite(regime.start_bp) ? regime.start_bp : null;
  const end   = Number.isFinite(regime.end_bp)   ? regime.end_bp   : null;
  if (start == null || end == null) return null;
  return { start_bp: start, end_bp: end, length_bp: Math.max(0, end - start) };
}

// =====================================================================
// 2. regimePairwiseTopology — relationship between two regimes
// =====================================================================

/**
 * Pairwise relationship between two regimes. Combines bp-range
 * geometry (overlap / containment / gap) with sample-core relatedness.
 *
 * Returns:
 *   {
 *     relationship: REGIME_TOPOLOGY_RELATIONSHIPS.*,
 *     bp_overlap_bp,        bp of intersection (0 if no overlap)
 *     bp_gap_bp,            bp between (0 if overlapping or NaN if one is null)
 *     bp_containment_frac,  bp(intersection) / bp(smaller regime)
 *     hom_a_jaccard,
 *     hom_b_jaccard,
 *     het_jaccard,
 *     chained_shared_hom: int   max(|A.hom_a ∩ B.hom_a|, |A.hom_b ∩ B.hom_b|)
 *   }
 *
 * @param {Object} A   Layer-2 regime
 * @param {Object} B   Layer-2 regime
 * @param {Object} [opts]
 * @returns {Object}
 */
export function regimePairwiseTopology(A, B, opts) {
  const o = opts || {};
  const adjacentMax  = Number.isFinite(o.adjacent_max_gap_bp)
    ? o.adjacent_max_gap_bp
    : REGIME_TOPOLOGY_DEFAULTS.adjacent_max_gap_bp;
  const relatedMin   = Number.isFinite(o.related_min_jaccard)
    ? o.related_min_jaccard
    : REGIME_TOPOLOGY_DEFAULTS.related_min_jaccard;
  const nestedMin    = Number.isFinite(o.nested_min_bp_frac)
    ? o.nested_min_bp_frac
    : REGIME_TOPOLOGY_DEFAULTS.nested_min_bp_frac;
  const chainedMinN  = Number.isFinite(o.chained_min_shared)
    ? o.chained_min_shared
    : REGIME_TOPOLOGY_DEFAULTS.chained_min_shared;
  const chainedMinJ  = Number.isFinite(o.chained_min_jaccard)
    ? o.chained_min_jaccard
    : REGIME_TOPOLOGY_DEFAULTS.chained_min_jaccard;

  const fA = regimeBpFootprint(A);
  const fB = regimeBpFootprint(B);
  if (!fA || !fB || !A || !B) {
    return {
      relationship: REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT,
      bp_overlap_bp: 0, bp_gap_bp: NaN,
      bp_containment_frac: 0,
      hom_a_jaccard: 0, hom_b_jaccard: 0, het_jaccard: 0,
      chained_shared_hom: 0,
    };
  }
  const ov_lo = Math.max(fA.start_bp, fB.start_bp);
  const ov_hi = Math.min(fA.end_bp,   fB.end_bp);
  const bp_overlap = Math.max(0, ov_hi - ov_lo);
  const bp_gap = bp_overlap > 0
    ? 0
    : Math.max(0, Math.max(fA.start_bp, fB.start_bp)
                   - Math.min(fA.end_bp, fB.end_bp));
  const smaller_len = Math.min(fA.length_bp, fB.length_bp);
  const containment = smaller_len > 0 ? bp_overlap / smaller_len : 0;

  const aHomA = A.hom_a_intersect || A.hom_a || new Set();
  const aHomB = A.hom_b_intersect || A.hom_b || new Set();
  const aHet  = A.het_union || A.het || new Set();
  const bHomA = B.hom_a_intersect || B.hom_a || new Set();
  const bHomB = B.hom_b_intersect || B.hom_b || new Set();
  const bHet  = B.het_union || B.het || new Set();
  const jHomA = bandJaccard(aHomA, bHomA);
  const jHomB = bandJaccard(aHomB, bHomB);
  const jHet  = bandJaccard(aHet,  bHet);

  // Count shared homozygote samples (largest of HOM_A∩HOM_A, HOM_B∩HOM_B).
  function intersectSize(a, b) {
    if (!a || !b || a.size === 0 || b.size === 0) return 0;
    let n = 0;
    const [s, l] = a.size <= b.size ? [a, b] : [b, a];
    for (const x of s) if (l.has(x)) n++;
    return n;
  }
  const sharedHom = Math.max(intersectSize(aHomA, bHomA),
                             intersectSize(aHomB, bHomB));

  const base = {
    bp_overlap_bp: bp_overlap,
    bp_gap_bp: bp_gap,
    bp_containment_frac: containment,
    hom_a_jaccard: jHomA,
    hom_b_jaccard: jHomB,
    het_jaccard:   jHet,
    chained_shared_hom: sharedHom,
  };

  const sampleRelated = Math.max(jHomA, jHomB, jHet) >= relatedMin;

  // NESTED: high containment + sample relatedness
  if (containment >= nestedMin && sampleRelated) {
    return Object.assign({}, base, {
      relationship: REGIME_TOPOLOGY_RELATIONSHIPS.NESTED,
    });
  }
  // OVERLAPPING_CONFLICT: overlap but disjoint sample-cores
  if (bp_overlap > 0 && !sampleRelated) {
    return Object.assign({}, base, {
      relationship: REGIME_TOPOLOGY_RELATIONSHIPS.OVERLAPPING_CONFLICT,
    });
  }
  // CHAINED: adjacent + shared HOM_A or HOM_B (multi-inversion lineage)
  if (bp_gap <= adjacentMax && sharedHom >= chainedMinN
      && Math.max(jHomA, jHomB) >= chainedMinJ) {
    return Object.assign({}, base, {
      relationship: REGIME_TOPOLOGY_RELATIONSHIPS.CHAINED,
    });
  }
  // ADJACENT: close in bp but disjoint sample-cores
  if (bp_gap <= adjacentMax && !sampleRelated) {
    return Object.assign({}, base, {
      relationship: REGIME_TOPOLOGY_RELATIONSHIPS.ADJACENT,
    });
  }
  return Object.assign({}, base, {
    relationship: REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT,
  });
}

// =====================================================================
// 3. buildRegimeTopologyGraph — all-pairs topology
// =====================================================================

/**
 * Build the cross-regime topology graph. Returns:
 *
 *   {
 *     n_regimes,
 *     edges:               [{i, j, relationship, ...details}]
 *                          (sorted by bp_overlap_bp desc, then by
 *                           chained_shared_hom desc)
 *     relationship_matrix: Array<Array<string>>,
 *   }
 *
 * Self-edges and INDEPENDENT relationships are excluded from `edges`
 * but recorded in the matrix.
 *
 * @param {Array<Object>} regimes  output of refineRegimesFromIntervals
 * @param {Object} [opts]
 * @returns {Object}
 */
export function buildRegimeTopologyGraph(regimes, opts) {
  const N = Array.isArray(regimes) ? regimes.length : 0;
  const edges = [];
  const relationship_matrix = Array.from({ length: N }, () =>
    new Array(N).fill(REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT));
  for (let i = 0; i < N; i++) {
    relationship_matrix[i][i] = REGIME_TOPOLOGY_RELATIONSHIPS.NESTED;
    for (let j = i + 1; j < N; j++) {
      const r = regimePairwiseTopology(regimes[i], regimes[j], opts);
      relationship_matrix[i][j] = r.relationship;
      relationship_matrix[j][i] = r.relationship;
      if (r.relationship !== REGIME_TOPOLOGY_RELATIONSHIPS.INDEPENDENT) {
        edges.push(Object.assign({ i, j }, r));
      }
    }
  }
  edges.sort((a, b) => {
    if (b.bp_overlap_bp !== a.bp_overlap_bp) {
      return b.bp_overlap_bp - a.bp_overlap_bp;
    }
    return b.chained_shared_hom - a.chained_shared_hom;
  });
  return { n_regimes: N, edges, relationship_matrix };
}

// =====================================================================
// 4. findChromosomeRegimeChains — walk CHAINED edges
// =====================================================================

/**
 * Walk CHAINED edges to emit multi-inversion lineage chains. Each
 * chain is a sequence of regime indices where every adjacent pair
 * shares a CHAINED relationship.
 *
 * Greedy: start with the regime that has the smallest start_bp and
 * a CHAINED neighbour; follow CHAINED links rightward by bp.
 *
 * Returns:
 *   {
 *     chains: [
 *       {
 *         regime_ids: [...],     // ordered by start_bp asc
 *         length_bp,             // sum of regime span + gaps
 *         start_bp, end_bp,
 *         shared_homs_along: [   // per-step shared-hom count
 *           {from_idx, to_idx, n_shared}, ...
 *         ]
 *       }, ...
 *     ],
 *     n_chains,
 *     regime_in_chain: Int32Array(N)  -1 if not in a chain, else chain idx.
 *   }
 *
 * Regimes not part of any CHAINED edge appear as singleton chains
 * (one-element regime_ids).
 *
 * @param {Object} graph    output of buildRegimeTopologyGraph
 * @param {Array<Object>} regimes  same array passed to buildRegimeTopologyGraph
 * @returns {Object}
 */
export function findChromosomeRegimeChains(graph, regimes) {
  const N = graph ? graph.n_regimes : 0;
  const regime_in_chain = new Int32Array(N).fill(-1);
  const chains = [];
  if (N === 0) return { chains, n_chains: 0, regime_in_chain };
  // Build adjacency list of CHAINED neighbours.
  const adj = Array.from({ length: N }, () => []);
  for (const e of graph.edges) {
    if (e.relationship !== REGIME_TOPOLOGY_RELATIONSHIPS.CHAINED) continue;
    adj[e.i].push({ neighbor: e.j, n_shared: e.chained_shared_hom });
    adj[e.j].push({ neighbor: e.i, n_shared: e.chained_shared_hom });
  }
  // Sort regimes by start_bp to give chains a deterministic left-
  // to-right order.
  const byStart = regimes.map((r, i) => ({
    i,
    start_bp: r && Number.isFinite(r.start_bp) ? r.start_bp : 0,
    end_bp:   r && Number.isFinite(r.end_bp)   ? r.end_bp   : 0,
  })).sort((a, b) => a.start_bp - b.start_bp);

  for (const head of byStart) {
    if (regime_in_chain[head.i] !== -1) continue;
    // BFS over CHAINED neighbours; collect all visited indices.
    const visited = [head.i];
    const queue = [head.i];
    const seen = new Set([head.i]);
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const e of adj[cur]) {
        if (seen.has(e.neighbor)) continue;
        seen.add(e.neighbor);
        visited.push(e.neighbor);
        queue.push(e.neighbor);
      }
    }
    // Order by start_bp asc.
    visited.sort((a, b) => {
      const sa = regimes[a] && Number.isFinite(regimes[a].start_bp)
        ? regimes[a].start_bp : 0;
      const sb = regimes[b] && Number.isFinite(regimes[b].start_bp)
        ? regimes[b].start_bp : 0;
      return sa - sb;
    });
    const chainIdx = chains.length;
    for (const idx of visited) regime_in_chain[idx] = chainIdx;
    // Per-step shared-hom counts from the original edges.
    const shared_homs_along = [];
    for (let k = 1; k < visited.length; k++) {
      const fromIdx = visited[k - 1], toIdx = visited[k];
      const edge = graph.edges.find(e =>
        (e.i === fromIdx && e.j === toIdx)
        || (e.i === toIdx && e.j === fromIdx));
      shared_homs_along.push({
        from_idx: fromIdx, to_idx: toIdx,
        n_shared: edge ? edge.chained_shared_hom : 0,
      });
    }
    const start_bp = visited.reduce((s, idx) =>
      Math.min(s, regimes[idx].start_bp), Infinity);
    const end_bp = visited.reduce((s, idx) =>
      Math.max(s, regimes[idx].end_bp), -Infinity);
    chains.push({
      regime_ids: visited,
      start_bp, end_bp,
      length_bp: Math.max(0, end_bp - start_bp),
      shared_homs_along,
    });
  }
  return { chains, n_chains: chains.length, regime_in_chain };
}

// =====================================================================
// 5. serializeRegimesToJson — Set → array for export
// =====================================================================

/**
 * Convert the in-memory regime structure (with `Set<number>` cores)
 * into a JSON-friendly shape. Sample-id sets become sorted Int32
 * arrays so downstream consumers (registries, manuscript figures,
 * external tools) can ingest without bespoke deserialisation.
 *
 *   {
 *     ok, n_intervals, n_regimes,
 *     regimes: [{
 *       regime_id, member_ids, sign_split,
 *       start_bp, end_bp, n_intervals,
 *       hom_a_intersect: int[],
 *       hom_b_intersect: int[],
 *       het_union: int[],
 *     }, ...],
 *     // optional pass-throughs:
 *     topology?: { edges, relationship_matrix },
 *     chains?:   { chains, n_chains, regime_in_chain (array) }
 *   }
 *
 * @param {Object} refinedOutput  output of refineRegimesFromIntervals
 * @param {{topology?:Object, chains?:Object}} [extras]
 * @returns {Object}
 */
export function serializeRegimesToJson(refinedOutput, extras) {
  const ext = extras || {};
  if (!refinedOutput || !refinedOutput.ok) {
    return {
      ok: false,
      n_intervals: 0, n_regimes: 0, regimes: [],
    };
  }
  const setToSortedArr = (s) => {
    if (!s) return [];
    const arr = Array.from(s).filter(Number.isFinite);
    arr.sort((a, b) => a - b);
    return arr;
  };
  const regimes = refinedOutput.regimes.map(r => ({
    regime_id:        r.regime_id,
    member_ids:       Array.isArray(r.member_ids) ? r.member_ids.slice() : [],
    sign_split:       !!r.sign_split,
    start_bp:         Number.isFinite(r.start_bp) ? r.start_bp : 0,
    end_bp:           Number.isFinite(r.end_bp)   ? r.end_bp   : 0,
    n_intervals:      Number.isFinite(r.n_intervals) ? r.n_intervals : 0,
    hom_a_intersect:  setToSortedArr(r.hom_a_intersect),
    hom_b_intersect:  setToSortedArr(r.hom_b_intersect),
    het_union:        setToSortedArr(r.het_union),
  }));
  const out = {
    ok: true,
    n_intervals: refinedOutput.n_intervals,
    n_regimes:   refinedOutput.n_regimes,
    regimes,
  };
  if (ext.topology) {
    out.topology = {
      edges: (ext.topology.edges || []).map(e => Object.assign({}, e, {
        // Drop nothing — edges already plain.
      })),
      relationship_matrix: ext.topology.relationship_matrix,
    };
  }
  if (ext.chains) {
    out.chains = {
      n_chains: ext.chains.n_chains,
      chains: ext.chains.chains.map(c => ({
        regime_ids: c.regime_ids.slice(),
        start_bp: c.start_bp, end_bp: c.end_bp, length_bp: c.length_bp,
        shared_homs_along: (c.shared_homs_along || []).slice(),
      })),
      regime_in_chain: Array.from(ext.chains.regime_in_chain || []),
    };
  }
  return out;
}
