// shared/lineage_clustering.js
//
// Lineage clustering (legacy lines 39260-39296 _lineageClustering +
// _lineageCacheKey). Given a per-sample concordance matrix across L2
// envelopes, cuts samples into "lineages" via agglomerative average-
// linkage clustering at a fixed (1 - concordance) distance threshold.
//
// The lineage strip drawn on local_pca_dosage reads
// `state.lineageResult.lineage_id_per_sample[si]` to color each fish
// trajectory. This module produces that result without any state-globals.

import { agglomerativeAverageLinkage, cutDendrogram } from '../../inversion/shared/clustering.js';

/** Default (1 - concordance) distance cut threshold. */
export const LINEAGE_DEFAULT_THRESHOLD = 0.50;

/** Hungarian-chain agreement minimum for chain-break detection. */
export const LINEAGE_CHAIN_BREAK_AGREEMENT = 0.50;

/** Need at least this many L2 envelopes to attempt lineage compute. */
export const LINEAGE_MIN_L2_FOR_COMPUTE = 3;

/** Smallest accepted lineage size (no merging below this). */
export const LINEAGE_MIN_FISH_PER_LINEAGE = 1;

/**
 * Cluster samples into lineages from a per-sample concordance matrix.
 * Distance = 1 - concordance; diagonal is 0. Returns:
 *
 *   {
 *     threshold,
 *     dendrogram,
 *     lineage_id_per_sample,    // Int8/Int32Array, group id per sample
 *     n_lineages,                // number of distinct groups
 *   }
 *
 * @param {ArrayLike<number>} concordanceMatrix  flat row-major N×N
 * @param {number} n_samples
 * @param {number?} threshold  defaults to LINEAGE_DEFAULT_THRESHOLD
 * @returns {Object}
 */
export function lineageClustering(concordanceMatrix, n_samples, threshold) {
  const thr = (typeof threshold === 'number') ? threshold : LINEAGE_DEFAULT_THRESHOLD;
  const distMatrix = new Float32Array(n_samples * n_samples);
  for (let i = 0; i < n_samples; i++) {
    for (let j = 0; j < n_samples; j++) {
      distMatrix[i * n_samples + j] = (i === j)
        ? 0
        : (1 - concordanceMatrix[i * n_samples + j]);
    }
  }
  const dendrogram = agglomerativeAverageLinkage(distMatrix, n_samples);
  const cut = cutDendrogram(dendrogram, n_samples, thr);
  return {
    threshold: thr,
    dendrogram,
    lineage_id_per_sample: cut.group_id_per_band,
    n_lineages: cut.n_groups,
  };
}

// =====================================================================
// Per-sample lineage color
// =====================================================================

/**
 * Resolve a CSS color string for the given lineage id. Uses the same
 * golden-angle palette as the legacy `_lineageColor` so the strip
 * drawer + per-sample line colors stay visually consistent.
 *
 *   hue = (baseHue + lineageId × goldenAngle) mod 360
 *
 * Returns a neutral grey rgba() for lineage ids < 0 (NA).
 *
 * @param {number} lineageId
 * @returns {string}
 */
export function lineageColor(lineageId) {
  if (!Number.isFinite(lineageId) || lineageId < 0) return 'rgba(120, 128, 140, 0.55)';
  const baseHue = 210;
  const goldenAngle = 137.508;
  const hue = (baseHue + lineageId * goldenAngle) % 360;
  return 'hsl(' + hue.toFixed(1) + ', 70%, 55%)';
}

// =====================================================================
// Lineage strip drawer
// =====================================================================

/**
 * Draw the lineage strip on local_pca_dosage's PC1 panel. Renders one colored
 * bar per L2 envelope (by the dominant lineage among samples in the
 * L2's largest band) over a faint backdrop. L2s flagged as
 * "chain-break" by the Hungarian projection get a diagonal-hatch
 * cue and no color.
 *
 * Pure given the lineage result + envelopes + getCluster callback.
 * Headless-tolerant.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH         (unused; kept for sibling-drawer symmetry)
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {{lineage_id_per_sample:ArrayLike<number>, chains?:Array<{l2_indices:Array<number>}>}} lineageResult
 * @param {Array<{start_bp:number, end_bp:number}>} envelopes
 * @param {Function} getCluster   (l2idx) → { fixedKLabels, K? } or null
 * @param {{stripHeight?:number, stripOffset?:number, defaultK?:number}} opts
 */
