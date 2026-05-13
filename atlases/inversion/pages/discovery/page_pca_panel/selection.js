// pages/discovery/page_pca_panel/selection.js
//
// Selection store for the PCA scatter panel. Tracks:
//   - active window index (the PCA result currently shown)
//   - hovered window on the scrubber
//   - hovered sample on the scatter
//   - selected sample set (click-to-toggle)
//
// Subscribers fire on every actual change.

/**
 * Create the PCA-panel selection store.
 *
 * @param {number} [initialActiveIdx]  default 0
 * @returns {Object}                   API documented inline below.
 */
export function createPcaPanelSelection(initialActiveIdx) {
  let active        = Number.isFinite(initialActiveIdx) ? (initialActiveIdx | 0) : 0;
  let hoveredWindow = null;
  let hoveredSample = null;
  const selected = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  return {
    getActiveWindowIdx:  () => active,
    setActiveWindowIdx(i) {
      const next = _coerce(i);
      if (active !== next) { active = next; notify(); }
    },
    getHoveredWindowIdx: () => hoveredWindow,
    setHoveredWindowIdx(i) {
      const next = _coerce(i);
      if (hoveredWindow !== next) { hoveredWindow = next; notify(); }
    },
    getHoveredSample:    () => hoveredSample,
    setHoveredSample(i) {
      const next = _coerce(i);
      if (hoveredSample !== next) { hoveredSample = next; notify(); }
    },
    getSelectedSamples:  () => selected,
    toggleSelectedSample(i) {
      const k = _coerce(i);
      if (k == null) return;
      if (selected.has(k)) selected.delete(k);
      else                 selected.add(k);
      notify();
    },
    clearSelection() {
      if (selected.size === 0) return;
      selected.clear();
      notify();
    },
    getHovered: () => hoveredWindow,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Summarise the active PCA result for the right-hand panel.
 *
 * @param {Object} pca_result  one entry from pca_results
 * @param {Object} [meta]      optional { window_idx, candidate_label,
 *                                         start_bp, end_bp,
 *                                         n_samples }
 * @returns {Array<{label:string, value:string}>}
 */
export function summarisePcaResult(pca_result, meta) {
  const m = meta || {};
  const out = [];
  if (m.window_idx != null) {
    out.push({ label: 'Window', value: String(m.window_idx) });
  }
  if (m.start_bp != null && m.end_bp != null) {
    out.push({ label: 'Range', value: `${m.start_bp}–${m.end_bp} bp` });
  }
  if (!pca_result) {
    out.push({ label: 'PCA', value: '— (no result)' });
    return out;
  }
  const n = (pca_result.pc1 && pca_result.pc1.length) || m.n_samples || 0;
  out.push({ label: 'Samples', value: String(n) });
  out.push({ label: 'λ1',
             value: Number.isFinite(pca_result.lam1) ? pca_result.lam1.toFixed(4) : '—' });
  out.push({ label: 'λ2',
             value: Number.isFinite(pca_result.lam2) ? pca_result.lam2.toFixed(4) : '—' });
  if (Number.isFinite(pca_result.polarity_flips_applied)
      && pca_result.polarity_flips_applied > 0) {
    out.push({ label: 'Polarity flips',
               value: String(pca_result.polarity_flips_applied) });
  }
  return out;
}

/**
 * Cluster-size summary for a per-sample assignment array.
 *
 * @param {Int32Array|number[]|null} assignment
 * @returns {Array<[number, number]>}  [cluster_id, count] sorted desc
 */
export function clusterSizesFromAssignment(assignment) {
  if (!assignment || assignment.length === 0) return [];
  const counts = new Map();
  for (let i = 0; i < assignment.length; i++) {
    const k = assignment[i] | 0;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = Array.from(counts.entries());
  out.sort((a, b) => b[1] - a[1]);
  return out;
}
