// pages/discovery/dosage_cluster_adaptive_k.js
// =====================================================================
// Dosage clustering panel — atlas-side cartridge for HANDOFF_8 /
// SPEC_0 §11.8.
//
// Phase 1 scope:
//   - Per-cluster mean dosage curves rendered on a single canvas
//   - Verdict badge (structure_detected / no_structure /
//     insufficient_data) + K_chosen badge
//   - Per-K table in the right panel (silhouette, stability,
//     min_size, spatial_coherence, Δsil, passes); click a row to
//     focus that K's curves
//   - Cluster-size legend below
//
// Input contract:
//   atlasState.inversion.dosage_cluster_state = {
//     cluster_result:   shared/mgl_dosage_clustering
//                         .adaptiveKDosageClustering output,
//     candidate_label?: string,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './dosage_cluster_adaptive_k/_state.js';
import {
  paintClusterCurves,
  findClusterAtPixel,
  verdictColor,
  verdictLabel,
  clusterColor,
} from './dosage_cluster_adaptive_k/renderer.js';
import {
  createDosageClusterSelection,
  summariseKEntry,
  entryToDisplay,
  clusterSizesFromLabels,
} from './dosage_cluster_adaptive_k/selection.js';

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshDosageCluster(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCurves(_pageState);
  _renderPerK(_pageState);
  _renderChosenDetail(_pageState);
}

export function initDosageClusterToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshDosageCluster(pageState); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.mount: refresh threw —', e); }

  try { initDosageClusterToolbar(); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_dosage_cluster_adaptive_k_state = pageState;
  }

  // 2026-05-20: auto-compute on direct mount. Builds a per-sample
  // dosage-profile matrix D[sample × window] from the local_pca_dosage
  // data (PC1 across windows is a reasonable per-sample profile when
  // the raw dosage matrix isn't directly accessible), then runs
  // adaptiveKDosageClustering. Falls back to a fresh scrubber_main
  // resolve when the stash isn't populated.
  if (!pageState.cluster_result) {
    try {
      await _autoComputeDosageClustering(root, atlasState, registry);
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshDosageCluster(pageState); }
      catch (e) { console.warn('dosage_cluster_adaptive_k.mount: post-autocompute refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_dosage_cluster_adaptive_k_state = pageState;
      }
    } catch (e) {
      console.warn('dosage_cluster_adaptive_k.mount: auto-compute failed:', e);
    }
  }
}

async function _autoComputeDosageClustering(root, atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.dosage_cluster_state || {};
  if (existing.cluster_result) return;
  const stash = inv._local_pca_dosage_state;
  let data = (stash && stash.data) || null;
  if (!data && registry) {
    const chrom = atlasState.shared && atlasState.shared.activeChrom;
    if (chrom) {
      try { data = await registry.resolve('scrubber_main', { chrom }); }
      catch (e) {
        console.warn('dosage_cluster_adaptive_k: scrubber_main resolve threw —', e);
      }
    }
  }
  if (!data || !Array.isArray(data.windows)) {
    _setLoadingHint(root, 'no scrubber data on this chromosome.');
    return;
  }
  const wins = data.windows;
  const nW = wins.length;
  const nS = data.n_samples | 0;
  if (nW <= 0 || nS <= 0) return;
  // Build D[sample][window] = signed PC1 across windows. Float64Array
  // row-major n_samples × n_windows for adaptiveKDosageClustering's
  // expected contract.
  const D = new Float64Array(nS * nW);
  for (let i = 0; i < nW; i++) {
    const w = wins[i];
    if (!w || !w.pc1) continue;
    for (let s = 0; s < nS; s++) {
      D[s * nW + i] = +w.pc1[s] || 0;
    }
  }
  let result = null;
  try {
    const mod = await import('../../shared/mgl_dosage_clustering.js').catch(() => null);
    if (mod && typeof mod.adaptiveKDosageClustering === 'function') {
      result = mod.adaptiveKDosageClustering(D, nS, nW, {});
    }
  } catch (e) {
    _setLoadingHint(root, `adaptiveKDosageClustering threw: ${e && e.message ? e.message : 'error'}`);
    return;
  }
  if (!result) return;
  inv.dosage_cluster_state = Object.assign({}, existing, {
    cluster_result:  result,
    candidate_label: existing.candidate_label || (data.chrom || null),
  });
}

