// pages/discovery/local_pca_dosage/l2_sweep.js
//
// L2-sweep auto-promote pipeline (legacy lines 41749-42153).
// SPEC: specs_done/SPEC_l2_sweep_inheritance.md (authored 2026-05-15
//       from this file).
//
// When state.l2SweepEnabled is true and the user navigates to a new
// chromosome, local_pca_dosage.applyData() runs an inheritance-group clustering
// over EVERY usable L2 envelope (treating each L2 as a synthetic
// candidate with K-means labels) and auto-promotes the ones that
// clear five gates into state.candidateList. The promoted entries
// land with source='auto_l2_sweep' and confirmed=false so they show
// up in the review UI without participating in the inheritance pills
// until the user confirms them.
//
// Pipeline:
//   isUsableL2 filter (silhouette + populated-band count + cluster ok)
//     → synthetic items[] → inheritanceGroupClustering (shared/)
//     → cache on state.l2SweepResult + state.l2SweepCacheKey
//     → _autoPromoteFromSweep applies gates 1–6 (silhouette, group
//        count, band size, dedupe radius, dismissed-set, already-
//        covered) and calls addCandidateToList for survivors.
//
// All entry points take `state` as the first argument. Legacy used
// implicit `state` globals; those are gone.

import { silhouette1D } from '../../../shared/kmeans.js';
import { aggregateL2 } from '../../../shared/per_l2_cluster.js';
import { getL2Cluster } from './_data.js';
import { addCandidateToList } from './candidates.js';
import {
  inheritanceGroupClustering,
  IGC_MIN_BANDS_FOR_CLUSTERING,
} from '../../../shared/inheritance_groups.js';
import { inheritanceCacheKey } from './inheritance.js';

// =====================================================================
// Constants (legacy lines 41749-41755)
// =====================================================================

/** Gate 1: silhouette ≥ this. Below → SKIP(LOW_SILHOUETTE). */
export const AUTO_PROMOTE_MIN_SILHOUETTE = 0.30;

/** Gate 2: inheritance groups touching the L2 ≥ this. */
export const AUTO_PROMOTE_MIN_GROUPS     = 2;

/** Gate 3: smallest band size ≥ this. */
export const AUTO_PROMOTE_MIN_BAND_SIZE  = 5;

/** Gate 5: any existing candidate within this bp distance → SKIP(DEDUPE_TOO_CLOSE). */
export const AUTO_PROMOTE_DEDUPE_BP      = 100_000;

/** localStorage prefix for the per-chrom dismissed-L2 set. */
export const L2_SWEEP_DISMISSED_KEY_PFX  = 'pca_scrubber_v3.l2SweepDismissed.';

// =====================================================================
// Dismissed-set persistence (legacy lines 41763-41797)
// =====================================================================

/** Load the dismissed-L2 set for `chrom` from localStorage. Fail-soft → empty Set. */
export function loadL2SweepDismissed(chrom) {
  if (!chrom) return new Set();
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(L2_SWEEP_DISMISSED_KEY_PFX + chrom);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    const out = new Set();
    for (const v of arr) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0) out.add(n);
    }
    return out;
  } catch (_) {
    return new Set();
  }
}

export function saveL2SweepDismissed(chrom, set) {
  if (!chrom || !(set instanceof Set)) return;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(L2_SWEEP_DISMISSED_KEY_PFX + chrom, JSON.stringify(Array.from(set)));
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[l2sweep] dismissed-set persist failed:', e && e.message);
    }
  }
}

export function addL2SweepDismissed(chrom, l2idx) {
  if (!chrom || !Number.isInteger(l2idx)) return;
  const set = loadL2SweepDismissed(chrom);
  set.add(l2idx);
  saveL2SweepDismissed(chrom, set);
}

// =====================================================================
// Usability filter (legacy lines 41808-41841)
// =====================================================================

/**
 * Is this L2 envelope usable for the sweep? Checks env presence, bp
 * boundaries, cluster availability, and minimum-band-count.
 *
 * Returns { usable: bool, reason: string, env, cluster?, n_bands? }.
 */
