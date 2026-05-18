// pages/review/fish_ancestry_scroller/layers.js
// =====================================================================
// Renderers for the three numbered layers + brick-metrics block of the
// Fish Ancestry Scroller (SPEC_fish_ancestry_scroller.md §"UI layout v2").
//
//   ① Layer 1 — PC1 Band / Regime (per fish)
//   ② Layer 2 — Ancestry Bricks (per fish)
//   Brick metrics — five horizontal heatmap rows
//   ③ Layer 3 — Brick summary (cohort view: majority + agreement)
//
// Cross-layer alignment guarantee (spec §"Cross-layer alignment
// guarantees"): all per-fish layers share identical fish-row ordering
// and identical RF-window-column ordering. Layers 1, 2, and the five
// metrics rows render off the same `model.fish_rows` and
// `model.window_grid`; Layer 3 aggregates over the same window grid.
//
// Pure DOM: no fetch, no global mutation. Each renderer takes a
// canvas + the model + view state and paints.
// =====================================================================

// ---------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------

/** Spec §Layer 1 legend. */
export const PC1_BAND_COLORS = Object.freeze({
  band1: '#3b82c4',   // blue — Std Hom
  band2: '#e8a13a',   // amber — Het
  band3: '#c44a3b',   // red — Inv Hom
  mixed: '#9aa3ad',   // grey — Mixed / Uncertain
});

/** Spec §Layer 2 legend (K = up to 6 in defaults; only K1..K3 shown
 *  by name in the spec, the rest extend the palette deterministically). */
export const ANCESTRY_K_COLORS = Object.freeze([
  '#3b82c4',   // K1 — blue
  '#e8a13a',   // K2 — orange
  '#3aa8a0',   // K3 — teal
  '#a368c4',   // K4 — purple
  '#7aa83a',   // K5 — olive
  '#c43a86',   // K6 — magenta
]);

/** Spec §Brick metrics row: dosage concordance categorical colours. */
export const DOSAGE_CONCORDANCE_COLORS = Object.freeze({
  concordant: '#4aa84a',
  partial:    '#e8a13a',
  discordant: '#c44a3b',
});

/** Sentinel grey for ambiguous / null cells. */
export const AMBIGUOUS_COLOR = '#9aa3ad';

// ---------------------------------------------------------------------
// Layer 1 — PC1 Band / Regime
// ---------------------------------------------------------------------

/**
 * Paint Layer 1 — one row per fish, one column per RF window, colour =
 * PC1 band membership.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{fish_rows:Array, window_grid:Array, pc1_band:Object}} model
 *   - `fish_rows`: array of fish IDs in display order
 *   - `window_grid`: array of {idx, start_bp, end_bp}
 *   - `pc1_band`: {fish_id -> Array<'band1'|'band2'|'band3'|'mixed'|null>}
 *                 (one entry per window column, in window_grid order)
 */
export function paintLayer1(canvas, model) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const fishRows = (model && model.fish_rows) || [];
  const windows = (model && model.window_grid) || [];
  const pc1 = (model && model.pc1_band) || {};
  const W = canvas.width || 1000;
  const H = canvas.height || Math.max(1, fishRows.length * 14);
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (fishRows.length === 0 || windows.length === 0) return;
  const colW = W / windows.length;
  const rowH = H / fishRows.length;
  for (let r = 0; r < fishRows.length; r++) {
    const row = pc1[fishRows[r]] || [];
    for (let c = 0; c < windows.length; c++) {
      const band = row[c];
      ctx.fillStyle = PC1_BAND_COLORS[band] || AMBIGUOUS_COLOR;
      ctx.fillRect(c * colW, r * rowH, Math.ceil(colW), Math.ceil(rowH));
    }
  }
}

// ---------------------------------------------------------------------
// Layer 2 — Ancestry Bricks
// ---------------------------------------------------------------------

/**
 * Paint Layer 2 — per-fish merged-brick segments, colour driven by the
 * current view mode (default: dominant K).
 *
 * `model.bricks` shape: { fish_id -> Array<brick> } where each brick is
 *   { start_idx, end_idx, dominant_k, mean_delta_q, het_z, mean_entropy,
 *     alignment_confidence, dosage_concordance, flags: Array<string> }
 *
 * `viewState`:
 *   { view_mode: 'ancestry_k'|'delta_q'|'het_z'|'entropy'|'confidence'|'discordance',
 *     show_brick_borders: bool, show_warnings: bool }
 */
