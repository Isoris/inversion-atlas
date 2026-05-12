// tests/test_shared_ncrna_density.js
//
// Unit tests for atlases/inversion/shared/ncrna_density.js — the
// ncRNA density data layer (sibling to repeat_density.js).

class MockLS {
  constructor() { this.store = new Map(); }
  setItem(k, v) { this.store.set(String(k), String(v)); }
  getItem(k) { const v = this.store.get(String(k)); return v == null ? null : v; }
  removeItem(k) { this.store.delete(String(k)); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i) {
    const keys = Array.from(this.store.keys());
    return i < keys.length ? keys[i] : null;
  }
}
globalThis.localStorage = new MockLS();

const {
  NCRNA_DENSITY_TOOL,
  NCRNA_DENSITY_LS_PREFIX,
  NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY,
  NCRNA_DEFAULT_CLASS,
  NCRNA_CLASS_FAMILIES,
  isNcRNADensityJSON,
  validateNcRNADensityChrom,
  storeNcRNADensity,
  persistNcRNADensity,
  restoreNcRNADensity,
  clearNcRNADensity,
  getNcRNADensity,
  ncRNADensityChromList,
  resolveNcRNADensityClass,
  setNcRNADensityActiveClass,
  restoreNcRNADensityActiveClass,
} = await import('../atlases/inversion/shared/ncrna_density.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(chrom, classes) {
  const n_windows = 4;
  const by_class = {};
  for (const cls of classes) {
    by_class[cls] = {
      densities: [0.5, 1.2, 0.8, 0.3],
      max_density: 1.2,
    };
  }
  return {
    tool: NCRNA_DENSITY_TOOL,
    schema_version: 1,
    species: 'fClaHyb_Gar',
    n_chromosomes: 1,
    n_classes: classes.length,
    classes,
    default_class: classes.includes('tRNA_all') ? 'tRNA_all' : classes[0],
    generated_at: '2026-05-12T00:00:00Z',
    chromosomes: [{
      chrom, n_windows,
      window_centers_mb: [0.1, 0.2, 0.3, 0.4],
      by_class,
    }],
  };
}

// =====================================================================
group('constants');
check('TOOL = ncrna_density_v1',
      NCRNA_DENSITY_TOOL === 'ncrna_density_v1');
check('LS_PREFIX is inversion_atlas.ncRNADensity.',
      NCRNA_DENSITY_LS_PREFIX === 'inversion_atlas.ncRNADensity.');
check('ACTIVE_CLASS_LS_KEY is inversion_atlas.ncRNADensityActiveClass',
      NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY === 'inversion_atlas.ncRNADensityActiveClass');
check('DEFAULT_CLASS = tRNA_all',             NCRNA_DEFAULT_CLASS === 'tRNA_all');
check('CLASS_FAMILIES has 3 families',        NCRNA_CLASS_FAMILIES.length === 3);
check('CLASS_FAMILIES is frozen',             Object.isFrozen(NCRNA_CLASS_FAMILIES));
check('CLASS_FAMILIES[0].family = tRNA',      NCRNA_CLASS_FAMILIES[0].family === 'tRNA');
check('CLASS_FAMILIES[0].classes[0] = tRNA_all', NCRNA_CLASS_FAMILIES[0].classes[0] === 'tRNA_all');
check('CLASS_FAMILIES contains rRNA family',
      NCRNA_CLASS_FAMILIES.some(f => f.family === 'rRNA'));
check('CLASS_FAMILIES contains ncRNA family',
      NCRNA_CLASS_FAMILIES.some(f => f.family === 'ncRNA'));

// =====================================================================
group('isNcRNADensityJSON');
check('valid JSON → true',                    isNcRNADensityJSON(makeJSON('LG28', ['tRNA_all'])) === true);
check('null → false',                         isNcRNADensityJSON(null) === false);
check('wrong tool → false',
      isNcRNADensityJSON({ ...makeJSON('LG28', ['tRNA_all']), tool: 'something_else' }) === false);
