// pages/discovery/pca_scatter_per_window.js
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

import { _pageState, _setActiveState } from './pca_scatter_per_window/_state.js';
import {
  paintScrubberStrip,
  paintScatter,
  findWindowAtPixel,
  findPointAtPixel,
  findPointsInBox,
  buildClusterColorMap,
} from './pca_scatter_per_window/renderer.js';
import {
  createPcaPanelSelection,
  summarisePcaResult,
  clusterSizesFromAssignment,
} from './pca_scatter_per_window/selection.js';
import { pcaCacheKey } from '../../shared/mgl_candidate_mode.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  color_by:     'cluster',
  axis_choice:  'pc1_pc2',
  show_labels:  false,
});

// SPEC_0 §10 canonical variant axes. The panel will surface only the
// options actually present in pca_variants; these arrays drive the
// dropdown order.
const PCA_VIEW_OPTIONS = Object.freeze([
  'all_pairs', 'hom1_vs_hom2', 'hom1_vs_het', 'hom2_vs_het',
]);
const PCA_WEIGHTING_OPTIONS = Object.freeze(['weighted', 'unweighted']);
const PCA_ANCHOR_OPTIONS    = Object.freeze(['bi_baseline', 'view_self', 'none', 'both']);

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
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshPcaPanel(pageState); }
  catch (e) { console.warn('pca_scatter_per_window.mount: refresh threw —', e); }

  try { initPcaPanelToolbar(); }
  catch (e) { console.warn('pca_scatter_per_window.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_pca_scatter_per_window_state = pageState;
  }

  // 2026-05-20: auto-build pca_panel_state from the local_pca_dosage
  // stash on direct mount. The page expects a pre-computed pca_results[]
  // array, but the data already lives on state.data.windows[w].{pc1,pc2,
  // lam1,lam2} — no compute kernel needed, just adaptation.
  if (!pageState.data || !pageState.data.pca_results) {
    try {
      await _autoBuildPcaPanelState(atlasState, registry);
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshPcaPanel(pageState); }
      catch (e) { console.warn('pca_scatter_per_window.mount: post-autobuild refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_pca_scatter_per_window_state = pageState;
      }
    } catch (e) {
      console.warn('pca_scatter_per_window.mount: auto-build failed:', e);
    }
  }
}

