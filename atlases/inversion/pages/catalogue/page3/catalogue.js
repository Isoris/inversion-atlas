// pages/catalogue/page3/catalogue.js
//
// Catalogue rendering pipeline — the implementation legacy referenced
// but never shipped. Every legacy call site uses
// `typeof renderCatalogue === 'function'` guards meaning the original
// build expected an external script to install window.renderCatalogue;
// no JS file in the legacy drop does so (chat-33 / round-5-step-3 audit).
//
// Cartridge ships a first-pass implementation covering the core
// catalogue surface:
//   - Sortable columns (id, chr, span, K, verdict, n_windows, n_samples,
//     parent_l1, silhouette, coherence)
//   - Free-text filter (id, chr, verdict, parent_l1)
//   - Verdict filter (dropdown)
//   - View modes: l2_raw (default), fav (favorites only)
//   - Display modes: simple (subset of columns), detailed (all)
//   - Per-row selection (checkbox) + select-all / clear
//   - Per-row favorite toggle (star)
//   - Exports: TSV, Markdown, JSON
//
// State slots:
//   state.catalogueRows      : Array<Object>  — L2-envelope rows
//   state.catFavorites       : Set<string>    — favorited ids
//   state.catSelection       : Set<string>    — selected ids
//   state.catFilter          : string         — free-text
//   state.catVerdictFilter   : string         — '' | verdict-value
//   state.catViewMode        : 'l2_raw' | 'fav'
//   state.catDispMode        : 'simple' | 'detailed'
//   state.catSortKey         : string         — column key
//   state.catSortDir         : 'asc' | 'desc'
//
// Row shape (from L2-envelope data):
//   { id, chr, parent_l1?, start_bp?, end_bp?, K?, verdict?,
//     n_windows?, n_samples?, silhouette?, coherence?, fam_purity?,
//     cluster_ok? }
//
// Public entries:
//   CAT_COLUMNS                          : column catalogue + display props
//   CAT_VIEW_MODES                       : view-mode vocabulary
//   buildCatalogueRows(state)            : normalise/clone the input rows
//   filterCatalogueRows(rows, state)     : apply filter + verdict + view
//   sortCatalogueRows(rows, key, dir)    : column sort with stable tiebreaker
//   visibleColumns(disp)                 : columns rendered in the given mode
//   renderCatHeaderHtml(disp, sortKey, dir)
//                                        : the <th>'s for #catHead
//   renderCatBodyHtml(rows, disp, selection, favorites)
//                                        : the <tr>'s for #catBody
//   renderCatalogue(state)               : DOM orchestrator
//   exportCatalogueTSV(rows, disp)       : TSV string
//   exportCatalogueMarkdown(rows, disp)  : Markdown string
//   exportCatalogueJSON(rows, disp, meta): JSON-stringified bundle
//   wireCatalogueToolbar(state, opts)    : wire filter/sort/select/etc
//   teardownCatalogueToolbar()           : remove handlers

// =====================================================================
// Column catalogue
// =====================================================================

/** Sortable catalogue columns. Each row provides: key (sort attr),
 *  label (rendered <th>), kind (formatting: 'string' | 'int' | 'bp' |
 *  'mb' | 'float2' | 'float3' | 'bool'), simple (visible in 'simple'
 *  disp mode), align ('left' | 'right' | 'center').
 */
