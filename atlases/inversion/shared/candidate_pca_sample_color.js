// shared/candidate_pca_sample_color.js
//
// HANDOFF 2 Component 7 — sample-color resolver shared between
// drawPCA and drawHeatmap so the same sample is the same color in
// both panels. Six modes per CANDIDATE_PCA_SAMPLE_COLOR_MODES:
//
//   cluster              cluster_labels[si] → categorical palette
//   mean_dosage_window   mean dosage across markers in current window
//                         → diverging red/white/blue
//   median_dosage_window outlier-robust variant
//   pc1_score            current window's pc1[si] → diverging scale
//   pc2_score            current window's pc2[si] → diverging scale
//   tracked_group        state.trackedColors[si] (if any) → categorical
//
// Pure: no DOM, no fetch. Caller passes state explicitly. Color
// strings are CSS-compatible (#rrggbb or rgba(...)).
//
// Default palettes are inlined; caller can override with opts to
// honour atlas theming.

import {
  meanDosagePerSample,
  medianDosagePerSample,
} from './candidate_pca_ordering.js';

/**
 * Default 10-color categorical palette (matches the legacy
 * local_pca_dosage K-cluster palette — kept inlined so the module has zero
 * dependencies beyond candidate_pca_ordering.js).
 */
export const DEFAULT_CLUSTER_PALETTE = Object.freeze([
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
]);

/** Default "unknown" / "unclustered" / "missing" color. */
export const DEFAULT_NA_COLOR = '#bdbdbd';

/** Diverging endpoints (low, mid, high). */
export const DIVERGING_LOW  = '#2166ac';   // blue
export const DIVERGING_MID  = '#f7f7f7';   // white
export const DIVERGING_HIGH = '#b2182b';   // red

/** Linear interpolation between two #rrggbb strings. */
function _mix(c1, c2, t) {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Map a value v ∈ [lo, hi] to a diverging blue/white/red color.
 * NaN / non-finite → DEFAULT_NA_COLOR.
 *
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {string}
 */
export function divergingColor(v, lo, hi) {
  if (!Number.isFinite(v)) return DEFAULT_NA_COLOR;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
    return DEFAULT_NA_COLOR;
  }
  const mid = 0.5 * (lo + hi);
  if (v <= lo) return DIVERGING_LOW;
  if (v >= hi) return DIVERGING_HIGH;
  if (v < mid) return _mix(DIVERGING_LOW, DIVERGING_MID, (v - lo) / (mid - lo));
  return _mix(DIVERGING_MID, DIVERGING_HIGH, (v - mid) / (hi - mid));
}

/**
 * Pick a color from the categorical palette by integer label.
 * Negative / non-finite labels return the NA color.
 *
 * @param {number} label
 * @param {Array<string>} [palette]
 * @returns {string}
 */
export function clusterColor(label, palette) {
  if (label == null || !Number.isFinite(label) || label < 0) {
    return DEFAULT_NA_COLOR;
  }
  const p = palette || DEFAULT_CLUSTER_PALETTE;
  return p[label % p.length];
}

/**
 * Read cluster labels for the active window with locked-labels
 * precedence — same precedence as local_pca_dosage's draw paths.
 *
 * @param {Object} state
 * @returns {Array<number>|null}
 */
function _activeClusterLabels(state) {
  if (!state) return null;
  if (Array.isArray(state.lockedLabels)) return state.lockedLabels;
  if (state.lockedLabels && typeof state.lockedLabels.length === 'number') {
    return state.lockedLabels;
  }
  const cur = Number.isFinite(state.cur) ? state.cur : 0;
  const w = state.data && state.data.windows && state.data.windows[cur];
  return (w && w.cluster_labels) ? w.cluster_labels : null;
}

/**
 * Pull the active window from state. Used by pc1_score / pc2_score
 * + dosage modes that need the current window's bookkeeping.
 */
function _activeWindow(state) {
  const cur = Number.isFinite(state && state.cur) ? state.cur : 0;
  const ws = state && state.data && state.data.windows;
  return (ws && ws[cur]) ? ws[cur] : null;
}

