// tests/test_shared_candidate_mode.js
//
// Unit coverage for shared/candidate_mode.js — Parallel Candidate
// Registry mode system (legacy lines 37094-37410).

import * as PCR from '../atlases/inversion/shared/candidate_mode.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function _makeLS() {
  const store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
  };
}

// -----------------------------------------------------------------------------
group('Constants');
check('PCR_VALID_MODES frozen',     Object.isFrozen(PCR.PCR_VALID_MODES));
check('valid modes: default + detailed',
      PCR.PCR_VALID_MODES.includes('default') && PCR.PCR_VALID_MODES.includes('detailed'));
check('PCR_MODE_STORAGE_KEY',       PCR.PCR_MODE_STORAGE_KEY === 'inversion_atlas.activeMode');

// -----------------------------------------------------------------------------
group('pcrEnsureState');
const s1 = {};
PCR.pcrEnsureState(s1, { localStorage: _makeLS() });
check('default activeMode = "default"',  s1.activeMode === 'default');
check('candidate_detailed initialized',  s1.candidate_detailed === null);
check('candidateList_detailed initialized', Array.isArray(s1.candidateList_detailed));
check('candidates_detailed initialized', typeof s1.candidates_detailed === 'object');

// LS-restore
const ls2 = _makeLS();
ls2.setItem('inversion_atlas.activeMode', 'detailed');
const s2 = {};
PCR.pcrEnsureState(s2, { localStorage: ls2 });
check('LS-stored detailed restored',     s2.activeMode === 'detailed');

// Invalid LS value falls back to 'default'
const lsBad = _makeLS();
lsBad.setItem('inversion_atlas.activeMode', 'mystery');
const sBad = {};
PCR.pcrEnsureState(sBad, { localStorage: lsBad });
check('invalid LS value → default',      sBad.activeMode === 'default');

// Idempotent: re-ensure preserves slots
const s3 = { activeMode: 'detailed', candidate_detailed: { id: 'X' } };
PCR.pcrEnsureState(s3, { localStorage: _makeLS() });
check('idempotent: mode preserved',      s3.activeMode === 'detailed');
check('idempotent: existing candidate preserved',
      s3.candidate_detailed.id === 'X');

// -----------------------------------------------------------------------------
group('getActiveMode + setActiveMode');
const s4 = {};
const lsS = _makeLS();
check('getActiveMode w/o init → default', PCR.getActiveMode(s4, { localStorage: lsS }) === 'default');

check('setActiveMode("detailed") returns true',
      PCR.setActiveMode(s4, 'detailed', { localStorage: lsS }) === true);
check('getActiveMode → detailed after set',
      PCR.getActiveMode(s4, { localStorage: lsS }) === 'detailed');
check('LS-persisted after setActiveMode',
      lsS.getItem('inversion_atlas.activeMode') === 'detailed');

check('setActiveMode(invalid) → false',
      PCR.setActiveMode(s4, 'mystery') === false);
check('invalid mode does not mutate state',
      s4.activeMode === 'detailed');

// -----------------------------------------------------------------------------
group('getActiveCandidate + setActiveCandidate');
const s5 = { activeMode: 'default', candidate: { id: 'd1' }, candidate_detailed: { id: 'x1' } };
PCR.pcrEnsureState(s5, { localStorage: _makeLS() });
check('default mode reads state.candidate',
      PCR.getActiveCandidate(s5).id === 'd1');

s5.activeMode = 'detailed';
check('detailed mode reads state.candidate_detailed',
      PCR.getActiveCandidate(s5).id === 'x1');

PCR.setActiveCandidate(s5, { id: 'new_det' });
check('setActiveCandidate writes to current mode slot',
      s5.candidate_detailed.id === 'new_det');
check('does NOT cross-write to default slot',
      s5.candidate.id === 'd1');

s5.activeMode = 'default';
PCR.setActiveCandidate(s5, null);
check('set null clears default slot',
      s5.candidate === null);

