// pages/classification/candidate_regimes/_summary_palette.js
// CSS-ready palette for the regime-call ribbon in the summary panel.
// Kept in sync with REGIME_CALL_COLORS in dosage_heatmap/renderer.js
// and the controlled SAMPLE_REGIME_CALLS vocabulary in
// shared/mgl_regime_consistency.js.

export const REGIME_CALL_COLORS_CSS = Object.freeze({
  homA_like: '#3074C8',
  het_like:  '#9344B5',
  homB_like: '#D04545',
  uncertain: '#7a8290',
});

/** Re-export rowsToTsv so the panel module can keep its imports flat. */
export { rowsToTsv } from '../../../shared/mgl_regime_consistency.js';
