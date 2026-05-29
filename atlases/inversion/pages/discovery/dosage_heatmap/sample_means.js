// pages/discovery/dosage_heatmap/sample_means.js
// =====================================================================
// Per-sample mean computations for the dosage-heatmap left tracks.
//
// Reads upstream chrom-precomp data (theta_pi_per_window, ghsl_panel)
// and the canonical heatmap data (cellValue) to produce three
// per-sample Float32Arrays that the renderer's continuous left tracks
// consume:
//
//   sample_het_dosage_mean[s]    — fraction of markers in (0.5, 1.5] (het-ish)
//   sample_theta_pi_mean[s]      — mean θπ across the chrom's windows
//   sample_ghsl_mean[s]          — mean GHSL div_roll across the chrom's
//                                  windows at the panel's primary scale
//
// Each computation is conditional on the backing data being present;
// returns `null` when unavailable so the renderer auto-hides the track.
//
// Pure compute, no DOM.
// =====================================================================

/**
 * Mean het-dosage per sample: fraction of markers where dosage rounds
 * to 1 (heterozygous call). `cellValue(m, s)` returns null for NA;
 * those are skipped (not counted as missing-het).
 *
 * @param {Object} canonical  output of adaptMglHeatmapJson / adaptLegacyChunk
 * @returns {Float32Array|null}
 */
export function computeSampleHetDosageMean(canonical) {
  if (!canonical || typeof canonical.cellValue !== 'function') return null;
  const nS = canonical.n_samples | 0;
  const nM = canonical.n_markers | 0;
  if (nS <= 0 || nM <= 0) return null;
  const out = new Float32Array(nS);
  const cellValue = canonical.cellValue;
  for (let s = 0; s < nS; s++) {
    let n = 0, het = 0;
    for (let m = 0; m < nM; m++) {
      const v = cellValue(m, s);
      if (v == null || !Number.isFinite(v)) continue;
      n++;
      if (v > 0.5 && v <= 1.5) het++;
    }
    out[s] = n > 0 ? (het / n) : NaN;
  }
  return out;
}

/**
 * Mean θπ per sample from `data.theta_pi_per_window`. Handles both
 * shapes flagged by `page1_data_helpers.js`:
 *   - flat Float32Array[n_samples * n_windows] (row-major by sample)
 *   - Array<Float32Array> indexed by sample
 *
 * @param {Object} chromData    state.data on the chrom precomp
 * @returns {Float32Array|null}
 */
export function computeSampleThetaPiMean(chromData) {
  if (!chromData) return null;
  const p = chromData.theta_pi_per_window;
  if (!p || !Array.isArray(p.samples) || !Array.isArray(p.windows)) return null;
  const nS = p.samples.length | 0;
  const nW = p.windows.length | 0;
  if (nS <= 0 || nW <= 0) return null;
  const values = p.values;
  if (!values) return null;
  const out = new Float32Array(nS);
  const isFlat = ArrayBuffer.isView(values) || (Array.isArray(values) && typeof values[0] === 'number');
  for (let s = 0; s < nS; s++) {
    let n = 0, sum = 0;
    if (isFlat) {
      const base = s * nW;
      for (let w = 0; w < nW; w++) {
        const v = values[base + w];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
    } else {
      const row = values[s];
      if (!row) { out[s] = NaN; continue; }
      const lim = Math.min(nW, row.length);
      for (let w = 0; w < lim; w++) {
        const v = row[w];
        if (Number.isFinite(v)) { sum += v; n++; }
      }
    }
    out[s] = n > 0 ? (sum / n) : NaN;
  }
  return out;
}

/**
 * Mean GHSL per sample from `data.ghsl_panel.div_roll[primary_scale]`.
 * Aligns the panel's `samples[]` ordering to the canonical heatmap's
 * `sample_labels[]` when both are present; otherwise assumes index
 * parity.
 *
 * @param {Object} chromData    state.data on the chrom precomp
 * @param {Object} [canonical]  used for sample-label alignment
 * @returns {Float32Array|null}
 */
export function computeSampleGhslMean(chromData, canonical) {
  if (!chromData) return null;
  const panel = chromData.ghsl_panel;
  if (!panel || !panel.div_roll) return null;
  const scale = panel.primary_scale || (panel.scales && panel.scales[0]);
  if (!scale) return null;
  const M = panel.div_roll[scale];
  if (!M) return null;

  const panelSamples = Array.isArray(panel.samples) ? panel.samples : null;
  const heatmapSamples = canonical && Array.isArray(canonical.sample_labels)
    ? canonical.sample_labels : null;
  const nOut = canonical ? (canonical.n_samples | 0) : (panelSamples ? panelSamples.length : M.length);
  if (nOut <= 0) return null;

  // Sample index map: out_idx → panel_idx.
  let mapToPanel;
  if (panelSamples && heatmapSamples && panelSamples.length === heatmapSamples.length) {
    const lookup = new Map();
    for (let i = 0; i < panelSamples.length; i++) lookup.set(String(panelSamples[i]), i);
    mapToPanel = new Int32Array(nOut);
    for (let i = 0; i < nOut; i++) {
      const pi = lookup.has(String(heatmapSamples[i])) ? lookup.get(String(heatmapSamples[i])) : i;
      mapToPanel[i] = pi;
    }
  } else {
    mapToPanel = null;        // identity
  }

  const out = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const pi = mapToPanel ? mapToPanel[i] : i;
    const row = (pi >= 0 && pi < M.length) ? M[pi] : null;
    if (!row) { out[i] = NaN; continue; }
    let n = 0, sum = 0;
    for (let w = 0; w < row.length; w++) {
      const v = row[w];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    out[i] = n > 0 ? (sum / n) : NaN;
  }
  return out;
}
