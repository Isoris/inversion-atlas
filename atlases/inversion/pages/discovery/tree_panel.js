// pages/discovery/tree_panel.js
// =====================================================================
// Inversion-core haplotype tree panel — atlas-side cartridge for
// HANDOFF_5.
//
// Phase 1 scope (this commit):
//   - Single sample-tree canvas (Path B-style — though atlas-side
//     trees built via NJ on distance matrices computed in browser;
//     no IQ-TREE round-trip needed)
//   - Leaves coloured by candidate-mode cluster labels
//   - Hover / click linkage with the panel's selection store
//   - ARI badge: tree clades at K=cluster_count vs cluster labels
//
// Deferred:
//   - Band-tree (Path A) side-by-side with sample tree
//   - Bootstrap support shown on internal nodes
//   - Het-mode controls (iupac / hom_only / n / random) — only
//     matters for IQ-TREE Path B, which isn't done in the browser
//   - Cross-panel hover linkage with PCA / heatmap (separate commit
//     once those panels are wired)
//
// Input contract: the page reads from
//   atlasState.inversion.tree_panel_state = {
//     tree:                  mgl_nj_tree.buildNjTree output,
//     leaf_cluster_labels:   Array<number|string> per leaf,
//     leaf_colors_by_cluster:Array<string> color per cluster id,
//     candidate_label?:      string for the header,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './tree_panel/_state.js';
import {
  layoutFromMglTree,
  paintTree,
  findLeafAtPixel,
} from './tree_panel/renderer.js';
import {
  ariBetweenTreeAndClusters,
  createTreePanelSelection,
} from './tree_panel/selection.js';
import { autoBuildTreeFromPCA } from './tree_panel/_auto_build.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  show_sample_tree:    true,
  show_band_tree:      false,
  color_by_cluster:    true,
  distance_mode:       'dxy',
});

// =====================================================================
// Public entry — refresh
// =====================================================================

/**
 * Repaint everything from current `_pageState`. Idempotent.
 */
export function refreshTreePanel(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintTreeCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderLegend(_pageState);
}

export function initTreePanelToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  // If candidate-mode workflow hasn't stuffed a tree_panel_state yet,
  // auto-build one from local-PCA dosage so the page never lands on
  // the bare "No tree loaded" empty state.
  await _seedTreePanelStateIfMissing(atlasState, registry);

  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshTreePanel(pageState); }
  catch (e) { console.warn('tree_panel.mount: refresh threw —', e); }

  try { initTreePanelToolbar(); }
  catch (e) { console.warn('tree_panel.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_tree_panel_state = pageState;
  }
}

async function _seedTreePanelStateIfMissing(atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || null;
  if (!inv) return;
  if (!registry || typeof registry.resolve !== 'function') return;
  const sh = atlasState.shared || {};
  const chrom = sh.activeChrom;
  if (!chrom) return;
  const candidate = sh.activeCandidate || inv.candidate || null;

  // Keep a candidate-mode-supplied tree as-is; only short-circuit on a
  // previously-auto-built tree if it was built for THIS chrom + candidate.
  // Otherwise a chrom switch (or candidate switch) would keep showing the
  // old tree because tree_panel_state still has a non-null `tree`.
  const prev = inv.tree_panel_state;
  if (prev && prev.tree) {
    const vs = prev.view_state || {};
    if (!vs.auto_built) return;                                  // manual / external tree — leave alone
    if (vs._chrom === chrom && vs._candidate_id === (candidate && candidate.id || null)) return;
  }

  let data;
  try {
    // resolve() may return sync (hot-tier cache hit) or a Promise — wrap.
    data = await Promise.resolve(registry.resolve('scrubber_main', { chrom }));
  } catch (e) {
    console.warn('tree_panel.mount: scrubber_main resolve failed —', e);
    return;
  }
  let auto;
  try {
    auto = autoBuildTreeFromPCA(data, candidate);
  } catch (e) {
    console.warn('tree_panel.mount: autoBuildTreeFromPCA threw —', e);
    return;
  }
  if (!auto) return;
  inv.tree_panel_state = {
    tree:                   auto.tree,
    leaf_cluster_labels:    auto.leaf_cluster_labels,
    leaf_colors_by_cluster: auto.leaf_colors_by_cluster,
    candidate_label:        auto.candidate_label,
    view_state: {
      auto_built:    true,
      l2idx:         auto.l2idx,
      _chrom:        chrom,
      _candidate_id: candidate && candidate.id || null,
    },
  };
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('tree_panel.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const tp = inv.tree_panel_state || null;
  return {
    tree:                  tp ? tp.tree : null,
    leaf_cluster_labels:   tp ? tp.leaf_cluster_labels : null,
    leaf_colors_by_cluster:tp ? tp.leaf_colors_by_cluster : null,
    candidate_label:       tp ? (tp.candidate_label || null) : null,
    layout:                null,
    hit_regions:           [],
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (tp && tp.view_state) || {}),
    selection:             createTreePanelSelection(),
    _handlers:             {},
  };
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const label = document.getElementById('treePanelCandidateLabel');
  if (label) label.textContent = state.candidate_label || '—';
  // ARI badge.
  const badge = document.getElementById('treePanelARIBadge');
  if (badge) {
    if (state.tree && Array.isArray(state.leaf_cluster_labels)) {
      const distinct = new Set(state.leaf_cluster_labels).size;
      const K = Math.max(2, Math.min(6, distinct || 2));
      const ari = ariBetweenTreeAndClusters(state.tree, state.leaf_cluster_labels, K);
      badge.textContent = Number.isFinite(ari.ari)
        ? `ARI(tree, clusters): ${ari.ari.toFixed(3)} · n=${ari.n_leaves}`
        : '—';
    } else {
      badge.textContent = '—';
    }
  }
}

