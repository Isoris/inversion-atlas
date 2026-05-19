// tests/test_shared_uv_rotation.js

import {
  computeUVRotationCore,
  aggregateWindowRangeForUV,
  getOrComputeUVRotation,
  getOrComputeUVRotationSlab,
  wrapKmeansResultAsCluster,
  clusterFromRotation_UVRotated,
  clusterL2_UVRotated,
  clusterSlab_UVRotated,
} from '../atlases/inversion/shared/uv_rotation.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-4); }

// =====================================================================
// Fixture: 3 well-separated clusters in (x, y) space.
//   STD  at (-1, 0)
//   HET  at ( 0, 0)
//   INV  at ( 1, 0)
// All on the x-axis → rotation angle should be near 0; u ≈ x, v ≈ y.
// =====================================================================
function clusterPoints({ angle = 0, perCluster = 6, jitter = 0.05 } = {}) {
  // Build 3 clusters along a line at the requested angle (radians).
  // Returns { xs, ys } Float64Arrays of length 3 × perCluster.
  const nS = 3 * perCluster;
  const xs = new Float64Array(nS);
  const ys = new Float64Array(nS);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  for (let g = 0; g < 3; g++) {
    const cx = (g - 1);   // -1, 0, +1
    for (let i = 0; i < perCluster; i++) {
      const idx = g * perCluster + i;
      // Deterministic per-sample jitter
      const jx = jitter * ((i * 17 % 11) - 5) / 10;
      const jy = jitter * ((i * 31 % 13) - 6) / 10;
      // Rotate the (cx + jx, jy) point by angle
      xs[idx] = (cx + jx) * cosA - jy * sinA;
      ys[idx] = (cx + jx) * sinA + jy * cosA;
    }
  }
  return { xs, ys, nS };
}

// =====================================================================
group('computeUVRotationCore — axis along +x');
{
  // STD/HET/INV on x-axis (angle 0). Rotation should leave u ≈ x, v ≈ y.
  const { xs, ys, nS } = clusterPoints({ angle: 0 });
  const r = computeUVRotationCore(xs, ys, nS);
  check('ok = true',                            r.ok === true);
  check('us is Float64Array',                   r.us instanceof Float64Array);
  check('us length matches nS',                 r.us.length === nS);
  check('vs length matches nS',                 r.vs.length === nS);
  check('angle ≈ 0 degrees',                    Math.abs(r.angle) < 5);
  check('not degenerate',                       r.degenerate === false);
  check('baseN length 3',                       r.baseN.length === 3);
  // After rotation, us approximates xs (angle ≈ 0)
  check('us ≈ xs (rotation near identity)',
        approx(r.us[0], xs[0], 0.1) && approx(r.us[nS - 1], xs[nS - 1], 0.1));
}

// =====================================================================
group('computeUVRotationCore — axis at 45°');
{
  // Cluster line rotated 45°
  const angleRad = Math.PI / 4;
  const { xs, ys, nS } = clusterPoints({ angle: angleRad });
  const r = computeUVRotationCore(xs, ys, nS);
  check('ok = true',                            r.ok === true);
  // After back-rotation, us should now lie along the original line direction
  // (variance along u should dominate variance along v)
  let varU = 0, meanU = 0, varV = 0, meanV = 0;
  for (let i = 0; i < nS; i++) { meanU += r.us[i]; meanV += r.vs[i]; }
  meanU /= nS; meanV /= nS;
  for (let i = 0; i < nS; i++) {
    varU += (r.us[i] - meanU) ** 2;
    varV += (r.vs[i] - meanV) ** 2;
  }
  varU /= nS; varV /= nS;
  check('variance(u) > variance(v) (axis aligned)', varU > varV * 4);
  // Angle reported ~ 45 (or -135 depending on sign convention)
  const absDiff = Math.min(
    Math.abs(r.angle - 45),
    Math.abs(r.angle + 135),
    Math.abs(r.angle + 45),
    Math.abs(r.angle - 135),
  );
  check('reported angle near 45° (mod sign)',   absDiff < 5);
}

// =====================================================================
group('computeUVRotationCore — degenerate case');
{
  // All points identical → centroid[0] === centroid[2] → axisLen²=0
  const xs = new Float64Array(9).fill(0.5);
  const ys = new Float64Array(9).fill(0.5);
  const r = computeUVRotationCore(xs, ys, 9);
  // K-means3 on identical points either fails or returns degenerate
  if (r.ok) {
    check('degenerate: angle = 0',              r.angle === 0);
    check('degenerate flag set',                r.degenerate === true);
    // u, v identical to x, y (no rotation applied when axis is degenerate)
    check('us[0] ≈ xs[0] (no rotation)',         approx(r.us[0], xs[0], 1e-9));
  } else {
    check('degenerate: ok=false fallback',      r.reason === 'KMEANS_FAILED');
  }
}

