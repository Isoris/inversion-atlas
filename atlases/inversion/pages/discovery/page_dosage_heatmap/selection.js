// pages/discovery/page_dosage_heatmap/selection.js
//
// Selection store for the dosage-heatmap panel. Tracks:
//   - hovered cell {row, col, marker_idx, sample_idx, dosage}
//   - selected sample set (canonical sample ids)
//   - selected marker set (canonical marker ids)

/**
 * Create the dosage-heatmap selection store.
 *
 * @returns {Object} API documented inline below.
 */
export function createDosageHeatmapSelection() {
  let hovered = null;  // { row, col, marker_idx, sample_idx, dosage } | null
  const selectedSamples = new Set();
  const selectedMarkers = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  const _sameHover = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.marker_idx === b.marker_idx && a.sample_idx === b.sample_idx;
  };
  return {
    getHoveredCell: () => hovered,
    setHoveredCell(cell) {
      if (cell == null) {
        if (hovered !== null) { hovered = null; notify(); }
        return;
      }
      const next = {
        row:        cell.row | 0,
        col:        cell.col | 0,
        marker_idx: cell.marker_idx | 0,
        sample_idx: cell.sample_idx | 0,
        dosage:     Number.isFinite(cell.dosage) ? cell.dosage : null,
      };
      if (!_sameHover(hovered, next)) { hovered = next; notify(); }
    },
    getSelectedSamples: () => selectedSamples,
    toggleSelectedSample(i) {
      const k = _coerce(i);
      if (k == null) return;
      if (selectedSamples.has(k)) selectedSamples.delete(k);
      else                        selectedSamples.add(k);
      notify();
    },
    getSelectedMarkers: () => selectedMarkers,
    toggleSelectedMarker(i) {
      const k = _coerce(i);
      if (k == null) return;
      if (selectedMarkers.has(k)) selectedMarkers.delete(k);
      else                        selectedMarkers.add(k);
      notify();
    },
    clearSelection() {
      if (selectedSamples.size === 0 && selectedMarkers.size === 0) return;
      selectedSamples.clear();
      selectedMarkers.clear();
      notify();
    },
    getHovered: () => hovered,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Build a tooltip-style summary for a hovered cell. Mirrors the
 * legacy 'CGA037 · M0124 (12,018,473 bp) · dosage=1 · HOMO_1 · core'
 * format but uses just the data we have access to in the canonical
 * shape.
 *
 *   sample · marker · dosage=N · group · flipped
 *
 * @param {Object} hover    selection.getHoveredCell() value
 * @param {Object} data     canonical data shape (sample_labels, ...)
 * @returns {string}
 */
export function summariseHoverCell(hover, data) {
  if (!hover || !data) return '—';
  const parts = [];
  const sLabel = (data.sample_labels && data.sample_labels[hover.sample_idx])
              || ('S' + hover.sample_idx);
  parts.push(sLabel);
  const mLabel = (data.marker_labels && data.marker_labels[hover.marker_idx])
              || ('M' + hover.marker_idx);
  parts.push(mLabel);
  parts.push(hover.dosage == null ? 'dosage=NA'
                                  : 'dosage=' + (Number.isFinite(hover.dosage)
                                      ? hover.dosage.toFixed(3) : hover.dosage));
  if (data.sample_group && data.sample_group[hover.sample_idx] != null) {
    parts.push(String(data.sample_group[hover.sample_idx]));
  }
  if (data.marker_polarity && data.marker_polarity[hover.marker_idx]) {
    parts.push('flipped');
  }
  return parts.join(' · ');
}

/**
 * Count distinct group ids in `data.sample_group`. Returns
 * `[group_id, count]` pairs sorted descending by count — used by
 * the legend.
 *
 * @param {Array<*>|null} sample_group
 * @returns {Array<[*, number]>}
 */
export function groupSizesFromSampleGroup(sample_group) {
  if (!Array.isArray(sample_group) || sample_group.length === 0) return [];
  const counts = new Map();
  for (const g of sample_group) {
    if (g == null) continue;
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
