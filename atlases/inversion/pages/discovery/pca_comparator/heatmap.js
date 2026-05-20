// pages/discovery/pca_comparator/heatmap.js
//
// Band-persistence heatmap for the cross-evidence PCA comparator.
//
// Rows = samples (sorted by current-window dosage band so regime blocks
// are visually clustered). Cols = windows along the chromosome. Each
// cell is colored by the dosage K-band assignment at (sample, window),
// resolved through state.windowToL2[w] → getL2Cluster(state, l2).labels.
//
// What this strip is for (the reason the 3 PCAs alone feel dead):
//   - Regime cores      → solid horizontal bands across many windows.
//   - Boundary brackets → vertical color transitions across many rows
//                         at the same x position; the breakpoint zone is
//                         where the transition spans more than one window.
//   - Microstripes      → single-cell deviations from a row's local
//                         majority: recombinants, gene-conversion tracts,
//                         mosaicism, kinship leakage.
//   - Sub-structure     → a row sticks with its neighbors here but breaks
//                         away there → haplotype substructure within a
//                         copy-number class.
//
// The 3 PCAs above are now the zoom-in on whichever column you parked
// the cursor at; the heatmap is the genome-wide story they're zooming
// into.

import { getL2Cluster, groupColor } from '../local_pca_dosage/_data.js';

// Layout constants for the heatmap canvas (CSS pixels).
const STRIP_PAD = { l: 60, r: 8, t: 14, b: 18 };

// Cache last paint geometry so hit-testing (click / hover) can map
// pixel coords back to (sampleIdx, windowIdx).
let _lastGeom = null;

