// pages/discovery/local_pca_dosage/cusum_panel.js
//
// Σ CUSUM panel — Phase 1 of the per-sample CUSUM visualization
// (user request, chat 2026-05-18). Paints K per-karyotype band
// CUSUM trajectories across the chromosome bp axis, on a dedicated
// canvas between #tracksContainer and #linesPanel.
//
// Math lives in shared/cusum.js. This module is pure DOM/canvas
// painting + a 0-baseline reference.
//
// Layout:
//   - Reads state.cusumStripOn (boolean); skips paint when false.
//   - Reads state.cusumResidual ('cohort_mean' default), state.cusumOp
//     ('mean' default), state.cusumAxis ('pc1' default).
//   - Source of labels: state.lockedLabels (when user has pinned a
//     band assignment) or the current L2's K-means labels. Falls
//     back to a no-op when neither is available.
//
// Visual: K=3 bold lines colored by groupColor(k), faint 0-baseline
// rule, faint grid, sci-fi glow via shadowBlur. Header label in the
// top-left corner pulls font/styling from CSS.

import { fitCanvas, themeColor } from '../../../shared/page1_utils.js';
import { perSampleCusumByKaryotype } from '../../../shared/cusum.js';
import { _pageState, _setActiveState } from './_state.js';
import { groupColor, getL2Cluster } from './_data.js';

/**
 * Paint the CUSUM panel for the current state. No-op when the panel
 * is toggled off or no labels are available. Called from drawZ (and
 * by the ResizeObserver chain).
 */
export function drawCusumPanel(state) {
  _setActiveState(state);
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('cusumPanel');
  const canvas = document.getElementById('cusumCanvas');
  const labelEl = document.getElementById('cusumPanelLabel');
  if (!panel || !canvas) return;

  // Toggle visibility — also drives applyMainGrid via display sniff.
  const want = !!(state && state.cusumStripOn);
  if (panel.style.display === (want ? '' : 'none')) {
    // already correct
  } else {
    panel.style.display = want ? '' : 'none';
  }
  if (!want) return;
  if (!state || !state.data) return;

  // Resolve labels.
  let labels = state.lockedLabels;
  if (!labels) {
    const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
    if (curL2 >= 0) {
      const cl = getL2Cluster(state, curL2);
      if (cl && cl.labels) labels = cl.labels;
    }
  }
  if (!labels) {
    _drawEmpty(canvas, 'Σ CUSUM — no K-band labels at this window');
    return;
  }
  const K = state.k | 0;
  if (!K || K < 2) {
    _drawEmpty(canvas, 'Σ CUSUM — K < 2');
    return;
  }

  const axis = state.cusumAxis || 'pc1';
  const residual = state.cusumResidual || 'cohort_mean';
  const op = state.cusumOp || 'mean';

  // Compute.
  const r = perSampleCusumByKaryotype(state, axis, labels, K, { residual, op });
  if (!r || !r.bandTraj || r.bandTraj.length === 0) {
    _drawEmpty(canvas, 'Σ CUSUM — compute returned empty');
    return;
  }
  const bandTraj = r.bandTraj;

  // Update header label to reflect mode.
  if (labelEl) {
    labelEl.innerHTML = `Σ CUSUM <span style="color: var(--ink-dimmer);
      font-weight: normal;">(${axis} · ${residual} · ${op}-per-band)</span>`;
  }

  // Paint.
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 44, r: 16, t: 14, b: 16 };
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = Math.max(1, h - pad.t - pad.b);

  // Y-range across all bands + windows.
  let vMin = Infinity, vMax = -Infinity;
  for (let k = 0; k < bandTraj.length; k++) {
    const row = bandTraj[k];
    for (let i = 0; i < row.length; i++) {
      const v = row[i];
      if (!Number.isFinite(v)) continue;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  if (!isFinite(vMin) || !isFinite(vMax)) {
    _drawEmpty(canvas, 'Σ CUSUM — all bands NaN');
    return;
  }
  // Symmetrise around 0 so the 0-baseline sits at the visual middle.
  const vAbs = Math.max(Math.abs(vMin), Math.abs(vMax), 1e-9);
  const yMin = -vAbs * 1.05;
  const yMax =  vAbs * 1.05;

  const nW = bandTraj[0].length;
  const toX = (wi) => pad.l + (nW > 1 ? (wi / (nW - 1)) * plotW : plotW / 2);
  const toY = (v)  => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Faint horizontal grid (3 lines + 0-baseline highlight).
  ctx.strokeStyle = 'rgba(120,140,170,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = pad.t + plotH * frac;
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
  }
  ctx.stroke();
  // 0-baseline accent.
  ctx.strokeStyle = 'rgba(180,200,230,0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const y0 = toY(0);
  ctx.moveTo(pad.l, y0);
  ctx.lineTo(pad.l + plotW, y0);
  ctx.stroke();

  // Y-axis tick labels (just min / max / 0 — keeps it readable in 60px).
  ctx.fillStyle = themeColor('ink-dim') || 'rgba(160,180,200,0.7)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(yMax.toFixed(2), pad.l - 4, pad.t + 4);
  ctx.fillText(yMin.toFixed(2), pad.l - 4, pad.t + plotH - 4);
  ctx.fillText('0',             pad.l - 4, y0);

  // Per-band trajectories — bold lines with sci-fi glow.
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  for (let k = 0; k < bandTraj.length; k++) {
    const col = groupColor(k) || '#cdd5e1';
    ctx.strokeStyle = col;
    // shadowBlur gives the glow; reset between bands so colors don't bleed.
    ctx.shadowColor = col;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const traj = bandTraj[k];
    let started = false;
    for (let i = 0; i < traj.length; i++) {
      const v = traj[i];
      if (!Number.isFinite(v)) { started = false; continue; }
      const x = toX(i);
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else          { ctx.lineTo(x, y); }
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function _drawEmpty(canvas, msg) {
  if (typeof canvas !== 'object') return;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(160,180,200,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}
