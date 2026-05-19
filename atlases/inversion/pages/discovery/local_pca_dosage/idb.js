// pages/discovery/local_pca_dosage/idb.js
//
// IndexedDB persistence layer (legacy lines 54300-54402). Caches
// chromosome JSONs + enrichment files across page reloads so the user
// doesn't re-drop the same files on every session.
//
// Three object stores in db `pca_scrubber_v3.json_cache`:
//   chromCache    — keyPath 'chrom', one record per chromosome
//   enrichments   — keyPath 'key', one record per loaded enrichment file
//   meta          — keyPath 'k', config-style key-value entries
//                   (e.g. activeChrom = last-loaded chromosome name)
//
// All helpers return Promises. Failure modes are silent (logged to
// console.warn). In headless environments (no indexedDB global) every
// call rejects/no-ops without throwing — pages can call them
// unconditionally.

// =====================================================================
// Constants (legacy lines 54308-54312)
// =====================================================================

export const IDB_NAME           = 'pca_scrubber_v3.json_cache';
export const IDB_VERSION        = 1;
export const IDB_STORE_CHROM    = 'chromCache';
export const IDB_STORE_ENRICH   = 'enrichments';
export const IDB_STORE_META     = 'meta';

// =====================================================================
// Module-local open handle (one connection per app)
// =====================================================================

let _openPromise = null;

/**
 * Reset the module-local open promise. Useful in tests that swap
 * the indexedDB shim between cases.
 */
export function _resetIdbForTests() {
  _openPromise = null;
}

/**
 * Open (or reuse) the IndexedDB connection. Rejects when the
 * environment has no `indexedDB` global. Idempotent — subsequent
 * calls return the same Promise.
 */
export function idbOpen() {
  if (_openPromise) return _openPromise;
  _openPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_CHROM)) {
        db.createObjectStore(IDB_STORE_CHROM, { keyPath: 'chrom' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_ENRICH)) {
        db.createObjectStore(IDB_STORE_ENRICH, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_META)) {
        db.createObjectStore(IDB_STORE_META, { keyPath: 'k' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _openPromise;
}

// =====================================================================
// Primitive CRUD (legacy lines 54343-54379)
// =====================================================================

/** Put a record into `store`. Resolves when committed. */
export function idbPut(store, value) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  }));
}

/** Return all records from `store` as an array (empty when none). */
export function idbGetAll(store) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = (e) => reject(e.target.error);
  }));
}

/** Fetch one record by its key. Resolves null if missing. */
export function idbGet(store, key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = (e) => resolve(e.target.result || null);
    req.onerror = (e) => reject(e.target.error);
  }));
}

/** Clear all three stores in one transaction. */
export function idbClearAll() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORE_CHROM, IDB_STORE_ENRICH, IDB_STORE_META], 'readwrite');
    tx.objectStore(IDB_STORE_CHROM).clear();
    tx.objectStore(IDB_STORE_ENRICH).clear();
    tx.objectStore(IDB_STORE_META).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  }));
}

// =====================================================================
// Application-level persistence (legacy lines 54384-54402)
// =====================================================================

/**
 * Persist a chromosome JSON. Records `{ chrom, data, savedAt }` to the
 * chromCache store and stamps `meta.activeChrom = data.chrom` so the
 * next session can restore the same chromosome. Fail-soft (logs).
 *
 * @param {{chrom: string}} data
 * @returns {Promise<void>}
 */
export function idbPersistChrom(data) {
  if (!data || !data.chrom) return Promise.resolve();
  const record = { chrom: data.chrom, data, savedAt: Date.now() };
  return idbPut(IDB_STORE_CHROM, record)
    .then(() => idbPut(IDB_STORE_META, { k: 'activeChrom', v: data.chrom }))
    .catch(err => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[idb] persist chrom failed:',
                     err && err.message ? err.message : err);
      }
    });
}

/**
 * Persist a single enrichment JSON, keyed by `name`. Re-puts overwrite
 * any prior record with the same name. Fail-soft.
 */
export function idbPersistEnrichment(name, data) {
  const record = { key: name, name, data, savedAt: Date.now() };
  return idbPut(IDB_STORE_ENRICH, record).catch(err => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[idb] persist enrichment failed:', name,
                   err && err.message ? err.message : err);
    }
  });
}
