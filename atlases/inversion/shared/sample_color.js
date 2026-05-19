// atlases/inversion/shared/sample_color.js
//
// Pure sample-color resolvers — every page in the cartridge that
// needs to color a sample by its family / ancestry / lineage / etc.
// pulls from here rather than reaching into another page's
// _pageState. Each function takes `state` as its first argument so
// the resolvers compose cleanly with any caller's state shape.
//
// Legacy source: lines 33287-33298 (_resolveSampleScopeColor),
// 36303-36311 (familyColor), 33220-33254 (_lineageColor). The
// auto-trigger requestIdleCallback wrapping around _lineageColor
// stays in local_pca_dosage/_state.js because it's local_pca_dosage-specific scheduling
// behavior — the pure resolver here returns null when the lineage
// result isn't ready and lets the caller decide whether to schedule
// a compute.

// =====================================================================
// Constants (legacy lines 36262-36264)
// =====================================================================

const FAMILY_COLOR_SMALL     = '#cbd5e1';   // n == 2 or 3
const FAMILY_COLOR_SINGLETON = '#dde3eb';   // n == 1
const FAMILY_COLOR_UNMATCHED = '#94a3b8';   // family_id == -1 / missing

// =====================================================================
// Family color (legacy lines 36303-36311)
// =====================================================================

/**
 * Resolve a sample's color by family-id. Reads:
 *   state.data.samples[si].family_id
 *   state.familyPalette[family_id]
 *   state.smallFamilyIds (Set)
 *   state.singletonFamilyIds (Set)
 *
 * Returns the resolved hex (or fallback grey when family is missing).
 */
export function familyColor(state, si) {
  if (!state || !state.data || !state.data.samples) return FAMILY_COLOR_UNMATCHED;
  const sample = state.data.samples[si];
  if (!sample) return FAMILY_COLOR_UNMATCHED;
  const f = sample.family_id;
  if (f == null || f === -1) return FAMILY_COLOR_UNMATCHED;
  if (state.familyPalette && state.familyPalette[f]) return state.familyPalette[f];
  if (state.smallFamilyIds && state.smallFamilyIds.has && state.smallFamilyIds.has(f)) {
    return FAMILY_COLOR_SMALL;
  }
  if (state.singletonFamilyIds && state.singletonFamilyIds.has
      && state.singletonFamilyIds.has(f)) {
    return FAMILY_COLOR_SINGLETON;
  }
  return FAMILY_COLOR_UNMATCHED;
}

// =====================================================================
// Lineage color (legacy lines 33220-33254, pure subset)
// =====================================================================

/**
 * Resolve a sample's color by lineage assignment. Reads
 * state.lineageResult (populated by runLineageCompute in
 * local_pca_dosage/lineage.js). Returns null when the lineage result isn't
 * available — the caller decides whether to schedule a compute.
 *
 * The legacy local_pca_dosage path wraps this with a requestIdleCallback auto-
 * trigger; haplotype_regimes uses the pure version (degrades gracefully when no
 * result is loaded).
 */
export function lineageColor(state, si) {
  if (!state) return null;
  const result = state.lineageResult;
  if (!result || !result.lineage_id_per_sample) return null;
  if (si < 0 || si >= result.n_samples) return null;
  const lid = result.lineage_id_per_sample[si];
  if (lid == null || lid < 0 || lid >= result.n_lineages) return null;
  // Golden-angle rotation: each lineage gets a distinct hue.
  const baseHue = 210;                  // cool blue anchor for lineage 0
  const goldenAngle = 137.508;
  const hue = (baseHue + lid * goldenAngle) % 360;
  return `hsl(${hue.toFixed(1)}, 70%, 55%)`;
}

// =====================================================================
// Per-sample mode-color resolvers (2026-05-19 — wire up θπ / GHSL / F_ROH)
// =====================================================================
// Each resolver returns an rgb/hsl string or null. The shared 5-point
// cool→warm ramp (_vColorRamp below) maps a normalized [0,1] value to a
// cold-blue→hot-red gradient that matches the legacy `_vColor` rule.
//
// Normalization at the active window (state.cur) is cached per (mode, cur)
// on state.__colorScales so 226 samples × 1 paint = 1 min/max scan, not 226.
// applyData clears the cache when the chromosome swaps.

