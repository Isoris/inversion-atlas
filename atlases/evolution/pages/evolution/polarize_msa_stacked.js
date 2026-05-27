// pages/evolution/polarize_msa_stacked.js
// =====================================================================
// Stacked-consensus MSA viewer for inversion polarization. First
// cartridge of the "evolution" stage. Reuses the dosage-heatmap
// painter — each "sample" is one consensus row (outgroup, INV
// founder-like, INV subgroups by 2D-SFS doubleton clustering, STD).
//
// Input contract:
//   atlasState.inversion.polarize_msa_state = {
//     dosage:           Float64Array (row-major) | Array<Float64Array>,
//     n_markers, n_samples,
//     inv_idx:          number[]  INV-class sample indices
//     std_idx?:         number[]  STD-class sample indices
//     outgroup_idx?:    number[]  outgroup sample indices
//     marker_labels?:   string[]
//     candidate_label?: string,
//     view_state?:      { consensus_mode?: 'present'|'mrca',
//                          K_max?: number,
//                          show_confidence_stripe?: boolean }
//   }
// =====================================================================

import { _pageState, _setActiveState }
  from './polarize_msa_stacked/_state.js';
import { applyOnboarding, resetOnboarding } from '../../shared/onboarding.js';
import {
  buildPolarizeMsaRows,
  polarizationVerdict,
  ROW_TAG,
} from './polarize_msa_stacked/builder.js';
import {
  paintDosageHeatmap,
  findCellAtPixel,
  paintTierStripe,
  rowTagColor,
  tierLabel,
} from './polarize_msa_stacked/renderer.js';
import {
  createPolarizeMsaSelection,
  summariseHover,
} from './polarize_msa_stacked/selection.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  consensus_mode:          'present',
  K_max:                   3,
  show_confidence_stripe:  true,
});

const VERDICT_LABEL = Object.freeze({
  derived_inv:        'INV derived · STD ancestral',
  derived_std:        'STD derived · INV ancestral',
  unpolarized:        'Unpolarized',
  insufficient_data:  'Insufficient data',
});

// =====================================================================
// Public entry
// =====================================================================

export function refreshPolarizeMsa(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderTierSummary(_pageState);
  _renderRowLegend(_pageState);
}

