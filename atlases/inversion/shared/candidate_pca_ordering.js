// shared/candidate_pca_ordering.js
//
// HANDOFF 2 Component 6 — sample-axis ordering for the candidate-mode
// heatmap. Five row-order modes; the heatmap renderer asks
// computeSampleOrder(state, ...) for the per-frame ordering.
//
// All helpers are pure (state-as-arg) and return Int32Array-backed
// or plain Array<number> indices. NaN / non-finite values sort to
// the end for stability.

/**
 * Return indices that sort `arr` ascending. NaN / non-finite entries
 * are appended at the end in their original order.
 *
 *   argsort([0.5, 0.1, 0.3]) → [1, 2, 0]
 *
 * @param {Array<number>|Float32Array|Float64Array} arr
 * @returns {Array<number>}
 */
export function argsort(arr) {
  if (!arr || typeof arr.length !== 'number') return [];
  const n = arr.length;
  const finite = [];
  const nonFinite = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(arr[i])) finite.push(i);
    else nonFinite.push(i);
  }
  finite.sort((a, b) => arr[a] - arr[b]);
  return finite.concat(nonFinite);
}

/**
 * Group-sort: order by cluster label (ascending), and within each
 * cluster preserve the input order. Indices with label `null` /
 * `undefined` / negative are appended at the end (treated as
 * unclustered).
 *
 *   groupedArgsort([1, 0, 1, 0, 2]) → [1, 3, 0, 2, 4]
 *
 * @param {Array<number>|Int32Array|Int8Array} labels
 * @returns {Array<number>}
 */
export function groupedArgsort(labels) {
  if (!labels || typeof labels.length !== 'number') return [];
  const n = labels.length;
  const groups = new Map();
  const unclustered = [];
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (l == null || l < 0 || !Number.isFinite(l)) {
      unclustered.push(i);
      continue;
    }
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l).push(i);
  }
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  const out = [];
  for (const k of sortedKeys) out.push(...groups.get(k));
  out.push(...unclustered);
  return out;
}

/**
 * Per-sample mean dosage in the current window. The heatmap layer
 * stores per-window {markers[].dosage_centered[sample_idx]}; this
 * helper averages across markers in the current window.
 *
 *   markers: [{ pos, dosage_centered: Float32Array }, ...]
 *
 * Returns Float32Array(n_samples) of means; samples with no finite
 * marker get NaN so argsort routes them to the end of the order.
 *
 * @param {Array<{dosage_centered:Float32Array|Array<number>}>} markers
 * @param {number} n_samples
 * @returns {Float32Array}
 */
export function meanDosagePerSample(markers, n_samples) {
  const out = new Float32Array(n_samples);
  const counts = new Int32Array(n_samples);
  if (!Array.isArray(markers) || markers.length === 0 || !n_samples) {
    for (let i = 0; i < n_samples; i++) out[i] = NaN;
    return out;
  }
  for (const m of markers) {
    const d = m && m.dosage_centered;
    if (!d || d.length !== n_samples) continue;
    for (let i = 0; i < n_samples; i++) {
      const v = d[i];
      if (Number.isFinite(v)) { out[i] += v; counts[i]++; }
    }
  }
  for (let i = 0; i < n_samples; i++) {
    out[i] = counts[i] > 0 ? out[i] / counts[i] : NaN;
  }
  return out;
}

/**
 * Per-sample MEDIAN dosage in the current window. Companion to
 * meanDosagePerSample — median is more robust to outlier markers,
 * which the user (atlas owner) called out as the second canonical
 * summary on the PCA color overlay.
 *
 * Returns Float32Array(n_samples). Samples with no finite marker get
 * NaN so argsort routes them to the end of the order.
 *
 * @param {Array<{dosage_centered:Float32Array|Array<number>}>} markers
 * @param {number} n_samples
 * @returns {Float32Array}
 */
