// shared/diamond_detection.js
//
// Per-candidate "diamond" detection (legacy lines 37820-38010). A
// diamond is a contiguous-window range inside a candidate where one
// band's PC1 spread balloons (split + re-merge pattern), with one or
// more OTHER bands staying flat through the same windows.
//
// Strictness vocabulary:
//   loose    = any splitting range
//   strict   = splitting + ≥1 stable parallel band
//   strict-2 = splitting + ≥2 stable parallel bands  (strongest signal,
//              matches the multi-haplotype-system pattern)
//
// All helpers take `windows` (state.data.windows shape) explicitly so
// the module is unit-testable without a live atlas state. Pure compute.

/** spread > 1.5× baseline = splitting */
export const DD_SPLIT_RATIO_THRESHOLD = 1.5;
/** splitting must persist ≥3 windows */
export const DD_MIN_DIAMOND_WINDOWS = 3;
/** mean drift < 5% of band spread = stable */
export const DD_STABLE_VARIANCE_FRAC = 0.05;
/** band needs ≥4 samples to compute stats */
export const DD_MIN_BAND_SAMPLES = 4;

/** Strictness vocabulary. */
export const DIAMOND_STRICTNESS = Object.freeze(['loose', 'strict', 'strict2']);

// =====================================================================
// Per-band per-window stats
// =====================================================================

/**
 * Compute per-band per-window stats (mean PC1 + spread = sd, sample
 * count) across the candidate's window range. Returns:
 *   { bandStats: [{ band, perWindow: [{ wi, mean, sd, n }] }],
 *     windowRange: [lo, hi] }
 *
 * Returns null when inputs are unusable (missing labels, missing
 * windows, missing start_w/end_w).
 *
 * @param {Object} candidate          must have locked_labels + start_w + end_w
 * @param {Array<{pc1?:ArrayLike<number>}>} windows  from state.data.windows
 * @returns {Object|null}
 */
export function ddComputeBandStats(candidate, windows) {
  if (!candidate || !candidate.locked_labels) return null;
  if (!Array.isArray(windows)) return null;
  const winLo = candidate.start_w;
  const winHi = candidate.end_w;
  if (!Number.isFinite(winLo) || !Number.isFinite(winHi)) return null;
  const labels = candidate.locked_labels;
  let K = Number.isFinite(candidate.K) ? candidate.K : null;
  if (K == null) {
    let maxK = -1;
    for (let i = 0; i < labels.length; i++) {
      const v = labels[i];
      if (Number.isInteger(v) && v > maxK) maxK = v;
    }
    K = maxK + 1;
  }
  if (K <= 0) return null;

  const out = [];
  for (let b = 0; b < K; b++) {
    const perWindow = [];
    for (let wi = winLo; wi <= winHi && wi < windows.length; wi++) {
      const w = windows[wi];
      if (!w || !w.pc1) continue;
      const pc1 = w.pc1;
      let sum = 0, n = 0;
      for (let si = 0; si < labels.length; si++) {
        if (labels[si] === b && si < pc1.length && Number.isFinite(pc1[si])) {
          sum += pc1[si]; n++;
        }
      }
      if (n < DD_MIN_BAND_SAMPLES) {
        perWindow.push({ wi, mean: NaN, sd: NaN, n });
        continue;
      }
      const mean = sum / n;
      let sumSq = 0;
      for (let si = 0; si < labels.length; si++) {
        if (labels[si] === b && si < pc1.length && Number.isFinite(pc1[si])) {
          const d = pc1[si] - mean;
          sumSq += d * d;
        }
      }
      const sd = Math.sqrt(sumSq / Math.max(1, n - 1));
      perWindow.push({ wi, mean, sd, n });
    }
    out.push({ band: b, perWindow });
  }
  return { bandStats: out, windowRange: [winLo, winHi] };
}

// =====================================================================
// Splitting-range detection
// =====================================================================

/**
 * Identify contiguous window ranges where a band's spread exceeds the
 * splitting threshold (1.5× the band's baseline sd, where baseline =
 * 25th-percentile sd across the band's window range).
 *
 * Returns: Array<{ start_w, end_w, peak_sd, peak_ratio, baseline_sd }>
 *
 * @param {Array<{wi:number, sd:number}>} perWindow
 * @returns {Array<Object>}
 */
