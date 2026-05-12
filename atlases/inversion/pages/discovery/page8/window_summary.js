// pages/discovery/page8/window_summary.js
//
// Per-window summary table + strip canvas — the implementation legacy
// never shipped (chat-33 BATCH_1_NOTES: "0 functions extracted — pure
// HTML scaffold"). Page8's HTML wires #winSumTable / #winSumStripCanvas
// / #winSumL2Filter / #winSumZFilter / #winSumChips / #winSumNoChrom /
// #winSumBisnpInfoBtn but no JS file populates them.
//
// State slots used (set on state at mount time, mutated by toolbar):
//   state.activeChrom       : chromosome label for the chips area
//   state.precomp           : { windows: [...], l1: [...], l2: [...],
//                               focal_l2_id?: string }
//   state.winSumFilters     : { l2: '' | 'in_l2' | 'in_focal',
//                               zMin: <number> }
//   state.winSumColorMode   : sort/color key (defaults to 'z')
//   state.winSumSortKey     : current sort column
//   state.winSumSortDir     : 'asc' | 'desc'
//
// Window row shape (from precomp.windows[i]):
//   { idx?, start_bp, end_bp, center_bp?, n_snps?, z?, lam1?, lam2?,
//     l1_id?, l2_id? }
//
// Public entries:
//   COLOR_MODES                        : frozen catalogue + display labels
//   computeWindowRow(win, idx)         : derive sortable columns
//   buildWindowRows(precomp)           : build all rows + apply L1/L2 lookups
//   filterWindowRows(rows, filters,
//                    focalL2Id)        : apply L2/zMin filters
//   sortWindowRows(rows, key, dir)     : column sort with stable tiebreaker
//   renderWinSumTableHtml(rows, key, dir, currentIdx)
//                                      : full <table> html for #winSumTable body
//   renderWinSumChipsHtml(chrom, nVis, nTot)
//                                      : chip strip html
//   colorForRow(row, mode)             : 'rgba(...)' for the strip canvas
//   drawWinSumStripCanvas(canvas, rows, mode)
//                                      : paint strip on a provided canvas
//   renderPage8(state)                 : full render orchestrator
//   wireWinSumToolbar(state, opts)     : wire filter / sort / info-toggle
//   teardownWinSumToolbar()            : remove wired handlers
//
// Headless-tolerant: typeof document guards on every DOM helper; pure
// helpers operate on plain JS values.

// =====================================================================
// Catalogues
// =====================================================================

/** Sortable / colorable columns. Each entry is the key written to
 *  table th data-sort + the legend label. */
export const COLOR_MODES = Object.freeze([
  Object.freeze({ key: 'idx',         label: 'w#',         num: true,  numeric: 'int' }),
  Object.freeze({ key: 'mb',          label: 'center Mb',  num: true,  numeric: 'float2' }),
  Object.freeze({ key: 'n_snps',      label: 'n bi-SNPs',  num: true,  numeric: 'int' }),
  Object.freeze({ key: 'span_kb',     label: 'span kb',    num: true,  numeric: 'float1' }),
  Object.freeze({ key: 'snp_density', label: 'bi-SNPs/kb', num: true,  numeric: 'float2' }),
  Object.freeze({ key: 'z',           label: '|Z|',        num: true,  numeric: 'float2' }),
  Object.freeze({ key: 'lam1',        label: 'λ₁',         num: true,  numeric: 'float3' }),
  Object.freeze({ key: 'lam2',        label: 'λ₂',         num: true,  numeric: 'float3' }),
  Object.freeze({ key: 'ratio',       label: 'λ₁/λ₂',      num: true,  numeric: 'float2' }),
  Object.freeze({ key: 'l1',          label: 'L1',         num: false, numeric: null   }),
  Object.freeze({ key: 'l2',          label: 'L2',         num: false, numeric: null   }),
]);

const _COL_BY_KEY = (() => {
  const m = new Map();
  for (const c of COLOR_MODES) m.set(c.key, c);
  return m;
})();

// =====================================================================
// Row builders
// =====================================================================

