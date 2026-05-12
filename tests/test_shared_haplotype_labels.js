// tests/test_shared_haplotype_labels.js
//
// Unit coverage for shared/haplotype_labels.js — per-band haplotype-
// label load/save + auto-classification application (legacy lines
// 60625-60695 + 62303-62354).

import * as HL from '../atlases/inversion/shared/haplotype_labels.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// In-memory localStorage shim
function _makeLS() {
  const store = {};
  return {
    _store: store,
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
}

// -----------------------------------------------------------------------------
group('hapLabelLSKey');
check('basic chrom + id',
      HL.hapLabelLSKey('LG28', 'cand_A') === 'inversion_atlas.hap_labels.LG28.cand_A');
check('nullish chrom → "?"',
      HL.hapLabelLSKey(null, 'cand_A') === 'inversion_atlas.hap_labels.?.cand_A');
check('nullish id → "?"',
      HL.hapLabelLSKey('LG14', null) === 'inversion_atlas.hap_labels.LG14.?');
check('both nullish → "?.?"',
      HL.hapLabelLSKey(null, null) === 'inversion_atlas.hap_labels.?.?');

// -----------------------------------------------------------------------------
group('loadHaplotypeLabels');
// In-memory cache wins
const cWithCache = { chrom: 'LG28', id: 'cA', haplotype_labels: { 0: 'H1/H1', 1: 'H1/H2' } };
const cached = HL.loadHaplotypeLabels(cWithCache);
check('in-memory cache returned',  cached === cWithCache.haplotype_labels);
check('returns 2 entries',         Object.keys(cached).length === 2);

// LocalStorage hit
const ls = _makeLS();
ls.setItem('inversion_atlas.hap_labels.LG14.cB', JSON.stringify({ 0: 'fromLS' }));
const cFromLS = { chrom: 'LG14', id: 'cB' };
const lsLoaded = HL.loadHaplotypeLabels(cFromLS, { localStorage: ls });
check('LS hit: returns parsed object',     lsLoaded[0] === 'fromLS');
check('LS hit: cached on c.haplotype_labels',
      cFromLS.haplotype_labels && cFromLS.haplotype_labels[0] === 'fromLS');

// Cache miss → empty object
const cEmpty = { chrom: 'LG1', id: 'cMiss' };
const emptyMap = HL.loadHaplotypeLabels(cEmpty, { localStorage: _makeLS() });
check('empty store → {}',                  Object.keys(emptyMap).length === 0);
check('empty: c.haplotype_labels cached',  cEmpty.haplotype_labels !== undefined);

// Malformed JSON → empty object fallback
const lsBad = _makeLS();
lsBad.setItem('inversion_atlas.hap_labels.LG1.cBad', 'not-json{');
const cBad = { chrom: 'LG1', id: 'cBad' };
const badMap = HL.loadHaplotypeLabels(cBad, { localStorage: lsBad });
check('malformed JSON → {}',  Object.keys(badMap).length === 0);

// Null candidate
check('null candidate → {}',  Object.keys(HL.loadHaplotypeLabels(null)).length === 0);

// -----------------------------------------------------------------------------
group('saveHaplotypeLabels');
const lsSave = _makeLS();
const cSave = { chrom: 'LG28', id: 'cSave', haplotype_labels: { 0: 'H1/H1', 1: 'H1/H2' } };
HL.saveHaplotypeLabels(cSave, { localStorage: lsSave });
const raw = lsSave.getItem('inversion_atlas.hap_labels.LG28.cSave');
check('saved to LS',                       raw !== null);
const parsedBack = JSON.parse(raw);
check('round-trip: H1/H1',                 parsedBack[0] === 'H1/H1');

// No-op on null candidate
let saveNullOK = true;
try { HL.saveHaplotypeLabels(null, { localStorage: lsSave }); } catch (_) { saveNullOK = false; }
check('save null candidate: no-throw',  saveNullOK);

// No-op when haplotype_labels missing
const cNoLabels = { chrom: 'LG1', id: 'cX' };
HL.saveHaplotypeLabels(cNoLabels, { localStorage: lsSave });
check('no labels: nothing saved',
      lsSave.getItem('inversion_atlas.hap_labels.LG1.cX') === null);

// -----------------------------------------------------------------------------
group('setHaplotypeLabel');
const lsSet = _makeLS();
const cSet = { chrom: 'LG28', id: 'cSet' };

HL.setHaplotypeLabel(cSet, 0, 'H1/H1', { localStorage: lsSet });
check('set: in-memory label updated',
      cSet.haplotype_labels[0] === 'H1/H1');
check('set: persisted to LS',
      JSON.parse(lsSet.getItem('inversion_atlas.hap_labels.LG28.cSet'))[0] === 'H1/H1');

// Whitespace-only label → delete
HL.setHaplotypeLabel(cSet, 0, '   ', { localStorage: lsSet });
check('set whitespace: label deleted',  cSet.haplotype_labels[0] === undefined);

// Null label → delete
HL.setHaplotypeLabel(cSet, 1, 'H1/H2', { localStorage: lsSet });
HL.setHaplotypeLabel(cSet, 1, null, { localStorage: lsSet });
check('set null: label deleted',  cSet.haplotype_labels[1] === undefined);

// String trimming
HL.setHaplotypeLabel(cSet, 2, '  H2/H2  ', { localStorage: lsSet });
check('set: leading/trailing whitespace trimmed',
      cSet.haplotype_labels[2] === 'H2/H2');

// -----------------------------------------------------------------------------
group('applyAutoClassificationToCandidate');
// We need a state and a candidate that autoClassifyCandidate can classify.
// Use the simplest viable input: K=3 candidate with no per-window data so
// autoClassifyCandidate falls into the "no per-window data" branch (all
// confidence='none' → all skipped).
const cNoData = { chrom: 'LG28', id: 'cNoData', K: 3, locked_labels: [0, 1, 2] };
const noDataResult = HL.applyAutoClassificationToCandidate(cNoData, {
  localStorage: _makeLS(),
});
check('no-data candidate: applied=0',  noDataResult.applied === 0);
check('no-data candidate: skipped=3',  noDataResult.skipped === 3);
check('no-data candidate: vocab present',
      typeof noDataResult.vocab === 'string');

// Null candidate
check('null candidate: {applied:0, skipped:0}',
      HL.applyAutoClassificationToCandidate(null).applied === 0);

// confidenceFloor semantics — when no suggestion meets the floor everything
// is skipped (which is the default behaviour for the no-data case).

// -----------------------------------------------------------------------------
group('applyAutoClassificationToAllCandidates');
const stateMulti = {
  candidates: {
    cA: { chrom: 'LG28', id: 'cA', K: 3, locked_labels: [0, 1, 2] },
    cB: { chrom: 'LG14', id: 'cB', K: 3, locked_labels: [0, 1, 2] },
  },
};
const allResult = HL.applyAutoClassificationToAllCandidates(stateMulti, {
  localStorage: _makeLS(),
});
check('all: perCandidate keyed by id',
      'cA' in allResult.perCandidate && 'cB' in allResult.perCandidate);
check('all: totalApplied = 0 (no-data branch)',
      allResult.totalApplied === 0);
check('all: totalSkipped = 6 (3 bands × 2 cands)',
      allResult.totalSkipped === 6);

// Detailed mode
const stateDet = {
  activeMode: 'detailed',
  candidates: { ignored: { K: 3, locked_labels: [0, 1, 2] } },
  candidates_detailed: { d: { id: 'd', K: 3, locked_labels: [0, 1, 2] } },
};
const detResult = HL.applyAutoClassificationToAllCandidates(stateDet, {
  localStorage: _makeLS(),
});
check('detailed mode reads candidates_detailed',
      'd' in detResult.perCandidate && !('ignored' in detResult.perCandidate));

// Null state
check('null state → empty result',
      HL.applyAutoClassificationToAllCandidates(null).totalApplied === 0);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
