// shared/recent_files.js
//
// Recent-files history layer. Records every successfully-parsed JSON
// the user has dropped onto the file picker so the next session can
// remind them WHAT they had loaded. Browser security prevents storing
// the absolute filesystem path; this is purely a friction-reducing
// reminder — the user still has to re-pick the file to actually
// re-open it.
//
// Schema (single LS blob):
//   [
//     { name, size_kb, ts, chrom, n_layers, kind },
//     ...
//   ]
// Capped at RECENT_FILES_MAX entries (oldest dropped when over). Dedup
// is by `name` — re-dropping the same file just refreshes its `ts`.
//
// Legacy origin: lines 55278-55386 of legacy/Inversion_atlas.html.

import { classifyJSONKind } from './json_classify.js';

// =====================================================================
// Constants
// =====================================================================

export const RECENT_FILES_LS_KEY = 'inversion_atlas.recent_files';
export const RECENT_FILES_MAX = 30;

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

// =====================================================================
// API
// =====================================================================

/**
 * Record a freshly-parsed JSON in the recent-files list. Dedupes by
 * `file.name` (re-dropping the same filename just refreshes ts +
 * potentially upgrades the entry's kind / chrom / n_layers). Caps the
 * list at RECENT_FILES_MAX entries. Fail-soft on LS quota / parse
 * errors.
 *
 * `file` is the browser File-shaped object (anything with name / size
 * fields works; size is optional). `data` is the parsed JSON.
 *
 * `detectLayers` is an optional callback (data) → number of layers
 * detected — used to populate n_layers when kind === 'chromosome'.
 * Optional because computing it requires the schema detector from
 * page1's _data.js, which we don't import here to keep this module
 * page-isolated.
 *
 * @param {{name:string, size?:number}} file
 * @param {*} data
 * @param {{detectLayers?: (data:Object) => number}} [opts]
 * @returns {boolean}  true on successful LS write
 */
export function recordRecentJSON(file, data, opts) {
  if (!file || !file.name) return false;
  if (!_hasLocalStorage()) return false;

  let entries = [];
  try {
    const raw = localStorage.getItem(RECENT_FILES_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entries = parsed;
    }
  } catch (_) { /* fail-soft */ }

  const kind = classifyJSONKind(data);
  const chrom = (data && data.chrom)
    || (kind === 'chromosome' ? file.name.replace(/\.json$/, '') : null);
  let nLayers = 0;
  if (kind === 'chromosome' && opts && typeof opts.detectLayers === 'function') {
    try { nLayers = opts.detectLayers(data) || 0; } catch (_) {}
  }

  const entry = {
    name:     file.name,
    size_kb:  Math.round((file.size || 0) / 1024),
    ts:       Date.now(),
    kind,
    chrom:    chrom || null,
    n_layers: nLayers,
  };

  entries = entries.filter(e => e && e.name !== file.name);
  entries.unshift(entry);
  if (entries.length > RECENT_FILES_MAX) entries.length = RECENT_FILES_MAX;

  try {
    localStorage.setItem(RECENT_FILES_LS_KEY, JSON.stringify(entries));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Get the recent-files list (newest first). Returns [] when nothing
 * is recorded or LS isn't available.
 *
 * @returns {Array<{name:string, size_kb:number, ts:number, kind:string,
 *                  chrom:string|null, n_layers:number}>}
 */
export function getRecentJSONs() {
  if (!_hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(RECENT_FILES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** Drop the entire recent-files history. */
export function clearRecentJSONs() {
  if (!_hasLocalStorage()) return;
  try { localStorage.removeItem(RECENT_FILES_LS_KEY); } catch (_) {}
}