function _bpCenter(win) {
  if (Number.isFinite(win.center_bp)) return win.center_bp;
  if (Number.isFinite(win.start_bp) && Number.isFinite(win.end_bp)) {
    return (win.start_bp + win.end_bp) / 2;
  }
  return null;
}

/**
 * Build a single sortable row from a window object. `idx` is the
 * window's position in the precomp.windows array.
 *
 * @param {Object} win
 * @param {number} idx
 * @returns {Object}
 */
export function computeWindowRow(win, idx) {
  if (!win || typeof win !== 'object') return null;
  const start = Number.isFinite(win.start_bp) ? win.start_bp : null;
  const end   = Number.isFinite(win.end_bp)   ? win.end_bp   : null;
  const span_bp = (start != null && end != null && end > start) ? (end - start) : null;
  const span_kb = span_bp != null ? span_bp / 1000 : null;
  const n_snps  = Number.isFinite(win.n_snps) ? win.n_snps : null;
  const snp_density = (n_snps != null && span_kb != null && span_kb > 0)
    ? (n_snps / span_kb) : null;
  const centerBp = _bpCenter(win);
  const lam1 = Number.isFinite(win.lam1) ? win.lam1 : null;
  const lam2 = Number.isFinite(win.lam2) ? win.lam2 : null;
  const ratio = (lam1 != null && lam2 != null && lam2 > 0) ? (lam1 / lam2) : null;
  const z = Number.isFinite(win.z) ? Math.abs(win.z) : null;

  return {
    idx,
    start_bp:    start,
    end_bp:      end,
    mb:          centerBp != null ? centerBp / 1e6 : null,
    n_snps,
    span_kb,
    snp_density,
    z,
    lam1,
    lam2,
    ratio,
    l1:          (typeof win.l1_id === 'string' && win.l1_id) || '',
    l2:          (typeof win.l2_id === 'string' && win.l2_id) || '',
  };
}

/**
 * Build all sortable rows from a precomp's windows[]. Returns an empty
 * array when the input is missing or malformed.
 *
 * @param {Object} precomp
 * @returns {Array<Object>}
 */
export function buildWindowRows(precomp) {
  if (!precomp || !Array.isArray(precomp.windows)) return [];
  const out = [];
  for (let i = 0; i < precomp.windows.length; i++) {
    const r = computeWindowRow(precomp.windows[i], i);
    if (r) out.push(r);
  }
  return out;
}

// =====================================================================
// Filters
// =====================================================================

/**
 * Apply L2 + zMin filters. The l2 filter has three modes:
 *   - ''         → all rows (no filter)
 *   - 'in_l2'    → rows with non-empty l2 id
 *   - 'in_focal' → rows whose l2 id matches focalL2Id (when known)
 *
 * @param {Array<Object>} rows
 * @param {{l2?:string, zMin?:number}} filters
 * @param {string?} focalL2Id
 * @returns {Array<Object>}
 */
export function filterWindowRows(rows, filters, focalL2Id) {
  if (!Array.isArray(rows)) return [];
  const f = filters || {};
  const zMin = Number.isFinite(f.zMin) ? f.zMin : 0;
  const l2Mode = typeof f.l2 === 'string' ? f.l2 : '';
  const focal = (typeof focalL2Id === 'string' && focalL2Id) || null;
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    if (l2Mode === 'in_l2' && !r.l2) continue;
    if (l2Mode === 'in_focal') {
      if (!focal || r.l2 !== focal) continue;
    }
    if (zMin > 0) {
      if (r.z == null || r.z < zMin) continue;
    }
    out.push(r);
  }
  return out;
}

// =====================================================================
// Sort
// =====================================================================

function _cmp(a, b) {
  // null / undefined sort last regardless of direction
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }
  const sa = String(a), sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/**
 * Sort rows by a column key. Direction: 'asc' or 'desc'. Stable
 * tiebreaker = original idx (ascending).
 *
 * Unknown keys fall back to idx-ascending.
 *
 * @param {Array<Object>} rows
 * @param {string} key
 * @param {string} dir
 * @returns {Array<Object>}
 */
