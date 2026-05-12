// shared/newick_tree_layout.js
//
// HANDOFF 5 atlas-side rendering — full Newick parser + rectangular
// tree-layout for the per-candidate haplotype tree panel
// (specs_todo/pages_tree_panel/_to_do/HANDOFF_5_tree.md, "atlas-side
// rendering" — ~100 LOC of JS for basic SVG/canvas drawing).
//
// Two compute-only helpers:
//
//   parseNewick(newick)
//     Parse a Newick string to a nested tree:
//       {id, length, support?, children:[...]}
//     Internal nodes have id === null unless the Newick carries an
//     internal label (e.g. bootstrap support).
//
//   computeRectangularLayout(tree, opts)
//     Compute leaf_x, leaf_y, edges suitable for SVG / canvas. Uses
//     branch lengths for x by default; equal-depth (cladogram) when
//     `opts.cladogram = true`. Leaf y is the post-order leaf rank;
//     internal y is the midpoint of children.
//
//     Returns:
//       {
//         leaves: [{id, x, y, depth}, ...],
//         nodes:  [{id, x, y, depth, isLeaf, parent}, ...],
//         edges:  [{x1, y1, x2, y2, child_idx, parent_idx}, ...],
//         maxX, nLeaves,
//       }
//
// Both helpers are pure: no DOM, no fetch, no state.

/**
 * Parse a Newick string to a nested tree.
 *
 * Supports:
 *   - Branch lengths after `:`
 *   - Internal node labels (treated as support values when parsable as
 *     numbers, otherwise as labels).
 *   - Quoted names with single quotes (whitespace in quotes preserved).
 *
 * @param {string} newick
 * @returns {{id:string|null, length:number, support?:number|null,
 *           label?:string, children:Array}}
 */
export function parseNewick(newick) {
  if (!newick || typeof newick !== 'string') return null;
  const s = newick.trim().replace(/;$/, '');
  if (!s) return null;
  let i = 0;
  function readName() {
    if (s[i] === "'") {
      i++;
      let out = '';
      while (i < s.length && s[i] !== "'") { out += s[i++]; }
      if (s[i] === "'") i++;
      return out;
    }
    let out = '';
    while (i < s.length && ':,()'.indexOf(s[i]) < 0 && s[i] !== ';') {
      out += s[i++];
    }
    return out.trim();
  }
  function readLength() {
    if (s[i] !== ':') return 0;
    i++;
    let buf = '';
    while (i < s.length && ',()'.indexOf(s[i]) < 0 && s[i] !== ';') {
      buf += s[i++];
    }
    const v = parseFloat(buf);
    return Number.isFinite(v) ? v : 0;
  }
  function readNode() {
    const node = { id: null, length: 0, children: [] };
    if (s[i] === '(') {
      i++;
      while (true) {
        node.children.push(readNode());
        if (s[i] === ',') { i++; continue; }
        break;
      }
      if (s[i] === ')') i++;
      // Optional internal label / support after )
      const label = readName();
      if (label) {
        const num = parseFloat(label);
        if (Number.isFinite(num)) {
          node.support = num;
          node.label = label;
        } else {
          node.id = label;
          node.label = label;
        }
      }
    } else {
      const name = readName();
      node.id = name || null;
      node.label = name || null;
    }
    node.length = readLength();
    return node;
  }
  return readNode();
}

/**
 * Compute a rectangular (cladogram-style) layout for SVG / canvas
 * rendering. Returns leaf, node, and edge arrays with coordinates
 * suitable for left-rooted horizontal layouts.
 *
 * The layout convention:
 *   - x increases left → right; x of a node = cumulative branch length
 *     from the root (or hop-depth when `cladogram = true`).
 *   - y is the post-order leaf rank for leaves; internal y is the
 *     midpoint between min and max child y.
 *
 * @param {Object} tree  result of parseNewick
 * @param {{cladogram?:boolean, scaleX?:number, scaleY?:number}} [opts]
 * @returns {Object}
 */
