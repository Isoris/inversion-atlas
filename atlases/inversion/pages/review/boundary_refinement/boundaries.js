// pages/review/boundary_refinement/boundaries.js
//
// Boundary refinement — pure-helper port from legacy lines 17687-18430.
// First-pass cartridge implementation of the boundary_refinement "3 boundaries"
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
// Track score builder — converts layer data → per-track per-window arrays
// =====================================================================

/**
 * Resample a fixed-window-grid source array onto the local-PCA window
 * grid via bp-overlap averaging. Pure: takes the scan window bp grid
 * + the source's bp grid origin + step.
 *
 * @param {ArrayLike<number>?} sourceArr   values on the source grid
 * @param {number} scanStartBp             source grid origin
 * @param {number} scanWindowBp            source grid step
 * @param {ArrayLike<number>} winStartBp   target window start_bp
 * @param {ArrayLike<number>} winEndBp     target window end_bp
 * @param {number} winLo                   local window-index offset
 * @param {number} len                     local length
 * @returns {Float64Array|null}
 */
export function resampleBoundaryEvidenceTrack(sourceArr, scanStartBp, scanWindowBp, winStartBp, winEndBp, winLo, len) {
  if (!Array.isArray(sourceArr) && !ArrayBuffer.isView(sourceArr)) return null;
  if (!winStartBp || !winEndBp) return null;
  if (!Number.isFinite(scanStartBp) || !Number.isFinite(scanWindowBp) || scanWindowBp <= 0) return null;
  const a = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const wi = winLo + i;
    const s = winStartBp[wi], e = winEndBp[wi];
    if (!Number.isFinite(s) || !Number.isFinite(e)) { a[i] = NaN; continue; }
    const j0 = Math.max(0, Math.floor((s - scanStartBp) / scanWindowBp));
    const j1 = Math.min(sourceArr.length - 1, Math.floor((e - scanStartBp) / scanWindowBp));
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j++) {
      const v = sourceArr[j];
      if (v != null && Number.isFinite(v)) { sum += v; n++; }
    }
    a[i] = n > 0 ? (sum / n) : NaN;
  }
  return a;
}

/**
 * Build per-track per-window score arrays for a candidate's scan range.
 * Pure: takes `data` (= state.data shape) explicitly. Only includes
 * tracks whose source layer is present; absent tracks are omitted from
 * the result entirely so caller can detect via Object.keys.
 *
 * Recognised data sources (sub-fields of `data`):
 *   - windows.pve1                       → pca_drop
 *   - windows.band_continuity_score      → band_continuity_drop
 *   - windows.similarity_edge_score      → similarity_edge
 *   - ghsl_panel.div_median ([nS][nW] or [nW]) → ghsl_step + het_transition
 *   - candidate_marker_polarity (per-cand rows) → polarity_change
 *   - boundary_evidence (per-cand row) → fst_edge, theta_pi_step,
 *     discordant_pile, sv_anchor
 *
 * `opts.dosageMeans` (optional ArrayLike) lets caller inject a cached
 * dosage mean array; when present and length matches `len`, ships as
 * the `dosage_transition` track.
 *
 * @param {Object} data
 * @param {Object} cand
 * @param {{win_lo:number, win_hi:number}} scanRange
 * @param {{dosageMeans?:ArrayLike<number>}} opts
 * @returns {{tracks:Object<string,Float64Array>, len:number, win_lo:number, win_hi:number}}
 */