// =====================================================================
group('computeUVRotationCore — kmeans failure');
{
  // n=2 < K=3 → kmeans2D should fail to form 3 clusters
  const xs = new Float64Array([0, 1]);
  const ys = new Float64Array([0, 1]);
  const r = computeUVRotationCore(xs, ys, 2);
  // If kmeans returns a degenerate result with cx.length !== 3, we report failure
  if (!r.ok) {
    check('insufficient samples: ok=false',     r.reason === 'KMEANS_FAILED');
  } else {
    // If kmeans2D was tolerant and somehow produced 3 centroids, that's fine
    // — the contract is just that we report consistently
    check('K-means produced 3 centroids',       r.baseN.length === 3);
  }
}

// =====================================================================
group('computeUVRotationCore — centroid round-trip');
{
  // Verify centroids round-trip the rotation: (hom1_x, hom1_y) → (hom1_u, hom1_v)
  // should equal the rotation matrix applied to the original centroid.
  const { xs, ys, nS } = clusterPoints({ angle: Math.PI / 6 });
  const r = computeUVRotationCore(xs, ys, nS);
  if (r.ok) {
    const angleRad = r.angle * Math.PI / 180;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    // Forward rotation matches what core computed
    const expectedU0 =  r.hom1_x * cosA + r.hom1_y * sinA;
    const expectedV0 = -r.hom1_x * sinA + r.hom1_y * cosA;
    check('hom1_u round-trips',                  approx(r.hom1_u, expectedU0));
    check('hom1_v round-trips',                  approx(r.hom1_v, expectedV0));
    const expectedU2 =  r.hom2_x * cosA + r.hom2_y * sinA;
    check('hom2_u round-trips',                  approx(r.hom2_u, expectedU2));
  }
}

// =====================================================================
group('computeUVRotationCore — return shape');
{
  const { xs, ys, nS } = clusterPoints({ angle: 0 });
  const r = computeUVRotationCore(xs, ys, nS);
  if (r.ok) {
    check('exposes xs/ys',                      r.xs instanceof Float64Array && r.ys instanceof Float64Array);
    check('exposes us/vs',                      r.us instanceof Float64Array && r.vs instanceof Float64Array);
    check('exposes baseLabels',                 !!r.baseLabels);
    check('hom1/het/hom2 centroids in (x,y)',
          Number.isFinite(r.hom1_x) && Number.isFinite(r.het_x) && Number.isFinite(r.hom2_x));
    check('hom1/het/hom2 centroids in (u,v)',
          Number.isFinite(r.hom1_u) && Number.isFinite(r.het_u) && Number.isFinite(r.hom2_u));
  }
}

// =====================================================================
// Phase 1: aggregateWindowRangeForUV across a tiny synthetic state.
// =====================================================================
group('aggregateWindowRangeForUV');
{
  // 3 windows × 4 samples. Each window has a fixed PC1 + PC2 vector.
  // The aggregator should return the per-sample MEAN across windows.
  function fakeWin(pc1Vals, pc2Vals) {
    return { pc1: new Float64Array(pc1Vals), pc2: new Float64Array(pc2Vals) };
  }
  const state = {
    data: {
      n_samples: 4,
      n_windows: 3,
      chrom: 'LG_TEST',
      windows: [
        fakeWin([0, 1, 2, 3],  [0, 0, 0, 0]),
        fakeWin([1, 2, 3, 4],  [1, 1, 1, 1]),
        fakeWin([2, 3, 4, 5],  [2, 2, 2, 2]),
      ],
    },
    flipPC1: false, pc1Sign: null,
  };
  const agg = aggregateWindowRangeForUV(state, 0, 2);
  check('aggregateWindowRangeForUV returns xs+ys',
        agg && agg.xs && agg.ys && agg.xs.length === 4);
  // PC1 sample 0: (0+1+2)/3 = 1.0
  // PC1 sample 3: (3+4+5)/3 = 4.0
  check('PC1 mean s=0 → 1.0',  approx(agg.xs[0], 1.0));
  check('PC1 mean s=3 → 4.0',  approx(agg.xs[3], 4.0));
  // PC2 mean = (0+1+2)/3 = 1.0 for every sample
  check('PC2 mean s=0 → 1.0',  approx(agg.ys[0], 1.0));
  check('PC2 mean s=2 → 1.0',  approx(agg.ys[2], 1.0));
  check('null state → null',   aggregateWindowRangeForUV(null, 0, 0) === null);
  check('empty range → null',  aggregateWindowRangeForUV(state, 2, 1) === null);
}

