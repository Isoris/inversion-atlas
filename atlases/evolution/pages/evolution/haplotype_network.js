// pages/evolution/haplotype_network.js
// =====================================================================
// INV haplotype-network cartridge. Reuses shared/mgl_haplotype_network
// to cluster INV chromosomes by Hamming radius and lay out a minimum
// spanning tree between cluster representatives.
//
// Input contract:
//   atlasState.inversion.haplotype_network_state = {
//     dosage:           Float64Array | Array<Float64Array|number[]>,
//     n_markers, n_samples,
//     inv_idx:          number[],
//     sample_labels?:   string[],
//     candidate_label?: string,
//     view_state?:      { hamming_radius?, layout_seed?, show_labels? },
//   }
// =====================================================================

import { _pageState, _setActiveState }
  from './haplotype_network/_state.js';
import { buildHaplotypeNetwork } from '../../shared/mgl_haplotype_network.js';
import {
  paintHaplotypeNetwork,
  findNodeAtPixel,
  nodeColor,
} from './haplotype_network/renderer.js';
import {
  createHapNetSelection,
  summariseNode,
  summariseNetwork,
} from './haplotype_network/selection.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import { autoSeedInvIdx, chromDosageMatrix } from '../../shared/auto_seed_inv_idx.js';
import { attachAutoSeedBadge, detachAutoSeedBadge } from '../../shared/auto_seed_badge.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  hamming_radius:  2,
  layout_seed:     12345,
  show_labels:     false,
  layout_width:    640,
  layout_height:   360,
});

const STORAGE_KEY = 'evolution.haplotype_network.view_state';

function _loadPersistedViewState() {
  try {
    const raw = (typeof localStorage !== 'undefined')
      ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const p = JSON.parse(raw);
    return (p && typeof p === 'object') ? p : {};
  } catch (_) { return {}; }
}
function _persistViewState(vs) {
  try {
    if (typeof localStorage === 'undefined') return;
    const subset = {
      hamming_radius: vs.hamming_radius,
      layout_seed:    vs.layout_seed,
      show_labels:    vs.show_labels,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subset));
  } catch (_) {}
}

// =====================================================================
// Public entry
// =====================================================================

export function refreshHapNet(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderEdgeList(_pageState);
  _renderNodeList(_pageState);
}

export function initHapNetToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  // Opportunistically seed haplotype_network_state from upstream data
  // if it hasn't been set by an external caller. Median-PC1 split at
  // the active candidate's window range — see auto_seed_inv_idx.js.
  _autoSeedIfMissing(atlasState);

  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshHapNet(pageState); }
  catch (e) { console.warn('haplotype_network.mount: refresh threw —', e); }
  try { initHapNetToolbar(); }
  catch (e) { console.warn('haplotype_network.mount: toolbar threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_haplotype_network_state = pageState;
  }
}

