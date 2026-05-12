// tests/test_page1_diag_residuals.js
//
// Unit tests for pages/discovery/page1/diag_residuals.js — per-fish
// residual-Z diagnostic + "residual" sample-color mode. Drives the
// page1 getSampleColor switch's residual branch + the karyotype/tier
// page's suspicion column.

import {
  DIAG_RESIDUAL_SUSPICIOUS_Z,
  DIAG_BAND_CONSISTENCY_THRESH,
  diagResidualColor,
  diagComputeWindowResiduals,
  diagSampleColor,
  diagClearCache,
  diagComputeCandidateSuspicion,
} from '../atlases/inversion/pages/discovery/page1/diag_residuals.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('DIAG_RESIDUAL_SUSPICIOUS_Z = 2.5',    DIAG_RESIDUAL_SUSPICIOUS_Z === 2.5);
check('DIAG_BAND_CONSISTENCY_THRESH = 0.85', DIAG_BAND_CONSISTENCY_THRESH === 0.85);

// =====================================================================
group('diagResidualColor — ramp');
check('null → grey',                  diagResidualColor(null) === '#888');
check('NaN → grey',                   diagResidualColor(NaN) === '#888');
check('Infinity → grey',              diagResidualColor(Infinity) === '#888');
{
  const c0 = diagResidualColor(0);
  // z=0 → blue (79, 163, 255) = #4fa3ff
  check('z=0 → #4fa3ff (cool blue)',  c0 === '#4fa3ff');
}
{
  const c2 = diagResidualColor(2);
  // z=2 (t=0.5) → amber (245, 165, 36) = #f5a524
  check('z=2 → #f5a524 (amber)',      c2 === '#f5a524');
}
{
  const c4 = diagResidualColor(4);
  // z=4 (t=1.0) → red (224, 85, 92) = #e0555c
  check('z=4 → #e0555c (red)',        c4 === '#e0555c');
}
{
  // Clamp: z=10 → same as z=4
  check('z=10 clamps to z=4',         diagResidualColor(10) === '#e0555c');
}
{
  // Clamp: z=-1 → same as z=0
  check('z=-1 clamps to z=0',         diagResidualColor(-1) === '#4fa3ff');
}

