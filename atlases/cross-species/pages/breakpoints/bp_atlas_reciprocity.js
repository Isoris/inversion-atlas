// atlases/cross-species/pages/breakpoints/bp_atlas_reciprocity.js
//
// BP reciprocity page — renders BP3c reciprocity_table.tsv. Both-anchor
// validated zones with confidence tier + backbone_support flag.
// Phase 1a: page stub. Renders empty-state when data missing.

import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import {
  wireSortableHeaders,
  wireRowFilter,
  makeComparator,
  filterRows,
} from '../../shared/sortable_table.js';

const FILTER_FIELDS = ['zone_id', 'event_class', 'confidence_tier', 'backbone_support'];

let _pageState = null;

export async function mount(root, atlasState, registry) {
  resetOnboarding('bp_atlas_reciprocity');
  _pageState = {
    atlasState, registry,
    rows: [],
    filterText: '',
    sort: { field: null, dir: 'asc', type: null },
    _teardowns: [],
  };
  await _loadReciprocity(root, registry);
}

export async function unmount(_root) {
  if (_pageState && Array.isArray(_pageState._teardowns)) {
    for (const t of _pageState._teardowns) { try { t(); } catch (_) {} }
  }
  _pageState = null;
}

export function refresh(_state) {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('bp_atlas_reciprocity');
  if (root) _renderRows(root);
}

async function _loadReciprocity(root, registry) {
  if (!root || typeof document === 'undefined') return;
  const statusEl = root.querySelector('#bpRecStatus');
  if (statusEl) statusEl.textContent = 'loading reciprocity table…';
  let tsv = null;
  if (registry && typeof registry.resolve === 'function') {
    try { tsv = await registry.resolve('cross-species.bp_atlas_reciprocity_v1'); }
    catch (e) { console.warn('bp_atlas_reciprocity: load failed —', e); }
  }
  if (!tsv) {
    _renderEmpty(root);
    return;
  }
  const rows = (typeof tsv === 'string') ? _parseTsv(tsv)
             : (Array.isArray(tsv) ? tsv : []);
  if (_pageState) _pageState.rows = rows;
  if (rows.length === 0) {
    _renderEmpty(root);
    return;
  }
  // Make sure the table wrap is visible when data arrives (covers
  // the case where a previous mount left it hidden).
  const wrap = root.querySelector('#bpRecTableWrap');
  if (wrap) wrap.style.display = '';
  if (statusEl) statusEl.textContent = `${rows.length} zone${rows.length === 1 ? '' : 's'}`;
  _wireTableControls(root);
  _renderRows(root);
}

function _wireTableControls(root) {
  if (!_pageState || _pageState._teardowns.length > 0) return;
  const table = root.querySelector('#bpRecTable');
  const filterInput = root.querySelector('#bpRecFilter');
  if (table) {
    const r = wireSortableHeaders(table, {
      onSort: (field, dir, type) => {
        _pageState.sort = { field, dir, type };
        _renderRows(root);
      },
    });
    _pageState._teardowns.push(r.teardown);
  }
  if (filterInput) {
    const r = wireRowFilter(filterInput, {
      onChange: (text) => {
        _pageState.filterText = text;
        _renderRows(root);
      },
    });
    _pageState._teardowns.push(r.teardown);
  }
}

function _renderEmpty(root) {
  // Hide the table-wrap and let the onboarding panel take its slot.
  const wrap = root.querySelector('#bpRecTableWrap');
  if (wrap) wrap.style.display = 'none';
  applyOnboarding('bp_atlas_reciprocity');
  const statusEl = root.querySelector('#bpRecStatus');
  if (statusEl) statusEl.textContent = 'no data';
  const count = root.querySelector('#bpRecCount');
  if (count) count.textContent = '';
}

function _parseTsv(txt) {
  const lines = txt.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(l => {
    const cells = l.split('\t');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] != null ? cells[i] : ''; });
    return obj;
  });
}

function _renderRows(root) {
  if (!_pageState) return;
  const body = root.querySelector('#bpRecBody');
  if (!body) return;
  // Apply filter + sort each repaint — the row count is small (≤
  // hundreds), so re-sorting in place is cheaper than maintaining a
  // parallel sorted view.
  let view = filterRows(_pageState.rows, _pageState.filterText, FILTER_FIELDS);
  if (_pageState.sort.field) {
    view = view.slice();
    view.sort(makeComparator(_pageState.sort.field, _pageState.sort.dir, _pageState.sort.type));
  }
  body.innerHTML = '';
  for (const r of view) body.appendChild(_renderRow(r));
  // Reflect the filtered-row count next to the header status.
  const count = root.querySelector('#bpRecCount');
  if (count) {
    count.textContent = (view.length === _pageState.rows.length)
      ? ''
      : `${view.length} / ${_pageState.rows.length}`;
  }
}

function _renderRow(r) {
  const tr = document.createElement('tr');
  const bothAnchor = r.both_anchor === 'TRUE' || r.both_anchor === '1';
  const baCell = bothAnchor
    ? '<span style="color: #3cc08a; font-weight: 600;">YES</span>'
    : '<span style="color: var(--ink-dim);">no</span>';
  tr.innerHTML =
    `<td style="font-weight: 600;">${_esc(r.zone_id || r.cluster_id || '—')}</td>` +
    `<td class="cs-bp-num">${_esc(r.anchor_Cgar_pos || r.anchor_a_pos || '—')}</td>` +
    `<td class="cs-bp-num">${_esc(r.anchor_Cmac_pos || r.anchor_b_pos || '—')}</td>` +
    `<td>${_esc(r.event_class || '—')}</td>` +
    `<td>${_esc(r.confidence_tier || r.confidence || '—')}</td>` +
    `<td>${_esc(r.backbone_support || '—')}</td>` +
    `<td>${baCell}</td>`;
  return tr;
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
