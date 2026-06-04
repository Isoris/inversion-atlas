// pages/discovery/dosage_heatmap/karyogroup_stats.js
// =====================================================================
// Per-window statistics for a karyogroup partition — the quantitative
// boundary diagnostic behind the inside/outside signature of an
// inversion:
//
//   INSIDE the block         OUTSIDE the boundary
//   ------------------       ----------------------
//   karyogroup labels        labels stop predicting genotype
//     predict genotype       (Cramér's V drops)
//   FST elevated             FST drops
//   dosage clusters apart    dosage clusters merge (separation → 0)
//   hets intermediate        het intermediacy breaks down
//
// Given a karyogroup partition (per-sample labels, computed over the
// whole block) and the dosage matrix, this walks `nWindows` genomic
// windows and reports, per window:
//   - cramers_v        association between karyogroup and dosage tier
//                      (0/1/2) — how well the partition predicts genotype
//   - fst              AMOVA-style dosage FST proxy = SSB / (SSB+SSW),
//                      the "elevated between-arrangement" signal
//   - separation       normalised between-group dosage gap [0,1)
//   - het_intermediacy do the het-tier samples sit between the homs [0,1]
//   - n_used           samples with data + a karyogroup in the window
//
// Windows are then classified inside / outside (V ≥ vThreshold AND
// fst ≥ fstThreshold), and the longest inside run is reported as the
// karyogroup block span (start/end window + bp). The window count is a
// caller knob (`nWindows`), so the same partition can be scanned at
// several resolutions.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================
import { cramersV } from '../../../shared/contingency.js';
import { buildSampleTrajectoryMatrix } from './index_aware_cluster.js';

// Dosage → tier (0/1/2) using the same cut-points the detector calls on.
function _tier(v) { return v < 0.5 ? 0 : (v < 1.5 ? 1 : 2); }

/**
 * @param {Object} canonical            adapter output (cellValue, marker_pos_bp…)
 * @param {Object} opts
 *   labels: Int32Array                 per-sample karyogroup id (0..K-1; -1 = none) REQUIRED
 *   k?: number                         number of karyogroups (else inferred from labels)
 *   markerOrder?: Int32Array           working-set markers (genomic order applied internally)
 *   nWindows?: number                  window count (default 20); clamped to ≤ #markers
 *   vThreshold?: number                inside cutoff on Cramér's V (default 0.5)
 *   fstThreshold?: number              inside cutoff on FST proxy (default 0.05)
 *   minNWindow?: number                min samples in a window to score it (default 4)
 * @returns {Object|null}
 */