export function sortWindowRows(rows, key, dir) {
  if (!Array.isArray(rows)) return [];
  const out = rows.slice();
  const col = _COL_BY_KEY.get(key);
  const k = col ? col.key : 'idx';
  const sign = dir === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[k], bv = b[k];
    // null/undefined sort last regardless of direction
    const aNil = (av == null), bNil = (bv == null);
    if (aNil && bNil) return _cmp(a.idx, b.idx);
    if (aNil) return 1;
    if (bNil) return -1;
    const c = _cmp(av, bv);
    if (c !== 0) return c * sign;
    return _cmp(a.idx, b.idx);
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

function _formatNumeric(value, kind) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (kind === 'int')    return String(Math.round(value));
  if (kind === 'float1') return value.toFixed(1);
  if (kind === 'float2') return value.toFixed(2);
  if (kind === 'float3') return value.toFixed(3);
  return String(value);
}

/**
 * Build the <tbody> contents for #winSumTable. The caller paints the
 * thead separately (it's static HTML in the legacy shell).
 *
 * @param {Array<Object>} rows  already filtered + sorted
 * @param {string} key          current sort key (for header arrow class)
 * @param {string} dir          'asc' | 'desc'
 * @param {number?} currentIdx  active window (gets .cur class)
 * @returns {string}
 */
export function renderWinSumTableHtml(rows, key, dir, currentIdx) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<tr><td colspan="12" style="padding: 18px; text-align: center; '
         + 'color: var(--ink-dim);">No windows match the active filters.</td></tr>';
  }
  const cur = Number.isInteger(currentIdx) ? currentIdx : -1;
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const cls = r.idx === cur ? ' class="cur"' : '';
    out.push(
      '<tr' + cls + ' data-idx="' + r.idx + '">'
      + '<td class="num">' + r.idx + '</td>'
      + '<td class="num">' + _formatNumeric(r.mb, 'float2') + '</td>'
      + '<td class="num">' + _formatNumeric(r.n_snps, 'int') + '</td>'
      + '<td class="num">' + _formatNumeric(r.span_kb, 'float1') + '</td>'
      + '<td class="num">' + _formatNumeric(r.snp_density, 'float2') + '</td>'
      + '<td class="num">' + _formatNumeric(r.z, 'float2') + '</td>'
      + '<td class="num">' + _formatNumeric(r.lam1, 'float3') + '</td>'
      + '<td class="num">' + _formatNumeric(r.lam2, 'float3') + '</td>'
      + '<td class="num">' + _formatNumeric(r.ratio, 'float2') + '</td>'
      + '<td class="l1cell">' + _escape(r.l1) + '</td>'
      + '<td class="l2cell">' + _escape(r.l2) + '</td>'
      + '<td><button type="button" class="gobtn" data-go="' + r.idx + '">go</button></td>'
      + '</tr>'
    );
  }
  return out.join('');
}

/**
 * Build the chips HTML for the toolbar (#winSumChips). Lists active
 * chromosome + filtered/total counts.
 */
export function renderWinSumChipsHtml(chrom, nVisible, nTotal) {
  const parts = [];
  if (chrom) {
    parts.push('<span class="chip"><b>' + _escape(chrom) + '</b></span>');
  }
  parts.push(
    '<span class="chip">' + (nVisible || 0) + ' / ' + (nTotal || 0)
    + ' windows</span>'
  );
  return parts.join(' ');
}

// =====================================================================
// Color ramp for the strip canvas
// =====================================================================

function _rampValue(v) {
  // 0..1 → dark-blue → bright yellow (3-stop interp)
  if (!Number.isFinite(v)) return [120, 120, 120];
  v = Math.max(0, Math.min(1, v));
  if (v < 0.5) {
    const t = v / 0.5;
    return [Math.round(30 + (130 - 30) * t),
            Math.round(50 + (170 - 50) * t),
            Math.round(120 + (210 - 120) * t)];
  }
  const t = (v - 0.5) / 0.5;
  return [Math.round(130 + (245 - 130) * t),
          Math.round(170 + (200 - 170) * t),
          Math.round(210 + (60 - 210) * t)];
}

/**
 * Resolve a row's color for the strip canvas. `mode` picks the sort
 * column to drive the ramp. Non-numeric columns fall back to 'z'.
 * Returns 'rgba(r,g,b,0.95)'.
 */
