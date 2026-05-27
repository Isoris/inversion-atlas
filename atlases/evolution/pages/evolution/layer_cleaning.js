// pages/evolution/layer_cleaning.js
// =====================================================================
// Per-sample weighting cartridge for Layer 0/1 cleaning. Renders a
// per-sample bar showing final weight ∈ [0, 1] so the user can see
// which samples are clean (weight ≈ 1), downweighted (0 < w < 1), or
// excluded (w = 0).
//
// Input contract:
//   atlasState.inversion.layer_cleaning_state = {
//     n_samples,
//     kinship?:      Float64Array  (n × n)
//     family_ids?:   Array<*>      length n
//     hatchery_dup?: boolean[]     length n
//     sample_labels?: string[]
//     candidate_label?: string,
//     view_state?:   { kinship_threshold, duplicate_weight }
//   }
// =====================================================================

import { _pageState, _setActiveState } from './layer_cleaning/_state.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import { paintCanvasAxes, paintLegend } from '../../shared/canvas_axes.js';
import {
  computeSampleWeights,
  weightsSummary,
} from '../../shared/mgl_kinship_downweight.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  kinship_threshold: 0.10,
  duplicate_weight:  0.0,
});

export function refreshLayerCleaning(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderCounts(_pageState);
}

export function initLayerCleaningToolbar() {
  _wireToolbar(_pageState);
}

export async function mount(root, atlasState, registry) {
  resetOnboarding('layer_cleaning');
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshLayerCleaning(pageState); }
  catch (e) { console.warn('layer_cleaning.mount: refresh threw —', e); }
  try { initLayerCleaningToolbar(); }
  catch (e) { console.warn('layer_cleaning.mount: toolbar threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_layer_cleaning_state = pageState;
  }
}
export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('layer_cleaning.unmount: teardown threw —', e); }
  _setActiveState(null);
}

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.layer_cleaning_state || null;
  const vs = Object.assign({}, DEFAULT_VIEW_STATE, (src && src.view_state) || {});
  const weights = (src && Number.isFinite(src.n_samples))
    ? computeSampleWeights({
        n_samples:   src.n_samples,
        kinship:     src.kinship || null,
        family_ids:  src.family_ids || null,
        hatchery_dup:src.hatchery_dup || null,
        opts:        vs,
      })
    : new Float64Array(0);
  const summary = weightsSummary(weights);
  return {
    source:          src,
    candidate_label: src ? (src.candidate_label || null) : null,
    sample_labels:   src ? (src.sample_labels || null) : null,
    weights, summary,
    view_state:      vs,
    _handlers:       {},
  };
}

