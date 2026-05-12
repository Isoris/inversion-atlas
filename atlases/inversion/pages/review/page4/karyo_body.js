// pages/review/page4/karyo_body.js
//
// Karyotype body renderer + toolbar wiring (legacy lines 63091-63289).
// Cartridge port — composes karyo_labels.js + karyo_rows.js with
// shared/page1_data_helpers.js (groupColor). Sigma column reads
// state.sigmaSpread (precomputed σ array, one entry per sample) when
// present; falls back to NaN otherwise.

import { groupColor } from '../../../shared/page1_data_helpers.js';
import { getKaryotypeLabel, getKaryotypeLabelCaveat } from './karyo_labels.js';
import {
  buildKaryotypeRows,
  filterKaryoRows,
  sortKaryoRows,
  isKaryoTwoTrack,
} from './karyo_rows.js';

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _samples(state) {
  const d = state && state.data;
  if (d && Array.isArray(d.samples)) return d.samples;
  return [];
}

function _sigmaSpread(state) {
  // Precomputed σ per sample, optional. Page1 / shared modules write
  // this when available (state.sigmaSpread). Without it, the σ column
  // renders as '—' and high-σ rows are not flagged.
  return (state && (state.sigmaSpread || state._sigmaSpread)) || null;
}

/**
 * Build the karyotype body HTML for a populated candidate. Pure (no
 * DOM mutation): returns the inner HTML for #candKaryoContent.
 *
 * @param {Object} state    must have state.candidate
 * @returns {string}        empty string when no candidate
 */
