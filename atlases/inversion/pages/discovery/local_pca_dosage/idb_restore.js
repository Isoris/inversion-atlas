// pages/discovery/local_pca_dosage/idb_restore.js
//
// Session-restore orchestrator (legacy lines 54407-54473). On app
// startup, replays everything cached in IndexedDB: chromosome JSONs
// + enrichment files + the last-active chromosome marker. Composes
// local_pca_dosage/idb.js + local_pca_dosage/chrom_cache.js + local_pca_dosage/enrichment.js.
//
// `applyData` is local_pca_dosage's chrom-load entry point. It mutates state and
// kicks off the full panel-render pipeline. It's private to local_pca_dosage.js,
// so this orchestrator takes it as an injected callback rather than
// importing it directly — keeps the dependency direction one-way
// (orchestrator → primitives) and makes the function testable in
// isolation.

import {
  IDB_STORE_CHROM,
  IDB_STORE_ENRICH,
  IDB_STORE_META,
  idbGet,
  idbGetAll,
} from './idb.js';
import {
  setCachedChrom,
  hasCachedChrom,
  getCachedChrom,
  cachedChromNames,
  refreshChromSelect,
} from './chrom_cache.js';
import { mergeEnrichmentLayers } from './enrichment.js';

/**
 * Restore the IndexedDB cache. Returns
 * `{ n_chroms, n_enrichments, active }` on success, or `null` when
 * IDB is unavailable / contains nothing. Resolves regardless of
 * intermediate failures (each is logged via console.warn).
 *
 * @param {Object} state                local_pca_dosage _pageState (mutated)
 * @param {Object} [opts]
 * @param {(data:Object)=>void} [opts.applyData]
 *        Called with the chosen chromosome's data on restore. Without
 *        it, the cache is populated + selector is refreshed but no
 *        chromosome is applied. Page1's applyData is the typical
 *        injection.
 * @returns {Promise<{n_chroms:number, n_enrichments:number, active:string|null}|null>}
 */
export function restoreFromIdb(state, opts) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opts = opts || {};
  return Promise.all([
    idbGetAll(IDB_STORE_CHROM),
    idbGetAll(IDB_STORE_ENRICH),
    idbGet(IDB_STORE_META, 'activeChrom'),
  ]).then(([chroms, enrichments, activeMeta]) => {
    if ((!chroms || chroms.length === 0)
        && (!enrichments || enrichments.length === 0)) {
      return null;
    }

    // Repopulate the in-memory chrom cache.
    if (Array.isArray(chroms)) {
      for (const c of chroms) {
        if (c && c.chrom && c.data) setCachedChrom(c.chrom, c.data);
      }
    }
    // Surface the cached chroms in the #chromSelect dropdown.
    try { refreshChromSelect(state); } catch (_) { /* fail-soft */ }

    // Pick the chromosome to display: last-active, else most-recent
    // by savedAt timestamp.
    let target = null;
    if (activeMeta && activeMeta.v && hasCachedChrom(activeMeta.v)) {
      target = getCachedChrom(activeMeta.v);
    } else if (Array.isArray(chroms) && chroms.length > 0) {
      const sorted = chroms.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      target = sorted[0].data;
    }
    if (target && typeof opts.applyData === 'function') {
      try { opts.applyData(target); }
      catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[idb] applyData on restore failed:',
                       e && e.message ? e.message : e);
        }
      }
    }

    // Merge enrichments — only meaningful when an active chrom is set,
    // since the merge reads state.data.chrom for the mismatch check.
    if (state && state.data && Array.isArray(enrichments)) {
      for (const en of enrichments) {
        if (!en || !en.data) continue;
        try { mergeEnrichmentLayers(state, en.data); }
        catch (e) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[idb] merge enrichment on restore failed:',
                         en.name, e && e.message ? e.message : e);
          }
        }
      }
    }

    return {
      n_chroms: (chroms || []).length,
      n_enrichments: (enrichments || []).length,
      active: target ? target.chrom : null,
    };
  }).catch(err => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[idb] restore failed:', err && err.message ? err.message : err);
    }
    return null;
  });
}

/**
 * Replay cached enrichments onto the active chromosome only. Used by
 * local_pca_dosage.mount() after applyData() has already loaded the chromosome
 * from the shell's registry — we just need to merge any enrichments
 * the user dropped in a prior session.
 *
 * Each enrichment is filtered against state.data.chrom (the merge
 * function rejects chrom-mismatch anyway, but pre-filtering avoids
 * unnecessary work). Returns the number of enrichments that actually
 * merged. Headless-safe / fail-soft.
 *
 * @param {Object} state  local_pca_dosage _pageState with state.data already loaded
 * @returns {Promise<number>}  count of enrichments successfully merged
 */
export function replayEnrichmentsFromIdb(state) {
  if (typeof indexedDB === 'undefined') return Promise.resolve(0);
  if (!state || !state.data || !state.data.chrom) return Promise.resolve(0);
  const chrom = state.data.chrom;
  return idbGetAll(IDB_STORE_ENRICH).then(enrichments => {
    if (!Array.isArray(enrichments) || enrichments.length === 0) return 0;
    let merged = 0;
    for (const en of enrichments) {
      if (!en || !en.data) continue;
      // Pre-filter: only attempt enrichments whose chrom field matches
      // (or is absent — those are accepted by the merge function).
      if (en.data.chrom && en.data.chrom !== chrom) continue;
      try {
        const result = mergeEnrichmentLayers(state, en.data);
        if (result.added && result.added.length > 0) merged++;
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[idb] replay enrichment failed:',
                       en.name, e && e.message ? e.message : e);
        }
      }
    }
    return merged;
  }).catch(err => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[idb] enrichment replay failed:',
                   err && err.message ? err.message : err);
    }
    return 0;
  });
}

// Re-export a few commonly-used accessors so callers don't need to
// import from two modules.
export { cachedChromNames, refreshChromSelect } from './chrom_cache.js';