export function paintLayer2(canvas, model, viewState) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const fishRows = (model && model.fish_rows) || [];
  const windows  = (model && model.window_grid) || [];
  const bricks   = (model && model.bricks) || {};
  const view     = viewState || {};
  const mode     = view.view_mode || 'ancestry_k';
  const W = canvas.width || 1000;
  const H = canvas.height || Math.max(1, fishRows.length * 14);
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (fishRows.length === 0 || windows.length === 0) return;
  const colW = W / windows.length;
  const rowH = H / fishRows.length;
  for (let r = 0; r < fishRows.length; r++) {
    const rowBricks = bricks[fishRows[r]] || [];
    for (const b of rowBricks) {
      const x0 = b.start_idx * colW;
      const x1 = (b.end_idx + 1) * colW;
      ctx.fillStyle = brickFillForMode(b, mode);
      ctx.fillRect(x0, r * rowH, Math.max(1, x1 - x0), Math.ceil(rowH));
      if (view.show_brick_borders !== false) {
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 0.5;
        if (typeof ctx.strokeRect === 'function') {
          ctx.strokeRect(x0, r * rowH, Math.max(1, x1 - x0), rowH);
        }
      }
    }
  }
}

/** Spec §"View mode (brick color)" — map a brick to its fill colour. */
export function brickFillForMode(brick, mode) {
  if (!brick) return AMBIGUOUS_COLOR;
  switch (mode) {
    case 'ancestry_k': {
      const k = Number.isFinite(brick.dominant_k) ? brick.dominant_k : -1;
      return (k >= 0 && k < ANCESTRY_K_COLORS.length)
        ? ANCESTRY_K_COLORS[k]
        : AMBIGUOUS_COLOR;
    }
    case 'delta_q':    return sequentialFill(brick.mean_delta_q,         0, 1, '#fff', '#3b1e6b');
    case 'het_z':      return divergingFill(brick.het_z,                -2, 2, '#c44a3b', '#eef0f3', '#4aa84a');
    case 'entropy':    return sequentialFill(brick.mean_entropy,         0, 1, '#fff', '#e8a13a');
    case 'confidence': return sequentialFill(brick.alignment_confidence, 0, 1, '#fff', '#4aa84a');
    case 'discordance': {
      const flags = brick.flags || [];
      if (flags.includes('REGIME_DISCORDANT'))  return '#c44a3b';
      if (flags.includes('DOSAGE_DISCORDANT'))  return '#e8a13a';
      return AMBIGUOUS_COLOR;
    }
    default:
      return AMBIGUOUS_COLOR;
  }
}

