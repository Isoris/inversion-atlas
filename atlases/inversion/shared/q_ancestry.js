// shared/q_ancestry.js
//
// Q-association ancestry coloring. Drives the q_ancestry sample-color
// mode in page1/_state.js getSampleColor + the Q-proportion legend
// swap. Per-fish Q-vectors come from the NGSadmix K=2..20 precomp
// sweep; this module owns selection (which K is active), lookup,
// color resolution (hard / blend), and legend bars.
//
// Legacy origin: lines 36711-36941 of legacy/Inversion_atlas.html.
// Transformations from legacy:
//   - All entry points take `state` as their first argument (no
//     global `state` / `window.state` lookup).
//   - User-preference fields (state.qDisplayMode, state.qLegendMode)
//     live directly on state, same as before.
//   - Stored Q matrix shape is unchanged
//     (state._qAncestry = { K, q_vectors: Float32Array(n*K),
//      group_names, palette, available_K, admix_threshold, _all_K })
//     so existing precomp loaders keep working.
//
// SPEC_v2 alignment: the Q-vector registration is the in-memory
// equivalent of v2's q_ancestry_K layer. When Registry.write ships,
// qaRegisterK() becomes a registry.write('q_ancestry', {K}, payload)
// call and the in-memory _all_K cache becomes a thin read-through.
//
// Page-isolation: this is shared/, not page1/. Any page that wants
// to color by ancestry imports from here.

// =====================================================================
// Constants (legacy 36744-36750)
// =====================================================================

/**
 * 20-color palette tuned for Q-group distinction (handles K up to 20).
 * Frozen; clone if a consumer needs to mutate.
 */
export const QA_DEFAULT_PALETTE = Object.freeze([
  '#f5a524', '#9b59b6', '#3cc08a', '#4fa3ff', '#e0555c',
  '#16a085', '#e67e22', '#34495e', '#c0392b', '#27ae60',
  '#2980b9', '#8e44ad', '#d35400', '#7f8c8d', '#2c3e50',
  '#bdc3c7', '#e74c3c', '#1abc9c', '#f39c12', '#95a5a6',
]);

/** Default admixed-fish cutoff in hard-call mode (max_Q < this → grey). */
export const QA_ADMIX_THRESHOLD_DEFAULT = 0.7;

// =====================================================================
// Internal helpers
// =====================================================================

function _defaultGroupNames(K) {
  const out = [];
  for (let i = 0; i < K; i++) out.push('Q' + (i + 1));
  return out;
}

function _hexToRgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length !== 7) return [128, 128, 128];
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function _rgbToHex(r, g, b) {
  const h = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return '#' + h;
}

// =====================================================================
// State lifecycle
// =====================================================================

/**
 * Ensure state._qAncestry exists with the canonical shape. Also
 * initializes user-preference fields (qDisplayMode, qLegendMode)
 * with sane defaults. Idempotent.
 *
 * @param {Object} state
 * @returns {Object|null}  state._qAncestry, or null if !state
 */
export function qaEnsureState(state) {
  if (!state) return null;
  if (!state._qAncestry) {
    state._qAncestry = {
      K: null,
      q_vectors: null,
      group_names: null,
      palette: QA_DEFAULT_PALETTE.slice(),
      available_K: [],
      admix_threshold: QA_ADMIX_THRESHOLD_DEFAULT,
    };
  }
  if (!state.qDisplayMode) state.qDisplayMode = 'hard';
  if (!state.qLegendMode) state.qLegendMode = 'per_cluster';
  return state._qAncestry;
}

/**
 * Register a Q-vector matrix at a given K. Idempotent. The atlas
 * keeps the full set in state._qAncestry._all_K so the user can
 * switch K via the dropdown without re-loading.
 *
 * @param {Object} state
 * @param {number} K                          integer in 2..20
 * @param {Float32Array|Array<number>} q_vectors
 *                                            length n_samples * K, row-major
 * @param {Array<string>} [group_names]       length K, defaults to Q1..QK
 * @returns {boolean}                         true on success
 */
export function qaRegisterK(state, K, q_vectors, group_names) {
  if (!Number.isInteger(K) || K < 2 || K > 20) return false;
  if (!q_vectors) return false;
  const ui = qaEnsureState(state);
  if (!ui) return false;
  if (!ui._all_K) ui._all_K = {};
  ui._all_K[K] = {
    K,
    q_vectors: q_vectors instanceof Float32Array
      ? q_vectors : Float32Array.from(q_vectors),
    group_names: group_names || _defaultGroupNames(K),
  };
  if (!ui.available_K.includes(K)) {
    ui.available_K.push(K);
    ui.available_K.sort((a, b) => a - b);
  }
  if (ui.K == null) qaSetK(state, K);
  return true;
}

/**
 * Switch the active K. Q-vector and group_names slots are populated
 * from the cached _all_K registry. Returns false when the requested
 * K hasn't been registered.
 *
 * @param {Object} state
 * @param {number} K
 * @returns {boolean}
 */
export function qaSetK(state, K) {
  const ui = qaEnsureState(state);
  if (!ui) return false;
  if (!ui._all_K || !ui._all_K[K]) return false;
  const entry = ui._all_K[K];
  ui.K = K;
  ui.q_vectors = entry.q_vectors;
  ui.group_names = entry.group_names;
  return true;
}

/**
 * Drop all Q-ancestry state. Called on data reload. Preserves
 * qDisplayMode + qLegendMode so the user's display preference
 * survives across reloads.
 *
 * @param {Object} state
 */