export const CAT_COLUMNS = Object.freeze([
  Object.freeze({ key: 'star',       label: '★', kind: 'star',   simple: true,  align: 'center' }),
  Object.freeze({ key: 'sel',        label: '',  kind: 'sel',    simple: true,  align: 'center' }),
  Object.freeze({ key: 'id',         label: 'id',         kind: 'string', simple: true,  align: 'left'  }),
  Object.freeze({ key: 'chr',        label: 'chr',        kind: 'string', simple: true,  align: 'left'  }),
  Object.freeze({ key: 'parent_l1',  label: 'parent L1',  kind: 'string', simple: false, align: 'left'  }),
  Object.freeze({ key: 'start_bp',   label: 'start',      kind: 'bp',     simple: true,  align: 'right' }),
  Object.freeze({ key: 'end_bp',     label: 'end',        kind: 'bp',     simple: true,  align: 'right' }),
  Object.freeze({ key: 'span_kb',    label: 'span kb',    kind: 'float2', simple: true,  align: 'right' }),
  Object.freeze({ key: 'K',          label: 'K',          kind: 'int',    simple: true,  align: 'right' }),
  Object.freeze({ key: 'verdict',    label: 'verdict',    kind: 'string', simple: true,  align: 'left'  }),
  Object.freeze({ key: 'n_windows',  label: 'n windows',  kind: 'int',    simple: false, align: 'right' }),
  Object.freeze({ key: 'n_samples',  label: 'n samples',  kind: 'int',    simple: true,  align: 'right' }),
  Object.freeze({ key: 'silhouette', label: 'silhouette', kind: 'float3', simple: false, align: 'right' }),
  Object.freeze({ key: 'coherence',  label: 'coherence',  kind: 'float3', simple: false, align: 'right' }),
  Object.freeze({ key: 'fam_purity', label: 'fam purity', kind: 'float2', simple: false, align: 'right' }),
  Object.freeze({ key: 'cluster_ok', label: 'cluster ok', kind: 'bool',   simple: false, align: 'center' }),
]);

const _COL_BY_KEY = (() => {
  const m = new Map();
  for (const c of CAT_COLUMNS) m.set(c.key, c);
  return m;
})();

/** View-mode vocabulary. l1_merged and l3 are reserved for future
 *  rounds; the catalogue silently falls back to l2_raw for now. */
export const CAT_VIEW_MODES = Object.freeze(['l2_raw', 'fav', 'l1_merged', 'l3']);

// =====================================================================
// Row builder
// =====================================================================

/**
 * Normalise / clone the input rows so the renderer never mutates the
 * upstream state.catalogueRows. Derives span_kb and coerces nullable
 * numeric fields.
 *
 * @param {Object} state
 * @returns {Array<Object>}
 */
export function buildCatalogueRows(state) {
  if (!state || !Array.isArray(state.catalogueRows)) return [];
  const out = [];
  for (const r of state.catalogueRows) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) continue;
    const span_bp = (Number.isFinite(r.start_bp) && Number.isFinite(r.end_bp))
      ? Math.max(0, r.end_bp - r.start_bp) : null;
    out.push({
      id:         r.id,
      chr:        typeof r.chr === 'string' ? r.chr : '',
      parent_l1:  typeof r.parent_l1 === 'string' ? r.parent_l1 : '',
      start_bp:   Number.isFinite(r.start_bp) ? r.start_bp : null,
      end_bp:     Number.isFinite(r.end_bp)   ? r.end_bp   : null,
      span_kb:    span_bp != null ? span_bp / 1000 : null,
      K:          Number.isFinite(r.K) ? r.K : null,
      verdict:    typeof r.verdict === 'string' ? r.verdict : '',
      n_windows:  Number.isFinite(r.n_windows) ? r.n_windows : null,
      n_samples:  Number.isFinite(r.n_samples) ? r.n_samples : null,
      silhouette: Number.isFinite(r.silhouette) ? r.silhouette : null,
      coherence:  Number.isFinite(r.coherence)  ? r.coherence  : null,
      fam_purity: Number.isFinite(r.fam_purity) ? r.fam_purity : null,
      cluster_ok: typeof r.cluster_ok === 'boolean' ? r.cluster_ok : null,
    });
  }
  return out;
}

// =====================================================================
// Filter
// =====================================================================

/**
 * Apply free-text filter + verdict filter + view-mode filter. Returns
 * a new array.
 */