export function buildBoundaryTrackScores(data, cand, scanRange, opts) {
  if (!cand || !scanRange) return { tracks: {}, len: 0, win_lo: 0, win_hi: 0 };
  const winLo = scanRange.win_lo | 0;
  const winHi = scanRange.win_hi | 0;
  const len = Math.max(0, winHi - winLo + 1);
  const tracks = {};
  if (len === 0) return { tracks, len: 0, win_lo: winLo, win_hi: winHi };

  const d = data || {};
  const W = d.windows || null;
  const o = opts || {};

  const _copyWindow = (arr) => {
    if (!arr || arr.length <= winHi) return null;
    const a = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      const v = arr[winLo + i];
      a[i] = (v != null && Number.isFinite(v)) ? v : NaN;
    }
    return a;
  };

  if (W) {
    const pca = _copyWindow(W.pve1);
    if (pca) tracks.pca_drop = pca;
    const bcd = _copyWindow(W.band_continuity_score);
    if (bcd) tracks.band_continuity_drop = bcd;
    const sim = _copyWindow(W.similarity_edge_score);
    if (sim) tracks.similarity_edge = sim;
  }

  // ghsl_step + het_transition from ghsl_panel.div_median
  if (d.ghsl_panel && d.ghsl_panel.div_median) {
    const dm = d.ghsl_panel.div_median;
    if (Array.isArray(dm) && dm.length > 0) {
      const isMatrix = Array.isArray(dm[0]);
      const a = new Float64Array(len);
      if (isMatrix) {
        for (let i = 0; i < len; i++) {
          const wi = winLo + i;
          let sum = 0, n = 0;
          for (let s = 0; s < dm.length; s++) {
            const v = dm[s] && dm[s][wi];
            if (v != null && Number.isFinite(v)) { sum += v; n++; }
          }
          a[i] = n > 0 ? sum / n : NaN;
        }
      } else {
        for (let i = 0; i < len; i++) {
          const v = dm[winLo + i];
          a[i] = (v != null && Number.isFinite(v)) ? v : NaN;
        }
      }
      tracks.ghsl_step = a;
      tracks.het_transition = new Float64Array(a);
    }
  }

  // Dosage transition (caller-injected cache)
  if (o.dosageMeans && o.dosageMeans.length === len) {
    tracks.dosage_transition = new Float64Array(o.dosageMeans);
  }

  // polarity_change from candidate_marker_polarity (per-cand rows)
  if (Array.isArray(d.candidate_marker_polarity) && W && W.start_bp && W.end_bp) {
    const pol = d.candidate_marker_polarity.filter(r =>
      r && r.candidate_id === cand.id && Number.isFinite(r.pos));
    if (pol.length > 0) {
      const a = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        const wi = winLo + i;
        const s = W.start_bp[wi], e = W.end_bp[wi];
        let nIn = 0, nFlip = 0;
        for (const p of pol) {
          if (p.pos >= s && p.pos <= e) {
            nIn++;
            if (p.final_flip_decision === true) nFlip++;
          }
        }
        a[i] = nIn > 0 ? (nFlip / nIn) : NaN;
      }
      tracks.polarity_change = a;
    }
  }

  // boundary_evidence-derived tracks
  if (Array.isArray(d.boundary_evidence) && W && W.start_bp && W.end_bp) {
    const beRow = d.boundary_evidence.find(r => r && r.candidate_id === cand.id);
    if (beRow && beRow.tracks) {
      const sw = beRow.scan_window_bp || 5000;
      const ss = beRow.scan_start_bp != null ? beRow.scan_start_bp : 0;
      const t = beRow.tracks;
      const fst = resampleBoundaryEvidenceTrack(t.fst, ss, sw, W.start_bp, W.end_bp, winLo, len);
      if (fst) tracks.fst_edge = fst;

      // theta-pi step: mean across regimes when present
      const tpArrays = [];
      if (Array.isArray(t.theta_pi_homo1)) tpArrays.push(resampleBoundaryEvidenceTrack(t.theta_pi_homo1, ss, sw, W.start_bp, W.end_bp, winLo, len));
      if (Array.isArray(t.theta_pi_het))   tpArrays.push(resampleBoundaryEvidenceTrack(t.theta_pi_het,   ss, sw, W.start_bp, W.end_bp, winLo, len));
      if (Array.isArray(t.theta_pi_homo2)) tpArrays.push(resampleBoundaryEvidenceTrack(t.theta_pi_homo2, ss, sw, W.start_bp, W.end_bp, winLo, len));
      const tpClean = tpArrays.filter(Boolean);
      if (tpClean.length > 0) {
        const a = new Float64Array(len);
        for (let i = 0; i < len; i++) {
          let sum = 0, n = 0;
          for (const tpa of tpClean) {
            const v = tpa[i];
            if (v != null && Number.isFinite(v)) { sum += v; n++; }
          }
          a[i] = n > 0 ? sum / n : NaN;
        }
        tracks.theta_pi_step = a;
      }

      const disc = resampleBoundaryEvidenceTrack(t.discordant_pair_pileup, ss, sw, W.start_bp, W.end_bp, winLo, len);
      if (disc) tracks.discordant_pile = disc;

      // sv_anchor: 1 per window when any anchor's pos_bp lands inside
      if (Array.isArray(t.sv_anchors) && t.sv_anchors.length > 0) {
        const a = new Float64Array(len);
        for (let i = 0; i < len; i++) {
          const wi = winLo + i;
          const s = W.start_bp[wi], e = W.end_bp[wi];
          let any = 0;
          for (const sv of t.sv_anchors) {
            if (sv && sv.pos_bp >= s && sv.pos_bp <= e) { any = 1; break; }
          }
          a[i] = any;
        }
        tracks.sv_anchor = a;
      }
    }
  }

  return { tracks, len, win_lo: winLo, win_hi: winHi };
}

