// pages/discovery/pca_comparator/renderer.js
//
// Per-layer mini-PCA painter for the comparator. One function paints
// one panel against one of the 3 data sources (dosage, θπ, GHSL).
//
// Layer data sources at the current window state.sharedState.cur:
//   dosage:    state.sharedState.data.windows[cur].pc1[] / .pc2[]
//   theta_pi:  state.sharedState.data.theta_pi_local_pca[cur] (if loaded)
//   ghsl:      state.sharedState.data.ghsl_panel (if loaded)
//
// Coloring inherits from the anchor's K-means cluster (default
// dosage). For Phase 1 we read state.sharedState.lockedLabels when
// present (the user's pinned K-band assignment); otherwise we use the
// dosage K-means labels at the active L2 envelope. This matches how
// local_pca_dosage's drawPCA paints samples by groupColor — see
// SPEC_local_pca_comparator.md §State surface.

import { groupColor, getL2Cluster } from '../local_pca_dosage/_data.js';

const PANEL_PAD = { l: 28, r: 8, t: 12, b: 22 };
const POINT_R    = 3.6;
const POINT_R_HV = 6.0;     // hovered sample
const POINT_R_TR = 5.0;     // tracked sample

// Cache last-frame screen-space sample positions per layer for hit-test
// (findSampleAtPixel). Keyed by layer; reset on every paint.
const _lastScreenXY = {
  dosage:   null,
  theta_pi: null,
  ghsl:     null,
};
const _lastPlotRect = {
  dosage:   null,
  theta_pi: null,
  ghsl:     null,
};

