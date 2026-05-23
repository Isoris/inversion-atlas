// tests/test_shared_mgl_outgroup_synteny.js
import {
  normaliseSyntenyEntry,
  aggregateSyntenyVotes,
  MGL_SYNTENY_VOTES,
  MGL_SYNTENY_DEFAULTS,
} from '../atlases/evolution/shared/mgl_outgroup_synteny.js';

let pass=0, fail=0;
function check(label, cond) { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label); } }
function group(name) { console.log('\n--- ' + name + ' ---'); }

group('exports');
check('frozen votes', Object.isFrozen(MGL_SYNTENY_VOTES));
check('frozen defaults', Object.isFrozen(MGL_SYNTENY_DEFAULTS));

group('normaliseSyntenyEntry');
check('null → null', normaliseSyntenyEntry(null) === null);
const e = normaliseSyntenyEntry({ species: 'C. magur', vote: 'matches_A', confidence: 0.8 });
check('valid normalised', e && e.species === 'C. magur' && e.vote === 'matches_A' && e.confidence === 0.8);
const e2 = normaliseSyntenyEntry({ species: 'X', vote: 'garbage' });
check('invalid vote → unresolved', e2.vote === 'unresolved');
check('missing confidence → null', e2.confidence === null);

group('aggregateSyntenyVotes — empty / null');
check('null entries → insufficient_data',
      aggregateSyntenyVotes(null).verdict === 'insufficient_data');
check('empty entries → insufficient_data',
      aggregateSyntenyVotes([]).verdict === 'insufficient_data');

group('aggregateSyntenyVotes — clear majority A');
const votesA = [
  { species: 'A1', vote: 'matches_A', confidence: 1.0 },
  { species: 'A2', vote: 'matches_A', confidence: 0.9 },
  { species: 'A3', vote: 'matches_A', confidence: 0.8 },
  { species: 'B1', vote: 'matches_B', confidence: 0.5 },
];
const aA = aggregateSyntenyVotes(votesA);
check('verdict ancestral=A', aA.verdict === 'ancestral=A');
check('n_a = 3', aA.n_a === 3);
check('n_b = 1', aA.n_b === 1);
check('resolved_votes = 4', aA.resolved_votes === 4);

group('aggregateSyntenyVotes — clear majority B');
const votesB = [
  { species: 'B1', vote: 'matches_B', confidence: 1.0 },
  { species: 'B2', vote: 'matches_B', confidence: 1.0 },
  { species: 'B3', vote: 'matches_B', confidence: 1.0 },
];
const aB = aggregateSyntenyVotes(votesB);
check('verdict ancestral=B', aB.verdict === 'ancestral=B');
check('n_a = 0', aB.n_a === 0);
check('n_b = 3', aB.n_b === 3);

group('aggregateSyntenyVotes — unpolarized tie');
const votesT = [
  { species: 'A1', vote: 'matches_A', confidence: 1.0 },
  { species: 'B1', vote: 'matches_B', confidence: 1.0 },
  { species: 'A2', vote: 'matches_A', confidence: 1.0 },
  { species: 'B2', vote: 'matches_B', confidence: 1.0 },
];
const aT = aggregateSyntenyVotes(votesT);
check('verdict unpolarized', aT.verdict === 'unpolarized');

group('aggregateSyntenyVotes — insufficient resolved');
const votesU = [
  { species: 'X', vote: 'unresolved' },
  { species: 'Y', vote: 'unresolved' },
];
const aU = aggregateSyntenyVotes(votesU);
check('verdict insufficient_data', aU.verdict === 'insufficient_data');
check('n_unresolved = 2', aU.n_unresolved === 2);

group('aggregateSyntenyVotes — confidence-weighted');
const votesW = [
  { species: 'A1', vote: 'matches_A', confidence: 0.2 },
  { species: 'A2', vote: 'matches_A', confidence: 0.2 },
  { species: 'B1', vote: 'matches_B', confidence: 1.0 },
];
const aW = aggregateSyntenyVotes(votesW);
// confidence sum A = 0.4, B = 1.0; weighted leans B
check('confidence-weighted leans B', aW.verdict === 'ancestral=B');

group('aggregateSyntenyVotes — custom margin');
const closeVotes = [
  { species: 'A1', vote: 'matches_A', confidence: 1.0 },
  { species: 'A2', vote: 'matches_A', confidence: 1.0 },
  { species: 'B1', vote: 'matches_B', confidence: 1.0 },
];
// default margin 0.25 → resolves to A (2/3 vs 1/3 = 33% diff)
check('default margin: ancestral=A',
      aggregateSyntenyVotes(closeVotes).verdict === 'ancestral=A');
// strict margin 0.6 → unpolarized
check('strict margin: unpolarized',
      aggregateSyntenyVotes(closeVotes, { polarization_margin: 0.6 }).verdict === 'unpolarized');

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
