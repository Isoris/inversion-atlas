// pages/discovery/page1/events.js
//
// Click handlers + scrubber-position handler + track helpers
// (round 4 split, 2026-05-06).
//
// onSimClick / onZClick / onPCAClick: canvas click → state.cur update +
//   downstream redraw chain.
// setCur(state, i): the central scrubber-position setter; orchestrates
//   the full render chain (drawSim → drawZ → drawTracks → drawLinesPanel
//   → drawPCA → updateWinLabel → renderL3Panel).
// updateWinLabel:   refresh the window-position readout.
// buildTrackPanels: build the per-track sidebar widgets.
// drawTracks:       paint the track strips.
//
// Bodies extracted verbatim from the pre-split page1.js (eighth pass).

import { fitCanvas, fmt, fmtMb, formatTrackVal, shortId, themeColor } from '../../../shared/page1_utils.js';

import { _pageState, _setActiveState } from './_state.js';
import { allSampleIdx, currentMbRange, getL2Cluster, getPC } from './_data.js';
// Note: autoPickRadial is imported from pca_panel.js below. pca_panel.js
// also imports from events.js (setCur, onPCAClick), so this is a mutual
// import cycle — fine at runtime because both names are functions invoked
// after module init, not destructured at top-level.
import { drawSim, drawSimMini } from './sim_panel.js';
import { drawZ } from './z_panel.js';
import { drawLinesPanel } from './lines_panel.js';
import { autoPickRadial, drawAnchorStrip, drawPCA, recomputeAnchorConcord, renderTrackedList } from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';
import {
  _assignCandidateLanes,
  _candidateAtClick,
  _csBpHitTest2D,
  _csBpHitTestXFromList,
  _CS_BP_HIT_TOL_PX,
  _ensureCsOverlayIndex,
  _wRowBand,
  _wRowHandleClick,
  _winNavBand,
  _winNavHandleClick,
} from './candidates.js';

// --- updateWinLabel(state) — legacy lines 51738-51742 ---
export function updateWinLabel(state) {
  _setActiveState(state);
  if (!state || !state.data || !state.data.windows) return;
  const w = state.data.windows[state.cur];
  if (!w) return;
  const winIdxEl = document.getElementById('winIdx');
  const winBpEl  = document.getElementById('winBp');
  if (winIdxEl) winIdxEl.textContent = state.cur;
  if (winBpEl)  winBpEl.innerHTML = `· <b>${w.center_mb.toFixed(3)} Mb</b>`;
}

// --- setCur() — legacy lines 51747-51792 ---
export function setCur(state, i) {
  _setActiveState(state);
  if (!state || !state.data) return;
  state.cur = Math.max(0, Math.min(state.data.n_windows - 1, i | 0));
  const _scrubEl = document.getElementById('scrubber');
  if (_scrubEl) _scrubEl.value = state.cur;
  // 2026-05-06 round 3 (parity step): bare drawX() / updateWinLabel(state) / etc.
  // calls in legacy assumed `state` was a global. Under the new shell every
  // entry point takes `state` as first arg, so we wrap each in a guarded
  // call. The original try/catch pattern around drawSimMini/drawAnchorStrip
  // is preserved verbatim.
  try { updateWinLabel(state); } catch (_) {}
  try { drawSim(state); }       catch (_) {}
  try { drawZ(state); }         catch (_) {}
  try { drawTracks(state); }    catch (_) {}
  try { drawLinesPanel(state); }catch (_) {}
  try { drawPCA(state); }       catch (_) {}
  // v3.51: keep the minimap's orange crosshair in sync with the scrubber
  if (state.simInMinimap && typeof drawSimMini === 'function') {
    try { drawSimMini(state); } catch (_) {}
  }
  // v3.52: anchor concord strip — orange cursor line follows scrubber
  try { drawAnchorStrip(state); } catch (_) {}
  // v3.71: concord V badge (above per-sample-lines header) follows the scrubber
  try { _updateConcordBadge(state); } catch (_) {}
  try { updateSidebarInfo(state); } catch (_) {}
  try { renderZoneBlock(state); }   catch (_) {}
  if (typeof renderL3Panel === 'function') {
    try { renderL3Panel(state); } catch (_) {}
  }
  // v3.94: live dosage heatmap follows cursor (debounced; no-op when closed)
  if (typeof redrawCursorHeatmap === 'function') {
    try { redrawCursorHeatmap(); } catch (_) {}
  }
  // v4 turn 1 ask 1: keep the Windows page table .cur highlight in sync
  // with the scrubber even when the user is on page 1 (or any other page).
  // Auto-scroll the highlighted row into view + brief orange flash.
  // No-ops cheaply if the windows page DOM hasn't been built yet, or if
  // the current window's row is filtered out / not in the visible 2000.
  if (typeof _refreshWinSumCurRow === 'function') {
    try { _refreshWinSumCurRow(); } catch (_) {}
  }
  // v4 turn 31: redraw the windows-page strip too so its orange cursor
  // line follows the scrubber when ←/→ arrow keys move state.cur. Cheap
  // no-op when the strip canvas isn't visible / hasn't been built.
  if (typeof drawWinSumStrip === 'function') {
    try { drawWinSumStrip(state); } catch (_) {}
  }
  // v4 turn 22: keep the boundaries-page repeat density panel cursor in
  // sync with the global scrubber cursor. No-op when not on the boundaries
  // page or when no repeat density is loaded for the current chrom.
  if (typeof _renderRepeatDensityPanel === 'function') {
    try { _renderRepeatDensityPanel(); } catch (_) {}
  }
}

