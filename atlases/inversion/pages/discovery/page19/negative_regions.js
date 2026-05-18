// pages/discovery/page19/negative_regions.js
//
// Negative regions catalogue — the page19 implementation that legacy
// shipped only as an HTML shell. Loads `negative_regions.json` (or
// .tsv) into state.negativeRegions, renders summary cards (per-
// region_status counts) + the region table, supports CSV export and
// reset.
//
// state.negativeRegions shape (after a successful load):
//   {
//     metadata: { panel_name, date, ... },
//     regions: [
//       { region_id, chr, start_bp, end_bp, region_status,
//         evidence: { local_pca, ghsl, sv_callers, heterozygosity,
//                     ld, callable_mask },  // each: 'pass'|'limited'|'fail'
//         snp_density, callable_fraction, n_samples, notes, citation },
//       ...
//     ],
//   }
//
// region_status vocabulary (manuscript-facing — see legacy 7421-7450):
//   - inversion_candidate
//   - complex_candidate
//   - no_detectable_inversion_high_confidence
//   - no_detectable_inversion_low_power
//   - no_detectable_inversion_low_callability
//
// All pure helpers are headless-testable. DOM renderers + event
// wiring tolerate partial mocks.

// =====================================================================
// Constants
// =====================================================================

/** Five region_status values + their display colors (legacy 7421-7450). */
export const REGION_STATUSES = Object.freeze([
  Object.freeze({
    value: 'inversion_candidate',
    label: 'positive',
    fill:  '#e0555c',
    desc:  'Positive call cross-listed from the main catalogue.',
  }),
  Object.freeze({
    value: 'complex_candidate',
    label: 'complex',
    fill:  '#b07cf7',
    desc:  'Multi-arrangement or overlapping calls.',
  }),
  Object.freeze({
    value: 'no_detectable_inversion_high_confidence',
    label: 'high-conf neg',
    fill:  '#3cc08a',
    desc:  'Passes all evidence layers cleanly.',
  }),
  Object.freeze({
    value: 'no_detectable_inversion_low_power',
    label: 'low power',
    fill:  '#f5a524',
    desc:  'Region too small / SNP-poor to confidently exclude an inversion.',
  }),
  Object.freeze({
    value: 'no_detectable_inversion_low_callability',
    label: 'low callability',
    fill:  '#6b7388',
    desc:  'Callable mask gaps make absence call unreliable.',
  }),
]);

/** Evidence-layer slots referenced in the per-region table. */
export const EVIDENCE_LAYERS = Object.freeze([
  'local_pca', 'ghsl', 'sv_callers', 'heterozygosity', 'ld', 'callable_mask',
]);

const _STATUS_BY_VALUE = (() => {
  const m = new Map();
  for (const s of REGION_STATUSES) m.set(s.value, s);
  return m;
})();

// =====================================================================
// Validation
// =====================================================================

function _validRegion(r) {
  if (!r || typeof r !== 'object') return false;
  if (typeof r.region_id !== 'string' || !r.region_id) return false;
  if (typeof r.chr !== 'string' || !r.chr) return false;
  if (!Number.isFinite(r.start_bp) || r.start_bp < 0) return false;
  if (!Number.isFinite(r.end_bp) || r.end_bp <= r.start_bp) return false;
  if (typeof r.region_status !== 'string' || !r.region_status) return false;
  return true;
}

