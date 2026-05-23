// shared/inversion_classification_axes.js
// =====================================================================
// Per-candidate classification axes — small bridge module that turns
// existing per-axis primitive outputs (divergence network, XP-EHH
// outliers) into single-axis classification verdicts the future
// classification page will tile across.
//
// Each axis here is a pure classifier — takes the primitive's output,
// returns one of a frozen vocab. No DOM, no fetch, no schema math.
//
// Existing per-candidate axes (already shipped by their own modules):
//   - copy_origin_painting.summarizeArrangementCopyOrigin
//     → ARRANGEMENT_COPY_VERDICTS, COPY_ORIGIN_MECHANISMS
//   - regime_annotation/positional.annotateRegimePosition
//     → REGIME_POSITIONAL_LABELS
//   - regime_annotation/structure.annotateRegimeStructure
//     → REGIME_STRUCTURE_LABELS
//   - functional_burden.summarizeCandidateFunctionalBurden
//     → FUNCTIONAL_BURDEN_TAGS
//   - busco_4d_age.buildBuscoAgeBracketsBlock
//     → null or per-μ ages_my
//   - mendelian_para_vs_peri.cohortParaPeriContingency
//     → cohort-level only (not per-candidate)
//
// This module adds the two leftover per-candidate axes:
//   - DIVERGENCE: from computeDivergenceNetwork's edges
//   - XPEHH_SELECTION_SIGNAL: from xpehhValuesInRange within candidate bp
// =====================================================================

// 2026-05-23 Phase 1c: divergence_network moved to cross-species atlas.
import {
  DIVERGENCE_FST_WEAK_THRESHOLD,
  DIVERGENCE_FST_STRONG_THRESHOLD,
} from '../../cross-species/shared/divergence_network.js';
import {
  XPEHH_OUTLIER_Z_DEFAULT,
  xpehhValuesInRange,
} from './xpehh_per_window.js';

// =====================================================================
// Vocab
// =====================================================================

/** Per-candidate divergence-network axis. */
export const DIVERGENCE_AXIS_LABELS = Object.freeze({
  NO_DATA:           'no_data',
  LOW_POWER:         'low_power',
  NO_DIVERGENCE:     'no_divergence',
  WEAK_DIVERGENCE:   'weak_divergence',
  STRONG_DIVERGENCE: 'strong_divergence',
});

/** Per-candidate XP-EHH selection-signal axis. */
export const XPEHH_AXIS_LABELS = Object.freeze({
  NO_DATA:        'no_data',
  NO_SIGNAL:      'no_signal',
  MILD_OUTLIER:   'mild_outlier',
  STRONG_OUTLIER: 'strong_outlier',
});

/** Default thresholds. */
export const XPEHH_AXIS_DEFAULTS = Object.freeze({
  /** A candidate is a "mild outlier" if any window in its bp range
   *  has |xpehh| ≥ this z-score. */
  mild_z_threshold:   XPEHH_OUTLIER_Z_DEFAULT,   // 2.0
  /** A candidate is "strong" if any window has |xpehh| ≥ this. */
  strong_z_threshold: 4.0,
  /** A candidate is "strong" if ≥ this many windows are over mild_z. */
  strong_n_windows:   3,
});

// =====================================================================
// 1. Divergence axis
// =====================================================================

/**
 * Classify a candidate's divergence-network output into one axis label.
 *
 * Decision rule:
 *   - no_data:           network null, no edges, or no_groups
 *   - low_power:         every edge tagged 'low_power'
 *   - no_divergence:     max FST < weak threshold (0.10)
 *   - weak_divergence:   max FST in [0.10, 0.25)
 *   - strong_divergence: max FST ≥ 0.25
 *
 * Only `metric === 'fst'` edges are scored. Distance-metric networks
 * fall back to `no_data` (no calibrated threshold for distance).
 *
 * @param {Object} network   output of computeDivergenceNetwork
 * @returns {string}         one of DIVERGENCE_AXIS_LABELS values
 */
