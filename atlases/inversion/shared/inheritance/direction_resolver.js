// shared/inheritance/direction_resolver.js
// =====================================================================
// Stage D4-D5: Multi-chromosome PO direction resolver + IKC matrix.
//
// D4 — Direction resolver:
//   For each KING-PO dyad (A, B) compatible with PO inheritance, find
//   third samples C with KING-edges to both. The trio (A, B, C) lets
//   us test two directional hypotheses:
//     H_A: A is parent of B; C is the other parent
//     H_B: B is parent of A; C is the other parent
//   Score each hypothesis as the count of compatible (locus, axis)
//   pairs across all axes genome-wide. The direction with greater
//   compatibility is called.
//
//   Catfish-specific: *C. gariepinus* lacks validated sex-linked
//   markers. Direction inference relies SOLELY on autosomal trio
//   asymmetry across multiple inversion axes. Statistical meaning
//   requires ≥ 5 independent axes per dyad.
//
// D5 — IKC matrix:
//   226×226 cross-locus summary of dyad-level inheritance findings.
//   Used to identify sample swaps, complex rearrangements, pedigree
//   errors, and to corroborate or contradict KING.
// =====================================================================

import { trioAllowedKidStates, trioIsUninformative,
         IGKC_DEFAULTS, KING_THRESHOLDS } from './igkc_gates.js';
import { KARYOTYPE_STATE } from '../band_tracking/karyotype_caller.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const DIRECTION_DEFAULTS = Object.freeze({
  min_informative_axes: 5,    // hard floor for direction call
  confidence_threshold: 0.6,  // |Δ|/(sum) ≥ this to call a direction
});

export const DIRECTION = Object.freeze({
  A_TO_B:      'A_TO_B',
  B_TO_A:      'B_TO_A',
  UNDIRECTED:  'UNDIRECTED',
  INCOMPATIBLE: 'INCOMPATIBLE',
});

// ---------------------------------------------------------------------
// scoreTrioHypothesis
//
// For one trio (parent_candidate, kid_candidate, other_parent) and
// one axis, returns:
//   1 if compatible and informative
//   0 if compatible but uninformative (HET×HET)
//   -1 if INCOMPATIBLE
//   null if any state is NA/FLAGGED
// ---------------------------------------------------------------------

/**
 * @param {string} parent_state
 * @param {string} kid_state
 * @param {string} other_state
 * @returns {-1|0|1|null}
 */
export function scoreTrioHypothesisAtAxis(parent_state, kid_state, other_state) {
  const allowed = trioAllowedKidStates(parent_state, other_state);
  if (allowed == null) return null;
  if (kid_state === KARYOTYPE_STATE.NA || kid_state === KARYOTYPE_STATE.FLAGGED) return null;
  if (trioIsUninformative(parent_state, other_state)) return 0;
  return allowed.has(kid_state) ? 1 : -1;
}

// ---------------------------------------------------------------------
// resolveDyadDirection
//
// Test direction A→B vs B→A for one dyad using all candidate third
// samples C and all axes.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.sample_a
 * @param {number} args.sample_b
 * @param {Array<{a:number,b:number,kinship:number}>} args.king_edges
 * @param {Array<{locus_id, axis_id, calls_per_sample:Array}>} args.axis_calls
 * @param {object} [opts]
 * @returns {{
 *   sample_a, sample_b: number,
 *   candidates_c: Array<{c:number, score_a_parent:number,
 *                         score_b_parent:number, n_informative:number,
 *                         n_compatible_a:number, n_compatible_b:number,
 *                         n_incompatible_a:number, n_incompatible_b:number}>,
 *   total_score_a_parent: number,
 *   total_score_b_parent: number,
 *   n_informative_total: number,
 *   direction_score: number,        // ∈ [-1, 1]; positive = A is parent
 *   direction: string,              // one of DIRECTION values
 *   confidence: number,
 *   reason?: string,
 * }}
 */
