// pages/discovery/local_pca_dosage/band_diagnostics.js
//
// computeBandDiagnostics (legacy lines 15254-15583, ~330 LOC). Reads
// per-band statistics from the data layers that local_pca_dosage already carries
// (GHSL panel, θπ panel, ROH intervals, sample-FROH) and surfaces:

// 2026-05-19: was '../../shared/...' which from this file's location
// (atlases/inversion/pages/discovery/local_pca_dosage/) resolves to
// atlases/inversion/pages/shared/ — that dir doesn't exist, so the
// import 404'd at module load. Every sibling in this directory uses
// '../../../shared/' (three '..') to climb out of local_pca_dosage/ →
// discovery/ → pages/ before hitting atlases/inversion/shared/. This
// file was the outlier; fixed.
import { computeHetRateForRange } from '../../../shared/dosage_chunks.js';
//
//   - Per-band rows with mean/median for each available source
//     (GHSL, het, theta_pi, ROH overlap %, FROH).
//   - Confounder flags per band:
//       GHSL_support       — ghsl_mean spread > 1.3× across bands
//       theta_pi_shift     — theta_pi_mean spread > 1.3× across bands
//       het_high           — one band > 1.5× max(other bands)
//       middle_het_support — K=3 only; middle band > 1.2× both flanks
//       ROH_confounded     — one band's overlap_pct > max(2× others, 5%)
//       FROH_high          — one band's froh_mean > 1.5× max of others
//   - het_shape: 16-bin histogram + support_ratio (middle-vs-flanks for
//     K=3, max/min spread otherwise) with passes/marginal flags.
//
// Pure data reduction — reads state.data, no DOM, no mutation. The
// legacy version read `state` as a global; here state is the first arg.

/**
 * Compute per-band diagnostics for an L2 envelope's K-means clustering.
 *
 * @param {Object} state                       local_pca_dosage _pageState (read-only)
 * @param {{labels:ArrayLike<number>, usedK:number}} cl  cluster result
 * @param {{start_bp:number, end_bp:number}} env         L2 envelope
 * @param {number} [l2idx]                      reserved (legacy parity)
 * @returns {{bands: Array, data_status: Object, het_shape: Object|null} | null}
 */
