// tests/test_shared_mgl_inversion_divergence.js
import {
  perSiteClassFrequencies,
  divergenceFromFreqs,
  privateAndFixed,
  ageClass,
  computeDivergence,
  MGL_DIVERGENCE_DEFAULTS,
} from '../atlases/evolution/shared/mgl_inversion_divergence.js';

let pass=0, fail=0;
function check(l, c) { if (c) { pass++; console.log('  ✓', l); } else { fail++; console.log('  ✗', l); } }
function group(n) { console.log('\n--- ' + n + ' ---'); }

group('exports');
check('frozen defaults', Object.isFrozen(MGL_DIVERGENCE_DEFAULTS));
check('perSiteClassFrequencies fn', typeof perSiteClassFrequencies === 'function');
check('divergenceFromFreqs fn', typeof divergenceFromFreqs === 'function');
check('privateAndFixed fn', typeof privateAndFixed === 'function');
check('ageClass fn', typeof ageClass === 'function');
check('computeDivergence fn', typeof computeDivergence === 'function');

// Fixture: 8 samples; INV at [0..3], STD at [4..7]; 10 markers.
//   marker 0..3: INV all 2, STD all 0  → high divergence, fixed differences
//   marker 4..5: INV polymorphic (1,1,0,0), STD all 0  → private INV
//   marker 6..7: INV all 0, STD polymorphic            → private STD
//   marker 8..9: INV all 0, STD all 0                  → invariant
const dosage = [];
for (let mi = 0; mi < 4; mi++) dosage.push(Float64Array.from([2,2,2,2, 0,0,0,0]));
dosage.push(Float64Array.from([1,1,0,0, 0,0,0,0]));
dosage.push(Float64Array.from([1,1,0,0, 0,0,0,0]));
dosage.push(Float64Array.from([0,0,0,0, 1,1,0,0]));
dosage.push(Float64Array.from([0,0,0,0, 1,1,0,0]));
dosage.push(Float64Array.from([0,0,0,0, 0,0,0,0]));
dosage.push(Float64Array.from([0,0,0,0, 0,0,0,0]));

group('perSiteClassFrequencies');
const freqs = perSiteClassFrequencies({
  dosage, n_markers: 10, n_samples: 8,
  inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
});
check('site 0: freq_inv = 1', freqs.freq_inv[0] === 1);
check('site 0: freq_std = 0', freqs.freq_std[0] === 0);
check('n_called_inv = 4', freqs.n_called_inv[0] === 4);
check('site 4: freq_inv = 0.25', Math.abs(freqs.freq_inv[4] - 0.25) < 1e-9);
check('site 8: freq = 0 in both', freqs.freq_inv[8] === 0 && freqs.freq_std[8] === 0);

group('divergenceFromFreqs');
const div = divergenceFromFreqs(freqs);
check('dxy > 0', div.dxy > 0);
check('fst > 0', div.fst_hudson > 0);
check('pi_inv finite', Number.isFinite(div.pi_inv));
check('n_sites_evaluated = 10 (none skipped)', div.n_sites_evaluated === 10);

group('privateAndFixed');
const pvf = privateAndFixed(freqs);
check('fixed_differences = 4 (markers 0..3)', pvf.fixed_differences === 4);
check('private_inv = 2 (markers 4..5)', pvf.private_inv === 2);
check('private_std = 2 (markers 6..7)', pvf.private_std === 2);

group('ageClass — manual fixtures');
// young_clean: low pi_inv + high FST + shallow dxy
check('young_clean',
      ageClass({ pi_inv: 0.001, pi_std: 0.005, dxy: 0.005, fst_hudson: 0.6,
                 private_inv: 5, private_std: 10, fixed_differences: 0 }).age_class === 'young_clean');
// old_divergent
check('old_divergent',
      ageClass({ pi_inv: 0.010, pi_std: 0.008, dxy: 0.015, fst_hudson: 0.5,
                 private_inv: 50, private_std: 20, fixed_differences: 0 }).age_class === 'old_divergent');
// old_swept
check('old_swept',
      ageClass({ pi_inv: 0.001, pi_std: 0.005, dxy: 0.015, fst_hudson: 0.7,
                 private_inv: 5, private_std: 5, fixed_differences: 0 }).age_class === 'old_swept');
// leaky
check('leaky',
      ageClass({ pi_inv: 0.012, pi_std: 0.008, dxy: 0.002, fst_hudson: 0.05,
                 private_inv: 5, private_std: 5, fixed_differences: 0 }).age_class === 'leaky');
// insufficient
check('insufficient when not finite',
      ageClass({ pi_inv: NaN, pi_std: NaN, dxy: NaN, fst_hudson: NaN,
                 private_inv: 0, private_std: 0, fixed_differences: 0 }).age_class === 'insufficient');

group('computeDivergence — end-to-end');
const r = computeDivergence({
  dosage, n_markers: 10, n_samples: 8,
  inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
});
check('result has age_class', typeof r.age_class === 'string');
check('age_class_reason is string', typeof r.age_class_reason === 'string');
check('private_inv = 2', r.private_inv === 2);
check('fixed_differences = 4', r.fixed_differences === 4);

group('computeDivergence — null safety');
check('null args → insufficient',
      computeDivergence(null).age_class === 'insufficient');
check('missing std_idx → insufficient',
      computeDivergence({ dosage, n_markers: 10, n_samples: 8,
                          inv_idx: [0,1,2,3] }).age_class === 'insufficient');

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
