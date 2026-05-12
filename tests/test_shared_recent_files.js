// tests/test_shared_recent_files.js

class MockLS {
  constructor() { this.store = new Map(); this.quotaExceeded = false; }
  setItem(k, v) {
    if (this.quotaExceeded) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.store.set(String(k), String(v));
  }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); this.quotaExceeded = false; }
  get length() { return this.store.size; }
  key(i) { const keys = Array.from(this.store.keys()); return i < keys.length ? keys[i] : null; }
}
globalThis.localStorage = new MockLS();

const {
  RECENT_FILES_LS_KEY,
  RECENT_FILES_MAX,
  recordRecentJSON,
  getRecentJSONs,
  clearRecentJSONs,
} = await import('../atlases/inversion/shared/recent_files.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeChromJSON(chrom) {
  return { chrom, n_windows: 100, windows: [{ pos: 0 }] };
}
function makeCrossJSON() {
  return { tool: 'cross_species_breakpoints_v1', schema_version: 1, breakpoints: [] };
}

// =====================================================================
group('constants');
check('LS_KEY matches legacy',                 RECENT_FILES_LS_KEY === 'inversion_atlas.recent_files');
check('MAX = 30',                              RECENT_FILES_MAX === 30);

// =====================================================================
group('recordRecentJSON — basic');
{
  globalThis.localStorage.clear();
  const ok = recordRecentJSON(
    { name: 'LG28.json', size: 1804 * 1024 },
    makeChromJSON('LG28'));
  check('returns true',                         ok === true);
  const list = getRecentJSONs();
  check('1 entry recorded',                     list.length === 1);
  check('name stored',                          list[0].name === 'LG28.json');
  check('size_kb rounded',                      list[0].size_kb === 1804);
  check('kind = chromosome',                    list[0].kind === 'chromosome');
  check('chrom stored',                         list[0].chrom === 'LG28');
  check('ts is recent',                         list[0].ts > 0 && list[0].ts <= Date.now());
  check('n_layers defaults to 0',               list[0].n_layers === 0);
}

// =====================================================================
group('recordRecentJSON — kind classification');
{
  globalThis.localStorage.clear();
  recordRecentJSON({ name: 'cross.json' }, makeCrossJSON());
  check('cross-species kind',                  getRecentJSONs()[0].kind === 'cross_species');

  recordRecentJSON({ name: 'enrich.json' }, { _layers_present: ['het'] });
  check('enrichment kind',                     getRecentJSONs()[0].kind === 'enrichment');

  recordRecentJSON({ name: 'junk.json' }, { random: 'stuff' });
  check('unknown kind',                        getRecentJSONs()[0].kind === 'unknown');
}

// =====================================================================
group('recordRecentJSON — chrom fallback to filename');
{
  globalThis.localStorage.clear();
  // Chromosome JSON without explicit chrom field → fallback to filename
  // without the .json extension
  recordRecentJSON({ name: 'C_gar_LG14.json' }, { n_windows: 10, windows: [{}] });
  check('chrom defaults to filename strip',     getRecentJSONs()[0].chrom === 'C_gar_LG14');
}
{
  globalThis.localStorage.clear();
  // Non-chromosome kind → no chrom fallback
  recordRecentJSON({ name: 'aux.json' }, { _layers_present: [] });
  check('non-chrom kind → chrom = null',        getRecentJSONs()[0].chrom === null);
}

// =====================================================================
group('recordRecentJSON — dedup by name');
{
  globalThis.localStorage.clear();
  recordRecentJSON({ name: 'a.json' }, makeChromJSON('A'));
  recordRecentJSON({ name: 'b.json' }, makeChromJSON('B'));
  recordRecentJSON({ name: 'a.json' }, makeChromJSON('A'));  // re-record
  const list = getRecentJSONs();
  check('still 2 entries (deduped)',            list.length === 2);
  check('re-recorded a.json moved to front',    list[0].name === 'a.json');
  check('b.json moved to position 1',           list[1].name === 'b.json');
}

// =====================================================================
group('recordRecentJSON — cap at MAX');
{
  globalThis.localStorage.clear();
  for (let i = 0; i < RECENT_FILES_MAX + 5; i++) {
    recordRecentJSON({ name: `f${i}.json` }, makeChromJSON(`C${i}`));
  }
  const list = getRecentJSONs();
  check(`capped at ${RECENT_FILES_MAX}`,         list.length === RECENT_FILES_MAX);
  // Newest at front (= f34), oldest dropped (= f0 through f4)
  check('newest entry first',                   list[0].name === `f${RECENT_FILES_MAX + 4}.json`);
  check('oldest preserved',                     list[RECENT_FILES_MAX - 1].name === 'f5.json');
}