function _autoSeedIfMissing(atlasState) {
  const inv = atlasState && atlasState.inversion;
  if (!inv) return;
  if (inv.haplotype_network_state && inv.haplotype_network_state.dosage) return;
  const seed = autoSeedInvIdx(atlasState);
  if (!seed) return;
  const dosage = chromDosageMatrix(seed.chrom_data);
  if (!dosage) return;
  inv.haplotype_network_state = {
    dosage:          dosage.values,
    n_markers:       dosage.n_markers,
    n_samples:       dosage.n_samples,
    inv_idx:         Array.from(seed.inv_idx),
    sample_labels:   seed.sample_labels,
    candidate_label: seed.candidate_label,
    view_state:      _loadPersistedViewState(),
    _auto_seeded:    true,
  };
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('haplotype_network.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  // Empty-state panel re-renders on each mount.
  resetOnboarding('haplotype_network');
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.haplotype_network_state || null;
  const vs = Object.assign({}, DEFAULT_VIEW_STATE,
                           _loadPersistedViewState(),
                           (src && src.view_state) || {});
  const network = (src && src.dosage && Array.isArray(src.inv_idx))
    ? buildHaplotypeNetwork({
        dosage: src.dosage, n_markers: src.n_markers, n_samples: src.n_samples,
        inv_idx: src.inv_idx,
        opts: {
          hamming_radius: vs.hamming_radius,
          layout_width:   vs.layout_width,
          layout_height:  vs.layout_height,
          layout_seed:    vs.layout_seed,
        },
      })
    : { nodes: [], edges: [], sample_labels: new Int32Array(0),
        carrier_matrix: new Uint8Array(0),
        inter_distance: new Float64Array(0),
        pair_distance: new Float64Array(0) };
  return {
    source:           src,
    candidate_label:  src ? (src.candidate_label || null) : null,
    network,
    node_hit_regions: [],
    view_state:       vs,
    selection:        createHapNetSelection(),
    _handlers:        {},
  };
}

function _rebuildNetwork(state) {
  if (!state || !state.source) {
    state.network = { nodes: [], edges: [], sample_labels: new Int32Array(0),
                      carrier_matrix: new Uint8Array(0),
                      inter_distance: new Float64Array(0),
                      pair_distance: new Float64Array(0) };
    return;
  }
  const s = state.source;
  state.network = buildHaplotypeNetwork({
    dosage: s.dosage, n_markers: s.n_markers, n_samples: s.n_samples,
    inv_idx: s.inv_idx,
    opts: {
      hamming_radius: state.view_state.hamming_radius,
      layout_width:   state.view_state.layout_width,
      layout_height:  state.view_state.layout_height,
      layout_seed:    state.view_state.layout_seed,
    },
  });
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('hapNetCandidateLabel');
  if (lbl) {
    lbl.textContent = state.candidate_label || '—';
    if (state.source && state.source._auto_seeded) attachAutoSeedBadge(lbl);
    else                                           detachAutoSeedBadge(lbl);
  }
  const sb = document.getElementById('hapNetSummaryBadge');
  if (sb) sb.textContent = summariseNetwork(state.network);
  const hr = document.getElementById('hapNetHammingRadius');
  if (hr) hr.value = state.view_state.hamming_radius;
  const ls = document.getElementById('hapNetLayoutSeed');
  if (ls) ls.value = state.view_state.layout_seed;
  const sl = document.getElementById('hapNetShowLabels');
  if (sl) sl.checked = !!state.view_state.show_labels;
}

// =====================================================================
// Canvas paint
// =====================================================================

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('hapNetCanvas');
  const empty  = document.getElementById('hapNetEmpty');
  if (!canvas) return;
  const network = state.network;
  if (!network || !network.nodes || network.nodes.length === 0) {
    if (empty) {
      empty.style.display = '';
      applyOnboarding('haplotype_network');
    }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 400);
    }
    state.node_hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const paint = paintHaplotypeNetwork(canvas, network, {
    hovered_node:    state.selection.getHoveredNode(),
    selected_nodes:  state.selection.getSelectedNodes(),
    show_labels:     state.view_state.show_labels,
  });
  state.node_hit_regions = paint.node_hit_regions;
}


// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('hapNetSelectedFields');
  if (!fields) return;
  const hovered = state.selection.getHoveredNode();
  const node = (hovered != null && state.network.nodes)
    ? state.network.nodes[hovered] : null;
  let html = '';
  for (const row of summariseNode(node, state.network)) {
    html += `<dt>${row.label}</dt><dd>${row.value}</dd>`;
  }
  fields.innerHTML = html;
}