// =====================================================================
// L2 + slab rotation caches.
// =====================================================================
group('getOrComputeUVRotation L2 cache');
{
  function fakeWin(pc1Vals, pc2Vals) {
    return { pc1: new Float64Array(pc1Vals), pc2: new Float64Array(pc2Vals) };
  }
  const nS = 18;
  // Build 18 samples in 3 clusters at (-1, 0), (0, 0), (1, 0) with tiny jitter.
  const pc1 = new Float64Array(nS);
  const pc2 = new Float64Array(nS);
  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 6; i++) {
      const idx = g * 6 + i;
      pc1[idx] = (g - 1) + (i - 3) * 0.01;
      pc2[idx] =  (i - 3) * 0.01;
    }
  }
  // Repeat across 4 windows.
  const windows = [];
  for (let w = 0; w < 4; w++) windows.push({ pc1, pc2 });
  const state = {
    data: {
      n_samples: nS,
      n_windows: 4,
      chrom: 'LG_TEST',
      windows,
      l2_envelopes: [{ _s0: 0, _e0: 3 }],
      samples: null,
    },
    flipPC1: false, pc1Sign: null, minNGroup: 3,
  };
  const rot1 = getOrComputeUVRotation(state, 0);
  check('rotation cache returns ok', rot1.ok === true);
  // Second call should hit the cache (same object).
  const rot2 = getOrComputeUVRotation(state, 0);
  check('rotation cache hit returns the same object', rot1 === rot2);
  // Bad L2 idx
  const rotBad = getOrComputeUVRotation(state, 99);
  check('bad L2 idx → NO_ENV', rotBad.ok === false && rotBad.reason === 'NO_ENV');
}

group('getOrComputeUVRotationSlab cache');
{
  function fakeWin(pc1Vals, pc2Vals) {
    return { pc1: new Float64Array(pc1Vals), pc2: new Float64Array(pc2Vals) };
  }
  const nS = 9;
  const pc1 = new Float64Array(nS);
  const pc2 = new Float64Array(nS);
  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 3; i++) {
      pc1[g * 3 + i] = (g - 1) + 0.05 * i;
      pc2[g * 3 + i] = 0.05 * (i - 1);
    }
  }
  const state = {
    data: { n_samples: nS, n_windows: 5, chrom: 'LG_TEST',
            windows: Array.from({ length: 5 }, () => ({ pc1, pc2 })),
            samples: null },
    flipPC1: false, pc1Sign: null, minNGroup: 2,
  };
  const r = getOrComputeUVRotationSlab(state, 0, 2);
  check('slab rotation ok', r.ok === true);
  // Bad range
  const rBad = getOrComputeUVRotationSlab(state, 3, 1);
  check('s > e → BAD_RANGE', rBad.ok === false && rBad.reason === 'BAD_RANGE');
}

// =====================================================================
// wrapKmeansResultAsCluster shape.
// =====================================================================
group('wrapKmeansResultAsCluster');
{
  const state = {
    data: { n_samples: 9, samples: null },
    minNGroup: 2,
  };
  const fakeResult = {
    labels: new Int8Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    n_per_group: [3, 3, 3],
  };
  const w = wrapKmeansResultAsCluster(state, fakeResult, 3, null);
  check('wrap ok=true when all groups ≥ minNGroup', w.ok === true);
  check('wrap exports usedK=3',                     w.usedK === 3);
  check('wrap has fixedKLabels alias',              w.fixedKLabels === fakeResult.labels);
  check('wrap has null silhouette (Phase 1)',       w.silhouette === null);

  const lowGroup = { labels: new Int8Array([0, 0, 1, 1, 2]),
                     n_per_group: [2, 2, 1] };
  const w2 = wrapKmeansResultAsCluster({ data: { n_samples: 5, samples: null }, minNGroup: 2 },
                                        lowGroup, 3, null);
  check('wrap ok=false when a group < minNGroup',
        w2.ok === false && w2.reason === 'LOW_GROUP_N');
}

// =====================================================================
// clusterL2_UVRotated end-to-end on the synthetic state.
// =====================================================================
group('clusterL2_UVRotated end-to-end');
{
  const nS = 18;
  const pc1 = new Float64Array(nS);
  const pc2 = new Float64Array(nS);
  for (let g = 0; g < 3; g++) {
    for (let i = 0; i < 6; i++) {
      const idx = g * 6 + i;
      pc1[idx] = (g - 1) + (i - 3) * 0.01;
      pc2[idx] =  (i - 3) * 0.01;
    }
  }
  const state = {
    data: {
      n_samples: nS,
      n_windows: 4,
      chrom: 'LG_TEST',
      windows: Array.from({ length: 4 }, () => ({ pc1, pc2 })),
      l2_envelopes: [{ _s0: 0, _e0: 3 }],
      samples: null,
    },
    flipPC1: false, pc1Sign: null, minNGroup: 3,
  };
  const cl = clusterL2_UVRotated(state, 0);
  check('clusterL2_UVRotated returns ok',  cl.ok === true);
  check('cluster usedK = 3',               cl.usedK === 3);
  check('cluster labels length = nS',      cl.labels && cl.labels.length === nS);
  check('cluster n_per_group sums to nS',
        cl.n_per_group && cl.n_per_group.reduce((a, b) => a + b, 0) === nS);
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
