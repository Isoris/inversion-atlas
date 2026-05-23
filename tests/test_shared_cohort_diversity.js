// tests/test_shared_cohort_diversity.js
//
// Unit tests for atlases/popstats/shared/cohort_diversity.js — the
// F_ROH / π / F_HOM cohort-level diversity data layer.

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
  COHORT_DIVERSITY_TOOL,
  COHORT_DIVERSITY_LS_KEY,
  COHORT_DIVERSITY_NUMERIC_COLS,
  isCohortDiversityJSON,
  normalizeCohortDiversityRow,
  storeCohortDiversity,
  persistCohortDiversity,
  restoreCohortDiversity,
  clearCohortDiversity,
  diversityForSampleIdx,
  diversityForCGA,
  cohortDiversityCoverageOnCurrentChrom,
} = await import('../atlases/popstats/shared/cohort_diversity.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeRow(sample_id, overrides) {
  return Object.assign({
    sample_id,
    k8: 5,
    pruned81: true,
    h: 0.001, f_hom: 0.10, f_roh: 0.05,
    roh_total_bp: 1_000_000, roh_n: 4,
    roh_longest_bp: 500_000, roh_mean_bp: 250_000,
    th_in: 0.0015, th_out: 0.0018, th_ratio: 0.83,
    callable_bp: 800_000_000,
  }, overrides || {});
}

function makeWrappedJSON(rows) {
  return {
    tool: COHORT_DIVERSITY_TOOL,
    schema_version: 1,
    generated_at: '2026-05-12T00:00:00Z',
    cohort: { name: 'C_gar_226', n_samples: rows.length },
    samples: rows,
  };
}

// =====================================================================
group('constants');
check('TOOL = cohort_diversity_v1',          COHORT_DIVERSITY_TOOL === 'cohort_diversity_v1');
check('LS_KEY single blob (no per-chrom)',   COHORT_DIVERSITY_LS_KEY === 'inversion_atlas.cohort_diversity');
check('NUMERIC_COLS has 11 entries',         COHORT_DIVERSITY_NUMERIC_COLS.length === 11);
check('NUMERIC_COLS includes f_roh',         COHORT_DIVERSITY_NUMERIC_COLS.includes('f_roh'));
check('NUMERIC_COLS includes callable_bp',   COHORT_DIVERSITY_NUMERIC_COLS.includes('callable_bp'));
check('NUMERIC_COLS frozen',                 Object.isFrozen(COHORT_DIVERSITY_NUMERIC_COLS));

// =====================================================================
group('isCohortDiversityJSON — wrapped form');
check('valid wrapped → true',                isCohortDiversityJSON(makeWrappedJSON([makeRow('CGA001')])) === true);
check('wrong tool → false',
      isCohortDiversityJSON({ ...makeWrappedJSON([]), tool: 'other_tool' }) === false);
check('missing schema_version → false',
      isCohortDiversityJSON({ tool: COHORT_DIVERSITY_TOOL, samples: [] }) === false);
check('samples not array → false',
      isCohortDiversityJSON({ tool: COHORT_DIVERSITY_TOOL, schema_version: 1, samples: 'x' }) === false);
check('null → false',                        isCohortDiversityJSON(null) === false);

// =====================================================================
group('isCohortDiversityJSON — raw-array form');
check('raw array with sample_id+f_roh → true',
      isCohortDiversityJSON([makeRow('CGA001')]) === true);
check('raw array with `sample` field → true',
      isCohortDiversityJSON([{ sample: 'CGA001', f_roh: 0.05 }]) === true);
check('raw array no f_roh → false (dosage shape)',
      isCohortDiversityJSON([{ sample_id: 'CGA001', dosage: 0.5 }]) === false);
check('raw array no sample_id → false',
      isCohortDiversityJSON([{ f_roh: 0.05 }]) === false);
check('empty array → false',                 isCohortDiversityJSON([]) === false);

