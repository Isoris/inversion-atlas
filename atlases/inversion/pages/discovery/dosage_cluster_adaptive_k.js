// pages/discovery/dosage_cluster_adaptive_k.js
// =====================================================================
// Dosage clustering panel — atlas-side cartridge for HANDOFF_8 /
// SPEC_0 §11.8.
//
// Phase 1 scope:
//   - Per-cluster mean dosage curves rendered on a single canvas
//   - Verdict badge (structure_detected / no_structure /
//     insufficient_data) + K_chosen badge
//   - Per-K table in the right panel (silhouette, stability,
//     min_size, spatial_coherence, Δsil, passes); click a row to
//     focus that K's curves
//   - Cluster-size legend below
//
// Input contract:
//   atlasState.inversion.dosage_cluster_state = {
//     cluster_result:   shared/mgl_dosage_clustering
//                         .adaptiveKDosageClustering output,
//     candidate_label?: string,
//   }
// =====================================================================

import { _pageState, _setActiveState } from './dosage_cluster_adaptive_k/_state.js';
import {
  paintClusterCurves,
  findClusterAtPixel,
  verdictColor,
  verdictLabel,
  clusterColor,
} from './dosage_cluster_adaptive_k/renderer.js';
import {
  createDosageClusterSelection,
  summariseKEntry,
  entryToDisplay,
  clusterSizesFromLabels,
} from './dosage_cluster_adaptive_k/selection.js';

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshDosageCluster(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintCurves(_pageState);
  _renderPerK(_pageState);
  _renderChosenDetail(_pageState);
}

export function initDosageClusterToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshDosageCluster(pageState); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.mount: refresh threw —', e); }

  try { initDosageClusterToolbar(); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_dosage_cluster_adaptive_k_state = pageState;
  }

  // 2026-05-20 perf: compute is OPT-IN. Previously this page auto-ran
  // adaptiveKDosageClustering on mount, which blocked the main thread
  // for 3–8 s on long chromosomes and froze the whole atlas (user
  // report: "this page makes everything crash always"). Now:
  //   - On mount: only try to load a previously-cached result from
  //     sessionStorage. If hit, refresh. If miss, do NOTHING — show
  //     the empty hint that directs the user to click ▶ Compute.
  //   - The ▶ Compute button (wired in _wireToolbar) is the only entry
  //     point to the heavy sync K-means + bootstrap + silhouette run.
  // Net effect: navigating to this page never blocks. The user only
  // pays the compute cost when they explicitly ask for it, and only
  // once per (chrom, n_samples, n_windows) per session.
  if (!pageState.cluster_result) {
    try {
      const loaded = _tryLoadCachedClustering(atlasState);
      if (loaded) {
        pageState = _buildPageState(atlasState);
        _setActiveState(pageState);
        try { refreshDosageCluster(pageState); }
        catch (e) { console.warn('dosage_cluster_adaptive_k.mount: post-cache refresh threw —', e); }
        if (atlasState.inversion) {
          atlasState.inversion._page_dosage_cluster_adaptive_k_state = pageState;
        }
      } else {
        // No cached result — show the empty hint with Compute prompt.
        _setLoadingHint(root, '');
      }
    } catch (e) {
      console.warn('dosage_cluster_adaptive_k.mount: cache-load failed:', e);
    }
  }

  // Wire the ▶ Compute button — explicit user-triggered compute.
  try {
    _wireComputeButton(root, atlasState, registry);
  } catch (e) {
    console.warn('dosage_cluster_adaptive_k.mount: compute-button wiring threw —', e);
  }
}

