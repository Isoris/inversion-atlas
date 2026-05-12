// shared/ghsl_panel.js
//
// Pure accessors for the per-chrom `ghsl_panel` + `ghsl_kstripes`
// layers. The GHSL (Genome-wide Haplotype-pair Sequence Likeness)
// panel is a per-(sample, window, scale) rolling-divergence cube;
// the K-stripes layer is the per-K K-means partition over that cube.
//
// Used by:
//   - L2-as-triangle aggregation in the L3 zone (page1)
//   - GHSL evidence panel (page15)
//   - cross-page agreement checks against dosage / θπ
//
// state.data.ghsl_panel shape:
//   {
//     n_samples, n_windows, samples[],
//     window_idx[],                // 1-based panel-window indices
//     scales: ['s10k', 's25k', 's100k', ...],
//     primary_scale: 's25k',
//     div_roll: {
//       <scale>: Float32Array[n_samples][n_windows]   // matrices
//     },
//   }
//
// state.data.ghsl_kstripes shape:
//   {
//     by_k: {
//       '3': { stripe_per_sample[], stripe_means[], stripe_medians[],
//              n_per_stripe[] },
//       ...
//     }
//   }
//
// Legacy origin: lines 52683-52832 of legacy/Inversion_atlas.html.

// =====================================================================
// Constants
// =====================================================================

/** Default half-flank window count (focal ± 5 windows = 11 total). */
export const GHSL_DEFAULT_HALF_FLANK = 5;

// =====================================================================
// Layer accessors
// =====================================================================

export function ghslPanel(state) {
  return (state && state.data && state.data.ghsl_panel) || null;
}

export function ghslPanelScales(state) {
  const p = ghslPanel(state);
  return p ? (p.scales || []) : [];
}

export function ghslPanelPrimaryScale(state) {
  const p = ghslPanel(state);
  if (!p) return null;
  return p.primary_scale || (p.scales && p.scales[0]) || null;
}

// =====================================================================
// Cell-level lookup
// =====================================================================

/**
 * Rolling divergence at (sample_idx, panel_window_idx, scale). All
 * indices are panel-local (0-based for sample_idx, 0-based for the
 * window column). Returns null when the panel isn't loaded, the
 * scale isn't in div_roll, or any index is out of range.
 *
 * @param {Object} state
 * @param {number} sampleIdx
 * @param {number} panelWindowIdx
 * @param {string} [scale]   defaults to primary_scale
 * @returns {number|null}
 */
export function ghslDivAt(state, sampleIdx, panelWindowIdx, scale) {
  const p = ghslPanel(state);
  if (!p || !p.div_roll) return null;
  const s = scale || p.primary_scale;
  const M = p.div_roll[s];
  if (!M || sampleIdx < 0 || sampleIdx >= M.length) return null;
  const row = M[sampleIdx];
  if (!row || panelWindowIdx < 0 || panelWindowIdx >= row.length) return null;
  const v = row[panelWindowIdx];
  return Number.isFinite(v) ? v : null;
}

// =====================================================================
// Range aggregations
// =====================================================================

function _medianOfSortedFinite(sortedFinite) {
  const n = sortedFinite.length;
  if (n === 0) return null;
  if (n & 1) return sortedFinite[(n - 1) >> 1];
  return 0.5 * (sortedFinite[n / 2 - 1] + sortedFinite[n / 2]);
}

/**
 * Aggregate GHSL across a window column range [colStart, colEnd]
 * (inclusive) at a given scale, for all samples. The core function
 * for L2-as-triangle aggregation: the scrubber calls this when an
 * L2 square is selected, passing the L2's panel-window-column range.
 *
 * Returns:
 *   { samples: [...], mean: [...], median: [...], n: [...],
 *     scale, colStart, colEnd }
 * where mean / median / n each have length n_samples. Mean / median
 * are null when a sample has no finite values in the range.
 *
 * Returns null when the panel or the scale's matrix is missing.
 *
 * @param {Object} state
 * @param {number} colStart   panel-window column index (inclusive)
 * @param {number} colEnd     panel-window column index (inclusive)
 * @param {string} [scale]    defaults to primary_scale
 */
