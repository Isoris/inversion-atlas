// shared/mgl_nj_tree.js
// =====================================================================
// Neighbor-joining tree on a sample × sample distance matrix.
//
// Why NJ in the browser: the user's framing — "phylo can default to
// NJ (or fasttree), what's the difference anyway" — for the atlas's
// purposes (sample-relationship background frame, phylogenetic-
// confound check) a topology cluster is all we need; branch-length
// accuracy doesn't matter. NJ on 226×226 is milliseconds.
//
// Algorithm: Saitou & Nei 1987.
//   1. From the n×n distance matrix D, compute the Q matrix
//        Q_ij = (n-2) D_ij − Σ_k D_ik − Σ_k D_jk
//   2. Pick the pair (i, j) minimising Q.
//   3. Create new node u joining i and j; compute branch lengths
//      L_iu and L_ju per the formula.
//   4. Update D with the new node (distance from u to every k).
//   5. Remove i and j; repeat until only 2 active nodes remain.
//   6. Last pair → final unrooted tree.
//
// Output: a tree representation the atlas can consume:
//   - `tree`: array of nodes (each {id, parent_id, branch_length,
//     children:[ids], is_leaf:bool, leaf_label:string|null})
//   - `root_id`: id of the unrooted-tree's last internal node
//
// Also includes:
//   - distance helpers (euclidean on dosage, mean abs diff)
//   - cladeLabelsAtK(tree, K): cut the tree at depth that yields K
//     clades → per-leaf clade labels (input to
//     shared/phylogenetic_confound.classifyPhylogeneticConfound)
//   - toNewickString(tree): canonical Newick serialization
// =====================================================================

// =====================================================================
// 1. Distance helpers
// =====================================================================

/**
 * Pairwise Euclidean distance matrix on a sample × samples basis,
 * computed from a per-marker dosage matrix (row-major n_markers ×
 * n_samples). Returns a flat row-major n_samples × n_samples
 * Float64Array.
 *
 * @param {Float64Array} dosage   row-major n_markers × n_samples
 * @param {number} n_markers
 * @param {number} n_samples
 * @returns {Float64Array}
 */
export function pairwiseEuclideanFromDosage(dosage, n_markers, n_samples) {
  const D = new Float64Array(n_samples * n_samples);
  if (n_markers === 0 || n_samples === 0) return D;
  for (let i = 0; i < n_samples; i++) {
    for (let j = i + 1; j < n_samples; j++) {
      let s = 0;
      for (let r = 0; r < n_markers; r++) {
        const off = r * n_samples;
        const d = dosage[off + i] - dosage[off + j];
        s += d * d;
      }
      const dist = Math.sqrt(s);
      D[i * n_samples + j] = dist;
      D[j * n_samples + i] = dist;
    }
  }
  return D;
}

/**
 * Mean absolute dosage difference. More robust than Euclidean to
 * heavy-tailed per-marker outliers; useful when arrangements
 * differ at most positions but a few markers are noisy.
 *
 * @param {Float64Array} dosage
 * @param {number} n_markers
 * @param {number} n_samples
 * @returns {Float64Array}
 */
export function pairwiseMeanAbsDiffFromDosage(dosage, n_markers, n_samples) {
  const D = new Float64Array(n_samples * n_samples);
  if (n_markers === 0 || n_samples === 0) return D;
  const inv = 1 / n_markers;
  for (let i = 0; i < n_samples; i++) {
    for (let j = i + 1; j < n_samples; j++) {
      let s = 0;
      for (let r = 0; r < n_markers; r++) {
        const off = r * n_samples;
        s += Math.abs(dosage[off + i] - dosage[off + j]);
      }
      const dist = s * inv;
      D[i * n_samples + j] = dist;
      D[j * n_samples + i] = dist;
    }
  }
  return D;
}

// =====================================================================
// 2. Neighbor-joining
// =====================================================================

/**
 * Build a neighbor-joining tree from an n×n distance matrix.
 *
 * @param {Float64Array|number[][]} D_flat_or_2d   row-major n×n OR
 *   nested 2D array of distances. n is inferred.
 * @param {string[]} [labels]   optional per-leaf labels (length n).
 *   When omitted, leaves are labelled '0', '1', '2', ...
 * @returns {{
 *   nodes: Array<{
 *     id:number, parent_id:number|null,
 *     branch_length:number, children:number[],
 *     is_leaf:boolean, leaf_label:string|null,
 *   }>,
 *   root_id: number,
 *   n_leaves: number,
 * }}
 */