// =====================================================================
group('recordRecentJSON — opts.detectLayers');
{
  globalThis.localStorage.clear();
  const detectLayers = (data) => 8;
  recordRecentJSON({ name: 'lg.json' }, makeChromJSON('LG28'), { detectLayers });
  check('detectLayers populates n_layers',      getRecentJSONs()[0].n_layers === 8);
}
{
  globalThis.localStorage.clear();
  // detectLayers throws → caught, n_layers stays 0
  const detectLayers = () => { throw new Error('boom'); };
  recordRecentJSON({ name: 'lg.json' }, makeChromJSON('LG28'), { detectLayers });
  check('detectLayers throw: caught, n_layers = 0', getRecentJSONs()[0].n_layers === 0);
}
{
  globalThis.localStorage.clear();
  // detectLayers only called for chromosome kind
  let called = false;
  const detectLayers = () => { called = true; return 5; };
  recordRecentJSON({ name: 'cross.json' }, makeCrossJSON(), { detectLayers });
  check('detectLayers NOT called for non-chrom kind', called === false);
}

// =====================================================================
group('recordRecentJSON — input validation');
check('null file → false',                     recordRecentJSON(null, makeChromJSON('X')) === false);
check('no name → false',                       recordRecentJSON({}, makeChromJSON('X')) === false);
check('empty name → false',                    recordRecentJSON({ name: '' }, makeChromJSON('X')) === false);
{
  // Missing file.size → size_kb = 0
  globalThis.localStorage.clear();
  recordRecentJSON({ name: 'x.json' }, makeChromJSON('X'));
  check('missing file.size → size_kb = 0',     getRecentJSONs()[0].size_kb === 0);
}

// =====================================================================
group('recordRecentJSON — malformed LS history is tolerated');
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(RECENT_FILES_LS_KEY, '{bad json');
  let threw = false;
  try { recordRecentJSON({ name: 'x.json' }, makeChromJSON('X')); }
  catch (_) { threw = true; }
  check('malformed history: no throw',          !threw);
  check('overwrite with fresh entry',           getRecentJSONs().length === 1);
}
{
  // Non-array history → treated as empty
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(RECENT_FILES_LS_KEY, '{"not": "array"}');
  recordRecentJSON({ name: 'x.json' }, makeChromJSON('X'));
  check('non-array history: replaced with array', Array.isArray(getRecentJSONs())
                                                  && getRecentJSONs().length === 1);
}

// =====================================================================
group('recordRecentJSON — quota exceeded');
{
  globalThis.localStorage.clear();
  globalThis.localStorage.quotaExceeded = true;
  const r = recordRecentJSON({ name: 'x.json' }, makeChromJSON('X'));
  check('quota exceeded: returns false',        r === false);
  globalThis.localStorage.quotaExceeded = false;
}

// =====================================================================
group('getRecentJSONs');
{
  globalThis.localStorage.clear();
  check('no history → []',                      getRecentJSONs().length === 0);
  recordRecentJSON({ name: 'a.json' }, makeChromJSON('A'));
  recordRecentJSON({ name: 'b.json' }, makeChromJSON('B'));
  const list = getRecentJSONs();
  check('returns array',                        Array.isArray(list));
  check('newest first',                         list[0].name === 'b.json');
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(RECENT_FILES_LS_KEY, '{bad');
  check('malformed → []',                       getRecentJSONs().length === 0);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(RECENT_FILES_LS_KEY, '"a string"');
  check('non-array → []',                       getRecentJSONs().length === 0);
}

// =====================================================================
group('clearRecentJSONs');
{
  globalThis.localStorage.clear();
  recordRecentJSON({ name: 'a.json' }, makeChromJSON('A'));
  recordRecentJSON({ name: 'b.json' }, makeChromJSON('B'));
  clearRecentJSONs();
  check('history dropped',                      getRecentJSONs().length === 0);
  check('LS key removed',
        globalThis.localStorage.getItem(RECENT_FILES_LS_KEY) === null);
  // No-throw when nothing to clear
  let threw = false;
  try { clearRecentJSONs(); } catch (_) { threw = true; }
  check('clear when already empty: no throw',  !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
