// pages/discovery/local_pca_dosage/lines_panel.js
//
// Per-sample lines panel (round 4 split, 2026-05-06).
//
// drawLinesPanel: the per-sample line traces across windows, the
// secondary y-axis with strip overlays, the lasso-selection overlay,
// the candidate-band paint, and the various color modes (kmeans,
// theta_pi, GHSL, het_rate, etc.).
//
// buildLinesPanel + buildLinesPanelCheckboxes wire the panel's controls.
// refreshLinesColorMode revalidates the user's saved color mode against
// available layers. setLinesPanelCandidateBands toggles candidate-band
// shading.
//
// Bodies extracted verbatim from the pre-split local_pca_dosage.js (eighth pass).

import { fitCanvas, formatTrackVal, themeColor, withAlpha } from '../../../shared/page1_utils.js';

import { _resolveSampleScopeColor, _setActiveState, trackedColor } from './_state.js';
import { _LINES_COLOR_MODES, _isLinesColorModeAvailable, availablePCs, currentMbRange, getLinesGrid, getLinesSignAt, getLinesValuesAt } from './_data.js';
import { _drawBandTraceStrip, _drawDiamondOverlay, _drawInheritanceLabelsStrip, _drawLineageStrip, _drawRegimeBreadthStrip, _drawSnpDensityShade, _drawSnpDensityStrip, _drawTrackedLinkageStrip, _drawTransitionRateStrip } from './z_panel.js';
import { drawPCA } from './pca_panel.js';
import { _ensureCsOverlayIndex, _paintCandidateBands } from './candidates.js';
import { setCur } from './events.js';
import { wireBandTraceTooltip } from './band_trace_tooltip.js';
import { wireInheritancePillTooltip } from './inheritance_tooltip.js';
import { maybeShowFishInspectPopover } from './fish_inspect_popover.js';

