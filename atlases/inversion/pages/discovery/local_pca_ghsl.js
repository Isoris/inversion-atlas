// Atlas/inversion_discovery/local_pca_ghsl.js
// =============================================================================
// local_pca_ghsl — GHSL haplotype-divergence page (planned six-panel scanner; currently
//          empty-state with layer-status indicators only)
// (`<div id="local_pca_ghsl">` — empty-state shell with five [data-gh-layer]
//  indicator chips: ghsl_panel, ghsl_kstripes, ghsl_karyotype_runs,
//  ghsl_d17_envelopes, cusum_ghsl)
//
// Source: legacy/Inversion_atlas.html lines 7180-7247 (HTML shell) + lines
// 53065-53081 (the one extracted helper _refreshGhslLayerStatus).
//
// Same orthogonal-validation rationale as local_pca_theta_pi (θπ scanner): local_pca_ghsl is
// designed as a third evidence axis — GHSL haplotype divergence — that
// will eventually run the same six-panel pipeline (per-window analysis →
// window×window similarity → MDS → cluster → candidate intervals) but
// driven by haplotype-pair sequence divergence rather than dosage (local_pca_dosage)
// or per-sample θπ (local_pca_theta_pi). Regions hit by all three scrubbers are
// near-certainly real biology; regions hit by GHSL only are
// haplotype-specific divergence invisible to dosage-or-diversity scans.
//
// Round-5-step-15 status: local_pca_ghsl currently ships only the layer-status
// indicator wiring. The five [data-gh-layer] chips toggle between
// "🟢 loaded" and "⚪ not loaded" based on whether each GHSL layer is
// present in state.layersPresent (a Set). Empty-state placeholder visible
// until at least one of the GHSL layers ships from the R pipeline; full
// six-panel renderers (mirroring local_pca_dosage's drawZ/drawSim/drawLinesPanel/
// drawAnchorStrip/drawPca/drawL3) are TODO_MISSING — see CONTINUE_HERE
// "stub-preserving + one wired entry" pattern.
//
// External dependencies (when wired up):
//   TODO_MISSING(_drawGhslZPanel + 5 sibling panel renderers) — six-panel
//                                  pipeline mirroring local_pca_dosage / local_pca_theta_pi.
//   TODO_MISSING(_refreshGhslPanelVisibility) — empty-state vs panels
//                                  visibility toggle (mirrors local_pca_theta_pi's
//                                  _refreshThetaPiPanelVisibility).
//   global `state`              — the chat-33 helper reads
//                                  state.layersPresent (Set<layerName>);
//                                  future panel renderers will read the
//                                  per-window GHSL data slots once they
//                                  ship from R.
//
// Decision for this round (chat 38 round 5 step 15, 2026-05-07): preserve
// the chat-33 _refreshGhslLayerStatus body VERBATIM (it already takes
// state as an explicit arg per HANDOFF_BATCH_1 convention), add a
// state-aware public wrapper refreshGhslLayerStatus that mirrors confirmed_carousel's
// refreshConfirmedCarousel pattern, and call it from mount() so the chips
// render at mount time. This is the "stub-preserving + one wired entry"
// hybrid pattern (pattern 4 in CONTINUE_HERE, first instance).
//
// **Closing the discovery group**: with this round, local_pca_dosage, candidate_focus, window_summary_table,
// local_pca_theta_pi, local_pca_ghsl, negative_regions are all migrated — discovery group is COMPLETE
// (6 of 6).
// =============================================================================

import { contextFromState, clusterL2, ClusterCache } from '../../shared/per_l2_cluster.js';
import { hetRateColor } from '../../shared/het_rate.js';
import { alignLabels, hungarianChainProjection, concordanceMatrix } from '../../shared/hungarian.js';
import { buildContingency, computeARI, computeNMI, cramersV } from '../../shared/contingency.js';
import { kmeans1D, kmeans2D, silhouette1D, adaptiveK1D } from '../../shared/kmeans.js';
// 2026-05-15: panel renderers consume the documented ghsl_panel +
// ghsl_kstripes data shapes via these pure accessors. No invented data.
import {
  ghslPanel,
  ghslPanelScales,
  ghslPanelPrimaryScale,
  ghslAggregateRange,
} from '../../shared/ghsl_panel.js';

