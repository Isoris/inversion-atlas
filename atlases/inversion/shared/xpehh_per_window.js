// shared/xpehh_per_window.js
//
// Atlas-side consumer of the XP-EHH per-window track layer
// (specs_todo/SPEC_xpehh_per_window_track.md). The layer is produced
// server-side by selscan on the phased BEAGLE VCF; the atlas does not
// recompute it.
//
// Pure JS — no DOM, no fetch. localStorage is headless-tolerant
// (mirrors dxy_per_inversion.js / cross_species.js / karyotype_lineage.js
// — the existing per-layer convention).
//
// Eight exports drive the popstats-page (cartridge popstats) XP-EHH track:
//
//   isXpehhPerWindowJSON(data) → {ok, reasons}
//        Schema validator. Caller can show reasons[0] in a status pill.
//
//   storeXpehhPerWindow / persistXpehhPerWindow /
//   restoreXpehhPerWindow / clearXpehhPerWindow
//        State + localStorage lifecycle.
//
//   xpehhWindowsForChrom(state, chrom)
//        Per-chrom arrays bundle from the layer.
//
//   xpehhValueAtPosition(state, chrom, pos_bp)
//        Lookup the window covering `pos_bp` (returns null on miss).
//
//   xpehhValuesInRange(state, chrom, start_bp, end_bp)
//        Slice the per-window arrays for a bp range.
//
//   xpehhOutliers(state, chrom, opts)
//        Windows with |norm_xpehh_mean| ≥ z_threshold (default 2.0)
//        OR the top `pct` by magnitude — Sabeti-style outlier call.
//
//   xpehhTrackHeader(state)
//        'testCohort vs refCohort (n_test/n_ref)' for the track title
//        (spec §Tests: "test/ref cohort labels visible in the track
//         title so user knows which way the sign points").
//
//   xpehhAlignsWithTrack(state, chrom, otherWindows)
//        Window-grid alignment check vs another popstats track
//        (spec §Tests: "window grid matches F_ST exactly").

// =====================================================================
// Constants
// =====================================================================

export const XPEHH_PER_WINDOW_TOOL = 'xpehh_per_window_v1';
export const XPEHH_PER_WINDOW_SCHEMA_VERSION = 1;
export const XPEHH_PER_WINDOW_LS_KEY = 'inversion_atlas.xpehhPerWindow.v1';

/** Default z-score outlier threshold (spec §Architecture: ±2). */
export const XPEHH_OUTLIER_Z_DEFAULT = 2.0;

/** Default top-percentile fallback when norm_xpehh_mean is absent. */
export const XPEHH_OUTLIER_PCT_DEFAULT = 0.01;

// =====================================================================
// Headless-safe LS
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// 1. Schema validator
// =====================================================================

/**
 * Validate a parsed xpehh_per_window_v1 payload.
 *
 * @param {Object} data
 * @returns {{ok:boolean, reasons?:Array<string>}}
 */
export function isXpehhPerWindowJSON(data) {
  const reasons = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, reasons: ['payload is not an object'] };
  }
  if (data.schema_version !== XPEHH_PER_WINDOW_SCHEMA_VERSION) {
    reasons.push('schema_version !== ' + XPEHH_PER_WINDOW_SCHEMA_VERSION);
  }
  if (typeof data.test_cohort_id !== 'string' || !data.test_cohort_id) {
    reasons.push('test_cohort_id missing');
  }
  if (typeof data.ref_cohort_id !== 'string' || !data.ref_cohort_id) {
    reasons.push('ref_cohort_id missing');
  }
  if (!Number.isFinite(data.n_test) || !Number.isFinite(data.n_ref)) {
    reasons.push('n_test or n_ref missing / non-numeric');
  }
  if (!data.windows || typeof data.windows !== 'object') {
    reasons.push('windows{} missing');
  } else {
    const chroms = Object.keys(data.windows);
    if (chroms.length === 0) reasons.push('windows{} is empty');
    for (const ch of chroms) {
      const w = data.windows[ch];
      if (!w || typeof w !== 'object') {
        reasons.push('windows.' + ch + ' is not an object');
        continue;
      }
      const required = ['window_start_bp', 'window_end_bp', 'xpehh_mean'];
      for (const k of required) {
        if (!Array.isArray(w[k])) {
          reasons.push('windows.' + ch + '.' + k + ' missing or not an array');
        }
      }
      if (Array.isArray(w.window_start_bp)
          && Array.isArray(w.window_end_bp)
          && w.window_start_bp.length !== w.window_end_bp.length) {
        reasons.push('windows.' + ch + ': start/end length mismatch');
      }
      break;   // one report per chrom is plenty
    }
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true };
}

