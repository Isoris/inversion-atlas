// tests/test_shared_regimes_registry.js

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
  REGIMES_LS_KEY,
  REGIME_AXIS_TOPOLOGY,
  REGIME_AXIS_VALUES,
  ensureRegimeRegistry,
  persistRegimeRegistry,
  restoreRegimeRegistry,
  nextRegimeId,
  createRegime,
  updateRegime,
  deleteRegime,
  addL2ToRegime,
  removeL2FromRegime,
  regimesForL2,
  parseTrackScopedCandRef,
  formatCandTrackRef,
  addCandTrackToRegime,
  removeCandTrackFromRegime,
  regimesForCandTrack,
} = await import('../atlases/inversion/shared/regimes_registry.js');

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('LS_KEY matches legacy',                REGIMES_LS_KEY === 'pca_scrubber_v3.regimeRegistry');
check('AXIS_TOPOLOGY frozen',                  Object.isFrozen(REGIME_AXIS_TOPOLOGY));
check('AXIS_TOPOLOGY entries frozen',          Object.isFrozen(REGIME_AXIS_TOPOLOGY[0]));
check('7 axis topologies declared',            REGIME_AXIS_TOPOLOGY.length === 7);
check('AXIS_VALUES frozen',                    Object.isFrozen(REGIME_AXIS_VALUES));
check('first axis is unspecified',             REGIME_AXIS_TOPOLOGY[0].value === 'unspecified');
check('axis values include one_axis_3band',    REGIME_AXIS_VALUES.includes('one_axis_3band'));
check('axis values include artifact_suspect',  REGIME_AXIS_VALUES.includes('artifact_suspect'));
check('axis values length matches topology',
      REGIME_AXIS_VALUES.length === REGIME_AXIS_TOPOLOGY.length);
check('every axis has label + tooltip',
      REGIME_AXIS_TOPOLOGY.every(a => typeof a.label === 'string'
                                      && typeof a.tooltip === 'string'));

// =====================================================================
group('ensureRegimeRegistry');
{
  const state = {};
  const reg = ensureRegimeRegistry(state);
  check('initializes empty registry',           reg.regimes.length === 0);
  check('next_id starts at 1',                  reg.next_id === 1);
  check('version starts at 1',                  reg.version === 1);
  const reg2 = ensureRegimeRegistry(state);
  check('idempotent (same object)',             reg === reg2);
}
{
  // Backfill: malformed shape gets corrected
  const state = { regimeRegistry: { regimes: 'oops' } };
  ensureRegimeRegistry(state);
  check('non-array regimes backfilled to []',
        Array.isArray(state.regimeRegistry.regimes)
        && state.regimeRegistry.regimes.length === 0);
}
{
  const state = { regimeRegistry: { regimes: [], next_id: -5, version: null } };
  ensureRegimeRegistry(state);
  check('next_id <= 0 backfilled to 1',         state.regimeRegistry.next_id === 1);
  check('version null backfilled to 1',         state.regimeRegistry.version === 1);
}
check('null state → null',                    ensureRegimeRegistry(null) === null);

// =====================================================================
group('persist / restore round-trip');
{
  globalThis.localStorage.clear();
  const state = {};
  createRegime(state, { label: 'A', axis_topology: 'one_axis_3band' });
  createRegime(state, { label: 'B', axis_topology: 'one_axis_nested' });
  check('persist auto-fired on create',
        globalThis.localStorage.getItem(REGIMES_LS_KEY) !== null);
  // Restore into fresh state
  const state2 = {};
  check('restore → true',                       restoreRegimeRegistry(state2) === true);
  check('restored 2 regimes',                   state2.regimeRegistry.regimes.length === 2);
  check('labels preserved',
        state2.regimeRegistry.regimes[0].label === 'A'
        && state2.regimeRegistry.regimes[1].label === 'B');
}
{
  // Malformed entries dropped silently
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(REGIMES_LS_KEY, JSON.stringify({
    regimes: [
      { id: 'R1', label: 'A', axis_topology: 'one_axis_3band' },
      { /* no id */ },
      'a string',
      null,
      { id: 'R2', label: 'B', axis_topology: 'invalid_value', l2_ids: ['l2_x'] },
    ],
    next_id: 3, version: 1,
  }));
  const state = {};
  restoreRegimeRegistry(state);
  check('only valid entries restored',          state.regimeRegistry.regimes.length === 2);
  check('R1 + R2 preserved',
        state.regimeRegistry.regimes.map(r => r.id).sort().join(',') === 'R1,R2');
  const r2 = state.regimeRegistry.regimes.find(r => r.id === 'R2');
  check('invalid axis_topology coerced to unspecified', r2.axis_topology === 'unspecified');
  check('missing label defaulted',              typeof r2.label === 'string');
  check('l2_ids preserved',                     r2.l2_ids.includes('l2_x'));
}
{
  // Malformed JSON → false, defaults preserved
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem(REGIMES_LS_KEY, '{bad');
  const state = {};
  let threw = false;
  try { restoreRegimeRegistry(state); } catch (_) { threw = true; }
  check('malformed JSON: no throw',             !threw);
  check('regimes still empty',                  state.regimeRegistry.regimes.length === 0);
}
{
  globalThis.localStorage.clear();
  check('restore no LS key → false',            restoreRegimeRegistry({}) === false);
}

