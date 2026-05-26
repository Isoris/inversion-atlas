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
import {
  paintHeatmap,
  findCellAtPixel,
} from './pca_comparator/heatmap.js';
import { renderModeBBadge } from '../../../../core/mode_b_badge.js';

// ─── Mode-B 3-axis probe (2026-05-20) ───────────────────────────────────
// Independently resolves the three discovery layers via the registry for
// the active chrom — bypassing local_pca_dosage's pre-merged stash so the
// page-side data path can be cross-checked against the registry's own
// view. Pass = all 3 axes loaded AND their window counts agree (the
// natural definition of "the 3 pipelines are at consistent state for
// this chrom"). Fail-soft: any axis missing → ⚠; nothing loaded → ○.
async function _runThreeAxisProbe(atlasState, registry) {
  const slot = (typeof document !== 'undefined')
    ? document.getElementById('pccModeBBadge')
    : null;
  if (!slot) return;
  const chrom = atlasState && atlasState.shared && atlasState.shared.activeChrom;
  if (!chrom) {
    renderModeBBadge('pccModeBBadge',
      { ok: false, reason: 'empty-result' },
      { label: '3-axis freshness', layerKey: 'scrubber_*' });
    return;
  }
  if (!registry || typeof registry.resolve !== 'function') {
    renderModeBBadge('pccModeBBadge',
      { ok: false, reason: 'registry-not-injected' },
      { label: '3-axis freshness', layerKey: 'scrubber_*', context: chrom });
    return;
  }
  const axes = [
    { id: 'z-blocks', layer: 'scrubber_main',    keys: ['windows'] },
    { id: 'θπ',       layer: 'scrubber_thetapi', keys: ['theta_pi_local_pca', 'windows', 'theta_pi_per_window'] },
    { id: 'GHSL',     layer: 'scrubber_ghsl',    keys: ['ghsl_panel', 'windows', 'ghsl_per_window'] },
  ];
  const results = await Promise.all(axes.map(async (a) => {
    try {
      const p = await Promise.resolve(registry.resolve(a.layer, { chrom }));
      if (!p) return { axis: a.id, layer: a.layer, n: 0, present: false };
      let arr = null;
      for (const k of a.keys) {
        const v = p[k];
        if (Array.isArray(v) && v.length > 0) { arr = v; break; }
      }
      return { axis: a.id, layer: a.layer, n: arr ? arr.length : 0, present: !!arr };
    } catch (_) {
      return { axis: a.id, layer: a.layer, n: 0, present: false };
    }
  }));

  const loaded = results.filter((r) => r.present);
  const counts = new Set(loaded.map((r) => r.n));
  const allAgree = counts.size === 1;
  const pass = loaded.length === 3 && allAgree;
  const drift = loaded.length > 0 && !pass;

  const summaryParts = results.map((r) =>
    r.present ? `${r.axis} ${r.n}w` : `${r.axis} —`);
  const summary = `${loaded.length}/3 axes loaded · ${summaryParts.join(' · ')}` +
    (loaded.length === 3
      ? (allAgree ? ' · counts agree' : ' · window-count disagreement!')
      : '');

  renderModeBBadge('pccModeBBadge',
    loaded.length > 0
      ? { ok: true, n: loaded.length, rows: loaded, sample_keys: ['axis', 'layer', 'n', 'present'], payload: results }
      : { ok: false, reason: 'empty-result' },
    {
      label:    '3-axis freshness',
      layerKey: 'scrubber_main + scrubber_thetapi + scrubber_ghsl',
      context:  chrom,
      compare:  () => ({ pass: pass && !drift, summary }),
    });
}

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
  try { _wireHeatmap(pageState); } catch (e) {
    console.warn('pca_comparator.mount: heatmap wiring threw —', e);
  }
  try { refresh(pageState); } catch (e) {
    console.warn('pca_comparator.mount: refresh threw —', e);
  }
  if (atlasState.inversion) {
    atlasState.inversion._page_pca_comparator_state = pageState;
  }

  // Mode-B 3-axis probe — non-blocking. Surfaces independent per-axis
  // resolve results for the active chrom; the page renders from the
  // pre-merged local_pca_dosage stash regardless.
  _runThreeAxisProbe(atlasState, registry).catch((e) => {
    console.warn('pca_comparator.mount: 3-axis probe threw —', e);
  });
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
    // 2026-05-20: heatmap scope toggle (genome / focal). 'genome' renders
    // every window (default); 'focal' restricts to a slab matching the
    // current scrubUnit centered on the cursor, so the heatmap shows the
    // same interval the 3 PCAs are sampling. User-asked: "10w so 10
    // windows by 10 windows … click focal and it would show the dosage
    // but for 10 windows like the same interval as focal."
    heatmapScope: 'genome',
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
  // 2026-05-20 Phase 2: trajectory panel + concordance badge.
  _refreshTrajectoryAndConcord(state);
}

