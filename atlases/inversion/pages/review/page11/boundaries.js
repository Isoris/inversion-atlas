// pages/review/page11/boundaries.js
//
// Boundary refinement — pure-helper port from legacy lines 17687-18430.
// First-pass cartridge implementation of the page11 "3 boundaries"
// subsystem: constants + binary search + smoothing + MAD normalization
// + scan-range computation + support-class verdict + boundary record
// builder + staging-state initializer.
//
// Skipped in this round (deferred to a follow-up): _buildBoundaryTrackScores,
// _computeBoundaryEdges, _bndAutoPropose, the full page UI (canvas
// rendering of zone bars, candidate select, save/reset wiring). Those
// depend on state.data layer shapes that need more context.

// =====================================================================
// Constants
// =====================================================================

/** Default scan parameters + status vocabulary. Locked per legacy 17687. */
export const BOUNDARY_DEFAULTS = Object.freeze({
  SCAN_RADIUS_BP:        1_500_000,  // 1.5 Mb each side
  ZONE_RADIUS_WINDOWS:   5,          // ±5 windows per zone
  SMOOTH_WINDOW:         3,          // rolling-median width (odd)
  EXCLUDE_OUTER_PCT:     0.10,       // ignore outermost 10%
  SUPPORT_INCLUSION:     0.5,        // ≥ 0.5 × median nonzero → in support[]
  CANDIDATE_HUGE_BP:     3_000_000,  // 3 Mb threshold for scan expansion
  CANDIDATE_HUGE_RATIO:  0.5,        // 0.5×span instead of fixed radius
  STATUSES:              Object.freeze(['boundary_zone_only', 'SV_supported', 'junction_supported']),
});

/** Locked per-track weights. Sum to 1.0. */
export const BOUNDARY_TRACK_WEIGHTS = Object.freeze({
  pca_drop:               0.20,
  dosage_transition:      0.18,
  band_continuity_drop:   0.14,
  ghsl_step:              0.12,
  polarity_change:        0.10,
  het_transition:         0.06,
  similarity_edge:        0.05,
  fst_edge:               0.05,
  theta_pi_step:          0.04,
  discordant_pile:        0.04,
  sv_anchor:              0.02,
});

/** Per-track polarity. +1 = track rises INSIDE the inversion;
 *  -1 = track falls INSIDE (flip before summing). */
export const BOUNDARY_TRACK_POLARITY = Object.freeze({
  pca_drop:               +1,
  dosage_transition:      +1,
  band_continuity_drop:   -1,
  ghsl_step:              +1,
  polarity_change:        +1,
  het_transition:         +1,
  similarity_edge:        -1,
  fst_edge:               +1,
  theta_pi_step:          -1,
  discordant_pile:        +1,
  sv_anchor:              +1,
});

/** Ordered list of all track names. */
export const BOUNDARY_TRACK_NAMES = Object.freeze(Object.keys(BOUNDARY_TRACK_WEIGHTS));

/** support_class color palette (schema §12 — locked). */
export const SUPPORT_CLASS_COLORS = Object.freeze({
  strong:    Object.freeze({ hex: '#1B7837', opacity: 0.20 }),
  moderate:  Object.freeze({ hex: '#F4A582', opacity: 0.18 }),
  weak:      Object.freeze({ hex: '#FDDBC7', opacity: 0.16 }),
  ambiguous: Object.freeze({ hex: '#BDBDBD', opacity: 0.10 }),
});

// =====================================================================
// Binary search
// =====================================================================

/**
 * Binary-search a sorted bp array for the index bracketing `target`.
 *
 * mode='lo': first index with arr[i] >= target (or arr.length if all <)
 * mode='hi': last index with arr[i] <= target (or -1 if all >)
 *
 * @param {ArrayLike<number>} arr   sorted ascending
 * @param {number} target
 * @param {'lo'|'hi'} mode
 * @returns {number}
 */
