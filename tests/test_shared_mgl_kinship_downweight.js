// tests/test_shared_mgl_kinship_downweight.js
import {
  kinshipWeights, familyWeights, computeSampleWeights, weightsSummary,
  MGL_KINSHIP_DEFAULTS,
} from '../atlases/inversion/shared/mgl_kinship_downweight.js';

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

group('exports');
check('defaults frozen', Object.isFrozen(MGL_KINSHIP_DEFAULTS));

group('kinshipWeights');
// 3 samples; sample 0 strongly related to sample 1 (kinship 0.5);
// sample 2 unrelated.
const k = Float64Array.from([
  1.0, 0.5, 0.0,
  0.5, 1.0, 0.0,
  0.0, 0.0, 1.0,
]);
const wK = kinshipWeights(k, 3, 0.1);
check('sample 0 downweighted', Math.abs(wK[0] - 0.5) < 1e-9);
check('sample 1 downweighted', Math.abs(wK[1] - 0.5) < 1e-9);
check('sample 2 full weight',  wK[2] === 1);
check('null kinship → all 1',
      kinshipWeights(null, 3, 0.1).every(w => w === 1));

group('familyWeights');
const wF = familyWeights(['A', 'A', 'B', 'A', null], 5);
check('family A samples: weight 1/3',
      Math.abs(wF[0] - 1/3) < 1e-9 && Math.abs(wF[1] - 1/3) < 1e-9);
check('family B singleton: weight 1', wF[2] === 1);
check('null family id: weight 1',     wF[4] === 1);
check('null array → all 1',
      familyWeights(null, 5).every(w => w === 1));

group('computeSampleWeights');
const w = computeSampleWeights({
  n_samples: 5,
  kinship: Float64Array.from([
    1, 0.5, 0, 0, 0,
    0.5, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0.3,
    0, 0, 0, 0.3, 1,
  ]),
  family_ids: ['A', 'A', 'B', null, null],
  hatchery_dup: [false, false, false, true, false],
});
check('sample 0: kinship 0.5 × family 1/2 = 0.25',
      Math.abs(w[0] - 0.25) < 1e-9);
check('sample 2: unrelated singleton = 1', w[2] === 1);
check('sample 3: hatchery_dup → 0', w[3] === 0);
check('sample 4: kinship 0.3 = 0.7', Math.abs(w[4] - 0.7) < 1e-9);
check('null args → empty', computeSampleWeights(null).length === 0);
check('n_samples=0 → empty', computeSampleWeights({ n_samples: 0 }).length === 0);

group('weightsSummary');
const s = weightsSummary(Float64Array.from([1, 0.5, 0, 1, 0.95]));
check('n_total = 5', s.n_total === 5);
check('n_clean = 3 (1, 1, 0.95)', s.n_clean === 3);
check('n_downweighted = 1 (0.5)', s.n_downweighted === 1);
check('n_excluded = 1 (0)', s.n_excluded === 1);

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