function _coerceEvidence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of EVIDENCE_LAYERS) {
    if (k in raw) out[k] = String(raw[k]);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function _normalizeRegion(r) {
  const norm = {
    region_id:     String(r.region_id),
    chr:           String(r.chr),
    start_bp:      +r.start_bp,
    end_bp:        +r.end_bp,
    region_status: String(r.region_status),
  };
  const ev = _coerceEvidence(r.evidence);
  if (ev) norm.evidence = ev;
  if (Number.isFinite(r.snp_density))       norm.snp_density = +r.snp_density;
  if (Number.isFinite(r.callable_fraction)) norm.callable_fraction = +r.callable_fraction;
  if (Number.isFinite(r.n_samples))         norm.n_samples = +r.n_samples;
  if (typeof r.notes === 'string')          norm.notes = r.notes;
  if (typeof r.citation === 'string')       norm.citation = r.citation;
  return norm;
}

// =====================================================================
// Parsers
// =====================================================================

/**
 * Parse a JSON payload (string or already-parsed object) into a
 * negative-regions bundle. Returns:
 *   { ok: true, metadata, regions, n_dropped, errors? }
 * or
 *   { ok: false, error }
 *
 * Invalid regions are dropped with `n_dropped` and per-row errors;
 * the load is not aborted unless the top-level shape is wrong.
 *
 * @param {string|Object} input
 * @returns {Object}
 */
export function parseNegativeRegionsJSON(input) {
  let payload = input;
  if (typeof input === 'string') {
    try { payload = JSON.parse(input); }
    catch (e) { return { ok: false, error: 'JSON parse failed: ' + (e && e.message) }; }
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'payload is not an object' };
  }
  if (!Array.isArray(payload.regions)) {
    return { ok: false, error: 'missing regions[] array' };
  }
  const regions = [];
  const errors  = [];
  for (let i = 0; i < payload.regions.length; i++) {
    const r = payload.regions[i];
    if (!_validRegion(r)) {
      errors.push({ row: i, reason: 'invalid region shape' });
      continue;
    }
    regions.push(_normalizeRegion(r));
  }
  return {
    ok: true,
    metadata: (payload.metadata && typeof payload.metadata === 'object')
      ? payload.metadata : {},
    regions,
    n_dropped: errors.length,
    errors,
  };
}

/**
 * Parse a TSV payload (string). Accepts a header line followed by
 * data rows. Required columns: region_id, chr, start_bp, end_bp,
 * region_status. Optional: snp_density, callable_fraction, n_samples,
 * notes, citation, evidence_<layer>.
 *
 *   parseNegativeRegionsTSV('region_id\tchr\tstart_bp\tend_bp\tregion_status\nA\tLG28\t0\t1000\tinversion_candidate')
 *
 * Returns the same shape as parseNegativeRegionsJSON. Empty/comment
 * lines (leading #) are skipped.
 *
 * @param {string} text
 * @returns {Object}
 */
export function parseNegativeRegionsTSV(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'not a string' };
  }
  const lines = text.split(/\r?\n/);
  let headerCols = null;
  const regions = [];
  const errors  = [];
  let rowIdx = -1;
  for (const raw of lines) {
    if (!raw || raw.length === 0) continue;
    if (raw.startsWith('#')) continue;
    rowIdx++;
    const cells = raw.split('\t');
    if (!headerCols) {
      headerCols = cells.map(c => c.trim().toLowerCase());
      // Check required columns
      const need = ['region_id', 'chr', 'start_bp', 'end_bp', 'region_status'];
      for (const n of need) {
        if (headerCols.indexOf(n) < 0) {
          return { ok: false, error: 'TSV missing required column: ' + n };
        }
      }
      continue;
    }
    const obj = {};
    for (let i = 0; i < headerCols.length; i++) {
      obj[headerCols[i]] = cells[i] != null ? cells[i] : '';
    }
    const r = {
      region_id:     obj.region_id || '',
      chr:           obj.chr || '',
      start_bp:      Number(obj.start_bp),
      end_bp:        Number(obj.end_bp),
      region_status: obj.region_status || '',
    };
    // Evidence: any header column starting with 'evidence_'
    const ev = {};
    for (const col of headerCols) {
      if (col.startsWith('evidence_')) {
        const layer = col.slice('evidence_'.length);
        if (EVIDENCE_LAYERS.includes(layer)) ev[layer] = obj[col];
      }
    }
    if (Object.keys(ev).length > 0) r.evidence = ev;
    if (obj.snp_density)       r.snp_density = Number(obj.snp_density);
    if (obj.callable_fraction) r.callable_fraction = Number(obj.callable_fraction);
    if (obj.n_samples)         r.n_samples = Number(obj.n_samples);
    if (obj.notes)             r.notes = obj.notes;
    if (obj.citation)          r.citation = obj.citation;

    if (!_validRegion(r)) {
      errors.push({ row: rowIdx, reason: 'invalid region shape' });
      continue;
    }
    regions.push(_normalizeRegion(r));
  }
  if (!headerCols) return { ok: false, error: 'TSV had no header' };
  return {
    ok: true,
    metadata: {},
    regions,
    n_dropped: errors.length,
    errors,
  };
}

