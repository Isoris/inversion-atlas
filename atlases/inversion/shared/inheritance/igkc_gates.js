// shared/inheritance/igkc_gates.js
// =====================================================================
// Stage D2-D3: Inheritance-Gated Karyotype Calling.
//
// Mendelian compatibility gates over high-confidence KING parent-
// offspring relationships. Two layers:
//
//   D2 — DYAD GATES (parent-offspring pairs):
//     The only hard pairwise constraint is HOM_REF ↔ HOM_INV is
//     impossible. HET-anything is permissive. Each axis at each locus
//     contributes one dyad test.
//
//   D3 — TRIO GATES (parent-parent-offspring triples):
//     Full Mendelian table. Tracks informative vs uninformative loci
//     because HET×HET → any kid (uninformative).
//
// IGKC FLAGS but does NOT REASSIGN. A sample whose call is
// inconsistent with its KING-edges may be:
//   - sample swap
//   - pedigree mislabel
//   - complex rearrangement at the locus
//   - karyotype miscall (which is what FLAGGED in Stage C7 already is)
//
// The flag preserves all four hypotheses; downstream review or
// additional evidence resolves which.
// =====================================================================

import { KARYOTYPE_STATE } from '../band_tracking/karyotype_caller.js';

// ---------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------

export const KING_THRESHOLDS = Object.freeze({
  PO:    0.177,    // 1st-degree (parent-offspring or full-sib)
  SECOND: 0.0884,  // 2nd-degree
  THIRD:  0.0442,  // 3rd-degree
});

export const IGKC_DEFAULTS = Object.freeze({
  king_po_threshold: KING_THRESHOLDS.PO,
  king_2nd_threshold: KING_THRESHOLDS.SECOND,
  min_loci_for_dyad: 1,    // dyad needs at least this many tested axes
  min_loci_for_trio: 1,
});

// ---------------------------------------------------------------------
// Per-axis dyad compatibility
// ---------------------------------------------------------------------

const HR = KARYOTYPE_STATE.HOM_REF;
const HE = KARYOTYPE_STATE.HET;
const HI = KARYOTYPE_STATE.HOM_INV;
const NA = KARYOTYPE_STATE.NA;
const FL = KARYOTYPE_STATE.FLAGGED;

/**
 * Hard PO-incompatibility test for one axis.
 * HOM_REF ↔ HOM_INV is the only hard contradiction.
 * NA or FLAGGED on either side → uninformative (returns null).
 *
 * @param {string} stateA
 * @param {string} stateB
 * @returns {boolean|null}    true=compatible, false=contradiction, null=uninformative
 */
export function poDyadCompatibleAtAxis(stateA, stateB) {
  if (stateA === NA || stateA === FL || stateB === NA || stateB === FL) return null;
  if ((stateA === HR && stateB === HI) || (stateA === HI && stateB === HR)) return false;
  return true;
}

// ---------------------------------------------------------------------
// Per-axis trio compatibility table
//
// Returns the SET of allowed kid states given parent states.
// HET×HET → all three (uninformative).
// ---------------------------------------------------------------------

/**
 * @param {string} p1
 * @param {string} p2
 * @returns {Set<string>|null}    null if either parent is NA/FLAGGED
 */
export function trioAllowedKidStates(p1, p2) {
  if (p1 === NA || p1 === FL || p2 === NA || p2 === FL) return null;
  // Sort canonically so the table is symmetric in (p1, p2)
  const a = p1, b = p2;
  const k = [a, b].sort().join('|');
  switch (k) {
    case `${HR}|${HR}`: return new Set([HR]);
    case `${HE}|${HR}`: return new Set([HR, HE]);
    case `${HI}|${HR}`: return new Set([HE]);
    case `${HE}|${HE}`: return new Set([HR, HE, HI]);
    case `${HE}|${HI}`: return new Set([HE, HI]);
    case `${HI}|${HI}`: return new Set([HI]);
    default: return null;
  }
}

/**
 * @param {string} p1
 * @param {string} p2
 * @returns {boolean}   true if HET×HET (uninformative)
 */
export function trioIsUninformative(p1, p2) {
  return p1 === HE && p2 === HE;
}

// ---------------------------------------------------------------------
// IGKC DYAD GATES (D2)
//
// For one parent-offspring dyad (A, B), evaluate compatibility across
// all axes of all loci. Return summary plus the list of contradicting
// (locus_id, axis_id) pairs.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.sample_a
 * @param {number} args.sample_b
 * @param {Array<{locus_id, axis_id, calls_per_sample:Array}>} args.axis_calls
 *   axis_calls[i].calls_per_sample[s] is the per-axis-per-sample call
 *   record from karyotype_caller.callKaryotypePerAxisPerSample.
 * @param {object} [opts]
 * @returns {{
 *   sample_a: number,
 *   sample_b: number,
 *   n_loci_tested: number,
 *   n_compatible: number,
 *   n_contradictions: number,
 *   n_uninformative: number,
 *   dyad_contradiction_rate: number,
 *   contradictions: Array<{locus_id, axis_id,
 *                          state_a:string, state_b:string}>,
 *   flagged: boolean,
 * }}
 */