// Build a pca_panel_state envelope. 2026-05-20: falls back to a fresh
// registry.resolve('scrubber_main') when the local_pca_dosage stash isn't
// populated yet — so this page works as a first-mount destination
// (user opens it directly from the tab bar without visiting local_pca_dosage
// first).
async function _autoBuildPcaPanelState(atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.pca_panel_state || {};
  if (existing.pca_results) return;
  const stash = inv._local_pca_dosage_state;
  let data = (stash && stash.data) || null;
  if (!data && registry) {
    const chrom = atlasState.shared && atlasState.shared.activeChrom;
    if (chrom) {
      try { data = await registry.resolve('scrubber_main', { chrom }); }
      catch (e) {
        console.warn('pca_scatter_per_window: scrubber_main resolve threw —', e);
        return;
      }
    }
  }
  if (!data || !Array.isArray(data.windows)) return;
  const wins = data.windows;
  const n = wins.length;
  const pca_results = new Array(n);
  const window_meta = new Array(n);
  for (let i = 0; i < n; i++) {
    const w = wins[i];
    if (!w || !w.pc1 || !w.pc2) {
      pca_results[i] = null;
      window_meta[i] = { idx: i, start_bp: w && w.start_bp, end_bp: w && w.end_bp };
      continue;
    }
    pca_results[i] = {
      pc1:  w.pc1,
      pc2:  w.pc2,
      lam1: Number.isFinite(w.lam1) ? w.lam1 : null,
      lam2: Number.isFinite(w.lam2) ? w.lam2 : null,
      n_samples: data.n_samples | 0,
    };
    window_meta[i] = {
      idx:      Number.isFinite(w.idx) ? w.idx : i,
      start_bp: Number.isFinite(w.start_bp) ? w.start_bp : null,
      end_bp:   Number.isFinite(w.end_bp)   ? w.end_bp   : null,
    };
  }
  // Sample labels from data.samples[].cga / .id / fallback.
  let sample_labels = null;
  if (Array.isArray(data.samples) && data.samples.length === data.n_samples) {
    sample_labels = data.samples.map((s, i) =>
      (s && (s.cga || s.id || s.ind || s.sample)) || ('S' + i)
    );
  }
  // Cluster assignment from the cursor's L2 (best-effort — null if the
  // cluster module isn't reachable from here, which is fine; the page
  // renders without cluster coloring). Both `stash` and its `cur`/`windowToL2`
  // are null when the user opens this page before local_pca_dosage has
  // mounted (data came from registry.resolve fallback above).
  let cluster_assignment = null;
  const cur = (stash && Number.isFinite(stash.cur)) ? (stash.cur | 0) : 0;
  if (stash && stash.windowToL2 && stash.windowToL2[cur] >= 0
      && typeof window !== 'undefined') {
    try {
      // _state.js exposes getL2Cluster via the inversion stash's helpers
      // — but the chain through getOrCompute isn't exported clean. We
      // skip cluster pre-seeding and let the page render without it.
      // The user can color-by-cluster from the toolbar once the page
      // is up; the inv._local_pca_dosage_state stash is still queryable.
    } catch (_) { /* no-op */ }
  }
  inv.pca_panel_state = Object.assign({}, existing, {
    pca_results,
    candidate_label:    existing.candidate_label   || (data.chrom || null),
    anchor_label:       existing.anchor_label      || 'view_self',
    sample_labels,
    cluster_assignment,
    window_meta,
  });
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('pca_scatter_per_window.unmount: teardown threw —', e); }
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
  const variants = (ps && ps.pca_variants && typeof ps.pca_variants === 'object')
    ? ps.pca_variants : null;
  const variantKeys = variants ? Object.keys(variants) : [];
  const variant = (ps && ps.variant) ? _normaliseVariantChoice(ps.variant)
    : (variantKeys.length > 0 ? _parseVariantKey(variantKeys[0]) : null);
  const initialResults = variants && variant
    ? (variants[pcaCacheKey(variant.view, variant.weighting, variant.anchor)] || null)
    : (ps && ps.pca_results) || null;
  return {
    pca_variants:          variants,
    variant:               variant,
    pca_results:           initialResults,
    candidate_label:       ps ? (ps.candidate_label || null) : null,
    anchor_label:          ps ? (ps.anchor_label || null)
                              : (variant ? _variantLabel(variant) : 'view_self'),
    sample_labels:         ps ? (ps.sample_labels || null) : null,
    cluster_assignment:    ps ? (ps.cluster_assignment || null) : null,
    cluster_colors:        cmap,
    window_meta:           ps ? (ps.window_meta || null) : null,
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (ps && ps.view_state) || {}),
    scrubber_hits:         [],
    scatter_hits:          [],
    drag_box:              null,  // { x0, y0, x1, y1 } while dragging
    selection:             createPcaPanelSelection(0),
    _handlers:             {},
  };
}

function _normaliseVariantChoice(v) {
  if (!v) return null;
  return {
    view:      v.view      || 'all_pairs',
    weighting: v.weighting || 'weighted',
    anchor:    v.anchor    || 'view_self',
  };
}

function _parseVariantKey(k) {
  if (typeof k !== 'string') return null;
  const parts = k.split('|');
  if (parts.length !== 3) return null;
  return { view: parts[0], weighting: parts[1], anchor: parts[2] };
}

function _variantLabel(v) {
  if (!v) return '—';
  return `${v.view} · ${v.weighting} · ${v.anchor}`;
}

function _availableAxesFromVariants(variants) {
  const out = { views: new Set(), weightings: new Set(), anchors: new Set() };
  if (!variants) return out;
  for (const k of Object.keys(variants)) {
    const p = _parseVariantKey(k);
    if (!p) continue;
    out.views.add(p.view);
    out.weightings.add(p.weighting);
    out.anchors.add(p.anchor);
  }
  return out;
}

function _filterPresent(canonical, present) {
  const out = [];
  for (const v of canonical) if (present.has(v)) out.push(v);
  for (const v of present) if (!canonical.includes(v)) out.push(v);
  return out;
}