// --- onSimClick() — legacy lines 52067-52111 ---
export function onSimClick(state, evt) {
  _setActiveState(state);
  if (!state.data) return;
  const rect = document.getElementById('simCanvas').getBoundingClientRect();
  const px = evt.clientX - rect.left;
  const py = evt.clientY - rect.top;
  const g = state._simGeom;
  if (!g) return;
  // Click outside the heatmap square: ignore
  if (px < g.x0 || px > g.x1 || py < g.y0 || py > g.y1) return;
  // v4 turn 114c (remaining): cs-breakpoint click-to-jump on the diagonal
  // red-cross overlay (drawSim renders these via 114b). Check 2-D distance
  // to (toPx(bp.win), toPy(bp.win)) before falling back to the existing
  // x-axis scrub. Tolerance is _CS_BP_HIT_TOL_PX from the centralized
  // helper. Done before the x-axis fallback so a click ON a cross goes
  // to that cross, not to whatever window is at that x-fraction.
  if (typeof _ensureCsOverlayIndex === 'function') {
    const csIdx = _ensureCsOverlayIndex();
    if (csIdx && csIdx.bps.length > 0) {
      const Nw = state.data.n_windows;
      // Replicate drawSim's mapping exactly (it lives inside drawSim's
      // closure so we can't reuse it; re-derive from state._simGeom).
      const _toPx = (wIdx) => g.x0 + (wIdx + 0.5) * g.side / Nw;
      const _toPy = (wIdx) => g.y0 + (wIdx + 0.5) * g.side / Nw;
      // Allow a slightly larger tolerance here because the cross arms
      // extend ±7 px from center (see drawSim 114b armPx=7), so a click
      // near the tip of an arm is a legitimate target.
      const SIM_TOL = 7;
      const hit = _csBpHitTest2D(
        csIdx.bps, px, py,
        (bp) => (bp.win >= 0 && bp.win < Nw)
          ? { x: _toPx(bp.win), y: _toPy(bp.win) }
          : null,
        SIM_TOL
      );
      if (hit) {
        _csBpJumpToWindow(hit);
        return;
      }
    }
  }
  // Prefer x-axis (horizontal) → window index. The heatmap is symmetric, so
  // either axis works, but x is the natural "scrub through chromosome" gesture.
  const frac = (px - g.x0) / g.side;
  setCur(state, Math.round(frac * (state.data.n_windows - 1)));
}