// =====================================================================
group('normalizeCohortDiversityRow');
{
  const norm = normalizeCohortDiversityRow(makeRow('  CGA001  '));
  check('sample_id trimmed',                  norm.sample_id === 'CGA001');
  check('k8 coerced to string',               norm.k8 === '5' && typeof norm.k8 === 'string');
  check('pruned81 = true preserved',          norm.pruned81 === true);
  check('f_roh preserved',                    norm.f_roh === 0.05);
}
{
  // sample fallback to `sample` field
  const norm = normalizeCohortDiversityRow({ sample: 'CGA002', f_roh: 0.04 });
  check('sample fallback works',              norm.sample_id === 'CGA002');
}
{
  // pruned81 string coercion
  const trueStr = normalizeCohortDiversityRow(makeRow('CGA001', { pruned81: 'true' }));
  const falseStr = normalizeCohortDiversityRow(makeRow('CGA001', { pruned81: 'false' }));
  const intTrue = normalizeCohortDiversityRow(makeRow('CGA001', { pruned81: 1 }));
  const garbage = normalizeCohortDiversityRow(makeRow('CGA001', { pruned81: 'maybe' }));
  check('pruned81 "true" → true',             trueStr.pruned81 === true);
  check('pruned81 "false" → false',           falseStr.pruned81 === false);
  check('pruned81 1 → true',                  intTrue.pruned81 === true);
  check('pruned81 garbage → null',            garbage.pruned81 === null);
}
{
  // Non-finite numerics → null
  const norm = normalizeCohortDiversityRow({
    sample_id: 'CGA001', f_roh: NaN, h: 'oops', th_ratio: Infinity, callable_bp: 1000,
  });
  check('NaN f_roh → null',                   norm.f_roh === null);
  check('string h → null',                    norm.h === null);
  check('Infinity th_ratio → null',           norm.th_ratio === null);
  check('valid callable_bp preserved',        norm.callable_bp === 1000);
}
check('null row → null',                     normalizeCohortDiversityRow(null) === null);
check('row without sample_id → null',
      normalizeCohortDiversityRow({ f_roh: 0.05 }) === null);

// =====================================================================
group('storeCohortDiversity — happy path');
{
  const state = {};
  const ok = storeCohortDiversity(state,
    makeWrappedJSON([makeRow('CGA001'), makeRow('CGA002'), makeRow('CGA003')]));
  check('returns true',                       ok === true);
  check('state.cohortDiversity created',      !!state.cohortDiversity);
  check('3 samples loaded',                   state.cohortDiversity.samples.length === 3);
  check('byCGA is a Map',                     state.cohortDiversity.byCGA instanceof Map);
  check('byCGA size = 3',                     state.cohortDiversity.byCGA.size === 3);
  check('byCGA key is upper-cased',           state.cohortDiversity.byCGA.has('CGA001'));
  check('tool stored',                        state.cohortDiversity.tool === COHORT_DIVERSITY_TOOL);
  check('cohort preserved',                   state.cohortDiversity.cohort.name === 'C_gar_226');
  check('loaded_at is ISO string',            typeof state.cohortDiversity.loaded_at === 'string');
  check('breedingCardCache invalidated',      state._breedingCardCache === null);
  const diag = state.cohortDiversity.diagnostics;
  check('diagnostics.n_input = 3',            diag.n_input === 3);
  check('diagnostics.n_loaded = 3',           diag.n_loaded === 3);
  check('diagnostics.n_dropped_no_id = 0',    diag.n_dropped_no_id === 0);
  check('diagnostics.n_duplicate_id = 0',     diag.n_duplicate_id === 0);
}
{
  // Raw-array form works too
  const state = {};
  const ok = storeCohortDiversity(state, [makeRow('CGA001'), makeRow('CGA002')]);
  check('raw-array form succeeds',            ok === true);
  check('cohort defaulted',                   state.cohortDiversity.cohort.n_samples === 2);
}
{
  // Dropped rows + duplicates
  const state = {};
  storeCohortDiversity(state, makeWrappedJSON([
    makeRow('CGA001'),
    { sample_id: '', f_roh: 0.05 },              // dropped: no sample_id
    makeRow('CGA001', { f_roh: 0.99 }),          // duplicate (last writer wins)
    makeRow('cga002'),                           // lowercase — keys upper-case
  ]));
  const diag = state.cohortDiversity.diagnostics;
  check('n_input = 4',                        diag.n_input === 4);
  check('n_loaded = 3 (one dropped)',         diag.n_loaded === 3);
  check('n_dropped_no_id = 1',                diag.n_dropped_no_id === 1);
  check('n_duplicate_id = 1',                 diag.n_duplicate_id === 1);
  check('case-insensitive dedup: CGA002 stored under CGA002',
        state.cohortDiversity.byCGA.has('CGA002'));
  check('duplicate: last writer wins',
        state.cohortDiversity.byCGA.get('CGA001').f_roh === 0.99);
}
check('null state → false',                  storeCohortDiversity(null, makeWrappedJSON([makeRow('X')])) === false);
check('null parsed → false',                 storeCohortDiversity({}, null) === false);
check('wrong-shape input → false',           storeCohortDiversity({}, { foo: 'bar' }) === false);
check('all rows fail → false',
      storeCohortDiversity({}, makeWrappedJSON([{ no_id: true, f_roh: 0.05 }])) === false);

