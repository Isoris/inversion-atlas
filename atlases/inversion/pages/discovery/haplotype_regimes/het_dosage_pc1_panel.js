// pages/discovery/haplotype_regimes/het_dosage_pc1_panel.js
//
// Het-page-specific panel (2026-05-29). Per-sample PC1 traces across the
// chromosome, each line coloured by that sample's mean dosage (or het
// rate) using the SAME divergent ramp + fixed scale as the local_pca_dosage
// page-1 tracked samples: blue=0 (hom-ref) → white=1 (het) → red=2
// (hom-alt) for dosage [0,2]; blue=0 → white=0.5 → red=1 for het [0,1].
// Quentin: "PC1 lines recolored by dosage … same dosage colors as the
// tracked samples page 1 ramp of color and scale."
//
// Distinct from regimes_pc1_panel.js (which colours by focal-voter band):
// here colour encodes the dosage/het signal so the het band (balanced
// dosage ≈ 1.0 = white) separates visually from the hom arms (blue/red).
//
// Coloring is chromosome-wide (per-sample mean dosage over the whole
// chrom), so the panel is focal-independent — it only needs a redraw on
// data load, dosage-chunk arrival, and the dosage/het toggle. No coupling
// to the seed-strip focal cursor.
//
// Reads:
//   state._regimesGetPC1(w)        → Float32Array of per-sample PC1 at window w
//   state.data.windows[].start_bp  → bp span for the dosage query
//   state._hetDosageColorMode      → 'dosage' | 'het' (default 'dosage')
//   state._linesPanelGetCachedChunk (installed by installDosageChunkFetcher)

import { fitCanvas, themeColor, withAlpha } from '../../../shared/page1_utils.js';
import {
  perSampleColorFor,
  perSampleValuesForMode,
} from '../../../shared/per_sample_line_color.js';

const _GREY = 'rgba(140,150,170,0.10)';

// Max markers to subsample for the chrom-wide dosage mean. Keeps the
// whole-chrom query cheap; the high-variance selection then sharpens it.
const _DOSAGE_MAX_MARKERS = 400;

// ---------------------------------------------------------------------
// DOM scaffolding — one canvas inside #hetDosageCanvasContainer.
// ---------------------------------------------------------------------
export function buildHetDosagePanel(state) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('hetDosageCanvasContainer');
  const panel = document.getElementById('hetDosagePanel');
  if (!container || !panel) return;
  if (typeof container.appendChild !== 'function') return;
  if ('innerHTML' in container) container.innerHTML = '';
  if (panel.style) panel.style.display = '';
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  const sub = document.createElement('div');
  sub.className = 'het-dosage-subpanel';
  sub.style.cssText = 'position: relative; flex: 1 1 0; min-height: 0;';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display: block; position: absolute; inset: 0; cursor: crosshair;';
  cv.tabIndex = 0;
  sub.appendChild(cv);
  container.appendChild(sub);
}