export function initPolarizeMsaToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  resetOnboarding('polarize_msa_stacked');
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { refreshPolarizeMsa(pageState); }
  catch (e) { console.warn('polarize_msa_stacked.mount: refresh threw —', e); }
  try { initPolarizeMsaToolbar(); }
  catch (e) { console.warn('polarize_msa_stacked.mount: toolbar threw —', e); }
  if (atlasState.inversion) {
    atlasState.inversion._page_polarize_msa_stacked_state = pageState;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('polarize_msa_stacked.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const src = inv.polarize_msa_state || null;
  const vs = Object.assign({}, DEFAULT_VIEW_STATE, (src && src.view_state) || {});
  const stack = (src && src.dosage)
    ? buildPolarizeMsaRows({
        dosage: src.dosage, n_markers: src.n_markers, n_samples: src.n_samples,
        inv_idx: src.inv_idx, std_idx: src.std_idx, outgroup_idx: src.outgroup_idx,
        marker_labels: src.marker_labels,
        consensus_mode: vs.consensus_mode,
        opts: { K_max: vs.K_max },
      })
    : { rows: [], tier_mask: null, consensus_summary: null,
        subgroup_labels: null, K_actual: 0 };
  return {
    source:           src,
    candidate_label:  src ? (src.candidate_label || null) : null,
    marker_labels:    src ? (src.marker_labels || null) : null,
    stack,
    verdict:          src ? polarizationVerdict(stack) : null,
    layout:           null,
    view_state:       vs,
    selection:        createPolarizeMsaSelection(),
    _handlers:        {},
  };
}

function _rebuildStack(state) {
  if (!state || !state.source) {
    state.stack = { rows: [], tier_mask: null, consensus_summary: null,
                    subgroup_labels: null, K_actual: 0 };
    state.verdict = null;
    return;
  }
  const s = state.source;
  state.stack = buildPolarizeMsaRows({
    dosage: s.dosage, n_markers: s.n_markers, n_samples: s.n_samples,
    inv_idx: s.inv_idx, std_idx: s.std_idx, outgroup_idx: s.outgroup_idx,
    marker_labels: s.marker_labels,
    consensus_mode: state.view_state.consensus_mode,
    opts: { K_max: state.view_state.K_max },
  });
  state.verdict = polarizationVerdict(state.stack);
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('polarizeMsaCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const badge = document.getElementById('polarizeMsaVerdictBadge');
  if (badge) {
    const v = state.verdict && state.verdict.verdict;
    badge.textContent = v ? (VERDICT_LABEL[v] || v) : '—';
  }
  const cm = document.getElementById('polarizeMsaConsensusMode');
  if (cm) cm.value = state.view_state.consensus_mode;
  const ks = document.getElementById('polarizeMsaKSubgroups');
  if (ks) ks.value = state.view_state.K_max;
  const cs = document.getElementById('polarizeMsaShowConfidence');
  if (cs) cs.checked = !!state.view_state.show_confidence_stripe;
  const sc = document.getElementById('polarizeMsaSitesCount');
  if (sc) {
    const n = state.source ? state.source.n_markers : 0;
    sc.textContent = n + ' sites';
  }
}

// =====================================================================
// Canvas paint
// =====================================================================

function _paintCanvas(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('polarizeMsaCanvas');
  const empty  = document.getElementById('polarizeMsaEmpty');
  if (!canvas) return;
  const rows = state.stack && state.stack.rows;
  if (!rows || rows.length === 0) {
    if (empty) { empty.style.display = ''; applyOnboarding('polarize_msa_stacked'); }
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 400);
    }
    state.layout = null;
    return;
  }
  if (empty) empty.style.display = 'none';
  const n_samples = rows.length;
  const n_markers = state.source.n_markers;
  // Canonical adapter for the dosage-heatmap painter: each row in
  // the row-stack becomes a "sample".
  const data = {
    n_samples,
    n_markers,
    cellValue: (mi, si) => {
      const row = rows[si];
      if (!row) return null;
      const v = row.dosage_row[mi];
      return Number.isFinite(v) ? v : null;
    },
    sample_labels: rows.map(r => r.label),
    marker_labels: state.marker_labels,
  };
  const paint = paintDosageHeatmap(canvas, data, {
    show_group_track:    false,
    show_polarity_track: false,
    selected_samples:    state.selection.getSelectedRows(),
    selected_markers:    state.selection.getSelectedSites(),
    hovered_cell:        state.selection.getHoveredCell()
                            ? { row: state.selection.getHoveredCell().row,
                                col: state.selection.getHoveredCell().col }
                            : null,
  });
  state.layout = paint.layout;
  if (state.view_state.show_confidence_stripe && state.stack.tier_mask && state.layout) {
    paintTierStripe(canvas, state.stack.tier_mask, state.layout);
  }
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('polarizeMsaSelectedFields');
  if (!fields) return;
  const rows = summariseHover(
    state.selection.getHoveredCell(),
    state.stack.rows,
    state.stack.tier_mask,
    state.marker_labels,
  );
  let html = '';
  for (const r of rows) html += `<dt>${r.label}</dt><dd>${r.value}</dd>`;
  if (state.verdict) {
    html += `<dt>OG → INV matches</dt><dd>${state.verdict.inv_matches_outgroup}</dd>`;
    html += `<dt>OG → STD matches</dt><dd>${state.verdict.std_matches_outgroup}</dd>`;
    html += `<dt>Sites evaluated</dt><dd>${state.verdict.n_evaluated}</dd>`;
  }
  fields.innerHTML = html;
}

function _renderTierSummary(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('polarizeMsaTierBody');
  if (!body) return;
  const cs = state.stack.consensus_summary;
  if (!cs) { body.innerHTML = '<span class="empty">—</span>'; return; }
  const total = cs.n_total || 1;
  const pct = (n) => Math.round((n / total) * 100);
  let html = '<div class="pmsa-tier-row"><span class="pmsa-tier-swatch pmsa-tier-high"></span>'
           + `high: ${cs.n_high} (${pct(cs.n_high)}%)</div>`;
  html += '<div class="pmsa-tier-row"><span class="pmsa-tier-swatch pmsa-tier-medium"></span>'
           + `medium: ${cs.n_medium} (${pct(cs.n_medium)}%)</div>`;
  html += '<div class="pmsa-tier-row"><span class="pmsa-tier-swatch pmsa-tier-low"></span>'
           + `low: ${cs.n_low} (${pct(cs.n_low)}%)</div>`;
  html += '<div class="pmsa-tier-row"><span class="pmsa-tier-swatch pmsa-tier-ambiguous"></span>'
           + `ambiguous: ${cs.n_ambiguous} (${pct(cs.n_ambiguous)}%)</div>`;
  html += '<div class="pmsa-tier-row"><span class="pmsa-tier-swatch pmsa-tier-suspicious"></span>'
           + `suspicious: ${cs.n_suspicious} (${pct(cs.n_suspicious)}%)</div>`;
  body.innerHTML = html;
}

