// shared/boundary_evidence.js
//
// Boundary-refinement constants + pure helpers. Used by page11
// (boundaries refinement) for the candidate-scoped scan + the
// boundary_evidence layer accessors.
//
// The big algorithmic core (_computeBoundaryEdges, _bndAutoPropose)
// is left in legacy for now — it touches many tracks + drives DOM.
// This module ships the cartridge-side primitives that the algorithm
// + UI both depend on: locked constants, the scan-range helper, and
// the SV-anchor zone filter.
//
// Legacy origin:
//   - BOUNDARY_DEFAULTS / BOUNDARY_TRACK_WEIGHTS /
//     BOUNDARY_TRACK_POLARITY / BOUNDARY_TRACK_NAMES /
//     SUPPORT_CLASS_COLORS    : lines 17687-17760
//   - _boundaryScanRange      : line 17813
//   - _findSVAnchorsInZone    : line 17895

import { bsearchWin } from './window_coords.js';

// =====================================================================
// Constants
// =====================================================================

/**
 * Top-level boundary-refinement defaults. Frozen. Toolbar knobs in
 * page11 override SCAN_RADIUS_BP at runtime; everything else is fixed
 * for the manuscript figure.
 */
export const BOUNDARY_DEFAULTS = Object.freeze({
  SCAN_RADIUS_BP: 1_500_000,    // 1.5 Mb each side; toolbar adjusts
  ZONE_RADIUS_WINDOWS: 5,       // ±5 windows per zone
  SMOOTH_WINDOW: 3,             // rolling-median width (odd)
  EXCLUDE_OUTER_PCT: 0.10,      // ignore outermost 10% of scan halves
  SUPPORT_INCLUSION: 0.5,       // ≥ 0.5 × median nonzero → in support[]
  CANDIDATE_HUGE_BP: 3_000_000, // 3 Mb threshold for scan expansion
  CANDIDATE_HUGE_RATIO: 0.5,    // 0.5*span instead of fixed radius
  STATUSES: Object.freeze([
    'boundary_zone_only', 'SV_supported', 'junction_supported',
  ]),
});

/**
 * Locked default weights for the boundary-track ensemble. Sum to 1.0
 * exactly. When optional tracks are absent at runtime, remaining
 * weights are renormalized to 1.0 inside the algorithmic core
 * (_computeBoundaryEdges, still in legacy).
 */
export const BOUNDARY_TRACK_WEIGHTS = Object.freeze({
  pca_drop:              0.20,
  dosage_transition:     0.18,
  band_continuity_drop:  0.14,
  ghsl_step:             0.12,
  polarity_change:       0.10,
  het_transition:        0.06,
  similarity_edge:       0.05,
  fst_edge:              0.05,  // boundary_evidence layer required
  theta_pi_step:         0.04,  // boundary_evidence layer required
  discordant_pile:       0.04,  // boundary_evidence layer required
  sv_anchor:             0.02,  // boundary_evidence layer required
});

/**
 * Per-track polarity. +1 means "track rises INSIDE the inversion"
 * (so a rising step at a window is a left-edge-like signal); -1
 * means "track falls INSIDE" — the step gets flipped before the
 * combined sum, so a falling step (outside-high → inside-low) is
 * correctly treated as a left-edge contribution.
 */
export const BOUNDARY_TRACK_POLARITY = Object.freeze({
  pca_drop:              +1,
  dosage_transition:     +1,
  band_continuity_drop:  -1,
  ghsl_step:             +1,
  polarity_change:       +1,
  het_transition:        +1,
  similarity_edge:       -1,
  fst_edge:              +1,
  theta_pi_step:         -1,
  discordant_pile:       +1,
  sv_anchor:             +1,
});

/** Frozen list of track names in WEIGHTS-declaration order. */
export const BOUNDARY_TRACK_NAMES = Object.freeze(
  Object.keys(BOUNDARY_TRACK_WEIGHTS),
);

/**
 * support_class colour palette (schema §12 — locked). Drives the
 * zone-shading overlay in the boundaries page.
 */
