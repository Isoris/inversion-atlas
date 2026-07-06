// shared/candidate_stats_display.js
// =====================================================================
// Presentation of a candidate's per-region overdominance / POD hallmark
// stats (FIS · SIFT deleterious load · θπ diversity) as the `.cli-stats`
// line shown to the right of the karyotype meta in the candidate list.
// Shared so the list renderer and the on-the-fly "compute stats" in-place
// DOM update format identically.
//
// Pure string building. No DOM.
// =====================================================================

/** @returns {string} the `.cli-stats` div HTML for one candidate. */
export function statsLineHTML(cand) {
  const rs = cand && cand.region_stats;
  const fmt = (v, dp) => (Number.isFinite(v) ? v.toFixed(dp) : '—');
  const sci = (v) => (Number.isFinite(v) ? v.toExponential(1) : '—');
  const fis = rs ? rs.fis : NaN;
  const del = rs && rs.sift ? rs.sift.deleterious_load : NaN;
  const th  = rs ? rs.theta_pi : NaN;
  // Negative FIS = heterozygote excess (the POD / balancing-selection signal).
  const fisCls = Number.isFinite(fis) ? (fis < 0 ? 'cli-fis-neg' : 'cli-fis-pos') : '';
  const tip = (rs
    ? 'Region overdominance / POD hallmarks (popstats + SIFT).\n' +
      'FIS ' + fmt(fis, 4) + ' (negative = heterozygote excess)\n' +
      'SIFT deleterious load ' + fmt(del, 4) + '\n' +
      'θπ ' + sci(th) + (rs.computed_at ? '\ncomputed ' + rs.computed_at : '')
    : 'Not computed yet — use "compute stats" to fetch FIS / SIFT / θπ for this region.'
  ).replace(/"/g, '&quot;');
  return '<div class="cli-stats' + (rs ? '' : ' cli-stats-empty') + '" title="' + tip + '">' +
    '<span class="cli-stat"><span class="cli-stat-k">FIS</span> <b class="' + fisCls + '">' + fmt(fis, 3) + '</b></span>' +
    '<span class="cli-stat"><span class="cli-stat-k">SIFT</span> <b>' + fmt(del, 3) + '</b></span>' +
    '<span class="cli-stat"><span class="cli-stat-k">θπ</span> <b>' + sci(th) + '</b></span>' +
    '</div>';
}
