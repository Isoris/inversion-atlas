// pages/discovery/local_pca_dosage/_state.js
//
// State module for the local_pca_dosage split (round 4, 2026-05-06).
//
// This module owns the local_pca_dosage-private `_pageState` reference and the
// `_setActiveState(state)` setter. The other panel modules import
// `_pageState` (a `let` binding — ES live-binding semantics ensure they
// see the latest written value) and call `_setActiveState(state)` at the
// top of every public entry-point so helper bodies that read `_pageState`
// resolve to the active mount's state.
//
// Also hosts the state-bound color helpers (trackedColor, _vColor,
// _lineageColor, familyColor, ancestryColor, manualGroupColor,
// getSampleColor, _resolveSampleScopeColor). These functions read
// `_pageState` (or take `si` as their only arg and look up state
// internally), so they belong here alongside the state machinery.
//
// NOTE (chat 36 round 5 step 1, 2026-05-07): the FAMILY_PALETTE_BASE
// constant has been hoisted to atlases/inversion/shared/page1_data_helpers.js
// (its only consumer was buildFamilyPalette, which moved with it).
// Nothing in local_pca_dosage reads it from here any more, so it is no longer
// exported from this module.
//
// Bodies are verbatim extracts from the pre-split local_pca_dosage.js (round 3
// step 4, eighth pass). See that file's git history for legacy line
// numbers per function.

// manualGroupForSample is used by manualGroupColor below. Lives in
// manual_groups.js (which imports drawPCA/renderL3Panel — a mutual
// cycle with _state via getSampleColor). Both modules only reference
// each other from function bodies, so live-binding resolves them
// correctly at call time.
import { manualGroupForSample } from './manual_groups.js';

// _pageState: the module-level state reference. Every entry-point in
// every panel module sets this on entry via _setActiveState(state) so
// that helper bodies (which use `const state = _pageState;` injection)
// see the active mount's state. ES module live-binding semantics ensure
// importers see the latest written value.
export let _pageState = null;
export function _setActiveState(s) { _pageState = s; }

// runLineageCompute is imported here (rather than below `_lineageColor`)
// to keep all imports at the top per ESM convention. ESM hoists imports
// regardless of position, so this is purely stylistic.
import { runLineageCompute } from './lineage.js';
import {
  familyColor as _sharedFamilyColor,
  lineageColor as _sharedLineageColor,
  resolveSampleScopeColor as _sharedResolveSampleScopeColor,
} from '../../../shared/sample_color.js';
import { diagSampleColor } from './diag_residuals.js';
import { xpSampleColor } from '../../../shared/cross_page_clusters.js';
import { qaSampleColor } from '../../../shared/q_ancestry.js';

// =====================================================================
// Cache-invalidation helpers (legacy 34321 / 39362 / 39973)
// =====================================================================
// Reset the per-chromosome render caches so that the next paint after a
// data swap recomputes from scratch. Legacy versions read `state` as a
// global; here state is passed explicitly so the helpers compose with
// any state shape (local_pca_dosage's _pageState is the typical caller).

// --- _linesCacheInvalidate — legacy line 34321 ---
export function _linesCacheInvalidate(state) {
  if (!state) return;
  state.__linesCache = {};
}

// --- invalidateLineageCache — legacy lines 39362-39367 ---
export function invalidateLineageCache(state) {
  if (!state) return;
  state.lineageResult = null;
  state.lineageCacheKey = null;
}

// --- _bandTraceClearCache — legacy lines 39973-39982 ---
export function _bandTraceClearCache(state) {
  if (!state) return;
  state.bandTraceCache = null;
  state.bandTraceCacheKey = null;
  // turn 162 — also clear the hit-region stash so stale rectangles from
  // a prior chromosome can't fire false positives in the tooltip handler
  // before drawLinesPanel runs against the new chromosome.
  state._btraceHits = null;
}

// --- Family / lineage palette small-cohort fallbacks ---
// (Hoisted to shared/sample_color.js. The familyColor wrapper below
// just delegates to the shared resolver.)

// --- Generic tracked-sample / ancestry palette — legacy line 9791 ---
// Used by trackedColor() and ancestryColor() below. 8 distinct colors.
const PALETTE = [
  '#f5a524', '#4fa3ff', '#3cc08a', '#e0555c',
  '#b07cf7', '#f0d56a', '#7ad3db', '#ff8c6e',
];

// --- trackedColor — legacy lines 35959-35959 ---
export function trackedColor(si) {
  const state = _pageState;
  return PALETTE[state.tracked.indexOf(si) % PALETTE.length];
}

// --- _vColor — legacy lines 36125-36145 ---
export function _vColor(v) {
  if (v == null || !isFinite(v)) return 'rgba(40,46,58,0.5)';   // gray for missing
  // Hot end: warm orange-red. Cold end: deep blue.
  // Use a 5-point ramp tuned for the existing palette (orange highlights).
  const stops = [
    [0.00, [60,  100, 180]],   // cold blue
    [0.25, [80,  140, 200]],   // pale blue
    [0.50, [200, 200, 200]],   // gray midpoint
    [0.75, [240, 175,  60]],   // warm amber
    [1.00, [232,  90,  60]],   // hot red
  ];
  let v0 = stops[0], v1 = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i][0] && v <= stops[i+1][0]) { v0 = stops[i]; v1 = stops[i+1]; break; }
  }
  const t = (v1[0] === v0[0]) ? 0 : (v - v0[0]) / (v1[0] - v0[0]);
  const r = Math.round(v0[1][0] + (v1[1][0] - v0[1][0]) * t);
  const g = Math.round(v0[1][1] + (v1[1][1] - v0[1][1]) * t);
  const b = Math.round(v0[1][2] + (v1[1][2] - v0[1][2]) * t);
  return `rgb(${r},${g},${b})`;
}