export function isUsableL2(state, l2idx) {
  if (!state || !state.data || !Array.isArray(state.data.l2_envelopes)) {
    return { usable: false, reason: 'NO_DATA' };
  }
  const env = state.data.l2_envelopes[l2idx];
  if (!env) return { usable: false, reason: 'NO_ENV' };
  if (typeof env.start_bp !== 'number' || typeof env.end_bp !== 'number') {
    return { usable: false, reason: 'NO_BP', env };
  }
  let cluster;
  try {
    cluster = getL2Cluster(state, l2idx);
  } catch (e) {
    return { usable: false, reason: 'CLUSTER_THREW', env };
  }
  if (!cluster) return { usable: false, reason: 'NO_CLUSTER', env };
  if (cluster.ok === false) {
    return { usable: false, reason: cluster.reason || 'CLUSTER_NOT_OK', env, cluster };
  }
  if (!cluster.fixedKLabels || !cluster.fixedKLabels.length) {
    return { usable: false, reason: 'NO_FIXEDK_LABELS', env, cluster };
  }
  const populated = new Set();
  for (let i = 0; i < cluster.fixedKLabels.length; i++) {
    const lab = cluster.fixedKLabels[i];
    if (lab >= 0) populated.add(lab);
  }
  if (populated.size < IGC_MIN_BANDS_FOR_CLUSTERING) {
    return { usable: false, reason: 'TOO_FEW_BANDS', env, cluster, n_bands: populated.size };
  }
  return { usable: true, reason: 'OK', env, cluster, n_bands: populated.size };
}

// =====================================================================
// Silhouette on-demand (legacy lines 41848-41887)
// =====================================================================

/**
 * Compute a silhouette score for an L2's fixed-K labels. Uses the
 * cluster's pre-computed score if present, otherwise runs silhouette1D
 * over the L2's PC1 aggregation. Returns NaN on insufficient data.
 */
export function silhouetteForL2FixedK(state, l2idx, cluster) {
  if (!cluster || !cluster.fixedKLabels) return NaN;
  if (typeof cluster.silhouette === 'number' && isFinite(cluster.silhouette)) {
    return cluster.silhouette;
  }
  // Fixed-mode path: compute from aggregateL2 + fixedKLabels.
  let agg;
  try {
    agg = aggregateL2(state, l2idx);
  } catch (_) { return NaN; }
  if (!agg || !agg.xs || !agg.xs.length) return NaN;
  // K = max(label) + 1
  let K = 0;
  for (let i = 0; i < cluster.fixedKLabels.length; i++) {
    if (cluster.fixedKLabels[i] >= K) K = cluster.fixedKLabels[i] + 1;
  }
  if (K < 2) return NaN;
  // Filter out -1 labels (missing)
  const xs = Array.from(agg.xs);
  const xsKept = [], labsKept = [];
  for (let i = 0; i < cluster.fixedKLabels.length; i++) {
    const lab = cluster.fixedKLabels[i];
    if (lab >= 0 && lab < K && isFinite(xs[i])) {
      xsKept.push(xs[i]);
      labsKept.push(lab);
    }
  }
  if (xsKept.length < 4) return NaN;
  try {
    return silhouette1D(xsKept, labsKept, K);
  } catch (_) { return NaN; }
}

// =====================================================================
// Sweep orchestrator (legacy lines 41898-41991)
// =====================================================================

/**
 * Run inheritance-group clustering over every usable L2 envelope on the
 * active chromosome. Returns the augmented result (carrying items_meta
 * + per-L2 metadata for the auto-promote gates), or null when no
 * usable L2s exist. Mutates state.l2SweepResult + state.l2SweepCacheKey.
 *
 * @param {Object} state
 * @param {{force?: boolean, threshold?: number}} [opts]
 * @returns {Object|null}
 */
