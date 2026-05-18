// tests/test_page1_idb.js
//
// Unit tests for pages/discovery/local_pca_dosage/idb.js — IndexedDB persistence
// layer. Uses a minimal in-memory shim that implements the small slice
// of the IDB Promise-wrapped API the module uses (open + put + get +
// getAll + clear + transactional commit). No real IndexedDB needed.

import {
  IDB_NAME,
  IDB_VERSION,
  IDB_STORE_CHROM,
  IDB_STORE_ENRICH,
  IDB_STORE_META,
  idbOpen,
  idbPut,
  idbGet,
  idbGetAll,
  idbClearAll,
  idbPersistChrom,
  idbPersistEnrichment,
  _resetIdbForTests,
} from '../atlases/inversion/pages/discovery/local_pca_dosage/idb.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// Minimal IndexedDB shim
// =====================================================================
function installIndexedDB() {
  // Each store is a Map keyed by the keyPath value. After a "transaction"
  // completes synchronously we fire success in a microtask so the
  // Promise wrappers in idb.js see the same async ordering as real IDB.

  function makeStore(keyPath) {
    const map = new Map();
    return {
      keyPath, map,
      put(value) {
        const key = value[keyPath];
        map.set(key, value);
        return makeReq();
      },
      get(key) {
        const result = map.has(key) ? map.get(key) : undefined;
        return makeReq(result);
      },
      getAll() {
        return makeReq(Array.from(map.values()));
      },
      clear() {
        map.clear();
        return makeReq();
      },
    };
  }

  function makeReq(result) {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (req.onsuccess) req.onsuccess({ target: req });
    });
    return req;
  }

  function makeDb() {
    const stores = {
      [IDB_STORE_CHROM]: makeStore('chrom'),
      [IDB_STORE_ENRICH]: makeStore('key'),
      [IDB_STORE_META]:  makeStore('k'),
    };
    const objectStoreNames = {
      contains(name) { return name in stores; },
    };
    return {
      objectStoreNames,
      createObjectStore(name, opts) {
        stores[name] = makeStore(opts && opts.keyPath);
        return stores[name];
      },
      transaction(storeNames /* string | string[] */, mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const tx = {
          oncomplete: null,
          onerror: null,
          _used: 0,
          objectStore(name) {
            const s = stores[name];
            tx._used++;
            return s;
          },
        };
        // Commit at the end of the microtask queue
        queueMicrotask(() => {
          if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
      },
      _stores: stores,
    };
  }

  let installedDb = null;
  globalThis.indexedDB = {
    open(name, version) {
      const req = {
        result: null,
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
      };
      queueMicrotask(() => {
        const db = makeDb();
        installedDb = db;
        req.result = db;
        // First-open onupgradeneeded
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _getDb() { return installedDb; },
  };
  _resetIdbForTests();
}
function uninstallIndexedDB() {
  delete globalThis.indexedDB;
  _resetIdbForTests();
}

// =====================================================================
group('constants');
check('IDB_NAME',           IDB_NAME === 'pca_scrubber_v3.json_cache');
check('IDB_VERSION',        IDB_VERSION === 1);
check('IDB_STORE_CHROM',    IDB_STORE_CHROM === 'chromCache');
check('IDB_STORE_ENRICH',   IDB_STORE_ENRICH === 'enrichments');
check('IDB_STORE_META',     IDB_STORE_META === 'meta');

// =====================================================================
group('headless behaviour (no indexedDB global)');
{
  uninstallIndexedDB();
  let rejected = false;
  await idbOpen().catch(() => { rejected = true; });
  check('idbOpen() rejects when no indexedDB', rejected);
}
{
  // idbPersistChrom catches its own IDB errors → resolves regardless.
  let threw = false;
  await idbPersistChrom({ chrom: 'LG28' }).catch(() => { threw = true; });
  check('idbPersistChrom resolves fail-soft without indexedDB', !threw);
}
{
  let threw = false;
  await idbPersistEnrichment('x.json', { foo: 1 }).catch(() => { threw = true; });
  check('idbPersistEnrichment resolves fail-soft without indexedDB', !threw);
}
{
  let resolved = false;
  await idbPersistChrom(null).then(() => { resolved = true; });
  check('idbPersistChrom(null) resolves with no-op', resolved);
}
{
  let resolved = false;
  await idbPersistChrom({}).then(() => { resolved = true; });
  check('idbPersistChrom({} without chrom) resolves with no-op', resolved);
}

// =====================================================================
group('idbOpen returns a stable promise');
{
  installIndexedDB();
  const p1 = idbOpen();
  const p2 = idbOpen();
  check('two opens share the same Promise', p1 === p2);
  const db = await p1;
  check('resolves to a db handle', db && typeof db.transaction === 'function');
  uninstallIndexedDB();
}

// =====================================================================
group('CRUD round-trip via shimmed IDB');
{
  installIndexedDB();
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: { n_windows: 100 }, savedAt: 1 });
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG07', data: { n_windows: 200 }, savedAt: 2 });
  const got28 = await idbGet(IDB_STORE_CHROM, 'LG28');
  check('idbGet returns the put record',  got28 && got28.data.n_windows === 100);
  check('idbGet preserves savedAt',       got28.savedAt === 1);

  const got99 = await idbGet(IDB_STORE_CHROM, 'LG99');
  check('idbGet missing key → null',       got99 === null);

  const all = await idbGetAll(IDB_STORE_CHROM);
  check('idbGetAll returns 2 records',    Array.isArray(all) && all.length === 2);

  // Re-put on same key overwrites
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: { n_windows: 999 }, savedAt: 3 });
  const got28b = await idbGet(IDB_STORE_CHROM, 'LG28');
  check('re-put overwrites',              got28b.data.n_windows === 999);
  check('re-put still 2 total records',
        (await idbGetAll(IDB_STORE_CHROM)).length === 2);
  uninstallIndexedDB();
}