export function filterCatalogueRows(rows, state) {
  if (!Array.isArray(rows)) return [];
  const filter = (state && typeof state.catFilter === 'string')
    ? state.catFilter.trim().toLowerCase() : '';
  const verdict = (state && typeof state.catVerdictFilter === 'string')
    ? state.catVerdictFilter : '';
  const viewMode = (state && typeof state.catViewMode === 'string')
    ? state.catViewMode : 'l2_raw';
  const favs = (state && state.catFavorites instanceof Set)
    ? state.catFavorites : null;

  const out = [];
  for (const r of rows) {
    if (!r) continue;
    if (viewMode === 'fav') {
      if (!favs || !favs.has(r.id)) continue;
    }
    if (verdict && r.verdict !== verdict) continue;
    if (filter) {
      const hay = [r.id, r.chr, r.verdict, r.parent_l1]
        .map(s => (s == null ? '' : String(s).toLowerCase()))
        .join('\t');
      if (!hay.includes(filter)) continue;
    }
    out.push(r);
  }
  return out;
}

// =====================================================================
// Sort
// =====================================================================

function _cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a === b) ? 0 : (a ? 1 : -1);
  }
  const sa = String(a), sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/**
 * Stable sort by column key with null-last regardless of direction.
 * Tiebreaker: id (ascending).
 */
export function sortCatalogueRows(rows, key, dir) {
  if (!Array.isArray(rows)) return [];
  const out = rows.slice();
  const col = _COL_BY_KEY.get(key);
  const k = col ? col.key : 'id';
  const sign = dir === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[k], bv = b[k];
    const aNil = (av == null || av === '');
    const bNil = (bv == null || bv === '');
    if (aNil && bNil) return _cmp(a.id || '', b.id || '');
    if (aNil) return 1;
    if (bNil) return -1;
    const c = _cmp(av, bv);
    if (c !== 0) return c * sign;
    return _cmp(a.id || '', b.id || '');
  });
  return out;
}

// =====================================================================
// HTML
// =====================================================================

function _escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _formatCell(value, kind) {
  if (value == null) return '—';
  switch (kind) {
    case 'int':    return Number.isFinite(value) ? String(Math.round(value)) : '—';
    case 'bp':     return Number.isFinite(value) ? String(value) : '—';
    case 'mb':     return Number.isFinite(value) ? (value / 1e6).toFixed(2) : '—';
    case 'float2': return Number.isFinite(value) ? value.toFixed(2) : '—';
    case 'float3': return Number.isFinite(value) ? value.toFixed(3) : '—';
    case 'bool':   return value === true ? '✓' : value === false ? '✗' : '—';
    default:       return _escape(value);
  }
}

/**
 * Return the visible columns in the given display mode. 'simple'
 * drops the columns marked simple:false; 'detailed' keeps them all.
 */
export function visibleColumns(disp) {
  if (disp === 'simple') {
    return CAT_COLUMNS.filter(c => c.simple);
  }
  return CAT_COLUMNS.slice();
}

/**
 * Build the <th> contents for #catHead.
 */
export function renderCatHeaderHtml(disp, sortKey, sortDir) {
  const cols = visibleColumns(disp);
  const out = [];
  for (const col of cols) {
    if (col.kind === 'star' || col.kind === 'sel') {
      out.push('<th style="text-align: center;">' + _escape(col.label) + '</th>');
      continue;
    }
    const isSort = (col.key === sortKey);
    const cls = isSort
      ? ('sortable ' + (sortDir === 'desc' ? 'sort-desc' : 'sort-asc'))
      : 'sortable';
    const arrow = isSort ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
    out.push(
      '<th class="' + cls + '" data-sort="' + col.key + '" ' +
      'style="text-align: ' + col.align + '; cursor: pointer; user-select: none;">' +
      _escape(col.label) + arrow + '</th>'
    );
  }
  return out.join('');
}

/**
 * Build the <tr> contents for #catBody.
 */
