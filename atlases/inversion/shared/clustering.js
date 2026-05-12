// atlases/inversion/shared/clustering.js
//
// Hierarchical-clustering primitives extracted from legacy lines
// 38863-38968. Generic enough to live in shared/: they take a
// distance matrix (or a concordance matrix via clusterByConcordance)
// and return either a dendrogram or a compact group assignment.
//
// Pure functions — no state, no DOM. The lineage-specific orchestrator
// is in pages/discovery/page1/lineage.js; the band-tracking pipeline's
// downstream consumers use these primitives via that wrapper.

// =====================================================================
// agglomerativeAverageLinkage (legacy lines 38863-38928)
// =====================================================================

/**
 * Average-linkage agglomerative clustering on a flat row-major distance
 * matrix. Returns the merge dendrogram as an ordered list of merges.
 *
 * Each merge carries:
 *   { left, right, dist, size, members }
 * where left/right are cluster ids (leaf ids 0..N-1, internal ids N..),
 * size is the merged cluster size, and members is the leaf-index array.
 *
 * @param {Float32Array|number[]} distMatrix  Flat N×N, row-major.
 *                                            Symmetric assumed; diagonal ignored.
 * @param {number} N                          Number of leaves.
 * @returns {Array<{left:number,right:number,dist:number,size:number,members:number[]}>}
 */
export function agglomerativeAverageLinkage(distMatrix, N) {
  // Active cluster set. Each cluster has: id, members (leaf indices), size
  const active = [];
  for (let i = 0; i < N; i++) {
    active.push({ id: i, members: [i], size: 1, alive: true });
  }
  // Distance map: keys are "i,j" with i < j (cluster ids, may exceed N for
  // internal nodes). Flat Map for fast lookup.
  const distMap = new Map();
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = distMatrix[i * N + j];
      distMap.set(`${i},${j}`, isFinite(d) ? d : 1);
    }
  }
  const dendrogram = [];
  let nextId = N;

  while (active.filter(c => c.alive).length > 1) {
    // Find closest pair among alive clusters
    let bestI = -1, bestJ = -1, bestD = Infinity;
    for (let a = 0; a < active.length; a++) {
      if (!active[a].alive) continue;
      for (let b = a + 1; b < active.length; b++) {
        if (!active[b].alive) continue;
        const ki = active[a].id, kj = active[b].id;
        const key = ki < kj ? `${ki},${kj}` : `${kj},${ki}`;
        const d = distMap.get(key);
        if (d == null) continue;
        if (d < bestD) { bestD = d; bestI = a; bestJ = b; }
      }
    }
    if (bestI < 0) break;

    const ci = active[bestI], cj = active[bestJ];
    const newId = nextId++;
    const newMembers = ci.members.concat(cj.members);
    const newSize = ci.size + cj.size;
    dendrogram.push({
      left: ci.id, right: cj.id, dist: bestD, size: newSize, members: newMembers,
    });

    // Update distMap: for every other alive cluster k, compute d(merged, k)
    //   = (n_i * d(i,k) + n_j * d(j,k)) / (n_i + n_j)
    for (let a = 0; a < active.length; a++) {
      if (!active[a].alive) continue;
      if (a === bestI || a === bestJ) continue;
      const ck = active[a];
      const keyIK = ci.id < ck.id ? `${ci.id},${ck.id}` : `${ck.id},${ci.id}`;
      const keyJK = cj.id < ck.id ? `${cj.id},${ck.id}` : `${ck.id},${cj.id}`;
      const dIK = distMap.get(keyIK);
      const dJK = distMap.get(keyJK);
      if (dIK == null || dJK == null) continue;
      const dNew = (ci.size * dIK + cj.size * dJK) / newSize;
      const keyNew = newId < ck.id ? `${newId},${ck.id}` : `${ck.id},${newId}`;
      distMap.set(keyNew, dNew);
    }

    // Mark old clusters dead, push new
    ci.alive = false;
    cj.alive = false;
    active.push({ id: newId, members: newMembers, size: newSize, alive: true });
  }

  return dendrogram;
}