export function ddDetectSplittingRange(perWindow) {
  if (!Array.isArray(perWindow) || perWindow.length < DD_MIN_DIAMOND_WINDOWS + 2) return [];
  const sds = perWindow.map(p => p && p.sd).filter(s => Number.isFinite(s));
  if (sds.length === 0) return [];
  const sortedSds = sds.slice().sort((a, b) => a - b);
  const baseline = sortedSds[Math.floor(sortedSds.length / 4)];
  if (!Number.isFinite(baseline) || baseline <= 1e-6) return [];
  const threshold = baseline * DD_SPLIT_RATIO_THRESHOLD;

  const ranges = [];
  let curStart = -1, curEnd = -1, curPeak = 0;
  for (let i = 0; i < perWindow.length; i++) {
    const p = perWindow[i];
    if (!p) continue;
    const above = Number.isFinite(p.sd) && p.sd > threshold;
    if (above) {
      if (curStart < 0) { curStart = p.wi; curPeak = p.sd; }
      curEnd = p.wi;
      if (p.sd > curPeak) curPeak = p.sd;
    } else if (curStart >= 0) {
      if ((curEnd - curStart + 1) >= DD_MIN_DIAMOND_WINDOWS) {
        ranges.push({
          start_w: curStart, end_w: curEnd,
          peak_sd: curPeak, baseline_sd: baseline,
          peak_ratio: curPeak / baseline,
        });
      }
      curStart = -1;
    }
  }
  if (curStart >= 0 && (curEnd - curStart + 1) >= DD_MIN_DIAMOND_WINDOWS) {
    ranges.push({
      start_w: curStart, end_w: curEnd,
      peak_sd: curPeak, baseline_sd: baseline,
      peak_ratio: curPeak / baseline,
    });
  }
  return ranges;
}

// =====================================================================
// Stability check
// =====================================================================

/**
 * Total PC1 spread across all bands across all windows. Used as the
 * denominator when computing per-band stability fraction.
 *
 * @param {Array<{perWindow:Array<{mean:number}>}>} bandStats
 * @returns {number}
 */
export function ddTotalSpread(bandStats) {
  if (!Array.isArray(bandStats)) return 0;
  let lo = +Infinity, hi = -Infinity;
  for (const bs of bandStats) {
    if (!bs || !Array.isArray(bs.perWindow)) continue;
    for (const p of bs.perWindow) {
      if (!p || !Number.isFinite(p.mean)) continue;
      if (p.mean < lo) lo = p.mean;
      if (p.mean > hi) hi = p.mean;
    }
  }
  return (Number.isFinite(lo) && Number.isFinite(hi)) ? (hi - lo) : 0;
}

/**
 * Check whether a band is "stable" (flat-parallel) within a given
 * window range. Stable iff (max_mean - min_mean) / total_band_spread <
 * STABLE_VARIANCE_FRAC.
 *
 * @param {Array<{wi:number, mean:number}>} perWindow
 * @param {number} startW
 * @param {number} endW
 * @param {number} totalSpread
 * @returns {{stable:boolean, mean_drift:number, total_spread:number}}
 */
export function ddIsBandStable(perWindow, startW, endW, totalSpread) {
  let lo = +Infinity, hi = -Infinity, count = 0;
  if (Array.isArray(perWindow)) {
    for (const p of perWindow) {
      if (!p || p.wi < startW || p.wi > endW) continue;
      if (!Number.isFinite(p.mean)) continue;
      if (p.mean < lo) lo = p.mean;
      if (p.mean > hi) hi = p.mean;
      count++;
    }
  }
  if (count === 0 || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { stable: false, mean_drift: NaN, total_spread: totalSpread };
  }
  const drift = hi - lo;
  const fracDrift = totalSpread > 1e-6 ? drift / totalSpread : 0;
  return {
    stable: fracDrift < DD_STABLE_VARIANCE_FRAC,
    mean_drift: drift,
    total_spread: totalSpread,
  };
}

// =====================================================================
// Main detector
// =====================================================================

/**
 * Detect diamonds in a candidate. Returns Array<{
 *   splitting_band, diamond_start_w, diamond_end_w,
 *   stable_bands, slanting_bands,
 *   strict, strict2,
 *   baseline_spread, peak_spread, peak_spread_ratio
 * }>. Empty array when no diamonds are found.
 *
 * @param {Object} candidate
 * @param {Array<Object>} windows  state.data.windows
 * @returns {Array<Object>}
 */
export function detectDiamonds(candidate, windows) {
  const stats = ddComputeBandStats(candidate, windows);
  if (!stats) return [];
  const totalSpread = ddTotalSpread(stats.bandStats);
  const out = [];
  for (const bs of stats.bandStats) {
    const ranges = ddDetectSplittingRange(bs.perWindow);
    for (const r of ranges) {
      const stableBands = [];
      const slantingBands = [];
      for (const otherBs of stats.bandStats) {
        if (!otherBs || otherBs.band === bs.band) continue;
        const stab = ddIsBandStable(otherBs.perWindow, r.start_w, r.end_w, totalSpread);
        if (stab.stable) stableBands.push(otherBs.band);
        else             slantingBands.push(otherBs.band);
      }
      out.push({
        splitting_band: bs.band,
        diamond_start_w: r.start_w,
        diamond_end_w: r.end_w,
        stable_bands: stableBands,
        slanting_bands: slantingBands,
        strict:  stableBands.length >= 1,
        strict2: stableBands.length >= 2,
        baseline_spread: r.baseline_sd,
        peak_spread: r.peak_sd,
        peak_spread_ratio: r.peak_ratio,
      });
    }
  }
  return out;
}

/**
 * Summarise diamond detection for a candidate as the row-friendly
 * shape consumed by the catalogue Diamond column:
 *   { n_diamonds, n_loose, n_strict, n_strict2,
 *     has_loose, has_strict, has_strict2, diamonds }
 *
 * `n_loose` is identical to `n_diamonds` (a loose diamond is any
 * splitting range, regardless of stable-parallel-band count).
 *
 * @param {Object} candidate
 * @param {Array<Object>} windows  state.data.windows
 * @returns {Object}
 */