// --- onZClick() — legacy lines 52112-52202 ---
export function onZClick(state, evt) {
  _setActiveState(state);
  if (!state.data) return;
  const canvas = document.getElementById('zCanvas');
  const rect = canvas.getBoundingClientRect();
  const pad = { l: 44, r: 16 };
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;     // v4 turn 10: track y for W-row hit-test
  const plotW = rect.width - pad.l - pad.r;
  const frac = Math.max(0, Math.min(1, (x - pad.l) / plotW));
  const d = state.data;
  const mbMin = d.windows[0].center_mb;
  const mbMax = d.windows[d.n_windows - 1].center_mb;
  const targetMb = mbMin + frac * (mbMax - mbMin);
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < d.n_windows; i++) {
    const dd = Math.abs(d.windows[i].center_mb - targetMb);
    if (dd < bestD) { bestD = dd; bestI = i; }
  }
  // v4 turn 10: if the click landed inside the W-row, treat it as a window-
  // resolution draft edit instead of a setCur jump. The W-row's y-band is
  // computed from the same layout constants drawZ uses.
  // We need to mirror drawZ's collapsed/expanded layout choice here:
  //   collapsed mode uses padT=2, candBarH=5, candGap=1, zoneH=14
  //   expanded mode uses padT=14, candBarH=7, candGap=2, zoneH=14
  // _wRowBand returns null when the W-row isn't visible, so we fall through
  // to setCur in those cases.
  // v4 turn 13 (Deliverable B): account for multi-lane candBar height
  // (candBarTotal = candBarH × n_lanes). The candidate-click hit-test runs
  // BEFORE the W-row test so clicks on stacked candidate bars route to
  // candidate selection rather than setCur.
  const collapsed = !!state.zCollapsed;
  const padT     = collapsed ? 2 : 14;
  const candBarH = collapsed ? 5 : 7;
  const candGap  = collapsed ? 1 : 2;
  const _candLanes = (typeof _assignCandidateLanes === 'function')
    ? _assignCandidateLanes(state.candidateList || []).n_lanes : 1;
  const candBarTotal = candBarH * _candLanes;
  const zoneTop  = padT + candBarTotal + candGap;
  const zoneH    = 14;
  // Mb→px function matching drawZ's
  const toX_click = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;
  // v4 turn 13: candidate hit-test (lane-aware) — sets active candidate on hit
  if (typeof _candidateAtClick === 'function') {
    const hit = _candidateAtClick(x, y, padT, candBarTotal, toX_click, d);
    if (hit) {
      state.candidate = hit;
      // v4 turn 56: route through helper so persistence stays consistent
      // with the prev/next nav path (_navigateToCandidate).
      _persistActiveCandidate(hit.id || '');
      // Trigger a re-render so the new active candidate's downstream views
      // (candidate-focus tab, scale-stability "candidate" scale) update.
      if (typeof drawZ === 'function') drawZ(state);
      if (typeof renderL3Panel === 'function') renderL3Panel(state);
      if (typeof renderCandidateMetadata === 'function') renderCandidateMetadata();
      return;
    }
  }
  // v4 turn 33 (Ask A): nav-lane click test runs BEFORE the W-row test.
  // Its band sits between the L2 zone bar and the W-row. The W-row's zoneH
  // is inflated by the nav-lane's height + gap so its hit-test lands below
  // the nav-lane (matching the drawZ layout).
  const _navBandClick = _winNavBand({ collapsed, zoneTop, zoneH });
  const _navExtraClick = _navBandClick ? (_navBandClick.h + _navBandClick.gap) : 0;
  if (_winNavHandleClick(y, bestI, { collapsed, zoneTop, zoneH })) return;
  if (_wRowHandleClick(y, bestI, { collapsed, zoneTop,
                                    zoneH: zoneH + _navExtraClick })) return;
  // v4 turn 114c (remaining): cs-breakpoint click-to-jump. The red dashed
  // vertical lines drawn by drawZ at toX_click(bp.mb) take priority over
  // the generic setCur(state, bestI) fallback so users can land on a breakpoint
  // window even when the click isn't pixel-perfect on the dashed line.
  // Hit-test runs AFTER candidate / nav-lane / W-row tests because those
  // are higher-precedence interactive zones; users dragging a candidate
  // boundary or W-row scrubbing shouldn't be hijacked by a cs-bp click.
  if (typeof _ensureCsOverlayIndex === 'function') {
    const csIdx = _ensureCsOverlayIndex();
    if (csIdx && csIdx.bps.length > 0) {
      const _toXBp = (bp) => {
        if (bp.mb < mbMin || bp.mb > mbMax) return NaN;
        return toX_click(bp.mb);
      };
      const hit = _csBpHitTestXFromList(csIdx.bps, x, _CS_BP_HIT_TOL_PX, _toXBp);
      if (hit) {
        _csBpJumpToWindow(hit);
        return;
      }
    }
  }
  setCur(state, bestI);
}

