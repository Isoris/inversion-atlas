// shared/mgl_doubleton_sfs_clusters.js
// =====================================================================
// 2D-SFS doubleton sharing → hierarchical clustering of INV chromosomes.
//
// Idea: for each pair of INV chromosomes (i, j), count how many sites
// in the candidate carry a derived allele in *exactly* those two
// chromosomes (a "doubleton" shared by i and j). Pairs that share
// many such doubletons descend from a recent common ancestor — they
// belong to the same INV sublineage. Pairs with few/no shared
// doubletons are more distantly related within the INV class.
//
// Distance:    d(i, j) = 1 / (1 + shared_doubleton_count_ij)
// Clustering:  average-linkage (UPGMA-style) until K groups remain.
//
// V1 simplifications:
//   - "chromosomes" = SAMPLES, with one row per sample. HOM_B
//     contributes one row representing both copies (they're
//     identical at fixation); HET contributes one row that's
//     deliberately fuzzy (the renderer/UI flags this).
//   - "Derived" allele = dosage ≥ 1 for diploid inputs. The producer
//     can substitute proper phased haplotypes later without changing
//     the API.
//   - Missing data (dosage NA or -1) is skipped.
//
// Pure compute. No DOM, no fetch.
// =====================================================================

/** Array-or-TypedArray guard — see mgl_haplotype_network.js for why. */
function _isVec(x) {
  return Array.isArray(x) || (x != null && ArrayBuffer.isView(x) && typeof x.length === 'number');
}

/** Defaults. */
export const MGL_DOUBLETON_DEFAULTS = Object.freeze({
  K_min:                 2,
  K_max:                 6,
  min_group_size:        2,
  // Carrier threshold: a sample "carries" the derived allele when its
  // dosage exceeds this value. For diploid dosage in [0..2] the
  // default 0.5 catches HET+HOM.
  carrier_threshold:     0.5,
  // Doubleton = derived seen in exactly k samples (k_target = 2 by
  // default). Setting k_target larger lets the caller use k-tons
  // (3 or 4) for very small inversions.
  k_target:              2,
});

// =====================================================================
// 1. Doubleton-sharing matrix
// =====================================================================

/**
 * For each pair of samples in `inv_idx`, count the sites at which
 * BOTH samples are derived carriers AND the total number of derived
 * carriers across `inv_idx` at that site equals `k_target`.
 *
 * Output is a row-major symmetric Float64Array of length n*n where
 * n = inv_idx.length. Diagonal is 0.
 *
 * @param {Object} args
 * @param {Float64Array|Array<Float64Array|number[]>} args.dosage
 *   Either flat row-major Float64Array(n_markers × n_samples) or
 *   markers-as-rows array-of-arrays. Both shapes accepted.
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {number[]} args.inv_idx        INV-class sample indices
 * @param {Object} [args.opts]
 * @returns {{
 *   shared:Float64Array,    // n × n symmetric
 *   per_sample_carrier:Int32Array,  // per-INV-sample total carrier count
 *   n_doubleton_sites:number,
 * }}
 */
export function buildDoubletonShareMatrix(args) {
  const a = args || {};
  const o = a.opts || {};
  const D = MGL_DOUBLETON_DEFAULTS;
  const thr = Number.isFinite(o.carrier_threshold) ? o.carrier_threshold : D.carrier_threshold;
  const kTarget = Number.isFinite(o.k_target) ? o.k_target : D.k_target;
  if (!a.dosage || !_isVec(a.inv_idx) || a.inv_idx.length < 2) {
    return { shared: new Float64Array(0), per_sample_carrier: new Int32Array(0),
             n_doubleton_sites: 0 };
  }
  const n = a.inv_idx.length;
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  const getCell = (mi, si) => {
    if (isFlat) return a.dosage[mi * a.n_samples + si];
    const row = a.dosage[mi];
    return row ? row[si] : null;
  };
  const shared = new Float64Array(n * n);
  const perSample = new Int32Array(n);
  let n_doubleton_sites = 0;

  // For each site, find which INV samples carry the derived allele
  // and tally per-pair when the carrier count == k_target.
  const carriers = new Array(n);
  for (let mi = 0; mi < a.n_markers; mi++) {
    let nc = 0;
    for (let i = 0; i < n; i++) {
      const v = getCell(mi, a.inv_idx[i]);
      if (v == null || !Number.isFinite(v) || v < 0) continue;
      if (v > thr) { carriers[nc++] = i; perSample[i]++; }
    }
    if (nc !== kTarget) continue;
    n_doubleton_sites++;
    // Bump each pair in `carriers[0..nc)`.
    for (let a1 = 0; a1 < nc; a1++) {
      const i = carriers[a1];
      for (let b1 = a1 + 1; b1 < nc; b1++) {
        const j = carriers[b1];
        shared[i * n + j] += 1;
        shared[j * n + i] += 1;
      }
    }
  }
  return { shared, per_sample_carrier: perSample, n_doubleton_sites };
}