export function summarizeDiamonds(candidate, windows) {
  const diamonds = detectDiamonds(candidate, windows);
  return {
    n_diamonds: diamonds.length,
    n_loose:    diamonds.length,
    n_strict:   diamonds.filter(d => d.strict).length,
    n_strict2:  diamonds.filter(d => d.strict2).length,
    has_loose:  diamonds.length > 0,
    has_strict: diamonds.some(d => d.strict),
    has_strict2: diamonds.some(d => d.strict2),
    diamonds,
  };
}

// =====================================================================
// Canvas overlay drawer
// =====================================================================

/**
 * Draw the diamond overlay on the PC1 panel. One translucent cyan
 * rectangle per detected diamond, with dashed left/right edges and a
 * top annotation strip ("◆ split detected" or "[strict]" / "[strict2]"
 * variants). Skips diamonds covering < 8% of visible range (too
 * zoomed-out for the annotation to be useful).
 *
 * Pure given the diamond summary + canvas context. Caller pre-computes
 * the summary via summarizeDiamonds.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {Object} summary  from summarizeDiamonds
 * @param {Array<{center_mb:number}>} windows  state.data.windows
 * @param {{mode?:'loose'|'strict'|'strict2'}} opts
 */
export function drawDiamondOverlay(ctx, pad, plotW, plotH, mbMin, mbMax, summary, windows, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!summary || !Array.isArray(summary.diamonds) || summary.diamonds.length === 0) return;
  if (!Array.isArray(windows)) return;
  const mode = (opts && opts.mode) || 'loose';
  if (mode === 'off') return;
  const filtered = summary.diamonds.filter(dd =>
    mode === 'strict'  ? dd.strict  :
    mode === 'strict2' ? dd.strict2 :
    true
  );
  if (filtered.length === 0) return;

  if (typeof ctx.save === 'function') ctx.save();
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  for (const dd of filtered) {
    const wLo = dd.diamond_start_w;
    const wHi = dd.diamond_end_w;
    if (wLo == null || wHi == null) continue;
    if (wLo < 0 || wHi >= windows.length) continue;
    const winLo = windows[wLo], winHi = windows[wHi];
    if (!winLo || !winHi) continue;
    const mbLo = winLo.center_mb;
    const mbHi = winHi.center_mb;
    if (!Number.isFinite(mbLo) || !Number.isFinite(mbHi)) continue;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = Math.max(pad.l, mbToX(Math.max(mbLo, mbMin)));
    const xHi = Math.min(pad.l + plotW, mbToX(Math.min(mbHi, mbMax)));
    if (xHi - xLo < 12) continue;
    const visibleSpan = mbMax - mbMin;
    const diamondSpan = mbHi - mbLo;
    if (visibleSpan <= 0 || (diamondSpan / visibleSpan < 0.08)) continue;

    const alpha = dd.strict2 ? 0.16 : (dd.strict ? 0.12 : 0.08);
    ctx.fillStyle = 'rgba(60, 223, 255, ' + alpha + ')';
    ctx.fillRect(xLo, pad.t, xHi - xLo, plotH);

    if (typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = 'rgba(60, 223, 255, 0.55)';
      ctx.lineWidth = 1;
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xLo + 0.5, pad.t);
      ctx.lineTo(xLo + 0.5, pad.t + plotH);
      ctx.moveTo(xHi - 0.5, pad.t);
      ctx.lineTo(xHi - 0.5, pad.t + plotH);
      ctx.stroke();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
    }

    if (typeof ctx.fillText === 'function') {
      if (xHi - xLo >= 110) {
        const stripH = 12;
        ctx.fillStyle = 'rgba(60, 223, 255, 0.85)';
        ctx.fillRect(xLo, pad.t, xHi - xLo, stripH);
        ctx.fillStyle = '#000';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tag = dd.strict2 ? '◆ split [strict2]'
                  : dd.strict  ? '◆ split [strict]'
                  : '◆ split detected';
        ctx.fillText(tag, (xLo + xHi) / 2, pad.t + stripH / 2);
      } else if (xHi - xLo >= 40) {
        ctx.fillStyle = 'rgba(60, 223, 255, 0.85)';
        ctx.fillRect(xLo, pad.t, xHi - xLo, 8);
        ctx.fillStyle = '#000';
        ctx.font = '8px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◆', (xLo + xHi) / 2, pad.t + 4);
      }
    }
  }
  if (typeof ctx.restore === 'function') ctx.restore();
}

/**
 * Resolve the count under a given strictness mode. Convenience for the
 * catalogue Diamond column renderer.
 *
 * @param {Object} summary
 * @param {'loose'|'strict'|'strict2'} mode
 * @returns {number}
 */
export function diamondCountFor(summary, mode) {
  if (!summary) return 0;
  if (mode === 'strict')  return summary.n_strict  || 0;
  if (mode === 'strict2') return summary.n_strict2 || 0;
  return summary.n_loose || summary.n_diamonds || 0;
}
