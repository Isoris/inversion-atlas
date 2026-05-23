// =============================================================================
// popstats/_render.js
// =============================================================================
// The popstats track-stack renderer. Native ES-module port of the legacy
// `renderPopstatsPage()` from Inversion_atlas.html (lines 71575–71732).
//
// Inputs:
//   - root      — page root element (mounted by atlas_router)
//   - data      — scrubber_main JSON for the active chrom (state.data
//                 equivalent). Must contain `windows`. `tracks` is optional;
//                 `sim_mat` is optional.
//   - candidate — optional active candidate (for breakpoint overlay)
//   - cur       — optional current window index (for crosshair)
//
// Side effects: writes to #psChips and #psStack inside `root`. Hides #psNoChrom
// when data is present. Pure DOM, no global state.
// =============================================================================

import {
  fitCanvas, themeColor,
  drawFrame, drawBreakpoints, drawCrosshair, drawEdgeLabels,
  drawIdeogram, drawSimCollapse, drawLine,
} from './_canvas.js';
import { loadView, saveView, categoryOf, isVisible, toggle } from './_view.js';
import { collectTracks } from './_tracks.js';
import { attachTooltip } from './_tooltip.js';

const CAT_LABELS = { qc: 'QC', popstats: 'popstats' };

/**
 * Top-level render. Idempotent — safe to call after chip toggles or data
 * changes. Pulls toggle state from localStorage so chip clicks persist.
 */
export function renderPopstatsPage({ root, data, candidate, cur }) {
  if (!root) return;
  const stack    = root.querySelector('#psStack');
  const chipsBox = root.querySelector('#psChips');
  const noChrom  = root.querySelector('#psNoChrom');
  if (!stack || !chipsBox) return;

  if (!data || !data.windows) {
    if (noChrom) {
      noChrom.style.display = 'block';
      noChrom.textContent = 'Load a precomp JSON to view the popstats stack.';
    }
    stack.innerHTML = '';
    chipsBox.innerHTML = '';
    return;
  }
  if (noChrom) noChrom.style.display = 'none';

  const tracks = collectTracks(data);
  const view   = loadView();
  const bps    = _breakpoints(candidate, data, cur);

  _renderChips(chipsBox, tracks, view, () => {
    saveView(view);
    renderPopstatsPage({ root, data, candidate, cur });
  });
  _renderStack(stack, tracks, view);

  requestAnimationFrame(() => _drawAll(stack, tracks, view, data, bps, cur));
}

function _renderChips(chipsBox, tracks, view, onToggle) {
  chipsBox.innerHTML = '';
  let lastCat = null;
  for (const t of tracks) {
    const cat = categoryOf(t);
    if (cat !== lastCat && (cat === 'qc' || cat === 'popstats')) {
      const sep = document.createElement('span');
      sep.className = 'ps-chip-section';
      sep.textContent = CAT_LABELS[cat] + ':';
      sep.style.cssText = 'font-family: var(--mono); font-size: 10px; '
        + 'color: var(--ink-dim); margin: 0 4px 0 8px; align-self: center;';
      chipsBox.appendChild(sep);
    }
    lastCat = cat;

    const chip = document.createElement('span');
    chip.className = 'ps-chip';
    chip.dataset.category = cat;
    chip.dataset.trackId = t.id;
    if (isVisible(t, view))      chip.classList.add('active');
    if (!t.hasData && !t.alwaysOn) chip.classList.add('no-data');
    chip.textContent = t.label;

    if (t.hasData) {
      const parts = [`${t.label} — click to toggle visibility.`];
      if (t.yLabel) parts.push(`Y axis: ${t.yLabel}.`);
      if (t.edgeTop && t.edgeBot) parts.push(`High → ${t.edgeTop} · low → ${t.edgeBot}.`);
      else if (t.edgeTop)         parts.push(`High → ${t.edgeTop}.`);
      if (cat === 'qc')       parts.push('(QC track — off by default; click to show.)');
      else if (cat === 'popstats') parts.push('(popstats track — off by default; click to show.)');
      chip.title = parts.join(' ');
    } else {
      chip.title = `${t.label} — ${t.loadHint || 'data not loaded'}`;
    }

    chip.addEventListener('click', () => {
      toggle(t, view);
      onToggle();
    });
    chipsBox.appendChild(chip);
  }
}