// =====================================================================
// 2. Sharing → distance matrix
// =====================================================================

/**
 * d(i, j) = 1 / (1 + shared_ij). Diagonal is 0. Caps any +∞ inputs
 * at 1.0 (no shared) so the result fits the [0..1] expected range.
 *
 * @param {Float64Array} shared    output of buildDoubletonShareMatrix
 * @param {number} n
 * @returns {Float64Array}         n × n distance, row-major
 */
export function sharedToDistance(shared, n) {
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) out[i * n + j] = 0;
      else out[i * n + j] = 1 / (1 + shared[i * n + j]);
    }
  }
  return out;
}

// =====================================================================
// 3. Average-linkage agglomerative clustering
// =====================================================================

/**
 * Standard average-linkage (UPGMA) clustering. Merges the closest
 * pair of clusters at each step. Returns a list of merges + the
 * cluster-id assignment when cut to K groups.
 *
 * @param {Float64Array} dist   n × n distance matrix (row-major)
 * @param {number} n            number of leaves
 * @param {number} K            target group count
 * @returns {{
 *   labels:Int32Array,         length n, values 0..K-1
 *   merges:Array<{a:number, b:number, dist:number, size:number}>,
 *   K_actual:number,
 * }}
 */
export function averageLinkageCluster(dist, n, K) {
  if (n === 0) return { labels: new Int32Array(0), merges: [], K_actual: 0 };
  if (n === 1) return { labels: new Int32Array(1), merges: [], K_actual: 1 };
  const targetK = Math.max(1, Math.min(K | 0, n));
  // Each active cluster owns a set of leaf ids and a row in the
  // working distance matrix.
  const active = new Map();
  let nextId = n;
  for (let i = 0; i < n; i++) active.set(i, [i]);
  // Cached distance between cluster ids.
  const d = new Map();
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) d.set(key(i, j), dist[i * n + j]);
  }
  const merges = [];
  while (active.size > targetK) {
    // Find closest pair.
    let bestA = -1, bestB = -1, bestD = Infinity;
    const ids = Array.from(active.keys());
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const dij = d.get(key(ids[i], ids[j]));
        if (dij == null) continue;
        if (dij < bestD) { bestD = dij; bestA = ids[i]; bestB = ids[j]; }
      }
    }
    if (bestA < 0) break;
    const leavesA = active.get(bestA);
    const leavesB = active.get(bestB);
    const merged = leavesA.concat(leavesB);
    const newId = nextId++;
    active.delete(bestA); active.delete(bestB);
    active.set(newId, merged);
    merges.push({ a: bestA, b: bestB, dist: bestD, size: merged.length });
    // Refresh distances from the new cluster to every other active.
    for (const otherId of active.keys()) {
      if (otherId === newId) continue;
      const otherLeaves = active.get(otherId);
      // Average-linkage = mean over all leaf-pairs (a in merged, b in other).
      let sum = 0, cnt = 0;
      for (const x of merged) {
        for (const y of otherLeaves) {
          sum += dist[x * n + y];
          cnt++;
        }
      }
      d.set(key(newId, otherId), cnt > 0 ? sum / cnt : 0);
    }
    // Cull stale keys touching bestA / bestB.
    for (const k of Array.from(d.keys())) {
      const [a, b] = k.split('|').map(Number);
      if (a === bestA || a === bestB || b === bestA || b === bestB) d.delete(k);
    }
  }
  // Assign cluster ids to leaves.
  const labels = new Int32Array(n);
  let k = 0;
  for (const leaves of active.values()) {
    for (const leaf of leaves) labels[leaf] = k;
    k++;
  }
  return { labels, merges, K_actual: active.size };
}