export function computeBandDiagnostics(state, cl, env, l2idx) {
  if (!cl || !cl.labels || cl.usedK == null) return null;
  if (!env || !state || !state.data) return null;
  const K = cl.usedK;
  const labels = cl.labels;
  const n_samples = state.data.n_samples;

  // Build per-band sample lists
  const sampleIdxByBand = Array.from({ length: K }, () => []);
  for (let s = 0; s < n_samples; s++) {
    const k = labels[s];
    if (k >= 0 && k < K) sampleIdxByBand[k].push(s);
  }

  // 2026-05-20: adapt the modern theta-pi schema (theta_pi_per_window) to
  // the legacy "panel" shape this function consumes. The legacy
  // theta_pi_panel.div_roll was a single per-sample × per-window matrix
  // with parallel start_bp / end_bp arrays. theta_pi_per_window.values
  // already IS per-sample × per-window; its windows[] carry start_bp/end_bp.
  // Hoist into a synthetic panel so the L3 chips actually compute instead
  // of rendering '?' (the user's report on 2026-05-20: "We need to
  // calculate the values for het and so on in the contingency tables L3").
  function _tpiPanelFromPerWindow(d) {
    const tpw = d && d.theta_pi_per_window;
    if (!tpw || !Array.isArray(tpw.values) || !Array.isArray(tpw.windows)) return null;
    if (tpw.windows.length === 0) return null;
    const start_bp = tpw.windows.map(w => w && Number.isFinite(w.start_bp) ? w.start_bp : NaN);
    const end_bp   = tpw.windows.map(w => w && Number.isFinite(w.end_bp)   ? w.end_bp   : NaN);
    // Sanity: at least the first window must have valid bp; otherwise the
    // env-overlap predicate in _perSampleMeanPanel will reject everything.
    if (!Number.isFinite(start_bp[0]) || !Number.isFinite(end_bp[0])) return null;
    return {
      primary_scale: 'default',
      div_roll:      { default: tpw.values },
      start_bp,
      end_bp,
    };
  }
  // 2026-05-20: GHSL panel adapter. The modern GHSL precomp ships its
  // signal as ghsl_local_pca.pc_loadings_aligned[npc][nwin][nsamples] —
  // we synthesize a panel-shape matrix M[sample_idx][window_idx] where
  // each cell is |PC1| (the haplotype-divergence-direction magnitude).
  // The legacy ghsl_panel.div_roll carried phased-SNP heterozygous-block
  // fraction; |PC1| is a reasonable proxy for "how strongly this sample
  // separates along the local-PCA divergence axis" — high for the
  // minority arrangement, low for the majority.
  // Falls back to checking d.ghsl_view.{ghsl_local_pca, local_pca} for
  // the namespaced merge path (see pca_comparator/renderer.js for the
  // same fallback chain).
  function _ghslPanelFromLocalPca(d) {
    const lp =
         (d && d.ghsl_local_pca)
      || (d && d.ghsl_view && d.ghsl_view.ghsl_local_pca)
      || (d && d.ghsl_view && d.ghsl_view.local_pca);
    if (!lp || !Array.isArray(lp.pc_loadings_aligned)) return null;
    const pc1ByWin = lp.pc_loadings_aligned[0];
    if (!Array.isArray(pc1ByWin) || pc1ByWin.length === 0) return null;
    // Need per-window bp positions for the env-overlap predicate. Pull
    // from theta_pi_per_window.windows / data.windows depending on what
    // the GHSL precomp aligned to. The synthesized ghsl_view.windows is
    // the cleanest source (idx, start_bp, end_bp).
    const wins =
         (d && d.ghsl_view && Array.isArray(d.ghsl_view.windows) && d.ghsl_view.windows)
      || (d && Array.isArray(d.windows) && d.windows)
      || null;
    if (!wins) return null;
    const nW = Math.min(pc1ByWin.length, wins.length);
    if (nW === 0) return null;
    // Build M[sample][window] = |pc1|. pc_loadings_aligned is window-major
    // (pc1ByWin[w] is a length-nS array). We transpose to sample-major so
    // _perSampleMeanPanel's M[s][w] lookup works without rebuilding.
    let nS = 0;
    for (let i = 0; i < nW; i++) {
      const row = pc1ByWin[i];
      if (row && row.length > nS) nS = row.length;
    }
    if (nS === 0) return null;
    const M = new Array(nS);
    for (let s = 0; s < nS; s++) {
      const out = new Float32Array(nW);
      for (let i = 0; i < nW; i++) {
        const v = pc1ByWin[i] && pc1ByWin[i][s];
        out[i] = Number.isFinite(v) ? Math.abs(v) : NaN;
      }
      M[s] = out;
    }
    const start_bp = new Array(nW);
    const end_bp   = new Array(nW);
    for (let i = 0; i < nW; i++) {
      const w = wins[i] || {};
      start_bp[i] = Number.isFinite(w.start_bp) ? w.start_bp : NaN;
      end_bp[i]   = Number.isFinite(w.end_bp)   ? w.end_bp   : NaN;
    }
    if (!Number.isFinite(start_bp[0]) || !Number.isFinite(end_bp[0])) return null;
    return {
      primary_scale: 'default',
      div_roll:      { default: M },
      start_bp,
      end_bp,
    };
  }
  // Source presence — try the legacy paths first, fall back to the
  // schema v2 fields. ghsl_panel + theta_pi_panel are the legacy names;
  // theta_pi_per_window is what the modern pipeline ships.
  // 2026-05-20: GHSL panel synthesized from ghsl_local_pca.pc_loadings_aligned
  // (per-sample × per-window PC1 magnitudes) when the legacy ghsl_panel is
  // absent — that's what the modern GHSL precomp emits. Het uses the
  // dosage_chunks bridge directly (computed below), so it no longer rides
  // on the GHSL panel.
  const ghslPanel = state.data.ghsl_panel || _ghslPanelFromLocalPca(state.data);
  const tpiPanel  = state.data.theta_pi_panel || _tpiPanelFromPerWindow(state.data);
  const rohList   = Array.isArray(state.data.roh_intervals)
    ? state.data.roh_intervals : null;
  const frohArr   = (state.data.sample_froh && state.data.sample_froh.length === n_samples)
    ? state.data.sample_froh : null;
  // Het availability: chunk fetcher is installed iff dosage_chunks layer
  // is present. computeHetRateForRange returns NaN-filled when no
  // covering chunk is cached, so the chip will show "computing…" style
  // empty values until the fetch lands and a subsequent paint triggers.
  const hasHetSource = !!(state._linesPanelGetCachedChunk);
  const data_status = {
    ghsl:     !!(ghslPanel && ghslPanel.div_roll && ghslPanel.start_bp && ghslPanel.end_bp),
    theta_pi: !!(tpiPanel  && tpiPanel.div_roll  && tpiPanel.start_bp  && tpiPanel.end_bp),
    het:      hasHetSource,
    roh:      !!rohList,
    froh:     !!frohArr,
  };
  // Pre-compute het for ALL samples in this env's bp range once; per-band
  // means below just filter by sample index. NaN-filled when the chunk
  // isn't cached yet — the fetcher's onLoad callback will retrigger the
  // L3 panel render via the panel's existing cache-invalidation chain.
  let hetFullCohort = null;
  if (hasHetSource && Number.isFinite(env.start_bp) && Number.isFinite(env.end_bp)) {
    try {
      hetFullCohort = computeHetRateForRange(state, env.start_bp, env.end_bp, {
        getCachedChunk: state._linesPanelGetCachedChunk,
        cacheKey: 'band_diag:het:' + env.start_bp + ':' + env.end_bp,
      });
    } catch (e) { console.warn('band_diag het compute:', e); }
  }

  // Helper — per-sample mean over panel windows whose bp midpoint falls
  // inside the env's bp range. Returns Float64Array(n_samples), values
  // may be NaN if sample has no covered windows.
  function _perSampleMeanPanel(panel, sampleIdx) {
    if (!panel) return null;
    const scaleKey = panel.primary_scale ||
                     (panel.scales && panel.scales[0]) ||
                     Object.keys(panel.div_roll || {})[0];
    if (!scaleKey || !panel.div_roll[scaleKey]) return null;
    const M = panel.div_roll[scaleKey];
    if (!Array.isArray(M) || M.length === 0) return null;
    const sBp = panel.start_bp, eBp = panel.end_bp;
    if (!sBp || !eBp || sBp.length !== eBp.length) return null;
    const lo = env.start_bp, hi = env.end_bp;
    const cols = [];
    const N = sBp.length;
    for (let i = 0; i < N; i++) {
      const mid = (sBp[i] + eBp[i]) / 2;
      if (mid >= lo && mid <= hi) cols.push(i);
    }
    if (cols.length === 0) return null;
    const out = new Float64Array(sampleIdx.length);
    for (let si = 0; si < sampleIdx.length; si++) {
      const s = sampleIdx[si];
      const row = M[s];
      if (!row) { out[si] = NaN; continue; }
      let sum = 0, n = 0;
      for (const c of cols) {
        const v = row[c];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      out[si] = n > 0 ? (sum / n) : NaN;
    }
    return out;
  }

  // Helper — per-sample ROH coverage of the interval, returned as
  // fraction-of-interval-length (0..1). Samples with no ROH overlapping
  // the interval get 0 (NOT NaN). NaN if the ROH layer is absent.
  function _perSampleRohFrac(sampleIdx) {
    if (!rohList) return null;
    const lo = env.start_bp, hi = env.end_bp;
    const len = Math.max(1, hi - lo);
    const sampleSet = new Set(sampleIdx);
    const sumBp = new Map();
    for (const r of rohList) {
      if (!sampleSet.has(r.sample_idx)) continue;
      const a = Math.max(lo, r.start_bp);
      const b = Math.min(hi, r.end_bp);
      if (b <= a) continue;
      sumBp.set(r.sample_idx, (sumBp.get(r.sample_idx) || 0) + (b - a));
    }
    const out = new Float64Array(sampleIdx.length);
    for (let i = 0; i < sampleIdx.length; i++) {
      const s = sampleIdx[i];
      const bp = sumBp.get(s) || 0;
      out[i] = Math.min(1, bp / len);
    }
    return out;
  }

  // Helper — mean / median over a Float64Array, ignoring NaN.
  function _meanMedian(arr) {
    if (!arr || arr.length === 0) return { mean: null, median: null, n_valid: 0 };
    const valid = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (Number.isFinite(v)) valid.push(v);
    }
    if (valid.length === 0) return { mean: null, median: null, n_valid: 0 };
    valid.sort((a, b) => a - b);
    let s = 0;
    for (const v of valid) s += v;
    const mean = s / valid.length;
    const median = valid.length % 2 === 1
      ? valid[(valid.length - 1) >> 1]
      : 0.5 * (valid[valid.length / 2 - 1] + valid[valid.length / 2]);
    return { mean, median, n_valid: valid.length };
  }

  // Build per-band rows
  const bands = [];
  for (let k = 0; k < K; k++) {
    const idx = sampleIdxByBand[k];
    const n = idx.length;
    const row = {
      k, n,
      ghsl_mean: null,     ghsl_median: null,
      theta_pi_mean: null, theta_pi_median: null,
      het_mean: null,      het_median: null,
      roh_overlap_pct: null,
      roh_frac_mean: null, roh_frac_median: null,
      froh_mean: null,     froh_median: null,
      flags: [],
    };
    if (n === 0) { bands.push(row); continue; }

    if (data_status.ghsl) {
      const v = _perSampleMeanPanel(ghslPanel, idx);
      const mm = _meanMedian(v);
      row.ghsl_mean = mm.mean; row.ghsl_median = mm.median;
    }
    if (data_status.het) {
      // 2026-05-20: het now uses the dosage-chunk-backed hetFullCohort
      // computed above (computeHetRateForRange over the env's bp range).
      // Legacy used the GHSL panel's primary scale, but the modern GHSL
      // precomp doesn't ship the phased-SNP het matrix — dosage chunks
      // (genotype 1 = het) are the direct source. Filter the cohort-wide
      // het vector down to this band's sample indices.
      let v = null;
      if (hetFullCohort) {
        v = new Float64Array(idx.length);
        for (let i = 0; i < idx.length; i++) v[i] = hetFullCohort[idx[i]];
      }
      const mm = _meanMedian(v);
      row.het_mean = mm.mean; row.het_median = mm.median;
      // v3.93: stash the per-sample het vector so downstream het_shape
      // can build a histogram. Stripped from output before returning.
      const vals = [];
      if (v) for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) vals.push(v[i]);
      row._het_vals = vals;
    }
    if (data_status.theta_pi) {
      const v = _perSampleMeanPanel(tpiPanel, idx);
      const mm = _meanMedian(v);
      row.theta_pi_mean = mm.mean; row.theta_pi_median = mm.median;
    }
    if (data_status.roh) {
      const v = _perSampleRohFrac(idx);
      let nWithOverlap = 0;
      for (let i = 0; i < v.length; i++) if (v[i] > 0) nWithOverlap++;
      row.roh_overlap_pct = (nWithOverlap / v.length) * 100;
      const mm = _meanMedian(v);
      row.roh_frac_mean = mm.mean; row.roh_frac_median = mm.median;
    }
    if (data_status.froh) {
      const fr = new Float64Array(idx.length);
      for (let i = 0; i < idx.length; i++) fr[i] = frohArr[idx[i]];
      const mm = _meanMedian(fr);
      row.froh_mean = mm.mean; row.froh_median = mm.median;
    }
    bands.push(row);
  }

  // ---- flag computation ----
  function _vec(field) {
    return bands.map(b => b[field]).filter(v => v != null && Number.isFinite(v));
  }
  function _maxOf(arr) { return arr.length === 0 ? null : Math.max(...arr); }
  function _minOf(arr) { return arr.length === 0 ? null : Math.min(...arr); }

  // GHSL_support: spread > 1.3× between max and min band
  if (data_status.ghsl) {
    const gv = _vec('ghsl_mean');
    const gMax = _maxOf(gv), gMin = _minOf(gv);
    if (gMax != null && gMin != null && gMin > 0 && gMax / gMin > 1.3) {
      const argmax = bands.reduce((best, b, i) =>
        (b.ghsl_mean != null && (best == null || b.ghsl_mean > bands[best].ghsl_mean)) ? i : best, null);
      if (argmax != null) bands[argmax].flags.push('GHSL_support');
    }
  }
  // theta_pi_shift: same logic
  if (data_status.theta_pi) {
    const tv = _vec('theta_pi_mean');
    const tMax = _maxOf(tv), tMin = _minOf(tv);
    if (tMax != null && tMin != null && tMin > 0 && tMax / tMin > 1.3) {
      const argmax = bands.reduce((best, b, i) =>
        (b.theta_pi_mean != null && (best == null || b.theta_pi_mean > bands[best].theta_pi_mean)) ? i : best, null);
      if (argmax != null) bands[argmax].flags.push('theta_pi_shift');
    }
  }
  // het_high: one band > 1.5× max of others
  if (data_status.het) {
    for (let i = 0; i < bands.length; i++) {
      const me = bands[i].het_mean;
      if (me == null) continue;
      const others = bands.filter((_, j) => j !== i)
        .map(b => b.het_mean).filter(v => v != null);
      const mx = _maxOf(others);
      if (mx != null && mx > 0 && me / mx > 1.5) {
        bands[i].flags.push('het_high');
      }
    }
    // middle_het_support: K=3 only
    if (K === 3 && bands.length === 3 &&
        bands[1].het_mean != null && bands[0].het_mean != null && bands[2].het_mean != null) {
      const m = bands[1].het_mean, l = bands[0].het_mean, r = bands[2].het_mean;
      if (m > l * 1.2 && m > r * 1.2) {
        bands[1].flags.push('middle_het_support');
      }
    }
  }
  // ROH_confounded: one band's overlap pct > max(2× others, 5%)
  if (data_status.roh) {
    for (let i = 0; i < bands.length; i++) {
      const me = bands[i].roh_overlap_pct;
      if (me == null) continue;
      const others = bands.filter((_, j) => j !== i)
        .map(b => b.roh_overlap_pct).filter(v => v != null);
      const mx = _maxOf(others);
      if (mx != null && me > Math.max(2 * mx, 5)) {
        bands[i].flags.push('ROH_confounded');
      }
    }
  }
  // FROH_high: one band's froh_mean > 1.5× max of others
  if (data_status.froh) {
    for (let i = 0; i < bands.length; i++) {
      const me = bands[i].froh_mean;
      if (me == null) continue;
      const others = bands.filter((_, j) => j !== i)
        .map(b => b.froh_mean).filter(v => v != null);
      const mx = _maxOf(others);
      if (mx != null && mx > 0 && me / mx > 1.5) {
        bands[i].flags.push('FROH_high');
      }
    }
  }

  // ---- v3.93: het_shape — per-band histogram + support ratio ----
  let het_shape = null;
  if (data_status.het) {
    const N_BINS = 16;
    const BIN_LO = 0.0, BIN_HI = 1.0;
    const binEdges = new Float64Array(N_BINS + 1);
    for (let i = 0; i <= N_BINS; i++) {
      binEdges[i] = BIN_LO + (i / N_BINS) * (BIN_HI - BIN_LO);
    }
    const counts_per_band = bands.map(b => {
      const counts = new Int32Array(N_BINS);
      const vals = b._het_vals || [];
      for (const v of vals) {
        let bi = Math.floor(((Math.max(0, Math.min(1, v)) - BIN_LO) / (BIN_HI - BIN_LO)) * N_BINS);
        if (bi >= N_BINS) bi = N_BINS - 1;
        if (bi < 0) bi = 0;
        counts[bi]++;
      }
      return Array.from(counts);
    });
    let support_ratio = null, support_kind = 'none';
    const med = bands.map(b => b.het_median).filter(v => v != null);
    if (med.length >= 2) {
      if (K === 3 && bands.length === 3 &&
          bands[0].het_median != null && bands[1].het_median != null &&
          bands[2].het_median != null) {
        const flanks = 0.5 * (bands[0].het_median + bands[2].het_median);
        if (flanks > 0) {
          support_ratio = bands[1].het_median / flanks;
          support_kind = 'middle_vs_flanks';
        }
      }
      if (support_ratio == null) {
        const mx = Math.max(...med), mn = Math.min(...med);
        if (mn > 0) {
          support_ratio = mx / mn;
          support_kind = 'max_min_spread';
        }
      }
    }
    let support_passes = false, support_marginal = false;
    if (support_ratio != null) {
      if (support_ratio >= 1.5) support_passes = true;
      else if (support_ratio >= 1.2) support_marginal = true;
    }
    het_shape = {
      n_bins: N_BINS,
      bin_lo: BIN_LO, bin_hi: BIN_HI,
      bin_edges: Array.from(binEdges),
      counts_per_band,
      support_ratio,
      support_kind,
      support_passes,
      support_marginal,
    };
  }
  // Strip the working _het_vals from bands before returning.
  for (const b of bands) delete b._het_vals;

  return { bands, data_status, het_shape };
}
