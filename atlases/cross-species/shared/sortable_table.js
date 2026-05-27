// atlases/cross-species/shared/sortable_table.js
// =====================================================================
// Tiny helpers for the read-only data tables in the cross-species
// atlas (bp_atlas_reciprocity, bp_catalogue, future BP / synteny
// inspectors). The helpers are intentionally minimal — they wire UI
// affordances (click sort, debounced filter) but leave actual row
// sorting + filtering to the page, which already owns the row model.
//
// No DOM polyfill assumed — every browser API is wrapped in a typeof
// check so the helpers no-op cleanly under Node-side smoke tests.
// =====================================================================

const SORT_GLYPH = { asc: ' ▲', desc: ' ▼' };

/**
 * Wire sortable column headers on a table.
 *
 * Header cells must carry `data-field="<key>"`. Optional `data-type`
 * controls how the page is expected to compare values ('num' | 'str');
 * the helper just forwards it to onSort so the caller's comparator
 * can branch.
 *
 * Clicking a header cycles asc → desc → asc on that field. Switching
 * fields resets the direction to 'asc'. The helper writes the current
 * sort onto the table as `data-sort-field` + `data-sort-dir`, and
 * appends a ▲/▼ glyph to the active header.
 *
 * @param {HTMLTableElement} tableEl
 * @param {Object} opts
 * @param {(field:string, dir:'asc'|'desc', type:string|null)=>void} opts.onSort
 * @param {{field:string, dir:'asc'|'desc'}} [opts.initial]
 * @returns {{ teardown: Function, setSort: Function }}
 */
export function wireSortableHeaders(tableEl, opts) {
  if (!tableEl || typeof document === 'undefined') {
    return { teardown: () => {}, setSort: () => {} };
  }
  const o = opts || {};
  const onSort = typeof o.onSort === 'function' ? o.onSort : () => {};

  const ths = tableEl.querySelectorAll ? tableEl.querySelectorAll('th[data-field]') : [];
  const fieldOf = (th) => th && th.getAttribute && th.getAttribute('data-field');
  const typeOf  = (th) => th && th.getAttribute && th.getAttribute('data-type');

  // Cache original header text so repeated sorts don't accumulate glyphs.
  for (let i = 0; i < ths.length; i++) {
    const th = ths[i];
    if (!th.dataset || !('originalText' in th.dataset)) {
      const orig = (th.textContent || '').replace(/[  ]*[▲▼][  ]*$/, '');
      th.dataset.originalText = orig;
      th.textContent = orig;
      // cursor/user-select are owned by CSS
      // (.cs-bp-table thead th[data-field]) — wiring them here
      // would shadow the stylesheet rule.
    }
  }

  let curField = o.initial && o.initial.field || null;
  let curDir   = o.initial && o.initial.dir   || 'asc';

  function applyVisual() {
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      const f = fieldOf(th);
      const orig = th.dataset && th.dataset.originalText || (th.textContent || '');
      th.textContent = (f && f === curField)
        ? orig + (SORT_GLYPH[curDir] || '')
        : orig;
    }
    if (typeof tableEl.setAttribute === 'function') {
      if (curField) {
        tableEl.setAttribute('data-sort-field', curField);
        tableEl.setAttribute('data-sort-dir',   curDir);
      } else {
        if (typeof tableEl.removeAttribute === 'function') {
          tableEl.removeAttribute('data-sort-field');
          tableEl.removeAttribute('data-sort-dir');
        }
      }
    }
  }

  function setSort(field, dir) {
    if (!field) return;
    curField = field;
    curDir   = (dir === 'desc') ? 'desc' : 'asc';
    applyVisual();
    const ty = _findTypeFor(ths, field);
    onSort(curField, curDir, ty);
  }

  const handlers = [];
  for (let i = 0; i < ths.length; i++) {
    const th = ths[i];
    const cb = () => {
      const f = fieldOf(th);
      if (!f) return;
      if (f === curField) {
        curDir = (curDir === 'asc') ? 'desc' : 'asc';
      } else {
        curField = f;
        curDir   = 'asc';
      }
      applyVisual();
      onSort(curField, curDir, typeOf(th));
    };
    if (typeof th.addEventListener === 'function') th.addEventListener('click', cb);
    handlers.push({ th, cb });
  }

  applyVisual();

  function teardown() {
    for (const { th, cb } of handlers) {
      try { th.removeEventListener('click', cb); } catch (_) {}
    }
  }
  return { teardown, setSort };
}