/**
 * Compute the mean / median dosage per sample using the heatmap
 * payload passed via opts. Cached on `state` under
 * `_candidatePcaDosageCache` keyed by (mode × cur × markers
 * reference) so repeated drawPCA / drawHeatmap passes don't
 * re-aggregate every frame.
 *
 * @param {Object} state
 * @param {{heatmapMarkers?:Array, n_samples?:number}} opts
 * @param {'mean'|'median'} kind
 * @returns {Float32Array|null}
 */
export function dosageSummary(state, opts, kind) {
  if (!state) return null;
  const markers = opts && opts.heatmapMarkers;
  if (!Array.isArray(markers) || markers.length === 0) return null;
  const nFromState = state.data && Number.isFinite(state.data.n_samples)
    ? state.data.n_samples : null;
  const n = (opts && Number.isFinite(opts.n_samples)) ? opts.n_samples : nFromState;
  if (!Number.isFinite(n) || n <= 0) return null;
  const cacheKey = (kind || 'mean') + '|' + (state.cur || 0) + '|' + markers.length;
  if (!state._candidatePcaDosageCache) state._candidatePcaDosageCache = {};
  const cache = state._candidatePcaDosageCache;
  if (cache._markersRef === markers && cache[cacheKey]) return cache[cacheKey];
  if (cache._markersRef !== markers) {
    cache._markersRef = markers;
    for (const k of Object.keys(cache)) {
      if (k !== '_markersRef') delete cache[k];
    }
  }
  const out = (kind === 'median')
    ? medianDosagePerSample(markers, n)
    : meanDosagePerSample(markers, n);
  cache[cacheKey] = out;
  return out;
}

/**
 * Resolve the color for a single sample in candidate-PCA mode.
 *
 * @param {Object} state
 * @param {number} si  sample index
 * @param {{
 *   mode?:string,
 *   heatmapMarkers?:Array<{dosage_centered:Float32Array|Array<number>}>,
 *   n_samples?:number,
 *   palette?:Array<string>,
 *   dosageRange?:[number,number],
 *   pcRange?:[number,number],
 *   trackedColors?:Object<number,string>,
 * }} opts
 * @returns {string}  CSS color string
 */
export function resolveCandidatePCAColor(state, si, opts) {
  const o = opts || {};
  const cpm = state && state.candidatePCAMode;
  const mode = o.mode || (cpm && cpm.sample_color_mode) || 'cluster';

  if (mode === 'cluster') {
    const labels = _activeClusterLabels(state);
    const lbl = labels ? labels[si] : null;
    return clusterColor(lbl, o.palette);
  }
  if (mode === 'mean_dosage_window' || mode === 'median_dosage_window') {
    const kind = mode === 'median_dosage_window' ? 'median' : 'mean';
    const summary = dosageSummary(state, o, kind);
    if (!summary) return DEFAULT_NA_COLOR;
    const v = summary[si];
    const range = o.dosageRange || [-1, 1];
    return divergingColor(v, range[0], range[1]);
  }
  if (mode === 'pc1_score' || mode === 'pc2_score') {
    const win = _activeWindow(state);
    if (!win) return DEFAULT_NA_COLOR;
    const arr = mode === 'pc1_score' ? win.pc1 : win.pc2;
    if (!arr) return DEFAULT_NA_COLOR;
    const v = arr[si];
    const range = o.pcRange || [-3, 3];
    return divergingColor(v, range[0], range[1]);
  }
  if (mode === 'tracked_group') {
    const tc = o.trackedColors || (state && state.trackedColors);
    if (tc && (si in tc)) return tc[si];
    return DEFAULT_NA_COLOR;
  }
  return DEFAULT_NA_COLOR;
}

/**
 * Convenience: resolve colors for ALL samples in one pass. Returns
 * Array<string> length n_samples. Avoids re-computing the dosage
 * summary per sample.
 *
 * @param {Object} state
 * @param {number} n_samples
 * @param {Object} [opts]   same as resolveCandidatePCAColor
 * @returns {Array<string>}
 */
export function resolveCandidatePCAColorsAll(state, n_samples, opts) {
  const out = new Array(n_samples);
  for (let si = 0; si < n_samples; si++) {
    out[si] = resolveCandidatePCAColor(state, si, opts);
  }
  return out;
}