// =====================================================================
group('nextRegimeId');
{
  globalThis.localStorage.clear();
  const state = {};
  check('first → R1',                           nextRegimeId(state) === 'R1');
  check('second → R2',                          nextRegimeId(state) === 'R2');
}
{
  // Skips in-use ids
  const state = { regimeRegistry: { regimes: [{ id: 'R1' }, { id: 'R2' }, { id: 'R5' }], next_id: 1, version: 1 } };
  // next_id starts at 1 but R1, R2 in use → R3
  check('skips R1, R2 → R3',                    nextRegimeId(state) === 'R3');
}
{
  // After next_id pushes past R5
  const state = { regimeRegistry: { regimes: [{ id: 'R3' }, { id: 'R5' }], next_id: 4, version: 1 } };
  check('next_id=4, R5 in use → R4',            nextRegimeId(state) === 'R4');
}

// =====================================================================
group('createRegime');
{
  globalThis.localStorage.clear();
  const state = {};
  const r = createRegime(state, { label: 'Foo', axis_topology: 'one_axis_3band' });
  check('returns regime object',                !!r);
  check('id auto-assigned',                     r.id === 'R1');
  check('label stored',                         r.label === 'Foo');
  check('axis_topology stored',                 r.axis_topology === 'one_axis_3band');
  check('l2_ids defaulted to []',               Array.isArray(r.l2_ids) && r.l2_ids.length === 0);
  check('candidate_ids defaulted to []',        Array.isArray(r.candidate_ids));
  check('notes defaulted to ""',                r.notes === '');
  check('created_at + updated_at set',          typeof r.created_at === 'string'
                                                && r.created_at === r.updated_at);
  check('regime in registry',                   state.regimeRegistry.regimes.length === 1);
}
{
  // Explicit id
  const state = {};
  const r = createRegime(state, { id: 'MyRegime' });
  check('explicit id used',                     r.id === 'MyRegime');
}
{
  // Invalid axis_topology coerced to unspecified
  const state = {};
  const r = createRegime(state, { axis_topology: 'made_up' });
  check('invalid axis → unspecified',           r.axis_topology === 'unspecified');
}
{
  // Initial l2_ids + candidate_ids preserved as copies
  const state = {};
  const src = ['l2_1', 'l2_2'];
  const r = createRegime(state, { l2_ids: src });
  check('l2_ids copied (not shared ref)',       r.l2_ids !== src && r.l2_ids[0] === 'l2_1');
}
{
  // Duplicate id throws
  const state = {};
  createRegime(state, { id: 'R1' });
  let threw = false;
  try { createRegime(state, { id: 'R1' }); } catch (_) { threw = true; }
  check('duplicate id throws',                  threw);
}
{
  // Persisted to LS
  globalThis.localStorage.clear();
  const state = {};
  createRegime(state);
  check('create auto-persists',
        globalThis.localStorage.getItem(REGIMES_LS_KEY) !== null);
}

// =====================================================================
group('updateRegime');
{
  globalThis.localStorage.clear();
  const state = {};
  const r = createRegime(state, { id: 'R1', label: 'orig' });
  const createdAt = r.created_at;
  // Brief delay would be ideal but we trust ISO-millisecond resolution
  const updated = updateRegime(state, 'R1', { label: 'new', notes: 'a note' });
  check('returns updated regime',               updated.label === 'new' && updated.notes === 'a note');
  check('created_at preserved',                 updated.created_at === createdAt);
  check('updated_at bumped',                    typeof updated.updated_at === 'string');
  check('axis_topology unchanged',              updated.axis_topology === 'unspecified');
  // Patch axis_topology
  updateRegime(state, 'R1', { axis_topology: 'one_axis_3band' });
  check('axis_topology patched',                state.regimeRegistry.regimes[0].axis_topology === 'one_axis_3band');
  // Invalid axis_topology ignored
  updateRegime(state, 'R1', { axis_topology: 'oops' });
  check('invalid axis ignored',                 state.regimeRegistry.regimes[0].axis_topology === 'one_axis_3band');
}
check('update unknown id → null',              updateRegime({}, 'never_seen') === null);

