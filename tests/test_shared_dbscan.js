// tests/test_shared_dbscan.js

import {
  dbscan,
  kDistAutoEps,
  DBSCAN_DEFAULT_K,
  dbscanDefaultMinPts,
} from '../atlases/inversion/shared/dbscan.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// =====================================================================
group('constants');
check('DEFAULT_K = 5',                        DBSCAN_DEFAULT_K === 5);
check('dbscanDefaultMinPts(226) = 18',        dbscanDefaultMinPts(226) === 18);
check('dbscanDefaultMinPts(10) = 3 (floor)',  dbscanDefaultMinPts(10) === 3);
check('dbscanDefaultMinPts(0) = 3',           dbscanDefaultMinPts(0) === 3);
check('dbscanDefaultMinPts(null) = 3',        dbscanDefaultMinPts(null) === 3);

// =====================================================================
group('dbscan — 1D Float64Array input');
{
  // Two well-separated clusters: {0, 0.1, 0.2} and {5, 5.1, 5.2}
  const points = Float64Array.from([0, 0.1, 0.2, 5, 5.1, 5.2]);
  const labels = dbscan(points, 0.5, 2);
  // First 3 are one cluster, last 3 another
  check('returns Int32Array',                  labels instanceof Int32Array);
  check('length matches input',                labels.length === 6);
  check('label[0] === label[1]',               labels[0] === labels[1]);
  check('label[1] === label[2]',               labels[1] === labels[2]);
  check('label[3] === label[4]',               labels[3] === labels[4]);
  check('label[4] === label[5]',               labels[4] === labels[5]);
  check('first ≠ last cluster',                labels[0] !== labels[3]);
  check('all labels in {1, 2}',                Array.from(labels).every(l => l === 1 || l === 2));
}
{
  // All noise: every point isolated
  const points = Float64Array.from([0, 100, 200, 300, 400]);
  const labels = dbscan(points, 1, 2);
  check('isolated points → all 0 (noise)',
        Array.from(labels).every(l => l === 0));
}
{
  // n=1: noise
  const labels = dbscan(Float64Array.from([42]), 1, 2);
  check('n=1: single noise label',             labels.length === 1 && labels[0] === 0);
}

// =====================================================================
group('dbscan — 2D input');
{
  // 6 points, 2 clusters: (0,0)/(0.1,0)/(0.05,0.1) and (5,5)/(5.1,5)/(5,5.1)
  const data = Float64Array.from([
    0, 0,   0.1, 0,   0.05, 0.1,
    5, 5,   5.1, 5,   5,    5.1,
  ]);
  const pointsObj = { dim: 2, data, n: 6 };
  const labels = dbscan(pointsObj, 0.5, 2);
  check('2D: 6 labels',                        labels.length === 6);
  check('2D: first 3 share cluster',           labels[0] === labels[1] && labels[1] === labels[2]);
  check('2D: last 3 share cluster',            labels[3] === labels[4] && labels[4] === labels[5]);
  check('2D: clusters differ',                 labels[0] !== labels[3]);
}

// =====================================================================
group('dbscan — input validation');
check('null input → empty array',             dbscan(null, 0.5, 2).length === 0);
check('eps <= 0 → empty',                     dbscan(Float64Array.from([1, 2]), 0, 2).length === 0);
check('negative eps → empty',                 dbscan(Float64Array.from([1, 2]), -1, 2).length === 0);
check('non-integer minPts → empty',           dbscan(Float64Array.from([1, 2]), 0.5, 1.5).length === 0);
check('minPts < 1 → empty',                   dbscan(Float64Array.from([1, 2]), 0.5, 0).length === 0);

// =====================================================================
group('kDistAutoEps');
{
  // Tight cluster {0, 0.1, 0.2, 0.3} + outlier 100
  const points = Float64Array.from([0, 0.1, 0.2, 0.3, 100]);
  const eps = kDistAutoEps(points, 2);
  check('returns finite number',               Number.isFinite(eps));
  check('positive eps',                        eps > 0);
}
{
  // Identical points → median distance = 0 → eps = 0
  const points = Float64Array.from([1, 1, 1, 1]);
  const eps = kDistAutoEps(points, 2);
  check('all-identical: eps = 0',              eps === 0);
}
{
  // n=1 → NaN
  check('n=1 → NaN',                           Number.isNaN(kDistAutoEps(Float64Array.from([5]), 2)));
}
{
  // k > n - 1 clamped
  const points = Float64Array.from([0, 1, 2]);
  const eps = kDistAutoEps(points, 99);   // clamped to 2
  check('k > n-1 clamped, still finite',       Number.isFinite(eps));
}
check('null input → NaN',                     Number.isNaN(kDistAutoEps(null, 2)));
check('non-integer k → NaN',                  Number.isNaN(kDistAutoEps(Float64Array.from([0, 1]), 1.5)));
check('k < 1 → NaN',                          Number.isNaN(kDistAutoEps(Float64Array.from([0, 1]), 0)));

// =====================================================================
group('integration: auto-eps → dbscan');
{
  // Two tight clusters far apart, sized 5 each
  const points = Float64Array.from([
    0, 0.1, 0.2, 0.3, 0.4,
    10, 10.1, 10.2, 10.3, 10.4,
  ]);
  const eps = kDistAutoEps(points, 3);
  const labels = dbscan(points, eps, 2);
  check('auto-eps → 2 distinct clusters',
        new Set(Array.from(labels).filter(l => l > 0)).size === 2);
  check('no noise (all 10 in clusters)',
        Array.from(labels).every(l => l > 0));
}

// =====================================================================
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