// --- onPCAClick() — legacy lines 52203-52244 ---
export function onPCAClick(state, evt) {
  _setActiveState(state);
  if (!state.data) return;
  const canvas = document.getElementById('pcaCanvas');
  const rect = canvas.getBoundingClientRect();
  const px = evt.clientX - rect.left, py = evt.clientY - rect.top;
  const d = state.data, cur = state.cur;
  const trailStart = Math.max(0, cur - state.trailN);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let wi = trailStart; wi <= cur; wi++) {
    if (typeof getPC !== 'function') return;
    let pcRes;
    try { pcRes = getPC(state, wi); } catch (_) { return; }
    if (!pcRes) return;
    const { pc1, pc2, sign } = pcRes;
    const samples = (wi === cur) ? allSampleIdx(state) : state.tracked;
    for (const si of samples) {
      const x = pc1[si] * sign, y = pc2[si];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
  }
  const xPad = (xMax - xMin) * 0.08 || 0.01, yPad = (yMax - yMin) * 0.08 || 0.01;
  xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
  const w = rect.width, h = rect.height;
  // v3.73: must match drawPCA's pad constants. If they diverge, click-to-pick
  // hit detection will be off by the difference.
  // v3.99 turn 14d ask 3: r reduced 200 → 16 (matches drawPCA above).
  const pad = { l: 50, r: 16, t: 10, b: 38 };
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b;
  if (px < pad.l || px > w - pad.r || py < pad.t || py > h - pad.b) return;
  const toX = v => pad.l + ((v - xMin) / (xMax - xMin)) * plotW;
  const toY = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;
  let pcCur;
  if (typeof getPC === 'function') {
    try { pcCur = getPC(state, cur); } catch (_) { pcCur = null; }
  }
  if (!pcCur) return;
  const { pc1, pc2, sign } = pcCur;
  let bestI = -1, bestD = Infinity;
  for (let si = 0; si < d.n_samples; si++) {
    const x = toX(pc1[si] * sign), y = toY(pc2[si]);
    const dd = (x - px) * (x - px) + (y - py) * (y - py);
    if (dd < bestD) { bestD = dd; bestI = si; }
  }
  if (bestI >= 0 && bestD < 400) {
    const i = state.tracked.indexOf(bestI);
    if (i >= 0) state.tracked.splice(i, 1);
    else if (state.tracked.length < state.trackedN) state.tracked.push(bestI);
    renderTrackedList(state); drawLinesPanel(state); drawPCA(state); renderL3Panel(state);
  }
}

// --- buildTrackPanels(state) — legacy lines 32805-32848 ---
export function buildTrackPanels(state) {
  _setActiveState(state);
  const container = document.getElementById('tracksContainer');
  if (!container) return;
  container.innerHTML = '';
  if (!state.data || !state.data.tracks) return;
  const labels = Object.keys(state.data.tracks);
  if (labels.length === 0) return;
  for (const label of labels) {
    const trk = state.data.tracks[label];
    const panel = document.createElement('div');
    panel.className = 'track-panel';
    panel.dataset.trackLabel = label;
    const cv = document.createElement('canvas');
    panel.appendChild(cv);
    const lbl = document.createElement('div');
    lbl.className = 'track-label';
    lbl.innerHTML = `<b>${label}</b>`;
    panel.appendChild(lbl);
    const rng = document.createElement('div');
    rng.className = 'track-range';
    if (isFinite(trk.min) && isFinite(trk.max)) {
      rng.textContent = `${formatTrackVal(trk.min)} – ${formatTrackVal(trk.max)}`;
    }
    panel.appendChild(rng);
    // Click-to-jump (same gesture as Z panel)
    panel.addEventListener('click', e => {
      const rect = cv.getBoundingClientRect();
      const pad = { l: 44, r: 16 };
      const x = e.clientX - rect.left;
      const plotW = rect.width - pad.l - pad.r;
      const frac = Math.max(0, Math.min(1, (x - pad.l) / plotW));
      const wins = state.data.windows;
      const mbMin = wins[0].center_mb, mbMax = wins[wins.length - 1].center_mb;
      const targetMb = mbMin + frac * (mbMax - mbMin);
      let bestI = 0, bestD = Infinity;
      for (let i = 0; i < wins.length; i++) {
        const dd = Math.abs(wins[i].center_mb - targetMb);
        if (dd < bestD) { bestD = dd; bestI = i; }
      }
      setCur(state, bestI);
    });
    container.appendChild(panel);
  }
}

// --- drawTracks(state) — legacy lines 32860-32872 ---
export function drawTracks(state) {
  _setActiveState(state);
  if (!state.data || !state.data.tracks) return;
  const container = document.getElementById('tracksContainer');
  if (!container) return;
  const panels = container.querySelectorAll('.track-panel');
  for (const panel of panels) {
    const label = panel.dataset.trackLabel;
    const cv = panel.querySelector('canvas');
    const trk = state.data.tracks[label];
    if (!trk || !trk.values) continue;
    drawOneTrack(state, cv, trk, label);
  }
}

