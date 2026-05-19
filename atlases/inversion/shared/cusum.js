// atlases/inversion/shared/cusum.js
//
// Per-sample CUSUM (cumulative sum of residuals) + per-karyotype
// aggregator. User request (chat 2026-05-18): "the difference is the
// per sample CUSUM but I am not sure how it reflects in precomp. if
// we code the function to group it and do a mean or median cusum per
// karyotype then it could be definitely interesting."
//
// Math choice (default — see opts.residual to change):
//
//   residual_si(w) = value_si(w) − mean_over_samples(value(w))
//   CUSUM_si(w)   = Σ_{w'≤w} residual_si(w')
//
// Per-window cohort mean is what gets removed at each window — this
// makes the CUSUM a "drift from the cohort average" curve per
// sample. If sample si tracks the cohort exactly its CUSUM stays
// near zero; if it consistently lies above the cohort mean its
// CUSUM ramps up.
//
// Alternative residual options (opts.residual):
//
//   'cohort_mean'  (default) — residual = value − mean(value over samples at w)
//   'band_mean'              — residual = value − mean(value over same-band samples at w)
//                              (zero-mean by construction WITHIN each band; reveals
//                              within-band drifters)
//   'zero'                   — residual = value (no centering — raw cumulative
//                              path; useful for monotone signals like dosage)
//
// Per-karyotype aggregation: cusumGroupAggregate(cusums, labels, K)
// returns Float64Array[K] of per-band trajectories. Each band's
// trajectory is the per-window mean (or median) CUSUM across the
// samples assigned to that band. This is what the user wants to plot:
// "the HOM1 fish show this consistent CUSUM trajectory across the
// chromosome, while HET fish diverge here". Mean is the default;
// pass opts.op='median' for the robust variant.
//
// Window range is [startW, endW] inclusive — defaults to the full
// data.n_windows.

/**
 * Per-sample CUSUM trajectories.
 *
 * @param {object} state  — atlas state with .data (n_samples, n_windows, windows)
 * @param {string} axis   — 'pc1' | 'pc2' | etc.; key on data.windows[w][axis]
 * @param {{
 *   startW?: number,
 *   endW?: number,
 *   residual?: 'cohort_mean' | 'band_mean' | 'zero',
 *   labels?: ArrayLike<number>,  // required when residual='band_mean'
 *   K?: number,                  // required when residual='band_mean'
 * }} [opts]
 * @returns {Float64Array[] | null}  per-sample arrays of length (endW−startW+1)
 *                                   indexed [si][w_local]; null on bad inputs
 */
export function perSampleCusum(state, axis, opts) {
  if (!state || !state.data) return null;
  const d = state.data;
  const nS = d.n_samples | 0;
  const nW = d.n_windows | 0;
  if (nS <= 0 || nW <= 0) return null;
  const o = opts || {};
  const startW = (o.startW != null) ? Math.max(0, o.startW | 0) : 0;
  const endW   = (o.endW   != null) ? Math.min(nW - 1, o.endW | 0) : (nW - 1);
  if (endW < startW) return null;
  const residualMode = o.residual || 'cohort_mean';
  if (residualMode === 'band_mean') {
    if (!o.labels || !o.K) return null;
  }
  const ax = axis || 'pc1';
  const windows = d.windows;
  if (!windows) return null;

  const out = new Array(nS);
  for (let si = 0; si < nS; si++) out[si] = new Float64Array(endW - startW + 1);

  for (let w = startW, wi = 0; w <= endW; w++, wi++) {
    const win = windows[w];
    if (!win || !win[ax]) {
      // Window missing this axis — every sample carries forward its
      // last CUSUM (i.e. zero increment).
      for (let si = 0; si < nS; si++) {
        out[si][wi] = (wi > 0) ? out[si][wi - 1] : 0;
      }
      continue;
    }
    const vals = win[ax];

    // Compute the centering offset(s).
    let cohortMean = 0;
    let bandMean = null;  // per-band mean when residualMode === 'band_mean'
    if (residualMode === 'cohort_mean') {
      let sum = 0, cnt = 0;
      for (let si = 0; si < nS; si++) {
        const v = vals[si];
        if (Number.isFinite(v)) { sum += v; cnt++; }
      }
      cohortMean = cnt > 0 ? sum / cnt : 0;
    } else if (residualMode === 'band_mean') {
      const K = o.K | 0;
      const labels = o.labels;
      bandMean = new Float64Array(K);
      const bandCnt = new Int32Array(K);
      for (let si = 0; si < nS; si++) {
        const v = vals[si];
        const k = labels[si];
        if (!Number.isFinite(v)) continue;
        if (k < 0 || k >= K) continue;
        bandMean[k] += v;
        bandCnt[k]++;
      }
      for (let k = 0; k < K; k++) {
        if (bandCnt[k] > 0) bandMean[k] /= bandCnt[k];
        else                bandMean[k]  = 0;
      }
    }

    for (let si = 0; si < nS; si++) {
      const v = vals[si];
      const prev = (wi > 0) ? out[si][wi - 1] : 0;
      if (!Number.isFinite(v)) {
        // Missing → carry-forward; no increment.
        out[si][wi] = prev;
        continue;
      }
      let residual;
      if (residualMode === 'zero') {
        residual = v;
      } else if (residualMode === 'cohort_mean') {
        residual = v - cohortMean;
      } else {
        // band_mean
        const k = o.labels[si];
        residual = (k >= 0 && k < o.K) ? (v - bandMean[k]) : 0;
      }
      out[si][wi] = prev + residual;
    }
  }
  return out;
}

