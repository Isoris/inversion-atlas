// pages/discovery/page1/pca_panel.js
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
// Bodies extracted verbatim from the pre-split page1.js (eighth pass).

import { escapeHtml, fitCanvas, themeColor, withAlpha } from '../../../shared/page1_utils.js';
import { contextFromState, sampleSpreadL2 } from '../../../shared/per_l2_cluster.js';

import { _pageState, _setActiveState, _vColor, getSampleColor, trackedColor } from './_state.js';
import { allSampleIdx, getL2Cluster, getPC, getPCRender } from './_data.js';
import { drawLinesPanel } from './lines_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { refreshBandPickBar } from './candidates.js';
import { onPCAClick, setCur } from './events.js';

// --- recomputeAnchorConcord — legacy lines 36081-36122 ---
function recomputeAnchorConcord() {
  const state = _pageState;
  if (!state.data) { state.anchorConcord = null; return; }
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
    const cl = getL2Cluster(l2i);
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

// --- _refreshScreeInset — legacy lines 56497-56513 ---
function _refreshScreeInset() {
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
  const d = state.data;
  const cur = state.cur;
  const trailStart = Math.max(0, cur - state.trailN);

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
  if (state.data && state.data.windows && state.cur >= 0
      && state.cur < state.data.windows.length) {
    const _wObj = state.data.windows[state.cur];
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
    }
  }
  // Expose for lasso handler. Plot bounds also stored so lasso can clip
  // its drag rectangle to the data area.
  state.__pcaScreenXY = _pcaScreenXY;
  state.__pcaPlotRect = { x: pad.l, y: pad.t, w: plotW, h: plotH };

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
  // turn 120: refresh the scree inset on every PCA draw. Cheap (pure SVG
  // string write to an absolutely-positioned div, no canvas, no layout).
  // The renderer handles the off/on toggle and the empty-state internally.
  try { _refreshScreeInset(); } catch (e) { /* fail-soft */ }
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
  const N = state.data.n_windows;
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
    if (typeof renderTrackedList === 'function') renderTrackedList(state);
    try { drawLinesPanel(state); } catch (_) {}
    try { drawPCA(state); }        catch (_) {}
    if (typeof renderL3Panel === 'function') { try { renderL3Panel(state); } catch (_) {} }
    return;
  }
  // 2026-05-06 round 3: getPC extracted from legacy and takes (state, winIdx).
  // Defensive try/catch is kept because state.data.windows[i].pc1 may be
  // missing on slim precomp JSONs (has_pc2 === false path).
  let pcRes;
  if (typeof getPC === 'function') {
    try { pcRes = getPC(state, state.cur); } catch (_) { pcRes = null; }
  }
  if (!pcRes) {
    state.tracked = [];
    if (typeof renderTrackedList === 'function') renderTrackedList(state);
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
  if (typeof renderTrackedList === 'function') renderTrackedList(state);
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
  if (typeof refreshBandPickBar === 'function') refreshBandPickBar(state);
  if (state.trackingAnchor) state.trackingAnchor = null;
  if (typeof recomputeAnchorConcord === 'function') {
    try { recomputeAnchorConcord(); } catch (_) {}
  }
  if (typeof drawPCA === 'function')        { try { drawPCA(state); }        catch (_) {} }
  if (typeof drawLinesPanel === 'function') { try { drawLinesPanel(state); } catch (_) {} }
  if (typeof renderZoneBlock === 'function'){ try { renderZoneBlock(state); }catch (_) {} }
  if (typeof renderL3Panel === 'function')  { try { renderL3Panel(state); }  catch (_) {} }
  if (typeof drawAnchorStrip === 'function') {
    try { drawAnchorStrip(state); } catch (_) {}
  }
  if (typeof _updateConcordBadge === 'function') {
    try { _updateConcordBadge(); } catch (_) {}
  }
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
  if (typeof recomputeAnchorConcord === 'function') {
    try { recomputeAnchorConcord(); } catch (e) {}
  }
  if (typeof drawAnchorStrip === 'function') {
    try { drawAnchorStrip(state); } catch (e) {}
  }
  // v3.71: badge update after the recompute
  if (typeof _updateConcordBadge === 'function') {
    try { _updateConcordBadge(); } catch (e) {}
  }
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
