// tests/test_shared_band_tracking_iv.js

import {
  IV_CALLS,
  IV_CALL_DEFAULTS,
  iv_call_samples_from_skeleton,
} from '../atlases/inversion/shared/band_tracking/iv.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('vocab');

check('IV_CALLS frozen',                Object.isFrozen(IV_CALLS));
check('IV_CALL_DEFAULTS frozen',        Object.isFrozen(IV_CALL_DEFAULTS));
check('STD_STD constant',               IV_CALLS.STD_STD === 'STD/STD');
check('HET constant',                   IV_CALLS.HET === 'HET');
check('INV_INV constant',               IV_CALLS.INV_INV === 'INV/INV');
check('dominant_frac default = 0.66',   IV_CALL_DEFAULTS.dominant_frac === 0.66);
check('min_informative default = 3',    IV_CALL_DEFAULTS.min_informative === 3);

// =====================================================================
group('iv_call_samples_from_skeleton — clean cohort');

// 6 samples × 4 windows. Sample 0,1 = HOM_A; 2,3 = HET; 4,5 = HOM_B.
// k_het = 1 at every window.
const cleanLabels = Int8Array.of(0, 0, 1, 1, 2, 2);

const skel = {
  ok: true,
  windows: [
    { w: 0, k: 1 }, { w: 1, k: 1 }, { w: 2, k: 1 }, { w: 3, k: 1 },
  ],
};
const hom_a_set = new Set([0, 1]);
const hom_b_set = new Set([4, 5]);
const anchor = {
  ok: true,
  hom_a_per_window: [hom_a_set, hom_a_set, hom_a_set, hom_a_set],
  hom_b_per_window: [hom_b_set, hom_b_set, hom_b_set, hom_b_set],
};

const r = iv_call_samples_from_skeleton({
  skeleton: skel,
  hom_anchor: anchor,
  getLabels: () => cleanLabels,
  getK: () => 3,
});
check('ok = true',                       r.ok === true);
check('n_samples = 6',                   r.n_samples === 6);
check('n_windows = 4',                   r.n_windows === 4);
check('sample 0 → STD/STD',              r.calls.get(0).call === IV_CALLS.STD_STD);
check('sample 1 → STD/STD',              r.calls.get(1).call === IV_CALLS.STD_STD);
check('sample 2 → HET',                  r.calls.get(2).call === IV_CALLS.HET);
check('sample 3 → HET',                  r.calls.get(3).call === IV_CALLS.HET);
check('sample 4 → INV/INV',              r.calls.get(4).call === IV_CALLS.INV_INV);
check('sample 5 → INV/INV',              r.calls.get(5).call === IV_CALLS.INV_INV);
check('summary n_std_std = 2',           r.summary.n_std_std === 2);
check('summary n_het = 2',               r.summary.n_het === 2);
check('summary n_inv_inv = 2',           r.summary.n_inv_inv === 2);
check('summary n_uncalled = 0',          r.summary.n_uncalled === 0);
// dominant_frac = 1 on clean cohort
check('clean: dominant_frac = 1 for sample 0',
      r.calls.get(0).dominant_frac === 1);

// =====================================================================
group('iv_call_samples_from_skeleton — AMBIGUOUS sample');

// Sample 0 oscillates: 2 windows HOM_A, 2 windows HET, 0 windows HOM_B.
// dominant_frac = 0.5 < 0.66 → AMBIGUOUS.
const oscLabels = [
  Int8Array.of(0, 0, 1, 1, 2, 2),    // w=0: sample 0 in HOM_A
  Int8Array.of(0, 0, 1, 1, 2, 2),    // w=1: sample 0 in HOM_A
  Int8Array.of(1, 0, 1, 1, 2, 2),    // w=2: sample 0 in HET
  Int8Array.of(1, 0, 1, 1, 2, 2),    // w=3: sample 0 in HET
];

const rOsc = iv_call_samples_from_skeleton({
  skeleton: skel,
  hom_anchor: anchor,
  getLabels: (w) => oscLabels[w],
  getK: () => 3,
});
check('oscillating sample 0 → AMBIGUOUS',
      rOsc.calls.get(0).call === IV_CALLS.AMBIGUOUS);
check('summary n_ambiguous ≥ 1',         rOsc.summary.n_ambiguous >= 1);

// =====================================================================
group('iv_call_samples_from_skeleton — UNCALLED (too few informative)');

// Skeleton has only 2 windows → max informative = 2 < min_informative=3
const skelShort = {
  ok: true,
  windows: [{ w: 0, k: 1 }, { w: 1, k: 1 }],
};
const anchorShort = {
  ok: true,
  hom_a_per_window: [hom_a_set, hom_a_set],
  hom_b_per_window: [hom_b_set, hom_b_set],
};
const rShort = iv_call_samples_from_skeleton({
  skeleton: skelShort,
  hom_anchor: anchorShort,
  getLabels: () => cleanLabels,
  getK: () => 3,
});
check('short skeleton: every sample UNCALLED',
      rShort.summary.n_uncalled === 6);

// Override min_informative=1 → samples get called again
const rShortCalled = iv_call_samples_from_skeleton({
  skeleton: skelShort,
  hom_anchor: anchorShort,
  getLabels: () => cleanLabels,
  getK: () => 3,
}, { min_informative: 1 });
check('min_informative=1: callable',
      rShortCalled.summary.n_uncalled === 0);

// =====================================================================
group('iv_call_samples_from_skeleton — custom dominant_frac');

// 4 windows; sample 0 is HOM_A in 3, HET in 1 → 75% HOM_A.
const partialLabels = [
  Int8Array.of(0, 0, 1, 1, 2, 2),
  Int8Array.of(0, 0, 1, 1, 2, 2),
  Int8Array.of(0, 0, 1, 1, 2, 2),
  Int8Array.of(1, 0, 1, 1, 2, 2),
];
const rPartial = iv_call_samples_from_skeleton({
  skeleton: skel,
  hom_anchor: anchor,
  getLabels: (w) => partialLabels[w],
  getK: () => 3,
}, { dominant_frac: 0.66 });
check('75% dominant + thr=0.66 → STD/STD',
      rPartial.calls.get(0).call === IV_CALLS.STD_STD);

const rStrict = iv_call_samples_from_skeleton({
  skeleton: skel,
  hom_anchor: anchor,
  getLabels: (w) => partialLabels[w],
  getK: () => 3,
}, { dominant_frac: 0.80 });
check('75% dominant + thr=0.80 → AMBIGUOUS',
      rStrict.calls.get(0).call === IV_CALLS.AMBIGUOUS);

// =====================================================================
group('iv_call_samples_from_skeleton — error paths');

check('no skeleton → ok=false',
      iv_call_samples_from_skeleton({ hom_anchor: anchor, getLabels: () => null, getK: () => 0 }).ok === false);
check('no hom_anchor → ok=false',
      iv_call_samples_from_skeleton({ skeleton: skel, getLabels: () => null, getK: () => 0 }).ok === false);
check('hom_anchor not ok → ok=false',
      iv_call_samples_from_skeleton({
        skeleton: skel,
        hom_anchor: { ok: false },
        getLabels: () => null, getK: () => 0,
      }).ok === false);
check('no callbacks → ok=false',
      iv_call_samples_from_skeleton({
        skeleton: skel, hom_anchor: anchor,
      }).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