function _findTypeFor(ths, field) {
  for (let i = 0; i < ths.length; i++) {
    const th = ths[i];
    if (th.getAttribute && th.getAttribute('data-field') === field) {
      return th.getAttribute('data-type');
    }
  }
  return null;
}

/**
 * Wire a debounced text-filter input. Calls `onChange(text)` after
 * `debounceMs` of no further keystrokes.
 *
 * @param {HTMLInputElement} inputEl
 * @param {Object} opts
 * @param {(text:string)=>void} opts.onChange
 * @param {number} [opts.debounceMs=120]
 * @returns {{ teardown: Function }}
 */
export function wireRowFilter(inputEl, opts) {
  if (!inputEl || typeof document === 'undefined') {
    return { teardown: () => {} };
  }
  const o = opts || {};
  const onChange = typeof o.onChange === 'function' ? o.onChange : () => {};
  const debounceMs = Number.isFinite(o.debounceMs) ? o.debounceMs : 120;
  let timer = null;
  const cb = () => {
    if (timer != null) clearTimeout(timer);
    const v = (inputEl.value != null) ? String(inputEl.value) : '';
    timer = setTimeout(() => { timer = null; onChange(v); }, debounceMs);
  };
  if (typeof inputEl.addEventListener === 'function') {
    inputEl.addEventListener('input', cb);
  }
  return {
    teardown: () => {
      try { inputEl.removeEventListener('input', cb); } catch (_) {}
      if (timer != null) clearTimeout(timer);
    },
  };
}

/**
 * Comparator factory matching the data-type protocol on
 * `wireSortableHeaders`. Pages can use this as their default
 * comparator, falling back to custom logic for richer cells.
 *
 * @param {string} field
 * @param {'asc'|'desc'} dir
 * @param {string|null} type   'num' | 'str' (or null → str)
 * @returns {(a:Object, b:Object)=>number}
 */
export function makeComparator(field, dir, type) {
  const sign = (dir === 'desc') ? -1 : 1;
  const num  = (type === 'num');
  return (a, b) => {
    let av = (a && a[field]); let bv = (b && b[field]);
    if (num) {
      const af = parseFloat(av), bf = parseFloat(bv);
      const aOk = Number.isFinite(af), bOk = Number.isFinite(bf);
      if (!aOk && !bOk) return 0;
      if (!aOk) return  1;   // empty values sink to the bottom
      if (!bOk) return -1;
      return (af - bf) * sign;
    }
    av = (av == null) ? '' : String(av);
    bv = (bv == null) ? '' : String(bv);
    if (av === '' && bv === '') return 0;
    if (av === '') return  1;
    if (bv === '') return -1;
    return av.localeCompare(bv) * sign;
  };
}

/**
 * Row filter: returns the subset of `rows` whose value at any of
 * `fields` contains `text` (case-insensitive substring). When `text`
 * is empty, returns the original array unchanged.
 *
 * @param {Object[]} rows
 * @param {string}   text
 * @param {string[]} fields
 * @returns {Object[]}
 */
export function filterRows(rows, text, fields) {
  if (!Array.isArray(rows)) return [];
  if (!text) return rows;
  const needle = String(text).toLowerCase();
  if (!Array.isArray(fields) || fields.length === 0) {
    return rows.filter((r) => _rowMatchesAnyField(r, needle));
  }
  return rows.filter((r) => {
    for (const f of fields) {
      const v = r && r[f];
      if (v != null && String(v).toLowerCase().indexOf(needle) >= 0) return true;
    }
    return false;
  });
}

function _rowMatchesAnyField(r, needle) {
  if (!r || typeof r !== 'object') return false;
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (v != null && String(v).toLowerCase().indexOf(needle) >= 0) return true;
  }
  return false;
}
