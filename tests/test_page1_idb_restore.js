// tests/test_page1_idb_restore.js
//
// Integration tests for pages/discovery/page1/idb_restore.js — the
// session-restore orchestrator that replays IndexedDB cache contents
// at app startup. Uses the same in-memory IDB shim as test_page1_idb.js
// plus a minimal document shim so refreshChromSelect's DOM path runs.

import {
  restoreFromIdb,
  replayEnrichmentsFromIdb,
  cachedChromNames,
} from '../atlases/inversion/pages/discovery/page1/idb_restore.js';
import {
  IDB_STORE_CHROM,
  IDB_STORE_ENRICH,
  IDB_STORE_META,
  idbPut,
  _resetIdbForTests,
} from '../atlases/inversion/pages/discovery/page1/idb.js';
import {
  clearChromCache,
} from '../atlases/inversion/pages/discovery/page1/chrom_cache.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
// IndexedDB shim (same shape as test_page1_idb.js — copied for isolation)
// =====================================================================
function installIndexedDB() {
  function makeReq(result) {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
    return req;
  }
  function makeStore(keyPath) {
    const map = new Map();
    return {
      keyPath, map,
      put(value) { map.set(value[keyPath], value); return makeReq(); },
      get(key) { return makeReq(map.has(key) ? map.get(key) : undefined); },
      getAll() { return makeReq(Array.from(map.values())); },
      clear() { map.clear(); return makeReq(); },
    };
  }
  function makeDb() {
    const stores = {
      chromCache: makeStore('chrom'),
      enrichments: makeStore('key'),
      meta: makeStore('k'),
    };
    return {
      objectStoreNames: { contains: (n) => n in stores },
      createObjectStore(n, opts) {
        stores[n] = makeStore(opts && opts.keyPath);
        return stores[n];
      },
      transaction(storeNames /* , mode */) {
        const tx = {
          oncomplete: null, onerror: null,
          objectStore(n) { return stores[n]; },
        };
        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        return tx;
      },
    };
  }
  globalThis.indexedDB = {
    open() {
      const req = { result: null, onsuccess: null, onupgradeneeded: null, onerror: null };
      queueMicrotask(() => {
        req.result = makeDb();
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
  _resetIdbForTests();
}
function uninstallIndexedDB() { delete globalThis.indexedDB; _resetIdbForTests(); }

// =====================================================================
// Document shim (just enough for refreshChromSelect to run)
// =====================================================================
function installDocument() {
  const sel = {
    innerHTML: '', disabled: false, children: [], style: {},
    appendChild(node) { this.children.push(node); },
  };
  globalThis.document = {
    getElementById(id) { return id === 'chromSelect' ? sel : null; },
    createElement(_) {
      return { value: '', textContent: '', selected: false, style: {} };
    },
    _selectElement: sel,
  };
  return sel;
}
function uninstallDocument() { delete globalThis.document; }

function makeChromData(chrom, n_windows) {
  return {
    chrom, n_windows,
    windows: Array.from({ length: n_windows }, (_, i) => ({ center_mb: i })),
  };
}

// =====================================================================
group('headless / empty paths');
{
  uninstallIndexedDB();
  const result = await restoreFromIdb({});
  check('no indexedDB → null',  result === null);
}

{
  installIndexedDB();
  clearChromCache();
  const result = await restoreFromIdb({});
  check('empty IDB → null',     result === null);
  uninstallIndexedDB();
}

// =====================================================================
group('restore: chroms only, no active marker → picks most recent');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  // Pre-populate IDB: 2 chroms, older + newer; no activeChrom meta.
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: makeChromData('LG28', 1500), savedAt: 100 });
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG07', data: makeChromData('LG07', 800),  savedAt: 200 });

  const applied = [];
  const result = await restoreFromIdb({}, { applyData: (data) => applied.push(data.chrom) });

  check('returns non-null',           result !== null);
  check('n_chroms = 2',               result.n_chroms === 2);
  check('n_enrichments = 0',          result.n_enrichments === 0);
  check('active = LG07 (most-recent savedAt)',
        result.active === 'LG07');
  check('applyData called once',      applied.length === 1);
  check('applyData called with LG07', applied[0] === 'LG07');
  check('chrom cache has 2 entries',  cachedChromNames().length === 2);
  check('chrom cache includes LG28',  cachedChromNames().includes('LG28'));
  check('chrom cache includes LG07',  cachedChromNames().includes('LG07'));
  // Verify refreshChromSelect populated the dropdown
  const sel = globalThis.document._selectElement;
  check('chromSelect has 2 options',  sel.children.length === 2);
  check('chromSelect enabled',        sel.disabled === false);

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('restore: active marker overrides most-recent');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: makeChromData('LG28', 1500), savedAt: 100 });
  await idbPut(IDB_STORE_CHROM, { chrom: 'LG07', data: makeChromData('LG07', 800),  savedAt: 200 });
  await idbPut(IDB_STORE_META,  { k: 'activeChrom', v: 'LG28' });

  const applied = [];
  const result = await restoreFromIdb({}, { applyData: (data) => applied.push(data.chrom) });

  check('active = LG28 (meta override)',  result.active === 'LG28');
  check('applyData called with LG28',      applied[0] === 'LG28');

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('restore: active marker for chrom not in cache → falls back to most-recent');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: makeChromData('LG28', 1500), savedAt: 100 });
  await idbPut(IDB_STORE_META,  { k: 'activeChrom', v: 'LG99_MISSING' });

  const applied = [];
  const result = await restoreFromIdb({}, { applyData: (data) => applied.push(data.chrom) });

  check('active marker fell back to LG28',  result.active === 'LG28');
  check('applyData called with LG28',        applied[0] === 'LG28');

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('restore: applyData failure logged, restore continues');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: makeChromData('LG28', 1500), savedAt: 100 });

  let threw = false;
  let result;
  try {
    result = await restoreFromIdb({}, {
      applyData() { throw new Error('boom'); },
    });
  } catch (_) { threw = true; }
  check('restore catches applyData throw',  !threw);
  check('result still returned',             result !== null);
  check('active still set despite throw',    result.active === 'LG28');

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('restore: enrichments merged onto active chrom');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  await idbPut(IDB_STORE_CHROM, { chrom: 'LG28', data: makeChromData('LG28', 1500), savedAt: 100 });
  await idbPut(IDB_STORE_META,  { k: 'activeChrom', v: 'LG28' });
  await idbPut(IDB_STORE_ENRICH, {
    key: 'sv_evidence.json', name: 'sv_evidence.json', savedAt: 110,
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['sv_evidence'],
      sv_evidence: { confirmed: ['s1', 's2'] },
    },
  });

  // The applyData callback populates state.data + state.layersPresent
  // so the subsequent enrichment merge can run.
  const state = {};
  const applyData = (data) => {
    state.data = Object.assign({}, data, { _layers_present: ['windows', 'samples'] });
    state.layersPresent = new Set(['windows', 'samples']);
  };

  const result = await restoreFromIdb(state, { applyData });
  check('n_enrichments = 1',                 result.n_enrichments === 1);
  check('enrichment merged: sv_evidence',
        state.data.sv_evidence && state.data.sv_evidence.confirmed.length === 2);
  check('layersPresent grew',
        state.layersPresent.has('sv_evidence'));

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('restore: enrichments only, no chrom → returns metadata anyway');
{
  installIndexedDB();
  clearChromCache();
  installDocument();

  await idbPut(IDB_STORE_ENRICH, {
    key: 'orphan.json', name: 'orphan.json', savedAt: 50,
    data: { schema_version: 2, _layers_present: ['classification'],
            classification: { x: 1 } },
  });

  const result = await restoreFromIdb({});
  check('n_chroms = 0, n_enrichments = 1, active = null',
        result.n_chroms === 0
        && result.n_enrichments === 1
        && result.active === null);

  uninstallDocument();
  uninstallIndexedDB();
}

