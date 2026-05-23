// pages/evolution/polarize_msa_stacked/selection.js
//
// Selection store for the polarize MSA cartridge. Hovered cell is
// {row, col, marker_idx, sample_idx} where sample_idx here is the
// row-stack position (0 = outgroup, 1 = INV founder, etc.).

export function createPolarizeMsaSelection() {
  let hovered = null;
  const selected_rows = new Set();
  const selected_sites = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.marker_idx === b.marker_idx && a.sample_idx === b.sample_idx;
  };
  return {
    getHoveredCell: () => hovered,
    setHoveredCell(c) {
      if (c == null) {
        if (hovered !== null) { hovered = null; notify(); }
        return;
      }
      const next = {
        row: c.row | 0, col: c.col | 0,
        marker_idx: c.marker_idx | 0, sample_idx: c.sample_idx | 0,
        dosage: Number.isFinite(c.dosage) ? c.dosage : null,
      };
      if (!same(hovered, next)) { hovered = next; notify(); }
    },
    getSelectedRows: () => selected_rows,
    toggleSelectedRow(i) {
      const k = Number.isFinite(i) ? (i | 0) : null;
      if (k == null) return;
      if (selected_rows.has(k)) selected_rows.delete(k);
      else                      selected_rows.add(k);
      notify();
    },
    getSelectedSites: () => selected_sites,
    toggleSelectedSite(i) {
      const k = Number.isFinite(i) ? (i | 0) : null;
      if (k == null) return;
      if (selected_sites.has(k)) selected_sites.delete(k);
      else                       selected_sites.add(k);
      notify();
    },
    clearSelection() {
      if (selected_rows.size === 0 && selected_sites.size === 0) return;
      selected_rows.clear();
      selected_sites.clear();
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
 * Right-panel summary of the hovered cell.
 *
 * @param {Object} hover         from selection.getHoveredCell()
 * @param {Array<Object>} rows   row-stack from builder
 * @param {Int8Array|null} tier_mask
 * @param {string[]} [marker_labels]
 * @returns {Array<{label:string, value:string}>}
 */
export function summariseHover(hover, rows, tier_mask, marker_labels) {
  if (!hover) return [{ label: 'Cell', value: '—' }];
  const out = [];
  const row = rows && rows[hover.sample_idx];
  if (row) {
    out.push({ label: 'Row', value: row.label });
    out.push({ label: 'Source n', value: String(row.source_count) });
  }
  const mLabel = (marker_labels && marker_labels[hover.marker_idx])
              || ('site ' + hover.marker_idx);
  out.push({ label: 'Site', value: mLabel });
  out.push({ label: 'Dosage',
             value: hover.dosage == null ? 'NA'
                   : (Number.isFinite(hover.dosage) ? hover.dosage.toFixed(3) : hover.dosage) });
  if (tier_mask && tier_mask[hover.marker_idx] != null) {
    const t = tier_mask[hover.marker_idx];
    const label = t === 4 ? 'high' : t === 3 ? 'medium'
                : t === 2 ? 'low'  : t === 1 ? 'ambiguous' : 'suspicious';
    out.push({ label: 'Tier', value: label });
  }
  return out;
}