function _renderRowLegend(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('polarizeMsaRowLegendBody');
  if (!body) return;
  const rows = state.stack.rows;
  if (!rows || rows.length === 0) { body.innerHTML = '<span class="empty">—</span>'; return; }
  let html = '';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = rowTagColor(r.tag);
    html += `<div class="pmsa-row-legend-row" data-row-idx="${i}">`
         +    `<span class="pmsa-row-swatch" style="background:${c}"></span>`
         +    `<span class="pmsa-row-label">${r.label}</span>`
         + '</div>';
  }
  body.innerHTML = html;
}

// =====================================================================
// Toolbar
// =====================================================================

function _wireToolbar(state) {
  if (!state || typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaintAll = () => {
    _renderHeader(state);
    _paintCanvas(state);
    _renderRightPanel(state);
    _renderTierSummary(state);
    _renderRowLegend(state);
  };

  const onConsensusMode = (e) => {
    state.view_state.consensus_mode = (e && e.target && e.target.value) || 'present';
    _rebuildStack(state);
    repaintAll();
  };
  const onKChange = (e) => {
    const v = parseInt(e && e.target && e.target.value, 10);
    if (Number.isFinite(v) && v >= 1 && v <= 6) {
      state.view_state.K_max = v;
      _rebuildStack(state);
      repaintAll();
    }
  };
  const onConfidenceToggle = (e) => {
    state.view_state.show_confidence_stripe = !!(e && e.target && e.target.checked);
    _paintCanvas(state);
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('polarizeMsaCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const cellValue = (mi, si) => {
      const row = state.stack.rows[si];
      if (!row) return null;
      const v = row.dosage_row[mi];
      return Number.isFinite(v) ? v : null;
    };
    const cell = findCellAtPixel(state.layout, cellValue, x, y);
    state.selection.setHoveredCell(cell);
  };
  const onCanvasClick = (ev) => {
    const c = document.getElementById('polarizeMsaCanvas');
    if (!c || !state.stack.rows.length) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const cellValue = (mi, si) => {
      const row = state.stack.rows[si];
      if (!row) return null;
      const v = row.dosage_row[mi];
      return Number.isFinite(v) ? v : null;
    };
    const cell = findCellAtPixel(state.layout, cellValue, x, y);
    if (!cell) return;
    if (ev && ev.shiftKey) state.selection.toggleSelectedSite(cell.marker_idx);
    else                   state.selection.toggleSelectedRow(cell.sample_idx);
  };

  const unsub = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onConsensusMode, onKChange, onConfidenceToggle,
    onCanvasMove, onCanvasClick, unsub,
  };
  _addListener('polarizeMsaConsensusMode',  'change',    onConsensusMode);
  _addListener('polarizeMsaKSubgroups',     'change',    onKChange);
  _addListener('polarizeMsaShowConfidence', 'change',    onConfidenceToggle);
  _addListener('polarizeMsaCanvas',         'mousemove', onCanvasMove);
  _addListener('polarizeMsaCanvas',         'click',     onCanvasClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onConsensusMode)    _removeListener('polarizeMsaConsensusMode',  'change',    h.onConsensusMode);
  if (h.onKChange)          _removeListener('polarizeMsaKSubgroups',     'change',    h.onKChange);
  if (h.onConfidenceToggle) _removeListener('polarizeMsaShowConfidence', 'change',    h.onConfidenceToggle);
  if (h.onCanvasMove)       _removeListener('polarizeMsaCanvas',         'mousemove', h.onCanvasMove);
  if (h.onCanvasClick)      _removeListener('polarizeMsaCanvas',         'click',     h.onCanvasClick);
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