// --- drawOneTrack — legacy lines 32874-33001 ---
// Renders a single track strip (line graph + L1/L2 zone bars + crosshair).
// Legacy was global-state; here state is passed explicitly so _pageState
// dependency is removed for this leaf helper.
function drawOneTrack(state, canvas, trk, label) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const wins = state.data.windows;
  const Nwins = wins.length;
  if (Nwins === 0) return;
  const pad = { l: 44, r: 16, t: 16, b: 6 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const _mbR = currentMbRange(state);
  const mbMin = _mbR.mbMin, mbMax = _mbR.mbMax;

  let lo = trk.min, hi = trk.max;
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) { lo = 0; hi = 1; }
  const yPad = (hi - lo) * 0.05;
  lo -= yPad; hi += yPad;
  const toX = mb => pad.l + ((mb - mbMin) / Math.max(1e-9, mbMax - mbMin)) * plotW;
  const toY = v  => pad.t + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * plotH;

  // Frame
  ctx.strokeStyle = themeColor('rule');
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);

  // Y-axis ticks
  ctx.fillStyle = themeColor('ink-dimmer');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(formatTrackVal(hi), pad.l - 4, pad.t + 8);
  ctx.fillText(formatTrackVal(lo), pad.l - 4, pad.t + plotH);

  // Grid-decoupled rendering: tracks may carry their own pos_bp grid.
  const hasPosBp = Array.isArray(trk.pos_bp) && trk.pos_bp.length === trk.values.length;
  const Nval = trk.values.length;

  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < Nval; i++) {
    const v = trk.values[i];
    if (v == null || !isFinite(v)) { started = false; continue; }
    const mbHere = hasPosBp
      ? (trk.pos_bp[i] / 1e6)
      : (i < Nwins ? wins[i].center_mb : NaN);
    if (!isFinite(mbHere)) { started = false; continue; }
    const x = toX(mbHere), y = toY(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();

  // L1/L2 zone bars at top — match Z-panel palette.
  const barH = 3;
  const yL1 = 1, yL2 = 1 + barH + 1;
  if (Array.isArray(state.data.l1_envelopes)) {
    for (const e of state.data.l1_envelopes) {
      const x0 = toX(wins[e._s0].center_mb), x1 = toX(wins[e._e0].center_mb);
      ctx.fillStyle = 'rgba(48,116,200,0.55)';
      ctx.fillRect(x0, yL1, x1 - x0, barH);
    }
  }
  if (Array.isArray(state.data.l2_envelopes)) {
    for (const e of state.data.l2_envelopes) {
      const x0 = toX(wins[e._s0].center_mb), x1 = toX(wins[e._e0].center_mb);
      ctx.fillStyle = 'rgba(34,160,80,0.55)';
      ctx.fillRect(x0, yL2, x1 - x0, barH);
    }
  }

  // Crosshair at current window
  const cur = state.cur;
  if (cur >= 0 && cur < Nwins) {
    const xc = toX(wins[cur].center_mb);
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.round(xc) + 0.5, pad.t);
    ctx.lineTo(Math.round(xc) + 0.5, pad.t + plotH);
    ctx.stroke();
    let v = null;
    if (hasPosBp) {
      const curBp = (wins[cur].start_bp + wins[cur].end_bp) / 2;
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < Nval; i++) {
        const d = Math.abs(trk.pos_bp[i] - curBp);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) v = trk.values[bestI];
    } else {
      v = trk.values[cur];
    }
    if (v != null && isFinite(v)) {
      ctx.fillStyle = '#f5a524';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = xc > w / 2 ? 'right' : 'left';
      const offX = xc > w / 2 ? -4 : 4;
      ctx.fillText(formatTrackVal(v), xc + offX, pad.t + 12);
    }
  }
}

// --- updateSidebarInfo(state) — legacy lines 51729-51737 ---
export function updateSidebarInfo(state) {
  _setActiveState(state);
  if (!state || !state.data || !Array.isArray(state.data.windows)) return;
  const el = document.getElementById('sidebarInfo');
  if (!el) return;
  const w = state.data.windows[state.cur];
  if (!w) return;
  el.innerHTML =
    `<span class="dim">idx</span> ${state.cur}<br>` +
    `<span class="dim">Mb </span> ${w.center_mb.toFixed(3)}<br>` +
    `<span class="dim">|Z|</span> ${fmt(Math.abs(w.z || 0))}<br>` +
    `<span class="dim">λ₁ </span> ${fmt(w.lam1)}<br>` +
    `<span class="dim">λ₂ </span> ${fmt(w.lam2)}`;
}

