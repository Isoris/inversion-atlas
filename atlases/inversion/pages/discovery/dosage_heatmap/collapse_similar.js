// pages/discovery/dosage_heatmap/collapse_similar.js
// =====================================================================
// Collapse near-identical samples into a few representative rows to cut
// crowding in the heatmap (and shrink the row count before any O(n²)
// clustering work).
//
// Similarity is a Hamming distance over genomic-ordered, tier-quantized
// dosage bins: each sample's smoothed per-bin mean dosage is rounded to a
// tier (0 / 1 / 2), giving a short signature; two samples are "similar"
// when their signatures differ in ≤ `hammingThreshold` comparable bins.
// Because bin k is only ever compared to bin k, this Hamming distance is
// position-aware — it respects SNP order, unlike a positionless bag.
//
// Greedy leader clustering groups the samples; each group keeps its
// medoid plus the nearest few members as displayed representatives, and
// reports its full size so the page can draw an ×N badge + a right-side
// size histogram. Hidden members are still listed per group.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================
import { buildSampleTrajectoryMatrix, smoothTrajectories } from './index_aware_cluster.js';

const TIER_MISSING = -1;

/**
 * Per-sample tier signature over genomic-ordered bins.
 * @returns {{ sig:Int8Array, nS:number, nBins:number } | null}
 *   sig is row-major nS×nBins of tiers {0,1,2} or -1 (no data in that bin).
 */
export function sampleTierSignatures(canonical, opts) {
  const o = opts || {};
  const traj = buildSampleTrajectoryMatrix(canonical, o);
  if (!traj) return null;
  const { nS, nBins } = traj;
  const Bs = smoothTrajectories(traj.B, nS, nBins, o.smoothWindow);
  const sig = new Int8Array(nS * nBins);
  for (let i = 0; i < nS * nBins; i++) {
    const v = Bs[i];
    sig[i] = !Number.isFinite(v) ? TIER_MISSING : (v < 0.5 ? 0 : (v < 1.5 ? 1 : 2));
  }
  return { sig, nS, nBins };
}

/**
 * Hamming distance between two signatures over comparable bins (bins
 * where both samples have a tier). Returns Infinity when they share no
 * comparable bin (so they won't be collapsed together).
 */
export function hammingSignature(sig, nBins, i, j) {
  const bi = i * nBins, bj = j * nBins;
  let diff = 0, comparable = 0;
  for (let k = 0; k < nBins; k++) {
    const a = sig[bi + k], b = sig[bj + k];
    if (a === TIER_MISSING || b === TIER_MISSING) continue;
    comparable++;
    if (a !== b) diff++;
  }
  return comparable === 0 ? Infinity : diff;
}

// Tier sum over a signature's comparable bins (for ordering groups by
// overall dosage, low → high).
function _tierSum(sig, nBins, i) {
  const base = i * nBins;
  let sum = 0, c = 0;
  for (let k = 0; k < nBins; k++) { const v = sig[base + k]; if (v !== TIER_MISSING) { sum += v; c++; } }
  return c > 0 ? sum / c : Infinity;
}

/**
 * Collapse similar samples into representative rows.
 *
 * @param {Object} canonical
 * @param {Object} [opts]
 *   hammingThreshold?: number  max differing bins to still collapse (default 0)
 *   maxReps?: number           representative rows kept per group (default 4)
 *   binSize?, smoothWindow?…    forwarded to the trajectory builder
 * @returns {{
 *   n_samples:number, n_groups:number, n_displayed:number, n_bins:number,
 *   groups: Array<{ id, medoid, size, members:Int32Array, reps:Int32Array, tierMean:number }>,
 *   order: Int32Array,            // representative sample indices, display order
 *   row_group: Int32Array,        // per displayed row → group id
 *   row_group_size: Int32Array,   // per displayed row → group size
 *   row_is_group_start: Uint8Array,
 *   row_is_medoid: Uint8Array,
 * } | null}
 */
export function collapseSimilar(canonical, opts) {
  const o = opts || {};
  const t = Number.isFinite(o.hammingThreshold) ? (o.hammingThreshold | 0) : 0;
  const maxReps = Number.isFinite(o.maxReps) && o.maxReps >= 1 ? (o.maxReps | 0) : 4;
  const sigPack = sampleTierSignatures(canonical, o);
  if (!sigPack) return null;
  const { sig, nS, nBins } = sigPack;
  if (nS <= 0) return null;

  // Greedy leader clustering: each sample joins the first leader within
  // the Hamming threshold, else starts a new group. Deterministic in
  // sample-index order.
  const leaders = [];            // group id → leader sample idx
  const groupOf = new Int32Array(nS).fill(-1);
  const members = [];            // group id → array of sample idx
  for (let s = 0; s < nS; s++) {
    let g = -1;
    for (let L = 0; L < leaders.length; L++) {
      if (hammingSignature(sig, nBins, s, leaders[L]) <= t) { g = L; break; }
    }
    if (g < 0) { g = leaders.length; leaders.push(s); members.push([]); }
    groupOf[s] = g;
    members[g].push(s);
  }

  // Per-group medoid (member with min total Hamming to the rest; the
  // leader stands in for large groups to bound cost) + nearest reps.
  const MEDOID_EXACT_CAP = 300;
  const groups = [];
  for (let g = 0; g < members.length; g++) {
    const ms = members[g];
    let medoid = leaders[g];
    if (ms.length > 1 && ms.length <= MEDOID_EXACT_CAP) {
      let best = ms[0], bestSum = Infinity;
      for (const a of ms) {
        let sum = 0;
        for (const b of ms) { if (a === b) continue; const d = hammingSignature(sig, nBins, a, b); sum += Number.isFinite(d) ? d : nBins; }
        if (sum < bestSum) { bestSum = sum; best = a; }
      }
      medoid = best;
    }
    const byDist = ms.slice().sort((a, b) => {
      const da = hammingSignature(sig, nBins, a, medoid);
      const db = hammingSignature(sig, nBins, b, medoid);
      const fa = Number.isFinite(da) ? da : nBins + 1;
      const fb = Number.isFinite(db) ? db : nBins + 1;
      return fa - fb || (a - b);
    });
    const reps = byDist.slice(0, maxReps);
    groups.push({
      id: g, medoid, size: ms.length,
      members: Int32Array.from(ms),
      reps: Int32Array.from(reps),
      tierMean: _tierSum(sig, nBins, medoid),
    });
  }

  // Display order: groups ascending by overall dosage tier (low → high),
  // medoid first within each group.
  groups.sort((a, b) => (a.tierMean - b.tierMean) || (a.id - b.id));

  let nDisp = 0;
  for (const grp of groups) nDisp += grp.reps.length;
  const order = new Int32Array(nDisp);
  const row_group = new Int32Array(nDisp);
  const row_group_size = new Int32Array(nDisp);
  const row_is_group_start = new Uint8Array(nDisp);
  const row_is_medoid = new Uint8Array(nDisp);
  let r = 0;
  for (const grp of groups) {
    for (let i = 0; i < grp.reps.length; i++) {
      const sIdx = grp.reps[i];
      order[r] = sIdx;
      row_group[r] = grp.id;
      row_group_size[r] = grp.size;
      row_is_group_start[r] = (i === 0) ? 1 : 0;
      row_is_medoid[r] = (sIdx === grp.medoid) ? 1 : 0;
      r++;
    }
  }

  return {
    n_samples: nS,
    n_groups: groups.length,
    n_displayed: nDisp,
    n_bins: nBins,
    groups,
    order, row_group, row_group_size, row_is_group_start, row_is_medoid,
  };
}
