// pages/discovery/local_pca_dosage/sim_panel.js
//
// Sim_mat panel renderers (round 4 split, 2026-05-06).
//
// drawSim:    full sim_mat heatmap with envelope overlays + L1/L2 boundary
//             lines, anchor strip, and triangle-split PDF mode.
// drawSimMini: minimap variant rendered in the upper-left of the |Z| panel
//              when state.simInMinimap is set.
//
// Bodies extracted verbatim from the pre-split local_pca_dosage.js (eighth pass).
// `_setActiveState(state)` is set on entry; helper reads then resolve
// against the live `_pageState` from ./_state.js.

import { simColor, simColorPDF, zColorPDF } from '../../../shared/color_helpers.js';
import { fitCanvas, niceTicks, themeColor } from '../../../shared/page1_utils.js';

import { _setActiveState } from './_state.js';
import { getActiveSimScale, getActiveModeView } from './_data.js';
import { _ensureCsOverlayIndex } from './candidates.js';

// --- drawSim(state) — legacy lines 31331-31638 ---
export function drawSim(state) {
  _setActiveState(state);
  const canvas = document.getElementById('simCanvas');
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  // 2026-05-19 — read from the active mode's view, not state.data directly.
  // For 'dosage' mode this is a passthrough; for 'theta_pi' / 'ghsl' it
  // returns the synthesized envelope (pc1/pc2/sim_scales/envelopes/cusum
  // attached to data.theta_pi_view / .ghsl_view by getActiveModeView).
  const d = getActiveModeView(state);
  if (!d) return;

  // ---- Compute centered square geometry ----
  // The heatmap must be a perfect square so the diagonal reads at 45°
  // (otherwise visual structure inside L2 envelopes is unreadable).
  // Reserve a margin for axis text + a side legend strip.
  const padTop    = 24;
  const padBottom = 22;
  const padLeft   = 50;
  const padRight  = 130;   // leaves room for the legend strip
  const availW = Math.max(50, w - padLeft - padRight);
  const availH = Math.max(50, h - padTop - padBottom);
  const side   = Math.max(50, Math.min(availW, availH));
  const simX0  = padLeft + Math.floor((availW - side) / 2);
  const simY0  = padTop  + Math.floor((availH - side) / 2);
  const simX1  = simX0 + side;
  const simY1  = simY0 + side;
  // Persist geometry for the click handler
  state._simGeom = { x0: simX0, y0: simY0, x1: simX1, y1: simY1, side };

  const scale = getActiveSimScale(state);
  if (scale && scale.sim && scale.n > 0) {
    const N = scale.n;
    const sim = scale.sim;
    const zArr = scale.z;
    const usePdf = state.pdfStyle && zArr;

    // 2026-05-19 perf: cache the offscreen N×N sim_mat image so per-cursor
    // scrubs skip the N² pixel loop + putImageData (was running every
    // setCur — dominant cost when the scrub instrumentation logs
    // `drawSim=` higher than any other panel). The image depends only on
    // (sim array identity, z array identity, pdfStyle, N) — none of
    // those change when the user steps the cursor. Reference equality
    // on `sim` / `zArr` is enough: getActiveSimScale returns the same
    // typed-array references unless the chrom or active mode changes,
    // and pdfStyle is a state-level toggle. Cache lives on state so
    // remount tears it down naturally.
    const cacheKey = `${N}|${usePdf ? 'pdf' : 'plain'}`;
    const cache = state.__simImgCache;
    let off;
    if (cache
        && cache.key === cacheKey
        && cache.sim === sim
        && cache.zArr === zArr) {
      off = cache.canvas;
    } else {
      const img = ctx.createImageData(N, N);
      if (usePdf) {
        const q_lo = scale.q_lo, q_hi = scale.q_hi, z_max = scale.z_max;
        for (let k = 0; k < sim.length; k++) {
          const i = Math.floor(k / N), j = k - i * N;
          let r, g, b;
          if (i === j) {
            r = 232; g = 197; b = 71;  // diagonal yellow
          } else if (j < i) {
            [r, g, b] = simColorPDF(sim[k], q_lo, q_hi);
          } else {
            [r, g, b] = zColorPDF(zArr[k], z_max);
          }
          img.data[k*4]=r; img.data[k*4+1]=g; img.data[k*4+2]=b; img.data[k*4+3]=255;
        }
      } else {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < sim.length; i++) {
          if (sim[i] < mn) mn = sim[i]; if (sim[i] > mx) mx = sim[i];
        }
        const rng = Math.max(1e-9, mx - mn);
        for (let i = 0; i < sim.length; i++) {
          const v = (sim[i] - mn) / rng;
          const [r, g, b] = simColor(v);
          img.data[i*4]=r; img.data[i*4+1]=g; img.data[i*4+2]=b; img.data[i*4+3]=255;
        }
      }
      off = document.createElement('canvas');
      off.width = N; off.height = N;
      off.getContext('2d').putImageData(img, 0, 0);
      state.__simImgCache = { key: cacheKey, sim, zArr, canvas: off };
    }
    // v4 turn 72: adaptive smoothing. When the source matrix N is comparable
    // to or larger than the display side, keep crisp pixels (false). When the
    // source is significantly smaller (e.g. 200×200 thumbnail blit to 800×800
    // panel), enable high-quality smoothing so the upscale uses bilinear/cubic
    // interpolation instead of nearest-neighbor. Threshold: smooth when the
    // upscale ratio exceeds 1.5×.
    if (side / N > 1.5) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    } else {
      ctx.imageSmoothingEnabled = false;
    }
    ctx.drawImage(off, simX0, simY0, side, side);

    // Frame around the heatmap
    ctx.strokeStyle = 'rgba(120,128,140,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(simX0 + 0.5, simY0 + 0.5, side - 1, side - 1);
  } else {
    ctx.fillStyle = themeColor('panel-2');
    ctx.fillRect(simX0, simY0, side, side);
  }

  // Window-coord -> pixel coord (mapped INSIDE the square)
  const Nw = d.n_windows;
  const toPx = (wIdx) => simX0 + (wIdx + 0.5) * side / Nw;
  const toPy = (wIdx) => simY0 + (wIdx + 0.5) * side / Nw;

  // L1 envelope rectangles
  if (Array.isArray(d.l1_envelopes)) {
    const curL1 = state.windowToL1 ? state.windowToL1[state.cur] : -1;
    ctx.lineWidth = 1;
    d.l1_envelopes.forEach((e, i) => {
      const x0 = toPx(e._s0), x1 = toPx(e._e0);
      const y0 = toPy(e._s0), y1 = toPy(e._e0);
      const isCur = (i === curL1);
      ctx.strokeStyle = isCur ? 'rgba(0,66,255,1.0)' : 'rgba(0,66,255,0.45)';
      ctx.lineWidth = isCur ? 2 : 1;
      if (isCur) {
        ctx.fillStyle = 'rgba(0,66,255,0.10)';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    });
  }

  // L2 envelope rectangles
  if (Array.isArray(d.l2_envelopes)) {
    const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
    d.l2_envelopes.forEach((e, i) => {
      const x0 = toPx(e._s0), x1 = toPx(e._e0);
      const y0 = toPy(e._s0), y1 = toPy(e._e0);
      const isCur = (i === curL2);
      const isPinned = (i === state.secondaryL2 && state.secondaryL2 != null && i !== curL2);
      if (isPinned) {
        // Magenta highlight for the 2nd pinned focal
        ctx.strokeStyle = 'rgba(232,121,249,1.0)';  // #e879f9
        ctx.lineWidth = 2.5;
        ctx.fillStyle = 'rgba(232,121,249,0.10)';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else {
        ctx.strokeStyle = isCur ? 'rgba(0,230,118,1.0)' : 'rgba(0,230,118,0.55)';
        ctx.lineWidth = isCur ? 2 : 1;
        if (isCur) {
          ctx.fillStyle = 'rgba(0,230,118,0.12)';
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      }
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    });
  }

  // v3.99 turn 13 ask 2: confirmed candidates render as green-outlined zones
  // in the sim_mat, with their short ID label on top. The same dark-green
  // hue used for the catalogue confirmed-row indicator (rgba(60,192,138)).
  // Each confirmed candidate is drawn as an outlined box spanning its
  // bp interval, with the candidate ID rendered in dark green just above
  // the box. Provisional candidates do NOT get this treatment — only
  // candidates that the user has explicitly marked confirmed.
  if (Array.isArray(state.candidateList) && state.candidateList.length > 0) {
    ctx.save();
    for (const cand of state.candidateList) {
      if (!cand || !cand.confirmed) continue;
      // Map bp range to window indices (nearest-neighbor); guard against missing
      // start_bp / end_bp on malformed candidates.
      if (!isFinite(cand.start_bp) || !isFinite(cand.end_bp)) continue;
      let s0 = -1, e0 = -1;
      for (let wi = 0; wi < d.n_windows; wi++) {
        const w0 = d.windows[wi];
        if (!w0) continue;
        if (s0 < 0 && w0.end_bp >= cand.start_bp) s0 = wi;
        if (w0.start_bp <= cand.end_bp) e0 = wi;
      }
      if (s0 < 0 || e0 < s0) continue;
      const x0 = toPx(s0), x1 = toPx(e0);
      const y0 = toPy(s0), y1 = toPy(e0);
      // Outline + soft-green fill (tint matches catalogue confirmed-row alpha)
      ctx.strokeStyle = 'rgba(60,192,138,0.85)';
      ctx.fillStyle   = 'rgba(60,192,138,0.10)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      // ID label centered above the top edge. Short form strips chrom prefix
      // (e.g. "C_gar_LG28_d17L2_0001_03" → "d17L2_0001_03"); falls back to
      // full ID for non-conventional names.
      const fullId = String(cand.id || '?');
      const shortId = fullId.replace(/^[^_]+_[^_]+_[^_]+_/, '');
      // Position label just above the upper-left corner of the box. If the
      // box is at the very top of the matrix, render the label INSIDE the
      // top-left corner instead so it doesn't get clipped above the matrix.
      const labelY = (y0 - 4 < simY0 + 8) ? y0 + 11 : y0 - 4;
      ctx.font = 'bold 9.5px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      // Background pill so the label is readable over heatmap data.
      const labelW = ctx.measureText(shortId).width;
      const padX = 3, padY = 2;
      ctx.fillStyle = 'rgba(60,192,138,0.18)';
      ctx.fillRect(x0 - padX, labelY - 9, labelW + padX * 2, 9 + padY);
      ctx.fillStyle = 'rgba(40,140,90,1.0)';
      ctx.fillText(shortId, x0, labelY);
    }
    ctx.restore();
  }

  // v4 turn 114b: cross-species breakpoint red-cross overlay.
  // For each cs-breakpoint that maps to a window in the loaded chromosome,
  // draw a red cross (axis-aligned, ~14 px arms) at (toPx(wi), toPy(wi)) —
  // i.e., on the diagonal at the breakpoint's window position. This
  // marks where on the sim_mat the breakpoint sits, complementing the
  // page-16 catalogue. Drawn before the orange cursor crosshair so the
  // cursor stays visually on top.
  try {
    const csIdx = _ensureCsOverlayIndex();
    if (csIdx && csIdx.bps.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 90, 90, 0.85)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const armPx = 7;  // half-arm length → 14 px total
      for (const e of csIdx.bps) {
        if (e.win == null || e.win < 0) continue;
        const cx = toPx(e.win);
        const cy = toPy(e.win);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        // Clamp so cross stays visible even at edges
        if (cx < simX0 - armPx || cx > simX1 + armPx) continue;
        if (cy < simY0 - armPx || cy > simY1 + armPx) continue;
        ctx.beginPath();
        ctx.moveTo(cx - armPx, cy - armPx);
        ctx.lineTo(cx + armPx, cy + armPx);
        ctx.moveTo(cx + armPx, cy - armPx);
        ctx.lineTo(cx - armPx, cy + armPx);
        ctx.stroke();
      }
      ctx.restore();
    }
  } catch (_) { /* fail-soft */ }

  // Crosshair (clipped to inside the square)
  const xc = toPx(state.cur), yc = toPy(state.cur);
  ctx.strokeStyle = '#f5a524';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(Math.round(xc) + 0.5, simY0); ctx.lineTo(Math.round(xc) + 0.5, simY1);
  ctx.moveTo(simX0, Math.round(yc) + 0.5); ctx.lineTo(simX1, Math.round(yc) + 0.5);
  ctx.stroke();

  // Mb tick labels along the bottom (every ~5 Mb)
  const wins = d.windows;
  if (wins && wins.length > 0) {
    const mbMin = wins[0].center_mb, mbMax = wins[wins.length - 1].center_mb;
    const ticks = niceTicks(mbMin, mbMax, 6);
    ctx.fillStyle = themeColor('ink-dim');
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const mb of ticks) {
      // Find the nearest window
      const t = (mb - mbMin) / Math.max(1e-9, mbMax - mbMin);
      const x = simX0 + t * side;
      ctx.fillText(mb.toFixed(0), x, simY1 + 14);
    }
    ctx.textAlign = 'right';
    ctx.fillText('Mb', simX1, simY1 + 14);
    // Y-axis label
    ctx.save();
    ctx.translate(simX0 - 8, simY0 + side / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('window index', 0, 0);
    ctx.restore();
  }

  // ---- Side legend strip ----
  // Show: scale label, q_lo / q_hi, z_max, and small color ramps
  if (scale) {
    const lx = simX1 + 14;
    const lw = Math.max(30, Math.min(padRight - 20, w - lx - 8));
    let ly = simY0 + 4;
    ctx.fillStyle = themeColor('ink');
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(scale.label || 'scale', lx, ly);
    ly += 16;

    if (state.pdfStyle && scale.z) {
      // Sim ramp (lower triangle palette)
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = themeColor('ink-dim');
      ctx.fillText('similarity', lx, ly);
      ly += 4;
      const rampW = Math.min(lw, 90), rampH = 8;
      for (let i = 0; i < rampW; i++) {
        const v = i / (rampW - 1);
        const [r, g, b] = simColorPDF(v, scale.q_lo, scale.q_hi);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(lx + i, ly, 1, rampH);
      }
      ly += rampH + 11;
      ctx.fillStyle = themeColor('ink-dim');
      ctx.fillText(`q05 ${scale.q_lo.toFixed(2)}`, lx, ly);
      ly += 11;
      ctx.fillText(`q95 ${scale.q_hi.toFixed(2)}`, lx, ly);
      ly += 16;

      // Z ramp (upper triangle palette)
      ctx.fillText('local |Z|', lx, ly);
      ly += 4;
      for (let i = 0; i < rampW; i++) {
        const t = i / (rampW - 1);
        const z = (t * 2 - 1) * scale.z_max;
        const [r, g, b] = zColorPDF(z, scale.z_max);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(lx + i, ly, 1, rampH);
      }
      ly += rampH + 11;
      ctx.fillText(`±${scale.z_max.toFixed(1)}`, lx, ly);
      ly += 16;
    }
    ctx.fillStyle = themeColor('ink-dimmer');
    ctx.fillText(`${scale.n}×${scale.n}`, lx, ly);
    ly += 11;
    ctx.fillText(`thumb`, lx, ly);
  }
}

// --- drawSimMini(state) — legacy lines 31650-31767 ---
export function drawSimMini(state) {
  _setActiveState(state);
  const canvas = document.getElementById('simMinimapCanvas');
  if (!canvas) return;
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, w, h } = fit;
  ctx.clearRect(0, 0, w, h);
  if (!state.data) return;
  // Mode-aware view (see drawSim).
  const d = getActiveModeView(state);
  if (!d) return;

  // Square heatmap centered in the available space. Smaller padding than
  // drawSim because the minimap is much smaller and we want to maximize
  // the heatmap area. No legend strip.
  const pad = 4;
  const availW = Math.max(20, w - 2 * pad);
  const availH = Math.max(20, h - 2 * pad);
  const side = Math.min(availW, availH);
  const x0 = pad + Math.floor((availW - side) / 2);
  const y0 = pad + Math.floor((availH - side) / 2);
  state._simMinimapGeom = { x0, y0, side };

  const scale = getActiveSimScale(state);
  if (scale && scale.sim && scale.n > 0) {
    const N = scale.n;
    const sim = scale.sim;
    const zArr = scale.z;
    const usePdf = state.pdfStyle && zArr;

    // 2026-05-19 perf: reuse the drawSim image cache. drawSim and
    // drawSimMini produce IDENTICAL offscreen N×N images from the same
    // (sim, zArr, pdfStyle) inputs — only the final drawImage target
    // rect differs. Sharing one cache means drawSimMini gets a free
    // ride on the cache drawSim already populated (or vice versa,
    // whichever fires first this scrub).
    const cacheKey = `${N}|${usePdf ? 'pdf' : 'plain'}`;
    const cache = state.__simImgCache;
    let off;
    if (cache
        && cache.key === cacheKey
        && cache.sim === sim
        && cache.zArr === zArr) {
      off = cache.canvas;
    } else {
      const img = ctx.createImageData(N, N);
      if (usePdf) {
        const q_lo = scale.q_lo, q_hi = scale.q_hi, z_max = scale.z_max;
        for (let k = 0; k < sim.length; k++) {
          const i = Math.floor(k / N), j = k - i * N;
          let r, g, b;
          if (i === j) { r = 232; g = 197; b = 71; }
          else if (j < i) { [r, g, b] = simColorPDF(sim[k], q_lo, q_hi); }
          else { [r, g, b] = zColorPDF(zArr[k], z_max); }
          img.data[k*4] = r; img.data[k*4+1] = g; img.data[k*4+2] = b; img.data[k*4+3] = 255;
        }
      } else {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < sim.length; i++) {
          if (sim[i] < mn) mn = sim[i]; if (sim[i] > mx) mx = sim[i];
        }
        const rng = Math.max(1e-9, mx - mn);
        for (let i = 0; i < sim.length; i++) {
          const v = (sim[i] - mn) / rng;
          const [r, g, b] = simColor(v);
          img.data[i*4] = r; img.data[i*4+1] = g; img.data[i*4+2] = b; img.data[i*4+3] = 255;
        }
      }
      off = document.createElement('canvas');
      off.width = N; off.height = N;
      off.getContext('2d').putImageData(img, 0, 0);
      state.__simImgCache = { key: cacheKey, sim, zArr, canvas: off };
    }
    // v4 turn 72: adaptive smoothing — see main sim_mat draw above.
    if (side / N > 1.5) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    } else {
      ctx.imageSmoothingEnabled = false;
    }
    ctx.drawImage(off, x0, y0, side, side);
    ctx.strokeStyle = 'rgba(120,128,140,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);
  } else {
    ctx.fillStyle = themeColor('panel-2');
    ctx.fillRect(x0, y0, side, side);
  }

  const Nw = d.n_windows;
  const toPx = (wi) => x0 + (wi + 0.5) * side / Nw;
  const toPy = (wi) => y0 + (wi + 0.5) * side / Nw;

  // L1 envelopes — outlined only (no fill, since space is tight)
  if (Array.isArray(d.l1_envelopes)) {
    const curL1 = state.windowToL1 ? state.windowToL1[state.cur] : -1;
    d.l1_envelopes.forEach((e, i) => {
      const xa = toPx(e._s0), xb = toPx(e._e0);
      const ya = toPy(e._s0), yb = toPy(e._e0);
      const isCur = (i === curL1);
      ctx.strokeStyle = isCur ? 'rgba(0,80,255,0.95)' : 'rgba(0,80,255,0.35)';
      ctx.lineWidth = isCur ? 1.5 : 0.7;
      ctx.strokeRect(xa, ya, xb - xa, yb - ya);
    });
  }
  // L2 envelopes — green outlines
  if (Array.isArray(d.l2_envelopes)) {
    const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
    d.l2_envelopes.forEach((e, i) => {
      // _s0/_e0 are computed by buildEnvelopeIndices; defensively recompute
      // from start_w/end_w if missing (mini may render before that runs)
      const s0 = (e._s0 != null) ? e._s0 : Math.max(0, (e.start_w | 0) - 1);
      const e0 = (e._e0 != null) ? e._e0 : Math.max(s0, (e.end_w | 0) - 1);
      const xa = toPx(s0), xb = toPx(e0);
      const ya = toPy(s0), yb = toPy(e0);
      const isCur = (i === curL2);
      ctx.strokeStyle = isCur ? 'rgba(0,230,118,0.95)' : 'rgba(0,230,118,0.35)';
      ctx.lineWidth = isCur ? 1.5 : 0.6;
      ctx.strokeRect(xa, ya, xb - xa, yb - ya);
    });
  }

  // Current scrubber position — orange crosshair on diagonal
  const cur = state.cur;
  if (cur != null && cur >= 0 && cur < Nw) {
    const cx = toPx(cur), cy = toPy(cur);
    ctx.strokeStyle = 'rgba(245,165,36,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical line through current column
    ctx.moveTo(cx, y0);
    ctx.lineTo(cx, y0 + side);
    // Horizontal line through current row
    ctx.moveTo(x0, cy);
    ctx.lineTo(x0 + side, cy);
    ctx.stroke();
  }
}
