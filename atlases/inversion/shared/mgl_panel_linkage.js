// shared/mgl_panel_linkage.js
// =====================================================================
// Cross-panel sample-hover + sample-selection linkage. Each panel
// (PCA / dosage-heatmap / similarity) owns its own selection store
// but the SPEC_0 §10 contract says "hovering a sample in any panel
// highlights it in every other panel that shows the same sample".
//
// This module bridges per-panel selection stores to the shared
// mgl_render_state owned by the active mglCandidateMode slot. When
// the user hovers / clicks in one panel, the hover propagates
// through slot.render_state → all subscribed panels. The bridges
// are bidirectional but loop-safe (a slot-originated update never
// re-fires a slot update).
//
// Tree / fingerprint / nested-detector / dosage-cluster panels are
// not sample-keyed and are intentionally NOT bridged by this MVP.
//
// Pure compute. No DOM, no fetch.
// =====================================================================

import {
  setHover,
  updateMglRenderState,
  subscribeMglRenderState,
} from './mgl_render_state.js';

// =====================================================================
// 1. Set equality helper
// =====================================================================

function _sameSet(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set)) return a === b;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// =====================================================================
// 2. Generic bind helper — works on any panel that exposes
//    setHoveredSample / getHoveredSample / getSelectedSamples /
//    toggleSelectedSample / clearSelection / subscribe.
// =====================================================================

/**
 * Bind a panel whose selection store has:
 *   getHoveredSample()   → number|null
 *   setHoveredSample(n)  → void
 *   getSelectedSamples() → Set<number>
 *   toggleSelectedSample(n)
 *   clearSelection()
 *   subscribe(cb)        → unsubscribe
 *
 * @param {Object} panel_state   has .selection
 * @param {Object} slot          mglCandidateMode slot with .render_state
 * @returns {Function}           unsubscribe (call from page.unmount)
 */
export function bindSamplePanelToSlot(panel_state, slot) {
  if (!panel_state || !panel_state.selection || !slot || !slot.render_state) {
    return () => {};
  }
  const rs = slot.render_state;
  const sel = panel_state.selection;
  // Loop guard: while we're applying a slot-originated change to the
  // panel, do not push back.
  let applying = false;

  const unsubFromSlot = subscribeMglRenderState(rs, (s, keys) => {
    applying = true;
    try {
      if (keys.indexOf('hover_sample') >= 0) {
        const v = s.hover_sample;
        sel.setHoveredSample(Number.isFinite(v) ? v : null);
      }
      if (keys.indexOf('selected_samples') >= 0 && (s.selected_samples instanceof Set)) {
        const panelSet = sel.getSelectedSamples();
        if (!_sameSet(panelSet, s.selected_samples)) {
          sel.clearSelection();
          for (const v of s.selected_samples) sel.toggleSelectedSample(v);
        }
      }
    } finally { applying = false; }
  });

  const unsubFromPanel = sel.subscribe(() => {
    if (applying) return;
    // Push hover.
    const hv = sel.getHoveredSample();
    setHover(rs, Number.isFinite(hv) ? hv : null, undefined);
    // Push selection (replace if different — fresh Set reference so
    // updateMglRenderState's !== comparison fires).
    const panelSet = sel.getSelectedSamples();
    if (!_sameSet(rs.selected_samples, panelSet)) {
      updateMglRenderState(rs, { selected_samples: new Set(panelSet) });
    }
  });

  return () => { unsubFromSlot(); unsubFromPanel(); };
}

// =====================================================================
// 3. Adapter for the similarity panel — hovered_cell.{i,j}
// =====================================================================

/**
 * Bind the similarity panel: its hover is a cell {i, j}, but we
 * propagate only the row sample (i) into the slot.
 *
 * @param {Object} panel_state    similarity-panel page state
 * @param {Object} slot
 * @returns {Function}            unsubscribe
 */
