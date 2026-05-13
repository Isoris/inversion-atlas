// pages/discovery/page_pca_panel.js
// =====================================================================
// Per-window PCA scatter panel — atlas-side cartridge for SPEC_0 §10.
//
// Phase 1 scope (this commit):
//   - Window scrubber strip (colour = λ1 + λ2 magnitude)
//   - Click a cell to load that window's PC1×PC2 scatter
//   - Per-sample point colouring by cluster assignment (optional)
//   - Hover crosshair + right-panel detail (λ1, λ2, sample,
//     cluster id, hovered sample coords)
//   - Click point to toggle sample selection
//   - Toolbar: color-by (cluster | none), axis swap, labels
//
// Deferred:
//   - 4-view × 2-weighting × 2-anchor matrix browser (SPEC_0 §10
//     full grid). For now we render whichever PCA result was loaded
//     into pca_panel_state — the upstream picks the variant.
//   - Sample-label overflow handling for very large n_samples
//   - Cross-panel linkage with tree / fingerprint / similarity
//     (separate commit once mglCandidateMode wiring is plumbed
//     through all panels)
//
// Input contract:
//   atlasState.inversion.pca_panel_state = {
//     pca_results:           Array<PCA result | null>,
//     candidate_label?:      string,
//     anchor_label?:         string  e.g. 'view_self' (header badge),
//     sample_labels?:        Array<string>,
//     cluster_assignment?:   Int32Array  per sample,
//     cluster_colors?:       Object<number,string>  overrides,
//     window_meta?:          Array<{start_bp?, end_bp?, idx?}>,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './page_pca_panel/_state.js';
import {
  paintScrubberStrip,
  paintScatter,
  findWindowAtPixel,
  findPointAtPixel,
  buildClusterColorMap,
} from './page_pca_panel/renderer.js';
import {
  createPcaPanelSelection,
  summarisePcaResult,
  clusterSizesFromAssignment,
} from './page_pca_panel/selection.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  color_by:     'cluster',
  axis_choice:  'pc1_pc2',
  show_labels:  false,
});

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshPcaPanel(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintScrubber(_pageState);
  _paintScatterCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderClusterList(_pageState);
}

export function initPcaPanelToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshPcaPanel(pageState); }
  catch (e) { console.warn('page_pca_panel.mount: refresh threw —', e); }

  try { initPcaPanelToolbar(); }
  catch (e) { console.warn('page_pca_panel.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_pca_panel_state = pageState;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('page_pca_panel.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const ps = inv.pca_panel_state || null;
  const cmap = buildClusterColorMap(
    (ps && ps.cluster_assignment
      ? Math.max(1, ..._coerceArr(ps.cluster_assignment)) + 1 : 1),
    ps ? ps.cluster_colors : null,
  );
  return {
    pca_results:           ps ? (ps.pca_results || null) : null,
    candidate_label:       ps ? (ps.candidate_label || null) : null,
    anchor_label:          ps ? (ps.anchor_label || 'view_self') : 'view_self',
    sample_labels:         ps ? (ps.sample_labels || null) : null,
    cluster_assignment:    ps ? (ps.cluster_assignment || null) : null,
    cluster_colors:        cmap,
    window_meta:           ps ? (ps.window_meta || null) : null,
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (ps && ps.view_state) || {}),
    scrubber_hits:         [],
    scatter_hits:          [],
    selection:             createPcaPanelSelection(0),
    _handlers:             {},
  };
}

function _coerceArr(a) {
  if (a instanceof Int32Array || a instanceof Float64Array) return Array.from(a);
  return Array.isArray(a) ? a : [];
}

function _activePca(state) {
  if (!state || !Array.isArray(state.pca_results) || state.pca_results.length === 0) {
    return null;
  }
  let i = state.selection.getActiveWindowIdx();
  if (i == null || i < 0 || i >= state.pca_results.length) i = 0;
  return state.pca_results[i] || null;
}

