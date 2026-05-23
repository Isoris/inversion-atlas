// tests/test_shared_dotplot_mashmap.js

class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) { const keys = Array.from(this.store.keys()); return i < keys.length ? keys[i] : null; }
}
globalThis.localStorage = new MockLS();

const {
  DOTPLOT_MASHMAP_TOOL,
  DOTPLOT_MASHMAP_LS_KEY,
  isDotplotMashmapJSON,
  storeDotplotMashmap,
  persistDotplotMashmap,
  restoreDotplotMashmap,
  clearDotplotMashmap,
} = await import('../atlases/cross-species/shared/dotplot_mashmap.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(resolutions) {
  return {
    tool: DOTPLOT_MASHMAP_TOOL,
    schema_version: 1,
    generated_at: '2026-05-12T00:00:00Z',
    species_query:  { name: 'C_gariepinus', haplotype: 'hap1' },
    species_target: { name: 'C_macrocephalus', haplotype: 'hap1' },
    chrom_lengths_query: { LG28: 30_000_000 },
    chrom_lengths_target: { mac_LG7: 35_000_000 },
    resolutions: resolutions || [
      { segment_length: 100000, pct_identity: 0.85, n_alignments: 1024,
        alignments: [{ q_chr: 'LG28', q_start: 0, q_end: 100000,
                       t_chr: 'mac_LG7', t_start: 1000, t_end: 101000,
                       strand: '+', pct_identity: 0.92 }] },
    ],
  };
}

// =====================================================================
group('constants');
check('TOOL = dotplot_mashmap_v1',            DOTPLOT_MASHMAP_TOOL === 'dotplot_mashmap_v1');
check('LS_KEY matches legacy',                DOTPLOT_MASHMAP_LS_KEY === 'inversion_atlas.dotplot_mashmap');

// =====================================================================
group('isDotplotMashmapJSON');
check('valid → true',                          isDotplotMashmapJSON(makeJSON()) === true);
check('null → false',                          isDotplotMashmapJSON(null) === false);
check('wrong tool → false',                    isDotplotMashmapJSON({ ...makeJSON(), tool: 'x' }) === false);
check('non-number schema → false',
      isDotplotMashmapJSON({ ...makeJSON(), schema_version: '1' }) === false);
check('missing resolutions → false',
      isDotplotMashmapJSON({ tool: DOTPLOT_MASHMAP_TOOL, schema_version: 1 }) === false);

// =====================================================================
group('storeDotplotMashmap');
{
  const state = {};
  const ok = storeDotplotMashmap(state, makeJSON());
  check('returns true',                          ok === true);
  check('state.dotplotMashmap created',          !!state.dotplotMashmap);
  check('resolutions length = 1',                state.dotplotMashmap.resolutions.length === 1);
  check('species_query stored',                  state.dotplotMashmap.species_query.name === 'C_gariepinus');
  check('chrom_lengths_query stored',            state.dotplotMashmap.chrom_lengths_query.LG28 === 30_000_000);
  check('loaded_at is ISO string',               typeof state.dotplotMashmap.loaded_at === 'string');
}
{
  // Optional fields default
  const state = {};
  const json = makeJSON();
  delete json.species_query;
  delete json.species_target;
  delete json.chrom_lengths_query;
  storeDotplotMashmap(state, json);
  check('missing species_query → null',          state.dotplotMashmap.species_query === null);
  check('missing chrom_lengths_query → {}',
        typeof state.dotplotMashmap.chrom_lengths_query === 'object'
        && Object.keys(state.dotplotMashmap.chrom_lengths_query).length === 0);
}
check('null state → false',                    storeDotplotMashmap(null, makeJSON()) === false);
check('null parsed → false',                   storeDotplotMashmap({}, null) === false);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  storeDotplotMashmap(state, makeJSON());
  check('persist → true',                        persistDotplotMashmap(state) === true);
  const state2 = {};
  check('restore → true',                        restoreDotplotMashmap(state2) === true);
  check('restored 1 resolution',                 state2.dotplotMashmap.resolutions.length === 1);
  check('alignment round-tripped',
        state2.dotplotMashmap.resolutions[0].alignments[0].pct_identity === 0.92);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(DOTPLOT_MASHMAP_LS_KEY, 'x');
  const state = { dotplotMashmap: null };
  persistDotplotMashmap(state);
  check('persist null clears LS',
        globalThis.localStorage.getItem(DOTPLOT_MASHMAP_LS_KEY) === null);
}
{
  globalThis.localStorage.clear();
  check('restore no key → false',                restoreDotplotMashmap({}) === false);
}
{
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(DOTPLOT_MASHMAP_LS_KEY, '{bad');
  let threw = false;
  let ret;
  try { ret = restoreDotplotMashmap({}); } catch (_) { threw = true; }
  check('malformed JSON: no throw',              !threw);
  check('malformed JSON → false',                ret === false);
}

// =====================================================================
group('clearDotplotMashmap');
{
  globalThis.localStorage.clear();
  const state = { _csDotplotPanel: { stale: true }, _csDotplotPanelFp: 'fp1' };
  storeDotplotMashmap(state, makeJSON());
  persistDotplotMashmap(state);
  clearDotplotMashmap(state);
  check('dotplotMashmap nulled',                 state.dotplotMashmap === null);
  check('_csDotplotPanel cleared',               state._csDotplotPanel === null);
  check('_csDotplotPanelFp cleared',             state._csDotplotPanelFp === null);
  check('LS cleared',
        globalThis.localStorage.getItem(DOTPLOT_MASHMAP_LS_KEY) === null);
  let threw = false;
  try { clearDotplotMashmap(null); } catch (_) { threw = true; }
  check('null state: no throw',                  !threw);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