// =====================================================================
group('deleteRegime');
{
  const state = {};
  createRegime(state, { id: 'R1' });
  createRegime(state, { id: 'R2' });
  check('delete returns true',                  deleteRegime(state, 'R1') === true);
  check('R1 gone',                              state.regimeRegistry.regimes.length === 1
                                                && state.regimeRegistry.regimes[0].id === 'R2');
  check('delete unknown returns false',         deleteRegime(state, 'R99') === false);
}

// =====================================================================
group('L2 membership');
{
  const state = {};
  createRegime(state, { id: 'R1' });
  check('addL2 returns true',                   addL2ToRegime(state, 'R1', 'l2_a') === true);
  check('L2 added',                             state.regimeRegistry.regimes[0].l2_ids[0] === 'l2_a');
  // Idempotent
  addL2ToRegime(state, 'R1', 'l2_a');
  check('idempotent (no duplicate)',            state.regimeRegistry.regimes[0].l2_ids.length === 1);
  addL2ToRegime(state, 'R1', 'l2_b');
  check('second L2 added',                      state.regimeRegistry.regimes[0].l2_ids.length === 2);
  // Remove
  check('removeL2 returns true',                removeL2FromRegime(state, 'R1', 'l2_a') === true);
  check('l2_a removed',                         !state.regimeRegistry.regimes[0].l2_ids.includes('l2_a'));
  check('remove unknown L2 returns false',      removeL2FromRegime(state, 'R1', 'l2_x') === false);
  // Invalid regime
  check('addL2 to unknown regime → false',      addL2ToRegime(state, 'R99', 'l2_a') === false);
  check('removeL2 from unknown regime → false', removeL2FromRegime(state, 'R99', 'l2_a') === false);
  // Invalid l2Id
  check('addL2 empty string → false',           addL2ToRegime(state, 'R1', '') === false);
  check('addL2 non-string → false',             addL2ToRegime(state, 'R1', null) === false);
}

// =====================================================================
group('regimesForL2');
{
  const state = {};
  createRegime(state, { id: 'R1' });
  createRegime(state, { id: 'R2' });
  addL2ToRegime(state, 'R1', 'l2_a');
  addL2ToRegime(state, 'R2', 'l2_a');
  addL2ToRegime(state, 'R2', 'l2_b');
  check('l2_a claimed by 2 regimes',            regimesForL2(state, 'l2_a').length === 2);
  check('l2_b claimed by 1 regime',             regimesForL2(state, 'l2_b').length === 1);
  check('l2_c claimed by 0',                    regimesForL2(state, 'l2_c').length === 0);
  check('empty id → []',                        regimesForL2(state, '').length === 0);
  check('null id → []',                         regimesForL2(state, null).length === 0);
}

// =====================================================================
group('parseTrackScopedCandRef');
{
  const r = parseTrackScopedCandRef('cand_abc');
  check('bare: candidate_id preserved',         r.candidate_id === 'cand_abc');
  check('bare: track_idx = 0',                  r.track_idx === 0);
}
{
  const r = parseTrackScopedCandRef('cand_abc#t0');
  check('explicit t0: candidate_id',            r.candidate_id === 'cand_abc');
  check('explicit t0: track_idx',               r.track_idx === 0);
}
{
  const r = parseTrackScopedCandRef('cand_abc#t1');
  check('t1: candidate_id',                     r.candidate_id === 'cand_abc');
  check('t1: track_idx',                        r.track_idx === 1);
}
check('null → null',                          parseTrackScopedCandRef(null) === null);
check('empty string → null',                  parseTrackScopedCandRef('') === null);
check('non-string → null',                    parseTrackScopedCandRef(42) === null);
{
  // Malformed suffix: fallback to bare
  const r = parseTrackScopedCandRef('cand_abc#tNotANum');
  check('non-int suffix: fallback to bare',     r.candidate_id === 'cand_abc#tNotANum'
                                                && r.track_idx === 0);
}

// =====================================================================
group('formatCandTrackRef');
check('track 0 → bare',                       formatCandTrackRef('cand_abc', 0) === 'cand_abc');
check('track 1 → scoped',                     formatCandTrackRef('cand_abc', 1) === 'cand_abc#t1');
check('track 2 → scoped',                     formatCandTrackRef('cand_abc', 2) === 'cand_abc#t2');
check('missing track defaults to 0 (bare)',   formatCandTrackRef('cand_abc') === 'cand_abc');
check('null candId → null',                   formatCandTrackRef(null, 0) === null);
check('empty string candId → null',           formatCandTrackRef('', 0) === null);

