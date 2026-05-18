// pages/discovery/tree_panel/renderer.js
// =====================================================================
// Canvas-based renderer for the sample tree. Takes a tree produced
// by shared/mgl_nj_tree.buildNjTree (or anything that round-trips
// through Newick + shared/newick_tree_layout.computeRectangularLayout)
// and paints it onto the supplied canvas.
//
// Pure DOM helpers + a layout-builder wrapper. No state mutation.
// =====================================================================

import { toNewickString } from '../../../shared/mgl_nj_tree.js';
import {
  parseNewick,
  computeRectangularLayout,
} from '../../../shared/newick_tree_layout.js';

// =====================================================================
// 1. Layout
// =====================================================================

/**
 * Build a rendering layout from an mgl_nj_tree output. Goes through
 * Newick (round-trip is cheap and exercises the existing layout
 * machinery without inventing a parallel one).
 *
 * @param {Object} mglTree   output of mgl_nj_tree.buildNjTree
 * @param {Object} [opts]    forwarded to computeRectangularLayout
 *                            (cladogram, scaleX, scaleY)
 * @returns {Object|null}
 */
export function layoutFromMglTree(mglTree, opts) {
  if (!mglTree || !Array.isArray(mglTree.nodes) || mglTree.nodes.length === 0) return null;
  const newick = toNewickString(mglTree);
  const parsed = parseNewick(newick);
  if (!parsed) return null;
  return computeRectangularLayout(parsed, opts);
}

// =====================================================================
// 2. Canvas painter
// =====================================================================

/**
 * Paint the tree onto the canvas. Leaves are drawn at the right
 * edge (after the deepest internal node); branches are L-shaped
 * polylines.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} layout     output of layoutFromMglTree
 * @param {Object} [opts]
 *   leaf_colors_by_id?: Object<string, string>
 *   highlighted_leaf_id?: string|null      hover/selected highlight
 *   stroke?: string
 *   leaf_radius?: number
 *   font_size?: number
 *   show_labels?: boolean
 * @returns {{leaf_hit_regions: Array<{leaf_id:string, x:number, y:number, r:number}>}}
 */
export function paintTree(canvas, layout, opts) {
  const o = opts || {};
  if (!canvas || !canvas.getContext) return { leaf_hit_regions: [] };
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 1000;
  const H = canvas.height || 400;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!layout || layout.nodes.length === 0) return { leaf_hit_regions: [] };

  // Scale the layout coords into canvas space. Layout x is cumulative
  // branch length / hop depth; layout y is leaf rank. Pad the right
  // side so labels fit.
  const labelPad = (o.show_labels !== false) ? 120 : 8;
  const xPad = 8;
  const yPad = 8;
  const drawW = Math.max(50, W - labelPad - xPad);
  const drawH = Math.max(50, H - 2 * yPad);
  const maxX = layout.maxX || 1;
  const nLeaves = Math.max(1, layout.nLeaves);
  const sx = drawW / maxX;
  const sy = drawH / (nLeaves - 1 || 1);

  // Edges (L-shaped: horizontal + vertical at parent_x).
  ctx.strokeStyle = o.stroke || 'rgba(40, 50, 70, 0.85)';
  ctx.lineWidth = 1;
  if (typeof ctx.beginPath === 'function') {
    for (const e of layout.edges) {
      const x1 = xPad + e.x1 * sx;
      const y1 = yPad + e.y1 * sy;
      const x2 = xPad + e.x2 * sx;
      const y2 = yPad + e.y2 * sy;
      // Horizontal segment at the child's y from parent_x to child_x.
      ctx.beginPath();
      ctx.moveTo(x1, y2);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Vertical segment at the parent's x from parent_y to child_y.
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, y2);
      ctx.stroke();
    }
  }

  // Leaves: dots + labels at their x/y.
  const hitRegions = [];
  const colors = o.leaf_colors_by_id || {};
  const r = Number.isFinite(o.leaf_radius) ? o.leaf_radius : 3;
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  ctx.font = fontSize + 'px sans-serif';
  for (const lf of layout.leaves) {
    const x = xPad + lf.x * sx;
    const y = yPad + lf.y * sy;
    const fill = colors[lf.id] || 'rgba(60, 80, 100, 0.85)';
    ctx.fillStyle = fill;
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath();
      const isHL = lf.id === o.highlighted_leaf_id;
      ctx.arc(x, y, isHL ? r + 2 : r, 0, Math.PI * 2);
      if (typeof ctx.fill === 'function') ctx.fill();
      if (isHL) {
        ctx.strokeStyle = '#f5a524';
        ctx.lineWidth = 2;
        if (typeof ctx.stroke === 'function') ctx.stroke();
        ctx.strokeStyle = o.stroke || 'rgba(40, 50, 70, 0.85)';
        ctx.lineWidth = 1;
      }
    }
    if (o.show_labels !== false && typeof ctx.fillText === 'function') {
      ctx.fillStyle = 'rgba(40, 50, 70, 0.85)';
      ctx.fillText(String(lf.id), x + 6, y + fontSize / 3);
    }
    hitRegions.push({ leaf_id: String(lf.id), x, y, r: r + 4 });
  }

  return { leaf_hit_regions: hitRegions };
}

// =====================================================================
// 3. Hit testing
// =====================================================================

/**
 * Find the leaf under a canvas pixel (or null when none).
 *
 * @param {Array<{leaf_id:string, x:number, y:number, r:number}>} hitRegions
 * @param {number} x   canvas-relative
 * @param {number} y
 * @returns {string|null}
 */
export function findLeafAtPixel(hitRegions, x, y) {
  if (!Array.isArray(hitRegions)) return null;
  for (const h of hitRegions) {
    const dx = x - h.x, dy = y - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h.leaf_id;
  }
  return null;
}
