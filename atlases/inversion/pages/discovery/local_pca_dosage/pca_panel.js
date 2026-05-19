// pages/discovery/local_pca_dosage/pca_panel.js
//
// PCA scatter panel + anchor strip + tracked-list / manual-groups
// sidebars (round 4 split, 2026-05-06).
//
// drawPCA:           PC scatter for the current window (and overlay of
//                    tracked / locked / anchor samples).
// drawAnchorStrip:   strip showing the per-anchor concord with the
//                    current L2 envelope.
// recomputeAnchorConcord / _refreshScreeInset: support for the strip.
// renderTrackedList / renderManualGroupsList: sidebars listing tracked
//                    samples and user-defined manual groups.
// togglePlay / cycleKAside / autoPickRadial: PC-scatter UI controls.
//
// Bodies extracted verbatim from the pre-split local_pca_dosage.js (eighth pass).

import { escapeHtml, fitCanvas, themeColor, withAlpha } from '../../../shared/page1_utils.js';
import { contextFromState, sampleSpreadL2 } from '../../../shared/per_l2_cluster.js';
import { perSampleValuesForMode } from '../../../shared/per_sample_line_color.js';

import { _pageState, _setActiveState, _vColor, getSampleColor, trackedColor } from './_state.js';

// 2026-05-20: ramp modes whose per-sample values getSampleColor maps
// through perSampleColorFor. drawPCA pre-computes the value array once
// per frame and stashes it on state._pcaModePsVals so the inner sample
// loop just does a Float64Array index lookup + color mapping.
const _PCA_RAMP_MODES = new Set([
  'het', 'dosage', 'theta_pi', 'ghsl', 'froh', 'confounder_alert',
]);
import { allSampleIdx, availablePCs, getActiveModeView, getL2Cluster, getPC, getPCRender, groupColor, setPcaXY, setViewControlsLinked } from './_data.js';
import { buildLinesPanel, buildLinesPanelCheckboxes } from './lines_panel.js';
import { drawLinesPanel } from './lines_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { refreshBandPickBar } from './candidates.js';
import { _updateConcordBadge, onPCAClick, renderZoneBlock, setCur } from './events.js';
import { addToManualGroup } from './manual_groups.js';

// --- _K_CYCLE_ORDER — legacy line 56536 ---
// K-cycle button cycles state.k through this sequence.
const _K_CYCLE_ORDER = [3, 4, 5, 6, 2];

// --- _cramersV — legacy lines 36046-36077 ---
// Compute Cramér's V from a K_a × K_c contingency table (already counts).
// Returns NaN if the table is degenerate.
function _cramersV(table, K_a, K_c) {
  let n = 0;
  const rowSums = new Array(K_a).fill(0);
  const colSums = new Array(K_c).fill(0);
  for (let i = 0; i < K_a; i++) {
    for (let j = 0; j < K_c; j++) {
      const v = table[i * K_c + j];
      n += v; rowSums[i] += v; colSums[j] += v;
    }
  }
  if (n < 2) return NaN;
  let nzR = 0, nzC = 0;
  for (let i = 0; i < K_a; i++) if (rowSums[i] > 0) nzR++;
  for (let j = 0; j < K_c; j++) if (colSums[j] > 0) nzC++;
  if (nzR < 2 || nzC < 2) return 0;
  let chi2 = 0;
  for (let i = 0; i < K_a; i++) {
    for (let j = 0; j < K_c; j++) {
      const exp = (rowSums[i] * colSums[j]) / n;
      if (exp > 0) {
        const o = table[i * K_c + j];
        const d = o - exp;
        chi2 += d * d / exp;
      }
    }
  }
  const minDim = Math.min(nzR, nzC) - 1;
  if (minDim < 1) return 0;
  const v = Math.sqrt(chi2 / (n * minDim));
  return Math.max(0, Math.min(1, v));
}

// --- _ensureAnchor — legacy lines 35979-36040 ---
// Set anchor if tracked is non-empty AND no anchor exists yet. Extend
// anchor if tracked has new samples not yet in anchor.labels. v3.58: if
// the anchor window is OUTSIDE any L2 envelope, fall back to the NEAREST.
function _ensureAnchor() {
  const state = _pageState;
  if (!state || !state.data) return;
  if (state.tracked.length === 0) {
    state.trackingAnchor = null;
    state.anchorConcord = null;
    return;
  }
  const curWin = state.cur | 0;
  if (!state.trackingAnchor) {
    state.trackingAnchor = {
      winIdx: curWin,
      labels: new Map(),  // sampleIdx -> int label (or -1 if no L2 at anchor)
      K: state.k,
    };
  }
  const anchor = state.trackingAnchor;
  // If state.k changed since anchor was set, re-anchor with new K
  if (anchor.K !== state.k) {
    anchor.labels = new Map();
    anchor.K = state.k;
  }
  // v3.58: if the anchor window is OUTSIDE any L2 envelope, fall back to
  // the NEAREST L2 envelope by window distance.
  let anchorL2 = (state.windowToL2 && anchor.winIdx >= 0)
    ? state.windowToL2[anchor.winIdx] : -1;
  if (anchorL2 < 0 && Array.isArray(state.data.l2_envelopes) &&
      state.data.l2_envelopes.length > 0) {
    let bestL2 = -1, bestD = Infinity;
    for (let l2i = 0; l2i < state.data.l2_envelopes.length; l2i++) {
      const env = state.data.l2_envelopes[l2i];
      if (!env || env._s0 == null) continue;
      const d = (anchor.winIdx < env._s0)
        ? (env._s0 - anchor.winIdx)
        : (anchor.winIdx > env._e0 ? anchor.winIdx - env._e0 : 0);
      if (d < bestD) { bestD = d; bestL2 = l2i; }
    }
    anchorL2 = bestL2;
  }
  let anchorLabels = null;
  if (anchorL2 >= 0) {
    const cl = getL2Cluster(state, anchorL2);
    if (cl && cl.labels) anchorLabels = cl.labels;
  }
  for (const si of state.tracked) {
    if (anchor.labels.has(si)) continue;
    const lbl = (anchorLabels && si < anchorLabels.length) ? anchorLabels[si] : -1;
    anchor.labels.set(si, lbl);
  }
  // Drop entries for samples that are no longer tracked
  const trackedSet = new Set(state.tracked);
  for (const si of [...anchor.labels.keys()]) {
    if (!trackedSet.has(si)) anchor.labels.delete(si);
  }
}