// ---------------------------------------------------------------------
// Render.
// ---------------------------------------------------------------------
export function drawHetDosagePanel(state) {
  if (typeof document === 'undefined') return;
  if (!state || !state.data) return;
  const container = document.getElementById('hetDosageCanvasContainer');
  if (!container || typeof container.querySelector !== 'function') return;
  const sub = container.querySelector('.het-dosage-subpanel');
  if (!sub) return;
  const cv = sub.querySelector('canvas');
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);

  const getPc1 = state._regimesGetPC1;
  if (typeof getPc1 !== 'function') {
    _msg(ctx, w, h, 'PC1 getter not wired (run pipeline ctx first)');
    return;
  }
  const windows = state.data.windows;
  const nW = state.data.n_windows | 0
    || (Array.isArray(windows) ? windows.length : 0);
  if (!nW || nW < 2) { _msg(ctx, w, h, '(no windows)'); return; }

  const mode = (state._hetDosageColorMode === 'het') ? 'het' : 'dosage';

  // Geometry.
  const pad = { l: 44, r: 16, t: 8, b: 14 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW <= 0 || plotH <= 0) return;

  // ---- (A) per-sample PC1 matrix + y-range. Cached on state keyed by
  // window count so repeated draws (toggle, chunk arrival) are cheap. ----
  let cache = state._hetDosagePc1Cache;
  if (!cache || cache.nW !== nW || cache.chrom !== state.data.chrom) {
    let nS = state.data.n_samples | 0;
    if (!nS) {
      for (let wi = 0; wi < nW; wi++) {
        const v = getPc1(wi);
        if (v && v.length) { nS = v.length; break; }
      }
    }
    const M = new Array(nS);
    for (let si = 0; si < nS; si++) { M[si] = new Float32Array(nW); M[si].fill(NaN); }
    let yMin = Infinity, yMax = -Infinity;
    for (let wi = 0; wi < nW; wi++) {
      const v = getPc1(wi);
      if (!v) continue;
      const lim = Math.min(nS, v.length);
      for (let si = 0; si < lim; si++) {
        const val = v[si];
        if (Number.isFinite(val)) {
          M[si][wi] = val;
          if (val < yMin) yMin = val;
          if (val > yMax) yMax = val;
        }
      }
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) { yMin = -1; yMax = 1; }
    const yPad = (yMax - yMin) * 0.05;
    cache = { nW, chrom: state.data.chrom, M, nS, yMin: yMin - yPad, yMax: yMax + yPad };
    state._hetDosagePc1Cache = cache;
  }
  const { M, nS, yMin, yMax } = cache;
  if (!nS) { _msg(ctx, w, h, '(PC1 unavailable)'); return; }

  const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xByW = new Float32Array(nW);
  for (let wi = 0; wi < nW; wi++) xByW[wi] = pad.l + (wi / (nW - 1)) * plotW;

  // ---- (B) per-sample dosage/het values over the whole chrom. The
  // shared compute caches by range+quality, so this is a cache hit after
  // the first call (and returns NaN-filled until the chunk lands). ----
  const startBp = windows && windows[0] && Number.isFinite(windows[0].start_bp)
    ? windows[0].start_bp : null;
  const endBp = windows && windows[nW - 1]
    && Number.isFinite(windows[nW - 1].end_bp) ? windows[nW - 1].end_bp : null;
  let vals = null;
  if (startBp != null && endBp != null) {
    try {
      vals = perSampleValuesForMode(state, mode,
        { startW: 0, endW: nW - 1, highVar: true, maxMarkers: _DOSAGE_MAX_MARKERS });
    } catch (e) { console.warn('[het-dosage-panel] perSampleValuesForMode threw', e); }
  }
  const nWithVal = vals ? vals.reduce((a, v) => a + (Number.isFinite(v) ? 1 : 0), 0) : 0;

  // ---- (C) frame + y-ticks ----
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  ctx.fillStyle = themeColor('ink');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [yMin + (yMax - yMin) * 0.05, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.05]) {
    const yp = toY(v);
    ctx.fillText(v.toFixed(2), pad.l - 4, yp);
    ctx.strokeStyle = 'rgba(120,128,144,0.18)';
    ctx.beginPath();
    ctx.moveTo(pad.l, yp + 0.5); ctx.lineTo(pad.l + plotW, yp + 0.5);
    ctx.stroke();
  }

  // ---- (D) per-sample lines, coloured by dosage/het ----
  const _stride = Math.max(1, Math.floor(nW / Math.max(plotW * 2, 1)));
  const strokePath = (si) => {
    const ys = M[si];
    let started = false;
    ctx.beginPath();
    for (let wi = 0; wi < nW; wi += _stride) {
      const v = ys[wi];
      if (!Number.isFinite(v)) { started = false; continue; }
      const x = xByW[wi], y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    }
    if ((nW - 1) % _stride !== 0) {
      const vL = ys[nW - 1];
      if (Number.isFinite(vL)) {
        const xL = xByW[nW - 1], yL = toY(vL);
        if (!started) ctx.moveTo(xL, yL); else ctx.lineTo(xL, yL);
      }
    }
    ctx.stroke();
  };

  // Samples with no dosage value yet (chunk in flight) — faint grey first
  // so the PC1 shape is visible before colours resolve.
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = _GREY;
  for (let si = 0; si < nS; si++) {
    const dv = vals ? vals[si] : NaN;
    if (Number.isFinite(dv)) continue;
    strokePath(si);
  }
  // Coloured samples on top.
  ctx.lineWidth = 0.8;
  for (let si = 0; si < nS; si++) {
    const dv = vals ? vals[si] : NaN;
    if (!Number.isFinite(dv)) continue;
    const col = perSampleColorFor(mode, dv, vals);
    if (!col) continue;
    ctx.strokeStyle = withAlpha(col, 0.7);
    strokePath(si);
  }

  // ---- (E) header + ramp legend ----
  _drawLegend(ctx, pad, plotW, mode, nWithVal, nS);

  state.__hetDosageGeom = { pad, plotW, plotH, w, h, nW, yMin, yMax };
}