import { _pageState, _setActiveState } from './local_pca_ghsl/_state.js';

// ---------------------------------------------------------------------------
// Extracted bodies (chat-33, preserved VERBATIM)
// ---------------------------------------------------------------------------

// --- _refreshGhslLayerStatus() — legacy lines 53065-53081 ---
//
// Refreshes the GHSL layer-status indicator chips. Reads
// state.layersPresent (a Set of layer-name strings); for each
// [data-gh-layer] node in the DOM, toggles textContent + style.color
// between "🟢 loaded" / var(--good) (when layer is present) and
// "⚪ not loaded" / var(--ink-dimmer) (when absent).
//
// Signature unchanged from chat-33 extraction: takes `state` as explicit
// first arg per HANDOFF_BATCH_1 convention.
export function _refreshGhslLayerStatus(state) {
  if (typeof document === 'undefined') return;
  const indicators = document.querySelectorAll('[data-gh-layer]');
  if (!indicators || indicators.length === 0) return;
  indicators.forEach(node => {
    const layerName = node.dataset && node.dataset.ghLayer;
    if (!layerName) return;
    const present = !!(state.layersPresent && state.layersPresent.has(layerName));
    if (present) {
      node.textContent = '🟢 loaded';
      node.style.color = 'var(--good)';
    } else {
      node.textContent = '⚪ not loaded';
      node.style.color = 'var(--ink-dimmer)';
    }
  });
}

// ---------------------------------------------------------------------------
// State-aware public wrapper
// ---------------------------------------------------------------------------

/**
 * Public entry — state-aware wrapper around _refreshGhslLayerStatus.
 *
 * If `state` is passed, sets _pageState as a side effect before
 * delegating (mirrors confirmed_carousel's refreshConfirmedCarousel(state) pattern).
 * If called without args, falls back to _pageState set by mount().
 *
 * Returns the underlying call's return value (currently undefined).
 */
export function refreshGhslLayerStatus(state) {
  if (state) _setActiveState(state);
  const resolved = state || _pageState || {};
  return _refreshGhslLayerStatus(resolved);
}

// ---------------------------------------------------------------------------
// Panel visibility — added 2026-05-15.
// Mirrors local_pca_theta_pi's _refreshThetaPiPanelVisibility: hides the empty-state
// block and reveals the panel slots when the corresponding layers load.
// ---------------------------------------------------------------------------

/**
 * Per-panel show/hide gated on which GHSL layers are present in
 * state.layersPresent. The empty-state block (#ghslEmpty) hides as soon
 * as ANY GHSL layer arrives.
 *
 * @param {Object} state — must carry state.layersPresent (Set<layerName>)
 *                         and state.data when ghsl_panel layer loads.
 */
export function _refreshGhslPanelVisibility(state) {
  if (typeof document === 'undefined') return;
  const has = (name) => !!(state && state.layersPresent && state.layersPresent.has(name));

  const hasPanel       = has('ghsl_panel');
  const hasKStripes    = has('ghsl_kstripes');
  const hasKaryoRuns   = has('ghsl_karyotype_runs');
  const hasD17         = has('ghsl_d17_envelopes');
  const hasCusum       = has('cusum_ghsl');
  const hasAny = hasPanel || hasKStripes || hasKaryoRuns || hasD17 || hasCusum;

  const showHide = (id, visible, displayWhenVisible) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = visible ? (displayWhenVisible || 'block') : 'none';
  };

  // Ctrl bar + the four data-driven panels gate on ghsl_panel (the
  // matrix that all rendering depends on).
  showHide('ghCtrlBar',          hasPanel, 'flex');
  showHide('ghMeanStripPanel',   hasPanel, 'block');
  showHide('ghHeatmapPanel',     hasPanel, 'block');
  showHide('ghLinesPanel',       hasPanel, 'block');
  showHide('ghSampleTablePanel', hasPanel, 'block');

  // Empty-state hides as soon as ANY GHSL layer arrives.
  showHide('ghslEmpty', !hasAny, 'block');
}