function _setLoadingHint(root, msg) {
  const el = (root && root.querySelector && root.querySelector('#dosageClusterEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('dosageClusterEmpty'));
  if (el) {
    el.style.display = '';
    el.textContent = msg;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const dc = inv.dosage_cluster_state || null;
  const cr = dc ? dc.cluster_result : null;
  return {
    cluster_result:        cr,
    candidate_label:       dc ? (dc.candidate_label || null) : null,
    curve_hit_regions:     [],
    selection:             createDosageClusterSelection(
                              cr && Number.isFinite(cr.K_chosen) ? cr.K_chosen : null),
    _handlers:             {},
  };
}

function _activeEntry(state) {
  if (!state) return null;
  return entryToDisplay(state.cluster_result, state.selection.getFocusedK());
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('dosageClusterCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const badge = document.getElementById('dosageClusterVerdictBadge');
  if (badge) {
    const cr = state.cluster_result;
    if (cr && cr.verdict) {
      badge.textContent = verdictLabel(cr.verdict);
      badge.style.background = verdictColor(cr.verdict);
      badge.style.color = '#fff';
    } else {
      badge.textContent = '—';
      badge.style.background = '';
      badge.style.color = '';
    }
  }
  const k = document.getElementById('dosageClusterKBadge');
  if (k) {
    const cr = state.cluster_result;
    const focused = state.selection.getFocusedK();
    const e = _activeEntry(state);
    const Kshown = e ? e.K : (cr && cr.K_chosen) || null;
    k.textContent = (Kshown != null)
      ? `K = ${Kshown}${focused != null && cr && cr.K_chosen != null && focused !== cr.K_chosen ? ' (focused)' : ''}`
      : 'K = —';
  }
}

// =====================================================================
// Curve paint
// =====================================================================

function _paintCurves(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('dosageClusterCurvesCanvas');
  const empty  = document.getElementById('dosageClusterEmpty');
  if (!canvas) return;
  const entry = _activeEntry(state);
  const curves = entry ? entry.cluster_curves : null;
  if (!curves || !Array.isArray(curves) || curves.length === 0) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 320);
    }
    state.curve_hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const paint = paintClusterCurves(canvas, curves, {
    hovered_cluster: state.selection.getHoveredCluster(),
  });
  state.curve_hit_regions = paint.curve_hit_regions;
}

// =====================================================================
// Right panel — per-K table
// =====================================================================

function _renderPerK(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('dosageClusterPerKBody');
  if (!body) return;
  const cr = state.cluster_result;
  if (!cr || !Array.isArray(cr.per_K) || cr.per_K.length === 0) {
    body.innerHTML = '<span class="empty">No per-K table</span>';
    return;
  }
  const focused = state.selection.getFocusedK();
  let html = '<table class="dc-per-k-table">'
           + '<thead><tr>'
           +   '<th>K</th><th>sil</th><th>stab</th><th>min</th><th>coh</th><th>Δsil</th><th>✓</th>'
           + '</tr></thead><tbody>';
  for (const e of cr.per_K) {
    if (!e) continue;
    const rowCls = (focused === e.K) ? 'focused'
                 : (cr.K_chosen === e.K) ? 'chosen' : '';
    html += `<tr class="${rowCls}" data-k="${e.K}">`
         +    `<td>${e.K}</td>`
         +    `<td>${Number.isFinite(e.silhouette)        ? e.silhouette.toFixed(3) : '—'}</td>`
         +    `<td>${Number.isFinite(e.stability)         ? e.stability.toFixed(3)  : '—'}</td>`
         +    `<td>${Number.isFinite(e.min_size)          ? e.min_size              : '—'}</td>`
         +    `<td>${Number.isFinite(e.spatial_coherence) ? e.spatial_coherence.toFixed(3) : '—'}</td>`
         +    `<td>${Number.isFinite(e.delta_sil)
                       ? (e.delta_sil >= 0 ? '+' : '') + e.delta_sil.toFixed(3) : '—'}</td>`
         +    `<td>${e.passes ? '✓' : '—'}</td>`
         + '</tr>';
  }
  html += '</tbody></table>';
  body.innerHTML = html;
}

// =====================================================================
// Right panel — chosen K detail
// =====================================================================

function _renderChosenDetail(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('dosageClusterChosenFields');
  if (!fields) return;
  const entry = _activeEntry(state);
  if (!entry) {
    fields.innerHTML = '<dt class="empty">No chosen K</dt><dd>—</dd>';
    return;
  }
  let html = '';
  for (const row of summariseKEntry(entry)) {
    html += `<dt>${row.label}</dt><dd>${row.value}</dd>`;
  }
  const sizes = clusterSizesFromLabels(entry.labels);
  if (sizes.length > 0) {
    html += '<dt>Cluster sizes</dt><dd>';
    for (const [k, n] of sizes) {
      const c = clusterColor(k);
      html += `<span class="dc-cluster-swatch" style="background:${c}"></span>`
           +  `<span class="dc-cluster-size">${k}:n=${n}</span> `;
    }
    html += '</dd>';
  }
  fields.innerHTML = html;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

function _wireToolbar(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaintAll = () => {
    _renderHeader(state);
    _paintCurves(state);
    _renderPerK(state);
    _renderChosenDetail(state);
  };

  const onTableClick = (ev) => {
    // Find the closest <tr data-k> ancestor without relying on
    // document.querySelectorAll (works under the fake-DOM smoke).
    let node = ev && ev.target;
    while (node && (typeof node.getAttribute !== 'function' || !node.getAttribute('data-k'))) {
      node = node.parentNode;
    }
    if (!node) return;
    const k = parseInt(node.getAttribute('data-k'), 10);
    if (!Number.isFinite(k)) return;
    state.selection.setFocusedK(k);
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('dosageClusterCurvesCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.selection.setHoveredCluster(findClusterAtPixel(state.curve_hit_regions, x, y));
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onTableClick, onCanvasMove, unsubSelection,
  };
  _addListener('dosageClusterPerKBody',       'click',     onTableClick);
  _addListener('dosageClusterCurvesCanvas',   'mousemove', onCanvasMove);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onTableClick)   _removeListener('dosageClusterPerKBody',     'click',     h.onTableClick);
  if (h.onCanvasMove)   _removeListener('dosageClusterCurvesCanvas', 'mousemove', h.onCanvasMove);
  if (typeof h.unsubSelection === 'function') { try { h.unsubSelection(); } catch (_) {} }
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
