// shared/mgl_haplotype_network.js
// =====================================================================
// Minimum-spanning haplotype network for INV chromosomes. Nodes are
// dosage-vector clusters (samples at Hamming distance ≤ radius are
// collapsed); edges form a minimum spanning tree across nodes by
// pairwise Hamming distance.
//
// V1 simplifications:
//   - "haplotype" = per-sample dosage vector (HOM_B and HET both
//     contribute one row; HET's dosage values around 1 deliberately
//     produce fuzzier nodes — the UI surfaces this)
//   - Hamming distance over derived-carrier bool (dosage > threshold)
//   - Minimum spanning tree via Prim's algorithm
//   - Force-directed layout (n_iter iterations of attractive/
//     repulsive forces) for visualization
//
// Pure compute. No DOM, no fetch.
// =====================================================================

/**
 * Array-or-TypedArray guard. `Array.isArray(new Int32Array(...))` is
 * **false**, so a plain `Array.isArray(a.inv_idx)` check silently
 * rejects autoSeedInvIdx output (Int32Array) and every other typed
 * caller. The JSDoc on this module says `number[]` for historical
 * reasons, but in practice both shapes show up at the boundary.
 */
function _isVec(x) {
  return Array.isArray(x) || (x != null && ArrayBuffer.isView(x) && typeof x.length === 'number');
}

export const MGL_HAPNET_DEFAULTS = Object.freeze({
  hamming_radius:        2,        // samples within this distance collapse
  carrier_threshold:     0.5,
  layout_iterations:     100,
  layout_repulsion:      400,
  layout_attraction:     0.04,
  layout_damping:        0.85,
  layout_seed:           12345,
});

// =====================================================================
// 1. Per-sample carrier vector
// =====================================================================

/**
 * Build a per-INV-sample boolean carrier matrix: row[i][m] = 1 if
 * sample i's dosage at site m exceeds the carrier threshold.
 *
 * @param {Object} args
 *   dosage, n_markers, n_samples, inv_idx, opts
 * @returns {Uint8Array}  flat row-major (inv_idx.length × n_markers)
 */
export function buildCarrierMatrix(args) {
  const a = args || {};
  const o = a.opts || {};
  const D = MGL_HAPNET_DEFAULTS;
  const thr = Number.isFinite(o.carrier_threshold) ? o.carrier_threshold : D.carrier_threshold;
  if (!a.dosage || !_isVec(a.inv_idx)) {
    return new Uint8Array(0);
  }
  const n = a.inv_idx.length;
  const m = a.n_markers;
  const out = new Uint8Array(n * m);
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  for (let i = 0; i < n; i++) {
    const si = a.inv_idx[i];
    for (let mi = 0; mi < m; mi++) {
      const v = isFlat ? a.dosage[mi * a.n_samples + si]
                       : (a.dosage[mi] && a.dosage[mi][si]);
      if (v == null || !Number.isFinite(v) || v < 0) { out[i * m + mi] = 0; continue; }
      out[i * m + mi] = v > thr ? 1 : 0;
    }
  }
  return out;
}

/**
 * Pairwise Hamming distance over the carrier matrix.
 *
 * @param {Uint8Array} carriers   n × m row-major
 * @param {number} n
 * @param {number} m
 * @returns {Float64Array}        n × n row-major
 */
export function pairwiseHamming(carriers, n, m) {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      const off_i = i * m;
      const off_j = j * m;
      for (let mi = 0; mi < m; mi++) {
        if (carriers[off_i + mi] !== carriers[off_j + mi]) d++;
      }
      out[i * n + j] = d;
      out[j * n + i] = d;
    }
  }
  return out;
}

// =====================================================================
// 2. Cluster samples within Hamming radius
// =====================================================================

/**
 * Greedy single-link clustering: a sample joins an existing cluster
 * if it's within `radius` of any member, otherwise it starts a new one.
 * Returns per-sample cluster id (0-based) + per-cluster member lists.
 *
 * @param {Float64Array} dist    n × n
 * @param {number} n
 * @param {number} radius
 * @returns {{labels:Int32Array, clusters:Array<number[]>}}
 */