export function bindSimilarityPanelToSlot(panel_state, slot) {
  if (!panel_state || !panel_state.selection || !slot || !slot.render_state) {
    return () => {};
  }
  const rs = slot.render_state;
  const sel = panel_state.selection;
  let applying = false;

  const unsubFromSlot = subscribeMglRenderState(rs, (s, keys) => {
    applying = true;
    try {
      if (keys.indexOf('hover_sample') >= 0) {
        const v = s.hover_sample;
        if (Number.isFinite(v)) sel.setHoveredCell({ i: v, j: v });
        else                    sel.setHoveredCell(null);
      }
      if (keys.indexOf('selected_samples') >= 0 && (s.selected_samples instanceof Set)) {
        const panelSet = sel.getSelectedSamples();
        if (!_sameSet(panelSet, s.selected_samples)) {
          sel.clearSelection();
          for (const v of s.selected_samples) sel.toggleSelectedSample(v);
        }
      }
    } finally { applying = false; }
  });

  const unsubFromPanel = sel.subscribe(() => {
    if (applying) return;
    const cell = sel.getHoveredCell();
    const hv = cell && Number.isFinite(cell.i) ? cell.i : null;
    setHover(rs, hv, undefined);
    const panelSet = sel.getSelectedSamples();
    if (!_sameSet(rs.selected_samples, panelSet)) {
      updateMglRenderState(rs, { selected_samples: new Set(panelSet) });
    }
  });

  return () => { unsubFromSlot(); unsubFromPanel(); };
}

// =====================================================================
// 4. Adapter for the dosage-heatmap panel — hovered_cell.sample_idx
// =====================================================================

/**
 * Bind the dosage-heatmap panel: its hover is a cell {row, col,
 * marker_idx, sample_idx, dosage}.
 *
 * @param {Object} panel_state    dosage-heatmap page state
 * @param {Object} slot
 * @returns {Function}            unsubscribe
 */
export function bindDosageHeatmapPanelToSlot(panel_state, slot) {
  if (!panel_state || !panel_state.selection || !slot || !slot.render_state) {
    return () => {};
  }
  const rs = slot.render_state;
  const sel = panel_state.selection;
  let applying = false;

  // Cross-panel hover INTO the heatmap is intentionally a no-op:
  // the heatmap's hovered_cell is a {row, col, marker_idx,
  // sample_idx} object and we don't know the row/col without doing
  // a re-paint. Selection propagation (which draws a row underlay)
  // gives users the visual link they want.
  const unsubFromSlot = subscribeMglRenderState(rs, (s, keys) => {
    applying = true;
    try {
      if (keys.indexOf('selected_samples') >= 0 && (s.selected_samples instanceof Set)) {
        const panelSet = sel.getSelectedSamples();
        if (!_sameSet(panelSet, s.selected_samples)) {
          sel.clearSelection();
          for (const v of s.selected_samples) sel.toggleSelectedSample(v);
        }
      }
    } finally { applying = false; }
  });

  const unsubFromPanel = sel.subscribe(() => {
    if (applying) return;
    const cell = sel.getHoveredCell();
    const hv = cell && Number.isFinite(cell.sample_idx) ? cell.sample_idx : null;
    setHover(rs, hv, undefined);
    const panelSet = sel.getSelectedSamples();
    if (!_sameSet(rs.selected_samples, panelSet)) {
      updateMglRenderState(rs, { selected_samples: new Set(panelSet) });
    }
  });

  return () => { unsubFromSlot(); unsubFromPanel(); };
}

// =====================================================================
// 5. Top-level convenience: bind everything detectable on atlasState
// =====================================================================

/**
 * Walk atlasState.inversion and bind whichever sample-keyed panel
 * stashes are present (PCA / similarity / dosage-heatmap) to the
 * given mglCandidateMode slot.
 *
 * @param {Object} atlasState
 * @param {Object} slot
 * @returns {Function}    unsubscribe-all
 */
export function bindAllPanelsToCandidateMode(atlasState, slot) {
  const inv = atlasState && atlasState.inversion;
  if (!inv || !slot || !slot.render_state) return () => {};
  const unsubs = [];
  if (inv._page_pca_panel_state) {
    unsubs.push(bindSamplePanelToSlot(inv._page_pca_panel_state, slot));
  }
  if (inv._page_similarity_panel_state) {
    unsubs.push(bindSimilarityPanelToSlot(inv._page_similarity_panel_state, slot));
  }
  if (inv._page_dosage_heatmap_state) {
    unsubs.push(bindDosageHeatmapPanelToSlot(inv._page_dosage_heatmap_state, slot));
  }
  return () => { for (const u of unsubs) { try { u(); } catch (_) {} } };
}