export function refreshGhslPanelVisibility(state) {
  if (state) _setActiveState(state);
  return _refreshGhslPanelVisibility(state || _pageState || {});
}

// ---------------------------------------------------------------------------
// Panel renderers — added 2026-05-15.
// Each one is a thin painter over the documented ghsl_panel /
// ghsl_kstripes data shapes (see shared/ghsl_panel.js header). NO
// invented biology — every value drawn comes from
// state.data.ghsl_panel.div_roll[scale][sample][window] or
// state.data.ghsl_kstripes.by_k[K].stripe_per_sample[].
// ---------------------------------------------------------------------------

/** Helper: pick the active scale for rendering. Honours a #ghScaleSelect
 *  user choice if set; otherwise falls back to ghslPanelPrimaryScale. */
function _activeGhslScale(state) {
  const sel = (typeof document !== 'undefined') ? document.getElementById('ghScaleSelect') : null;
  if (sel && sel.value) return sel.value;
  return ghslPanelPrimaryScale(state);
}

/** Helper: HSL palette for K-stripe coloring. K-1 evenly-spaced hues. */
function _stripePalette(K) {
  const out = [];
  for (let i = 0; i < K; i++) {
    const h = (i * 360 / Math.max(1, K)) | 0;
    out.push(`hsl(${h}, 60%, 55%)`);
  }
  return out;
}

/** Helper: per-sample stripe assignment from ghsl_kstripes (or null). */
function _ghslStripes(state, K) {
  const ks = state && state.data && state.data.ghsl_kstripes;
  if (!ks || !ks.by_k) return null;
  const k = String(K || (ks.default_k != null ? ks.default_k : 3));
  const slot = ks.by_k[k];
  if (!slot || !Array.isArray(slot.stripe_per_sample)) return null;
  return { stripe_per_sample: slot.stripe_per_sample, K: parseInt(k, 10) };
}

/** Update the ctrl bar + populate the scale select + render dims labels. */
export function _renderGhslCtrlBar(state) {
  if (typeof document === 'undefined') return;
  const p = ghslPanel(state);
  if (!p) return;
  const chromEl = document.getElementById('ghChromLabel');
  const dimsEl  = document.getElementById('ghDimsLabel');
  const sel     = document.getElementById('ghScaleSelect');
  const ksLbl   = document.getElementById('ghKStripesLabel');
  if (chromEl) {
    const chrom = (state && state.activeChrom) || (p.chrom || '');
    chromEl.textContent = chrom ? `chrom: ${chrom}` : '';
  }
  if (dimsEl) {
    const ns = p.n_samples || (Array.isArray(p.samples) ? p.samples.length : 0);
    const nw = p.n_windows || 0;
    dimsEl.textContent = `${ns} samples × ${nw} windows`;
  }
  if (sel) {
    const scales = ghslPanelScales(state);
    const primary = ghslPanelPrimaryScale(state);
    if (sel.options.length !== scales.length) {
      sel.innerHTML = '';
      for (const s of scales) {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        if (s === primary) opt.selected = true;
        sel.appendChild(opt);
      }
    }
  }
  if (ksLbl) {
    const ks = state && state.data && state.data.ghsl_kstripes;
    if (ks && ks.by_k) {
      const ks_keys = Object.keys(ks.by_k).sort((a, b) => +a - +b);
      ksLbl.textContent = ks_keys.length
        ? `kstripes: K ∈ {${ks_keys.join(', ')}}`
        : 'kstripes: (empty)';
    } else {
      ksLbl.textContent = 'kstripes: not loaded';
    }
  }
}

