// pages/discovery/dosage_heatmap.js
// =====================================================================
// Sample × marker dosage heatmap — atlas-side cartridge for SPEC_0 §11
// (centering / polarity) and the partner of the PCA panel.
//
// Phase 1 scope (this commit):
//   - Sequential cream → deep red ramp (matches similarity panel
//     "Reds" + the user's reference image)
//   - Left side K=3 group annotation track (+ optional K=6)
//   - Top polarity stripe (one cell per displayed marker; black =
//     flipped)
//   - Sample ordering options: natural | by_group | by_k6
//   - Marker ordering options: natural | by_polarity
//   - Hover crosshair + right-panel cell summary
//   - Click a cell to toggle either the sample or the marker in
//     the selection set
//
// Two input shapes feed the same canonical painter via
// `./adapters.js` so the legacy candidate dosage-heatmap and the
// new mgl_heatmap_json result render identically:
//
//   atlasState.inversion.dosage_heatmap_state = {
//     mgl_heatmap_result?:   shared/mgl_heatmap_json output,
//     legacy_chunk?:         { samples, markers, dosage },
//     selected_marker_indices?: number[]   (legacy adapter)
//     sample_group?:         Array<*>      per canonical sample idx
//     sample_k6?:            Int32Array
//     marker_polarity?:      Array<boolean>|Function
//     candidate_label?:      string,
//     view_label?:           string  e.g. 'unweighted · cohort_mean',
//   }
//
// Deferred:
//   - Marker bp-axis (needs sidecar metadata wired through)
//   - Per-sample dosage hover sparkline
//   - Cross-panel candidate-mode linkage with PCA (separate commit)
// =====================================================================

import { _pageState, _setActiveState } from './dosage_heatmap/_state.js';
import {
  paintDosageHeatmap,
  findCellAtPixel,
  deriveSampleOrder,
  deriveMarkerOrder,
  buildGroupColorMap,
} from './dosage_heatmap/renderer.js';
import {
  adaptMglHeatmapJson,
  adaptLegacyChunk,
} from './dosage_heatmap/adapters.js';
import {
  createDosageHeatmapSelection,
  summariseHoverCell,
  groupSizesFromSampleGroup,
} from './dosage_heatmap/selection.js';
import { fitCanvasNoDpr } from '../../shared/page1_utils.js';

const DEFAULT_VIEW_STATE = Object.freeze({
  sample_order_mode:     'by_group',
  marker_order_mode:     'natural',
  show_group_track:      true,
  show_k6_track:         false,
  show_polarity_track:   true,
});

// =====================================================================
// Public entry — refresh
// =====================================================================

export function refreshDosageHeatmap(state) {
  if (state) _setActiveState(state);
  _renderHeader(_pageState);
  _paintHeatmap(_pageState);
  _renderRightPanel(_pageState);
  _renderLegend(_pageState);
  _updateTooltip(_pageState);
}

