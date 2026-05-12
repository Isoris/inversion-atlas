// shared/tracked_linkage.js
//
// "Tracked linkage projection" (legacy lines 46711-46860). Given a set
// of tracked fish indices, for each active candidate compute:
//   - per-band counts of those fish (band → integer)
//   - dominant band + purity (dominant_count / n_tracked)
//   - optional inheritance-group lookup (when an inheritance result
//     is supplied)
//
// The projection drives the PC1-panel background shading on page1: a
// shaded interval per candidate, colored by inheritance group, opacity
// scaled by purity.
//
// All compute is pure: caller passes the candidate set + (optionally)
// the inheritance result explicitly. The legacy stale-cache logic +
// requestIdleCallback recompute lives in the caller.

/** Skip shading below this purity. */
export const TLP_PURITY_FLOOR = 0.30;
/** Need at least this many tracked fish. */
export const TLP_MIN_FISH = 3;
/** Band must have ≥ this many lassoed fish to count. */
export const TLP_MIN_FISH_IN_BAND = 1;

/** Default inheritance-group color palette (matches legacy). */
export const TLP_INH_GROUP_COLORS = Object.freeze([
  '#4fa3ff', '#f5a524', '#3cc08a', '#e0555c', '#b07cf7',
  '#5fc8d8', '#d97f5c', '#88c45e', '#ce5fb5', '#7c8fff',
]);

/**
 * Resolve a color hex for an inheritance group id. Negative / null
 * → neutral grey.
 */
export function tlpInhGroupColor(groupId) {
  if (groupId == null || groupId < 0) return '#7a8398';
  return TLP_INH_GROUP_COLORS[groupId % TLP_INH_GROUP_COLORS.length];
}

/**
 * Per-candidate dominance projection across a tracked-fish set.
 *
 * @param {ArrayLike<number>} fishIdx
 *    sample indices to project (state.tracked in the legacy build)
 * @param {Array<{id, K, labels:ArrayLike<number>, seq_num?, start_bp?, end_bp?}>} items
 *    candidate set (typically _gatherActiveCandidatesForInheritance)
 * @param {Object?} inh
 *    optional inheritance result with shape:
 *      { items_meta: [{ id }], band_index: [{ item_idx, band }],
 *        cut: { group_id_per_band: ArrayLike<number> } }
 * @param {{purityFloor?:number, minFish?:number}} opts
 * @returns {{n_total:number, per_candidate:Array<Object>}}
 */
export function computeTrackedLinkageProjection(fishIdx, items, inh, opts) {
  const o = opts || {};
  const minFish = Number.isFinite(o.minFish) ? o.minFish : TLP_MIN_FISH;

  if (!Array.isArray(fishIdx) && !ArrayBuffer.isView(fishIdx)) fishIdx = [];
  const nTotal = fishIdx.length;
  const out = { n_total: nTotal, per_candidate: [] };
  if (nTotal < minFish) return out;
  if (!Array.isArray(items) || items.length === 0) return out;

  // Build the (id → inh-item-idx) + (item_idx:band → group_id) lookups
  // when an inheritance result is supplied.
  const inhItemIdx = new Map();
  if (inh && Array.isArray(inh.items_meta)) {
    for (let i = 0; i < inh.items_meta.length; i++) {
      const meta = inh.items_meta[i];
      if (meta && meta.id != null) inhItemIdx.set(String(meta.id), i);
    }
  }
  const bandToGroup = new Map();
  if (inh && inh.band_index && inh.cut && inh.cut.group_id_per_band) {
    const bi = inh.band_index;
    const gpb = inh.cut.group_id_per_band;
    for (let n = 0; n < bi.length; n++) {
      const row = bi[n];
      if (!row) continue;
      bandToGroup.set(row.item_idx + ':' + row.band, gpb[n]);
    }
  }

  for (const it of items) {
    if (!it) continue;
    const labels = it.labels;
    const K = it.K;
    if (!labels || !Number.isFinite(K) || K <= 0) continue;
    const counts = new Array(K).fill(0);
    let hits = 0;
    for (let i = 0; i < fishIdx.length; i++) {
      const fi = fishIdx[i];
      const k = labels[fi];
      if (k >= 0 && k < K) { counts[k]++; hits++; }
    }
    if (hits === 0) continue;
    let domBand = 0, domCount = counts[0];
    for (let k = 1; k < K; k++) {
      if (counts[k] > domCount) { domBand = k; domCount = counts[k]; }
    }
    const purity = domCount / nTotal;
    const itemIdx = inhItemIdx.get(String(it.id));
    let inhGroupId = null;
    if (itemIdx != null) {
      const gid = bandToGroup.get(itemIdx + ':' + domBand);
      if (gid != null) inhGroupId = gid;
    }
    out.per_candidate.push({
      candidate_id: String(it.id),
      seq_num: it.seq_num,
      start_bp: it.start_bp,
      end_bp:   it.end_bp,
      K,
      dominant_band: domBand,
      dominant_count: domCount,
      purity,
      per_band_counts: counts,
      inh_group_id: inhGroupId,
      inh_group_color: tlpInhGroupColor(inhGroupId),
    });
  }
  return out;
}

/**
 * Filter the projection to candidates whose purity ≥ floor (for the
 * PC1-panel shading layer that the legacy uses). Pure: returns a new
 * array.
 *
 * @param {Object} projection  output of computeTrackedLinkageProjection
 * @param {number?} purityFloor  defaults to TLP_PURITY_FLOOR
 * @returns {Array<Object>}
 */
export function filterByPurityFloor(projection, purityFloor) {
  const floor = Number.isFinite(purityFloor) ? purityFloor : TLP_PURITY_FLOOR;
  if (!projection || !Array.isArray(projection.per_candidate)) return [];
  return projection.per_candidate.filter(r => r && r.purity >= floor);
}