// =====================================================================
group('replayEnrichmentsFromIdb — headless / empty paths');
{
  uninstallIndexedDB();
  const n = await replayEnrichmentsFromIdb({ data: { chrom: 'LG28' } });
  check('no indexedDB → 0', n === 0);
}
{
  installIndexedDB();
  const n = await replayEnrichmentsFromIdb(null);
  check('null state → 0', n === 0);
  const n2 = await replayEnrichmentsFromIdb({});
  check('state without data → 0', n2 === 0);
  const n3 = await replayEnrichmentsFromIdb({ data: {} });
  check('state without chrom → 0', n3 === 0);
  uninstallIndexedDB();
}
{
  installIndexedDB();
  const n = await replayEnrichmentsFromIdb({ data: { chrom: 'LG28' } });
  check('empty enrichments store → 0', n === 0);
  uninstallIndexedDB();
}

// =====================================================================
group('replayEnrichmentsFromIdb — chrom filtering');
{
  installIndexedDB();
  // Three enrichments: two for LG28, one for LG07
  await idbPut(IDB_STORE_ENRICH, {
    key: 'sv.json', name: 'sv.json', savedAt: 1,
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['sv_evidence'],
      sv_evidence: { confirmed: ['s1'] },
    },
  });
  await idbPut(IDB_STORE_ENRICH, {
    key: 'cls.json', name: 'cls.json', savedAt: 2,
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['classification'],
      classification: { result: 'PASS' },
    },
  });
  await idbPut(IDB_STORE_ENRICH, {
    key: 'other.json', name: 'other.json', savedAt: 3,
    data: {
      schema_version: 2, chrom: 'LG07',
      _layers_present: ['gene_cargo'],
      gene_cargo: { genes: ['X'] },
    },
  });

  const state = {
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['windows', 'samples'],
      windows: [{}], n_windows: 1, samples: [{}],
    },
    layersPresent: new Set(['windows', 'samples']),
  };
  const n = await replayEnrichmentsFromIdb(state);
  check('LG28 state: 2 enrichments merged',  n === 2);
  check('sv_evidence merged onto state.data',
        state.data.sv_evidence && state.data.sv_evidence.confirmed[0] === 's1');
  check('classification merged onto state.data',
        state.data.classification && state.data.classification.result === 'PASS');
  check('LG07-only enrichment NOT merged',
        !state.data.gene_cargo);
  check('layersPresent grew by 2',
        state.layersPresent.has('sv_evidence')
        && state.layersPresent.has('classification')
        && !state.layersPresent.has('gene_cargo'));

  uninstallIndexedDB();
}

