// shared/divergence_network.js
//
// Inversion-overlay version of the pairwise group-divergence network.
// Computes node-level within-group diversity + pairwise FST (or
// Euclidean distance) between karyotype arrangements for the active
// candidate, then exposes render hints (radius / color / edge width /
// circular layout) for any canvas/SVG renderer to consume.
//
// See specs_todo/SPEC_inversion_divergence_network_v1.md for the
// full design + math.
//
// State-as-first-arg, pure compute. No DOM, no localStorage.

// 2026-05-23 Phase 1c: divergence_network moved here from inversion/shared/.
// cross_page_clusters stays in inversion/shared/ (inversion-side cluster
// colouring infrastructure). Cross-atlas relative path.
import { XP_K_PALETTE } from '../../inversion/shared/cross_page_clusters.js';

// =====================================================================
// Constants
// =====================================================================

export const DIVERGENCE_NETWORK_SOURCES = Object.freeze(['pc1', 'dosage']);
export const DIVERGENCE_NETWORK_METRICS = Object.freeze(['fst', 'distance']);

/** Min samples per group below which a pair is flagged 'low_power'. */
export const DIVERGENCE_LOW_POWER_MIN_N = 5;

/** FST thresholds for the weak / strong edge tags. */
export const DIVERGENCE_FST_WEAK_THRESHOLD = 0.10;
export const DIVERGENCE_FST_STRONG_THRESHOLD = 0.25;

/** Edge thickness scale (px). weight ∈ [0, 1] maps linearly to this range. */
export const DIVERGENCE_EDGE_PX_MIN = 1;
export const DIVERGENCE_EDGE_PX_MAX = 8;

/** Node radius scale (px). Maps sqrt(n) into this range. */
export const DIVERGENCE_NODE_PX_MIN = 8;
export const DIVERGENCE_NODE_PX_MAX = 36;

/** Edge color palette by flag. */
export const DIVERGENCE_EDGE_COLORS = Object.freeze({
  strong:    '#e0555c',   // red
  weak:      '#f5a524',   // amber
  low_power: '#888',      // grey (also dashed in render hints)
  null:      '#5a6472',   // muted grey, no flag
});

/**
 * Canonical sort order for common arrangement labels. Used to anchor
 * the circular layout so STD is always at the top, INV at the bottom,
 * HET to the right (mirrors the karyotype-diagram convention).
 */
export const DIVERGENCE_LABEL_ORDER = Object.freeze([
  'STD', 'HOM_REF', 'AA', 'arr_0',
  'HET', 'AB',                 'arr_1',
  'INV', 'HOM_INV', 'BB',      'arr_2',
]);

// =====================================================================
// Group membership + per-window value extraction
// =====================================================================

function _resolveLabel(karyotypeBySample, si) {
  if (Array.isArray(karyotypeBySample)) {
    return (si >= 0 && si < karyotypeBySample.length) ? karyotypeBySample[si] : null;
  }
  if (karyotypeBySample && typeof karyotypeBySample === 'object') {
    return karyotypeBySample[si] || null;
  }
  return null;
}