export function renderKaryotypeBodyHtml(state) {
  const c = state && state.candidate;
  if (!c || !Array.isArray(c.locked_labels) || !Number.isFinite(c.K)) return '';

  const samples = _samples(state);
  const sigSpread = _sigmaSpread(state);
  const rows = buildKaryotypeRows(c, samples, sigSpread);
  const twoTrack = isKaryoTwoTrack(c);

  // Header summary pills
  const counts = new Array(c.K).fill(0);
  for (let i = 0; i < c.locked_labels.length; i++) {
    const k = c.locked_labels[i];
    if (k >= 0 && k < c.K) counts[k]++;
  }
  const caveat = getKaryotypeLabelCaveat(state);
  const titleAttr = caveat ? ' title="' + _escape(caveat) + '"' : '';
  const pillsHtml = counts.map((n, k) => {
    const lbl = getKaryotypeLabel(state, k, c.K);
    return '<div class="ck-band-pill"' + titleAttr + '>'
      + '<span class="swatch" style="background:' + groupColor(k) + ';"></span>'
      + '<span><b>' + _escape(lbl) + '</b>: <b>' + n + '</b> samples</span>'
      + '</div>';
  }).join('');

  let trackPills = '';
  if (twoTrack) {
    const t0Bands = new Set(c.tracks[0].active_bands);
    const t1Bands = new Set(c.tracks[1].active_bands);
    let t0n = 0, t1n = 0;
    for (let i = 0; i < c.locked_labels.length; i++) {
      const k = c.locked_labels[i];
      if (k < 0) continue;
      if (t0Bands.has(k)) t0n++;
      else if (t1Bands.has(k)) t1n++;
    }
    const t0Primary = groupColor(c.tracks[0].active_bands[0]);
    const t1Primary = groupColor(c.tracks[1].active_bands[0]);
    trackPills =
      '<div class="ck-band-pill" style="border-left: 2px solid ' + t0Primary
        + '; padding-left: 6px;" title="Samples whose K-cluster belongs to track 1\'s active_bands.">'
        + '<span style="font-weight: 700; color: ' + t0Primary
        + '; font-family: var(--mono); font-size: 9.5px;">T1</span>'
        + '<span>track 1: <b>' + t0n + '</b> samples</span></div>'
      + '<div class="ck-band-pill" style="border-left: 2px solid ' + t1Primary
        + '; padding-left: 6px;" title="Samples whose K-cluster belongs to track 2\'s active_bands.">'
        + '<span style="font-weight: 700; color: ' + t1Primary
        + '; font-family: var(--mono); font-size: 9.5px;">T2</span>'
        + '<span>track 2: <b>' + t1n + '</b> samples</span></div>';
  }

  const startMb = Number.isFinite(c.start_bp) ? (c.start_bp / 1e6).toFixed(2) : '?';
  const endMb   = Number.isFinite(c.end_bp)   ? (c.end_bp   / 1e6).toFixed(2) : '?';
  const span_mb = (Number.isFinite(c.start_bp) && Number.isFinite(c.end_bp))
    ? ((c.end_bp - c.start_bp) / 1e6).toFixed(2) : '—';
  const idDisplay = c.id ? String(c.id).replace(/^cand_/, '') : '?';
  const headerHtml =
    '<div class="ck-header">'
    + '<h3>karyotype assignments · ' + _escape(c.chrom || '?') + ' '
    + startMb + '–' + endMb + ' Mb'
    + (twoTrack ? ' <span class="ck-two-track-badge">two-track</span>' : '')
    + '</h3>'
    + '<div class="ck-subtitle">'
    + 'candidate ' + _escape(idDisplay) + ' · K=' + (c.K | 0)
    + ' · ' + span_mb + ' Mb · ' + c.locked_labels.length + ' samples'
    + '</div>'
    + '<div class="ck-summary">' + pillsHtml + trackPills + '</div>'
    + '</div>';

  // Karyo UI state slots (read fresh each render).
  const ui = state.karyoUi || {};
  const filterValue = typeof ui.filter === 'string' ? ui.filter : '';
  const bandFilter  = typeof ui.bandFilter === 'string' ? ui.bandFilter : '';
  const sortKey     = typeof ui.sortKey === 'string' ? ui.sortKey : 'k_label';

  const bandOptions = ['<option value="">all bands</option>']
    .concat(counts.map((_, k) =>
      '<option value="k' + k + '"' + (bandFilter === 'k' + k ? ' selected' : '') + '>'
      + 'band ' + k + '</option>'))
    .join('');
  const toolbarHtml =
    '<div class="ck-toolbar">'
    + '<input type="text" id="ckFilter" placeholder="filter (CGA, family, ancestry...)" '
    + 'value="' + _escape(filterValue) + '" />'
    + '<select id="ckBandFilter">' + bandOptions + '</select>'
    + '<button type="button" id="ckExportTSV" class="export">⬇ export TSV</button>'
    + '<span class="info" id="ckInfo"></span>'
    + '</div>';

  const filtered = filterKaryoRows(rows, ui);
  const sorted   = sortKaryoRows(filtered, ui);

  const cols = twoTrack
    ? [
        { key: 'cga',       label: 'CGA' },
        { key: 'ind',       label: 'Ind' },
        { key: 'k_label',   label: 'Track 1' },
        { key: 'k_label',   label: 'Track 2', _track: 1 },
        { key: 'sigma',     label: 'σ' },
        { key: 'family_id', label: 'Family' },
        { key: 'ancestry',  label: 'Ancestry' },
      ]
    : [
        { key: 'cga',       label: 'CGA' },
        { key: 'ind',       label: 'Ind' },
        { key: 'k_label',   label: 'Band' },
        { key: 'sigma',     label: 'σ' },
        { key: 'family_id', label: 'Family' },
        { key: 'ancestry',  label: 'Ancestry' },
      ];

  let thead = '<thead><tr>';
  for (const col of cols) {
    const isSort = (sortKey === col.key);
    const arrow = isSort ? (ui.sortAsc !== false ? '▲' : '▼') : '↕';
    const cls = isSort ? 'sorted' : '';
    thead += '<th data-key="' + col.key + '" class="' + cls + '">'
      + _escape(col.label)
      + ' <span style="opacity:0.5;font-size:9px;">' + arrow + '</span>'
      + '</th>';
  }
  thead += '</tr></thead>';

  // Sigma threshold: if a sigmaSpread is provided, mark rows whose
  // sigma > 2 × q50 as "high-sigma". When no spread, no threshold.
  let sigmaThr = Infinity;
  if (sigSpread && sigSpread.length > 0) {
    const v = [];
    for (let i = 0; i < sigSpread.length; i++) {
      if (Number.isFinite(sigSpread[i])) v.push(sigSpread[i]);
    }
    if (v.length >= 10) {
      v.sort((a, b) => a - b);
      const q50 = v[Math.min(v.length - 1, Math.floor(v.length * 0.5))];
      sigmaThr = 2 * q50;
    }
  }

  const renderTrackCell = (r, trackIdx) => {
    if (r.track_idx === trackIdx) {
      return '<div class="band-cell" style="justify-content:flex-end;">'
        + '<span class="swatch" style="background:' + groupColor(r.k_label) + ';"></span>'
        + 'g' + r.k_label + '</div>';
    }
    return '<span style="color: var(--ink-dimmer);">—</span>';
  };

  let tbody = '<tbody>';
  for (const r of sorted) {
    const isHigh = Number.isFinite(r.sigma) && r.sigma > sigmaThr;
    const sigmaCell = Number.isFinite(r.sigma) ? r.sigma.toFixed(4) : '—';
    const sigmaClass = isHigh ? 'num high-sigma' : 'num';
    const famLabel = r.family_id === -1 ? '—' : ('F' + r.family_id);
    const ancLabel = r.ancestry || '—';
    if (twoTrack) {
      tbody += '<tr>'
        + '<td>' + _escape(r.cga) + '</td>'
        + '<td>' + _escape(r.ind) + '</td>'
        + '<td class="num">' + renderTrackCell(r, 0) + '</td>'
        + '<td class="num">' + renderTrackCell(r, 1) + '</td>'
        + '<td class="' + sigmaClass + '">' + sigmaCell + (isHigh ? ' ⚠' : '') + '</td>'
        + '<td class="num">' + _escape(famLabel) + '</td>'
        + '<td>' + _escape(ancLabel) + '</td>'
        + '</tr>';
    } else {
      tbody += '<tr>'
        + '<td>' + _escape(r.cga) + '</td>'
        + '<td>' + _escape(r.ind) + '</td>'
        + '<td class="num"><div class="band-cell" style="justify-content:flex-end;">'
        + '<span class="swatch" style="background:' + groupColor(r.k_label) + ';"></span>'
        + r.k_label + '</div></td>'
        + '<td class="' + sigmaClass + '">' + sigmaCell + (isHigh ? ' ⚠' : '') + '</td>'
        + '<td class="num">' + _escape(famLabel) + '</td>'
        + '<td>' + _escape(ancLabel) + '</td>'
        + '</tr>';
    }
  }
  tbody += '</tbody>';

  const tableHtml = '<table class="ck-table">' + thead + tbody + '</table>';

  return headerHtml + toolbarHtml + tableHtml;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

let _filterHandler = null;
let _bandHandler   = null;
let _exportHandler = null;
let _headerHandler = null;

function _canListen(t) {
  return t
    && typeof t.addEventListener === 'function'
    && typeof t.removeEventListener === 'function';
}

function _ensureKaryoUi(state) {
  if (!state) return;
  if (!state.karyoUi || typeof state.karyoUi !== 'object') {
    state.karyoUi = { sortKey: 'k_label', sortAsc: true, filter: '', bandFilter: '' };
  }
}

/**
 * Render + wire the karyotype body. Writes to #candKaryoContent, sets
 * #ckInfo count text, and wires filter/band/sort/export handlers.
 * Idempotent. Headless-tolerant.
 *
 * `opts.onChange(state)` fires after every user mutation (re-render
 * already happens internally).
 * `opts.onExport(filename, content, mime)` fires when the user clicks
 * the export-TSV button; defaults to a Blob/URL download.
 */
export function renderKaryotypeBody(state, opts) {
  if (typeof document === 'undefined') return;
  _ensureKaryoUi(state);
  const content = document.getElementById('candKaryoContent');
  if (!content) return;
  content.innerHTML = renderKaryotypeBodyHtml(state);

  // Update count display + sigma threshold note
  const c = state && state.candidate;
  if (c && Array.isArray(c.locked_labels)) {
    const samples = _samples(state);
    const allRows = buildKaryotypeRows(c, samples, _sigmaSpread(state));
    const filtered = filterKaryoRows(allRows, state.karyoUi);
    const info = document.getElementById('ckInfo');
    if (info) info.textContent = filtered.length + ' of ' + allRows.length + ' samples';
  }

  wireKaryotypeToolbar(state, opts);
}

export function wireKaryotypeToolbar(state, opts) {
  if (typeof document === 'undefined') return;
  teardownKaryotypeToolbar();
  _ensureKaryoUi(state);
  const onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : null;
  const onExport = (opts && typeof opts.onExport === 'function') ? opts.onExport : _defaultExport;

  const filterEl = document.getElementById('ckFilter');
  const bandEl   = document.getElementById('ckBandFilter');
  const expBtn   = document.getElementById('ckExportTSV');
  const content  = document.getElementById('candKaryoContent');

  const refresh = () => {
    renderKaryotypeBody(state, opts);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };

  _filterHandler = (evt) => {
    if (!state || !state.karyoUi) return;
    state.karyoUi.filter = (evt && evt.target && evt.target.value) || '';
    refresh();
  };
  _bandHandler = (evt) => {
    if (!state || !state.karyoUi) return;
    state.karyoUi.bandFilter = (evt && evt.target && evt.target.value) || '';
    refresh();
  };
  _exportHandler = () => {
    if (!state) return;
    const c = state.candidate;
    if (!c) return;
    const samples = _samples(state);
    const sig = _sigmaSpread(state);
    const allRows = buildKaryotypeRows(c, samples, sig);
    const filtered = filterKaryoRows(allRows, state.karyoUi);
    const sorted = sortKaryoRows(filtered, state.karyoUi);
    const tsv = exportKaryotypeTSV(c, sorted);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = 'karyotype_' + (c.id || 'cand') + '_' + stamp + '.tsv';
    try { onExport(name, tsv, 'text/tab-separated-values'); } catch (_) {}
  };
  _headerHandler = (evt) => {
    if (!state || !state.karyoUi || !evt || !evt.target) return;
    let th = evt.target;
    while (th && th !== content) {
      if (th.getAttribute && th.getAttribute('data-key')) break;
      th = th.parentNode;
    }
    if (!th || !th.getAttribute) return;
    const key = th.getAttribute('data-key');
    if (!key) return;
    if (state.karyoUi.sortKey === key) {
      state.karyoUi.sortAsc = !state.karyoUi.sortAsc;
    } else {
      state.karyoUi.sortKey = key;
      state.karyoUi.sortAsc = true;
    }
    refresh();
  };

  if (_canListen(filterEl)) filterEl.addEventListener('input',  _filterHandler);
  if (_canListen(bandEl))   bandEl.addEventListener('change',   _bandHandler);
  if (_canListen(expBtn))   expBtn.addEventListener('click',    _exportHandler);
  if (_canListen(content))  content.addEventListener('click',   _headerHandler);
}

export function teardownKaryotypeToolbar() {
  if (typeof document === 'undefined') return;
  const pairs = [
    ['ckFilter',           'input',  _filterHandler],
    ['ckBandFilter',       'change', _bandHandler],
    ['ckExportTSV',        'click',  _exportHandler],
    ['candKaryoContent',   'click',  _headerHandler],
  ];
  for (const [id, evt, h] of pairs) {
    if (!h) continue;
    const el = document.getElementById(id);
    if (_canListen(el)) el.removeEventListener(evt, h);
  }
  _filterHandler = _bandHandler = _exportHandler = _headerHandler = null;
}

// =====================================================================
// TSV export
// =====================================================================

function _tsvCell(v) {
  if (v == null) return '';
  return String(v).replace(/[\t\r\n]/g, ' ');
}

/**
 * Export the karyotype rows for a candidate as TSV. Header includes
 * the candidate id + chrom + bp range + K; then one row per sample.
 *
 * @param {Object} cand
 * @param {Array<Object>} rows  (filtered + sorted)
 * @returns {string}
 */
export function exportKaryotypeTSV(cand, rows) {
  const lines = [];
  if (cand) {
    lines.push('# candidate: ' + _tsvCell(cand.id || '?'));
    lines.push('# chrom: '     + _tsvCell(cand.chrom || '?')
               + ' ' + (Number.isFinite(cand.start_bp) ? cand.start_bp : '?')
               + '-' + (Number.isFinite(cand.end_bp)   ? cand.end_bp   : '?'));
    lines.push('# K: ' + (Number.isFinite(cand.K) ? cand.K : '?'));
  }
  lines.push(['si', 'cga', 'ind', 'k_label', 'sigma', 'family_id', 'ancestry', 'track_idx'].join('\t'));
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r) continue;
      lines.push([
        r.si,
        _tsvCell(r.cga),
        _tsvCell(r.ind),
        r.k_label,
        Number.isFinite(r.sigma) ? r.sigma.toFixed(6) : '',
        r.family_id,
        _tsvCell(r.ancestry),
        r.track_idx == null ? '' : r.track_idx,
      ].join('\t'));
    }
  }
  return lines.join('\n');
}

function _defaultExport(filename, content, mime) {
  if (typeof document === 'undefined') return;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') return;
  try {
    const blob = new Blob([content], { type: mime || 'text/plain' });
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
