// atlases/inversion/shared/inheritance_groups.js
//
// Inheritance-group clustering (legacy lines 38785-39049). Groups bands
// across multiple candidates by the *fish sets they contain*: two bands
// belong to the same inheritance group iff their fish memberships
// overlap above a Jaccard threshold.
//
// Pipeline:
//   items (each with K-means labels[]) → per-band fish masks
//     → pairwise Jaccard distance matrix
//     → average-linkage agglomeration + cut at threshold
//     → inheritance-group assignment per band
//
// Pure compute, no state. Consumed by local_pca_dosage's inheritance-labels strip
// (the "I1·3g" annotations on the lines panel) and by candidate_focus's
// inheritance-group rendering.

import { agglomerativeAverageLinkage, cutDendrogram } from './clustering.js';

// =====================================================================
// Constants (legacy lines 38785-38786)
// =====================================================================

/** Jaccard-distance cut: bands within (1 - this) similarity merge. */
export const IGC_DEFAULT_DIST_THRESHOLD = 0.15;

/** Need at least this many bands across all candidates before clustering. */
export const IGC_MIN_BANDS_FOR_CLUSTERING = 2;

// =====================================================================
// Per-band fish-membership mask (legacy 38817-38828)
// =====================================================================

/**
 * Build a Uint8Array mask flagging samples whose label in items[item_idx]
 * is equal to `band`. Returns null when inputs are out of range.
 * The returned mask has `._count` attached as a convenience.
 */
export function buildBandFishMask(items, K_per_item, item_idx, band) {
  const a = items[item_idx];
  if (!a || !a.labels || band < 0 || band >= K_per_item[item_idx]) return null;
  const n = a.labels.length;
  const mask = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (a.labels[i] === band) { mask[i] = 1; count++; }
  }
  mask._count = count;
  return mask;
}

// =====================================================================
// Jaccard distance between two binary masks (legacy 38842-38852)
// =====================================================================

/**
 * Jaccard distance: 1 - |A ∩ B| / |A ∪ B|. Returns NaN on shape mismatch.
 * When both masks are empty (union = 0), returns 1 (maximally distant by
 * convention — no positive evidence for similarity).
 */
export function jaccardDistance(maskA, maskB) {
  if (!maskA || !maskB || maskA.length !== maskB.length) return NaN;
  let inter = 0, uni = 0;
  for (let i = 0; i < maskA.length; i++) {
    const a = maskA[i], b = maskB[i];
    if (a && b) inter++;
    if (a || b) uni++;
  }
  if (uni === 0) return 1;
  return 1 - inter / uni;
}

// =====================================================================
// Inheritance-group clustering (legacy 38972-39049)
// =====================================================================

/**
 * Cluster bands across N candidates by fish-membership similarity.
 *
 * Each item must carry:
 *   - `id`     (string-coercible identifier; missing → '_<i>')
 *   - `K`      (number of bands; required, > 0)
 *   - `labels` (per-sample band labels; integers in [0, K), -1 for unassigned)
 *
 * @param {Array<{id?:any, K:number, labels:ArrayLike<number>}>} items
 * @param {{threshold?: number}} [opts]
 * @returns {Object|null}  Returns null when items.length < 2 or when the
 *                         total band count is < IGC_MIN_BANDS_FOR_CLUSTERING.
 */
export function inheritanceGroupClustering(items, opts) {
  if (!Array.isArray(items) || items.length < 2) return null;
  const threshold = (opts && opts.threshold != null)
    ? +opts.threshold : IGC_DEFAULT_DIST_THRESHOLD;

  const n_items = items.length;
  const ids = items.map((it, i) => (it && it.id != null) ? String(it.id) : `_${i}`);
  const K_per_item = items.map(it => (it && it.K > 0) ? it.K : 0);

  // Build the band index: enumerate all (item, band) pairs
  const band_index = [];
  for (let i = 0; i < n_items; i++) {
    for (let b = 0; b < K_per_item[i]; b++) {
      band_index.push({ item_idx: i, band: b, item_id: ids[i] });
    }
  }
  const N = band_index.length;
  if (N < IGC_MIN_BANDS_FOR_CLUSTERING) return null;

  // Fish-membership masks (one Uint8Array per band, length n_samples)
  const fish_masks = new Array(N);
  for (let n = 0; n < N; n++) {
    const { item_idx, band } = band_index[n];
    fish_masks[n] = buildBandFishMask(items, K_per_item, item_idx, band);
  }

  // Distance matrix (Jaccard distance over fish masks)
  const distance_matrix = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = jaccardDistance(fish_masks[i], fish_masks[j]);
      const dv = isFinite(d) ? d : 1;
      distance_matrix[i * N + j] = dv;
      distance_matrix[j * N + i] = dv;
    }
  }

  const dendrogram = agglomerativeAverageLinkage(distance_matrix, N);
  const cut = cutDendrogram(dendrogram, N, threshold);

  // Rtab map: group_id → { item_idx → band[] }
  const per_group = {};
  const group_ids_set = new Set();
  for (let n = 0; n < N; n++) {
    const g = cut.group_id_per_band[n];
    group_ids_set.add(g);
    const { item_idx, band } = band_index[n];
    if (!per_group[g]) per_group[g] = {};
    if (!per_group[g][item_idx]) per_group[g][item_idx] = [];
    per_group[g][item_idx].push(band);
  }
  const group_ids = Array.from(group_ids_set).sort((a, b) => a - b);

  // Per-item n_groups: how many distinct inheritance groups touch this candidate
  const per_item_n_groups = new Array(n_items).fill(0);
  for (const gid of group_ids) {
    const itemIdxList = Object.keys(per_group[gid]);
    for (const ii of itemIdxList) per_item_n_groups[+ii]++;
  }

  return {
    n_items, ids, K_per_item, n_bands_total: N,
    band_index,
    fish_masks,
    distance_matrix,
    dendrogram,
    cut,
    rtab: {
      group_ids,
      per_group,
      per_item_n_groups,
    },
  };
}

// =====================================================================
// Legacy window.* aliases (browser-console debug)
// =====================================================================
if (typeof window !== 'undefined') {
  window.inheritanceGroupClustering = inheritanceGroupClustering;
  window._buildBandFishMask         = buildBandFishMask;
  window._jaccardDistance           = jaccardDistance;
}