export function initDosageHeatmapToolbar() {
  _wireToolbar(_pageState);
}

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  let pageState = _buildPageState(atlasState);
  _setActiveState(pageState);

  try { refreshDosageHeatmap(pageState); }
  catch (e) { console.warn('dosage_heatmap.mount: refresh threw —', e); }

  try { initDosageHeatmapToolbar(); }
  catch (e) { console.warn('dosage_heatmap.mount: toolbar wiring threw —', e); }

  if (atlasState.inversion) {
    atlasState.inversion._page_dosage_heatmap_state = pageState;
  }

  // 2026-05-20: auto-fetch a default chunk on direct mount. The page used
  // to render the empty "feed buildHeatmapFromDosage output…" stub when
  // the user navigated here without first opening from a candidate. Now
  // we fetch a sensible default range so the heatmap renders immediately.
  //
  // Priority order for the bp range:
  //   1. Active candidate's start_bp/end_bp (if set on shared state)
  //   2. Focal L2 envelope of the local_pca_dosage cursor (from the stash)
  //   3. First ~2 Mb of the active chromosome
  //
  // Uses the same /api/dosage/chunk endpoint the candidate-open path
  // uses, via the synthetic chunk-index template that local_pca_dosage
  // attaches to state.data.dosage_chunks. Bails silently when no chrom
  // is loaded or the template URL isn't available.
  if (!pageState.data) {
    try {
      await _autoLoadDefaultChunk(root, atlasState);
      // Rebuild the page state from the now-populated inv.dosage_heatmap_state
      // and re-render.
      pageState = _buildPageState(atlasState);
      _setActiveState(pageState);
      try { refreshDosageHeatmap(pageState); }
      catch (e) { console.warn('dosage_heatmap.mount: post-autoload refresh threw —', e); }
      // 2026-05-26: re-wire the toolbar so its selection subscribe + key
      // handlers bind to the NEW pageState. Without this the original
      // wire references the abandoned pre-load pageState and dropdowns
      // appear to do nothing because the selection.subscribe was on the
      // dead state. _wireToolbar is idempotent (calls _teardownToolbar).
      try { initDosageHeatmapToolbar(); }
      catch (e) { console.warn('dosage_heatmap.mount: post-autoload toolbar re-wire threw —', e); }
      if (atlasState.inversion) {
        atlasState.inversion._page_dosage_heatmap_state = pageState;
      }
    } catch (e) {
      console.warn('dosage_heatmap.mount: auto-load failed:', e);
    }
  }
}

