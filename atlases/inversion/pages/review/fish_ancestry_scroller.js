// pages/review/fish_ancestry_scroller.js
// =====================================================================
// Fish Ancestry Scroller — review-stage page that renders the three
// numbered layers + brick metrics + cohort summary for one selected
// inversion candidate (one chromosome viewport).
//
// Spec: specs_todo/SPEC_fish_ancestry_scroller.md (UI layout v2 —
// canonical). Mockups: plots/ancestry_atlas_mockup_v2.png and
// plots/ancestry_scroller_mockup.png.
//
// This page is the consumer of the shared ancestry primitives:
//   - shared/ancestry_alignment.js — produces aligned Q (label-switching
//     fixed) → driver of Layer 2 brick K assignment + ΔQ metric.
//   - shared/ancestry_bricks.js    — produces per-fish bricks + flags →
//     driver of Layer 2 and the brick-metrics block.
//
// The page does NOT compute alignment or bricks; the caller supplies a
// fully prepared `model` to mount(). When the model is missing, the
// page renders an empty-state stub (window_summary_table pattern).
// =====================================================================

import { _pageState, _setActiveState } from './fish_ancestry_scroller/_state.js';
import {
  paintLayer1, paintLayer2, paintMetrics, paintLayer3,
} from './fish_ancestry_scroller/layers.js';
import {
  renderContextCard,
  formatSelectedBrickFields,
  formatSelectedBrickStatus,
} from './fish_ancestry_scroller/right_panel.js';
import {
  resolveClick,
  createSelectionStore,
} from './fish_ancestry_scroller/selection.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  view_mode:           'ancestry_k',
  show_inversion:      true,
  show_breakpoints:    true,
  show_metrics:        true,
  show_brick_borders:  true,
  show_warnings:       true,
});

// ---------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------

/**
 * Refresh — repaint every layer + metrics + summary using the current
 * state's `model` and `view_state`. Idempotent.
 */
export function refreshAncestryScroller(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintAll(_pageState);
  _renderRightPanel(_pageState);
}

/**
 * Wire toolbar handlers (view-mode dropdown, overlay toggles, layer 2
 * click). Idempotent — calling twice replaces handlers.
 */
export function initAncestryScrollerToolbar() {
  _wireToolbar(_pageState);
}

// ---------------------------------------------------------------------
// Atlas-router lifecycle
// ---------------------------------------------------------------------

/** Mount — called by atlas-router on tab activation. */
export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshAncestryScroller(pageState); }
  catch (e) { console.warn('fish_ancestry_scroller.mount: refresh threw —', e); }

  try { initAncestryScrollerToolbar(); }
  catch (e) { console.warn('fish_ancestry_scroller.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._pageAncestryScrollerState = pageState;
  }
}

/** Unmount — clear handlers and live-binding state. */
export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('fish_ancestry_scroller.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// ---------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const ancestry = inv.ancestry_scroller || {};
  return {
    candidate:   ancestry.candidate   || null,
    chrom:       ancestry.chrom       || (inv.activeChrom || null),
    viewport_bp: ancestry.viewport_bp || null,   // [start_bp, end_bp]
    breakpoints: ancestry.breakpoints || null,   // [bp_left, bp_right]
    K:           ancestry.K           || 3,
    model:       ancestry.model       || null,   // {fish_rows, window_grid, pc1_band, bricks}
    view_state:  Object.assign({}, DEFAULT_VIEW_STATE, ancestry.view_state || {}),
    selection:   createSelectionStore(),
    _handlers:   {},
  };
}

// ---------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const chromLabel = document.getElementById('ancScrollChromLabel');
  const viewport   = document.getElementById('ancScrollViewport');
  if (chromLabel) {
    chromLabel.textContent = state.chrom
      ? `${state.chrom}:`
      : '—';
  }
  if (viewport) {
    if (Array.isArray(state.viewport_bp) && state.viewport_bp.length === 2) {
      const a = (state.viewport_bp[0] / 1e6).toFixed(2);
      const b = (state.viewport_bp[1] / 1e6).toFixed(2);
      viewport.textContent = `${a} – ${b} Mb`;
    } else {
      viewport.textContent = '— – — Mb';
    }
  }
  const kSel = document.getElementById('ancScrollKSelect');
  if (kSel) {
    kSel.value = String(state.K || 3);
  }
}

// ---------------------------------------------------------------------
// Layer painting
// ---------------------------------------------------------------------

function _paintAll(state) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  if (!state || !state.model) {
    _showEmptyState(state);
    return;
  }
  _hideEmptyState();
  const m  = state.model;
  const vs = state.view_state;

  paintLayer1(document.getElementById('ancScrollLayer1Canvas'), m);
  paintLayer2(document.getElementById('ancScrollLayer2Canvas'), m, vs);
  if (vs.show_metrics !== false) {
    paintMetrics(document.getElementById('ancScrollMetricsCanvas'), m);
  }
  paintLayer3(document.getElementById('ancScrollLayer3Canvas'), m);
}

/**
 * Show the empty-state surface when there's no upstream ancestry model.
 * Inserts a #ancScrollEmpty block inside .anc-scroll-tracks (above the
 * unpainted Layer 1 / 2 / metrics / 3 sections). Replaces any prior copy.
 *
 * The page is a pure renderer: alignment + brick construction happen
 * cluster-side (instant_q → ancestry_alignment.js → ancestry_bricks.js).
 * The empty state surfaces this contract so users don't see four blank
 * canvases and wonder if the page is broken.
 */
