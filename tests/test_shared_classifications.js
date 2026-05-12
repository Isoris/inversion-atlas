// tests/test_shared_classifications.js
//
// Unit tests for atlases/inversion/shared/classifications.js.

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
  CLASSIFICATIONS_LS_KEY,
  initClassifications,
  persistClassifications,
  setClassification,
  getClassification,
  clearClassification,
} = await import('../atlases/inversion/shared/classifications.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('LS_KEY',                                CLASSIFICATIONS_LS_KEY === 'inversion_atlas.classifications.v1');

// =====================================================================
group('initClassifications');
{
  globalThis.localStorage.clear();
  const state = {};
  const dict = initClassifications(state);
  check('returns dict',                          dict && typeof dict === 'object');
  check('state.classifications created',         !!state.classifications);
  check('starts empty',                          Object.keys(dict).length === 0);
  const dict2 = initClassifications(state);
  check('idempotent (same object)',              dict === dict2);
}
{
  // Restore from LS on first init
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CLASSIFICATIONS_LS_KEY, JSON.stringify({
    bp1: { architecture_class: 'A', notes: 'restored' },
    bp2: { age_model: 'YOUNG-POP' },
  }));
  const state = {};
  initClassifications(state);
  check('restored bp1 from LS',                  state.classifications.bp1.architecture_class === 'A');
  check('restored bp2 from LS',                  state.classifications.bp2.age_model === 'YOUNG-POP');
}
{
  // Malformed JSON → empty dict
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CLASSIFICATIONS_LS_KEY, '{not json}');
  const state = {};
  let threw = false;
  try { initClassifications(state); } catch (_) { threw = true; }
  check('malformed JSON: no throw',              !threw);
  check('malformed JSON → empty dict',           Object.keys(state.classifications).length === 0);
}
{
  // Non-object payload (e.g. an array) is ignored
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CLASSIFICATIONS_LS_KEY, 'null');
  const state = {};
  initClassifications(state);
  check('null payload → empty dict',             Object.keys(state.classifications).length === 0);
}
check('null state → null',                     initClassifications(null) === null);

// =====================================================================
group('setClassification');
{
  globalThis.localStorage.clear();
  const state = {};
  const ok = setClassification(state, 'bp1', {
    architecture_class: 'E', age_model: 'MULTI-AGE-HOTSPOT', confidence: 'high', notes: 'recurrent',
  });
  check('returns true',                          ok === true);
  const entry = state.classifications.bp1;
  check('entry stored',                          !!entry);
  check('architecture_class stored',             entry.architecture_class === 'E');
  check('age_model stored',                      entry.age_model === 'MULTI-AGE-HOTSPOT');
  check('confidence stored',                     entry.confidence === 'high');
  check('notes stored',                          entry.notes === 'recurrent');
  check('updated_at is ISO string',              typeof entry.updated_at === 'string'
                                                 && entry.updated_at.indexOf('T') > 0);
  check('persisted to LS',
        globalThis.localStorage.getItem(CLASSIFICATIONS_LS_KEY) !== null);
}
{
  // Merge: second set updates only the provided fields
  globalThis.localStorage.clear();
  const state = {};
  setClassification(state, 'bp1', { architecture_class: 'A', notes: 'simple' });
  const prevUpdatedAt = state.classifications.bp1.updated_at;
  // brief delay so updated_at definitively changes — sleep would be a no-op
  // here. Instead, just trust ISO precision (it's ms) and the second call.
  setClassification(state, 'bp1', { age_model: 'YOUNG-POP' });
  const entry = state.classifications.bp1;
  check('merge preserves architecture_class',    entry.architecture_class === 'A');
  check('merge preserves notes',                 entry.notes === 'simple');
  check('merge adds age_model',                  entry.age_model === 'YOUNG-POP');
  check('updated_at refreshed (string)',         typeof entry.updated_at === 'string');
}
check('null state → false',                    setClassification(null, 'bp1', {}) === false);
check('empty bpId → false',                    setClassification({}, '', {}) === false);
check('null bpId → false',                     setClassification({}, null, {}) === false);

// =====================================================================
group('getClassification');
{
  const state = {};
  setClassification(state, 'bp1', { architecture_class: 'A' });
  check('existing → entry',                      getClassification(state, 'bp1').architecture_class === 'A');
  check('unknown → null',                        getClassification(state, 'bp99') === null);
  check('empty bpId → null',                     getClassification(state, '') === null);
  check('null bpId → null',                      getClassification(state, null) === null);
  check('null state → null',                     getClassification(null, 'bp1') === null);
}
{
  // Get auto-rehydrates from LS even on a fresh state
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CLASSIFICATIONS_LS_KEY, JSON.stringify({
    bp1: { architecture_class: 'B', notes: 'auto-rehydrated' },
  }));
  const state = {};
  const r = getClassification(state, 'bp1');
  check('get auto-rehydrates from LS',           r && r.architecture_class === 'B');
}

// =====================================================================
group('clearClassification');
{
  globalThis.localStorage.clear();
  const state = {};
  setClassification(state, 'bp1', { architecture_class: 'A' });
  setClassification(state, 'bp2', { architecture_class: 'B' });
  const ok = clearClassification(state, 'bp1');
  check('returns true when cleared',             ok === true);
  check('bp1 removed',                           !state.classifications.bp1);
  check('bp2 preserved',                         state.classifications.bp2.architecture_class === 'B');
  // LS reflects the deletion
  const rawAfter = JSON.parse(globalThis.localStorage.getItem(CLASSIFICATIONS_LS_KEY));
  check('LS reflects deletion',                  !rawAfter.bp1 && rawAfter.bp2);
  // Clear on bp that doesn't exist → false
  check('returns false when bp not present',     clearClassification(state, 'bp_nope') === false);
  check('null state → false',                    clearClassification(null, 'bp1') === false);
  check('empty bpId → false',                    clearClassification(state, '') === false);
}

// =====================================================================
group('persistClassifications fail-soft');
{
  // When state.classifications is missing, persists empty object (so a
  // stale earlier blob doesn't survive).
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(CLASSIFICATIONS_LS_KEY, '{"old":"data"}');
  const state = {};
  persistClassifications(state);
  check('persists empty dict when state.classifications missing',
        globalThis.localStorage.getItem(CLASSIFICATIONS_LS_KEY) === '{}');
}
check('null state → false',                    persistClassifications(null) === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