export function classifyCandidateDivergence(network) {
  if (!network || !Array.isArray(network.edges) || network.edges.length === 0) {
    return DIVERGENCE_AXIS_LABELS.NO_DATA;
  }
  const meta = network.meta || {};
  if (meta.metric && meta.metric !== 'fst') {
    return DIVERGENCE_AXIS_LABELS.NO_DATA;
  }
  // Are all edges low-power?
  const usableEdges = network.edges.filter(e => e && e.flag !== 'low_power');
  if (usableEdges.length === 0) {
    return DIVERGENCE_AXIS_LABELS.LOW_POWER;
  }
  let maxFst = -Infinity;
  for (const e of usableEdges) {
    if (Number.isFinite(e.fst) && e.fst > maxFst) maxFst = e.fst;
  }
  if (!Number.isFinite(maxFst)) return DIVERGENCE_AXIS_LABELS.NO_DATA;
  if (maxFst >= DIVERGENCE_FST_STRONG_THRESHOLD) {
    return DIVERGENCE_AXIS_LABELS.STRONG_DIVERGENCE;
  }
  if (maxFst >= DIVERGENCE_FST_WEAK_THRESHOLD) {
    return DIVERGENCE_AXIS_LABELS.WEAK_DIVERGENCE;
  }
  return DIVERGENCE_AXIS_LABELS.NO_DIVERGENCE;
}

// =====================================================================
// 2. XP-EHH selection-signal axis
// =====================================================================

/**
 * Classify a candidate's XP-EHH signal by inspecting the windows that
 * overlap `[candidate.start_bp, candidate.end_bp]` on its chromosome.
 *
 * Decision rule:
 *   - no_data:        no windows in range, or layer missing
 *   - strong_outlier: max |xpehh| ≥ strong_z_threshold (default 4.0),
 *                     OR ≥ strong_n_windows (default 3) windows have
 *                     |xpehh| ≥ mild_z_threshold
 *   - mild_outlier:   max |xpehh| ≥ mild_z_threshold (default 2.0)
 *   - no_signal:      otherwise
 *
 * Prefers `norm_xpehh_mean` when present (Z-normalised already);
 * otherwise falls back to raw `xpehh_mean` and uses the same
 * thresholds (caller's responsibility — see spec §"What this track
 * DOES claim" — un-normed values are interpreted as standardized
 * unless the producer says otherwise).
 *
 * @param {Object} state               atlas state with state.xpehhPerWindow
 * @param {{chrom:string, start_bp:number, end_bp:number}} candidate
 * @param {Object} [opts]              vocab overrides
 * @returns {string}                   one of XPEHH_AXIS_LABELS values
 */
export function classifyCandidateXpehhSignal(state, candidate, opts) {
  const o = opts || {};
  const mildZ   = Number.isFinite(o.mild_z_threshold)   ? o.mild_z_threshold   : XPEHH_AXIS_DEFAULTS.mild_z_threshold;
  const strongZ = Number.isFinite(o.strong_z_threshold) ? o.strong_z_threshold : XPEHH_AXIS_DEFAULTS.strong_z_threshold;
  const strongN = Number.isFinite(o.strong_n_windows)   ? o.strong_n_windows   : XPEHH_AXIS_DEFAULTS.strong_n_windows;
  if (!state || !candidate || !candidate.chrom) {
    return XPEHH_AXIS_LABELS.NO_DATA;
  }
  if (!Number.isFinite(candidate.start_bp) || !Number.isFinite(candidate.end_bp)) {
    return XPEHH_AXIS_LABELS.NO_DATA;
  }
  const vals = xpehhValuesInRange(state, candidate.chrom, candidate.start_bp, candidate.end_bp);
  if (!vals || !Array.isArray(vals.xpehh_mean) || vals.xpehh_mean.length === 0) {
    return XPEHH_AXIS_LABELS.NO_DATA;
  }
  // Prefer normed values when present.
  const useNorm = Array.isArray(vals.norm_xpehh_mean)
    && vals.norm_xpehh_mean.some(v => Number.isFinite(v));
  const arr = useNorm ? vals.norm_xpehh_mean : vals.xpehh_mean;
  let maxAbs = 0;
  let nMild = 0;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > maxAbs) maxAbs = a;
    if (a >= mildZ) nMild++;
  }
  if (maxAbs >= strongZ || nMild >= strongN) {
    return XPEHH_AXIS_LABELS.STRONG_OUTLIER;
  }
  if (maxAbs >= mildZ) {
    return XPEHH_AXIS_LABELS.MILD_OUTLIER;
  }
  return XPEHH_AXIS_LABELS.NO_SIGNAL;
}
