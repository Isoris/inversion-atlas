// pages/discovery/nested_inversion_detector/selection.js
//
// Selection store for the nested-detector panel. Tracks:
//   - hovered band     (per-stratum candidate cell)
//   - hovered interval (contiguous inner interval)
//   - selected interval set (click-to-toggle)

export function createNestedDetectorSelection() {
  let hoveredBand = null;       // {stratum, band_id, candidate_idx} | null
  let hoveredInterval = null;   // number | null
  const selected = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _sameBand = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.stratum === b.stratum
        && a.candidate_idx === b.candidate_idx;
  };
  return {
    getHoveredBand: () => hoveredBand,
    setHoveredBand(b) {
      const next = b ? {
        stratum: b.stratum,
        band_id: b.band_id | 0,
        candidate_idx: b.candidate_idx | 0,
      } : null;
      if (!_sameBand(hoveredBand, next)) { hoveredBand = next; notify(); }
    },
    getHoveredInterval: () => hoveredInterval,
    setHoveredInterval(i) {
      const next = Number.isFinite(i) ? (i | 0) : null;
      if (hoveredInterval !== next) { hoveredInterval = next; notify(); }
    },
    getSelectedIntervals: () => selected,
    toggleSelectedInterval(i) {
      const k = Number.isFinite(i) ? (i | 0) : null;
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
    getHovered: () => hoveredInterval,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Summarise an inner interval for the right-panel detail list.
 *
 * @param {Object} interval   one entry from result.inner_intervals
 * @returns {Array<{label:string, value:string}>}
 */
export function summariseInterval(interval) {
  if (!interval) return [{ label: 'Interval', value: '—' }];
  const out = [];
  if (interval.window_start != null && interval.window_end != null) {
    out.push({
      label: 'Windows',
      value: `${interval.window_start}–${interval.window_end}`,
    });
  }
  if (interval.start_bp != null && interval.end_bp != null) {
    out.push({
      label: 'Range',
      value: `${interval.start_bp}–${interval.end_bp} bp`,
    });
  }
  if (Array.isArray(interval.strata)) {
    out.push({ label: 'Strata', value: interval.strata.join(', ') });
  }
  if (Number.isFinite(interval.combined_silhouette)) {
    out.push({
      label: 'Mean silhouette',
      value: interval.combined_silhouette.toFixed(3),
    });
  }
  return out;
}

/**
 * Count per-stratum candidate counts for the right-panel header.
 *
 * @param {Object} result
 * @returns {Array<[string, number]>}
 */
export function candidateCountsByStratum(result) {
  if (!result) return [];
  const psc = result.per_stratum_candidates || {};
  const out = [];
  for (const s of ['HOM1', 'HET', 'HOM2']) {
    out.push([s, Array.isArray(psc[s]) ? psc[s].length : 0]);
  }
  return out;
}