export const SUPPORT_CLASS_COLORS = Object.freeze({
  strong:    { hex: '#1B7837', opacity: 0.20 },  // green
  moderate:  { hex: '#F4A582', opacity: 0.18 },  // amber
  weak:      { hex: '#FDDBC7', opacity: 0.16 },  // peach
  ambiguous: { hex: '#BDBDBD', opacity: 0.10 },  // grey
});

// =====================================================================
// Scan range
// =====================================================================

/**
 * Compute the scan region for a candidate — bp range AND window
 * indices (when state.data.windows ships sorted start_bp/end_bp
 * arrays; otherwise win_lo/win_hi remain 0).
 *
 * Implements the "candidate huge" expansion rule: when candidate
 * span > BOUNDARY_DEFAULTS.CANDIDATE_HUGE_BP, the scan radius
 * expands to span * BOUNDARY_DEFAULTS.CANDIDATE_HUGE_RATIO.
 *
 * Optional `chromLen` clamps the right end so the scan never
 * extends past the chromosome.
 *
 * @param {Object} state
 * @param {{start_bp:number, end_bp:number}} cand
 * @param {number} [scan_radius_bp]   default BOUNDARY_DEFAULTS.SCAN_RADIUS_BP
 * @param {number} [chromLen]
 * @returns {{start_bp:number, end_bp:number, win_lo:number, win_hi:number}|null}
 */
export function boundaryScanRange(state, cand, scan_radius_bp, chromLen) {
  if (!cand) return null;
  const span = (cand.end_bp - cand.start_bp) || 0;
  let radius = (scan_radius_bp != null)
    ? scan_radius_bp
    : BOUNDARY_DEFAULTS.SCAN_RADIUS_BP;
  if (span > BOUNDARY_DEFAULTS.CANDIDATE_HUGE_BP) {
    radius = Math.max(radius, span * BOUNDARY_DEFAULTS.CANDIDATE_HUGE_RATIO);
  }
  const start_bp = Math.max(0, cand.start_bp - radius);
  const end_bp = (chromLen != null && Number.isFinite(chromLen))
    ? Math.min(chromLen, cand.end_bp + radius)
    : (cand.end_bp + radius);
  let win_lo = 0, win_hi = 0;
  if (state && state.data && state.data.windows
      && state.data.windows.start_bp && state.data.windows.end_bp) {
    win_lo = bsearchWin(state.data.windows.start_bp, start_bp, 'lo');
    const hiIdx = bsearchWin(state.data.windows.end_bp, end_bp, 'hi');
    win_hi = Math.max(win_lo, hiIdx);
  }
  return { start_bp, end_bp, win_lo, win_hi };
}

// =====================================================================
// SV anchor filter
// =====================================================================

/**
 * Filter SV anchors (from a boundary_evidence row's tracks.sv_anchors)
 * to those whose `pos_bp` lies inside [zoneStartBp, zoneEndBp]. Pure
 * copies of each anchor object are returned — callers can mutate the
 * result without affecting the layer.
 *
 * @param {Object} boundaryEvidenceRow   from data.boundary_evidence[i]
 * @param {number} zoneStartBp           inclusive
 * @param {number} zoneEndBp             inclusive
 * @returns {Array<{kind:string, pos_bp:number, qual:?number, ct:?string}>}
 */
export function findSVAnchorsInZone(boundaryEvidenceRow, zoneStartBp, zoneEndBp) {
  if (!boundaryEvidenceRow || !boundaryEvidenceRow.tracks) return [];
  const anchors = boundaryEvidenceRow.tracks.sv_anchors;
  if (!Array.isArray(anchors)) return [];
  const out = [];
  for (const a of anchors) {
    if (!a || a.pos_bp == null) continue;
    if (a.pos_bp >= zoneStartBp && a.pos_bp <= zoneEndBp) {
      out.push({
        kind: a.kind,
        pos_bp: a.pos_bp,
        qual: (a.qual != null) ? a.qual : null,
        ct: a.ct || null,
      });
    }
  }
  return out;
}