function _rebuild(state) {
  if (!state || !state.source) return;
  const s = state.source;
  state.weights = computeSampleWeights({
    n_samples:    s.n_samples,
    kinship:      s.kinship || null,
    family_ids:   s.family_ids || null,
    hatchery_dup: s.hatchery_dup || null,
    opts:         state.view_state,
  });
  state.summary = weightsSummary(state.weights);
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('lcCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const sb = document.getElementById('lcSummaryBadge');
  if (sb) {
    if (state.summary && state.summary.n_total > 0) {
      sb.textContent = `clean ${state.summary.n_clean} · `
                     + `dw ${state.summary.n_downweighted} · `
                     + `ex ${state.summary.n_excluded}`;
    } else { sb.textContent = '—'; }
  }
  const kt = document.getElementById('lcKinshipThr');
  if (kt) kt.value = state.view_state.kinship_threshold;
  const dw = document.getElementById('lcDupWeight');
  if (dw) dw.value = state.view_state.duplicate_weight;
}

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('lcCanvas');
  const empty  = document.getElementById('lcEmpty');
  if (!canvas) return;
  const w = state.weights;
  if (!w || w.length === 0) {
    if (empty) { empty.style.display = ''; applyOnboarding('layer_cleaning'); }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 300);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 300;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  // Wider gutters: room for the y-axis ticks/title on the left and
  // an inline legend strip at the bottom.
  const left = 64, top = 22, right = 16, bottom = 56;
  const barW = Math.max(2, (W - left - right) / w.length);
  const barH = Math.max(50, H - top - bottom);
  const plot = { x: left, y: top, w: barW * w.length, h: barH };

  // Axes — y is weight ∈ [0, 1], x is sample index. Grid on Y so the
  // user can eyeball where each bar lands relative to the 0.9 clean
  // threshold.
  paintCanvasAxes(ctx, {
    plot,
    xRange: [0, Math.max(1, w.length - 1)],
    yRange: [0, 1],
    xLabel: 'sample index',
    yLabel: 'weight',
    nXTicks: 6,
    nYTicks: 5,
    showGrid: true,
  });

  // Bars.
  for (let i = 0; i < w.length; i++) {
    const v = w[i];
    const h = barH * (Number.isFinite(v) ? v : 0);
    let c;
    if (v === 0)        c = '#D04545';
    else if (v >= 0.9)  c = '#2BAA50';
    else                c = '#D8A030';
    ctx.fillStyle = c;
    if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(plot.x + i * barW, plot.y + (barH - h), barW + 0.5, h);
    }
  }

  // Clean threshold line at y=0.9 (the boundary we use to call a
  // sample "clean"). Dashed and labelled to disambiguate from grid.
  if (typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
    const yClean = plot.y + plot.h - 0.9 * plot.h;
    ctx.strokeStyle = 'rgba(43, 170, 80, 0.85)';
    ctx.lineWidth = 1;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, yClean);
    ctx.lineTo(plot.x + plot.w, yClean);
    ctx.stroke();
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
    if (typeof ctx.fillText === 'function') {
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(43, 170, 80, 0.85)';
      if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'left';
      if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'bottom';
      ctx.fillText('clean ≥ 0.9', plot.x + 4, yClean - 2);
      if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'alphabetic';
    }
  }

  // Inline colour-legend strip under the chart.
  paintLegend(ctx, {
    origin: { x: plot.x, y: plot.y + plot.h + 28 },
    entries: [
      { label: 'clean (≥0.9)',       color: '#2BAA50' },
      { label: 'downweighted',       color: '#D8A030' },
      { label: 'excluded (w = 0)',   color: '#D04545' },
    ],
  });
}

function _renderCounts(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('lcCountsBody');
  if (!body) return;
  if (!state.summary || state.summary.n_total === 0) {
    body.innerHTML = '<dt class="empty">—</dt><dd>—</dd>';
    return;
  }
  const s = state.summary;
  let html = '';
  html += `<dt>n total</dt><dd>${s.n_total}</dd>`;
  html += `<dt>n clean (≥0.9)</dt><dd>${s.n_clean}</dd>`;
  html += `<dt>n downweighted</dt><dd>${s.n_downweighted}</dd>`;
  html += `<dt>n excluded (w=0)</dt><dd>${s.n_excluded}</dd>`;
  if (Number.isFinite(s.mean_weight)) {
    html += `<dt>mean weight</dt><dd>${s.mean_weight.toFixed(3)}</dd>`;
  }
  body.innerHTML = html;
}

function _wireToolbar(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);
  const repaintAll = () => { _renderHeader(state); _paintCanvas(state); _renderCounts(state); };
  const onKThr = (e) => {
    const v = parseFloat(e && e.target && e.target.value);
    if (Number.isFinite(v) && v >= 0 && v <= 1) {
      state.view_state.kinship_threshold = v;
      _rebuild(state); repaintAll();
    }
  };
  const onDup = (e) => {
    const v = parseFloat(e && e.target && e.target.value);
    if (Number.isFinite(v) && v >= 0 && v <= 1) {
      state.view_state.duplicate_weight = v;
      _rebuild(state); repaintAll();
    }
  };
  state._handlers = { onKThr, onDup };
  _addListener('lcKinshipThr', 'change', onKThr);
  _addListener('lcDupWeight',  'change', onDup);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onKThr) _removeListener('lcKinshipThr', 'change', h.onKThr);
  if (h.onDup)  _removeListener('lcDupWeight',  'change', h.onDup);
  state._handlers = {};
}
function _addListener(id, evt, cb) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const el = document.getElementById(id);
  if (el && typeof el.addEventListener === 'function') el.addEventListener(evt, cb);
}
function _removeListener(id, evt, cb) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const el = document.getElementById(id);
  if (el && typeof el.removeEventListener === 'function') el.removeEventListener(evt, cb);
}
