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
  paintTrajectory,
  computeConcordance,
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
    // 2026-05-20: cursor-unit picker (1w / 5w / 10w / 25w / L2 / Cand).
    // Drives ←/→ step size + snap behavior.
    scrubUnit: '1',
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
//
// 2026-05-20 — lazy/cached lines paint. The lines panel paints 226
// polylines × n_windows (~9000 on LG01) onto a canvas → millions of
// ctx ops, ~hundreds of ms blocking the main thread. Quentin: "for
// cross evidence PCA you must lazy load or manage it because its
// freezing". Two-phase fix:
//   1. paintLines is deferred to the next idle/animation frame so the
//      3 scatters reveal instantly. Initial mount no longer blocks
//      ~200ms on the lines render.
//   2. The per-paint scheduler coalesces overlapping refresh() calls
//      (arrow-key scrubs, anchor change, hover) so we never queue a
//      paint while one is already pending.
// The lines renderer (renderer.js#paintLines) internally caches a
// background canvas keyed by (anchor + axis + nWin) — subsequent
// paints with the same key skip the polyline pass and only redraw
// the cursor / yMin/yMax overlay.
// ---------------------------------------------------------------------------
function _paintAll(state) {
  if (typeof document === 'undefined') return;
  paintPanel(state, 'dosage');
  paintPanel(state, 'theta_pi');
  paintPanel(state, 'ghsl');
  _scheduleLinesPaint(state);
  _refreshLinesStatus(state);
}

let _linesPaintScheduled = 0;
function _scheduleLinesPaint(state) {
  if (_linesPaintScheduled) return;
  const run = () => {
    _linesPaintScheduled = 0;
    try { paintLines(state, state.linesAxis || 'pc1'); }
    catch (e) { console.warn('pca_comparator: paintLines threw —', e); }
  };
  // requestIdleCallback when available; rAF fallback. Either way the
  // 3 scatters render synchronously above and the lines fill in on
  // the next tick — the page becomes interactive immediately.
  if (typeof requestIdleCallback === 'function') {
    _linesPaintScheduled = requestIdleCallback(run, { timeout: 120 });
  } else {
    _linesPaintScheduled = requestAnimationFrame(run);
  }
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
  // 2026-05-20: cursor-unit picker on the header. Sets state.scrubUnit
  // which the ←/→ hotkey reads. Persisted so a reload keeps the choice.
  const scrubBar = document.getElementById('pcaCompScrubUnits');
  if (scrubBar) {
    try {
      const saved = localStorage.getItem('pca_comparator.scrubUnit');
      if (saved) state.scrubUnit = saved;
    } catch (_) {}
    scrubBar.querySelectorAll('button[data-scrub-unit]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scrubUnit === state.scrubUnit);
      const onClick = () => {
        state.scrubUnit = btn.dataset.scrubUnit;
        try { localStorage.setItem('pca_comparator.scrubUnit', state.scrubUnit); } catch (_) {}
        scrubBar.querySelectorAll('button[data-scrub-unit]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
      };
      btn.addEventListener('click', onClick);
      state._teardownFns.push(() => btn.removeEventListener('click', onClick));
    });
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
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = (e.key === 'ArrowLeft') ? -1 : 1;
    // 2026-05-20: scrub-unit-aware navigation. The picker on the header
    // sets state.scrubUnit; here we translate it into a target cur.
    // Numeric units = step by N windows (×20 with shift, same as before).
    // L2 snaps to the next/previous L2 envelope boundary; Cand snaps to
    // the next/previous candidate. Both read from the local_pca_dosage
    // stash (inv._local_pca_dosage_state) — comparator is a read-only
    // inspector and doesn't own L2/candidate state.
    const unit = state.scrubUnit || '1';
    const cur = ss.cur | 0;
    let target = cur;
    if (unit === 'l2') {
      target = _snapToL2(state, cur, dir);
    } else if (unit === 'cand') {
      target = _snapToCandidate(state, cur, dir);
    } else {
      const step = (parseInt(unit, 10) || 1) * (e.shiftKey ? 20 : 1);
      target = cur + dir * step;
    }
    ss.cur = Math.max(0, Math.min(nWin - 1, target));
    refresh(state);
  };
  document.addEventListener('keydown', onKey);
  state._teardownFns.push(() => document.removeEventListener('keydown', onKey));
}

