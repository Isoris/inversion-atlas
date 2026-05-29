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
import { kmeans2D } from '../../shared/kmeans.js';
import { fitCanvasNoDpr } from '../../shared/page1_utils.js';

// 2026-05-29: cap the per-window scan so a genome-wide fallback (no
// focal L2) stays responsive. Focal-L2 scope is almost always far
// smaller than this.
const NESTED_MAX_SCAN_WINDOWS = 1500;
// Width of the "cursor slab" scope (windows, centred on the cursor).
const NESTED_CURSOR_SLAB = 500;
const NESTED_SCOPE_LS_KEY = 'nested_detector.scope_mode';

// Mount context — root/atlasState/registry stashed so the scope selector
// can re-run the detector without a full page remount.
let _mountCtx = null;

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
  _mountCtx = { root, atlasState, registry };
  // 2026-05-29: invalidate a cached detector_result computed for a
  // DIFFERENT chromosome OR a different scope mode. Without this, the
  // auto-detect bails on `existing.detector_result` and the page keeps
  // showing the prior chrom's / scope's result (Quentin saw LG01 data
  // while LG27 was selected).
  const activeChrom = atlasState && atlasState.shared && atlasState.shared.activeChrom;
  const inv = (atlasState && atlasState.inversion) || {};
  const scopeMode = _readScopeMode();
  if (inv.nested_detector_state &&
      ((activeChrom && inv.nested_detector_state._chrom &&
        inv.nested_detector_state._chrom !== activeChrom) ||
       (inv.nested_detector_state._scope_mode &&
        inv.nested_detector_state._scope_mode !== scopeMode))) {
    inv.nested_detector_state = null;
  }

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
      await _autoDetectNested(root, atlasState, registry, scopeMode);
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
async function _autoDetectNested(root, atlasState, registry, scopeMode) {
  scopeMode = scopeMode || 'focal_l2';
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
      // 2026-05-26: contribute chromSummary (SPEC_multichrom Slice 1).
      if (data && typeof atlasState.setChromSummary === 'function') {
        try {
          const cs = await import('../../../../core/chrom_summary.js');
          atlasState.setChromSummary(chrom, cs.buildChromSummary(data, { chrom }));
        } catch (_) { /* non-essential */ }
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

  // -------------------------------------------------------------------
  // 2026-05-29 (a)+(b): scope-bounded, per-window karyotype detection.
  //
  // (a) SCOPE: restrict the scan to a window range chosen by the user's
  //     scope selector — focal L2 envelope / active candidate span /
  //     cursor slab / genome (capped). See _resolveScopeRange.
  //
  // (b) PER-WINDOW KARYOTYPE: re-cluster EACH window's cohort (PC1, PC2)
  //     into 3 parent strata via 2D K-means (kmeans2D already orders
  //     clusters by PC1, so label 0/1/2 = HOM1/HET/HOM2 consistently
  //     across windows). Then test each window-local stratum's PC2 (the
  //     secondary axis, orthogonal to the parent split) for inner 3-band
  //     structure. This is the correct method: it never broadcasts a
  //     single window's labels genome-wide, so it can't carpet the
  //     chromosome with the old label-drift false positives.
  // -------------------------------------------------------------------
  const cur = (stash && Number.isFinite(stash.cur)) ? (stash.cur | 0)
            : Math.floor(nW / 2);
  const { wStart, wEnd, scopeLabel, scopeWarn } =
    _resolveScopeRange(scopeMode, { stash, data, cur, nW, atlasState });

  const strataNames = ['HOM1', 'HET', 'HOM2'];
  const per_stratum_per_window_pcs = {
    HOM1: [], HET: [], HOM2: [],
  };
  // Representative parent karyotype (focal window) for the detector's
  // stratum-size gate.
  let parent_karyotype = null;

  for (let w = wStart; w <= wEnd; w++) {
    const win = wins[w];
    if (!win || !win.pc1 || !win.pc2) {
      for (const nm of strataNames) per_stratum_per_window_pcs[nm].push({ idx: w, pcs: [] });
      continue;
    }
    let km = null;
    try { km = kmeans2D(win.pc1, win.pc2, 3); } catch (_) { km = null; }
    if (!km || !km.labels) {
      for (const nm of strataNames) per_stratum_per_window_pcs[nm].push({ idx: w, pcs: [] });
      continue;
    }
    const lab = km.labels;
    // Stash the focal window's labels as the representative parent karyotype.
    if (w === Math.max(wStart, Math.min(wEnd, cur)) && !parent_karyotype) {
      parent_karyotype = new Array(nS);
      for (let s = 0; s < nS; s++) {
        const k = lab[s];
        parent_karyotype[s] = (k === 0) ? 'HOM1' : (k === 1) ? 'HET' : (k === 2) ? 'HOM2' : null;
      }
    }
    // Per window-local stratum, collect members' PC2 (secondary axis).
    const pc2By = [[], [], []];
    for (let s = 0; s < nS; s++) {
      const k = lab[s];
      if (k >= 0 && k < 3) pc2By[k].push(+win.pc2[s] || 0);
    }
    for (let st = 0; st < 3; st++) {
      per_stratum_per_window_pcs[strataNames[st]].push({
        idx: w,
        pcs: [Float64Array.from(pc2By[st])],
      });
    }
  }
  if (!parent_karyotype) {
    _setLoadingHint(root, 'no per-window PCA available on this chromosome.');
    return;
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
  // 2026-05-29: light saturation guard. With per-window karyotype the
  // old genome-wide label-drift carpet can't happen, but keep a soft
  // check against the SCANNED scope: if essentially every window in the
  // scope is flagged the silhouette threshold is too loose for this
  // cohort — flag it rather than present a wall of intervals as signal.
  const scopeW = Math.max(1, wEnd - wStart + 1);
  let warning = scopeWarn;
  try {
    const ivs = Array.isArray(result.inner_intervals) ? result.inner_intervals : [];
    let covered = 0;
    for (const iv of ivs) {
      const a = Number.isFinite(iv.window_start) ? iv.window_start : null;
      const b = Number.isFinite(iv.window_end)   ? iv.window_end   : a;
      if (a != null) covered += Math.max(0, b - a + 1);
    }
    const frac = covered / scopeW;
    if (frac > 0.9) {
      result.verdict = 'no_nested_structure';
      const note = `inner-band signal saturates the scanned scope `
                 + `(${(frac * 100).toFixed(0)}% of windows) — silhouette threshold likely too `
                 + `loose for this cohort; treat as no clear nested structure.`;
      warning = warning ? (warning + ' · ' + note) : note;
    }
  } catch (_) { /* non-fatal */ }
  inv.nested_detector_state = Object.assign({}, existing, {
    detector_result: result,
    warning,
    candidate_label: (data.chrom || existing.candidate_label || '') + ' · ' + scopeLabel,
    // 2026-05-29: stamp the chrom this result was computed for so mount()
    // can invalidate the cache on a chrom change.
    _chrom:          (atlasState.shared && atlasState.shared.activeChrom)
                       || data.chrom || null,
    _scope_mode:     scopeMode,
    // Render against the full chromosome so focal intervals sit at their
    // true genomic position on the track x-axis.
    n_windows:       nW,
  });
}

// =====================================================================
// Scope resolution (2026-05-29)
// =====================================================================
// Map a scope mode → window range [wStart, wEnd] (0-based, inclusive)
// plus a human label + optional warning. Supported modes:
//   focal_l2  — the focal L2 envelope from the local_pca_dosage stash
//   candidate — the active candidate's window span (shared.activeCandidate,
//               else the candidateList entry containing the cursor)
//   cursor    — a NESTED_CURSOR_SLAB-wide slab centred on the cursor
//   genome    — whole chromosome, capped at NESTED_MAX_SCAN_WINDOWS
// Each fall-through path degrades to a cursor slab with a warning so the
// page always produces *something* scoped rather than the old carpet.
function _resolveScopeRange(scopeMode, ctx) {
  const { stash, data, cur, nW, atlasState } = ctx;
  const clamp = (a, b) => ({
    wStart: Math.max(0, Math.min(nW - 1, a | 0)),
    wEnd:   Math.max(0, Math.min(nW - 1, b | 0)),
  });

  if (scopeMode === 'candidate') {
    const cand = _resolveActiveCandidate(stash, atlasState, cur);
    if (cand) {
      let s = null, e = null;
      if (Number.isFinite(cand.start_w) && Number.isFinite(cand.end_w)) {
        s = (cand.start_w | 0) - 1; e = (cand.end_w | 0) - 1;   // 1-based → 0-based
      } else if (Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp)) {
        const m = _bpRangeToWindows(data, cand.start_bp, cand.end_bp, nW);
        if (m) { s = m.s; e = m.e; }
      }
      if (s != null && e != null && e >= s) {
        const r = clamp(s, e);
        const name = (cand.label || cand.id || 'candidate');
        return { ...r, scopeLabel: `candidate ${name} (w ${r.wStart}-${r.wEnd})`, scopeWarn: null };
      }
    }
    const r = _centeredSlab(cur, nW);
    return { ...r, scopeLabel: `cursor slab (no candidate)`,
             scopeWarn: 'no candidate window-range available — open a candidate (or set start_w/end_w). Scanned a cursor slab instead.' };
  }

  if (scopeMode === 'cursor') {
    const r = _centeredSlab(cur, nW);
    return { ...r, scopeLabel: `cursor slab (w ${r.wStart}-${r.wEnd}, around ${cur})`, scopeWarn: null };
  }

  if (scopeMode === 'genome') {
    if (nW > NESTED_MAX_SCAN_WINDOWS) {
      const r = _centeredSlab(cur, nW, NESTED_MAX_SCAN_WINDOWS);
      return { ...r, scopeLabel: `genome (capped to w ${r.wStart}-${r.wEnd})`,
               scopeWarn: `genome scope capped to ${NESTED_MAX_SCAN_WINDOWS} windows around the cursor for responsiveness.` };
    }
    return { wStart: 0, wEnd: nW - 1, scopeLabel: 'genome', scopeWarn: null };
  }

  // focal_l2 (default)
  const w2l = stash && stash.windowToL2;
  const envs = data.l2_envelopes;
  if (w2l && Array.isArray(envs) && envs.length) {
    const li = w2l[Math.max(0, Math.min(nW - 1, cur))] | 0;
    const env = (li >= 0) ? envs[li] : null;
    if (env) {
      const s0 = Number.isFinite(env._s0) ? env._s0 : (env.start_w - 1);
      const e0 = Number.isFinite(env._e0) ? env._e0 : (env.end_w - 1);
      if (Number.isFinite(s0) && Number.isFinite(e0) && e0 >= s0) {
        const r = clamp(s0, e0);
        return { ...r, scopeLabel: `focal L2 (w ${r.wStart}-${r.wEnd}, window ${cur})`, scopeWarn: null };
      }
    }
  }
  const r = _centeredSlab(cur, nW);
  return { ...r, scopeLabel: `cursor slab (no focal L2)`,
           scopeWarn: 'no focal L2 envelope — lock colors on an L2 in local PCA |z|, or pick the candidate / cursor / genome scope. Scanned a cursor slab.' };
}

// Centred window slab. `width` defaults to NESTED_CURSOR_SLAB.
function _centeredSlab(cur, nW, width) {
  const w = Math.min(nW, Math.max(2, width || NESTED_CURSOR_SLAB));
  const half = w >> 1;
  let s = Math.max(0, (cur | 0) - half);
  let e = Math.min(nW - 1, s + w - 1);
  s = Math.max(0, e - w + 1);
  return { wStart: s, wEnd: e };
}

// Active candidate: shared.activeCandidate, else the candidateList entry
// whose window span contains the cursor, else the first candidate.
function _resolveActiveCandidate(stash, atlasState, cur) {
  const active = atlasState && atlasState.shared && atlasState.shared.activeCandidate;
  if (active) return active;
  const cands = (stash && Array.isArray(stash.candidateList)) ? stash.candidateList : [];
  for (const c of cands) {
    if (!c) continue;
    const s = Number.isFinite(c.start_w) ? (c.start_w - 1) : null;
    const e = Number.isFinite(c.end_w)   ? (c.end_w - 1)   : null;
    if (s != null && e != null && cur >= s && cur <= e) return c;
  }
  return cands.length ? cands[0] : null;
}

// Map a [startBp, endBp] interval to inclusive window indices via each
// window's center_mb (×1e6) or start_bp. Returns { s, e } or null.
function _bpRangeToWindows(data, startBp, endBp, nW) {
  const wins = data.windows;
  let s = null, e = null;
  for (let i = 0; i < nW; i++) {
    const w = wins[i];
    if (!w) continue;
    const c = Number.isFinite(w.center_mb) ? w.center_mb * 1e6
            : Number.isFinite(w.start_bp)  ? w.start_bp
            : null;
    if (c == null) continue;
    if (c >= startBp && c <= endBp) { if (s == null) s = i; e = i; }
  }
  return (s != null && e != null) ? { s, e } : null;
}

// localStorage-backed scope mode (default focal_l2).
function _readScopeMode() {
  try {
    const v = localStorage.getItem(NESTED_SCOPE_LS_KEY);
    if (v === 'focal_l2' || v === 'candidate' || v === 'cursor' || v === 'genome') return v;
  } catch (_) {}
  return 'focal_l2';
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
    warning:              ns ? (ns.warning || null) : null,
    scope_mode:           _readScopeMode(),
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
  const scopeSel = document.getElementById('nestedDetectorScope');
  if (scopeSel && state.scope_mode) scopeSel.value = state.scope_mode;
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
  // 2026-05-29: reliability warning banner (saturation guard).
  const warn = document.getElementById('nestedDetectorWarning');
  if (warn) {
    if (state.warning) {
      warn.style.display = '';
      warn.textContent = '⚠ ' + state.warning;
    } else {
      warn.style.display = 'none';
      warn.textContent = '';
    }
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
  // 2026-05-26: fit canvas backing buffer to CSS box (renderer reads
  // canvas.width/.height directly; default 300×150 → invisible content).
  fitCanvasNoDpr(canvas);
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

  // 2026-05-29: scope selector — re-run the detector for the chosen
  // bound (focal L2 / candidate / cursor slab / genome) and re-render.
  const onScopeChange = (ev) => {
    const mode = (ev && ev.target && ev.target.value) || 'focal_l2';
    try { localStorage.setItem(NESTED_SCOPE_LS_KEY, mode); } catch (_) {}
    if (!_mountCtx) return;
    const { root, atlasState, registry } = _mountCtx;
    const inv = (atlasState && atlasState.inversion) || {};
    inv.nested_detector_state = null;   // force re-detect
    _setLoadingHint(root, `re-scanning (${mode})…`);
    _autoDetectNested(root, atlasState, registry, mode)
      .then(() => {
        const ps = _buildPageState(atlasState);
        _setActiveState(ps);
        refreshNestedDetector(ps);
        if (atlasState.inversion) atlasState.inversion._page_nested_inversion_detector_state = ps;
        // Tear down THIS (old) state's DOM listeners before re-wiring the
        // fresh state, else listeners on the (unchanged) canvas/select
        // elements would accumulate.
        _teardownToolbar(state);
        _wireToolbar(ps);
      })
      .catch((e) => console.warn('nested_inversion_detector: scope re-detect threw —', e));
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onCanvasMove, onCanvasClick, onScopeChange, unsubSelection,
  };
  _addListener('nestedDetectorTracksCanvas', 'mousemove', onCanvasMove);
  _addListener('nestedDetectorTracksCanvas', 'click',     onCanvasClick);
  _addListener('nestedDetectorScope',        'change',    onScopeChange);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onCanvasMove)   _removeListener('nestedDetectorTracksCanvas', 'mousemove', h.onCanvasMove);
  if (h.onCanvasClick)  _removeListener('nestedDetectorTracksCanvas', 'click',     h.onCanvasClick);
  if (h.onScopeChange)  _removeListener('nestedDetectorScope',        'change',    h.onScopeChange);
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
