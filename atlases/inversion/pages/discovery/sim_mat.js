// pages/discovery/sim_mat.js
// =====================================================================
// Dedicated sim_mat heatmap page — surfaces the same window × window
// similarity heatmap that local_pca_dosage renders in its sim panel,
// but as its own standalone page. The actual paint is delegated to
// drawSim() in local_pca_dosage/sim_panel.js (single source of truth
// for the heatmap visual + envelope overlays + anchor strip).
//
// State source priority:
//   1. atlasState.inversion._local_pca_dosage_state — the live legacy
//      state stashed when local_pca_dosage was mounted. Used as-is so
//      cursor / scale / mode carry over.
//   2. Bootstrap via registry.resolve('scrubber_main', { chrom }) —
//      builds a minimal scrubber-shaped state from scratch so the page
//      can render on a first-mount before local_pca_dosage opens.
//
// The user clicks on the heatmap to move state.cur (matches
// local_pca_dosage's click-to-jump behaviour). On move we just
// re-call drawSim; we don't fire the full local_pca_dosage redraw
// pipeline because this page only shows the one panel.
// =====================================================================

import { drawSim } from './local_pca_dosage/sim_panel.js';
import { _setActiveState } from './local_pca_dosage/_state.js';

let _pageHandlers = null;

// =====================================================================
// Atlas-router lifecycle
// =====================================================================

export async function mount(root, atlasState, registry) {
  const inv = (atlasState && atlasState.inversion) || {};
  let state = inv._local_pca_dosage_state || null;

  // Bootstrap a minimal scrubber-shaped state if local_pca_dosage hasn't
  // mounted yet. Same registry call local_pca_dosage uses.
  if (!state || !state.data) {
    const chrom = (state && state.data && state.data.chrom)
               || (atlasState.shared && atlasState.shared.activeChrom);
    if (!chrom) {
      _setEmpty('No active chromosome. Open local_pca_dosage on a chromosome first, or pick one from the catalogue.');
      return;
    }
    if (!registry) {
      _setEmpty('No registry available to bootstrap scrubber data.');
      return;
    }
    let data = null;
    try {
      const resolved = registry.resolve('scrubber_main', { chrom });
      // registry.resolve hot-cache hits return sync, cold returns a promise.
      data = (resolved && typeof resolved.then === 'function')
        ? await resolved
        : resolved;
    } catch (e) {
      _setEmpty(`Failed to load scrubber data: ${e && e.message ? e.message : 'unknown error'}`);
      return;
    }
    if (!data) {
      _setEmpty('Scrubber data unavailable for ' + chrom + '.');
      return;
    }
    // Contribute chromSummary (SPEC_multichrom Slice 1) so the topbar's
    // chrom picker has the same summary fields other pages produce.
    // Non-essential — fail-soft on missing helper / setter.
    if (typeof atlasState.setChromSummary === 'function') {
      try {
        const cs = await import('../../../../core/chrom_summary.js');
        atlasState.setChromSummary(chrom, cs.buildChromSummary(data, { chrom }));
      } catch (_) { /* non-essential */ }
    }
    if (!state) state = {};
    state.data = data;
    if (state.cur == null) {
      const nW = (Array.isArray(data.windows) ? data.windows.length : data.n_windows) | 0;
      state.cur = Math.max(0, Math.floor(nW / 2));
    }
    // Stash for next mount + so other pages reading the stash see it too.
    if (atlasState.inversion) {
      atlasState.inversion._local_pca_dosage_state = state;
    }
  }

  _setActiveState(state);
  _setEmpty(null);
  _renderHeader(state);
  _safeDraw(state);
  _wireHandlers(state);
}

export async function unmount(root) {
  _teardownHandlers();
  _setActiveState(null);
}

// =====================================================================
// Header / cursor label
// =====================================================================

function _renderHeader(state) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const d = state && state.data;
  const lblChrom = document.getElementById('simMatChromLabel');
  if (lblChrom) lblChrom.textContent = (d && d.chrom) || '—';
  const lblCur = document.getElementById('simMatCursorLabel');
  if (lblCur) lblCur.textContent = 'cur ' + ((state && state.cur != null) ? state.cur : '—');
  _populateScaleSelect(state);
}

// Populate the scale dropdown from state.data.sim_scales (object keyed by
// scale label). Pre-selects state.simScale (or the data's default). When
// data has no multi-scale envelope (only the legacy sim_thumb path), the
// dropdown carries a single "—" option and is disabled.
function _populateScaleSelect(state) {
  const sel = document.getElementById('simMatScaleSelect');
  if (!sel) return;
  const d = state && state.data;
  const scales = d && d.sim_scales;
  const keys = scales ? Object.keys(scales) : [];
  if (keys.length === 0) {
    sel.innerHTML = '<option value="">—</option>';
    sel.disabled = true;
    return;
  }
  const cur = (state && state.simScale && scales[state.simScale])
    ? state.simScale
    : (d.default_sim_scale && scales[d.default_sim_scale]
       ? d.default_sim_scale
       : keys[0]);
  sel.disabled = false;
  // Re-render options only when the key set changes (avoids losing the
  // user's selection mid-paint).
  const wantOptions = keys.join('|');
  if (sel.dataset.optKeys !== wantOptions) {
    sel.innerHTML = keys.map(k =>
      `<option value="${k}">${k}</option>`).join('');
    sel.dataset.optKeys = wantOptions;
  }
  if (sel.value !== cur) sel.value = cur;
}

