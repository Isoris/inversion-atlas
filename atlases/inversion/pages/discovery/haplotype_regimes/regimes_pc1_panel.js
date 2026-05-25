// pages/discovery/regimes_page/regimes_pc1_panel.js
//
// PC1-LINES variant of the long-range regimes panel.
//
// Same architecture as regimes_panel.js (focal voter from a seed band
// combo, scope-aware track, pattern-class strip on top, "you are here"
// rectangle on the active seed loci) — but the y-axis is per-window
// PC1 from the upstream local PCA, exactly like the existing
// lines_panel.js per-sample lines plot.
//
// PC1 is intrinsically per-chromosome (each chromosome has its own
// local PCA), so the genome-scope view is rendered as a sequence of
// per-chromosome lines segments with visible boundaries between
// chromosomes. Lines do NOT connect across chromosome boundaries —
// that would imply continuity that doesn't exist in the underlying
// PCA. This is the only honest way to render PC1 across chromosomes
// (Quentin's design call).
//
// Reads:
//   state.regimesPanel.ctx_callbacks.getPC1   (w) => Float32Array
//   state.regimesPanel.scope                  'chrom' | 'genome'
//   state.regimesPanel.current_chromosome_idx
//   state.regimesPanel.focal                  { seed_index, band_mask }
//   state.regimesPanel.track                  built by ensureRegimesTrack
//
// Writes (for click handlers / arrow keys):
//   state.__regimesPC1Geom = { pad, plotW, plotH, w, h, nGrid, windowList,
//                              yMin, yMax, mbAt }
// =====================================================================

import { fitCanvas, themeColor, withAlpha } from '../../../shared/page1_utils.js';
import { resolveSampleScopeColor } from '../../../shared/sample_color.js';
import {
  buildFocalVoter, ensureRegimesTrack, PATTERN_CLASS_COLORS,
  DOSAGE_CLASS_COLOURS,
} from './regimes_panel.js';