const _VCOLOR_STOPS = [
  [0.00, [60,  100, 180]],   // cold blue
  [0.25, [80,  140, 200]],   // pale blue
  [0.50, [200, 200, 200]],   // gray midpoint
  [0.75, [240, 175,  60]],   // warm amber
  [1.00, [232,  90,  60]],   // hot red
];

// Take a normalized value v ∈ [0,1] and return an rgb() string.
// Out-of-range / non-finite returns null so the caller falls back.
function _vColorRamp(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0) v = 0; else if (v > 1) v = 1;
  let lo = _VCOLOR_STOPS[0], hi = _VCOLOR_STOPS[_VCOLOR_STOPS.length - 1];
  for (let i = 0; i < _VCOLOR_STOPS.length - 1; i++) {
    if (v >= _VCOLOR_STOPS[i][0] && v <= _VCOLOR_STOPS[i + 1][0]) {
      lo = _VCOLOR_STOPS[i]; hi = _VCOLOR_STOPS[i + 1]; break;
    }
  }
  const t = (hi[0] === lo[0]) ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
  const r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
  const g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
  const b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
  return `rgb(${r},${g},${b})`;
}

// Per-(mode, cur) min/max cache. Returns { lo, hi } or null when the
// values array is empty / all non-finite. `fetcher(state)` returns an
// array of length n_samples (numbers or NaN) at the current state.cur.
function _getColorScale(state, mode, fetcher) {
  if (!state) return null;
  if (!state.__colorScales) state.__colorScales = new Map();
  const cur = (state.cur | 0) || 0;
  const key = `${mode}:${cur}`;
  if (state.__colorScales.has(key)) return state.__colorScales.get(key);
  const values = fetcher(state);
  if (!values) { state.__colorScales.set(key, null); return null; }
  let lo = Infinity, hi = -Infinity, n = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n++;
  }
  if (n === 0 || !Number.isFinite(lo)) {
    state.__colorScales.set(key, null);
    return null;
  }
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const scale = { lo, hi, n };
  state.__colorScales.set(key, scale);
  return scale;
}

/**
 * Color a sample by its F_ROH value. Reads:
 *   state.data.sample_froh — array of length n_samples
 * Cold = low F (outbred); warm = high F (inbred). Per-sample (no window
 * axis), so caching is mode-keyed only — but we still go through
 * _getColorScale to share the min/max plumbing.
 */
export function frohColor(state, si) {
  if (!state || !state.data || !Array.isArray(state.data.sample_froh)) return null;
  const arr = state.data.sample_froh;
  if (si < 0 || si >= arr.length) return null;
  const scale = _getColorScale(state, 'froh', s => s.data.sample_froh);
  if (!scale) return null;
  const v = arr[si];
  if (!Number.isFinite(v)) return null;
  return _vColorRamp((v - scale.lo) / (scale.hi - scale.lo));
}

/**
 * Confounder-alert color: red highlight for samples whose F_ROH is
 * unusually high (top 5% of the cohort). Everyone else gets a faint
 * grey so the highlighted samples pop. Pure threshold, no ramp.
 *
 * The threshold is computed on first call per chrom via _getColorScale's
 * cache (we reuse the cache slot for an ordered-array sentinel).
 */
export function confounderAlertColor(state, si) {
  if (!state || !state.data || !Array.isArray(state.data.sample_froh)) return null;
  const arr = state.data.sample_froh;
  if (si < 0 || si >= arr.length) return null;
  // Cache the 95th-percentile threshold per chrom.
  if (!state.__confounderAlert) {
    const xs = arr.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (xs.length === 0) { state.__confounderAlert = { thr: Infinity }; return null; }
    const idx = Math.floor(xs.length * 0.95);
    state.__confounderAlert = { thr: xs[Math.min(xs.length - 1, idx)] };
  }
  const v = arr[si];
  if (!Number.isFinite(v)) return null;
  return v >= state.__confounderAlert.thr ? '#e0555c' : 'rgba(180,190,210,0.25)';
}