export function bsearchWin(arr, target, mode) {
  if (!arr || arr.length === 0) return mode === 'lo' ? 0 : -1;
  let lo = 0, hi = arr.length - 1;
  if (mode === 'lo') {
    if (target <= arr[0]) return 0;
    if (target > arr[hi]) return arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] >= target) hi = m;
      else lo = m + 1;
    }
    return lo;
  }
  // hi
  if (target < arr[0]) return -1;
  if (target >= arr[hi]) return hi;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (arr[m] <= target) lo = m;
    else hi = m - 1;
  }
  return lo;
}

// =====================================================================
// Rolling median + MAD normalization
// =====================================================================

/**
 * Rolling-median smoother. Returns Float64Array of same length.
 * Width should be odd; for even, the lower median is returned.
 * NA values (NaN, -1, null) are excluded from each median; a window
 * with no non-NA values yields NaN at that index.
 *
 * @param {ArrayLike<number>?} arr
 * @param {number} width
 * @returns {Float64Array}
 */
export function rollingMedian(arr, width) {
  if (!arr) return new Float64Array(0);
  const n = arr.length;
  const out = new Float64Array(n);
  const w = Math.max(1, width | 0);
  const half = (w - 1) >> 1;
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      const v = arr[j];
      if (v != null && Number.isFinite(v) && v !== -1) buf.push(v);
    }
    if (buf.length === 0) { out[i] = NaN; continue; }
    buf.sort((a, b) => a - b);
    out[i] = buf[(buf.length - 1) >> 1];
  }
  return out;
}

/**
 * Median absolute deviation, NA-tolerant. Returns 0 when fewer than 2
 * non-NA values (caller should fall back to ±1 to avoid div-by-zero).
 */
export function perTrackMad(arr) {
  if (!arr) return 0;
  const finite = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null && Number.isFinite(v) && v !== -1) finite.push(v);
  }
  if (finite.length < 2) return 0;
  finite.sort((a, b) => a - b);
  const med = finite[(finite.length - 1) >> 1];
  const abs = finite.map(v => Math.abs(v - med));
  abs.sort((a, b) => a - b);
  return abs[(abs.length - 1) >> 1];
}

/**
 * Element-wise division by a scalar MAD. Returns Float64Array. NA/-1/null
 * → 0 in output (so downstream sums don't propagate). MAD=0 → all zeros.
 */
export function madNormalize(arr, mad) {
  const n = arr ? arr.length : 0;
  const out = new Float64Array(n);
  if (!mad || !Number.isFinite(mad) || mad === 0) return out;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    out[i] = (v != null && Number.isFinite(v) && v !== -1) ? (v / mad) : 0;
  }
  return out;
}

// =====================================================================
// Support class verdict
// =====================================================================

/**
 * Resolve the support_class for an edge given its combined score and
 * its support[] array (the list of tracks that contributed ≥ inclusion
 * threshold). Verdicts: 'strong' | 'moderate' | 'weak' | 'ambiguous'.
 *
 * Rules (locked schema §12):
 *   n = 0                       → ambiguous
 *   n ≥ 3 AND score ≥ 0.60      → strong
 *   n == 2                      → moderate
 *   n ≥ 3 AND score ≥ 0.40      → moderate
 *   n == 1                      → weak
 *   n ≥ 2 AND score <  0.40     → weak
 *
 * @param {number} score
 * @param {Array<string>?} supportArr
 * @returns {'strong'|'moderate'|'weak'|'ambiguous'}
 */
export function supportClass(score, supportArr) {
  const n = (supportArr && supportArr.length) || 0;
  const s = Number.isFinite(score) ? Number(score) : 0;
  if (n === 0) return 'ambiguous';
  if (n >= 3 && s >= 0.60) return 'strong';
  if (n === 2)             return 'moderate';
  if (n >= 3 && s >= 0.40) return 'moderate';
  if (n === 1)             return 'weak';
  if (n >= 2 && s < 0.40)  return 'weak';
  return 'weak';
}

// =====================================================================
// Scan range
// =====================================================================

