// tests/test_page1_active_samples.js
//
// Unit coverage for the active-samples filter
// (atlases/inversion/pages/discovery/page1/active_samples.js).
//
// All entry points take `state` as their first argument and are
// localStorage-/DOM-tolerant: when those globals are absent they
// degrade gracefully (load = no-op fail-soft, badge refresh = no-op,
// save = no-op). The tests synthesise a minimal `state` fixture
// matching the page1 _pageState shape (just `data.samples`).

import {
  ACTIVE_SAMPLES_LS_KEY,
  ACTIVE_SAMPLES_SCHEMA_VERSION,
  _activeSamplesCgaForSi,
  _activeSamplesCgasToIndexSet,
  _activeSamplesIndexSetToCgas,
  loadActiveSamples,
  saveActiveSamples,
  isSampleActive,
  activeSampleCounts,
  refreshActiveSamplesBadge,
} from '../atlases/inversion/pages/discovery/page1/active_samples.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// Build a synthetic state with 5 samples — three with cga, two ind-only.
function fixtureState() {
  return {
    data: {
      samples: [
        { cga: 'cga_001', ind: 'ind_A' },
        { cga: 'cga_002', ind: 'ind_B' },
        { cga: 'cga_003', ind: 'ind_C' },
        {                ind: 'ind_D' },      // no cga → ind is canonical id
        { cga: null,     ind: 'ind_E' },      // null cga → ind fallback
      ],
    },
    activeSampleSet: null,
    activeSampleReasons: new Map(),
  };
}

// =====================================================================
group('storage constants');
check('LS key matches legacy', ACTIVE_SAMPLES_LS_KEY === 'pca_scrubber_v3.active_samples');
check('schema version = 1',    ACTIVE_SAMPLES_SCHEMA_VERSION === 1);

// =====================================================================
group('_activeSamplesCgaForSi');
{
  const state = fixtureState();
  check('cga preferred',           _activeSamplesCgaForSi(state, 0) === 'cga_001');
  check('ind fallback (no cga)',   _activeSamplesCgaForSi(state, 3) === 'ind_D');
  check('ind fallback (null cga)', _activeSamplesCgaForSi(state, 4) === 'ind_E');
  check('out-of-range si → null',  _activeSamplesCgaForSi(state, 99) === null);
  check('null state → null',       _activeSamplesCgaForSi(null, 0) === null);
  check('state w/o samples → null', _activeSamplesCgaForSi({ data: {} }, 0) === null);
}

// =====================================================================
group('_activeSamplesCgasToIndexSet');
{
  const state = fixtureState();
  const subset = _activeSamplesCgasToIndexSet(state, ['cga_001', 'cga_003', 'ind_D']);
  check('valid CGAs → Set',         subset instanceof Set);
  check('3 entries',                subset.size === 3);
  check('contains 0 (cga_001)',     subset.has(0));
  check('contains 2 (cga_003)',     subset.has(2));
  check('contains 3 (ind_D)',       subset.has(3));
  check('does NOT contain 1',       !subset.has(1));
  check('does NOT contain 4',       !subset.has(4));
}
{
  const state = fixtureState();
  const dropped = _activeSamplesCgasToIndexSet(state, ['cga_unknown']);
  check('unknown CGA → empty Set', dropped instanceof Set && dropped.size === 0);
}
check('null cgas → null',
       _activeSamplesCgasToIndexSet(fixtureState(), null) === null);
check('null state → null',
       _activeSamplesCgasToIndexSet(null, ['cga_001']) === null);

// =====================================================================
group('_activeSamplesIndexSetToCgas');
{
  const state = fixtureState();
  const cgas = _activeSamplesIndexSetToCgas(state, new Set([0, 2, 4]));
  check('Set → CGA list',          Array.isArray(cgas) && cgas.length === 3);
  check('includes cga_001',        cgas.includes('cga_001'));
  check('includes cga_003',        cgas.includes('cga_003'));
  check('includes ind_E (fallback)', cgas.includes('ind_E'));
}
check('null set → []',            _activeSamplesIndexSetToCgas(fixtureState(), null).length === 0);
check('null state → []',          _activeSamplesIndexSetToCgas(null, new Set([0])).length === 0);

// =====================================================================
group('round-trip: indexSet → cgas → indexSet');
{
  const state = fixtureState();
  const original = new Set([0, 2, 3]);
  const cgas = _activeSamplesIndexSetToCgas(state, original);
  const back = _activeSamplesCgasToIndexSet(state, cgas);
  check('round-trip preserves size', back.size === original.size);
  for (const si of original) {
    check(`round-trip preserves index ${si}`, back.has(si));
  }
}