// =====================================================================
// Summary
// =====================================================================

/**
 * Per-region_status counts. Returns an object keyed by status, with
 * value 0 for known statuses that have no rows. Unknown statuses get
 * lumped under `_other`.
 *
 *   summarizeRegionStatuses(regions) → { inversion_candidate: 2, ... }
 *
 * @param {Array<{region_status:string}>} regions
 * @returns {Object<string,number>}
 */
export function summarizeRegionStatuses(regions) {
  const out = {};
  for (const s of REGION_STATUSES) out[s.value] = 0;
  out._other = 0;
  if (!Array.isArray(regions)) return out;
  for (const r of regions) {
    if (!r || typeof r.region_status !== 'string') continue;
    if (out[r.region_status] != null) out[r.region_status]++;
    else out._other++;
  }
  return out;
}

// =====================================================================
// CSV export
// =====================================================================

function _tsvCell(v) {
  if (v == null) return '';
  // TSV: strip tab + newline (matches the catalogue / karyotype_tier export hygiene
  // convention). Tabs and newlines are illegal in TSV cells; the legacy
  // catalogue / karyotype_tier / page8 exporters all use this strip-not-quote pattern.
  return String(v).replace(/[\t\r\n]/g, ' ');
}

/**
 * Render the loaded regions as a TSV string. One header line +
 * per-region rows. Includes a column for every evidence layer
 * (empty when missing). Newline = '\n'; embedded tabs / newlines
 * are stripped (no quoting needed in TSV).
 *
 * Preferred over CSV across the inversion atlas — matches the
 * catalogue catalogue / karyotype_tier karyotype / page8 export convention.
 *
 * @param {Array<Object>} regions
 * @returns {string}
 */
export function regionsToTSV(regions) {
  const cols = [
    'region_id', 'chr', 'start_bp', 'end_bp', 'region_status',
    ...EVIDENCE_LAYERS.map(l => 'evidence_' + l),
    'snp_density', 'callable_fraction', 'n_samples',
    'notes', 'citation',
  ];
  const out = [cols.join('\t')];
  if (!Array.isArray(regions)) return out.join('\n');
  for (const r of regions) {
    if (!r) continue;
    const row = [];
    row.push(_tsvCell(r.region_id));
    row.push(_tsvCell(r.chr));
    row.push(_tsvCell(r.start_bp));
    row.push(_tsvCell(r.end_bp));
    row.push(_tsvCell(r.region_status));
    for (const layer of EVIDENCE_LAYERS) {
      row.push(_tsvCell(r.evidence && r.evidence[layer]));
    }
    row.push(_tsvCell(r.snp_density));
    row.push(_tsvCell(r.callable_fraction));
    row.push(_tsvCell(r.n_samples));
    row.push(_tsvCell(r.notes));
    row.push(_tsvCell(r.citation));
    out.push(row.join('\t'));
  }
  return out.join('\n');
}

/**
 * Back-compat alias. Existing call sites that imported `regionsToCSV`
 * still work, but the implementation now emits TSV (per user
 * preference — TSV is the canonical inversion-atlas export format).
 * Prefer `regionsToTSV` for new code.
 *
 * @deprecated use regionsToTSV
 */