// --- drawLinesPanel(state) — legacy lines 34894-35744 ---
export function drawLinesPanel(state) {
  _setActiveState(state);
  if (!state.data) return;
  const container = document.getElementById('linesCanvasContainer');
  if (!container || typeof container.querySelectorAll !== 'function') return;
  const subs = container.querySelectorAll('.lines-subpanel');
  if (!subs || subs.length === 0) return;

  // 2026-05-18: keep the band-trace pick dropdown in sync with the focal
  // candidate. The full rebuild fires only when the candidate ID changes
  // (one-shot per scrub), so the cost is amortized to ~free.
  const curCandId = state.candidate ? state.candidate.id : null;
  if (state._lastBandTracePickCandId !== curCandId) {
    state._lastBandTracePickCandId = curCandId;
    if (typeof window !== 'undefined' && window._updateBandTracePickOptions) {
      try { window._updateBandTracePickOptions(); } catch (_) {}
    }
  }

  const d = state.data;
  const nWin = d.n_windows;
  const nS = d.n_samples;
  if (nWin < 2 || nS === 0) return;

  const trackedSet = new Set(state.tracked);
  const mbs = d.windows.map(w0 => w0.center_mb);
  const _mbR = currentMbRange(state);
  const mbMin = _mbR.mbMin, mbMax = _mbR.mbMax;

  for (const sub of subs) {
    const source = sub.dataset.linesSource;
    const cv = sub.querySelector('canvas');
    if (!cv) continue;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);

    // v3.99 turn 6: pad.t reduced 18 → 6 for tighter compact layout, per
     // Quentin's request. MUST match _computeLinesLassoSamples pad above.
    const pad = { l: 44, r: 16, t: 6, b: 8 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    if (plotW <= 0 || plotH <= 0) continue;

    // Resolve the source's native grid. PC sources use the precomp grid;
    // GHSL sources (het, ghsl_div_<scale>) use the GHSL panel grid which has
    // its own n_windows and bp positions. The X-axis is always the precomp's
    // [mbMin, mbMax] so all sub-panels stay vertically aligned along the
    // chromosome regardless of which grid each source uses.
    const sourceGrid = getLinesGrid(state, source);   // null = precomp grid
    let nGrid;
    let mbAt;   // function: gridIdx -> mb position
    if (sourceGrid) {
      nGrid = sourceGrid.length;
      mbAt = (gi) => sourceGrid[gi] / 1e6;
    } else {
      nGrid = nWin;
      mbAt = (gi) => mbs[gi];
    }
    if (nGrid < 2) {
      ctx.fillStyle = themeColor('dim');
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`(${source.toUpperCase()} not available in this dataset)`, w / 2, h / 2);
      continue;
    }

    // v3.99 turn 7 perf: per-source cache for the expensive y-matrix +
    // y-bounds + x-by-grid. None of these depend on state.cur — they're
    // pure functions of (source data, source sign, plotW, plotH, mb range,
    // pad). On window-by-window stepping the inputs don't change, so we
    // can reuse the entire computation. Cache key includes everything that
    // affects the values; on cache hit we just re-stroke the polylines on
    // top of the freshly cleared canvas.
    if (!state.__linesCache) state.__linesCache = {};
    const cacheKey = [
      'v1',
      source,
      nGrid,
      mbMin.toFixed(6), mbMax.toFixed(6),
      plotW, plotH,
      pad.l, pad.r, pad.t, pad.b,
      // sign array is per-grid-step; the data it derives from rarely
      // changes during stepping, but include a coarse marker so flips
      // (sign-align toggle) invalidate. state.flipPC1 controls whether
      // the per-window sign-flip is applied to the PC1 source.
      state.flipPC1 ? 'sa' : '',
      // data identity — if the user loads a different chromosome the cache
      // must miss
      state.data && state.data.chrom ? state.data.chrom : '',
    ].join('|');
    let cached = state.__linesCache[source];
    if (!cached || cached._key !== cacheKey) {
      // Compute Y range across all samples and all windows for this source
      let yMin = Infinity, yMax = -Infinity;
      let validData = false;
      for (let gi = 0; gi < nGrid; gi++) {
        const vals = getLinesValuesAt(state, gi, source);
        if (!vals) continue;
        const sign = getLinesSignAt(state, gi, source);
        for (let si = 0; si < nS; si++) {
          const v = vals[si] * sign;
          if (!isFinite(v)) continue;
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
          validData = true;
        }
      }
      if (!validData) {
        // Source not present — render an info message (not cached)
        ctx.fillStyle = themeColor('dim');
        ctx.font = '12px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`(${source.toUpperCase()} not available in this dataset)`, w / 2, h / 2);
        continue;
      }
      const yPad = (yMax - yMin) * 0.05 || 0.01;
      yMin -= yPad; yMax += yPad;
      const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
      const xByGrid = new Float32Array(nGrid);
      for (let gi = 0; gi < nGrid; gi++) {
        xByGrid[gi] = pad.l + ((mbAt(gi) - mbMin) / (mbMax - mbMin)) * plotW;
      }
      const yMatrix = new Array(nS);
      for (let si = 0; si < nS; si++) {
        const arr = new Float32Array(nGrid);
        for (let i = 0; i < nGrid; i++) arr[i] = NaN;
        yMatrix[si] = arr;
      }
      for (let gi = 0; gi < nGrid; gi++) {
        const vals = getLinesValuesAt(state, gi, source);
        if (!vals) continue;
        const sign = getLinesSignAt(state, gi, source);
        for (let si = 0; si < nS; si++) {
          const v = vals[si] * sign;
          if (isFinite(v)) yMatrix[si][gi] = toY(v);
        }
      }
      cached = { _key: cacheKey, yMin, yMax, xByGrid, yMatrix };
      state.__linesCache[source] = cached;
    }
    const yMin = cached.yMin;
    const yMax = cached.yMax;
    const xByGrid = cached.xByGrid;
    const yMatrix = cached.yMatrix;
    // toY still defined for downstream cursor-overlay code that needs to
    // forward-map a y value not in the cache (rare — kept for compatibility
    // with the geometry stash + click-inspect popover).
    const toY = (v) => pad.t + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const toX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

    // v3.87: stash this sub-canvas's geometry on state so the click-inspect
    // popover can forward-map per-sample values into canvas y to find the
    // closest tracked fish at a click position. Keyed by source name.
    if (!state.__linesGeom) state.__linesGeom = {};
    state.__linesGeom[source] = {
      pad: { l: pad.l, r: pad.r, t: pad.t, b: pad.b },
      plotW, plotH, w, h,
      mbMin, mbMax, yMin, yMax,
      nGrid, sourceGrid: !!sourceGrid,
    };

    // turn 141 Slice 1: per-candidate vertical band highlights.
    // SPEC §2.4 — bands paint FIRST so they're pure background; lines,
    // tracking highlights, the cursor crosshair, and the inheritance
    // strip all stack on top. Gated on state.linesPanelCandidateBands
    // (default ON, persisted). Helper handles all filtering / clipping
    // / palette assignment. Wrapped in try/catch so a misbehaving
    // candidate (e.g. a malformed bp value) can't take out the whole
    // panel — band drawing is purely additive and safe to skip.
    if (state.linesPanelCandidateBands !== false) {
      try {
        _paintCandidateBands(ctx, {
          pad, plotW, plotH, toX, mbMin, mbMax,
          candidates: Array.isArray(state.candidateList) ? state.candidateList : [],
          chrom: (state.data && state.data.chrom) ? state.data.chrom : null,
        });
      } catch (e) {
        // Defensive: never let band-drawing failure block the rest of
        // the lines panel from rendering.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[lines/candBands] paint failed:', e && e.message);
        }
      }
    }

    // Frame
    ctx.strokeStyle = themeColor('rule');
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW, plotH);

    // Y-axis ticks (3 ticks: min, mid, max)
    // v3.79: switched from themeColor('dim') (--ink-dim, light-grey) to
    // themeColor('ink') (--ink, white in dark mode / dark-grey in light) for
    // full contrast — the dim tone was reading as black/illegible against
    // dark backgrounds in some configurations.
    ctx.fillStyle = themeColor('ink');
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const yMid = (yMin + yMax) / 2;
    for (const v of [yMin + (yMax - yMin) * 0.05, yMid, yMax - (yMax - yMin) * 0.05]) {
      const yp = toY(v);
      ctx.fillText(formatTrackVal(v), pad.l - 4, yp);
      ctx.strokeStyle = 'rgba(42,50,66,0.4)';
      ctx.beginPath();
      ctx.moveTo(pad.l, yp + 0.5); ctx.lineTo(pad.l + plotW, yp + 0.5);
      ctx.stroke();
    }

    // v3.99 turn 7 perf: xByGrid + yMatrix were previously built here on
    // every draw. They're now provided by state.__linesCache[source] above
    // (rebuilt only when inputs change). Helpers below (strokeSamplePath,
    // strokeSamplePathStyled) close over the cached references.

    // Helper to stroke a polyline with NaN gap handling
    function strokeSamplePath(si) {
      const ys = yMatrix[si];
      let started = false;
      ctx.beginPath();
      for (let gi = 0; gi < nGrid; gi++) {
        const y = ys[gi];
        if (!isFinite(y)) { started = false; continue; }
        const x = xByGrid[gi];
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
    }

    // v3.85: per-segment-styled stroke for tracked fish whose K=3 vote inside
    // the active candidate differs from their consensus regime. Inputs:
    //   si:        sample index
    //   jumpMask:  Uint8Array(nGrid), 1 = this window falls inside an L2
    //              where this fish jumped parents
    //   normalStyle: { strokeStyle, lineWidth, dash }
    //   jumpStyle:   { strokeStyle, lineWidth, dash }
    // The polyline is broken into runs of constant mask value, each stroked
    // with its own style. NaN gaps still break the line. A small overlap of
    // 1 vertex between adjacent runs keeps the visual transition smooth.
    function strokeSamplePathStyled(si, jumpMask, normalStyle, jumpStyle) {
      const ys = yMatrix[si];
      // Walk gi, accumulate runs
      let runStart = -1;
      let runMask = 0;
      const flushRun = (giEnd) => {
        if (runStart < 0) return;
        const style = runMask ? jumpStyle : normalStyle;
        ctx.save();
        ctx.strokeStyle = style.strokeStyle;
        ctx.lineWidth = style.lineWidth;
        if (style.dash) ctx.setLineDash(style.dash); else ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        // Include 1 extra vertex on either end (where finite) so segments
        // visually meet. Use clamped indices.
        const giA = Math.max(0, runStart - (runMask ? 0 : 0));
        const giB = Math.min(nGrid - 1, giEnd + (runMask ? 0 : 0));
        for (let gi = giA; gi <= giB; gi++) {
          const y = ys[gi];
          if (!isFinite(y)) { started = false; continue; }
          const x = xByGrid[gi];
          if (!started) { ctx.moveTo(x, y); started = true; }
          else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.restore();
        runStart = -1;
      };
      for (let gi = 0; gi < nGrid; gi++) {
        const m = jumpMask[gi];
        if (runStart < 0) { runStart = gi; runMask = m; continue; }
        if (m !== runMask) {
          flushRun(gi);   // close previous run at gi-1, but include gi as overlap
          runStart = gi - 1;   // start next run one vertex earlier so segments meet
          if (runStart < 0) runStart = 0;
          runMask = m;
        }
      }
      flushRun(nGrid - 1);
    }

    // Draw untracked first as a single batched stroke per sample (cheap)
    // v3.99 turn 8 perf: the untracked-gray cloud (~200-220 polylines × nGrid
    // segments) is a pure function of (yMatrix, xByGrid, trackedSet, w, h).
    // None of those depend on state.cur. Cache an offscreen canvas with the
    // pre-stroked cloud and blit it on each frame instead of re-stroking.
    // Cache key includes the trackedSet hash since picking a sample to track
    // moves it from the untracked-gray bucket to the colored-overlay bucket.
    // v4 turn 108: cache key also includes state.linesColorMode so switching
    // from kmeans to family (or any other mode) invalidates the cache and
    // triggers a re-stroke with per-sample colors.
    let trackedHashLocal = 0;
    for (const si of trackedSet) trackedHashLocal += si | 0;
    trackedHashLocal = (trackedHashLocal * 31) ^ (trackedSet.size << 16);
    const lcMode = state.linesColorMode || 'kmeans';
    const overlayCacheKey = cacheKey + '|tr=' + trackedHashLocal +
                            '|wh=' + w + 'x' + h + '|lc=' + lcMode;
    if (!cached.bgCanvas || cached.bgCanvasKey !== overlayCacheKey) {
      // (Re)build offscreen canvas. Use a plain canvas (matches main 2D
      // context) sized to the visible CSS pixels of the live canvas — so
      // drawImage maps 1:1 without scaling artifacts.
      const off = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0))
        : (function() {
            const c = document.createElement('canvas');
            c.width = Math.max(1, w | 0);
            c.height = Math.max(1, h | 0);
            return c;
          })();
      const offCtx = off.getContext('2d');
      offCtx.lineWidth = 0.6;
      // v4 turn 108: per-sample coloring. For modes that produce one color
      // per sample (family, lineage, F_ROH, kmeans-as-stable-band), call
      // the resolver per sample. For 'kmeans' we keep the legacy grey-cloud
      // behavior because the per-window lane assignments are conveyed by
      // the WALKING of each line through the band y-positions, not by line
      // color (every sample is the same grey). For 'family' / 'lineage',
      // each fish gets its family / lineage color across all windows; alpha
      // bumped to 0.25 so saturated colors remain readable when 226 lines
      // overlap.
      // 2026-05-18: 'lineage' added. The dropdown previously offered it
      // but the lines stayed grey — only 'family' triggered the
      // per-sample-coloring branch. Other window-varying modes (het /
      // dosage / θπ / GHSL / F_ROH) still need per-sample-mean resolvers
      // (separate port; per-window coloring would require breaking the
      // line into colored segments which is a larger render change).
      const usePerSampleColor = (lcMode === 'family' || lcMode === 'lineage');
      const baseAlpha = usePerSampleColor ? 0.25 : 0.10;
      const defaultStroke = `rgba(180,190,210,${baseAlpha.toFixed(3)})`;
      offCtx.strokeStyle = defaultStroke;
      // v4 turn 126: track how many samples got a real per-sample color.
      // If we're in family mode but every sample falls back to the default
      // stroke (because family_id isn't loaded on samples), the visual
      // result is identical to kmeans mode — Quentin reported "color by
      // family doesn't color." A notice gets drawn on the live canvas
      // below to make this state visible instead of silently no-op'ing.
      let _perSampleColorHits = 0;
      for (let si = 0; si < nS; si++) {
        if (trackedSet.has(si)) continue;
        // Pick per-sample stroke color when in a per-sample-coloring mode.
        if (usePerSampleColor) {
          const c = _resolveSampleScopeColor(si, lcMode);
          if (c) {
            _perSampleColorHits++;
            // c may be 'rgb(r,g,b)' or '#rrggbb' — wrap with alpha.
            offCtx.strokeStyle = withAlpha(c, baseAlpha);
          } else {
            offCtx.strokeStyle = defaultStroke;
          }
        }
        const ys = yMatrix[si];
        let started = false;
        offCtx.beginPath();
        for (let gi = 0; gi < nGrid; gi++) {
          const y = ys[gi];
          if (!isFinite(y)) { started = false; continue; }
          const x = xByGrid[gi];
          if (!started) { offCtx.moveTo(x, y); started = true; }
          else { offCtx.lineTo(x, y); }
        }
        offCtx.stroke();
      }
      cached.bgCanvas = off;
      cached.bgCanvasKey = overlayCacheKey;
      // Stash the diagnostic so the live-canvas pass below can draw a notice.
      // We stash it on `cached` so subsequent frames (when the cache is
      // re-blitted instead of re-built) can still surface the notice.
      cached.bgFamilyMissing = (usePerSampleColor && _perSampleColorHits === 0);
      cached.bgFamilyDistinct = 0;
      if (usePerSampleColor) {
        // Count distinct non-fallback colors so the notice can hint at it.
        const distinct = new Set();
        for (let si = 0; si < nS; si++) {
          if (typeof _resolveSampleScopeColor !== 'function') break;
          const c = _resolveSampleScopeColor(si, lcMode);
          if (c) distinct.add(c);
        }
        cached.bgFamilyDistinct = distinct.size;
      }
    }
    // Blit the pre-rendered untracked cloud (single drawImage call instead
    // of ~220 strokes × nGrid segments). Massive speedup on stepping.
    ctx.drawImage(cached.bgCanvas, 0, 0);

    // v4 turn 126: family-mode "no data" notice. When the user picks
    // "color: family" but the loaded JSON doesn't have family_id on samples,
    // every line falls back to the default grey stroke — looking identical
    // to kmeans mode and producing Quentin's "color by family doesn't color"
    // report. Drawn ONLY on PC1 sub-panel (one notice, not per-subpanel) and
    // ONLY when the diagnostic flagged us as no-hits. Notice is small,
    // amber-tinted, top-right of the plot so it doesn't obscure data.
    if (source === 'pc1' && cached.bgFamilyMissing) {
      ctx.save();
      const msg = 'family mode: no family data loaded — drag-drop ngsRelate JSON';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const textW = ctx.measureText(msg).width;
      const noticeX = w - 8;
      const noticeY = pad.t + 4;
      // Faint amber backdrop so the text reads against the line cloud
      ctx.fillStyle = 'rgba(245, 165, 36, 0.15)';
      ctx.fillRect(noticeX - textW - 6, noticeY - 2, textW + 8, 14);
      ctx.strokeStyle = 'rgba(245, 165, 36, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(noticeX - textW - 6 + 0.5, noticeY - 2 + 0.5, textW + 8 - 1, 14 - 1);
      ctx.fillStyle = 'rgba(245, 165, 36, 0.95)';
      ctx.fillText(msg, noticeX - 2, noticeY);
      ctx.restore();
    }

    // v3.76: Lasso mode for the PC1 sub-canvas — suppress tracked-color so
    // the user can pick fresh by trajectory. Tracked samples still render but
    // in dim grey (same treatment as untracked, slightly brighter so they're
    // identifiable). Lassoed samples render in accent color so the user sees
    // the live selection. Other sub-canvases ignore lasso mode entirely.
    const isPC1 = (source === 'pc1');
    const lassoOnHere = isPC1 && state.linesLassoActive;
    const lassoSet = lassoOnHere ? new Set(state.linesLassoSelected || []) : null;
    if (lassoOnHere) {
      // Tracked samples → dim grey (slightly brighter than untracked so still readable)
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(200,210,225,0.18)';
      for (const si of state.tracked) {
        if (lassoSet && lassoSet.has(si)) continue;   // will render in accent below
        strokeSamplePath(si);
      }
      // Lassoed samples → accent color (gold)
      if (lassoSet && lassoSet.size > 0) {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = '#f5a524';
        for (const si of lassoSet) strokeSamplePath(si);
      }
    } else {
      // Tracked lines (full color, full opacity) — original behavior
      // v3.85: when an active candidate has fish_calls and this is the PC1
      // sub-canvas, build a per-fish jumpMask: 1 = this grid index falls
      // inside an L2 where the fish's K=3 vote differs from its consensus
      // regime. Tracked fish with no jumps stroke the normal way; jumpers
      // get strokeSamplePathStyled which breaks the polyline at L2 boundaries
      // and renders the "jumped" segments in dashed red.
      const cand = (isPC1 && state.candidate) ? state.candidate : null;
      const candFishCalls = (cand && Array.isArray(cand.fish_calls))
        ? cand.fish_calls : null;
      const candL2s = (cand && Array.isArray(cand.l2_indices))
        ? cand.l2_indices : null;
      // Precompute per-L2 mb-range for the candidate (so we can map gi → L2idx
      // by mb position without rebuilding the lookup per fish).
      // v3.86: when the lines panel is rendering on the precomp grid (i.e.
      // sourceGrid is null and nGrid === nWin), gi IS the window index, so
      // we compare integer window ranges directly via env._s0/_e0 — both
      // faster (no float ops) and more accurate at L2 boundaries (no rounding
      // edge cases when boundary mb falls exactly on a window center).
      // For non-precomp sources (GHSL etc.) the grid is mb-positioned and we
      // fall back to the mb-range path.
      let l2BpRanges = null;     // mb-based, used when sourceGrid != null
      let l2WinRanges = null;    // window-index-based, used when sourceGrid == null
      let gridSlotByGi = null;   // Int16Array(nGrid): slot index (0..candL2s.length-1)
                                 // covering this gi, or -1 if outside all L2s.
                                 // Pre-bucketed once so the per-fish loop is O(nGrid),
                                 // not O(nGrid * nL2). Int16 (not Int8) because some
                                 // candidates merge >127 L2s on long chromosomes.
      if (candL2s && candL2s.length > 0) {
        const envs = d.l2_envelopes || [];
        if (sourceGrid) {
          l2BpRanges = candL2s.map(li => {
            const env = envs[li];
            return env ? [env.start_bp / 1e6, env.end_bp / 1e6] : null;
          });
          // Pre-bucket gi → slot by mb position
          gridSlotByGi = new Int16Array(nGrid).fill(-1);
          for (let gi = 0; gi < nGrid; gi++) {
            const mb = mbAt(gi);
            for (let p = 0; p < l2BpRanges.length; p++) {
              const r = l2BpRanges[p];
              if (!r) continue;
              if (mb >= r[0] && mb <= r[1]) { gridSlotByGi[gi] = p; break; }
            }
          }
        } else {
          // Precomp grid: compare integer window indices.
          l2WinRanges = candL2s.map(li => {
            const env = envs[li];
            return env ? [env._s0, env._e0] : null;
          });
          gridSlotByGi = new Int16Array(nGrid).fill(-1);
          for (let gi = 0; gi < nGrid; gi++) {
            for (let p = 0; p < l2WinRanges.length; p++) {
              const r = l2WinRanges[p];
              if (!r) continue;
              if (gi >= r[0] && gi <= r[1]) { gridSlotByGi[gi] = p; break; }
            }
          }
        }
      }
      // Helper: build the mask for a given fish_call entry. Returns null when
      // no jumping (so caller can use the cheap path). Uses the pre-bucketed
      // gridSlotByGi so the lookup is O(1) per gi.
      function _buildJumpMask(fc) {
        if (!fc || !candFishCalls || !candL2s || !gridSlotByGi) return null;
        if (fc.subband_stability == null) return null;
        if (fc.subband_stability >= 1) return null;
        if (!Array.isArray(fc.votes) || fc.regime < 0) return null;
        const mask = new Uint8Array(nGrid);
        let anyJumped = false;
        for (let gi = 0; gi < nGrid; gi++) {
          const slot = gridSlotByGi[gi];
          if (slot < 0) continue;
          const vote = fc.votes[slot];
          if (vote >= 0 && vote !== fc.regime) {
            mask[gi] = 1;
            anyJumped = true;
          }
        }
        return anyJumped ? mask : null;
      }
      const normalStyle_jump = { strokeStyle: '#e0555c', lineWidth: 1.6, dash: [4, 3] };
      ctx.lineWidth = 1.4;
      for (const si of state.tracked) {
        const fc = candFishCalls ? candFishCalls[si] : null;
        const mask = _buildJumpMask(fc);
        if (mask) {
          // Mixed: normal segments in tracked color, jumped segments in dashed red
          strokeSamplePathStyled(si, mask,
            { strokeStyle: trackedColor(si), lineWidth: 1.4, dash: null },
            normalStyle_jump
          );
        } else {
          ctx.strokeStyle = trackedColor(si);
          strokeSamplePath(si);
        }
      }
    }

    // Crosshair at current window. state.cur indexes into the precomp grid;
    // we draw it at the corresponding mb position so all panels' crosshairs
    // line up vertically with the precomp-driven page layout.
    const curMb = (state.cur >= 0 && state.cur < nWin) ? mbs[state.cur] : NaN;
    if (isFinite(curMb)) {
      const xc = toX(curMb);
      ctx.strokeStyle = '#f5a524';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.round(xc) + 0.5, pad.t);
      ctx.lineTo(Math.round(xc) + 0.5, pad.t + plotH);
      ctx.stroke();
    }

    // v3.84: active-candidate overlay on the PC1 sub-panel. When a saved
    // candidate is active (state.candidate set) AND it has fish_calls (i.e.
    // committed via the v3.80+ flow), draw:
    //   1. A translucent amber band shading the candidate's bp-span horizontally
    //   2. Vertical dashed lines at each supporting L2's right boundary
    //   3. A small ⚠ glyph at the right edge of the plot for each tracked fish
    //      whose subband_stability < 1 (i.e. crossed K=3 parents within this
    //      candidate). The glyph sits at the fish's y-position at the last
    //      window of the candidate span — tells the user at a glance which
    //      tracked samples are regime-jumpers within this candidate.
    if (isPC1 && state.candidate && state.candidate.l2_indices &&
        state.candidate.l2_indices.length > 0) {
      const cand = state.candidate;
      const envs = d.l2_envelopes || [];
      // v3.91: reset marker hit list at the top of the overlay block. The
      // populated path inside (if (lastGi >= 0)) overwrites this; clearing
      // here keeps the list in sync when the candidate scrolls out of view
      // or all tracked fish have stability >= 1.
      cv.__candJumperMarkers = [];
      state.__candJumperMarkers = [];
      // Map candidate bp-span to screen x. Use start_bp/end_bp directly so
      // the band aligns with the chromosome coords on the existing axis.
      const candStartMb = cand.start_bp / 1e6;
      const candEndMb = cand.end_bp / 1e6;
      // Clip to visible mb range
      const visStartMb = Math.max(candStartMb, mbMin);
      const visEndMb = Math.min(candEndMb, mbMax);
      if (visEndMb > visStartMb) {
        const xLo = toX(visStartMb);
        const xHi = toX(visEndMb);
        // Translucent band
        ctx.save();
        ctx.fillStyle = 'rgba(245,196,58,0.06)';
        ctx.fillRect(xLo, pad.t, xHi - xLo, plotH);
        // Top + bottom edges
        ctx.strokeStyle = 'rgba(245,196,58,0.40)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xLo, pad.t + 0.5); ctx.lineTo(xHi, pad.t + 0.5);
        ctx.moveTo(xLo, pad.t + plotH - 0.5); ctx.lineTo(xHi, pad.t + plotH - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        // L2 boundary verticals (between supporting intervals; skip first
        // and last since those are the band edges)
        ctx.save();
        ctx.strokeStyle = 'rgba(245,196,58,0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        for (let i = 0; i < cand.l2_indices.length - 1; i++) {
          const env = envs[cand.l2_indices[i]];
          if (!env) continue;
          const boundaryMb = env.end_bp / 1e6;
          if (boundaryMb < mbMin || boundaryMb > mbMax) continue;
          const xb = Math.round(toX(boundaryMb)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(xb, pad.t);
          ctx.lineTo(xb, pad.t + plotH);
          ctx.stroke();
        }
        ctx.restore();
        // Jumper markers — tracked fish with subband_stability < 1
        if (Array.isArray(cand.fish_calls) && state.tracked.length > 0) {
          // Get y-source for last visible window in the candidate span. The
          // mbAt(gi) function gives mb position; find the gridIdx whose
          // mb is closest to (and ≤) visEndMb.
          let lastGi = -1;
          for (let gi = 0; gi < nGrid; gi++) {
            if (mbAt(gi) <= visEndMb) lastGi = gi;
            else break;
          }
          if (lastGi >= 0) {
            const valsLast = getLinesValuesAt(state, lastGi, source);
            const xMarker = toX(visEndMb) + 6;   // just outside the band
            // v3.91: stash marker positions for click hit-testing. One entry
            // per drawn ⚠ glyph; carries the fish index, marker center on
            // canvas, and the first-jump L2 within this candidate (used to
            // jump the scrubber when the marker is clicked).
            const markerHits = [];
            ctx.save();
            for (const si of state.tracked) {
              const fc = cand.fish_calls[si];
              if (!fc || fc.subband_stability == null) continue;
              if (fc.subband_stability >= 1) continue;
              if (!valsLast) continue;
              const y0 = valsLast[si];
              if (!isFinite(y0)) continue;
              const yp = toY(y0);
              // Small triangle glyph (warning ⚠ in geometry form so it
              // renders consistently across fonts).
              ctx.fillStyle = '#e0555c';
              ctx.strokeStyle = themeColor('bg');
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(xMarker, yp - 4);
              ctx.lineTo(xMarker - 4, yp + 3);
              ctx.lineTo(xMarker + 4, yp + 3);
              ctx.closePath();
              ctx.stroke();   // dark outline first for contrast
              ctx.fill();
              // Exclamation tick inside
              ctx.fillStyle = themeColor('bg');
              ctx.fillRect(xMarker - 0.5, yp - 1, 1, 3);
              // v3.91: find the first L2 in cand.l2_indices where this fish's
              // subband_path's K=3 parent disagrees with fc.regime — that's
              // a "jump". Records the L2 envelope index + center window so a
              // click on this marker can scrub there. Falls back to the last
              // L2 of the candidate if subband_path is missing or no jump
              // detected (shouldn't happen since stability < 1 by definition).
              let jumpL2Idx = -1, jumpWinIdx = -1;
              if (Array.isArray(fc.subband_path) && fc.regime != null) {
                const path = fc.subband_path;
                for (let p = 0; p < path.length; p++) {
                  const tok = path[p];
                  if (typeof tok !== 'string' || tok.length < 2 || tok[0] !== 'g') continue;
                  const parentDigit = tok.charCodeAt(1) - 48;   // '0'..'9' → 0..9
                  if (parentDigit < 0 || parentDigit > 9) continue;
                  if (parentDigit !== fc.regime) {
                    jumpL2Idx = cand.l2_indices[p];
                    break;
                  }
                }
              }
              if (jumpL2Idx < 0 && cand.l2_indices.length > 0) {
                jumpL2Idx = cand.l2_indices[cand.l2_indices.length - 1];
              }
              if (jumpL2Idx >= 0 && envs[jumpL2Idx]) {
                const env2 = envs[jumpL2Idx];
                const s0 = env2._s0, e0 = env2._e0;
                if (Number.isFinite(s0) && Number.isFinite(e0) && e0 >= s0) {
                  jumpWinIdx = (s0 + e0) >> 1;
                }
              }
              markerHits.push({
                si: si,
                x: xMarker,
                y: yp,
                jump_l2_idx: jumpL2Idx,
                jump_win_idx: jumpWinIdx,
              });
            }
            ctx.restore();
            // Stash on canvas + state. Canvas stash is what the click handler
            // consults (it has the cv element directly). State stash makes
            // the data inspectable from console / tests.
            cv.__candJumperMarkers = markerHits;
            state.__candJumperMarkers = markerHits;
          }
        }
      }
    } else if (isPC1) {
      // v3.91: no active candidate (or empty l2_indices) on the PC1 panel —
      // clear any stale marker hit-test entries so unmodified clicks fall
      // through to the existing click-to-jump behavior.
      cv.__candJumperMarkers = [];
      state.__candJumperMarkers = [];
    }


    // turn 123: tracked-linkage shading. When the user has lassoed fish
    // (state.tracked), shade each candidate's bp range on the lines panel
    // by the dominant band's inheritance group, with alpha keyed to purity.
    // Drawn FIRST so subsequent overlays (diamond, transitions, lines) sit on top.
    if (isPC1) {
      try {
        _drawTrackedLinkageStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // v4 turn 94: Diamond zone overlay. When the user is zoomed (visible
    // mb range smaller than the candidate's full span), and the active
    // candidate has detectable diamond patterns, draw a translucent cyan
    // background rectangle behind the diamond windows on the PC1 sub-panel,
    // with a small "split detected" annotation strip on top.
    //
    // Only on PC1 sub-panel and only when zoomed enough that the diamond
    // is visually distinguishable (otherwise it looks like a thin smear).
    if (isPC1) {
      try {
        _drawDiamondOverlay(ctx, pad, plotW, plotH, mbMin, mbMax, w, h);
      } catch (_) {}
    }

    // v4 turn 95: SNP-density strip on PC1 sub-panel (only when activated
    // via toolbar button + the user is zoomed). Thin gradient bar above the
    // plot showing where SNP density is low (PC1 loses resolution) vs high.
    if (isPC1) {
      try {
        _drawSnpDensityStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // v4 turn 99: SNP-density shade on PC1 sub-panel — translucent vertical
    // bars across plot height for low-density windows. Drawn on top of lines
    // because the alpha is low (≤ 0.18) and the visual "darkening" of low-density
    // columns is the intended effect. Activated via toolbar button (mode='shade').
    if (isPC1) {
      try {
        _drawSnpDensityShade(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // v4 turn 102: structural-haplotype transition-rate strip on PC1 sub-panel.
    // Per-L2-boundary transition_rate (fraction of fish that change band)
    // shown as red-graded bars at the bottom of the plot. Hotspots (rate >=
    // 0.30) get a thin vertical tick across the plot height.
    if (isPC1) {
      try {
        _drawTransitionRateStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // v4 turn 104: regime-breadth strip on PC1 sub-panel — categorical
    // per-L2 classification (narrow/medium/wide/no_signal) drawn as a thin
    // colored bar at the top of the plot. Green = narrow (clean segregation),
    // red = wide (no clean segregation), amber = mixed, grey = no signal.
    if (isPC1) {
      try {
        _drawRegimeBreadthStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // turn 117: inheritance group labels strip on PC1 sub-panel — small
    // "I1·3g" labels above each candidate region. I1 = sequential candidate
    // number on this chromosome by start_bp; 3g = number of inheritance
    // groups (computed via inheritanceGroupClustering on confirmed
    // candidates' band labels). Placed above the regime-breadth strip.
    if (isPC1) {
      try {
        _drawInheritanceLabelsStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // turn 130 Slice 2: lineage strip — per-L2 dominant lineage
    // (computed from the fish-trajectory clustering, runLineageCompute).
    // Sibling to the regime-breadth strip. Toggle: state.linesLineageStripOn.
    if (isPC1) {
      try {
        _drawLineageStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // turn 161 — band-trace strip (Slice 4 UI). Per-L2 stacked bar of
    // band_fractions for state.bandTraceFishSet, with a regime-color
    // top stripe. Sits above the lineage strip so it doesn't displace
    // the existing diagnostic. Off by default; user toggles via the
    // lines header. Observation-only — no inversion-call markers in
    // this slice (manuscript framing: report co-segregation, do not
    // interpret).
    if (isPC1) {
      try {
        _drawBandTraceStrip(ctx, pad, plotW, plotH, mbMin, mbMax);
      } catch (_) {}
    }

    // v3.76: Lasso rectangle overlay on the PC1 panel. Live drag uses
    // linesLassoRect (filled translucent gold + dashed border); after pointer-up
    // the rect persists in linesLassoCommitted (lighter dashed border only) so
    // the user sees what was selected until Confirm or Clear.
    if (isPC1 && state.linesLassoActive) {
      const live = state.linesLassoRect;
      const committed = state.linesLassoCommitted;
      const drawRect = (rect, fillStyle, strokeStyle, lineDash) => {
        if (!rect) return;
        const x0 = Math.min(rect.x0, rect.x1);
        const y0 = Math.min(rect.y0, rect.y1);
        const x1 = Math.max(rect.x0, rect.x1);
        const y1 = Math.max(rect.y0, rect.y1);
        ctx.save();
        ctx.fillStyle = fillStyle;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1.2;
        ctx.setLineDash(lineDash);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
        ctx.restore();
      };
      if (live) {
        drawRect(live, 'rgba(245,165,36,0.10)', '#f5a524', [4, 3]);
      } else if (committed) {
        drawRect(committed, 'rgba(245,165,36,0.05)', 'rgba(245,165,36,0.6)', [2, 4]);
      }
    }

    // v4 turn 114a: cross-species breakpoint overlay vertical lines.
    // Renders a thin red dashed vertical line at each cs-breakpoint Gar
    // genomic position, spanning the subpanel's plot region. Distinct from
    // L1/L2 boundaries (blue/green) and lasso (gold). Per-subpanel loop so
    // every sub gets the overlay regardless of source (PC1, PC2, GHSL,
    // dosage, etc.). Source data: state.crossSpecies.breakpoints filtered
    // by chrom (built lazily by _ensureCsOverlayIndex).
    try {
      const csIdx = _ensureCsOverlayIndex();
      if (csIdx && csIdx.bps.length > 0) {
        ctx.save();
        ctx.strokeStyle = '#e85a5a';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.globalAlpha = 0.85;
        const yTop = pad.t;
        const yBot = pad.t + plotH;
        for (const e of csIdx.bps) {
          if (e.mb < mbMin || e.mb > mbMax) continue;
          const xx = pad.l + ((e.mb - mbMin) / (mbMax - mbMin)) * plotW;
          if (!Number.isFinite(xx)) continue;
          ctx.beginPath();
          ctx.moveTo(xx + 0.5, yTop);
          ctx.lineTo(xx + 0.5, yBot);
          ctx.stroke();
        }
        ctx.restore();
      }
    } catch (_) { /* fail-soft */ }
  }
}

// --- buildLinesPanelCheckboxes(state) — legacy lines 33016-33117 ---
export function buildLinesPanelCheckboxes(state) {
  _setActiveState(state);
  const wrap = document.getElementById('linesYsourceCheckboxes');
  if (!wrap || typeof wrap.appendChild !== 'function') return;
  if ('innerHTML' in wrap) wrap.innerHTML = '';
  const avail = availablePCs(state);   // ['pc1', 'pc2', ...]
  const sources = avail.slice();
  // Stage 3: append GHSL panel sources when the panel layer is loaded.
  // 'het' — alias for divergence at the primary scale (per-sample het rate
  //          per phased-snp denominator; from STEP_C04_snake3_ghsl_v6.R).
  // 'ghsl_div_s<scale>' — one per available rolling scale on the panel.
  if (state.data && state.data.ghsl_panel && state.data.ghsl_panel.div_roll) {
    const panel = state.data.ghsl_panel;
    sources.push('het');
    const scales = panel.scales || Object.keys(panel.div_roll);
    for (const scale of scales) {
      // scale comes through as 's10', 's20', etc. — keep the prefix as is.
      sources.push(`ghsl_div_${scale}`);
    }
  }
  const selected = new Set(state.viewControls.linesYsources);

  for (const src of sources) {
    const id = `linesYsrc_${src}`;
    const lab = document.createElement('label');
    lab.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.value = src;
    cb.checked = selected.has(src);
    cb.addEventListener('change', () => {
      const checkedNow = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
        .map(el => el.value);
      // Always keep at least one source selected; if user unchecked the last
      // one, re-check the one they just toggled to keep the panel populated.
      if (checkedNow.length === 0) {
        cb.checked = true;
        return;
      }
      // Preserve order from the sources array (PCs first, then GHSL chips)
      const ordered = sources.filter(s => checkedNow.includes(s));
      // 2026-05-15 bug-fix: prior code called `setLinesYsources(ordered)`
      // but no such function exists anywhere in the modular tree (verified
      // by repo-wide grep). The handler threw ReferenceError silently,
      // killing the source-checkbox UX — clicking PC2 (or any source)
      // did nothing. Replaced with the direct slot assignment pattern
      // used elsewhere in shared/page1_data_helpers.js (lines 562 / 585).
      if (state && state.viewControls) {
        state.viewControls.linesYsources = ordered.slice();
      }
      // If linked, the PCA selector also updates — refresh its UI
      if (state.viewControls.linked) {
        if (typeof refreshPcaAxisBar === 'function') refreshPcaAxisBar();
        drawPCA(state);
      }
      buildLinesPanel(state);
      drawLinesPanel(state);
    });
    lab.appendChild(cb);
    const span = document.createElement('span');
    // Keep PC labels short ('PC1'); GHSL labels readable ('het', 'div_s50')
    if (/^pc[1-4]$/.test(src)) {
      span.textContent = src.toUpperCase();
      // v3.99 turn 13 ask 4: per-PC tooltip explaining --npc availability so
      // the verbose visible note can be hidden. The text is built once we
      // know `avail.length` and `sources.length`, so we set the title
      // attribute on each PC label after the loop. For now, leave a
      // placeholder; the tooltip is patched below.
      lab.dataset.pcTooltip = '1';
    } else if (src === 'het') {
      span.textContent = 'het';
    } else if (/^ghsl_div_s\d+$/.test(src)) {
      span.textContent = `div_${src.replace(/^ghsl_div_/, '')}`;
    } else {
      span.textContent = src;
    }
    lab.appendChild(span);
    wrap.appendChild(lab);
  }

  // v3.99 turn 13 ask 4: build the npc-availability text once, then attach it
  // as a tooltip to every PC label (instead of a separate visible inline note
  // that pushed the toolbar to wrap onto a second line). The visible
  // #linesYsourceNote span is now hidden via display:none — kept in DOM so
  // older code paths that reference it don't crash.
  let npcTooltip = '';
  {
    const ghslExtras = sources.length - avail.length;
    if (ghslExtras > 0) {
      npcTooltip = `${avail.length} PCs · ${ghslExtras} GHSL sources in this dataset`;
    } else {
      npcTooltip = avail.length <= 2
        ? `${avail.length} PCs in this dataset (run with --npc 4 for more)`
        : `${avail.length} PCs available`;
    }
  }
  wrap.querySelectorAll('label[data-pc-tooltip]').forEach(lab => {
    lab.title = npcTooltip;
  });

  // Note about availability — v3.99 turn 13 ask 4: hidden by default. The
  // text is now in the per-PC label tooltips above. Element kept so the
  // initial-render code path at line ~19842 (which sets a different message
  // pre-buildLinesPanel) still finds the node without erroring.
  const note = document.getElementById('linesYsourceNote');
  if (note) {
    note.textContent = '';
    note.style.display = 'none';
  }
}

// --- buildLinesPanel(state) — legacy lines 33334-33610 ---
export function buildLinesPanel(state) {
  _setActiveState(state);
  // Construct one sub-canvas per source in state.viewControls.linesYsources.
  // Recreates all sub-canvases on every call (cheap; sources rarely change).
  const container = document.getElementById('linesCanvasContainer');
  const panel = document.getElementById('linesPanel');
  if (!container || !panel) return;
  if (typeof container.appendChild !== 'function') return;   // test-shim safety
  if (!state.data) {
    if (panel.style) panel.style.display = 'none';
    return;
  }
  if (panel.style) panel.style.display = '';
  if ('innerHTML' in container) container.innerHTML = '';
  const sources = state.viewControls.linesYsources.slice();
  // v3.58: container flex/sizing is now in CSS (#linesPanel #linesCanvasContainer).
  // We only need to ensure display:flex flex-direction:column for sub-canvas
  // stacking; the parent #linesPanel is a flex column that gives this container
  // its share of the available height via min-height:0 + flex:1 1 auto.
  if (container.style) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
  }
  for (const src of sources) {
    const sub = document.createElement('div');
    sub.className = 'lines-subpanel';
    sub.dataset.linesSource = src;
    // Each subpanel gets equal share via flex:1; min-height:0 lets it shrink
    sub.style.cssText = `position: relative; flex: 1 1 0; min-height: 0; border-bottom: 1px solid var(--rule, #2a3242);`;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'display: block; width: 100%; height: 100%; cursor: crosshair;';
    cv.dataset.linesSource = src;
    sub.appendChild(cv);
    // turn 2p: install inheritance-pill tooltip on PC1 canvas. Pills are
    // only ever drawn on the PC1 sub-panel (per turn 2c), so we skip the
    // other sources to keep the handler load minimal.
    if (src === 'pc1') {
      try { wireInheritancePillTooltip(cv, state); } catch (_) {}
    }
    // turn 162 — band-trace strip tooltip. Same gating as the inheritance
    // pill (PC1 only), since the strip itself is also PC1-only. Idempotent
    // via the canvas dataset marker, so re-running drawLinesPanel after
    // each chrom switch (which destroys + recreates these canvases) just
    // re-attaches handlers to fresh nodes.
    if (src === 'pc1') {
      try { wireBandTraceTooltip(cv, state); } catch (_) {}
    }
    const lbl = document.createElement('div');
    lbl.className = 'lines-subpanel-label';
    lbl.style.cssText = 'position: absolute; top: 4px; left: 8px; font-size: 11px; color: var(--dim, #888); pointer-events: none; font-family: ui-monospace, monospace; font-weight: 600;';
    lbl.textContent = src.toUpperCase();
    sub.appendChild(lbl);
    // Click-to-jump: same gesture as Z panel
    cv.addEventListener('click', e => {
      // v3.76: in lasso mode on the PC1 sub-canvas, the pointer handlers
      // below own the gesture; the click event still fires after a no-motion
      // pointerup, but we suppress it to avoid double-acting (the pointer-up
      // logic already clears any tiny rect). dataset.linesSource === 'pc1'
      // is the gating condition because lasso only lives on that source.
      if (state.linesLassoActive && cv.dataset.linesSource === 'pc1') {
        // If the down was treated as a click (no drag), let it fall through;
        // we set _lassoSwallowClick on pointerup when there was a drag.
        if (cv.__lassoSwallowClick) {
          cv.__lassoSwallowClick = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      // v3.91: unmodified click on a ⚠ jumper marker (PC1 panel only) →
      // jump scrubber to the L2 where the fish first crossed K=3 parents
      // within the active candidate, then open the same popover the v3.87
      // shift+click path uses (anchored at the marker, fish forced to the
      // marker's si). The hit list `cv.__candJumperMarkers` is populated
      // during draw inside the candidate-overlay block. Hit radius 7 px.
      // No-op (falls through) when no marker hit, no candidate, or shift is
      // held (shift+click still routes to the existing line-inspect logic).
      if (!e.shiftKey && cv.dataset.linesSource === 'pc1' &&
          Array.isArray(cv.__candJumperMarkers) && cv.__candJumperMarkers.length > 0) {
        const rect0 = cv.getBoundingClientRect();
        const cx = e.clientX - rect0.left;
        const cy = e.clientY - rect0.top;
        const HIT_R = 7;
        let bestM = null, bestD2 = HIT_R * HIT_R;
        for (const m of cv.__candJumperMarkers) {
          const dx = m.x - cx, dy = m.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= bestD2) { bestD2 = d2; bestM = m; }
        }
        if (bestM) {
          if (Number.isFinite(bestM.jump_win_idx) && bestM.jump_win_idx >= 0) {
            setCur(state, bestM.jump_win_idx);
          }
          maybeShowFishInspectPopover(e, cv, state, bestM.si);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      // v3.87: shift+click on PC1 → inspect nearest tracked fish for the
      // active candidate. Shows a popover with the fish's votes, subband_path,
      // regime, confidence, and subband_stability. No-op when no candidate
      // is active or the click misses all tracked-fish lines. Without shift,
      // falls through to the existing click-to-jump behavior.
      if (e.shiftKey && cv.dataset.linesSource === 'pc1') {
        const handled = maybeShowFishInspectPopover(e, cv, state);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      const rect = cv.getBoundingClientRect();
      const pad = { l: 44, r: 16 };
      const x = e.clientX - rect.left;
      const plotW = rect.width - pad.l - pad.r;
      const frac = Math.max(0, Math.min(1, (x - pad.l) / plotW));
      // v3.99 turn 3: match the Z-panel's Mb-based mapping. Previously this
      // used window-index-fraction (`frac * (wins.length - 1)`), which is
      // wrong when windows are non-uniform in Mb across the chromosome —
      // the click would jump to a window at the wrong genomic position
      // relative to where the user clicked, and clicks at the same x
      // position across the Z-panel and lines-panel would land on
      // different windows. Now both panels use the same Mb axis: convert
      // the click fraction to an Mb position via currentMbRange(state), then
      // find the window with the closest center_mb.
      const d = state.data;
      const _mbR = currentMbRange(state);
      // v4 turn 114c (remaining): cs-breakpoint click-to-jump. Same red
      // dashed lines that drawLinesPanel paints across each subpanel get
      // a click-target priority over the generic Mb-frac → setCur fallback,
      // so a click near a cs-bp line lands on that breakpoint's window
      // exactly. Re-derive the per-subpanel toX from rect + pad here
      // (drawLinesPanel uses the same pad constants).
      {
        const csIdx = _ensureCsOverlayIndex();
        if (csIdx && csIdx.bps.length > 0) {
          const _mbMinL = _mbR.mbMin, _mbMaxL = _mbR.mbMax;
          const _toX = (bp) => {
            if (bp.mb < _mbMinL || bp.mb > _mbMaxL) return NaN;
            return pad.l + ((bp.mb - _mbMinL) / (_mbMaxL - _mbMinL)) * plotW;
          };
          const hit = _csBpHitTestXFromList(csIdx.bps, x, _CS_BP_HIT_TOL_PX, _toX);
          if (hit) {
            _csBpJumpToWindow(hit);
            return;
          }
        }
      }
      const targetMb = _mbR.mbMin + frac * (_mbR.mbMax - _mbR.mbMin);
      let bestWin = 0, bestD = Infinity;
      for (let i = 0; i < d.n_windows; i++) {
        const dd = Math.abs(d.windows[i].center_mb - targetMb);
        if (dd < bestD) { bestD = dd; bestWin = i; }
      }
      setCur(state, bestWin);
    });
    // v4 turn 114d: cs-breakpoint hover-glow on this subpanel. Same toX
    // mapping as the click hit-test above; tolerance is _CS_BP_HOVER_TOL_PX
    // (one px more generous than _CS_BP_HIT_TOL_PX so the glow engages
    // slightly before a click would commit). Idempotent via the wiring
    // helper's internal flag — buildLinesPanel rebuilds subpanels on every
    // call, but each new canvas is a fresh DOM node so the flag is fresh
    // too.
    if (typeof _wireCsBpHoverOnCanvas === 'function') {
      _wireCsBpHoverOnCanvas(cv, (canvas, evt, csIdx) => {
        if (!state.data) return null;
        const rect = canvas.getBoundingClientRect();
        const x = evt.clientX - rect.left;
        const pad = { l: 44, r: 16 };
        const plotW = rect.width - pad.l - pad.r;
        if (plotW <= 0) return null;
        const _mbR = currentMbRange(state);
        const _toX = (bp) => {
          if (bp.mb < _mbR.mbMin || bp.mb > _mbR.mbMax) return NaN;
          return pad.l + ((bp.mb - _mbR.mbMin) / (_mbR.mbMax - _mbR.mbMin)) * plotW;
        };
        return _csBpHitTestXFromList(csIdx.bps, x, _CS_BP_HOVER_TOL_PX, _toX);
      });
    }
    // v3.76: lasso pointer handlers — only on the PC1 sub-canvas. Drag a
    // rectangle to select samples whose trajectory passes through it. On
    // pointer-up with non-trivial motion, compute the lassoed sample set
    // and store it; the Confirm button then commits to state.tracked.
    if (src === 'pc1') {
      let dragging = false;
      let downX = 0, downY = 0;
      cv.addEventListener('pointerdown', e => {
        if (!state.linesLassoActive) return;
        // We own the gesture. Capture pointer; track screen→canvas mapping.
        dragging = true;
        const rect = cv.getBoundingClientRect();
        downX = e.clientX - rect.left;
        downY = e.clientY - rect.top;
        state.linesLassoRect = { x0: downX, y0: downY, x1: downX, y1: downY };
        state.linesLassoCommitted = null;
        cv.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      cv.addEventListener('pointermove', e => {
        if (!dragging) return;
        const rect = cv.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (state.linesLassoRect) {
          state.linesLassoRect.x1 = x;
          state.linesLassoRect.y1 = y;
        }
        // Live redraw (cheap — single subcanvas)
        drawLinesPanel(state);
      });
      cv.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
        if (!state.linesLassoRect) return;
        const r = state.linesLassoRect;
        const dx = Math.abs(r.x1 - r.x0), dy = Math.abs(r.y1 - r.y0);
        // Negligible motion → treat as click (let click handler run normally,
        // jumps to that window). Clear rect so no overlay sticks around.
        if (dx < 4 && dy < 4) {
          state.linesLassoRect = null;
          drawLinesPanel(state);
          return;
        }
        // Real drag → commit rect, compute lasso. Suppress the trailing click.
        cv.__lassoSwallowClick = true;
        state.linesLassoCommitted = {
          x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1),
          x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1),
        };
        state.linesLassoRect = null;
        const lassoed = _computeLinesLassoSamples(cv, state.linesLassoCommitted);
        state.linesLassoSelected = lassoed;
        if (typeof _updateLinesLassoUI === 'function') _updateLinesLassoUI();
        drawLinesPanel(state);
      });
      cv.addEventListener('pointercancel', () => {
        dragging = false;
        state.linesLassoRect = null;
        drawLinesPanel(state);
      });
      // v3.91: cursor affordance — show a pointer cursor when hovering over
      // a ⚠ jumper marker so the user knows it's clickable. Cheap: just walks
      // the marker hit list (≤ |state.tracked|) on each move event and flips
      // cv.style.cursor. Doesn't fire when dragging (lasso owns the gesture).
      cv.addEventListener('mousemove', e => {
        if (dragging) return;
        const hits = cv.__candJumperMarkers;
        if (!Array.isArray(hits) || hits.length === 0) {
          if (cv.style.cursor === 'pointer') cv.style.cursor = '';
          return;
        }
        const r2 = cv.getBoundingClientRect();
        const cx = e.clientX - r2.left;
        const cy = e.clientY - r2.top;
        const HIT_R = 7;
        let hovering = false;
        for (const m of hits) {
          const dx = m.x - cx, dy = m.y - cy;
          if (dx * dx + dy * dy <= HIT_R * HIT_R) { hovering = true; break; }
        }
        const want = hovering ? 'pointer' : '';
        if (cv.style.cursor !== want) cv.style.cursor = want;
      });
    }
    container.appendChild(sub);
  }
}

// --- refreshLinesColorMode(state) — legacy lines 33165-33193 ---
export function refreshLinesColorMode(state) {
  _setActiveState(state);
  const sel = (typeof document !== 'undefined' && document.getElementById)
    ? document.getElementById('linesColorModeSelect')
    : null;
  // Validate state slot — fall back to kmeans if invalid or its layer gone
  const valid = _LINES_COLOR_MODES.some(m => m.id === state.linesColorMode);
  if (!valid || !_isLinesColorModeAvailable(state, state.linesColorMode)) {
    state.linesColorMode = 'kmeans';
  }
  // Sync the <select>: enable/disable each option based on layer availability
  if (sel && sel.options) {
    for (let i = 0; i < sel.options.length; i++) {
      const opt = sel.options[i];
      const def = _LINES_COLOR_MODES.find(m => m.id === opt.value);
      if (!def) continue;
      const avail = _isLinesColorModeAvailable(state, def.id);
      opt.disabled = !avail;
      // Refresh title (tooltip) to reflect current availability
      if (avail) {
        opt.title = `Color by ${def.label} — source layer present.`;
      } else if (def.layer) {
        opt.title = `Needs ${def.layer} JSON layer (currently not loaded).`;
      } else {
        opt.title = `Color by ${def.label}.`;
      }
    }
    sel.value = state.linesColorMode;

    // 2026-05-15 bug-fix: wire the change handler. Without this the
    // select had no event listener anywhere in the repo (verified by
    // grep) — picking a colour mode from the dropdown did nothing.
    // Idempotent via dataset.wired so refreshes don't double-attach.
    if (!sel.dataset.wired) {
      sel.addEventListener('change', (e) => {
        const newMode = e.target.value;
        // Only accept modes that are currently available; if the user
        // somehow picks a disabled option (shouldn't happen via the
        // dropdown UI, but be defensive) fall back to kmeans.
        if (_isLinesColorModeAvailable(state, newMode)) {
          state.linesColorMode = newMode;
        } else {
          state.linesColorMode = 'kmeans';
          sel.value = 'kmeans';
        }
        try { drawLinesPanel(state); }
        catch (err) { console.warn('[linesColorMode] drawLinesPanel:', err); }
      });
      sel.dataset.wired = '1';
    }
  }
}

// --- setLinesPanelCandidateBands() — legacy lines 34002-34007 ---
export function setLinesPanelCandidateBands(state, b) {
  _setActiveState(state);
  const _state = (typeof window !== 'undefined' && window.state) ? window.state : state;
  _state.linesPanelCandidateBands = !!b;
  try { localStorage.setItem(_LINES_PANEL_CAND_BANDS_KEY, b ? '1' : '0'); } catch (_) {}
  drawLinesPanel(state);
}

// --- lasso wiring — legacy lines 33752-33782 + 34011-34014 + 34229-34262 ---
// Verbatim port of:
//   _updateLinesLassoUI()       — refresh badge / confirm / clear visibility
//   setLinesLassoActive(b)      — toggle state.linesLassoActive + clear state
//   attachLinesLasso(state)     — wire the checkbox + confirm + clear handlers
// Called once from local_pca_dosage.js mount() so the lasso checkbox actually toggles.
function _updateLinesLassoUI(state) {
  if (typeof document === 'undefined') return;
  const cb = document.getElementById('linesLassoToggle');
  if (cb) cb.checked = !!state.linesLassoActive;
  const badge   = document.getElementById('linesLassoBadge');
  const confirm = document.getElementById('linesLassoConfirmBtn');
  const clear   = document.getElementById('linesLassoClearBtn');
  const n = (state.linesLassoSelected || []).length;
  const showCommitted = !!state.linesLassoActive && n > 0;
  if (badge) {
    if (badge.style) badge.style.display = state.linesLassoActive ? '' : 'none';
    badge.textContent = `${n} selected`;
  }
  if (confirm && confirm.style) confirm.style.display = showCommitted ? '' : 'none';
  if (clear && clear.style) clear.style.display = showCommitted ? '' : 'none';
}

function setLinesLassoActive(state, b) {
  state.linesLassoActive = !!b;
  if (!b) {
    state.linesLassoRect = null;
    state.linesLassoCommitted = null;
    state.linesLassoSelected = [];
  }
  _updateLinesLassoUI(state);
  drawLinesPanel(state);
}

export function attachLinesLasso(state) {
  _setActiveState(state);
  if (typeof document === 'undefined') return;
  // Expose the UI updater on window so the pointer handlers above (which
  // call `_updateLinesLassoUI()` via runtime guard) find it. Cheap bridge
  // until those guards are promoted to imports across the lines panel.
  if (typeof window !== 'undefined') {
    window._updateLinesLassoUI = () => _updateLinesLassoUI(state);
  }
  const cb = document.getElementById('linesLassoToggle');
  if (cb && !cb.__wired) {
    cb.__wired = true;
    cb.addEventListener('change', e => setLinesLassoActive(state, !!e.target.checked));
  }
  const confirmBtn = document.getElementById('linesLassoConfirmBtn');
  if (confirmBtn && !confirmBtn.__wired) {
    confirmBtn.__wired = true;
    confirmBtn.addEventListener('click', () => {
      const sel = (state.linesLassoSelected || []).slice();
      if (sel.length === 0) return;
      const cap = Math.max(1, state.trackedN | 0);
      state.tracked = sel.slice(0, cap);
      if (sel.length > cap) state.trackedN = Math.min(50, sel.length);
      state.linesLassoRect = null;
      state.linesLassoCommitted = null;
      state.linesLassoSelected = [];
      state.linesLassoActive = false;
      if (cb) cb.checked = false;
      _updateLinesLassoUI(state);
      // Trigger downstream redraws via window-mounted helpers (still guarded
      // until they're all converted to ES imports).
      if (typeof window !== 'undefined') {
        try { window.renderTrackedList && window.renderTrackedList(); } catch (_) {}
        try { window._syncTrackedCompactUI && window._syncTrackedCompactUI(); } catch (_) {}
        try { window.drawPCA && window.drawPCA(state); } catch (_) {}
        try { window.renderL3Panel && window.renderL3Panel(state); } catch (_) {}
      }
      drawLinesPanel(state);
    });
  }
  const clearBtn = document.getElementById('linesLassoClearBtn');
  if (clearBtn && !clearBtn.__wired) {
    clearBtn.__wired = true;
    clearBtn.addEventListener('click', () => {
      state.linesLassoRect = null;
      state.linesLassoCommitted = null;
      state.linesLassoSelected = [];
      _updateLinesLassoUI(state);
      drawLinesPanel(state);
    });
  }
}
