// tests/test_shared_similarity_matrix.js
//
// Unit coverage for shared/similarity_matrix.js — HANDOFF 10
// per-window Pearson similarity primitives.

import {
  DOSAGE_MISSING_BYTE,
  DOSAGE_DECODE_FACTOR,
  SIMILARITY_MIN_MARKERS,
  binarySearchFirstGE,
  computeFlipVector,
  pearsonSimilarityMatrix,
  similarityCacheKey,
} from '../atlases/inversion/shared/similarity_matrix.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');

check('DOSAGE_MISSING_BYTE = 255',    DOSAGE_MISSING_BYTE === 255);
check('DOSAGE_DECODE_FACTOR = 1/127', DOSAGE_DECODE_FACTOR === 1 / 127);
check('SIMILARITY_MIN_MARKERS = 20',  SIMILARITY_MIN_MARKERS === 20);

// =====================================================================
group('binarySearchFirstGE');

const pos = new Uint32Array([10, 20, 30, 40, 50]);
check('target 25 → idx 2 (first ≥ 25 is 30)',
      binarySearchFirstGE(pos, 25) === 2);
check('target 20 → idx 1 (exact match)',
      binarySearchFirstGE(pos, 20) === 1);
check('target 10 → idx 0',                binarySearchFirstGE(pos, 10) === 0);
check('target 0 → idx 0',                 binarySearchFirstGE(pos, 0) === 0);
check('target 50 → idx 4',                binarySearchFirstGE(pos, 50) === 4);
check('target 100 → idx 5 (past end)',    binarySearchFirstGE(pos, 100) === 5);
check('empty → idx 0',                    binarySearchFirstGE([], 5) === 0);
check('null → idx 0',                     binarySearchFirstGE(null, 5) === 0);

// =====================================================================
group('computeFlipVector — no refs');

// 3 samples × 4 markers
const dosageRaw = new Uint8Array([
  // s0: 0, 1, 2, 0
  0, 127, 254, 0,
  // s1: 2, 1, 0, 2
  254, 127, 0, 254,
  // s2: 0, 1, 2, 0
  0, 127, 254, 0,
]);

check('no pos refs → all zero',
      computeFlipVector(dosageRaw, 4, [], [0], { decode: true })
        .every(v => v === 0));
check('no neg refs → all zero',
      computeFlipVector(dosageRaw, 4, [0], [], { decode: true })
        .every(v => v === 0));

// =====================================================================
group('computeFlipVector — clear contrast');

// Use s0+s2 as POS, s1 as NEG.
// Marker 0: pos avg 0, neg avg 2 → contrast = -2 < 0 → flip = 1
// Marker 1: pos avg 1, neg avg 1 → contrast = 0  → flip = 0 (not < 0)
// Marker 2: pos avg 2, neg avg 0 → contrast = 2 > 0 → flip = 0
// Marker 3: pos avg 0, neg avg 2 → flip = 1
const flip = computeFlipVector(dosageRaw, 4, [0, 2], [1], { decode: true });
check('marker 0 contrast < 0 → flip=1',  flip[0] === 1);
check('marker 1 equal → flip=0',          flip[1] === 0);
check('marker 2 contrast > 0 → flip=0',   flip[2] === 0);
check('marker 3 contrast < 0 → flip=1',   flip[3] === 1);
check('returns Uint8Array',               flip instanceof Uint8Array);

// =====================================================================
group('computeFlipVector — missing values skipped');

// Sample 0 marker 0 is missing
const dosageMiss = new Uint8Array([
  255, 127, 254, 0,
  254, 127, 0,   254,
  0,   127, 254, 0,
]);
const flipMiss = computeFlipVector(dosageMiss, 4, [0, 2], [1], { decode: true });
// Marker 0: pos avg = (only s2 = 0) / 1 = 0; neg avg = 2 → contrast < 0 → flip 1
check('missing pos value skipped',         flipMiss[0] === 1);

