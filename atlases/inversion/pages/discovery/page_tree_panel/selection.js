// pages/discovery/page_tree_panel/selection.js
//
// Selection store + ARI helpers for the tree panel. The panel hooks
// hover/click into its hit-region list (renderer.findLeafAtPixel)
// and pushes selection through here.

import { computeARI } from '../../../shared/contingency.js';
import { cladeLabelsAtK } from '../../../shared/mgl_nj_tree.js';

/**
 * Compute ARI between the tree's clade assignments at K=k and
 * supplied per-leaf cluster labels (e.g. K-means cluster of the
 * candidate-mode PCA). High ARI = "the tree splits agree with the
 * clustering" — supports inversion-claim concordance.
 *
 * @param {Object} tree           mgl_nj_tree.buildNjTree output
 * @param {Array<string|number>} leaf_cluster_labels   indexed by leaf
 *   id (parsed as int from the tree's leaf_label string)
 * @param {number} K              target clade count (default 3)
 * @returns {{ari:number, n_leaves:number}}
 */
export function ariBetweenTreeAndClusters(tree, leaf_cluster_labels, K) {
  if (!tree || !Array.isArray(leaf_cluster_labels)) {
    return { ari: NaN, n_leaves: 0 };
  }
  const k = Number.isFinite(K) ? K : 3;
  const clade = cladeLabelsAtK(tree, k);
  if (!clade || clade.length === 0) return { ari: NaN, n_leaves: 0 };
  const cl = leaf_cluster_labels.slice(0, clade.length);
  const ari = computeARI(clade, cl.map(String));
  return { ari, n_leaves: clade.length };
}

/**
 * Create a tiny selection store. The panel uses this to track
 * hover state + sample selection list. Subscribers fire on every
 * change so the renderer can re-paint.
 *
 * @returns {{
 *   getHovered: () => string|null,
 *   setHovered: (id:string|null) => void,
 *   getSelected: () => Set<string>,
 *   toggleSelected: (id:string) => void,
 *   clearSelection: () => void,
 *   subscribe: (cb:Function) => Function,
 * }}
 */
export function createTreePanelSelection() {
  let hovered = null;
  const selected = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  return {
    getHovered:     () => hovered,
    setHovered(id) {
      const next = id || null;
      if (hovered !== next) { hovered = next; notify(); }
    },
    getSelected:    () => selected,
    toggleSelected(id) {
      if (!id) return;
      if (selected.has(id)) selected.delete(id);
      else                  selected.add(id);
      notify();
    },
    clearSelection() {
      if (selected.size === 0) return;
      selected.clear();
      notify();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