export function colorForRow(row, mode, ctxBounds) {
  if (!row) return 'rgba(120,120,120,0.45)';
  const col = _COL_BY_KEY.get(mode);
  const numeric = (col && col.num) ? mode : 'z';
  const v = row[numeric];
  if (!Number.isFinite(v) || !ctxBounds) return 'rgba(120,120,120,0.45)';
  const { lo, hi } = ctxBounds;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return 'rgba(120,120,120,0.45)';
  }
  const norm = (v - lo) / (hi - lo);
  const [r, g, b] = _rampValue(norm);
  return 'rgba(' + r + ',' + g + ',' + b + ',0.95)';
}

function _computeBounds(rows, mode) {
  const col = _COL_BY_KEY.get(mode);
  const k = (col && col.num) ? mode : 'z';
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    const v = r && r[k];
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo, hi };
}

// =====================================================================
// Canvas drawing
// =====================================================================

/**
 * Paint the strip canvas. One tick per row at the Mb position, height
 * proportional to color-ramp value. Headless-tolerant: returns silently
 * when the canvas lacks getContext.
 */
export function drawWinSumStripCanvas(canvas, rows, mode) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const list = Array.isArray(rows) ? rows : [];
  const w = (canvas.clientWidth  || canvas.width  || 800);
  const h = (canvas.clientHeight || canvas.height || 60);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (list.length === 0) return;

  let mbMin = Infinity, mbMax = -Infinity;
  for (const r of list) {
    if (r && Number.isFinite(r.mb)) {
      if (r.mb < mbMin) mbMin = r.mb;
      if (r.mb > mbMax) mbMax = r.mb;
    }
  }
  if (!Number.isFinite(mbMin) || !Number.isFinite(mbMax) || mbMax <= mbMin) {
    // Single point — paint a centered bar.
    ctx.fillStyle = 'rgba(140,170,210,0.85)';
    ctx.fillRect(Math.floor(w / 2) - 1, 0, 2, h);
    return;
  }
  const bounds = _computeBounds(list, mode);
  const xToPx = (mb) => ((mb - mbMin) / (mbMax - mbMin)) * (w - 2) + 1;

  for (const r of list) {
    if (!r || !Number.isFinite(r.mb)) continue;
    const px = xToPx(r.mb);
    ctx.fillStyle = colorForRow(r, mode, bounds);
    ctx.fillRect(px - 0.5, 0, 1.5, h);
  }
}

// =====================================================================
// DOM render orchestrator
// =====================================================================

function _resolveFilters(state) {
  const f = (state && state.winSumFilters) || {};
  return {
    l2:   typeof f.l2 === 'string' ? f.l2 : '',
    zMin: Number.isFinite(f.zMin) ? f.zMin : 0,
  };
}

function _resolveSort(state) {
  return {
    key: (state && typeof state.winSumSortKey === 'string') ? state.winSumSortKey : 'idx',
    dir: (state && state.winSumSortDir === 'desc') ? 'desc' : 'asc',
  };
}

function _show(id, visible, displayWhenVisible) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = visible ? (displayWhenVisible || 'block') : 'none';
}

/**
 * Full render pass: visibility (no-chrom vs strip+table), chips,
 * strip canvas, and table body. Idempotent. Reads state and writes to
 * the DOM. No-op when document is absent.
 *
 * @param {Object} state
 */