export function ghslAggregateRange(state, colStart, colEnd, scale) {
  const p = ghslPanel(state);
  if (!p || !p.div_roll) return null;
  const s = scale || p.primary_scale;
  const M = p.div_roll[s];
  if (!M) return null;
  const ns = M.length;
  const c0 = Math.max(0, Math.min(colStart, colEnd));
  const c1 = Math.min((p.n_windows || 0) - 1, Math.max(colStart, colEnd));
  const mean   = new Array(ns).fill(null);
  const median = new Array(ns).fill(null);
  const n      = new Array(ns).fill(0);
  for (let si = 0; si < ns; si++) {
    const row = M[si];
    if (!row) continue;
    let sum = 0, count = 0;
    const tmp = [];
    for (let c = c0; c <= c1; c++) {
      const v = row[c];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v; count++; tmp.push(v);
    }
    n[si] = count;
    if (count > 0) {
      mean[si] = sum / count;
      tmp.sort((a, b) => a - b);
      median[si] = _medianOfSortedFinite(tmp);
    }
  }
  return {
    samples: Array.isArray(p.samples) ? p.samples.slice() : [],
    mean, median, n, scale: s, colStart: c0, colEnd: c1,
  };
}

/**
 * Aggregate GHSL in a window of size (2 × halfFlank + 1) centered on
 * focalCol. Used for the focal-window-with-flanks view (tighter than
 * full-L2 mean, avoids signal dilution when the L2 spans gene-
 * conversion-eroded regions).
 *
 * Out-of-range flanks are clipped to the panel's window range.
 *
 * @returns {Object|null}    same shape as ghslAggregateRange + focalCol + halfFlank
 */
export function ghslAggregateFocal(state, focalCol, halfFlank, scale) {
  const p = ghslPanel(state);
  if (!p || !p.div_roll) return null;
  const hf = (typeof halfFlank === 'number' && Number.isFinite(halfFlank) && halfFlank >= 0)
    ? Math.floor(halfFlank) : GHSL_DEFAULT_HALF_FLANK;
  const c0 = Math.max(0, focalCol - hf);
  const c1 = Math.min((p.n_windows || 0) - 1, focalCol + hf);
  const agg = ghslAggregateRange(state, c0, c1, scale);
  if (!agg) return null;
  agg.focalCol  = focalCol;
  agg.halfFlank = hf;
  return agg;
}

/**
 * Aggregate GHSL within an L2 interval [intervalStart, intervalEnd],
 * but anchored on a focal window with flanks rather than the full
 * range. The "interval view" of L2-as-triangle aggregation when the
 * L2 is wide.
 *
 * If focalCol is null, uses the L2 midpoint. halfFlank defaults to
 * GHSL_DEFAULT_HALF_FLANK. The result is clipped to the L2 range, so
 * a focal near an edge gets a shorter window (not pulled outside the L2).
 *
 * @returns {Object|null}
 */
export function ghslAggregateInterval(state, intervalStart, intervalEnd, focalCol, halfFlank, scale) {
  const p = ghslPanel(state);
  if (!p || !p.div_roll) return null;
  const hf = (typeof halfFlank === 'number' && Number.isFinite(halfFlank) && halfFlank >= 0)
    ? Math.floor(halfFlank) : GHSL_DEFAULT_HALF_FLANK;
  const iStart = Math.max(0, Math.min(intervalStart, intervalEnd));
  const iEnd   = Math.min((p.n_windows || 0) - 1, Math.max(intervalStart, intervalEnd));
  if (iEnd < iStart) return null;
  let fcol = focalCol;
  if (focalCol == null || !Number.isFinite(focalCol)) {
    fcol = Math.floor((iStart + iEnd) / 2);
  }
  // Clamp focal into the interval
  fcol = Math.max(iStart, Math.min(iEnd, fcol));
  // Clip flanks to the interval range (not just the panel range)
  const c0 = Math.max(iStart, fcol - hf);
  const c1 = Math.min(iEnd,   fcol + hf);
  const agg = ghslAggregateRange(state, c0, c1, scale);
  if (!agg) return null;
  agg.intervalStart = iStart;
  agg.intervalEnd   = iEnd;
  agg.focalCol      = fcol;
  agg.halfFlank     = hf;
  return agg;
}

// =====================================================================
// K-stripes accessors
// =====================================================================

/**
 * Per-K stripe partition lookup. Returns:
 *   { stripe_per_sample: [...], stripe_means: [...],
 *     stripe_medians: [...], n_per_stripe: [...] }
 * or null when K isn't in the kstripes layer / layer not loaded.
 */
export function ghslKStripes(state, K) {
  const ks = state && state.data && state.data.ghsl_kstripes;
  if (!ks || !ks.by_k) return null;
  return ks.by_k[String(K)] || null;
}

/**
 * Available K values, sorted ascending. Empty array when kstripes
 * isn't loaded.
 */
export function ghslKStripesAvailableK(state) {
  const ks = state && state.data && state.data.ghsl_kstripes;
  if (!ks || !ks.by_k) return [];
  return Object.keys(ks.by_k)
    .map(s => parseInt(s, 10))
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
}
