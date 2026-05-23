import { diamondCountFor } from '../../../shared/diamond_detection.js';
// pages/catalogue/catalogue/catalogue.js
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
  // 2026-05-20 (SPEC_cramers_v_seed_merge.md Phase 1 deliverable #4):
  // surface `source` so the TSV/MD/JSON export can distinguish
  // user-curated drafts (lock_promote, seed_promote, l3_pair_merge)
  // from auto-promoted candidates (auto_l2_sweep, auto_cramers_v_local,
  // auto_cramers_v_macrostripe). `simple: false` keeps it out of the
  // default narrow-table view but it's always included in exports.
  Object.freeze({ key: 'source',     label: 'source',     kind: 'string', simple: false, align: 'left'  }),
  Object.freeze({ key: 'diamond',    label: 'Diamond',    kind: 'diamond',simple: true,  align: 'center' }),
  Object.freeze({ key: 'n_windows',  label: 'n windows',  kind: 'int',    simple: false, align: 'right' }),
  Object.freeze({ key: 'n_samples',  label: 'n samples',  kind: 'int',    simple: true,  align: 'right' }),
  Object.freeze({ key: 'silhouette', label: 'silhouette', kind: 'float3', simple: false, align: 'right' }),
  Object.freeze({ key: 'coherence',  label: 'coherence',  kind: 'float3', simple: false, align: 'right' }),
  Object.freeze({ key: 'fam_purity', label: 'fam purity', kind: 'float2', simple: false, align: 'right' }),
  Object.freeze({ key: 'cluster_ok', label: 'cluster ok', kind: 'bool',   simple: false, align: 'center' }),
]);

/** Diamond strictness vocab — drives the diamond-mode toolbar buttons
 *  and the count rendered in the Diamond column. */