// =====================================================================
group('persistCohortDiversity / restoreCohortDiversity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeCohortDiversity(state, makeWrappedJSON([makeRow('CGA001'), makeRow('CGA002')]));
  check('persist → true',                     persistCohortDiversity(state) === true);
  // Round-trip into fresh state
  const state2 = {};
  check('restore → true',                     restoreCohortDiversity(state2) === true);
  check('restored 2 samples',                 state2.cohortDiversity.samples.length === 2);
  check('byCGA rebuilt',                      state2.cohortDiversity.byCGA instanceof Map);
  check('byCGA size = 2',                     state2.cohortDiversity.byCGA.size === 2);
  check('CGA001 restored',
        state2.cohortDiversity.byCGA.get('CGA001').sample_id === 'CGA001');
}
{
  // Persist with no data clears the LS key
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(COHORT_DIVERSITY_LS_KEY, '{"foo":1}');
  const state = { cohortDiversity: null };
  persistCohortDiversity(state);
  check('persist null clears LS',
        globalThis.localStorage.getItem(COHORT_DIVERSITY_LS_KEY) === null);
}
{
  // Restore with no key → false, no throw
  globalThis.localStorage.clear();
  const state = {};
  check('restore no key → false',             restoreCohortDiversity(state) === false);
}
{
  // Restore malformed → false
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(COHORT_DIVERSITY_LS_KEY, '{not json}');
  const state = {};
  let threw = false;
  let ret;
  try { ret = restoreCohortDiversity(state); } catch (_) { threw = true; }
  check('malformed JSON: no throw',           !threw);
  check('malformed JSON → false',             ret === false);
}

// =====================================================================
group('clearCohortDiversity');
{
  globalThis.localStorage.clear();
  const state = {};
  storeCohortDiversity(state, makeWrappedJSON([makeRow('CGA001')]));
  persistCohortDiversity(state);
  state._breedingCardCache = { cached: true };
  clearCohortDiversity(state);
  check('cohortDiversity nulled',             state.cohortDiversity === null);
  check('breedingCardCache nulled',           state._breedingCardCache === null);
  check('LS key cleared',
        globalThis.localStorage.getItem(COHORT_DIVERSITY_LS_KEY) === null);
  let threw = false;
  try { clearCohortDiversity(null); } catch (_) { threw = true; }
  check('null state: no throw',               !threw);
}

// =====================================================================
group('diversityForCGA');
{
  const state = {};
  storeCohortDiversity(state, makeWrappedJSON([makeRow('CGA001'), makeRow('CGA002')]));
  check('uppercase lookup works',
        diversityForCGA(state, 'CGA001').sample_id === 'CGA001');
  check('lowercase coerced to upper',
        diversityForCGA(state, 'cga001').sample_id === 'CGA001');
  check('unknown CGA → null',                 diversityForCGA(state, 'CGA999') === null);
  check('empty string → null',                diversityForCGA(state, '') === null);
  check('null cga → null',                    diversityForCGA(state, null) === null);
  check('null state → null',                  diversityForCGA(null, 'CGA001') === null);
  check('no cohort loaded → null',            diversityForCGA({}, 'CGA001') === null);
}