// All-missing marker → flip stays 0
const dosageAllMiss = new Uint8Array([
  255, 0,
  255, 0,
]);
const flipAM = computeFlipVector(dosageAllMiss, 2, [0], [1], { decode: true });
check('all-missing marker → flip 0',       flipAM[0] === 0);

// =====================================================================
group('pearsonSimilarityMatrix — happy path');

// 3 samples × 24 markers; sample 1 is identical to sample 0;
// sample 2 is opposite (2 - sample 0).
// Pre-build with 24 markers so SIMILARITY_MIN_MARKERS=20 is satisfied.
const n_markers = 24;
const n_samples = 3;
const dosageHP = new Uint8Array(n_samples * n_markers);
const positions = new Uint32Array(n_markers);
for (let m = 0; m < n_markers; m++) positions[m] = m * 10;
// s0: alternating 0, 1, 2 dosage encoded as 0, 127, 254
for (let m = 0; m < n_markers; m++) {
  const enc = (m % 3) * 127;
  dosageHP[0 * n_markers + m] = enc;       // s0
  dosageHP[1 * n_markers + m] = enc;       // s1 == s0
  dosageHP[2 * n_markers + m] = 254 - enc; // s2 = 2 - s0
}

const r1 = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: n_markers,
});

check('ok=true',                          r1.ok === true);
check('nSamples=3',                       r1.nSamples === 3);
check('nMarkersInWindow=24',              r1.nMarkersInWindow === 24);
check('matrix length = 9',                r1.matrix.length === 9);
check('diagonal = 1',
      r1.matrix[0] === 1 && r1.matrix[4] === 1 && r1.matrix[8] === 1);
check('s0 ↔ s1: corr = 1 (identical)',
      approx(r1.matrix[0 * 3 + 1], 1.0, 1e-5));
check('s0 ↔ s2: corr = -1 (opposite)',
      approx(r1.matrix[0 * 3 + 2], -1.0, 1e-5));
check('symmetric: m[1,0] === m[0,1]',
      r1.matrix[1 * 3 + 0] === r1.matrix[0 * 3 + 1]);

// =====================================================================
group('pearsonSimilarityMatrix — absoluteValue mode (raw_scan)');

const r1abs = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: n_markers,
}, { absoluteValue: true });

check('absolute: corr(s0,s2) = +1',
      approx(r1abs.matrix[0 * 3 + 2], 1.0, 1e-5));
check('diagonal still 1',                 r1abs.matrix[0] === 1);

// =====================================================================
group('pearsonSimilarityMatrix — flip vector polarity correction');

// Flip every marker → s0 becomes (2 - original), so corr(s0, s2) should
// flip from -1 to +1 (s2 was already 2 - s0).
const flipAll = new Uint8Array(n_markers).fill(1);
const rFlip = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: n_markers,
}, { flipVector: flipAll });

// With every marker flipped:
//   s0' = 2 - s0 (= s2 original)
//   s2' = 2 - s2 = s0 original
// So corr(s0', s2') = corr(s2, s0) = -1 still (signs flipped on both).
// Actually corr is invariant under affine transforms on EACH variable;
// flipping both gives same corr. Confirm corr(s0',s1') = 1 still.
check('flip both: corr(s0,s1) still 1',
      approx(rFlip.matrix[0 * 3 + 1], 1.0, 1e-5));
check('flip both: corr(s0,s2) still -1',
      approx(rFlip.matrix[0 * 3 + 2], -1.0, 1e-5));

// Flip only some markers → similarity shifts
const flipHalf = new Uint8Array(n_markers);
for (let m = 0; m < n_markers / 2; m++) flipHalf[m] = 1;
const rHalf = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: n_markers,
}, { flipVector: flipHalf });
// s0,s1 still identical → corr(s0,s1) = 1
check('flip half: corr(s0,s1) still 1',
      approx(rHalf.matrix[0 * 3 + 1], 1.0, 1e-5));
// Flip applied per-marker to BOTH s0 and s2 (same flip vector), so
// the affine transform applies identically and correlation is
// invariant — corr(s0, s2) stays at -1.
check('flip half: corr(s0,s2) still -1 (per-marker invariance)',
      approx(rHalf.matrix[0 * 3 + 2], -1.0, 1e-5));