export const regionsToCSV = regionsToTSV;

// =====================================================================
// HTML builders
// =====================================================================

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _bpMb(n) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + ' Mb';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + ' kb';
  return String(n) + ' bp';
}

/**
 * Build summary-cards HTML for the loaded regions. One card per
 * known status (always rendered with count 0 if missing) + an
 * '_other' card if any unknown statuses appeared.
 *
 * Returns the inner HTML for #nrSummaryCards.
 */
export function renderSummaryCardsHtml(regions) {
  const counts = summarizeRegionStatuses(regions);
  const parts = [];
  parts.push('<div style="display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0;">');
  for (const s of REGION_STATUSES) {
    const n = counts[s.value] || 0;
    parts.push(
      '<div style="flex: 1 1 180px; min-width: 160px; padding: 10px 14px; ' +
      'border: 1px solid var(--rule); border-radius: 4px; ' +
      'border-left: 3px solid ' + s.fill + ';">' +
      '<div style="font-size:18px; font-weight:600;">' + n + '</div>' +
      '<div style="font-size:11px; color: var(--ink-dim); margin-top:2px;">' +
      _escape(s.label) + '</div>' +
      '<div style="font-size:10.5px; color: var(--ink-dimmer); margin-top:4px; ' +
      'line-height:1.4;">' + _escape(s.desc) + '</div>' +
      '</div>'
    );
  }
  if (counts._other > 0) {
    parts.push(
      '<div style="flex: 1 1 180px; min-width: 160px; padding: 10px 14px; ' +
      'border: 1px solid var(--rule); border-radius: 4px;">' +
      '<div style="font-size:18px; font-weight:600;">' + counts._other + '</div>' +
      '<div style="font-size:11px; color: var(--ink-dim);">other</div>' +
      '<div style="font-size:10.5px; color: var(--ink-dimmer);">' +
      'rows with status outside the canonical 5-value vocabulary</div>' +
      '</div>'
    );
  }
  parts.push('</div>');
  return parts.join('');
}

function _evidenceChip(value) {
  if (value === 'pass')    return '<span style="color: #3cc08a;">✓</span>';
  if (value === 'fail')    return '<span style="color: #e0555c;">✗</span>';
  if (value === 'limited') return '<span style="color: #f5a524;">~</span>';
  return '<span style="color: var(--ink-dimmer);">—</span>';
}

/**
 * Build the region table HTML.
 *
 * @param {Array<Object>} regions
 * @returns {string}
 */
