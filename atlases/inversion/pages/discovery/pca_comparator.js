// pages/discovery/pca_comparator.js
//
// Cross-evidence PCA comparator — Phase 1 (side-by-side).
// Per specs_todo/SPEC_local_pca_comparator.md.
//
// Three synchronized mini-PCA panels at the active window
// (state.cur), one per evidence axis:
//   - dosage (state.data.windows[w].pc1[]/pc2[])  ← always available
//   - θπ     (state.data.theta_pi_local_pca)      ← optional layer
//   - GHSL   (state.data.ghsl_panel)              ← optional layer
//
// K-band coloring is inherited from the anchor's K-means clustering
// (default: dosage). Each sample keeps its anchor band color across
// all 3 panels — so the question "is this fish consistently in band g0
// across all 3 axes?" is answered by COLOR + POSITION agreement.
//
// Phase 1 explicitly does NOT do:
//   - Procrustes overlay (Phase 3, see SPEC §Phase 3)
//   - Per-sample 3-axis line trajectory (Phase 2 / Option C)
//   - Concordance score badge per sample (Phase 2)
//
// Read-only inspector — writes nothing.

import { _pageState, _setActiveState } from './pca_comparator/_state.js';
import {
  paintPanel,
  findSampleAtPixel,
  paintLines,
  windowAtLinesX,
} from './pca_comparator/renderer.js';

export async function mount(root, atlasState, registry) {
  const pageState = _buildPageState(atlasState);
  _setActiveState(pageState);
  try { _wireHotkeys(pageState); } catch (e) {
    console.warn('pca_comparator.mount: hotkeys threw —', e);
  }
  try { _wireToolbar(pageState); } catch (e) {
    console.warn('pca_comparator.mount: toolbar threw —', e);
  }
  try { _wireCanvasHover(pageState); } catch (e) {
    console.warn('pca_comparator.mount: hover wiring threw —', e);
  }
  try { refresh(pageState); } catch (e) {
    console.warn('pca_comparator.mount: refresh threw —', e);
  }
  if (atlasState.inversion) {
    atlasState.inversion._page_pca_comparator_state = pageState;
  }
}

export async function unmount(root) {
  const s = _pageState;
  if (s && s._teardownFns) {
    for (const fn of s._teardownFns) {
      try { fn(); } catch (_) {}
    }
  }
  _setActiveState(null);
}

// ---------------------------------------------------------------------------
// Public refresh — repaint all 3 panels + header.
// ---------------------------------------------------------------------------
export function refresh(state) {
  if (state) _setActiveState(state);
  const s = _pageState;
  if (!s) return;
  _renderHeader(s);
  _paintAll(s);
}

// ---------------------------------------------------------------------------
// State construction.
//
// Reads the inversion cartridge's shared state for window + samples;
// the comparator is a read-only inspector — it does not own data.
// ---------------------------------------------------------------------------
function _buildPageState(atlasState) {
  const inv = (atlasState && atlasState.inversion) || {};
  // The inversion cartridge keeps the live local-PCA state on
  // atlasState.inversion._local_pca_dosage_state (set by local_pca_dosage.mount).
  // We share-by-reference; the comparator never writes to it.
  const sharedState = inv._local_pca_dosage_state || null;
  return {
    sharedState,
    anchor: 'dosage',        // 'dosage' | 'theta_pi' | 'ghsl'
    linesAxis: 'pc1',        // 'pc1' | 'pc2' — drives the per-sample lines strip
    hoveredSample: -1,
    _teardownFns: [],
    _canvasIds: {
      dosage:    'pcaCompCanvasDosage',
      theta_pi:  'pcaCompCanvasThetaPi',
      ghsl:      'pcaCompCanvasGhsl',
    },
    _statusIds: {
      dosage:    'pcaCompStatusDosage',
      theta_pi:  'pcaCompStatusThetaPi',
      ghsl:      'pcaCompStatusGhsl',
    },
  };
}

// ---------------------------------------------------------------------------
// Header — window label + hovered-sample badge.
// ---------------------------------------------------------------------------
function _renderHeader(state) {
  if (typeof document === 'undefined') return;
  const winLbl = document.getElementById('pcaCompWindowLabel');
  const mbLbl  = document.getElementById('pcaCompMbLabel');
  const hoverEl = document.getElementById('pcaCompHoveredSample');
  const ss = state.sharedState;
  if (!ss || !ss.data) {
    if (winLbl) winLbl.textContent = 'window — (no chromosome loaded)';
    if (mbLbl) mbLbl.textContent = '';
    if (hoverEl) hoverEl.textContent = 'hover: —';
    return;
  }
  const cur = ss.cur;
  const win = ss.data.windows && ss.data.windows[cur];
  if (winLbl) winLbl.textContent = `window ${cur}`;
  if (mbLbl && win && win.center_mb != null) {
    mbLbl.textContent = `· ${ss.data.chrom || ''}: ${win.center_mb.toFixed(3)} Mb`;
  } else if (mbLbl) {
    mbLbl.textContent = '';
  }
  if (hoverEl) {
    if (state.hoveredSample >= 0 && ss.data.samples) {
      const s = ss.data.samples[state.hoveredSample];
      hoverEl.textContent = 'hover: ' + (s ? (s.cga || s.ind || `si=${state.hoveredSample}`)
                                            : `si=${state.hoveredSample}`);
    } else {
      hoverEl.textContent = 'hover: —';
    }
  }
}