export function resolveDyadDirection(args, opts) {
  opts = Object.assign({}, DIRECTION_DEFAULTS, opts || {});
  const { sample_a, sample_b, king_edges, axis_calls } = args;

  // Find candidate Cs: samples with KING(A,C) ≥ PO and KING(B,C) ≥ 2nd
  const edgesByA = new Map();
  const edgesByB = new Map();
  for (const e of king_edges) {
    if (e.a === sample_a) edgesByA.set(e.b, e.kinship);
    if (e.b === sample_a) edgesByA.set(e.a, e.kinship);
    if (e.a === sample_b) edgesByB.set(e.b, e.kinship);
    if (e.b === sample_b) edgesByB.set(e.a, e.kinship);
  }
  const candidate_c = [];
  for (const [c, kAC] of edgesByA) {
    if (c === sample_a || c === sample_b) continue;
    const kBC = edgesByB.get(c);
    if (kAC == null || kBC == null) continue;
    if (kAC < KING_THRESHOLDS.PO) continue;
    if (kBC < KING_THRESHOLDS.SECOND) continue;
    candidate_c.push(c);
  }

  let total_a = 0, total_b = 0, n_informative = 0;
  const candidates_out = [];

  for (const c of candidate_c) {
    let sA = 0, sB = 0, nInf = 0;
    let n_comp_a = 0, n_comp_b = 0, n_incomp_a = 0, n_incomp_b = 0;

    for (const ax of axis_calls) {
      const cA = ax.calls_per_sample[sample_a];
      const cB = ax.calls_per_sample[sample_b];
      const cC = ax.calls_per_sample[c];
      if (!cA || !cB || !cC) continue;

      // H_A: A is parent of B; C is the other parent of B
      const sA_axis = scoreTrioHypothesisAtAxis(cA.state_call, cB.state_call, cC.state_call);
      // H_B: B is parent of A; C is the other parent of A
      const sB_axis = scoreTrioHypothesisAtAxis(cB.state_call, cA.state_call, cC.state_call);

      if (sA_axis !== null && sA_axis !== 0) {
        if (sA_axis === 1) { sA++; n_comp_a++; }
        else               { sA--; n_incomp_a++; }
      }
      if (sB_axis !== null && sB_axis !== 0) {
        if (sB_axis === 1) { sB++; n_comp_b++; }
        else               { sB--; n_incomp_b++; }
      }
      if ((sA_axis !== null && sA_axis !== 0) || (sB_axis !== null && sB_axis !== 0)) {
        nInf++;
      }
    }

    candidates_out.push({
      c, score_a_parent: sA, score_b_parent: sB,
      n_informative: nInf,
      n_compatible_a: n_comp_a,
      n_compatible_b: n_comp_b,
      n_incompatible_a: n_incomp_a,
      n_incompatible_b: n_incomp_b,
    });
    total_a += sA;
    total_b += sB;
    n_informative += nInf;
  }

  // Direction call
  const sum = Math.abs(total_a) + Math.abs(total_b);
  const direction_score = sum > 0 ? (total_a - total_b) / (Math.abs(total_a) + Math.abs(total_b)) : 0;
  const confidence = sum > 0 ? Math.abs(total_a - total_b) / (Math.abs(total_a) + Math.abs(total_b)) : 0;

  let direction, reason;
  if (n_informative < opts.min_informative_axes) {
    direction = DIRECTION.UNDIRECTED;
    reason = `n_informative=${n_informative} < ${opts.min_informative_axes}`;
  } else if (total_a < 0 && total_b < 0) {
    direction = DIRECTION.INCOMPATIBLE;
    reason = `both directions show net incompatibility (a=${total_a}, b=${total_b})`;
  } else if (confidence < opts.confidence_threshold) {
    direction = DIRECTION.UNDIRECTED;
    reason = `confidence=${confidence.toFixed(3)} < ${opts.confidence_threshold}`;
  } else {
    direction = total_a > total_b ? DIRECTION.A_TO_B : DIRECTION.B_TO_A;
    reason = `confidence=${confidence.toFixed(3)} ≥ ${opts.confidence_threshold}`;
  }

  return {
    sample_a, sample_b,
    candidates_c: candidates_out,
    total_score_a_parent: total_a,
    total_score_b_parent: total_b,
    n_informative_total: n_informative,
    direction_score,
    direction,
    confidence,
    reason,
  };
}

// ---------------------------------------------------------------------
// resolveAllDyadDirections
// ---------------------------------------------------------------------

/**
 * Run resolveDyadDirection on every KING-PO dyad.
 *
 * @param {object} args
 * @returns {Array<ReturnType<typeof resolveDyadDirection>>}
 */
