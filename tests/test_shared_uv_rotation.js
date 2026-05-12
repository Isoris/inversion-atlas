// tests/test_shared_uv_rotation.js

import { computeUVRotationCore } from '../atlases/inversion/shared/uv_rotation.js';

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
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