function _activeMeta(state) {
  if (!state) return {};
  let i = state.selection.getActiveWindowIdx() || 0;
  const w = state.window_meta && state.window_meta[i];
  return {
    window_idx: i,
    start_bp:   w ? w.start_bp : null,
    end_bp:     w ? w.end_bp   : null,
  };
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const label = document.getElementById('pcaPanelCandidateLabel');
  if (label) label.textContent = state.candidate_label || '—';
  const badge = document.getElementById('pcaPanelAnchorBadge');
  if (badge) badge.textContent = state.anchor_label || 'view_self';
  // Reflect view-state on toolbar inputs.
  const col = document.getElementById('pcaPanelColorBy');
  if (col) col.value = state.view_state.color_by || 'cluster';
  const ax = document.getElementById('pcaPanelAxisChoice');
  if (ax) ax.value = state.view_state.axis_choice || 'pc1_pc2';
  const lab = document.getElementById('pcaPanelShowLabels');
  if (lab) lab.checked = !!state.view_state.show_labels;
  const wLbl = document.getElementById('pcaPanelWindowLabel');
  if (wLbl) {
    const idx = state.selection.getActiveWindowIdx();
    wLbl.textContent = (idx != null && state.pca_results) ? `window ${idx}` : 'window —';
  }
}

// =====================================================================
// Scrubber paint
// =====================================================================

function _paintScrubber(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('pcaPanelScrubberCanvas');
  if (!canvas) return;
  if (!Array.isArray(state.pca_results) || state.pca_results.length === 0) {
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 24);
    }
    state.scrubber_hits = [];
    return;
  }
  const paint = paintScrubberStrip(canvas, state.pca_results, {
    active_window_idx:  state.selection.getActiveWindowIdx(),
    hovered_window_idx: state.selection.getHoveredWindowIdx(),
  });
  state.scrubber_hits = paint.window_hit_regions;
}

// =====================================================================
// Scatter paint
// =====================================================================

function _paintScatterCanvas(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('pcaPanelScatterCanvas');
  const empty  = document.getElementById('pcaPanelEmpty');
  if (!canvas) return;
  const aw = _activePca(state);
  if (!aw || !aw.pc1 || !aw.pc2) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 600);
    }
    state.scatter_hits = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const useCluster = (state.view_state.color_by !== 'none');
  const paint = paintScatter(canvas, aw, {
    axis_choice:        state.view_state.axis_choice,
    cluster_assignment: useCluster ? state.cluster_assignment : null,
    cluster_colors:     state.cluster_colors,
    sample_labels:      state.sample_labels,
    selected_samples:   state.selection.getSelectedSamples(),
    hovered_sample:     state.selection.getHoveredSample(),
    show_labels:        state.view_state.show_labels,
  });
  state.scatter_hits = paint.point_hit_regions;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('pcaPanelSelectedFields');
  if (!fields) return;
  const aw = _activePca(state);
  if (!aw) {
    fields.innerHTML = '<dt class="empty">No window selected</dt><dd>load a PCA result first</dd>';
    return;
  }
  const rows = summarisePcaResult(aw, _activeMeta(state));
  let html = '';
  for (const r of rows) html += `<dt>${r.label}</dt><dd>${r.value}</dd>`;
  const hover = state.selection.getHoveredSample();
  if (hover != null && Number.isFinite(hover) && aw.pc1 && aw.pc2) {
    const lbl = (state.sample_labels && state.sample_labels[hover]) || ('sample ' + hover);
    const cl = state.cluster_assignment && state.cluster_assignment[hover];
    const x = aw.pc1[hover], y = aw.pc2[hover];
    html += `<dt>Hover</dt><dd>${lbl}</dd>`;
    if (cl != null) html += `<dt>Cluster</dt><dd>${cl}</dd>`;
    html += `<dt>PC1, PC2</dt><dd>${Number.isFinite(x) ? x.toFixed(4) : '—'}, ${Number.isFinite(y) ? y.toFixed(4) : '—'}</dd>`;
  }
  fields.innerHTML = html;
}