export function runL2SweepInheritance(state, opts) {
  if (!state) return null;
  if (!state.data || !Array.isArray(state.data.l2_envelopes) || !state.data.l2_envelopes.length) {
    state.l2SweepResult = null;
    state.l2SweepCacheKey = null;
    return null;
  }
  const force = !!(opts && opts.force);

  const items = [];
  const usableMeta = [];
  for (let l2idx = 0; l2idx < state.data.l2_envelopes.length; l2idx++) {
    const u = isUsableL2(state, l2idx);
    if (!u.usable) continue;
    items.push({
      id: 'L2:' + l2idx,
      labels: u.cluster.fixedKLabels,
      K: state.k || 3,
      start_bp: u.env.start_bp,
      end_bp: u.env.end_bp,
      meta: { source: 'l2_sweep', l2_idx: l2idx },
    });
    usableMeta.push({ l2idx, env: u.env, cluster: u.cluster, n_bands: u.n_bands });
  }
  // Sort items + parallel meta by start_bp
  const order = items.map((_, i) => i).sort((a, b) => items[a].start_bp - items[b].start_bp);
  const sortedItems = order.map(i => items[i]);
  const sortedMeta  = order.map(i => usableMeta[i]);
  for (let i = 0; i < sortedItems.length; i++) sortedItems[i].seq_num = i + 1;

  if (sortedItems.length < IGC_MIN_BANDS_FOR_CLUSTERING) {
    state.l2SweepResult = null;
    state.l2SweepCacheKey = null;
    return null;
  }

  // Cache key: prefix with chrom + 'sweep::' to distinguish from the
  // candidate-based inheritance compute's cache.
  const mode = state.activeMode || 'default';
  const cacheKey = 'sweep::' + (state.data.chrom || '?') + '::'
                 + inheritanceCacheKey(sortedItems, mode);

  if (!force && state.l2SweepCacheKey === cacheKey && state.l2SweepResult) {
    return state.l2SweepResult;
  }

  let result = null;
  try {
    result = inheritanceGroupClustering(sortedItems, opts);
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[l2sweep] inheritance compute threw:', e && e.message);
    }
    return null;
  }
  if (!result) {
    state.l2SweepResult = null;
    state.l2SweepCacheKey = cacheKey;
    return null;
  }

  result.items_meta = sortedItems.map(it => ({
    id: it.id, K: it.K, seq_num: it.seq_num,
    start_bp: it.start_bp, end_bp: it.end_bp,
  }));
  result.l2_meta = sortedMeta.map((m, i) => ({
    l2idx: m.l2idx,
    item_idx: i,
    item_id: sortedItems[i].id,
    seq_num: sortedItems[i].seq_num,
    start_bp: m.env.start_bp,
    end_bp: m.env.end_bp,
    n_bands: m.n_bands,
    n_per_group: Array.isArray(m.cluster.n_per_group)
                  ? m.cluster.n_per_group.slice() : null,
    silhouette: silhouetteForL2FixedK(state, m.l2idx, m.cluster),
  }));

  state.l2SweepResult = result;
  state.l2SweepCacheKey = cacheKey;
  return result;
}

export function invalidateL2SweepCache(state) {
  if (!state) return;
  state.l2SweepResult = null;
  state.l2SweepCacheKey = null;
}

// =====================================================================
// Auto-promote (legacy lines 42011-42153)
// =====================================================================

/**
 * Apply the auto-promote gates to a sweep result and add survivors to
 * state.candidateList via addCandidateToList. Returns
 * { promoted: number[], skipped: Array<{l2idx, reason, …}> } so the
 * caller can surface promotion stats in the UI.
 *
 * Gates (in order, first failure stops further evaluation for that L2):
 *   1. DISMISSED            user-dismissed via the inspector
 *   2. ALREADY_IN_CANDIDATE another candidate's l2_indices includes this L2
 *   3. LOW_SILHOUETTE       silhouette < AUTO_PROMOTE_MIN_SILHOUETTE
 *   4. SMALL_BAND           min(n_per_group) < AUTO_PROMOTE_MIN_BAND_SIZE
 *   5. TOO_FEW_GROUPS       inheritance groups touching < AUTO_PROMOTE_MIN_GROUPS
 *   6. DEDUPE_TOO_CLOSE     bp distance to ANY existing candidate < AUTO_PROMOTE_DEDUPE_BP
 *
 * @param {Object} state
 * @param {Object} result   sweep result from runL2SweepInheritance
 * @returns {{promoted: number[], skipped: Array}}
 */
