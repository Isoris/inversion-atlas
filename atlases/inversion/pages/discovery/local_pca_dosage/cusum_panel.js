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
    panel.style.display = want ? 'flex' : 'none';
  }
  if (!want) return;
  if (!state || !state.data) return;

  // 2026-05-20: paint the focal CUSUM (existing behavior, lockedLabels
  // → nearest-L2 sweep). Then, if the L3 layout is "Dual" and a
  // secondary L2 is pinned, also paint a second CUSUM trajectory in
  // the right pane using that L2's K-means labels. The CSS rules on
  // body[data-l3-layout="dual"] reveal the right pane; otherwise it
  // collapses to 0 width. Re-paint of the right pane is cheap (same
  // compute path; the trajectories are O(K × n_windows)).
  _paintFocalCusum(state, canvas, labelEl);
  const secondaryCanvas = document.getElementById('cusumCanvasRight');
  const secondaryLabel  = document.getElementById('cusumPanelLabelRight');
  const dual = state.l3Layout === 'dual'
            && Number.isFinite(state.secondaryL2)
            && state.secondaryL2 >= 0;
  if (dual && secondaryCanvas) {
    _paintSecondaryCusum(state, secondaryCanvas, secondaryLabel);
  } else if (secondaryCanvas) {
    // Clear in case we just left dual mode so the old image doesn't
    // linger on a future re-entry into dual.
    const sCtx = secondaryCanvas.getContext('2d');
    if (sCtx) sCtx.clearRect(0, 0, secondaryCanvas.width || 1, secondaryCanvas.height || 1);
  }
}

// 2026-05-20: extracted focal-CUSUM body. Same logic as before, just
// targets the caller-supplied canvas + label so the right pane can
// reuse it. Returns silently when no labels are resolvable.
function _paintFocalCusum(state, canvas, labelEl) {

  // Resolve labels. Strategy (2026-05-20):
  //   1. lockedLabels (user has explicitly pinned a K-band assignment) — preferred.
  //   2. current window's L2 cluster labels — the legacy behavior.
  //   3. NEAREST L2 with valid cluster labels — fallback. In GHSL / θπ
  //      modes the user's cursor often sits on a window whose L2 hasn't
  //      produced usable labels (e.g. n_samples_per_group below threshold),
  //      which used to bail out with "no K-band labels at this window".
  //      The user (Quentin, 2026-05-20) said "we dont have sparse mode but
  //      we can still try or not?" — so we now sweep outward from cur to
  //      find ANY L2 with labels and use those rather than render empty.
  //      The cusum is per-band-trajectory across the whole chrom; the
  //      starting label set just defines K, the bands themselves still
  //      mean the same thing across windows.
  let labels = state.lockedLabels;
  let labelsSource = labels ? 'locked' : null;
  if (!labels) {
    const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
    if (curL2 >= 0) {
      const cl = getL2Cluster(state, curL2);
      if (cl && cl.labels) { labels = cl.labels; labelsSource = `L2#${curL2}`; }
    }
  }
  if (!labels && state.data && Array.isArray(state.data.l2_envelopes)) {
    const wToL2 = state.windowToL2;
    const N = state.data.l2_envelopes.length;
    // Sweep adjacent L2s by walker distance, then anywhere on the chrom.
    const curL2 = (wToL2 && state.cur != null) ? wToL2[state.cur] : -1;
    const order = [];
    if (curL2 >= 0) {
      for (let d = 1; d < N; d++) {
        if (curL2 - d >= 0) order.push(curL2 - d);
        if (curL2 + d < N)  order.push(curL2 + d);
      }
    } else {
      for (let i = 0; i < N; i++) order.push(i);
    }
    for (const li of order) {
      try {
        const cl = getL2Cluster(state, li);
        if (cl && cl.labels) { labels = cl.labels; labelsSource = `L2#${li} (nearest)`; break; }
      } catch (_) {}
    }
  }
  if (!labels) {
    _drawEmpty(canvas, 'Σ CUSUM — no K-band labels anywhere on this chromosome');
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

// 2026-05-20: secondary-CUSUM pane. Uses state.secondaryL2's K-means
// labels as the band partition (instead of lockedLabels / focal-L2)
// and paints the per-band trajectories on the right-side canvas. The
// per-band trajectory shape is identical (same residual + op + axis
// state slots) so the user reads the right pane the same way as the
// left — only the partition differs.
function _paintSecondaryCusum(state, canvas, labelEl) {
  if (!state || !state.data) return;
  const li = state.secondaryL2 | 0;
  const cl = getL2Cluster(state, li);
  const labels = cl && cl.labels;
  if (!labels) {
    _drawEmpty(canvas, `Σ CUSUM (L2#${li}) — no K-band labels at secondary L2`);
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
  const r = perSampleCusumByKaryotype(state, axis, labels, K, { residual, op });
  if (!r || !r.bandTraj || r.bandTraj.length === 0) {
    _drawEmpty(canvas, 'Σ CUSUM (secondary) — compute returned empty');
    return;
  }
  const bandTraj = r.bandTraj;
  if (labelEl) {
    labelEl.innerHTML = `Σ CUSUM <span style="color: var(--ink-dimmer);
      font-weight: normal;">(secondary L2#${li} · ${axis} · ${residual} · ${op}-per-band)</span>`;
  }
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 44, r: 16, t: 14, b: 16 };
  const plotW = Math.max(1, w - pad.l - pad.r);
  const plotH = Math.max(1, h - pad.t - pad.b);
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
  if (!isFinite(vMin) || !isFinite(vMax)) { _drawEmpty(canvas, 'Σ CUSUM — all NaN'); return; }
  const vAbs = Math.max(Math.abs(vMin), Math.abs(vMax), 1e-9);
  const yMin = -vAbs * 1.05;
  const yMax =  vAbs * 1.05;
  const nW = bandTraj[0].length;
  const toX = (wi) => pad.l + (nW > 1 ? (wi / (nW - 1)) * plotW : plotW / 2);
  const toY = (v)  => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  // Grid + 0-baseline.
  ctx.strokeStyle = 'rgba(120,140,170,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = pad.t + plotH * frac;
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(180,200,230,0.32)';
  ctx.beginPath();
  const y0 = toY(0);
  ctx.moveTo(pad.l, y0);
  ctx.lineTo(pad.l + plotW, y0);
  ctx.stroke();
  // Y-axis tick labels.
  ctx.fillStyle = themeColor('ink-dim') || 'rgba(160,180,200,0.7)';
  ctx.font = '9.5px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(yMax.toFixed(2), pad.l - 4, pad.t + 4);
  ctx.fillText(yMin.toFixed(2), pad.l - 4, pad.t + plotH - 4);
  ctx.fillText('0',             pad.l - 4, y0);
  // Trajectories.
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  for (let k = 0; k < bandTraj.length; k++) {
    const col = groupColor(k) || '#cdd5e1';
    ctx.strokeStyle = col;
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