// ---------------------------------------------------------------------------
// Paint all 3 panels.
// ---------------------------------------------------------------------------
function _paintAll(state) {
  if (typeof document === 'undefined') return;
  paintPanel(state, 'dosage');
  paintPanel(state, 'theta_pi');
  paintPanel(state, 'ghsl');
  try { paintLines(state, state.linesAxis || 'pc1'); }
  catch (e) { console.warn('pca_comparator: paintLines threw —', e); }
  _refreshLinesStatus(state);
}

function _refreshLinesStatus(state) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('pcaCompStatusLines');
  if (el) el.textContent = `anchor: ${state.anchor || 'dosage'} · ${(state.linesAxis || 'pc1').toUpperCase()}`;
  // Update the PC1/PC2 button highlight to reflect the active axis.
  const b1 = document.getElementById('pcaCompLinesAxisPC1');
  const b2 = document.getElementById('pcaCompLinesAxisPC2');
  if (b1 && b2) {
    const isPC1 = (state.linesAxis || 'pc1') === 'pc1';
    b1.style.background = isPC1 ? 'var(--accent)' : 'var(--panel-2)';
    b1.style.color      = isPC1 ? '#0b0e13'       : 'var(--ink)';
    b1.style.border     = isPC1 ? '0'             : '1px solid var(--rule)';
    b2.style.background = !isPC1 ? 'var(--accent)' : 'var(--panel-2)';
    b2.style.color      = !isPC1 ? '#0b0e13'       : 'var(--ink)';
    b2.style.border     = !isPC1 ? '0'             : '1px solid var(--rule)';
  }
}

// ---------------------------------------------------------------------------
// Toolbar — anchor selector.
// ---------------------------------------------------------------------------
function _wireToolbar(state) {
  if (typeof document === 'undefined') return;
  const anchorSel = document.getElementById('pcaCompAnchor');
  if (anchorSel) {
    anchorSel.value = state.anchor || 'dosage';
    const onChange = (e) => {
      state.anchor = e.target.value;
      _paintAll(state);
    };
    anchorSel.addEventListener('change', onChange);
    state._teardownFns.push(() => anchorSel.removeEventListener('change', onChange));
  }
  // PC1 / PC2 buttons for the per-sample lines strip.
  const b1 = document.getElementById('pcaCompLinesAxisPC1');
  const b2 = document.getElementById('pcaCompLinesAxisPC2');
  if (b1) {
    const onB1 = () => { state.linesAxis = 'pc1'; _paintAll(state); };
    b1.addEventListener('click', onB1);
    state._teardownFns.push(() => b1.removeEventListener('click', onB1));
  }
  if (b2) {
    const onB2 = () => { state.linesAxis = 'pc2'; _paintAll(state); };
    b2.addEventListener('click', onB2);
    state._teardownFns.push(() => b2.removeEventListener('click', onB2));
  }
  // Click-to-scrub on the lines canvas.
  const linesCanvas = document.getElementById('pcaCompLinesCanvas');
  if (linesCanvas) {
    const onClick = (e) => {
      const rect = linesCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const wi = windowAtLinesX(x);
      if (wi < 0) return;
      const ss = state.sharedState;
      if (!ss || !ss.data) return;
      ss.cur = wi;
      refresh(state);
    };
    linesCanvas.addEventListener('click', onClick);
    state._teardownFns.push(() => linesCanvas.removeEventListener('click', onClick));
  }
}

// ---------------------------------------------------------------------------
// Hotkeys — ←/→ scrub the shared window cursor. We mutate
// sharedState.cur so the rest of the atlas (local_pca_dosage etc.) follows
// along when the user navigates back.
// ---------------------------------------------------------------------------
function _wireHotkeys(state) {
  if (typeof document === 'undefined') return;
  const onKey = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // The shell router replaces #app-root.innerHTML between pages and our
    // mount/unmount handler manages this listener's lifetime — so simply
    // checking the page element still exists in the DOM is enough.
    // The old code required a `.active` class that the router never sets,
    // which silently killed arrow-key navigation here.
    const pageEl = document.getElementById('pca_comparator');
    if (!pageEl) return;
    const ss = state.sharedState;
    if (!ss || !ss.data) return;
    const nWin = ss.data.n_windows | 0;
    if (nWin <= 0) return;
    const step = e.shiftKey ? 20 : 1;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      ss.cur = Math.max(0, (ss.cur | 0) - step);
      refresh(state);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      ss.cur = Math.min(nWin - 1, (ss.cur | 0) + step);
      refresh(state);
    }
  };
  document.addEventListener('keydown', onKey);
  state._teardownFns.push(() => document.removeEventListener('keydown', onKey));
}

// ---------------------------------------------------------------------------
// Canvas hover wiring — track which sample is hovered in any panel
// and re-paint all 3 so the highlight follows across.
// ---------------------------------------------------------------------------
function _wireCanvasHover(state) {
  if (typeof document === 'undefined') return;
  for (const layer of ['dosage', 'theta_pi', 'ghsl']) {
    const canvas = document.getElementById(state._canvasIds[layer]);
    if (!canvas) continue;
    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const si = findSampleAtPixel(state, layer, x, y);
      if (si !== state.hoveredSample) {
        state.hoveredSample = si;
        _renderHeader(state);
        _paintAll(state);
      }
    };
    const onLeave = () => {
      if (state.hoveredSample !== -1) {
        state.hoveredSample = -1;
        _renderHeader(state);
        _paintAll(state);
      }
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    state._teardownFns.push(() => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    });
  }
}
