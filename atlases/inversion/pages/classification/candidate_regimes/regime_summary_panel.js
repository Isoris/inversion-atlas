// pages/classification/candidate_regimes/regime_summary_panel.js
// =====================================================================
// Renders the 4-table regime summary bundle from
// shared/mgl_regime_consistency.js into the candidate_regimes page.
// Pure-ish — touches DOM, but no app state.
//
// Inputs:
//   root: HTMLElement (the page root, used for querySelector)
//   tables: output of buildRegimeTables (4 row arrays)
//   lengthBinAggregate: output of lengthBinAggregate
// =====================================================================

import { rowsToTsv, REGIME_CALL_COLORS_CSS } from './_summary_palette.js';

// Subset of columns to render in each table view (the rest stay in the TSV).
const COLS_CANDIDATE = Object.freeze([
  'candidate_id', 'chrom', 'start', 'end',
  'n_samples', 'n_bands', 'major_band_pattern',
  'long_range_support_windows', 'support_span_mb', 'persistence_bucket',
  'mean_contingency_agreement', 'mean_cramers_v',
  'heterozygote_band_present', 'homA_count', 'het_count', 'homB_count',
  'uncertain_count', 'regime_class', 'confidence', 'support_score',
  'notes',
]);
const COLS_SAMPLE = Object.freeze([
  'candidate_id', 'sample_id', 'regime_call', 'band_id',
  'call_confidence', 'fraction_windows_supporting_call', 'notes',
]);
const COLS_WINDOW = Object.freeze([
  'candidate_id', 'window_id', 'chrom', 'start',
  'agreement_to_seed', 'cramers_v_to_seed', 'assigned_regime',
  'is_supported', 'n_samples',
]);
const COLS_QC = Object.freeze([
  'candidate_id', 'regime_class', 'confidence', 'support_score',
  'n_samples_used', 'n_windows_tested', 'n_windows_supported',
  'possible_ancestry_confounding', 'possible_family_confounding',
  'missingness',
]);
const COLS_LEN = Object.freeze([
  'bin', 'lo_bp', 'hi_bp', 'n',
  'mean_cramers_v', 'mean_confidence', 'het_band_rate',
]);

/**
 * Show the summary tables panel and render all five tables. Idempotent.
 *
 * @param {HTMLElement} root
 * @param {Object} bundle  output of buildRegimeTables (+ optional length_binned)
 * @param {Object} [opts]  { downloadPrefix }
 */
export function renderRegimeSummaryPanel(root, bundle, opts) {
  if (!root || !bundle) return;
  const wrap = root.querySelector('#rgSummaryTablesWrap');
  if (!wrap) return;
  wrap.style.display = 'flex';

  _renderTable(root, '#rgSummaryCandTable',   bundle.candidate_regime_summary, COLS_CANDIDATE,
    { renderCell: _candCell });
  _renderTable(root, '#rgSummarySampleTable', bundle.sample_regime_calls,      COLS_SAMPLE,
    { renderCell: _sampleCell });
  _renderTable(root, '#rgSummaryWindowTable', bundle.window_regime_support,    COLS_WINDOW,
    { renderCell: _windowCell });
  _renderTable(root, '#rgSummaryQcTable',     bundle.regime_qc_summary,        COLS_QC,
    { renderCell: _qcCell });
  if (bundle.length_binned_aggregate) {
    _renderTable(root, '#rgSummaryLenTable',  bundle.length_binned_aggregate,  COLS_LEN);
  }

  _setText(root, '#rgSummaryTablesCount',
    `${bundle.candidate_regime_summary.length} candidate${bundle.candidate_regime_summary.length === 1 ? '' : 's'}`);
  _setText(root, '#rgSummaryCandCount',    `(${bundle.candidate_regime_summary.length})`);
  _setText(root, '#rgSummarySampleCount',  `(${bundle.sample_regime_calls.length})`);
  _setText(root, '#rgSummaryWindowCount',  `(${bundle.window_regime_support.length})`);
  _setText(root, '#rgSummaryQcCount',      `(${bundle.regime_qc_summary.length})`);
  _setText(root, '#rgSummaryLenCount',
    bundle.length_binned_aggregate ? `(${bundle.length_binned_aggregate.length} bins)` : '');

  // Wire TSV downloads.
  const prefix = (opts && opts.downloadPrefix) || 'regime_';
  _wireDownload(root, '#rgSummaryDownloadCand',   `${prefix}candidate_regime_summary.tsv`,
                bundle.candidate_regime_summary);
  _wireDownload(root, '#rgSummaryDownloadSample', `${prefix}sample_regime_calls.tsv`,
                bundle.sample_regime_calls);
  _wireDownload(root, '#rgSummaryDownloadWindow', `${prefix}window_regime_support.tsv`,
                bundle.window_regime_support);
  _wireDownload(root, '#rgSummaryDownloadQc',     `${prefix}regime_qc_summary.tsv`,
                bundle.regime_qc_summary);
  if (bundle.length_binned_aggregate) {
    _wireDownload(root, '#rgSummaryDownloadLen',  `${prefix}length_binned_aggregate.tsv`,
                  bundle.length_binned_aggregate);
  }
}