// ---------------------------------------------------------------------------
// Public: paint one panel.
// ---------------------------------------------------------------------------
export function paintPanel(state, layer) {
  if (typeof document === 'undefined') return;
  const canvasId = state._canvasIds[layer];
  const statusId = state._statusIds[layer];
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const status = document.getElementById(statusId);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Size the canvas to its CSS box (retina-correct via DPR transform).
  const { cssW, cssH } = _fitCanvas(canvas, ctx);
  const w = cssW;
  const h = cssH;
  ctx.clearRect(0, 0, w, h);

  const ss = state.sharedState;
  if (!ss || !ss.data) {
    _drawEmpty(ctx, w, h, 'no chromosome loaded');
    if (status) status.textContent = 'no data';
    _lastScreenXY[layer] = null;
    _lastPlotRect[layer] = null;
    return;
  }

  const pts = _getLayerPoints(ss, layer);
  if (!pts || !pts.xs || !pts.ys) {
    _drawEmpty(ctx, w, h, pts && pts.reason ? pts.reason : `${layer} layer not loaded`);
    if (status) status.textContent = 'absent';
    _lastScreenXY[layer] = null;
    _lastPlotRect[layer] = null;
    return;
  }

  const nS = pts.xs.length;
  // Axis bounds: include all samples; pad 5% on each side.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let si = 0; si < nS; si++) {
    const x = pts.xs[si], y = pts.ys[si];
    if (!isFinite(x) || !isFinite(y)) continue;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  if (!isFinite(xMin) || xMin === xMax) { xMin -= 0.5; xMax += 0.5; }
  if (!isFinite(yMin) || yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  const padX = (xMax - xMin) * 0.05;
  const padY = (yMax - yMin) * 0.05;
  xMin -= padX; xMax += padX; yMin -= padY; yMax += padY;

  const plotW = w - PANEL_PAD.l - PANEL_PAD.r;
  const plotH = h - PANEL_PAD.t - PANEL_PAD.b;
  const toX = (v) => PANEL_PAD.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = (v) => PANEL_PAD.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Axis lines.
  ctx.strokeStyle = 'rgba(120,140,170,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PANEL_PAD.l, PANEL_PAD.t + plotH);
  ctx.lineTo(PANEL_PAD.l + plotW, PANEL_PAD.t + plotH);
  ctx.moveTo(PANEL_PAD.l, PANEL_PAD.t);
  ctx.lineTo(PANEL_PAD.l, PANEL_PAD.t + plotH);
  ctx.stroke();
  // Axis labels.
  ctx.fillStyle = 'rgba(160,180,200,0.8)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(pts.xLabel || 'PC1', PANEL_PAD.l + plotW / 2, h - 6);
  ctx.save();
  ctx.translate(10, PANEL_PAD.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(pts.yLabel || 'PC2', 0, 0);
  ctx.restore();

  // K-band labels from the anchor.
  const groupLabels = _resolveAnchorLabels(state);

  // Plot samples.
  const screenXY = new Float32Array(nS * 2);
  const trackedSet = new Set(ss.tracked || []);
  for (let si = 0; si < nS; si++) {
    const x = pts.xs[si], y = pts.ys[si];
    if (!isFinite(x) || !isFinite(y)) {
      screenXY[si * 2]     = -1;
      screenXY[si * 2 + 1] = -1;
      continue;
    }
    const px = toX(x), py = toY(y);
    screenXY[si * 2]     = px;
    screenXY[si * 2 + 1] = py;
    const k = groupLabels ? groupLabels[si] : -1;
    const col = (k != null && k >= 0) ? (groupColor(k) || '#cdd5e1') : '#7a8696';
    const isHovered = (si === state.hoveredSample);
    const isTracked = trackedSet.has(si);
    const r = isHovered ? POINT_R_HV : (isTracked ? POINT_R_TR : POINT_R);
    ctx.fillStyle = isHovered ? col : _withAlpha(col, isTracked ? 0.85 : 0.55);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    if (isHovered || isTracked) {
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  if (status) {
    const nValid = _countValid(pts.xs, pts.ys);
    status.textContent = `n=${nValid}/${nS}`;
  }

  // Stash for hit-test.
  _lastScreenXY[layer] = screenXY;
  _lastPlotRect[layer] = { x: PANEL_PAD.l, y: PANEL_PAD.t, w: plotW, h: plotH };
}

// ---------------------------------------------------------------------------
// Hit-test — return the sample index under (px, py) for a given panel.
// ---------------------------------------------------------------------------
export function findSampleAtPixel(state, layer, x, y) {
  const screenXY = _lastScreenXY[layer];
  const rect     = _lastPlotRect[layer];
  if (!screenXY || !rect) return -1;
  if (x < rect.x - 2 || x > rect.x + rect.w + 2) return -1;
  if (y < rect.y - 2 || y > rect.y + rect.h + 2) return -1;
  const HIT_R2 = (POINT_R_HV + 2) * (POINT_R_HV + 2);
  let best = -1, bestD2 = HIT_R2;
  const nS = screenXY.length / 2;
  for (let si = 0; si < nS; si++) {
    const sx = screenXY[si * 2];
    const sy = screenXY[si * 2 + 1];
    if (sx < 0) continue;
    const dx = sx - x, dy = sy - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = si; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Layer accessors. Returns { xs, ys, xLabel, yLabel, reason? }.
//
// Data shapes (confirmed 2026-05-19 against actual pipeline output):
//   dosage:   d.windows[cur].pc1[s] / .pc2[s]           — per-window object
//   theta_pi: d.theta_pi_local_pca.pc_loadings_aligned  — [npc][n_windows][n_samples]
//             so PC1 at window cur = pc_loadings_aligned[0][cur] (length n_samples).
//   ghsl:     d.ghsl_local_pca.pc_loadings_aligned      — same [npc][nwin][nS] layout
//             (NOT d.ghsl_panel.local_pca — that path is from an older schema draft).
// ---------------------------------------------------------------------------
function _getLayerPoints(sharedState, layer) {
  const d = sharedState.data;
  if (!d) return null;
  const cur = sharedState.cur | 0;
  if (layer === 'dosage') {
    if (!d.windows || !d.windows[cur]) return { reason: 'window absent' };
    const w = d.windows[cur];
    if (!w.pc1 || !w.pc2) return { reason: 'PC1/PC2 absent on window' };
    return { xs: w.pc1, ys: w.pc2, xLabel: 'PC1 (dosage)', yLabel: 'PC2 (dosage)' };
  }
  if (layer === 'theta_pi') {
    const lp = d.theta_pi_local_pca;
    if (!lp) return { reason: 'theta_pi_local_pca not loaded' };
    return _getPointsFromLoadings(lp, cur, 'θπ');
  }
  if (layer === 'ghsl') {
    // Prefer the canonical top-level ghsl_local_pca (matches theta-pi layout).
    // Fall back to the legacy d.ghsl_panel.local_pca for older fixtures.
    const lp = d.ghsl_local_pca || (d.ghsl_panel && d.ghsl_panel.local_pca);
    if (!lp) return { reason: 'ghsl_local_pca not loaded' };
    return _getPointsFromLoadings(lp, cur, 'GHSL');
  }
  return null;
}

// Common helper: extract PC1/PC2 at window `cur` from a `*_local_pca` block.
// Supports two shapes:
//   (a) pc_loadings_aligned: [npc][n_windows][n_samples]  ← actual pipeline output
//   (b) per-window object: lp.windows[cur].pc1/pc2        ← older draft schema
function _getPointsFromLoadings(lp, cur, axisLabel) {
  if (lp.pc_loadings_aligned) {
    const a = lp.pc_loadings_aligned;
    if (!Array.isArray(a) || a.length < 2) return { reason: `${axisLabel}: pc_loadings_aligned needs ≥2 PCs` };
    const pc1Series = a[0];
    const pc2Series = a[1];
    if (!Array.isArray(pc1Series) || cur >= pc1Series.length) {
      return { reason: `${axisLabel}: no PC at window ${cur}` };
    }
    return {
      xs: pc1Series[cur],
      ys: pc2Series[cur],
      xLabel: `PC1 (${axisLabel})`,
      yLabel: `PC2 (${axisLabel})`,
    };
  }
  // Legacy fallback.
  const w = Array.isArray(lp) ? lp[cur] : (lp.windows && lp.windows[cur]);
  if (!w || !w.pc1 || !w.pc2) return { reason: `${axisLabel}: no PC at window ${cur}` };
  return { xs: w.pc1, ys: w.pc2, xLabel: `PC1 (${axisLabel})`, yLabel: `PC2 (${axisLabel})` };
}

// Resolve K-band labels from the anchor source.
function _resolveAnchorLabels(state) {
  const ss = state.sharedState;
  if (!ss || !ss.data) return null;
  // For now all 3 anchor options pull from the dosage K-means since
  // that's the only fully-wired clustering. θπ + GHSL anchor options
  // will activate once those layers ship their own clusterings.
  // User-visible: the dropdown is informational in Phase 1; consistent
  // K-band coloring across panels is the goal.
  if (ss.lockedLabels) return ss.lockedLabels;
  const curL2 = ss.windowToL2 ? ss.windowToL2[ss.cur] : -1;
  if (curL2 < 0) return null;
  const cl = getL2Cluster(ss, curL2);
  return cl && cl.labels ? cl.labels : null;
}

function _countValid(xs, ys) {
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    if (isFinite(xs[i]) && isFinite(ys[i])) n++;
  }
  return n;
}

function _drawEmpty(ctx, w, h, msg) {
  ctx.fillStyle = 'rgba(160,180,200,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}

// Size the canvas backing-store to CSS-pixel × DPR and pre-transform
// the context so the caller can draw in CSS pixels (no DPR math at
// every call site). Returns the CSS-pixel dimensions.
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

function _withAlpha(col, a) {
  if (typeof col !== 'string') return col;
  if (col.startsWith('#') && col.length === 7) {
    const r = parseInt(col.slice(1, 3), 16);
    const g = parseInt(col.slice(3, 5), 16);
    const b = parseInt(col.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (col.startsWith('rgb(')) {
    return col.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  }
  return col;
}