// -----------------------------------------------------------------------------
group('getActiveCandidateList + getActiveCandidatesMap');
const s6 = {
  activeMode: 'default',
  candidateList: [{ id: 'a' }, { id: 'b' }],
  candidateList_detailed: [{ id: 'da' }],
  candidates: { a: { id: 'a' }, b: { id: 'b' } },
  candidates_detailed: { da: { id: 'da' } },
};
PCR.pcrEnsureState(s6, { localStorage: _makeLS() });
check('default list returned',           PCR.getActiveCandidateList(s6).length === 2);
check('default map returned',
      Object.keys(PCR.getActiveCandidatesMap(s6)).length === 2);

s6.activeMode = 'detailed';
check('detailed list returned',          PCR.getActiveCandidateList(s6).length === 1);
check('detailed map returned',
      Object.keys(PCR.getActiveCandidatesMap(s6)).length === 1);

// -----------------------------------------------------------------------------
group('clearDetailedState');
const s7 = {
  candidate_detailed: { id: 'd1' },
  candidateList_detailed: [{ id: 'd1' }, { id: 'd2' }],
  candidates_detailed: { d1: { id: 'd1' } },
  candidate: { id: 'kept' },  // default slot untouched
  candidateList: [{ id: 'kept' }],
};
PCR.clearDetailedState(s7);
check('candidate_detailed cleared',      s7.candidate_detailed === null);
check('candidateList_detailed emptied',  s7.candidateList_detailed.length === 0);
check('candidates_detailed emptied',
      Object.keys(s7.candidates_detailed).length === 0);
check('default slot untouched',          s7.candidate.id === 'kept');
check('default list untouched',          s7.candidateList[0].id === 'kept');

// -----------------------------------------------------------------------------
group('assertCandidateMode');
check('no tag → "default" implicit',
      PCR.assertCandidateMode({ id: 'a' }, 'default') === true);
check('explicit default tag matches',
      PCR.assertCandidateMode({ _system: 'default' }, 'default') === true);
check('detailed tag with detailed expected',
      PCR.assertCandidateMode({ _system: 'detailed' }, 'detailed') === true);
check('detailed tag with default expected → false',
      PCR.assertCandidateMode({ _system: 'detailed' }, 'default') === false);
check('null cand → true (no-op)',  PCR.assertCandidateMode(null, 'default') === true);

// -----------------------------------------------------------------------------
group('assertSameMode');
check('both default (no tag) → true',
      PCR.assertSameMode({ id: 'a' }, { id: 'b' }) === true);
check('default + default tag → true',
      PCR.assertSameMode({ id: 'a' }, { _system: 'default' }) === true);
check('cross-mode → false',
      PCR.assertSameMode({ _system: 'default' }, { _system: 'detailed' }) === false);
check('both detailed → true',
      PCR.assertSameMode({ _system: 'detailed' }, { _system: 'detailed' }) === true);
check('null A → true',     PCR.assertSameMode(null, { _system: 'detailed' }) === true);
check('null B → true',     PCR.assertSameMode({ _system: 'detailed' }, null) === true);

// -----------------------------------------------------------------------------
group('mergeIsolationAudit');
// Clean state
const audClean = PCR.mergeIsolationAudit({
  candidate: { id: 'a', _system: 'default' },
  candidate_detailed: { id: 'd', _system: 'detailed' },
  candidateList: [{ id: 'a' }, { _system: 'default' }],
  candidates: { a: { id: 'a' } },
  candidateList_detailed: [{ id: 'd', _system: 'detailed' }],
  candidates_detailed: { d: { id: 'd', _system: 'detailed' } },
});
check('clean state: ok = true',          audClean.ok === true);
check('clean state: zero violations',    audClean.violations.length === 0);

// Detailed candidate in default slot
const audViolDef = PCR.mergeIsolationAudit({
  candidate: { id: 'bad', _system: 'detailed' },
});
check('default slot w/ detailed tag: violation',
      audViolDef.ok === false && audViolDef.violations.length === 1);
check('violation row: slot = state.candidate',
      audViolDef.violations[0].slot === 'state.candidate');

// Default candidate in detailed slot
const audViolDet = PCR.mergeIsolationAudit({
  candidate_detailed: { id: 'wrong' },  // no _system → 'default' implicit
});
check('detailed slot w/ default tag: violation',
      audViolDet.ok === false);

