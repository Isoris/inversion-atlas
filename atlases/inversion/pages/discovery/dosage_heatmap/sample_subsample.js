// pages/discovery/dosage_heatmap/sample_subsample.js
// =====================================================================
// Per-karyogroup sample subsampling — the "≈N samples per karyotype
// group" figure mode. Given a sample display order and a per-sample
// group label, keep at most `cap` samples from each group, spread
// EVENLY through that group's members (not just the first N) so the
// thinned set still spans the group's variation. Row order is preserved.
//
// Samples with no group (label < 0) are kept as-is (never capped) — the
// cap only makes sense once a karyogroup detection is active.
//
// Pure compute. No DOM.
// =====================================================================

/**
 * @param {Int32Array|number[]} order   current sample display order
 *                                      (entries are sample indices)
 * @param {Int32Array|number[]} labels  group id per sample index (-1 = none)
 * @param {number} cap                  max samples kept per group (≤0 = no cap)
 * @returns {Int32Array} subset of `order`, same relative ordering
 */
export function subsampleByGroup(order, labels, cap) {
  const ord = (order instanceof Int32Array) ? order : Int32Array.from(order || []);
  if (!(cap > 0) || !labels || !labels.length) return ord;

  // Members of each group, in display order.
  const groups = new Map();              // gid → [positions into ord]
  const ungrouped = [];                  // positions kept unconditionally
  for (let p = 0; p < ord.length; p++) {
    const si = ord[p];
    const g = si < labels.length ? labels[si] : -1;
    if (g < 0) { ungrouped.push(p); continue; }
    let arr = groups.get(g);
    if (!arr) { arr = []; groups.set(g, arr); }
    arr.push(p);
  }

  // Evenly-spaced pick within each over-cap group.
  const keep = new Uint8Array(ord.length);
  for (const p of ungrouped) keep[p] = 1;
  for (const arr of groups.values()) {
    if (arr.length <= cap) { for (const p of arr) keep[p] = 1; continue; }
    for (let k = 0; k < cap; k++) {
      const idx = Math.min(arr.length - 1, Math.round((k + 0.5) * arr.length / cap));
      keep[arr[idx]] = 1;
    }
  }

  const out = [];
  for (let p = 0; p < ord.length; p++) if (keep[p]) out.push(ord[p]);
  return Int32Array.from(out);
}
