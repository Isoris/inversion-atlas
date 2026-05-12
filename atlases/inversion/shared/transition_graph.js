// shared/transition_graph.js
//
// Structural-haplotype transition graph (legacy lines 38020-38150). For
// each pair of adjacent L2 envelopes along a chromosome, counts how
// many fish change band assignment under Hungarian-aligned labels. The
// per-boundary transition_rate identifies positions where many fish
// re-cluster simultaneously — these are the structural-haplotype regime
// boundaries.
//
// Naming: this is NOT an evolutionary DAG. Acyclicity comes from genome
// coordinates being ordered (left → right), not from evolutionary
// history. The "transition_rate" framing keeps that distinction clear.
//
// All helpers are pure: cluster lookup + Hungarian permutation are
// injected as callbacks so the module is testable without a live atlas
// state.

/** Boundaries with transition_rate ≥ this threshold are hotspots. */
export const SHTG_HOTSPOT_THRESHOLD = 0.30;
/** Minimum total samples (with valid labels on both sides) to compute
 *  a meaningful transition_rate. */
export const SHTG_MIN_SAMPLES = 5;

// =====================================================================
// Per-boundary stats
// =====================================================================

/**
 * Compute transition stats for one (left → right) L2 boundary.
 *
 * @param {{labels:ArrayLike<number>, fixedKLabels?:ArrayLike<number>}} leftCluster
 * @param {{labels:ArrayLike<number>, fixedKLabels?:ArrayLike<number>}} rightCluster
 * @param {ArrayLike<number>?} perm   Hungarian-aligned right-side label
 *                                     for each left-side band. When null/
 *                                     missing, identity mapping is used.
 * @param {{leftEnvelope?:Object, rightEnvelope?:Object, leftIdx?:number,
 *         rightIdx?:number, minSamples?:number}} opts
 * @returns {Object|null}
 */
export function computeShtgBoundaryStats(leftCluster, rightCluster, perm, opts) {
  if (!leftCluster || !rightCluster) return null;
  if (!leftCluster.labels || !rightCluster.labels) return null;
  if (leftCluster.labels.length !== rightCluster.labels.length) return null;

  const o = opts || {};
  const minSamples = Number.isFinite(o.minSamples) ? o.minSamples : SHTG_MIN_SAMPLES;
  const llab = leftCluster.fixedKLabels || leftCluster.labels;
  const rlab = rightCluster.fixedKLabels || rightCluster.labels;

  const edgeMap = {};
  let nValid = 0, nChanged = 0;
  for (let si = 0; si < llab.length; si++) {
    const fl = llab[si];
    const fr = rlab[si];
    if (!Number.isInteger(fl) || !Number.isInteger(fr) || fl < 0 || fr < 0) continue;
    nValid++;
    const flAligned = (perm && perm[fl] != null) ? perm[fl] : fl;
    if (flAligned !== fr) nChanged++;
    if (!edgeMap[fl]) edgeMap[fl] = {};
    edgeMap[fl][fr] = (edgeMap[fl][fr] || 0) + 1;
  }

  if (nValid < minSamples) return null;
  const transition_rate = nChanged / nValid;

  const edges = [];
  for (const fl of Object.keys(edgeMap)) {
    for (const fr of Object.keys(edgeMap[fl])) {
      edges.push({
        from_band: parseInt(fl, 10),
        to_band:   parseInt(fr, 10),
        count:     edgeMap[fl][fr],
      });
    }
  }
  edges.sort((a, b) => b.count - a.count);

  let position_mb = NaN;
  const eL = o.leftEnvelope, eR = o.rightEnvelope;
  if (eL && eR && Number.isFinite(eL.end_bp) && Number.isFinite(eR.start_bp)) {
    position_mb = (eL.end_bp + eR.start_bp) / 2 / 1e6;
  }

  return {
    l2_left:        Number.isFinite(o.leftIdx)  ? o.leftIdx  : null,
    l2_right:       Number.isFinite(o.rightIdx) ? o.rightIdx : null,
    position_mb,
    n_samples:      nValid,
    n_changed:      nChanged,
    transition_rate,
    edges,
  };
}

// =====================================================================
// Full transition graph
// =====================================================================

/**
 * Walk every adjacent L2 envelope pair and compute per-boundary stats.
 * Returns:
 *   { boundaries: [...], hotspots: [...] }
 *
 * `state.data.l2_envelopes` supplies the envelope list. Callbacks:
 *   - getCluster(idx) → cluster ({ labels, fixedKLabels? }) or null
 *   - getPerm(leftIdx, rightIdx) → permutation array or null (identity
 *     fallback applies when null is returned)
 *
 * @param {Object} state
 * @param {{getCluster:Function, getPerm:Function, minSamples?:number,
 *         hotspotThreshold?:number}} opts
 * @returns {{boundaries:Array<Object>, hotspots:Array<Object>}}
 */