// =====================================================================
// cutDendrogram (legacy lines 38935-38968)
// =====================================================================

/**
 * Cut the dendrogram at a distance threshold and return compact group
 * assignments. Any merge with `dist < threshold` collapses its members
 * into one group. The returned `group_id_per_band` is dense (0..n_groups-1).
 *
 * @param {ReturnType<typeof agglomerativeAverageLinkage>} dendrogram
 * @param {number} N                Number of leaves.
 * @param {number} threshold        Distance threshold for the cut.
 * @returns {{threshold:number, group_id_per_band:Int32Array, n_groups:number}}
 */
export function cutDendrogram(dendrogram, N, threshold) {
  // Union-find over leaves
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Apply union across all members of merged clusters when dist < threshold.
  for (const m of dendrogram) {
    if (m.dist >= threshold) continue;
    const members = m.members;
    if (members.length < 2) continue;
    const root = members[0];
    for (let i = 1; i < members.length; i++) union(root, members[i]);
  }

  // Compact group ids
  const group_id_per_band = new Int32Array(N);
  const remap = new Map();
  let next_id = 0;
  for (let i = 0; i < N; i++) {
    const r = find(i);
    if (!remap.has(r)) { remap.set(r, next_id++); }
    group_id_per_band[i] = remap.get(r);
  }
  return { threshold, group_id_per_band, n_groups: next_id };
}

// =====================================================================
// clusterByConcordance — convenience wrapper for the lineage pipeline
// (legacy lines 39260-39276, `_lineageClustering`)
// =====================================================================

/**
 * Cluster N samples by a concordance matrix: convert concordance → distance
 * (1 - C), agglomerate with average linkage, cut at threshold.
 *
 * @param {Float32Array} concordance  Flat N×N concordance (range [0, 1]).
 * @param {number} N                  Sample count.
 * @param {number} threshold          Distance threshold (1 - concordance cut).
 * @returns {{threshold:number, dendrogram:Array, lineage_id_per_sample:Int32Array, n_lineages:number}}
 */
export function clusterByConcordance(concordance, N, threshold) {
  const distMatrix = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      distMatrix[i * N + j] = (i === j) ? 0 : (1 - concordance[i * N + j]);
    }
  }
  const dendrogram = agglomerativeAverageLinkage(distMatrix, N);
  const cut = cutDendrogram(dendrogram, N, threshold);
  return {
    threshold,
    dendrogram,
    lineage_id_per_sample: cut.group_id_per_band,
    n_lineages: cut.n_groups,
  };
}

// =====================================================================
// cosineDistance (legacy line 38789)
// =====================================================================

/**
 * Cosine distance between two equal-length numeric vectors:
 *   cosineDistance(u, v) = 1 − (u · v) / (‖u‖ · ‖v‖)
 * Clamped to [0, 2] for numerical safety (the cos-sim domain is
 * [−1, 1], so the distance maps into [0, 2]).
 *
 * Returns NaN when inputs are missing or unequal length; returns 1
 * (maximally distant) when either vector is zero — matches the
 * legacy convention used by the inheritance-group clustering's
 * fingerprint-cosine path.
 *
 * @param {Float32Array|Float64Array|number[]} u
 * @param {Float32Array|Float64Array|number[]} v
 * @returns {number}
 */
export function cosineDistance(u, v) {
  if (!u || !v || u.length !== v.length) return NaN;
  let dot = 0, nu = 0, nv = 0;
  for (let i = 0; i < u.length; i++) {
    dot += u[i] * v[i];
    nu  += u[i] * u[i];
    nv  += v[i] * v[i];
  }
  if (nu === 0 || nv === 0) return 1;
  const sim = dot / Math.sqrt(nu * nv);
  const clamped = Math.max(-1, Math.min(1, sim));
  return 1 - clamped;
}

// =====================================================================
// Console-debug exposures (parity with legacy `window._cosineDistance`)
// =====================================================================
if (typeof window !== 'undefined') {
  window._cosineDistance              = cosineDistance;
  window._agglomerativeAverageLinkage = agglomerativeAverageLinkage;
  window._cutDendrogram               = cutDendrogram;
}