export function qaClearState(state) {
  if (!state) return;
  delete state._qAncestry;
}

// =====================================================================
// Lookups
// =====================================================================

/**
 * Q-vector (length K) for sample si. Returns null if no K is selected
 * or si is out-of-range.
 *
 * @param {Object} state
 * @param {number} si
 * @returns {Float32Array|null}
 */
export function qaSampleQ(state, si) {
  const ui = qaEnsureState(state);
  if (!ui || !ui.q_vectors || ui.K == null) return null;
  if (!Number.isInteger(si) || si < 0) return null;
  const offset = si * ui.K;
  if (offset + ui.K > ui.q_vectors.length) return null;
  return ui.q_vectors.subarray(offset, offset + ui.K);
}

/**
 * Resolve dominant Q-group + max-Q for a sample. Returns
 *   { dominant: int, max_q: number, q: Float32Array }
 * or null when no Q data is registered for this sample.
 *
 * @param {Object} state
 * @param {number} si
 * @returns {{dominant:number, max_q:number, q:Float32Array}|null}
 */
export function qaResolveSample(state, si) {
  const qvec = qaSampleQ(state, si);
  if (!qvec) return null;
  let dom = 0, maxQ = qvec[0];
  for (let k = 1; k < qvec.length; k++) {
    if (qvec[k] > maxQ) { maxQ = qvec[k]; dom = k; }
  }
  return { dominant: dom, max_q: maxQ, q: qvec };
}

// =====================================================================
// Color resolver (legacy 36857-36883)
// =====================================================================

/**
 * Resolve sample color in Q-association mode. Routes between hard
 * and blend display via state.qDisplayMode (default 'hard').
 *   - 'hard'  → full color of dominant group; admixed (max_q below
 *               admix_threshold) → grey. Float-tolerant boundary
 *               (max_q exactly at threshold still gets the full
 *               color — Float32 rounding of 0.70 → 0.6999... case).
 *   - 'blend' → color weighted by the full Q-vector. Fish at
 *               60% Q1 + 40% Q2 looks halfway between the two
 *               group colors.
 *
 * Falls through to grey when no Q-vectors are registered.
 *
 * @param {Object} state
 * @param {number} si
 * @returns {string}
 */
export function qaSampleColor(state, si) {
  const ui = qaEnsureState(state);
  if (!ui) return '#888';
  const r = qaResolveSample(state, si);
  if (!r) return '#888';
  const palette = ui.palette || QA_DEFAULT_PALETTE;
  if (state.qDisplayMode === 'blend') {
    let acc_r = 0, acc_g = 0, acc_b = 0, w_sum = 0;
    for (let k = 0; k < r.q.length; k++) {
      const w = r.q[k]; if (w <= 0) continue;
      const [rr, gg, bb] = _hexToRgb(palette[k] || '#888');
      acc_r += w * rr; acc_g += w * gg; acc_b += w * bb; w_sum += w;
    }
    if (w_sum <= 0) return '#888';
    return _rgbToHex(
      Math.round(acc_r / w_sum),
      Math.round(acc_g / w_sum),
      Math.round(acc_b / w_sum));
  }
  const thr = ui.admix_threshold || QA_ADMIX_THRESHOLD_DEFAULT;
  if (r.max_q < thr - 1e-5) return '#888';
  return palette[r.dominant] || '#888';
}

// =====================================================================
// Legend Q-proportion bars (legacy 36890-36922)
// =====================================================================

/**
 * Compute Q-proportion bars for the legend.
 *   - layout 'cohort'      → one bar with cohort-wide mean Q (props
 *                            sums to 1 across K).
 *   - layout 'per_cluster' → one bar group per K-means karyotype
 *                            cluster, showing within-cluster mean Q
 *                            (figure-style: "AA cluster has Q1=85%,
 *                            Q2=15%"). Requires kmeansLabels (one
 *                            integer per sample).
 *
 * Returns null when no Q data is registered or per_cluster was
 * requested without labels.
 *
 * @param {Object} state
 * @param {'cohort'|'per_cluster'} layout
 * @param {Int8Array|Int32Array|Array<number>|null} kmeansLabels
 * @returns {Object|null}
 */
export function qaProportionBars(state, layout, kmeansLabels) {
  const ui = qaEnsureState(state);
  if (!ui || !ui.q_vectors || ui.K == null) return null;
  const nS = ui.q_vectors.length / ui.K;
  if (layout === 'cohort') {
    const props = new Float32Array(ui.K);
    for (let si = 0; si < nS; si++) {
      const qv = qaSampleQ(state, si);
      if (!qv) continue;
      for (let k = 0; k < ui.K; k++) props[k] += qv[k];
    }
    for (let k = 0; k < ui.K; k++) props[k] /= nS || 1;
    return { props, n: nS };
  }
  if (!kmeansLabels) return null;
  const clusterIds = new Set();
  for (const l of kmeansLabels) if (l != null && l >= 0) clusterIds.add(l);
  const sortedIds = Array.from(clusterIds).sort((a, b) => a - b);
  const clusters = sortedIds.map(id => {
    const props = new Float32Array(ui.K);
    let count = 0;
    for (let si = 0; si < nS; si++) {
      if (kmeansLabels[si] !== id) continue;
      const qv = qaSampleQ(state, si);
      if (!qv) continue;
      for (let k = 0; k < ui.K; k++) props[k] += qv[k];
      count++;
    }
    if (count > 0) for (let k = 0; k < ui.K; k++) props[k] /= count;
    return { id, count, props };
  });
  return { clusters };
}
