// tests/test_shared_band_mode_detect.js
//
// Unit coverage for shared/band_mode_detect.js — 1D bimodality
// detector on a heterozygosity vector.

import {
  MULTIMODAL_GAP_Z,
  MULTIMODAL_GAP_MIN,
  MIN_MODE_SAMPLES,
  meanOf,
  detectBandModes,
} from '../atlases/inversion/shared/band_mode_detect.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');

check('MULTIMODAL_GAP_Z = 2.0',    MULTIMODAL_GAP_Z === 2.0);
check('MULTIMODAL_GAP_MIN = 0.15', MULTIMODAL_GAP_MIN === 0.15);
check('MIN_MODE_SAMPLES = 3',      MIN_MODE_SAMPLES === 3);

// =====================================================================
group('meanOf');

check('mean of [1,2,3,4] = 2.5', meanOf([1, 2, 3, 4]) === 2.5);
check('mean of [] = 0',          meanOf([]) === 0);
check('mean of null = 0',        meanOf(null) === 0);
check('mean of Float32Array',
      Math.abs(meanOf(new Float32Array([0.1, 0.2, 0.3])) - 0.2) < 1e-6);

// =====================================================================
group('detectBandModes — short input → unimodal');

const shortR = detectBandModes([0.1, 0.2, 0.3]);
check('< 2*MIN_MODE_SAMPLES → unimodal',
      shortR.n_modes === 1);
check('short: center is mean',
      approx(shortR.mode_centers[0], 0.2));
check('short: assignments length matches input',
      shortR.mode_assignments.length === 3);
check('empty → unimodal',
      detectBandModes([]).n_modes === 1);
check('null → unimodal',
      detectBandModes(null).n_modes === 1);

// =====================================================================
group('detectBandModes — clear bimodal');

// Two well-separated clusters: 6 low (~0.1), 6 high (~0.8)
const bimod = [0.05, 0.08, 0.10, 0.12, 0.09, 0.11,
               0.75, 0.78, 0.80, 0.82, 0.79, 0.81];
const rBi = detectBandModes(bimod);
check('clear bimodal: n_modes = 2',     rBi.n_modes === 2);
check('center 0 < center 1',            rBi.mode_centers[0] < rBi.mode_centers[1]);
check('center 0 ≈ 0.09',                approx(rBi.mode_centers[0], 0.092, 0.02));
check('center 1 ≈ 0.79',                approx(rBi.mode_centers[1], 0.79, 0.02));
check('first 6 → mode 0',
      rBi.mode_assignments[0] === 0 && rBi.mode_assignments[5] === 0);
check('last 6 → mode 1',
      rBi.mode_assignments[6] === 1 && rBi.mode_assignments[11] === 1);

// =====================================================================
group('detectBandModes — unimodal narrow distribution');

// Tight cluster around 0.5: gap will be tiny → unimodal
const tight = [0.48, 0.50, 0.51, 0.49, 0.52, 0.50,
               0.51, 0.49, 0.50, 0.52, 0.48, 0.50];
const rT = detectBandModes(tight);
check('tight cluster: unimodal',        rT.n_modes === 1);
check('tight: center near 0.5',         approx(rT.mode_centers[0], 0.5, 0.02));

// All identical (degenerate)
const same = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
const rS = detectBandModes(same);
check('all identical: unimodal',        rS.n_modes === 1);
check('all identical: center 0.5',      approx(rS.mode_centers[0], 0.5));

// =====================================================================
group('detectBandModes — borderline gap < MULTIMODAL_GAP_MIN');

// Two clusters with absolute gap < 0.15 → unimodal (absolute floor)
const smallGap = [0.10, 0.12, 0.11, 0.13, 0.10, 0.12,
                  0.18, 0.20, 0.19, 0.21, 0.18, 0.20];
const rSG = detectBandModes(smallGap);
check('gap < 0.15: unimodal',           rSG.n_modes === 1);

// =====================================================================
group('detectBandModes — mode ordering (low first)');

// Input deliberately ordered with HIGH cluster first
const flipped = [0.85, 0.80, 0.82, 0.78, 0.81, 0.79,
                 0.10, 0.12, 0.08, 0.11, 0.09, 0.10];
const rF = detectBandModes(flipped);
check('flipped input still emits low-first centers',
      rF.n_modes === 2 && rF.mode_centers[0] < rF.mode_centers[1]);

// Assignments swapped accordingly: first 6 (high values) → mode 1
check('flipped: first 6 → mode 1 (high)',
      rF.mode_assignments[0] === 1 && rF.mode_assignments[5] === 1);
check('flipped: last 6 → mode 0 (low)',
      rF.mode_assignments[6] === 0 && rF.mode_assignments[11] === 0);

// =====================================================================
group('detectBandModes — Int8Array / TypedArray');

const f32 = new Float32Array([0.05, 0.08, 0.10, 0.12, 0.09, 0.11,
                               0.75, 0.78, 0.80, 0.82, 0.79, 0.81]);
const rTA = detectBandModes(f32);
check('Float32Array input works',       rTA.n_modes === 2);
check('returns Int8Array assignments',
      rTA.mode_assignments instanceof Int8Array);

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail > 0 ? 1 : 0);
