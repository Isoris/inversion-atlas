// tests/test_shared_candidate_display_name.js
//
// Unit coverage for shared/candidate_display_name.js — stable
// human-readable candidate labels (legacy lines 56827-56970).

import * as DN from '../atlases/inversion/shared/candidate_display_name.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('candidateDisplayChromShort');
check('C_gar_LG28 → LG28',          DN.candidateDisplayChromShort('C_gar_LG28') === 'LG28');
check('C_mac_LG14 → LG14',          DN.candidateDisplayChromShort('C_mac_LG14') === 'LG14');
check('chr_1 → 1',                  DN.candidateDisplayChromShort('chr_1') === '1');
check('plain LG28 unchanged',       DN.candidateDisplayChromShort('LG28') === 'LG28');
check('empty → "?"',                DN.candidateDisplayChromShort('') === '?');
check('null → "?"',                 DN.candidateDisplayChromShort(null) === '?');

// -----------------------------------------------------------------------------
group('candidateDisplayLetterSeq');
check('0 → A',                      DN.candidateDisplayLetterSeq(0) === 'A');
check('1 → B',                      DN.candidateDisplayLetterSeq(1) === 'B');
check('25 → Z',                     DN.candidateDisplayLetterSeq(25) === 'Z');
check('26 → AA',                    DN.candidateDisplayLetterSeq(26) === 'AA');
check('27 → AB',                    DN.candidateDisplayLetterSeq(27) === 'AB');
check('51 → AZ',                    DN.candidateDisplayLetterSeq(51) === 'AZ');
check('52 → BA',                    DN.candidateDisplayLetterSeq(52) === 'BA');
check('701 → ZZ',                   DN.candidateDisplayLetterSeq(701) === 'ZZ');
check('702 → AAA',                  DN.candidateDisplayLetterSeq(702) === 'AAA');
check('negative → "?"',             DN.candidateDisplayLetterSeq(-1) === '?');
check('NaN → "?"',                  DN.candidateDisplayLetterSeq(NaN) === '?');

// -----------------------------------------------------------------------------
group('buildCandidateDisplayNameMap: basic');
const cands = [
  { id: 'c1', chrom: 'C_gar_LG28', start_bp: 15_190_000, end_bp: 16_220_000 },
  { id: 'c2', chrom: 'C_gar_LG14', start_bp:  5_120_000, end_bp:  5_980_000 },
  { id: 'c3', chrom: 'LG14',       start_bp:  5_300_000, end_bp:  5_700_000 },
];
const map1 = DN.buildCandidateDisplayNameMap(cands);
check('c1 → LG28.15-16Mb.A',         map1.c1 === 'LG28.15-16Mb.A');
// c2 + c3 both LG14, both floor(5_xxx_000) so they bin together at 5-5Mb
// → degenerate single-Mb form "5Mb" — and disambiguation letters by start_bp asc.
check('c2 first (start 5.12) → A',   map1.c2 === 'LG14.5Mb.A');
check('c3 second (start 5.30) → B',  map1.c3 === 'LG14.5Mb.B');

// -----------------------------------------------------------------------------
group('buildCandidateDisplayNameMap: disambiguation ordering');
const dupCands = [
  { id: 'late', chrom: 'LG28',  start_bp: 15_500_000, end_bp: 16_500_000 },
  { id: 'mid',  chrom: 'LG28',  start_bp: 15_300_000, end_bp: 16_500_000 },
  { id: 'early', chrom: 'LG28', start_bp: 15_100_000, end_bp: 16_500_000 },
];
const dupMap = DN.buildCandidateDisplayNameMap(dupCands);
check('early (lowest start_bp) → A', dupMap.early === 'LG28.15-16Mb.A');
check('mid → B',                     dupMap.mid   === 'LG28.15-16Mb.B');
check('late → C',                    dupMap.late  === 'LG28.15-16Mb.C');