// --- _renderScreeInsetHTML — legacy lines 56422-56493 ---
// Pure SVG string renderer. Returns the inset's innerHTML or '' when the
// inset shouldn't render. Reads state.cur and state.data.windows[].
const _SCREE_BAR_COLORS = ['#4fa3ff', '#f5a524', '#3cc08a', '#e0555c', '#b07cf7', '#5dc4d6', '#888'];
function _renderScreeInsetHTML() {
  const state = _pageState;
  if (!state || !state.screePlotEnabled) return '';
  if (!state.data || !Array.isArray(state.data.windows)) return '';
  if (state.cur == null || state.cur < 0 || state.cur >= state.data.windows.length) return '';
  const w = state.data.windows[state.cur];
  if (!w) return '';
  let spectrum = null;
  let isFallback = false;
  if (Array.isArray(w.lam_top_k) && w.lam_top_k.length >= 2) {
    spectrum = w.lam_top_k.filter(v => Number.isFinite(v) && v > 0);
  } else if (Number.isFinite(w.lam1) && Number.isFinite(w.lam2)) {
    spectrum = [w.lam1, w.lam2].filter(v => Number.isFinite(v) && v > 0);
    isFallback = true;
  }
  if (!spectrum || spectrum.length < 2) return '';
  spectrum = spectrum.slice(0, 7);
  spectrum = spectrum.slice().sort((a, b) => b - a);
  const svgW = 100, svgH = 38;
  const padL = 2, padR = 2, padTop = 2, padBot = 2;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padTop - padBot;
  const nBars = spectrum.length;
  const barW = plotW / nBars - 1.5;
  const lamMax = spectrum[0];
  const bars = [];
  for (let i = 0; i < nBars; i++) {
    const lam = spectrum[i];
    const hFrac = lamMax > 0 ? (lam / lamMax) : 0;
    const barH = Math.max(1, hFrac * plotH);
    const barX = padL + i * (plotW / nBars);
    const barY = padTop + (plotH - barH);
    const color = _SCREE_BAR_COLORS[i] || _SCREE_BAR_COLORS[_SCREE_BAR_COLORS.length - 1];
    bars.push(
      '<rect class="scree-inset-bar" x="' + barX.toFixed(1) + '" y="' + barY.toFixed(1) +
      '" width="' + barW.toFixed(1) + '" height="' + barH.toFixed(1) +
      '" fill="' + color + '"></rect>'
    );
  }
  const svg = '<svg class="scree-inset-svg" viewBox="0 0 ' + svgW + ' ' + svgH +
              '" preserveAspectRatio="none">' + bars.join('') + '</svg>';
  let ratioStr = '';
  if (spectrum.length >= 2 && spectrum[1] > 0) {
    const r = spectrum[0] / spectrum[1];
    ratioStr = 'λ₁/λ₂ = ' + r.toFixed(1);
  }
  const hint = isFallback
    ? '<div class="scree-inset-fallback-hint">k≥3 needs precomp ≥2.16</div>'
    : '';
  return (
    '<div class="scree-inset-label">PC eigenvalues · w' + state.cur + '</div>' +
    svg +
    '<div class="scree-inset-ratio">' + ratioStr + '</div>' +
    hint
  );
}

// --- recomputeAnchorConcord — legacy lines 36081-36122 ---
// Compute per-window Cramér's V between anchor labels and current labels.
// Stores in state.anchorConcord (Float32Array of length n_windows).
export function recomputeAnchorConcord() {
  const state = _pageState;
  if (!state || !state.data) { if (state) state.anchorConcord = null; return; }
  _ensureAnchor();
  const N = state.data.n_windows;
  if (!state.trackingAnchor || state.tracked.length === 0) {
    state.anchorConcord = null;
    return;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = NaN;
  const anchor = state.trackingAnchor;
  const K_a = anchor.K | 0;
  // Per-L2-envelope: compute V once per envelope, fill all windows in it
  if (!Array.isArray(state.data.l2_envelopes)) {
    state.anchorConcord = out;
    return;
  }
  for (let l2i = 0; l2i < state.data.l2_envelopes.length; l2i++) {
    const env = state.data.l2_envelopes[l2i];
    if (!env || env._s0 == null) continue;
    const cl = getL2Cluster(state, l2i);
    const labels = cl && cl.labels ? cl.labels : null;
    let v = NaN;
    if (labels) {
      const K_c = state.k | 0;
      const table = new Int32Array(K_a * K_c);
      let any = false;
      for (const [si, anchorLbl] of anchor.labels) {
        if (anchorLbl < 0 || anchorLbl >= K_a) continue;
        const curLbl = labels[si];
        if (curLbl == null || curLbl < 0 || curLbl >= K_c) continue;
        table[anchorLbl * K_c + curLbl]++;
        any = true;
      }
      if (any) v = _cramersV(table, K_a, K_c);
    }
    for (let w = env._s0; w <= env._e0; w++) {
      if (w >= 0 && w < N) out[w] = v;
    }
  }
  state.anchorConcord = out;
}

// 2026-05-20: smart-corner placement for the scree inset. Quentin:
// "[the scree plot] should be like in repulsion with datapoints and try
// to go on the corner by default". Algorithm: count scatter dots in
// each of the 4 plot-area quadrants, pick the LEAST-populated corner,
// set the inset's `data-corner` attribute so CSS positions it there.
// Sticky-ish: a 10% margin around the current corner keeps the inset
// from oscillating between corners while the user scrubs (tiny shifts
// in dot density would otherwise re-trigger placement on every frame).
function _positionScreeInsetSmart(state, screenXY, nSamples, pad, plotW, plotH) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('screeInset');
  if (!el || el.style.display === 'none') return;
  if (!screenXY || !nSamples || plotW <= 0 || plotH <= 0) return;
  const cx = pad.l + plotW / 2;
  const cy = pad.t + plotH / 2;
  let tl = 0, tr = 0, bl = 0, br = 0;
  for (let si = 0; si < nSamples; si++) {
    const x = screenXY[si * 2];
    const y = screenXY[si * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < pad.l || x > pad.l + plotW || y < pad.t || y > pad.t + plotH) continue;
    if (x < cx) {
      if (y < cy) tl++; else bl++;
    } else {
      if (y < cy) tr++; else br++;
    }
  }
  const corners = [
    { id: 'tl', n: tl }, { id: 'tr', n: tr },
    { id: 'bl', n: bl }, { id: 'br', n: br },
  ];
  // Hysteresis: prefer to stay in the current corner if it's still
  // within 10% of the minimum density so we don't snap on every paint.
  const cur = el.dataset.corner || 'tr';
  const curEntry = corners.find(c => c.id === cur);
  corners.sort((a, b) => a.n - b.n);
  const best = corners[0];
  if (curEntry && (curEntry.n - best.n) <= Math.max(1, Math.round(nSamples * 0.10))) {
    el.dataset.corner = cur;
  } else {
    el.dataset.corner = best.id;
  }
}

// --- _refreshScreeInset — legacy lines 56497-56513 ---
// 2026-05-18: exposed on window so sidebar.js (#screeToggle change handler)
// can repaint without importing pca_panel internals.
export function _refreshScreeInset() {
  const state = _pageState;
  const el = document.getElementById('screeInset');
  if (!el) return;
  if (!state.screePlotEnabled) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const html = _renderScreeInsetHTML();
  if (html === '') {
    el.style.display = 'none';
    el.innerHTML = '';
  } else {
    el.style.display = 'block';
    el.innerHTML = html;
  }
}

