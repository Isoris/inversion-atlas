// tests/test_shared_band_tracking_hom.js

import {
  HOM_DEFAULTS,
  hom_anchor_in_window,
  hom_anchor_to_het,
} from '../atlases/inversion/shared/band_tracking/hom.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('defaults');

check('frozen',                       Object.isFrozen(HOM_DEFAULTS));
check('consensus_min_frac = 0.5',     HOM_DEFAULTS.consensus_min_frac === 0.5);

// =====================================================================
group('hom_anchor_in_window');

const labels = Int8Array.of(0, 0, 1, 1, 2, 2);
const pc1    = Float32Array.of(-2, -1, 0, 0.2, 3, 3.5);
const r = hom_anchor_in_window(labels, pc1, 3, 1);
check('k_hom_low = 0',                r.k_hom_low === 0);
check('k_hom_high = 2',               r.k_hom_high === 2);
check('mean_pc1 length 3',            r.mean_pc1.length === 3);

// With het_k=null, the het band (index 1) is included → still picks 0 / 2
const r2 = hom_anchor_in_window(labels, pc1, 3, null);
check('without het exclude: still 0 / 2', r2.k_hom_low === 0 && r2.k_hom_high === 2);

check('K=1 → null',                   hom_anchor_in_window(Int8Array.of(0), Float32Array.of(1), 1) === null);

// Two bands collapse to same mean → null
const labelsTie = Int8Array.of(0, 1);
const pc1Tie    = Float32Array.of(1, 1);
check('tied means → null',            hom_anchor_in_window(labelsTie, pc1Tie, 2) === null);

// =====================================================================
group('hom_anchor_to_het — clean skeleton');

// Build a fake skeleton with 3 windows, k=1 het at each.
const labelsClean = Int8Array.of(0, 0, 1, 1, 2, 2);
const pc1Clean    = Float32Array.of(-2, -1, 0, 0.2, 3, 3.5);
const skel = {
  ok: true,
  windows: [
    { w: 0, k: 1 },
    { w: 1, k: 1 },
    { w: 2, k: 1 },
  ],
};
const anchor = hom_anchor_to_het({
  skeleton: skel,
  getLabels: () => labelsClean,
  getPc1:    () => pc1Clean,
  getK:      () => 3,
});
check('ok = true',                    anchor.ok === true);
check('n_windows = 3',                anchor.n_windows === 3);
check('hom_a_per_window length 3',    anchor.hom_a_per_window.length === 3);
check('hom_a window contains 0,1',
      anchor.hom_a_per_window[0].has(0) && anchor.hom_a_per_window[0].has(1));
check('hom_b window contains 4,5',
      anchor.hom_b_per_window[0].has(4) && anchor.hom_b_per_window[0].has(5));
// Consensus: samples 0,1 should be HOM_A; 4,5 should be HOM_B.
check('consensus HOM_A = {0, 1}',
      anchor.hom_a_consensus.size === 2
      && anchor.hom_a_consensus.has(0)
      && anchor.hom_a_consensus.has(1));
check('consensus HOM_B = {4, 5}',
      anchor.hom_b_consensus.size === 2
      && anchor.hom_b_consensus.has(4)
      && anchor.hom_b_consensus.has(5));
check('hom_a_score[0] = 1',           anchor.hom_a_score.get(0) === 1);
check('hom_b_score[4] = 1',           anchor.hom_b_score.get(4) === 1);

// =====================================================================
group('hom_anchor_to_het — sample disambiguation');

// Sample 0 is in HOM_A at window 0 and in HOM_B at window 1.
// Tie-break: drop from the one where score is lower.
const labelsW0 = Int8Array.of(0, 1, 2, 2);
const labelsW1 = Int8Array.of(2, 1, 0, 0);  // sample 0 now in band 2 (high)
const pc1Uni   = Float32Array.of(-2, 0, 3, 3.5);
const skelDis = {
  ok: true,
  windows: [
    { w: 0, k: 1 },
    { w: 1, k: 1 },
  ],
};
const anchorDis = hom_anchor_to_het({
  skeleton: skelDis,
  getLabels: (w) => w === 0 ? labelsW0 : labelsW1,
  getPc1:    () => pc1Uni,
  getK:      () => 3,
}, { consensus_min_frac: 0.5 });
// Sample 0 has score 0.5 in both HOM_A and HOM_B (one window each).
// Tie-break drops from HOM_B (or HOM_A) — at least not in both.
check('sample 0 not in both consensuses',
      !(anchorDis.hom_a_consensus.has(0)
        && anchorDis.hom_b_consensus.has(0)));

// =====================================================================
group('hom_anchor_to_het — error paths');

check('no skeleton → ok=false',
      hom_anchor_to_het({}).ok === false);
check('skeleton not ok → ok=false',
      hom_anchor_to_het({ skeleton: { ok: false } }).ok === false);
check('no callbacks → ok=false',
      hom_anchor_to_het({ skeleton: skel }).ok === false);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