export function renderRegionsTableHtml(regions) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return '<div style="padding: 24px; text-align: center; color: var(--ink-dim);">'
         + 'No regions loaded. Use <b>load negative_regions…</b> above.</div>';
  }
  const rows = [];
  rows.push(
    '<table style="width: 100%; border-collapse: collapse; font-size: 11px; font-family: var(--mono);">'
    + '<thead><tr style="background: var(--panel-2); border-bottom: 1px solid var(--rule);">'
    + '<th style="padding: 6px 10px; text-align: left;">region_id</th>'
    + '<th style="padding: 6px 10px; text-align: left;">chr</th>'
    + '<th style="padding: 6px 10px; text-align: right;">start</th>'
    + '<th style="padding: 6px 10px; text-align: right;">end</th>'
    + '<th style="padding: 6px 10px; text-align: left;">status</th>'
    + EVIDENCE_LAYERS.map(l =>
        '<th style="padding: 6px 10px; text-align: center;" title="' + l + '">'
        + l.replace(/_/g, ' ').substring(0, 8) + '</th>').join('')
    + '<th style="padding: 6px 10px; text-align: right;">SNPs/kb</th>'
    + '<th style="padding: 6px 10px; text-align: right;">callable</th>'
    + '<th style="padding: 6px 10px; text-align: right;">n</th>'
    + '<th style="padding: 6px 10px; text-align: left;">notes</th>'
    + '</tr></thead><tbody>'
  );
  for (const r of regions) {
    if (!r) continue;
    const statusEntry = _STATUS_BY_VALUE.get(r.region_status);
    const statusColor = statusEntry ? statusEntry.fill : 'var(--ink-dimmer)';
    rows.push(
      '<tr style="border-bottom: 1px solid var(--rule);">'
      + '<td style="padding: 4px 10px;">' + _escape(r.region_id) + '</td>'
      + '<td style="padding: 4px 10px;">' + _escape(r.chr) + '</td>'
      + '<td style="padding: 4px 10px; text-align: right;">' + _bpMb(r.start_bp) + '</td>'
      + '<td style="padding: 4px 10px; text-align: right;">' + _bpMb(r.end_bp) + '</td>'
      + '<td style="padding: 4px 10px;">'
      + '<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; '
      + 'background: ' + statusColor + '; margin-right: 6px;"></span>'
      + _escape(r.region_status) + '</td>'
      + EVIDENCE_LAYERS.map(l =>
          '<td style="padding: 4px 10px; text-align: center;">'
          + _evidenceChip(r.evidence && r.evidence[l]) + '</td>').join('')
      + '<td style="padding: 4px 10px; text-align: right;">'
        + (Number.isFinite(r.snp_density) ? (r.snp_density * 1000).toFixed(1) : '—') + '</td>'
      + '<td style="padding: 4px 10px; text-align: right;">'
        + (Number.isFinite(r.callable_fraction) ? (r.callable_fraction * 100).toFixed(0) + '%' : '—') + '</td>'
      + '<td style="padding: 4px 10px; text-align: right;">'
        + (Number.isFinite(r.n_samples) ? r.n_samples : '—') + '</td>'
      + '<td style="padding: 4px 10px; color: var(--ink-dim);">' + _escape(r.notes || '') + '</td>'
      + '</tr>'
    );
  }
  rows.push('</tbody></table>');
  return rows.join('');
}

// =====================================================================
// Build a download filename
// =====================================================================

/**
 * Build a CSV filename for the loaded regions.
 *   buildExportFilename(state, now?) → 'negative_regions_2026-05-12T10-30-45.tsv'
 */