// Auto-fetch a default dosage chunk and stash it on inv.dosage_heatmap_state.
// Returns silently if no chrom is loaded or the dosage_chunks template URL
// isn't available (e.g. user opened this page before mounting local_pca_dosage).
async function _autoLoadDefaultChunk(root, atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  // If a payload is already set (candidate-open path), don't overwrite.
  const dh = inv.dosage_heatmap_state || {};
  if (dh.legacy_chunk || dh.mgl_heatmap_result) return;
  // 2026-05-20: be permissive about the stash — work even when
  // local_pca_dosage hasn't mounted yet. We only need a chrom + a
  // chunk-URL template; the latter has a hard-coded fallback below.
  const stash = inv._local_pca_dosage_state;
  const data = stash && stash.data;
  const chrom = (data && data.chrom)
             || (atlasState.shared && atlasState.shared.activeChrom);
  if (!chrom) return;
  const dc = data && data.dosage_chunks;
  // Prefer the synthetic-bridge URL that local_pca_dosage attaches; fall
  // back to the canonical /api/dosage/chunk template so this page is
  // self-sufficient when opened first.
  const template =
       (dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint))
    || '/api/dosage/chunk?chrom=__CHROM__&start=__START__&end=__END__&cap=__CAP__';
  if (!template || template.indexOf('__START__') < 0) return;
  // Pick a default region.
  let startBp = null, endBp = null, sourceLabel = null;
  // 1. Active candidate.
  const cand = atlasState.shared && atlasState.shared.activeCandidate;
  if (cand && Number.isFinite(cand.start_bp) && Number.isFinite(cand.end_bp)) {
    startBp = cand.start_bp; endBp = cand.end_bp;
    sourceLabel = `candidate ${cand.label || cand.id || ''}`.trim();
  }
  // 2. Focal L2 of the current cursor (only when the stash + data are present).
  if (startBp == null && stash && stash.windowToL2 && stash.cur != null
      && data && Array.isArray(data.l2_envelopes)) {
    const li = stash.windowToL2[stash.cur | 0];
    if (li >= 0 && data.l2_envelopes[li]) {
      const env = data.l2_envelopes[li];
      if (Number.isFinite(env.start_bp) && Number.isFinite(env.end_bp)) {
        startBp = env.start_bp; endBp = env.end_bp;
        sourceLabel = `focal L2 (window ${stash.cur | 0})`;
      }
    }
  }
  // 3. First 2 Mb of the chrom — best-effort window-range pull from
  //    data.windows[0..N].start_bp/end_bp, capped at 2 Mb. Falls back
  //    to "first 2 Mb starting at bp=1" when no windows array exists.
  if (startBp == null && data && Array.isArray(data.windows) && data.windows.length > 0) {
    const w0 = data.windows[0];
    const firstBp = Number.isFinite(w0.start_bp) ? w0.start_bp : 1;
    startBp = firstBp;
    endBp   = firstBp + 2_000_000;
    sourceLabel = `${chrom} ${(firstBp / 1e6).toFixed(2)}–${(endBp / 1e6).toFixed(2)} Mb (default)`;
  } else if (startBp == null) {
    startBp = 1;
    endBp   = 2_000_000;
    sourceLabel = `${chrom} 0.00–2.00 Mb (default)`;
  }
  if (startBp == null || endBp == null) return;
  const cap = (dc && (dc.cap_default | 0)) || 1000;
  const url = template
    .replace('__CHROM__', encodeURIComponent(chrom))
    .replace('__START__', String(startBp | 0))
    .replace('__END__',   String(endBp | 0))
    .replace('__CAP__',   String(cap));
  // Show a "loading" status on the empty-state slot while the fetch is
  // in flight so the user knows something is happening. 2026-05-26: added
  // a 15 s AbortController timeout so a server-side hang (or a workspace
  // served without atlas_server.py) surfaces as a clear failure instead of
  // an infinite "loading…" message. The endpoint is served by
  // start.sh → atlas_server.py at http://127.0.0.1:8000/api/dosage/chunk;
  // without it the page is read-only.
  _setLoadingHint(root, `loading dosage chunk for ${sourceLabel}…`);
  const controller = (typeof AbortController === 'function') ? new AbortController() : null;
  const timeoutMs = 15000;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let chunk = null;
  try {
    const r = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!r.ok) {
      _setLoadingHint(root, `failed to load dosage chunk (HTTP ${r.status}) — ` +
        `is atlas_server.py running? (start.sh, default port 8000)`);
      return;
    }
    chunk = await r.json();
  } catch (e) {
    if (timer) clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError');
    _setLoadingHint(root, aborted
      ? `dosage chunk request timed out after ${timeoutMs / 1000}s — ` +
        `is atlas_server.py running? (start.sh, default port 8000)`
      : `dosage chunk fetch failed: ${e && e.message ? e.message : 'network error'} — ` +
        `is atlas_server.py running?`);
    return;
  }
  if (!chunk || typeof chunk !== 'object') return;
  inv.dosage_heatmap_state = Object.assign({}, dh, {
    legacy_chunk:    chunk,
    candidate_label: dh.candidate_label || sourceLabel,
    view_label:      dh.view_label || `auto-loaded · ${sourceLabel}`,
  });
}

function _setLoadingHint(root, msg) {
  if (!root) return;
  const el = (root.querySelector && root.querySelector('#dosageHeatmapEmpty'))
    || (typeof document !== 'undefined' && document.getElementById('dosageHeatmapEmpty'));
  if (el) el.textContent = msg;
}

export async function unmount(root) {
  try { _teardownToolbar(_pageState); }
  catch (e) { console.warn('dosage_heatmap.unmount: teardown threw —', e); }
  _setActiveState(null);
}

// =====================================================================
// State construction
// =====================================================================

