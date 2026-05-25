// inversion_catalogue/overview.js
// =====================================================================
// Page "Overview" — synthesis-stage landing surface.
//
// Two tiles:
//   1. Layer inventory    — workspace action-pipeline registry contents.
//                           Queries GET /api/layers (atlas-core envelope
//                           index) and groups by layer_type. Answers
//                           "what data has been captured in this
//                           workspace?". Fail-soft when the server is
//                           offline or no workspace-root is configured.
//
//   2. Candidate spreadsheet — sortable + filterable table of inversion
//                           candidates from state.candidateList.
//                           Manuscript-bound output: TSV export.
//                           Columns: id, chrom, region (bp), length,
//                           verdict, status (provisional / confirmed),
//                           locked_labels, source, promoted_at.
//                           Two filters: status (all / provisional /
//                           confirmed) + chrom (auto-populated from the
//                           data). Click a column header to sort; click
//                           again to reverse.
//
// History:
//   - Legacy single-file declared `<div id="overview">` (Inversion_atlas.html
//     line 9322) and a tab button at line 5138 but never shipped a render
//     function. Comments at line 5021 + 5134 of the monolith described
//     two intended features: "candidate overview spreadsheet" + an
//     action-pipeline inventory.
//   - Round 5 step 8 (chat 36, 2026-05-07): added the atlas-router
//     lifecycle (mount / unmount / _pageState live-binding). Factory
//     entry wirePageOverview(state) RETAINED for backward-compat.
//   - Round 1 2026-05-14: shipped the layer-inventory tile.
//   - 2026-05-23: shipped the candidate-spreadsheet tile (this turn) —
//     completes the second feature the legacy comments hinted at. Both
//     tiles co-exist on one page; the spreadsheet reads from the live
//     state.candidateList rather than a registry layer, so it works
//     today without waiting for inversion.candidates_v1 to land on disk.
// =====================================================================

import { _pageState, _setActiveState } from './overview/_state.js';
import { listLayers } from '../../shared/atlas_server.js';

/**
 * Internal: render the synthesis overview using _pageState.
 *
 * Round-1 implementation (2026-05-14): the legacy "layer-presence
 * checklist" — answers "what action-pipeline data has been captured in
 * this workspace?" Asynchronously fetches GET /api/layers (atlas-core's
 * envelope index), groups by layer_type, and renders a compact table
 * inside #invLayerInventory.
 *
 * The HTML container shows "Querying …" until the probe resolves; on
 * error (server offline, 5xx, etc.) it shows a fail-soft message but
 * leaves the page navigable.
 */
function _renderPageOverview() {
  // Fire-and-forget — the page is rendered synchronously by the router;
  // the inventory populates as soon as the index loads.
  _populateLayerInventory()
    .catch((e) => console.warn('overview: _populateLayerInventory threw —', e));
  // Candidate spreadsheet renders synchronously from _pageState.candidateList.
  try { _populateCandidateSpreadsheet(); }
  catch (e) { console.warn('overview: _populateCandidateSpreadsheet threw —', e); }
}

// ---------------------------------------------------------------------------
// Layer-inventory rendering (envelope-aware, fail-soft).
// ---------------------------------------------------------------------------
// listLayers() returns the inversion-atlas fail-soft shape
//   { ok, status, json?: { layers, n, total }, text?, error? }
// (see shared/atlas_server.js for the convention — different from the
// throwing-pattern used in the four other atlases). The renderer
// branches on .ok and surfaces .error in the empty-state message.