export function buildExportFilename(state, now) {
  const stamp = (now || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return 'negative_regions_' + stamp + '.tsv';
}

// =====================================================================
// DOM renderer + wiring
// =====================================================================

function _canListen(target) {
  return target
    && typeof target.addEventListener === 'function'
    && typeof target.removeEventListener === 'function';
}

/**
 * Render against the active document. Reads state.negativeRegions
 * (which is set by the load handlers). Updates #nrSummaryCards and
 * the table slot (#nrTableSlot if present, falls back to creating a
 * div inside the page wrapper). Idempotent.
 */
export function renderNegativeRegions(state) {
  if (typeof document === 'undefined') return;
  const regions = (state && Array.isArray(state.negativeRegions))
    ? state.negativeRegions : [];
  const summary = document.getElementById('nrSummaryCards');
  if (summary) summary.innerHTML = renderSummaryCardsHtml(regions);
  const slot = document.getElementById('nrTableSlot');
  if (slot) slot.innerHTML = renderRegionsTableHtml(regions);
  const badge = document.getElementById('nrTableBadge');
  if (badge) badge.textContent = String(regions.length);
}

// Handler refs for teardown
let _loadHandler   = null;
let _loadChangeHandler = null;
let _exportHandler = null;
let _resetHandler  = null;

/**
 * Wire load / export / reset buttons. Idempotent. State is mutated:
 *   - successful load → state.negativeRegions = [...]
 *                       state.negativeRegionsMetadata = {...}
 *   - reset → state.negativeRegions = []
 *
 * Optional onChange callback fires after every mutation (load / reset)
 * so callers can re-render dependent UI.
 */
export function wireNegativeRegionsToolbar(state, opts) {
  if (typeof document === 'undefined') return;
  teardownNegativeRegionsToolbar();

  const loadBtn = document.getElementById('nrLoadBtn');
  const loadIn  = document.getElementById('nrLoadInput');
  const exportBtn = document.getElementById('nrExportCsvBtn');
  const resetBtn  = document.getElementById('nrResetBtn');
  const onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : null;

  _loadHandler = () => {
    if (loadIn && typeof loadIn.click === 'function') loadIn.click();
  };
  _loadChangeHandler = (evt) => {
    const file = evt && evt.target && evt.target.files && evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e && e.target && e.target.result;
      if (typeof text !== 'string') return;
      const isJson = file.name.toLowerCase().endsWith('.json');
      const result = isJson ? parseNegativeRegionsJSON(text)
                            : parseNegativeRegionsTSV(text);
      if (!result.ok) {
        if (typeof alert === 'function') {
          alert('Failed to parse: ' + result.error);
        }
        return;
      }
      if (state) {
        state.negativeRegions = result.regions;
        state.negativeRegionsMetadata = result.metadata || {};
        if (result.n_dropped > 0 && typeof console !== 'undefined') {
          console.warn('[negativeRegions] dropped ' + result.n_dropped + ' invalid rows');
        }
      }
      renderNegativeRegions(state);
      if (onChange) { try { onChange(state); } catch (_) {} }
    };
    reader.readAsText(file);
    // Reset the input so re-selecting the same file fires change
    if (loadIn) loadIn.value = '';
  };
  _exportHandler = () => {
    if (!state || !Array.isArray(state.negativeRegions) || state.negativeRegions.length === 0) return;
    const tsv = regionsToTSV(state.negativeRegions);
    _downloadBlob(tsv, buildExportFilename(state), 'text/tab-separated-values');
  };
  _resetHandler = () => {
    if (!state) return;
    state.negativeRegions = [];
    state.negativeRegionsMetadata = {};
    renderNegativeRegions(state);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };

  if (_canListen(loadBtn)) loadBtn.addEventListener('click', _loadHandler);
  if (_canListen(loadIn))  loadIn.addEventListener('change', _loadChangeHandler);
  if (_canListen(exportBtn)) exportBtn.addEventListener('click', _exportHandler);
  if (_canListen(resetBtn))  resetBtn.addEventListener('click', _resetHandler);
}

/** Remove all wired handlers. Idempotent. */
export function teardownNegativeRegionsToolbar() {
  if (typeof document === 'undefined') return;
  if (_loadHandler) {
    const el = document.getElementById('nrLoadBtn');
    if (_canListen(el)) el.removeEventListener('click', _loadHandler);
    _loadHandler = null;
  }
  if (_loadChangeHandler) {
    const el = document.getElementById('nrLoadInput');
    if (_canListen(el)) el.removeEventListener('change', _loadChangeHandler);
    _loadChangeHandler = null;
  }
  if (_exportHandler) {
    const el = document.getElementById('nrExportCsvBtn');
    if (_canListen(el)) el.removeEventListener('click', _exportHandler);
    _exportHandler = null;
  }
  if (_resetHandler) {
    const el = document.getElementById('nrResetBtn');
    if (_canListen(el)) el.removeEventListener('click', _resetHandler);
    _resetHandler = null;
  }
}

// =====================================================================
// Blob download (browser-only)
// =====================================================================

function _downloadBlob(text, filename, mime) {
  if (typeof document === 'undefined') return;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') return;
  try {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    if (document.body && typeof document.body.appendChild === 'function') {
      document.body.appendChild(a);
    }
    if (typeof a.click === 'function') a.click();
    setTimeout(() => {
      if (document.body && typeof document.body.removeChild === 'function') {
        try { document.body.removeChild(a); } catch (_) {}
      }
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 200);
  } catch (_) { /* fail-soft */ }
}