/**
 * Color a sample by its θπ value at the current window. Reads:
 *   state.data.theta_pi_per_window.values[si][cur]
 * Cold = low π (low diversity, possibly inversion-suppressed);
 * warm = high π (high diversity).
 */
export function thetaPiColor(state, si) {
  if (!state || !state.data || !state.data.theta_pi_per_window) return null;
  const tpw = state.data.theta_pi_per_window;
  if (!Array.isArray(tpw.values)) return null;
  const row = tpw.values[si];
  if (!row) return null;
  const cur = (state.cur | 0) || 0;
  const v = row[cur];
  if (!Number.isFinite(v)) return null;
  const scale = _getColorScale(state, 'theta_pi', s => {
    const tp = s.data && s.data.theta_pi_per_window;
    if (!tp || !Array.isArray(tp.values)) return null;
    const c = (s.cur | 0) || 0;
    const n = tp.values.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = tp.values[i];
      out[i] = (r && Number.isFinite(r[c])) ? r[c] : NaN;
    }
    return out;
  });
  if (!scale) return null;
  return _vColorRamp((v - scale.lo) / (scale.hi - scale.lo));
}

/**
 * Color a sample by its GHSL local-PCA PC1 value at the current window.
 * Reads:
 *   state.data.ghsl_local_pca.pc_loadings_aligned[0][cur][si]
 * The sign+magnitude of PC1 separates karyotype groups in GHSL space;
 * cold/warm maps to the two arms of the PC1 axis.
 */
export function ghslColor(state, si) {
  if (!state || !state.data || !state.data.ghsl_local_pca) return null;
  const lp = state.data.ghsl_local_pca;
  const a = lp.pc_loadings_aligned;
  if (!Array.isArray(a) || !Array.isArray(a[0])) return null;
  const cur = (state.cur | 0) || 0;
  const row = a[0][cur];
  if (!Array.isArray(row)) return null;
  const v = row[si];
  if (!Number.isFinite(v)) return null;
  const scale = _getColorScale(state, 'ghsl', s => {
    const _lp = s.data && s.data.ghsl_local_pca;
    const _a  = _lp && _lp.pc_loadings_aligned;
    if (!Array.isArray(_a) || !Array.isArray(_a[0])) return null;
    const c = (s.cur | 0) || 0;
    const r = _a[0][c];
    return Array.isArray(r) ? r : null;
  });
  if (!scale) return null;
  return _vColorRamp((v - scale.lo) / (scale.hi - scale.lo));
}

/**
 * Drop any cached color scales — called by applyData on chrom change
 * so the next paint recomputes min/max for the new chromosome.
 * Safe to call when state is null/undefined or no cache exists.
 */
export function invalidateColorScales(state) {
  if (!state) return;
  if (state.__colorScales && state.__colorScales.clear) state.__colorScales.clear();
  state.__confounderAlert = null;
}

// =====================================================================
// Composite scope-color resolver (legacy lines 33287-33298 + 2026-05-19)
// =====================================================================

/**
 * Resolve a sample's color for one of the page-agnostic "scope" modes
 * that haplotype_regimes' regime panels and local_pca_dosage's lines panel both consume.
 *
 * Implemented today:
 *   'family', 'lineage'                — per-sample, hand-coded resolvers
 *   'theta_pi', 'ghsl'                 — per-sample-at-current-window, ramp
 *   'froh', 'confounder_alert'         — per-sample, F_ROH-based
 * Still stubbed (return null → caller falls back to default grey):
 *   'dosage', 'het'                    — need an async dosage chunk fetch
 *
 * @param {Object} state  any page state with the relevant slots
 * @param {number} si     sample index
 * @param {string} mode   one of the above
 * @returns {string|null}
 */
export function resolveSampleScopeColor(state, si, mode) {
  if (mode === 'family')           return familyColor(state, si);
  if (mode === 'lineage')          return lineageColor(state, si);
  if (mode === 'theta_pi')         return thetaPiColor(state, si);
  if (mode === 'ghsl')             return ghslColor(state, si);
  if (mode === 'froh')             return frohColor(state, si);
  if (mode === 'confounder_alert') return confounderAlertColor(state, si);
  return null;
}