export function renderCatBodyHtml(rows, disp, selection, favorites) {
  if (!Array.isArray(rows) || rows.length === 0) {
    const cols = visibleColumns(disp);
    return '<tr><td colspan="' + cols.length + '" '
         + 'style="padding: 18px; text-align: center; color: var(--ink-dim);">'
         + 'No rows match the current filter.</td></tr>';
  }
  const cols = visibleColumns(disp);
  const sel = (selection instanceof Set) ? selection : new Set();
  const favs = (favorites instanceof Set) ? favorites : new Set();
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const selected = sel.has(r.id);
    out.push('<tr data-id="' + _escape(r.id) + '"' + (selected ? ' class="selected"' : '') + '>');
    for (const col of cols) {
      if (col.kind === 'star') {
        const on = favs.has(r.id);
        out.push(
          '<td style="text-align: center;">' +
          '<button type="button" class="cat-star" data-star="' + _escape(r.id) + '" ' +
          'style="background: none; border: 0; cursor: pointer; ' +
          'color: ' + (on ? '#f5a524' : 'var(--ink-dimmer)') + ';">' +
          (on ? '★' : '☆') + '</button></td>'
        );
        continue;
      }
      if (col.kind === 'sel') {
        out.push(
          '<td style="text-align: center;">' +
          '<input type="checkbox" class="cat-sel" data-sel="' + _escape(r.id) + '"' +
          (selected ? ' checked' : '') + '></td>'
        );
        continue;
      }
      const raw = r[col.key];
      const formatted = _formatCell(raw, col.kind);
      out.push(
        '<td style="text-align: ' + col.align + ';">' +
        (col.kind === 'string' ? _escape(formatted) : formatted) +
        '</td>'
      );
    }
    out.push('</tr>');
  }
  return out.join('');
}

// =====================================================================
// Exports
// =====================================================================

function _exportColumns(disp) {
  // Exports skip the star + checkbox columns (UI-only).
  return visibleColumns(disp).filter(c => c.kind !== 'star' && c.kind !== 'sel');
}

function _exportValue(value, kind) {
  if (value == null) return '';
  switch (kind) {
    case 'int':    return Number.isFinite(value) ? String(Math.round(value)) : '';
    case 'bp':     return Number.isFinite(value) ? String(value) : '';
    case 'mb':     return Number.isFinite(value) ? (value / 1e6).toFixed(4) : '';
    case 'float2': return Number.isFinite(value) ? value.toFixed(2) : '';
    case 'float3': return Number.isFinite(value) ? value.toFixed(3) : '';
    case 'bool':   return value === true ? 'true' : value === false ? 'false' : '';
    default:       return String(value);
  }
}

function _tsvCell(v) {
  if (v == null) return '';
  // TSV: strip tab + newline (matches the legacy export hygiene rule).
  return String(v).replace(/[\t\r\n]/g, ' ');
}

/** TSV export — tab-separated, one header row, one row per filtered row. */
export function exportCatalogueTSV(rows, disp) {
  const cols = _exportColumns(disp);
  const out = [cols.map(c => c.key).join('\t')];
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r) continue;
      const cells = cols.map(c => _tsvCell(_exportValue(r[c.key], c.kind)));
      out.push(cells.join('\t'));
    }
  }
  return out.join('\n');
}

function _mdCell(v) {
  if (v == null) return '';
  return String(v).replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
}

/** Markdown export — pipe-table; safe escaping for `|` and newlines. */
export function exportCatalogueMarkdown(rows, disp) {
  const cols = _exportColumns(disp);
  const head = '| ' + cols.map(c => _mdCell(c.label)).join(' | ') + ' |';
  const sep  = '| ' + cols.map(c => '---').join(' | ') + ' |';
  const out = [head, sep];
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r) continue;
      const cells = cols.map(c => _mdCell(_exportValue(r[c.key], c.kind)));
      out.push('| ' + cells.join(' | ') + ' |');
    }
  }
  return out.join('\n');
}

/** JSON export — round-trippable bundle with metadata. */
export function exportCatalogueJSON(rows, disp, meta) {
  const cols = _exportColumns(disp);
  const colKeys = cols.map(c => c.key);
  const payload = {
    schema_version: 'catalogue.v1',
    generated_at:   (meta && meta.generated_at) || new Date().toISOString(),
    chrom:          (meta && meta.chrom)        || null,
    filter:         (meta && meta.filter)       || {},
    columns:        colKeys,
    rows:           [],
  };
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r) continue;
      const obj = {};
      for (const c of cols) obj[c.key] = (r[c.key] == null ? null : r[c.key]);
      payload.rows.push(obj);
    }
  }
  return JSON.stringify(payload, null, 2);
}