function _renderClusterList(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('pcaPanelClusterListBody');
  if (!body) return;
  if (!state.cluster_assignment) {
    body.innerHTML = '<span class="empty">No cluster assignment</span>';
    return;
  }
  const sizes = clusterSizesFromAssignment(state.cluster_assignment);
  if (sizes.length === 0) {
    body.innerHTML = '<span class="empty">No clusters</span>';
    return;
  }
  let html = '';
  for (const [k, n] of sizes) {
    const color = state.cluster_colors[k] || '#888888';
    html += `<div class="pca-cluster-row" data-cluster-id="${k}">`
         +    `<span class="pca-cluster-swatch" style="background:${color}"></span>`
         +    `<span class="pca-cluster-id">cluster ${k}</span> `
         +    `<span class="pca-cluster-count">n = ${n}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

function _wireToolbar(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaintScatter = () => {
    _paintScatterCanvas(state);
    _renderClusterList(state);
  };
  const repaintAll = () => {
    _renderHeader(state);
    _paintScrubber(state);
    _paintScatterCanvas(state);
    _renderRightPanel(state);
    _renderClusterList(state);
  };

  const onColorBy = (e) => {
    state.view_state.color_by = (e && e.target && e.target.value) || 'cluster';
    repaintScatter();
  };
  const onAxisChoice = (e) => {
    state.view_state.axis_choice = (e && e.target && e.target.value) || 'pc1_pc2';
    repaintScatter();
  };
  const onShowLabels = (e) => {
    state.view_state.show_labels = !!(e && e.target && e.target.checked);
    repaintScatter();
  };
  const onScrubberMove = (ev) => {
    const c = document.getElementById('pcaPanelScrubberCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.selection.setHoveredWindowIdx(findWindowAtPixel(state.scrubber_hits, x, y));
  };
  const onScrubberClick = (ev) => {
    const c = document.getElementById('pcaPanelScrubberCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const idx = findWindowAtPixel(state.scrubber_hits, x, y);
    if (idx != null) state.selection.setActiveWindowIdx(idx);
  };
  const onScatterMove = (ev) => {
    const c = document.getElementById('pcaPanelScatterCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.selection.setHoveredSample(findPointAtPixel(state.scatter_hits, x, y));
  };
  const onScatterClick = (ev) => {
    const c = document.getElementById('pcaPanelScatterCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const idx = findPointAtPixel(state.scatter_hits, x, y);
    if (idx != null) state.selection.toggleSelectedSample(idx);
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onColorBy, onAxisChoice, onShowLabels,
    onScrubberMove, onScrubberClick,
    onScatterMove, onScatterClick,
    unsubSelection,
  };

  _addListener('pcaPanelColorBy',         'change',    onColorBy);
  _addListener('pcaPanelAxisChoice',      'change',    onAxisChoice);
  _addListener('pcaPanelShowLabels',      'change',    onShowLabels);
  _addListener('pcaPanelScrubberCanvas',  'mousemove', onScrubberMove);
  _addListener('pcaPanelScrubberCanvas',  'click',     onScrubberClick);
  _addListener('pcaPanelScatterCanvas',   'mousemove', onScatterMove);
  _addListener('pcaPanelScatterCanvas',   'click',     onScatterClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onColorBy)        _removeListener('pcaPanelColorBy',        'change',    h.onColorBy);
  if (h.onAxisChoice)     _removeListener('pcaPanelAxisChoice',     'change',    h.onAxisChoice);
  if (h.onShowLabels)     _removeListener('pcaPanelShowLabels',     'change',    h.onShowLabels);
  if (h.onScrubberMove)   _removeListener('pcaPanelScrubberCanvas', 'mousemove', h.onScrubberMove);
  if (h.onScrubberClick)  _removeListener('pcaPanelScrubberCanvas', 'click',     h.onScrubberClick);
  if (h.onScatterMove)    _removeListener('pcaPanelScatterCanvas',  'mousemove', h.onScatterMove);
  if (h.onScatterClick)   _removeListener('pcaPanelScatterCanvas',  'click',     h.onScatterClick);
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
