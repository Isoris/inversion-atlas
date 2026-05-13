// pages/discovery/page_dosage_cluster/selection.js
//
// Selection store for the dosage-clustering panel. Tracks:
//   - focused K row in the per-K table (drives the chosen-detail
//     and re-points the curve canvas to that K's curves)
//   - hovered cluster id (drives in-canvas highlighting)
//
// Subscribers fire on every actual change.

export function createDosageClusterSelection(initialFocusK) {
  let focusedK = Number.isFinite(initialFocusK) ? (initialFocusK | 0) : null;
  let hoveredCluster = null;
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  return {
    getFocusedK: () => focusedK,
    setFocusedK(k) {
      const next = _coerce(k);
      if (focusedK !== next) { focusedK = next; notify(); }
    },
    getHoveredCluster: () => hoveredCluster,
    setHoveredCluster(c) {
      const next = _coerce(c);
      if (hoveredCluster !== next) { hoveredCluster = next; notify(); }
    },
    getHovered: () => hoveredCluster,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Build a per-K table row summary array.
 *
 * @param {Object} entry   one element of result.per_K
 * @returns {Array<{label:string, value:string}>}
 */
export function summariseKEntry(entry) {
  if (!entry) return [];
  const out = [
    { label: 'K',          value: String(entry.K) },
    { label: 'silhouette', value: Number.isFinite(entry.silhouette) ? entry.silhouette.toFixed(3) : '—' },
    { label: 'stability',  value: Number.isFinite(entry.stability)  ? entry.stability.toFixed(3)  : '—' },
    { label: 'min size',   value: Number.isFinite(entry.min_size)   ? String(entry.min_size)      : '—' },
    { label: 'coherence',  value: Number.isFinite(entry.spatial_coherence)
                                    ? entry.spatial_coherence.toFixed(3) : '—' },
    { label: 'Δsil',       value: Number.isFinite(entry.delta_sil)
                                    ? (entry.delta_sil >= 0 ? '+' : '') + entry.delta_sil.toFixed(3) : '—' },
    { label: 'passes',     value: entry.passes ? 'yes' : 'no' },
  ];
  return out;
}

/**
 * Resolve which per_K entry the panel should display curves for.
 * Priority: focusedK → K_chosen → first non-degenerate per_K.
 *
 * @param {Object} result
 * @param {number|null} focusedK
 * @returns {Object|null}
 */
export function entryToDisplay(result, focusedK) {
  if (!result || !Array.isArray(result.per_K) || result.per_K.length === 0) return null;
  if (Number.isFinite(focusedK)) {
    const e = result.per_K.find(e => e && e.K === focusedK);
    if (e) return e;
  }
  if (Number.isFinite(result.K_chosen)) {
    const e = result.per_K.find(e => e && e.K === result.K_chosen);
    if (e) return e;
  }
  // Fall back to the first entry with non-null curves.
  for (const e of result.per_K) {
    if (e && e.cluster_curves) return e;
  }
  return result.per_K[0];
}

/**
 * Cluster-size summary for a per-sample assignment array.
 *
 * @param {Int32Array|number[]|null} labels
 * @returns {Array<[number, number]>}
 */
export function clusterSizesFromLabels(labels) {
  if (!labels || labels.length === 0) return [];
  const counts = new Map();
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i] | 0;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
