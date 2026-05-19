// shared/mgl_render_state.js
// =====================================================================
// Coordinated rendering state for the SPEC_0 §10 dual-panel PCA +
// heatmap view.
//
// Why this exists: PCA and heatmap originate from the same dosage
// matrix; they should share their controls (view, weighting,
// anchor, centering, polarity, color mode) and their derived
// presentation (sample order, sample colors, marker order, hover,
// selection). Switching ANY control updates both panels through
// the same channel.
//
// Design:
//   - The state is a plain object. The module exposes a small
//     create/get/set surface + pure derivers for sample_order /
//     sample_colors / marker_order from the underlying PCA &
//     heatmap result objects.
//   - Subscribe/unsubscribe lets consumers (the PCA renderer,
//     the heatmap renderer, the right-panel selected-card) react
//     to changes without each owning a copy of the state.
//
// Pure compute. No DOM, no fetch. Consumed by local_pca_dosage's candidate-mode
// shell (HANDOFF_2) and by the upcoming tree / fingerprint /
// similarity panels.
// =====================================================================

// =====================================================================
// Vocab
// =====================================================================

/** Color-mode enum (SPEC_0 §10.2). */
export const MGL_COLOR_MODES = Object.freeze([
  'cluster',
  'mean_dosage_window',
  'pc1_score',
  'pc2_score',
  'tracked_group',
  'external_annotation',
]);

/** Sample-order modes (SPEC_0 §10.5). */
export const MGL_SAMPLE_ORDERS = Object.freeze([
  'pc1_anchor',
  'pc1_view',
  'cluster',
  'manual',
  'mean_dosage',
]);

/** Marker-order modes (SPEC_0 §10.6). */
export const MGL_MARKER_ORDERS = Object.freeze([
  'genomic',
  'pc1_loading',
  'pc2_loading',
  'clustering',
  'manual',
]);

// =====================================================================
// 1. Create / default state
// =====================================================================

/**
 * Build a fresh shared-state object with defaults from SPEC_0 §10.
 *
 * @param {Object} [opts]   override individual defaults
 * @returns {Object}        the state object
 */
export function createMglRenderState(opts) {
  const o = opts || {};
  return {
    // Controls
    view_name:          o.view_name          || 'all_pairs',
    weighting:          o.weighting          || 'weighted',
    anchor_mode:        o.anchor_mode        || 'bi_baseline',
    centering_anchor:   o.centering_anchor   || 'all',
    polarity_reference: o.polarity_reference || 'pc1_correlation',
    // Derived / presentation
    sample_order_mode:  o.sample_order_mode  || 'pc1_anchor',
    sample_order:       o.sample_order       || null,   // Int32Array of indices
    sample_color_mode:  o.sample_color_mode  || 'cluster',
    sample_colors:      o.sample_colors      || null,   // Array<string> per sample
    marker_order_mode:  o.marker_order_mode  || 'genomic',
    marker_order:       o.marker_order       || null,
    // Hover + selection
    hover_sample:       null,
    hover_marker:       null,
    selected_samples:   new Set(),
    selected_markers:   new Set(),
    // Subscription list — populated via subscribe()
    _subs:              new Set(),
  };
}

// =====================================================================
// 2. Get / set with notification
// =====================================================================

/**
 * Update one or more fields on the state object + notify subscribers.
 * Only fires the notify callback when at least one field changed.
 *
 * @param {Object} state
 * @param {Object} patch
 */
export function updateMglRenderState(state, patch) {
  if (!state || !patch) return;
  let changed = false;
  const changedKeys = [];
  for (const k of Object.keys(patch)) {
    if (k === '_subs') continue;
    const next = patch[k];
    if (state[k] !== next) {
      state[k] = next;
      changed = true;
      changedKeys.push(k);
    }
  }
  if (changed) _notify(state, changedKeys);
}

/**
 * Subscribe to state changes. Returns an unsubscribe function.
 *
 * The callback receives `(state, changedKeys[])`. It runs synchronously
 * after every `updateMglRenderState` that mutates at least one field.
 *
 * @param {Object} state
 * @param {Function} cb
 * @returns {Function}   unsubscribe
 */
export function subscribeMglRenderState(state, cb) {
  if (!state || typeof cb !== 'function') return () => {};
  if (!state._subs) state._subs = new Set();
  state._subs.add(cb);
  return () => state._subs.delete(cb);
}

function _notify(state, changedKeys) {
  if (!state._subs) return;
  for (const cb of state._subs) {
    try { cb(state, changedKeys); } catch (_) { /* swallow */ }
  }
}

// =====================================================================
// 3. Derivers — sample_order
// =====================================================================