// Read cached clustering result (if any) into atlasState.inversion.
// Returns true on cache hit. Does NOT trigger any compute.
function _tryLoadCachedClustering(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.dosage_cluster_state || {};
  if (existing.cluster_result) return true;
  const stash = inv._local_pca_dosage_state;
  const data = (stash && stash.data) || null;
  if (!data || !Array.isArray(data.windows)) return false;
  const nW = data.windows.length;
  const nS = data.n_samples | 0;
  if (nW <= 0 || nS <= 0) return false;
  const chrom = (data && data.chrom)
             || (atlasState.shared && atlasState.shared.activeChrom)
             || 'unknown';
  const cacheKey = `inv_atlas.dosage_cluster.${chrom}.${nS}.${nW}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return false;
    inv.dosage_cluster_state = Object.assign({}, existing, {
      cluster_result:  JSON.parse(cached),
      candidate_label: existing.candidate_label || chrom,
      _cache_hit:      true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Wire the explicit ▶ Compute button. On click, runs the heavy
// adaptiveKDosageClustering and refreshes the page state.
function _wireComputeButton(root, atlasState, registry) {
  const btn = (root && root.querySelector && root.querySelector('#dosageClusterComputeBtn'))
    || (typeof document !== 'undefined' && document.getElementById('dosageClusterComputeBtn'));
  if (!btn || btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Computing…';
    try {
      await _autoComputeDosageClustering(root, atlasState, registry);
      const pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshDosageCluster(pageState); }
      catch (e) { console.warn('dosage_cluster_adaptive_k: post-compute refresh threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_dosage_cluster_adaptive_k_state = pageState;
      }
    } catch (e) {
      console.warn('dosage_cluster_adaptive_k: compute failed:', e);
      _setLoadingHint(root, `compute failed: ${e && e.message ? e.message : 'error'}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Recompute';
    }
  });
}

