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
import { detectNestedInversion } from '../../shared/mgl_nested_detector.js';

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
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshNestedDetector(pageState); }
  catch (e) { console.warn('nested_inversion_detector.mount: refresh threw —', e); }

  try { initNestedDetectorToolbar(); }
  catch (e) { console.warn('nested_inversion_detector.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_nested_inversion_detector_state = pageState;
  }

  // 2026-05-20: auto-run detectNestedInversion on direct mount. Builds
  // a per-stratum-per-window PC set from the local_pca_dosage data
  // (filtering the full-cohort PC1/PC2 per window down to each
  // stratum's sample subset). This is a proxy — the strict version
  // would re-run PCA on each stratum subset — but the cluster
  // structure within each stratum still surfaces and the page renders
  // a meaningful verdict instead of the "feed detectNestedInversion
  // first" empty state.
  if (!pageState.detector_result) {
    try {
      await _autoDetectNested(root, atlasState, registry);
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshNestedDetector(pageState); }
      catch (e) { console.warn('nested_inversion_detector.mount: post-autodetect refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_nested_inversion_detector_state = pageState;
      }
    } catch (e) {
      console.warn('nested_inversion_detector.mount: auto-detect failed:', e);
    }
  }
}

// Build per_stratum_per_window_pcs from the local_pca_dosage data + the
// focal L2's K-means assignment, then call detectNestedInversion. The
// resulting verdict + per-stratum inner-band candidates + contiguous
// inner intervals land on inv.nested_detector_state. Silently returns
// when prerequisites are missing.
async function _autoDetectNested(root, atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.nested_detector_state || {};
  if (existing.detector_result) return;
  // 2026-05-20: fall back to a fresh registry resolve when the stash
  // isn't populated, so this page works as a first-mount destination.
  const stash = inv._local_pca_dosage_state;
  let data = (stash && stash.data) || null;
  if (!data && registry) {
    const chrom = atlasState.shared && atlasState.shared.activeChrom;
    if (chrom) {
      try { data = await registry.resolve('scrubber_main', { chrom }); }
      catch (e) {
        console.warn('nested_inversion_detector: scrubber_main resolve threw —', e);
      }
    }
  }
  if (!data || !Array.isArray(data.windows)) {
    _setLoadingHint(root, 'no scrubber data on this chromosome.');
    return;
  }
  const wins = data.windows;
  const nW = wins.length;
  const nS = data.n_samples | 0;
  if (nW <= 0 || nS <= 0) return;
  // Pull labels via priority: lockedLabels > stash focal-L2 K-means >
  // auto-cluster the active window's PC1×PC2 via K-means K=3 (so the
  // page works even when local_pca_dosage hasn't run yet).
  let labels = stash && stash.lockedLabels;
  if (!labels) {
    const cur = (stash && Number.isFinite(stash.cur)) ? (stash.cur | 0)
              : Math.floor(nW / 2);
    const w = wins[Math.max(0, Math.min(nW - 1, cur))];
    if (w && w.pc1 && w.pc2) {
      try {
        const km = await import('../../shared/kmeans.js').catch(() => null);
        if (km && typeof km.kmeans2D === 'function') {
          const result = km.kmeans2D(w.pc1, w.pc2, 3);
          if (result && result.labels) labels = result.labels;
        }
      } catch (e) {
        console.warn('nested_inversion_detector: K-means fallback threw —', e);
      }
    }
  }
  if (!labels) {
    _setLoadingHint(root, 'no K-means labels available — lock colors on a focal L2 in local_pca_dosage first (🔒 button).');
    return;
  }
  // Group sample indices by label.
  const idxByLabel = [[], [], []];
  for (let s = 0; s < nS; s++) {
    const k = labels[s];
    if (k >= 0 && k < 3) idxByLabel[k].push(s);
  }
  const strataNames = ['HOM1', 'HET', 'HOM2'];
  const per_stratum_per_window_pcs = Object.create(null);
  for (let st = 0; st < 3; st++) {
    const idx = idxByLabel[st];
    const per_window = new Array(nW);
    for (let i = 0; i < nW; i++) {
      const w = wins[i];
      if (!w || !w.pc1 || !w.pc2) { per_window[i] = { idx: i, pcs: [] }; continue; }
      const pc1Sub = new Float64Array(idx.length);
      const pc2Sub = new Float64Array(idx.length);
      for (let j = 0; j < idx.length; j++) {
        pc1Sub[j] = +w.pc1[idx[j]] || 0;
        pc2Sub[j] = +w.pc2[idx[j]] || 0;
      }
      per_window[i] = { idx: i, pcs: [pc1Sub, pc2Sub] };
    }
    per_stratum_per_window_pcs[strataNames[st]] = per_window;
  }
  // Build parent_karyotype mapping 0/1/2 → HOM1/HET/HOM2 for the
  // detector's verdict + stratum-size gating.
  const parent_karyotype = new Array(nS);
  for (let s = 0; s < nS; s++) {
    const k = labels[s];
    parent_karyotype[s] = (k === 0) ? 'HOM1'
                       : (k === 1) ? 'HET'
                       : (k === 2) ? 'HOM2'
                       : null;
  }
  let result = null;
  try {
    result = detectNestedInversion({
      per_stratum_per_window_pcs,
      parent_karyotype,
    });
  } catch (e) {
    _setLoadingHint(root, `detectNestedInversion threw: ${e && e.message ? e.message : 'error'}`);
    return;
  }
  inv.nested_detector_state = Object.assign({}, existing, {
    detector_result: result,
    candidate_label: existing.candidate_label || (data.chrom || null),
    n_windows:       nW,
  });
}

function _setLoadingHint(root, msg) {
  const el = (root && root.querySelector && root.querySelector('#nestedDetectorEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('nestedDetectorEmpty'));
  if (el) {
    el.style.display = '';
    el.textContent = msg;
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