export function igkcDyad(args, opts) {
  opts = Object.assign({}, IGKC_DEFAULTS, opts || {});
  const { sample_a, sample_b, axis_calls } = args;
  let nT = 0, nC = 0, nX = 0, nU = 0;
  const contradictions = [];

  for (const ax of axis_calls) {
    const callA = ax.calls_per_sample[sample_a];
    const callB = ax.calls_per_sample[sample_b];
    if (!callA || !callB) continue;
    const compat = poDyadCompatibleAtAxis(callA.state_call, callB.state_call);
    if (compat == null) { nU++; continue; }
    nT++;
    if (compat) nC++;
    else {
      nX++;
      contradictions.push({
        locus_id: ax.locus_id,
        axis_id:  ax.axis_id,
        state_a:  callA.state_call,
        state_b:  callB.state_call,
      });
    }
  }

  return {
    sample_a, sample_b,
    n_loci_tested:           nT,
    n_compatible:            nC,
    n_contradictions:        nX,
    n_uninformative:         nU,
    dyad_contradiction_rate: nT > 0 ? nX / nT : 0,
    contradictions,
    flagged: nX >= 1 && nT >= opts.min_loci_for_dyad,
  };
}

// ---------------------------------------------------------------------
// IGKC TRIO GATES (D3)
//
// For one (P1, P2, KID) trio, evaluate compatibility across all axes.
// Track informative vs uninformative loci separately.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.parent1
 * @param {number} args.parent2
 * @param {number} args.kid
 * @param {Array} args.axis_calls    same format as igkcDyad
 * @param {object} [opts]
 * @returns {{
 *   parent1, parent2, kid: number,
 *   n_loci_tested: number,
 *   n_informative: number,
 *   n_compatible: number,
 *   n_contradictions: number,
 *   n_uninformative_parents: number,    // HET×HET cases
 *   n_missing: number,                  // any state was NA/FLAGGED
 *   trio_contradiction_rate: number,
 *   contradictions: Array<{locus_id, axis_id, p1, p2, kid_observed,
 *                          allowed:string[]}>,
 *   flagged: boolean,
 * }}
 */
export function igkcTrio(args, opts) {
  opts = Object.assign({}, IGKC_DEFAULTS, opts || {});
  const { parent1, parent2, kid, axis_calls } = args;
  let nT = 0, nInf = 0, nC = 0, nX = 0, nUP = 0, nM = 0;
  const contradictions = [];

  for (const ax of axis_calls) {
    const cP1  = ax.calls_per_sample[parent1];
    const cP2  = ax.calls_per_sample[parent2];
    const cKid = ax.calls_per_sample[kid];
    if (!cP1 || !cP2 || !cKid) continue;
    const allowed = trioAllowedKidStates(cP1.state_call, cP2.state_call);
    if (allowed == null) { nM++; continue; }
    nT++;
    if (trioIsUninformative(cP1.state_call, cP2.state_call)) { nUP++; continue; }
    nInf++;
    if (cKid.state_call === FL || cKid.state_call === NA) { nM++; continue; }
    if (allowed.has(cKid.state_call)) nC++;
    else {
      nX++;
      contradictions.push({
        locus_id: ax.locus_id,
        axis_id:  ax.axis_id,
        p1: cP1.state_call,
        p2: cP2.state_call,
        kid_observed: cKid.state_call,
        allowed: Array.from(allowed),
      });
    }
  }

  return {
    parent1, parent2, kid,
    n_loci_tested:           nT,
    n_informative:           nInf,
    n_compatible:            nC,
    n_contradictions:        nX,
    n_uninformative_parents: nUP,
    n_missing:               nM,
    trio_contradiction_rate: nInf > 0 ? nX / nInf : 0,
    contradictions,
    flagged: nX >= 1 && nInf >= opts.min_loci_for_trio,
  };
}

// ---------------------------------------------------------------------
// Genome-wide pass: enumerate KING-PO dyads and run igkcDyad on each
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {Array<{a:number, b:number, kinship:number}>} args.king_edges
 * @param {Array} args.axis_calls
 * @param {object} [opts]
 * @returns {Array<ReturnType<typeof igkcDyad>>}
 */
export function igkcAllDyads(args, opts) {
  opts = Object.assign({}, IGKC_DEFAULTS, opts || {});
  const { king_edges, axis_calls } = args;
  const out = [];
  for (const e of king_edges) {
    if (e.kinship < opts.king_po_threshold) continue;
    out.push(igkcDyad({ sample_a: e.a, sample_b: e.b, axis_calls }, opts));
  }
  return out;
}

// ---------------------------------------------------------------------
// Console-debug
// ---------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window._poDyadCompatibleAtAxis = poDyadCompatibleAtAxis;
  window._trioAllowedKidStates   = trioAllowedKidStates;
  window._trioIsUninformative    = trioIsUninformative;
  window._igkcDyad               = igkcDyad;
  window._igkcTrio               = igkcTrio;
  window._igkcAllDyads           = igkcAllDyads;
  window._IGKC_DEFAULTS          = IGKC_DEFAULTS;
  window._KING_THRESHOLDS        = KING_THRESHOLDS;
}