// --- drawPCA(state) — legacy lines 35749-35949 ---
export function drawPCA(state) {
  _setActiveState(state);
  const canvas = document.getElementById('pcaCanvas');
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  document.getElementById('emptyState').style.display = 'none';
  // 2026-05-19 mode-switch — read PC scatter from the active mode's view.
  // For dosage this is state.data; for θπ / GHSL it's the synthesized
  // view with pc1/pc2 attached to each window from pc_loadings_aligned.
  const d = getActiveModeView(state) || state.data;
  const cur = state.cur;
  const trailStart = Math.max(0, cur - state.trailN);
  // 2026-05-20: pre-compute per-sample value array for the active
  // color ramp mode. getSampleColor reads from state._pcaModePsVals so
  // the inner per-sample loop stays O(1). For point-evaluation modes
  // (theta_pi / ghsl / froh / confounder_alert) the range collapses
  // to the current window; for chunk-backed modes (het / dosage) the
  // helper consults state._linesPanelGetCachedChunk (set by the lazy
  // chunk fetcher) and returns NaN-filled until a chunk lands — the
  // ramp color then falls back to grey, which is the correct visual
  // for "no data yet".
  if (_PCA_RAMP_MODES.has(state.colorMode)) {
    try {
      const vals = perSampleValuesForMode(state, state.colorMode, { startW: cur, endW: cur });
      state._pcaModePsVals = vals ? { mode: state.colorMode, vals } : null;
    } catch (e) {
      state._pcaModePsVals = null;
      console.warn('drawPCA precompute psVals failed:', e);
    }
  } else {
    state._pcaModePsVals = null;
  }

  // v3.25: which two PCs to plot (default PC1×PC2). PC1 keeps its sign-flip
  // rule (signX); other PCs render in raw orientation. The analytics path
  // (k-means, sample identity, lockedLabels) still uses canonical PC1×PC2
  // via getPC() — only the visual axis changes here.
  const [axisX, axisY] = state.viewControls.pcaXY;

  // Range across trail span
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let wi = trailStart; wi <= cur; wi++) {
    const { x: xs, y: ys, signX, signY } = getPCRender(state, wi, axisX, axisY);
    if (!xs || !ys) continue;
    const samples = (wi === cur) ? allSampleIdx(state) : state.tracked;
    for (const si of samples) {
      const x = xs[si] * signX, y = ys[si] * signY;
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
  }
  const xPad = (xMax - xMin) * 0.08 || 0.01;
  const yPad = (yMax - yMin) * 0.08 || 0.01;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

  // v3.73: top padding tightened from 32 → 10 — there's no chart title or
  // axis label above the plot frame, just the YMax tick label which sits at
  // pad.t+4 inside the frame. The previous 32px reserved blank space that
  // pushed the data-point cluster down and squeezed the visible area. Bottom
  // padding 38 stays (X-axis tick labels + "PC1" label sit there).
  // v3.99 turn 14d ask 3: right padding reduced 200 → 16. Previously the
  // 200-px gutter reserved space for an external legend, but the per-band
  // legend is rendered INSIDE the plot frame at the top-right (line ~14391
  // computes lx = pad.l + plotW - legendW - 3), so the right gutter was
  // pure empty space. Reducing it lets the scatter use the full canvas
  // width. Hit-detection in onPCAClick() must use the same value.
  const pad = { l: 50, r: 16, t: 10, b: 38 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  const toX = v => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Frame + grid
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  ctx.strokeStyle = 'rgba(42,50,66,0.5)';
  ctx.setLineDash([2, 3]);
  for (let i = 1; i < 5; i++) {
    const gx = pad.l + (i / 5) * plotW;
    ctx.beginPath(); ctx.moveTo(gx, pad.t); ctx.lineTo(gx, pad.t + plotH); ctx.stroke();
    const gy = pad.t + (i / 5) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + plotW, gy); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Axis labels
  // v4 turn 2 ask 5: include %variance contribution in the axis labels.
  // For local PCA, each window has lam1 and lam2 (the two eigenvalues of
  // the local covariance matrix). The %variance shown is the fraction
  // each eigenvalue contributes to the top-2-PC basis: lam_k / (lam1+lam2).
  // This is locally interpretable — "of the variance captured by PC1+PC2,
  // PC1 explains XX%" — which is the only honest percentage we can give
  // from per-window data alone (full-dimensional variance is not in JSON).
  // Falls back to bare "PC1"/"PC2" when eigenvalues are missing or invalid.
  // Quentin: "you add (%) variance in axis text in y and x bc now it just
  // says PC1 which is not enough."
  let _pcaPC1Label = 'PC1';
  let _pcaPC2Label = 'PC2';
  // 2026-05-20: pull lam1/lam2 from the ACTIVE view's window so the
  // axis labels (PC1 λ₁ X.X%) match the scatter the user is looking at
  // in θπ / GHSL mode. Dosage windows carry these fields; the synthesized
  // theta_pi / ghsl views often don't, in which case the bare "PC1"/"PC2"
  // fallback is the correct rendering.
  {
    const _view = (typeof getActiveModeView === 'function')
      ? (getActiveModeView(state) || state.data)
      : state.data;
    if (_view && _view.windows && state.cur >= 0
        && state.cur < _view.windows.length) {
      const _wObj = _view.windows[state.cur];
      const _l1 = _wObj && _wObj.lam1;
      const _l2 = _wObj && _wObj.lam2;
      if (_l1 != null && isFinite(_l1) && _l2 != null && isFinite(_l2)
          && (_l1 + _l2) > 1e-12) {
        const _sum = _l1 + _l2;
        const _p1 = (100 * _l1 / _sum).toFixed(1);
        const _p2 = (100 * _l2 / _sum).toFixed(1);
        _pcaPC1Label = `PC1 (λ₁ ${_p1}%)`;
        _pcaPC2Label = `PC2 (λ₂ ${_p2}%)`;
      }
    }
  }
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(_pcaPC1Label, pad.l + plotW / 2, h - 12);
  ctx.save(); ctx.translate(14, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText(_pcaPC2Label, 0, 0); ctx.restore();
  ctx.textAlign = 'right';
  ctx.fillText(yMax.toFixed(3), pad.l - 5, pad.t + 4);
  ctx.fillText(yMin.toFixed(3), pad.l - 5, pad.t + plotH);
  ctx.textAlign = 'center';
  ctx.fillText(xMin.toFixed(3), pad.l, pad.t + plotH + 14);
  ctx.fillText(xMax.toFixed(3), pad.l + plotW, pad.t + plotH + 14);

  // Determine L2 group labels for cluster coloring.
  // Priority: state.lockedLabels (manually frozen) > current L2's K-means labels.
  const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
  let groupLabels = null;
  if (state.colorMode === 'cluster') {
    if (state.lockedLabels) {
      groupLabels = state.lockedLabels;
    } else if (curL2 >= 0) {
      const cl = getL2Cluster(state, curL2);
      if (cl && cl.labels) groupLabels = cl.labels;
    }
  }

  // Non-tracked samples (current window) — use user-selected PC axes
  const cR = getPCRender(state, cur, axisX, axisY);
  const pc1c = cR.x, pc2c = cR.y, signXc = cR.signX, signYc = cR.signY;
  const trackedSet = new Set(state.tracked);
  // Cache current-window screen-space positions for lasso readback.
  // Stored as Float32Array pairs (x, y) indexed by sample idx.
  const _pcaScreenXY = new Float32Array(d.n_samples * 2);
  if (pc1c && pc2c) {
    for (let si = 0; si < d.n_samples; si++) {
      const x = toX(pc1c[si] * signXc);
      const y = toY(pc2c[si] * signYc);
      _pcaScreenXY[si * 2]     = x;
      _pcaScreenXY[si * 2 + 1] = y;
      if (trackedSet.has(si)) continue;
      const baseCol = getSampleColor(si, state.colorMode, groupLabels);
      const col = withAlpha(baseCol, state.colorMode === 'cluster' ? 0.45 : 0.7);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 2.8, 0, Math.PI * 2); ctx.fill();
      // 2026-05-18: Phase 1 polish — microgroup halo around
      // macrostripe-colored dots. When the user is in macrostripe
      // mode (state.useMacrostripeColors + bandingResult populated),
      // the dot fill is the macrostripe color; a thin ring carries
      // the per-window K-means microgroup color so the fine
      // structure stays visible without dominating. Skipped on
      // tracked samples (they already get a distinctive trail).
      if (state.useMacrostripeColors && state.bandingResult
          && state.colorMode === 'cluster'
          && groupLabels && groupLabels[si] != null && groupLabels[si] >= 0) {
        const microCol = ['#4fa3ff', '#b8b8b8', '#f5a524',
                          '#3cc08a', '#e0555c'][groupLabels[si]] || '#888';
        if (microCol !== baseCol) {
          ctx.strokeStyle = withAlpha(microCol, 0.85);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }
  // Expose for lasso handler. Plot bounds also stored so lasso can clip
  // its drag rectangle to the data area.
  state.__pcaScreenXY = _pcaScreenXY;
  state.__pcaPlotRect = { x: pad.l, y: pad.t, w: plotW, h: plotH };
  // 2026-05-20: smart-corner placement for the scree inset. Counts the
  // scatter dots in each of the four quadrants of the plot area and
  // snaps the inset to the LEAST-populated corner so the bars don't
  // sit on top of data. CSS uses data-corner=tl|tr|bl|br with the
  // transition styled in inversion.css so the move animates smoothly
  // when the user scrubs through windows. Drag-to-reattach is a future
  // ask (queued); this gives the user automatic "stay out of the data"
  // behavior today.
  try { _positionScreeInsetSmart(state, _pcaScreenXY, d.n_samples, pad, plotW, plotH); }
  catch (e) { console.warn('_positionScreeInsetSmart:', e); }

  // Trails (tracked samples)
  if (state.trailOn && state.tracked.length > 0 && state.trailN > 0) {
    // turn 128: when neither PCA axis is PC1, the trail lines wander in 2D
    // (they're no longer ~horizontal as in the default pc1×pc2 view because
    // PC2/3/4 vary a lot per window). Drop the line alpha so the cluttered
    // wander doesn't visually dominate the scatter. The dot fade below
    // already implies temporal direction; the line is just connective tissue.
    const _trailNeitherIsPc1 = (axisX !== 'pc1' && axisY !== 'pc1');
    const _trailLineAlpha = _trailNeitherIsPc1 ? 0.32 : 0.85;
    for (const si of state.tracked) {
      const col = trackedColor(si);
      ctx.strokeStyle = col; ctx.lineWidth = 1.3;
      ctx.globalAlpha = _trailLineAlpha;
      ctx.beginPath();
      let first = true;
      for (let wi = trailStart; wi <= cur; wi++) {
        const r = getPCRender(state, wi, axisX, axisY);
        if (!r.x || !r.y) continue;
        const x = toX(r.x[si] * r.signX), y = toY(r.y[si] * r.signY);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let wi = trailStart; wi < cur; wi++) {
        const r = getPCRender(state, wi, axisX, axisY);
        if (!r.x || !r.y) continue;
        const t = (wi - trailStart) / Math.max(1, cur - trailStart);
        ctx.fillStyle = col; ctx.globalAlpha = 0.15 + 0.5 * t;
        const x = toX(r.x[si] * r.signX), y = toY(r.y[si] * r.signY);
        ctx.beginPath(); ctx.arc(x, y, 2.0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Tracked dots — outline color = group, fill = sample identity, label = CGA
  if (pc1c && pc2c) for (const si of state.tracked) {
    const col = trackedColor(si);
    const x = toX(pc1c[si] * signXc), y = toY(pc2c[si] * signYc);
    // Group halo
    if (groupLabels) {
      const gcol = ['#4fa3ff', '#b8b8b8', '#f5a524'][groupLabels[si]] || '#666';
      ctx.strokeStyle = gcol; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = col;
    ctx.strokeStyle = themeColor('bg');
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // Label with text shadow for readability
    const name = d.samples[si].cga || d.samples[si].ind;
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.strokeStyle = themeColor('bg'); ctx.lineWidth = 3;
    ctx.strokeText(name, x + 9, y + 4);
    ctx.fillStyle = col;
    ctx.fillText(name, x + 9, y + 4);
  }
  // 2026-05-18: cluster-label notation overlay (Group H from WIRE_AUDIT).
  // Render group labels at K-cluster centroids when state.pcaClusterLabelMode
  // is set (cycle via N hotkey, see _wireClusterLabelHotkey in sidebar.js).
  // Centroids are computed from sample screen-space positions in the current
  // frame — agnostic to fit dimension (works for kmeans1D + kmeans2D).
  if (state.pcaClusterLabelMode && state.pcaClusterLabelMode !== 'none'
      && groupLabels && _pcaScreenXY) {
    _drawClusterLabelOverlay(ctx, state, groupLabels, _pcaScreenXY, d.n_samples);
  }

  // 2026-05-18: selection-group halo (Group G stage 1). Renders a thin
  // amber ring around each sample in state.selectionGroup.ids so the
  // user sees what they lassoed in selection mode. The selection
  // persists until U is pressed again or another lasso replaces it.
  if (state.selectionGroup && state.selectionGroup.ids
      && state.selectionGroup.ids.length && _pcaScreenXY) {
    _drawSelectionHalo(ctx, state.selectionGroup.ids, _pcaScreenXY);
  }
  // turn 120: refresh the scree inset on every PCA draw. Cheap (pure SVG
  // string write to an absolutely-positioned div, no canvas, no layout).
  // The renderer handles the off/on toggle and the empty-state internally.
  try { _refreshScreeInset(); } catch (e) { /* fail-soft */ }
}

// ---------------------------------------------------------------------------
// _drawClusterLabelOverlay — Group H from WIRE_AUDIT_page1.md (2026-05-18).
// Paints group labels at K-cluster centroids on the PCA scatter. Modes:
//   'g_index'   — 'g0', 'g1', 'g2'
//   'h_system'  — 'HOMO_1', 'HET', 'HOMO_2' for K=3; falls back to 'gN' for K!=3
//   'h_pair'    — 'H1/H1', 'H1/H2', 'H2/H2' for K=3; H-pair table at higher K
// Centroids are mean (x,y) of sample positions per cluster — works for
// kmeans1D and kmeans2D fits identically (we don't need cl.centers).
// ---------------------------------------------------------------------------
const _H_SYSTEM_LABELS_K3 = ['HOMO_1', 'HET', 'HOMO_2'];
const _H_PAIR_LABELS = {
  3: ['H1/H1', 'H1/H2', 'H2/H2'],
  4: ['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3'],
  5: ['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3', 'H3/H3'],
  6: ['H1/H1', 'H1/H2', 'H2/H2', 'H1/H3', 'H2/H3', 'H3/H3'],
};

function _clusterLabelText(mode, k, K) {
  if (mode === 'g_index') return `g${k}`;
  if (mode === 'h_system') {
    if (K === 3 && k >= 0 && k < 3) return _H_SYSTEM_LABELS_K3[k];
    return `g${k}`;   // fallback
  }
  if (mode === 'h_pair') {
    const pal = _H_PAIR_LABELS[K];
    if (pal && k >= 0 && k < pal.length) return pal[k];
    return `g${k}`;
  }
  return null;
}

// Selection-group halo (Group G stage 1). Amber ring around each
// lassoed sample so the user sees the group at a glance. Mirrors the
// K-cycle button's accent palette for visual continuity.
function _drawSelectionHalo(ctx, ids, screenXY) {
  ctx.save();
  ctx.strokeStyle = 'rgba(245,165,36,0.85)';
  ctx.fillStyle   = 'rgba(245,165,36,0.18)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < ids.length; i++) {
    const si = ids[i];
    const x = screenXY[si * 2], y = screenXY[si * 2 + 1];
    if (!isFinite(x) || !isFinite(y)) continue;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function _drawClusterLabelOverlay(ctx, state, groupLabels, screenXY, nS) {
  const K = state.k || 3;
  const xSum = new Float64Array(K);
  const ySum = new Float64Array(K);
  const cnt  = new Int32Array(K);
  for (let si = 0; si < nS; si++) {
    const k = groupLabels[si];
    if (k == null || k < 0 || k >= K) continue;
    const x = screenXY[si * 2], y = screenXY[si * 2 + 1];
    if (!isFinite(x) || !isFinite(y)) continue;
    xSum[k] += x;
    ySum[k] += y;
    cnt[k]++;
  }
  ctx.save();
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  for (let k = 0; k < K; k++) {
    if (cnt[k] === 0) continue;
    const cx = xSum[k] / cnt[k];
    const cy = ySum[k] / cnt[k];
    const text = _clusterLabelText(state.pcaClusterLabelMode, k, K);
    if (!text) continue;
    // Halo (stroke against bg) then fill in the cluster's color.
    ctx.strokeStyle = 'rgba(14,17,22,0.92)';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = groupColor(k) || '#fff';
    ctx.fillText(text, cx, cy);
  }
  ctx.restore();
}

// --- drawAnchorStrip(state) — legacy lines 36147-36256 ---
export function drawAnchorStrip(state) {
  _setActiveState(state);
  const canvas = document.getElementById('anchorStripCanvas');
  if (!canvas) return;
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  // Mode-aware window count for the anchor strip.
  const view = getActiveModeView(state) || state.data;
  const N = (view.windows && view.windows.length) || view.n_windows || state.data.n_windows;
  // v3.59: defensive recompute. If samples are tracked but concord is missing
  // or stale (e.g. data just loaded, or some upstream caller forgot to call
  // recomputeAnchorConcord), do it inline so the strip never silently shows
  // the "track samples to enable" hint while tracking IS actually active.
  if (state.tracked.length > 0 &&
      (!state.anchorConcord ||
       state.anchorConcord.length !== N ||
       !state.trackingAnchor)) {
    if (typeof recomputeAnchorConcord === 'function') {
      try { recomputeAnchorConcord(); } catch (_) {}
    }
  }
  const concord = state.anchorConcord;
  // v3.58: padding matches drawLines (l:44, r:16) so the per-window x-coords
  // line up exactly with the PC1/PC2 plot area above. Previously was l:30,
  // r:8 which shifted the strip a few pixels left of the lines plot.
  const padL = 44, padR = 16;
  const plotW = Math.max(10, w - padL - padR);

  // Background
  ctx.fillStyle = themeColor('panel');
  ctx.fillRect(0, 0, w, h);

  if (state.tracked.length === 0) {
    // No tracked samples yet — render generic hint
    ctx.fillStyle = themeColor('ink-dimmer');
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('anchor concord — track samples to enable', 8, h / 2 + 3);
    return;
  }
  if (!state.trackingAnchor) {
    // v3.59: tracked but anchor failed to capture (no L2 envelopes on the
    // chrom, or some other edge case). Better diagnostic than the generic hint.
    ctx.fillStyle = themeColor('ink-dimmer');
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    const noL2 = !Array.isArray(state.data.l2_envelopes) ||
                 state.data.l2_envelopes.length === 0;
    ctx.fillText(noL2
      ? 'anchor concord — no L2 envelopes on this chromosome'
      : 'anchor concord — anchor capture failed (try re-tracking inside an L2 zone)',
      8, h / 2 + 3);
    return;
  }
  if (!concord) {
    // Recompute returned with concord=null somehow. Render gray.
    ctx.fillStyle = themeColor('ink-dimmer');
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('anchor concord — computing…', 8, h / 2 + 3);
    return;
  }

  // Draw one vertical strip per window
  const stripH = h - 4;
  const stripY = 2;
  for (let wi = 0; wi < N; wi++) {
    const x0 = padL + Math.floor((wi / N) * plotW);
    const x1 = padL + Math.floor(((wi + 1) / N) * plotW);
    ctx.fillStyle = _vColor(concord[wi]);
    ctx.fillRect(x0, stripY, Math.max(1, x1 - x0), stripH);
  }

  // Y-axis label on the left
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('V', 4, h / 2 + 3);

  // Vertical orange line at current scrubber position
  const curX = padL + Math.floor(((state.cur + 0.5) / N) * plotW);
  ctx.strokeStyle = '#f5a524';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(curX + 0.5, 0);
  ctx.lineTo(curX + 0.5, h);
  ctx.stroke();

  // Vertical green line at anchor position
  if (state.trackingAnchor.winIdx != null && state.trackingAnchor.winIdx >= 0) {
    const ax = padL + Math.floor(((state.trackingAnchor.winIdx + 0.5) / N) * plotW);
    ctx.strokeStyle = 'rgba(0,230,118,0.85)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(ax + 0.5, 0);
    ctx.lineTo(ax + 0.5, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Current V value in tiny text on the right
  const vCur = concord[state.cur];
  if (isFinite(vCur)) {
    ctx.fillStyle = themeColor('ink-dim');
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`V=${vCur.toFixed(2)}`, w - 4, h / 2 + 3);
  }
}

// --- autoPickRadial() — legacy lines 51862-51892 ---
export function autoPickRadial(state, n) {
  _setActiveState(state);
  if (!state || !state.data) return;
  if (n == null || !isFinite(n)) n = state.trackedN;
  n = Math.max(0, Math.min(state.data.n_samples, n | 0));
  if (n === 0) {
    state.tracked = [];
    renderTrackedList(state);
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    if (typeof renderL3Panel === 'function') { try { renderL3Panel(state); } catch (_) {} }
    return;
  }
  // 2026-05-06 round 3: getPC extracted from legacy and takes (state, winIdx).
  // Defensive try/catch is kept because state.data.windows[i].pc1 may be
  // missing on slim precomp JSONs (has_pc2 === false path).
  let pcRes;
  try { pcRes = getPC(state, state.cur); } catch (_) { pcRes = null; }
  if (!pcRes) {
    state.tracked = [];
    renderTrackedList(state);
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    if (typeof renderL3Panel === 'function') { try { renderL3Panel(state); } catch (_) {} }
    return;
  }
  const { pc1, pc2, sign } = pcRes;
  const N = state.data.n_samples;
  let mx = 0, my = 0;
  for (let i = 0; i < N; i++) { mx += pc1[i] * sign; my += pc2[i]; }
  mx /= N; my /= N;
  const picks = []; const used = new Set();
  for (let k = 0; k < n; k++) {
    const target = (k / n) * Math.PI * 2;
    let bestI = -1, bestScore = -Infinity;
    for (let i = 0; i < N; i++) {
      if (used.has(i)) continue;
      const dx = pc1[i] * sign - mx, dy = pc2[i] - my;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      let dA = Math.abs(ang - target);
      if (dA > Math.PI) dA = 2 * Math.PI - dA;
      const score = r - 0.5 * r * (dA / Math.PI);
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    if (bestI >= 0) { picks.push(bestI); used.add(bestI); }
  }
  state.tracked = picks;
  renderTrackedList(state);
  try { drawPCA(state); } catch (_) {}
  if (typeof renderL3Panel === 'function') { try { renderL3Panel(state); } catch (_) {} }
}

// --- togglePlay() — legacy lines 52399-52417 ---
export function togglePlay(state) {
  _setActiveState(state);
  const btn = document.getElementById('playBtn');
  if (state.playing) {
    clearInterval(state.playTimer);
    state.playing = false;
    if (btn) {
      btn.textContent = '▶ Play';
      btn.classList.remove('playing');
    }
  } else {
    state.playing = true;
    if (btn) {
      btn.textContent = '❚❚ Pause';
      btn.classList.add('playing');
    }
    state.playTimer = setInterval(() => {
      if (!state.data) return;
      let next = state.cur + 2;
      if (next >= state.data.n_windows) next = 0;
      setCur(state, next);
    }, 80);
  }
}

// --- cycleKAside() — legacy lines 56537-56565 ---
// v4 turn 3: K-cycle button on the tracked-samples aside. Click cycles
// state.k through 3 → 4 → 5 → 6 → 2 → 3, recoloring the PCA scatter,
// per-sample lines, band-pick buttons, and L3 contingency.
export function cycleKAside(state) {
  _setActiveState(state);
  const cur = state.k;
  const i = _K_CYCLE_ORDER.indexOf(cur);
  const next = (i < 0)
    ? _K_CYCLE_ORDER[0]
    : _K_CYCLE_ORDER[(i + 1) % _K_CYCLE_ORDER.length];
  state.kMode = 'fixed';
  state.k = next;
  state.l2GroupCache = null; state.cacheKey = null;
  // Mirror to sidebar kSelect so both UIs stay aligned
  const _kSel = document.getElementById('kSelect');
  if (_kSel) _kSel.value = String(next);
  try { refreshBandPickBar(state); } catch (_) {}
  if (state.trackingAnchor) state.trackingAnchor = null;
  try { recomputeAnchorConcord(); } catch (_) {}
  try { drawPCA(state); }        catch (_) {}
  try { drawLinesPanel(state); } catch (_) {}
  try { renderZoneBlock(state); }catch (_) {}
  try { renderL3Panel(state); }  catch (_) {}
  try { drawAnchorStrip(state); } catch (_) {}
  try { _updateConcordBadge(state); } catch (_) {}
  if (typeof _syncTrackedCompactUI === 'function') _syncTrackedCompactUI();
}

// --- renderTrackedList(state) — legacy lines 52004-52062 ---
export function renderTrackedList(state) {
  _setActiveState(state);
  // v4 turn 73c: refactored to dual-write into both #trackedList (sidebar)
  // AND #trackedListCompact (compact panel). Same chip-building logic; each
  // chip is built fresh per container because a DOM node can only belong to
  // one parent.
  const elSidebar = document.getElementById('trackedList');
  const elCompact = document.getElementById('trackedListCompact');
  if (elSidebar) elSidebar.innerHTML = '';
  if (elCompact) elCompact.innerHTML = '';
  const ci = document.getElementById('trackedCountInfo');
  const ni = document.getElementById('trackedNInfo');
  if (ci) ci.textContent = state.tracked.length;
  if (ni) ni.textContent = state.trackedN;
  // v3.70: keep the compact-mode tracked-samples panel in sync
  if (typeof _syncTrackedCompactUI === 'function') {
    try { _syncTrackedCompactUI(); } catch (e) {}
  }
  // v3.71: refresh the concord badge after recomputeAnchorConcord runs below
  // (we call it after the recompute so the badge reflects the freshest data)
  // v3.52: tracked set changed — refresh anchor + recompute concord
  try { recomputeAnchorConcord(); } catch (e) {}
  try { drawAnchorStrip(state); } catch (e) {}
  // v3.71: badge update after the recompute
  try { _updateConcordBadge(state); } catch (e) {}
  if (!state.data) return;
  // Pre-compute per-sample spread for the current L2 once.
  const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
  const sd = curL2 >= 0 ? sampleSpreadL2(contextFromState(state), curL2) : null;

  // v4 turn 73c: helper to build a chip for one sample. Called twice (once
  // for sidebar, once for compact) so each container gets its own DOM node.
  const buildChip = (si) => {
    const s = state.data.samples[si];
    const chip = document.createElement('span');
    chip.className = 'tag on';
    let label = s.cga || s.ind;
    if (sd && isFinite(sd[si])) {
      label += ` <span style="opacity:0.6; font-size:10px;">σ${sd[si].toFixed(3)}</span>`;
      if (sd[si] > 0.05) chip.style.borderColor = 'var(--bad)';
    }
    chip.innerHTML = label;
    chip.onclick = () => {
      state.tracked = state.tracked.filter(x => x !== si);
      renderTrackedList(state); drawLinesPanel(state); drawPCA(state); renderL3Panel(state);
    };
    return chip;
  };

  state.tracked.forEach(si => {
    if (elSidebar) elSidebar.appendChild(buildChip(si));
    if (elCompact) elCompact.appendChild(buildChip(si));
  });
}

// --- renderManualGroupsList() — legacy lines 48152-48191 ---
export function renderManualGroupsList(state) {
  _setActiveState(state);
  const containers = [];
  if (typeof document !== 'undefined') {
    const sidebar = document.getElementById('manualGroupsList');
    const compact = document.getElementById('manualGroupsListCompact');
    // turn 135 Slice 1 (SPEC_g_panel_unified_groups.md): popup re-host.
    // The G-panel manual tab body holds a #manualGroupsListPopup div.
    // When the popup is open, this renderer also fills it so the
    // single source of truth (state.manualGroups) drives all three
    // surfaces. When the popup isn't open the lookup returns null
    // and the loop just skips it (existing pattern).
    const popup   = document.getElementById('manualGroupsListPopup');
    if (sidebar) containers.push(sidebar);
    if (compact) containers.push(compact);
    if (popup)   containers.push(popup);
  }
  if (containers.length === 0) return;
  const groups = state.manualGroups || [];
  if (groups.length === 0) {
    const emptyHtml = '<div class="mg-empty">No groups yet — pick samples or grab a K-band.</div>';
    for (const box of containers) box.innerHTML = emptyHtml;
    return;
  }
  let html = '';
  for (const g of groups) {
    const pinClass = g.scope === 'cohort' ? 'mg-pin pinned' : 'mg-pin';
    const pinTitle = g.scope === 'cohort'
      ? 'Pinned to cohort — follows you across chromosomes (click to unpin)'
      : 'Per-chromosome — click to pin to cohort';
    html += `<div class="mg-row" data-mgid="${g.id}">` +
      `<span class="mg-swatch" style="background:${g.color}"></span>` +
      `<span class="mg-name" contenteditable="true" spellcheck="false" ` +
      `data-mgid="${g.id}">${escapeHtml(g.name)}</span>` +
      `<span class="mg-count">n=${g.members.length}</span>` +
      `<button class="${pinClass}" data-mgid="${g.id}" title="${pinTitle}">📌</button>` +
      `<button class="mg-del" data-mgid="${g.id}" title="Remove this group">×</button>` +
      `</div>`;
  }
  for (const box of containers) box.innerHTML = html;
}

// =============================================================================
// PCA lasso — legacy lines 52260-52398 (IIFE)
// =============================================================================
// Shift+drag (or plain drag with #pcaLassoToggle on) → draws a rectangle
// over #pcaCanvas; on release, creates a new manual group from the enclosed
// samples (or replaces state.tracked when in tracked-lasso mode).
//
// Idempotent: stores the bound state on canvas.__pcaLassoBound so a
// re-mount doesn't double-attach.
export function attachPcaLasso(state) {
  _setActiveState(state);
  const canvas = document.getElementById('pcaCanvas');
  if (!canvas) return;
  if (canvas.__pcaLassoBound) return;  // already attached
  canvas.__pcaLassoBound = true;

  let lassoEl = null;       // overlay div (created lazily)
  let dragging = false;
  let startX = 0, startY = 0;     // canvas-local coords
  let startClientX = 0, startClientY = 0;
  let canvasRect = null;

  function ensureOverlay() {
    if (lassoEl) return lassoEl;
    // Prefer the local_pca_dosage.html-baked #pcaLassoOverlay div if present; fall
    // back to a body-injected div otherwise.
    const existing = document.getElementById('pcaLassoOverlay');
    if (existing) {
      lassoEl = existing;
      lassoEl.style.position = 'fixed';
      lassoEl.style.pointerEvents = 'none';
      lassoEl.style.zIndex = '100';
      lassoEl.style.border = '1px dashed var(--accent, #f5a524)';
      lassoEl.style.background = 'rgba(245,165,36,0.08)';
      lassoEl.style.display = 'none';
      return lassoEl;
    }
    lassoEl = document.createElement('div');
    lassoEl.id = 'pcaLassoOverlay';
    lassoEl.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'z-index: 100',
      'border: 1px dashed var(--accent, #f5a524)',
      'background: rgba(245,165,36,0.08)',
      'display: none',
    ].join(';');
    document.body.appendChild(lassoEl);
    return lassoEl;
  }

  function updateOverlay(curClientX, curClientY) {
    const el = ensureOverlay();
    const x0 = Math.min(startClientX, curClientX);
    const y0 = Math.min(startClientY, curClientY);
    const x1 = Math.max(startClientX, curClientX);
    const y1 = Math.max(startClientY, curClientY);
    el.style.left   = x0 + 'px';
    el.style.top    = y0 + 'px';
    el.style.width  = (x1 - x0) + 'px';
    el.style.height = (y1 - y0) + 'px';
    el.style.display = '';
  }

  function hideOverlay() {
    if (lassoEl) lassoEl.style.display = 'none';
  }

  function _samplesInBox(x0, y0, x1, y1) {
    const st = _pageState;
    if (!st || !st.data || !st.__pcaScreenXY) return [];
    const xy = st.__pcaScreenXY;
    const out = [];
    const lo_x = Math.min(x0, x1), hi_x = Math.max(x0, x1);
    const lo_y = Math.min(y0, y1), hi_y = Math.max(y0, y1);
    const N = st.data.n_samples;
    for (let si = 0; si < N; si++) {
      const sx = xy[si * 2], sy = xy[si * 2 + 1];
      if (sx >= lo_x && sx <= hi_x && sy >= lo_y && sy <= hi_y) out.push(si);
    }
    return out;
  }

  canvas.addEventListener('pointerdown', (e) => {
    // Three activation paths:
    //   (1) state.selectionMode (U key) + Shift+drag → selection lasso.
    //       Writes to state.selectionGroup (transient). v Group G stage 1.
    //   (2) Shift+left-click (no selectionMode) → manual-group lasso
    //       (existing v3.39 behavior).
    //   (3) state.pcaLassoActive (lasso checkbox in tracked-samples
    //       aside) + plain left-click → tracked-samples lasso. v4 turn 4.
    if (e.button !== 0) return;
    const st = _pageState;
    if (!st || !st.data) return;
    const isShift = !!e.shiftKey;
    const isSelection = isShift && !!st.selectionMode;
    const isTrackedLasso = !isShift && !!st.pcaLassoActive;
    if (!isShift && !isTrackedLasso) return;
    e.preventDefault();
    canvasRect = canvas.getBoundingClientRect();
    startX = e.clientX - canvasRect.left;
    startY = e.clientY - canvasRect.top;
    startClientX = e.clientX;
    startClientY = e.clientY;
    dragging = true;
    canvas.__pcaLassoMode = isSelection ? 'selection'
                          : (isTrackedLasso ? 'tracked' : 'manual');
    try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
    updateOverlay(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    updateOverlay(e.clientX, e.clientY);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    hideOverlay();
    if (!canvasRect) return;
    const endX = e.clientX - canvasRect.left;
    const endY = e.clientY - canvasRect.top;
    // Reject tiny drags (treat as click). Threshold = 4px.
    const dx = Math.abs(endX - startX), dy = Math.abs(endY - startY);
    if (dx < 4 && dy < 4) return;
    const samples = _samplesInBox(startX, startY, endX, endY);
    if (samples.length === 0) return;
    const st = _pageState;
    const mode = canvas.__pcaLassoMode || 'manual';
    if (mode === 'tracked') {
      // v4 turn 4: tracked-samples lasso. Replace state.tracked with the
      // lassoed set, capped at trackedN.
      const cap = Math.max(1, st.trackedN | 0);
      st.tracked = samples.slice(0, cap);
      if (samples.length > cap) st.trackedN = Math.min(50, samples.length);
      // Auto-deactivate lasso (one-shot, like the lines lasso).
      st.pcaLassoActive = false;
      const cb = document.getElementById('pcaLassoToggle');
      if (cb) cb.checked = false;
      if (typeof _updatePcaLassoUI === 'function') _updatePcaLassoUI();
      renderTrackedList(st);
      if (typeof _syncTrackedCompactUI === 'function') _syncTrackedCompactUI();
      try { drawLinesPanel(st); } catch (_) {}
      drawPCA(st);
      try { renderL3Panel(st); } catch (_) {}
      return;
    }
    if (mode === 'selection') {
      // Group G stage 1: selection-mode lasso. Stash on the transient
      // state.selectionGroup slot (not manualGroups). The G-panel
      // manual tab will surface a "save selection as group" button to
      // promote this into a persistent manual group; until then it's
      // just observation. See specs_todo/SPEC_cross_atlas_group_transfer.md.
      const d = st.data || {};
      st.selectionGroup = {
        ids:           samples.slice(),
        source_atlas:  'inversion',
        source_page:   'local_pca_dosage',
        source_window: (st.cur | 0),
        source_chrom:  d.chrom || null,
        ts:            Date.now(),
      };
      // Repaint so the selection halo (drawPCA post-pass) shows up.
      drawPCA(st);
      return;
    }
    // mode === 'manual': existing v3.39 manual-group lasso.
    // Auto-name lasso_<N> avoiding collisions
    const groups = st.manualGroups || [];
    let n = 1, name;
    do { name = 'lasso_' + n++; } while (groups.some(g => g.name === name) && n < 1000);
    const g = addToManualGroup(name, samples);
    if (g && st.colorMode !== 'manual') {
      // Flip to manual mode so user immediately sees the result of the lasso
      st.colorMode = 'manual';
      const bar = document.querySelectorAll('#colorModeBar button');
      bar.forEach(b => b.classList.toggle('active', b.dataset.mode === 'manual'));
      drawPCA(st);
      try { renderL3Panel(st); } catch (_) {}
      try { drawLinesPanel(st); } catch (_) {}
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // Hint the user that Shift activates lasso — title attribute on the canvas
  if (!canvas.title) {
    canvas.title = 'Click to track a sample · Shift+drag to lasso into a new manual group · checkbox in tracked-samples panel = lasso into tracked';
  }
}

// =============================================================================
// refreshPcaAxisBar — legacy lines 66680-66767
// =============================================================================
// Populates the scatter-axes X/Y selectors from availablePCs(state) and wires
// change handlers (idempotent via .dataset.wired). Also updates the axis
// readout below the canvas and the "X PCs available" tooltip.
export function refreshPcaAxisBar(state) {
  _setActiveState(state);
  if (!state || !state.viewControls) return;
  const avail = availablePCs(state);
  const [curX, curY] = state.viewControls.pcaXY;

  const fillSelect = (id, currentVal) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    for (const pc of avail) {
      const opt = document.createElement('option');
      opt.value = pc;
      opt.textContent = pc.toUpperCase();
      if (pc === currentVal) opt.selected = true;
      sel.appendChild(opt);
    }
    if (!sel.dataset.wired) {
      sel.addEventListener('change', () => {
        const newX = document.getElementById('pcaXSelect').value;
        const newY = document.getElementById('pcaYSelect').value;
        if (newX === newY) {
          const which = sel.dataset.axis;
          const other = avail.find(pc => pc !== (which === 'X' ? newY : newX));
          if (other) {
            if (which === 'X') document.getElementById('pcaXSelect').value = other;
            else                document.getElementById('pcaYSelect').value = other;
          }
        }
        const finalX = document.getElementById('pcaXSelect').value;
        const finalY = document.getElementById('pcaYSelect').value;
        setPcaXY(state, finalX, finalY);
        const lab = document.getElementById('pcaPanelLabelAxes');
        if (lab) lab.textContent = `${finalX.toUpperCase()} × ${finalY.toUpperCase()}`;
        try { drawPCA(state); } catch (_) {}
        if (state.viewControls.linked) {
          try { buildLinesPanelCheckboxes(state); } catch (_) {}
          try { buildLinesPanel(state); } catch (_) {}
          try { drawLinesPanel(state); } catch (_) {}
        }
      });
      sel.dataset.wired = '1';
    }
  };

  fillSelect('pcaXSelect', curX);
  fillSelect('pcaYSelect', curY);

  const linkChk = document.getElementById('viewControlsLinked');
  if (linkChk) {
    linkChk.checked = !!state.viewControls.linked;
    if (!linkChk.dataset.wired) {
      linkChk.addEventListener('change', e => {
        setViewControlsLinked(state, e.target.checked);
      });
      linkChk.dataset.wired = '1';
    }
  }

  const xSel = document.getElementById('pcaXSelect');
  const ySel = document.getElementById('pcaYSelect');
  const tooltip = (avail.length <= 2)
    ? `${avail.length} PCs in this dataset (run with --npc 4 for more)`
    : `${avail.length} PCs available`;
  if (xSel) xSel.title = tooltip;
  if (ySel) ySel.title = tooltip;

  const note = document.getElementById('pcaAxisAvailNote');
  if (note) { note.textContent = ''; note.style.display = 'none'; }

  const lab = document.getElementById('pcaPanelLabelAxes');
  if (lab) lab.textContent = `${curX.toUpperCase()} × ${curY.toUpperCase()}`;
}

// =============================================================================
// refreshColorModeBar — legacy lines 66769-66800
// =============================================================================
// Enables/disables color-mode buttons based on whether the data supports each
// mode (family requires family_source, ancestry requires ≥2 distinct values).
export function refreshColorModeBar(state) {
  _setActiveState(state);
  const famBtn = document.querySelector('#colorModeBar button[data-mode="family"]');
  if (famBtn) {
    const ok = state.data && state.data.family_source && state.data.family_source !== 'none';
    famBtn.disabled = !ok;
  }
  const ancBtn = document.querySelector('#colorModeBar button[data-mode="ancestry"]');
  if (ancBtn) {
    const set = new Set();
    if (state.data && Array.isArray(state.data.samples)) {
      for (const s of state.data.samples) set.add(s && s.ancestry ? s.ancestry : 'unknown');
    }
    ancBtn.disabled = set.size < 2;
  }
  const manBtn = document.querySelector('#colorModeBar button[data-mode="manual"]');
  if (manBtn) manBtn.disabled = false;   // always available — user creates groups manually
}

// =============================================================================
// refreshLockBtn — legacy lines 56695-56711
// =============================================================================
// Updates the 🔒 lock-colors button's label + accent styling based on
// whether state.lockedLabels is set.
export function refreshLockBtn(state) {
  _setActiveState(state);
  const btn = document.getElementById('lockColorsBtn');
  if (!btn) return;
  if (state && state.lockedLabels) {
    const refL2 = state.lockedRefL2;
    const env = refL2 != null && state.data ? state.data.l2_envelopes[refL2] : null;
    // shortId import is in events.js; we inline a minimal version here to
    // avoid circular events↔pca dependency. Same regex / fallback rules.
    const idRaw = env ? env.candidate_id : null;
    let id = '?';
    if (idRaw) {
      const m = String(idRaw).match(/d17L2_(\d+)_(\d+)$/);
      const m2 = String(idRaw).match(/d17L1_(\d+)$/);
      id = m ? `L2 ${m[1]}/${m[2]}` : (m2 ? `L1 ${m2[1]}` : idRaw);
    }
    btn.innerHTML = `🔓 unlock (frozen to ${id})`;
    btn.style.background = 'var(--accent)';
    btn.style.color = '#0e1116';
    btn.style.borderColor = 'var(--accent)';
  } else {
    btn.innerHTML = '🔒 lock colors to current L2';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}
