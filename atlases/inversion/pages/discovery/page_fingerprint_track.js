// pages/discovery/page_fingerprint_track.js
// =====================================================================
// Per-window diversity fingerprint track — atlas-side cartridge for
// HANDOFF_6.
//
// Phase 1 scope (this commit):
//   - Single horizontal regime strip across the candidate
//   - Switch markers above the strip (▲ return / ▼ terminal /
//     · brief switches; brief hidden by default)
//   - Scenario badge in header (stable / recombinant_tract /
//     two_adjacent / nested / complex / insufficient)
//   - Hover / click linkage with the panel's selection store
//   - Optional window labels under the strip
//
// Deferred:
//   - Genomic coordinates axis (start_bp / end_bp) — needs window
//     metadata to be wired through atlasState; for now we use
//     window indices
//   - Cross-panel linkage with tree / PCA / heatmap (separate
//     commit once those panels are wired through HANDOFF_2's
//     candidate-mode slot)
//   - Stage 1 in-browser π / dXY / Fst from Beagle — separate
//     primitive
//
// Input contract: the page reads from
//   atlasState.inversion.fingerprint_track_state = {
//     fingerprint_result:    shared/mgl_fingerprinter output,
//     candidate_label?:      string for the header,
//     regime_colors_by_id?:  Object<number,string> overrides,
//     window_labels?:        Array<string>,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './page_fingerprint_track/_state.js';
import {
  paintFingerprintTrack,
  findWindowAtPixel,
  findSwitchAtPixel,
  buildRegimeColorMap,
} from './page_fingerprint_track/renderer.js';
import {
  createFingerprintSelection,
  summariseWindow,
} from './page_fingerprint_track/selection.js';
import {
  MGL_ARCHITECTURE_SCENARIOS,
  MGL_SWITCH_TYPES,
} from '../../shared/mgl_fingerprinter.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  show_brief_switches:   false,
  show_labels:           true,
});

const SCENARIO_LABEL = {
  [MGL_ARCHITECTURE_SCENARIOS.STABLE_INVERSION]:                'Stable inversion',
  [MGL_ARCHITECTURE_SCENARIOS.ONE_INVERSION_WITH_RECOMBINANT]:  'One inv + recombinant tract',
  [MGL_ARCHITECTURE_SCENARIOS.TWO_ADJACENT_INVERSIONS]:         'Two adjacent inversions',
  [MGL_ARCHITECTURE_SCENARIOS.NESTED_REARRANGEMENT]:            'Nested rearrangement',
  [MGL_ARCHITECTURE_SCENARIOS.COMPLEX_OR_UNCLEAR]:              'Complex / unclear',
  [MGL_ARCHITECTURE_SCENARIOS.INSUFFICIENT_DATA]:               'Insufficient data',
};

const SWITCH_TYPE_LABEL = {
  [MGL_SWITCH_TYPES.RETURN_SWITCH]:    'return',
  [MGL_SWITCH_TYPES.TERMINAL_SWITCH]:  'terminal',
  [MGL_SWITCH_TYPES.BRIEF_SWITCH]:     'brief',
};

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshFingerprintTrack(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintTrackCanvas(_pageState);
  _renderRightPanel(_pageState);
  _renderSwitchList(_pageState);
}

export function initFingerprintTrackToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshFingerprintTrack(pageState); }
  catch (e) { console.warn('page_fingerprint_track.mount: refresh threw —', e); }

  try { initFingerprintTrackToolbar(); }
  catch (e) { console.warn('page_fingerprint_track.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_fingerprint_track_state = pageState;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('page_fingerprint_track.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const ft = inv.fingerprint_track_state || null;
  const fp = ft ? ft.fingerprint_result : null;
  const colors = buildRegimeColorMap(
    (fp && fp.n_regimes) || 0,
    ft ? ft.regime_colors_by_id : null,
  );
  return {
    fingerprint_result:    fp,
    candidate_label:       ft ? (ft.candidate_label || null) : null,
    window_labels:         ft ? (ft.window_labels || null) : null,
    regime_colors_by_id:   colors,
    window_hit_regions:    [],
    switch_hit_regions:    [],
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (ft && ft.view_state) || {}),
    selection:             createFingerprintSelection(),
    _handlers:             {},
  };
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const label = document.getElementById('fingerprintCandidateLabel');
  if (label) label.textContent = state.candidate_label || '—';
  const badge = document.getElementById('fingerprintScenarioBadge');
  if (badge) {
    const fp = state.fingerprint_result;
    if (fp && fp.scenario) {
      const txt = SCENARIO_LABEL[fp.scenario] || fp.scenario;
      badge.textContent = `${txt} · ${fp.n_regimes} regime${fp.n_regimes === 1 ? '' : 's'}`;
    } else {
      badge.textContent = '—';
    }
  }
  // Reflect checkbox state to match view_state (idempotent on remount).
  const cbBrief = document.getElementById('fingerprintShowBriefSwitches');
  if (cbBrief) cbBrief.checked = !!state.view_state.show_brief_switches;
  const cbLab = document.getElementById('fingerprintShowLabels');
  if (cbLab) cbLab.checked = !!state.view_state.show_labels;
}