export function computeRectangularLayout(tree, opts) {
  const o = opts || {};
  const cladogram = !!o.cladogram;
  const scaleX = Number.isFinite(o.scaleX) ? o.scaleX : 1;
  const scaleY = Number.isFinite(o.scaleY) ? o.scaleY : 1;

  if (!tree) {
    return { leaves: [], nodes: [], edges: [], maxX: 0, nLeaves: 0 };
  }

  const nodes = [];
  const leaves = [];
  const edges = [];

  // Assign depths and parent index via DFS.
  function dfsCollect(node, depth, parentIdx) {
    const idx = nodes.length;
    const rec = {
      id: node.id, label: node.label || null, support: node.support,
      length: node.length,
      depth, parent: parentIdx,
      isLeaf: !node.children || node.children.length === 0,
      childIdxs: [],
      x: 0, y: 0,
    };
    nodes.push(rec);
    if (rec.isLeaf) leaves.push(idx);
    if (node.children) {
      for (const c of node.children) {
        const cIdx = dfsCollect(c, depth + 1, idx);
        rec.childIdxs.push(cIdx);
      }
    }
    return idx;
  }
  dfsCollect(tree, 0, -1);

  // x: cumulative branch length (or hop depth in cladogram mode).
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0) {
      n.x = 0;
    } else {
      const parent = nodes[n.parent];
      const step = cladogram ? 1 : n.length;
      n.x = parent.x + step;
    }
  }

  // y: leaves get sequential rank; internals = midpoint of children.
  for (let li = 0; li < leaves.length; li++) {
    nodes[leaves[li]].y = li;
  }
  // Post-order: process children before parents — node order from
  // dfsCollect already places parents before children, so iterate
  // backwards for post-order.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.isLeaf || n.childIdxs.length === 0) continue;
    let minY = Infinity, maxY = -Infinity;
    for (const ci of n.childIdxs) {
      if (nodes[ci].y < minY) minY = nodes[ci].y;
      if (nodes[ci].y > maxY) maxY = nodes[ci].y;
    }
    n.y = 0.5 * (minY + maxY);
  }

  // Apply scaling.
  let maxX = 0;
  for (const n of nodes) {
    n.x *= scaleX;
    n.y *= scaleY;
    if (n.x > maxX) maxX = n.x;
  }

  // Edges: one per non-root node. Two segments: horizontal from
  // (parent.x, child.y) to (child.x, child.y) and vertical from
  // (parent.x, parent.y) to (parent.x, child.y). The renderer can
  // draw both as one polyline; emit a single edge record with the
  // canonical horizontal-segment endpoints + the vertical-y at parent.
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0) continue;
    const p = nodes[n.parent];
    edges.push({
      x1: p.x, y1: p.y,
      x2: n.x, y2: n.y,
      child_idx: i,
      parent_idx: n.parent,
    });
  }

  return {
    leaves: leaves.map(idx => ({
      id: nodes[idx].id, x: nodes[idx].x, y: nodes[idx].y,
      depth: nodes[idx].depth,
    })),
    nodes,
    edges,
    maxX,
    nLeaves: leaves.length,
  };
}

/**
 * Classify a per-candidate tree as ladder / parallel / scattered
 * given a per-leaf band-label map (HANDOFF 5 Phase 3 "divergence
 * pattern").
 *
 * Rules:
 *   - For each band b, find the smallest subtree containing every
 *     leaf labelled b. Compute purity = (b-leaves in subtree) /
 *     (total leaves in subtree).
 *   - "parallel": all bands have purity ≥ pureThreshold AND each
 *     band's minimal subtree is sister-of (or near-sister) the other
 *     bands' subtrees (≤ 2 hops apart at the root).
 *   - "ladder": all bands have purity ≥ pureThreshold AND the
 *     bands are nested in order (each band sits inside the prior
 *     band's parent subtree).
 *   - "scattered": at least one band has purity < pureThreshold.
 *
 * Returns `{pattern, purity, n_bands}` where pattern ∈
 * {'parallel', 'ladder', 'scattered', 'ambiguous'}.
 *
 * @param {Object} layout result of computeRectangularLayout
 * @param {Object<string, string>|Map<string,string>} bandOf
 * @param {{pureThreshold?:number}} [opts]
 * @returns {{pattern:string, purity:Object<string,number>, n_bands:number}}
 */
