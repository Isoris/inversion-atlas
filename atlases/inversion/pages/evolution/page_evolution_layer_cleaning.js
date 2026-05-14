// pages/evolution/page_evolution_layer_cleaning.js
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

import { _pageState, _setActiveState } from './page_evolution_layer_cleaning/_state.js';
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
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshLayerCleaning(pageState); }
  catch (e) { console.warn('page_evolution_layer_cleaning.mount: refresh threw —', e); }
  try { initLayerCleaningToolbar(); }
  catch (e) { console.warn('page_evolution_layer_cleaning.mount: toolbar threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_layer_cleaning_state = pageState;
  }
}
export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('page_evolution_layer_cleaning.unmount: teardown threw —', e); }
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
    if (empty) empty.style.display = '';
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
  const padX = 32, padY = 20;
  const barW = Math.max(2, (W - 2 * padX) / w.length);
  const barH = Math.max(50, H - 2 * padY);
  for (let i = 0; i < w.length; i++) {
    const v = w[i];
    const h = barH * (Number.isFinite(v) ? v : 0);
    // green=clean, yellow=mid, red=excluded
    let c;
    if (v === 0)        c = '#D04545';
    else if (v >= 0.9)  c = '#2BAA50';
    else                c = '#D8A030';
    ctx.fillStyle = c;
    if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(padX + i * barW, padY + (barH - h), barW + 0.5, h);
    }
  }
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(padX, padY, barW * w.length, barH);
  }
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
