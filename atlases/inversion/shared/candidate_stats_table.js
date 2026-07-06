// shared/candidate_stats_table.js
// =====================================================================
// Export the candidate & karyotype list to a TSV table — one row per
// candidate inversion / LRR, with the computed overdominance / POD
// hallmark stats (FIS, nucleotide diversity, deleterious load) alongside
// the region's coordinates and karyotype grouping. This is the on-page
// analogue of manuscript Table 1.
//
// Reads the per-candidate `region_stats` block populated by the on-the-fly
// popstats + SIFT fetch. Missing stats render as empty cells.
//
// Pure string building. No DOM.
// =====================================================================

const COLUMNS = Object.freeze([
  'candidate_id', 'chrom', 'start_bp', 'end_bp', 'span_mb', 'K',
  'karyotype_groups', 'is_auto',
  'fis', 'theta_pi', 'deleterious_load', 'del_tol_ratio', 'n_sites',
  'fis_by_group', 'stats_source', 'computed_at',
]);

/**
 * @param {Array<Object>} candidates  candidate objects (each may carry
 *                                    `region_stats` from the stats fetch)
 * @returns {string} TSV (header + one row per candidate)
 */
export function buildCandidateStatsTSV(candidates) {
  const rows = [COLUMNS.join('\t')];
  const list = Array.isArray(candidates) ? candidates : [];
  for (const c of list) {
    if (!c) continue;
    const rs = c.region_stats || null;
    const sift = rs && rs.sift ? rs.sift : null;
    const span = (Number.isFinite(c.end_bp) && Number.isFinite(c.start_bp))
      ? ((c.end_bp - c.start_bp) / 1e6) : NaN;
    const cells = [
      _cell(c.id),
      _cell(c.chrom),
      _int(c.start_bp),
      _int(c.end_bp),
      _fix(span, 3),
      _int(c.K),
      _cell(_karyoGroups(rs)),
      _bool(_isAuto(c)),
      _fix(rs && rs.fis, 4),
      _sci(rs && rs.theta_pi),
      _fix(sift && sift.deleterious_load, 4),
      _fix(sift && sift.del_tol_ratio, 4),
      _int(rs && rs.n_sites),
      _cell(_byGroup(rs && rs.fis_by_group)),
      _cell(rs && rs.source),
      _cell(rs && rs.computed_at),
    ];
    rows.push(cells.join('\t'));
  }
  return rows.join('\n') + '\n';
}

export const CANDIDATE_STATS_COLUMNS = COLUMNS;

// --- cell formatters ---------------------------------------------------
function _karyoGroups(rs) {
  const g = rs && (rs.fis_by_group || rs.theta_pi_by_group);
  if (!g) return '';
  return Object.keys(g).filter(k => k !== 'ALL').join(';');
}
function _byGroup(g) {
  if (!g) return '';
  return Object.keys(g)
    .filter(k => k !== 'ALL')
    .map(k => k + ':' + (Number.isFinite(g[k]) ? g[k].toFixed(4) : ''))
    .join(';');
}
function _isAuto(c) {
  if (typeof c.is_auto === 'boolean') return c.is_auto;
  return !!(c.origin === 'auto' || c.auto === true);
}
function _cell(v) {
  if (v == null) return '';
  return String(v).replace(/[\t\r\n]/g, ' ');
}
function _int(v) { return Number.isFinite(v) ? String(Math.round(v)) : ''; }
function _fix(v, d) { return Number.isFinite(v) ? v.toFixed(d) : ''; }
function _sci(v) { return Number.isFinite(v) ? v.toExponential(3) : ''; }
function _bool(v) { return v ? 'true' : 'false'; }
