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
    // 2026-05-20: also check the namespaced theta_pi_view for parity with
    // the GHSL branch below — when scrubber_thetapi data lands via the
    // selective merge in local_pca_dosage.mount, the canonical PC loadings
    // wind up under d.theta_pi_view.theta_pi_local_pca, not at top level.
    const lp =
         d.theta_pi_local_pca
      || (d.theta_pi_view && d.theta_pi_view.theta_pi_local_pca)
      || (d.theta_pi_view && d.theta_pi_view.local_pca);
    if (!lp) {
      const chrom = d.chrom || '?';
      return {
        reason: `θπ: layer not available for ${chrom} — the theta-pi pipeline (precomp_thetapi root) hasn't produced this chromosome yet.`,
      };
    }
    return _getPointsFromLoadings(lp, cur, 'θπ');
  }
  if (layer === 'ghsl') {
    // 2026-05-20: widen the lookup. The selective merge in
    // local_pca_dosage.mount() only copies top-level keys whose name
    // starts with 'ghsl', so a GHSL precomp shipping `local_pca` (no
    // prefix) ends up under d.ghsl_view.local_pca only. We also check
    // the namespaced d.ghsl_view.ghsl_local_pca for parity with the
    // top-level path. Quentin (2026-05-20): "GHSL local PCA not loaded
    // despite being loaded for that chrom in the cross evidence PCA
    // comparator."
    const lp =
         d.ghsl_local_pca
      || (d.ghsl_view && d.ghsl_view.ghsl_local_pca)
      || (d.ghsl_view && d.ghsl_view.local_pca)
      || (d.ghsl_panel && d.ghsl_panel.local_pca);
    if (!lp) {
      const chrom = d.chrom || '?';
      return {
        reason: `GHSL: layer not available for ${chrom} — the GHSL pipeline (precomp_ghsl root) hasn't produced this chromosome yet.`,
      };
    }
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
    if (!Array.isArray(a) || a.length < 2) {
      return { reason: `${axisLabel}: pc_loadings_aligned has ${a && a.length || 0} PC${(a && a.length) === 1 ? '' : 's'} (need ≥ 2)` };
    }
    const pc1Series = a[0];
    const pc2Series = a[1];
    // 2026-05-20: explain WHY the window isn't covered. The pipeline
    // often produces fewer per-window PC rows than the chromosome has
    // total dosage windows (θπ + GHSL are run on subsets). The blunt
    // "no PC at window N" left the user wondering whether the layer
    // was broken — this gives them the data extent so they can scrub
    // back into the covered range. Quentin: "sometimes it says like
    // no data for this window but maybe idk".
    if (!Array.isArray(pc1Series)) {
      return { reason: `${axisLabel}: PC1 series not an array (got ${typeof pc1Series})` };
    }
    if (cur >= pc1Series.length) {
      const lastBp = lp.windows && lp.windows[pc1Series.length - 1] && lp.windows[pc1Series.length - 1].end_bp;
      const mb = Number.isFinite(lastBp) ? ` (~${(lastBp / 1e6).toFixed(1)} Mb)` : '';
      return {
        reason: `${axisLabel}: cursor at window ${cur} — past the ${axisLabel} data extent (${pc1Series.length} windows${mb}). Scrub left to enter the covered range.`,
      };
    }
    if (cur < 0) {
      return { reason: `${axisLabel}: cursor at window ${cur} — left of window 0. Scrub right.` };
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

// ---------------------------------------------------------------------------
// Per-sample lines panel — one polyline per sample showing PC1 (or PC2)
// across all windows for the anchor layer. Lets the user see where the
// active cursor sits in the chromosome-wide signal and click anywhere on
// the strip to jump the cursor there. Read-only otherwise.
//
// `axis` is 'pc1' or 'pc2'.
// ---------------------------------------------------------------------------
const _lastLinesRect = { x: 0, y: 0, w: 0, h: 0, mbMin: 0, mbMax: 0, nWin: 0 };

export function paintLines(state, axis) {
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('pcaCompLinesCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cssW: w, cssH: h } = _fitCanvas(canvas, ctx);
  ctx.clearRect(0, 0, w, h);

  const ss = state.sharedState;
  if (!ss || !ss.data) {
    _drawEmpty(ctx, w, h, 'no chromosome loaded');
    return;
  }
  const d = ss.data;
  const nWin = (Array.isArray(d.windows) && d.windows.length) || (d.n_windows | 0);
  if (!nWin) { _drawEmpty(ctx, w, h, 'no windows'); return; }

  const anchor = state.anchor || 'dosage';
  const axKey = (axis === 'pc2') ? 'pc2' : 'pc1';
  // Series shape: [nWin] each containing length-nS Float arrays.
  const series = _getPerWindowSeries(d, anchor, axKey);
  if (!series || !series.byWin) {
    _drawEmpty(ctx, w, h, series && series.reason ? series.reason : 'no per-sample series');
    return;
  }

  const pad = { l: 36, r: 8, t: 8, b: 18 };
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = Math.max(1, h - pad.t - pad.b);

  // X is centre_mb if available, else window index.
  const mbs = [];
  let haveMb = true;
  for (let i = 0; i < nWin; i++) {
    const w0 = d.windows && d.windows[i];
    const mb = w0 && Number.isFinite(w0.center_mb) ? +w0.center_mb : NaN;
    if (!Number.isFinite(mb)) haveMb = false;
    mbs.push(mb);
  }
  let mbMin = 0, mbMax = nWin - 1;
  if (haveMb) {
    mbMin = mbs[0]; mbMax = mbs[nWin - 1];
    if (mbMax <= mbMin) mbMax = mbMin + 1;
  }
  const toX = (i) => {
    if (haveMb) return pad.l + ((mbs[i] - mbMin) / (mbMax - mbMin)) * plotW;
    return pad.l + (i / Math.max(1, nWin - 1)) * plotW;
  };

  // Compute robust y range across visible samples + windows.
  let yMin = +Infinity, yMax = -Infinity;
  for (let i = 0; i < nWin; i++) {
    const v = series.byWin[i];
    if (!v) continue;
    for (let s = 0; s < v.length; s++) {
      const y = v[s];
      if (!Number.isFinite(y)) continue;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax === yMin) {
    yMin = -1; yMax = 1;
  }
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad; yMax += yPad;
  const toY = (y) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  // 2026-05-20: offscreen-canvas cache for the polyline pass. Keyed by
  // the inputs that change the polyline geometry. Cursor scrub / hover
  // don't invalidate it, so left/right arrow stays instant after the
  // first paint. Decimation: when n_windows is huge (LG01 ~9000), we
  // sample every K-th window so the polyline pass stays under ~100ms.
  const chrom = d.chrom || '?';
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cacheKey = [chrom, anchor, axKey, nWin, w | 0, h | 0, dpr,
                    yMin.toFixed(4), yMax.toFixed(4), haveMb ? 1 : 0,
                    series.nSamples | 0].join('|');
  const cache = state._linesBgCache;
  let bg = cache && cache.key === cacheKey ? cache.canvas : null;
  if (!bg) {
    // Decimate when n_windows > 2000 — paint every K-th window so the
    // polyline op count stays bounded. The visual resolution stays
    // good because the cached canvas is 1:1 with the live canvas;
    // we're just dropping window-grid density, not pixel density.
    const stride = Math.max(1, Math.ceil(nWin / 2000));
    bg = _renderLinesBackground(w, h, dpr, pad, plotW, plotH, series,
                                 toX, toY, nWin, stride);
    state._linesBgCache = { key: cacheKey, canvas: bg };
  }

  // Background plot area + axis ticks (light) drawn on the LIVE canvas
  // (so they always reflect the current geometry; cheap).
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(pad.l, pad.t, plotW, plotH);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + plotH + 0.5);
  ctx.lineTo(pad.l + plotW, pad.t + plotH + 0.5);
  ctx.stroke();

  // Blit the cached polyline canvas.
  ctx.drawImage(bg, 0, 0, w, h);

  // Hovered-sample re-stroke on top (cheap — single polyline). This is
  // why we don't bake the hover state into the cache: hovering would
  // invalidate it on every mousemove and defeat the point of caching.
  if (state.hoveredSample >= 0 && state.hoveredSample < series.nSamples) {
    const s = state.hoveredSample;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#f5a524';
    ctx.beginPath();
    let started = false;
    const stride = Math.max(1, Math.ceil(nWin / 2000));
    for (let i = 0; i < nWin; i += stride) {
      const v = series.byWin[i];
      if (!v) { started = false; continue; }
      const y = v[s];
      if (!Number.isFinite(y)) { started = false; continue; }
      const xx = toX(i), yy = toY(y);
      if (!started) { ctx.moveTo(xx, yy); started = true; }
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }

  // Cursor.
  const cur = Math.max(0, Math.min(nWin - 1, ss.cur | 0));
  const xCur = toX(cur);
  ctx.strokeStyle = '#f5a524';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(xCur + 0.5, pad.t);
  ctx.lineTo(xCur + 0.5, pad.t + plotH);
  ctx.stroke();

  // Axis labels.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`${anchor} ${axKey.toUpperCase()}`, pad.l + 4, pad.t + 2);
  if (haveMb) {
    ctx.textAlign = 'left';
    ctx.fillText(`${mbMin.toFixed(2)} Mb`, pad.l, pad.t + plotH + 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${mbMax.toFixed(2)} Mb`, pad.l + plotW, pad.t + plotH + 4);
  }

  _lastLinesRect.x = pad.l;
  _lastLinesRect.y = pad.t;
  _lastLinesRect.w = plotW;
  _lastLinesRect.h = plotH;
  _lastLinesRect.mbMin = haveMb ? mbMin : 0;
  _lastLinesRect.mbMax = haveMb ? mbMax : (nWin - 1);
  _lastLinesRect.nWin = nWin;
  _lastLinesRect.haveMb = haveMb;
}

// 2026-05-20: render the per-sample polylines into an offscreen canvas
// for caching. Decimation stride drops the per-window step count when
// n_windows is huge — at stride=K we plot every Kth window, keeping
// the polyline op count bounded while preserving visual resolution
// (the canvas is already pixel-aligned with the live canvas). Returns
// an OffscreenCanvas or a regular HTMLCanvasElement (both blittable
// via ctx.drawImage). DPR-aware so the cached image stays crisp on
// retina displays.
function _renderLinesBackground(w, h, dpr, pad, plotW, plotH, series,
                                 toX, toY, nWin, stride) {
  const cw = Math.max(1, Math.ceil(w * dpr));
  const ch = Math.max(1, Math.ceil(h * dpr));
  let off;
  if (typeof OffscreenCanvas === 'function') {
    off = new OffscreenCanvas(cw, ch);
  } else {
    off = document.createElement('canvas');
    off.width = cw; off.height = ch;
  }
  const o = off.getContext('2d');
  if (!o) return off;
  o.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Don't paint the plot frame here — the live canvas redraws it each
  // frame so the cached image is JUST polylines (which is what's
  // expensive). Light-blue translucent strokes match the live theme.
  o.lineWidth = 0.8;
  o.globalAlpha = 0.55;
  o.strokeStyle = 'rgba(160,200,235,0.6)';
  const nS = series.nSamples | 0;
  for (let s = 0; s < nS; s++) {
    o.beginPath();
    let started = false;
    for (let i = 0; i < nWin; i += stride) {
      const v = series.byWin[i];
      if (!v) { started = false; continue; }
      const y = v[s];
      if (!Number.isFinite(y)) { started = false; continue; }
      const xx = toX(i), yy = toY(y);
      if (!started) { o.moveTo(xx, yy); started = true; }
      else o.lineTo(xx, yy);
    }
    o.stroke();
  }
  return off;
}

// ---------------------------------------------------------------------------
// Phase 2 (2026-05-20): per-sample 3-axis trajectory + concordance score.
//
// `paintTrajectory(state, si)` paints the sample's (PC1, PC2) trajectory
// across all windows into 3 stacked canvases — one per evidence axis.
// Each canvas plots PC1 vs. PC2 with the cursor's window marked as a
// bright dot and the rest of the trajectory as a faint polyline so the
// reader can see "does this fish loop / drift in similar shapes across
// the 3 axes?"
//
// `computeConcordance(state, si)` returns the fraction of windows where
// the sample's PC1 SIGN agrees across all 3 axes (a rough proxy for
// "this fish is on the same haplotype side in all three signals"). The
// header badge surfaces this as a 0-100% number with green/amber/red
// tinting. Cheap to compute and meaningful for the inversion use case.
// ---------------------------------------------------------------------------

const _TRAJ_CANVAS_IDS = {
  dosage:   'pcaCompTrajDosage',
  theta_pi: 'pcaCompTrajThetaPi',
  ghsl:     'pcaCompTrajGhsl',
};

export function paintTrajectory(state, si) {
  if (typeof document === 'undefined') return;
  if (!Number.isFinite(si) || si < 0) return;
  const ss = state && state.sharedState;
  if (!ss || !ss.data) return;
  const d = ss.data;
  for (const layer of ['dosage', 'theta_pi', 'ghsl']) {
    const canvas = document.getElementById(_TRAJ_CANVAS_IDS[layer]);
    if (!canvas) continue;
    _paintOneTrajectory(state, canvas, layer, si, d);
  }
}

function _paintOneTrajectory(state, canvas, layer, si, d) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cssW: w, cssH: h } = _fitCanvas(canvas, ctx);
  ctx.clearRect(0, 0, w, h);
  // Walk all windows; collect (pc1, pc2) per window for this sample.
  const xs = [], ys = [];
  const ss = state.sharedState;
  const cur = ss.cur | 0;
  const nWin = (Array.isArray(d.windows) && d.windows.length) || (d.n_windows | 0);
  for (let i = 0; i < nWin; i++) {
    let pc1Vec = null, pc2Vec = null;
    if (layer === 'dosage') {
      const w0 = d.windows[i];
      if (w0 && w0.pc1 && w0.pc2) { pc1Vec = w0.pc1; pc2Vec = w0.pc2; }
    } else {
      const lp = _resolveLp(d, layer);
      if (lp && Array.isArray(lp.pc_loadings_aligned)) {
        const a = lp.pc_loadings_aligned;
        if (a[0] && a[1] && i < a[0].length) {
          pc1Vec = a[0][i]; pc2Vec = a[1][i];
        }
      }
    }
    if (!pc1Vec || !pc2Vec || si >= pc1Vec.length) { xs.push(NaN); ys.push(NaN); continue; }
    xs.push(+pc1Vec[si]); ys.push(+pc2Vec[si]);
  }
  // Plot bounds.
  let xMin = +Infinity, xMax = -Infinity, yMin = +Infinity, yMax = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    if (xs[i] < xMin) xMin = xs[i]; if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i]; if (ys[i] > yMax) yMax = ys[i];
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    _drawEmpty(ctx, w, h, `${layer} — no data`);
    return;
  }
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) yMax = yMin + 1;
  const pad = { l: 6, r: 6, t: 14, b: 6 };
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = Math.max(1, h - pad.t - pad.b);
  const toX = (v) => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  // Faint trajectory polyline.
  ctx.strokeStyle = 'rgba(160,200,235,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { started = false; continue; }
    const X = toX(xs[i]), Y = toY(ys[i]);
    if (!started) { ctx.moveTo(X, Y); started = true; }
    else ctx.lineTo(X, Y);
  }
  ctx.stroke();
  // Dots: small everywhere, bright at the current cursor's window.
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    const X = toX(xs[i]), Y = toY(ys[i]);
    ctx.fillStyle = (i === cur) ? '#f5a524' : 'rgba(120,160,200,0.45)';
    const r = (i === cur) ? 3 : 1.2;
    ctx.beginPath();
    ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Header label.
  ctx.fillStyle = 'rgba(160,180,200,0.75)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(layer, 4, 2);
}

function _resolveLp(d, layer) {
  if (layer === 'theta_pi') {
    return d.theta_pi_local_pca
        || (d.theta_pi_view && d.theta_pi_view.theta_pi_local_pca)
        || (d.theta_pi_view && d.theta_pi_view.local_pca);
  }
  if (layer === 'ghsl') {
    return d.ghsl_local_pca
        || (d.ghsl_view && d.ghsl_view.ghsl_local_pca)
        || (d.ghsl_view && d.ghsl_view.local_pca)
        || (d.ghsl_panel && d.ghsl_panel.local_pca);
  }
  return null;
}

export function computeConcordance(state, si) {
  const ss = state && state.sharedState;
  if (!ss || !ss.data || !Number.isFinite(si) || si < 0) return null;
  const d = ss.data;
  const nWin = (Array.isArray(d.windows) && d.windows.length) || (d.n_windows | 0);
  if (nWin <= 0) return null;
  const tpiLp = _resolveLp(d, 'theta_pi');
  const ghslLp = _resolveLp(d, 'ghsl');
  if (!tpiLp && !ghslLp) return null;
  const tpiPc1 = tpiLp && tpiLp.pc_loadings_aligned && tpiLp.pc_loadings_aligned[0];
  const ghslPc1 = ghslLp && ghslLp.pc_loadings_aligned && ghslLp.pc_loadings_aligned[0];
  let agree = 0, total = 0;
  for (let i = 0; i < nWin; i++) {
    const dw = d.windows[i];
    if (!dw || !dw.pc1) continue;
    const dPc1 = dw.pc1[si];
    if (!Number.isFinite(dPc1)) continue;
    const tPc1 = (tpiPc1 && tpiPc1[i] && Number.isFinite(tpiPc1[i][si])) ? tpiPc1[i][si] : null;
    const gPc1 = (ghslPc1 && ghslPc1[i] && Number.isFinite(ghslPc1[i][si])) ? ghslPc1[i][si] : null;
    // Need at least 2 layers' PC1 to compare; count windows where all 3 are present.
    if (tPc1 == null && gPc1 == null) continue;
    total++;
    const dSign = dPc1 >= 0 ? 1 : -1;
    let layersAgree = 0;
    let layersChecked = 0;
    if (tPc1 != null) { layersChecked++; if ((tPc1 >= 0 ? 1 : -1) === dSign) layersAgree++; }
    if (gPc1 != null) { layersChecked++; if ((gPc1 >= 0 ? 1 : -1) === dSign) layersAgree++; }
    if (layersChecked > 0 && layersAgree === layersChecked) agree++;
  }
  if (total === 0) return null;
  return { agree, total, frac: agree / total };
}

// Click-to-scrub: translate an x pixel coordinate inside the lines canvas
// into the corresponding window index. Returns -1 if outside the plot box.
export function windowAtLinesX(px) {
  const r = _lastLinesRect;
  if (!r || !r.w) return -1;
  if (px < r.x || px > r.x + r.w) return -1;
  const frac = (px - r.x) / r.w;
  return Math.max(0, Math.min(r.nWin - 1, Math.round(frac * (r.nWin - 1))));
}

// Build per-window arrays of length n_samples for the chosen anchor + axis.
function _getPerWindowSeries(d, anchor, axKey) {
  const nWin = (Array.isArray(d.windows) && d.windows.length) || (d.n_windows | 0);
  if (!nWin) return null;
  if (anchor === 'dosage') {
    const byWin = new Array(nWin);
    let nSamples = 0;
    for (let i = 0; i < nWin; i++) {
      const w = d.windows[i];
      const v = w && w[axKey];
      byWin[i] = (v && v.length) ? v : null;
      if (v && v.length > nSamples) nSamples = v.length;
    }
    if (!nSamples) return { reason: 'dosage: no per-sample PC on windows' };
    return { byWin, nSamples };
  }
  if (anchor === 'theta_pi') {
    // 2026-05-20: namespaced-view fallback (see _getLayerPoints).
    const lp =
         d.theta_pi_local_pca
      || (d.theta_pi_view && d.theta_pi_view.theta_pi_local_pca)
      || (d.theta_pi_view && d.theta_pi_view.local_pca);
    if (!lp || !lp.pc_loadings_aligned) return { reason: 'θπ: pc_loadings_aligned absent' };
    return _seriesFromLoadings(lp.pc_loadings_aligned, axKey, nWin, 'θπ');
  }
  if (anchor === 'ghsl') {
    const lp =
         d.ghsl_local_pca
      || (d.ghsl_view && d.ghsl_view.ghsl_local_pca)
      || (d.ghsl_view && d.ghsl_view.local_pca)
      || (d.ghsl_panel && d.ghsl_panel.local_pca);
    if (!lp || !lp.pc_loadings_aligned) return { reason: 'GHSL: pc_loadings_aligned absent' };
    return _seriesFromLoadings(lp.pc_loadings_aligned, axKey, nWin, 'GHSL');
  }
  return null;
}

function _seriesFromLoadings(loadings, axKey, nWin, label) {
  if (!Array.isArray(loadings) || loadings.length < 1) return { reason: `${label}: pc_loadings_aligned empty` };
  const pcIdx = (axKey === 'pc2') ? 1 : 0;
  const pcSeries = loadings[pcIdx];
  if (!Array.isArray(pcSeries)) return { reason: `${label}: PC${pcIdx + 1} series not array` };
  const byWin = new Array(nWin);
  let nSamples = 0;
  for (let i = 0; i < nWin; i++) {
    const v = pcSeries[i];
    byWin[i] = (v && v.length) ? v : null;
    if (v && v.length > nSamples) nSamples = v.length;
  }
  if (!nSamples) return { reason: `${label}: no per-sample values in PC${pcIdx + 1}` };
  return { byWin, nSamples };
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

// 2026-05-20: word-wrap the empty-state message so longer explanations
// (e.g. "cursor at window N — past the θπ data extent (M windows ~X Mb).
// Scrub left to enter the covered range.") render readably instead of
// truncating off the right edge.
function _drawEmpty(ctx, w, h, msg) {
  ctx.fillStyle = 'rgba(160,180,200,0.65)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = Math.max(80, w - 32);
  const lineH = 14;
  const words = String(msg || '').split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? (cur + ' ' + word) : word;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length === 0) lines.push(String(msg || ''));
  const totalH = lines.length * lineH;
  let y = h / 2 - totalH / 2 + lineH / 2;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }
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
