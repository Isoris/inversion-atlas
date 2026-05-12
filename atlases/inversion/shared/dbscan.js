// shared/dbscan.js
//
// Pure JS DBSCAN clustering primitive (O(N²) naive — fine for cohort
// sizes around N=226 used in the inversion atlas). Includes a
// k-distance auto-epsilon helper matching the R-side STEP22 convention.
//
// Both functions are pure (no state, no DOM). The DBSCAN labels follow
// R `dbscan::dbscan()` convention: 0 = NOISE, 1+ = actual clusters.
//
// Legacy origin:
//   - _dbscan         line 11094
//   - _kDistAutoEps   line 11153
//
// Speed: typed arrays everywhere; ~51k pair distance comparisons at
// N=226 finish in ~0.5 ms in V8. No kd-tree — overhead exceeds savings
// at this scale.

// =====================================================================
// Input-shape helpers
// =====================================================================

function _readPoints(pointsObj) {
  const isFlat = ArrayBuffer.isView(pointsObj);
  if (isFlat) {
    return { dim: 1, data: pointsObj, n: pointsObj.length };
  }
  if (pointsObj && typeof pointsObj === 'object'
      && Number.isInteger(pointsObj.dim)
      && pointsObj.data
      && Number.isInteger(pointsObj.n)) {
    return { dim: pointsObj.dim, data: pointsObj.data, n: pointsObj.n };
  }
  return null;
}

function _dist2(dim, data, i, j) {
  if (dim === 1) {
    const d = data[i] - data[j];
    return d * d;
  }
  let s = 0;
  for (let k = 0; k < dim; k++) {
    const d = data[i * dim + k] - data[j * dim + k];
    s += d * d;
  }
  return s;
}

// =====================================================================
// DBSCAN
// =====================================================================

/**
 * DBSCAN clustering on 1-D or D-dimensional points.
 *
 *   pointsObj : Float64Array of length N (1-D), OR
 *               { dim: D, data: Float64Array(N*D), n: N } for D-D
 *   eps       : Euclidean distance threshold
 *   minPts    : minimum cluster size including the seed point
 *
 * Returns Int32Array(N) of cluster labels:
 *   0   = NOISE (R dbscan convention)
 *   1+  = cluster id (1-indexed)
 *
 * On invalid input → returns an empty Int32Array.
 *
 * @param {Float64Array|{dim:number,data:Float64Array,n:number}} pointsObj
 * @param {number} eps
 * @param {number} minPts
 * @returns {Int32Array}
 */
export function dbscan(pointsObj, eps, minPts) {
  const p = _readPoints(pointsObj);
  if (!p || !(eps > 0) || !Number.isInteger(minPts) || minPts < 1) {
    return new Int32Array(0);
  }
  const { dim, data, n } = p;
  const eps2 = eps * eps;

  function neighbors(i) {
    const out = [];
    for (let j = 0; j < n; j++) {
      if (i !== j && _dist2(dim, data, i, j) <= eps2) out.push(j);
    }
    return out;
  }

  // 0 = unvisited, -1 = noise (provisional, may be promoted to border),
  // ≥1 = cluster id
  const labels = new Int32Array(n);
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== 0) continue;
    const nb = neighbors(i);
    if (nb.length < minPts - 1) {   // -1: neighbors() excludes self
      labels[i] = -1;
      continue;
    }
    cid++;
    labels[i] = cid;
    const queue = nb.slice();
    while (queue.length > 0) {
      const j = queue.shift();
      if (labels[j] === -1) labels[j] = cid;   // promote noise → border
      if (labels[j] !== 0) continue;
      labels[j] = cid;
      const nb2 = neighbors(j);
      if (nb2.length >= minPts - 1) {
        for (const k of nb2) if (labels[k] === 0) queue.push(k);
      }
    }
  }
  // Convert -1 → 0 (R convention)
  for (let i = 0; i < n; i++) if (labels[i] === -1) labels[i] = 0;
  return labels;
}

// =====================================================================
// k-distance auto-epsilon
// =====================================================================

/**
 * Auto-eps for DBSCAN via k-distance heuristic:
 *
 *   eps = median(k-NN distance over all points) × 0.8
 *
 * Mirrors STEP22's R-side default. `k` is capped at `n - 1` when the
 * input is small. Returns NaN when n < 2 or all distances are
 * non-finite.
 *
 * @param {Float64Array|{dim:number,data:Float64Array,n:number}} pointsObj
 * @param {number} k    typically 5
 * @returns {number}
 */
export function kDistAutoEps(pointsObj, k) {
  const p = _readPoints(pointsObj);
  if (!p) return NaN;
  const { dim, data, n } = p;
  if (n < 2) return NaN;
  if (!Number.isInteger(k) || k < 1) return NaN;
  const kActual = Math.min(k, n - 1);
  const knnDists = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d2s = new Float64Array(n - 1);
    let pIdx = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      d2s[pIdx++] = _dist2(dim, data, i, j);
    }
    const sorted = Array.from(d2s).sort((a, b) => a - b);
    knnDists[i] = Math.sqrt(sorted[kActual - 1]);
  }
  const finite = Array.from(knnDists).filter(v => Number.isFinite(v));
  if (finite.length === 0) return NaN;
  finite.sort((a, b) => a - b);
  const median = (finite.length % 2 === 1)
    ? finite[(finite.length - 1) >> 1]
    : 0.5 * (finite[finite.length / 2 - 1] + finite[finite.length / 2]);
  return median * 0.8;
}

/** Default k for kDistAutoEps. STEP22's R default is 5. */
export const DBSCAN_DEFAULT_K = 5;

/**
 * Default minPts for DBSCAN: max(3, floor(n * 0.08)). Mirrors STEP22.
 *
 * @param {number} n
 * @returns {number}
 */
export function dbscanDefaultMinPts(n) {
  if (!Number.isInteger(n) || n < 1) return 3;
  return Math.max(3, Math.floor(n * 0.08));
}