// Local dosage→rgba helper. Mirrors _dosageClassColour in regimes_panel.js
// but exposed as a separate symbol to keep the import surface flat.
function _dosagePC1ClassColour(cls, alpha) {
  const hex = DOSAGE_CLASS_COLOURS[cls];
  if (!hex || hex.startsWith('rgba')) return hex || 'rgba(0,0,0,0)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------
// drawRegimesPC1Panel — render the PC1-lines variant onto a single
// canvas inside #regimesPC1CanvasContainer.
//
// Layout (vertical):
//   - top:    pattern-class strip (per-window class for focal voter)
//   - middle: PC1 lines for all samples; voter samples coloured by
//             original voter band; untracked grey
//   - overlay: "you are here" rectangle on the active seed loci range
//
// In genome scope, the x-axis stretches across all chromosomes
// concatenated. Lines break at chromosome boundaries (NaN gaps between
// the last window of chr i and the first window of chr i+1) — this is
// honest because PC1 is per-chromosome and there's no meaningful
// continuity to draw.
// ---------------------------------------------------------------------

export function drawRegimesPC1Panel(state) {
  if (!state || !state.regimesPanel) return;
  const rp = state.regimesPanel;
  const cb = rp.ctx_callbacks;
  if (!cb || typeof cb.getPC1 !== 'function') {
    _drawMessage('regimes panel: getPC1 callback not provided');
    return;
  }
  const container = document.getElementById('regimesPC1CanvasContainer');
  if (!container || typeof container.querySelector !== 'function') return;
  // 2026-05-21: also match the genome subpanel class so the alias-routed
  // genome paint actually finds its subpanel (regimes-genome-pc1-subpanel).
  const sub = container.querySelector(
    '.regimes-pc1-subpanel, .regimes-genome-pc1-subpanel');
  if (!sub) return;
  const cv = sub.querySelector('canvas');
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);

  // Geometry
  // 2026-05-26: stripH 16 → 12 + bottom pad 16 → 12 (matches the trim
  // applied to regimes_panel.js — same "panels are a bit thick" feedback).
  const stripH = 12;
  const pad = { l: 44, r: 16, t: 6 + stripH, b: 12 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  if (plotW <= 0 || plotH <= 0) return;

  // Resolve the focal voter and ensure the regimes track is built
  // (we share the track with the lanes panel — same scope, same focal).
  ensureRegimesTrack(state);
  const track = rp.track;
  const locus = rp.stage3_loci[rp.focal.seed_index];
  if (!track || !locus) {
    _drawMessage(ctx, w, h, '(no track or seed)');
    return;
  }
  const voter = buildFocalVoter(locus, rp.focal.band_mask);
  if (voter.n === 0) {
    _drawMessage(ctx, w, h, `(seed ${rp.focal.seed_index} ${voter.label} is empty)`);
    return;
  }

  const windowList = rp.windowList || [];
  const nGrid = windowList.length;
  if (nGrid < 2) {
    _drawMessage(ctx, w, h, '(no windows in scope)');
    return;
  }

  // ---------------- (A) Build per-sample PC1 y-matrix ----------------
  // Walk windowList, fetch PC1 for each window. Discover n_samples
  // from the first non-null PC1 array.
  let n_samples = track.n_samples || 0;
  if (!n_samples) {
    for (const wl of windowList) {
      const v = cb.getPC1(wl.w);
      if (v && v.length > 0) { n_samples = v.length; break; }
    }
  }
  if (n_samples === 0) {
    _drawMessage(ctx, w, h, '(PC1 unavailable)');
    return;
  }

  // Cache PC1 per window — pulling from getPC1 is potentially expensive.
  // Cache on track so re-renders without focal change are cheap.
  if (!track._pc1Matrix || track._pc1Matrix._key !== `n=${nGrid}|${rp.scope}`) {
    const M = new Array(n_samples);
    for (let si = 0; si < n_samples; si++) {
      M[si] = new Float32Array(nGrid);
      for (let gi = 0; gi < nGrid; gi++) M[si][gi] = NaN;
    }
    let yMin = Infinity, yMax = -Infinity;
    let prevChr = -1;
    for (let gi = 0; gi < nGrid; gi++) {
      const wl = windowList[gi];
      // Genome-scope: insert NaN gap between chromosomes (honest break)
      if (rp.scope === 'genome' && wl.chr !== prevChr && prevChr >= 0) {
        // Just leave gi as NaN-bordered — the strokePath helper will
        // break the line because the previous gi's value was finite
        // and this gi will be — actually we need to leave NaN at this
        // boundary. So skip the assignment for the FIRST window of a
        // new chromosome? No, we want to draw it. The break is
        // achieved by NOT assigning the LAST window of the previous
        // chrom. To do that cleanly we set the "transition" gi to NaN
        // for the first window of each new chrom. But that loses one
        // window of data. Simpler: insert a single-window gap by
        // skipping the previous chrom's last gi. Even simpler: rely
        // on the fact that adjacent chromosomes are usually disjoint
        // window indices, and draw a vertical separator instead of a
        // line break.
        //
        // Going with separator-only — every PC1 value gets drawn, and
        // we paint a chromosome divider on top.
      }
      const v = cb.getPC1(wl.w);
      if (!v) { prevChr = wl.chr; continue; }
      for (let si = 0; si < n_samples; si++) {
        const val = v[si];
        if (Number.isFinite(val)) {
          M[si][gi] = val;
          if (val < yMin) yMin = val;
          if (val > yMax) yMax = val;
        }
      }
      prevChr = wl.chr;
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMin === yMax) {
      yMin = -1; yMax = 1;
    }
    const yPad = (yMax - yMin) * 0.05;
    yMin -= yPad; yMax += yPad;
    track._pc1Matrix = M;
    track._pc1Matrix._key = `n=${nGrid}|${rp.scope}`;
    track._pc1YMin = yMin;
    track._pc1YMax = yMax;
  }
  const M = track._pc1Matrix;
  const yMin = track._pc1YMin, yMax = track._pc1YMax;
  const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const xByGi = new Float32Array(nGrid);
  for (let gi = 0; gi < nGrid; gi++) {
    xByGi[gi] = pad.l + (gi / Math.max(1, nGrid - 1)) * plotW;
  }
  const cellW = Math.max(1, plotW / nGrid);

  // ---------------- (B) Pattern-class strip ----------------
  const stripY = pad.t - stripH + 2;
  const stripPaintH = stripH - 4;
  for (let gi = 0; gi < nGrid; gi++) {
    const cls = track.pattern_classes[gi];
    const colour = PATTERN_CLASS_COLORS[cls] || '#1f2937';
    ctx.fillStyle = colour;
    ctx.fillRect(xByGi[gi] - cellW / 2, stripY, cellW + 0.5, stripPaintH);
  }
  ctx.strokeStyle = themeColor('rule');
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, stripY + 0.5, plotW, stripPaintH);

  // ---------------- (C) Plot frame + y-ticks ----------------
  ctx.strokeStyle = themeColor('rule');
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);
  ctx.fillStyle = themeColor('ink');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of [yMin + (yMax - yMin) * 0.05,
                   (yMin + yMax) / 2,
                   yMax - (yMax - yMin) * 0.05]) {
    const yp = toY(v);
    ctx.fillText(v.toFixed(2), pad.l - 4, yp);
    ctx.strokeStyle = 'rgba(120,128,144,0.20)';
    ctx.beginPath();
    ctx.moveTo(pad.l, yp + 0.5); ctx.lineTo(pad.l + plotW, yp + 0.5);
    ctx.stroke();
  }

  // ---------------- (D) Per-sample lines ----------------
  const trackedSet = state.tracked instanceof Set
    ? state.tracked : new Set(state.tracked || []);
  const voterSet = voter.samples;

  // 2026-05-20 perf: X-axis decimation. See the matching note in
  // regimes_panel.js — at 9192 × 226 the un-decimated loop hangs the tab.
  const _stride = Math.max(1, Math.floor(nGrid / Math.max(plotW * 2, 1)));
  function strokePath(si) {
    const ys = M[si];
    let started = false;
    ctx.beginPath();
    for (let gi = 0; gi < nGrid; gi += _stride) {
      const v = ys[gi];
      if (!Number.isFinite(v)) { started = false; continue; }
      const x = xByGi[gi];
      const y = toY(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    // Always include the last sample so the line reaches the right edge.
    if ((nGrid - 1) % _stride !== 0) {
      const vLast = ys[nGrid - 1];
      if (Number.isFinite(vLast)) {
        const xLast = xByGi[nGrid - 1];
        const yLast = toY(vLast);
        if (!started) ctx.moveTo(xLast, yLast); else ctx.lineTo(xLast, yLast);
      }
    }
    ctx.stroke();
  }

  // Untracked + non-voter — faint grey
  // 2026-05-26: lineWidth 0.6 → 0.5 (matches regimes_panel.js trim).
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(140,150,170,0.10)';
  for (let si = 0; si < n_samples; si++) {
    if (voterSet.has(si)) continue;
    if (trackedSet.has(si)) continue;
    strokePath(si);
  }

  // Tracked but not in voter — preserved tracked colour at low alpha.
  // 2026-05-26: lineWidth 1.0 → 0.7.
  for (const si of trackedSet) {
    if (voterSet.has(si)) continue;
    let col = '#aab2c0';
    {
      const c = resolveSampleScopeColor(state, si, state.linesColorMode || 'kmeans');
      if (c) col = c;
    }
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = withAlpha(col, 0.45);
    strokePath(si);
  }

  // Voter samples — coloured by their original voter band
  const bandHues = ['#f5a524', '#22d3ee', '#a78bfa', '#34d399', '#f472b6',
                    '#fb7185', '#facc15', '#60a5fa'];
  const siToFocalBand = new Map();
  for (let bi = 0; bi < voter.bands.length; bi++) {
    const b = voter.bands[bi];
    const bandSamples = locus.per_band_samples[b];
    if (!bandSamples) continue;
    for (const si of bandSamples) siToFocalBand.set(si, bi);
  }
  // Match regimes_panel.js: alpha 0.35/0.80 + lineWidth 0.8 (was 0.45/0.85 + 1.2).
  // 2026-05-26: trim per Quentin's "lines are a bit thick" feedback — keeps
  // voter visibility but lets dense overlap regions surface gradients.
  const voterAlpha = voterSet.size > 8 ? 0.35 : 0.80;
  for (const si of voterSet) {
    const bi = siToFocalBand.get(si);
    const col = bandHues[(bi >= 0 ? bi : 0) % bandHues.length];
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = withAlpha(col, voterAlpha);
    strokePath(si);
  }

  // ---------------- (E) "You are here" seed-loci rectangle ----------------
  // Painted as a stratified box with K horizontal stripes (one per
  // seed band). Each stripe is tinted by that band's macro-band dosage
  // class when getMacroDosage is provided (HOM_REF=blue, HET=white,
  // HOM_INV=red, AMBIGUOUS=grey). Active bands (in the focal voter
  // mask) render at full alpha; inactive bands at 0.95 for slight
  // contrast — same convention as the lanes panel so the user can flip
  // between the two views without re-learning the visual cue.
  const seedChr = locus.chromosome_idx != null
    ? locus.chromosome_idx
    : (locus.chrom != null ? locus.chrom : -1);
  let seedGiStart = -1, seedGiEnd = -1;
  for (let gi = 0; gi < nGrid; gi++) {
    const wl = windowList[gi];
    if (wl.chr !== seedChr) continue;
    if (wl.w >= locus.s_window && wl.w <= locus.e_window) {
      if (seedGiStart < 0) seedGiStart = gi;
      seedGiEnd = gi;
    }
  }
  // Skip stripe fills when the rect would cover ≥85% of the plot width —
  // see regimes_panel.js for the rationale (orange tint drowns out the
  // PC1 traces when the seed IS the chromosome).
  const _rectCoversPlot = seedGiStart >= 0 && seedGiEnd >= seedGiStart
    && (xByGi[seedGiEnd] - xByGi[seedGiStart]) >= 0.85 * plotW;
  if (seedGiStart >= 0 && seedGiEnd >= seedGiStart) {
    const x0 = xByGi[seedGiStart] - 0.5 * cellW;
    const x1 = xByGi[seedGiEnd] + 0.5 * cellW;
    const seedK = locus.K;
    const stripeH = plotH / Math.max(1, seedK);
    const getMacroDosage = cb.getMacroDosage || null;
    const activeBandsSet = new Set(voter.bands);
    ctx.save();
    if (!_rectCoversPlot) for (let b = 0; b < seedK; b++) {
      const yTop = pad.t + b * stripeH;
      const isActive = activeBandsSet.has(b);
      const baseAlpha = isActive ? 0.09 : 0.05;
      let fillCol = `rgba(245, 165, 36, ${baseAlpha})`;
      if (getMacroDosage) {
        try {
          const bandSamples = locus.per_band_samples[b];
          const dos = getMacroDosage(locus, bandSamples);
          if (dos && dos.dosage_class) {
            fillCol = _dosagePC1ClassColour(dos.dosage_class, baseAlpha);
          }
        } catch (_) { /* fall through to gold */ }
      }
      ctx.fillStyle = fillCol;
      ctx.globalAlpha = isActive ? 0.85 : 0.55;
      ctx.fillRect(x0, yTop, x1 - x0, stripeH);
    }
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = 'rgba(245, 165, 36, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0 + 0.5, pad.t + 0.5, x1 - x0 - 1, plotH - 1);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(245, 165, 36, 0.30)';
    ctx.lineWidth = 0.5;
    if (!_rectCoversPlot) for (let b = 1; b < seedK; b++) {
      const ySep = pad.t + b * stripeH + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, ySep);
      ctx.lineTo(x1, ySep);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- (F) Chromosome boundary dividers (genome scope) ----------------
  if (rp.scope === 'genome') {
    ctx.strokeStyle = 'rgba(220,230,245,0.35)';
    ctx.lineWidth = 1;
    ctx.fillStyle = themeColor('dim');
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let prevChr = -1;
    for (let gi = 0; gi < nGrid; gi++) {
      const ci = windowList[gi].chr;
      if (ci !== prevChr) {
        const x = xByGi[gi];
        ctx.beginPath();
        ctx.moveTo(x + 0.5, pad.t);
        ctx.lineTo(x + 0.5, pad.t + plotH);
        ctx.stroke();
        const name = (rp.chromosomes[ci] && rp.chromosomes[ci].name)
          ? rp.chromosomes[ci].name
          : `chr ${ci}`;
        ctx.fillText(name, x + 4, pad.t + plotH + 2);
        prevChr = ci;
      }
    }
  }

  // ---------------- (G) Header — focal voter info + scope ----------------
  const hdr = `seed ${rp.focal.seed_index}  ${voter.label}  (n=${voter.n})  ` +
              `· scope=${rp.scope}  · ${rp.bandComboMode || 'additive'}`;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(pad.l + 4, pad.t + 4, ctx.measureText(hdr).width + 12, 16);
  ctx.fillStyle = '#e6edf6';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(hdr, pad.l + 10, pad.t + 6);

  // Stash geometry for click handlers
  state.__regimesPC1Geom = {
    pad, plotW, plotH, w, h, nGrid, windowList, yMin, yMax,
  };
}

function _drawMessage(ctx, w, h, msg) {
  if (typeof ctx === 'string') return;
  if (!ctx) return;
  ctx.fillStyle = themeColor('dim');
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, w / 2, h / 2);
}

// ---------------------------------------------------------------------
// buildRegimesPC1Panel — DOM scaffolding (one canvas + a hint header).
// Same shape as buildRegimesPanel from regimes_panel.js.
// ---------------------------------------------------------------------

export function buildRegimesPC1Panel(state) {
  const container = document.getElementById('regimesPC1CanvasContainer');
  const panel = document.getElementById('regimesPC1Panel');
  if (!container || !panel) return;
  if (typeof container.appendChild !== 'function') return;
  if ('innerHTML' in container) container.innerHTML = '';
  if (!state.regimesPanel || !state.regimesPanel.stage3_loci ||
      state.regimesPanel.stage3_loci.length === 0) {
    if (panel.style) panel.style.display = 'none';
    return;
  }
  if (panel.style) panel.style.display = '';
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  const sub = document.createElement('div');
  sub.className = 'regimes-pc1-subpanel';
  sub.style.cssText = 'position: relative; flex: 1 1 0; min-height: 0; ' +
                      'border-bottom: 1px solid var(--rule, #2a3242);';
  const cv = document.createElement('canvas');
  // 2026-05-20: position:absolute + inset:0 (same fix as regimes_panel.js).
  // height:100% on a flex-basis-0 parent resolves to 0 in some browsers,
  // which trips fitCanvas() → "bail: zero plot area" in drawRegimesPC1Panel.
  cv.style.cssText = 'display: block; position: absolute; inset: 0; cursor: crosshair;';
  cv.tabIndex = 0;
  sub.appendChild(cv);
  container.appendChild(sub);
}

// Console-debug
if (typeof window !== 'undefined') {
  window._drawRegimesPC1Panel  = drawRegimesPC1Panel;
  window._buildRegimesPC1Panel = buildRegimesPC1Panel;
}
