// pages/evolution/inv_internal_substructure.js
// =====================================================================
// PCA on derived-only samples to surface sublineages inside the INV
// class. Reuses shared/mgl_pca_compute.pcaForWindow.
// =====================================================================

import { _pageState, _setActiveState } from './inv_internal_substructure/_state.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import { autoSeedDosageInput } from '../../shared/auto_seed_inv_idx.js';
import { attachAutoSeedBadge, detachAutoSeedBadge } from '../../shared/auto_seed_badge.js';
import { paintCanvasAxes } from '../../shared/canvas_axes.js';
// 2026-05-23 Phase 1c: mgl_pca_compute moved to cross-species atlas.
// inv_internal_substructure will migrate to evolution atlas in Phase 2
// — at that point this becomes evolution → cross-species cross-atlas.
import { pcaForWindow } from '../../../cross-species/shared/mgl_pca_compute.js';

/** Array-or-TypedArray guard — see evolution/shared/mgl_haplotype_network.js. */
function _isVec(x) {
  return Array.isArray(x) || (x != null && ArrayBuffer.isView(x) && typeof x.length === 'number');
}

export function refreshInternalHistory(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderMetrics(_pageState);
}

export function initInternalHistoryToolbar() { /* no toolbar */ }

export async function mount(root, atlasState, registry) {
  resetOnboarding('inv_internal_substructure');
  _autoSeedIfMissing(atlasState);
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshInternalHistory(pageState); }
  catch (e) { console.warn('inv_internal_substructure.mount: refresh threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_inv_internal_substructure_state = pageState;
  }
}

function _autoSeedIfMissing(atlasState) {
  const inv = atlasState && atlasState.inversion;
  if (!inv) return;
  if (inv.internal_history_state && inv.internal_history_state.dosage) return;
  const seeded = autoSeedDosageInput(atlasState);
  if (!seeded) return;
  inv.internal_history_state = seeded;
}
export async function unmount(root) { _setActiveState(null); }

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.internal_history_state || null;
  // Slice dosage to inv-only columns, then call pcaForWindow.
  let pca = null;
  if (src && src.dosage && _isVec(src.inv_idx) && src.inv_idx.length >= 2) {
    const isFlat = src.dosage instanceof Float64Array || ArrayBuffer.isView(src.dosage);
    const n_inv = src.inv_idx.length;
    const dosage_slice = new Float64Array(src.n_markers * n_inv);
    for (let mi = 0; mi < src.n_markers; mi++) {
      for (let i = 0; i < n_inv; i++) {
        const v = isFlat ? src.dosage[mi * src.n_samples + src.inv_idx[i]]
                         : (src.dosage[mi] && src.dosage[mi][src.inv_idx[i]]);
        dosage_slice[mi * n_inv + i] = Number.isFinite(v) ? v : 0;
      }
    }
    pca = pcaForWindow({
      dosage:    dosage_slice,
      n_markers: src.n_markers,
      n_samples: n_inv,
    });
  }
  return {
    source:          src,
    candidate_label: src ? (src.candidate_label || null) : null,
    pca,
  };
}

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('ihCandidateLabel');
  if (lbl) {
    lbl.textContent = state.candidate_label || '—';
    if (state.source && state.source._auto_seeded) attachAutoSeedBadge(lbl);
    else                                           detachAutoSeedBadge(lbl);
  }
  const n = document.getElementById('ihNotePresent');
  if (n) {
    n.textContent = state.pca && state.pca.pc1
      ? `n_inv = ${state.pca.pc1.length}` : '—';
  }
}

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('ihCanvas');
  const empty  = document.getElementById('ihEmpty');
  if (!canvas) return;
  if (!state.pca || !state.pca.pc1) {
    if (empty) { empty.style.display = ''; applyOnboarding('inv_internal_substructure'); }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 500, canvas.height || 400);
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 500;
  const H = canvas.height || 400;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  const pc1 = state.pca.pc1;
  const pc2 = state.pca.pc2;
  let lo1 = Infinity, hi1 = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (let i = 0; i < pc1.length; i++) {
    if (pc1[i] < lo1) lo1 = pc1[i];
    if (pc1[i] > hi1) hi1 = pc1[i];
    if (pc2[i] < lo2) lo2 = pc2[i];
    if (pc2[i] > hi2) hi2 = pc2[i];
  }
  if (lo1 === hi1) { lo1 -= 0.5; hi1 += 0.5; }
  if (lo2 === hi2) { lo2 -= 0.5; hi2 += 0.5; }
  // Plot margins make room for axis tick labels + axis titles.
  const plot = { x: 56, y: 16, w: Math.max(50, W - 80), h: Math.max(50, H - 60) };

  // % variance subtitles when eigenvalues sum is known.
  let xLabel = 'PC1', yLabel = 'PC2';
  const lamSum = (state.pca.lam1 || 0) + (state.pca.lam2 || 0);
  if (lamSum > 0) {
    xLabel = `PC1  (${(100 * (state.pca.lam1 || 0) / lamSum).toFixed(1)}%)`;
    yLabel = `PC2  (${(100 * (state.pca.lam2 || 0) / lamSum).toFixed(1)}%)`;
  }
  paintCanvasAxes(ctx, {
    plot,
    xRange: [lo1, hi1], yRange: [lo2, hi2],
    xLabel, yLabel,
    nXTicks: 5, nYTicks: 5,
  });

  ctx.fillStyle = 'rgba(48, 116, 200, 0.85)';
  for (let i = 0; i < pc1.length; i++) {
    const tx = (pc1[i] - lo1) / (hi1 - lo1);
    const ty = (pc2[i] - lo2) / (hi2 - lo2);
    const px = plot.x + tx * plot.w;
    const py = plot.y + plot.h - ty * plot.h;
    if (typeof ctx.beginPath === 'function' && typeof ctx.arc === 'function' && typeof ctx.fill === 'function') {
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(px - 3, py - 3, 6, 6);
    }
  }
}

function _renderMetrics(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('ihMetricsBody');
  if (!body) return;
  if (!state.pca) { body.innerHTML = '<dt class="empty">—</dt><dd>—</dd>'; return; }
  const f = (v) => Number.isFinite(v) ? v.toFixed(4) : '—';
  let html = '';
  html += `<dt>λ1</dt><dd>${f(state.pca.lam1)}</dd>`;
  html += `<dt>λ2</dt><dd>${f(state.pca.lam2)}</dd>`;
  html += `<dt>n samples</dt><dd>${state.pca.pc1 ? state.pca.pc1.length : 0}</dd>`;
  body.innerHTML = html;
}