/**
 * Per-band aggregate CUSUM trajectory. For each window, computes the
 * mean (or median) CUSUM across the samples assigned to that band.
 *
 * @param {Float64Array[]} cusums  — output of perSampleCusum (length nS, each
 *                                   length nW_local)
 * @param {ArrayLike<number>} labels  — sample → band id, length nS
 * @param {number} K
 * @param {{op?: 'mean'|'median'}} [opts]
 * @returns {Float64Array[]}  per-band arrays of length nW_local
 */
export function cusumGroupAggregate(cusums, labels, K, opts) {
  const op = (opts && opts.op) || 'mean';
  if (!Array.isArray(cusums) || cusums.length === 0) return [];
  const nS = cusums.length;
  const nW = cusums[0] ? cusums[0].length : 0;
  const out = new Array(K);
  for (let k = 0; k < K; k++) out[k] = new Float64Array(nW);

  // Bucket sample indices by band ahead of time.
  const idxByBand = Array.from({ length: K }, () => []);
  for (let si = 0; si < nS; si++) {
    const k = labels[si];
    if (k >= 0 && k < K) idxByBand[k].push(si);
  }

  for (let k = 0; k < K; k++) {
    const idx = idxByBand[k];
    if (idx.length === 0) continue;
    if (op === 'median') {
      // Per-window median across band members.
      const buf = new Float64Array(idx.length);
      for (let w = 0; w < nW; w++) {
        let n = 0;
        for (const si of idx) {
          const v = cusums[si] ? cusums[si][w] : NaN;
          if (Number.isFinite(v)) buf[n++] = v;
        }
        if (n === 0) { out[k][w] = NaN; continue; }
        const sliced = buf.subarray(0, n);
        // Avoid full sort: in-place sort the slice (small N).
        const sorted = Array.from(sliced).sort((a, b) => a - b);
        out[k][w] = (n % 2 === 1)
          ? sorted[(n - 1) >> 1]
          : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
      }
    } else {
      // Mean.
      for (let w = 0; w < nW; w++) {
        let sum = 0, n = 0;
        for (const si of idx) {
          const v = cusums[si] ? cusums[si][w] : NaN;
          if (Number.isFinite(v)) { sum += v; n++; }
        }
        out[k][w] = n > 0 ? (sum / n) : NaN;
      }
    }
  }
  return out;
}

/**
 * Convenience: compute per-sample CUSUM + per-band aggregate in one
 * call. Returns { cusums, bandTraj } where bandTraj[k][w] is the
 * mean (or median) CUSUM for band k at window w.
 *
 * Mainly a sketch for the lines-panel strip / overlay: render the K
 * bold colored lines from bandTraj over a thin grey cloud of the nS
 * individual cusums.
 */
export function perSampleCusumByKaryotype(state, axis, labels, K, opts) {
  const o = opts || {};
  const residual = o.residual || 'cohort_mean';
  const cusums = perSampleCusum(state, axis, {
    startW: o.startW, endW: o.endW,
    residual, labels, K,
  });
  if (!cusums) return null;
  const bandTraj = cusumGroupAggregate(cusums, labels, K, { op: o.op || 'mean' });
  return { cusums, bandTraj };
}

if (typeof window !== 'undefined') {
  window._perSampleCusum            = perSampleCusum;
  window._cusumGroupAggregate       = cusumGroupAggregate;
  window._perSampleCusumByKaryotype = perSampleCusumByKaryotype;
  window._perSampleCusumPanel       = perSampleCusumPanel;
}

// ---------------------------------------------------------------------
// Panel-flavoured CUSUM for sparse / multi-scale layers
//
// θπ and GHSL aren't on the dense per-window PCA grid — they live on
// panel objects like state.data.theta_pi_panel and state.data.ghsl_panel
// with the shape:
//
//   panel.div_roll[scaleKey][sample_idx][col_idx]   // values
//   panel.start_bp[col_idx], panel.end_bp[col_idx]  // bp range per col
//   panel.scales = [scaleKey, ...]                   // available scales
//   panel.primary_scale                              // default scale
//
// Different scales = different column densities. The user
// (chat 2026-05-18): "for theta pi or GHSL haplotype divergence by
// sequence length its a bit too sparse in markers. so we must
// consider a bit more dense scale". perSampleCusumPanel lets the
// caller pick which scale to walk so they can trade sparsity for
// signal at boundary candidates.
//
// Centering / residual options + NaN carry-forward semantics match
// perSampleCusum exactly — the only difference is the column source.
// ---------------------------------------------------------------------