// --- _lineageColor — wraps shared.lineageColor with auto-trigger ---
// local_pca_dosage schedules the lineage compute via requestIdleCallback on first
// reference. The pure shared.lineageColor returns null when the result
// isn't ready; the wrapper here adds the scheduling so subsequent
// paints find a populated state.lineageResult.
export function _lineageColor(si) {
  const _state = _pageState;
  if (!_state || !_state.data) return null;
  // Auto-trigger compute on first reference. Mirrors the pattern in
  // _drawInheritanceLabelsStrip — schedule via requestIdleCallback so
  // the current paint completes; the next paint picks up the result.
  if (!_state.lineageResult
      && !_state._lineageComputeScheduled
      && _state.data.l2_envelopes && _state.data.l2_envelopes.length >= 3) {
    _state._lineageComputeScheduled = true;
    const fire = () => {
      _state._lineageComputeScheduled = false;
      try { runLineageCompute(_state); } catch (_) {}
      if (typeof window !== 'undefined' && typeof window.requestRepaint === 'function') {
        try { window.requestRepaint(); } catch (_) {}
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(fire, { timeout: 200 });
    } else {
      setTimeout(fire, 0);
    }
    return null;
  }
  return _sharedLineageColor(_state, si);
}

// --- familyColor — wraps shared.familyColor with local_pca_dosage's _pageState ---
function familyColor(si) {
  return _sharedFamilyColor(_pageState, si);
}

// --- ancestryColor — legacy lines 35950-35958 ---
function ancestryColor(sIdx) {
  const state = _pageState;
  const a = state.data.samples[sIdx].ancestry || 'unknown';
  if (!state.ancestryPalette) state.ancestryPalette = {};
  if (!state.ancestryPalette[a]) {
    const keys = Object.keys(state.ancestryPalette);
    state.ancestryPalette[a] = PALETTE[keys.length % PALETTE.length];
  }
  return state.ancestryPalette[a];
}

// --- manualGroupColor — legacy lines 48011-48014 ---
function manualGroupColor(si) {
  const g = manualGroupForSample(si);
  return g ? g.color : '#5a6472';   // muted grey for unassigned
}

// --- getSampleColor — legacy lines 47816-47845 ---
export function getSampleColor(si, mode, groupLabels) {
  const state = _pageState;
  mode = mode || state.colorMode || 'cluster';
  if (mode === 'cluster') {
    // 2026-05-18: Phase 1 of SPEC_macrostripe_microgroup_hierarchy.md.
    // When state.useMacrostripeColors is on AND state.bandingResult is
    // populated for the current chrom, override the per-window K-means
    // microgroup color with the per-sample macrostripe color (derived
    // from band-tracking Stage 3 sample sets). When OFF or banding not
    // run, fall through to today's K-means microgroup palette.
    if (state && state.useMacrostripeColors && state.bandingResult) {
      try {
        // Lazy-import to keep the _state module's static graph thin —
        // shared/macrostripe.js pulls in band_tracking/locus_construction
        // which has its own dependency chain.
        const ms = (typeof window !== 'undefined' && window._getMacrostripeColor)
          ? window._getMacrostripeColor(state, si)
          : null;
        if (ms) return ms;
      } catch (_) { /* fail-soft → drop to K-means below */ }
    }
    if (groupLabels && groupLabels[si] != null && groupLabels[si] >= 0) {
      return ['#4fa3ff', '#b8b8b8', '#f5a524', '#3cc08a', '#e0555c'][groupLabels[si]] || '#888';
    }
    return '#888';
  }
  // v4 turn 83: residual mode — recolor by per-fish residual_z from the
  // focal-window K-means band centroid. Cool blue = clean homozygote;
  // amber = intermediate; red = suspicious (≥2.5σ from band centroid).
  // Compute lives in local_pca_dosage/diag_residuals.js.
  if (mode === 'residual') {
    return diagSampleColor(state, si, state.cur);
  }
  // v4 turn 84: cross-page cluster modes — color by another page's clusters
  // for the active candidate. When the requested source has no clusters
  // loaded for this candidate, falls through to grey so the user can see
  // that the source is missing rather than a misleading default.
  if (mode === 'cluster_dosage')   return xpSampleColor(state, si, 'dosage');
  if (mode === 'cluster_theta_pi') return xpSampleColor(state, si, 'theta_pi');
  if (mode === 'cluster_ghsl')     return xpSampleColor(state, si, 'ghsl');
  // v4 turn 86: Q-association ancestry mode — color by per-fish Q-vector at
  // the user-selected K. Two sub-modes (hard / blend) selected via
  // state.qDisplayMode. Falls through to grey if no Q-vectors are loaded.
  if (mode === 'q_ancestry') return qaSampleColor(state, si);
  if (mode === 'family')   return familyColor(si);
  if (mode === 'ancestry') return ancestryColor(si);
  if (mode === 'manual')   return manualGroupColor(si);
  /* mode === 'none' */    return '#888';
}

// --- _resolveSampleScopeColor — local_pca_dosage-flavoured wrapper ---
// Uses local_pca_dosage's _lineageColor (with the auto-trigger scheduling) for
// 'lineage' mode, otherwise defers to the pure shared resolver. The
// shared resolver alone is what haplotype_regimes and any future page consumes
// — they import resolveSampleScopeColor from shared/sample_color.js
// and never reach into this module.
export function _resolveSampleScopeColor(si, mode) {
  if (mode === 'lineage') return _lineageColor(si);
  return _sharedResolveSampleScopeColor(_pageState, si, mode);
}