// =====================================================================
// 4. End-to-end orchestrator
// =====================================================================

/**
 * Top-level entry. Builds the doubleton-share matrix, converts it to
 * a distance, then cuts the UPGMA tree at K=opts.K_max (or as many
 * groups as fit given min_group_size).
 *
 * @param {Object} args     forwarded to buildDoubletonShareMatrix
 * @returns {{
 *   shared:Float64Array, distance:Float64Array,
 *   labels:Int32Array, merges:Array<Object>, K_actual:number,
 *   per_sample_carrier:Int32Array, n_doubleton_sites:number,
 * }}
 */
export function clusterInvByDoubletonSharing(args) {
  const a = args || {};
  const o = a.opts || {};
  const D = MGL_DOUBLETON_DEFAULTS;
  const Kmax = Number.isFinite(o.K_max) ? o.K_max : D.K_max;
  const minGrp = Number.isFinite(o.min_group_size) ? o.min_group_size : D.min_group_size;
  const r = buildDoubletonShareMatrix(args);
  const n = _isVec(a.inv_idx) ? a.inv_idx.length : 0;
  if (n < 2) {
    return {
      shared: r.shared, distance: new Float64Array(0),
      labels: new Int32Array(n), merges: [], K_actual: n,
      per_sample_carrier: r.per_sample_carrier,
      n_doubleton_sites: r.n_doubleton_sites,
    };
  }
  const distance = sharedToDistance(r.shared, n);
  // Walk down from Kmax until the smallest cluster passes minGrp.
  let chosen = null;
  for (let K = Math.min(Kmax, n); K >= 1; K--) {
    const c = averageLinkageCluster(distance, n, K);
    if (K === 1) { chosen = c; break; }
    const counts = new Int32Array(c.K_actual);
    for (let i = 0; i < c.labels.length; i++) counts[c.labels[i]]++;
    let minC = Infinity;
    for (let i = 0; i < counts.length; i++) if (counts[i] < minC) minC = counts[i];
    if (minC >= minGrp) { chosen = c; break; }
  }
  if (!chosen) chosen = averageLinkageCluster(distance, n, 1);
  return {
    shared: r.shared, distance,
    labels: chosen.labels, merges: chosen.merges, K_actual: chosen.K_actual,
    per_sample_carrier: r.per_sample_carrier,
    n_doubleton_sites: r.n_doubleton_sites,
  };
}

// =====================================================================
// 5. Per-cluster consensus rows
// =====================================================================

/**
 * Build a per-cluster mean-dosage row for each subgroup. Useful as
 * input to the MSA-style renderer.
 *
 * @param {Object} args
 * @param {Float64Array|Array<Float64Array|number[]>} args.dosage
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {number[]} args.inv_idx       same length as args.labels
 * @param {Int32Array} args.labels      cluster id per inv_idx position
 * @param {number} args.K_actual
 * @returns {Array<Float64Array>}       per cluster: mean dosage row
 */
export function perClusterMeanDosage(args) {
  const a = args || {};
  if (!a.dosage || !(a.n_markers > 0) || !_isVec(a.inv_idx)
      || !a.labels || !(a.K_actual > 0)) return [];
  const out = new Array(a.K_actual);
  for (let k = 0; k < a.K_actual; k++) out[k] = new Float64Array(a.n_markers);
  const counts = new Int32Array(a.K_actual);
  const isFlat = a.dosage instanceof Float64Array || ArrayBuffer.isView(a.dosage);
  for (let mi = 0; mi < a.n_markers; mi++) {
    const sums = new Float64Array(a.K_actual);
    const ns   = new Int32Array(a.K_actual);
    for (let pi = 0; pi < a.inv_idx.length; pi++) {
      const si = a.inv_idx[pi];
      const v = isFlat ? a.dosage[mi * a.n_samples + si]
                       : (a.dosage[mi] && a.dosage[mi][si]);
      if (v == null || !Number.isFinite(v) || v < 0) continue;
      const k = a.labels[pi];
      sums[k] += v;
      ns[k]++;
    }
    for (let k = 0; k < a.K_actual; k++) {
      out[k][mi] = ns[k] > 0 ? sums[k] / ns[k] : NaN;
    }
    if (mi === 0) for (let k = 0; k < a.K_actual; k++) counts[k] = ns[k];
  }
  return out;
}