/**
 * Compute the scan region for a candidate — bp range AND window indices
 * when `windows` ({start_bp, end_bp}) is provided. Implements the
 * "candidate huge" expansion rule: when candidate span > CANDIDATE_HUGE_BP,
 * radius expands to span × CANDIDATE_HUGE_RATIO.
 *
 * @param {{start_bp:number, end_bp:number}} cand
 * @param {number?} scan_radius_bp   defaults to BOUNDARY_DEFAULTS.SCAN_RADIUS_BP
 * @param {number?} chromLen         optional clamp on end
 * @param {{start_bp:ArrayLike<number>, end_bp:ArrayLike<number>}?} windows
 * @returns {{start_bp:number, end_bp:number, win_lo:number, win_hi:number}|null}
 */
export function boundaryScanRange(cand, scan_radius_bp, chromLen, windows) {
  if (!cand || !Number.isFinite(cand.start_bp) || !Number.isFinite(cand.end_bp)) return null;
  const span = (cand.end_bp - cand.start_bp) || 0;
  let radius = scan_radius_bp != null ? scan_radius_bp : BOUNDARY_DEFAULTS.SCAN_RADIUS_BP;
  if (span > BOUNDARY_DEFAULTS.CANDIDATE_HUGE_BP) {
    radius = Math.max(radius, span * BOUNDARY_DEFAULTS.CANDIDATE_HUGE_RATIO);
  }
  const start_bp = Math.max(0, cand.start_bp - radius);
  const end_bp   = (chromLen != null && Number.isFinite(chromLen))
    ? Math.min(chromLen, cand.end_bp + radius)
    : (cand.end_bp + radius);
  let win_lo = 0, win_hi = 0;
  if (windows && windows.start_bp && windows.end_bp) {
    win_lo = bsearchWin(windows.start_bp, start_bp, 'lo');
    const hiIdx = bsearchWin(windows.end_bp, end_bp, 'hi');
    win_hi = Math.max(win_lo, hiIdx);
  }
  return { start_bp, end_bp, win_lo, win_hi };
}

// =====================================================================
// SV anchor filter
// =====================================================================

/**
 * Filter SV anchors (boundary_evidence.tracks.sv_anchors) to those whose
 * pos_bp falls inside the zone. Returns shallow-cloned anchor objects.
 *
 * @param {Object?} boundaryEvidenceRow
 * @param {number} zoneStartBp
 * @param {number} zoneEndBp
 * @returns {Array<Object>}
 */
export function findSVAnchorsInZone(boundaryEvidenceRow, zoneStartBp, zoneEndBp) {
  if (!boundaryEvidenceRow || !boundaryEvidenceRow.tracks) return [];
  const anchors = boundaryEvidenceRow.tracks.sv_anchors;
  if (!Array.isArray(anchors)) return [];
  const out = [];
  for (const a of anchors) {
    if (!a) continue;
    if (!Number.isFinite(a.pos_bp)) continue;
    if (a.pos_bp >= zoneStartBp && a.pos_bp <= zoneEndBp) {
      out.push(Object.assign({}, a));
    }
  }
  return out;
}

// =====================================================================
// Boundary state
// =====================================================================

/**
 * Initialise state.__boundaries on first access. Idempotent — returns
 * the existing slot when present. Mutates state.
 *
 * @param {Object} state
 * @returns {Object}
 */
export function ensureBoundariesState(state) {
  if (!state) return null;
  if (!state.__boundaries) {
    state.__boundaries = {
      active_cand_id: null,
      scan_radius_bp: BOUNDARY_DEFAULTS.SCAN_RADIUS_BP,
      staging: {
        cand_id:           null,
        boundary_left:     null,
        boundary_right:    null,
        breakpoint_status: 'boundary_zone_only',
        boundary_notes:    '',
        dirty:             false,
      },
      cache: new Map(),
    };
  }
  return state.__boundaries;
}

// =====================================================================
// Boundary record
// =====================================================================

/**
 * Deep-clone a boundary record (so staging copies don't alias committed
 * state).
 *
 * @param {Object?} rec
 * @returns {Object|null}
 */
