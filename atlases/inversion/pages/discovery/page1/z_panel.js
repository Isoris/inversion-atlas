// pages/discovery/page1/z_panel.js
//
// |Z| panel renderer + 9 strip renderers (round 4 split, 2026-05-06).
//
// drawZ: the robust-|Z| waveform with candidate lane/bar overlay, embedded
//        sim_mat minimap, and per-strip overlays (SNP density, transition
//        rate, regime breadth, lineage, diamond, inheritance labels,
//        tracked-linkage, band-trace).
//
// Each `_drawXxxStrip` is a panel sub-renderer that drawZ delegates to
// based on which data layers are present. Strips are also called by
// drawLinesPanel for the secondary lines view.
//
// Bodies extracted verbatim from the pre-split page1.js (eighth pass).

import { fitCanvas, niceTicks, themeColor } from '../../../shared/page1_utils.js';
import { karyoColor } from '../../../shared/color_helpers.js';

import { _lineageColor, _pageState, _setActiveState } from './_state.js';
import { currentMbRange, getL2Cluster } from './_data.js';
import { _assignCandidateLanes, _drawWRow, _drawWinNavLane, _ensureCsOverlayIndex, _wRowBand, _winNavBand, drawCandidateBar } from './candidates.js';

// --- STATUS_COLOR — legacy line 9805 ---
// Color palette for L2 boundary validation_status markers drawn in the Z panel.
const STATUS_COLOR = {
  STABLE_BLUE: '#c8102e',
  MARGINAL:    '#e07b3f',
  DECAYS:      '#999999',
  EDGE:        '#9b59b6',
  DEDUP:       '#555555',
};

// --- _drawSnpDensityStrip — legacy lines 34495-34568 ---
export function _drawSnpDensityStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  // v4 turn 99: only render strip when mode is 'strip'. Mode 'shade' is
  // rendered by _drawSnpDensityShade. Mode 'off' = early return.
  const mode = _state.linesSnpDensityMode || (_state.linesSnpDensityOn ? 'strip' : 'off');
  if (mode !== 'strip') return;
  const d = _state.data;
  if (!d || !d.windows) return;

  // Find windows visible in [mbMin, mbMax]
  const visibleW = [];
  for (let wi = 0; wi < d.windows.length; wi++) {
    const mb = d.windows[wi].center_mb;
    if (mb >= mbMin && mb <= mbMax) visibleW.push(wi);
  }
  if (visibleW.length < 5) return;

  // Compute density values + min/max across visible
  const vals = visibleW.map(wi => _snpDensityForWindow(wi)).filter(v => v != null && isFinite(v));
  if (vals.length < 5) return;
  let vMin = Infinity, vMax = -Infinity;
  for (const v of vals) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) return;

  // Strip drawn at TOP of plot, just below pad.t (so it doesn't overlap diamond
  // overlay strip). Use 4px height; very thin.
  const stripH = 4;
  const stripY = Math.max(0, pad.t - stripH - 1);
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  ctx.save();
  // For each visible window, draw a thin vertical bar of color from cool
  // (low density, blue) to warm (high density, yellow). Use a viridis-like
  // ramp so it's visually distinct from cluster colors.
  const colorRamp = (t) => {
    // Simple cool→warm: blue → cyan → green → yellow → orange
    const tc = Math.max(0, Math.min(1, t));
    if (tc < 0.25) {
      const u = tc / 0.25;
      return `rgb(${Math.round(40 + u * 0)}, ${Math.round(60 + u * 100)}, ${Math.round(180 + u * 75)})`;
    } else if (tc < 0.5) {
      const u = (tc - 0.25) / 0.25;
      return `rgb(${Math.round(40)}, ${Math.round(160 + u * 60)}, ${Math.round(255 - u * 100)})`;
    } else if (tc < 0.75) {
      const u = (tc - 0.5) / 0.25;
      return `rgb(${Math.round(40 + u * 200)}, ${Math.round(220 - u * 0)}, ${Math.round(155 - u * 100)})`;
    } else {
      const u = (tc - 0.75) / 0.25;
      return `rgb(${Math.round(240 + u * 15)}, ${Math.round(220 - u * 60)}, ${Math.round(55 - u * 50)})`;
    }
  };

  for (const wi of visibleW) {
    const v = _snpDensityForWindow(wi);
    if (v == null || !isFinite(v)) continue;
    const t = (v - vMin) / (vMax - vMin);
    const mb = d.windows[wi].center_mb;
    const x = mbToX(mb);
    // Width of one window's strip: half the spacing to neighbor
    let bw = 2;
    if (wi > 0 && wi < d.windows.length - 1) {
      const mbL = d.windows[wi - 1].center_mb;
      const mbR = d.windows[wi + 1].center_mb;
      bw = ((mbToX(mbR) - mbToX(mbL)) / 2) + 1;
    }
    ctx.fillStyle = colorRamp(t);
    ctx.fillRect(x - bw / 2, stripY, bw, stripH);
  }
  // Add a thin border around the strip
  ctx.strokeStyle = 'rgba(120, 128, 140, 0.6)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(pad.l, stripY, plotW, stripH);
  ctx.restore();
}

// --- _drawSnpDensityShade — legacy lines 34575-34620 ---
export function _drawSnpDensityShade(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  const mode = _state.linesSnpDensityMode || (_state.linesSnpDensityOn ? 'strip' : 'off');
  if (mode !== 'shade') return;
  const d = _state.data;
  if (!d || !d.windows) return;

  // Find windows visible in [mbMin, mbMax]
  const visibleW = [];
  for (let wi = 0; wi < d.windows.length; wi++) {
    const mb = d.windows[wi].center_mb;
    if (mb >= mbMin && mb <= mbMax) visibleW.push(wi);
  }
  if (visibleW.length < 5) return;

  // Compute density values + visible-range min/max for normalization
  const vals = visibleW.map(wi => _snpDensityForWindow(wi)).filter(v => v != null && isFinite(v));
  if (vals.length < 5) return;
  let vMin = Infinity, vMax = -Infinity;
  for (const v of vals) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) return;

  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  ctx.save();
  // Shade alpha: 0 at high density (vMax), up to 0.18 at low density (vMin).
  // Linear; users can read shade darkness as "how much resolution is lost".
  for (const wi of visibleW) {
    const v = _snpDensityForWindow(wi);
    if (v == null || !isFinite(v)) continue;
    const t = (v - vMin) / (vMax - vMin);   // 0 = lowest, 1 = highest
    const alpha = (1 - t) * 0.18;            // 0..0.18
    if (alpha < 0.01) continue;              // skip near-transparent
    const mb = d.windows[wi].center_mb;
    const x = mbToX(mb);
    let bw = 2;
    if (wi > 0 && wi < d.windows.length - 1) {
      const mbL = d.windows[wi - 1].center_mb;
      const mbR = d.windows[wi + 1].center_mb;
      bw = ((mbToX(mbR) - mbToX(mbL)) / 2) + 1;
    }
    ctx.fillStyle = 'rgba(40, 50, 70, ' + alpha + ')';
    ctx.fillRect(x - bw / 2, pad.t, bw, plotH);
  }
  ctx.restore();
}