// =====================================================================
group('diversityForSampleIdx');
{
  const state = {
    data: {
      samples: [
        { cga: 'CGA001' },
        { cga: 'CGA002' },
        { cga: 'cga003' },   // lowercase
        { cga: null },       // missing
        { /* no cga */ },
      ],
    },
  };
  storeCohortDiversity(state, makeWrappedJSON([
    makeRow('CGA001'), makeRow('CGA002'), makeRow('CGA003'),
  ]));
  check('si=0 → CGA001',                       diversityForSampleIdx(state, 0).sample_id === 'CGA001');
  check('si=1 → CGA002',                       diversityForSampleIdx(state, 1).sample_id === 'CGA002');
  check('si=2 (lowercase cga) → CGA003',       diversityForSampleIdx(state, 2).sample_id === 'CGA003');
  check('si=3 (null cga) → null',              diversityForSampleIdx(state, 3) === null);
  check('si=4 (no cga) → null',                diversityForSampleIdx(state, 4) === null);
  check('si out of range → null',              diversityForSampleIdx(state, 99) === null);
  check('si negative → null',                  diversityForSampleIdx(state, -1) === null);
  check('si non-integer → null',               diversityForSampleIdx(state, 1.5) === null);
  check('no data → null',                      diversityForSampleIdx({ cohortDiversity: state.cohortDiversity }, 0) === null);
  check('no cohort → null',                    diversityForSampleIdx({ data: state.data }, 0) === null);
}

// =====================================================================
group('cohortDiversityCoverageOnCurrentChrom');
{
  // 5 samples, 2 resolve to cohort (CGA001, CGA002)
  const state = {
    data: {
      samples: [
        { cga: 'CGA001' },
        { cga: 'CGA002' },
        { cga: 'CGA999', ind: 'IND_X' },
        { cga: null, ind: 'IND_Y' },
        { /* nothing */ },
      ],
    },
  };
  storeCohortDiversity(state, makeWrappedJSON([
    makeRow('CGA001'), makeRow('CGA002'),
  ]));
  const cov = cohortDiversityCoverageOnCurrentChrom(state);
  check('n_total = 5',                         cov.n_total === 5);
  check('n_resolved = 2',                      cov.n_resolved === 2);
  check('n_unresolved = 3',                    cov.n_unresolved === 3);
  check('unresolved_cgas list populated',      cov.unresolved_cgas.length === 3);
  // Sample 2 has cga='CGA999', so it pushes 'CGA999' not 'IND_X'. The ind
  // fallback only kicks in when cga is null — that's sample 3 ('IND_Y').
  check('uses ind as fallback when cga is null', cov.unresolved_cgas.includes('IND_Y'));
  check('uses cga when present',               cov.unresolved_cgas.includes('CGA999'));
  check('uses "?" when nothing available',     cov.unresolved_cgas.includes('?'));
}
{
  // No cohort loaded → all unresolved
  const state = { data: { samples: [{ cga: 'CGA001' }, { cga: 'CGA002' }] } };
  const cov = cohortDiversityCoverageOnCurrentChrom(state);
  check('no cohort: n_total = 2',              cov.n_total === 2);
  check('no cohort: n_unresolved = 2',         cov.n_unresolved === 2);
  check('no cohort: n_resolved = 0',           cov.n_resolved === 0);
}
{
  // No chrom data → 0/0
  const cov = cohortDiversityCoverageOnCurrentChrom({});
  check('no chrom: n_total = 0',               cov.n_total === 0);
}
{
  // Unresolved list capped at 10
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push({ cga: 'CGA' + i });
  const state = { data: { samples } };
  storeCohortDiversity(state, makeWrappedJSON([makeRow('CGA999')]));   // none resolve
  const cov = cohortDiversityCoverageOnCurrentChrom(state);
  check('unresolved list capped at 10',        cov.unresolved_cgas.length === 10);
  check('full n_unresolved still reflects all', cov.n_unresolved === 20);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