export function computeKaryogroupStats(canonical, opts) {
  const o = opts || {};
  const labels = o.labels;
  if (!labels || typeof labels.length !== 'number') return null;
  const nWindows = Number.isFinite(o.nWindows) && o.nWindows >= 1 ? (o.nWindows | 0) : 20;
  const vThreshold   = Number.isFinite(o.vThreshold)   ? o.vThreshold   : 0.5;
  const fstThreshold = Number.isFinite(o.fstThreshold) ? o.fstThreshold : 0.05;
  const minNWindow   = Number.isFinite(o.minNWindow)   ? (o.minNWindow | 0) : 4;

  // Infer K from labels if not given.
  let K = Number.isFinite(o.k) ? (o.k | 0) : 0;
  if (K <= 0) { for (let s = 0; s < labels.length; s++) if (labels[s] + 1 > K) K = labels[s] + 1; }
  if (K <= 0) return null;

  // Reuse the trajectory builder to get genomic-ordered windows (force the
  // bin count to nWindows) + per-sample per-window mean dosage.
  const traj = buildSampleTrajectoryMatrix(canonical, {
    markerOrder: o.markerOrder,
    binSize: 1, minBins: nWindows, maxBins: nWindows,
  });
  if (!traj) return null;
  const { B, nS, nBins, cols, binStart } = traj;
  const W = nBins;
  const pos = canonical && canonical.marker_pos_bp;

  const nM = (canonical && canonical.n_markers | 0) || 0;
  const cramers   = new Float64Array(W).fill(NaN);
  const fst       = new Float64Array(W).fill(NaN);
  const separation = new Float64Array(W).fill(NaN);
  const hetInter  = new Float64Array(W).fill(NaN);
  const strength  = new Float64Array(W).fill(NaN);   // per-window split strength
  const nUsed     = new Int32Array(W);
  const winStartBp = new Float64Array(W).fill(NaN);
  const winEndBp   = new Float64Array(W).fill(NaN);

  for (let w = 0; w < W; w++) {
    // bp span of the window (first/last ordered marker in the bin).
    if (pos && pos.length) {
      const c0 = cols[binStart[w]], c1 = cols[binStart[w + 1] - 1];
      if (Number.isFinite(pos[c0])) winStartBp[w] = pos[c0];
      if (Number.isFinite(pos[c1])) winEndBp[w] = pos[c1];
    }
    // Collect (value, group, tier) for samples with data + a karyogroup.
    const vals = [], grps = [];
    const table = new Float64Array(K * 3);          // karyogroup × tier
    for (let s = 0; s < nS; s++) {
      const v = B[s * nBins + w];
      const g = labels[s];
      if (!Number.isFinite(v) || g < 0 || g >= K) continue;
      vals.push(v); grps.push(g);
      table[g * 3 + _tier(v)]++;
    }
    const n = vals.length;
    nUsed[w] = n;
    if (n < minNWindow) continue;

    cramers[w] = cramersV(table, K, 3);

    // Group dosage means + AMOVA FST proxy + separation.
    const gSum = new Float64Array(K), gCnt = new Int32Array(K);
    let allSum = 0;
    for (let i = 0; i < n; i++) { gSum[grps[i]] += vals[i]; gCnt[grps[i]]++; allSum += vals[i]; }
    const grand = allSum / n;
    const gMean = new Float64Array(K);
    for (let g = 0; g < K; g++) gMean[g] = gCnt[g] > 0 ? gSum[g] / gCnt[g] : NaN;
    let SSB = 0, SSW = 0;
    for (let g = 0; g < K; g++) if (gCnt[g] > 0) SSB += gCnt[g] * (gMean[g] - grand) ** 2;
    for (let i = 0; i < n; i++) SSW += (vals[i] - gMean[grps[i]]) ** 2;
    const denom = SSB + SSW;
    fst[w] = denom > 0 ? SSB / denom : 0;

    separation[w] = _separationNorm(gMean, gCnt, K);
    hetInter[w]   = _hetIntermediacy(gMean, gCnt, K);
    // Split strength = how strongly the karyogroup partition holds in this
    // window: Cramér's V (predicts genotype) blended with the FST proxy.
    const vv = Number.isFinite(cramers[w]) ? cramers[w] : 0;
    const ff = Number.isFinite(fst[w]) ? Math.max(0, Math.min(1, fst[w])) : 0;
    strength[w] = 0.5 * vv + 0.5 * ff;
  }

  // Scatter window strength back to per-marker (for the renderer's "fan"
  // boundary colour mode). NaN for markers outside the working set.
  const perMarkerStrength = new Float64Array(nM).fill(NaN);
  for (let w = 0; w < W; w++) {
    for (let c = binStart[w]; c < binStart[w + 1]; c++) {
      const mi = cols[c];
      if (mi >= 0 && mi < nM) perMarkerStrength[mi] = strength[w];
    }
  }

  // Inside / outside classification + longest inside run = block span.
  const inside = new Uint8Array(W);
  let nInside = 0;
  for (let w = 0; w < W; w++) {
    const ins = Number.isFinite(cramers[w]) && Number.isFinite(fst[w])
             && cramers[w] >= vThreshold && fst[w] >= fstThreshold;
    inside[w] = ins ? 1 : 0;
    if (ins) nInside++;
  }
  const block = _longestRun(inside, W, winStartBp, winEndBp);

  // Convenience per-window object array + summaries.
  const windows = [];
  let vAll = 0, vAllN = 0, fAll = 0, fAllN = 0, vIn = 0, vInN = 0, fIn = 0, fInN = 0;
  for (let w = 0; w < W; w++) {
    windows.push({
      idx: w,
      start_bp: Number.isFinite(winStartBp[w]) ? winStartBp[w] : null,
      end_bp:   Number.isFinite(winEndBp[w])   ? winEndBp[w]   : null,
      n: nUsed[w],
      cramers_v: cramers[w], fst: fst[w],
      separation: separation[w], het_intermediacy: hetInter[w],
      inside: !!inside[w],
    });
    if (Number.isFinite(cramers[w])) { vAll += cramers[w]; vAllN++; if (inside[w]) { vIn += cramers[w]; vInN++; } }
    if (Number.isFinite(fst[w]))     { fAll += fst[w];     fAllN++; if (inside[w]) { fIn += fst[w];     fInN++; } }
  }

  let nPresent = 0; { const seen = new Uint8Array(K); for (let s = 0; s < nS; s++) { const g = labels[s]; if (g >= 0 && g < K && !seen[g]) { seen[g] = 1; nPresent++; } } }

  return {
    k: K, n_karyogroups_present: nPresent,
    n_windows: W,
    cramers_v: cramers, fst, separation, het_intermediacy: hetInter,
    strength, per_marker_strength: perMarkerStrength,
    n_used: nUsed, inside,
    window_start_bp: winStartBp, window_end_bp: winEndBp,
    n_inside: nInside, n_outside: W - nInside,
    frac_inside: W > 0 ? nInside / W : 0,
    block,
    windows,
    summary: {
      cramers_v_mean_all:    vAllN > 0 ? vAll / vAllN : NaN,
      cramers_v_mean_inside: vInN  > 0 ? vIn  / vInN  : NaN,
      fst_mean_all:          fAllN > 0 ? fAll / fAllN : NaN,
      fst_mean_inside:       fInN  > 0 ? fIn  / fInN  : NaN,
    },
    thresholds: { v: vThreshold, fst: fstThreshold },
  };
}