export function resolveAllDyadDirections(args, opts) {
  opts = Object.assign({}, DIRECTION_DEFAULTS, opts || {});
  const { king_edges, axis_calls } = args;
  const out = [];
  for (const e of king_edges) {
    if (e.kinship < KING_THRESHOLDS.PO) continue;
    out.push(resolveDyadDirection(
      { sample_a: e.a, sample_b: e.b, king_edges, axis_calls }, opts));
  }
  return out;
}

// ---------------------------------------------------------------------
// IKC matrix (D5)
//
// 226×226 summary, indexed by (sample_a, sample_b) for a < b.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.n_samples
 * @param {Array<{a:number,b:number,kinship:number,relationship_class:string}>} args.king_edges
 * @param {Array<ReturnType<typeof import('./igkc_gates.js').igkcDyad>>} args.dyad_results
 * @param {Array<ReturnType<typeof resolveDyadDirection>>} [args.direction_results]
 * @returns {{
 *   ikc: Array<Array<{
 *     n_loci_tested, n_compatible, n_contradictions: number,
 *     dyad_contradiction_rate: number,
 *     KING_kinship: number,
 *     KING_relationship_class: string,
 *     agree_with_KING: boolean,
 *     direction?: string,
 *     direction_confidence?: number,
 *   }|null>>,
 *   summary: {
 *     n_PO_dyads: number,
 *     n_clean_inheritance: number,
 *     n_flagged: number,
 *     n_directionally_resolved: number,
 *     median_direction_confidence: number,
 *   }
 * }}
 */
export function buildIKCMatrix(args) {
  const { n_samples, king_edges, dyad_results, direction_results } = args;
  const ikc = Array.from({ length: n_samples },
                          () => new Array(n_samples).fill(null));

  // Index KING edges and direction results
  const kingIdx = new Map();
  for (const e of king_edges) {
    const key = `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}`;
    kingIdx.set(key, e);
  }
  const dirIdx = new Map();
  if (direction_results) {
    for (const d of direction_results) {
      const key = `${Math.min(d.sample_a, d.sample_b)}|${Math.max(d.sample_a, d.sample_b)}`;
      dirIdx.set(key, d);
    }
  }

  let n_po = 0, n_clean = 0, n_flagged = 0, n_resolved = 0;
  const conf_values = [];

  for (const dy of dyad_results) {
    const a = Math.min(dy.sample_a, dy.sample_b);
    const b = Math.max(dy.sample_a, dy.sample_b);
    const king_e = kingIdx.get(`${a}|${b}`);
    const dir = dirIdx.get(`${a}|${b}`);
    const cell = {
      n_loci_tested:           dy.n_loci_tested,
      n_compatible:            dy.n_compatible,
      n_contradictions:        dy.n_contradictions,
      dyad_contradiction_rate: dy.dyad_contradiction_rate,
      KING_kinship:            king_e ? king_e.kinship : null,
      KING_relationship_class: king_e ? (king_e.relationship_class || 'PO') : null,
      agree_with_KING:         dy.n_contradictions === 0,
    };
    if (dir) {
      cell.direction = dir.direction;
      cell.direction_confidence = dir.confidence;
      cell.n_informative_for_direction = dir.n_informative_total;
    }
    ikc[a][b] = cell;
    ikc[b][a] = cell;

    n_po++;
    if (dy.n_contradictions === 0) n_clean++;
    else                            n_flagged++;
    if (dir && (dir.direction === DIRECTION.A_TO_B || dir.direction === DIRECTION.B_TO_A)) {
      n_resolved++;
      conf_values.push(dir.confidence);
    }
  }

  conf_values.sort((x, y) => x - y);
  const median_conf = conf_values.length > 0
    ? conf_values[Math.floor(conf_values.length / 2)]
    : 0;

  return {
    ikc,
    summary: {
      n_PO_dyads:                  n_po,
      n_clean_inheritance:         n_clean,
      n_flagged:                   n_flagged,
      n_directionally_resolved:    n_resolved,
      median_direction_confidence: median_conf,
    },
  };
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._scoreTrioHypothesisAtAxis = scoreTrioHypothesisAtAxis;
  window._resolveDyadDirection      = resolveDyadDirection;
  window._resolveAllDyadDirections  = resolveAllDyadDirections;
  window._buildIKCMatrix            = buildIKCMatrix;
  window._DIRECTION                 = DIRECTION;
  window._DIRECTION_DEFAULTS        = DIRECTION_DEFAULTS;
}