function _resolveVariantResults(state, variant) {
  if (!state || !state.pca_variants || !variant) return null;
  return state.pca_variants[
    pcaCacheKey(variant.view, variant.weighting, variant.anchor)
  ] || null;
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
  if (badge) {
    badge.textContent = state.anchor_label
      || (state.variant ? _variantLabel(state.variant) : '—');
  }
  // Populate variant pickers from the keys present in pca_variants.
  _populateVariantPickers(state);
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

function _populateVariantPickers(state) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const variants = state.pca_variants;
  const variant  = state.variant;
  const vPick = document.getElementById('pcaPanelViewPicker');
  const wPick = document.getElementById('pcaPanelWeightingPicker');
  const aPick = document.getElementById('pcaPanelAnchorPicker');
  if (!variants || Object.keys(variants).length === 0) {
    // No variants supplied — hide pickers (single-variant mode).
    if (vPick) vPick.style.display = 'none';
    if (wPick) wPick.style.display = 'none';
    if (aPick) aPick.style.display = 'none';
    return;
  }
  const axes = _availableAxesFromVariants(variants);
  const views      = _filterPresent(PCA_VIEW_OPTIONS,      axes.views);
  const weightings = _filterPresent(PCA_WEIGHTING_OPTIONS, axes.weightings);
  const anchors    = _filterPresent(PCA_ANCHOR_OPTIONS,    axes.anchors);
  _renderOptions(vPick, views,      variant ? variant.view      : null);
  _renderOptions(wPick, weightings, variant ? variant.weighting : null);
  _renderOptions(aPick, anchors,    variant ? variant.anchor    : null);
  if (vPick) vPick.style.display = '';
  if (wPick) wPick.style.display = '';
  if (aPick) aPick.style.display = '';
}