// =====================================================================
// Track paint
// =====================================================================

function _paintTrackCanvas(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('fingerprintTrackCanvas');
  const empty  = document.getElementById('fingerprintTrackEmpty');
  if (!canvas) return;
  if (!state.fingerprint_result
      || !Array.isArray(state.fingerprint_result.windows)
      || state.fingerprint_result.windows.length === 0) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 800, canvas.height || 120);
    }
    state.window_hit_regions = [];
    state.switch_hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const paint = paintFingerprintTrack(canvas, state.fingerprint_result, {
    regime_colors_by_id:   state.regime_colors_by_id,
    show_brief_switches:   state.view_state.show_brief_switches,
    show_labels:           state.view_state.show_labels,
    window_labels:         state.window_labels,
    hovered_window:        state.selection.getHoveredWindow(),
    hovered_switch:        state.selection.getHoveredSwitch(),
    selected_windows:      state.selection.getSelected(),
  });
  state.window_hit_regions = paint.window_hit_regions;
  state.switch_hit_regions = paint.switch_hit_regions;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('fingerprintSelectedFields');
  if (!fields) return;
  const fp = state.fingerprint_result;
  const hover = state.selection.getHoveredWindow();
  if (!fp || hover == null || !fp.windows[hover]) {
    fields.innerHTML = '<dt class="empty">No window selected</dt><dd>hover or click in the track</dd>';
    return;
  }
  const w = fp.windows[hover];
  const label = (state.window_labels && state.window_labels[hover]) || `idx ${hover}`;
  const selected = state.selection.getSelected().has(hover);
  let html = '';
  html += `<dt>Window</dt><dd>${label}</dd>`;
  html += `<dt>Regime</dt><dd>${w.regime_id}</dd>`;
  html += `<dt>Selected</dt><dd>${selected ? 'yes' : 'no'}</dd>`;
  html += `<dt>Signature</dt><dd>${summariseWindow(w)}</dd>`;
  fields.innerHTML = html;
}

function _renderSwitchList(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('fingerprintSwitchListBody');
  if (!body) return;
  const fp = state.fingerprint_result;
  if (!fp || !Array.isArray(fp.switches) || fp.switches.length === 0) {
    body.innerHTML = '<span class="empty">No switches detected</span>';
    return;
  }
  const showBrief = !!state.view_state.show_brief_switches;
  let html = '';
  for (let i = 0; i < fp.switches.length; i++) {
    const s = fp.switches[i];
    if (!showBrief && s.type === MGL_SWITCH_TYPES.BRIEF_SWITCH) continue;
    const label = SWITCH_TYPE_LABEL[s.type] || s.type;
    html += `<div class="fingerprint-switch-row" data-switch-idx="${i}">`
         +    `<span class="fingerprint-switch-type fingerprint-switch-${label}">${label}</span> `
         +    `<span class="fingerprint-switch-range">windows ${s.window_start}–${s.window_end}</span> `
         +    `<span class="fingerprint-switch-regimes">R${s.regime_outer}→R${s.regime_inner}</span>`
         + '</div>';
  }
  if (html === '') html = '<span class="empty">No switches at current filter</span>';
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
    _paintTrackCanvas(state);
    _renderSwitchList(state);
  };

  const onShowBrief = (e) => {
    state.view_state.show_brief_switches = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowLabels = (e) => {
    state.view_state.show_labels = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onCanvasMove = (ev) => {
    const canvas = document.getElementById('fingerprintTrackCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    // Prefer switch hits (they sit above the strip).
    const sidx = findSwitchAtPixel(state.switch_hit_regions, x, y);
    state.selection.setHoveredSwitch(sidx);
    const widx = findWindowAtPixel(state.window_hit_regions, x, y);
    state.selection.setHoveredWindow(widx);
  };
  const onCanvasClick = (ev) => {
    const canvas = document.getElementById('fingerprintTrackCanvas');
    if (!canvas) return;
    const rect = typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const widx = findWindowAtPixel(state.window_hit_regions, x, y);
    if (widx != null) state.selection.toggleSelected(widx);
  };

  const unsubSelection = state.selection.subscribe(() => {
    _paintTrackCanvas(state);
    _renderRightPanel(state);
  });

  state._handlers = {
    onShowBrief, onShowLabels,
    onCanvasMove, onCanvasClick,
    unsubSelection,
  };

  _addListener('fingerprintShowBriefSwitches', 'change',    onShowBrief);
  _addListener('fingerprintShowLabels',        'change',    onShowLabels);
  _addListener('fingerprintTrackCanvas',       'mousemove', onCanvasMove);
  _addListener('fingerprintTrackCanvas',       'click',     onCanvasClick);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onShowBrief)   _removeListener('fingerprintShowBriefSwitches', 'change',    h.onShowBrief);
  if (h.onShowLabels)  _removeListener('fingerprintShowLabels',        'change',    h.onShowLabels);
  if (h.onCanvasMove)  _removeListener('fingerprintTrackCanvas',       'mousemove', h.onCanvasMove);
  if (h.onCanvasClick) _removeListener('fingerprintTrackCanvas',       'click',     h.onCanvasClick);
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