// =====================================================================
group('replayEnrichmentsFromIdb — already-present layer is not re-counted');
{
  installIndexedDB();
  await idbPut(IDB_STORE_ENRICH, {
    key: 'sv.json', name: 'sv.json', savedAt: 1,
    data: {
      schema_version: 2, chrom: 'LG28',
      _layers_present: ['sv_evidence'],
      sv_evidence: { confirmed: ['stale'] },
    },
  });
  const state = {
    data: {
      chrom: 'LG28', schema_version: 2,
      _layers_present: ['windows', 'samples', 'sv_evidence'],
      windows: [{}], n_windows: 1, samples: [{}],
      sv_evidence: { confirmed: ['original'] },
    },
    layersPresent: new Set(['windows', 'samples', 'sv_evidence']),
  };
  const n = await replayEnrichmentsFromIdb(state);
  check('already-present layer: 0 merges counted', n === 0);
  check('original payload preserved',
        state.data.sv_evidence.confirmed[0] === 'original');
  uninstallIndexedDB();
}

// =====================================================================
group('replayEnrichmentsFromIdb — chrom-less enrichment is accepted');
{
  installIndexedDB();
  // No chrom field on the enrichment → mergeEnrichmentLayers accepts it.
  await idbPut(IDB_STORE_ENRICH, {
    key: 'anycap.json', name: 'anycap.json', savedAt: 1,
    data: {
      schema_version: 2,
      _layers_present: ['ghsl_panel'],
      ghsl_panel: { samples: ['s1'], div_roll: {} },
    },
  });
  const state = {
    data: {
      chrom: 'LG28', schema_version: 2,
      _layers_present: ['windows', 'samples'],
      windows: [{}], n_windows: 1, samples: [{}],
    },
    layersPresent: new Set(['windows', 'samples']),
  };
  const n = await replayEnrichmentsFromIdb(state);
  check('chrom-less enrichment merged', n === 1 && state.data.ghsl_panel);
  uninstallIndexedDB();
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