export function bndCloneRecord(rec) {
  if (!rec) return null;
  return {
    zone_start_bp: rec.zone_start_bp,
    zone_end_bp:   rec.zone_end_bp,
    score:         rec.score,
    support:       Array.isArray(rec.support) ? rec.support.slice() : [],
    support_class: rec.support_class,
    source:        rec.source,
    sv_anchors_in_zone: Array.isArray(rec.sv_anchors_in_zone)
                          ? rec.sv_anchors_in_zone.map(a => Object.assign({}, a))
                          : [],
    notes:         rec.notes || '',
    set_at:        rec.set_at,
    set_by:        rec.set_by,
  };
}

/**
 * Build a boundary record from an edge result. Requires `windows`
 * ({start_bp, end_bp}) to compute the zone bp range from the window
 * index. Headless-friendly: pure function.
 *
 * @param {{window_idx:number, score:number, support?:Array<string>}} edge
 * @param {'left'|'right'} side
 * @param {'auto'|'manual'|'auto_plus_manual'} source
 * @param {{windows: {start_bp:ArrayLike<number>, end_bp:ArrayLike<number>},
 *         zone_radius_windows?:number, sv_anchors?:Array<Object>,
 *         now?:Date}} opts
 * @returns {Object|null}
 */
export function buildBoundaryRecord(edge, side, source, opts) {
  if (!edge) return null;
  const o = opts || {};
  const W = o.windows;
  if (!W || !W.start_bp || !W.end_bp) return null;
  const r = (o.zone_radius_windows != null)
    ? o.zone_radius_windows : BOUNDARY_DEFAULTS.ZONE_RADIUS_WINDOWS;
  const wIdx = edge.window_idx | 0;
  const lo = Math.max(0, wIdx - r);
  const hi = Math.min(W.start_bp.length - 1, wIdx + r);
  const zone_start_bp = W.start_bp[lo];
  const zone_end_bp   = W.end_bp[hi];
  const now = (o.now instanceof Date ? o.now : new Date());
  return {
    zone_start_bp,
    zone_end_bp,
    score: Number((edge.score || 0).toFixed(4)),
    support: (edge.support || []).slice(),
    support_class: supportClass(edge.score, edge.support),
    source: source || 'auto',
    sv_anchors_in_zone: o.sv_anchors || [],
    notes: '',
    set_at: now.toISOString(),
    set_by: source === 'manual' ? 'scrubber_manual'
          : source === 'auto_plus_manual' ? 'scrubber_manual'
          : 'scrubber_auto',
  };
}

// =====================================================================
// Candidate registry helpers
// =====================================================================

/**
 * Find a candidate by its registry id (checks both .id and .candidate_id).
 *
 * @param {Object} state  state.candidateList = Array<Object>
 * @param {string|number?} candId
 * @returns {Object|null}
 */
export function bndFindCandidate(state, candId) {
  if (candId == null) return null;
  const list = (state && state.candidateList) || [];
  for (const c of list) {
    if (!c) continue;
    if (c.id === candId || c.candidate_id === candId) return c;
  }
  return null;
}

/**
 * Format bp as "12,018,473 bp". Returns "? bp" for nullish/non-finite.
 *
 * @param {number|string} n
 * @returns {string}
 */
export function bndFmtBp(n) {
  if (n == null || !Number.isFinite(Number(n))) return '? bp';
  try { return Number(n).toLocaleString('en-US') + ' bp'; }
  catch (_) { return n + ' bp'; }
}

/**
 * Populate state.__boundaries.staging from a candidate's existing
 * boundary fields. Always clears `dirty`. Returns the staging slot.
 *
 * @param {Object} state
 * @param {Object} cand
 * @returns {Object}
 */
export function bndStageFromCandidate(state, cand) {
  const bs = ensureBoundariesState(state);
  bs.staging = {
    cand_id: cand ? (cand.id != null ? cand.id : cand.candidate_id) : null,
    boundary_left:  cand ? bndCloneRecord(cand.boundary_left)  : null,
    boundary_right: cand ? bndCloneRecord(cand.boundary_right) : null,
    breakpoint_status: (cand && cand.breakpoint_status) || 'boundary_zone_only',
    boundary_notes:    (cand && cand.boundary_notes) || '',
    dirty: false,
  };
  return bs.staging;
}
