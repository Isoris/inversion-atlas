// pages/discovery/nested_inversion_detector.js
// =====================================================================
// Nested-inversion detector panel — atlas-side cartridge for
// HANDOFF_7 / SPEC_0 §11.7.
//
// Phase 1 scope:
//   - 3 horizontal stratum tracks (HOM1 / HET / HOM2) with one
//     coloured bar per per-stratum inner-band candidate (bar
//     height = silhouette quality)
//   - Highlighted overlays for contiguous inner intervals
//   - Verdict badge + strata-scanned indicator
//   - Hover crosshair + right-panel interval summary; click an
//     interval to toggle in selection
//
// Input contract:
//   atlasState.inversion.nested_detector_state = {
//     detector_result:   shared/mgl_nested_detector
//                          .detectNestedInversion output,
//     candidate_label?:  string,
//     n_windows?:        number   (defaults to inferred from result),
//   }
// =====================================================================

import { _pageState, _setActiveState } from './nested_inversion_detector/_state.js';
import {
  paintNestedTracks,
  findBandAtPixel,
  findIntervalAtPixel,
  totalWindowCount,
  verdictColor,
  verdictLabel,
  stratumColor,
} from './nested_inversion_detector/renderer.js';
import {
  createNestedDetectorSelection,
  summariseInterval,
  candidateCountsByStratum,
} from './nested_inversion_detector/selection.js';

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshNestedDetector(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintTracks(_pageState);
  _renderRightPanel(_pageState);
  _renderCandidatesList(_pageState);
}

export function initNestedDetectorToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshNestedDetector(pageState); }
  catch (e) { console.warn('nested_inversion_detector.mount: refresh threw —', e); }

  try { initNestedDetectorToolbar(); }
  catch (e) { console.warn('nested_inversion_detector.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_nested_inversion_detector_state = pageState;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('nested_inversion_detector.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const ns = inv.nested_detector_state || null;
  const dr = ns ? ns.detector_result : null;
  return {
    detector_result:      dr,
    candidate_label:      ns ? (ns.candidate_label || null) : null,
    n_windows:            ns && Number.isFinite(ns.n_windows)
                            ? ns.n_windows : totalWindowCount(dr),
    band_hit_regions:     [],
    interval_hit_regions: [],
    selection:            createNestedDetectorSelection(),
    _handlers:            {},
  };
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('nestedDetectorCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const badge = document.getElementById('nestedDetectorVerdictBadge');
  if (badge) {
    const dr = state.detector_result;
    if (dr && dr.verdict) {
      badge.textContent = verdictLabel(dr.verdict);
      badge.style.background = verdictColor(dr.verdict);
      badge.style.color = '#fff';
    } else {
      badge.textContent = '—';
      badge.style.background = '';
      badge.style.color = '';
    }
  }
  const strata = document.getElementById('nestedDetectorStrataBadge');
  if (strata) {
    const dr = state.detector_result;
    const scanned = (dr && Array.isArray(dr.strata_scanned)) ? dr.strata_scanned : [];
    strata.textContent = scanned.length
      ? 'strata scanned: ' + scanned.join(', ')
      : 'strata scanned: —';
  }
}

// =====================================================================
// Tracks paint
// =====================================================================

function _paintTracks(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('nestedDetectorTracksCanvas');
  const empty  = document.getElementById('nestedDetectorEmpty');
  if (!canvas) return;
  const dr = state.detector_result;
  if (!dr) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 160);
    }
    state.band_hit_regions = [];
    state.interval_hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const paint = paintNestedTracks(canvas, dr, {
    n_windows:           state.n_windows,
    hovered_interval_idx: state.selection.getHoveredInterval(),
  });
  state.band_hit_regions = paint.band_hit_regions;
  state.interval_hit_regions = paint.interval_hit_regions;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('nestedDetectorIntervalsBody');
  if (!body) return;
  const dr = state.detector_result;
  if (!dr || !Array.isArray(dr.inner_intervals) || dr.inner_intervals.length === 0) {
    body.innerHTML = '<span class="empty">No inner intervals</span>';
    return;
  }
  const hoveredIdx = state.selection.getHoveredInterval();
  const selected = state.selection.getSelectedIntervals();
  let html = '';
  for (let i = 0; i < dr.inner_intervals.length; i++) {
    const iv = dr.inner_intervals[i];
    const rows = summariseInterval(iv);
    const cls = (hoveredIdx === i ? 'hovered ' : '')
              + (selected.has(i) ? 'selected' : '');
    html += `<div class="nested-interval-row ${cls}" data-iv="${i}">`
         +    `<span class="nested-interval-title">Interval ${i}</span>`
         +    '<dl>';
    for (const r of rows) html += `<dt>${r.label}</dt><dd>${r.value}</dd>`;
    html += '</dl></div>';
  }
  body.innerHTML = html;
}

function _renderCandidatesList(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('nestedDetectorCandidatesBody');
  if (!body) return;
  const counts = candidateCountsByStratum(state.detector_result);
  if (counts.length === 0) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  let html = '';
  for (const [s, n] of counts) {
    const c = stratumColor(s);
    html += `<div class="nested-stratum-row" data-stratum="${s}">`
         +    `<span class="nested-stratum-swatch" style="background:${c}"></span>`
         +    `<span class="nested-stratum-id">${s}</span> `
         +    `<span class="nested-stratum-count">n = ${n}</span>`
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

  const repaintAll = () => {
    _paintTracks(state);
    _renderRightPanel(state);
  };

  const onCanvasMove = (ev) => {
    const c = document.getElementById('nestedDetectorTracksCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    // Interval overlays span the whole row — check them first.
    const iv = findIntervalAtPixel(state.interval_hit_regions, x, y);
    state.selection.setHoveredInterval(iv);
    const band = findBandAtPixel(state.band_hit_regions, x, y);
    state.selection.setHoveredBand(band);
  };
  const onCanvasClick = (ev) => {
    const c = document.getElementById('nestedDetectorTracksCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const iv = findIntervalAtPixel(state.interval_hit_regions, x, y);
    if (iv != null) state.selection.toggleSelectedInterval(iv);
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onCanvasMove, onCanvasClick, unsubSelection,
  };
  _addListener('nestedDetectorTracksCanvas', 'mousemove', onCanvasMove);
  _addListener('nestedDetectorTracksCanvas', 'click',     onCanvasClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onCanvasMove)   _removeListener('nestedDetectorTracksCanvas', 'mousemove', h.onCanvasMove);
  if (h.onCanvasClick)  _removeListener('nestedDetectorTracksCanvas', 'click',     h.onCanvasClick);
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