/** Per-window mean-divergence-across-samples strip. Pure painter over
 *  ghslAggregateRange(state, c, c, scale).mean (collapsed across samples). */
export function _drawGhslMeanStrip(state) {
  if (typeof document === 'undefined') return;
  const cv = document.getElementById('ghMeanStripCanvas');
  if (!cv) return;
  const p = ghslPanel(state);
  if (!p) return;
  const scale = _activeGhslScale(state);
  const M = scale && p.div_roll && p.div_roll[scale];
  if (!M || !p.n_windows) return;

  // Resize backing store to CSS pixel dims for crisp rendering.
  const cssW = cv.clientWidth || 800;
  const cssH = cv.clientHeight || 80;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = Math.floor(cssW * dpr);
  cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Compute per-window mean across samples (only finite values).
  const nw = p.n_windows;
  const ns = M.length;
  const means = new Float32Array(nw);
  let vmin = Infinity, vmax = -Infinity;
  for (let w = 0; w < nw; w++) {
    let sum = 0, n = 0;
    for (let s = 0; s < ns; s++) {
      const row = M[s];
      if (!row) continue;
      const v = row[w];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v; n++;
    }
    const m = n > 0 ? (sum / n) : NaN;
    means[w] = m;
    if (Number.isFinite(m)) {
      if (m < vmin) vmin = m;
      if (m > vmax) vmax = m;
    }
  }

  // Plot as a filled area underneath a line.
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax === vmin) {
    ctx.fillStyle = 'rgba(180,180,180,0.3)';
    ctx.fillText('no finite values at this scale', 8, cssH / 2);
    return;
  }
  const padL = 32, padR = 8, padT = 6, padB = 14;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);
  const xAt = (w) => padL + (w / Math.max(1, nw - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - vmin) / (vmax - vmin)) * plotH;

  // Filled region.
  ctx.fillStyle = 'rgba(80, 140, 220, 0.25)';
  ctx.beginPath();
  ctx.moveTo(xAt(0), padT + plotH);
  for (let w = 0; w < nw; w++) {
    const m = means[w];
    if (!Number.isFinite(m)) continue;
    ctx.lineTo(xAt(w), yAt(m));
  }
  ctx.lineTo(xAt(nw - 1), padT + plotH);
  ctx.closePath();
  ctx.fill();

  // Trace.
  ctx.strokeStyle = '#4f8ad6';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let started = false;
  for (let w = 0; w < nw; w++) {
    const m = means[w];
    if (!Number.isFinite(m)) { started = false; continue; }
    if (!started) { ctx.moveTo(xAt(w), yAt(m)); started = true; }
    else ctx.lineTo(xAt(w), yAt(m));
  }
  ctx.stroke();

  // Y-axis labels.
  ctx.fillStyle = 'rgba(170,170,170,0.9)';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(vmax.toFixed(3), 2, padT);
  ctx.textBaseline = 'bottom';
  ctx.fillText(vmin.toFixed(3), 2, padT + plotH);

  // Legend.
  const legendEl = document.getElementById('ghMeanStripLegend');
  if (legendEl) {
    legendEl.textContent = `scale=${scale} · windows=${nw} · samples=${ns} · range=[${vmin.toFixed(3)}, ${vmax.toFixed(3)}]`;
  }
}

/** Sample × window heatmap of div_roll[scale]. Pure painter — no
 *  reordering or normalization beyond linear value→color mapping. */