export function buildNjTree(D_flat_or_2d, labels) {
  // Normalise input to a flat Float64Array.
  let n, D;
  if (D_flat_or_2d instanceof Float64Array) {
    n = Math.round(Math.sqrt(D_flat_or_2d.length));
    D = D_flat_or_2d.slice();
  } else if (Array.isArray(D_flat_or_2d) && Array.isArray(D_flat_or_2d[0])) {
    n = D_flat_or_2d.length;
    D = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) D[i * n + j] = D_flat_or_2d[i][j];
    }
  } else {
    return { nodes: [], root_id: -1, n_leaves: 0 };
  }
  if (n < 2) return { nodes: [], root_id: -1, n_leaves: n };

  // Initialise leaves.
  const nodes = new Array(n);
  for (let i = 0; i < n; i++) {
    nodes[i] = {
      id: i,
      parent_id: null,
      branch_length: 0,
      children: [],
      is_leaf: true,
      leaf_label: labels && labels[i] != null ? String(labels[i]) : String(i),
    };
  }

  // Active set: indices currently in play. We'll add new internal
  // nodes to nodes[] and add their ids to `active`.
  const active = new Array(n);
  for (let i = 0; i < n; i++) active[i] = i;

  // We resize working distance matrix in place by tracking a logical
  // mapping. Use a Map<active_idx, row_idx_in_D>. Simpler: keep
  // working matrix indexed by node id, expand as we add nodes.
  // The active count starts at n and shrinks to 2.
  // Distances keyed by `nodeId × nodeId` via a Map<bigint-key, number>.
  const distKey = (a, b) => (a < b) ? (a * 1000003 + b) : (b * 1000003 + a);
  const dist = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      dist.set(distKey(i, j), D[i * n + j]);
    }
  }

  // Helper: row sums over active set.
  const rowSums = () => {
    const m = active.length;
    const sums = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        s += dist.get(distKey(active[i], active[j])) || 0;
      }
      sums[i] = s;
    }
    return sums;
  };

  // Main loop.
  while (active.length > 2) {
    const m = active.length;
    const sums = rowSums();

    // Find the pair (i, j) minimising Q.
    let bestI = 0, bestJ = 1, bestQ = Infinity;
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const dij = dist.get(distKey(active[i], active[j])) || 0;
        const q = (m - 2) * dij - sums[i] - sums[j];
        if (q < bestQ) { bestQ = q; bestI = i; bestJ = j; }
      }
    }
    const ai = active[bestI], aj = active[bestJ];
    const dij = dist.get(distKey(ai, aj)) || 0;

    // Branch lengths.
    const L_iu = 0.5 * dij + (sums[bestI] - sums[bestJ]) / (2 * (m - 2));
    const L_ju = dij - L_iu;

    // Create new internal node u.
    const u = nodes.length;
    nodes.push({
      id: u,
      parent_id: null,
      branch_length: 0,
      children: [ai, aj],
      is_leaf: false,
      leaf_label: null,
    });
    nodes[ai].parent_id = u;
    nodes[ai].branch_length = Math.max(0, L_iu);
    nodes[aj].parent_id = u;
    nodes[aj].branch_length = Math.max(0, L_ju);

    // Update distances from u to every other active node k.
    for (let k = 0; k < m; k++) {
      if (k === bestI || k === bestJ) continue;
      const ak = active[k];
      const d_ik = dist.get(distKey(ai, ak)) || 0;
      const d_jk = dist.get(distKey(aj, ak)) || 0;
      const d_uk = 0.5 * (d_ik + d_jk - dij);
      dist.set(distKey(u, ak), Math.max(0, d_uk));
    }

    // Drop old distances involving ai and aj.
    for (let k = 0; k < m; k++) {
      const ak = active[k];
      dist.delete(distKey(ai, ak));
      dist.delete(distKey(aj, ak));
    }

    // Replace bestI, bestJ in active list with u.
    // (Remove the bigger index first so the smaller doesn't shift.)
    const hi = Math.max(bestI, bestJ);
    const lo = Math.min(bestI, bestJ);
    active.splice(hi, 1);
    active.splice(lo, 1);
    active.push(u);
  }

  // Final 2 active nodes — connect them through a final root.
  const a = active[0], b = active[1];
  const d_ab = dist.get(distKey(a, b)) || 0;
  const root = nodes.length;
  nodes.push({
    id: root,
    parent_id: null,
    branch_length: 0,
    children: [a, b],
    is_leaf: false,
    leaf_label: null,
  });
  nodes[a].parent_id = root;
  nodes[a].branch_length = Math.max(0, d_ab * 0.5);
  nodes[b].parent_id = root;
  nodes[b].branch_length = Math.max(0, d_ab * 0.5);

  return { nodes, root_id: root, n_leaves: n };
}