// =====================================================================
// 2. Store / lifecycle
// =====================================================================

/**
 * Store the validated payload onto state.xpehhPerWindow. No-op when
 * state is null or the payload fails validation. Deep-clones to avoid
 * mutation surprises (matches dxy_per_inversion convention).
 *
 * @param {Object} state
 * @param {Object} parsed
 * @returns {boolean}
 */
export function storeXpehhPerWindow(state, parsed) {
  if (!state) return false;
  const v = isXpehhPerWindowJSON(parsed);
  if (!v.ok) return false;
  state.xpehhPerWindow = {
    schema_version: parsed.schema_version,
    tool: parsed.tool || XPEHH_PER_WINDOW_TOOL,
    generated_at: parsed.generated_at || null,
    test_cohort_id: parsed.test_cohort_id,
    ref_cohort_id:  parsed.ref_cohort_id,
    n_test: parsed.n_test,
    n_ref:  parsed.n_ref,
    tool_args: parsed.tool_args || null,
    windows: JSON.parse(JSON.stringify(parsed.windows)),
    loaded_at: new Date().toISOString(),
  };
  return true;
}

export function persistXpehhPerWindow(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    if (state.xpehhPerWindow) {
      localStorage.setItem(XPEHH_PER_WINDOW_LS_KEY,
        JSON.stringify(state.xpehhPerWindow));
    } else {
      localStorage.removeItem(XPEHH_PER_WINDOW_LS_KEY);
    }
    return true;
  } catch (_) { return false; }
}

export function restoreXpehhPerWindow(state) {
  if (!state || !_hasLocalStorage()) return false;
  try {
    const raw = localStorage.getItem(XPEHH_PER_WINDOW_LS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return storeXpehhPerWindow(state, parsed);
  } catch (_) { return false; }
}

export function clearXpehhPerWindow(state) {
  if (!state) return;
  state.xpehhPerWindow = null;
  persistXpehhPerWindow(state);
}

// =====================================================================
// 3. Accessors
// =====================================================================

/**
 * Per-chrom window bundle from the layer. Returns null when the
 * chrom isn't present in the layer.
 *
 * @param {Object} state
 * @param {string} chrom
 * @returns {Object|null}
 */
export function xpehhWindowsForChrom(state, chrom) {
  const layer = state && state.xpehhPerWindow;
  if (!layer || !layer.windows) return null;
  return layer.windows[chrom] || null;
}

/**
 * Lookup the window covering bp position `pos_bp` on `chrom`. Returns
 * the window record `{idx, start_bp, end_bp, xpehh_mean,
 * norm_xpehh_mean, xpehh_max_abs, n_snps}` or null on miss.
 *
 * @param {Object} state
 * @param {string} chrom
 * @param {number} pos_bp
 * @returns {Object|null}
 */
export function xpehhValueAtPosition(state, chrom, pos_bp) {
  const w = xpehhWindowsForChrom(state, chrom);
  if (!w || !Array.isArray(w.window_start_bp) || !Array.isArray(w.window_end_bp)) {
    return null;
  }
  if (!Number.isFinite(pos_bp)) return null;
  const starts = w.window_start_bp;
  const ends = w.window_end_bp;
  // Binary search on starts for first start_bp > pos_bp, then pick the
  // window before it whose end_bp ≥ pos_bp.
  let lo = 0, hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] > pos_bp) hi = mid;
    else lo = mid + 1;
  }
  const idx = lo - 1;
  if (idx < 0 || idx >= starts.length) return null;
  if (pos_bp < starts[idx] || pos_bp > ends[idx]) return null;
  return {
    idx,
    start_bp: starts[idx],
    end_bp:   ends[idx],
    xpehh_mean:     _read(w.xpehh_mean, idx),
    norm_xpehh_mean: _read(w.norm_xpehh_mean, idx),
    xpehh_max_abs:  _read(w.xpehh_max_abs, idx),
    n_snps:         _read(w.n_snps, idx),
  };
}