// ---------------------------------------------------------------------------
// Public: paint the band-persistence strip.
// ---------------------------------------------------------------------------
export function paintHeatmap(state) {
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('pcaCompHeatmapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { cssW, cssH } = _fitCanvas(canvas, ctx);
  ctx.clearRect(0, 0, cssW, cssH);

  const ss = state.sharedState;
  if (!ss || !ss.data) {
    _drawEmpty(ctx, cssW, cssH, 'no chromosome loaded');
    _lastGeom = null;
    return;
  }
  const d = ss.data;
  const nWin = d.n_windows | 0;
  const samples = d.samples || [];
  const nSam = samples.length | 0;
  if (nWin <= 0 || nSam <= 0) {
    _drawEmpty(ctx, cssW, cssH, 'no windows / samples');
    _lastGeom = null;
    return;
  }

  // Resolve per-window per-sample band labels via the L2-cluster cache.
  // Many windows share an L2 envelope → fetch each L2's labels once.
  const labelByWinSam = _buildLabelMatrix(ss, nWin, nSam);

  // Row order: sort by band at the current window so the regime appears
  // as horizontal blocks. Ties broken by sample index for stability.
  const cur = (ss.cur | 0);
  const rowOrder = _rowOrderByBandAt(labelByWinSam, nSam, nWin, cur);

  // 2026-05-20: scope = 'focal' restricts the heatmap to a slab around
  // the cursor matching the comparator's scrubUnit (1w / 5w / 10w /
  // 25w / L2 / Cand). Default 'genome' renders every window.
  // Returns { wStart, wEnd } inclusive bounds (both clamped to [0, nWin-1]).
  const scope = (state.heatmapScope === 'focal') ? 'focal' : 'genome';
  let wStart = 0, wEnd = nWin - 1;
  if (scope === 'focal') {
    const slab = _resolveFocalSlab(ss, state.scrubUnit || '1', cur, nWin);
    wStart = slab.start;
    wEnd = slab.end;
  }
  const scopeNWin = wEnd - wStart + 1;
  // Update the scope-label so the header text matches what's painted.
  _updateScopeLabel(scope, wStart, wEnd, scopeNWin, nWin);

  const plotW = Math.max(1, cssW - STRIP_PAD.l - STRIP_PAD.r);
  const plotH = Math.max(1, cssH - STRIP_PAD.t - STRIP_PAD.b);

  // Build the heatmap as ImageData for speed (nSam*nWin can be ~5e5).
  // Then drawImage-via-temp-canvas with image-rendering: pixelated.
  // In focal scope we build only the slab range, so the ImageData is
  // scopeNWin wide and the per-row inner loop walks only that range.
  const img = ctx.createImageData(scopeNWin, nSam);
  const buf = img.data;
  for (let row = 0; row < nSam; row++) {
    const si = rowOrder[row];
    for (let w = 0; w < scopeNWin; w++) {
      const srcW = wStart + w;
      const k = labelByWinSam[srcW * nSam + si];
      const rgb = _bandRGB(k);
      const off = (row * scopeNWin + w) * 4;
      buf[off]     = rgb[0];
      buf[off + 1] = rgb[1];
      buf[off + 2] = rgb[2];
      buf[off + 3] = 255;
    }
  }
  // Stage onto a temp canvas at native resolution, then scale-draw into
  // the plot rect with smoothing off so pixels stay crisp.
  const tmp = document.createElement('canvas');
  tmp.width  = scopeNWin;
  tmp.height = nSam;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, scopeNWin, nSam,
                STRIP_PAD.l, STRIP_PAD.t, plotW, plotH);
  ctx.restore();

  // Frame.
  ctx.strokeStyle = 'rgba(120,140,170,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(STRIP_PAD.l + 0.5, STRIP_PAD.t + 0.5,
                 plotW - 1, plotH - 1);

  // X axis: window-index ticks at the rendered range's ends + cursor.
  ctx.fillStyle = 'rgba(160,180,200,0.7)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`w=${wStart}`, STRIP_PAD.l, STRIP_PAD.t + plotH + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`w=${wEnd}`, STRIP_PAD.l + plotW, STRIP_PAD.t + plotH + 12);

  // Y axis label.
  ctx.save();
  ctx.translate(12, STRIP_PAD.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(160,180,200,0.7)';
  ctx.fillText(`samples (n=${nSam}, sorted by band @ w=${cur})`, 0, 0);
  ctx.restore();

  // Vertical cursor at current window (linked with the 3 PCAs above).
  // In focal scope cur may be at the slab center; the cursor line is
  // drawn at its position WITHIN the rendered range. If cur falls
  // outside [wStart, wEnd] (e.g., after scope toggle before refresh),
  // skip the cursor draw to avoid a mis-anchored line.
  if (cur >= wStart && cur <= wEnd) {
    const cx = STRIP_PAD.l + ((cur - wStart + 0.5) / scopeNWin) * plotW;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(cx, STRIP_PAD.t - 2);
    ctx.lineTo(cx, STRIP_PAD.t + plotH + 2);
    ctx.stroke();
  }

  // Hovered-sample row highlight — mirrors the cross-PCA hover.
  const hov = state.hoveredSample | 0;
  if (hov >= 0) {
    const rowIdx = rowOrder.indexOf(hov);
    if (rowIdx >= 0) {
      const ry = STRIP_PAD.t + (rowIdx / nSam) * plotH;
      const rh = Math.max(1.5, plotH / nSam);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(STRIP_PAD.l + 0.5, ry + 0.5, plotW - 1, rh);
      // Sample label.
      const s = samples[hov];
      const lbl = s ? (s.cga || s.ind || `si=${hov}`) : `si=${hov}`;
      ctx.fillStyle = 'rgba(220,230,245,0.9)';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(lbl, STRIP_PAD.l - 4, ry + rh / 2 + 3);
    }
  }

  _lastGeom = {
    plot: { x: STRIP_PAD.l, y: STRIP_PAD.t, w: plotW, h: plotH },
    // Hit-test must map pixels back to the actual rendered range, not
    // [0, nWin). In genome scope this is unchanged (wStart=0,
    // scopeNWin=nWin). In focal scope it constrains scrub-clicks to
    // the slab — same UX as the 3 PCAs sampling only that range.
    nWin: scopeNWin,
    wStart,
    nSam, rowOrder,
  };
}

