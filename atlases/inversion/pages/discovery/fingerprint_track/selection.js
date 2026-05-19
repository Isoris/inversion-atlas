// pages/discovery/fingerprint_track/selection.js
//
// Selection store for the fingerprint track. Tracks hover on either
// a window cell or a switch marker, plus a set of selected windows
// (click-to-toggle).

/**
 * Create a fingerprint-track selection store.
 *
 * @returns {{
 *   getHoveredWindow: () => number|null,
 *   setHoveredWindow: (i:number|null) => void,
 *   getHoveredSwitch: () => number|null,
 *   setHoveredSwitch: (i:number|null) => void,
 *   getSelected:      () => Set<number>,
 *   toggleSelected:   (i:number) => void,
 *   clearSelection:   () => void,
 *   getHovered:       () => number|null,
 *   subscribe:        (cb:Function) => Function,
 * }}
 */
export function createFingerprintSelection() {
  let hoveredWindow = null;
  let hoveredSwitch = null;
  const selected = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  return {
    getHoveredWindow: () => hoveredWindow,
    setHoveredWindow(i) {
      const next = _coerce(i);
      if (hoveredWindow !== next) { hoveredWindow = next; notify(); }
    },
    getHoveredSwitch: () => hoveredSwitch,
    setHoveredSwitch(i) {
      const next = _coerce(i);
      if (hoveredSwitch !== next) { hoveredSwitch = next; notify(); }
    },
    getSelected: () => selected,
    toggleSelected(i) {
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
    // Convenience for symmetry with the tree panel's selection store.
    getHovered: () => hoveredWindow,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Build a one-line summary string for a window record. Used by the
 * right-side detail panel.
 *
 * @param {Object} window_record   one entry from fingerprint.windows
 * @returns {string}
 */
export function summariseWindow(window_record) {
  if (!window_record) return '—';
  const sig = window_record.rank_signature;
  if (!sig) return `window ${window_record.idx} · no data`;
  return `window ${window_record.idx} · regime ${window_record.regime_id} · `
       + `pi[${sig.pi_rank.join(',')}] dxy[${sig.dxy_rank.join(',')}] fst[${sig.fst_rank.join(',')}]`;
}