function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  const dh = inv.dosage_heatmap_state || null;
  let canonical = null;
  if (dh) {
    if (dh.mgl_heatmap_result) {
      canonical = adaptMglHeatmapJson(dh.mgl_heatmap_result, {
        sample_group: dh.sample_group || null,
        sample_k6:    dh.sample_k6    || null,
      });
    } else if (dh.legacy_chunk) {
      canonical = adaptLegacyChunk(dh.legacy_chunk, {
        selected_marker_indices: dh.selected_marker_indices || null,
        sample_group:            dh.sample_group || null,
        sample_k6:               dh.sample_k6    || null,
        marker_polarity:         dh.marker_polarity || null,
      });
    }
  }
  return {
    atlasState:            atlasState || null,
    data:                  canonical,
    // 2026-05-26: stash the raw legacy chunk so the free-scroll handler
    // can read (chrom, start_bp, end_bp) without depending on
    // local_pca_dosage's stash being populated.
    _raw_legacy_chunk:     (dh && dh.legacy_chunk) || null,
    candidate_label:       dh ? (dh.candidate_label || null) : null,
    view_label:            dh ? (dh.view_label || _defaultViewLabel(dh)) : null,
    group_colors:          canonical
                              ? buildGroupColorMap(_distinctOf(canonical.sample_group))
                              : new Map(),
    k6_colors:             canonical
                              ? buildGroupColorMap(_distinctOf(canonical.sample_k6))
                              : new Map(),
    layout:                null,
    last_cursor_px:        null,
    view_state:            Object.assign({}, DEFAULT_VIEW_STATE,
                                          (dh && dh.view_state) || {}),
    free_scroll:           false,
    selection:             createDosageHeatmapSelection(),
    _handlers:             {},
  };
}

function _defaultViewLabel(dh) {
  if (dh.mgl_heatmap_result && dh.mgl_heatmap_result.centering) {
    const c = dh.mgl_heatmap_result.centering;
    return `${c.anchor || '—'} · polarity ${c.polarity_reference || 'none'}`;
  }
  return null;
}

function _distinctOf(arr) {
  if (!arr) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) continue;
    if (!seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

// =====================================================================
// Header
// =====================================================================

function _renderHeader(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const lbl = document.getElementById('dosageHeatmapCandidateLabel');
  if (lbl) lbl.textContent = state.candidate_label || '—';
  const view = document.getElementById('dosageHeatmapViewBadge');
  if (view) view.textContent = state.view_label || '—';
  // Reflect view-state on toolbar inputs.
  const so = document.getElementById('dosageHeatmapSampleOrder');
  if (so) so.value = state.view_state.sample_order_mode;
  const mo = document.getElementById('dosageHeatmapMarkerOrder');
  if (mo) mo.value = state.view_state.marker_order_mode;
  const gt = document.getElementById('dosageHeatmapShowGroupTrack');
  if (gt) gt.checked = !!state.view_state.show_group_track;
  const pt = document.getElementById('dosageHeatmapShowPolarityTrack');
  if (pt) pt.checked = !!state.view_state.show_polarity_track;
  // 2026-05-26: K6-track checkbox added to HTML; mirror existing pattern.
  const k6 = document.getElementById('dosageHeatmapShowK6Track');
  if (k6) k6.checked = !!state.view_state.show_k6_track;
  // Free-scroll toggle + range label.
  const fs = document.getElementById('dosageHeatmapFreeScroll');
  if (fs) fs.checked = !!state.free_scroll;
  _updateFreeRangeLabel();
}

// =====================================================================
// Heatmap paint
// =====================================================================

function _paintHeatmap(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('dosageHeatmapCanvas');
  const empty  = document.getElementById('dosageHeatmapEmpty');
  if (!canvas) return;
  // 2026-05-26: size the canvas backing buffer to its CSS display box.
  // The HTML has no width/height attributes, so the buffer defaults to
  // 300×150 — paintDosageHeatmap then drew into that tiny buffer and
  // the browser stretched the result to fit the wrap. Re-fit on every
  // paint so layout changes track too.
  fitCanvasNoDpr(canvas);
  if (!state.data) {
    if (empty) empty.style.display = '';
    if (canvas.getContext) {
      const ctx = canvas.getContext('2d');
      if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 600, canvas.height || 400);
    }
    state.layout = null;
    return;
  }
  if (empty) empty.style.display = 'none';
  const order_s = deriveSampleOrder(state.view_state.sample_order_mode,
                                     state.data.n_samples, state.data);
  const order_m = deriveMarkerOrder(state.view_state.marker_order_mode,
                                     state.data.n_markers, state.data);
  const hov = state.selection.getHoveredCell();
  const paint = paintDosageHeatmap(canvas, state.data, {
    sample_order:        order_s,
    marker_order:        order_m,
    show_group_track:    state.view_state.show_group_track,
    show_k6_track:       state.view_state.show_k6_track,
    show_polarity_track: state.view_state.show_polarity_track,
    group_colors:        state.group_colors,
    k6_colors:           state.k6_colors,
    hovered_cell:        hov ? { row: hov.row, col: hov.col } : null,
    selected_samples:    state.selection.getSelectedSamples(),
    selected_markers:    state.selection.getSelectedMarkers(),
  });
  state.layout = paint.layout;
}