export function _drawGhslHeatmap(state) {
  if (typeof document === 'undefined') return;
  const cv = document.getElementById('ghHeatmapCanvas');
  if (!cv) return;
  const p = ghslPanel(state);
  if (!p) return;
  const scale = _activeGhslScale(state);
  const M = scale && p.div_roll && p.div_roll[scale];
  if (!M || !p.n_windows) return;

  const cssW = cv.clientWidth || 1000;
  const cssH = cv.clientHeight || 320;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = Math.floor(cssW * dpr);
  cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const nw = p.n_windows;
  const ns = M.length;
  if (ns === 0 || nw === 0) return;

  // Find global min/max across the matrix (finite only) for normalization.
  let vmin = Infinity, vmax = -Infinity;
  for (let s = 0; s < ns; s++) {
    const row = M[s];
    if (!row) continue;
    for (let w = 0; w < nw; w++) {
      const v = row[w];
      if (v != null && Number.isFinite(v)) {
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax === vmin) {
    ctx.fillStyle = 'rgba(180,180,180,0.5)';
    ctx.font = '11px monospace';
    ctx.fillText('no finite values at this scale', 8, cssH / 2);
    return;
  }

  const padL = 64, padT = 4, padR = 8, padB = 14;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);
  const cellW = plotW / nw;
  const cellH = plotH / ns;

  // ImageData-based fill for performance: build a buffer once and put it.
  const buf = ctx.createImageData(Math.max(1, Math.floor(plotW)), Math.max(1, Math.floor(plotH)));
  const bufW = buf.width;
  const bufH = buf.height;
  for (let py = 0; py < bufH; py++) {
    const s = Math.min(ns - 1, Math.floor(py / cellH));
    const row = M[s];
    if (!row) continue;
    for (let px = 0; px < bufW; px++) {
      const w = Math.min(nw - 1, Math.floor(px / cellW));
      const v = row[w];
      const off = (py * bufW + px) * 4;
      if (v == null || !Number.isFinite(v)) {
        buf.data[off]     = 36;
        buf.data[off + 1] = 36;
        buf.data[off + 2] = 36;
        buf.data[off + 3] = 255;
        continue;
      }
      // Normalize to [0,1] then map cool→warm (low→high).
      const t = (v - vmin) / (vmax - vmin);
      // Simple blue→white→red ramp for divergence.
      const r = Math.floor(255 * Math.max(0, Math.min(1, t * 1.6 - 0.3)));
      const b = Math.floor(255 * Math.max(0, Math.min(1, (1 - t) * 1.6 - 0.3)));
      const g = Math.floor(255 * (1 - Math.abs(t - 0.5) * 1.6));
      buf.data[off]     = r;
      buf.data[off + 1] = Math.max(0, g);
      buf.data[off + 2] = b;
      buf.data[off + 3] = 255;
    }
  }
  ctx.putImageData(buf, padL, padT);

  // Y-axis labels: every k-th sample id (for readability).
  ctx.fillStyle = 'rgba(170,170,170,0.9)';
  ctx.font = '9.5px monospace';
  ctx.textBaseline = 'middle';
  const stride = Math.max(1, Math.floor(ns / 24));
  const samples = Array.isArray(p.samples) ? p.samples : null;
  for (let s = 0; s < ns; s += stride) {
    const yMid = padT + (s + 0.5) * cellH;
    const lbl = samples ? String(samples[s] || s) : String(s);
    ctx.fillText(lbl.slice(-8), 4, yMid);
  }

  // Legend.
  const legendEl = document.getElementById('ghHeatmapLegend');
  if (legendEl) {
    legendEl.textContent = `scale=${scale} · matrix=${ns}×${nw} · color=blue(low)→white→red(high) · range=[${vmin.toFixed(3)}, ${vmax.toFixed(3)}]`;
  }
}

/** Per-sample line traces across windows. Coloured by ghsl_kstripes
 *  per-sample assignment when available; otherwise a single muted hue. */
export function _drawGhslLines(state) {
  if (typeof document === 'undefined') return;
  const cv = document.getElementById('ghLinesCanvas');
  if (!cv) return;
  const p = ghslPanel(state);
  if (!p) return;
  const scale = _activeGhslScale(state);
  const M = scale && p.div_roll && p.div_roll[scale];
  if (!M || !p.n_windows) return;

  const cssW = cv.clientWidth || 1000;
  const cssH = cv.clientHeight || 240;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  cv.width = Math.floor(cssW * dpr);
  cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const nw = p.n_windows;
  const ns = M.length;
  if (ns === 0 || nw === 0) return;

  // Find global min/max for the y-axis.
  let vmin = Infinity, vmax = -Infinity;
  for (let s = 0; s < ns; s++) {
    const row = M[s];
    if (!row) continue;
    for (let w = 0; w < nw; w++) {
      const v = row[w];
      if (v != null && Number.isFinite(v)) {
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
  }
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax === vmin) {
    ctx.fillStyle = 'rgba(180,180,180,0.5)';
    ctx.font = '11px monospace';
    ctx.fillText('no finite values at this scale', 8, cssH / 2);
    return;
  }

  const padL = 32, padT = 8, padR = 8, padB = 14;
  const plotW = Math.max(1, cssW - padL - padR);
  const plotH = Math.max(1, cssH - padT - padB);
  const xAt = (w) => padL + (w / Math.max(1, nw - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - vmin) / (vmax - vmin)) * plotH;

  // Stripe coloring (use K=3 by default; falls back to muted when
  // ghsl_kstripes layer is absent).
  const stripes = _ghslStripes(state, 3);
  const palette = stripes ? _stripePalette(stripes.K) : null;
  const noteEl = document.getElementById('ghLinesColorNote');
  if (noteEl) {
    noteEl.textContent = stripes
      ? `coloured by ghsl_kstripes K=${stripes.K} stripe assignment`
      : 'ghsl_kstripes layer not loaded — single-hue rendering';
  }

  // Draw per-sample traces.
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.55;
  for (let s = 0; s < ns; s++) {
    const row = M[s];
    if (!row) continue;
    let stripeIdx = -1;
    if (stripes) {
      const v = stripes.stripe_per_sample[s];
      if (Number.isInteger(v) && v >= 0) stripeIdx = v;
    }
    ctx.strokeStyle = (palette && stripeIdx >= 0)
      ? palette[stripeIdx % palette.length]
      : 'rgba(120, 150, 200, 0.7)';
    ctx.beginPath();
    let started = false;
    for (let w = 0; w < nw; w++) {
      const v = row[w];
      if (v == null || !Number.isFinite(v)) { started = false; continue; }
      const x = xAt(w), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // Y-axis labels.
  ctx.fillStyle = 'rgba(170,170,170,0.9)';
  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(vmax.toFixed(3), 2, padT);
  ctx.textBaseline = 'bottom';
  ctx.fillText(vmin.toFixed(3), 2, padT + plotH);
}

/** Per-sample summary table at the active scale. Uses
 *  ghslAggregateRange across the full window range. */
export function _renderGhslSampleTable(state) {
  if (typeof document === 'undefined') return;
  const slot = document.getElementById('ghSampleTableSlot');
  if (!slot) return;
  const p = ghslPanel(state);
  if (!p || !p.n_windows) {
    slot.innerHTML = '<div style="padding:12px;color:var(--ink-dim);">no ghsl_panel loaded</div>';
    return;
  }
  const scale = _activeGhslScale(state);
  const agg = ghslAggregateRange(state, 0, p.n_windows - 1, scale);
  if (!agg) {
    slot.innerHTML = `<div style="padding:12px;color:var(--ink-dim);">no values at scale ${scale}</div>`;
    return;
  }
  const rows = [];
  rows.push(
    '<table style="width:100%;border-collapse:collapse;">' +
    '<thead><tr style="background:var(--panel-2);">' +
    '<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--rule);">sample</th>' +
    '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--rule);">mean</th>' +
    '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--rule);">median</th>' +
    '<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--rule);">n_finite</th>' +
    '</tr></thead><tbody>'
  );
  const samples = agg.samples;
  const nFmt = (v) => (v == null || !Number.isFinite(v)) ? '—' : v.toFixed(4);
  for (let i = 0; i < samples.length; i++) {
    const sid = samples[i];
    const escSid = String(sid).replace(/[<>&"']/g, (c) =>
      ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&#39;' }[c]));
    rows.push(
      `<tr><td style="padding:3px 8px;border-bottom:1px solid var(--rule);">${escSid}</td>` +
      `<td style="text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule);">${nFmt(agg.mean[i])}</td>` +
      `<td style="text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule);">${nFmt(agg.median[i])}</td>` +
      `<td style="text-align:right;padding:3px 8px;border-bottom:1px solid var(--rule);">${agg.n[i]}</td></tr>`
    );
  }
  rows.push('</tbody></table>');
  slot.innerHTML = rows.join('');
}

/** Public render entry — calls all four panels in order, gated on
 *  ghsl_panel layer presence. Cheap to call repeatedly (each renderer
 *  is idempotent: clears its canvas, paints fresh). */
export function renderGhslPanels(state) {
  if (state) _setActiveState(state);
  const s = state || _pageState;
  if (!s || !ghslPanel(s)) return;
  try { _renderGhslCtrlBar(s); } catch (e) { console.warn('local_pca_ghsl ctrlBar:', e); }
  try { _drawGhslMeanStrip(s); } catch (e) { console.warn('local_pca_ghsl meanStrip:', e); }
  try { _drawGhslHeatmap(s); }   catch (e) { console.warn('local_pca_ghsl heatmap:', e); }
  try { _drawGhslLines(s); }     catch (e) { console.warn('local_pca_ghsl lines:', e); }
  try { _renderGhslSampleTable(s); } catch (e) { console.warn('local_pca_ghsl sampleTable:', e); }
}

// ---------------------------------------------------------------------------
// Atlas-router lifecycle (chat 38 round 5 step 15, 2026-05-07).
// ---------------------------------------------------------------------------

/**
 * Mount: called by atlas_router when the user navigates to local_pca_ghsl.
 *
 * Builds a legacy-shape state with the slots the chat-33 helper needs
 * (layersPresent — a Set of GHSL layer names; activeChrom for any
 * future chrom-aware rendering). Calls refreshGhslLayerStatus to
 * populate the five [data-gh-layer] indicator chips at mount time.
 */
export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);

  try { refreshGhslLayerStatus(legacyState); }
  catch (e) { console.warn('local_pca_ghsl.mount: refreshGhslLayerStatus threw —', e); }

  // 2026-05-15: wire panel-visibility + render any panels whose layers
  // are present at mount time. When ghsl_panel is absent, the empty-state
  // stays visible and the panel slots stay hidden — same pattern as local_pca_theta_pi.
  try { refreshGhslPanelVisibility(legacyState); }
  catch (e) { console.warn('local_pca_ghsl.mount: refreshGhslPanelVisibility threw —', e); }

  try { renderGhslPanels(legacyState); }
  catch (e) { console.warn('local_pca_ghsl.mount: renderGhslPanels threw —', e); }

  // Wire the scale-select to re-render every panel on change.
  if (typeof document !== 'undefined') {
    const sel = document.getElementById('ghScaleSelect');
    if (sel && !sel.__page15Wired) {
      sel.addEventListener('change', () => {
        try { renderGhslPanels(legacyState); }
        catch (e) { console.warn('local_pca_ghsl scaleSelect change:', e); }
      });
      sel.__page15Wired = true;
    }
  }

  if (atlasState.inversion) atlasState.inversion._page15State = legacyState;
}

/**
 * Unmount: clear _pageState so post-unmount callbacks see null.
 */
export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const inv = atlasState.inversion || {};
  const legacy = Object.assign({}, inv);
  // layersPresent: Set<layerName> — read by _refreshGhslLayerStatus.
  // Default to an empty Set so the chat-33 helper's `.has(layerName)`
  // call doesn't blow up on an undefined slot.
  legacy.layersPresent = inv.layersPresent || new Set();
  legacy.activeChrom   = inv.activeChrom   || null;
  return legacy;
}