export function renderPage8(state) {
  if (typeof document === 'undefined') return;
  const hasData = !!(state && state.precomp && Array.isArray(state.precomp.windows)
                  && state.precomp.windows.length > 0);

  _show('winSumNoChrom',   !hasData, 'block');
  _show('winSumStrip',      hasData, 'block');
  _show('winSumTableWrap',  hasData, 'block');

  const chips = document.getElementById('winSumChips');
  const body  = document.getElementById('winSumTableBody');
  const cnt   = document.getElementById('winSumCount');
  const modeLabel = document.getElementById('winSumColorModeLabel');
  const canvas = document.getElementById('winSumStripCanvas');

  if (!hasData) {
    if (chips) chips.innerHTML = '';
    if (body)  body.innerHTML  = '';
    if (cnt)   cnt.textContent = '';
    if (canvas && typeof canvas.getContext === 'function') {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const w = canvas.width || 800, h = canvas.height || 60;
        ctx.clearRect(0, 0, w, h);
      }
    }
    return;
  }

  const allRows = buildWindowRows(state.precomp);
  const filters = _resolveFilters(state);
  const focal   = (state.precomp && state.precomp.focal_l2_id) || null;
  const filtered = filterWindowRows(allRows, filters, focal);
  const sort = _resolveSort(state);
  const sorted = sortWindowRows(filtered, sort.key, sort.dir);

  const mode = (state.winSumColorMode && _COL_BY_KEY.has(state.winSumColorMode))
    ? state.winSumColorMode : 'z';

  if (chips) chips.innerHTML = renderWinSumChipsHtml(state.activeChrom, sorted.length, allRows.length);
  if (body)  body.innerHTML  = renderWinSumTableHtml(sorted, sort.key, sort.dir, state.cur);
  if (cnt)   cnt.textContent = sorted.length + ' window' + (sorted.length === 1 ? '' : 's') + ' shown';
  if (modeLabel) {
    const col = _COL_BY_KEY.get(mode);
    modeLabel.textContent = col ? col.label : mode;
  }
  drawWinSumStripCanvas(canvas, sorted, mode);

  // Update header arrows
  const headers = document.querySelectorAll
    ? document.querySelectorAll('#winSumTable thead th.sortable')
    : null;
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach(th => {
      const k = th.getAttribute ? th.getAttribute('data-sort') : null;
      if (!k || !th.classList) return;
      if (typeof th.classList.remove === 'function') {
        th.classList.remove('sort-asc');
        th.classList.remove('sort-desc');
      }
      if (k === sort.key && typeof th.classList.add === 'function') {
        th.classList.add(sort.dir === 'desc' ? 'sort-desc' : 'sort-asc');
      }
    });
  }
}

// =====================================================================
// Event wiring
// =====================================================================

let _l2ChangeHandler   = null;
let _zChangeHandler    = null;
let _bisnpToggleHandler = null;
let _bodyClickHandler  = null;
let _headClickHandler  = null;

function _canListen(target) {
  return target
    && typeof target.addEventListener === 'function'
    && typeof target.removeEventListener === 'function';
}

/**
 * Wire toolbar handlers:
 *   - L2 filter <select>  → state.winSumFilters.l2
 *   - |Z| filter <input>  → state.winSumFilters.zMin
 *   - sortable th clicks  → state.winSumSortKey/dir + winSumColorMode
 *   - table body row+go-button click → opts.onJump(idx)
 *   - bisnp info toggle   → show/hide #winSumBisnpInfoPanel
 *
 * Idempotent: tears down prior wiring before attaching. Tolerant of
 * partial DOM mocks (missing elements / no addEventListener).
 *
 * @param {Object} state
 * @param {{onChange?:Function, onJump?:Function}} opts
 */