// --- _drawTransitionRateStrip — legacy lines 34640-34699 ---
export function _drawTransitionRateStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state.linesTransRateOn) return;
  if (typeof computeStructuralHaplotypeTransitionGraph !== 'function') return;

  let graph = null;
  try { graph = computeStructuralHaplotypeTransitionGraph(); } catch (_) { return; }
  if (!graph || !Array.isArray(graph.boundaries) || graph.boundaries.length === 0) return;

  // Strip drawn just BELOW the SNP-density strip (which sits at pad.t - 5).
  // To avoid stacking inconsistencies, place the trans-rate strip at the BOTTOM
  // of the plot area instead — between plotH bottom and the x-axis. This keeps
  // the top region clean for the diamond annotation strip.
  const stripH = 5;
  const stripY = pad.t + plotH - stripH - 1;   // just inside the plot bottom
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  ctx.save();

  // Faint background row so users see the strip exists even if all rates are 0
  ctx.fillStyle = 'rgba(40, 50, 70, 0.25)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  const hotspotThr = (typeof _SHTG_HOTSPOT_THRESHOLD === 'number') ? _SHTG_HOTSPOT_THRESHOLD : 0.30;

  for (const b of graph.boundaries) {
    if (!isFinite(b.position_mb)) continue;
    if (b.position_mb < mbMin || b.position_mb > mbMax) continue;
    const x = mbToX(b.position_mb);
    // Bar height encodes transition_rate; rate=0 → no bar, rate=1 → full strip
    const r = Math.max(0, Math.min(1, b.transition_rate));
    if (r < 0.02) continue;   // skip near-zero (would be 1px and noisy)
    const barH = r * stripH;
    // Color: green for low rate, amber for medium, red for hotspot
    let color;
    if (r >= hotspotThr) color = 'rgba(224, 85, 92, 0.90)';      // red
    else if (r >= 0.15)   color = 'rgba(245, 165, 36, 0.80)';     // amber
    else                  color = 'rgba(60, 192, 138, 0.60)';     // green-ish
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.5, stripY + (stripH - barH), 3, barH);

    // Hotspot tag: thin vertical tick across the FULL plot height for
    // visual prominence. Tells the user "regime boundary here."
    if (r >= hotspotThr) {
      ctx.strokeStyle = 'rgba(224, 85, 92, 0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, pad.t);
      ctx.lineTo(x + 0.5, pad.t + plotH);
      ctx.stroke();
    }
  }

  // Frame
  ctx.strokeStyle = 'rgba(120, 128, 140, 0.40)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(pad.l, stripY, plotW, stripH);

  ctx.restore();
}

// --- _drawRegimeBreadthStrip — legacy lines 34720-34762 ---
export function _drawRegimeBreadthStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state.linesRegimeBreadthOn) return;
  if (typeof computeWindowedBandReachPerL2 !== 'function') return;
  const d = _state.data;
  if (!d || !Array.isArray(d.l2_envelopes)) return;

  let entries = null;
  try { entries = computeWindowedBandReachPerL2(); } catch (_) { return; }
  if (!Array.isArray(entries) || entries.length === 0) return;

  // Strip drawn at the TOP of the plot, just above pad.t. Height 5px.
  const stripH = 5;
  const stripY = Math.max(0, pad.t - stripH - 1);

  ctx.save();

  // Faint background
  ctx.fillStyle = 'rgba(40, 50, 70, 0.18)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  // For each entry, find the bp range its center_l2 covers (start_bp..end_bp)
  // and paint that range with the regime-breadth color.
  for (const e of entries) {
    const env = d.l2_envelopes[e.center_l2];
    if (!env) continue;
    const mbLo = env.start_bp / 1e6;
    const mbHi = env.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    if (xHi - xLo < 1) continue;
    ctx.fillStyle = _regimeBreadthColor(e.regime_breadth);
    ctx.fillRect(xLo, stripY, xHi - xLo, stripH);
  }

  // Frame
  ctx.strokeStyle = 'rgba(120, 128, 140, 0.40)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(pad.l, stripY, plotW, stripH);

  ctx.restore();
}

// --- _drawLineageStrip — legacy lines 34790-34888 ---
export function _drawLineageStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state || _state.linesLineageStripOn === false) return;
  const d = _state.data;
  if (!d || !Array.isArray(d.l2_envelopes)) return;

  const result = _state.lineageResult;
  if (!result || !result.lineage_id_per_sample) {
    // Not yet computed; the resolver auto-trigger handles this on first paint.
    // Don't push a fallback compute here too — duplicating the trigger leads
    // to thrash. Just skip the strip for this paint.
    return;
  }
  const lineageOf = result.lineage_id_per_sample;

  // Strip drawn just ABOVE the regime-breadth strip (which sits at
  // pad.t - 6, height 5). Place lineage strip at pad.t - 13, height 5
  // so they're visually distinct (1 px gap between them).
  const stripH = 5;
  const stripY = Math.max(0, pad.t - 13);

  ctx.save();

  // Faint backdrop so empty L2s read as "computed but no signal" rather
  // than "didn't try".
  ctx.fillStyle = 'rgba(40, 50, 70, 0.14)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  // Track which L2s belong to which Hungarian chain. Within-chain L2s
  // get a colored bar; chain-break L2s stay backdrop-only with a thin
  // vertical tick at the break.
  const inChain = new Set();
  if (Array.isArray(result.chains)) {
    for (const ch of result.chains) {
      if (Array.isArray(ch.l2_indices)) {
        for (const idx of ch.l2_indices) inChain.add(idx);
      }
    }
  }

  for (let l2idx = 0; l2idx < d.l2_envelopes.length; l2idx++) {
    const env = d.l2_envelopes[l2idx];
    if (!env || env.start_bp == null) continue;
    const mbLo = env.start_bp / 1e6;
    const mbHi = env.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    if (xHi - xLo < 1) continue;

    if (!inChain.has(l2idx)) {
      // Chain-break L2: draw a faint diagonal hatch as the "no chain" cue
      ctx.fillStyle = 'rgba(120, 128, 140, 0.18)';
      ctx.fillRect(xLo, stripY, xHi - xLo, stripH);
      continue;
    }

    // Find the dominant lineage among the fish in this L2's largest band.
    const cl = (typeof getL2Cluster === 'function') ? getL2Cluster(l2idx) : null;
    if (!cl || !cl.fixedKLabels) continue;
    const labels = cl.fixedKLabels;
    const K = cl.K || (_state.k || 3);
    // Largest-band: tally band sizes
    const bandCounts = new Int32Array(K);
    for (let s = 0; s < labels.length; s++) {
      const lb = labels[s];
      if (lb >= 0 && lb < K) bandCounts[lb]++;
    }
    let bigBand = 0, bigCount = -1;
    for (let k = 0; k < K; k++) if (bandCounts[k] > bigCount) { bigCount = bandCounts[k]; bigBand = k; }

    // Dominant lineage in that band
    const lineageCounts = {};
    for (let s = 0; s < labels.length; s++) {
      if (labels[s] !== bigBand) continue;
      const lid = lineageOf[s];
      if (lid == null || lid < 0) continue;
      lineageCounts[lid] = (lineageCounts[lid] || 0) + 1;
    }
    let domLineage = -1, domCount = -1;
    for (const k of Object.keys(lineageCounts)) {
      if (lineageCounts[k] > domCount) { domCount = lineageCounts[k]; domLineage = +k; }
    }
    if (domLineage < 0) continue;

    // Color: same golden-angle palette as _lineageColor for visual continuity
    const baseHue = 210, goldenAngle = 137.508;
    const hue = (baseHue + domLineage * goldenAngle) % 360;
    ctx.fillStyle = `hsl(${hue.toFixed(1)}, 70%, 55%)`;
    ctx.fillRect(xLo, stripY, xHi - xLo, stripH);
  }

  // Frame
  ctx.strokeStyle = 'rgba(120, 128, 140, 0.40)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(pad.l, stripY, plotW, stripH);

  ctx.restore();
}

