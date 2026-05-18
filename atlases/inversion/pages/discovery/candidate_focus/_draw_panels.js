// pages/discovery/candidate_focus/_draw_panels.js
//
// Drawing-panel sub-module for candidate_focus (chat 36 round 5 step 2,
// 2026-05-07). 7 functions that paint the analytic panels of the
// candidate-detail page on canvas elements: local PCA, per-sample
// lines, GHSL per-band, sigma chart, location strip, plus the two
// statistical-support helpers sigmaProfileCandidate and
// candidateBandComposition.
//
// All bodies extracted byte-verbatim from legacy/Inversion_atlas.html.
// State shim same as _html_builders.js.
//
// This module has zero cross-bucket dependencies within candidate_focus/, but
// imports a few shared helpers from atlases/inversion/shared/ for
// statistical computation and PC access.

import { _pageState } from './_state.js';
import { sampleSpreadRange, getPC, getL2Cluster, allSampleIdx, getActiveSimScale, groupColor } from '../../../shared/page1_data_helpers.js';

// --- _candWindowRange — extracted from legacy line 59237 (candidate_focus-private) ---
// Returns the [s0, e0] (0-based, inclusive) window range of a candidate's
// span, clamped to the chromosome's window count. Returns null if invalid.
function _candWindowRange(c) {
  const state = _pageState;
  if (!c) return null;
  // Candidates store start_w / end_w as 1-based inclusive (matching the
  // catalogue convention). The internal getPC array is 0-based.
  const s0 = Math.max(0, (c.start_w | 0) - 1);
  const e0 = Math.max(s0, Math.min((state.data.n_windows | 0) - 1, (c.end_w | 0) - 1));
  if (s0 > e0) return null;
  return [s0, e0];
}

// --- _candLockedLabels — extracted from legacy line 59247 (candidate_focus-private) ---
// Returns the candidate's locked K-means labels (Int8Array), or null if
// they weren't locked when promoted or if the array length disagrees.
function _candLockedLabels(c) {
  const state = _pageState;
  // The candidate stores locked_labels as an Int8Array of length n_samples
  // (or null if colors weren't locked when promoted). Returns null if absent.
  if (!c || !c.locked_labels) return null;
  if (c.locked_labels.length !== state.data.n_samples) return null;
  return c.locked_labels;
}

// --- sigmaProfileCandidate — extracted from legacy ---
export function sigmaProfileCandidate(cand) {
  const state = _pageState;
  if (!cand) return null;
  const sd = sampleSpreadRange(state, cand.start_w, cand.end_w);
  if (!sd) return null;
  const vals = Array.from(sd).filter(v => isFinite(v));
  if (vals.length < 10) return null;
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  const q50 = q(0.50), q90 = q(0.90), q95 = q(0.95);
  let mean = 0; for (const v of vals) mean += v; mean /= vals.length;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of vals) {
    const d = v - mean;
    m2 += d*d; m3 += d*d*d; m4 += d*d*d*d;
  }
  m2 /= vals.length; m3 /= vals.length; m4 /= vals.length;
  const variance = m2;
  const skew = variance > 0 ? m3 / Math.pow(variance, 1.5) : 0;
  const kurt = variance > 0 ? m4 / (variance * variance) : 3;
  const bimodality_coef = (skew * skew + 1) / kurt;
  const is_bimodal = bimodality_coef > (5 / 9);
  const high_thr = 2 * q50;
  const n_high = vals.filter(v => v > high_thr).length;
  const ratio_high = n_high / vals.length;
  let verdict, reason;
  const K = cand.K;
  if (K <= 3) {
    verdict = 'NA';
    reason = `K=${K}, no extra bands to explain`;
  } else if (q50 < 0.05 && ratio_high < 0.05) {
    verdict = 'TWO_INVERSIONS';
    reason = `${K} bands, all samples stable across candidate (q50=${q50.toFixed(3)})`;
  } else if (is_bimodal && ratio_high > 0.02 && ratio_high < 0.25) {
    verdict = 'CROSSOVER_ARTIFACTS';
    reason = `${n_high} samples drifting across candidate (${(ratio_high*100).toFixed(0)}%, BC=${bimodality_coef.toFixed(2)})`;
  } else if (q50 > 0.10) {
    verdict = 'NOISY_REGION';
    reason = `everyone has high σ (q50=${q50.toFixed(3)}) — low power`;
  } else {
    verdict = 'UNDETERMINED';
    reason = `q50=${q50.toFixed(3)}, BC=${bimodality_coef.toFixed(2)}, ratio_high=${(ratio_high*100).toFixed(0)}%`;
  }
  // Top drifters (descending σ), capped at 12 for the candidate page
  const sortedIdx = [];
  for (let si = 0; si < sd.length; si++) sortedIdx.push(si);
  sortedIdx.sort((a, b) => sd[b] - sd[a]);
  const top_high = sortedIdx.slice(0, Math.min(12, n_high)).map(si => ({
    si, sigma: sd[si],
  }));
  return {
    sd, q50, q90, q95, n_high, ratio_high, bimodality_coef, is_bimodal,
    verdict, reason, top_high,
  };
}

