// shared/mgl_candidate_mode.js
// =====================================================================
// Lifecycle helpers for the local_pca_dosage multi-allelic candidate-mode state
// slot (HANDOFF_2 §"Component 1: candidate-mode state machine").
//
// Lives at `state.mglCandidateMode` on local_pca_dosage's legacy state. The
// existing `state.candidateMode` boolean is unrelated legacy
// scrub-vs-candidate UI plumbing and is left alone.
//
// What lives in the slot:
//   - The active candidate id + bp interval
//   - A coordinated MglRenderState instance (controls + selection)
//   - Caches for loaded PCA and heatmap layers (canonical shape,
//     coming from EITHER mgl_pca_json.fromPrecomputedJson or
//     mgl_pca_compute.computePcaForWindowList — caller chooses)
//   - A cache for loaded Beagle text (per (candidate_id × view) key),
//     so the live-compute path doesn't re-parse on every recompute
//   - Pointers to the currently-active PCA + heatmap result for
//     the renderer to draw
//
// Pure compute / state plumbing. No DOM, no fetch.
// =====================================================================

import { createMglRenderState, updateMglRenderState } from './mgl_render_state.js';

// =====================================================================
// 1. Default slot shape
// =====================================================================

/**
 * Build a fresh slot. Renderers read `slot.active` to decide whether
 * to paint the candidate-mode view at all.
 *
 * @param {Object} [opts]
 * @returns {Object}
 */
export function createMglCandidateModeSlot(opts) {
  const o = opts || {};
  return {
    active:         false,
    candidate_id:   null,
    interval:       null,           // { chrom, start, end }
    render_state:   createMglRenderState(o.render_state_init || {}),
    // Caches keyed by canonical-name strings. The actual values are
    // outputs of fromPrecomputedJson / computePcaForWindowList etc.
    loaded_pca:     Object.create(null),
    loaded_heatmap: Object.create(null),
    loaded_beagle:  Object.create(null),
    // Currently-active in-memory result objects.
    active_pca:     null,
    active_heatmap: null,
  };
}

// =====================================================================
// 2. Activate / deactivate
// =====================================================================

/**
 * Mark the slot active for a specific candidate. Updates the
 * candidate id + interval. Does NOT load any JSON or compute
 * anything — the caller is responsible for calling
 * registerPcaResult / registerHeatmapResult / setActivePca etc.
 *
 * @param {Object} slot
 * @param {{ candidate_id:string,
 *           chrom:string, start:number, end:number }} candidate
 */
export function activateForCandidate(slot, candidate) {
  if (!slot || !candidate) return;
  slot.active       = true;
  slot.candidate_id = candidate.candidate_id || null;
  slot.interval     = {
    chrom: candidate.chrom || null,
    start: Number.isFinite(candidate.start) ? candidate.start : null,
    end:   Number.isFinite(candidate.end)   ? candidate.end   : null,
  };
}

/**
 * Deactivate without dropping the caches — the user might come
 * back. To fully reset, call resetMglCandidateModeSlot.
 *
 * @param {Object} slot
 */
export function deactivate(slot) {
  if (!slot) return;
  slot.active = false;
}

/** Reset to empty — drops every cached layer. */
export function resetMglCandidateModeSlot(slot) {
  if (!slot) return;
  slot.active = false;
  slot.candidate_id = null;
  slot.interval = null;
  slot.loaded_pca = Object.create(null);
  slot.loaded_heatmap = Object.create(null);
  slot.loaded_beagle = Object.create(null);
  slot.active_pca = null;
  slot.active_heatmap = null;
}

// =====================================================================
// 3. Cache keys + registration
// =====================================================================

/**
 * Canonical cache key for a PCA layer. Mirrors
 * mgl_pca_json.pcaFilenameFor but with a stripped extension so it
 * can index loaded_pca regardless of the source path.
 */
export function pcaCacheKey(view, weighting, anchor) {
  return `${view}|${weighting}|${anchor}`;
}

export function heatmapCacheKey(view, weighting, centering_anchor) {
  return `${view}|${weighting}|${centering_anchor}`;
}

export function beagleCacheKey(candidate_id, view) {
  return `${candidate_id}|${view}`;
}

/**
 * Store a PCA result in the cache. The renderer fetches it back via
 * getActivePca() once setActivePca() points at the matching key.
 *
 * @param {Object} slot
 * @param {string} view
 * @param {string} weighting   'weighted' | 'unweighted'
 * @param {string} anchor      'bi_baseline' | 'view_self' | 'none' | 'both'
 * @param {Object} result      output of fromPrecomputedJson or
 *                              computePcaForWindowList
 */
export function registerPcaResult(slot, view, weighting, anchor, result) {
  if (!slot || !result) return;
  slot.loaded_pca[pcaCacheKey(view, weighting, anchor)] = result;
}

export function registerHeatmapResult(slot, view, weighting, centering, result) {
  if (!slot || !result) return;
  slot.loaded_heatmap[heatmapCacheKey(view, weighting, centering)] = result;
}

export function registerBeagleText(slot, candidate_id, view, text) {
  if (!slot || typeof text !== 'string') return;
  slot.loaded_beagle[beagleCacheKey(candidate_id, view)] = text;
}

// =====================================================================
// 4. Activate a specific (view × weighting × anchor) triple
// =====================================================================

/**
 * Switch the currently-active PCA + heatmap to a specific (view ×
 * weighting × anchor × centering) combination. Looks up the cached
 * results; if either isn't present, the corresponding active_* is
 * set to null (the renderer should show an empty state).
 *
 * Side effect: also updates `slot.render_state` so the controls
 * reflect the new choice. Subscribers of the render state get
 * notified.
 *
 * @param {Object} slot
 * @param {{view_name:string, weighting:string, anchor_mode:string,
 *          centering_anchor:string}} choice
 */
export function activatePcaHeatmapChoice(slot, choice) {
  if (!slot || !choice) return;
  const view      = choice.view_name        || slot.render_state.view_name;
  const weighting = choice.weighting        || slot.render_state.weighting;
  const anchor    = choice.anchor_mode      || slot.render_state.anchor_mode;
  const center    = choice.centering_anchor || slot.render_state.centering_anchor;
  slot.active_pca     = slot.loaded_pca[pcaCacheKey(view, weighting, anchor)]    || null;
  slot.active_heatmap = slot.loaded_heatmap[heatmapCacheKey(view, weighting, center)] || null;
  updateMglRenderState(slot.render_state, {
    view_name:        view,
    weighting,
    anchor_mode:      anchor,
    centering_anchor: center,
  });
}

// =====================================================================
// 5. Accessors
// =====================================================================

export function getActivePca(slot)     { return slot && slot.active_pca || null; }
export function getActiveHeatmap(slot) { return slot && slot.active_heatmap || null; }
export function getRenderState(slot)   { return slot && slot.render_state || null; }

/** Inspect cache size for diagnostics. */
export function cacheStats(slot) {
  if (!slot) return { pca: 0, heatmap: 0, beagle: 0 };
  return {
    pca:     Object.keys(slot.loaded_pca).length,
    heatmap: Object.keys(slot.loaded_heatmap).length,
    beagle:  Object.keys(slot.loaded_beagle).length,
  };
}