/**
 * Per-sample CUSUM over a panel layer (θπ / GHSL).
 *
 * @param {object} state
 * @param {string} panelKey  — 'theta_pi_panel' | 'ghsl_panel' | etc.;
 *                             must resolve to a panel with the
 *                             expected div_roll / start_bp / end_bp shape
 * @param {{
 *   scale?: string,                            // default panel.primary_scale
 *   startBp?: number, endBp?: number,          // optional bp filter
 *   residual?: 'cohort_mean'|'band_mean'|'zero',
 *   labels?: ArrayLike<number>,                // required when residual='band_mean'
 *   K?: number,                                // required when residual='band_mean'
 * }} [opts]
 * @returns {{
 *   cusums: Float64Array[],     // per-sample arrays of length nCols
 *   colStartBp: Float64Array,   // per-column bp range (for plotting)
 *   colEndBp: Float64Array,
 *   scale: string,              // resolved scale key
 *   nCols: number,
 * } | null}
 */
export function perSampleCusumPanel(state, panelKey, opts) {
  if (!state || !state.data) return null;
  const panel = state.data[panelKey];
  if (!panel || !panel.div_roll) return null;
  const o = opts || {};
  const scale = o.scale
              || panel.primary_scale
              || (panel.scales && panel.scales[0])
              || Object.keys(panel.div_roll)[0];
  if (!scale || !panel.div_roll[scale]) return null;
  const M = panel.div_roll[scale];
  if (!Array.isArray(M) || M.length === 0) return null;
  if (!panel.start_bp || !panel.end_bp
      || panel.start_bp.length !== panel.end_bp.length) return null;

  const nS = state.data.n_samples | 0;
  if (nS <= 0) return null;

  // Resolve column subset by bp range if requested.
  const N = panel.start_bp.length;
  const colIdx = [];
  const useFilter = Number.isFinite(o.startBp) && Number.isFinite(o.endBp);
  for (let i = 0; i < N; i++) {
    if (useFilter) {
      const mid = (panel.start_bp[i] + panel.end_bp[i]) / 2;
      if (mid < o.startBp || mid > o.endBp) continue;
    }
    colIdx.push(i);
  }
  if (colIdx.length === 0) return null;
  const nC = colIdx.length;

  const residualMode = o.residual || 'cohort_mean';
  if (residualMode === 'band_mean' && (!o.labels || !o.K)) return null;

  const cusums = new Array(nS);
  for (let si = 0; si < nS; si++) cusums[si] = new Float64Array(nC);

  for (let ci = 0; ci < nC; ci++) {
    const c = colIdx[ci];
    // Centering offset for this column.
    let cohortMean = 0;
    let bandMean = null;
    if (residualMode === 'cohort_mean') {
      let sum = 0, cnt = 0;
      for (let si = 0; si < nS; si++) {
        const row = M[si];
        if (!row) continue;
        const v = row[c];
        if (Number.isFinite(v)) { sum += v; cnt++; }
      }
      cohortMean = cnt > 0 ? sum / cnt : 0;
    } else if (residualMode === 'band_mean') {
      const K = o.K | 0;
      bandMean = new Float64Array(K);
      const bandCnt = new Int32Array(K);
      for (let si = 0; si < nS; si++) {
        const row = M[si];
        if (!row) continue;
        const v = row[c];
        const k = o.labels[si];
        if (!Number.isFinite(v)) continue;
        if (k < 0 || k >= K) continue;
        bandMean[k] += v;
        bandCnt[k]++;
      }
      for (let k = 0; k < K; k++) {
        if (bandCnt[k] > 0) bandMean[k] /= bandCnt[k];
        else                bandMean[k]  = 0;
      }
    }
    for (let si = 0; si < nS; si++) {
      const row = M[si];
      const v = row ? row[c] : NaN;
      const prev = (ci > 0) ? cusums[si][ci - 1] : 0;
      if (!Number.isFinite(v)) {
        cusums[si][ci] = prev;
        continue;
      }
      let residual;
      if (residualMode === 'zero') {
        residual = v;
      } else if (residualMode === 'cohort_mean') {
        residual = v - cohortMean;
      } else {
        const k = o.labels[si];
        residual = (k >= 0 && k < o.K) ? (v - bandMean[k]) : 0;
      }
      cusums[si][ci] = prev + residual;
    }
  }

  // Stash per-column bp range so the renderer can plot at bp positions
  // (panel cols aren't on the dense PCA window grid; the cusum index
  // ci doesn't correspond to dosage windows).
  const colStartBp = new Float64Array(nC);
  const colEndBp   = new Float64Array(nC);
  for (let ci = 0; ci < nC; ci++) {
    colStartBp[ci] = panel.start_bp[colIdx[ci]];
    colEndBp[ci]   = panel.end_bp[colIdx[ci]];
  }

  return { cusums, colStartBp, colEndBp, scale, nCols: nC };
}
