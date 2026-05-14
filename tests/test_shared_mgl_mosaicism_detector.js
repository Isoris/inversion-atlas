// tests/test_shared_mgl_mosaicism_detector.js
import {
  classMeansPerSite,
  perWindowLeakage,
  integrityVerdict,
  MGL_MOSAICISM_DEFAULTS,
} from '../atlases/inversion/shared/mgl_mosaicism_detector.js';

let pass=0, fail=0;
function check(l,c){ if (c) {pass++; console.log('  ✓',l);} else {fail++; console.log('  ✗',l);} }
function group(n){ console.log('\n--- '+n+' ---'); }

group('exports');
check('frozen defaults', Object.isFrozen(MGL_MOSAICISM_DEFAULTS));
check('classMeansPerSite fn', typeof classMeansPerSite === 'function');
check('perWindowLeakage fn', typeof perWindowLeakage === 'function');
check('integrityVerdict fn', typeof integrityVerdict === 'function');

// Fixture: 8 samples (INV 0..3, STD 4..7), 40 markers in 2 windows of
// 20 each. INV samples are mostly INV-like (dosage 2) but sample 0
// has STD-like (dosage 0) at window 1 → leaky.
const dosage = [];
for (let mi = 0; mi < 40; mi++) {
  if (mi < 20) {
    dosage.push(Float64Array.from([2, 2, 2, 2, 0, 0, 0, 0]));
  } else {
    // window 1: sample 0 looks like STD (dosage 0).
    dosage.push(Float64Array.from([0, 2, 2, 2, 0, 0, 0, 0]));
  }
}

group('classMeansPerSite');
const means = classMeansPerSite({
  dosage, n_markers: 40, n_samples: 8, inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
});
check('inv mean site 0 = 2', means.inv[0] === 2);
check('std mean site 0 = 0', means.std[0] === 0);
check('inv mean site 20 ≈ 1.5 (3/4)', Math.abs(means.inv[20] - 1.5) < 1e-9);

group('perWindowLeakage — fixture');
const L = perWindowLeakage({
  dosage, n_markers: 40, n_samples: 8,
  inv_idx: [0,1,2,3], std_idx: [4,5,6,7],
  opts: { window_size_markers: 20 },
});
check('2 windows', L.n_windows === 2);
check('4 inv samples', L.n_inv === 4);
check('sample 0 window 0 leakage ≈ 0',
      Math.abs(L.per_sample_per_window[0 * 2 + 0]) < 0.1);
check('sample 0 window 1 leakage > 0.5 (STD-like)',
      L.per_sample_per_window[0 * 2 + 1] > 0.5);
// sample 1 has INV pattern throughout (cleaner) — leakage at window 1
// should be lower than sample 0's.
check('sample 0 window 1 leakage > sample 1 window 1',
      L.per_sample_per_window[0 * 2 + 1] >
      L.per_sample_per_window[1 * 2 + 1]);
check('per_sample_leakage length = 4', L.per_sample_leakage.length === 4);
check('window_starts/ends populated',
      L.window_starts[0] === 0 && L.window_ends[0] === 20
   && L.window_starts[1] === 20 && L.window_ends[1] === 40);

// Empty / null safety.
check('null args → zero windows',
      perWindowLeakage(null).n_windows === 0);
check('empty inv_idx → zero',
      perWindowLeakage({ dosage, n_markers: 40, n_samples: 8, inv_idx: [] }).n_windows === 0);

group('integrityVerdict');
// 5 clean (leakage 0), 1 mostly leaky (0.6), 1 intermediate (0.2)
const psl = Float64Array.from([0, 0, 0, 0, 0, 0.6, 0.2]);
const v = integrityVerdict(psl);
check('n_clean = 5', v.n_clean === 5);
check('n_leaky = 1', v.n_leaky === 1);
check('n_intermediate = 1', v.n_intermediate === 1);
check('integrity = clean', v.integrity === 'clean');

// All leaky.
const v2 = integrityVerdict(Float64Array.from([0.5, 0.6, 0.7]));
check('all leaky → integrity = leaky', v2.integrity === 'leaky');

// Empty.
check('empty → insufficient', integrityVerdict(new Float64Array(0)).integrity === 'insufficient');
check('null → insufficient', integrityVerdict(null).integrity === 'insufficient');

console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
