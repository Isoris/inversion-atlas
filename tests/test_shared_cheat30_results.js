// tests/test_shared_cheat30_results.js
//
// Unit tests for atlases/inversion/shared/cheat30_results.js — the
// cheat30 GDS-by-genotype results layer.

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
  CHEAT30_TOOL,
  CHEAT30_LS_PREFIX,
  isCheat30JSON,
  storeCheat30Results,
  persistCheat30Results,
  restoreCheat30Results,
  clearCheat30Results,
  getCheat30Results,
  cheat30ForCandidate,
} = await import('../atlases/inversion/shared/cheat30_results.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeJSON(chrom, candIds) {
  const candidates = {};
  for (const cid of candIds) {
    candidates[cid] = {
      n_ref: 100, n_het: 50, n_inv: 76,
      separation_p: 0.001,
      separation_effect: 0.42,
      age_proxy: 0.18,
      dip_p: 0.7, dip_stat: 0.03, is_bimodal: false,
      origin_class: 'single_origin',
      mean_ibs_same: 0.85, mean_ibs_diff: 0.42,
      pair_summaries: {
        RR_RR: { n: 4950, mean: 0.85, sd: 0.04, quantiles: [0.78, 0.82, 0.85, 0.88, 0.92] },
      },
      pair_density: {
        RR_RR: { x: [0.7, 0.8, 0.9], y: [0.1, 0.5, 0.3] },
      },
    };
  }
  return {
    tool: CHEAT30_TOOL,
    schema_version: 'cheat30_v1',
    species: 'fClaHyb_Gar',
    chrom,
    generated_at: '2026-05-12T00:00:00Z',
    candidates,
  };
}

// =====================================================================
group('constants');
check('CHEAT30_TOOL = cheat30_gds_by_genotype',
      CHEAT30_TOOL === 'cheat30_gds_by_genotype');
check('CHEAT30_LS_PREFIX = inversion_atlas.cheat30Results.',
      CHEAT30_LS_PREFIX === 'inversion_atlas.cheat30Results.');

// =====================================================================
group('isCheat30JSON');
check('valid v1 JSON → true',                isCheat30JSON(makeJSON('LG28', ['cand_1'])) === true);
check('null → false',                        isCheat30JSON(null) === false);
check('missing schema_version → false',
      isCheat30JSON({ chrom: 'LG28', candidates: {} }) === false);
check('non-string schema_version → false',
      isCheat30JSON({ ...makeJSON('LG28', []), schema_version: 1 }) === false);
check('wrong schema_version prefix → false',
      isCheat30JSON({ ...makeJSON('LG28', []), schema_version: 'foo_v1' }) === false);
check('future cheat30_v2 → true (prefix match)',
      isCheat30JSON({ ...makeJSON('LG28', ['c']), schema_version: 'cheat30_v2' }) === true);
check('missing chrom → false',
      isCheat30JSON({ ...makeJSON('LG28', ['c']), chrom: '' }) === false);
check('missing candidates → false',
      isCheat30JSON({ ...makeJSON('LG28', []), candidates: null }) === false);

// =====================================================================
group('storeCheat30Results');
{
  const state = {};
  const chrom = storeCheat30Results(state, makeJSON('LG28', ['cand_15Mb', 'cand_22Mb']));
  check('returns chrom name',                  chrom === 'LG28');
  check('state.cheat30Results created',        !!state.cheat30Results);
  check('LG28 entry present',                  !!state.cheat30Results.LG28);
  const entry = state.cheat30Results.LG28;
  check('schema_version stored',               entry.schema_version === 'cheat30_v1');
  check('tool stored',                         entry.tool === CHEAT30_TOOL);
  check('species stored',                      entry.species === 'fClaHyb_Gar');
  check('candidates dict stored',              !!entry.candidates.cand_15Mb);
  check('candidate n_ref preserved',           entry.candidates.cand_15Mb.n_ref === 100);
}
{
  // tool default
  const state = {};
  const json = makeJSON('LG28', ['c']);
  delete json.tool;
  storeCheat30Results(state, json);
  check('tool defaulted from CHEAT30_TOOL',    state.cheat30Results.LG28.tool === CHEAT30_TOOL);
}
check('null state → null',                   storeCheat30Results(null, makeJSON('LG28', ['c'])) === null);
check('null parsed → null',                  storeCheat30Results({}, null) === null);
check('non-cheat30 JSON → null',             storeCheat30Results({}, { version: 2 }) === null);