// =====================================================================
// Fixture: 6 samples, K=2, two well-separated clusters
// =====================================================================
function makeFixture() {
  // Samples 0-2 cluster at (0, 0) with small jitter
  // Samples 3-5 cluster at (10, 10) with small jitter
  return {
    k: 2,
    data: {
      windows: [
        {
          // Window 0: clean clusters, no precomp residuals
          pc1: [0.0, 0.1, -0.1, 10.0, 10.1, 9.9],
          pc2: [0.0, 0.0, 0.1, 10.0, 9.9, 10.0],
        },
        {
          // Window 1: cluster 0 has one outlier (sample 2 far from centroid)
          pc1: [0.0, 0.0, 5.0, 10.0, 10.0, 10.0],
          pc2: [0.0, 0.0, 5.0, 10.0, 10.0, 10.0],
        },
        {
          // Window 2: precomp-provided residuals
          pc1: [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
          pc2: [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
          band_residual_z: [0.1, 0.2, 0.3, 0.5, 1.0, 5.0],
          band:            [0,   0,   0,   1,   1,   1  ],
        },
        {
          // Window 3: empty / malformed
          pc1: null,
        },
      ],
      n_samples: 6,
    },
  };
}

// =====================================================================
group('diagComputeWindowResiduals — input validation');
check('null state → null',
      diagComputeWindowResiduals(null, 0) === null);
check('state without data → null',
      diagComputeWindowResiduals({}, 0) === null);
check('window without pc1 → null',
      diagComputeWindowResiduals(makeFixture(), 3) === null);
check('out-of-range winIdx → null',
      diagComputeWindowResiduals(makeFixture(), 99) === null);

// =====================================================================
group('diagComputeWindowResiduals — clean clusters');
{
  const state = makeFixture();
  const r = diagComputeWindowResiduals(state, 0);
  check('returns object',                  !!r);
  check('source = atlas (no precomp)',     r.source === 'atlas');
  check('residuals is Float32Array(6)',
        r.residuals instanceof Float32Array && r.residuals.length === 6);
  check('labels is Int32Array-like (6)',
        r.labels && r.labels.length === 6);
  // All samples should be close to their centroid → low residual_z
  let allLow = true;
  for (let i = 0; i < 6; i++) {
    if (r.residuals[i] > 3) allLow = false;
  }
  check('clean clusters → all residuals < 3',  allLow);
  check('cached on state._diagCache',          !!state._diagCache);
  check('cache key 0:2 present',               !!state._diagCache['0:2']);
  // Second call returns cached object (same identity)
  const r2 = diagComputeWindowResiduals(state, 0);
  check('second call returns cached object',   r === r2);
}

// =====================================================================
group('diagComputeWindowResiduals — outlier elevates residual');
{
  // Window 1 has sample 2 at (5,5) — between the two cluster centroids.
  // Whichever cluster it's assigned to, it'll be far from the centroid.
  const state = makeFixture();
  const r = diagComputeWindowResiduals(state, 1);
  check('outlier window returns residuals',  !!r);
  // The outlier sample has the highest residual among samples 0-2 (its cluster)
  // OR samples 3-5 depending on K-means initialization. Check it's
  // identifiable as the maximum.
  let maxIdx = 0, maxVal = r.residuals[0];
  for (let i = 1; i < r.residuals.length; i++) {
    if (r.residuals[i] > maxVal) { maxVal = r.residuals[i]; maxIdx = i; }
  }
  check('outlier (sample 2 at (5,5)) is the max-residual sample',
        maxIdx === 2);
}

// =====================================================================
group('diagComputeWindowResiduals — precomp path');
{
  const state = makeFixture();
  const r = diagComputeWindowResiduals(state, 2);
  check('source = precomp',                  r.source === 'precomp');
  // Float32 can't represent 0.1 exactly; compare with a small epsilon.
  check('residuals copied verbatim',
        Math.abs(r.residuals[0] - 0.1) < 1e-6 && r.residuals[5] === 5.0);
  check('labels copied verbatim',
        r.labels[0] === 0 && r.labels[5] === 1);
  // The precomp path skips kmeans2D — verify by checking no within_sd
  check('no within_sd on precomp path',      r.within_sd === undefined);
}

// =====================================================================
group('diagSampleColor — composition');
{
  const state = makeFixture();
  // Window 2 has precomp residuals. Sample 0: z=0.1 → near-blue.
  const c0 = diagSampleColor(state, 0, 2);
  check('sample 0 w2 (z=0.1) → low-residual color',
        typeof c0 === 'string' && c0.startsWith('#'));
  // Sample 5 has z=5.0 (clamped to z=4) → red.
  const c5 = diagSampleColor(state, 5, 2);
  check('sample 5 w2 (z=5.0) → red (clamped)', c5 === '#e0555c');
  // Out-of-range sample → grey
  check('out-of-range sample → grey',          diagSampleColor(state, 99, 2) === '#888');
  // Missing window data → grey
  check('null pc1 window → grey',              diagSampleColor(state, 0, 3) === '#888');
}

// =====================================================================
group('diagClearCache');
{
  const state = makeFixture();
  diagComputeWindowResiduals(state, 0);
  check('cache populated',                     Object.keys(state._diagCache).length > 0);
  diagClearCache(state);
  check('cache empty after clear',             Object.keys(state._diagCache).length === 0);
  // null state: no throw
  let threw = false;
  try { diagClearCache(null); } catch (_) { threw = true; }
  check('null state: no throw',                !threw);
}

// =====================================================================
group('diagComputeCandidateSuspicion — input validation');
check('null state → null',
      diagComputeCandidateSuspicion(null, 0, 1) === null);
check('state without data → null',
      diagComputeCandidateSuspicion({}, 0, 1) === null);
check('winLo > winHi → null',
      diagComputeCandidateSuspicion(makeFixture(), 5, 0) === null);
check('window without pc1 → null',
      diagComputeCandidateSuspicion(makeFixture(), 3, 3) === null);

// =====================================================================
group('diagComputeCandidateSuspicion — clean span');
{
  const state = makeFixture();
  const s = diagComputeCandidateSuspicion(state, 0, 0);
  check('returns suspicion summary',          !!s);
  check('n_windows = 1',                      s.n_windows === 1);
  check('meanZ Float32Array(6)',
        s.meanZ instanceof Float32Array && s.meanZ.length === 6);
  check('maxZ Float64Array(6)',
        s.maxZ instanceof Float64Array && s.maxZ.length === 6);
  check('consistency Float32Array(6)',
        s.consistency instanceof Float32Array && s.consistency.length === 6);
  check('suspicious Uint8Array(6)',
        s.suspicious instanceof Uint8Array && s.suspicious.length === 6);
  // Clean span: all samples should be NOT suspicious (low z, perfect consistency)
  let allFine = true;
  for (let i = 0; i < 6; i++) if (s.suspicious[i]) allFine = false;
  check('clean span: no suspicious samples',  allFine);
}

// =====================================================================
group('diagComputeCandidateSuspicion — precomp window with z=5 outlier');
{
  const state = makeFixture();
  // Window 2's precomp residuals: sample 5 has z=5 (>2.5 threshold)
  const s = diagComputeCandidateSuspicion(state, 2, 2);
  check('sample 5 (z=5) flagged suspicious',  s.suspicious[5] === 1);
  // Samples 0-2 with z=0.1, 0.2, 0.3 should NOT be flagged
  check('sample 0 NOT suspicious',            s.suspicious[0] === 0);
  check('sample 1 NOT suspicious',            s.suspicious[1] === 0);
}

// =====================================================================
group('getSampleColor wiring (page1/_state.js)');
{
  // Verify the _state.js module imports diagSampleColor and uses it
  // for mode === 'residual'. Smoke test: the export is present.
  const mod = await import('../atlases/inversion/pages/discovery/page1/_state.js');
  check('getSampleColor exported',           typeof mod.getSampleColor === 'function');
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