function _read(arr, i) {
  if (!Array.isArray(arr)) return null;
  const v = arr[i];
  return v === undefined ? null : v;
}

/**
 * Slice the per-window arrays for a bp range `[start_bp, end_bp]`.
 * Returns null when chrom is absent. Inclusive boundaries based on
 * window midpoint.
 *
 * @param {Object} state
 * @param {string} chrom
 * @param {number} start_bp
 * @param {number} end_bp
 * @returns {Object|null}
 */
export function xpehhValuesInRange(state, chrom, start_bp, end_bp) {
  const w = xpehhWindowsForChrom(state, chrom);
  if (!w || !Array.isArray(w.window_start_bp)) return null;
  if (!Number.isFinite(start_bp) || !Number.isFinite(end_bp)) return null;
  const starts = w.window_start_bp;
  const ends = w.window_end_bp;
  const out = {
    window_start_bp: [],
    window_end_bp:   [],
    xpehh_mean:      [],
    norm_xpehh_mean: [],
    xpehh_max_abs:   [],
    n_snps:          [],
    indices:         [],
  };
  for (let i = 0; i < starts.length; i++) {
    const mid = 0.5 * (starts[i] + ends[i]);
    if (mid < start_bp || mid > end_bp) continue;
    out.window_start_bp.push(starts[i]);
    out.window_end_bp.push(ends[i]);
    out.xpehh_mean.push(_read(w.xpehh_mean, i));
    out.norm_xpehh_mean.push(_read(w.norm_xpehh_mean, i));
    out.xpehh_max_abs.push(_read(w.xpehh_max_abs, i));
    out.n_snps.push(_read(w.n_snps, i));
    out.indices.push(i);
  }
  return out;
}

// =====================================================================
// 4. Outlier classifier
// =====================================================================

/**
 * Windows on `chrom` flagged as outliers per:
 *
 *   - When `norm_xpehh_mean` is populated: |norm_xpehh_mean| ≥
 *     `opts.z_threshold` (default 2.0, Sabeti's ±2 horizontal lines).
 *   - When `norm_xpehh_mean` is absent: top `opts.pct` (default 1 %)
 *     by |xpehh_mean| magnitude across the chrom.
 *
 * Returns an array `[{idx, start_bp, end_bp, value, sign}]`. Empty
 * when the chrom isn't in the layer.
 *
 * @param {Object} state
 * @param {string} chrom
 * @param {{z_threshold?:number, pct?:number}} [opts]
 * @returns {Array<Object>}
 */