/**
 * Hide the summary tables panel. Called when no pipeline result.
 */
export function hideRegimeSummaryPanel(root) {
  if (!root) return;
  const wrap = root.querySelector('#rgSummaryTablesWrap');
  if (wrap) wrap.style.display = 'none';
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function _setText(root, sel, text) {
  const el = root.querySelector(sel);
  if (el) el.textContent = text;
}

function _renderTable(root, sel, rows, cols, opts) {
  const host = root.querySelector(sel);
  if (!host) return;
  if (!rows || rows.length === 0) {
    host.innerHTML = '<div style="padding: 6px 0; color: var(--ink-dimmer, #5a6472);">(empty)</div>';
    return;
  }
  const renderCell = (opts && typeof opts.renderCell === 'function')
    ? opts.renderCell : _defaultCell;
  let html = '<table style="width: 100%; border-collapse: collapse; font-family: ui-monospace, monospace; font-size: 10.5px;">';
  html += '<thead><tr>';
  for (const c of cols) {
    html += `<th style="text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--rule, #2a3242); white-space: nowrap; color: var(--ink-dim, #8895a8);">${_esc(c)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>';
    for (const c of cols) html += renderCell(c, r[c], r);
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
}

function _defaultCell(col, v, row) {
  return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap;">${_fmt(v)}</td>`;
}

function _candCell(col, v, row) {
  if (col === 'regime_class') {
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap;"><code style="background: var(--panel-2, #181d27); padding: 1px 5px; border-radius: 3px;">${_esc(v)}</code></td>`;
  }
  if (col === 'persistence_bucket' && v) {
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap; color: var(--accent, #f5a524);">${_esc(v)}</td>`;
  }
  if (col === 'heterozygote_band_present') {
    const t = v ? 'yes' : 'no';
    const c = v ? 'var(--ink, #d4dae2)' : 'var(--ink-dimmer, #5a6472)';
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap; color: ${c};">${t}</td>`;
  }
  if (col === 'confidence' || col === 'support_score') {
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap;"><span title="${_fmt(v)}">${_fmt(v)}</span></td>`;
  }
  return _defaultCell(col, v, row);
}

function _sampleCell(col, v, row) {
  if (col === 'regime_call') {
    const color = REGIME_CALL_COLORS_CSS[v] || 'var(--ink-dimmer, #5a6472)';
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap;"><span style="display: inline-flex; align-items: center; gap: 5px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${color};"></span>${_esc(v)}</span></td>`;
  }
  return _defaultCell(col, v, row);
}

function _windowCell(col, v, row) {
  if (col === 'is_supported') {
    const t = v ? '✓' : '·';
    const c = v ? 'rgba(80,180,90,0.85)' : 'var(--ink-dimmer, #5a6472)';
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); text-align: center; color: ${c};">${t}</td>`;
  }
  return _defaultCell(col, v, row);
}

function _qcCell(col, v, row) {
  if (col === 'possible_ancestry_confounding' || col === 'possible_family_confounding') {
    if (v === true) {
      return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap; color: rgba(220,150,60,0.95);">⚠ yes</td>`;
    }
    return `<td style="padding: 3px 8px; border-bottom: 1px solid var(--rule-soft, #1a212e); white-space: nowrap; color: var(--ink-dimmer, #5a6472);">no</td>`;
  }
  return _candCell(col, v, row);
}

function _fmt(v) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NA';
    return Number.isInteger(v) ? String(v) : v.toPrecision(4);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return _esc(String(v));
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _wireDownload(root, sel, filename, rows) {
  const btn = root.querySelector(sel);
  if (!btn) return;
  btn.onclick = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const tsv = rowsToTsv(rows);
    _downloadBlob(filename, tsv, 'text/tab-separated-values');
  };
}

function _downloadBlob(filename, content, mime) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 100);
}