check('non-number schema_version → false',
      isNcRNADensityJSON({ ...makeJSON('LG28', ['tRNA_all']), schema_version: '1' }) === false);
check('empty chromosomes → false',
      isNcRNADensityJSON({ ...makeJSON('LG28', ['tRNA_all']), chromosomes: [] }) === false);
check('repeat-density JSON shape rejected',
      isNcRNADensityJSON({ version: 2, binning_source: 'scrubber_windows',
                           chromosomes: [{ chrom: 'LG28' }] }) === false);

// =====================================================================
group('validateNcRNADensityChrom');
check('valid block → true',
      validateNcRNADensityChrom(makeJSON('LG28', ['tRNA_all']).chromosomes[0]) === true);
check('null → false',                         validateNcRNADensityChrom(null) === false);
{
  const bad = makeJSON('LG28', ['tRNA_all']).chromosomes[0];
  bad.window_centers_mb = [0.1];
  check('wrong window_centers_mb length → false', validateNcRNADensityChrom(bad) === false);
}
{
  const bad = makeJSON('LG28', ['tRNA_all']).chromosomes[0];
  bad.by_class.tRNA_all.densities = [0.5];
  check('wrong densities length → false',     validateNcRNADensityChrom(bad) === false);
}
{
  const bad = makeJSON('LG28', ['tRNA_all']).chromosomes[0];
  bad.by_class = null;
  check('missing by_class → false',           validateNcRNADensityChrom(bad) === false);
}

// =====================================================================
group('storeNcRNADensity');
{
  const state = {};
  const chrom = storeNcRNADensity(state, makeJSON('LG28', ['tRNA_all', 'rRNA_18S']));
  check('returns chrom name',                  chrom === 'LG28');
  check('state.ncRNADensity created',          !!state.ncRNADensity);
  check('LG28 entry present',                  !!state.ncRNADensity.LG28);
  const entry = state.ncRNADensity.LG28;
  check('tool stored',                         entry.tool === NCRNA_DENSITY_TOOL);
  check('species stored',                      entry.species === 'fClaHyb_Gar');
  check('default_class stored',                entry.default_class === 'tRNA_all');
  check('classes copied (not shared ref)',     entry.classes.length === 2);
  check('chrom_block stored',                  entry.chrom_block.n_windows === 4);
}
check('null state → null',                    storeNcRNADensity(null, makeJSON('LG28', ['tRNA_all'])) === null);
check('null parsed → null',                   storeNcRNADensity({}, null) === null);
check('non-ncrna JSON → null',                storeNcRNADensity({}, { version: 2 }) === null);

// =====================================================================
group('persistNcRNADensity / restoreNcRNADensity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeNcRNADensity(state, makeJSON('LG28', ['tRNA_all']));
  storeNcRNADensity(state, makeJSON('LG14', ['tRNA_all', 'rRNA_5S']));
  check('persist LG28 → true',                persistNcRNADensity(state, 'LG28') === true);
  check('persist LG14 → true',                persistNcRNADensity(state, 'LG14') === true);
  check('persist non-existent chrom → false', persistNcRNADensity(state, 'LG99') === false);
  // Round-trip
  const state2 = {};
  const n = restoreNcRNADensity(state2);
  check('restored 2 chroms',                  n === 2);
  check('LG28 restored',                      !!state2.ncRNADensity.LG28);
  check('LG14 restored',                      !!state2.ncRNADensity.LG14);
  check('restored default_class',             state2.ncRNADensity.LG28.default_class === 'tRNA_all');
  // localStorage prefix isolation: doesn't pick up REPEAT_DENSITY_LS_PREFIX keys
  globalThis.localStorage.setItem('pca_scrubber_v3.repeatDensity.LG28', '{"foo":1}');
  const state3 = {};
  const n3 = restoreNcRNADensity(state3);
  check('does not load TE density keys',      n3 === 2);
}