export function drawLineageStrip(ctx, pad, plotW, plotH, mbMin, mbMax, lineageResult, envelopes, getCluster, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!lineageResult || !lineageResult.lineage_id_per_sample) return;
  if (!Array.isArray(envelopes) || envelopes.length === 0) return;
  if (typeof getCluster !== 'function') return;

  const o = opts || {};
  const stripH = Number.isFinite(o.stripHeight) ? o.stripHeight : 5;
  const offset = Number.isFinite(o.stripOffset) ? o.stripOffset : 13;
  const stripY = Math.max(0, pad.t - offset);
  const defaultK = Number.isFinite(o.defaultK) ? o.defaultK : 3;
  const lineageOf = lineageResult.lineage_id_per_sample;

  if (typeof ctx.save === 'function') ctx.save();

  ctx.fillStyle = 'rgba(40, 50, 70, 0.14)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  const inChain = new Set();
  if (Array.isArray(lineageResult.chains)) {
    for (const ch of lineageResult.chains) {
      if (ch && Array.isArray(ch.l2_indices)) {
        for (const idx of ch.l2_indices) inChain.add(idx);
      }
    }
  }

  for (let l2idx = 0; l2idx < envelopes.length; l2idx++) {
    const env = envelopes[l2idx];
    if (!env || !Number.isFinite(env.start_bp) || !Number.isFinite(env.end_bp)) continue;
    const mbLo = env.start_bp / 1e6;
    const mbHi = env.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    if (xHi - xLo < 1) continue;

    if (!inChain.has(l2idx)) {
      // Chain-break L2: muted grey overlay
      ctx.fillStyle = 'rgba(120, 128, 140, 0.18)';
      ctx.fillRect(xLo, stripY, xHi - xLo, stripH);
      continue;
    }

    const cl = getCluster(l2idx);
    if (!cl || !cl.fixedKLabels) continue;
    const labels = cl.fixedKLabels;
    const K = Number.isFinite(cl.K) ? cl.K : defaultK;

    // Find the dominant lineage in the largest band
    const bandCounts = new Int32Array(K);
    for (let s = 0; s < labels.length; s++) {
      const lb = labels[s];
      if (lb >= 0 && lb < K) bandCounts[lb]++;
    }
    let bigBand = 0, bigCount = -1;
    for (let k = 0; k < K; k++) {
      if (bandCounts[k] > bigCount) { bigCount = bandCounts[k]; bigBand = k; }
    }

    const lineageCounts = {};
    for (let s = 0; s < labels.length; s++) {
      if (labels[s] !== bigBand) continue;
      const lid = lineageOf[s];
      if (lid == null || lid < 0) continue;
      lineageCounts[lid] = (lineageCounts[lid] || 0) + 1;
    }
    let domLineage = -1, domCount = -1;
    for (const k of Object.keys(lineageCounts)) {
      if (lineageCounts[k] > domCount) { domCount = lineageCounts[k]; domLineage = +k; }
    }
    if (domLineage < 0) continue;

    ctx.fillStyle = lineageColor(domLineage);
    ctx.fillRect(xLo, stripY, xHi - xLo, stripH);
  }

  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeStyle = 'rgba(120, 128, 140, 0.40)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(pad.l, stripY, plotW, stripH);
  }

  if (typeof ctx.restore === 'function') ctx.restore();
}

/**
 * Cache key for lineage compute. Captures the inputs that, when
 * changed, must invalidate the cached result:
 *   - chrom (cross-chrom switches)
 *   - mode ('default' | 'detailed')
 *   - K (K=3 ↔ K=6 switches)
 *   - threshold
 *   - L2 set (length + endpoints — full content hash would be heavy)
 *
 * Returns a "::"-joined fingerprint string.
 *
 * @param {ArrayLike<number>} l2_indices
 * @param {number} K
 * @param {number} threshold
 * @param {string?} mode
 * @param {string?} chrom
 * @returns {string}
 */
export function lineageCacheKey(l2_indices, K, threshold, mode, chrom) {
  const arr = Array.isArray(l2_indices) || ArrayBuffer.isView(l2_indices)
    ? l2_indices : [];
  const n = arr.length;
  const first = n > 0 ? (arr[0] || 0) : 0;
  const last  = n > 0 ? (arr[n - 1] || 0) : 0;
  return [
    chrom || '_',
    mode || 'default',
    K,
    threshold,
    n,
    first,
    last,
  ].join('::');
}
