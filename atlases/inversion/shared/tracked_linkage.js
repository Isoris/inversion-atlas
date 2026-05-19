// shared/tracked_linkage.js
//
// "Tracked linkage projection" (legacy lines 46711-46860). Given a set
// of tracked fish indices, for each active candidate compute:
//   - per-band counts of those fish (band → integer)
//   - dominant band + purity (dominant_count / n_tracked)
//   - optional inheritance-group lookup (when an inheritance result
//     is supplied)
//
// The projection drives the PC1-panel background shading on local_pca_dosage: a
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

// =====================================================================
// Canvas drawer
// =====================================================================

function _hexToRgb(hex) {
  if (typeof hex !== 'string' || hex.length !== 7 || hex[0] !== '#') {
    return [122, 131, 152];  // neutral grey fallback
  }
  return [
    parseInt(hex.slice(1, 3), 16) || 0,
    parseInt(hex.slice(3, 5), 16) || 0,
    parseInt(hex.slice(5, 7), 16) || 0,
  ];
}

/**
 * Draw the tracked-linkage shading strip behind PC1 trajectories.
 * One translucent rectangle per candidate whose purity ≥ floor,
 * colored by inheritance group (alpha = purity² × 0.45). Adds a
 * compact label "I<seq>·b<band> · <purity%>" when the rectangle is
 * wide enough (≥ 36px) AND purity ≥ 0.5.
 *
 * Pure given the projection + canvas context. Caller pre-computes
 * the projection via computeTrackedLinkageProjection.
 *
 * Headless-tolerant: returns silently when ctx is not a CanvasRenderingContext.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {Object} projection   from computeTrackedLinkageProjection
 * @param {{purityFloor?:number}} opts
 */
export function drawTrackedLinkageStrip(ctx, pad, plotW, plotH, mbMin, mbMax, projection, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!projection || !Array.isArray(projection.per_candidate)
      || projection.per_candidate.length === 0) return;
  const floor = (opts && Number.isFinite(opts.purityFloor)) ? opts.purityFloor : TLP_PURITY_FLOOR;

  if (typeof ctx.save === 'function') ctx.save();
  for (const rec of projection.per_candidate) {
    if (!rec || rec.purity < floor) continue;
    if (!Number.isFinite(rec.start_bp) || !Number.isFinite(rec.end_bp)) continue;
    const mbLo = rec.start_bp / 1e6;
    const mbHi = rec.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    const w = xHi - xLo;
    if (w < 1) continue;
    const alpha = rec.purity * rec.purity * 0.45;
    const [r, g, b] = _hexToRgb(rec.inh_group_color || '#7a8398');
    ctx.fillStyle = 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha.toFixed(3) + ')';
    ctx.fillRect(xLo, pad.t, w, plotH);
    if (w >= 36 && rec.purity >= 0.5) {
      if (typeof ctx.fillText === 'function') {
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(' + r + ', ' + g + ', ' + b + ', 0.95)';
        const label = 'I' + rec.seq_num + '·b' + rec.dominant_band
          + ' · ' + (rec.purity * 100).toFixed(0) + '%';
        ctx.fillText(label, (xLo + xHi) / 2, pad.t + plotH - 2);
      }
    }
  }
  if (typeof ctx.restore === 'function') ctx.restore();
}

// =====================================================================
// Per-candidate inheritance-group lookup
// =====================================================================

/**
 * Map a single candidate's bands → inheritance group_ids, using the
 * inheritance result's `band_index` + `cut.group_id_per_band` arrays.
 * Returns `{ [band_idx]: group_id }`.
 *
 * Empty object when:
 *   - candidate is null / has no id
 *   - inheritance result is null / lacks items_meta+rtab
 *   - candidate's id is not in items_meta
 *   - band_index / cut is missing
 *
 * Pure: caller passes inh explicitly (legacy reads state.inheritanceResult).
 *
 * @param {Object?} cand
 * @param {Object?} inh   inheritance result with shape:
 *   { items_meta: [{id}], rtab?, band_index: [{item_idx, band}],
 *     cut: { group_id_per_band: ArrayLike<number> } }
 * @returns {Object<number, number>}
 */
export function inheritanceSuggestionsForCandidate(cand, inh) {
  if (!cand) return {};
  if (!inh || !Array.isArray(inh.items_meta) || !inh.rtab) return {};
  const candId = String(cand.id);
  const itemIdx = inh.items_meta.findIndex(m => m && String(m.id) === candId);
  if (itemIdx < 0) return {};
  const out = {};
  if (inh.band_index && inh.cut && inh.cut.group_id_per_band) {
    const bi = inh.band_index;
    const gpb = inh.cut.group_id_per_band;
    for (let n = 0; n < bi.length; n++) {
      const row = bi[n];
      if (row && row.item_idx === itemIdx) {
        out[row.band] = gpb[n];
      }
    }
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
