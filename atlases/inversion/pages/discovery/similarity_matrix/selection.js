// pages/discovery/similarity_matrix/selection.js
//
// Selection store for the similarity-matrix panel. Tracks:
//   - active window index (the matrix currently displayed)
//   - hover-window index on the transition strip
//   - hover-cell {i, j} on the heatmap
//   - selected sample set (click on the matrix highlights a row/col)
//
// Subscribers fire on every actual change.

/**
 * Create a similarity-panel selection store.
 *
 * @param {number} [initialActiveIdx]  default 0
 * @returns {{
 *   getActiveWindowIdx:  () => number|null,
 *   setActiveWindowIdx:  (i:number|null) => void,
 *   getHoveredWindowIdx: () => number|null,
 *   setHoveredWindowIdx: (i:number|null) => void,
 *   getHoveredCell:      () => {i:number, j:number}|null,
 *   setHoveredCell:      (cell:{i:number, j:number}|null) => void,
 *   getSelectedSamples:  () => Set<number>,
 *   toggleSelectedSample:(i:number) => void,
 *   clearSelection:      () => void,
 *   getHovered:          () => number|null,
 *   subscribe:           (cb:Function) => Function,
 * }}
 */
export function createSimilarityPanelSelection(initialActiveIdx) {
  let active        = Number.isFinite(initialActiveIdx) ? (initialActiveIdx | 0) : 0;
  let hoveredWindow = null;
  let hoveredCell   = null;
  const selected = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  const _coerceCell = (c) => {
    if (!c || !Number.isFinite(c.i) || !Number.isFinite(c.j)) return null;
    return { i: c.i | 0, j: c.j | 0 };
  };
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
    getHoveredCell:      () => hoveredCell,
    setHoveredCell(c) {
      const next = _coerceCell(c);
      const prev = hoveredCell;
      const same = (prev && next && prev.i === next.i && prev.j === next.j)
                || (prev === null && next === null);
      if (!same) { hoveredCell = next; notify(); }
    },
    getSelectedSamples: () => selected,
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
 * Summarise the active window for the right-hand panel.
 *
 * @param {Object} window_record   similarity.windows[i]
 * @returns {Array<{label:string, value:string}>}
 */
export function summariseWindow(window_record) {
  if (!window_record) return [{ label: 'Window', value: '—' }];
  const w = window_record;
  const out = [];
  out.push({ label: 'Window', value: String(w.idx) });
  if (w.start_bp != null && w.end_bp != null) {
    out.push({ label: 'Range', value: `${w.start_bp}–${w.end_bp} bp` });
  }
  out.push({ label: 'Markers',  value: String(w.n_markers_in_window) });
  out.push({ label: 'K blocks', value: String(w.K) });
  out.push({ label: 'Silhouette',
             value: Number.isFinite(w.silhouette_score)
               ? w.silhouette_score.toFixed(3) : '—' });
  return out;
}

/**
 * Block-size summary: array of [block_id, count] sorted by count desc.
 *
 * @param {Int32Array|null} assignment
 * @returns {Array<[number, number]>}
 */
export function blockSizesFromAssignment(assignment) {
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
