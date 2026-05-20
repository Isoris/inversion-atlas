// pages/discovery/similarity_matrix.js
// =====================================================================
// Per-window similarity-matrix panel — atlas-side cartridge for
// HANDOFF_10 / SPEC_0 §11.9.
//
// Phase 1 scope (this commit):
//   - Transition strip across windows + ARI gap row
//   - Scrubbable: click a window cell to load its similarity matrix
//   - Per-window similarity heatmap (n_samples × n_samples)
//   - Block-overlay outlines (toggle)
//   - Diagonal hide/show (toggle)
//   - Sample order: natural | by_block
//   - Hover-cell crosshair + right-panel detail
//   - Click matrix cell → toggle sample in selection set
//
// Deferred:
//   - Sample labels on row / column axes (needs full-page redesign for
//     large n)
//   - Multi-metric switcher in-panel (pearson/l1/l2) — currently the
//     metric is fixed at load time upstream
//   - Cross-panel linkage with tree / fingerprint / PCA — separate
//     commit
//
// Input contract: the page reads from
//   atlasState.inversion.similarity_panel_state = {
//     similarity_result:    shared/mgl_similarity_matrix
//                             .computeSimilarityAndBlocks output,
//     candidate_label?:     string,
//     metric_label?:        string  e.g. 'pearson' (header badge),
//     sample_labels?:       Array<string>,
//     block_colors?:        Object<number,string>  per-block overrides,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './similarity_matrix/_state.js';
import {
  paintTransitionTrack,
  paintSimilarityMatrix,
  findWindowAtPixel,
  findCellAtPixel,
  deriveSampleOrder,
  buildBlockColorMap,
} from './similarity_matrix/renderer.js';
import {
  createSimilarityPanelSelection,
  summariseWindow,
  blockSizesFromAssignment,
} from './similarity_matrix/selection.js';
import { computeSimilarityAndBlocks } from '../../shared/mgl_similarity_matrix.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  show_block_overlay:    true,
  show_diagonal:         true,
  sample_order_mode:     'natural',
});

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshSimilarityPanel(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintTransition(_pageState);
  _paintMatrix(_pageState);
  _renderRightPanel(_pageState);
  _renderBlockList(_pageState);
}

export function initSimilarityPanelToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshSimilarityPanel(pageState); }
  catch (e) { console.warn('similarity_matrix.mount: refresh threw —', e); }

  try { initSimilarityPanelToolbar(); }
  catch (e) { console.warn('similarity_matrix.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_similarity_matrix_state = pageState;
  }

  // 2026-05-20: auto-compute on direct mount, same pattern as
  // dosage_heatmap. Fetch a default dosage chunk, slice its markers
  // into windows, run computeSimilarityAndBlocks, stash the result
  // on inv.similarity_panel_state, and re-render.
  if (!pageState.data || !pageState.data.similarity_result) {
    try {
      await _autoComputeSimilarity(root, atlasState);
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshSimilarityPanel(pageState); }
      catch (e) { console.warn('similarity_matrix.mount: post-autoload refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_similarity_matrix_state = pageState;
      }
    } catch (e) {
      console.warn('similarity_matrix.mount: auto-compute failed:', e);
    }
  }
}