function _showEmptyState(state) {
  const root = document.getElementById('fish_ancestry_scroller');
  if (!root) return;
  const tracks = root.querySelector ? root.querySelector('.anc-scroll-tracks') : null;
  if (!tracks) return;
  // Hide the layer + metrics blocks so the empty state owns the column.
  const blocks = tracks.querySelectorAll
    ? tracks.querySelectorAll('.anc-scroll-layer, .anc-scroll-metrics')
    : [];
  blocks.forEach(el => { if (el.style) el.style.display = 'none'; });

  let empty = root.querySelector ? root.querySelector('#ancScrollEmpty') : null;
  if (!empty) {
    empty = document.createElement('div');
    empty.id = 'ancScrollEmpty';
    empty.className = 'anc-scroll-empty';
    tracks.insertBefore(empty, tracks.firstChild);
  }
  const chrom     = state && state.chrom;
  const candidate = state && state.candidate;
  const ctx = (chrom || candidate)
    ? `Current scope: ${chrom || '(no chrom)'}${candidate ? ` · ${candidate.id || candidate}` : ''}.`
    : 'No chromosome / candidate selected.';
  empty.innerHTML =
    '<div class="anc-empty-title">No ancestry model loaded</div>'
    + '<div>This page is a renderer for the cluster-side ancestry pipeline:</div>'
    + '<div><code>instant_q</code> → <code>ancestry_alignment.js</code> '
    + '→ <code>ancestry_bricks.js</code> → <code>atlasState.inversion.ancestry_scroller.model</code>.</div>'
    + `<div>${ctx}</div>`
    + '<div>Spec: <code>specs_todo/SPEC_fish_ancestry_scroller.md</code>.</div>';
}

function _hideEmptyState() {
  const empty = document.getElementById('ancScrollEmpty');
  if (empty && empty.style) empty.style.display = 'none';
  const root = document.getElementById('fish_ancestry_scroller');
  if (!root) return;
  const blocks = root.querySelectorAll
    ? root.querySelectorAll('.anc-scroll-layer, .anc-scroll-metrics')
    : [];
  blocks.forEach(el => { if (el.style) el.style.display = ''; });
}

// ---------------------------------------------------------------------
// Right panel
// ---------------------------------------------------------------------

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const ctxList = document.getElementById('ancScrollContextList');
  if (ctxList) renderContextCard(ctxList);

  const fields = document.getElementById('ancScrollSelectedFields');
  const status = document.getElementById('ancScrollSelectedStatus');
  const sel = state.selection.get();
  if (fields) fields.innerHTML = formatSelectedBrickFields(sel);
  if (status) status.innerHTML = formatSelectedBrickStatus(sel);
}

// ---------------------------------------------------------------------
// Toolbar wiring (view-mode dropdown + overlay toggles + Layer-2 click)
// ---------------------------------------------------------------------

function _wireToolbar(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;

  _teardownToolbar(state);

  const onViewMode = (e) => {
    state.view_state = Object.assign({}, state.view_state, {
      view_mode: e && e.target ? e.target.value : 'ancestry_k',
    });
    _paintAll(state);
  };
  const onShowMetrics = (e) => {
    state.view_state.show_metrics = !!(e && e.target && e.target.checked);
    _paintAll(state);
  };
  const onShowBorders = (e) => {
    state.view_state.show_brick_borders = !!(e && e.target && e.target.checked);
    _paintAll(state);
  };
  const onShowWarnings = (e) => {
    state.view_state.show_warnings = !!(e && e.target && e.target.checked);
    _paintAll(state);
  };
  const onLayer2Click = (e) => {
    const canvas = document.getElementById('ancScrollLayer2Canvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0 };
    const px = {
      x: ((e && e.clientX) || 0) - (rect.left || 0),
      y: ((e && e.clientY) || 0) - (rect.top  || 0),
      canvas_w: canvas.width  || 0,
      canvas_h: canvas.height || 0,
    };
    const sel = resolveClick(px, state.model);
    state.selection.set(sel);
    _renderRightPanel(state);
  };

  state._handlers.onViewMode     = onViewMode;
  state._handlers.onShowMetrics  = onShowMetrics;
  state._handlers.onShowBorders  = onShowBorders;
  state._handlers.onShowWarnings = onShowWarnings;
  state._handlers.onLayer2Click  = onLayer2Click;

  _addListener('ancScrollViewMode',         'change', onViewMode);
  _addListener('ancScrollShowMetrics',      'change', onShowMetrics);
  _addListener('ancScrollShowBrickBorders', 'change', onShowBorders);
  _addListener('ancScrollShowWarnings',     'change', onShowWarnings);
  _addListener('ancScrollLayer2Canvas',     'click',  onLayer2Click);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onViewMode)     _removeListener('ancScrollViewMode',         'change', h.onViewMode);
  if (h.onShowMetrics)  _removeListener('ancScrollShowMetrics',      'change', h.onShowMetrics);
  if (h.onShowBorders)  _removeListener('ancScrollShowBrickBorders', 'change', h.onShowBorders);
  if (h.onShowWarnings) _removeListener('ancScrollShowWarnings',     'change', h.onShowWarnings);
  if (h.onLayer2Click)  _removeListener('ancScrollLayer2Canvas',     'click',  h.onLayer2Click);
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