// Same-bin tiebreaker: same start_bp AND same Mb floors but different
// exact end_bp values → sort by end_bp asc
const sameBin = [
  { id: 'longer',  chrom: 'LG1', start_bp: 1_000_000, end_bp: 1_900_000 },
  { id: 'shorter', chrom: 'LG1', start_bp: 1_000_000, end_bp: 1_500_000 },
];
const sameBinMap = DN.buildCandidateDisplayNameMap(sameBin);
check('same-bin tiebreaker: shorter end_bp first',
      sameBinMap.shorter === 'LG1.1Mb.A' && sameBinMap.longer === 'LG1.1Mb.B');

// Real tie: same start AND end
const realTie = [
  { id: 'zzz', chrom: 'LG1', start_bp: 1_000_000, end_bp: 2_000_000 },
  { id: 'aaa', chrom: 'LG1', start_bp: 1_000_000, end_bp: 2_000_000 },
];
const realTieMap = DN.buildCandidateDisplayNameMap(realTie);
check('exact tie: id lexicographic (aaa first)',
      realTieMap.aaa === 'LG1.1-2Mb.A' && realTieMap.zzz === 'LG1.1-2Mb.B');

// -----------------------------------------------------------------------------
group('buildCandidateDisplayNameMap: edge cases');
check('empty → {}',                 Object.keys(DN.buildCandidateDisplayNameMap([])).length === 0);
check('null → {}',                  Object.keys(DN.buildCandidateDisplayNameMap(null)).length === 0);

// Missing bp → fallback label
const noBp = [
  { id: 'c-broken', chrom: 'C_gar_LG28' },
];
const noBpMap = DN.buildCandidateDisplayNameMap(noBp);
check('missing bp → "LG28.??Mb.?"',  noBpMap['c-broken'] === 'LG28.??Mb.?');

// Mixed valid + missing-bp candidates: valid ones still get letters
const mixed = [
  { id: 'good', chrom: 'LG14', start_bp: 1_000_000, end_bp: 2_000_000 },
  { id: 'bad', chrom: 'LG14' },
];
const mixedMap = DN.buildCandidateDisplayNameMap(mixed);
check('mixed valid: good → letter',  mixedMap.good === 'LG14.1-2Mb.A');
check('mixed invalid: bad → ?? form', mixedMap.bad === 'LG14.??Mb.?');

// Candidates without id are skipped
const noId = [
  { chrom: 'LG1', start_bp: 0, end_bp: 100 },
  { id: 'kept', chrom: 'LG1', start_bp: 0, end_bp: 100 },
];
const noIdMap = DN.buildCandidateDisplayNameMap(noId);
check('candidate without id skipped', Object.keys(noIdMap).length === 1);

// -----------------------------------------------------------------------------
group('candidateDisplayName: state-based convenience');
const state = {
  candidateList: [
    { id: 'cA', chrom: 'LG28', start_bp: 15_000_000, end_bp: 16_000_000 },
    { id: 'cB', chrom: 'LG28', start_bp: 15_500_000, end_bp: 16_000_000 },
  ],
  candidate: { id: 'cA', chrom: 'LG28', start_bp: 15_000_000, end_bp: 16_000_000 },
};

check('display name of cA from state', DN.candidateDisplayName(state, state.candidate) === 'LG28.15-16Mb.A');
check('display name of cB from state', DN.candidateDisplayName(state, state.candidateList[1]) === 'LG28.15-16Mb.B');

// Off-list candidate gets disambiguated against the loaded universe
const offList = { id: 'cX', chrom: 'LG28', start_bp: 15_200_000, end_bp: 16_000_000 };
const offName = DN.candidateDisplayName(state, offList);
check('off-list candidate disambiguated',  offName === 'LG28.15-16Mb.B'); // sorted: cA (15.0), cX (15.2), cB (15.5) → cX is B

check('null candidate → "?"',          DN.candidateDisplayName(state, null) === '?');
check('null state still works',
      DN.candidateDisplayName(null, { id: 'cX', chrom: 'LG28', start_bp: 0, end_bp: 1_000_000 })
        === 'LG28.0-1Mb.A');

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
