// pages/evolution/page_evolution_haplotype_network/renderer.js
// =====================================================================
// Canvas painter for the INV haplotype network. Nodes (circles)
// sized by chromosome count and coloured by an optional subgroup
// assignment (defaults to a discrete palette indexed by node id);
// edges (lines) connecting MST neighbours with thickness inversely
// proportional to inter-cluster distance.
//
// Pure draw + hit-test. No state mutation.
// =====================================================================

const NODE_PALETTE = Object.freeze([
  '#3074C8', '#2BAA50', '#D04545',
  '#A060B8', '#D8A030', '#3DB5C0',
  '#C06080', '#60A030', '#705090', '#888888',
]);

const NODE_BASE_RADIUS = 5;
const NODE_AREA_SCALE  = 18;   // radius² ∝ size * AREA_SCALE

/**
 * Paint nodes + edges from a haplotype-network object onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} network         buildHaplotypeNetwork output
 * @param {Object} [opts]
 *   hovered_node?:  number|null
 *   selected_nodes?: Set<number>
 *   show_labels?:    boolean
 *   color_for_node?: (node_id:number) => string
 *   font_size?:      number
 * @returns {{
 *   node_hit_regions: Array<{node_id:number, x:number, y:number, r:number}>,
 *   plot:{x:number, y:number, w:number, h:number},
 * }}
 */
export function paintHaplotypeNetwork(canvas, network, opts) {
  const o = opts || {};
  if (!canvas || typeof canvas.getContext !== 'function') {
    return { node_hit_regions: [], plot: null };
  }
  const ctx = canvas.getContext('2d');
  const W = canvas.width || 800;
  const H = canvas.height || 400;
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, W, H);
  if (!network || !Array.isArray(network.nodes) || network.nodes.length === 0) {
    return { node_hit_regions: [], plot: null };
  }
  const pad = 16;
  const plot = { x: pad, y: pad, w: Math.max(50, W - 2 * pad), h: Math.max(50, H - 2 * pad) };
  // Network positions live in [0..layout_width] × [0..layout_height];
  // re-scale into our plot box defensively.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of network.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const map = (x, y) => ({
    px: plot.x + ((x - minX) / spanX) * plot.w,
    py: plot.y + ((y - minY) / spanY) * plot.h,
  });

  // Edges first (so nodes overlay).
  ctx.strokeStyle = 'rgba(40, 50, 70, 0.55)';
  ctx.lineWidth = 1;
  if (typeof ctx.beginPath === 'function') {
    for (const e of network.edges || []) {
      const a = network.nodes[e.a]; const b = network.nodes[e.b];
      if (!a || !b) continue;
      const pa = map(a.x, a.y);
      const pb = map(b.x, b.y);
      // Edge thickness: thicker = smaller distance.
      const w = Math.max(1, Math.min(4, 4 / (1 + (e.dist || 1))));
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      if (typeof ctx.stroke === 'function') ctx.stroke();
      // Label edge distance.
      if (typeof ctx.fillText === 'function') {
        ctx.fillStyle = 'rgba(40, 50, 70, 0.7)';
        const midX = (pa.px + pb.px) / 2;
        const midY = (pa.py + pb.py) / 2;
        ctx.fillText(String(e.dist | 0), midX + 2, midY - 2);
      }
    }
  }
  ctx.lineWidth = 1;

  // Nodes.
  const fontSize = Number.isFinite(o.font_size) ? o.font_size : 10;
  ctx.font = fontSize + 'px sans-serif';
  const hovered = Number.isFinite(o.hovered_node) ? o.hovered_node : null;
  const selected = (o.selected_nodes instanceof Set) ? o.selected_nodes : null;
  const colorFor = (typeof o.color_for_node === 'function')
    ? o.color_for_node
    : (id) => NODE_PALETTE[id % NODE_PALETTE.length];
  const hits = [];
  for (const n of network.nodes) {
    const { px, py } = map(n.x, n.y);
    const r = Math.max(NODE_BASE_RADIUS,
      Math.min(28, Math.sqrt(n.size * NODE_AREA_SCALE)));
    ctx.fillStyle = colorFor(n.id);
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (typeof ctx.fill === 'function') ctx.fill();
      if (hovered === n.id) {
        ctx.strokeStyle = '#f5a524';
        ctx.lineWidth = 3;
        if (typeof ctx.stroke === 'function') ctx.stroke();
      } else if (selected && selected.has(n.id)) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        if (typeof ctx.stroke === 'function') ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    if (o.show_labels && typeof ctx.fillText === 'function') {
      ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
      ctx.fillText(String(n.id), px + r + 2, py + fontSize / 3);
    }
    hits.push({ node_id: n.id, x: px, y: py, r: r + 2 });
  }
  return { node_hit_regions: hits, plot };
}

/**
 * Find the node under a canvas pixel (or null).
 *
 * @param {Array<{node_id:number, x:number, y:number, r:number}>} hits
 * @param {number} px
 * @param {number} py
 * @returns {number|null}
 */
export function findNodeAtPixel(hits, px, py) {
  if (!Array.isArray(hits)) return null;
  for (const h of hits) {
    const dx = px - h.x, dy = py - h.y;
    if (dx * dx + dy * dy <= h.r * h.r) return h.node_id;
  }
  return null;
}

/** Expose the palette so the right-panel legend matches. */
export function nodeColor(id) {
  return NODE_PALETTE[id % NODE_PALETTE.length];
}