// =====================================================================
// Right panel
// =====================================================================

function _renderRightPanel(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const fields = document.getElementById('dosageHeatmapSelectedFields');
  if (!fields) return;
  if (!state.data) {
    fields.innerHTML = '<dt class="empty">No heatmap loaded</dt><dd>—</dd>';
    return;
  }
  const hov = state.selection.getHoveredCell();
  if (!hov) {
    const html =
      '<dt>Samples</dt><dd>' + state.data.n_samples + '</dd>'
      + '<dt>Markers</dt><dd>' + state.data.n_markers + '</dd>'
      + '<dt>Selected samples</dt><dd>' + state.selection.getSelectedSamples().size + '</dd>'
      + '<dt>Selected markers</dt><dd>' + state.selection.getSelectedMarkers().size + '</dd>';
    fields.innerHTML = html;
    return;
  }
  let html = '<dt>Cell</dt><dd>' + summariseHoverCell(hov, state.data) + '</dd>';
  html += '<dt>Sample idx</dt><dd>' + hov.sample_idx + '</dd>';
  html += '<dt>Marker idx</dt><dd>' + hov.marker_idx + '</dd>';
  html += '<dt>Dosage</dt><dd>' + (hov.dosage == null ? 'NA'
            : (Number.isFinite(hov.dosage) ? hov.dosage.toFixed(4) : hov.dosage)) + '</dd>';
  fields.innerHTML = html;
}