// --- renderZoneBlock(state) — legacy lines 48274-48318 ---
// Renders the L1/L2 zone block above the K-means legend in the sidebar.
// Reads windowToL1, windowToL2, l2NeighborsInL1 — all built by buildIndexes.
export function renderZoneBlock(state) {
  _setActiveState(state);
  const el = document.getElementById('zoneBlock');
  if (!el) return;
  if (!state || !state.data) { el.textContent = '—'; return; }
  const d = state.data;
  const cur = state.cur;
  const l1i = state.windowToL1 ? state.windowToL1[cur] : -1;
  const l2i = state.windowToL2 ? state.windowToL2[cur] : -1;

  let html = '';
  if (l1i >= 0 && d.l1_envelopes && d.l1_envelopes[l1i]) {
    const e = d.l1_envelopes[l1i];
    html += `<div class="zone-title">L1 zone</div>` +
            `<div><span class="zone-id">${e.candidate_id}</span></div>` +
            `<div class="zone-meta">w ${e.start_w}–${e.end_w} · ${fmtMb(e.start_bp)}–${fmtMb(e.end_bp)} Mb · ${e.n_windows}W · sim ${fmt(e.mean_sim)}</div>`;
  } else {
    html += `<div class="zone-title">L1 zone</div><div class="zone-meta">— outside L1 envelopes —</div>`;
  }

  if (l2i >= 0 && d.l2_envelopes && d.l2_envelopes[l2i]) {
    const e = d.l2_envelopes[l2i];
    const cl = getL2Cluster(state, l2i);
    const okText = cl && cl.ok ? `K=${state.k} · n/group: ${cl.n_per_group.join('/')}`
                                : `K=${state.k} · ${cl ? cl.reason || 'INCOMPLETE' : '—'}`;
    html += `<div class="zone-title">L2 zone</div>` +
            `<div><span class="zone-id">${e.candidate_id}</span></div>` +
            `<div class="zone-meta">w ${e.start_w}–${e.end_w} · ${fmtMb(e.start_bp)}–${fmtMb(e.end_bp)} Mb · ${e.n_windows}W · sim ${fmt(e.mean_sim)}</div>` +
            `<div class="zone-meta">${okText}</div>`;

    const nbMap = state.l2NeighborsInL1;
    const nb = (nbMap && typeof nbMap.get === 'function') ? (nbMap.get(l2i) || { left: null, right: null })
                                                          : { left: null, right: null };
    const lname = nb.left  != null ? d.l2_envelopes[nb.left]?.candidate_id  : null;
    const rname = nb.right != null ? d.l2_envelopes[nb.right]?.candidate_id : null;
    let nbHtml = '<div class="zone-title">L2 neighbors (in same L1 parent)</div>';
    nbHtml += `<div class="neighbor">` +
              (lname ? `<span class="arrow">←</span> ${shortId(lname)} ` : `<span class="arrow">←</span> <span class="dim">none</span> `) +
              `<span class="ncur">[${shortId(e.candidate_id)}]</span> ` +
              (rname ? ` ${shortId(rname)} <span class="arrow">→</span>` : ` <span class="dim">none</span> <span class="arrow">→</span>`) +
              `</div>`;
    html += nbHtml;
  } else {
    html += `<div class="zone-title">L2 zone</div><div class="zone-meta">— outside L2 envelopes —</div>`;
  }

  el.innerHTML = html;
}

// --- _persistActiveCandidate(candId) — legacy lines 57399-57407 ---
// Save/clear the active candidate id in localStorage so candidate-focus
// survives reloads. Fail-soft on storage exceptions.
export function _persistActiveCandidate(candId) {
  try {
    if (candId) {
      localStorage.setItem('pca_scrubber_v3.activeCandidateId', candId);
    } else {
      localStorage.removeItem('pca_scrubber_v3.activeCandidateId');
    }
  } catch (_) { /* fail-soft */ }
}

// --- _csBpJumpToWindow(bp) — legacy lines 23887-23900 ---
// Cross-panel "jump to breakpoint" action. Centers the scrubber on the
// breakpoint's window via setCur, which fans out the full redraw chain.
// Lives here (not in candidates.js) because it calls setCur, which would
// create a circular import the other way around.
export function _csBpJumpToWindow(bp) {
  if (!bp || typeof bp.win !== 'number' || bp.win < 0) return false;
  const state = _pageState;
  if (!state) return false;
  setCur(state, bp.win);
  return true;
}