// ---------------------------------------------------------------------------
// Hit-test — return { si, w } under (px, py) or null.
// ---------------------------------------------------------------------------
export function findCellAtPixel(x, y) {
  const g = _lastGeom;
  if (!g) return null;
  const { plot, nWin, nSam, rowOrder, wStart } = g;
  if (x < plot.x || x > plot.x + plot.w) return null;
  if (y < plot.y || y > plot.y + plot.h) return null;
  const wLocal = Math.max(0, Math.min(nWin - 1,
    Math.floor(((x - plot.x) / plot.w) * nWin)));
  const row = Math.max(0, Math.min(nSam - 1,
    Math.floor(((y - plot.y) / plot.h) * nSam)));
  // Translate slab-local window back to absolute window index for the
  // caller (scrub handler updates ss.cur with the absolute value).
  return { si: rowOrder[row], w: (wStart | 0) + wLocal };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

// Walk windows, resolve each L2's labels once, broadcast to all windows
// in that L2 envelope. Returns a Int8Array of length nWin*nSam,
// indexed as [w * nSam + si]. Cell value -1 = unassigned.
function _buildLabelMatrix(ss, nWin, nSam) {
  const out = new Int8Array(nWin * nSam).fill(-1);
  const w2l = ss.windowToL2;
  if (!w2l) return out;
  // Cache per-L2 labels to avoid recomputing for every window.
  const byL2 = new Map();
  for (let w = 0; w < nWin; w++) {
    const l2 = w2l[w] | 0;
    if (l2 < 0) continue;
    let labels = byL2.get(l2);
    if (labels === undefined) {
      const cl = getL2Cluster(ss, l2);
      labels = (cl && cl.labels) ? cl.labels : null;
      byL2.set(l2, labels);
    }
    if (!labels) continue;
    const base = w * nSam;
    const lim = Math.min(nSam, labels.length | 0);
    for (let si = 0; si < lim; si++) {
      const k = labels[si];
      out[base + si] = (k >= 0 && k < 127) ? k : -1;
    }
  }
  return out;
}

// Stable order by band at window w, fallback to sample index.
function _rowOrderByBandAt(labelByWinSam, nSam, nWin, w) {
  const cur = Math.max(0, Math.min(nWin - 1, w | 0));
  const base = cur * nSam;
  const idx = new Int32Array(nSam);
  for (let si = 0; si < nSam; si++) idx[si] = si;
  const arr = Array.from(idx);
  arr.sort((a, b) => {
    const ka = labelByWinSam[base + a];
    const kb = labelByWinSam[base + b];
    if (ka !== kb) {
      // Push unassigned (-1) to the bottom.
      if (ka < 0) return 1;
      if (kb < 0) return -1;
      return ka - kb;
    }
    return a - b;
  });
  return arr;
}

// Band index → RGB triple. Reuses groupColor() so heatmap palette
// matches the 3 PCA panels exactly. Unassigned bands render dark gray
// so they don't pretend to be a cluster.
function _bandRGB(k) {
  if (k < 0) return [22, 26, 34];
  const hex = groupColor(k);
  if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length !== 7) {
    return [205, 213, 225];
  }
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function _drawEmpty(ctx, w, h, msg) {
  ctx.fillStyle = 'rgba(160,180,200,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}

// 2026-05-20: resolve the focal slab bounds for the current scrubUnit.
// scrubUnit values are the comparator header's step picker:
//   '1' '5' '10' '25' → ±N/2 windows around cursor (clamped to chrom)
//   'L2'              → the L2 envelope containing cur (via sharedState.windowToL2)
//   'Cand'            → the candidate containing cur (via candidateList ranges)
// Falls back to ±5 windows when L2 / Cand can't resolve so the user
// always sees SOME slab, never an empty heatmap.
function _resolveFocalSlab(ss, scrubUnit, cur, nWin) {
  const clamp = (s, e) => ({
    start: Math.max(0, s | 0),
    end:   Math.min(nWin - 1, e | 0),
  });
  if (scrubUnit === 'L2') {
    const w2l = ss.windowToL2;
    const envs = ss.data && ss.data.l2_envelopes;
    if (w2l && envs && envs.length) {
      const l2 = w2l[cur] | 0;
      if (l2 >= 0 && envs[l2]) {
        const env = envs[l2];
        const s = (env._s0 != null) ? env._s0 : (env.start_w - 1);
        const e = (env._e0 != null) ? env._e0 : (env.end_w - 1);
        return clamp(s, e);
      }
    }
    return clamp(cur - 5, cur + 5);
  }
  if (scrubUnit === 'Cand') {
    const cands = ss.candidateList || [];
    for (const c of cands) {
      const s = (c.start_w | 0) - 1;
      const e = (c.end_w | 0) - 1;
      if (cur >= s && cur <= e) return clamp(s, e);
    }
    return clamp(cur - 5, cur + 5);
  }
  const halfW = Math.max(1, (parseInt(scrubUnit, 10) | 0)) >> 1;
  return clamp(cur - halfW, cur + halfW);
}

// Update the heatmap header text so "genome × samples" reads
// "slab w=A..B (Nw) × samples" in focal scope.
function _updateScopeLabel(scope, wStart, wEnd, scopeNWin, totalWin) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('pcaCompHeatmapScopeLabel');
  if (!el) return;
  if (scope === 'focal') {
    el.textContent = ` · slab w=${wStart}..${wEnd} (${scopeNWin}w) × samples · dosage K-band`;
  } else {
    el.textContent = ` · genome × samples · dosage K-band (${totalWin}w)`;
  }
}

function _fitCanvas(canvas, ctx) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = Math.max(1, (canvas.clientWidth  | 0));
  const cssH = Math.max(1, (canvas.clientHeight | 0));
  const targetW = Math.max(1, (cssW * dpr) | 0);
  const targetH = Math.max(1, (cssH * dpr) | 0);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width  = targetW;
    canvas.height = targetH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssW, cssH };
}