function _renderLegend(state) {
  if (!state) return;
  if (typeof document === 'undefined' || !document.getElementById) return;
  const body = document.getElementById('dosageHeatmapLegendBody');
  if (!body) return;
  if (!state.data || !state.data.sample_group) {
    body.innerHTML = '<span class="empty">—</span>';
    return;
  }
  const sizes = groupSizesFromSampleGroup(state.data.sample_group);
  let html = '';
  for (const [g, n] of sizes) {
    const c = state.group_colors.get(g) || '#888';
    html += '<div class="dh2-legend-row">'
         +    '<span class="dh2-legend-swatch" style="background:' + c + '"></span>'
         +    '<span class="dh2-legend-id">' + g + '</span> '
         +    '<span class="dh2-legend-count">n = ' + n + '</span>'
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

  // 2026-05-26: handlers read the LIVE _pageState via the module-level
  // reference (refreshed by _setActiveState on every mount / auto-load
  // remount). The old pattern closed over the initial `state` param,
  // which became stale after the auto-load created a new pageState —
  // reorder dropdowns mutated the abandoned object → repaint painted
  // the still-empty initial state → "nothing happens".
  const live = () => _pageState || state;
  const repaint = () => { _paintHeatmap(live()); };
  const repaintAll = () => {
    const s = live();
    _renderHeader(s);
    _paintHeatmap(s);
    _renderRightPanel(s);
    _renderLegend(s);
  };

  const onSampleOrder = (e) => {
    const s = live();
    if (!s) return;
    s.view_state.sample_order_mode = (e && e.target && e.target.value) || 'natural';
    repaint();
  };
  const onMarkerOrder = (e) => {
    const s = live();
    if (!s) return;
    s.view_state.marker_order_mode = (e && e.target && e.target.value) || 'natural';
    repaint();
  };
  const onShowGroupTrack = (e) => {
    const s = live();
    if (!s) return;
    s.view_state.show_group_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowPolarityTrack = (e) => {
    const s = live();
    if (!s) return;
    s.view_state.show_polarity_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  const onShowK6Track = (e) => {
    const s = live();
    if (!s) return;
    s.view_state.show_k6_track = !!(e && e.target && e.target.checked);
    repaint();
  };
  // 2026-05-26: free-scroll mode — toggle + arrow-key handler. Untracks
  // the page from the active candidate; ←/→ shifts the active bp range
  // by half a window (Shift = full window) and refetches the chunk.
  const onFreeScrollToggle = (e) => {
    const s = live();
    if (!s) return;
    const on = !!(e && e.target && e.target.checked);
    s.free_scroll = on;
    _updateFreeRangeLabel();
  };
  const onKey = (ev) => {
    const s = live();
    if (!s || !s.free_scroll) return;
    if (typeof document !== 'undefined') {
      const pageEl = document.getElementById('dosage_heatmap');
      if (!pageEl) return;
    }
    const key = ev && ev.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' &&
        key !== 'Home'      && key !== 'End') return;
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    ev.preventDefault();
    _scrubFree(s, key, !!ev.shiftKey);
  };
  const onCanvasMove = (ev) => {
    const c = document.getElementById('dosageHeatmapCanvas');
    if (!c) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    state.last_cursor_px = { x, y };
    const cell = findCellAtPixel(state.layout, state.data ? state.data.cellValue : null, x, y);
    state.selection.setHoveredCell(cell);
    _updateTooltip(state);
  };
  const onCanvasLeave = () => {
    state.last_cursor_px = null;
    state.selection.setHoveredCell(null);
    _hideTooltip();
  };
  const onCanvasClick = (ev) => {
    const c = document.getElementById('dosageHeatmapCanvas');
    if (!c || !state.data) return;
    const rect = typeof c.getBoundingClientRect === 'function'
      ? c.getBoundingClientRect() : { left: 0, top: 0 };
    const x = ((ev && ev.clientX) || 0) - (rect.left || 0);
    const y = ((ev && ev.clientY) || 0) - (rect.top  || 0);
    const cell = findCellAtPixel(state.layout, state.data.cellValue, x, y);
    if (!cell) return;
    // Shift-click → toggle marker; plain click → toggle sample.
    if (ev && ev.shiftKey) state.selection.toggleSelectedMarker(cell.marker_idx);
    else                   state.selection.toggleSelectedSample(cell.sample_idx);
  };

  const unsubSelection = state.selection.subscribe(() => {
    repaintAll();
    _updateTooltip(state);
  });

  state._handlers = {
    onSampleOrder, onMarkerOrder,
    onShowGroupTrack, onShowPolarityTrack, onShowK6Track,
    onFreeScrollToggle, onKey,
    onCanvasMove, onCanvasClick, onCanvasLeave,
    unsubSelection,
  };

  _addListener('dosageHeatmapSampleOrder',        'change',     onSampleOrder);
  _addListener('dosageHeatmapMarkerOrder',        'change',     onMarkerOrder);
  _addListener('dosageHeatmapShowGroupTrack',     'change',     onShowGroupTrack);
  _addListener('dosageHeatmapShowPolarityTrack',  'change',     onShowPolarityTrack);
  _addListener('dosageHeatmapShowK6Track',        'change',     onShowK6Track);
  _addListener('dosageHeatmapFreeScroll',         'change',     onFreeScrollToggle);
  _addListener('dosageHeatmapCanvas',             'mousemove',  onCanvasMove);
  _addListener('dosageHeatmapCanvas',             'click',      onCanvasClick);
  _addListener('dosageHeatmapCanvas',             'mouseleave', onCanvasLeave);
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', onKey);
  }
}

function _teardownToolbar(state) {
  if (!state || !state._handlers) return;
  const h = state._handlers;
  if (h.onSampleOrder)        _removeListener('dosageHeatmapSampleOrder',        'change',    h.onSampleOrder);
  if (h.onMarkerOrder)        _removeListener('dosageHeatmapMarkerOrder',        'change',    h.onMarkerOrder);
  if (h.onShowGroupTrack)     _removeListener('dosageHeatmapShowGroupTrack',     'change',    h.onShowGroupTrack);
  if (h.onShowPolarityTrack)  _removeListener('dosageHeatmapShowPolarityTrack',  'change',    h.onShowPolarityTrack);
  if (h.onShowK6Track)        _removeListener('dosageHeatmapShowK6Track',        'change',    h.onShowK6Track);
  if (h.onFreeScrollToggle)   _removeListener('dosageHeatmapFreeScroll',         'change',    h.onFreeScrollToggle);
  if (h.onCanvasMove)         _removeListener('dosageHeatmapCanvas',             'mousemove',  h.onCanvasMove);
  if (h.onCanvasClick)        _removeListener('dosageHeatmapCanvas',             'click',      h.onCanvasClick);
  if (h.onCanvasLeave)        _removeListener('dosageHeatmapCanvas',             'mouseleave', h.onCanvasLeave);
  if (h.onKey && typeof document !== 'undefined' && document.removeEventListener) {
    document.removeEventListener('keydown', h.onKey);
  }
  if (typeof h.unsubSelection === 'function') { try { h.unsubSelection(); } catch (_) {} }
  state._handlers = {};
}

// 2026-05-26: free-scroll bp-range scrubber. Reads the current chunk's
// (chrom, start_bp, end_bp), shifts by ½ or full window, clamps to the
// chromosome size when known, then refetches via the same /api/dosage/chunk
// pipe _autoLoadDefaultChunk uses. Tracks an in-flight token so rapid
// key-mashing doesn't race; only the latest request wins.
let _scrubReqId = 0;
async function _scrubFree(state, key, shiftKey) {
  const chunk = state && state._raw_legacy_chunk;
  const chrom = (chunk && chunk.chrom)
             || (state && state.atlasState && state.atlasState.shared
                  && state.atlasState.shared.activeChrom);
  if (!chrom) return;
  let startBp = chunk && Number.isFinite(chunk.start_bp) ? chunk.start_bp | 0 : null;
  let endBp   = chunk && Number.isFinite(chunk.end_bp)   ? chunk.end_bp   | 0 : null;
  if (startBp == null || endBp == null || endBp <= startBp) return;
  const width = endBp - startBp;
  const step = shiftKey ? width : Math.max(1, width >> 1);
  // Chrom size lookup — only used to clamp End/End-key. Falls back to
  // letting the server's region check trim if size is unknown.
  const inv = state.atlasState && state.atlasState.inversion;
  const stash = inv && inv._local_pca_dosage_state;
  const dataWindows = stash && stash.data && stash.data.windows;
  const chromSize = dataWindows && dataWindows.length
    ? (dataWindows[dataWindows.length - 1].end_bp | 0)
    : null;
  let newStart, newEnd;
  if (key === 'Home') {
    newStart = 1; newEnd = 1 + width;
  } else if (key === 'End' && chromSize) {
    newEnd = chromSize; newStart = Math.max(1, newEnd - width);
  } else if (key === 'ArrowLeft') {
    newStart = Math.max(1, startBp - step);
    newEnd   = newStart + width;
  } else if (key === 'ArrowRight') {
    newStart = startBp + step;
    if (chromSize && newStart + width > chromSize) {
      newEnd = chromSize; newStart = Math.max(1, newEnd - width);
    } else {
      newEnd = newStart + width;
    }
  } else {
    return;
  }
  const myReq = ++_scrubReqId;
  await _fetchFreeRange(state, chrom, newStart, newEnd, myReq);
}

async function _fetchFreeRange(state, chrom, startBp, endBp, reqId) {
  const inv = state.atlasState && state.atlasState.inversion;
  const stash = inv && inv._local_pca_dosage_state;
  const data = stash && stash.data;
  const dc = data && data.dosage_chunks;
  const template =
       (dc && Array.isArray(dc.chunks) && dc.chunks[0] && (dc.chunks[0].url || dc._endpoint))
    || '/api/dosage/chunk?chrom=__CHROM__&start=__START__&end=__END__&cap=__CAP__';
  const cap = (dc && (dc.cap_default | 0)) || 1000;
  const url = template
    .replace('__CHROM__', encodeURIComponent(chrom))
    .replace('__START__', String(startBp | 0))
    .replace('__END__',   String(endBp | 0))
    .replace('__CAP__',   String(cap));
  let chunk = null;
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    chunk = await r.json();
  } catch (_) { return; }
  if (reqId !== _scrubReqId) return;   // a newer request superseded us
  if (!chunk || typeof chunk !== 'object') return;
  inv.dosage_heatmap_state = Object.assign({}, inv.dosage_heatmap_state || {}, {
    legacy_chunk:    chunk,
    candidate_label: `free · ${chrom} ${(startBp / 1e6).toFixed(2)}-${(endBp / 1e6).toFixed(2)} Mb`,
    view_label:      `free scroll · ${chrom} ${(startBp / 1e6).toFixed(2)}-${(endBp / 1e6).toFixed(2)} Mb`,
  });
  // Rebuild + repaint via the exported refresh path so all panels sync.
  try {
    const newPageState = _buildPageState(state.atlasState);
    newPageState.free_scroll = true;   // preserve mode across remount
    _setActiveState(newPageState);
    refreshDosageHeatmap(newPageState);
    if (inv) inv._page_dosage_heatmap_state = newPageState;
  } catch (e) {
    console.warn('dosage_heatmap free-scroll: refresh threw —', e);
  }
  _updateFreeRangeLabel();
}