export function clusterByHammingRadius(dist, n, radius) {
  const labels = new Int32Array(n).fill(-1);
  const clusters = [];
  for (let i = 0; i < n; i++) {
    let assigned = -1;
    for (let k = 0; k < clusters.length; k++) {
      for (const m of clusters[k]) {
        if (dist[i * n + m] <= radius) { assigned = k; break; }
      }
      if (assigned >= 0) break;
    }
    if (assigned >= 0) {
      labels[i] = assigned;
      clusters[assigned].push(i);
    } else {
      labels[i] = clusters.length;
      clusters.push([i]);
    }
  }
  return { labels, clusters };
}

// =====================================================================
// 3. Inter-cluster distance + minimum spanning tree
// =====================================================================

/**
 * Mean inter-cluster Hamming distance.
 *
 * @param {Float64Array} dist    n × n sample distance
 * @param {number} n
 * @param {Array<number[]>} clusters
 * @returns {Float64Array}       K × K
 */
export function interClusterDistance(dist, n, clusters) {
  const K = clusters.length;
  const out = new Float64Array(K * K);
  for (let a = 0; a < K; a++) {
    for (let b = a + 1; b < K; b++) {
      let sum = 0, cnt = 0;
      for (const i of clusters[a]) {
        for (const j of clusters[b]) {
          sum += dist[i * n + j];
          cnt++;
        }
      }
      const d = cnt > 0 ? sum / cnt : 0;
      out[a * K + b] = d;
      out[b * K + a] = d;
    }
  }
  return out;
}

/**
 * Prim's minimum spanning tree on a dense K × K distance matrix.
 * Returns the edges that form the MST (K - 1 edges).
 *
 * @param {Float64Array} dist   K × K
 * @param {number} K
 * @returns {Array<{a:number, b:number, dist:number}>}
 */
export function minimumSpanningTree(dist, K) {
  if (K === 0) return [];
  if (K === 1) return [];
  const inTree = new Uint8Array(K);
  const minEdge = new Float64Array(K).fill(Infinity);
  const parent = new Int32Array(K).fill(-1);
  inTree[0] = 1;
  for (let k = 1; k < K; k++) {
    minEdge[k] = dist[0 * K + k];
    parent[k] = 0;
  }
  const edges = [];
  for (let it = 1; it < K; it++) {
    let best = -1, bestD = Infinity;
    for (let k = 0; k < K; k++) {
      if (!inTree[k] && minEdge[k] < bestD) { bestD = minEdge[k]; best = k; }
    }
    if (best < 0) break;
    inTree[best] = 1;
    edges.push({ a: parent[best], b: best, dist: bestD });
    for (let k = 0; k < K; k++) {
      if (!inTree[k]) {
        const d = dist[best * K + k];
        if (d < minEdge[k]) { minEdge[k] = d; parent[k] = best; }
      }
    }
  }
  return edges;
}

// =====================================================================
// 4. Force-directed layout
// =====================================================================

// Tiny seeded PRNG (Mulberry32) so layouts are reproducible.
function _mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Force-directed layout of nodes + edges in a canvas-friendly box.
 *
 * @param {number} K
 * @param {Array<{a:number, b:number, dist:number}>} edges
 * @param {Object} [opts]
 *   width / height / iterations / repulsion / attraction /
 *   damping / seed
 * @returns {Array<{x:number, y:number}>}   length K, in [0..W] x [0..H]
 */