export function autoPromoteFromSweep(state, result) {
  if (!state) return { promoted: [], skipped: [] };
  if (!result || !Array.isArray(result.l2_meta) || !result.l2_meta.length) {
    return { promoted: [], skipped: [] };
  }
  const chrom = state.data && state.data.chrom ? state.data.chrom : null;
  const dismissed = loadL2SweepDismissed(chrom);

  // Gate 2 prep: build the coveredL2 set
  const existingCands = Array.isArray(state.candidateList) ? state.candidateList : [];
  const coveredL2Set = new Set();
  for (const c of existingCands) {
    if (!c || !Array.isArray(c.l2_indices)) continue;
    for (const li of c.l2_indices) {
      if (Number.isInteger(li)) coveredL2Set.add(li);
    }
  }

  // Gate 5 prep: groups touching each item_idx
  const itemsLen = result.items_meta ? result.items_meta.length : 0;
  const groupsTouchingItem = new Array(itemsLen).fill(null).map(() => new Set());
  if (Array.isArray(result.groups)) {
    for (let g = 0; g < result.groups.length; g++) {
      const grp = result.groups[g];
      if (!grp) continue;
      const members = Array.isArray(grp.members) ? grp.members
                    : Array.isArray(grp.cells)   ? grp.cells
                    : [];
      for (const m of members) {
        const ii = (m && typeof m === 'object')
                    ? (Number.isInteger(m.item_idx) ? m.item_idx
                       : Number.isInteger(m.itemIdx) ? m.itemIdx : -1)
                    : -1;
        if (ii >= 0 && ii < groupsTouchingItem.length) {
          groupsTouchingItem[ii].add(g);
        }
      }
    }
  }
  // Newer shape: result.rtab.group_ids + per_group keyed by group → items
  if (groupsTouchingItem.every(s => s.size === 0) && result.rtab && result.rtab.per_group) {
    for (const gid of result.rtab.group_ids || []) {
      const perItem = result.rtab.per_group[gid] || {};
      for (const ii of Object.keys(perItem)) {
        const n = +ii;
        if (n >= 0 && n < groupsTouchingItem.length) {
          groupsTouchingItem[n].add(gid);
        }
      }
    }
  }

  const promoted = [];
  const skipped = [];

  for (const meta of result.l2_meta) {
    const l2idx = meta.l2idx;

    if (dismissed.has(l2idx)) {
      skipped.push({ l2idx, reason: 'DISMISSED' });
      continue;
    }
    if (coveredL2Set.has(l2idx)) {
      skipped.push({ l2idx, reason: 'ALREADY_IN_CANDIDATE' });
      continue;
    }
    if (!isFinite(meta.silhouette) || meta.silhouette < AUTO_PROMOTE_MIN_SILHOUETTE) {
      skipped.push({ l2idx, reason: 'LOW_SILHOUETTE', silhouette: meta.silhouette });
      continue;
    }
    if (Array.isArray(meta.n_per_group)) {
      const minBand = meta.n_per_group.reduce((a, b) => Math.min(a, b), Infinity);
      if (minBand < AUTO_PROMOTE_MIN_BAND_SIZE) {
        skipped.push({ l2idx, reason: 'SMALL_BAND', min_band: minBand });
        continue;
      }
    }
    const grpCount = groupsTouchingItem[meta.item_idx]
                      ? groupsTouchingItem[meta.item_idx].size : 0;
    if (grpCount < AUTO_PROMOTE_MIN_GROUPS) {
      skipped.push({ l2idx, reason: 'TOO_FEW_GROUPS', groups: grpCount });
      continue;
    }
    // Gate 6: dedupe radius
    let tooClose = false;
    for (const c of existingCands) {
      if (!c || typeof c.start_bp !== 'number' || typeof c.end_bp !== 'number') continue;
      const d = Math.max(0, Math.max(meta.start_bp, c.start_bp) - Math.min(meta.end_bp, c.end_bp));
      if (d < AUTO_PROMOTE_DEDUPE_BP) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) {
      skipped.push({ l2idx, reason: 'DEDUPE_TOO_CLOSE' });
      continue;
    }

    // All gates passed — construct + add the auto candidate. The whole
    // build is inside a try/catch because the locked_labels lookup
    // (getL2Cluster) can throw on stale envelopes, and addCandidateToList
    // may reject duplicates. Either way: skip with ADD_THREW.
    try {
      const env = state.data.l2_envelopes[l2idx];
      if (!env) throw new Error('no envelope at l2idx ' + l2idx);
      const cluster = getL2Cluster(state, l2idx);
      const cand = {
        id: 'auto_l2sweep_' + (state.data.chrom || 'chrom') + '_' + l2idx
            + '_' + Date.now(),
        source: 'auto_l2_sweep',
        chrom: state.data.chrom || null,
        l2_indices: [l2idx],
        ref_l2: l2idx,
        ref_window: env._s0 != null ? env._s0 : null,
        K: state.k || 3,
        locked_labels: cluster && cluster.fixedKLabels ? cluster.fixedKLabels : null,
        start_w: env._s0 != null ? env._s0 : null,
        end_w:   env._e0 != null ? env._e0 : null,
        start_bp: env.start_bp,
        end_bp:   env.end_bp,
        created_at: new Date().toISOString(),
        auto_promoted_at: new Date().toISOString(),
        notes: '',
        confirmed: false,
      };
      addCandidateToList(state, cand);
      promoted.push(l2idx);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[l2sweep] auto-promote add failed for L2 ' + l2idx + ':',
                     e && e.message);
      }
      skipped.push({ l2idx, reason: 'ADD_THREW' });
    }
  }

  return { promoted, skipped };
}