// Show/hide the per-sample trajectory row + compute concordance badge.
// Runs on every header refresh (cheap when nothing to do; the heavy
// trajectory paint is gated on hoveredSample being valid).
function _refreshTrajectoryAndConcord(state) {
  if (typeof document === 'undefined') return;
  const wrap = document.getElementById('pcaCompTrajectoryWrap');
  const label = document.getElementById('pcaCompTrajLabel');
  const badge = document.getElementById('pcaCompConcordBadge');
  const si = state.hoveredSample;
  const ss = state.sharedState;
  if (si < 0 || !ss || !ss.data) {
    if (wrap) wrap.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = 'flex';
  if (label && ss.data.samples && ss.data.samples[si]) {
    const s = ss.data.samples[si];
    label.textContent = (s.cga || s.ind || `si=${si}`);
  } else if (label) {
    label.textContent = `si=${si}`;
  }
  try { paintTrajectory(state, si); } catch (e) {
    console.warn('paintTrajectory:', e);
  }
  if (badge) {
    let cc = null;
    try { cc = computeConcordance(state, si); } catch (_) {}
    if (cc && Number.isFinite(cc.frac)) {
      const pct = Math.round(cc.frac * 100);
      const col = cc.frac >= 0.9 ? '#3cc08a'
                : cc.frac >= 0.6 ? '#f5a524'
                : '#e0555c';
      badge.style.display = 'inline';
      badge.style.color = col;
      badge.style.borderColor = col;
      badge.textContent = `concord ${pct}% (${cc.agree}/${cc.total}w)`;
      badge.title = `PC1-sign agreement across all 3 evidence axes for this sample: ${cc.agree} of ${cc.total} valid windows. High = consistent biology across signals; low = layers disagree (recombinant / mosaic).`;
    } else {
      badge.style.display = 'none';
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
  // 2026-05-26: heatmap moved off the sync path. paintHeatmap builds an
  // Int8Array(nWin×nSam) + per-pixel ImageData fill (~2M writes on LG01)
  // and was blocking first paint right next to paintLines. Both now go
  // through _scheduleHeavyPaints — 3 scatters reveal instantly, heatmap
  // fills in on the next idle tick, lines on the one after.
  _paintPlaceholder('pcaCompHeatmapCanvas', 'computing band heatmap…');
  _paintPlaceholder('pcaCompLinesCanvas',   'computing per-sample lines…');
  _scheduleHeavyPaints(state);
  _refreshLinesStatus(state);
}

// Quick "computing…" placeholder so the user sees feedback during the
// idle-callback gap before the real paint runs. Only fires once per
// mount — subsequent refresh() calls have a cached paint and don't
// need the placeholder. Cheap (single text draw); never blocks.
function _paintPlaceholder(canvasId, msg) {
  if (typeof document === 'undefined') return;
  const c = document.getElementById(canvasId);
  if (!c) return;
  // Skip if the canvas already has content (cached paint from a prior
  // refresh — no point flashing the placeholder over a finished image).
  if (c.dataset.painted === '1') return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = Math.max(1, c.clientWidth  | 0);
  const cssH = Math.max(1, c.clientHeight | 0);
  if (c.width !== cssW * dpr || c.height !== cssH * dpr) {
    c.width  = cssW * dpr;
    c.height = cssH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = 'rgba(160,180,200,0.55)';
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, cssW / 2, cssH / 2);
}

let _heavyPaintScheduled = 0;
function _scheduleHeavyPaints(state) {
  if (_heavyPaintScheduled) return;
  const run = () => {
    _heavyPaintScheduled = 0;
    try { paintHeatmap(state); }
    catch (e) { console.warn('pca_comparator: paintHeatmap threw —', e); }
    const heatCanvas = document.getElementById('pcaCompHeatmapCanvas');
    if (heatCanvas) heatCanvas.dataset.painted = '1';
    // Lines piggyback on the next frame so the heatmap reveal isn't
    // blocked by the polyline pass on a cold cache.
    const runLines = () => {
      try { paintLines(state, state.linesAxis || 'pc1'); }
      catch (e) { console.warn('pca_comparator: paintLines threw —', e); }
      const linesCanvas = document.getElementById('pcaCompLinesCanvas');
      if (linesCanvas) linesCanvas.dataset.painted = '1';
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runLines, { timeout: 200 });
    } else {
      requestAnimationFrame(runLines);
    }
  };
  if (typeof requestIdleCallback === 'function') {
    _heavyPaintScheduled = requestIdleCallback(run, { timeout: 120 });
  } else {
    _heavyPaintScheduled = requestAnimationFrame(run);
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
        // 2026-05-20: when in focal heatmap scope, scrubUnit change
        // implies a different slab width — repaint so the heatmap
        // tracks the new unit.
        if (state.heatmapScope === 'focal') refresh(state);
      };
      btn.addEventListener('click', onClick);
      state._teardownFns.push(() => btn.removeEventListener('click', onClick));
    });
  }
  // 2026-05-20: heatmap scope toggle (genome / focal).
  const scopeBar = document.getElementById('pcaCompHeatmapScopeBar');
  if (scopeBar) {
    try {
      const saved = localStorage.getItem('pca_comparator.heatmapScope');
      if (saved === 'focal' || saved === 'genome') state.heatmapScope = saved;
    } catch (_) {}
    scopeBar.querySelectorAll('button[data-heatmap-scope]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.heatmapScope === state.heatmapScope);
      const onClick = () => {
        state.heatmapScope = btn.dataset.heatmapScope;
        try { localStorage.setItem('pca_comparator.heatmapScope', state.heatmapScope); } catch (_) {}
        scopeBar.querySelectorAll('button[data-heatmap-scope]').forEach(b => {
          b.classList.toggle('active', b === btn);
        });
        refresh(state);
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
// ---------------------------------------------------------------------------
// Heatmap wiring — click a column to scrub the shared window cursor
// (which the 3 PCAs above then follow); hover a row to highlight the
// sample across the 3 PCAs (same hoveredSample mechanism as the dots).
// ---------------------------------------------------------------------------
function _wireHeatmap(state) {
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('pcaCompHeatmapCanvas');
  if (!canvas) return;
  const onMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cell = findCellAtPixel(e.clientX - rect.left, e.clientY - rect.top);
    const si = cell ? cell.si : -1;
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
  const onClick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cell = findCellAtPixel(e.clientX - rect.left, e.clientY - rect.top);
    if (!cell) return;
    const ss = state.sharedState;
    if (!ss || !ss.data) return;
    const nWin = ss.data.n_windows | 0;
    if (nWin <= 0) return;
    ss.cur = Math.max(0, Math.min(nWin - 1, cell.w | 0));
    refresh(state);
  };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  state._teardownFns.push(() => {
    canvas.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('mouseleave', onLeave);
    canvas.removeEventListener('click', onClick);
  });
}

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