// --- _drawDiamondOverlay — legacy lines 34339-34433 ---
export function _drawDiamondOverlay(ctx, pad, plotW, plotH, mbMin, mbMax, w, h) {
  const _state = _pageState;
  if (!_state.candidate) return;
  if (typeof summarizeDiamonds !== 'function') return;
  if (typeof catState !== 'undefined' && catState && catState.diamondMode === 'off') return;

  // Compute diamonds for the active candidate
  let summary = null;
  try { summary = summarizeDiamonds(_state.candidate); } catch (_) { return; }
  if (!summary || !summary.diamonds || summary.diamonds.length === 0) return;

  const d = _state.data;
  if (!d || !d.windows) return;

  // Strictness filter: respect the catalogue's diamondMode setting if active.
  // 'loose' → all; 'strict' → strict; 'strict2' → strict2.
  const mode = (typeof catState !== 'undefined' && catState && catState.diamondMode) || 'loose';
  const filtered = summary.diamonds.filter(dd =>
    mode === 'loose'   ? true :
    mode === 'strict'  ? dd.strict :
    mode === 'strict2' ? dd.strict2 : true
  );
  if (filtered.length === 0) return;

  ctx.save();

  // Convert mb to plot x
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  for (const dd of filtered) {
    const wLo = dd.diamond_start_w;
    const wHi = dd.diamond_end_w;
    if (wLo == null || wHi == null) continue;
    if (wLo < 0 || wHi >= d.windows.length) continue;
    const mbLo = d.windows[wLo].center_mb;
    const mbHi = d.windows[wHi].center_mb;
    // Skip if outside visible range
    if (mbHi < mbMin || mbLo > mbMax) continue;
    // Clip to visible
    const xLo = Math.max(pad.l, mbToX(Math.max(mbLo, mbMin)));
    const xHi = Math.min(pad.l + plotW, mbToX(Math.min(mbHi, mbMax)));
    if (xHi - xLo < 12) continue;   // too narrow to read

    // Visibility heuristic: skip if diamond covers < 8% of visible range
    // (means we're too zoomed-out for the annotation to be useful)
    const visibleSpan = mbMax - mbMin;
    const diamondSpan = mbHi - mbLo;
    if (diamondSpan / visibleSpan < 0.08) continue;

    // Draw translucent cyan background rectangle behind the diamond windows.
    // Slightly stronger alpha for strict diamonds (more confident detection).
    const alpha = dd.strict2 ? 0.16 : (dd.strict ? 0.12 : 0.08);
    ctx.fillStyle = 'rgba(60, 223, 255, ' + alpha + ')';
    ctx.fillRect(xLo, pad.t, xHi - xLo, plotH);

    // Draw a thin border on left/right edges of the diamond zone for clarity
    ctx.strokeStyle = 'rgba(60, 223, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xLo + 0.5, pad.t);
    ctx.lineTo(xLo + 0.5, pad.t + plotH);
    ctx.moveTo(xHi - 0.5, pad.t);
    ctx.lineTo(xHi - 0.5, pad.t + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Top annotation strip: small label "◆ split detected" across the top of
    // the diamond zone if there's enough horizontal room (>= 110px).
    if (xHi - xLo >= 110) {
      const stripH = 12;
      ctx.fillStyle = 'rgba(60, 223, 255, 0.85)';
      ctx.fillRect(xLo, pad.t, xHi - xLo, stripH);
      ctx.fillStyle = '#000';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tag = dd.strict2 ? '◆ split [strict2]' :
                  dd.strict  ? '◆ split [strict]'  :
                                '◆ split detected';
      ctx.fillText(tag, (xLo + xHi) / 2, pad.t + stripH / 2);
    } else if (xHi - xLo >= 40) {
      // Compact: just the diamond glyph
      ctx.fillStyle = 'rgba(60, 223, 255, 0.85)';
      ctx.fillRect(xLo, pad.t, xHi - xLo, 8);
      ctx.fillStyle = '#000';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◆', (xLo + xHi) / 2, pad.t + 4);
    }
  }

  ctx.restore();
}

// --- _drawInheritanceLabelsStrip — legacy lines 41557-41683 ---
export function _drawInheritanceLabelsStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state || !_state.linesInheritanceLabelsOn) return;

  // turn 2p: reset hit regions on each draw — they're recomputed below
  // and consumed by the canvas mousemove handler installed by
  // _wireInheritancePillTooltip().
  _state._inhPillHitRegions = [];

  // Auto-trigger compute if needed
  let result = _state.inheritanceResult;
  const items = _gatherActiveCandidatesForInheritance();
  if (items.length < 2) return;   // nothing to label

  const mode = _state.activeMode || 'default';
  const expectedKey = _inheritanceCacheKey(items, mode);
  if (!result || _state.inheritanceCacheKey !== expectedKey) {
    // Schedule deferred compute. Use requestIdleCallback if available;
    // fallback to setTimeout. We do NOT block this frame.
    if (!_state._inheritanceComputeScheduled) {
      _state._inheritanceComputeScheduled = true;
      const fire = () => {
        _state._inheritanceComputeScheduled = false;
        try { runInheritanceCompute(); } catch (_) {}
        // Trigger a redraw if the atlas has a paint scheduler hook
        if (typeof window.requestRepaint === 'function') {
          try { window.requestRepaint(); } catch (_) {}
        }
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(fire, { timeout: 200 });
      } else {
        setTimeout(fire, 0);
      }
    }
    // While waiting, draw a faint placeholder so the user knows compute is in flight
    ctx.save();
    ctx.font = `${_INH_LABEL_FONT_PX}px sans-serif`;
    ctx.fillStyle = 'rgba(140, 150, 165, 0.55)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const stripY = Math.max(0,
      pad.t - _INH_LABEL_STRIP_HEIGHT - _INH_LABEL_STRIP_GAP_BELOW - 6
    );
    ctx.fillText('inheritance: computing…', pad.l + 2, stripY);
    ctx.restore();
    return;
  }

  // Strip drawn ABOVE the regime-breadth strip (which sits at pad.t - 6 area).
  // Place the inheritance labels strip 12px above plot top to leave room.
  const stripH = _INH_LABEL_STRIP_HEIGHT;
  const stripY = Math.max(0, pad.t - stripH - 8);

  ctx.save();
  ctx.font = `${_INH_LABEL_FONT_PX}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const meta = result.items_meta || [];
  const n_per_item = result.rtab && result.rtab.per_item_n_groups;

  for (let i = 0; i < meta.length; i++) {
    const m = meta[i];
    const n_groups = (n_per_item && n_per_item[i] != null) ? n_per_item[i] : '?';
    const mbLo = m.start_bp / 1e6;
    const mbHi = m.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLoVis = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHiVis = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    const w = xHiVis - xLoVis;
    if (w < _INH_LABEL_MIN_BAND_PX) continue;

    const label = _formatInheritanceLabel(m.seq_num, m.seq_num, n_groups);
    const xMid = (xLoVis + xHiVis) / 2;
    const yMid = stripY + stripH / 2;

    // Background pill behind text for legibility
    const textWidth = ctx.measureText(label).width;
    const padX = 3;
    ctx.fillStyle = 'rgba(30, 38, 56, 0.85)';
    ctx.fillRect(xMid - textWidth / 2 - padX, stripY,
                 textWidth + padX * 2, stripH);
    // Subtle frame
    ctx.strokeStyle = 'rgba(110, 130, 165, 0.65)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(xMid - textWidth / 2 - padX, stripY,
                   textWidth + padX * 2, stripH);
    // Text
    ctx.fillStyle = 'rgba(220, 232, 250, 0.95)';
    ctx.fillText(label, xMid, yMid);

    // turn 2p: record hit region for tooltip. Coordinates are in the
    // canvas's CSS pixel space (the same space the mousemove handler
    // converts events into).
    _state._inhPillHitRegions.push({
      x: xMid - textWidth / 2 - padX,
      y: stripY,
      w: textWidth + padX * 2,
      h: stripH,
      candidate_id: m.id,
      seq_num: m.seq_num,
      n_groups: n_groups,
      start_bp: m.start_bp,
      end_bp: m.end_bp,
      item_idx: i,
    });

    // Tick from label to the candidate's left edge (visual association)
    if (mbLo >= mbMin && mbLo <= mbMax) {
      ctx.strokeStyle = 'rgba(110, 130, 165, 0.45)';
      ctx.beginPath();
      ctx.moveTo(xLoVis, stripY + stripH);
      ctx.lineTo(xLoVis, pad.t - 1);
      ctx.stroke();
    }
    if (mbHi >= mbMin && mbHi <= mbMax) {
      ctx.strokeStyle = 'rgba(110, 130, 165, 0.45)';
      ctx.beginPath();
      ctx.moveTo(xHiVis, stripY + stripH);
      ctx.lineTo(xHiVis, pad.t - 1);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// --- _drawTrackedLinkageStrip — legacy lines 46863-46902 ---
export function _drawTrackedLinkageStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state) return;
  if (_state.linesTrackedLinkageOn === false) return;   // explicit off
  const tracked = _state.tracked;
  if (!Array.isArray(tracked) || tracked.length < _TLP_MIN_FISH) return;
  const proj = computeTrackedLinkageProjection(tracked);
  if (!proj || !proj.per_candidate || proj.per_candidate.length === 0) return;

  ctx.save();
  for (const rec of proj.per_candidate) {
    if (rec.purity < _TLP_PURITY_FLOOR) continue;
    const mbLo = rec.start_bp / 1e6;
    const mbHi = rec.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    const w = xHi - xLo;
    if (w < 1) continue;
    // Alpha = purity² (squared so weak signals fade fast)
    const alpha = rec.purity * rec.purity * 0.45;   // cap at 0.45 even for purity=1
    // Convert hex inh-group color to rgba
    const hex = rec.inh_group_color || '#7a8398';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.fillRect(xLo, pad.t, w, plotH);
    // Thin label at bottom: "I3·b2 · 96%"
    if (w >= 36 && rec.purity >= 0.5) {
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
      const label = `I${rec.seq_num}·b${rec.dominant_band} · ${(rec.purity * 100).toFixed(0)}%`;
      ctx.fillText(label, (xLo + xHi) / 2, pad.t + plotH - 2);
    }
  }
  ctx.restore();
}

// --- _drawBandTraceStrip — legacy lines 39842-39969 ---
export function _drawBandTraceStrip(ctx, pad, plotW, plotH, mbMin, mbMax) {
  const _state = _pageState;
  if (!_state || !_state.bandTraceOn) return;
  if (!_state.bandTraceFishSet || !_state.bandTraceFishSet.length) return;
  const d = _state.data;
  if (!d || !Array.isArray(d.l2_envelopes)) return;

  const trace = _bandTraceGetOrCompute();
  if (!trace || !Array.isArray(trace.per_l2) || trace.per_l2.length === 0) return;

  const stripH = 7;
  const stripY = Math.max(0, pad.t - 21);
  const borderH = 1;        // top regime-color stripe
  const fillsH = stripH - borderH;

  // turn 162 — record per-L2 hit rectangles for the hover tooltip. Stored
  // on state in CSS-pixel space (the same space the canvas is drawn in via
  // fitCanvas's setTransform(dpr,…); the mousemove handler in
  // _wireBandTraceTooltip compares cursor CSS coords directly without
  // re-applying any DPR scaling). One rect per visible L2 column spanning
  // the full strip height; the entry is the trace's per_l2[i] so the
  // tooltip body can render entropy / dominant_band / regime / n_valid
  // without re-deriving anything.
  _state._btraceHits = [];

  ctx.save();

  // Backdrop — slightly different tint from lineage strip so they're
  // visually distinguishable when both are on.
  ctx.fillStyle = 'rgba(60, 40, 70, 0.14)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  // Band-colour palette — shared with the karyotype tab and cockpit
  // via shared/color_helpers.js (legacy _gpKaryoColor at line 42894).
  const bandColor = karyoColor;

  // Index per_l2 by l2_idx for O(1) lookup
  const byL2 = {};
  for (let i = 0; i < trace.per_l2.length; i++) {
    byL2[trace.per_l2[i].l2_idx] = trace.per_l2[i];
  }

  // turn 163 — chain-break tick. When the Hungarian projection breaks
  // (chain_idx changes from one painted L2 to the next), drop a thin
  // vertical tick at the leading edge of the new chain so the user can
  // see "the band identity downstream of this point isn't the same
  // identity-space as upstream." Without the tick, a regime stripe that
  // looks contiguous green could actually be two separate co-segregating
  // groups that happen to have the same dominant_band index in different
  // chains. Tracker init to -1 means "no previous L2 painted yet" — the
  // first painted L2 never gets a tick.
  let prevChainIdx = -1;

  for (let l2idx = 0; l2idx < d.l2_envelopes.length; l2idx++) {
    const env = d.l2_envelopes[l2idx];
    if (!env || env.start_bp == null) continue;
    const mbLo = env.start_bp / 1e6;
    const mbHi = env.end_bp / 1e6;
    if (mbHi < mbMin || mbLo > mbMax) continue;
    const xLo = pad.l + Math.max(0, ((mbLo - mbMin) / (mbMax - mbMin)) * plotW);
    const xHi = pad.l + Math.min(plotW, ((mbHi - mbMin) / (mbMax - mbMin)) * plotW);
    const w = xHi - xLo;
    if (w < 1) continue;

    const e = byL2[l2idx];
    if (!e) continue;

    // turn 163 — chain-break tick. Drawn BEFORE the L2's own paint so
    // the tick sits on the leading edge of the new chain (visually:
    // "everything after this tick is in a new chain"). Skipped on the
    // very first painted L2 (prevChainIdx === -1) and when the chain
    // hasn't changed.
    if (prevChainIdx !== -1 && e.chain_idx !== prevChainIdx) {
      ctx.fillStyle = _BTRACE_CHAIN_BREAK_COLOR;
      ctx.fillRect(xLo - 0.5, stripY, 1, stripH);
    }
    prevChainIdx = e.chain_idx;

    // turn 162 — record hover-hit rectangle for this L2 column. Spans the
    // full strip height (regime stripe + stacked bars) so the user can
    // hover anywhere in the column. Pushed BEFORE the regime/stacked-bar
    // paint so hits exist even when the column is `no_valid` (the top
    // stripe alone is painted then, but the column is still hoverable).
    _state._btraceHits.push({
      x: xLo, y: stripY, w: w, h: stripH,
      l2_idx: l2idx,
      entry: e,
    });

    // Top stripe: regime color. Even when no_valid, paint the dark
    // sentinel so the user can distinguish "computed but empty" from
    // "outside view range."
    const regimeC = _BTRACE_REGIME_COLOR[e.regime] || _BTRACE_REGIME_COLOR.no_valid;
    ctx.fillStyle = regimeC;
    ctx.fillRect(xLo, stripY, w, borderH);

    // Stacked bars below: each band's fraction as a horizontal slab,
    // ordered by band index. Skip if no_valid (top stripe alone
    // communicates the state).
    if (e.regime === 'no_valid') continue;
    const fillTop = stripY + borderH;
    let acc = 0;
    const K = (e.band_fractions && e.band_fractions.length) || 0;
    for (let k = 0; k < K; k++) {
      const frac = e.band_fractions[k] || 0;
      if (frac <= 0) continue;
      const h = frac * fillsH;
      ctx.fillStyle = bandColor(k);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(xLo, fillTop + acc, w, h);
      acc += h;
    }
    ctx.globalAlpha = 1;
  }

  // Frame
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(pad.l + 0.25, stripY + 0.25, plotW - 0.5, stripH - 0.5);

  ctx.restore();
}

// --- drawZ(state) — legacy lines 31839-32460 ---
export function drawZ(state) {
  _setActiveState(state);
  const canvas = document.getElementById('zCanvas');
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (!state.data) {
    // v3.99 turn 14e ask 2: when no data is loaded, draw a centered hint
    // text instead of a silent blank canvas. In compact mode the right
    // column was completely empty on first open with no clue what to do.
    // The hint mirrors the sidebar emptyState language so the user knows
    // both surfaces point to the same action.
    ctx.fillStyle = themeColor('ink-dim');
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Load a precomp JSON in the sidebar (Browse…) to begin.', w / 2, h / 2 - 8);
    ctx.font = '10.5px ui-monospace, monospace';
    ctx.fillStyle = themeColor('ink-dimmer') || themeColor('ink-dim');
    ctx.fillText('Robust |Z| profile renders here once data is loaded.', w / 2, h / 2 + 10);
    return;
  }
  const d = state.data;
  // v3.61: when collapsed, render a COMPACT view that keeps the L1/L2 zone
  // bars + boundary arrows + a yellow candidate strip visible. Previously
  // collapsing the Z panel hid everything (including the L1/L2 zone bars,
  // which the user relies on for orientation while scrubbing). Compact
  // mode is the new default for the collapse state.
  if (state.zCollapsed) {
    const pad = { l: 44, r: 16, t: 2, b: 1 };
    const zoneH = 14;
    const peaksH = 5;
    // v3.99 t14e+ continue: candidate bar above L1/L2 (was below boundaries
    // in old strip placement). Slightly thinner here than in non-collapsed
    // mode since vertical space is constrained; ★ glyph still fits at h=5.
    // v4 turn 13 (Deliverable B): when overlapping candidates require N>1
    // lanes, the bar's TOTAL height is N × candBarH so each lane gets the
    // same per-lane height as the single-lane case.
    const candBarH = 5;
    const candGap  = 1;
    const _candLanes = (typeof _assignCandidateLanes === 'function')
      ? _assignCandidateLanes(state.candidateList || []).n_lanes : 1;
    const candBarTotal = candBarH * _candLanes;
    const zoneTop  = pad.t + candBarTotal + candGap;
    const plotW = w - pad.l - pad.r;
    const _mbR = currentMbRange(state);
    const mbMin = _mbR.mbMin, mbMax = _mbR.mbMax;
    const toX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;
    const xOfWin = (wi) => toX(d.windows[wi].center_mb);
    // v3.99 t14e+ continue: Candidate bar — pending grey + confirmed gold ★
    // sitting ABOVE the L1/L2 zone bars
    drawCandidateBar(ctx, d, toX, pad.t, candBarTotal);
    // v4 turn 1 ask 5: "cand" label to the left of the candidate strip,
    // mirroring the L1/L2 label pattern below. Quentin: "the candidate
    // track is missing L3 or Candidate label to the left." Using "cand"
    // (4 chars) so it fits the same pad.l offset as "L1"/"L2" without
    // overlapping the y-axis tick labels. Color is amber (--accent /
    // rgba(245,165,36)) — matches the candidate bar's confirmed gold
    // and is the recognizable "candidate" hue throughout the scrubber.
    ctx.fillStyle = 'rgba(245, 165, 36, 0.95)';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('cand', pad.l - 4, pad.t + candBarTotal / 2);
    // L1 zone bars (top half of zoneH, deeper blue — v3.99 turn 13 ask 3)
    if (Array.isArray(d.l1_envelopes)) {
      const y0 = zoneTop, hzone = zoneH / 2 - 1;
      const curL1 = state.windowToL1 ? state.windowToL1[state.cur] : -1;
      d.l1_envelopes.forEach((e, i) => {
        const x0 = xOfWin(e._s0), x1 = xOfWin(e._e0);
        ctx.fillStyle = (i === curL1) ? 'rgba(48,116,200,0.95)' : 'rgba(48,116,200,0.50)';
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), hzone);
      });
      // v4 turn 4 ask 2: dark-red 1px separator at each fragment's right edge
      // so adjacent L1 envelopes are visible. Without these, neighbors at
      // alpha=0.50 visually merge into one bar.
      ctx.fillStyle = 'rgba(140, 29, 36, 0.95)';
      d.l1_envelopes.forEach((e, i) => {
        if (i === d.l1_envelopes.length - 1) return;
        const x1 = xOfWin(e._e0);
        ctx.fillRect(x1 - 0.5, y0, 1, hzone);
      });
      ctx.fillStyle = 'rgba(48,116,200,0.95)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('L1', pad.l - 4, y0 + hzone / 2);
    }
    // L2 zone bars (bottom half, deeper green — v3.99 turn 13 ask 3)
    if (Array.isArray(d.l2_envelopes)) {
      const y0 = zoneTop + zoneH / 2 + 1, hzone = zoneH / 2 - 1;
      const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
      d.l2_envelopes.forEach((e, i) => {
        const x0 = xOfWin(e._s0), x1 = xOfWin(e._e0);
        ctx.fillStyle = (i === curL2) ? 'rgba(34,160,80,0.95)' : 'rgba(34,160,80,0.50)';
        ctx.fillRect(x0, y0, Math.max(1, x1 - x0), hzone);
      });
      // v4 turn 4 ask 2: dark-red 1px separator (same as L1)
      ctx.fillStyle = 'rgba(140, 29, 36, 0.95)';
      d.l2_envelopes.forEach((e, i) => {
        if (i === d.l2_envelopes.length - 1) return;
        const x1 = xOfWin(e._e0);
        ctx.fillRect(x1 - 0.5, y0, 1, hzone);
      });
      // v4 turn 107: window-mode candidate boundary ticks on minimap L2 row
      if (Array.isArray(state.candidateList)) {
        ctx.fillStyle = 'rgba(60, 223, 255, 0.95)';
        for (const c of state.candidateList) {
          if (!c || c.source !== 'l3_draft_w') continue;
          if (c.start_w != null) {
            const xs = xOfWin(c.start_w);
            ctx.fillRect(xs - 0.5, y0 - 1, 1, hzone + 2);
          }
          if (c.end_w != null) {
            const xe = xOfWin(c.end_w);
            ctx.fillRect(xe + 0.5, y0 - 1, 1, hzone + 2);
          }
        }
      }
      if (state.l3Draft && state.l3Draft.resolution === 'W' &&
          state.l3Draft.start_w != null && state.l3Draft.end_w != null) {
        ctx.fillStyle = 'rgba(245, 196, 58, 0.95)';   // gold (draft palette)
        const xs = xOfWin(state.l3Draft.start_w);
        const xe = xOfWin(state.l3Draft.end_w);
        ctx.fillRect(xs - 0.5, y0 - 1, 1, hzone + 2);
        ctx.fillRect(xe + 0.5, y0 - 1, 1, hzone + 2);
      }
      ctx.fillStyle = 'rgba(34,160,80,0.95)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('L2', pad.l - 4, y0 + hzone / 2);
    }
    // v4 turn 33 (Ask A): always-on windows-navigation lane, sits between
    // the L2 zone bar and the candidate-mode W-row. Visual rhythm is
    // cand → L1 → L2 → win-nav → W-row(if cand mode) → boundary arrows.
    const _navBandC = _winNavBand({ collapsed: true, zoneTop, zoneH });
    if (_navBandC) {
      _drawWinNavLane(ctx, d, toX, xOfWin, _navBandC, pad.l);
    }
    const _navExtraC = _navBandC ? (_navBandC.h + _navBandC.gap) : 0;
    // v4 turn 10: W-row (per-window candidate-draft strip), collapsed mode.
    // Sits directly below the L2 zone bar; only visible when in candidate mode.
    // v4 turn 33: when nav-lane is visible we pass an inflated zoneH so the
    // W-row band lands below it instead of stacking on top.
    const _wBandC = _wRowBand({ collapsed: true, zoneTop,
                                  zoneH: zoneH + _navExtraC });
    if (_wBandC) {
      _drawWRow(ctx, d, toX, xOfWin, _wBandC);
    }
    // Boundary arrows (just below zone bars)
    if (Array.isArray(d.l2_boundaries)) {
      // v4 turn 10: when W-row is visible, push the arrow band down by its
      // height + gap so it doesn't overlap the W-row.
      // v4 turn 33: also push down by the nav-lane's height + gap.
      const _wExtra = _wBandC ? (_wBandC.h + _wBandC.gap) : 0;
      const _vertExtra = _navExtraC + _wExtra;
      const yArrowTop  = zoneTop + zoneH + _vertExtra + 1;
      const yArrowBase = zoneTop + zoneH + _vertExtra + peaksH - 1;
      const halfW = 3;
      for (const b of d.l2_boundaries) {
        const wi = (b.boundary_w | 0) - 1;
        if (wi < 0 || wi >= d.n_windows) continue;
        const x = toX(d.windows[wi].center_mb);
        const col = STATUS_COLOR[b.validation_status] || '#666';
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, yArrowTop);
        ctx.lineTo(x - halfW, yArrowBase);
        ctx.lineTo(x + halfW, yArrowBase);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Cursor — extends from pad.t (top of candidate bar) through L1/L2 down
    // to the bottom of the boundary-arrow band.
    // v4 turn 10: include W-row in cursor extent when W-row is visible.
    // v4 turn 33: include nav-lane too.
    const _wExtraCur = _wBandC ? (_wBandC.h + _wBandC.gap) : 0;
    const _vertExtraCur = _navExtraC + _wExtraCur;
    const xCur = toX(d.windows[state.cur].center_mb);
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(xCur + 0.5, pad.t);
    ctx.lineTo(xCur + 0.5, zoneTop + zoneH + _vertExtraCur + peaksH);
    ctx.stroke();
    return;
  }
  // v3.57: pad.t reduced from 18 → 6 because the panel-label header is now
  // in normal flow ABOVE the canvas (flex column on #zPanel), not absolute
  // overlay. Zone bars sit at canvas-top with just 6px breathing room.
  // v3.99 turn 14e: bumped 6 → 14 because turn 14d hid the panel-label
  // header strip entirely (moved explanation to a panel-level tooltip and
  // ⚙/▼ buttons to canvas bottom-left). With the strip gone, the canvas
  // is flush with the top of the panel and 6 px isn't enough breathing
  // room — the L1/L2 zone bars at y=pad.t looked like they were overflowing
  // into adjacent panels above. 14 px restores proper visual separation.
  const pad = { l: 44, r: 16, t: 14, b: 22 };
  // Reserve top strip for L1/L2 zone bars
  const zoneH = 14;
  // v3.61: reserve a thin band BELOW the zone bars for L2 boundary arrows
  // (previously rendered as filled circles at the BOTTOM of the plot area on
  // the dashed yellow line). Putting them just under the zone bars makes them
  // read as "boundary markers tied to the L1/L2 envelope coloring above"
  // rather than getting confused with the z-score scatter.
  const peaksH = 8;
  // v3.99 t14e+ continue: reserve a band ABOVE the L1/L2 zone bars for the
  // candidate bar (drawCandidateBar). Pending candidates render grey here,
  // confirmed candidates render shiny gold + ★. 2 px gap separates this
  // strip from the L1 bar below it. Total top-band cost: candBarH + 2 px.
  const candBarH = 7;
  const candGap  = 2;
  // v4 turn 13 (Deliverable B): when overlapping candidates require N>1
  // lanes, the bar's TOTAL height is N × candBarH so each lane gets the
  // same per-lane height as the single-lane case. zoneTop and plotH both
  // adjust to keep L1/L2/W-row/peaks/scatter visually in the same place
  // relative to the cand bar's BOTTOM.
  const _candLanes = _assignCandidateLanes(state.candidateList || []).n_lanes;
  const candBarTotal = candBarH * _candLanes;
  // Effective top of L1 bar shifts down by (candBarTotal + candGap)
  const zoneTop = pad.t + candBarTotal + candGap;
  // v4 turn 33 (Ask A): always-on nav-windows lane between L2 and W-row.
  // _navExtra captures its height + gap, and the W-row computation uses
  // an inflated zoneH so it lands BELOW the nav-lane.
  const _navBandEx = _winNavBand({ collapsed: false, zoneTop, zoneH });
  const _navExtra  = _navBandEx ? (_navBandEx.h + _navBandEx.gap) : 0;
  // v4 turn 10: reserve a per-window draft strip between the L2 zone bar and
  // the boundary-arrow band when in candidate mode. _wExtra captures both the
  // row height and its top gap; everything below it (boundary arrows, plot,
  // toY ladder) shifts down by this amount so the layout doesn't collide.
  // _wRowBand returns null when the row is not visible — in that case
  // _wExtra evaluates to 0 and the layout is identical to pre-v4-turn-10.
  // v4 turn 33: pass zoneH + _navExtra so W-row lands below the nav-lane.
  const _wRowEx = _wRowBand({ collapsed: false, zoneTop,
                                zoneH: zoneH + _navExtra });
  const _wExtra = _wRowEx ? (_wRowEx.h + _wRowEx.gap) : 0;
  // Total vertical reservation between L2 bottom and the boundary-arrow top.
  const _vertExtra = _navExtra + _wExtra;
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b - candBarTotal - candGap - zoneH - _vertExtra - peaksH;

  const mbs = d.windows.map(w0 => w0.center_mb);
  // v3.41: signed-or-absolute Z values per state.zValueMode
  const zMode_val = state.zValueMode || 'abs';
  const zs = (zMode_val === 'signed')
    ? d.windows.map(w0 => +(w0.z || 0))
    : d.windows.map(w0 => Math.abs(w0.z || 0));
  const _mbR = currentMbRange(state);
  const mbMin = _mbR.mbMin, mbMax = _mbR.mbMax;
  // Compute zMax / zMin from the visible window subset only.
  let zMax = 0, zMin = 0;
  for (let i = 0; i < d.n_windows; i++) {
    const cm = mbs[i];
    if (cm < mbMin || cm > mbMax) continue;
    if (zs[i] > zMax) zMax = zs[i];
    if (zMode_val === 'signed' && zs[i] < zMin) zMin = zs[i];
  }
  zMax = Math.max(3, Math.ceil(zMax));
  if (zMode_val === 'signed') {
    // Symmetric range so 0 sits in the middle. Use max(|zMax|, |zMin|).
    const r = Math.max(zMax, Math.abs(Math.floor(zMin)));
    zMax = r;
    zMin = -r;
  } else {
    zMin = 0;
  }

  const toX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;
  // v3.61: z-scatter starts at zoneTop + zoneH + peaksH (below boundary-arrows)
  // v3.99 t14e+ continue: zoneTop = pad.t + candBarH + candGap (was pad.t)
  // v4 turn 10: + _wExtra so the W-row sits between the L2 bar and the arrows.
  // v4 turn 33: switched to _vertExtra (which includes the always-on nav-lane).
  const toY = (z)  => zoneTop + zoneH + _vertExtra + peaksH + plotH - ((z - zMin) / (zMax - zMin)) * plotH;
  const xOfWin = (wi) => toX(d.windows[wi].center_mb);

  // L1 zone bars (top half of zoneH, deeper blue per Quentin's request).
  // v3.99 turn 13 ask 3: colors darkened to be more legible against the
  // panel background; old 79,163,255 was washed-out and the inactive band
  // at 0.35 alpha was nearly invisible. New rgb(48,116,200) is the same hue
  // family but with more saturation. Active state stays brighter via alpha.
  if (Array.isArray(d.l1_envelopes)) {
    const y0 = zoneTop, hzone = zoneH / 2 - 1;
    const curL1 = state.windowToL1 ? state.windowToL1[state.cur] : -1;
    d.l1_envelopes.forEach((e, i) => {
      const x0 = xOfWin(e._s0), x1 = xOfWin(e._e0);
      ctx.fillStyle = (i === curL1) ? 'rgba(48,116,200,0.95)' : 'rgba(48,116,200,0.50)';
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), hzone);
    });
    // v4 turn 4 ask 2: dark-red 1px separator at each fragment's right edge
    // so adjacent L1 envelopes are visually distinct.
    ctx.fillStyle = 'rgba(140, 29, 36, 0.95)';
    d.l1_envelopes.forEach((e, i) => {
      if (i === d.l1_envelopes.length - 1) return;
      const x1 = xOfWin(e._e0);
      ctx.fillRect(x1 - 0.5, y0, 1, hzone);
    });
    // v3.99 turn 13 ask 3: "L1" label in the y-axis margin so users can
    // tell what the blue bar means. Right-aligned to pad.l - 4 so it sits
    // just inside the bar's left edge.
    ctx.fillStyle = 'rgba(48,116,200,0.95)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('L1', pad.l - 4, y0 + hzone / 2);
  }
  // L2 zone bars (bottom half, deeper green)
  if (Array.isArray(d.l2_envelopes)) {
    const y0 = zoneTop + zoneH / 2 + 1, hzone = zoneH / 2 - 1;
    const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
    d.l2_envelopes.forEach((e, i) => {
      const x0 = xOfWin(e._s0), x1 = xOfWin(e._e0);
      ctx.fillStyle = (i === curL2) ? 'rgba(34,160,80,0.95)' : 'rgba(34,160,80,0.50)';
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), hzone);
    });
    // v4 turn 4 ask 2: dark-red 1px separator (same as L1)
    ctx.fillStyle = 'rgba(140, 29, 36, 0.95)';
    d.l2_envelopes.forEach((e, i) => {
      if (i === d.l2_envelopes.length - 1) return;
      const x1 = xOfWin(e._e0);
      ctx.fillRect(x1 - 0.5, y0, 1, hzone);
    });
    // v4 turn 107: bright cyan tick markers on the L2 strip at the start/end
    // window of every committed candidate whose boundaries don't align with
    // the underlying L2 envelopes. These are window-mode candidates from
    // turn 106 (source='l3_draft_w'). Visually communicates "user-defined
    // unit boundaries here that L2 doesn't reflect" — the L2 segments
    // themselves stay unchanged because the L2 registry isn't authoritative
    // anymore (Quentin's design choice for turn 106-107: L2 = navigation,
    // candidates = real units).
    if (Array.isArray(state.candidateList)) {
      ctx.fillStyle = 'rgba(60, 223, 255, 0.95)';
      for (const c of state.candidateList) {
        if (!c) continue;
        // Only draw ticks for window-mode candidates (turn-106 tagged) OR
        // candidates whose start_w / end_w don't fall on an L2 boundary.
        const isWindowMode = c.source === 'l3_draft_w';
        if (!isWindowMode) continue;
        if (c.start_w != null) {
          const xs = xOfWin(c.start_w);
          ctx.fillRect(xs - 1, y0 - 1, 2, hzone + 2);
        }
        if (c.end_w != null) {
          const xe = xOfWin(c.end_w);
          ctx.fillRect(xe, y0 - 1, 2, hzone + 2);
        }
      }
    }
    // Active draft in window mode — show its current ticks too (as the user
    // is extending/shrinking with arrows, the cyan ticks update live).
    if (state.l3Draft && state.l3Draft.resolution === 'W' &&
        state.l3Draft.start_w != null && state.l3Draft.end_w != null) {
      ctx.fillStyle = 'rgba(245, 196, 58, 0.95)';   // gold (matches draft palette)
      const xs = xOfWin(state.l3Draft.start_w);
      const xe = xOfWin(state.l3Draft.end_w);
      ctx.fillRect(xs - 1, y0 - 1, 2, hzone + 2);
      ctx.fillRect(xe,     y0 - 1, 2, hzone + 2);
    }
    // v3.99 turn 13 ask 3: "L2" label, same pattern as L1
    ctx.fillStyle = 'rgba(34,160,80,0.95)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('L2', pad.l - 4, y0 + hzone / 2);
  }

  // Threshold lines + |Z| points
  ctx.strokeStyle = 'rgba(42,50,66,0.6)';
  for (let i = 0; i <= 4; i++) {
    // v3.61: gridlines start at top of z-scatter (after zone bars + peaks band)
    // v3.99 t14e+ continue: zoneTop replaces pad.t (candidate bar offset)
    // v4 turn 10: + _wExtra so gridlines stay aligned with toY when W-row visible.
    // v4 turn 33: switched to _vertExtra.
    const y = zoneTop + zoneH + _vertExtra + peaksH + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
  }
  const ths = [
    { z: 2.5, color: 'rgba(224,85,92,0.45)' },
    { z: 1.8, color: 'rgba(60,192,138,0.40)' },
    { z: 1.2, color: 'rgba(245,165,36,0.40)' },
  ];
  ctx.setLineDash([4, 4]);
  for (const th of ths) {
    if (th.z > zMax) continue;
    ctx.strokeStyle = th.color;
    let y = toY(th.z);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
    // In signed mode, also draw the negative mirror so deviations in either
    // direction are flagged
    if (zMode_val === 'signed' && -th.z >= zMin) {
      y = toY(-th.z);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  // Solid baseline at zero (signed mode) — important visual reference
  if (zMode_val === 'signed') {
    ctx.strokeStyle = themeColor('ink-dim');
    ctx.lineWidth = 1;
    const y0 = toY(0);
    ctx.beginPath();
    ctx.moveTo(pad.l, y0); ctx.lineTo(pad.l + plotW, y0);
    ctx.stroke();
  }
  // v3.50: y-axis tick labels are now generated by niceTicks() below in the
  // "Axes labels" block. The previous implementation hard-coded zMin/mid/zMax,
  // and was then overwritten by an integer ladder loop. Both paths consolidated.
  // Y-axis label (mode indicator) at top-left
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(zMode_val === 'signed' ? 'Z' : '|Z|', 4, zoneTop + zoneH + _vertExtra + peaksH + 9);

  // ---------------------------------------------------------------------------
  // Z dot coloring — switchable mode (state.zColorMode):
  //   'bands'     band thresholds (current default; preserves existing colors)
  //   'gradient'  continuous viridis-ish from cool low |Z| to hot high |Z|
  //   'zone'      bright if window is in current focal L2; dim otherwise
  //   'highlight' bright if |Z| >= state.zHighlightThr; dim below
  // ---------------------------------------------------------------------------
  const zMode = state.zColorMode || 'bands';
  const curL1 = state.windowToL1 ? state.windowToL1[state.cur] : -1;
  const curL2 = state.windowToL2 ? state.windowToL2[state.cur] : -1;
  const zThr  = (state.zHighlightThr != null && isFinite(state.zHighlightThr))
              ? state.zHighlightThr : 1.8;

  for (let i = 0; i < d.n_windows; i++) {
    const z = zs[i];                              // signed or abs depending on mode
    const zAbs = Math.abs(z);                     // for thresholding (significance is symmetric)
    let color;
    if (zMode === 'gradient') {
      // Continuous gradient: 0..zMax mapped through HSL hue 220→0 (blue→red)
      // with brightness scaling so very low-|Z| is muted.
      const t = Math.max(0, Math.min(1, zAbs / zMax));
      const hue = (1 - t) * 220;          // 220° (blue) at low, 0° (red) at high
      const sat = 70;                      // %
      const lit = 35 + 25 * t;             // 35→60% lightness
      const alpha = 0.30 + 0.70 * t;       // dim at bottom, bright at top
      color = `hsla(${hue.toFixed(0)},${sat}%,${lit}%,${alpha.toFixed(2)})`;
    } else if (zMode === 'zone') {
      // In current focal L2 → bright green (matches L2 zone bar palette).
      // In current L1 (but not L2) → muted blue. Outside both → very dim grey.
      // v3.99 turn 14e+: colors aligned to the darker turn-13 palette so the
      // dots match the L1/L2 zone-bar colors above. Old rgba(0,230,118)
      // and rgba(79,163,255) were the pre-turn-13 washed-out values.
      const inL2 = (curL2 >= 0) && (state.windowToL2 && state.windowToL2[i] === curL2);
      const inL1 = (curL1 >= 0) && (state.windowToL1 && state.windowToL1[i] === curL1);
      if (inL2)      color = 'rgba(34,160,80,0.85)';
      else if (inL1) color = 'rgba(48,116,200,0.55)';
      else           color = 'rgba(180,180,180,0.18)';
    } else if (zMode === 'highlight') {
      // Bright above threshold, dim below. Threshold itself shown as a
      // dashed horizontal line for clarity (drawn after the dot loop).
      if (zAbs >= zThr) {
        color = 'rgba(245,165,36,0.92)';   // bright amber
      } else {
        color = 'rgba(170,170,170,0.22)';  // muted grey
      }
    } else {
      // Default: 'bands' — palette ported from the R z-score profile plot
      // (v3.60). Five bins that spread the high-|Z| range across three colors
      // so peaks visibly differentiate. Bins use 1.5/2/3/4 breakpoints, which
      // are visualization-only and intentionally distinct from the biological
      // S1L/S1M/S1S thresholds (1.2/1.8/2.5) drawn as dashed reference lines
      // elsewhere in the panel. Compared on |Z| so signed mode still
      // highlights extreme negative deviations.
      if      (zAbs >= 4)   color = 'rgba(26, 47, 112, 0.95)';   // deep navy
      else if (zAbs >= 3)   color = 'rgba(45, 87, 160, 0.90)';   // rich blue
      else if (zAbs >= 2)   color = 'rgba(79, 127, 184, 0.80)';  // mid blue
      else if (zAbs >= 1.5) color = 'rgba(166, 197, 229, 0.65)'; // pale ice blue
      else                  color = 'rgba(200, 200, 200, 0.32)'; // muted grey (z<1.5)
    }
    ctx.fillStyle = color;
    const x = toX(mbs[i]), y = toY(z);
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
  }
  // Draw the highlight threshold as a dashed amber line in 'highlight' mode
  if (zMode === 'highlight' && zThr > 0 && zThr <= zMax) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245,165,36,0.65)';
    ctx.lineWidth = 1;
    const yT = toY(zThr);
    ctx.beginPath(); ctx.moveTo(pad.l, yT); ctx.lineTo(pad.l + plotW, yT); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(245,165,36,0.92)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`|Z|≥${zThr.toFixed(1)}`, pad.l + 4, yT - 3);
  }

  // L2 boundary peaks colored by validation_status
  // v3.61: rendered as small UPWARD triangles in the dedicated peaksH band
  // between the L2 zone bar and the z-scatter (was filled circles at the
  // bottom of the plot area, on the dashed yellow line). Triangles point up
  // so they read as "boundary marker tied to the L1/L2 envelope above".
  // v4 turn 10: W-row (per-window candidate-draft strip), expanded mode.
  // Sits directly below the L2 zone bar; only visible when in candidate mode.
  // _wRowEx was computed up front so plotH already accounts for this band.
  // v4 turn 33: nav-lane (always-on) is drawn FIRST so it sits between L2
  // and the W-row. _navBandEx was reserved up front so plotH/toY/arrows
  // already account for it via _vertExtra.
  if (_navBandEx) {
    _drawWinNavLane(ctx, d, toX, xOfWin, _navBandEx, pad.l);
  }
  if (_wRowEx) {
    _drawWRow(ctx, d, toX, xOfWin, _wRowEx);
  }
  if (Array.isArray(d.l2_boundaries)) {
    // v4 turn 10: + _wExtra so arrows sit below the W-row, not on top of it.
    // v4 turn 33: switched to _vertExtra so arrows sit below the always-on nav-lane too.
    const yArrowTop  = zoneTop + zoneH + _vertExtra + 2;          // pointed tip touches just below zone bars (or W-row)
    const yArrowBase = zoneTop + zoneH + _vertExtra + peaksH - 1; // triangle base
    const halfW      = 3;
    for (const b of d.l2_boundaries) {
      const wi = (b.boundary_w | 0) - 1;
      if (wi < 0 || wi >= d.n_windows) continue;
      const x = toX(d.windows[wi].center_mb);
      const col = STATUS_COLOR[b.validation_status] || '#666';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, yArrowTop);                   // tip
      ctx.lineTo(x - halfW, yArrowBase);          // base-left
      ctx.lineTo(x + halfW, yArrowBase);          // base-right
      ctx.closePath();
      ctx.fill();
    }
  }
  // v3.99 t14e+ continue: Candidate bar moved ABOVE the L1/L2 zone bars per
  // Quentin's request — pending candidates render grey, confirmed render
  // shiny gold + ★. Drawn at pad.t (top of canvas plot area, before the
  // L1/L2 zone bars at zoneTop). The old strip-below-boundary-arrows
  // location has been removed.
  // v4 turn 13: candBarTotal = candBarH × n_lanes (lane-stacking when
  // overlapping candidates exist; identical to candBarH when n_lanes=1).
  drawCandidateBar(ctx, d, toX, pad.t, candBarTotal);
  // v4 turn 1 ask 5: "cand" label to the left of the candidate strip,
  // mirroring the L1/L2 label pattern. Same amber color, same right-
  // aligned at pad.l - 4 anchor. See the compact-mode call site above
  // for full rationale.
  ctx.fillStyle = 'rgba(245, 165, 36, 0.95)';
  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('cand', pad.l - 4, pad.t + candBarTotal / 2);

  // Axes labels
  // v3.50: previous code rendered an integer label at EVERY z from 0..zMax,
  // which became unreadable for zMax > ~10 (e.g. zMax=51 → 52 stacked
  // labels). Use niceTicks for ~5 well-spaced labels at round numbers.
  ctx.fillStyle = themeColor('ink-dim');
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  const zTicks = niceTicks(zMin, zMax, 5);
  for (const z of zTicks) {
    const y = toY(z);
    // Stay below the zone-bar + peaks strip (v3.61)
    // v3.99 t14e+ continue: use zoneTop instead of pad.t
    // v4 turn 10: + _wExtra so guard tracks toY in W-row mode.
    if (y < zoneTop + zoneH + _wExtra + peaksH - 2) continue;
    // Use 1 decimal for fractional ticks (e.g. 2.5), no decimals for integers
    const lbl = (Math.abs(z - Math.round(z)) < 1e-9) ? z.toFixed(0) : z.toFixed(1);
    ctx.fillText(lbl, pad.l - 5, y + 3);
  }
  ctx.textAlign = 'center';
  const mbTicks = niceTicks(mbMin, mbMax, 6);
  for (const mb of mbTicks) {
    const x = toX(mb);
    // v4 turn 10: + _wExtra so mb-axis labels stay aligned with plot bottom.
    ctx.fillText(mb.toFixed(0), x, zoneTop + zoneH + _wExtra + peaksH + plotH + 14);
  }
  // v3.99 turn 13 ask 5: chromosome name + "(Mb)" label moved from the
  // right edge to the left edge of the X-axis.
  // v3.99 turn 14e: anchored further left at x=2 (was pad.l=44) so the
  // label sits in the y-axis margin area starting near the panel's left
  // edge instead of starting at where the plot area begins. Frees the
  // pad.l..pad.l+plotW zone for the leftmost mb tick label without
  // collision.
  ctx.textAlign = 'left';
  ctx.fillText(d.chrom + ' (Mb)', 2, h - 4);

  // v4 turn 114a: cross-species breakpoint overlay lines.
  // Renders a thin red dashed vertical line at each cs-breakpoint Gar
  // genomic position, spanning the full plot region. Distinct from the
  // existing cursor (orange solid) and L1/L2 boundaries (blue/green solid).
  // Source data: state.crossSpecies.breakpoints filtered by chrom (built
  // by _ensureCsOverlayIndex).
  try {
    const csIdx = (typeof _ensureCsOverlayIndex === 'function')
      ? _ensureCsOverlayIndex() : null;
    if (csIdx && csIdx.bps.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#e85a5a';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.globalAlpha = 0.85;
      const yTop = pad.t;
      const yBot = zoneTop + zoneH + _wExtra + peaksH + plotH;
      for (const e of csIdx.bps) {
        if (e.mb < mbMin || e.mb > mbMax) continue;
        const xx = toX(e.mb);
        if (!Number.isFinite(xx)) continue;
        ctx.beginPath();
        ctx.moveTo(xx + 0.5, yTop);
        ctx.lineTo(xx + 0.5, yBot);
        ctx.stroke();
      }
      ctx.restore();
    }
  } catch (_) { /* fail-soft: overlay is decorative */ }

  // Current cursor
  // v3.99 t14e+ continue: cursor extends from pad.t (top — through candidate
  // bar) all the way down to plot bottom, so it visually links the candidate
  // strip with the L1/L2 bars and the z-scatter as one continuous indicator.
  // v4 turn 10: + _wExtra so the cursor reaches plot bottom in W-row mode too.
  const xCur = toX(d.windows[state.cur].center_mb);
  ctx.strokeStyle = '#f5a524';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xCur + 0.5, pad.t);
  ctx.lineTo(xCur + 0.5, zoneTop + zoneH + _wExtra + peaksH + plotH);
  ctx.stroke();
}