// =====================================================================
// 3. Clade labels at K (for phylogenetic_confound consumption)
// =====================================================================

/**
 * Cut the tree to produce K clades and return a per-leaf clade label.
 *
 * Approach: find the K-1 longest internal branches and remove them.
 * Each remaining connected subtree of leaves = one clade. Labels are
 * strings 'clade_0', 'clade_1', ...
 *
 * When the tree has fewer leaves than K, returns one clade per leaf.
 *
 * @param {Object} tree     buildNjTree output
 * @param {number} K        target number of clades (≥ 2)
 * @returns {string[]}      labels per leaf, in leaf-id order (size n_leaves)
 */
export function cladeLabelsAtK(tree, K) {
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) return [];
  const n_leaves = tree.n_leaves;
  if (K <= 1) return new Array(n_leaves).fill('clade_0');
  if (K >= n_leaves) {
    // Every leaf its own clade.
    return new Array(n_leaves).fill(null).map((_, i) => 'clade_' + i);
  }
  // Collect every parent→child edge with its child's branch_length.
  // Split into INTERNAL-child edges (between internal nodes — the
  // "trunks" separating clades) and LEAF-child edges (which would
  // isolate a single leaf). For clade detection we always prefer
  // to cut trunk edges first; leaf edges only get cut if we still
  // need more cuts after exhausting all internal edges.
  const internalEdges = [];
  const leafEdges = [];
  for (const n of tree.nodes) {
    if (n.parent_id === null) continue;
    const e = { child: n.id, parent: n.parent_id, length: n.branch_length };
    if (n.is_leaf) leafEdges.push(e);
    else           internalEdges.push(e);
  }
  internalEdges.sort((a, b) => b.length - a.length);
  leafEdges.sort((a, b) => b.length - a.length);
  const cuts = new Set();
  let remaining = K - 1;
  for (let i = 0; i < internalEdges.length && remaining > 0; i++, remaining--) {
    cuts.add(internalEdges[i].child);
  }
  for (let i = 0; i < leafEdges.length && remaining > 0; i++, remaining--) {
    cuts.add(leafEdges[i].child);
  }
  // BFS/DFS from each remaining root component. A "root" is a node
  // whose parent edge was cut, OR the tree root.
  const cladeOf = new Array(tree.nodes.length).fill(-1);
  const components = [];
  for (const n of tree.nodes) {
    const isCutChild = cuts.has(n.id);
    const isOriginalRoot = n.parent_id === null;
    if (isCutChild || isOriginalRoot) {
      // Walk down, painting all reachable descendants (stopping at
      // any cut edge) with this component's index.
      const compIdx = components.length;
      components.push(n.id);
      const stack = [n.id];
      while (stack.length) {
        const cur = stack.pop();
        cladeOf[cur] = compIdx;
        const node = tree.nodes[cur];
        for (const c of node.children) {
          if (cuts.has(c)) continue;
          stack.push(c);
        }
      }
    }
  }
  // Build per-leaf labels.
  const labels = new Array(n_leaves);
  for (let i = 0; i < n_leaves; i++) {
    labels[i] = cladeOf[i] >= 0 ? ('clade_' + cladeOf[i]) : 'clade_unassigned';
  }
  return labels;
}

// =====================================================================
// 4. Newick serialization
// =====================================================================

/**
 * Serialise a buildNjTree result to a Newick string. Internal nodes
 * are unlabelled; leaves use their `leaf_label`. Branch lengths are
 * written with 6 significant figures.
 *
 * @param {Object} tree
 * @returns {string}
 */
export function toNewickString(tree) {
  if (!tree || !Array.isArray(tree.nodes) || tree.root_id < 0) return ';';
  return _newickFor(tree, tree.root_id) + ';';
}

function _newickFor(tree, nodeId) {
  const n = tree.nodes[nodeId];
  if (!n) return '';
  if (n.is_leaf) {
    return _escapeLabel(n.leaf_label) + ':' + _fmtLen(n.branch_length);
  }
  const inner = n.children.map(c => _newickFor(tree, c)).join(',');
  // Root has branch_length 0; omit the colon when nodeId is root.
  if (n.parent_id === null) return '(' + inner + ')';
  return '(' + inner + '):' + _fmtLen(n.branch_length);
}

function _escapeLabel(s) {
  if (s == null) return '';
  // Quote labels containing characters reserved by Newick.
  if (/[\s,():;[\]']/.test(s)) {
    return "'" + s.replace(/'/g, "''") + "'";
  }
  return s;
}

function _fmtLen(x) {
  if (!Number.isFinite(x)) return '0';
  return x.toPrecision(6);
}