export const CAT_DIAMOND_MODES = Object.freeze(['loose', 'strict', 'strict2']);

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
      // 2026-05-20: candidate provenance. L2-envelope rows (the
      // default catalogueRows source) don't carry `source`; auto-
      // promoted + manually-promoted candidates do. Empty string for
      // L2-envelope rows keeps the column well-formed in the TSV.
      source:     typeof r.source === 'string' ? r.source : '',
      n_windows:  Number.isFinite(r.n_windows) ? r.n_windows : null,
      n_samples:  Number.isFinite(r.n_samples) ? r.n_samples : null,
      silhouette: Number.isFinite(r.silhouette) ? r.silhouette : null,
      coherence:  Number.isFinite(r.coherence)  ? r.coherence  : null,
      fam_purity: Number.isFinite(r.fam_purity) ? r.fam_purity : null,
      cluster_ok: typeof r.cluster_ok === 'boolean' ? r.cluster_ok : null,
      diamond_summary: (r.diamond_summary && typeof r.diamond_summary === 'object')
        ? r.diamond_summary : null,
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
  // 2026-05-20: source filter — narrows the catalogue to candidates
  // tagged with one provenance source (e.g. only V·local auto-merge,
  // only manual lock_promote). Empty string = no filter.
  const sourceF = (state && typeof state.catSourceFilter === 'string')
    ? state.catSourceFilter : '';
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
    if (sourceF && r.source !== sourceF) continue;
    if (filter) {
      const hay = [r.id, r.chr, r.verdict, r.parent_l1, r.source]
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

function _diamondCellHtml(row, mode) {
  const summary = row && row.diamond_summary;
  const n = diamondCountFor(summary, mode);
  if (n === 0) {
    return '<span style="color: var(--ink-dimmer);">—</span>';
  }
  const glyph = mode === 'strict2' ? '◆◆' : (mode === 'strict' ? '◆' : '◇');
  return '<span style="color: var(--accent); font-weight: 600;" '
    + 'title="' + _escape(n + ' ' + mode + ' diamond' + (n === 1 ? '' : 's')) + '">'
    + glyph + ' ' + n + '</span>';
}

/**
 * Build the <tr> contents for #catBody.
 */
export function renderCatBodyHtml(rows, disp, selection, favorites, diamondMode) {
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
      if (col.kind === 'diamond') {
        out.push('<td style="text-align: center;">'
          + _diamondCellHtml(r, diamondMode || 'loose') + '</td>');
        continue;
      }
      // 2026-05-20: render the `source` column as a coloured chip
      // matching candidate_focus's .src-chip-* classes. Same visual
      // treatment as the candidate-focus header so a user can scan
      // the catalogue and instantly see which candidates came from
      // L2-sweep vs Cramér V local vs Cramér V macrostripe vs the
      // manual draft paths. Falls back to a plain "—" for rows with
      // no source (L2-envelope rows that aren't candidates).
      if (col.key === 'source') {
        const raw = r[col.key];
        if (!raw) {
          out.push('<td style="text-align: ' + col.align + ';">' +
                   '<span style="color: var(--ink-dimmer);">—</span></td>');
          continue;
        }
        const chipClass = 'src-chip src-chip-' +
          String(raw).replace(/[^a-z0-9_]/g, '_');
        out.push(
          '<td style="text-align: ' + col.align + ';">' +
          '<span class="' + chipClass + '">' + _escape(raw) + '</span>' +
          '</td>'
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
// Promote-to-candidate
// =====================================================================

function _candidateIdFromRow(row) {
  return row && (row.id || row.candidate_id || null);
}

/**
 * Promote a set of catalogue rows to provisional candidates. Pure
 * helpers: takes the row objects + an existing candidateList (Array)
 * and returns:
 *   { promoted: Array<Object>, candidateList: Array<Object> }
 *
 * - Rows whose id already appears in candidateList are skipped.
 * - Each promoted entry carries `provisional: true`, `confirmed: false`,
 *   `promoted_from: 'catalogue'`, and copies chr/start_bp/end_bp/K
 *   from the row. The returned candidateList is a NEW array (caller
 *   should assign back); existing entries are preserved.
 *
 * @param {Array<Object>} rows           catalogue rows (after build)
 * @param {Array<Object>?} candidateList existing list (defaults [])
 * @returns {{promoted:Array<Object>, candidateList:Array<Object>}}
 */
export function promoteRowsToCandidates(rows, candidateList) {
  const list = Array.isArray(candidateList) ? candidateList.slice() : [];
  const haveIds = new Set();
  for (const c of list) {
    if (c && typeof c.id === 'string') haveIds.add(c.id);
  }
  const promoted = [];
  if (!Array.isArray(rows)) return { promoted, candidateList: list };
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const id = _candidateIdFromRow(r);
    if (!id || haveIds.has(id)) continue;
    const cand = {
      id,
      chrom:       typeof r.chr === 'string' ? r.chr : (r.chrom || ''),
      start_bp:    Number.isFinite(r.start_bp) ? r.start_bp : null,
      end_bp:      Number.isFinite(r.end_bp)   ? r.end_bp   : null,
      K:           Number.isFinite(r.K) ? r.K : null,
      verdict:     typeof r.verdict === 'string' ? r.verdict : '',
      // 2026-05-20: preserve provenance when an existing row already
      // had a `source` tag (auto-promoted rows surface in the catalogue
      // via inv.catalogueRows). Falls back to the canonical
      // 'catalogue_promote' source for rows that don't carry one —
      // matches the existing 'promoted_from: catalogue' breadcrumb.
      source:      typeof r.source === 'string' && r.source
                     ? r.source : 'catalogue_promote',
      provisional: true,
      confirmed:   false,
      promoted_from: 'catalogue',
      promoted_at:   new Date().toISOString(),
      locked_labels: [],
    };
    promoted.push(cand);
    haveIds.add(id);
    list.push(cand);
  }
  return { promoted, candidateList: list };
}

/**
 * State-aware wrapper around promoteRowsToCandidates. Reads the
 * currently-selected ids from state.catSelection, finds the matching
 * rows, promotes them onto state.candidateList, and (when promoted ≥ 1)
 * sets state.candidate to the first promoted candidate.
 *
 * Returns the same shape as promoteRowsToCandidates plus the resolved
 * candidate that was activated (may be null when nothing promoted).
 *
 * @param {Object} state
 * @returns {{promoted:Array<Object>, candidateList:Array<Object>, active:Object|null}}
 */
export function promoteSelectedToCandidates(state) {
  const all = buildCatalogueRows(state);
  const sel = (state && state.catSelection instanceof Set) ? state.catSelection : new Set();
  const rows = all.filter(r => sel.has(r.id));
  const existing = (state && Array.isArray(state.candidateList)) ? state.candidateList : [];
  const out = promoteRowsToCandidates(rows, existing);
  if (state) {
    state.candidateList = out.candidateList;
    if (out.promoted.length > 0) {
      state.candidate = out.promoted[0];
    }
  }
  return Object.assign({}, out, { active: out.promoted[0] || null });
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
  if (typeof state.catSourceFilter !== 'string')  state.catSourceFilter = '';
  if (typeof state.catViewMode !== 'string')      state.catViewMode = 'l2_raw';
  if (typeof state.catDispMode !== 'string')      state.catDispMode = 'detailed';
  if (typeof state.catSortKey !== 'string')       state.catSortKey = 'id';
  if (typeof state.catSortDir !== 'string')       state.catSortDir = 'asc';
  if (typeof state.catDiamondMode !== 'string'
      || CAT_DIAMOND_MODES.indexOf(state.catDiamondMode) < 0) {
    state.catDiamondMode = 'loose';
  }
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
      : renderCatBodyHtml(sorted, state.catDispMode, state.catSelection,
                          state.catFavorites, state.catDiamondMode);
  }

  if (empty) {
    if (all.length === 0) {
      empty.style.display = 'block';
      empty.textContent = 'Load a JSON to populate the catalogue.';
    } else {
      empty.style.display = 'none';
    }
  }
  // 2026-05-20: refresh the compare-modes overlap strip on every
  // catalogue re-render so it tracks list mutations + auto-merge
  // promotions in real time.
  try { _renderSourceOverlap(state); } catch (e) {
    if (typeof console !== 'undefined') console.warn('[_renderSourceOverlap]', e);
  }
  // 2026-05-20: refresh #catSourceFilter option labels with per-source
  // counts so the user sees how many candidates each source carries
  // before clicking.
  try { _refreshSourceFilterCounts(state); } catch (e) {
    if (typeof console !== 'undefined') console.warn('[_refreshSourceFilterCounts]', e);
  }
  if (selInfo) {
    const nSel = state.catSelection ? state.catSelection.size : 0;
    selInfo.textContent = nSel + ' selected of ' + sorted.length;
  }
}

// =====================================================================
// Compare-modes overlap strip (SPEC_cramers_v_seed_merge.md Phase 2)
// =====================================================================
// Reads state.candidateList, partitions by the auto / semi-auto modes
// shipped on the haplotype_regimes + local_pca_dosage pages
// (`l3_pair_merge` from the L3 adjacent-pair Cramér mini-table,
// `auto_cramers_v_local` from the ↻ auto-merge V Mode 1 button,
// `auto_cramers_v_macrostripe` from the ↻ auto-merge V macro Mode 2
// button), and computes pairwise + triple genomic overlap. Two
// candidates "agree" when same chrom + bp range intersects
// (max(start) <= min(end)). Renders a single-line summary strip;
// hidden when no candidates carry any of the tracked sources.
//
// 2026-05-20 (Quentin feedback): the original 3-set was
// (auto_l2_sweep, auto_cramers_v_local, auto_cramers_v_macrostripe)
// per the SPEC, but the legacy inheritance L2-sweep is no longer the
// workflow — every promote path now flows through the regimes-page
// pipeline. Replaced auto_l2_sweep with l3_pair_merge so the audit
// strip compares the three modes the user actually runs today.
//
// Output shape per source bucket A:
//   |A|      = number of candidates tagged with source A
//   A∩B      = candidates in A with ≥1 overlapping candidate in B
//   A∩B∩C    = candidates in A with overlap in both B and C
//   A-only   = candidates in A with no overlap in B nor C
//
// (Counts are computed from each source's perspective. By symmetry,
//  A∩B == B∩A is not guaranteed because two candidates can map 1:N —
//  but the agreement read is the right one for the audit question.)
// =====================================================================

const _AUTO_SOURCES = [
  { key: 'l3_pair_merge',              label: 'L3-pair',   short: 'L3p',
    chip: 'src-chip-l3_pair_merge' },
  { key: 'auto_cramers_v_local',       label: 'V · local', short: 'Vloc',
    chip: 'src-chip-auto_cramers_v_local' },
  { key: 'auto_cramers_v_macrostripe', label: 'V · macro', short: 'Vmac',
    chip: 'src-chip-auto_cramers_v_macrostripe' },
];

function _overlapsBp(a, b) {
  if (!a || !b) return false;
  const sa = a.start_bp | 0, ea = a.end_bp | 0;
  const sb = b.start_bp | 0, eb = b.end_bp | 0;
  if (!Number.isFinite(sa) || !Number.isFinite(ea)) return false;
  if (!Number.isFinite(sb) || !Number.isFinite(eb)) return false;
  if (a.chrom && b.chrom && a.chrom !== b.chrom) return false;
  return Math.max(sa, sb) <= Math.min(ea, eb);
}

function _renderSourceOverlap(state) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('catSourceOverlap');
  if (!el) return;
  const list = (state && Array.isArray(state.candidateList))
    ? state.candidateList : [];
  // Partition by source.
  const buckets = _AUTO_SOURCES.map(s => ({
    src: s, cands: list.filter(c => c && c.source === s.key),
  }));
  const totalAuto = buckets.reduce((acc, b) => acc + b.cands.length, 0);
  if (totalAuto === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';

  // Per-bucket overlap counts.
  const stats = buckets.map((bk, bi) => {
    const others = buckets.filter((_, j) => j !== bi);
    let nABC = 0;          // overlap with BOTH other sources
    let nOnly = 0;         // overlap with neither other source
    const pairwise = others.map(() => 0);
    for (const c of bk.cands) {
      const hits = others.map(ob =>
        ob.cands.some(d => d.id !== c.id && _overlapsBp(c, d)));
      hits.forEach((h, hi) => { if (h) pairwise[hi]++; });
      if (hits.every(Boolean)) nABC++;
      else if (hits.every(h => !h)) nOnly++;
    }
    return { src: bk.src, n: bk.cands.length, pairwise, others,
             nABC, nOnly };
  });

  // Build the HTML.
  const parts = [];
  parts.push('<span style="color: var(--ink); font-weight: 500;">compare modes:</span>');
  for (const st of stats) {
    const colour = st.src.chip;
    parts.push(
      '<span class="src-chip ' + colour + '" title="Candidates auto-promoted as ' +
      _escape(st.src.label) + ' (source=' + _escape(st.src.key) + ').">' +
      _escape(st.src.label) + ': <b>' + st.n + '</b>' +
      '</span>'
    );
  }
  // Pairwise: A∩B (count from A's perspective + count from B's perspective
  // — we show whichever is non-zero. Two candidates can map 1:N so they
  // can differ; the audit read is "at least N regions from A intersect B").
  const pairLabels = [
    [0, 1, 'L3p ∩ Vloc'],
    [0, 2, 'L3p ∩ Vmac'],
    [1, 2, 'Vloc ∩ Vmac'],
  ];
  for (const [ai, bi, lbl] of pairLabels) {
    const A = stats[ai], B = stats[bi];
    // A's "overlap with bucket index" — A.others matches buckets with index != ai,
    // in original order. We need to find the slot whose .src.key matches B's key.
    const aIdxInOthers = A.others.findIndex(o => o.src.key === B.src.key);
    const bIdxInOthers = B.others.findIndex(o => o.src.key === A.src.key);
    const nA = aIdxInOthers >= 0 ? A.pairwise[aIdxInOthers] : 0;
    const nB = bIdxInOthers >= 0 ? B.pairwise[bIdxInOthers] : 0;
    const n  = Math.max(nA, nB);
    if (n > 0) {
      parts.push(
        '<span style="padding: 1px 8px; border-radius: 3px; ' +
        'background: rgba(120,140,170,0.10); border: 1px solid var(--rule); ' +
        'color: var(--ink);" title="Candidates from each side that overlap a candidate from the other (max of both directions).">' +
        _escape(lbl) + ': <b>' + n + '</b></span>'
      );
    }
  }
  // Triple intersection.
  const tripleN = stats[0].nABC;
  if (tripleN > 0) {
    parts.push(
      '<span style="padding: 1px 8px; border-radius: 3px; ' +
      'background: rgba(60,192,138,0.15); border: 1px solid var(--good); ' +
      'color: var(--good); font-weight: 600;" title="Regions where all three auto-promote modes agree (each has a candidate that overlaps a candidate from each of the other two).">' +
      'all 3 agree: <b>' + tripleN + '</b></span>'
    );
  }
  // Per-source "only" counts.
  const onlyParts = [];
  for (const st of stats) {
    if (st.nOnly > 0) {
      onlyParts.push(_escape(st.src.short) + '-only: <b>' + st.nOnly + '</b>');
    }
  }
  if (onlyParts.length) {
    parts.push(
      '<span style="color: var(--ink-dimmer); margin-left: 6px;" ' +
      'title="Candidates each mode caught that no other mode caught (disagreement regions).">' +
      onlyParts.join(' · ') + '</span>'
    );
  }
  el.innerHTML = parts.join('');
}

// =====================================================================
// Source-filter option counts (2026-05-20)
// =====================================================================
// Updates the labels of every #catSourceFilter <option> to include the
// per-source candidate count: "V · local" → "V · local (8)". Hides
// options for sources that have 0 matching candidates (so the dropdown
// doesn't surface obsolete legacy sources). The "all sources" option
// always shows the unfiltered count.
function _refreshSourceFilterCounts(state) {
  if (typeof document === 'undefined') return;
  const sel = document.getElementById('catSourceFilter');
  if (!sel) return;
  const list = (state && Array.isArray(state.candidateList))
    ? state.candidateList : [];
  // Tally per-source counts.
  const counts = new Map();
  for (const c of list) {
    if (!c) continue;
    const key = (typeof c.source === 'string' && c.source) ? c.source : '';
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Walk every <option>; preserve its original (count-free) label in
  // dataset.baseLabel so re-renders don't accumulate "(N) (N) (N)".
  for (const opt of sel.options) {
    if (!opt.dataset.baseLabel) {
      opt.dataset.baseLabel = opt.textContent;
    }
    const base = opt.dataset.baseLabel;
    if (!opt.value) {
      // "all sources" — show total
      opt.textContent = list.length > 0 ? `${base} (${list.length})` : base;
      opt.hidden = false;
      continue;
    }
    const n = counts.get(opt.value) || 0;
    opt.textContent = n > 0 ? `${base} (${n})` : base;
    // Hide zero-count options unless they're currently selected (so
    // the user can still un-pick them).
    opt.hidden = (n === 0) && (sel.value !== opt.value);
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
let _sourceChangeHandler  = null;
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
let _viewAsCandHandler    = null;
let _diamondLooseHandler  = null;
let _diamondStrictHandler = null;
let _diamondStrict2Handler = null;

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
  const sourceIn  = document.getElementById('catSourceFilter');
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
  const viewAsCand    = document.getElementById('catViewAsCandidate');
  const onPromote     = (opts && typeof opts.onPromote === 'function') ? opts.onPromote : null;
  const diaLoose      = document.getElementById('catDiamondLoose');
  const diaStrict     = document.getElementById('catDiamondStrict');
  const diaStrict2    = document.getElementById('catDiamondStrict2');

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
  _sourceChangeHandler = (evt) => {
    if (!state) return;
    state.catSourceFilter = (evt && evt.target && evt.target.value) || '';
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
  _viewAsCandHandler = () => {
    const result = promoteSelectedToCandidates(state);
    refresh();
    if (onPromote && result.promoted.length > 0) {
      try { onPromote(state, result); } catch (_) {}
    }
  };
  const _setDiamondMode = (m) => {
    if (!state) return;
    state.catDiamondMode = m;
    refresh();
  };
  _diamondLooseHandler   = () => _setDiamondMode('loose');
  _diamondStrictHandler  = () => _setDiamondMode('strict');
  _diamondStrict2Handler = () => _setDiamondMode('strict2');

  if (_canListen(filterIn))  filterIn.addEventListener('input',  _filterInputHandler);
  if (_canListen(verdictIn)) verdictIn.addEventListener('change', _verdictChangeHandler);
  if (_canListen(sourceIn))  sourceIn.addEventListener('change',  _sourceChangeHandler);
  if (sourceIn && state.catSourceFilter) sourceIn.value = state.catSourceFilter;
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
  if (_canListen(viewAsCand)) viewAsCand.addEventListener('click', _viewAsCandHandler);
  if (_canListen(diaLoose))   diaLoose.addEventListener('click',   _diamondLooseHandler);
  if (_canListen(diaStrict))  diaStrict.addEventListener('click',  _diamondStrictHandler);
  if (_canListen(diaStrict2)) diaStrict2.addEventListener('click', _diamondStrict2Handler);
}

/** Remove handlers wired by wireCatalogueToolbar. Idempotent. */
export function teardownCatalogueToolbar() {
  if (typeof document === 'undefined') return;
  const pairs = [
    ['catFilter',        'input',  '_filterInputHandler'],
    ['catVerdictFilter', 'change', '_verdictChangeHandler'],
    ['catSourceFilter',  'change', '_sourceChangeHandler'],
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
    ['catViewAsCandidate', 'click', '_viewAsCandHandler'],
    ['catDiamondLoose',    'click', '_diamondLooseHandler'],
    ['catDiamondStrict',   'click', '_diamondStrictHandler'],
    ['catDiamondStrict2',  'click', '_diamondStrict2Handler'],
  ];
  const handlers = {
    _filterInputHandler,   _verdictChangeHandler, _sourceChangeHandler,
    _headClickHandler, _bodyClickHandler,
    _selectAllHandler,     _clearSelHandler,      _viewFavHandler,   _viewL2Handler,
    _dispSimpleHandler,    _dispDetailedHandler,
    _exportTSVHandler,     _exportMDHandler,      _exportJSONHandler,
    _viewAsCandHandler,
    _diamondLooseHandler,  _diamondStrictHandler, _diamondStrict2Handler,
  };
  for (const [id, evt, slot] of pairs) {
    const h = handlers[slot];
    if (!h) continue;
    const el = document.getElementById(id);
    if (_canListen(el)) el.removeEventListener(evt, h);
  }
  _filterInputHandler = _verdictChangeHandler = _sourceChangeHandler = null;
  _headClickHandler = _bodyClickHandler = null;
  _selectAllHandler   = _clearSelHandler      = _viewFavHandler   = _viewL2Handler = null;
  _dispSimpleHandler  = _dispDetailedHandler  = null;
  _exportTSVHandler   = _exportMDHandler      = _exportJSONHandler = null;
  _viewAsCandHandler  = null;
  _diamondLooseHandler = _diamondStrictHandler = _diamondStrict2Handler = null;
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