// =====================================================================
group('pearsonSimilarityMatrix — insufficient markers');

const rIns = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: 5,    // only 5 markers, < SIMILARITY_MIN_MARKERS
});
check('< MIN_MARKERS: ok=false',           rIns.ok === false);
check('reason = insufficient_markers',     rIns.reason === 'insufficient_markers');
check('nMarkersInWindow echoed',           rIns.nMarkersInWindow === 5);

// Custom minMarkers
const rInsOk = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [0, 1, 2],
  startIdx: 0, endIdx: 5,
}, { minMarkers: 5 });
check('custom minMarkers honoured',         rInsOk.ok === true);

// =====================================================================
group('pearsonSimilarityMatrix — invalid inputs');

const rNul = pearsonSimilarityMatrix(null);
check('null args → ok=false',              rNul.ok === false);
check('null args: reason invalid_inputs',  rNul.reason === 'invalid_inputs');

const rEmpty = pearsonSimilarityMatrix({
  dosage: dosageHP, nMarkers: n_markers,
  sampleSubset: [],
  startIdx: 0, endIdx: n_markers,
});
check('empty sampleSubset → invalid',      rEmpty.ok === false);

// =====================================================================
group('pearsonSimilarityMatrix — missing dosage values');

// Build a tiny dataset where sample 0 has all markers missing
const n_m = 30;
const dosageMissAll = new Uint8Array(2 * n_m);
for (let m = 0; m < n_m; m++) {
  dosageMissAll[0 * n_m + m] = DOSAGE_MISSING_BYTE;  // s0 fully missing
  dosageMissAll[1 * n_m + m] = (m % 3) * 127;
}
const rMa = pearsonSimilarityMatrix({
  dosage: dosageMissAll, nMarkers: n_m,
  sampleSubset: [0, 1], startIdx: 0, endIdx: n_m,
});
check('all-missing sample: diag still 1', rMa.matrix[0] === 1);
check('all-missing sample: pair → 0',     rMa.matrix[0 * 2 + 1] === 0);

// Constant dosage (SD = 0) → pair → 0
const dosageConst = new Uint8Array(2 * n_m);
for (let m = 0; m < n_m; m++) {
  dosageConst[0 * n_m + m] = 127;             // s0 all 1.0
  dosageConst[1 * n_m + m] = (m % 3) * 127;   // s1 varies
}
const rConst = pearsonSimilarityMatrix({
  dosage: dosageConst, nMarkers: n_m,
  sampleSubset: [0, 1], startIdx: 0, endIdx: n_m,
});
check('constant sample: SD=0 → pair → 0', rConst.matrix[0 * 2 + 1] === 0);

// =====================================================================
group('similarityCacheKey');

const k1 = similarityCacheKey({
  chrom: 'LG28', windowStart: 1000, windowEnd: 2000,
  sampleSubset: [0, 1, 2], polarityMode: 'raw_scan',
});
const k2 = similarityCacheKey({
  chrom: 'LG28', windowStart: 1000, windowEnd: 2000,
  sampleSubset: [2, 1, 0], polarityMode: 'raw_scan',
});
check('subset reordering doesn\'t bust cache',  k1 === k2);

const k3 = similarityCacheKey({
  chrom: 'LG28', windowStart: 1000, windowEnd: 2000,
  sampleSubset: [0, 1, 2], polarityMode: 'polarity_corrected_outer',
});
check('polarity mode part of key',              k1 !== k3);

const k4 = similarityCacheKey({
  chrom: 'LG29', windowStart: 1000, windowEnd: 2000,
  sampleSubset: [0, 1, 2], polarityMode: 'raw_scan',
});
check('chrom part of key',                      k1 !== k4);

// Default polarity_mode
const kDef = similarityCacheKey({
  chrom: 'X', windowStart: 0, windowEnd: 100, sampleSubset: [0],
});
check('default polarity_mode present',          kDef.indexOf('raw_scan') >= 0);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
