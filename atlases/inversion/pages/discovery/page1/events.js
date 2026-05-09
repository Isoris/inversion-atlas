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

import { formatTrackVal } from '../../../shared/page1_utils.js';

import { _setActiveState } from './_state.js';
import { allSampleIdx, getPC } from './_data.js';
import { drawSim, drawSimMini } from './sim_panel.js';
import { drawZ } from './z_panel.js';
import { drawLinesPanel } from './lines_panel.js';
import { drawAnchorStrip, drawPCA, renderTrackedList } from './pca_panel.js';
import { renderL3Panel } from './l3_panel.js';
import { _assignCandidateLanes, _ensureCsOverlayIndex, _wRowBand, _winNavBand } from './candidates.js';

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
  if (typeof drawAnchorStrip === 'function') {
    try { drawAnchorStrip(state); } catch (_) {}
  }
  // v3.71: concord V badge (above per-sample-lines header) follows the scrubber
  if (typeof _updateConcordBadge === 'function') {
    try { _updateConcordBadge(); } catch (_) {}
  }
  if (typeof updateSidebarInfo === 'function') {
    try { updateSidebarInfo(state); } catch (_) {}
  }
  if (typeof renderZoneBlock === 'function') {
    try { renderZoneBlock(state); } catch (_) {}
  }
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
  const _navBandClick = (typeof _winNavBand === 'function')
    ? _winNavBand({ collapsed, zoneTop, zoneH }) : null;
  const _navExtraClick = _navBandClick ? (_navBandClick.h + _navBandClick.gap) : 0;
  if (typeof _winNavHandleClick === 'function' &&
      _winNavHandleClick(y, bestI, { collapsed, zoneTop, zoneH })) return;
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
    drawOneTrack(cv, trk, label);
  }
}