// =====================================================================
group('addCandTrackToRegime + removeCandTrackFromRegime');
{
  const state = {
    candidateList: [
      { id: 'cand1', tracks: [{}, {}] },
      { id: 'cand2', tracks: [{}] },
    ],
  };
  createRegime(state, { id: 'R1' });
  let onChangedFires = 0;
  const onChanged = () => { onChangedFires++; };
  check('add track 0 returns true',
        addCandTrackToRegime(state, 'R1', 'cand1', 0, { onCandidateListChanged: onChanged }) === true);
  const r1 = state.regimeRegistry.regimes[0];
  check('stored as bare (track 0)',             r1.candidate_ids[0] === 'cand1');
  check('mirrored onto cand.tracks[0]',         state.candidateList[0].tracks[0].regime_id === 'R1');
  check('onCandidateListChanged fired',         onChangedFires === 1);
  // Idempotent: add same pair again
  addCandTrackToRegime(state, 'R1', 'cand1', 0);
  check('dedup: still 1 entry',                 r1.candidate_ids.length === 1);
  // Add track 1: scoped form
  addCandTrackToRegime(state, 'R1', 'cand1', 1);
  check('track 1 stored as scoped',             r1.candidate_ids.includes('cand1#t1'));
  check('mirrored onto cand.tracks[1]',         state.candidateList[0].tracks[1].regime_id === 'R1');
  // Bare + scoped form dedup
  const otherState = {
    candidateList: [],
    regimeRegistry: { regimes: [{ id: 'R1', candidate_ids: ['cand_x'], l2_ids: [] }], next_id: 2, version: 1 },
  };
  addCandTrackToRegime(otherState, 'R1', 'cand_x', 0);
  check('dedup across bare/scoped: bare stays',
        otherState.regimeRegistry.regimes[0].candidate_ids.length === 1);
  // Remove
  check('remove track 0 returns true',
        removeCandTrackFromRegime(state, 'R1', 'cand1', 0) === true);
  check('cand.tracks[0].regime_id cleared',     state.candidateList[0].tracks[0].regime_id === null);
  check('only #t1 entry remains',
        r1.candidate_ids.length === 1 && r1.candidate_ids[0] === 'cand1#t1');
}
{
  // Add to unknown regime → false
  const state = { regimeRegistry: { regimes: [], next_id: 1, version: 1 } };
  check('unknown regime → false',
        addCandTrackToRegime(state, 'R99', 'cand1', 0) === false);
}
{
  // Add with invalid candId → false
  const state = {};
  createRegime(state, { id: 'R1' });
  check('empty candId → false',                 addCandTrackToRegime(state, 'R1', '', 0) === false);
  check('null candId → false',                  addCandTrackToRegime(state, 'R1', null, 0) === false);
}
{
  // Remove from absent pair → false
  const state = {};
  createRegime(state, { id: 'R1' });
  check('absent pair → false',                  removeCandTrackFromRegime(state, 'R1', 'cand_x', 0) === false);
}
{
  // onCandidateListChanged throw is caught
  const state = {};
  createRegime(state, { id: 'R1' });
  let threw = false;
  try {
    addCandTrackToRegime(state, 'R1', 'c1', 0, {
      onCandidateListChanged: () => { throw new Error('boom'); },
    });
  } catch (_) { threw = true; }
  check('onChanged throw caught (fail-soft)',   !threw);
  check('candidate still added',                state.regimeRegistry.regimes[0].candidate_ids.includes('c1'));
}

// =====================================================================
group('regimesForCandTrack');
{
  const state = {};
  createRegime(state, { id: 'R1' });
  createRegime(state, { id: 'R2' });
  addCandTrackToRegime(state, 'R1', 'cand_x', 0);
  addCandTrackToRegime(state, 'R2', 'cand_x', 0);
  addCandTrackToRegime(state, 'R2', 'cand_x', 1);
  check('cand_x track 0 claimed by 2',          regimesForCandTrack(state, 'cand_x', 0).length === 2);
  check('cand_x track 1 claimed by 1',          regimesForCandTrack(state, 'cand_x', 1).length === 1);
  check('cand_x track 2 claimed by 0',          regimesForCandTrack(state, 'cand_x', 2).length === 0);
  check('cand_y by 0 (unknown)',                regimesForCandTrack(state, 'cand_y', 0).length === 0);
  check('null cand → []',                       regimesForCandTrack(state, null, 0).length === 0);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