// --- jumpToValue(state) — legacy lines 52418-52439 ---
// Sidebar "Go" button handler: reads #jumpUnit + #jumpVal and routes to
// setCur on the nearest matching window. Co-located here because it
// calls setCur and would otherwise create an import cycle from sidebar.js.
export function jumpToValue(state) {
  _setActiveState(state);
  if (!state.data) return;
  const unit = document.getElementById('jumpUnit').value;
  const v = parseFloat(document.getElementById('jumpVal').value);
  if (!isFinite(v)) return;
  const d = state.data;
  if (unit === 'win') {
    // 1-based input -> 0-based index
    setCur(state, Math.round(v) - 1);
    return;
  }
  // For Mb / bp: find nearest window center
  const targetBp = unit === 'mb' ? v * 1e6 : v;
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < d.n_windows; i++) {
    const w = d.windows[i];
    const center = (w.start_bp + w.end_bp) / 2;
    const dd = Math.abs(center - targetBp);
    if (dd < bestD) { bestD = dd; bestI = i; }
  }
  setCur(state, bestI);
}

// --- jumpL2(state, direction) — legacy lines 52440-52453 ---
export function jumpL2(state, direction) {
  _setActiveState(state);
  if (!state.data || !state.data.l2_envelopes) return;
  const cur = state.cur;
  const sorted = state.data.l2_envelopes
    .map((e, i) => ({ i, s: e._s0 }))
    .sort((a, b) => a.s - b.s);
  if (direction > 0) {
    for (const it of sorted) if (it.s > cur) { setCur(state, it.s); return; }
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].s < cur) { setCur(state, sorted[i].s); return; }
    }
  }
}

// --- jumpL1(state, direction) — legacy lines 52454-52467 ---
export function jumpL1(state, direction) {
  _setActiveState(state);
  if (!state.data || !state.data.l1_envelopes) return;
  const cur = state.cur;
  const sorted = state.data.l1_envelopes
    .map((e, i) => ({ i, s: e._s0 }))
    .sort((a, b) => a.s - b.s);
  if (direction > 0) {
    for (const it of sorted) if (it.s > cur) { setCur(state, it.s); return; }
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].s < cur) { setCur(state, sorted[i].s); return; }
    }
  }
}

// --- pickFromFocalBand(state, band) — legacy lines 51893-51969 ---
// Pick N samples from the focal L2's K-means clustering. When `band === 'all'`,
// distribute across bands proportional to size. When `band` is a numeric K
// index (0..k-1), pick exclusively from that band's samples (most typical
// first, then spread across the cluster centroid → periphery).
export function pickFromFocalBand(state, band) {
  _setActiveState(state);
  const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
  if (curL2 < 0) { autoPickRadial(state, state.trackedN); return; }
  const cl = getL2Cluster(state, curL2);
  if (!cl || !cl.labels) { autoPickRadial(state, state.trackedN); return; }
  const pc = getPC(state, state.cur);
  if (!pc) return;
  const { pc1, pc2, sign } = pc;
  const budget = state.trackedN;
  if (budget === 0) {
    state.tracked = []; renderTrackedList(state); drawLinesPanel(state); drawPCA(state); renderL3Panel(state); return;
  }

  // Helper: pick `want` samples from group `k` spread along distance from centroid
  function pickInGroup(k, want) {
    const grp = [];
    for (let i = 0; i < cl.labels.length; i++) if (cl.labels[i] === k) grp.push(i);
    if (grp.length === 0) return [];
    let cxg = 0, cyg = 0;
    for (const i of grp) { cxg += pc1[i] * sign; cyg += pc2[i]; }
    cxg /= grp.length; cyg /= grp.length;
    grp.sort((a, b) => {
      const da = (pc1[a] * sign - cxg) ** 2 + (pc2[a] - cyg) ** 2;
      const db = (pc1[b] * sign - cxg) ** 2 + (pc2[b] - cyg) ** 2;
      return da - db;
    });
    const take = Math.min(grp.length, want);
    const out = [];
    for (let t = 0; t < take; t++) {
      const idx = Math.round(t * (grp.length - 1) / Math.max(1, take - 1));
      if (!out.includes(grp[idx])) out.push(grp[idx]);
    }
    return out;
  }

  let picks = [];
  if (band === 'all') {
    // Distribute trackedN across bands proportional to size (with floors)
    const total_n = cl.labels.length;
    const perGroup = new Array(state.k);
    let allocated = 0;
    for (let k = 0; k < state.k; k++) {
      const want = Math.max(1, Math.round(budget * cl.n_per_group[k] / total_n));
      perGroup[k] = Math.min(cl.n_per_group[k], want);
      allocated += perGroup[k];
    }
    let kk = 0;
    while (allocated > budget && kk < 1000) {
      const idx = perGroup.indexOf(Math.max(...perGroup));
      if (idx < 0 || perGroup[idx] <= 1) break;
      perGroup[idx]--; allocated--; kk++;
    }
    for (let k = 0; k < state.k; k++) {
      for (const si of pickInGroup(k, perGroup[k])) {
        if (!picks.includes(si)) picks.push(si);
      }
    }
  } else {
    // Specific band index
    const k = band | 0;
    if (k < 0 || k >= state.k) return;
    picks = pickInGroup(k, budget);
  }
  state.tracked = picks.slice(0, budget);
  renderTrackedList(state);
  drawPCA(state);
  // v4 turn 2 ask 1: also refresh the per-sample-lines panel — picking a band
  // changes which samples are tracked, and the lines panel colors lines by
  // tracked-sample status.
  drawLinesPanel(state);
  renderL3Panel(state);
}