function _renderEdgeList(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('hapNetEdgeBody');
  if (!body) return;
  const edges = state.network ? state.network.edges : [];
  if (!Array.isArray(edges) || edges.length === 0) {
    body.innerHTML = '<span class="empty">No edges</span>';
    return;
  }
  let html = '';
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    html += `<div class="hnet-edge-row">`
         +    `<span class="hnet-edge-id">${e.a} → ${e.b}</span>`
         +    `<span class="hnet-edge-dist">d = ${e.dist.toFixed(1)}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}

function _renderNodeList(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('hapNetNodeBody');
  if (!body) return;
  const nodes = state.network ? state.network.nodes : [];
  if (!Array.isArray(nodes) || nodes.length === 0) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  let html = '';
  for (const n of nodes) {
    const c = nodeColor(n.id);
    html += `<div class="hnet-node-row" data-node-id="${n.id}">`
         +    `<span class="hnet-node-swatch" style="background:${c}"></span>`
         +    `<span class="hnet-node-id">node ${n.id}</span> `
         +    `<span class="hnet-node-count">n = ${n.size}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

function _wireToolbar(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaintAll = () => {
    _renderHeader(state);
    _paintCanvas(state);
    _renderRightPanel(state);
    _renderEdgeList(state);
    _renderNodeList(state);
  };

  const onRadiusChange = (e) => {
    const v = parseInt(e && e.target && e.target.value, 10);
    if (Number.isFinite(v) && v >= 0 && v <= 20) {
      state.view_state.hamming_radius = v;
      _persistViewState(state.view_state);
      _rebuildNetwork(state);
      repaintAll();
    }
  };
  const onSeedChange = (e) => {
    const v = parseInt(e && e.target && e.target.value, 10);
    if (Number.isFinite(v) && v >= 1) {
      state.view_state.layout_seed = v;
      _persistViewState(state.view_state);
      _rebuildNetwork(state);
      repaintAll();
    }
  };
  const onShowLabels = (e) => {
    state.view_state.show_labels = !!(e && e.target && e.target.checked);
    _persistViewState(state.view_state);
    _paintCanvas(state);
  };
  const onRecompute = () => {
    _rebuildNetwork(state);
    repaintAll();
  };
  const onReseed = () => {
    // Cycle to a new layout seed — keeps the user from typing a number.
    const next = (Math.floor(Math.random() * 99000) + 1000) | 0;
    state.view_state.layout_seed = next;
    _persistViewState(state.view_state);
    const inp = document.getElementById('hapNetLayoutSeed');
    if (inp) inp.value = next;
    _rebuildNetwork(state);
    repaintAll();
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('hapNetCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.selection.setHoveredNode(findNodeAtPixel(state.node_hit_regions, x, y));
  };
  const onCanvasClick = (ev) => {
    const c = document.getElementById('hapNetCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const id = findNodeAtPixel(state.node_hit_regions, x, y);
    if (id != null) state.selection.toggleSelectedNode(id);
  };

  const unsub = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onRadiusChange, onSeedChange, onShowLabels,
    onRecompute, onReseed,
    onCanvasMove, onCanvasClick, unsub,
  };
  _addListener('hapNetHammingRadius', 'change',    onRadiusChange);
  _addListener('hapNetLayoutSeed',    'change',    onSeedChange);
  _addListener('hapNetShowLabels',    'change',    onShowLabels);
  _addListener('hapNetRecompute',     'click',     onRecompute);
  _addListener('hapNetReseed',        'click',     onReseed);
  _addListener('hapNetCanvas',        'mousemove', onCanvasMove);
  _addListener('hapNetCanvas',        'click',     onCanvasClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onRadiusChange) _removeListener('hapNetHammingRadius', 'change',    h.onRadiusChange);
  if (h.onSeedChange)   _removeListener('hapNetLayoutSeed',    'change',    h.onSeedChange);
  if (h.onShowLabels)   _removeListener('hapNetShowLabels',    'change',    h.onShowLabels);
  if (h.onRecompute)    _removeListener('hapNetRecompute',     'click',     h.onRecompute);
  if (h.onReseed)       _removeListener('hapNetReseed',        'click',     h.onReseed);
  if (h.onCanvasMove)   _removeListener('hapNetCanvas',        'mousemove', h.onCanvasMove);
  if (h.onCanvasClick)  _removeListener('hapNetCanvas',        'click',     h.onCanvasClick);
  if (typeof h.unsub === 'function') { try { h.unsub(); } catch (_) {} }
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