// =====================================================================
// DOM render orchestrator
// =====================================================================

function _ensureCatalogueState(state) {
  if (!state) return;
  if (!Array.isArray(state.catalogueRows)) state.catalogueRows = [];
  if (!(state.catFavorites instanceof Set)) state.catFavorites = new Set();
  if (!(state.catSelection instanceof Set)) state.catSelection = new Set();
  if (typeof state.catFilter !== 'string')        state.catFilter = '';
  if (typeof state.catVerdictFilter !== 'string') state.catVerdictFilter = '';
  if (typeof state.catViewMode !== 'string')      state.catViewMode = 'l2_raw';
  if (typeof state.catDispMode !== 'string')      state.catDispMode = 'detailed';
  if (typeof state.catSortKey !== 'string')       state.catSortKey = 'id';
  if (typeof state.catSortDir !== 'string')       state.catSortDir = 'asc';
}

/**
 * Full render pass. Reads state, writes #catHead / #catBody /
 * #catEmpty / #catSelInfo / #catFilter / #catVerdictFilter. Idempotent.
 * No-op when document is absent.
 */
export function renderCatalogue(state) {
  if (typeof document === 'undefined') return;
  _ensureCatalogueState(state);

  const head    = document.getElementById('catHead');
  const body    = document.getElementById('catBody');
  const empty   = document.getElementById('catEmpty');
  const selInfo = document.getElementById('catSelInfo');

  const all      = buildCatalogueRows(state);
  const filtered = filterCatalogueRows(all, state);
  const sorted   = sortCatalogueRows(filtered, state.catSortKey, state.catSortDir);

  if (head) head.innerHTML = renderCatHeaderHtml(state.catDispMode, state.catSortKey, state.catSortDir);
  if (body) {
    // When no source rows have been loaded, leave the body empty so the
    // catEmpty hint (rendered below) is the only message. Render the
    // "No rows match" stub only when rows exist but filters drop them all.
    body.innerHTML = (all.length === 0)
      ? ''
      : renderCatBodyHtml(sorted, state.catDispMode, state.catSelection, state.catFavorites);
  }

  if (empty) {
    if (all.length === 0) {
      empty.style.display = 'block';
      empty.textContent = 'Load a JSON to populate the catalogue.';
    } else {
      empty.style.display = 'none';
    }
  }
  if (selInfo) {
    const nSel = state.catSelection ? state.catSelection.size : 0;
    selInfo.textContent = nSel + ' selected of ' + sorted.length;
  }
}

// =====================================================================
// Event wiring
// =====================================================================

function _canListen(t) {
  return t
    && typeof t.addEventListener === 'function'
    && typeof t.removeEventListener === 'function';
}

let _filterInputHandler   = null;
let _verdictChangeHandler = null;
let _headClickHandler     = null;
let _bodyClickHandler     = null;
let _selectAllHandler     = null;
let _clearSelHandler      = null;
let _viewFavHandler       = null;
let _viewL2Handler        = null;
let _dispSimpleHandler    = null;
let _dispDetailedHandler  = null;
let _exportTSVHandler     = null;
let _exportMDHandler      = null;
let _exportJSONHandler    = null;

function _attachBtn(id, handlerSlot, fn, slotName, slotMap) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  if (_canListen(el)) {
    el.addEventListener('click', fn);
    slotMap[slotName] = fn;
  }
}

/**
 * Wire all catalogue toolbar handlers (filter, verdict, sort, view/
 * disp mode, select-all/clear, exports, body row clicks). Idempotent.
 * Optional `opts.onChange(state)` fires after every state mutation.
 * Optional `opts.onDownload(filename, content, mime)` is called for
 * exports; defaults to a Blob/URL download (browser-only).
 */