// ---------------------------------------------------------------------------
// Snap helpers for the cursor-unit picker (2026-05-20).
// Both helpers read L2 / candidate state from the local_pca_dosage stash
// since the comparator is a read-only inspector and doesn't own that
// state. Fall back to a ±25 window step when the source isn't available
// so the keypress still moves the cursor noticeably.
// ---------------------------------------------------------------------------
function _snapToL2(state, cur, dir) {
  const ss = state.sharedState;
  const wToL2 = ss && ss.windowToL2;
  const env = ss && ss.data && ss.data.l2_envelopes;
  if (!wToL2 || !Array.isArray(env) || env.length === 0) return cur + dir * 25;
  // Find the next L2 boundary in `dir`. Boundaries are at e._s0 (left
  // edge) and e._e0 + 1 (right edge) of each envelope. We collect all
  // boundary window indices on the chrom, sort, and pick the closest
  // strictly in the direction of travel.
  const boundaries = [];
  for (const e of env) {
    if (!e) continue;
    if (Number.isFinite(e._s0)) boundaries.push(e._s0);
    if (Number.isFinite(e._e0)) boundaries.push(Math.min((ss.data.n_windows | 0) - 1, e._e0 + 1));
  }
  if (boundaries.length === 0) return cur + dir * 25;
  boundaries.sort((a, b) => a - b);
  if (dir > 0) {
    for (const b of boundaries) if (b > cur) return b;
    return boundaries[boundaries.length - 1];
  } else {
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (boundaries[i] < cur) return boundaries[i];
    }
    return boundaries[0];
  }
}

function _snapToCandidate(state, cur, dir) {
  const ss = state.sharedState;
  const cands = ss && Array.isArray(ss.candidateList) ? ss.candidateList : [];
  if (cands.length === 0) return cur + dir * 25;
  // Anchor each candidate at its ref_window (or start_w as fallback).
  const anchors = [];
  for (const c of cands) {
    if (!c) continue;
    const w = Number.isFinite(c.ref_window) ? c.ref_window
            : Number.isFinite(c.start_w)   ? c.start_w
            : null;
    if (w != null) anchors.push(w | 0);
  }
  if (anchors.length === 0) return cur + dir * 25;
  anchors.sort((a, b) => a - b);
  if (dir > 0) {
    for (const a of anchors) if (a > cur) return a;
    return anchors[anchors.length - 1];
  } else {
    for (let i = anchors.length - 1; i >= 0; i--) {
      if (anchors[i] < cur) return anchors[i];
    }
    return anchors[0];
  }
}

// ---------------------------------------------------------------------------
// Canvas hover wiring — track which sample is hovered in any panel
// and re-paint all 3 so the highlight follows across.
// ---------------------------------------------------------------------------
function _wireCanvasHover(state) {
  if (typeof document === 'undefined') return;
  // 2026-05-20: comparator hover was repainting EVERYTHING on every
  // mousemove that changed hoveredSample — 3 scatters AND the
  // per-sample lines panel (226 polylines × thousands of windows).
  // The lines redraw was the bottleneck (Quentin: "The PCA comparator
  // page is supper slow and laggy"). Fixes:
  //   1. rAF-coalesce hover repaints so multiple moves in the same
  //      frame batch into one paint.
  //   2. Skip paintLines on hover-only changes. The lines panel doesn't
  //      visually highlight the hovered sample meaningfully (one of 226
  //      threads gets amber instead of light blue — invisible). It
  //      stays repainted on click / arrow-key (cursor scrub) where it
  //      actually matters.
  //   3. Only repaint the 3 scatters on hover.
  let _hoverRafId = 0;
  const requestHoverRepaint = () => {
    if (_hoverRafId) return;
    _hoverRafId = requestAnimationFrame(() => {
      _hoverRafId = 0;
      _renderHeader(state);
      paintPanel(state, 'dosage');
      paintPanel(state, 'theta_pi');
      paintPanel(state, 'ghsl');
    });
  };
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
        requestHoverRepaint();
      }
    };
    const onLeave = () => {
      if (state.hoveredSample !== -1) {
        state.hoveredSample = -1;
        requestHoverRepaint();
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