// Normalised min standardised gap between group dosage means, in [0,1).
function _separationNorm(gMean, gCnt, K) {
  // Pooled SD unavailable here (means only) → use a fixed dosage-scale
  // denom (0.5 = a tier half-width) so the metric is comparable to the
  // detector's separation. Squash through 1−exp(−x/1.5).
  let minGap = Infinity;
  for (let a = 0; a < K; a++) {
    for (let b = a + 1; b < K; b++) {
      if (gCnt[a] === 0 || gCnt[b] === 0) continue;
      const g = Math.abs(gMean[a] - gMean[b]) / 0.5;
      if (g < minGap) minGap = g;
    }
  }
  if (!Number.isFinite(minGap)) return NaN;
  return 1 - Math.exp(-minGap / 1.5);
}

// Do the het-tier samples sit between the homozygous extremes? Returns
// [0,1]: 1 when the group nearest dosage 1.0 lies at the midpoint of the
// min/max group means; 0 when it sits at an extreme. NaN if <3 groups.
function _hetIntermediacy(gMean, gCnt, K) {
  const present = [];
  for (let g = 0; g < K; g++) if (gCnt[g] > 0 && Number.isFinite(gMean[g])) present.push(gMean[g]);
  if (present.length < 3) return NaN;
  let lo = Infinity, hi = -Infinity;
  for (const m of present) { if (m < lo) lo = m; if (m > hi) hi = m; }
  const range = hi - lo;
  if (range <= 1e-9) return 0;
  // Group mean closest to 1.0 (the het tier centre).
  let hetMean = present[0], bestD = Infinity;
  for (const m of present) { const d = Math.abs(m - 1.0); if (d < bestD) { bestD = d; hetMean = m; } }
  const mid = (lo + hi) / 2;
  return Math.max(0, 1 - Math.abs(hetMean - mid) / (range / 2));
}

// Longest contiguous run of inside windows → block span.
function _longestRun(inside, W, startBp, endBp) {
  let bestS = -1, bestLen = 0, curS = -1, curLen = 0;
  for (let w = 0; w <= W; w++) {
    const on = w < W && inside[w];
    if (on) { if (curS < 0) { curS = w; curLen = 0; } curLen++; }
    else { if (curLen > bestLen) { bestLen = curLen; bestS = curS; } curS = -1; curLen = 0; }
  }
  if (bestLen <= 0) return null;
  const e = bestS + bestLen - 1;
  return {
    start_win: bestS, end_win: e, n_windows: bestLen,
    start_bp: Number.isFinite(startBp[bestS]) ? startBp[bestS] : null,
    end_bp:   Number.isFinite(endBp[e])       ? endBp[e]       : null,
  };
}
