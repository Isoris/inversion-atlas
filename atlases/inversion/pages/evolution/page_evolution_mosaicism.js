// pages/evolution/page_evolution_mosaicism.js
// =====================================================================
// Per-INV-sample × window leakage heatmap. Cells coloured by fraction
// of informative sites where the sample matches STD-consensus rather
// than INV-consensus.
//
// Input contract:
//   atlasState.inversion.mosaicism_state = {
//     dosage, n_markers, n_samples, inv_idx, std_idx,
//     candidate_label?, sample_labels?,
//     view_state?: { window_size_markers }
//   }
// =====================================================================

import { _pageState, _setActiveState } from './page_evolution_mosaicism/_state.js';
import {
  perWindowLeakage,
  integrityVerdict,
} from '../../shared/mgl_mosaicism_detector.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  window_size_markers: 20,
});

const INTEGRITY_LABEL = Object.freeze({
  clean:        'Clean',
  mixed:        'Mixed',
  leaky:        'Leaky',
  insufficient: 'Insufficient data',
});

const INTEGRITY_COLOR = Object.freeze({
  clean: '#2BAA50', mixed: '#D8A030', leaky: '#D04545', insufficient: '#888888',
});

function _heatColor(v) {
  if (!Number.isFinite(v)) return 'rgb(220,220,220)';
  const t = Math.max(0, Math.min(1, v));
  // White → red ramp.
  const r = Math.round(255);
  const g = Math.round(255 - 215 * t);
  const b = Math.round(255 - 230 * t);
  return `rgb(${r},${g},${b})`;
}

export function refreshMosaicism(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderCounts(_pageState);
}

export function initMosaicismToolbar() {
  _wireToolbar(_pageState);
}

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshMosaicism(pageState); }
  catch (e) { console.warn('page_evolution_mosaicism.mount: refresh threw —', e); }
  try { initMosaicismToolbar(); }
  catch (e) { console.warn('page_evolution_mosaicism.mount: toolbar threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_mosaicism_state = pageState;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('page_evolution_mosaicism.unmount: teardown threw —', e); }
  _setActiveState(null);
}

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.mosaicism_state || null;
  const vs = Object.assign({}, DEFAULT_VIEW_STATE, (src && src.view_state) || {});
  const leak = (src && src.dosage && Array.isArray(src.inv_idx))
    ? perWindowLeakage({
        dosage: src.dosage, n_markers: src.n_markers, n_samples: src.n_samples,
        inv_idx: src.inv_idx, std_idx: src.std_idx,
        opts: { window_size_markers: vs.window_size_markers },
      })
    : null;
  const verdict = leak ? integrityVerdict(leak.per_sample_leakage) : null;
  return {
    source:          src,
    candidate_label: src ? (src.candidate_label || null) : null,
    sample_labels:   src ? (src.sample_labels || null) : null,
    leak,
    verdict,
    layout:          null,
    hover:           null,         // { sample_idx, window_idx, value }
    view_state:      vs,
    _handlers:       {},
  };
}

