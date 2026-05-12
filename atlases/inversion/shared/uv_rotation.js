// shared/uv_rotation.js
//
// UV-rotation primitive: takes per-sample aggregated (PC1, PC2) values,
// runs K-means3 on them, finds the axis from K-means centroid[0] to
// centroid[2], and rotates every sample + centroid into a (u, v) basis
// aligned with that axis. u = along-axis (the "STD/HET/INV gradient");
// v = orthogonal residual.
//
// Used by both the L2 rotation cache and the slab UV rotation path on
// page1. The legacy code keeps the cache slot keyed by L2 idx or
// (s, e) slab — those callers go in legacy for now. This module
// extracts the pure compute portion (Phase 2 of UV rotation).
//
// Legacy origin: lines 11035-11075 of legacy/Inversion_atlas.html
// (_computeUVRotationCore).

import { kmeans2D } from './kmeans.js';

/**
 * Run K-means3 on (xs, ys), find the axis from centroid[0] to
 * centroid[2], rotate everything into (u, v) basis.
 *
 * Phase ordering convention: the caller is expected to have already
 * aggregated per-sample mean PC1 (× sign) and PC2 across a window
 * range. K-means3 partitions those aggregated points into 3 clusters
 * (STD / HET / INV). The "axis" is the line from cluster 0's
 * centroid to cluster 2's centroid; rotation aligns the basis so
 * `u` is along that line and `v` is orthogonal.
 *
 * Returns:
 *   { ok: true, xs, ys, us, vs, angle (degrees),
 *     hom1_x/y, het_x/y, hom2_x/y,       // K-means centroids in (x,y)
 *     hom1_u/v, het_u/v, hom2_u/v,       // K-means centroids in (u,v)
 *     baseLabels: Int8Array,
 *     baseN: number[3],
 *     degenerate: boolean                 // true iff axisLen² ≤ 0
 *   }
 * or { ok: false, reason: 'KMEANS_FAILED' } if K-means returned bad shape.
 *
 * Inputs `xs` / `ys` are Float64Array of length `nS`. `nS` is passed
 * separately so callers using sub-views don't have to slice.
 *
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {number} nS
 * @returns {Object}
 */
export function computeUVRotationCore(xs, ys, nS) {
  const k3 = kmeans2D(xs, ys, 3);
  if (!k3 || !k3.cx || !k3.cy || k3.cx.length !== 3) {
    return { ok: false, reason: 'KMEANS_FAILED' };
  }
  const dx = k3.cx[2] - k3.cx[0];
  const dy = k3.cy[2] - k3.cy[0];
  const axisLen2 = dx * dx + dy * dy;
  const angle = (axisLen2 > 0) ? Math.atan2(dy, dx) : 0;
  const cos_a = Math.cos(angle);
  const sin_a = Math.sin(angle);

  const us = new Float64Array(nS);
  const vs = new Float64Array(nS);
  for (let si = 0; si < nS; si++) {
    const px = xs[si], py = ys[si];
    us[si] =  px * cos_a + py * sin_a;
    vs[si] = -px * sin_a + py * cos_a;
  }

  // Rotate centroids too (cheap; lets distance-to-Het modes skip
  // recomputing).
  const hom1_u =  k3.cx[0] * cos_a + k3.cy[0] * sin_a;
  const hom1_v = -k3.cx[0] * sin_a + k3.cy[0] * cos_a;
  const het_u  =  k3.cx[1] * cos_a + k3.cy[1] * sin_a;
  const het_v  = -k3.cx[1] * sin_a + k3.cy[1] * cos_a;
  const hom2_u =  k3.cx[2] * cos_a + k3.cy[2] * sin_a;
  const hom2_v = -k3.cx[2] * sin_a + k3.cy[2] * cos_a;

  return {
    ok: true,
    xs, ys, us, vs,
    angle: angle * 180 / Math.PI,
    hom1_x: k3.cx[0], hom1_y: k3.cy[0],
    het_x:  k3.cx[1], het_y:  k3.cy[1],
    hom2_x: k3.cx[2], hom2_y: k3.cy[2],
    hom1_u, hom1_v, het_u, het_v, hom2_u, hom2_v,
    baseLabels: k3.labels,
    baseN: k3.n_per_group.slice(),
    degenerate: axisLen2 <= 0,
  };
}