function clamp01(x) {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

function sequentialFill(v, lo, hi, cLow, cHigh) {
  if (!Number.isFinite(v)) return AMBIGUOUS_COLOR;
  const t = clamp01((v - lo) / (hi - lo));
  return lerpHex(cLow, cHigh, t);
}

function divergingFill(v, lo, hi, cLow, cMid, cHigh) {
  if (!Number.isFinite(v)) return AMBIGUOUS_COLOR;
  if (v < 0) {
    const t = clamp01(v / lo);   // lo is negative
    return lerpHex(cMid, cLow, t);
  }
  const t = clamp01(v / hi);
  return lerpHex(cMid, cHigh, t);
}

function lerpHex(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bC = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bC})`;
}

function hexToRgb(h) {
  if (h.startsWith('rgb')) {
    const m = h.match(/(\d+)/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

// ---------------------------------------------------------------------
// Brick metrics — 5-row heatmap
// ---------------------------------------------------------------------

/** Spec §"Brick metrics — five stacked heatmap rows". */
export const METRIC_ROWS = Object.freeze([
  { key: 'mean_delta_q',         label: 'ΔQ (mean abs)',     mode: 'delta_q' },
  { key: 'het_z',                label: 'Het. z-score',      mode: 'het_z' },
  { key: 'mean_entropy',         label: 'Entropy',           mode: 'entropy' },
  { key: 'alignment_confidence', label: 'Confidence',        mode: 'confidence' },
  { key: 'dosage_concordance',   label: 'Dosage concordance', mode: 'categorical' },
]);

/**
 * Paint the metrics block — same fish-row × window-column grid as
 * Layer 2, repeated five times (one row per metric). Each metric row
 * sits in its own horizontal band of the canvas.
 *
 * For categorical metrics (dosage concordance), cells are coloured by
 * the categorical map; for sequential metrics, cells use the same
 * sequential / diverging gradients as `brickFillForMode`.
 */
export function paintMetrics(canvas, model) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const fishRows = (model && model.fish_rows) || [];
  const windows  = (model && model.window_grid) || [];
  const bricks   = (model && model.bricks) || {};
  const W = canvas.width || 1000;
  const H = canvas.height || (METRIC_ROWS.length * 30);
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (windows.length === 0) return;
  const rowH = H / METRIC_ROWS.length;
  const colW = W / windows.length;
  // For each metric row we collapse over fish: cohort-mean per window
  // (categorical: majority category).
  for (let m = 0; m < METRIC_ROWS.length; m++) {
    const metric = METRIC_ROWS[m];
    for (let c = 0; c < windows.length; c++) {
      const cellColor = cellColorForMetric(
        metric, c, fishRows, bricks,
      );
      ctx.fillStyle = cellColor;
      ctx.fillRect(c * colW, m * rowH, Math.ceil(colW), Math.ceil(rowH));
    }
  }
}

function cellColorForMetric(metric, c, fishRows, bricks) {
  if (metric.mode === 'categorical') {
    let counts = { concordant: 0, partial: 0, discordant: 0 };
    let n = 0;
    for (const f of fishRows) {
      const b = brickAtWindow(bricks[f] || [], c);
      if (!b) continue;
      const dc = b.dosage_concordance;
      if (dc in counts) { counts[dc]++; n++; }
    }
    if (n === 0) return AMBIGUOUS_COLOR;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return DOSAGE_CONCORDANCE_COLORS[top[0]] || AMBIGUOUS_COLOR;
  }
  let sum = 0, n = 0;
  for (const f of fishRows) {
    const b = brickAtWindow(bricks[f] || [], c);
    if (!b) continue;
    const v = b[metric.key];
    if (Number.isFinite(v)) { sum += v; n++; }
  }
  if (n === 0) return AMBIGUOUS_COLOR;
  return brickFillForMode({ [metric.key]: sum / n, dominant_k: 0 }, metric.mode);
}

function brickAtWindow(bricks, c) {
  for (const b of bricks) {
    if (b.start_idx <= c && c <= b.end_idx) return b;
  }
  return null;
}

// ---------------------------------------------------------------------
// Layer 3 — Brick summary (cohort)
// ---------------------------------------------------------------------

/**
 * Compute cohort-level majority-K + fraction-agreement per window.
 *
 * Spec formulas (§Track 3a, §Track 3b):
 *   majority_K[w]         = argmax_K Σ_fish 1(brick_dominant_K[fish, w] == K)
 *   fraction_agreement[w] = (1/N) · Σ_fish 1(brick_dominant_K[fish, w] == majority_K[w])
 *
 * Returns:
 *   { majority: Array<int|null>, agreement: Array<number> }
 */
export function computeBrickSummary(model) {
  const fishRows = (model && model.fish_rows) || [];
  const windows  = (model && model.window_grid) || [];
  const bricks   = (model && model.bricks) || {};
  const majority  = new Array(windows.length);
  const agreement = new Array(windows.length).fill(0);
  for (let c = 0; c < windows.length; c++) {
    const counts = Object.create(null);
    let n = 0;
    for (const f of fishRows) {
      const b = brickAtWindow(bricks[f] || [], c);
      if (!b || !Number.isFinite(b.dominant_k)) continue;
      counts[b.dominant_k] = (counts[b.dominant_k] || 0) + 1;
      n++;
    }
    if (n === 0) { majority[c] = null; agreement[c] = 0; continue; }
    let bestK = null, bestN = -1;
    for (const [k, v] of Object.entries(counts)) {
      if (v > bestN) { bestN = v; bestK = Number(k); }
    }
    majority[c]  = bestK;
    agreement[c] = bestN / n;
  }
  return { majority, agreement };
}

/**
 * Paint Layer 3 — Track 3a (majority ancestry, horizontal bar) above
 * Track 3b (fraction agreement, area chart 0..1).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} model
 */
export function paintLayer3(canvas, model) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const windows = (model && model.window_grid) || [];
  const W = canvas.width || 1000;
  const H = canvas.height || 80;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (windows.length === 0) return;
  const summary = computeBrickSummary(model);
  const colW = W / windows.length;
  const trackAH = H * 0.35;
  const trackBH = H * 0.65;
  // Track 3a — majority bar.
  for (let c = 0; c < windows.length; c++) {
    const k = summary.majority[c];
    ctx.fillStyle = (k != null && k >= 0 && k < ANCESTRY_K_COLORS.length)
      ? ANCESTRY_K_COLORS[k]
      : AMBIGUOUS_COLOR;
    ctx.fillRect(c * colW, 0, Math.ceil(colW), trackAH);
  }
  // Track 3b — agreement area (grey-to-black gradient by height).
  for (let c = 0; c < windows.length; c++) {
    const a = summary.agreement[c];
    const barH = trackBH * a;
    ctx.fillStyle = `rgba(40,40,40,${0.25 + 0.6 * a})`;
    ctx.fillRect(c * colW, trackAH + (trackBH - barH), Math.ceil(colW), barH);
  }
}
