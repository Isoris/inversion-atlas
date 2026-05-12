// shared/cross_page_clusters.js
//
// Cross-page cluster registry. Pages 1 (dosage), 2 (θπ MDS), 3 (GHSL)
// each compute their own K-means assignment for the active candidate;
// this module is the shared, page-independent store that lets ANY page
// color its scatter by ANY other page's clusters. Used by the
// "cluster_dosage" / "cluster_theta_pi" / "cluster_ghsl" sample-color
// modes in page1/_state.js and elsewhere.
//
// Legacy origin: lines 36540-36709 of legacy/Inversion_atlas.html.
// Transformations from legacy:
//   - All entry points take `state` as their first argument (no
//     global `state` / `window.state` lookup).
//   - Registry lives at state._crossPageClusters with the same
//     {dosage, theta_pi, ghsl} shape, so the data layout is
//     unchanged and any consumer that already peeks at state
//     keeps working.
//   - The legacy resolver chain for the "active candidate id" is
//     preserved verbatim (focalCandidate → lockedCandidate →
//     currentCandidate → 'env_' + focalEnvIdx → null).
//
// SPEC_v2 alignment: this module is the "page-1 dosage cluster",
// "page-2 θπ cluster", "page-3 GHSL cluster" tuple that v2's
// candidate_clusters_<source> layer will back. When Registry.write
// ships, each register() call becomes a registry.write() and the
// in-memory registry becomes a thin cache over the registry.read().
// Signatures (state, source, candId, payload) already match.
//
// Page-isolation: this is shared/, not page1/. Pages 1/2/3 import
// from here; they do NOT import each other. That is the whole point.

// =====================================================================
// Constants
// =====================================================================

/** The three signal sources that produce per-candidate K-means clusters. */
export const XP_CLUSTER_SOURCES = Object.freeze(['dosage', 'theta_pi', 'ghsl']);

/**
 * Shared K-cluster palette so a fish keeps the same color across signal
 * types — answers the question "does fish X stay in the same color
 * across orthogonal evidence layers?" with "yes if karyotype-consistent".
 */
export const XP_K_PALETTE = Object.freeze([
  '#4fa3ff', '#b8b8b8', '#f5a524', '#3cc08a', '#e0555c',
]);

// =====================================================================
// Registry plumbing
// =====================================================================

/**
 * Ensure state._crossPageClusters exists with the canonical shape.
 * Returns the registry. Idempotent.
 *
 * @param {Object} state
 * @returns {{dosage:Object, theta_pi:Object, ghsl:Object}|null}
 */
export function xpEnsureClusterRegistry(state) {
  if (!state) return null;
  if (!state._crossPageClusters) {
    state._crossPageClusters = { dosage: {}, theta_pi: {}, ghsl: {} };
  }
  return state._crossPageClusters;
}

/**
 * Register K-means cluster labels for `candidateId` under `source`.
 * Idempotent — later writes overwrite earlier ones for the same
 * (source, candidateId) pair.
 *
 * @param {Object} state
 * @param {'dosage'|'theta_pi'|'ghsl'} source
 * @param {string} candidateId
 * @param {Int8Array|Array<number>} labels   integer labels in 0..k-1
 * @param {number} [k]                       cluster count (default 3)
 * @returns {boolean}                        true on success
 */
export function xpRegisterClusters(state, source, candidateId, labels, k) {
  if (!state || !source || !candidateId || !labels) return false;
  if (!XP_CLUSTER_SOURCES.includes(source)) return false;
  const reg = xpEnsureClusterRegistry(state);
  if (!reg) return false;
  reg[source][candidateId] = {
    labels: labels instanceof Int8Array ? labels : Int8Array.from(labels),
    k: k || 3,
    source,
    candidate_id: candidateId,
  };
  return true;
}

/**
 * Look up the cluster entry for (source, candidateId). Returns null
 * when the source hasn't shipped clusters for the candidate yet —
 * downstream callers (e.g. xpSampleColor) fall through to grey so
 * the user can see that the cross-page evidence layer is missing.
 *
 * @param {Object} state
 * @param {'dosage'|'theta_pi'|'ghsl'} source
 * @param {string} candidateId
 * @returns {{labels:Int8Array, k:number, source:string, candidate_id:string}|null}
 */
export function xpLookupClusters(state, source, candidateId) {
  if (!state || !source || !candidateId) return null;
  const reg = xpEnsureClusterRegistry(state);
  if (!reg || !reg[source]) return null;
  return reg[source][candidateId] || null;
}

/**
 * Resolve the "currently active candidate id" for cross-page lookups.
 * Mirrors the legacy precedence so existing focal/locked/current state
 * keeps driving the cross-page colorings.
 *
 * @param {Object} state
 * @returns {string|null}
 */
export function xpActiveCandidateId(state) {
  if (!state) return null;
  if (state.focalCandidate && state.focalCandidate.id) return state.focalCandidate.id;
  if (state.lockedCandidate && state.lockedCandidate.id) return state.lockedCandidate.id;
  if (state.currentCandidate && state.currentCandidate.id) return state.currentCandidate.id;
  if (typeof state.focalEnvIdx === 'number') return 'env_' + state.focalEnvIdx;
  return null;
}