// =====================================================================
// Tree paint
// =====================================================================

// 2026-05-20: size the canvas to its CSS box × DPR before paintTree
// runs. Without this the canvas stayed at its 300×150 default backing-
// store and the browser stretch-scaled it up to fill the layout box,
// rendering text and dots ~3-4× their intended size (Quentin's report:
// "our tree has its text a bit strange"). The renderer uses
// `canvas.width`/`.height` directly for its draw coords, so we also
// apply `ctx.setTransform(dpr, …)` so the renderer can keep operating
// in CSS-px terms — coords drawn at e.g. (300, 200) land at the right
// place on a 2× display instead of in the upper-left quadrant.
function _fitTreeCanvas(canvas) {
  if (!canvas || !canvas.getContext) return null;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = Math.max(1, canvas.clientWidth  | 0);
  const cssH = Math.max(1, canvas.clientHeight | 0);
  const targetW = Math.max(1, (cssW * dpr) | 0);
  const targetH = Math.max(1, (cssH * dpr) | 0);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width  = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Stash CSS dims so paintTree can read them via canvas.__cssW/H
  // instead of the backing-store canvas.width/.height.
  canvas.__cssW = cssW;
  canvas.__cssH = cssH;
  return { dpr, cssW, cssH, ctx };
}

function _paintTreeCanvas(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('treePanelCanvas');
  const empty  = document.getElementById('treePanelEmpty');
  if (!canvas) return;
  if (!state.tree) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 1000, canvas.height || 400);
    }
    state.layout = null;
    state.hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  // Build layout once; cache on state.
  if (!state.layout) {
    state.layout = layoutFromMglTree(state.tree, { cladogram: true });
  }
  // 2026-05-20: fit canvas to CSS box × DPR before painting. paintTree
  // (renderer.js) was updated to honor canvas.__cssW / __cssH when
  // present (falls back to canvas.width / .height otherwise) — we
  // stash CSS dims so the renderer's scale math runs in CSS px while
  // the backing store stays at DPR for crisp pixels.
  _fitTreeCanvas(canvas);
  // Map leaf_id → colour.
  const leaf_colors_by_id = _buildLeafColorMap(state);
  const paint = paintTree(canvas, state.layout, {
    leaf_colors_by_id,
    highlighted_leaf_id: state.selection.getHovered(),
    show_labels:         true,
  });
  state.hit_regions = paint.leaf_hit_regions;
}