// =====================================================================
group('idbClearAll wipes every store');
{
  installIndexedDB();
  await idbPut(IDB_STORE_CHROM,  { chrom: 'LG28', data: {}, savedAt: 1 });
  await idbPut(IDB_STORE_ENRICH, { key: 'enrich.json', name: 'enrich.json', data: {}, savedAt: 2 });
  await idbPut(IDB_STORE_META,   { k: 'activeChrom', v: 'LG28' });

  await idbClearAll();
  check('chrom store cleared',  (await idbGetAll(IDB_STORE_CHROM)).length === 0);
  check('enrich store cleared', (await idbGetAll(IDB_STORE_ENRICH)).length === 0);
  check('meta store cleared',   (await idbGetAll(IDB_STORE_META)).length === 0);
  uninstallIndexedDB();
}

// =====================================================================
group('idbPersistChrom round-trip');
{
  installIndexedDB();
  const chromData = { chrom: 'LG28', n_windows: 1500, samples: [] };
  await idbPersistChrom(chromData);

  const stored = await idbGet(IDB_STORE_CHROM, 'LG28');
  check('chrom data persisted',     stored && stored.data.n_windows === 1500);
  check('savedAt timestamp set',    typeof stored.savedAt === 'number' && stored.savedAt > 0);

  const active = await idbGet(IDB_STORE_META, 'activeChrom');
  check('meta.activeChrom set to LG28',  active && active.v === 'LG28');

  // Another chrom flips the activeChrom marker
  await idbPersistChrom({ chrom: 'LG07', n_windows: 800 });
  const active2 = await idbGet(IDB_STORE_META, 'activeChrom');
  check('meta.activeChrom updates on new persist',
        active2 && active2.v === 'LG07');
  check('both chrom records present',
        (await idbGetAll(IDB_STORE_CHROM)).length === 2);
  uninstallIndexedDB();
}

// =====================================================================
group('idbPersistEnrichment round-trip');
{
  installIndexedDB();
  await idbPersistEnrichment('panel_A.json', { mode: 'panel_A', data: [1, 2, 3] });
  await idbPersistEnrichment('panel_B.json', { mode: 'panel_B', data: [4, 5] });

  const all = await idbGetAll(IDB_STORE_ENRICH);
  check('2 enrichment records',          all.length === 2);
  const a = await idbGet(IDB_STORE_ENRICH, 'panel_A.json');
  check('enrichment A retrievable',      a && a.data.mode === 'panel_A');
  check('enrichment carries name field', a && a.name === 'panel_A.json');
  check('enrichment carries savedAt',    typeof a.savedAt === 'number');

  // Re-persist same name overwrites
  await idbPersistEnrichment('panel_A.json', { mode: 'panel_A', data: [99] });
  const aUpd = await idbGet(IDB_STORE_ENRICH, 'panel_A.json');
  check('re-persist overwrites',         aUpd.data.data[0] === 99);
  check('count stays at 2',              (await idbGetAll(IDB_STORE_ENRICH)).length === 2);
  uninstallIndexedDB();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