// =====================================================================
// Color resolvers
// =====================================================================

/**
 * Map a cluster label (0..k-1) to a hex color. Null / negative labels
 * → neutral grey.
 *
 * @param {number|null|undefined} label
 * @returns {string}
 */
export function xpClusterColor(label) {
  if (label == null || label < 0) return '#888';
  return XP_K_PALETTE[label] || '#888';
}

/**
 * Sample color for cross-page cluster mode. Returns grey when:
 *   - no active candidate is selected
 *   - the requested source has no clusters loaded for that candidate
 * Both fall-throughs are intentional — they make the missing-layer
 * case visible to the user instead of a misleading default color.
 *
 * @param {Object} state
 * @param {number} si
 * @param {'dosage'|'theta_pi'|'ghsl'} source
 * @returns {string}
 */
export function xpSampleColor(state, si, source) {
  const candId = xpActiveCandidateId(state);
  if (!candId) return '#888';
  const entry = xpLookupClusters(state, source, candId);
  if (!entry || !entry.labels) return '#888';
  return xpClusterColor(entry.labels[si]);
}

// =====================================================================
// Concordance summary
// =====================================================================

function _choose2(x) { return x < 2 ? 0 : (x * (x - 1)) / 2; }

function _adjustedRandIndex(table, n) {
  if (n < 2) return 0;
  let sum_nij = 0;
  const rowSums = new Int32Array(table.length);
  const colSums = new Int32Array(table[0].length);
  for (let r = 0; r < table.length; r++) {
    for (let c = 0; c < table[r].length; c++) {
      sum_nij += _choose2(table[r][c]);
      rowSums[r] += table[r][c]; colSums[c] += table[r][c];
    }
  }
  let sum_a = 0, sum_b = 0;
  for (let r = 0; r < rowSums.length; r++) sum_a += _choose2(rowSums[r]);
  for (let c = 0; c < colSums.length; c++) sum_b += _choose2(colSums[c]);
  const total = _choose2(n);
  const expected = (sum_a * sum_b) / total;
  const max = (sum_a + sum_b) / 2;
  if (max === expected) return 0;
  return (sum_nij - expected) / (max - expected);
}

/**
 * Compute concordance between two cluster sources for the active
 * candidate. Returns:
 *   { n, kA, kB,
 *     agreement,   // greedy row-max / n (intuitive % "agreeing" fish)
 *     ari,         // adjusted rand index (chance-corrected)
 *     cramers_v,   // χ²-based association strength
 *     chi2,        // raw χ²
 *     contingency: number[kA][kB]  // joint counts
 *   }
 * or null when either source has no clusters for the active candidate.
 *
 * @param {Object} state
 * @param {'dosage'|'theta_pi'|'ghsl'} sourceA
 * @param {'dosage'|'theta_pi'|'ghsl'} sourceB
 * @returns {Object|null}
 */
export function xpComputeConcordance(state, sourceA, sourceB) {
  const candId = xpActiveCandidateId(state);
  if (!candId) return null;
  const entryA = xpLookupClusters(state, sourceA, candId);
  const entryB = xpLookupClusters(state, sourceB, candId);
  if (!entryA || !entryB) return null;
  const labA = entryA.labels;
  const labB = entryB.labels;
  const n = Math.min(labA.length, labB.length);
  if (n === 0) return null;
  const kA = entryA.k, kB = entryB.k;
  const table = [];
  for (let i = 0; i < kA; i++) table.push(new Int32Array(kB));
  for (let i = 0; i < n; i++) {
    if (labA[i] >= 0 && labB[i] >= 0 && labA[i] < kA && labB[i] < kB) {
      table[labA[i]][labB[i]]++;
    }
  }
  let bestMatchSum = 0;
  for (let r = 0; r < kA; r++) {
    let best = 0;
    for (let c = 0; c < kB; c++) if (table[r][c] > best) best = table[r][c];
    bestMatchSum += best;
  }
  const agreement = n > 0 ? bestMatchSum / n : 0;
  const rowTot = new Int32Array(kA);
  const colTot = new Int32Array(kB);
  for (let r = 0; r < kA; r++) for (let c = 0; c < kB; c++) {
    rowTot[r] += table[r][c]; colTot[c] += table[r][c];
  }
  let chi2 = 0;
  for (let r = 0; r < kA; r++) for (let c = 0; c < kB; c++) {
    const exp = (rowTot[r] * colTot[c]) / n;
    if (exp > 0) {
      const dev = table[r][c] - exp;
      chi2 += dev * dev / exp;
    }
  }
  const minDim = Math.min(kA, kB) - 1;
  const cramersV = (n > 0 && minDim > 0) ? Math.sqrt(chi2 / (n * minDim)) : 0;
  const ari = _adjustedRandIndex(table, n);
  return {
    n, kA, kB, agreement, ari, cramers_v: cramersV, chi2,
    contingency: table.map(r => Array.from(r)),
  };
}
