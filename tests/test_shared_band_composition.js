// tests/test_shared_band_composition.js
//
// Unit coverage for shared/band_composition.js — per-band family +
// ancestry tallies (legacy lines 10465-10500 + 61065).

import * as BC from '../atlases/inversion/shared/band_composition.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// -----------------------------------------------------------------------------
group('bandSampleCounts');
check('basic: 3 bands, 6 labels',
      BC.bandSampleCounts([0, 1, 2, 0, 1, 2], 3).join(',') === '2,2,2');
check('out-of-range labels skipped',
      BC.bandSampleCounts([0, 1, 5, 0, -1, 2], 3).join(',') === '2,1,1');
check('null labels → all zeros',
      BC.bandSampleCounts(null, 3).join(',') === '0,0,0');
check('K=0 → empty array',
      BC.bandSampleCounts([0, 1], 0).length === 0);

// -----------------------------------------------------------------------------
group('candidateBandComposition: basic');
const samples = [
  { id: 'A', family_id: 1, ancestry: 'EU' },
  { id: 'B', family_id: 1, ancestry: 'EU' },
  { id: 'C', family_id: 2, ancestry: 'AS' },
  { id: 'D', family_id: 2, ancestry: 'AS' },
  { id: 'E', family_id: -1, ancestry: 'AF' },  // -1 → unknown
  { id: 'F', family_id: 3 },                    // no ancestry
];
const candidate = {
  K: 2,
  locked_labels: [0, 0, 1, 1, 0, 1],
};
const comp = BC.candidateBandComposition(candidate, samples);
check('2 bands returned',          comp.length === 2);

const band0 = comp[0];
check('band 0: n = 3',             band0.n === 3);
check('band 0: members = [0,1,4]', band0.members.join(',') === '0,1,4');
// Band 0: family 1 (2x), family unknown (1x)
check('band 0: families count = 2', band0.families.length === 2);
check('band 0: top family = 1 with n=2',
      band0.families[0].family_id === 1 && band0.families[0].n === 2);
check('band 0: top family frac ≈ 0.667',
      Math.abs(band0.families[0].frac - 2/3) < 1e-9);
check('band 0: ancestries sorted desc',
      band0.ancestries[0].n >= band0.ancestries[band0.ancestries.length - 1].n);

const band1 = comp[1];
check('band 1: n = 3',             band1.n === 3);
// Band 1: family 2 (2x), family 3 (1x)
check('band 1: top family = 2',    band1.families[0].family_id === 2);

// -----------------------------------------------------------------------------
group('candidateBandComposition: derived K');
const noK = { locked_labels: [0, 0, 1, 1, 2, 2] };
const derivedComp = BC.candidateBandComposition(noK, samples);
check('K derived from labels: 3 bands',  derivedComp.length === 3);

// -----------------------------------------------------------------------------
group('candidateBandComposition: edge cases');
check('null candidate → null',     BC.candidateBandComposition(null, samples) === null);
check('no locked_labels → null',
      BC.candidateBandComposition({ K: 2 }, samples) === null);
check('null samples → still works',
      BC.candidateBandComposition({ K: 2, locked_labels: [0, 0, 1, 1] }, null).length === 2);
check('empty samples: all unknown family',
      BC.candidateBandComposition({ K: 1, locked_labels: [0, 0, 0] }, [])[0]
        .families[0].family_id === 'unknown');

// Empty band yields n=0 + empty arrays
const candWithEmptyBand = { K: 3, locked_labels: [0, 0, 1, 1] };
const compEmpty = BC.candidateBandComposition(candWithEmptyBand, samples);
check('empty band: n = 0',         compEmpty[2].n === 0);
check('empty band: families = []', compEmpty[2].families.length === 0);

// -----------------------------------------------------------------------------
group('Self-check');
check('valid composition passes self-check',  BC._bandCompositionSelfCheck(comp));
check('null fails self-check',                 BC._bandCompositionSelfCheck(null) === false);

// -----------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
