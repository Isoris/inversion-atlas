// pages/evolution/polarize_msa_stacked/renderer.js
// =====================================================================
// Thin adapter: feeds the row-stack from builder.js into the existing
// dosage-heatmap painter, plus paints a tier-confidence stripe across
// the top.
// =====================================================================

// 2026-05-23 Phase 2: polarize_msa_stacked moved from inversion-atlas to
// evolution-atlas. dosage_heatmap stays in inversion (page-1 discovery
// infrastructure). Cross-atlas relative path from depth
// atlases/evolution/pages/evolution/polarize_msa_stacked/ →
// atlases/inversion/pages/discovery/dosage_heatmap/.
// Phase 1d / Phase 5 task: switch to cross_atlas_imports.resolveCrossAtlasRead()
// once atlas-core ships the proposal package (docs/atlas-core-proposals/).
import { paintDosageHeatmap, findCellAtPixel }
  from '../../../../inversion/pages/discovery/dosage_heatmap/renderer.js';

// Re-export the dosage-heatmap painter so the cartridge's import
// graph stays explicit about the canonical-adapter reuse:
//   {n_samples, n_markers, cellValue(m, s)}
// where each "sample" is one row in our row-stack.
export { paintDosageHeatmap, findCellAtPixel };

// =====================================================================
// Tier-stripe painter (independent of the cell painter)
// =====================================================================

const TIER_COLOR = Object.freeze({
  4: '#1f5723',  // high       — dark green
  3: '#3aa14a',  // medium     — green
  2: '#cfa12a',  // low        — yellow
  1: '#c66b1d',  // ambiguous  — orange
  0: '#888888',  // suspicious — grey
});

/**
 * Paint a one-cell-tall confidence stripe along the top of the
 * canvas (just inside the matrix x-extent so columns line up).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Int8Array|null} tier_mask    per-site tier (0..4)
 * @param {Object} layout               from paintDosageHeatmap
 * @returns {void}
 */
export function paintTierStripe(canvas, tier_mask, layout) {
  if (!canvas || !canvas.getContext || !tier_mask || !layout) return;
  const ctx = canvas.getContext('2d');
  const n = tier_mask.length;
  if (n === 0 || !(layout.cellW > 0)) return;
  // Stripe sits 3px above the matrix.
  const stripeH = 5;
  const y = Math.max(0, layout.matY - stripeH - 2);
  for (let mi = 0; mi < n && mi < layout.n_displayed_markers; mi++) {
    const tier = tier_mask[layout.marker_order ? layout.marker_order[mi] : mi];
    ctx.fillStyle = TIER_COLOR[tier] || TIER_COLOR[0];
    if (typeof ctx.fillRect === 'function') {
      ctx.fillRect(layout.matX + mi * layout.cellW, y, layout.cellW + 0.5, stripeH);
    }
  }
}

/**
 * Map a row's tag to a row-track colour. Matches the legend
 * rendered in the right panel.
 */
export function rowTagColor(tag) {
  switch (tag) {
    case 'outgroup':    return '#705090';
    case 'inv_founder': return '#D04545';
    case 'inv_group':   return '#3074C8';
    case 'std':         return '#2BAA50';
    default:            return '#888888';
  }
}

/**
 * Map a tier numeric back to a label string for the right panel.
 */
export function tierLabel(t) {
  if (t === 4) return 'high';
  if (t === 3) return 'medium';
  if (t === 2) return 'low';
  if (t === 1) return 'ambiguous';
  return 'suspicious';
}