// Header label + a small blue→white→red gradient legend with fixed
// domain ticks (0 / mid / max). Mirrors the page-1 ramp semantics.
function _drawLegend(ctx, pad, plotW, mode, nWithVal, nS) {
  const isDos = (mode === 'dosage');
  const lo = '0';
  const mid = isDos ? '1' : '0.5';
  const hi = isDos ? '2' : '1';
  const label = isDos ? 'dosage' : 'het rate';

  const hdr = `PC1 lines · coloured by ${label}` +
    (nWithVal < nS ? `  (${nWithVal}/${nS} samples — fetching dosage…)` : `  (n=${nS})`);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const hdrW = ctx.measureText(hdr).width + 12;
  ctx.fillRect(pad.l + 4, pad.t + 4, hdrW, 15);
  ctx.fillStyle = '#e6edf6';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(hdr, pad.l + 10, pad.t + 5);

  // Gradient legend bar, top-right inside the plot.
  const barW = 90, barH = 8;
  const bx = pad.l + plotW - barW - 6, by = pad.t + 6;
  const grad = ctx.createLinearGradient(bx, 0, bx + barW, 0);
  grad.addColorStop(0, '#2166AC');   // blue (0)
  grad.addColorStop(0.5, '#F7F7F7'); // white (mid = het/expected)
  grad.addColorStop(1, '#B2182B');   // red (max)
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, barW, barH);
  ctx.strokeStyle = withAlpha(themeColor('rule'), 0.7);
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '8.5px ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';   ctx.fillText(lo, bx, by + barH + 2);
  ctx.textAlign = 'center'; ctx.fillText(mid, bx + barW / 2, by + barH + 2);
  ctx.textAlign = 'right';  ctx.fillText(hi, bx + barW, by + barH + 2);
}

function _msg(ctx, w, h, msg) {
  if (!ctx) return;
  ctx.fillStyle = themeColor('dim');
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}

// Wire the dosage/het toggle pills (#hetDosageModeBar buttons[data-het-color]).
// Idempotent. Calls opts.onChange() after flipping the mode + persisting.
export function wireHetDosageToggle(root, state, opts) {
  if (typeof document === 'undefined' || !root) return;
  const bar = root.querySelector('#hetDosageModeBar');
  if (!bar) return;
  // Restore persisted choice.
  try {
    const saved = localStorage.getItem('het_skeletons.colorMode');
    if (saved === 'het' || saved === 'dosage') state._hetDosageColorMode = saved;
  } catch (_) {}
  if (!state._hetDosageColorMode) state._hetDosageColorMode = 'dosage';
  bar.querySelectorAll('button[data-het-color]').forEach(b => {
    b.classList.toggle('active', b.dataset.hetColor === state._hetDosageColorMode);
    if (b.dataset.hetWired === '1') return;
    b.dataset.hetWired = '1';
    b.addEventListener('click', () => {
      state._hetDosageColorMode = b.dataset.hetColor;
      try { localStorage.setItem('het_skeletons.colorMode', state._hetDosageColorMode); } catch (_) {}
      bar.querySelectorAll('button[data-het-color]').forEach(b2 =>
        b2.classList.toggle('active', b2 === b));
      if (opts && typeof opts.onChange === 'function') opts.onChange();
    });
  });
}

if (typeof window !== 'undefined') {
  window._drawHetDosagePanel = drawHetDosagePanel;
}