// --- candidateBandComposition — extracted from legacy ---
export function candidateBandComposition(cand) {
  const state = _pageState;
  if (!cand || !cand.locked_labels) return null;
  const d = state.data;
  if (!d) return null;
  const K = cand.K;
  const out = [];
  for (let k = 0; k < K; k++) {
    const memberIdx = [];
    for (let si = 0; si < cand.locked_labels.length; si++) {
      if (cand.locked_labels[si] === k) memberIdx.push(si);
    }
    const n = memberIdx.length;
    // Family tally
    const famCounts = new Map();
    for (const si of memberIdx) {
      const fid = d.samples[si] && d.samples[si].family_id;
      const key = (fid != null && fid !== -1) ? fid : 'unknown';
      famCounts.set(key, (famCounts.get(key) || 0) + 1);
    }
    const families = Array.from(famCounts.entries())
      .map(([family_id, count]) => ({ family_id, n: count, frac: n > 0 ? count / n : 0 }))
      .sort((a, b) => b.n - a.n);
    // Ancestry tally (if available)
    const ancCounts = new Map();
    for (const si of memberIdx) {
      const a = d.samples[si] && d.samples[si].ancestry;
      const key = a || 'unknown';
      ancCounts.set(key, (ancCounts.get(key) || 0) + 1);
    }
    const ancestries = Array.from(ancCounts.entries())
      .map(([label, count]) => ({ label, n: count, frac: n > 0 ? count / n : 0 }))
      .sort((a, b) => b.n - a.n);
    out.push({ k, n, members: memberIdx, families, ancestries });
  }
  return out;
}

// --- drawCandLocalPCA — extracted from legacy ---
export function drawCandLocalPCA(c) {
  const canvas = document.getElementById('cp-localpca-canvas');
  if (!canvas) return;
  const range = _candWindowRange(c);
  if (!range) return;
  const labels = _candLockedLabels(c);
  // drawSlabMiniPCA already does the right thing — aggregate per-sample
  // mean PC1/PC2 across the range, color by the provided labels.
  drawSlabMiniPCA(canvas, range, labels);
  // If no locked labels, overlay a hint
  if (!labels) {
    const fit = fitCanvas(canvas);
    const { ctx, w, h } = fit;
    ctx.fillStyle = 'rgba(255, 215, 100, 0.8)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('lock colors on diagnostic page for per-band coloring', w / 2, 12);
  }
}