export function wireCatalogueToolbar(state, opts) {
  if (typeof document === 'undefined') return;
  teardownCatalogueToolbar();
  _ensureCatalogueState(state);

  const onChange   = (opts && typeof opts.onChange   === 'function') ? opts.onChange   : null;
  const onDownload = (opts && typeof opts.onDownload === 'function') ? opts.onDownload : _defaultDownload;

  const filterIn  = document.getElementById('catFilter');
  const verdictIn = document.getElementById('catVerdictFilter');
  const head      = document.getElementById('catHead');
  const body      = document.getElementById('catBody');
  const selectAll = document.getElementById('catSelectAll');
  const clearSel  = document.getElementById('catClearSel');
  const viewFav   = document.getElementById('catViewFav');
  const viewL2    = document.getElementById('catViewL2');
  const dispSimple   = document.getElementById('catDispSimple');
  const dispDetailed = document.getElementById('catDispDetailed');
  const exportTSV  = document.getElementById('catExportTSV');
  const exportMD   = document.getElementById('catExportMD');
  const exportJSON = document.getElementById('catExportJSON');

  const refresh = () => { renderCatalogue(state); if (onChange) { try { onChange(state); } catch (_) {} } };

  _filterInputHandler = (evt) => {
    if (!state) return;
    state.catFilter = (evt && evt.target && evt.target.value) || '';
    refresh();
  };
  _verdictChangeHandler = (evt) => {
    if (!state) return;
    state.catVerdictFilter = (evt && evt.target && evt.target.value) || '';
    refresh();
  };
  _headClickHandler = (evt) => {
    if (!state || !evt || !evt.target) return;
    let th = evt.target;
    while (th && th !== head) {
      if (th.getAttribute && th.getAttribute('data-sort')) break;
      th = th.parentNode;
    }
    if (!th || !th.getAttribute) return;
    const k = th.getAttribute('data-sort');
    if (!k) return;
    if (state.catSortKey === k) {
      state.catSortDir = state.catSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.catSortKey = k;
      state.catSortDir = 'asc';
    }
    refresh();
  };
  _bodyClickHandler = (evt) => {
    if (!state || !evt || !evt.target) return;
    const t = evt.target;
    const starId = t.getAttribute ? t.getAttribute('data-star') : null;
    if (starId) {
      if (state.catFavorites.has(starId)) state.catFavorites.delete(starId);
      else                                state.catFavorites.add(starId);
      refresh();
      return;
    }
    const selId = t.getAttribute ? t.getAttribute('data-sel') : null;
    if (selId) {
      if (state.catSelection.has(selId)) state.catSelection.delete(selId);
      else                               state.catSelection.add(selId);
      refresh();
      return;
    }
  };
  _selectAllHandler = () => {
    if (!state) return;
    const filtered = filterCatalogueRows(buildCatalogueRows(state), state);
    for (const r of filtered) state.catSelection.add(r.id);
    refresh();
  };
  _clearSelHandler = () => {
    if (!state) return;
    state.catSelection.clear();
    refresh();
  };
  _viewFavHandler = () => {
    if (!state) return;
    state.catViewMode = state.catViewMode === 'fav' ? 'l2_raw' : 'fav';
    refresh();
  };
  _viewL2Handler = () => {
    if (!state) return;
    state.catViewMode = 'l2_raw';
    refresh();
  };
  _dispSimpleHandler = () => {
    if (!state) return;
    state.catDispMode = 'simple';
    refresh();
  };
  _dispDetailedHandler = () => {
    if (!state) return;
    state.catDispMode = 'detailed';
    refresh();
  };
  const _doExport = (fmt) => {
    const filtered = filterCatalogueRows(buildCatalogueRows(state), state);
    const sorted   = sortCatalogueRows(filtered, state.catSortKey, state.catSortDir);
    const disp = state.catDispMode || 'detailed';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    let content, mime, name;
    if (fmt === 'tsv') {
      content = exportCatalogueTSV(sorted, disp);
      mime = 'text/tab-separated-values';
      name = 'catalogue_' + stamp + '.tsv';
    } else if (fmt === 'md') {
      content = exportCatalogueMarkdown(sorted, disp);
      mime = 'text/markdown';
      name = 'catalogue_' + stamp + '.md';
    } else {
      content = exportCatalogueJSON(sorted, disp, {
        chrom: state.activeChrom || null,
        filter: {
          text: state.catFilter, verdict: state.catVerdictFilter,
          viewMode: state.catViewMode, dispMode: disp,
          sortKey: state.catSortKey, sortDir: state.catSortDir,
        },
      });
      mime = 'application/json';
      name = 'catalogue_' + stamp + '.json';
    }
    try { onDownload(name, content, mime); } catch (_) {}
  };
  _exportTSVHandler  = () => _doExport('tsv');
  _exportMDHandler   = () => _doExport('md');
  _exportJSONHandler = () => _doExport('json');

  if (_canListen(filterIn))  filterIn.addEventListener('input',  _filterInputHandler);
  if (_canListen(verdictIn)) verdictIn.addEventListener('change', _verdictChangeHandler);
  if (_canListen(head))      head.addEventListener('click',      _headClickHandler);
  if (_canListen(body))      body.addEventListener('click',      _bodyClickHandler);
  if (_canListen(selectAll)) selectAll.addEventListener('click', _selectAllHandler);
  if (_canListen(clearSel))  clearSel.addEventListener('click',  _clearSelHandler);
  if (_canListen(viewFav))   viewFav.addEventListener('click',   _viewFavHandler);
  if (_canListen(viewL2))    viewL2.addEventListener('click',    _viewL2Handler);
  if (_canListen(dispSimple))   dispSimple.addEventListener('click',   _dispSimpleHandler);
  if (_canListen(dispDetailed)) dispDetailed.addEventListener('click', _dispDetailedHandler);
  if (_canListen(exportTSV))  exportTSV.addEventListener('click',  _exportTSVHandler);
  if (_canListen(exportMD))   exportMD.addEventListener('click',   _exportMDHandler);
  if (_canListen(exportJSON)) exportJSON.addEventListener('click', _exportJSONHandler);
}