function _rebuildLeak(state) {
  if (!state || !state.source) return;
  const s = state.source;
  state.leak = perWindowLeakage({
    dosage: s.dosage, n_markers: s.n_markers, n_samples: s.n_samples,
    inv_idx: s.inv_idx, std_idx: s.std_idx,
    opts: { window_size_markers: state.view_state.window_size_markers },
  });
  state.verdict = integrityVerdict(state.leak.per_sample_leakage);
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('mosCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const b = document.getElementById('mosIntegrityBadge');
  if (b) {
    if (state.verdict) {
      b.textContent = INTEGRITY_LABEL[state.verdict.integrity] || state.verdict.integrity;
      b.style.background = INTEGRITY_COLOR[state.verdict.integrity] || '#888';
      b.style.color = '#fff';
    } else {
      b.textContent = '—'; b.style.background = ''; b.style.color = '';
    }
  }
  const ws = document.getElementById('mosWindowSize');
  if (ws) ws.value = state.view_state.window_size_markers;
}

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('mosCanvas');
  const empty  = document.getElementById('mosEmpty');
  if (!canvas) return;
  const L = state.leak;
  if (!L || L.n_inv === 0 || L.n_windows === 0) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 320);
    }
    state.layout = null;
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 320;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  const padX = 8, padY = 8;
  const cellW = Math.max(2, (W - 2 * padX) / L.n_windows);
  const cellH = Math.max(4, (H - 2 * padY) / L.n_inv);
  for (let pi = 0; pi < L.n_inv; pi++) {
    for (let w = 0; w < L.n_windows; w++) {
      const v = L.per_sample_per_window[pi * L.n_windows + w];
      ctx.fillStyle = _heatColor(v);
      if (typeof ctx.fillRect === 'function') {
        ctx.fillRect(padX + w * cellW, padY + pi * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
  }
  // Outline.
  ctx.strokeStyle = 'rgba(40,50,70,0.6)';
  ctx.lineWidth = 1;
  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeRect(padX, padY, cellW * L.n_windows, cellH * L.n_inv);
  }
  state.layout = { padX, padY, cellW, cellH, n_inv: L.n_inv, n_windows: L.n_windows };
}

function _renderRightPanel(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('mosSelectedFields');
  if (!fields) return;
  if (!state.hover) { fields.innerHTML = '<dt class="empty">No cell hovered</dt><dd>—</dd>'; return; }
  const h = state.hover;
  let html = '';
  const sampleIdx = state.source && state.source.inv_idx
    ? state.source.inv_idx[h.sample_idx] : h.sample_idx;
  const sLabel = (state.sample_labels && state.sample_labels[sampleIdx]) || ('s' + sampleIdx);
  html += `<dt>Sample</dt><dd>${sLabel}</dd>`;
  html += `<dt>Window</dt><dd>${h.window_idx}</dd>`;
  html += `<dt>Leakage</dt><dd>${
    Number.isFinite(h.value) ? (h.value * 100).toFixed(1) + '%' : '—'
  }</dd>`;
  if (state.leak) {
    const psl = state.leak.per_sample_leakage[h.sample_idx];
    html += `<dt>Sample leakage</dt><dd>${
      Number.isFinite(psl) ? (psl * 100).toFixed(1) + '%' : '—'
    }</dd>`;
  }
  fields.innerHTML = html;
}

function _renderCounts(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('mosCountsBody');
  if (!body) return;
  if (!state.verdict) { body.innerHTML = '<span class="empty">—</span>'; return; }
  const v = state.verdict;
  let html = '';
  html += `<div>clean: <b>${v.n_clean}</b></div>`;
  html += `<div>intermediate: <b>${v.n_intermediate}</b></div>`;
  html += `<div>leaky: <b>${v.n_leaky}</b></div>`;
  if (Number.isFinite(v.mean_leakage)) {
    html += `<div>mean: <b>${(v.mean_leakage * 100).toFixed(1)}%</b></div>`;
  }
  body.innerHTML = html;
}

function _wireToolbar(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);
  const repaintAll = () => {
    _renderHeader(state); _paintCanvas(state); _renderRightPanel(state); _renderCounts(state);
  };
  const onWindowChange = (e) => {
    const v = parseInt(e && e.target && e.target.value, 10);
    if (Number.isFinite(v) && v >= 2 && v <= 200) {
      state.view_state.window_size_markers = v;
      _rebuildLeak(state);
      state.hover = null;
      repaintAll();
    }
  };
  const onMove = (ev) => {
    const c = document.getElementById('mosCanvas');
    if (!c || !state.layout) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const L = state.layout;
    const col = Math.floor((x - L.padX) / L.cellW);
    const row = Math.floor((y - L.padY) / L.cellH);
    if (col < 0 || col >= L.n_windows || row < 0 || row >= L.n_inv) {
      if (state.hover != null) { state.hover = null; _renderRightPanel(state); }
      return;
    }
    const v = state.leak.per_sample_per_window[row * L.n_windows + col];
    state.hover = { sample_idx: row, window_idx: col, value: v };
    _renderRightPanel(state);
  };
  state._handlers = { onWindowChange, onMove };
  _addListener('mosWindowSize', 'change',    onWindowChange);
  _addListener('mosCanvas',     'mousemove', onMove);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onWindowChange) _removeListener('mosWindowSize', 'change',    h.onWindowChange);
  if (h.onMove)         _removeListener('mosCanvas',     'mousemove', h.onMove);
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
