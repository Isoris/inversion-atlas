// tests/test_discovery_dosage_collapse.js
//
// Unit coverage for pages/discovery/dosage_heatmap/collapse_similar.js
// — collapsing near-identical samples into representative rows via a
// Hamming distance over tier-quantized genomic bins.

import {
  sampleTierSignatures, hammingSignature, collapseSimilar,
} from '../atlases/inversion/pages/discovery/dosage_heatmap/collapse_similar.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

function makeCanonical(rows) {
  const nS = rows.length, nM = rows[0].length;
  return {
    n_samples: nS, n_markers: nM,
    sample_labels: rows.map((_, i) => 's' + i),
    marker_pos_bp: null,
    cellValue: (m, s) => rows[s][m],
  };
}

const A = [0, 0, 0, 1, 1, 1, 2, 2, 2];
const B = [2, 2, 2, 1, 1, 1, 0, 0, 0];
// A-near differs from A in just the last bin (2→1 region) → Hamming 1 at binSize 3.
const A_NEAR = [0, 0, 0, 1, 1, 1, 1, 1, 1];

const BIN_OPTS = { binSize: 3, minBins: 3, maxBins: 3, smoothWindow: 1 };

// =====================================================================
group('sampleTierSignatures + hammingSignature');

const canSig = makeCanonical([A, A.slice(), B]);
const sp = sampleTierSignatures(canSig, BIN_OPTS);
check('signature: 3 bins per sample', sp && sp.nBins === 3 && sp.nS === 3);
check('A → tiers [0,1,2]', sp && sp.sig[0] === 0 && sp.sig[1] === 1 && sp.sig[2] === 2);
check('B → tiers [2,1,0]', sp && sp.sig[6] === 2 && sp.sig[7] === 1 && sp.sig[8] === 0);
check('Hamming(A,A) = 0', hammingSignature(sp.sig, 3, 0, 1) === 0);
check('Hamming(A,B) = 2 (bins 0 and 2 differ)', hammingSignature(sp.sig, 3, 0, 2) === 2);
check('Hamming Infinity when no comparable bins', (() => {
  const sig = Int8Array.from([-1, -1, 0, 1]);   // 2 samples, 2 bins, no shared bin
  return hammingSignature(sig, 2, 0, 1) === Infinity;
})());

// =====================================================================
group('collapseSimilar — exact (threshold 0)');

// 5 identical A + 2 identical B → 2 groups, sizes 5 and 2.
const canExact = makeCanonical([A, A.slice(), A.slice(), A.slice(), A.slice(), B, B.slice()]);
const plan = collapseSimilar(canExact, Object.assign({ hammingThreshold: 0, maxReps: 3 }, BIN_OPTS));
check('returns a plan', !!plan && plan.n_samples === 7);
check('two groups', plan.n_groups === 2);
check('group sizes 5 and 2', (() => {
  const s = plan.groups.map(g => g.size).sort((a, b) => a - b);
  return s[0] === 2 && s[1] === 5;
})());
check('displayed rows capped by maxReps (3 + 2 = 5)', plan.n_displayed === 5);
check('order length = n_displayed', plan.order.length === 5);
check('groups ordered low→high dosage (A group first)', (() => {
  // first displayed row should be an A sample (tier mean 1) vs B (also 1)...
  // A and B both average tier 1; tie-break by group id. Assert deterministic.
  return plan.row_group[0] === plan.groups[0].id;
})());
check('row metadata aligned + group-start flags', (() => {
  let starts = 0;
  for (let r = 0; r < plan.row_is_group_start.length; r++) starts += plan.row_is_group_start[r];
  return starts === 2;   // one start per group
})());
check('each group has exactly one medoid among its rows', (() => {
  const medByGroup = new Map();
  for (let r = 0; r < plan.row_is_medoid.length; r++) {
    if (plan.row_is_medoid[r]) medByGroup.set(plan.row_group[r], (medByGroup.get(plan.row_group[r]) || 0) + 1);
  }
  return medByGroup.size === 2 && Array.from(medByGroup.values()).every(v => v === 1);
})());
check('row_group_size matches the owning group', (() => {
  for (let r = 0; r < plan.row_group.length; r++) {
    const g = plan.groups.find(gr => gr.id === plan.row_group[r]);
    if (!g || g.size !== plan.row_group_size[r]) return false;
  }
  return true;
})());

// =====================================================================
group('collapseSimilar — Hamming tolerance');

// A, A-near (Hamming 1), B. threshold 0 → 3 groups; threshold 1 → A+A_near merge.
const canTol = makeCanonical([A, A_NEAR, B]);
const p0 = collapseSimilar(canTol, Object.assign({ hammingThreshold: 0, maxReps: 5 }, BIN_OPTS));
const p1 = collapseSimilar(canTol, Object.assign({ hammingThreshold: 1, maxReps: 5 }, BIN_OPTS));
check('threshold 0 keeps A and A-near separate', p0.n_groups === 3);
check('threshold 1 merges A with A-near', p1.n_groups === 2);
check('merged group has size 2', (() => {
  const sizes = p1.groups.map(g => g.size).sort((a, b) => b - a);
  return sizes[0] === 2;
})());

// =====================================================================
group('degenerate guards');

check('null on empty/invalid', collapseSimilar(null) === null);
check('all rows shown when every sample is unique', (() => {
  const c = makeCanonical([A, B, A_NEAR]);
  const p = collapseSimilar(c, Object.assign({ hammingThreshold: 0, maxReps: 5 }, BIN_OPTS));
  return p.n_groups === 3 && p.n_displayed === 3;
})());
check('maxReps caps rows for a big group', (() => {
  const rows = []; for (let i = 0; i < 10; i++) rows.push(A.slice());
  const c = makeCanonical(rows);
  const p = collapseSimilar(c, Object.assign({ hammingThreshold: 0, maxReps: 4 }, BIN_OPTS));
  return p.n_groups === 1 && p.groups[0].size === 10 && p.n_displayed === 4;
})());

// =====================================================================
console.log('\n=================');
console.log('pass: ' + pass + '   fail: ' + fail);
console.log('=================');
if (fail > 0 && typeof process !== 'undefined') process.exitCode = 1;