// =====================================================================
group('persistCheat30Results / restoreCheat30Results');
{
  globalThis.localStorage.clear();
  const state = {};
  storeCheat30Results(state, makeJSON('LG28', ['c1']));
  storeCheat30Results(state, makeJSON('LG14', ['c2', 'c3']));
  check('persist LG28 → true',                 persistCheat30Results(state, 'LG28') === true);
  check('persist LG14 → true',                 persistCheat30Results(state, 'LG14') === true);
  check('persist non-existent chrom → false',  persistCheat30Results(state, 'LG99') === false);
  // Round-trip
  const state2 = {};
  const n = restoreCheat30Results(state2);
  check('restored 2 chroms',                   n === 2);
  check('LG28 restored',                       !!state2.cheat30Results.LG28);
  check('LG14 restored',                       !!state2.cheat30Results.LG14);
  check('LG14 has cand c2',                    !!state2.cheat30Results.LG14.candidates.c2);
  // Mismatch chrom in key vs payload → skipped
  globalThis.localStorage.setItem(CHEAT30_LS_PREFIX + 'LG99', JSON.stringify({
    chrom: 'LG_other', candidates: {},
  }));
  const state3 = {};
  const n3 = restoreCheat30Results(state3);
  check('chrom mismatch in payload → skipped', n3 === 2);
}

// =====================================================================
group('clearCheat30Results');
{
  globalThis.localStorage.clear();
  const state = {};
  storeCheat30Results(state, makeJSON('LG28', ['c']));
  persistCheat30Results(state, 'LG28');
  clearCheat30Results(state, 'LG28');
  check('chrom removed from memory',          !state.cheat30Results.LG28);
  check('chrom removed from localStorage',
        globalThis.localStorage.getItem(CHEAT30_LS_PREFIX + 'LG28') === null);
  let threw = false;
  try { clearCheat30Results(null, 'LG28'); } catch (_) { threw = true; }
  check('null state: no throw',               !threw);
}

// =====================================================================
group('getCheat30Results');
{
  const state = {};
  storeCheat30Results(state, makeJSON('LG28', ['c']));
  check('get returns entry',                  !!getCheat30Results(state, 'LG28'));
  check('get unknown → null',                 getCheat30Results(state, 'LG99') === null);
  check('get null state → null',              getCheat30Results(null, 'LG28') === null);
  check('get empty state → null',             getCheat30Results({}, 'LG28') === null);
}

// =====================================================================
group('cheat30ForCandidate');
{
  const state = {};
  storeCheat30Results(state, makeJSON('LG28', ['cand_15Mb']));
  check('valid candidate → block',
        !!cheat30ForCandidate(state, { chrom: 'LG28', id: 'cand_15Mb' }));
  check('legacy candidate_id field accepted',
        !!cheat30ForCandidate(state, { chrom: 'LG28', candidate_id: 'cand_15Mb' }));
  check('id takes precedence over candidate_id',
        !!cheat30ForCandidate(state,
          { chrom: 'LG28', id: 'cand_15Mb', candidate_id: 'nope' }));
  check('unknown candidate → null',
        cheat30ForCandidate(state, { chrom: 'LG28', id: 'cand_999' }) === null);
  check('unknown chrom → null',
        cheat30ForCandidate(state, { chrom: 'LG99', id: 'cand_15Mb' }) === null);
  check('null state → null',                   cheat30ForCandidate(null, { chrom: 'LG28', id: 'c' }) === null);
  check('null candidate → null',               cheat30ForCandidate(state, null) === null);
  check('empty state → null',                  cheat30ForCandidate({}, { chrom: 'LG28', id: 'c' }) === null);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