function _groupSamples(karyotypeBySample, n_samples, includeRecombinants) {
  const groups = new Map();
  let n_classified = 0, n_unclassified = 0;
  const skipped = new Set();
  for (let si = 0; si < n_samples; si++) {
    const raw = _resolveLabel(karyotypeBySample, si);
    if (raw == null || raw === '') { n_unclassified++; continue; }
    const label = String(raw);
    if (label === 'RECOMBINANT' && !includeRecombinants) {
      skipped.add('RECOMBINANT');
      n_unclassified++;
      continue;
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(si);
    n_classified++;
  }
  return { groups, n_classified, n_unclassified, skipped };
}

/**
 * Pull the per-sample value for `(si, w)` from state.data.windows[w].
 * Returns NaN when missing so the caller can skip cleanly.
 */
function _sampleValue(state, w, si, source) {
  const win = state && state.data && state.data.windows && state.data.windows[w];
  if (!win) return NaN;
  if (source === 'pc1') {
    return win.pca && win.pca.pc1 ? win.pca.pc1[si] : NaN;
  }
  if (source === 'dosage') {
    return win.dosage ? win.dosage[si] : NaN;
  }
  return NaN;
}

// =====================================================================
// Per-window math (private)
// =====================================================================

function _groupMeanVarAt(state, w, sampleIdx, source) {
  let sum = 0, n = 0;
  for (const si of sampleIdx) {
    const v = _sampleValue(state, w, si, source);
    if (Number.isFinite(v)) { sum += v; n++; }
  }
  if (n === 0) return { mean: NaN, varSum: 0, n: 0 };
  const mean = sum / n;
  let varSum = 0;
  for (const si of sampleIdx) {
    const v = _sampleValue(state, w, si, source);
    if (Number.isFinite(v)) varSum += (v - mean) * (v - mean);
  }
  return { mean, varSum, n };
}

function _fstAt(state, w, idxA, idxB, source) {
  const a = _groupMeanVarAt(state, w, idxA, source);
  const b = _groupMeanVarAt(state, w, idxB, source);
  if (!Number.isFinite(a.mean) || !Number.isFinite(b.mean)) return NaN;
  if (a.n + b.n < 2) return NaN;
  if (source === 'dosage') {
    const p1 = a.mean / 2;
    const p2 = b.mean / 2;
    const pBar = (a.n * p1 + b.n * p2) / (a.n + b.n);
    const Hs = (a.n * 2 * p1 * (1 - p1) + b.n * 2 * p2 * (1 - p2)) / (a.n + b.n);
    const Ht = 2 * pBar * (1 - pBar);
    if (!(Ht > 0)) return 0;
    const v = (Ht - Hs) / Ht;
    return v > 0 ? v : 0;
  }
  // Variance-ratio FST for continuous (pc1) values
  const total_n = a.n + b.n;
  const mu = (a.n * a.mean + b.n * b.mean) / total_n;
  let SS_t = 0;
  for (const si of idxA) {
    const v = _sampleValue(state, w, si, source);
    if (Number.isFinite(v)) SS_t += (v - mu) * (v - mu);
  }
  for (const si of idxB) {
    const v = _sampleValue(state, w, si, source);
    if (Number.isFinite(v)) SS_t += (v - mu) * (v - mu);
  }
  const SS_w = a.varSum + b.varSum;
  if (!(SS_t > 0)) return 0;
  const v = (SS_t - SS_w) / SS_t;
  return v > 0 ? v : 0;
}

// =====================================================================
// Public: compute
// =====================================================================

/**
 * Compute the divergence-network data structure for the active
 * candidate. See SPEC §5 for the output shape.
 *
 * @param {Object} state
 * @param {Object} candidate              { id, chrom, K, start_w, end_w, ... }
 * @param {Array<string>|Object<number,string>} karyotypeBySample
 * @param {Object} [opts]
 * @param {'pc1'|'dosage'} [opts.source='pc1']
 * @param {'fst'|'distance'} [opts.metric='fst']
 * @param {boolean} [opts.includeRecombinants=false]
 * @param {boolean} [opts.exposeMembership=false]   include sample_idx[] in node
 * @returns {Object|null}
 */
export function computeDivergenceNetwork(state, candidate, karyotypeBySample, opts) {
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  if (!candidate) return null;
  const n_samples = Number.isFinite(state.data.n_samples)
    ? state.data.n_samples
    : (state.data.samples ? state.data.samples.length : 0);
  if (!n_samples) return null;

  const source = (opts && opts.source) || 'pc1';
  const metric = (opts && opts.metric) || 'fst';
  if (!DIVERGENCE_NETWORK_SOURCES.includes(source)) return null;
  if (!DIVERGENCE_NETWORK_METRICS.includes(metric)) return null;

  const startW = Number.isFinite(candidate.start_w) ? candidate.start_w : 0;
  const endW   = Number.isFinite(candidate.end_w)
    ? candidate.end_w
    : (state.data.windows.length - 1);
  if (endW < startW) return null;

  const { groups, n_classified, n_unclassified, skipped } =
    _groupSamples(karyotypeBySample, n_samples,
                  !!(opts && opts.includeRecombinants));

  if (groups.size === 0) {
    return {
      meta: _meta(candidate, source, metric, 0, startW, endW),
      nodes: [], edges: [],
      stats: {
        n_samples_total: n_samples,
        n_samples_classified: 0,
        n_samples_unclassified: n_unclassified,
        n_groups: 0,
        skipped_groups: Array.from(skipped),
      },
    };
  }

  // --- Node-level within-group stats ---------------------------------
  const groupIds = Array.from(groups.keys()).sort(_compareLabels);
  const nodes = [];
  let n_windows_used = 0;
  for (const gid of groupIds) {
    const idx = groups.get(gid);
    let sumVar = 0, cnt = 0;
    let sumMeanPc1 = 0, sumMeanPc2 = 0, cntMean = 0;
    let cntMeanPc2 = 0;
    for (let w = startW; w <= endW; w++) {
      const stats = _groupMeanVarAt(state, w, idx, source);
      if (stats.n > 0) {
        // Per-window variance proxy for π
        sumVar += stats.varSum / stats.n;
        cnt++;
        sumMeanPc1 += stats.mean;
        cntMean++;
        if (source === 'pc1') {
          const pc2 = _groupMeanPC2At(state, w, idx);
          if (Number.isFinite(pc2)) { sumMeanPc2 += pc2; cntMeanPc2++; }
        }
      }
    }
    n_windows_used = Math.max(n_windows_used, cnt);
    const node = {
      id: gid,
      n: idx.length,
      within_pi: cnt > 0 ? sumVar / cnt : 0,
      mean_pc1:  cntMean > 0 ? sumMeanPc1 / cntMean : 0,
      mean_pc2:  cntMeanPc2 > 0 ? sumMeanPc2 / cntMeanPc2 : 0,
      color:     _colorForLabel(gid, groupIds.indexOf(gid)),
    };
    if (opts && opts.exposeMembership) node.sample_idx = idx.slice();
    nodes.push(node);
  }

  // --- Edge-level pairwise stats -------------------------------------
  const edges = [];
  for (let i = 0; i < groupIds.length; i++) {
    for (let j = i + 1; j < groupIds.length; j++) {
      const a = groupIds[i], b = groupIds[j];
      const idxA = groups.get(a), idxB = groups.get(b);
      const edge = { a, b, fst: null, distance: null, flag: null, weight: 0 };
      if (metric === 'fst') {
        let sumFst = 0, nWin = 0;
        for (let w = startW; w <= endW; w++) {
          const v = _fstAt(state, w, idxA, idxB, source);
          if (Number.isFinite(v)) { sumFst += v; nWin++; }
        }
        const fst = nWin > 0 ? sumFst / nWin : 0;
        edge.fst = fst;
        edge.weight = fst;
      } else {
        // Euclidean over per-window group means
        let sumSq = 0, nWin = 0;
        for (let w = startW; w <= endW; w++) {
          const ma = _groupMeanVarAt(state, w, idxA, source);
          const mb = _groupMeanVarAt(state, w, idxB, source);
          if (Number.isFinite(ma.mean) && Number.isFinite(mb.mean)) {
            const d = ma.mean - mb.mean;
            sumSq += d * d;
            nWin++;
          }
        }
        const dist = nWin > 0 ? Math.sqrt(sumSq / nWin) : 0;
        edge.distance = dist;
        edge.weight = dist;
      }
      // Confidence flag
      if (idxA.length < DIVERGENCE_LOW_POWER_MIN_N
          || idxB.length < DIVERGENCE_LOW_POWER_MIN_N) {
        edge.flag = 'low_power';
      } else if (metric === 'fst') {
        if (edge.fst >= DIVERGENCE_FST_STRONG_THRESHOLD)      edge.flag = 'strong';
        else if (edge.fst >= DIVERGENCE_FST_WEAK_THRESHOLD)   edge.flag = 'weak';
      }
      edges.push(edge);
    }
  }

  return {
    meta: _meta(candidate, source, metric, n_windows_used, startW, endW),
    nodes,
    edges,
    stats: {
      n_samples_total: n_samples,
      n_samples_classified: n_classified,
      n_samples_unclassified: n_unclassified,
      n_groups: groupIds.length,
      skipped_groups: Array.from(skipped),
    },
  };
}

function _meta(candidate, source, metric, n_windows_used, startW, endW) {
  return {
    candidate_id: candidate.id || null,
    chrom:        candidate.chrom || null,
    start_w:      startW,
    end_w:        endW,
    n_windows_used,
    source,
    metric,
    generated_at: new Date().toISOString(),
  };
}

function _groupMeanPC2At(state, w, sampleIdx) {
  const win = state.data.windows[w];
  if (!win || !win.pca || !win.pca.pc2) return NaN;
  const pc2 = win.pca.pc2;
  let sum = 0, n = 0;
  for (const si of sampleIdx) {
    const v = pc2[si];
    if (Number.isFinite(v)) { sum += v; n++; }
  }
  return n > 0 ? sum / n : NaN;
}

function _compareLabels(a, b) {
  const ia = DIVERGENCE_LABEL_ORDER.indexOf(a);
  const ib = DIVERGENCE_LABEL_ORDER.indexOf(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a < b ? -1 : (a > b ? 1 : 0);
}

function _colorForLabel(label, fallbackIdx) {
  // Map canonical arrangement labels to the shared XP K-palette.
  if (label === 'STD' || label === 'HOM_REF' || label === 'AA' || label === 'arr_0') return XP_K_PALETTE[0];
  if (label === 'HET' || label === 'AB'                       || label === 'arr_1') return XP_K_PALETTE[2];
  if (label === 'INV' || label === 'HOM_INV' || label === 'BB' || label === 'arr_2') return XP_K_PALETTE[4];
  // Fallback: rotate through palette
  return XP_K_PALETTE[fallbackIdx % XP_K_PALETTE.length] || '#888';
}

// =====================================================================
// Render hints
// =====================================================================

/**
 * Decorate a computed network with layout positions + per-element
 * render hints. Pure compute — caller's renderer reads x/y/width/etc.
 *
 *   divergenceNetworkRenderHints(network, {
 *     width: 360, height: 240, cx: 180, cy: 120, radius: 90
 *   })
 *
 * Defaults: 320×220 canvas, centered, layout radius = min(w,h) * 0.35.
 *
 * @param {Object} network    from computeDivergenceNetwork
 * @param {Object} [layout]
 * @returns {{nodes, edges, layout}|null}
 */
export function divergenceNetworkRenderHints(network, layout) {
  if (!network || !Array.isArray(network.nodes)) return null;
  const cfg = Object.assign({
    width: 320, height: 220, cx: null, cy: null, radius: null,
  }, layout || {});
  if (cfg.cx == null) cfg.cx = cfg.width / 2;
  if (cfg.cy == null) cfg.cy = cfg.height / 2;
  if (cfg.radius == null) cfg.radius = Math.min(cfg.width, cfg.height) * 0.35;

  // Circular layout: nodes evenly spaced around (cx, cy). The shared
  // _compareLabels sort in computeDivergenceNetwork already anchored
  // STD-ish groups first, so positions are stable across paints.
  const n = network.nodes.length;
  const nodeHints = network.nodes.map((node, i) => {
    const angle = n === 1
      ? -Math.PI / 2
      : -Math.PI / 2 + (i / n) * Math.PI * 2;
    const x = cfg.cx + cfg.radius * Math.cos(angle);
    const y = cfg.cy + cfg.radius * Math.sin(angle);
    const r = _nodeRadius(node.n, network.nodes);
    return {
      id: node.id,
      x, y, radius: r,
      fill: node.color,
      stroke: '#181c25',
      strokeWidth: 1.5,
      label: node.id,
      label_value: node.within_pi,
      n: node.n,
    };
  });

  // Edge hints: thickness from weight, color from flag
  const maxWeight = _maxFiniteWeight(network.edges);
  const nodeById = new Map(nodeHints.map(h => [h.id, h]));
  const edgeHints = network.edges.map(e => {
    const a = nodeById.get(e.a);
    const b = nodeById.get(e.b);
    if (!a || !b) return null;
    const norm = maxWeight > 0 ? Math.max(0, Math.min(1, e.weight / maxWeight)) : 0;
    const width = DIVERGENCE_EDGE_PX_MIN + norm * (DIVERGENCE_EDGE_PX_MAX - DIVERGENCE_EDGE_PX_MIN);
    const flagKey = e.flag === 'strong' ? 'strong'
                  : e.flag === 'weak'   ? 'weak'
                  : e.flag === 'low_power' ? 'low_power'
                  : 'null';
    return {
      a: e.a, b: e.b,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      width,
      stroke: DIVERGENCE_EDGE_COLORS[flagKey],
      dashed: e.flag === 'low_power',
      label: _formatEdgeLabel(e, network.meta.metric),
      flag: e.flag,
      weight: e.weight,
    };
  }).filter(Boolean);

  return {
    nodes: nodeHints,
    edges: edgeHints,
    layout: cfg,
  };
}

function _nodeRadius(nodeN, allNodes) {
  if (!allNodes || allNodes.length === 0) return DIVERGENCE_NODE_PX_MIN;
  let maxN = 0;
  for (const n of allNodes) if (n.n > maxN) maxN = n.n;
  if (!(maxN > 0)) return DIVERGENCE_NODE_PX_MIN;
  const norm = Math.sqrt(nodeN / maxN);  // area-proportional
  return DIVERGENCE_NODE_PX_MIN
    + norm * (DIVERGENCE_NODE_PX_MAX - DIVERGENCE_NODE_PX_MIN);
}

function _maxFiniteWeight(edges) {
  let mx = 0;
  for (const e of edges) {
    if (Number.isFinite(e.weight) && e.weight > mx) mx = e.weight;
  }
  return mx;
}

function _formatEdgeLabel(edge, metric) {
  if (metric === 'fst') {
    return edge.fst != null && Number.isFinite(edge.fst)
      ? edge.fst.toFixed(2)
      : '—';
  }
  return edge.distance != null && Number.isFinite(edge.distance)
    ? edge.distance.toFixed(2)
    : '—';
}
