// atlases/cross-species/pages/breakpoints/bp_catalogue.js
//
// BP catalogue — tiered headline breakpoint table from the
// gene_order_consolidation workflow's breakpoints_consolidated_v1
// layer. Renders the Tier 1 (cross_method = TRUE) vs Tier 2
// (recurrent single-method, ≥ 3 species) split.
//
// Phase 1a: page stub. When data is absent, renders empty-state with
// a pointer to the producer workflow. When data is present, parses
// the TSV and renders rows with tier-filter buttons.
//
// Per docs/MIGRATION_4_ATLASES.md §1.3 + atlases/cross-species/README.md.

import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import {
  wireSortableHeaders,
  wireRowFilter,
  makeComparator,
  filterRows,
} from '../../shared/sortable_table.js';

const FILTER_FIELDS = ['cluster_id', 'chrom_focal', 'chrom', 'methods_csv',
                       'methods', 'confidence_tier', 'backbone'];

let _pageState = null;

export async function mount(root, atlasState, registry) {
  resetOnboarding('bp_catalogue');
  _pageState = {
    atlasState,
    registry,
    rows: [],
    tierFilter: 'all',     // 'all' | '1' | '2'
    activeClusterId: null,
    filterText: '',
    sort: { field: null, dir: 'asc', type: null },
    _teardowns: [],
  };
  _wireTierBar(root);
  await _loadCatalogue(root, atlasState, registry);
}

export async function unmount(_root) {
  if (_pageState && Array.isArray(_pageState._teardowns)) {
    for (const t of _pageState._teardowns) { try { t(); } catch (_) {} }
  }
  _pageState = null;
}

export function refresh(_state) {
  if (typeof document === 'undefined') return;
  // Caller-driven refresh path: re-paint from cached rows.
  const root = document.getElementById('bp_catalogue');
  if (root) _renderRows(root);
}

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------

async function _loadCatalogue(root, atlasState, registry) {
  if (!root || typeof document === 'undefined') return;
  const statusEl = root.querySelector('#bpCatStatus');
  if (statusEl) statusEl.textContent = 'loading catalogue…';
  let tsv = null;
  if (registry && typeof registry.resolve === 'function') {
    try {
      tsv = await registry.resolve('cross-species.breakpoints_consolidated_v1');
    } catch (e) {
      console.warn('bp_catalogue: failed to load breakpoints_consolidated_v1 —', e);
    }
  }
  if (!tsv) { _renderEmpty(root); return; }
  const rows = (typeof tsv === 'string') ? _parseTsv(tsv)
             : (Array.isArray(tsv) ? tsv : []);
  if (_pageState) _pageState.rows = rows;
  if (rows.length === 0) { _renderEmpty(root); return; }
  const wrap = root.querySelector('#bpCatTableWrap');
  if (wrap) wrap.style.display = '';
  if (statusEl) statusEl.textContent = `loaded ${rows.length} cluster${rows.length === 1 ? '' : 's'}`;
  _wireTableControls(root);
  _renderRows(root);
}

function _wireTableControls(root) {
  if (!_pageState || _pageState._teardowns.length > 0) return;
  const table = root.querySelector('#bpCatTable');
  const filterInput = root.querySelector('#bpCatFilter');
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
  const wrap = root.querySelector('#bpCatTableWrap');
  if (wrap) wrap.style.display = 'none';
  applyOnboarding('bp_catalogue');
  const statusEl = root.querySelector('#bpCatStatus');
  if (statusEl) statusEl.textContent = 'no data';
  const count = root.querySelector('#bpCatCount');
  if (count) count.textContent = '';
}