async function _autoComputeDosageClustering(root, atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || {};
  const existing = inv.dosage_cluster_state || {};
  if (existing.cluster_result) return;
  const stash = inv._local_pca_dosage_state;
  let data = (stash && stash.data) || null;
  if (!data && registry) {
    const chrom = atlasState.shared && atlasState.shared.activeChrom;
    if (chrom) {
      try { data = await registry.resolve('scrubber_main', { chrom }); }
      catch (e) {
        console.warn('dosage_cluster_adaptive_k: scrubber_main resolve threw —', e);
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

  // 2026-05-19 perf: cache the cluster result across navigations by
  // (chrom, n_samples, n_windows). adaptiveKDosageClustering takes
  // 3–8 s on a 226-sample × 9k-window chromosome (multi-start K-means
  // + bootstrap + silhouette for K=2..6); user-reported "this page
  // makes everything super slow". Result is deterministic for the
  // same data shape — store in sessionStorage so it survives tab nav
  // but doesn't pollute long-term storage. sessionStorage rather than
  // localStorage because the upstream PC1 vectors CAN change between
  // browser sessions (re-emit precomp) without a version stamp;
  // session-scoped caching is the safe compromise.
  const chrom = (data && data.chrom)
             || (atlasState.shared && atlasState.shared.activeChrom)
             || 'unknown';
  const cacheKey = `inv_atlas.dosage_cluster.${chrom}.${nS}.${nW}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      inv.dosage_cluster_state = Object.assign({}, existing, {
        cluster_result:  JSON.parse(cached),
        candidate_label: existing.candidate_label || chrom,
        _cache_hit:      true,
      });
      return;
    }
  } catch (_) { /* sessionStorage unavailable / malformed; recompute */ }

  // Show a loading hint NOW so the user sees the page is alive while
  // the multi-second sync compute runs (vs the previous behavior:
  // page mounts in a blank/frozen state for the full compute duration).
  _setLoadingHint(
    root,
    `computing adaptive-K dosage clustering on ${nS} samples × ${nW} windows… ` +
    `(K=2..6 with bootstrap + silhouette; first run can take 3–8 s on long chromosomes — ` +
    `subsequent visits load from session cache)`,
  );

  // Build D[sample][window] = signed PC1 across windows. Float64Array
  // row-major n_samples × n_windows for adaptiveKDosageClustering's
  // expected contract.
  const D = new Float64Array(nS * nW);
  for (let i = 0; i < nW; i++) {
    const w = wins[i];
    if (!w || !w.pc1) continue;
    for (let s = 0; s < nS; s++) {
      D[s * nW + i] = +w.pc1[s] || 0;
    }
  }
  let result = null;
  try {
    const mod = await import('../../shared/mgl_dosage_clustering.js').catch(() => null);
    if (mod && typeof mod.adaptiveKDosageClustering === 'function') {
      // 2026-05-19 perf: yield so the browser PAINTS the loading
      // hint before the multi-second sync compute starts. Just
      // setTimeout(…, 0) doesn't guarantee a paint between yields —
      // the task queue runs without necessarily letting the renderer
      // tick. RAF-then-setTimeout pattern:
      //   1. requestAnimationFrame waits for the next vsync (paint).
      //   2. Inside the RAF callback, setTimeout(0) yields again so
      //      the heavy compute runs as the next macrotask, AFTER the
      //      paint has actually been flushed to the screen.
      // Net effect: user sees "computing…" hint, then the tab freezes
      // for the compute duration, then the result. Without this the
      // tab freezes BEFORE the hint paints, and the user sees a blank
      // page until the compute finishes.
      result = await new Promise(resolve => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            try { resolve(mod.adaptiveKDosageClustering(D, nS, nW, {})); }
            catch (_) { resolve(null); }
          }, 0);
        });
      });
    }
  } catch (e) {
    _setLoadingHint(root, `adaptiveKDosageClustering threw: ${e && e.message ? e.message : 'error'}`);
    return;
  }
  if (!result) return;
  inv.dosage_cluster_state = Object.assign({}, existing, {
    cluster_result:  result,
    candidate_label: existing.candidate_label || chrom,
  });
  // Stash for next nav. sessionStorage has a per-origin quota (~5 MB
  // typically) which the cluster_result usually fits inside (per-K
  // labels are int8-ish + small metadata), but huge cohorts on huge
  // chromosomes may overflow — silently skip caching on quota error,
  // recompute is the worst case.
  try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); }
  catch (_) { /* over quota or storage disabled */ }
}

function _setLoadingHint(root, msg) {
  const el = (root && root.querySelector && root.querySelector('#dosageClusterEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('dosageClusterEmpty'));
  if (el) {
    el.style.display = '';
    el.textContent = msg;
  }
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('dosage_cluster_adaptive_k.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const dc = inv.dosage_cluster_state || null;
  const cr = dc ? dc.cluster_result : null;
  return {
    cluster_result:        cr,
    candidate_label:       dc ? (dc.candidate_label || null) : null,
    curve_hit_regions:     [],
    selection:             createDosageClusterSelection(
                              cr && Number.isFinite(cr.K_chosen) ? cr.K_chosen : null),
    _handlers:             {},
  };
}

function _activeEntry(state) {
  if (!state) return null;
  return entryToDisplay(state.cluster_result, state.selection.getFocusedK());
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('dosageClusterCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const badge = document.getElementById('dosageClusterVerdictBadge');
  if (badge) {
    const cr = state.cluster_result;
    if (cr && cr.verdict) {
      badge.textContent = verdictLabel(cr.verdict);
      badge.style.background = verdictColor(cr.verdict);
      badge.style.color = '#fff';
    } else {
      badge.textContent = '—';
      badge.style.background = '';
      badge.style.color = '';
    }
  }
  const k = document.getElementById('dosageClusterKBadge');
  if (k) {
    const cr = state.cluster_result;
    const focused = state.selection.getFocusedK();
    const e = _activeEntry(state);
    const Kshown = e ? e.K : (cr && cr.K_chosen) || null;
    k.textContent = (Kshown != null)
      ? `K = ${Kshown}${focused != null && cr && cr.K_chosen != null && focused !== cr.K_chosen ? ' (focused)' : ''}`
      : 'K = —';
  }
}

// =====================================================================
// Curve paint
// =====================================================================

function _paintCurves(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('dosageClusterCurvesCanvas');
  const empty  = document.getElementById('dosageClusterEmpty');
  if (!canvas) return;
  const entry = _activeEntry(state);
  const curves = entry ? entry.cluster_curves : null;
  if (!curves || !Array.isArray(curves) || curves.length === 0) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 320);
    }
    state.curve_hit_regions = [];
    return;
  }
  if (empty) empty.style.display = 'none';
  const paint = paintClusterCurves(canvas, curves, {
    hovered_cluster: state.selection.getHoveredCluster(),
  });
  state.curve_hit_regions = paint.curve_hit_regions;
}

// =====================================================================
// Right panel — per-K table
// =====================================================================

function _renderPerK(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('dosageClusterPerKBody');
  if (!body) return;
  const cr = state.cluster_result;
  if (!cr || !Array.isArray(cr.per_K) || cr.per_K.length === 0) {
    body.innerHTML = '<span class="empty">No per-K table</span>';
    return;
  }
  const focused = state.selection.getFocusedK();
  let html = '<table class="dc-per-k-table">'
           + '<thead><tr>'
           +   '<th>K</th><th>sil</th><th>stab</th><th>min</th><th>coh</th><th>Δsil</th><th>✓</th>'
           + '</tr></thead><tbody>';
  for (const e of cr.per_K) {
    if (!e) continue;
    const rowCls = (focused === e.K) ? 'focused'
                 : (cr.K_chosen === e.K) ? 'chosen' : '';
    html += `<tr class="${rowCls}" data-k="${e.K}">`
         +    `<td>${e.K}</td>`
         +    `<td>${Number.isFinite(e.silhouette)        ? e.silhouette.toFixed(3) : '—'}</td>`
         +    `<td>${Number.isFinite(e.stability)         ? e.stability.toFixed(3)  : '—'}</td>`
         +    `<td>${Number.isFinite(e.min_size)          ? e.min_size              : '—'}</td>`
         +    `<td>${Number.isFinite(e.spatial_coherence) ? e.spatial_coherence.toFixed(3) : '—'}</td>`
         +    `<td>${Number.isFinite(e.delta_sil)
                       ? (e.delta_sil >= 0 ? '+' : '') + e.delta_sil.toFixed(3) : '—'}</td>`
         +    `<td>${e.passes ? '✓' : '—'}</td>`
         + '</tr>';
  }
  html += '</tbody></table>';
  body.innerHTML = html;
}

// =====================================================================
// Right panel — chosen K detail
// =====================================================================

function _renderChosenDetail(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('dosageClusterChosenFields');
  if (!fields) return;
  const entry = _activeEntry(state);
  if (!entry) {
    fields.innerHTML = '<dt class="empty">No chosen K</dt><dd>—</dd>';
    return;
  }
  let html = '';
  for (const row of summariseKEntry(entry)) {
    html += `<dt>${row.label}</dt><dd>${row.value}</dd>`;
  }
  const sizes = clusterSizesFromLabels(entry.labels);
  if (sizes.length > 0) {
    html += '<dt>Cluster sizes</dt><dd>';
    for (const [k, n] of sizes) {
      const c = clusterColor(k);
      html += `<span class="dc-cluster-swatch" style="background:${c}"></span>`
           +  `<span class="dc-cluster-size">${k}:n=${n}</span> `;
    }
    html += '</dd>';
  }
  fields.innerHTML = html;
}

// =====================================================================
// Toolbar wiring
// =====================================================================

function _wireToolbar(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  _teardownToolbar(state);

  const repaintAll = () => {
    _renderHeader(state);
    _paintCurves(state);
    _renderPerK(state);
    _renderChosenDetail(state);
  };

  const onTableClick = (ev) => {
    // Find the closest <tr data-k> ancestor without relying on
    // document.querySelectorAll (works under the fake-DOM smoke).
    let node = ev && ev.target;
    while (node && (typeof node.getAttribute !== 'function' || !node.getAttribute('data-k'))) {
      node = node.parentNode;
    }
    if (!node) return;
    const k = parseInt(node.getAttribute('data-k'), 10);
    if (!Number.isFinite(k)) return;
    state.selection.setFocusedK(k);
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('dosageClusterCurvesCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.selection.setHoveredCluster(findClusterAtPixel(state.curve_hit_regions, x, y));
  };

  const unsubSelection = state.selection.subscribe(() => { repaintAll(); });

  state._handlers = {
    onTableClick, onCanvasMove, unsubSelection,
  };
  _addListener('dosageClusterPerKBody',       'click',     onTableClick);
  _addListener('dosageClusterCurvesCanvas',   'mousemove', onCanvasMove);
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onTableClick)   _removeListener('dosageClusterPerKBody',     'click',     h.onTableClick);
  if (h.onCanvasMove)   _removeListener('dosageClusterCurvesCanvas', 'mousemove', h.onCanvasMove);
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
