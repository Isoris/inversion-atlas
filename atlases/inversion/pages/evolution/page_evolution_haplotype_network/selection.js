// pages/evolution/page_evolution_haplotype_network/selection.js

export function createHapNetSelection() {
  let hoveredNode = null;
  const selectedNodes = new Set();
  const subs = new Set();
  const notify = () => { for (const cb of subs) { try { cb(); } catch (_) {} } };
  const _coerce = (v) => (Number.isFinite(v) ? (v | 0) : null);
  return {
    getHoveredNode: () => hoveredNode,
    setHoveredNode(n) {
      const next = _coerce(n);
      if (hoveredNode !== next) { hoveredNode = next; notify(); }
    },
    getSelectedNodes: () => selectedNodes,
    toggleSelectedNode(n) {
      const k = _coerce(n);
      if (k == null) return;
      if (selectedNodes.has(k)) selectedNodes.delete(k);
      else                      selectedNodes.add(k);
      notify();
    },
    clearSelection() {
      if (selectedNodes.size === 0) return;
      selectedNodes.clear();
      notify();
    },
    getHovered: () => hoveredNode,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/**
 * Right-panel summary for a hovered node.
 *
 * @param {Object} node           one entry from network.nodes
 * @param {Object} network
 * @returns {Array<{label:string, value:string}>}
 */
export function summariseNode(node, network) {
  if (!node) return [{ label: 'Node', value: '—' }];
  const out = [];
  out.push({ label: 'Node id', value: String(node.id) });
  out.push({ label: 'Chromosomes', value: String(node.size) });
  out.push({ label: 'Carrier sites', value: String(node.carrier_count) });
  if (network && Array.isArray(network.edges)) {
    let degree = 0;
    for (const e of network.edges) if (e.a === node.id || e.b === node.id) degree++;
    out.push({ label: 'Degree (MST)', value: String(degree) });
  }
  if (Array.isArray(node.members) && node.members.length > 0) {
    out.push({
      label: 'Members',
      value: node.members.slice(0, 6).join(', ')
           + (node.members.length > 6 ? ` +${node.members.length - 6}` : ''),
    });
  }
  return out;
}

/**
 * One-line summary of the network for the header badge.
 *
 * @param {Object} network
 * @returns {string}
 */
export function summariseNetwork(network) {
  if (!network || !Array.isArray(network.nodes) || network.nodes.length === 0) return '—';
  const n = network.nodes.length;
  const e = (network.edges || []).length;
  let totalMembers = 0;
  for (const node of network.nodes) totalMembers += node.size;
  return `${n} nodes · ${e} edges · ${totalMembers} INV chromosomes`;
}