export function xpehhOutliers(state, chrom, opts) {
  const w = xpehhWindowsForChrom(state, chrom);
  if (!w) return [];
  const o = opts || {};
  const z = Number.isFinite(o.z_threshold)
    ? o.z_threshold : XPEHH_OUTLIER_Z_DEFAULT;
  const pct = Number.isFinite(o.pct)
    ? o.pct : XPEHH_OUTLIER_PCT_DEFAULT;
  const out = [];

  const useNorm = Array.isArray(w.norm_xpehh_mean)
    && w.norm_xpehh_mean.some(v => Number.isFinite(v));

  if (useNorm) {
    for (let i = 0; i < w.norm_xpehh_mean.length; i++) {
      const v = w.norm_xpehh_mean[i];
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) >= z) {
        out.push({
          idx: i,
          start_bp: w.window_start_bp[i],
          end_bp: w.window_end_bp[i],
          value: v,
          sign: v >= 0 ? 1 : -1,
        });
      }
    }
    return out;
  }
  // Fallback: top-pct by |xpehh_mean|.
  if (!Array.isArray(w.xpehh_mean)) return [];
  const indexed = [];
  for (let i = 0; i < w.xpehh_mean.length; i++) {
    const v = w.xpehh_mean[i];
    if (!Number.isFinite(v)) continue;
    indexed.push({ i, v });
  }
  indexed.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const k = Math.max(1, Math.floor(indexed.length * pct));
  for (let j = 0; j < k && j < indexed.length; j++) {
    const { i, v } = indexed[j];
    out.push({
      idx: i,
      start_bp: w.window_start_bp[i],
      end_bp: w.window_end_bp[i],
      value: v,
      sign: v >= 0 ? 1 : -1,
    });
  }
  // Restore positional order so callers reading left → right don't
  // see them shuffled by magnitude.
  out.sort((a, b) => a.start_bp - b.start_bp);
  return out;
}

// =====================================================================
// 5. Header + alignment
// =====================================================================

/**
 * Track-header string for the popstats panel title (spec §Tests:
 * "test/ref cohort labels visible in the track title").
 *
 *   'Gar_226_HOM_INV_at_LG28_inv vs Gar_226_HOM_REF_at_LG28_inv (60/60)'
 *
 * Returns `null` when no layer is loaded.
 *
 * @param {Object} state
 * @returns {string|null}
 */
export function xpehhTrackHeader(state) {
  const layer = state && state.xpehhPerWindow;
  if (!layer) return null;
  return layer.test_cohort_id + ' vs ' + layer.ref_cohort_id
    + ' (' + layer.n_test + '/' + layer.n_ref + ')';
}

/**
 * Confirm the XP-EHH window grid matches another popstats track's
 * grid on the same chrom (spec §Tests: "window grid matches F_ST
 * exactly"). Caller passes the other track's
 * `{window_start_bp, window_end_bp}` arrays.
 *
 * @param {Object} state
 * @param {string} chrom
 * @param {{window_start_bp:Array<number>, window_end_bp:Array<number>}} otherWindows
 * @returns {{ok:boolean, reason?:string,
 *           n_xpehh:number, n_other:number}}
 */
export function xpehhAlignsWithTrack(state, chrom, otherWindows) {
  const w = xpehhWindowsForChrom(state, chrom);
  if (!w) {
    return { ok: false, reason: 'xpehh_chrom_missing',
             n_xpehh: 0, n_other: 0 };
  }
  if (!otherWindows || !Array.isArray(otherWindows.window_start_bp)
      || !Array.isArray(otherWindows.window_end_bp)) {
    return { ok: false, reason: 'other_windows_malformed',
             n_xpehh: w.window_start_bp.length, n_other: 0 };
  }
  const a = w.window_start_bp, b = otherWindows.window_start_bp;
  const ea = w.window_end_bp, eb = otherWindows.window_end_bp;
  const n_xpehh = a.length, n_other = b.length;
  if (n_xpehh !== n_other) {
    return { ok: false, reason: 'length_mismatch', n_xpehh, n_other };
  }
  for (let i = 0; i < n_xpehh; i++) {
    if (a[i] !== b[i] || ea[i] !== eb[i]) {
      return { ok: false, reason: 'window_grid_mismatch_at_' + i,
               n_xpehh, n_other };
    }
  }
  return { ok: true, n_xpehh, n_other };
}