export function wireWinSumToolbar(state, opts) {
  if (typeof document === 'undefined') return;
  teardownWinSumToolbar();

  const l2Sel = document.getElementById('winSumL2Filter');
  const zIn   = document.getElementById('winSumZFilter');
  const head  = document.getElementById('winSumTable');
  const body  = document.getElementById('winSumTableBody');
  const bisnpBtn = document.getElementById('winSumBisnpInfoBtn');
  const bisnpPanel = document.getElementById('winSumBisnpInfoPanel');

  const onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : null;
  const onJump   = (opts && typeof opts.onJump   === 'function') ? opts.onJump   : null;

  // Seed missing filter state with defaults
  if (state) {
    if (!state.winSumFilters || typeof state.winSumFilters !== 'object') {
      state.winSumFilters = { l2: '', zMin: 0 };
    }
    if (typeof state.winSumSortKey !== 'string') state.winSumSortKey = 'idx';
    if (state.winSumSortDir !== 'desc') state.winSumSortDir = 'asc';
    if (typeof state.winSumColorMode !== 'string') state.winSumColorMode = 'z';
  }

  _l2ChangeHandler = (evt) => {
    if (!state) return;
    const v = evt && evt.target ? String(evt.target.value || '') : '';
    state.winSumFilters.l2 = v;
    renderPage8(state);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };
  _zChangeHandler = (evt) => {
    if (!state) return;
    const raw = evt && evt.target ? evt.target.value : null;
    const n = raw === '' || raw == null ? 0 : Number(raw);
    state.winSumFilters.zMin = Number.isFinite(n) ? Math.max(0, n) : 0;
    renderPage8(state);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };
  _headClickHandler = (evt) => {
    if (!state) return;
    const t = evt && evt.target;
    if (!t) return;
    // Walk up to nearest th with data-sort
    let th = t;
    while (th && th !== head) {
      if (th.getAttribute && th.getAttribute('data-sort')) break;
      th = th.parentNode;
    }
    if (!th || !th.getAttribute) return;
    const k = th.getAttribute('data-sort');
    if (!k) return;
    if (state.winSumSortKey === k) {
      state.winSumSortDir = state.winSumSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.winSumSortKey = k;
      state.winSumSortDir = 'asc';
    }
    state.winSumColorMode = k;
    renderPage8(state);
    if (onChange) { try { onChange(state); } catch (_) {} }
  };
  _bodyClickHandler = (evt) => {
    const t = evt && evt.target;
    if (!t) return;
    const goAttr = t.getAttribute ? t.getAttribute('data-go') : null;
    if (goAttr != null) {
      const idx = parseInt(goAttr, 10);
      if (Number.isFinite(idx) && onJump) { try { onJump(idx); } catch (_) {} }
      return;
    }
    // Row click — walk up to <tr>
    let tr = t;
    while (tr && tr !== body) {
      if (tr.getAttribute && tr.getAttribute('data-idx') != null) break;
      tr = tr.parentNode;
    }
    if (!tr || !tr.getAttribute) return;
    const idxAttr = tr.getAttribute('data-idx');
    if (idxAttr == null) return;
    const idx = parseInt(idxAttr, 10);
    if (Number.isFinite(idx) && onJump) { try { onJump(idx); } catch (_) {} }
  };
  _bisnpToggleHandler = () => {
    if (!bisnpPanel || !bisnpPanel.style) return;
    bisnpPanel.style.display = bisnpPanel.style.display === 'none' ? 'block' : 'none';
  };

  if (_canListen(l2Sel))    l2Sel.addEventListener('change',  _l2ChangeHandler);
  if (_canListen(zIn))      zIn.addEventListener('input',     _zChangeHandler);
  if (_canListen(head))     head.addEventListener('click',    _headClickHandler);
  if (_canListen(body))     body.addEventListener('click',    _bodyClickHandler);
  if (_canListen(bisnpBtn)) bisnpBtn.addEventListener('click', _bisnpToggleHandler);
}

/** Remove handlers wired by wireWinSumToolbar. Idempotent. */
export function teardownWinSumToolbar() {
  if (typeof document === 'undefined') return;
  if (_l2ChangeHandler) {
    const el = document.getElementById('winSumL2Filter');
    if (_canListen(el)) el.removeEventListener('change', _l2ChangeHandler);
    _l2ChangeHandler = null;
  }
  if (_zChangeHandler) {
    const el = document.getElementById('winSumZFilter');
    if (_canListen(el)) el.removeEventListener('input', _zChangeHandler);
    _zChangeHandler = null;
  }
  if (_headClickHandler) {
    const el = document.getElementById('winSumTable');
    if (_canListen(el)) el.removeEventListener('click', _headClickHandler);
    _headClickHandler = null;
  }
  if (_bodyClickHandler) {
    const el = document.getElementById('winSumTableBody');
    if (_canListen(el)) el.removeEventListener('click', _bodyClickHandler);
    _bodyClickHandler = null;
  }
  if (_bisnpToggleHandler) {
    const el = document.getElementById('winSumBisnpInfoBtn');
    if (_canListen(el)) el.removeEventListener('click', _bisnpToggleHandler);
    _bisnpToggleHandler = null;
  }
}