export function computeStructuralHaplotypeTransitionGraph(state, opts) {
  const out = { boundaries: [], hotspots: [] };
  const o = opts || {};
  const getCluster = o.getCluster;
  const getPerm    = o.getPerm;
  if (typeof getCluster !== 'function') return out;

  const envs = (state && state.data && Array.isArray(state.data.l2_envelopes))
    ? state.data.l2_envelopes : null;
  if (!envs || envs.length < 2) return out;

  const threshold = Number.isFinite(o.hotspotThreshold)
    ? o.hotspotThreshold : SHTG_HOTSPOT_THRESHOLD;
  const minSamples = Number.isFinite(o.minSamples) ? o.minSamples : SHTG_MIN_SAMPLES;

  for (let i = 0; i < envs.length - 1; i++) {
    const cl = getCluster(i);
    const cr = getCluster(i + 1);
    if (!cl || !cr) continue;
    const perm = (typeof getPerm === 'function') ? getPerm(i, i + 1) : null;
    const stats = computeShtgBoundaryStats(cl, cr, perm, {
      leftIdx:       i,
      rightIdx:      i + 1,
      leftEnvelope:  envs[i],
      rightEnvelope: envs[i + 1],
      minSamples,
    });
    if (stats) out.boundaries.push(stats);
  }
  out.hotspots = out.boundaries
    .filter(b => b.transition_rate >= threshold)
    .slice()
    .sort((a, b) => b.transition_rate - a.transition_rate);
  return out;
}

// =====================================================================
// Display summary
// =====================================================================

// =====================================================================
// Canvas strip drawer
// =====================================================================

/**
 * Paint the transition-rate strip near the bottom of the PC1 panel.
 * One vertical bar per boundary at its midpoint, height encoding the
 * transition rate. Boundaries with rate ≥ hotspot threshold get a
 * full-plot-height tick. Color tiers:
 *
 *   rate ≥ hotspotThreshold   → red
 *   rate ≥ 0.15               → amber
 *   rate ≥ 0.02               → green
 *
 * Boundaries with rate < 0.02 are skipped (would be 1px and noisy).
 * Pure given the graph from computeStructuralHaplotypeTransitionGraph
 * + the canvas context. Headless-tolerant.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{l:number, t:number}} pad
 * @param {number} plotW
 * @param {number} plotH
 * @param {number} mbMin
 * @param {number} mbMax
 * @param {{boundaries:Array<{position_mb:number, transition_rate:number}>}} graph
 * @param {{hotspotThreshold?:number, stripHeight?:number}} opts
 */
export function drawTransitionRateStrip(ctx, pad, plotW, plotH, mbMin, mbMax, graph, opts) {
  if (!ctx || typeof ctx.fillRect !== 'function') return;
  if (!graph || !Array.isArray(graph.boundaries) || graph.boundaries.length === 0) return;
  const o = opts || {};
  const hotspotThr = Number.isFinite(o.hotspotThreshold)
    ? o.hotspotThreshold : SHTG_HOTSPOT_THRESHOLD;
  const stripH = Number.isFinite(o.stripHeight) ? o.stripHeight : 5;
  const stripY = pad.t + plotH - stripH - 1;
  const mbToX = (mb) => pad.l + ((mb - mbMin) / (mbMax - mbMin)) * plotW;

  if (typeof ctx.save === 'function') ctx.save();

  // Faint background
  ctx.fillStyle = 'rgba(40, 50, 70, 0.25)';
  ctx.fillRect(pad.l, stripY, plotW, stripH);

  for (const b of graph.boundaries) {
    if (!b || !Number.isFinite(b.position_mb)) continue;
    if (b.position_mb < mbMin || b.position_mb > mbMax) continue;
    const x = mbToX(b.position_mb);
    const r = Math.max(0, Math.min(1, Number.isFinite(b.transition_rate) ? b.transition_rate : 0));
    if (r < 0.02) continue;
    const barH = r * stripH;
    let color;
    if (r >= hotspotThr)   color = 'rgba(224, 85, 92, 0.90)';
    else if (r >= 0.15)    color = 'rgba(245, 165, 36, 0.80)';
    else                   color = 'rgba(60, 192, 138, 0.60)';
    ctx.fillStyle = color;
    ctx.fillRect(x - 1.5, stripY + (stripH - barH), 3, barH);

    // Full-plot-height hotspot tick
    if (r >= hotspotThr && typeof ctx.beginPath === 'function' && typeof ctx.stroke === 'function') {
      ctx.strokeStyle = 'rgba(224, 85, 92, 0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, pad.t);
      ctx.lineTo(x + 0.5, pad.t + plotH);
      ctx.stroke();
    }
  }

  if (typeof ctx.strokeRect === 'function') {
    ctx.strokeStyle = 'rgba(120, 128, 140, 0.40)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(pad.l, stripY, plotW, stripH);
  }

  if (typeof ctx.restore === 'function') ctx.restore();
}

/**
 * Per-boundary summary suitable for inline display:
 *   { position_mb, transition_rate, n_changed, n_samples,
 *     is_hotspot, top_edges_label }
 *
 * `top_edges_label` is a human-readable string like
 *   "B0→B0: 80, B1→B2: 30"
 * showing the top-3 edges by count.
 *
 * @param {Object} stats   from computeShtgBoundaryStats
 * @param {number?} hotspotThreshold  defaults to SHTG_HOTSPOT_THRESHOLD
 * @returns {Object|null}
 */
export function summarizeTransitionBoundary(stats, hotspotThreshold) {
  if (!stats) return null;
  const thr = Number.isFinite(hotspotThreshold) ? hotspotThreshold : SHTG_HOTSPOT_THRESHOLD;
  const topEdges = (stats.edges || []).slice(0, 3).map(e =>
    'B' + e.from_band + '→B' + e.to_band + ':' + e.count);
  return {
    position_mb:     stats.position_mb,
    transition_rate: stats.transition_rate,
    n_changed:       stats.n_changed,
    n_samples:       stats.n_samples,
    is_hotspot:      stats.transition_rate >= thr,
    top_edges_label: topEdges.join(', '),
  };
}