export function forceLayout(K, edges, opts) {
  const o = opts || {};
  const D = MGL_HAPNET_DEFAULTS;
  const W = Math.max(50, Number.isFinite(o.width) ? o.width : 400);
  const H = Math.max(50, Number.isFinite(o.height) ? o.height : 300);
  const iters = Number.isFinite(o.iterations) ? o.iterations : D.layout_iterations;
  const repul = Number.isFinite(o.repulsion) ? o.repulsion : D.layout_repulsion;
  const attr  = Number.isFinite(o.attraction) ? o.attraction : D.layout_attraction;
  const damp  = Number.isFinite(o.damping) ? o.damping : D.layout_damping;
  const seed  = Number.isFinite(o.seed) ? o.seed : D.layout_seed;
  const rng = _mulberry32(seed | 0);
  if (K === 0) return [];
  const pos = new Array(K);
  for (let i = 0; i < K; i++) pos[i] = { x: rng() * W, y: rng() * H };
  const vel = new Array(K);
  for (let i = 0; i < K; i++) vel[i] = { x: 0, y: 0 };
  for (let it = 0; it < iters; it++) {
    const fx = new Float64Array(K);
    const fy = new Float64Array(K);
    // Repulsion (all-pairs).
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { d2 = 0.01; dx = 0.1; dy = 0.1; }
        const f = repul / d2;
        fx[i] += f * dx; fy[i] += f * dy;
        fx[j] -= f * dx; fy[j] -= f * dy;
      }
    }
    // Attraction along edges.
    for (const e of edges) {
      const dx = pos[e.b].x - pos[e.a].x;
      const dy = pos[e.b].y - pos[e.a].y;
      const f = attr * (e.dist > 0 ? e.dist : 1);
      fx[e.a] += f * dx; fy[e.a] += f * dy;
      fx[e.b] -= f * dx; fy[e.b] -= f * dy;
    }
    // Integrate with damping.
    for (let i = 0; i < K; i++) {
      vel[i].x = (vel[i].x + fx[i]) * damp;
      vel[i].y = (vel[i].y + fy[i]) * damp;
      pos[i].x += vel[i].x;
      pos[i].y += vel[i].y;
      // Clamp to box with margin.
      if (pos[i].x < 10) pos[i].x = 10; else if (pos[i].x > W - 10) pos[i].x = W - 10;
      if (pos[i].y < 10) pos[i].y = 10; else if (pos[i].y > H - 10) pos[i].y = H - 10;
    }
  }
  return pos;
}

// =====================================================================
// 5. End-to-end orchestrator
// =====================================================================

/**
 * Build the full haplotype network from INV chromosomes.
 *
 * @param {Object} args   dosage / n_markers / n_samples / inv_idx /
 *                        opts (hamming_radius / carrier_threshold /
 *                        layout_width / layout_height / etc.)
 * @returns {{
 *   nodes:Array<{id:number, members:number[], size:number,
 *                 carrier_count:number, x:number, y:number}>,
 *   edges:Array<{a:number, b:number, dist:number}>,
 *   sample_labels:Int32Array,    n × 1, per-INV-sample node id
 *   carrier_matrix:Uint8Array,   n × n_markers
 *   inter_distance:Float64Array, K × K
 *   pair_distance:Float64Array,  n × n   sample-level
 * }}
 */
export function buildHaplotypeNetwork(args) {
  const a = args || {};
  const o = a.opts || {};
  const D = MGL_HAPNET_DEFAULTS;
  const radius = Number.isFinite(o.hamming_radius) ? o.hamming_radius : D.hamming_radius;
  if (!a.dosage || !_isVec(a.inv_idx) || a.inv_idx.length === 0) {
    return { nodes: [], edges: [], sample_labels: new Int32Array(0),
             carrier_matrix: new Uint8Array(0),
             inter_distance: new Float64Array(0),
             pair_distance: new Float64Array(0) };
  }
  const n = a.inv_idx.length;
  const m = a.n_markers;
  const carriers = buildCarrierMatrix(args);
  const pairs = pairwiseHamming(carriers, n, m);
  const cl = clusterByHammingRadius(pairs, n, radius);
  const interD = interClusterDistance(pairs, n, cl.clusters);
  const K = cl.clusters.length;
  const edges = minimumSpanningTree(interD, K);
  const pos = forceLayout(K, edges, {
    width:      Number.isFinite(o.layout_width)  ? o.layout_width  : 400,
    height:     Number.isFinite(o.layout_height) ? o.layout_height : 300,
    iterations: o.layout_iterations,
    repulsion:  o.layout_repulsion,
    attraction: o.layout_attraction,
    damping:    o.layout_damping,
    seed:       o.layout_seed,
  });
  const nodes = new Array(K);
  for (let k = 0; k < K; k++) {
    const members = cl.clusters[k];
    let carriers_count = 0;
    for (const i of members) {
      for (let mi = 0; mi < m; mi++) carriers_count += carriers[i * m + mi];
    }
    nodes[k] = {
      id:            k,
      members,
      size:          members.length,
      carrier_count: carriers_count,
      x:             pos[k] ? pos[k].x : 0,
      y:             pos[k] ? pos[k].y : 0,
    };
  }
  return {
    nodes, edges,
    sample_labels:  cl.labels,
    carrier_matrix: carriers,
    inter_distance: interD,
    pair_distance:  pairs,
  };
}