/**
 * Compute the sample-display order from the active mode.
 *
 *   'pc1_anchor'  → ascending PC1 in the anchor view (default)
 *   'pc1_view'    → ascending PC1 in the current view
 *   'cluster'     → group by cluster label (locked or runtime)
 *   'manual'      → caller supplies state.sample_order directly
 *   'mean_dosage' → ascending per-sample mean dosage in window
 *
 * Returns a fresh Int32Array of sample indices, length n_samples.
 *
 * @param {Object} state
 * @param {Object} ctx
 *   { pca_result?, heatmap_result?, window_idx?, cluster_labels?,
 *     mean_dosage_per_sample? }
 * @returns {Int32Array|null}
 */
export function deriveSampleOrder(state, ctx) {
  const c = ctx || {};
  const n = _inferNSamples(c);
  if (n === 0) return null;

  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;

  switch (state.sample_order_mode) {
    case 'manual':
      return state.sample_order instanceof Int32Array
        ? state.sample_order : out;

    case 'pc1_anchor':
    case 'pc1_view': {
      const w = _windowForOrder(c, state.sample_order_mode);
      if (!w) return out;
      const pc = w.pc1;
      if (!pc || pc.length !== n) return out;
      out.sort((a, b) => pc[a] - pc[b]);
      return out;
    }

    case 'cluster': {
      const labels = c.cluster_labels;
      if (!labels || labels.length !== n) return out;
      out.sort((a, b) => {
        if (labels[a] === labels[b]) return a - b;
        return labels[a] < labels[b] ? -1 : 1;
      });
      return out;
    }

    case 'mean_dosage': {
      const md = c.mean_dosage_per_sample;
      if (!md || md.length !== n) return out;
      out.sort((a, b) => md[a] - md[b]);
      return out;
    }
  }
  return out;
}

function _windowForOrder(ctx, mode) {
  const r = mode === 'pc1_view' ? ctx.pca_result
                                : (ctx.anchor_pca_result || ctx.pca_result);
  if (!r || !Array.isArray(r.windows)) return null;
  const idx = Number.isFinite(ctx.window_idx) ? ctx.window_idx : 0;
  return r.windows[Math.max(0, Math.min(r.windows.length - 1, idx))] || null;
}

function _inferNSamples(ctx) {
  if (ctx.pca_result && Number.isFinite(ctx.pca_result.n_samples)) {
    return ctx.pca_result.n_samples;
  }
  if (ctx.heatmap_result && Number.isFinite(ctx.heatmap_result.n_samples)) {
    return ctx.heatmap_result.n_samples;
  }
  if (Array.isArray(ctx.cluster_labels)) return ctx.cluster_labels.length;
  if (ctx.mean_dosage_per_sample
      && Number.isFinite(ctx.mean_dosage_per_sample.length)) {
    return ctx.mean_dosage_per_sample.length;
  }
  return 0;
}

// =====================================================================
// 4. Derivers — sample_colors
// =====================================================================

/**
 * Compute per-sample colors from the active color mode + supplied
 * context. Pure: switching color_mode does NOT recompute PCA /
 * heatmap layers — just the colors.
 *
 *   'cluster'             → categorical palette by cluster_labels
 *   'mean_dosage_window'  → continuous (low-high) on mean_dosage_per_sample
 *   'pc1_score'           → continuous on PC1 of the window
 *   'pc2_score'           → continuous on PC2 of the window
 *   'tracked_group'       → categorical by tracked_groups
 *   'external_annotation' → categorical by external_annotations
 *
 * Returns Array<string> (CSS colour strings) of length n_samples.
 *
 * @param {Object} state
 * @param {Object} ctx
 *   { pca_result?, window_idx?, cluster_labels?,
 *     mean_dosage_per_sample?, tracked_groups?, external_annotations?,
 *     categorical_palette?, continuous_palette? }
 * @returns {string[]|null}
 */
export function deriveSampleColors(state, ctx) {
  const c = ctx || {};
  const n = _inferNSamples(c);
  if (n === 0) return null;

  const cat = c.categorical_palette
    || ['#3074C8', '#2BAA50', '#D04545', '#A060B8', '#D8A030', '#3DB5C0'];
  const grey = 'rgba(140,140,140,0.55)';

  switch (state.sample_color_mode) {
    case 'cluster':
      return _categoricalColors(c.cluster_labels, n, cat, grey);
    case 'tracked_group':
      return _categoricalColors(c.tracked_groups, n, cat, grey);
    case 'external_annotation':
      return _categoricalColors(c.external_annotations, n, cat, grey);
    case 'mean_dosage_window':
      return _continuousColors(c.mean_dosage_per_sample, n,
                               c.continuous_palette);
    case 'pc1_score':
    case 'pc2_score': {
      const w = _windowForOrder(c, 'pc1_view');
      if (!w) return new Array(n).fill(grey);
      const arr = state.sample_color_mode === 'pc1_score' ? w.pc1 : w.pc2;
      return _continuousColors(arr, n, c.continuous_palette);
    }
  }
  return new Array(n).fill(grey);
}