export function medianDosagePerSample(markers, n_samples) {
  const out = new Float32Array(n_samples);
  if (!Array.isArray(markers) || markers.length === 0 || !n_samples) {
    for (let i = 0; i < n_samples; i++) out[i] = NaN;
    return out;
  }
  const buf = new Array(n_samples);
  for (let i = 0; i < n_samples; i++) buf[i] = [];
  for (const m of markers) {
    const d = m && m.dosage_centered;
    if (!d || d.length !== n_samples) continue;
    for (let i = 0; i < n_samples; i++) {
      const v = d[i];
      if (Number.isFinite(v)) buf[i].push(v);
    }
  }
  for (let i = 0; i < n_samples; i++) {
    const v = buf[i];
    if (v.length === 0) { out[i] = NaN; continue; }
    v.sort((a, b) => a - b);
    const mid = v.length >> 1;
    out[i] = (v.length & 1) ? v[mid] : 0.5 * (v[mid - 1] + v[mid]);
  }
  return out;
}

/**
 * Compute the sample-row order for the heatmap based on the active
 * mode + current state. Returns an Array<number> of sample indices.
 *
 * Modes:
 *   - 'pc1_anchor':   use the bi_baseline-unweighted-bi_baseline anchored
 *     PC1 of the current window (canonical reference; same across views)
 *   - 'pc1_view':     use the active view's PC1 for the current window
 *   - 'cluster':      group by current window's cluster_labels
 *   - 'manual':       return state.candidatePCAMode.manual_order verbatim
 *   - 'mean_dosage':  argsort mean dosage in current window
 *   - 'median_dosage': argsort median dosage (outlier-robust variant)
 *
 * When the requested data is missing (e.g. anchor JSON not yet loaded),
 * falls back to identity order [0..n_samples-1] so the heatmap renders
 * something instead of crashing.
 *
 * @param {Object} state
 * @param {Object} [opts]
 * @param {Array<{dosage_centered:Float32Array}>} [opts.heatmapMarkers]
 *        per-window heatmap rows for 'mean_dosage' mode
 * @param {number} [opts.n_samples]   override; defaults to state.data.n_samples
 * @returns {Array<number>}
 */
export function computeSampleOrder(state, opts) {
  const m = state && state.candidatePCAMode;
  if (!m) return [];
  const nFromState = state && state.data && Number.isFinite(state.data.n_samples)
    ? state.data.n_samples
    : null;
  const n = (opts && Number.isFinite(opts.n_samples)) ? opts.n_samples : nFromState;
  if (!Number.isFinite(n) || n <= 0) return [];

  const mode = m.row_order || 'pc1_anchor';
  const cur = Number.isFinite(state.cur) ? state.cur : 0;
  const identity = () => {
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = i;
    return out;
  };

  if (mode === 'pc1_anchor') {
    const ref = m.loaded_pca && m.loaded_pca['bi_baseline_unweighted_bi_baseline'];
    if (!ref || !ref.windows || !ref.windows[cur] || !ref.windows[cur].pc1) {
      return identity();
    }
    return argsort(ref.windows[cur].pc1);
  }
  if (mode === 'pc1_view') {
    const d = state.data;
    if (!d || !d.windows || !d.windows[cur] || !d.windows[cur].pc1) {
      return identity();
    }
    return argsort(d.windows[cur].pc1);
  }
  if (mode === 'cluster') {
    const d = state.data;
    if (!d || !d.windows || !d.windows[cur]) return identity();
    const labels = d.windows[cur].cluster_labels;
    if (!labels) return identity();
    return groupedArgsort(labels);
  }
  if (mode === 'manual') {
    if (Array.isArray(m.manual_order) && m.manual_order.length === n) {
      return m.manual_order.slice();
    }
    return identity();
  }
  if (mode === 'mean_dosage') {
    const markers = opts && opts.heatmapMarkers;
    if (!markers) return identity();
    return argsort(meanDosagePerSample(markers, n));
  }
  if (mode === 'median_dosage') {
    const markers = opts && opts.heatmapMarkers;
    if (!markers) return identity();
    return argsort(medianDosagePerSample(markers, n));
  }
  return identity();
}