function _updateFreeRangeLabel() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('dosageHeatmapFreeRangeLabel');
  if (!el) return;
  const s = _pageState;
  if (!s || !s.free_scroll) { el.style.display = 'none'; return; }
  const chunk = s._raw_legacy_chunk;
  if (!chunk || !Number.isFinite(chunk.start_bp) || !Number.isFinite(chunk.end_bp)) {
    el.style.display = 'inline'; el.textContent = '· free scroll on';
    return;
  }
  el.style.display = 'inline';
  el.textContent = `· ${chunk.chrom || ''} ${(chunk.start_bp / 1e6).toFixed(2)}-${(chunk.end_bp / 1e6).toFixed(2)} Mb (←/→)`;
}

function _updateTooltip(state) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const slot = document.getElementById('dosageHeatmapTooltip');
  if (!slot) return;
  if (!state) { slot.style.display = 'none'; return; }
  const hov = state.selection.getHoveredCell();
  const px  = state.last_cursor_px;
  if (!hov || !px || !state.data) { slot.style.display = 'none'; return; }
  slot.innerHTML = summariseHoverCell(hov, state.data);
  slot.style.display = 'block';
  // Position the tooltip 12px right + 4px below the cursor, clamped to
  // the canvas-wrap. We use offsetWidth/Height after toggling display
  // so the dimensions are known.
  const canvas = document.getElementById('dosageHeatmapCanvas');
  const wrap = canvas && canvas.parentElement;
  if (!wrap) return;
  const ww = (typeof wrap.clientWidth  === 'number') ? wrap.clientWidth  : 0;
  const wh = (typeof wrap.clientHeight === 'number') ? wrap.clientHeight : 0;
  const tw = slot.offsetWidth  || 0;
  const th = slot.offsetHeight || 0;
  let left = px.x + 12;
  let top  = px.y + 4;
  if (tw > 0 && left + tw > ww - 4) left = px.x - tw - 8;
  if (left < 4) left = 4;
  if (th > 0 && top + th > wh - 4) top = px.y - th - 6;
  if (top < 4) top = 4;
  slot.style.left = left + 'px';
  slot.style.top  = top  + 'px';
}

function _hideTooltip() {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const slot = document.getElementById('dosageHeatmapTooltip');
  if (slot) slot.style.display = 'none';
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