// =====================================================================
// Edge detection — combined boundary peak finder
// =====================================================================

// Internal MAD that treats only NaN/null as missing — step arrays
// computed inside computeBoundaryEdges are floating-point derivatives
// where -1 is a legitimate value, not the source-layer NA sentinel.
function _madFiniteOnly(arr) {
  if (!arr) return 0;
  const finite = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) finite.push(v);
  }
  if (finite.length < 2) return 0;
  finite.sort((a, b) => a - b);
  const med = finite[(finite.length - 1) >> 1];
  const abs = finite.map(v => Math.abs(v - med));
  abs.sort((a, b) => a - b);
  return abs[(abs.length - 1) >> 1];
}

function _normalizeFiniteOnly(arr, mad) {
  const len = arr ? arr.length : 0;
  const out = new Float64Array(len);
  if (!mad || !Number.isFinite(mad) || mad === 0) return out;
  for (let i = 0; i < len; i++) {
    const v = arr[i];
    out[i] = (v != null && Number.isFinite(v)) ? (v / mad) : 0;
  }
  return out;
}


/**
 * Combine per-track score arrays into left/right edge candidates.
 * Algorithm (legacy lines 18127-18255):
 *
 *   1. Renormalize weights over present tracks so they sum to 1.0.
 *      Equal-weight fallback when the present tracks have no defined
 *      weight.
 *   2. Per track: rollingMedian smooth → forward step (b - a) →
 *      polarity flip (BOUNDARY_TRACK_POLARITY) → MAD normalize.
 *      Smoothing the score (not the step) preserves clean transitions
 *      while suppressing single-window noise.
 *   3. Sum positive steps into combined_left[i] and absolute negative
 *      steps into combined_right[i], weighted by the per-track normW.
 *   4. Argmax left half (with outer-pct exclusion) → left edge.
 *      Argmax right half → right edge.
 *   5. Build per-edge support[] by including tracks whose contribution
 *      at the chosen window is ≥ inclusion_threshold × median nonzero.
 *
 * Returns { left, right, combined_left, combined_right } where each
 * edge (when present) is shaped:
 *   { window_idx, window_idx_local, score, support, by_track }
 *
 * Pure: doesn't touch document or state. All inputs explicit.
 *
 * @param {{tracks:Object<string,Float64Array>, len:number, win_lo:number}} trackScores
 * @param {Object<string,number>?} weights      defaults to BOUNDARY_TRACK_WEIGHTS
 * @param {{smooth_window?:number, support_inclusion?:number,
 *         exclude_outer_pct?:number}?} opts
 * @returns {{left:Object|null, right:Object|null,
 *           combined_left:Float64Array, combined_right:Float64Array}}
 */