// =====================================================================
group('isSampleActive');
{
  const state = fixtureState();
  // No subset → all active
  check('no subset: sample 0 active', isSampleActive(state, 0) === true);
  check('no subset: sample 99 active (default true)', isSampleActive(state, 99) === true);
  // Subset of {1, 3} → only those are active
  state.activeSampleSet = new Set([1, 3]);
  check('subset {1,3}: 1 active',  isSampleActive(state, 1) === true);
  check('subset {1,3}: 3 active',  isSampleActive(state, 3) === true);
  check('subset {1,3}: 0 inactive', isSampleActive(state, 0) === false);
  check('subset {1,3}: 4 inactive', isSampleActive(state, 4) === false);
  check('null state → true',       isSampleActive(null, 0) === true);
}

// =====================================================================
group('activeSampleCounts');
{
  const state = fixtureState();
  let c = activeSampleCounts(state);
  check('no subset: active === total',  c.active === 5 && c.total === 5);
  state.activeSampleSet = new Set([0, 1, 2]);
  c = activeSampleCounts(state);
  check('subset of 3: active === 3',    c.active === 3 && c.total === 5);
  c = activeSampleCounts({ data: { samples: [] } });
  check('empty cohort: 0/0',            c.active === 0 && c.total === 0);
  c = activeSampleCounts(null);
  check('null state: 0/0',              c.active === 0 && c.total === 0);
}

// =====================================================================
group('refreshActiveSamplesBadge (no-op when DOM absent)');
// In Node `document` is undefined, so the function should bail without
// throwing — exercising the typeof document guard.
{
  let threw = false;
  try { refreshActiveSamplesBadge(fixtureState()); } catch (e) { threw = true; }
  check('refreshActiveSamplesBadge tolerates no DOM', !threw);
}

// =====================================================================
group('loadActiveSamples / saveActiveSamples (no-op when localStorage absent)');
{
  const state = fixtureState();
  // Pre-populate so we can confirm load resets even when storage is absent
  state.activeSampleSet = new Set([7, 8]);
  state.activeSampleReasons = new Map([[7, 'pre-existing']]);
  let threw = false;
  try { loadActiveSamples(state); } catch (e) { threw = true; }
  check('loadActiveSamples tolerates no localStorage', !threw);
  // Even without storage, the function resets the slots to "all active"
  check('load resets activeSampleSet to null',  state.activeSampleSet === null);
  check('load resets reasons to empty Map',
        state.activeSampleReasons instanceof Map && state.activeSampleReasons.size === 0);

  let threw2 = false;
  try { saveActiveSamples(state); } catch (e) { threw2 = true; }
  check('saveActiveSamples tolerates no localStorage', !threw2);
}

// =====================================================================
group('persistence round-trip (with in-memory localStorage shim)');
// Install a minimal localStorage shim, exercise save → load, verify the
// subset round-trips through CGA storage and back to indices.
{
  const memStore = {};
  globalThis.localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
    setItem(k, v) { memStore[k] = String(v); },
    removeItem(k) { delete memStore[k]; },
  };

  const stateA = fixtureState();
  stateA.activeSampleSet = new Set([0, 2]);              // CGAs cga_001, cga_003
  stateA.activeSampleReasons = new Map([[2, 'low coverage']]);
  saveActiveSamples(stateA);

  const stateB = fixtureState();
  loadActiveSamples(stateB);
  check('persisted subset round-trips: 2 indices',
        stateB.activeSampleSet instanceof Set && stateB.activeSampleSet.size === 2);
  check('persisted subset contains 0',  stateB.activeSampleSet.has(0));
  check('persisted subset contains 2',  stateB.activeSampleSet.has(2));
  check('reasons round-trip (2 → "low coverage")',
        stateB.activeSampleReasons.get(2) === 'low coverage');

  // Save all-active state (null sentinel)
  const stateC = fixtureState();
  stateC.activeSampleSet = null;
  saveActiveSamples(stateC);
  const stateD = fixtureState();
  loadActiveSamples(stateD);
  check('all-active round-trips: activeSampleSet === null',
        stateD.activeSampleSet === null);

  // Saving a full-cohort set should also round-trip to "all active"
  const stateE = fixtureState();
  stateE.activeSampleSet = new Set([0, 1, 2, 3, 4]);
  saveActiveSamples(stateE);
  const stateF = fixtureState();
  loadActiveSamples(stateF);
  check('full-cohort subset collapses to null on load',
        stateF.activeSampleSet === null);

  // Bad schema version → fail-soft, no subset loaded
  memStore[ACTIVE_SAMPLES_LS_KEY] = JSON.stringify({
    version: 999, active_cgas: ['cga_001'], reasons: {},
  });
  const stateG = fixtureState();
  loadActiveSamples(stateG);
  check('wrong schema version → null subset', stateG.activeSampleSet === null);

  // Corrupt JSON → fail-soft
  memStore[ACTIVE_SAMPLES_LS_KEY] = '{not-json';
  const stateH = fixtureState();
  let threwH = false;
  try { loadActiveSamples(stateH); } catch (e) { threwH = true; }
  check('corrupt JSON: load does not throw',  !threwH);
  check('corrupt JSON: null subset',          stateH.activeSampleSet === null);

  delete globalThis.localStorage;
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
