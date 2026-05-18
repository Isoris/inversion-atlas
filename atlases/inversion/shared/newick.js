// shared/newick.js
//
// Minimal Newick parser → flat list of leaves with depth approximation.
// Used by the multi-species UI tree rendering (cross_species_breakpoints) to derive leaf
// order + relative depth from a phylo_tree_v1 newick string. Does NOT
// reconstruct full topology — only what's needed to render a left-
// rooted cladogram from a sorted leaf list.
//
// Legacy origin: lines 26876-26912 of legacy/Inversion_atlas.html.

/**
 * Parse a Newick string into a flat list of leaves with depth.
 *
 *   '((A:0.1,B:0.1):0.05,C:0.15);'  →
 *     [{id: 'A', depth: 2}, {id: 'B', depth: 2}, {id: 'C', depth: 1}]
 *
 * When `allowedIds` is provided (Set or Array), leaf ids outside that
 * set are still recorded but flagged with `_unknown: true` so callers
 * can decide whether to render them or fall back to a reference list.
 *
 * Branch lengths after `:` are stripped from the id. Internal node
 * labels are ignored (the parser only records leaves — tokens flushed
 * outside a closing paren or as comma-separated entries inside one).
 *
 * @param {string} newick
 * @param {Iterable<string>} [allowedIds]
 * @returns {Array<{id:string, depth:number, _unknown?:boolean}>}
 */
export function parseNewickToLeaves(newick, allowedIds) {
  if (!newick || typeof newick !== 'string') return [];
  const allowed = allowedIds ? new Set(allowedIds) : null;
  const leaves = [];
  let depth = 0;
  let token = '';
  let curDepth = 0;
  function flushToken() {
    if (token) {
      const colon = token.indexOf(':');
      const id = (colon >= 0 ? token.substring(0, colon) : token).trim();
      if (id && (!allowed || allowed.has(id))) {
        leaves.push({ id, depth: curDepth });
      } else if (id) {
        leaves.push({ id, depth: curDepth, _unknown: true });
      }
      token = '';
    }
  }
  for (let i = 0; i < newick.length; i++) {
    const ch = newick.charAt(i);
    if (ch === '(') { depth++; curDepth = depth; flushToken(); }
    else if (ch === ')') { flushToken(); depth--; curDepth = depth; }
    else if (ch === ',') { flushToken(); }
    else if (ch === ';') { flushToken(); break; }
    else { token += ch; }
  }
  flushToken();
  return leaves;
}