function _renderOptions(select, values, active) {
  if (!select || !Array.isArray(values)) return;
  // Build a string of <option> elements — using innerHTML keeps the
  // logic small even under the fake-DOM smoke (no createElement
  // needed).
  let html = '';
  for (const v of values) {
    const sel = (v === active) ? ' selected' : '';
    html += `<option value="${v}"${sel}>${v}</option>`;
  }
  select.innerHTML = html;
  if (active != null && 'value' in select) select.value = String(active);
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
    drag_box:           state.drag_box,
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

  const _setVariantAxis = (axis, value) => {
    if (!state.variant) state.variant = { view: 'all_pairs', weighting: 'weighted', anchor: 'view_self' };
    state.variant[axis] = value;
    const r = _resolveVariantResults(state, state.variant);
    if (r) {
      state.pca_results = r;
      // Keep the active window in-range for the new results.
      const idx = state.selection.getActiveWindowIdx();
      if (!(Number.isFinite(idx) && idx >= 0 && idx < r.length)) {
        state.selection.setActiveWindowIdx(0);
      }
    } else {
      state.pca_results = null;
    }
    state.anchor_label = _variantLabel(state.variant);
    repaintAll();
  };
  const onViewPick      = (e) => _setVariantAxis('view',      (e && e.target && e.target.value) || 'all_pairs');
  const onWeightingPick = (e) => _setVariantAxis('weighting', (e && e.target && e.target.value) || 'weighted');
  const onAnchorPick    = (e) => _setVariantAxis('anchor',    (e && e.target && e.target.value) || 'view_self');

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
  const _scatterPx = (ev) => {
    const c = document.getElementById('pcaPanelScatterCanvas');
    if (!c) return null;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: ((ev && ev.clientX) || 0) - (rect.left || 0),
      y: ((ev && ev.clientY) || 0) - (rect.top  || 0),
    };
  };
  const onScatterMove = (ev) => {
    const px = _scatterPx(ev);
    if (!px) return;
    if (state.drag_box) {
      // Update the drag box while a drag is in progress.
      state.drag_box.x1 = px.x;
      state.drag_box.y1 = px.y;
      // Hover suppressed during drag.
      state.selection.setHoveredSample(null);
      _paintScatterCanvas(state);
      return;
    }
    state.selection.setHoveredSample(findPointAtPixel(state.scatter_hits, px.x, px.y));
  };
  const onScatterDown = (ev) => {
    const px = _scatterPx(ev);
    if (!px) return;
    // If the click landed on a point, leave drag for click toggle.
    if (findPointAtPixel(state.scatter_hits, px.x, px.y) != null) return;
    state.drag_box = { x0: px.x, y0: px.y, x1: px.x, y1: px.y, shift: !!(ev && ev.shiftKey) };
    _paintScatterCanvas(state);
  };
  const onScatterUp = (ev) => {
    if (!state.drag_box) return;
    const px = _scatterPx(ev);
    if (px) { state.drag_box.x1 = px.x; state.drag_box.y1 = px.y; }
    const dx = Math.abs(state.drag_box.x1 - state.drag_box.x0);
    const dy = Math.abs(state.drag_box.y1 - state.drag_box.y0);
    // Only commit as a box-select if the drag is non-trivial (> 4 px
    // each side). Smaller drags fall through to the click handler.
    if (dx > 4 && dy > 4) {
      const inside = findPointsInBox(state.scatter_hits, state.drag_box);
      if (!state.drag_box.shift) state.selection.clearSelection();
      for (const i of inside) {
        if (!state.selection.getSelectedSamples().has(i)) {
          state.selection.toggleSelectedSample(i);
        }
      }
    }
    state.drag_box = null;
    _paintScatterCanvas(state);
  };
  const onScatterClick = (ev) => {
    // Click handler suppressed when a box-select just fired (the
    // mouseup cleared drag_box; if the drag was meaningful we'd have
    // run the box-select logic already, so plain clicks land here).
    const px = _scatterPx(ev);
    if (!px) return;
    const idx = findPointAtPixel(state.scatter_hits, px.x, px.y);
    if (idx != null) state.selection.toggleSelectedSample(idx);
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onViewPick, onWeightingPick, onAnchorPick,
    onColorBy, onAxisChoice, onShowLabels,
    onScrubberMove, onScrubberClick,
    onScatterMove, onScatterClick,
    onScatterDown, onScatterUp,
    unsubSelection,
  };

  _addListener('pcaPanelViewPicker',      'change',    onViewPick);
  _addListener('pcaPanelWeightingPicker', 'change',    onWeightingPick);
  _addListener('pcaPanelAnchorPicker',    'change',    onAnchorPick);
  _addListener('pcaPanelColorBy',         'change',    onColorBy);
  _addListener('pcaPanelAxisChoice',      'change',    onAxisChoice);
  _addListener('pcaPanelShowLabels',      'change',    onShowLabels);
  _addListener('pcaPanelScrubberCanvas',  'mousemove', onScrubberMove);
  _addListener('pcaPanelScrubberCanvas',  'click',     onScrubberClick);
  _addListener('pcaPanelScatterCanvas',   'mousedown', onScatterDown);
  _addListener('pcaPanelScatterCanvas',   'mousemove', onScatterMove);
  _addListener('pcaPanelScatterCanvas',   'mouseup',   onScatterUp);
  _addListener('pcaPanelScatterCanvas',   'click',     onScatterClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onViewPick)       _removeListener('pcaPanelViewPicker',     'change',    h.onViewPick);
  if (h.onWeightingPick)  _removeListener('pcaPanelWeightingPicker','change',    h.onWeightingPick);
  if (h.onAnchorPick)     _removeListener('pcaPanelAnchorPicker',   'change',    h.onAnchorPick);
  if (h.onColorBy)        _removeListener('pcaPanelColorBy',        'change',    h.onColorBy);
  if (h.onAxisChoice)     _removeListener('pcaPanelAxisChoice',     'change',    h.onAxisChoice);
  if (h.onShowLabels)     _removeListener('pcaPanelShowLabels',     'change',    h.onShowLabels);
  if (h.onScrubberMove)   _removeListener('pcaPanelScrubberCanvas', 'mousemove', h.onScrubberMove);
  if (h.onScrubberClick)  _removeListener('pcaPanelScrubberCanvas', 'click',     h.onScrubberClick);
  if (h.onScatterDown)    _removeListener('pcaPanelScatterCanvas',  'mousedown', h.onScatterDown);
  if (h.onScatterMove)    _removeListener('pcaPanelScatterCanvas',  'mousemove', h.onScatterMove);
  if (h.onScatterUp)      _removeListener('pcaPanelScatterCanvas',  'mouseup',   h.onScatterUp);
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
