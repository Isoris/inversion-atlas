// shared/band_tracking/window_classification.js
// =====================================================================
// Per-window three-way classification used by the seed-discovery walker
// and (optionally) by the chain walk break rule.
//
// Inputs at one window w:
//   v_to_anchor   ∈ [0, 1]   Cramer's V between the anchor's labels (on
//                            the anchor's tracked sample subset) and w's
//                            labels (on the same samples). High = labels
//                            preserved.
//   h_off         ∈ [0, 1]   Off-diagonal entropy of the Hungarian-aligned
//                            (anchor × w) contingency, normalised by
//                            log(K_eff - 1). Low = travelers leave their
//                            band coherently (real crossover); high =
//                            travelers scatter randomly (regime end).
//   band_quality  ∈ [0, 1]   Existing band-stability score for w.
//
// Output: one of four classes.
//   INTERIOR    — clean inversion interior; chain extends.
//   CROSSOVER   — real intra-inversion recombination; chain extends.
//   REGIME_END  — inversion footprint ends here; chain breaks.
//   UNRELIABLE  — w's data is too noisy to classify; walker skips and
//                 holds state across this window.
//
// The classification is the load-bearing decision in seed_discovery.js
// and the new chain-walk break rule. All thresholds are exposed as
// parameters with sensible defaults; calibrate on LG28.
// =====================================================================

export const WINDOW_CLASS = Object.freeze({
  INTERIOR:   'INTERIOR',
  CROSSOVER:  'CROSSOVER',
  REGIME_END: 'REGIME_END',
  UNRELIABLE: 'UNRELIABLE',
});

export const WINDOW_CLASSIFICATION_DEFAULTS = Object.freeze({
  // V thresholds: V > V_high → INTERIOR
  //               V_mod ≤ V ≤ V_high → CROSSOVER or REGIME_END (decided by H_off)
  //               V < V_mod → REGIME_END
  v_high:                 0.70,
  v_moderate:             0.40,
  // H_off threshold (only consulted when V is in the moderate band)
  h_off_low:              0.40,   // below = coherent travelers (CROSSOVER)
  h_off_high:             0.70,   // above = random scatter (REGIME_END)
  // band_quality threshold (gate before any V/H_off interpretation)
  band_quality_min:       0.40,
});

// ---------------------------------------------------------------------
// classifyWindow
//
// Returns one of WINDOW_CLASS values for a single window's signals.
// Pure function. Returns UNRELIABLE if any required input is missing or
// if band_quality is below threshold.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {number} args.v_to_anchor
 * @param {number} args.h_off
 * @param {number} args.band_quality
 * @param {object} [opts]
 * @returns {string}  one of WINDOW_CLASS values
 */
export function classifyWindow(args, opts) {
  const o = Object.assign({}, WINDOW_CLASSIFICATION_DEFAULTS, opts || {});
  const { v_to_anchor: v, h_off, band_quality: bq } = args;
  // band_quality gate runs first — UNRELIABLE windows are invisible to
  // the V/H_off interpretation regardless of their values.
  if (!Number.isFinite(bq) || bq < o.band_quality_min) return WINDOW_CLASS.UNRELIABLE;
  if (!Number.isFinite(v))                              return WINDOW_CLASS.UNRELIABLE;
  // Clear-interior case: V high, regardless of H_off.
  if (v >= o.v_high)                                    return WINDOW_CLASS.INTERIOR;
  // Clear-end case: V low, regardless of H_off.
  if (v < o.v_moderate)                                 return WINDOW_CLASS.REGIME_END;
  // Moderate-V band: H_off decides.
  // H_off may be NaN if the contingency has no off-diagonal mass at all
  // (perfect alignment). Treat that as "coherent" → CROSSOVER, but only
  // if V is at least somewhat elevated. With V in [v_mod, v_high) and no
  // travelers, we're in INTERIOR-adjacent territory; call it CROSSOVER
  // for chain-walking purposes (extends the chain).
  if (!Number.isFinite(h_off))                          return WINDOW_CLASS.CROSSOVER;
  if (h_off <= o.h_off_low)                             return WINDOW_CLASS.CROSSOVER;
  if (h_off >= o.h_off_high)                            return WINDOW_CLASS.REGIME_END;
  // H_off in the middle band: ambiguous. We default to REGIME_END
  // because chain extension across genuinely ambiguous transitions is
  // worse than under-extending — under-extension is recovered by the
  // cross-seed voting in Stage 2 (linkage groups merge). Over-extension
  // contaminates the seed's tracked-sample identity and degrades voting.
  return WINDOW_CLASS.REGIME_END;
}

// ---------------------------------------------------------------------
// classifyWindowGenomeWide
//
// Sweep classifier over a window range. Convenience wrapper. The caller
// supplies per-window getters; we don't re-derive any signals here.
// ---------------------------------------------------------------------

/**
 * @param {object} args
 * @param {(w:number) => number} args.getV         per-window V to anchor
 * @param {(w:number) => number} args.getHoff      per-window H_off to anchor
 * @param {(w:number) => number} args.getBandQuality
 * @param {number} args.s_window
 * @param {number} args.e_window
 * @param {object} [opts]
 * @returns {string[]}    classifications, length = e_window - s_window + 1
 */
export function classifyWindowsRange(args, opts) {
  const { getV, getHoff, getBandQuality, s_window, e_window } = args;
  const out = new Array(e_window - s_window + 1);
  for (let w = s_window; w <= e_window; w++) {
    out[w - s_window] = classifyWindow({
      v_to_anchor:  getV(w),
      h_off:        getHoff(w),
      band_quality: getBandQuality(w),
    }, opts);
  }
  return out;
}

// Console-debug
if (typeof window !== 'undefined') {
  window._classifyWindow      = classifyWindow;
  window._classifyWindowsRange = classifyWindowsRange;
  window._WINDOW_CLASS        = WINDOW_CLASS;
  window._WINDOW_CLASSIFICATION_DEFAULTS = WINDOW_CLASSIFICATION_DEFAULTS;
}