// Auto-fetch a dosage chunk + run computeSimilarityAndBlocks on a default
// region. Returns silently if no chrom is loaded or the dosage_chunks
// bridge isn't available. The compute slices the chunk's markers into
// ~12 evenly-sized windows so the transition track has multiple cells
// to scrub through.
async function _autoComputeSimilarity(root, atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.similarity_panel_state || {};
  if (existing.similarity_result) return;
  // 2026-05-20: tolerate missing stash — fall back to the canonical
  // /api/dosage/chunk template + shared.activeChrom so this page is
  // self-sufficient when opened first.
  const stash = inv._local_pca_dosage_state;
  const data = stash && stash.data;
  const chrom = (data && data.chrom)
             || (atlasState.shared && atlasState.shared.activeChrom);
  if (!chrom) return;
  const dc = data && data.dosage_chunks;
  const template =
       (dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint))
    || '/api/dosage/chunk?chrom=__CHROM__&start=__START__&end=__END__&cap=__CAP__';
  if (!template || template.indexOf('__START__') < 0) return;
  // Pick a default region (same priority as dosage_heatmap auto-load).
  let startBp = null, endBp = null, sourceLabel = null;
  const cand = atlasState.shared && atlasState.shared.activeCandidate;
  if (cand && Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp)) {
    startBp = cand.start_bp; endBp = cand.end_bp;
    sourceLabel = `candidate ${cand.label || cand.id || ''}`.trim();
  }
  if (startBp == null && stash && stash.windowToL2 && stash.cur != null
      && data && Array.isArray(data.l2_envelopes)) {
    const li = stash.windowToL2[stash.cur | 0];
    if (li >= 0 && data.l2_envelopes[li]) {
      const env = data.l2_envelopes[li];
      if (Number.isFinite(env.start_bp) && Number.isFinite(env.end_bp)) {
        startBp = env.start_bp; endBp = env.end_bp;
        sourceLabel = `focal L2 (window ${stash.cur | 0})`;
      }
    }
  }
  if (startBp == null && data && Array.isArray(data.windows) && data.windows.length > 0) {
    const w0 = data.windows[0];
    const firstBp = Number.isFinite(w0.start_bp) ? w0.start_bp : 1;
    startBp = firstBp;
    endBp   = firstBp + 2_000_000;
    sourceLabel = `${chrom} ${(firstBp / 1e6).toFixed(2)}–${(endBp / 1e6).toFixed(2)} Mb (default)`;
  } else if (startBp == null) {
    startBp = 1;
    endBp   = 2_000_000;
    sourceLabel = `${chrom} 0.00–2.00 Mb (default)`;
  }
  if (startBp == null || endBp == null) return;
  const cap = Math.max(((dc && dc.cap_default | 0) || 1000), 800);
  const url = template
    .replace('__CHROM__', encodeURIComponent(chrom))
    .replace('__START__', String(startBp | 0))
    .replace('__END__',   String(endBp | 0))
    .replace('__CAP__',   String(cap));
  _setLoadingHint(root, `computing similarity for ${sourceLabel}…`);
  let chunk = null;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      _setLoadingHint(root, `chunk fetch failed (HTTP ${r.status}). Open from a candidate to specify a region.`);
      return;
    }
    chunk = await r.json();
  } catch (e) {
    _setLoadingHint(root, `chunk fetch failed: ${e && e.message ? e.message : 'network error'}`);
    return;
  }
  if (!chunk || !Array.isArray(chunk.markers) || !Array.isArray(chunk.dosage)
      || !Array.isArray(chunk.samples)) {
    _setLoadingHint(root, 'chunk has unexpected shape — cannot compute similarity.');
    return;
  }
  const n_markers = chunk.markers.length | 0;
  const n_samples = chunk.samples.length | 0;
  if (n_markers <= 0 || n_samples <= 0) return;
  // Flatten chunk.dosage (markers-major, NA = -1) into a Float64Array.
  // mgl_similarity_matrix expects row-major n_markers × n_samples with
  // NaN for missing (NOT -1).
  const flat = new Float64Array(n_markers * n_samples);
  for (let m = 0; m < n_markers; m++) {
    const row = chunk.dosage[m];
    const offset = m * n_samples;
    if (!row) {
      for (let s = 0; s < n_samples; s++) flat[offset + s] = NaN;
      continue;
    }
    for (let s = 0; s < n_samples; s++) {
      const v = row[s];
      flat[offset + s] = (v == null || !Number.isFinite(v) || v < 0) ? NaN : v;
    }
  }
  // Slice markers into ~12 windows. Each window slice carries its bp
  // range derived from the marker positions at its boundaries.
  const N_WINDOWS_TARGET = Math.min(12, Math.max(1, Math.floor(n_markers / 30)));
  const perWindow = Math.max(1, Math.floor(n_markers / N_WINDOWS_TARGET));
  const windows = [];
  for (let wi = 0; wi < N_WINDOWS_TARGET; wi++) {
    const s = wi * perWindow;
    const e = (wi === N_WINDOWS_TARGET - 1) ? n_markers - 1 : (s + perWindow - 1);
    if (s > e) break;
    const wsMark = chunk.markers[s] || {};
    const weMark = chunk.markers[e] || {};
    windows.push({
      idx:       wi,
      start_idx: s,
      end_idx:   e,
      start_bp:  Number.isFinite(wsMark.pos_bp) ? wsMark.pos_bp : null,
      end_bp:    Number.isFinite(weMark.pos_bp) ? weMark.pos_bp : null,
    });
  }
  if (windows.length === 0) return;
  let result = null;
  try {
    result = computeSimilarityAndBlocks({
      dosage:    flat,
      n_markers,
      n_samples,
      windows,
    });
  } catch (e) {
    _setLoadingHint(root, `computeSimilarityAndBlocks threw: ${e && e.message ? e.message : 'error'}`);
    return;
  }
  inv.similarity_panel_state = Object.assign({}, existing, {
    similarity_result: result,
    candidate_label:   existing.candidate_label || sourceLabel,
    metric_label:      existing.metric_label    || 'pearson',
    sample_labels:     chunk.samples.slice(),
  });
}