// Multiple violations
const audMulti = PCR.mergeIsolationAudit({
  candidateList: [{ _system: 'detailed', id: 'x1' }, { _system: 'detailed', id: 'x2' }],
});
check('multiple violations counted',     audMulti.violations.length === 2);

// Null state
check('null state: ok = true (no-op)',   PCR.mergeIsolationAudit(null).ok === true);

// -----------------------------------------------------------------------------
group('pcrDeepCloneCandidate');
// Plain object
const orig = {
  id: 'cA', K: 3,
  locked_labels: new Int8Array([0, 1, 2]),
  l3_cuts: [50, 75],
  nested: { foo: 'bar', list: [1, 2, 3] },
};
const cloned = PCR.pcrDeepCloneCandidate(orig);
check('clone: id preserved',              cloned.id === 'cA');
check('clone: typed array re-wrapped',
      cloned.locked_labels instanceof Int8Array && cloned.locked_labels !== orig.locked_labels);
check('clone: typed array values match',  cloned.locked_labels[2] === 2);
check('clone: regular array cloned',      cloned.l3_cuts !== orig.l3_cuts);
check('clone: nested object cloned',      cloned.nested !== orig.nested);
check('clone: nested.list cloned',        cloned.nested.list !== orig.nested.list);

// Mutating clone doesn't change orig
cloned.l3_cuts.push(99);
cloned.locked_labels[0] = 9;
check('clone mutation: orig unchanged',
      orig.l3_cuts.length === 2 && orig.locked_labels[0] === 0);

// Typed array variants
check('clone Uint8Array',
      PCR.pcrDeepCloneCandidate(new Uint8Array([1, 2])) instanceof Uint8Array);
check('clone Int32Array',
      PCR.pcrDeepCloneCandidate(new Int32Array([1, 2])) instanceof Int32Array);
check('clone Float32Array',
      PCR.pcrDeepCloneCandidate(new Float32Array([1.5])) instanceof Float32Array);
check('clone Float64Array',
      PCR.pcrDeepCloneCandidate(new Float64Array([1.5])) instanceof Float64Array);

// Scalars pass through unchanged
check('null → null',           PCR.pcrDeepCloneCandidate(null) === null);
check('number → same',         PCR.pcrDeepCloneCandidate(42) === 42);
check('string → same',         PCR.pcrDeepCloneCandidate('x') === 'x');

// -----------------------------------------------------------------------------
group('initDetailedFromDefault');
const sInit = {
  candidate: { id: 'active', K: 3 },
  candidateList: [{ id: 'a', K: 3 }, { id: 'b', K: 3 }],
  candidates: { a: { id: 'a', K: 3 }, b: { id: 'b', K: 3 } },
};
const count = PCR.initDetailedFromDefault(sInit);
check('returns count of duplicated candidates',  count === 2);
check('candidate_detailed populated',            sInit.candidate_detailed.id === 'active');
check('candidate_detailed tagged _system',
      sInit.candidate_detailed._system === 'detailed');
check('candidateList_detailed populated',
      sInit.candidateList_detailed.length === 2);
check('candidateList_detailed entries tagged',
      sInit.candidateList_detailed.every(c => c._system === 'detailed'));
check('candidates_detailed populated',
      Object.keys(sInit.candidates_detailed).length === 2);
check('candidates_detailed entries tagged',
      Object.values(sInit.candidates_detailed).every(c => c._system === 'detailed'));

// Clones are independent
sInit.candidate_detailed.K = 99;
check('detailed clone: independent from default',
      sInit.candidate.K === 3);

// Empty state: zero duplicated
const sEmpty = {};
PCR.pcrEnsureState(sEmpty, { localStorage: _makeLS() });
const countEmpty = PCR.initDetailedFromDefault(sEmpty);
check('empty state: count = 0',  countEmpty === 0);

// Null state: no-throw
let safeInit = true;
try { PCR.initDetailedFromDefault(null); } catch (_) { safeInit = false; }
check('null state: no-throw',  safeInit);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
