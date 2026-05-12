// tests/test_shared_candidate_registry.js
//
// Unit coverage for shared/candidate_registry.js — in-memory CRUD +
// localStorage persistence for the candidate list (legacy lines
// 57304-57435).

import * as CR from '../atlases/inversion/shared/candidate_registry.js';
import { candidateFromJSON } from '../atlases/inversion/shared/candidate_io.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function _makeLS() {
  const store = {};
  return {
    _store: store,
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

// -----------------------------------------------------------------------------
group('candStorageKey');
check('LG28 → pca_scrubber_v3.candidates.LG28',
      CR.candStorageKey('LG28') === 'pca_scrubber_v3.candidates.LG28');
check('null → _unknown',
      CR.candStorageKey(null) === 'pca_scrubber_v3.candidates._unknown');

// -----------------------------------------------------------------------------
group('isInCandidateList');
const s1 = { candidateList: [{ id: 'a' }, { id: 'b' }] };
check('present id → true',     CR.isInCandidateList(s1, 'a') === true);
check('absent id → false',     CR.isInCandidateList(s1, 'z') === false);
check('null state → false',    CR.isInCandidateList(null, 'a') === false);
check('no list → false',       CR.isInCandidateList({}, 'a') === false);

// -----------------------------------------------------------------------------
group('addCandidateToList');
const ls2 = _makeLS();
const s2 = { data: { chrom: 'LG28' }, candidateList: [] };
const added1 = CR.addCandidateToList(s2, { id: 'cA' }, { localStorage: ls2 });
check('newly added: true',        added1 === true);
check('candidateList grew to 1',  s2.candidateList.length === 1);
check('persisted to LS',
      ls2.getItem('pca_scrubber_v3.candidates.LG28') !== null);

// Idempotent: re-add same id is no-op
const added2 = CR.addCandidateToList(s2, { id: 'cA' }, { localStorage: ls2 });
check('duplicate add: false',     added2 === false);
check('candidateList unchanged',  s2.candidateList.length === 1);

// Null cand / missing id
check('null cand: false',         CR.addCandidateToList(s2, null) === false);
check('missing id: false',        CR.addCandidateToList(s2, { foo: 'bar' }) === false);

// onChange / onPersist callbacks
let onChangeCalls = 0;
let onPersistCalls = 0;
CR.addCandidateToList(s2, { id: 'cB' }, {
  localStorage: ls2,
  onChange:  () => { onChangeCalls++; },
  onPersist: () => { onPersistCalls++; },
});
check('onPersist fired',          onPersistCalls === 1);
check('onChange fired',           onChangeCalls === 1);

// -----------------------------------------------------------------------------
group('removeCandidateFromList');
const s3 = { data: { chrom: 'LG14' }, candidateList: [{ id: 'a' }, { id: 'b' }] };
const ls3 = _makeLS();
const rem1 = CR.removeCandidateFromList(s3, 'a', { localStorage: ls3 });
check('removed: true',            rem1 === true);
check('candidateList: 1 left',    s3.candidateList.length === 1);
check('remaining is b',           s3.candidateList[0].id === 'b');

// Removing missing id: no-op
const rem2 = CR.removeCandidateFromList(s3, 'z', { localStorage: ls3 });
check('absent id: false',         rem2 === false);
check('candidateList unchanged',  s3.candidateList.length === 1);

// -----------------------------------------------------------------------------
group('persistCandidateList');
const ls4 = _makeLS();
const s4 = {
  data: { chrom: 'LG1' },
  candidateList: [{ id: 'p1', K: 3 }, { id: 'p2', K: 3 }],
};

let rebuilt = false, invalidated = false;
CR.persistCandidateList(s4, {
  localStorage: ls4,
  rebuildRegistries:    () => { rebuilt = true; },
  invalidateInheritance: () => { invalidated = true; },
});
check('rebuildRegistries fired',  rebuilt);
check('invalidateInheritance fired', invalidated);
const stored = ls4.getItem('pca_scrubber_v3.candidates.LG1');
check('LS write contains both ids',
      stored.includes('p1') && stored.includes('p2'));

// No state.data → no LS write (returns silently)
const ls4b = _makeLS();
const s4b = { candidateList: [{ id: 'p1' }] };
CR.persistCandidateList(s4b, { localStorage: ls4b });
check('no state.data: no LS write',
      ls4b.getItem('pca_scrubber_v3.candidates._unknown') === null);

// localStorage write failure is silent (uses a shim that throws)
const throwingLS = {
  setItem: () => { throw new Error('quota'); },
  getItem: () => null,
  removeItem: () => {},
};
let safeWrite = true;
try {
  CR.persistCandidateList({ data: { chrom: 'LG1' }, candidateList: [{ id: 'x' }] },
                          { localStorage: throwingLS });
} catch (_) { safeWrite = false; }
check('LS write failure: silent',  safeWrite);

// Callback failures are silent
let safeRebuild = true;
try {
  CR.persistCandidateList(s4, {
    localStorage: ls4,
    rebuildRegistries: () => { throw new Error('boom'); },
  });
} catch (_) { safeRebuild = false; }
check('callback throw: silent',  safeRebuild);

// -----------------------------------------------------------------------------
group('restoreCandidateList');
// Save then restore: round-trip
const ls5 = _makeLS();
const s5a = {
  data: { chrom: 'LG1' },
  candidateList: [{ id: 'r1', K: 3, chrom: 'LG1', source: 'manual' }],
};
CR.persistCandidateList(s5a, { localStorage: ls5 });

const s5b = { data: { chrom: 'LG1' }, candidateList: [] };
const restored = CR.restoreCandidateList(s5b, {
  fromJSON: candidateFromJSON,
  localStorage: ls5,
});
check('restored 1 entry',         restored.length === 1);
check('restored id preserved',    restored[0].id === 'r1');
check('state.candidateList set',  s5b.candidateList.length === 1);

// No fromJSON → returns existing list
const s5c = { data: { chrom: 'LG1' }, candidateList: [{ id: 'orig' }] };
const noFromJSON = CR.restoreCandidateList(s5c, { localStorage: ls5 });
check('no fromJSON: returns existing list',
      noFromJSON.length === 1 && noFromJSON[0].id === 'orig');

// No LS entry: returns existing list
const ls6 = _makeLS();
const s6 = { data: { chrom: 'LGZ' }, candidateList: [{ id: 'in-mem' }] };
const noLSRestored = CR.restoreCandidateList(s6, {
  fromJSON: candidateFromJSON, localStorage: ls6,
});
check('no LS entry: returns existing',
      noLSRestored.length === 1 && noLSRestored[0].id === 'in-mem');

// Malformed JSON in LS → returns existing list
const ls7 = _makeLS();
ls7.setItem('pca_scrubber_v3.candidates.LG1', 'not-json{');
const s7 = { data: { chrom: 'LG1' }, candidateList: [{ id: 'fallback' }] };
const badJsonRestored = CR.restoreCandidateList(s7, {
  fromJSON: candidateFromJSON, localStorage: ls7,
});
check('malformed JSON: fallback to existing',
      badJsonRestored.length === 1 && badJsonRestored[0].id === 'fallback');

// -----------------------------------------------------------------------------
group('clearCandidateList');
const ls8 = _makeLS();
ls8.setItem('pca_scrubber_v3.candidates.LG2', 'whatever');
const s8 = { data: { chrom: 'LG2' }, candidateList: [{ id: 'a' }, { id: 'b' }] };
CR.clearCandidateList(s8, { localStorage: ls8 });
check('clear: candidateList = []',  s8.candidateList.length === 0);
check('clear: LS entry removed',
      ls8.getItem('pca_scrubber_v3.candidates.LG2') === null);

// Null state: no-op
let safeClear = true;
try { CR.clearCandidateList(null); } catch (_) { safeClear = false; }
check('null state: no-throw',  safeClear);

// -----------------------------------------------------------------------------
group('persistActiveCandidateId + restoreActiveCandidateId');
check('ACTIVE_CAND_STORAGE_KEY constant',
      CR.ACTIVE_CAND_STORAGE_KEY === 'pca_scrubber_v3.activeCandidateId');

const lsA = _makeLS();
CR.persistActiveCandidateId('cand_X', { localStorage: lsA });
check('persisted to LS',
      lsA.getItem('pca_scrubber_v3.activeCandidateId') === 'cand_X');
check('restored matches',
      CR.restoreActiveCandidateId({ localStorage: lsA }) === 'cand_X');

// Clear with null
CR.persistActiveCandidateId(null, { localStorage: lsA });
check('null cleared LS',
      lsA.getItem('pca_scrubber_v3.activeCandidateId') === null);
check('restore after clear → null',
      CR.restoreActiveCandidateId({ localStorage: lsA }) === null);

// Empty string acts like null
CR.persistActiveCandidateId('cand_Y', { localStorage: lsA });
CR.persistActiveCandidateId('', { localStorage: lsA });
check('empty string clears LS',
      lsA.getItem('pca_scrubber_v3.activeCandidateId') === null);

// LS write failure is silent
const throwingLS2 = {
  getItem: () => { throw new Error('boom'); },
  setItem: () => { throw new Error('boom'); },
  removeItem: () => { throw new Error('boom'); },
};
let safePersist = true;
try {
  CR.persistActiveCandidateId('id', { localStorage: throwingLS2 });
  CR.persistActiveCandidateId(null, { localStorage: throwingLS2 });
} catch (_) { safePersist = false; }
check('throwing LS: persist silent',  safePersist);
check('throwing LS: restore returns null',
      CR.restoreActiveCandidateId({ localStorage: throwingLS2 }) === null);

// No localStorage shim: silent + returns null
check('no LS shim: restore returns null',
      CR.restoreActiveCandidateId({ localStorage: null }) === null);

// -----------------------------------------------------------------------------
group('removeCandidateFully');
const sR = {
  data: { chrom: 'LG28' },
  candidateList: [{ id: 'cA' }, { id: 'cB' }, { id: 'cC' }],
  candidate: { id: 'cB' },
};
const lsR = _makeLS();

// Remove the active candidate by id
let refreshCalls = 0;
const r1 = CR.removeCandidateFully(sR, 'cB', {
  localStorage: lsR,
  onUiRefresh: () => { refreshCalls++; },
});
check('returns true',                  r1 === true);
check('candidateList size = 2',        sR.candidateList.length === 2);
check('state.candidate cleared',       sR.candidate === null);
check('onUiRefresh fired',             refreshCalls === 1);

// Active id cleared from LS
lsR.setItem('pca_scrubber_v3.activeCandidateId', 'cB');
sR.candidateList = [{ id: 'cA' }, { id: 'cB' }];
sR.candidate = { id: 'cB' };
CR.removeCandidateFully(sR, 'cB', { localStorage: lsR });
check('LS active-candidate id cleared',
      lsR.getItem('pca_scrubber_v3.activeCandidateId') === null);

// Remove a non-active candidate — state.candidate untouched
const sR2 = {
  data: { chrom: 'LG14' },
  candidateList: [{ id: 'cA' }, { id: 'cB' }],
  candidate: { id: 'cA' },
};
CR.removeCandidateFully(sR2, 'cB', { localStorage: _makeLS() });
check('non-active remove: state.candidate untouched',
      sR2.candidate && sR2.candidate.id === 'cA');

// Default id = currently-focused candidate
const sR3 = {
  data: { chrom: 'LG1' },
  candidateList: [{ id: 'cX' }, { id: 'cY' }],
  candidate: { id: 'cY' },
};
const r3 = CR.removeCandidateFully(sR3, null, { localStorage: _makeLS() });
check('null id defaults to active: removed cY',
      r3 === true && sR3.candidateList.length === 1 && sR3.candidateList[0].id === 'cX');
check('state.candidate cleared after default-id remove',
      sR3.candidate === null);

// No active + no id → false (no-op)
const sR4 = { candidateList: [], candidate: null };
check('no id + no active → false',
      CR.removeCandidateFully(sR4, null) === false);

// Null state → false
check('null state → false',           CR.removeCandidateFully(null, 'x') === false);

// Throwing onUiRefresh: silent
let safeUiRefresh = true;
try {
  CR.removeCandidateFully({
    data: { chrom: 'LG1' },
    candidateList: [{ id: 'cZ' }],
    candidate: { id: 'cZ' },
  }, 'cZ', {
    localStorage: _makeLS(),
    onUiRefresh: () => { throw new Error('boom'); },
  });
} catch (_) { safeUiRefresh = false; }
check('throwing onUiRefresh: silent',  safeUiRefresh);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