function _setLoadingHint(root, msg) {
  const el = (root && root.querySelector && root.querySelector('#similarityPanelEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('similarityPanelEmpty'));
  if (el) {
    el.style.display = '';
    el.textContent = msg;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('similarity_matrix.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const sp = inv.similarity_panel_state || null;
  const sr = sp ? sp.similarity_result : null;
  return {
    similarity_result:     sr,
    candidate_label:       sp ? (sp.candidate_label || null) : null,
    metric_label:          sp ? (sp.metric_label || 'pearson') : 'pearson',
    sample_labels:         sp ? (sp.sample_labels || null) : null,
    block_colors:          sp ? (sp.block_colors || null) : null,
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (sp && sp.view_state) || {}),
    transition_hits:       [],
    matrix_geom:           null,
    selection:             createSimilarityPanelSelection(0),
    _handlers:             {},
  };
}

function _activeWindow(state) {
  if (!state || !state.similarity_result) return null;
  const ws = state.similarity_result.windows;
  if (!Array.isArray(ws) || ws.length === 0) return null;
  let idx = state.selection.getActiveWindowIdx();
  if (idx == null || idx < 0 || idx >= ws.length) idx = 0;
  return ws[idx];
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const label = document.getElementById('similarityPanelCandidateLabel');
  if (label) label.textContent = state.candidate_label || '—';
  const metric = document.getElementById('similarityPanelMetricBadge');
  if (metric) metric.textContent = state.metric_label || 'pearson';
  // Reflect view-state on the toolbar inputs.
  const cbOv = document.getElementById('similarityPanelShowBlockOverlay');
  if (cbOv) cbOv.checked = !!state.view_state.show_block_overlay;
  const cbDg = document.getElementById('similarityPanelShowDiagonal');
  if (cbDg) cbDg.checked = !!state.view_state.show_diagonal;
  const sel = document.getElementById('similarityPanelSampleOrder');
  if (sel) sel.value = state.view_state.sample_order_mode || 'natural';
  // Active window label.
  const wLbl = document.getElementById('similarityPanelWindowLabel');
  if (wLbl) {
    const aw = _activeWindow(state);
    wLbl.textContent = aw ? `window ${aw.idx}` : 'window —';
  }
}

// =====================================================================
// Transition strip paint
// =====================================================================

function _paintTransition(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('similarityPanelTransitionCanvas');
  if (!canvas) return;
  const sr = state.similarity_result;
  if (!sr || !Array.isArray(sr.windows) || sr.windows.length === 0) {
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 56);
    }
    state.transition_hits = [];
    return;
  }
  const paint = paintTransitionTrack(canvas, sr.windows, sr.block_transition_ari, {
    active_window_idx:  state.selection.getActiveWindowIdx(),
    hovered_window_idx: state.selection.getHoveredWindowIdx(),
  });
  state.transition_hits = paint.window_hit_regions;
}

// =====================================================================
// Matrix paint
// =====================================================================

function _paintMatrix(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('similarityPanelMatrixCanvas');
  const empty  = document.getElementById('similarityPanelEmpty');
  if (!canvas) return;
  const aw = _activeWindow(state);
  if (!aw || !aw.similarity) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 600);
    }
    state.matrix_geom = null;
    return;
  }
  if (empty) empty.style.display = 'none';
  const n = Math.round(Math.sqrt(aw.similarity.length));
  const order = deriveSampleOrder(state.view_state.sample_order_mode,
                                   aw.assignment, n);
  // Sequential reds ramp for the matrix cells; the cluster bands on
  // the outside use the block palette so cluster boundaries pop
  // independently of the cell colour.
  const cmap = buildBlockColorMap(aw.K || 1, state.block_colors);
  const isPearson = (state.metric_label || 'pearson') === 'pearson';
  const geom = paintSimilarityMatrix(canvas, aw, {
    sample_order:        order,
    show_block_overlay:  state.view_state.show_block_overlay,
    show_diagonal:       state.view_state.show_diagonal,
    show_cluster_bands:  state.view_state.show_cluster_bands !== false,
    hovered_cell:        state.selection.getHoveredCell(),
    selected_samples:    state.selection.getSelectedSamples(),
    block_colors_by_id:  cmap,
    ramp_mode:           'reds',
    vmin:                isPearson ? -1 : 0,
    vmax:                1,
  });
  state.matrix_geom = geom;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('similarityPanelSelectedFields');
  if (!fields) return;
  const aw = _activeWindow(state);
  if (!aw) {
    fields.innerHTML = '<dt class="empty">No window selected</dt><dd>load a similarity result first</dd>';
    return;
  }
  const rows = summariseWindow(aw);
  let html = '';
  for (const r of rows) html += `<dt>${r.label}</dt><dd>${r.value}</dd>`;
  const hover = state.selection.getHoveredCell();
  if (hover && aw.similarity) {
    const n = Math.round(Math.sqrt(aw.similarity.length));
    const v = aw.similarity[hover.i * n + hover.j];
    const li = (state.sample_labels && state.sample_labels[hover.i]) || ('sample ' + hover.i);
    const lj = (state.sample_labels && state.sample_labels[hover.j]) || ('sample ' + hover.j);
    html += `<dt>Hover</dt><dd>${li} ↔ ${lj}</dd>`;
    html += `<dt>S(i,j)</dt><dd>${Number.isFinite(v) ? v.toFixed(3) : '—'}</dd>`;
  }
  fields.innerHTML = html;
}