// --- drawCandLinesPanel — extracted from legacy ---
export function drawCandLinesPanel(c) {
  const state = _pageState;
  const canvas = document.getElementById('cp-lines-canvas');
  if (!canvas) return;
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  const range = _candWindowRange(c);
  if (!range) return;
  const [s0, e0] = range;
  const nW = e0 - s0 + 1;
  const nS = state.data.n_samples;
  const labels = _candLockedLabels(c);
  const pad = { l: 30, r: 8, t: 8, b: 16 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW < 10 || plotH < 10) return;

  // Y-range: scan all PC1 values (sign-aligned) across the candidate range
  let yMin = Infinity, yMax = -Infinity;
  for (let wi = s0; wi <= e0; wi++) {
    const { pc1, sign } = getPC(state, wi);
    for (let si = 0; si < nS; si++) {
      const v = pc1[si] * sign;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!isFinite(yMin) || !isFinite(yMax)) return;
  const yPad = (yMax - yMin) * 0.06 || 0.01;
  yMin -= yPad; yMax += yPad;

  const toX = wi => pad.l + ((wi - s0) / Math.max(1, nW - 1)) * plotW;
  const toY = v  => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Frame
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);

  // Zero line
  if (yMin <= 0 && yMax >= 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.l, toY(0));
    ctx.lineTo(pad.l + plotW, toY(0));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Lines: one per sample. Many samples (226) — keep alpha low so density
  // shows where most lines pass.
  ctx.lineWidth = 0.7;
  for (let si = 0; si < nS; si++) {
    const k = labels ? labels[si] : -1;
    ctx.strokeStyle = (k >= 0) ? groupColor(k) : 'rgba(180,180,180,0.5)';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    let started = false;
    for (let wi = s0; wi <= e0; wi++) {
      const { pc1, sign } = getPC(state, wi);
      const v = pc1[si] * sign;
      const x = toX(wi), y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;

  // Axes labels
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(yMax.toFixed(2), pad.l - 4, pad.t + 8);
  ctx.fillText(yMin.toFixed(2), pad.l - 4, pad.t + plotH);
  ctx.textAlign = 'left';
  ctx.fillText(`w${s0 + 1}`, pad.l, h - 3);
  ctx.textAlign = 'right';
  ctx.fillText(`w${e0 + 1}`, w - 3, h - 3);
  ctx.textAlign = 'center';
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.fillText(`${nW} windows · sign-aligned PC1`, pad.l + plotW / 2, h - 3);
}

// --- drawCandGHSLPerBand — extracted from legacy ---
export function drawCandGHSLPerBand(c) {
  const state = _pageState;
  const container = document.getElementById('cp-ghsl-bands');
  if (!container) return;
  const panel = state.data && state.data.ghsl_panel;
  if (!panel || !panel.div_roll) {
    container.innerHTML = 'GHSL panel not available for this chromosome.';
    return;
  }
  const range = _candWindowRange(c);
  if (!range) {
    container.innerHTML = 'invalid candidate window range';
    return;
  }
  const labels = _candLockedLabels(c);
  if (!labels) {
    container.innerHTML = '<span style="color: rgba(255, 215, 100, 0.85);">' +
      'lock colors on diagnostic page to enable per-band GHSL.</span>';
    return;
  }
  // Pick the primary scale.
  const scaleKey = panel.primary_scale || (panel.scales && panel.scales[0]);
  if (!scaleKey || !panel.div_roll[scaleKey]) {
    container.innerHTML = `GHSL primary scale not present in this panel (${scaleKey}).`;
    return;
  }
  const M = panel.div_roll[scaleKey];   // M[sample][window]
  // The GHSL panel uses its own grid (panel.start_bp / panel.end_bp), not the
  // precomp window grid. We need to convert the candidate's bp range into
  // panel column indices.
  if (!Array.isArray(panel.start_bp) || !Array.isArray(panel.end_bp)) {
    container.innerHTML = 'GHSL panel missing start_bp/end_bp arrays.';
    return;
  }
  const startBp = c.start_bp;
  const endBp   = c.end_bp;
  let colS = -1, colE = -1;
  for (let i = 0; i < panel.start_bp.length; i++) {
    const mid = (panel.start_bp[i] + panel.end_bp[i]) / 2;
    if (colS < 0 && mid >= startBp) colS = i;
    if (mid <= endBp) colE = i;
  }
  if (colS < 0 || colE < colS) {
    container.innerHTML = 'no GHSL columns overlap candidate range.';
    return;
  }

  // Per-sample mean GHSL across the candidate columns
  const nS = M.length;
  const mean = new Float64Array(nS);
  for (let s = 0; s < nS; s++) {
    let sum = 0, n = 0;
    for (let j = colS; j <= colE; j++) {
      const v = M[s][j];
      if (typeof v === 'number' && isFinite(v)) { sum += v; n++; }
    }
    mean[s] = (n > 0) ? sum / n : NaN;
  }

  // Group by locked label — collect mean per band
  const K = c.K | 0;
  const perBand = Array.from({length: K}, () => []);
  for (let si = 0; si < nS && si < labels.length; si++) {
    const k = labels[si];
    if (k >= 0 && k < K && isFinite(mean[si])) perBand[k].push(mean[si]);
  }

  // Render: one mini-card per band side-by-side
  container.style.gridTemplateColumns = `repeat(${K}, 1fr)`;
  let html = '';
  for (let k = 0; k < K; k++) {
    const arr = perBand[k];
    const n = arr.length;
    const mn = n > 0 ? arr.reduce((a, b) => a + b, 0) / n : NaN;
    const sd = n > 1 ? Math.sqrt(
      arr.reduce((a, b) => a + (b - mn) ** 2, 0) / (n - 1)
    ) : NaN;
    const swatch = `<span style="display:inline-block; width:9px; height:9px; ` +
                   `background:${groupColor(k)}; border-radius:2px; vertical-align:middle; ` +
                   `margin-right:5px;"></span>`;
    html += `
      <div style="background: var(--panel); border: 1px solid var(--rule); border-radius: 3px;
                  padding: 8px 10px; min-height: 80px;">
        <div style="font-family: var(--mono); font-size: 10.5px; color: var(--ink); margin-bottom: 6px;">
          ${swatch}band ${k} <span class="dim">(n=${n})</span>
        </div>
        <div style="font-family: var(--mono); font-size: 13px; font-weight: 600; color: var(--ink);">
          ${isFinite(mn) ? mn.toFixed(3) : '—'}
        </div>
        <div style="font-family: var(--mono); font-size: 10px; color: var(--ink-dim); margin-top: 2px;">
          mean GHSL · σ=${isFinite(sd) ? sd.toFixed(3) : '—'}
        </div>
        ${_candGHSLDistroBar(arr, mn, sd)}
      </div>
    `;
  }
  // Footer hint about scale used
  html += `<div style="grid-column: 1 / -1; font-family: var(--mono); font-size: 10px;
                       color: var(--ink-dimmer); margin-top: 4px;">
    scale: ${scaleKey} · columns ${colS + 1}–${colE + 1} of GHSL panel
  </div>`;
  container.innerHTML = html;
}

// --- drawCandidateSigmaChart — extracted from legacy ---
export function drawCandidateSigmaChart(c, profile) {
  const canvas = document.getElementById('candSigmaCanvas');
  if (!canvas || !profile || !profile.sd) return;
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const sd = profile.sd;
  const N = sd.length;
  if (N === 0) return;
  // Sort samples by σ ascending so the bars rise from left to right
  const order = [];
  for (let i = 0; i < N; i++) order.push(i);
  order.sort((a, b) => sd[a] - sd[b]);
  const pad = { l: 44, r: 14, t: 14, b: 22 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  let maxSd = 0;
  for (let i = 0; i < N; i++) if (isFinite(sd[i]) && sd[i] > maxSd) maxSd = sd[i];
  if (maxSd === 0) maxSd = 1e-6;
  const yMax = maxSd * 1.05;
  const barW = plotW / N;
  // Frame
  ctx.strokeStyle = themeColor('rule');
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  // 2·q50 threshold line (the "drifter" cutoff)
  if (isFinite(profile.q50)) {
    const yT = pad.t + plotH * (1 - (2 * profile.q50) / yMax);
    ctx.strokeStyle = 'rgba(245,165,36,0.55)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.l, yT);
    ctx.lineTo(pad.l + plotW, yT);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,165,36,0.85)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('2·q50', pad.l + 4, yT - 3);
  }
  // Bars: each sample at its sorted x position, height = σ, color = locked band
  for (let j = 0; j < N; j++) {
    const si = order[j];
    const v = sd[si];
    if (!isFinite(v)) continue;
    const k = c.locked_labels && c.locked_labels[si];
    const col = (k != null && k >= 0) ? groupColor(k) : '#6a7280';
    const x = pad.l + j * barW;
    const barH = (v / yMax) * plotH;
    const y = pad.t + plotH - barH;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, Math.max(0.6, barW - 0.5), barH);
  }
  // Y-axis labels (0 / max)
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('0', pad.l - 4, pad.t + plotH);
  ctx.fillText(maxSd.toFixed(3), pad.l - 4, pad.t + 8);
  // X-axis label
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.textAlign = 'center';
  ctx.fillText(`samples sorted by σ (${N} total) · color = candidate band`,
               pad.l + plotW / 2, h - 6);
}

// --- drawCandidateLocationStrip — extracted from legacy ---
export function drawCandidateLocationStrip(c) {
  if (!c) return;
  drawCandSimMini(c);
  drawCandL1Mini(c);
  drawCandKaryoMini(c);
}