export function computeBoundaryEdges(trackScores, weights, opts) {
  const o = opts || {};
  const w = weights || BOUNDARY_TRACK_WEIGHTS;
  const smoothW = o.smooth_window != null ? o.smooth_window : BOUNDARY_DEFAULTS.SMOOTH_WINDOW;
  const inclTh  = o.support_inclusion != null ? o.support_inclusion : BOUNDARY_DEFAULTS.SUPPORT_INCLUSION;
  const excPct  = o.exclude_outer_pct != null ? o.exclude_outer_pct : BOUNDARY_DEFAULTS.EXCLUDE_OUTER_PCT;

  const emptyResult = () => ({
    left: null, right: null,
    combined_left:  new Float64Array(0),
    combined_right: new Float64Array(0),
  });

  if (!trackScores || !trackScores.tracks) return emptyResult();
  const presentTracks = Object.keys(trackScores.tracks);
  const n = trackScores.len | 0;
  if (presentTracks.length === 0 || n < 4) return emptyResult();

  // Renormalize weights over present tracks
  let weightSum = 0;
  for (const t of presentTracks) weightSum += (w[t] || 0);
  const normW = {};
  if (weightSum > 0) {
    for (const t of presentTracks) normW[t] = (w[t] || 0) / weightSum;
  } else {
    for (const t of presentTracks) normW[t] = 1 / presentTracks.length;
  }

  // Per-track: smooth → step → polarity flip → MAD-normalize.
  // The MAD + normalize here use NaN-only (not -1 sentinel) checks
  // because step values are floating-point derivatives where -1 is a
  // legitimate negative value, not a missing-data marker.
  const stepNorm = {};
  for (const t of presentTracks) {
    const arr = trackScores.tracks[t];
    const smoothed = rollingMedian(arr, smoothW);
    const polarity = (BOUNDARY_TRACK_POLARITY[t] != null)
      ? BOUNDARY_TRACK_POLARITY[t] : 1;
    const step = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) {
      const a = smoothed[i], b = smoothed[i + 1];
      step[i] = (Number.isFinite(a) && Number.isFinite(b))
        ? polarity * (b - a) : 0;
    }
    step[n - 1] = 0;
    const mad = _madFiniteOnly(step);
    stepNorm[t] = _normalizeFiniteOnly(step, mad || 1);
  }

  // Combine per side (positive step → left, negative → right)
  const combined_left  = new Float64Array(n);
  const combined_right = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let cl = 0, cr = 0;
    for (const t of presentTracks) {
      const s = stepNorm[t][i];
      const ww = normW[t];
      if (s > 0)      cl += ww * s;
      else if (s < 0) cr += ww * (-s);
    }
    combined_left[i]  = cl;
    combined_right[i] = cr;
  }

  // Argmax in left/right halves with outer-pct exclusion
  const half  = Math.floor(n / 2);
  const excLo = Math.floor(n * excPct);
  const excHi = n - excLo;

  let argL = -1, valL = -1;
  for (let i = excLo; i < half; i++) {
    if (combined_left[i] > valL) { valL = combined_left[i]; argL = i; }
  }
  let argR = -1, valR = -1;
  for (let i = half; i < excHi; i++) {
    if (combined_right[i] > valR) { valR = combined_right[i]; argR = i; }
  }

  const winLo = trackScores.win_lo | 0;
  const emitEdge = (argIdx, val, side) => {
    if (argIdx < 0) return null;
    const contribs = {};
    for (const t of presentTracks) {
      const s = stepNorm[t][argIdx];
      const signed = (side === 'left') ? s : -s;
      contribs[t] = (signed > 0) ? normW[t] * signed : 0;
    }
    const nonZero = [];
    for (const t of presentTracks) if (contribs[t] > 0) nonZero.push(contribs[t]);
    if (nonZero.length === 0) return null;
    nonZero.sort((a, b) => a - b);
    const med = nonZero[(nonZero.length - 1) >> 1];
    const thr = med * inclTh;
    const support = [];
    for (const t of presentTracks) {
      if (contribs[t] >= thr) support.push(t);
    }
    support.sort();
    return {
      window_idx: winLo + argIdx,
      window_idx_local: argIdx,
      score: Math.min(1, val),
      support,
      by_track: contribs,
    };
  };

  return {
    left:  emitEdge(argL, valL, 'left'),
    right: emitEdge(argR, valR, 'right'),
    combined_left,
    combined_right,
  };
}

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