// =====================================================================
group('clearNcRNADensity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeNcRNADensity(state, makeJSON('LG28', ['tRNA_all']));
  persistNcRNADensity(state, 'LG28');
  clearNcRNADensity(state, 'LG28');
  check('chrom removed from memory',          !state.ncRNADensity.LG28);
  check('chrom removed from localStorage',
        globalThis.localStorage.getItem(NCRNA_DENSITY_LS_PREFIX + 'LG28') === null);
  let threw = false;
  try { clearNcRNADensity(null, 'LG28'); } catch (_) { threw = true; }
  check('null state: no throw',               !threw);
}

// =====================================================================
group('getNcRNADensity / ncRNADensityChromList');
{
  const state = {};
  storeNcRNADensity(state, makeJSON('LG28', ['tRNA_all']));
  storeNcRNADensity(state, makeJSON('LG14', ['tRNA_all']));
  storeNcRNADensity(state, makeJSON('LG07', ['tRNA_all']));
  check('get returns entry',                  !!getNcRNADensity(state, 'LG28'));
  check('get unknown → null',                 getNcRNADensity(state, 'LG99') === null);
  check('get null state → null',              getNcRNADensity(null, 'LG28') === null);
  check('chromList sorted alpha',
        JSON.stringify(ncRNADensityChromList(state)) === JSON.stringify(['LG07', 'LG14', 'LG28']));
  check('chromList no data → []',             ncRNADensityChromList({}).length === 0);
}

// =====================================================================
group('resolveNcRNADensityClass');
{
  const state = {};
  storeNcRNADensity(state, makeJSON('LG28', ['tRNA_all', 'rRNA_18S', 'ncRNA_miRNA']));
  check('default → JSON default_class (tRNA_all)',
        resolveNcRNADensityClass(state, 'LG28') === 'tRNA_all');
  state.ncRNADensityActiveClass = { LG28: 'rRNA_18S' };
  check('override → rRNA_18S',
        resolveNcRNADensityClass(state, 'LG28') === 'rRNA_18S');
  state.ncRNADensityActiveClass = { LG28: 'gone_class' };
  check('override missing class → default_class',
        resolveNcRNADensityClass(state, 'LG28') === 'tRNA_all');
  check('unknown chrom → null',               resolveNcRNADensityClass(state, 'LG99') === null);
}
{
  // No default_class, no tRNA_all → first available
  const state = {};
  const json = makeJSON('LG28', ['rRNA_18S', 'ncRNA_miRNA']);
  json.default_class = 'nope';
  storeNcRNADensity(state, json);
  check('no priority/default → first class',
        resolveNcRNADensityClass(state, 'LG28') === 'rRNA_18S');
}

// =====================================================================
group('setNcRNADensityActiveClass / restoreNcRNADensityActiveClass');
{
  globalThis.localStorage.clear();
  const state = {};
  setNcRNADensityActiveClass(state, 'LG28', 'rRNA_5S');
  setNcRNADensityActiveClass(state, 'LG14', 'ncRNA_snRNA');
  check('LG28 active class set',              state.ncRNADensityActiveClass.LG28 === 'rRNA_5S');
  check('LG14 active class set',              state.ncRNADensityActiveClass.LG14 === 'ncRNA_snRNA');
  check('persisted to localStorage',
        globalThis.localStorage.getItem(NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY) !== null);
  // Round-trip
  const state2 = {};
  check('restore → true',                     restoreNcRNADensityActiveClass(state2) === true);
  check('restored LG28',                      state2.ncRNADensityActiveClass.LG28 === 'rRNA_5S');
  check('restored LG14',                      state2.ncRNADensityActiveClass.LG14 === 'ncRNA_snRNA');
}
{
  // Restore with no key → false
  globalThis.localStorage.clear();
  const state = {};
  check('restore no key → false',             restoreNcRNADensityActiveClass(state) === false);
}
{
  // Restore with malformed JSON → false, no throw
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(NCRNA_DENSITY_ACTIVE_CLASS_LS_KEY, '{not json}');
  const state = {};
  let threw = false;
  let ret;
  try { ret = restoreNcRNADensityActiveClass(state); } catch (_) { threw = true; }
  check('malformed JSON: no throw',           !threw);
  check('malformed JSON → false',             ret === false);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