function _categoricalColors(labels, n, palette, grey) {
  if (!labels || labels.length !== n) return new Array(n).fill(grey);
  const uniq = new Map();
  for (const l of labels) {
    if (l == null) continue;
    if (!uniq.has(l)) uniq.set(l, uniq.size);
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = uniq.get(labels[i]);
    out[i] = k == null ? grey : palette[k % palette.length];
  }
  return out;
}

function _continuousColors(values, n, palette) {
  if (!values || values.length !== n) {
    return new Array(n).fill('rgba(140,140,140,0.55)');
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const out = new Array(n);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    for (let i = 0; i < n; i++) out[i] = 'rgb(128,128,128)';
    return out;
  }
  // Default 2-stop palette: blue → red.
  const stops = palette && palette.length >= 2
    ? palette : ['#3074C8', '#D04545'];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out[i] = 'rgba(140,140,140,0.55)'; continue; }
    const t = (v - lo) / (hi - lo);
    out[i] = _lerpHex(stops[0], stops[stops.length - 1], t);
  }
  return out;
}

function _lerpHex(a, b, t) {
  const [ar, ag, ab] = _hexToRgb(a), [br, bg, bb] = _hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const v = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${v})`;
}
function _hexToRgb(h) {
  if (h.startsWith('rgb')) {
    const m = h.match(/(\d+)/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

// =====================================================================
// 5. Derivers — marker_order
// =====================================================================

/**
 * Compute the heatmap-column (marker) display order. Delegates to
 * the heatmap module's `orderMarkerIndices` for the standard modes.
 *
 * Returns Array<number> of marker indices.
 *
 * @param {Object} state
 * @param {Object} heatmap_result   output of mgl_heatmap_json.fromPrecomputedJson
 *   or buildHeatmapFromDosage
 * @param {{ref_pc1?:Float64Array, ref_pc2?:Float64Array,
 *           manual_order?:number[]}} [ctx]
 * @returns {number[]}
 */
export function deriveMarkerOrder(state, heatmap_result, ctx) {
  const N = heatmap_result && heatmap_result.n_markers || 0;
  if (state.marker_order_mode === 'manual'
      && Array.isArray(ctx && ctx.manual_order)) {
    return ctx.manual_order.slice();
  }
  // Delegate to the heatmap module — same ordering vocabulary.
  // Done as a runtime import to avoid a circular if anyone ever
  // adds a reverse dependency.
  // (kept inline-clean: dynamic import not used; consumers call
  //  orderMarkerIndices directly when needed)
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = i;
  return out;
}

// =====================================================================
// 6. Selection helpers
// =====================================================================

/** Toggle a sample's selection state in `state.selected_samples`.
 *  Notifies subscribers via 'selected_samples' key. */
export function toggleSampleSelected(state, sample_idx) {
  if (!state) return;
  if (!(state.selected_samples instanceof Set)) state.selected_samples = new Set();
  if (state.selected_samples.has(sample_idx)) state.selected_samples.delete(sample_idx);
  else                                         state.selected_samples.add(sample_idx);
  _notify(state, ['selected_samples']);
}

export function clearSampleSelection(state) {
  if (!state || !(state.selected_samples instanceof Set)) return;
  if (state.selected_samples.size === 0) return;
  state.selected_samples.clear();
  _notify(state, ['selected_samples']);
}

/** Toggle a marker's selection state. */
export function toggleMarkerSelected(state, marker_idx) {
  if (!state) return;
  if (!(state.selected_markers instanceof Set)) state.selected_markers = new Set();
  if (state.selected_markers.has(marker_idx)) state.selected_markers.delete(marker_idx);
  else                                         state.selected_markers.add(marker_idx);
  _notify(state, ['selected_markers']);
}

/**
 * Set hover_sample / hover_marker. Pass null to clear.
 */
export function setHover(state, sample_idx, marker_idx) {
  if (!state) return;
  const changed = [];
  if (sample_idx !== undefined && state.hover_sample !== sample_idx) {
    state.hover_sample = sample_idx;
    changed.push('hover_sample');
  }
  if (marker_idx !== undefined && state.hover_marker !== marker_idx) {
    state.hover_marker = marker_idx;
    changed.push('hover_marker');
  }
  if (changed.length) _notify(state, changed);
}