function _buildLeafColorMap(state) {
  const out = Object.create(null);
  if (!state.layout || !state.view_state.color_by_cluster) return out;
  if (!Array.isArray(state.leaf_cluster_labels)) return out;
  const colors = state.leaf_colors_by_cluster
    || ['#3074C8', '#2BAA50', '#D04545', '#A060B8', '#D8A030', '#3DB5C0'];
  // Each leaf in the layout has an id; the mgl_nj_tree builder labels
  // leaves '0', '1', ... unless the caller passed names. Map by index.
  for (let i = 0; i < state.layout.leaves.length; i++) {
    const lf = state.layout.leaves[i];
    const cl = state.leaf_cluster_labels[parseInt(lf.id, 10) | 0];
    if (cl == null) continue;
    out[lf.id] = colors[(typeof cl === 'number' ? cl : 0) % colors.length];
  }
  return out;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('treePanelSelectedFields');
  if (!fields) return;
  const hover = state.selection.getHovered();
  if (!hover) {
    fields.innerHTML = '<dt class="empty">No leaf selected</dt><dd>hover or click in the tree</dd>';
    return;
  }
  const leafIdx = parseInt(hover, 10) | 0;
  const cl = Array.isArray(state.leaf_cluster_labels)
    ? state.leaf_cluster_labels[leafIdx]
    : null;
  const selected = state.selection.getSelected().has(hover);
  let html = '';
  html += `<dt>Leaf ID</dt><dd>${hover}</dd>`;
  html += `<dt>Cluster</dt><dd>${cl == null ? '—' : cl}</dd>`;
  html += `<dt>Selected</dt><dd>${selected ? 'yes' : 'no'}</dd>`;
  fields.innerHTML = html;
}

function _renderLegend(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('treePanelLegendBody');
  if (!body) return;
  if (!state.view_state.color_by_cluster || !Array.isArray(state.leaf_cluster_labels)) {
    body.innerHTML = '<span>—</span>';
    return;
  }
  const distinct = Array.from(new Set(state.leaf_cluster_labels))
    .filter(v => v != null)
    .sort((a, b) => (typeof a === typeof b ? (a < b ? -1 : 1) : 0));
  const colors = state.leaf_colors_by_cluster
    || ['#3074C8', '#2BAA50', '#D04545', '#A060B8', '#D8A030', '#3DB5C0'];
  let html = '';
  for (const cl of distinct) {
    const c = colors[(typeof cl === 'number' ? cl : 0) % colors.length];
    html += `<span class="tree-legend-swatch" style="background:${c}"></span>${cl} `;
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

  const repaint = () => { state.layout = null; _paintTreeCanvas(state); _renderLegend(state); };

  const onShowSampleTree = (e) => {
    state.view_state.show_sample_tree = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowBandTree = (e) => {
    state.view_state.show_band_tree = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onColorByCluster = (e) => {
    state.view_state.color_by_cluster = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onDistanceMode = (e) => {
    state.view_state.distance_mode = (e && e.target && e.target.value) || 'dxy';
    repaint();
  };
  const onCanvasMove = (ev) => {
    const canvas = document.getElementById('treePanelCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const id = findLeafAtPixel(state.hit_regions, x, y);
    state.selection.setHovered(id);
  };
  const onCanvasClick = (ev) => {
    const canvas = document.getElementById('treePanelCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const id = findLeafAtPixel(state.hit_regions, x, y);
    if (id) state.selection.toggleSelected(id);
  };

  // Subscribe the renderer to selection changes so hover / click
  // updates the canvas + right panel.
  const unsubSelection = state.selection.subscribe(() => {
    _paintTreeCanvas(state);
    _renderRightPanel(state);
  });

  state._handlers = {
    onShowSampleTree, onShowBandTree, onColorByCluster, onDistanceMode,
    onCanvasMove, onCanvasClick, unsubSelection,
  };

  _addListener('treePanelShowSampleTree',  'change', onShowSampleTree);
  _addListener('treePanelShowBandTree',    'change', onShowBandTree);
  _addListener('treePanelColorByCluster',  'change', onColorByCluster);
  _addListener('treePanelDistanceMode',    'change', onDistanceMode);
  _addListener('treePanelCanvas',          'mousemove', onCanvasMove);
  _addListener('treePanelCanvas',          'click',     onCanvasClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onShowSampleTree)  _removeListener('treePanelShowSampleTree',  'change',    h.onShowSampleTree);
  if (h.onShowBandTree)    _removeListener('treePanelShowBandTree',    'change',    h.onShowBandTree);
  if (h.onColorByCluster)  _removeListener('treePanelColorByCluster',  'change',    h.onColorByCluster);
  if (h.onDistanceMode)    _removeListener('treePanelDistanceMode',    'change',    h.onDistanceMode);
  if (h.onCanvasMove)      _removeListener('treePanelCanvas',          'mousemove', h.onCanvasMove);
  if (h.onCanvasClick)     _removeListener('treePanelCanvas',          'click',     h.onCanvasClick);
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