// --- clearPicks(state) — legacy lines 51995-52003 ---
export function clearPicks(state) {
  _setActiveState(state);
  state.tracked = [];
  renderTrackedList(state);
  drawPCA(state);
  // v4 turn 2 ask 1: also refresh the per-sample-lines panel (see
  // pickFromFocalBand for full rationale).
  drawLinesPanel(state);
  renderL3Panel(state);
}

// --- _updateConcordBadge — legacy lines 51795-51858 ---
// Renders the Cramér's V badge into #concordBadge (above per-sample-lines
// header). Three states:
//   - no tracked / no anchor    → "V –"  (dim)
//   - at anchor window itself   → "V 1.00 (anchor)"  (purple)
//   - at any other window       → "V 0.78" with green/yellow/red color
// Thresholds: ≥0.7 green, 0.4–0.7 yellow, <0.4 red.
export function _updateConcordBadge(state) {
  state = state || _pageState;
  if (typeof document === 'undefined') return;
  const el = document.getElementById('concordBadge');
  if (!el) return;
  const havData = !!(state && state.data);
  const havAnchor = !!(state && state.trackingAnchor && state.anchorConcord);
  const havTracked = !!(state && Array.isArray(state.tracked) && state.tracked.length > 0);
  if (!havData || !havAnchor || !havTracked) {
    el.textContent = 'V –';
    el.style.color = 'var(--ink-dim)';
    el.style.background = 'var(--panel-2)';
    el.style.borderColor = 'var(--rule)';
    el.title = 'Cramér\'s V — no anchor set yet. Track at least one sample to anchor; the V will then show concord between this window and the anchor window.';
    return;
  }
  const n_windows = state.data.n_windows;
  const cur = state.cur;
  const anchorIdx = state.trackingAnchor.winIdx;
  let v = NaN;
  if (cur >= 0 && cur < n_windows && state.anchorConcord.length === n_windows) {
    v = state.anchorConcord[cur];
  }
  if (cur === anchorIdx) {
    el.textContent = 'V 1.00 (anchor)';
    el.style.color = '#a570f0';
    el.style.background = 'rgba(124,58,237,0.15)';
    el.style.borderColor = 'rgba(124,58,237,0.55)';
    el.title = `At the anchor window (window ${anchorIdx}). V = 1.00 by definition.`;
    return;
  }
  if (!isFinite(v)) {
    el.textContent = 'V –';
    el.style.color = 'var(--ink-dim)';
    el.style.background = 'var(--panel-2)';
    el.style.borderColor = 'var(--rule)';
    el.title = `Cramér's V is undefined at window ${cur} (degenerate K-means). Try a different window.`;
    return;
  }
  const txt = `V ${v.toFixed(2)}`;
  let fg, bg, bd;
  if (v >= 0.70)      { fg = '#7be88a'; bg = 'rgba(123,232,138,0.15)';  bd = 'rgba(123,232,138,0.55)'; }
  else if (v >= 0.40) { fg = '#f5c43a'; bg = 'rgba(245,196,58,0.15)';   bd = 'rgba(245,196,58,0.55)'; }
  else                { fg = '#e0555c'; bg = 'rgba(224,85,92,0.15)';    bd = 'rgba(224,85,92,0.55)'; }
  el.textContent = txt;
  el.style.color = fg;
  el.style.background = bg;
  el.style.borderColor = bd;
  el.title = `Cramér's V = ${v.toFixed(3)}. Concord between tracked samples' K-means labels at window ${anchorIdx} (anchor) vs window ${cur} (current). High = same sample-grouping persists; low = grouping has reshuffled.`;
}