// =====================================================================
// Click-to-jump (mirrors onSimClick's geometry math without pulling in
// the rest of the local_pca_dosage event pipeline)
// =====================================================================

function _onSimClick(state, evt) {
  if (!state || !state.data) return;
  const canvas = document.getElementById('simCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = evt.clientX - rect.left;
  const py = evt.clientY - rect.top;
  const g = state._simGeom;
  if (!g) return;
  if (px < g.x0 || px > g.x1 || py < g.y0 || py > g.y1) return;
  const view = state.data;
  const Nw = (view && view.n_windows)
    || (view && view.windows && view.windows.length) || 0;
  if (Nw <= 0) return;
  const frac = (px - g.x0) / g.side;
  const next = Math.max(0, Math.min(Nw - 1, Math.round(frac * (Nw - 1))));
  if (next === state.cur) return;
  state.cur = next;
  _renderHeader(state);
  _safeDraw(state);
}

function _onResize() {
  // Re-fit + re-paint when the layout changes (e.g. devtools toggle).
  const state = _activeState();
  if (state) _safeDraw(state);
}

// Keyboard nav: arrow keys step the cursor, shift+arrow steps by 10,
// Home/End jump to first/last window. Ignored when focus is inside an
// input, select, or contenteditable — so typing in the scale dropdown
// or any future text input doesn't steal arrow keys.
function _onKeyDown(state, evt) {
  if (!state || !state.data) return;
  const t = evt.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT'
            || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
    return;
  }
  const view = state.data;
  const Nw = (view && view.n_windows)
    || (view && view.windows && view.windows.length) || 0;
  if (Nw <= 0) return;
  const cur = (state.cur != null) ? (state.cur | 0) : 0;
  let next = cur;
  const step = evt.shiftKey ? 10 : 1;
  switch (evt.key) {
    case 'ArrowLeft':  next = cur - step; break;
    case 'ArrowRight': next = cur + step; break;
    case 'Home':       next = 0; break;
    case 'End':        next = Nw - 1; break;
    default: return;
  }
  evt.preventDefault();
  next = Math.max(0, Math.min(Nw - 1, next));
  if (next === cur) return;
  state.cur = next;
  _renderHeader(state);
  _safeDraw(state);
}

function _activeState() {
  // _setActiveState stashes onto the local_pca_dosage module's _pageState,
  // but we don't have a getter exported. Stash on a local ref instead.
  return _pageHandlers && _pageHandlers.state || null;
}

function _wireHandlers(state) {
  _teardownHandlers();
  if (typeof document === 'undefined' || !document.getElementById) return;
  const canvas = document.getElementById('simCanvas');
  const refresh = document.getElementById('simMatRefreshBtn');
  const scaleSel = document.getElementById('simMatScaleSelect');
  const onClick = (evt) => _onSimClick(state, evt);
  const onResize = () => _onResize();
  const onRefresh = () => { _renderHeader(state); _safeDraw(state); };
  // Switching the scale: invalidate the per-scale image cache stored on
  // state.__simImgCache so drawSim regenerates with the new scale's data,
  // then re-paint.
  const onScaleChange = (evt) => {
    const next = evt && evt.target && evt.target.value;
    if (!next || next === state.simScale) return;
    state.simScale = next;
    try { delete state.__simImgCache; } catch (_) { state.__simImgCache = null; }
    _renderHeader(state);
    _safeDraw(state);
  };
  const onKeyDown = (evt) => _onKeyDown(state, evt);
  _pageHandlers = { state, canvas, refresh, scaleSel, onClick, onResize, onRefresh, onScaleChange, onKeyDown };
  if (canvas) canvas.addEventListener('click', onClick);
  if (refresh) refresh.addEventListener('click', onRefresh);
  if (scaleSel) scaleSel.addEventListener('change', onScaleChange);
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
  // Document-level keydown so arrows work without needing canvas focus.
  // Scoped to the mount/unmount lifecycle.
  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
}

function _teardownHandlers() {
  if (!_pageHandlers) return;
  const h = _pageHandlers;
  if (h.canvas && h.onClick) h.canvas.removeEventListener('click', h.onClick);
  if (h.refresh && h.onRefresh) h.refresh.removeEventListener('click', h.onRefresh);
  if (h.scaleSel && h.onScaleChange) h.scaleSel.removeEventListener('change', h.onScaleChange);
  if (typeof window !== 'undefined' && h.onResize) {
    window.removeEventListener('resize', h.onResize);
  }
  if (typeof document !== 'undefined' && h.onKeyDown) {
    document.removeEventListener('keydown', h.onKeyDown);
  }
  _pageHandlers = null;
}

// =====================================================================
// Safe drawSim wrapper
// =====================================================================

function _safeDraw(state) {
  try {
    drawSim(state);
  } catch (e) {
    console.warn('sim_mat.drawSim threw:', e);
    _setEmpty(`Render failed: ${e && e.message ? e.message : 'unknown error'}`);
  }
}

function _setEmpty(msg) {
  if (typeof document === 'undefined' || !document.getElementById) return;
  const empty = document.getElementById('simMatEmpty');
  if (!empty) return;
  if (msg) {
    empty.textContent = msg;
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
  }
}
