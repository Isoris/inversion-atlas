// atlases/inversion/shared/color_helpers.js
//
// Color palettes for the sim_mat heatmap and the diverging Z panel.
// Pure functions — no state dependency, no DOM dependency, no theme
// dependency. Hoisted from legacy/Inversion_atlas.html during page1
// migration round 3 (2026-05-06) so page1 and page12 share a single
// source of truth (page12 line 613 references the same `simColor`).
//
// Origin notes:
//   simColor       — legacy lines 31256-31263. Single-channel viridis-ish
//                    ramp used when pdfStyle == false.
//   simColorPDF    — legacy lines 31281-31294. Five-stop piecewise-linear
//                    gradient matching the STEP_D17c overlay's lower
//                    triangle palette. Quantile breakpoints (q_lo, q_hi)
//                    are passed in by the caller from the active scale.
//   zColorPDF      — legacy lines 31299-31307. Diverging blue/white/red
//                    matching scale_fill_gradient2 in the L2 overlay.
//
// Helper internals (`hex`, `lerpRGB`, `SIM_PDF_COLORS`, `Z_LOW`,
// `Z_MID`, `Z_HIGH`) are kept module-private. If a future caller needs
// `hex` or `lerpRGB` standalone, export them then; not yet.
//
// Return contract:
//   All three functions return [r, g, b] integer arrays in [0, 255].
//   Callers do `const [r, g, b] = simColor(v); ctx.fillStyle = ...`.

// ---------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------

// Hex string -> [r, g, b]. Legacy line 31267.
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

// Linear interpolation between two RGB triples. Legacy line 31270.
function lerpRGB(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Five-stop palette for simColorPDF. Legacy line 31280.
const SIM_PDF_COLORS = ['#F8F8F8', '#A8DBC2', '#F2DC78', '#E08838', '#7E1F1F'].map(hex);

// Diverging blue/white/red endpoints for zColorPDF. Legacy lines 31296-31298.
const Z_LOW  = hex('#2C5AA0');
const Z_MID  = hex('#FAFAFA');
const Z_HIGH = hex('#B22222');

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

// Legacy: function simColor(v) — lines 31256-31263.
// Single-channel viridis-ish ramp. Input v is clamped to [0, 1].
export function simColor(v) {
  v = Math.max(0, Math.min(1, v));
  if (v < 0.5) {
    const t = v / 0.5;
    return [Math.round(30 + t * 40), Math.round(50 + t * 70), Math.round(120 + t * 100)];
  }
  const t = (v - 0.5) / 0.5;
  return [Math.round(70 + t * 185), Math.round(120 + t * 100), Math.round(220 - t * 180)];
}

// Legacy: function simColorPDF(v, q_lo, q_hi) — lines 31281-31294.
// Piecewise-linear gradient on values [0..1] with breakpoints at:
//   v0 = 0, v1 = q_lo, v2 = (q_lo+q_hi)/2, v3 = q_hi, v4 = 1
//   c0..c4 = "#F8F8F8", "#A8DBC2", "#F2DC78", "#E08838", "#7E1F1F"
export function simColorPDF(v, q_lo, q_hi) {
  if (v < 0) v = 0; else if (v > 1) v = 1;
  const v2 = (q_lo + q_hi) / 2;
  const breaks = [0, q_lo, v2, q_hi, 1];
  // Find the segment
  for (let i = 0; i < 4; i++) {
    if (v <= breaks[i + 1]) {
      const span = breaks[i + 1] - breaks[i];
      const t = span > 1e-9 ? (v - breaks[i]) / span : 0;
      return lerpRGB(SIM_PDF_COLORS[i], SIM_PDF_COLORS[i + 1], t);
    }
  }
  return SIM_PDF_COLORS[4];
}

// Legacy: function zColorPDF(z, z_max) — lines 31299-31307.
// Diverging blue/white/red palette. Non-finite z returns mid-grey
// (matches legacy fallback for NaN cells).
export function zColorPDF(z, z_max) {
  if (!isFinite(z)) return [200, 200, 200];
  if (z_max < 1e-6) z_max = 1;
  // Squish into [-z_max, +z_max]
  if (z < -z_max) z = -z_max; else if (z > z_max) z = z_max;
  const t = (z + z_max) / (2 * z_max);  // 0..1
  if (t <= 0.5) return lerpRGB(Z_LOW, Z_MID, t * 2);
  return lerpRGB(Z_MID, Z_HIGH, (t - 0.5) * 2);
}