// Minimal TSV → array-of-objects parser. Header row required.
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

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function _renderRows(root) {
  if (!_pageState) return;
  const body = root.querySelector('#bpCatBody');
  const count = root.querySelector('#bpCatCount');
  if (!body) return;
  body.innerHTML = '';
  // Tier-bar filter (Tier 1 / Tier 2 / all) composes with the text
  // filter from the header search input.
  let view = _pageState.rows.filter(_passesTierFilter);
  view = filterRows(view, _pageState.filterText, FILTER_FIELDS);
  if (_pageState.sort.field) {
    view = view.slice();
    view.sort(makeComparator(_pageState.sort.field, _pageState.sort.dir, _pageState.sort.type));
  }
  const filtered = view;
  for (const r of filtered) {
    body.appendChild(_renderRow(r));
  }
  if (count) {
    const n = filtered.length;
    const total = _pageState.rows.length;
    count.textContent = (n === total) ? `${n}` : `${n} of ${total}`;
  }
}

function _passesTierFilter(r) {
  if (!_pageState) return true;
  const f = _pageState.tierFilter || 'all';
  if (f === 'all') return true;
  const isTier1 = (r.cross_method === 'TRUE' || r.cross_method_flag === 'TRUE'
                || r.cross_method === '1'    || r.cross_method_flag === '1');
  if (f === '1') return isTier1;
  if (f === '2') return !isTier1;
  return true;
}

function _renderRow(r) {
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--rule)';
  tr.style.cursor = 'pointer';
  const isTier1 = (r.cross_method === 'TRUE' || r.cross_method_flag === 'TRUE'
                || r.cross_method === '1'    || r.cross_method_flag === '1');
  const xmCell = isTier1
    ? '<span style="color: #5fb3ff; font-weight: 600;">YES (Tier 1)</span>'
    : '<span style="color: var(--ink-dim);">no (Tier 2)</span>';
  const fmt = (v) => Number.isFinite(+v) ? (+v).toFixed(2) : (v || '—');
  tr.innerHTML =
    `<td style="padding: 3px 6px; font-weight: 600;">${_esc(r.cluster_id || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.chrom_focal || r.chrom || '—')}</td>` +
    `<td style="padding: 3px 6px; text-align: right;">${fmt((+r.start_bp_focal || +r.start_bp) / 1e6)}</td>` +
    `<td style="padding: 3px 6px; text-align: right;">${fmt((+r.end_bp_focal   || +r.end_bp)   / 1e6)}</td>` +
    `<td style="padding: 3px 6px; text-align: right;">${_esc(r.n_methods || '—')}</td>` +
    `<td style="padding: 3px 6px; color: var(--ink-dim);">${_esc(r.methods_csv || r.methods || '—')}</td>` +
    `<td style="padding: 3px 6px; text-align: right;">${_esc(r.n_species || '—')}</td>` +
    `<td style="padding: 3px 6px;">${xmCell}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.confidence_tier || r.confidence || '—')}</td>` +
    `<td style="padding: 3px 6px;">${_esc(r.backbone_support || '—')}</td>` +
    `<td style="padding: 3px 6px; text-align: right;">${_esc(r.tolerance_kb_stable_at || '—')}</td>`;
  tr.addEventListener('click', () => {
    if (_pageState) _pageState.activeClusterId = r.cluster_id;
    if (_pageState && _pageState.atlasState && _pageState.atlasState.shared) {
      _pageState.atlasState.shared.crossSpecies = _pageState.atlasState.shared.crossSpecies || {};
      _pageState.atlasState.shared.crossSpecies.activeBreakpointId = r.cluster_id;
    }
  });
  return tr;
}

// ---------------------------------------------------------------------------
// Tier toggle
// ---------------------------------------------------------------------------

function _wireTierBar(root) {
  if (typeof document === 'undefined' || !root) return;
  const bar = root.querySelector('#bpCatTierBar');
  if (!bar) return;
  bar.querySelectorAll('button[data-bpc-tier]').forEach(b => {
    b.addEventListener('click', () => {
      if (_pageState) _pageState.tierFilter = b.dataset.bpcTier;
      bar.querySelectorAll('button[data-bpc-tier]').forEach(b2 => {
        b2.classList.toggle('active', b2 === b);
      });
      _renderRows(root);
    });
  });
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