function _renderBlockList(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('similarityPanelBlockListBody');
  if (!body) return;
  const aw = _activeWindow(state);
  if (!aw || !aw.assignment) {
    body.innerHTML = '<span class="empty">No blocks detected</span>';
    return;
  }
  const sizes = blockSizesFromAssignment(aw.assignment);
  if (sizes.length === 0) {
    body.innerHTML = '<span class="empty">No blocks detected</span>';
    return;
  }
  const cmap = buildBlockColorMap(aw.K || 1, state.block_colors);
  let html = '';
  for (const [k, n] of sizes) {
    const color = cmap[k] || '#888888';
    html += `<div class="similarity-block-row" data-block-id="${k}">`
         +    `<span class="similarity-block-swatch" style="background:${color}"></span>`
         +    `<span class="similarity-block-id">block ${k}</span> `
         +    `<span class="similarity-block-count">n = ${n}</span>`
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

  const repaint = () => {
    _paintMatrix(state);
    _renderBlockList(state);
  };
  const repaintAll = () => {
    _renderHeader(state);
    _paintTransition(state);
    _paintMatrix(state);
    _renderRightPanel(state);
    _renderBlockList(state);
  };

  const onShowOverlay = (e) => {
    state.view_state.show_block_overlay = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowDiagonal = (e) => {
    state.view_state.show_diagonal = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onSampleOrder = (e) => {
    const v = (e && e.target && e.target.value) || 'natural';
    state.view_state.sample_order_mode = v;
    repaint();
  };
  const onTransitionMove = (ev) => {
    const canvas = document.getElementById('similarityPanelTransitionCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const idx = findWindowAtPixel(state.transition_hits, x, y);
    state.selection.setHoveredWindowIdx(idx);
  };
  const onTransitionClick = (ev) => {
    const canvas = document.getElementById('similarityPanelTransitionCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const idx = findWindowAtPixel(state.transition_hits, x, y);
    if (idx != null) state.selection.setActiveWindowIdx(idx);
  };
  const onMatrixMove = (ev) => {
    const canvas = document.getElementById('similarityPanelMatrixCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const cell = findCellAtPixel(state.matrix_geom, x, y);
    state.selection.setHoveredCell(cell);
  };
  const onMatrixClick = (ev) => {
    const canvas = document.getElementById('similarityPanelMatrixCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const cell = findCellAtPixel(state.matrix_geom, x, y);
    if (cell) state.selection.toggleSelectedSample(cell.i);
  };

  const unsubSelection = state.selection.subscribe(() => {
    repaintAll();
  });

  state._handlers = {
    onShowOverlay, onShowDiagonal, onSampleOrder,
    onTransitionMove, onTransitionClick,
    onMatrixMove, onMatrixClick,
    unsubSelection,
  };

  _addListener('similarityPanelShowBlockOverlay', 'change',    onShowOverlay);
  _addListener('similarityPanelShowDiagonal',     'change',    onShowDiagonal);
  _addListener('similarityPanelSampleOrder',      'change',    onSampleOrder);
  _addListener('similarityPanelTransitionCanvas', 'mousemove', onTransitionMove);
  _addListener('similarityPanelTransitionCanvas', 'click',     onTransitionClick);
  _addListener('similarityPanelMatrixCanvas',     'mousemove', onMatrixMove);
  _addListener('similarityPanelMatrixCanvas',     'click',     onMatrixClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onShowOverlay)      _removeListener('similarityPanelShowBlockOverlay', 'change',    h.onShowOverlay);
  if (h.onShowDiagonal)     _removeListener('similarityPanelShowDiagonal',     'change',    h.onShowDiagonal);
  if (h.onSampleOrder)      _removeListener('similarityPanelSampleOrder',      'change',    h.onSampleOrder);
  if (h.onTransitionMove)   _removeListener('similarityPanelTransitionCanvas', 'mousemove', h.onTransitionMove);
  if (h.onTransitionClick)  _removeListener('similarityPanelTransitionCanvas', 'click',     h.onTransitionClick);
  if (h.onMatrixMove)       _removeListener('similarityPanelMatrixCanvas',     'mousemove', h.onMatrixMove);
  if (h.onMatrixClick)      _removeListener('similarityPanelMatrixCanvas',     'click',     h.onMatrixClick);
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