export function classifyTreePattern(layout, bandOf, opts) {
  const o = opts || {};
  const pureThr = Number.isFinite(o.pureThreshold) ? o.pureThreshold : 0.85;
  if (!layout || !layout.nodes || !bandOf) {
    return { pattern: 'ambiguous', purity: {}, n_bands: 0 };
  }
  const bandFor = (id) => {
    if (id == null) return null;
    if (bandOf instanceof Map) return bandOf.get(id) || null;
    return bandOf[id] || null;
  };
  // For each leaf, look up band; build per-band leaf-id set.
  const bandLeaves = new Map();
  for (const lf of layout.leaves) {
    const b = bandFor(lf.id);
    if (!b) continue;
    if (!bandLeaves.has(b)) bandLeaves.set(b, new Set());
    bandLeaves.get(b).add(lf.id);
  }
  if (bandLeaves.size === 0) {
    return { pattern: 'ambiguous', purity: {}, n_bands: 0 };
  }
  // For each band: smallest subtree containing every band-leaf =
  // the deepest node whose descendant-leaf set is a superset of the
  // band-leaves.
  const leafIdsByNode = new Array(layout.nodes.length);
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i];
    if (n.isLeaf) {
      leafIdsByNode[i] = new Set([n.id]);
    } else {
      const set = new Set();
      for (const ci of n.childIdxs) {
        for (const x of leafIdsByNode[ci]) set.add(x);
      }
      leafIdsByNode[i] = set;
    }
  }
  const purity = Object.create(null);
  const subtreeIdx = Object.create(null);
  for (const [band, leaves] of bandLeaves) {
    let bestIdx = 0;     // root
    let bestSize = leafIdsByNode[0].size;
    for (let i = 1; i < layout.nodes.length; i++) {
      const set = leafIdsByNode[i];
      let containsAll = true;
      for (const id of leaves) {
        if (!set.has(id)) { containsAll = false; break; }
      }
      if (!containsAll) continue;
      if (set.size < bestSize) { bestIdx = i; bestSize = set.size; }
    }
    let bandLeavesInSubtree = 0;
    for (const id of leafIdsByNode[bestIdx]) {
      if (bandFor(id) === band) bandLeavesInSubtree++;
    }
    purity[band] = leafIdsByNode[bestIdx].size > 0
      ? bandLeavesInSubtree / leafIdsByNode[bestIdx].size
      : 0;
    subtreeIdx[band] = bestIdx;
  }
  const allPure = Object.values(purity).every(p => p >= pureThr);
  if (!allPure) {
    return { pattern: 'scattered', purity, n_bands: bandLeaves.size };
  }
  // ladder vs parallel: ladder if every band-subtree's parent is an
  // ancestor of another band-subtree. parallel if band-subtrees are
  // sisters (share a common parent or a small set of common parents).
  const indices = Object.values(subtreeIdx);
  // Build ancestor sets.
  function ancestors(idx) {
    const anc = new Set();
    let cur = layout.nodes[idx].parent;
    while (cur >= 0) { anc.add(cur); cur = layout.nodes[cur].parent; }
    return anc;
  }
  const ancMap = indices.map(ancestors);
  let nestedHits = 0;
  for (let a = 0; a < indices.length; a++) {
    for (let b = 0; b < indices.length; b++) {
      if (a === b) continue;
      if (ancMap[a].has(indices[b])) nestedHits++;
    }
  }
  // If many "subtree A is ancestor of subtree B" relationships, it's a
  // ladder. Otherwise parallel.
  return {
    pattern: nestedHits >= indices.length - 1 ? 'ladder' : 'parallel',
    purity,
    n_bands: bandLeaves.size,
  };
}