async function _populateLayerInventory() {
  const slot = (typeof document !== 'undefined')
    ? document.getElementById('invLayerInventory') : null;
  if (!slot) return;   // overview HTML hasn't loaded

  let resp;
  try {
    // No filter — we want the whole index so we can group by layer_type.
    // limit=500 is the server-side default; bump if you have a workspace
    // with more registered envelopes.
    resp = await listLayers({ limit: 500 });
  } catch (e) {
    slot.innerHTML =
      `<span style="color: #b00;">Failed to query /api/layers: ${_escape(String(e))}</span>`;
    return;
  }

  if (!resp.ok) {
    if (resp.status === 503) {
      slot.innerHTML =
        '<span class="ov-hint">' +
        'Action pipeline subsystem not configured (no workspace root). ' +
        'Start atlas_server.py with <code>--workspace-root</code> to enable.</span>';
    } else {
      slot.innerHTML =
        `<span class="ov-error">/api/layers returned HTTP ${resp.status}: ` +
        `${_escape((resp.error || '').slice(0, 200))}</span>`;
    }
    return;
  }

  const rows = (resp.json && resp.json.layers) || [];
  const total = (resp.json && resp.json.total) || rows.length;
  if (rows.length === 0) {
    slot.innerHTML =
      '<span class="ov-hint">' +
      '◌  No layer envelopes captured yet. Submit an action via ' +
      '<code>POST /api/actions</code> or <code>scripts/atlas_action.py</code> ' +
      'to populate the inventory.</span>';
    return;
  }

  // Group rows by layer_type; remember the most-recent row per group.
  const groups = new Map();   // layer_type → { count, latest_row }
  for (const r of rows) {
    const t = r.layer_type || '(no type)';
    const g = groups.get(t) || { count: 0, latest: null };
    g.count += 1;
    if (!g.latest || (r.created_at || '') > (g.latest.created_at || '')) {
      g.latest = r;
    }
    groups.set(t, g);
  }

  const sortedTypes = Array.from(groups.keys()).sort();
  let html =
    `<div class="ov-summary">` +
    `<b>${total}</b> envelope${total === 1 ? '' : 's'} across ` +
    `<b>${sortedTypes.length}</b> layer type${sortedTypes.length === 1 ? '' : 's'}.` +
    `</div>` +
    `<table class="ov-table">` +
    `<thead><tr>` +
    `<th>layer_type</th>` +
    `<th class="ov-right">count</th>` +
    `<th>latest</th>` +
    `<th>created</th>` +
    `</tr></thead><tbody>`;
  for (const t of sortedTypes) {
    const g = groups.get(t);
    html +=
      `<tr>` +
      `<td><code>${_escape(t)}</code></td>` +
      `<td class="ov-right">${g.count}</td>` +
      `<td><code>${_escape(g.latest.layer_id || '')}</code></td>` +
      `<td class="ov-dim">${_escape(g.latest.created_at || '')}</td>` +
      `</tr>`;
  }
  html += `</tbody></table>`;
  slot.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Candidate spreadsheet (manuscript-bound: sortable + filterable + TSV export).
// ---------------------------------------------------------------------------
// Reads _pageState.candidateList (mirrored from atlasState.inversion via
// _buildLegacyState in mount()). Each candidate carries the shape promoted
// by catalogue.js::promoteRowsToCandidates:
//   { id, chrom, start_bp, end_bp, K, verdict, source, provisional,
//     confirmed, promoted_from, promoted_at, locked_labels[] }

const _sortState = { col: 'chrom', dir: 1 };  // 1 = asc, -1 = desc

function _populateCandidateSpreadsheet() {
  if (typeof document === 'undefined') return;
  const slot = document.getElementById('invCandidateSpreadsheet');
  if (!slot) return;

  const list = Array.isArray(_pageState && _pageState.candidateList)
    ? _pageState.candidateList
    : [];

  // Populate the chrom filter dropdown (idempotent — only adds new chroms).
  const chromSel = document.getElementById('ovChromFilter');
  if (chromSel) {
    const have = new Set(Array.from(chromSel.options).map(o => o.value));
    const chroms = new Set();
    for (const c of list) { if (c && c.chrom) chroms.add(c.chrom); }
    for (const ch of Array.from(chroms).sort()) {
      if (have.has(ch)) continue;
      const opt = document.createElement('option');
      opt.value = ch;
      opt.textContent = ch;
      chromSel.appendChild(opt);
    }
  }

  _ensureCandidateControlsBound();
  _renderCandidateTable(list, slot);
}

function _ensureCandidateControlsBound() {
  if (typeof document === 'undefined') return;
  if (_ensureCandidateControlsBound._bound) return;
  const statusSel = document.getElementById('ovStatusFilter');
  const chromSel  = document.getElementById('ovChromFilter');
  const exportBtn = document.getElementById('ovTsvExport');
  if (!statusSel && !chromSel && !exportBtn) return;  // controls not in DOM yet

  if (statusSel) statusSel.addEventListener('change', _refreshCandidateTable);
  if (chromSel)  chromSel.addEventListener('change',  _refreshCandidateTable);
  if (exportBtn) exportBtn.addEventListener('click',  _exportCandidatesTsv);
  _ensureCandidateControlsBound._bound = true;
}

function _refreshCandidateTable() {
  const slot = document.getElementById('invCandidateSpreadsheet');
  if (!slot) return;
  const list = Array.isArray(_pageState && _pageState.candidateList)
    ? _pageState.candidateList
    : [];
  _renderCandidateTable(list, slot);
}

function _filteredCandidates(list) {
  const statusSel = (typeof document !== 'undefined')
    ? document.getElementById('ovStatusFilter') : null;
  const chromSel  = (typeof document !== 'undefined')
    ? document.getElementById('ovChromFilter')  : null;
  const status = statusSel ? statusSel.value : 'all';
  const chrom  = chromSel  ? chromSel.value  : '';

  return list.filter(c => {
    if (!c) return false;
    if (chrom && c.chrom !== chrom) return false;
    if (status === 'confirmed'   && c.confirmed   !== true) return false;
    if (status === 'provisional' && c.provisional !== true) return false;
    return true;
  });
}

function _sortCandidates(rows) {
  const { col, dir } = _sortState;
  const cmp = (a, b) => {
    let av = a[col];
    let bv = b[col];
    // length is derived
    if (col === 'length') {
      av = (a.end_bp != null && a.start_bp != null) ? (a.end_bp - a.start_bp) : null;
      bv = (b.end_bp != null && b.start_bp != null) ? (b.end_bp - b.start_bp) : null;
    }
    // status pseudo-column
    if (col === 'status') {
      av = a.confirmed ? 2 : (a.provisional ? 1 : 0);
      bv = b.confirmed ? 2 : (b.provisional ? 1 : 0);
    }
    if (av == null && bv == null) return 0;
    if (av == null) return  1;   // nulls sort to the bottom regardless of dir
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  };
  return rows.slice().sort(cmp);
}

function _renderCandidateTable(allRows, slot) {
  const summary = (typeof document !== 'undefined')
    ? document.getElementById('ovCandSummary') : null;

  if (allRows.length === 0) {
    slot.innerHTML =
      '<span class="ov-hint">' +
      'No candidates yet. Promote one from the catalogue page or from a ' +
      'diagnostic page (local PCA, haplotype regimes) to populate this table.' +
      '</span>';
    if (summary) summary.textContent = '';
    return;
  }

  const filtered = _filteredCandidates(allRows);
  const sorted = _sortCandidates(filtered);

  if (summary) {
    const nConf = filtered.filter(c => c.confirmed === true).length;
    const nProv = filtered.filter(c => c.provisional === true && !c.confirmed).length;
    summary.textContent =
      `${sorted.length} shown (of ${allRows.length}) — ${nConf} confirmed, ${nProv} provisional`;
  }

  const cols = [
    { key: 'id',            label: 'id' },
    { key: 'chrom',         label: 'chrom' },
    { key: 'start_bp',      label: 'start' },
    { key: 'end_bp',        label: 'end' },
    { key: 'length',        label: 'length' },
    { key: 'verdict',       label: 'verdict' },
    { key: 'status',        label: 'status' },
    { key: 'locked_labels', label: 'locked_labels' },
    { key: 'source',        label: 'source' },
    { key: 'promoted_at',   label: 'promoted_at' },
  ];

  let html = '<table class="ov-table ov-table-cand"><thead><tr>';
  for (const c of cols) {
    const isActive = c.key === _sortState.col;
    const arrow = isActive ? (_sortState.dir === 1 ? ' ▲' : ' ▼') : '';
    html += `<th data-sort="${c.key}" class="ov-sortable${isActive ? ' ov-active' : ''}">` +
            _escape(c.label) + arrow + '</th>';
  }
  html += '</tr></thead><tbody>';

  for (const r of sorted) {
    const len = (r.end_bp != null && r.start_bp != null)
      ? (r.end_bp - r.start_bp) : null;
    const status = r.confirmed ? 'confirmed' : (r.provisional ? 'provisional' : '');
    const statusClass = r.confirmed ? 'ov-conf' : (r.provisional ? 'ov-prov' : '');
    const labels = Array.isArray(r.locked_labels) ? r.locked_labels.join(', ') : '';
    html += '<tr>' +
      `<td><code>${_escape(r.id || '')}</code></td>` +
      `<td>${_escape(r.chrom || '')}</td>` +
      `<td class="ov-right">${r.start_bp != null ? r.start_bp.toLocaleString() : ''}</td>` +
      `<td class="ov-right">${r.end_bp   != null ? r.end_bp.toLocaleString()   : ''}</td>` +
      `<td class="ov-right">${len != null ? len.toLocaleString() : ''}</td>` +
      `<td>${_escape(r.verdict || '')}</td>` +
      `<td class="${statusClass}">${status}</td>` +
      `<td>${_escape(labels)}</td>` +
      `<td class="ov-dim">${_escape(r.source || '')}</td>` +
      `<td class="ov-dim">${_escape((r.promoted_at || '').slice(0, 10))}</td>` +
      '</tr>';
  }
  html += '</tbody></table>';
  slot.innerHTML = html;

  // Bind sortable headers (re-attach on every render — innerHTML clears them).
  const headers = slot.querySelectorAll('th.ov-sortable');
  headers.forEach(h => {
    h.addEventListener('click', () => {
      const k = h.getAttribute('data-sort');
      if (_sortState.col === k) _sortState.dir *= -1;
      else { _sortState.col = k; _sortState.dir = 1; }
      _refreshCandidateTable();
    });
  });
}

function _exportCandidatesTsv() {
  if (typeof document === 'undefined') return;
  const list = Array.isArray(_pageState && _pageState.candidateList)
    ? _pageState.candidateList
    : [];
  const filtered = _filteredCandidates(list);
  const sorted = _sortCandidates(filtered);

  const cols = ['id','chrom','start_bp','end_bp','length','verdict',
                'status','locked_labels','source','promoted_at'];
  const lines = [cols.join('\t')];
  for (const r of sorted) {
    const len = (r.end_bp != null && r.start_bp != null)
      ? (r.end_bp - r.start_bp) : '';
    const status = r.confirmed ? 'confirmed' : (r.provisional ? 'provisional' : '');
    const labels = Array.isArray(r.locked_labels) ? r.locked_labels.join('|') : '';
    lines.push([
      r.id || '',
      r.chrom || '',
      r.start_bp != null ? r.start_bp : '',
      r.end_bp   != null ? r.end_bp   : '',
      len,
      r.verdict || '',
      status,
      labels,
      r.source || '',
      r.promoted_at || '',
    ].map(v => String(v).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
  }

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inversion_candidates_${new Date().toISOString().slice(0, 10)}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Public entry — state-aware wrapper. Sets _pageState before delegating
 * so the (currently-empty) renderer sees live data.
 */
export function renderPageOverview(state) {
  if (state) _setActiveState(state);
  return _renderPageOverview();
}

/**
 * Backward-compat factory (legacy chat-33 surface). Retained so anything
 * importing `wirePageOverview` keeps working. The returned closure
 * shares state with the module-level _pageState via _setActiveState,
 * so the new lifecycle and the old factory both see the same data.
 */
export function wirePageOverview(state) {
  if (state) _setActiveState(state);
  return { renderPageOverview: _renderPageOverview };
}

export default wirePageOverview;

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 36 round 5 step 8, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to overview.
 *
 * Builds a legacy-shape state (currently a passthrough — overview
 * declares no requires_layers / requires_slots in pages.registry.json,
 * so there's nothing chrom-specific to wire). The mount is structured
 * the same as sibling pages so the future overview implementation can
 * read from atlasState.inversion + atlasState.shared without a
 * separate refactor.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { renderPageOverview(legacyState); }
  catch (e) { console.warn('overview.mount: renderPageOverview threw —', e); }

  if (atlasState.inversion) atlasState.inversion._pageOverviewState = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  // Pass-through: overview reads no specific state slots in the
  // current empty-stub implementation. When the real overview lands,
  // it'll likely want candidateList + layersPresent + ancestry-related
  // slots — those flow through Object.assign({}, inv) below.
  return Object.assign({}, inv);
}