function _renderStack(stack, tracks, view) {
  stack.innerHTML = '';
  for (const t of tracks) {
    if (!isVisible(t, view)) continue;
    const div = document.createElement('div');
    div.className = 'ps-track';
    div.style.height = `${t.height}px`;
    div.dataset.trackId = t.id;
    const label = document.createElement('div');
    label.className = 'ps-track-label';
    label.textContent = t.label;
    div.appendChild(label);
    if (!t.hasData && !t.alwaysOn) {
      const msg = document.createElement('div');
      msg.className = 'ps-empty-msg';
      msg.textContent = t.loadHint || `${t.label} — data not loaded`;
      div.appendChild(msg);
    } else {
      const cv = document.createElement('canvas');
      cv.dataset.trackId = t.id;
      div.appendChild(cv);
    }
    stack.appendChild(div);
  }
}

function _drawAll(stack, tracks, view, data, bps, cur) {
  const wins = data.windows;
  if (!wins || wins.length === 0) return;
  const mbMin = wins[0].center_mb;
  const mbMax = wins[wins.length - 1].center_mb;
  if (!isFinite(mbMin) || !isFinite(mbMax) || mbMin === mbMax) return;

  for (const t of tracks) {
    if (!isVisible(t, view)) continue;
    const div = stack.querySelector(`.ps-track[data-track-id="${t.id}"]`);
    if (!div) continue;
    const cv = div.querySelector('canvas');
    if (!cv) continue;
    const { ctx, w, h } = fitCanvas(cv);
    if (!ctx) continue;
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 80, r: 60, t: 14, b: 6 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) continue;
    const toX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

    drawFrame(ctx, pad, plotW, plotH);
    drawBreakpoints(ctx, toX, pad, plotH, bps);

    if (t.renderer === 'ideogram') {
      drawIdeogram(ctx, toX, pad, plotW, plotH, mbMin, mbMax, bps);
    } else if (t.renderer === 'sim_collapse') {
      drawSimCollapse(ctx, toX, pad, plotW, plotH, wins, data.sim_mat);
    } else if (typeof t.getData === 'function') {
      const td = t.getData(data);
      if (td) {
        drawLine(ctx, toX, pad, plotW, plotH, td, t);
        attachTooltip(cv, {
          trackDef: t, data: td,
          padL: pad.l, padR: pad.r,
          mbMin, mbMax,
        });
      }
    }

    if (typeof cur === 'number' && wins[cur]) {
      drawCrosshair(ctx, toX, pad, plotH, wins[cur].center_mb);
    }
    drawEdgeLabels(ctx, pad, plotW, plotH, t);
  }
}

function _breakpoints(candidate, data, cur) {
  const bps = [];
  if (candidate && isFinite(candidate.start_mb) && isFinite(candidate.end_mb)) {
    bps.push(candidate.start_mb, candidate.end_mb);
  } else if (data && data.l2_envelopes && typeof cur === 'number') {
    const env = _findL2Envelope(data.l2_envelopes, cur);
    if (env && data.windows) {
      const s = data.windows[(env._s0 ?? env.start_w - 1)];
      const e = data.windows[(env._e0 ?? env.end_w - 1)];
      if (s && e) bps.push(s.center_mb, e.center_mb);
    }
  }
  return bps;
}

function _findL2Envelope(envelopes, w) {
  for (const env of envelopes) {
    const s0 = env._s0 ?? (env.start_w - 1);
    const e0 = env._e0 ?? (env.end_w   - 1);
    if (w >= s0 && w <= e0) return env;
  }
  return null;
}