/** Remove handlers wired by wireCatalogueToolbar. Idempotent. */
export function teardownCatalogueToolbar() {
  if (typeof document === 'undefined') return;
  const pairs = [
    ['catFilter',        'input',  '_filterInputHandler'],
    ['catVerdictFilter', 'change', '_verdictChangeHandler'],
    ['catHead',          'click',  '_headClickHandler'],
    ['catBody',          'click',  '_bodyClickHandler'],
    ['catSelectAll',     'click',  '_selectAllHandler'],
    ['catClearSel',      'click',  '_clearSelHandler'],
    ['catViewFav',       'click',  '_viewFavHandler'],
    ['catViewL2',        'click',  '_viewL2Handler'],
    ['catDispSimple',    'click',  '_dispSimpleHandler'],
    ['catDispDetailed',  'click',  '_dispDetailedHandler'],
    ['catExportTSV',     'click',  '_exportTSVHandler'],
    ['catExportMD',      'click',  '_exportMDHandler'],
    ['catExportJSON',    'click',  '_exportJSONHandler'],
  ];
  const handlers = {
    _filterInputHandler,   _verdictChangeHandler, _headClickHandler, _bodyClickHandler,
    _selectAllHandler,     _clearSelHandler,      _viewFavHandler,   _viewL2Handler,
    _dispSimpleHandler,    _dispDetailedHandler,
    _exportTSVHandler,     _exportMDHandler,      _exportJSONHandler,
  };
  for (const [id, evt, slot] of pairs) {
    const h = handlers[slot];
    if (!h) continue;
    const el = document.getElementById(id);
    if (_canListen(el)) el.removeEventListener(evt, h);
  }
  _filterInputHandler = _verdictChangeHandler = _headClickHandler = _bodyClickHandler = null;
  _selectAllHandler   = _clearSelHandler      = _viewFavHandler   = _viewL2Handler = null;
  _dispSimpleHandler  = _dispDetailedHandler  = null;
  _exportTSVHandler   = _exportMDHandler      = _exportJSONHandler = null;
}

function _defaultDownload(filename, content, mime) {
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
