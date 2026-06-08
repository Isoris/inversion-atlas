// pages/discovery/dosage_heatmap/ghsl_track.js
// =====================================================================
// On-chromosome GHSL curves — Track 1 of the GHSL / HWE_F_IS overlay.
//
// GHSL (windowed homologous haplotype divergence) lives in the data as a
// per-sample, per-window panel (`ghsl_panel.div_roll[scale]`, jagged
// [sample][window]). The existing UI shows it only as a per-SAMPLE left
// track (one value per fish). This module instead produces curves ALONG
// the chromosome (x = genomic window):
//
//   - per-sample trajectories   (the raw [sample][window] matrix)
//   - per-karyogroup trajectories (mean GHSL per window within each
//                                  detected karyogroup / arrangement block)
//   - across-sample summaries    (median / P90 / mean per window)
//
// This is the haplotype-divergence BACKGROUND layer: it shows where
// homologous haplotypes are unusually divergent, but says nothing on its
// own about population genotype-frequency excess/deficit — that is the
// HWE_F_IS layer (Track 2, imported via hwe_fis_adapter.js). Only the
// overlay of the two is interpretable.
//
// Pure compute. No DOM.
// =====================================================================
import { karyogroupName } from './dosage_detect.js';

/**
 * @param {Object} chromData   state.data (reads chromData.ghsl_panel)
 * @param {Object} [opts]
 *   scale?: string             panel scale key (default primary_scale)
 *   panelLabels?: Int32Array   karyogroup id per PANEL sample (-1 = none);
 *                              when given, per-karyogroup curves are built
 *   k?: number                 #karyogroups (else inferred from panelLabels)
 *   maxSamplesKept?: number    cap on per-sample trajectories returned
 *                              (rendering guard; default 400, 0 = all)
 * @returns {Object|null}
 *   { scale, n_windows, win_x, per_sample, per_karyo, median, p90, mean,
 *     n_used, vmin, vmax }
 */
export function buildGhslChromCurves(chromData, opts) {
  const o = opts || {};
  const panel = chromData && chromData.ghsl_panel;
  if (!panel || !panel.div_roll) return null;
  const scale = o.scale || panel.primary_scale || (panel.scales && panel.scales[0]);
  if (!scale) return null;
  const M = panel.div_roll[scale];
  if (!M || !M.length) return null;

  const nP = M.length;                       // panel samples
  // Window count = widest row (rows can be jagged / NaN-padded).
  let W = 0;
  for (let s = 0; s < nP; s++) { const r = M[s]; if (r && r.length > W) W = r.length; }
  if (W <= 0) return null;

  const win_x = _windowX(panel, scale, W);

  // Across-sample per-window summaries + global value range.
  const median = new Float32Array(W).fill(NaN);
  const p90    = new Float32Array(W).fill(NaN);
  const mean   = new Float32Array(W).fill(NaN);
  const n_used = new Int32Array(W);
  let vmin = Infinity, vmax = -Infinity;
  const col = new Float64Array(nP);
  for (let w = 0; w < W; w++) {
    let n = 0, sum = 0;
    for (let s = 0; s < nP; s++) {
      const r = M[s]; const v = r && w < r.length ? r[w] : NaN;
      if (Number.isFinite(v)) { col[n++] = v; sum += v; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    }
    n_used[w] = n;
    if (n > 0) {
      mean[w] = sum / n;
      const sub = col.slice(0, n).sort();
      median[w] = _quantileSorted(sub, 0.5);
      p90[w]    = _quantileSorted(sub, 0.9);
    }
  }
  if (!(vmin < vmax)) { vmin = 0; vmax = 1; }

  // Per-karyogroup mean trajectories.
  let per_karyo = null;
  const labels = o.panelLabels;
  if (labels && labels.length) {
    let K = Number.isFinite(o.k) ? (o.k | 0) : 0;
    if (K <= 0) for (let s = 0; s < labels.length; s++) if (labels[s] + 1 > K) K = labels[s] + 1;
    if (K > 0) {
      per_karyo = {};
      for (let g = 0; g < K; g++) {
        const curve = new Float32Array(W).fill(NaN);
        for (let w = 0; w < W; w++) {
          let n = 0, sum = 0;
          for (let s = 0; s < nP && s < labels.length; s++) {
            if (labels[s] !== g) continue;
            const r = M[s]; const v = r && w < r.length ? r[w] : NaN;
            if (Number.isFinite(v)) { sum += v; n++; }
          }
          if (n > 0) curve[w] = sum / n;
        }
        per_karyo[karyogroupName(g)] = curve;
      }
    }
  }

  // Per-sample trajectories (capped for rendering sanity).
  const cap = Number.isFinite(o.maxSamplesKept) ? (o.maxSamplesKept | 0) : 400;
  const per_sample = (cap > 0 && nP > cap) ? M.slice(0, cap) : M;

  return {
    scale, n_windows: W, win_x,
    per_sample, per_karyo,
    median, p90, mean, n_used,
    vmin, vmax,
  };
}

// Per-window x positions (genomic midpoints) from the panel if present,
// else 0..W-1 window indices.
function _windowX(panel, scale, W) {
  const cand = (panel.win_mid && panel.win_mid[scale]) || panel.win_mid
            || (panel.windows && (panel.windows[scale] || panel.windows));
  const out = new Float64Array(W);
  if (Array.isArray(cand) && cand.length >= W) {
    for (let w = 0; w < W; w++) {
      const e = cand[w];
      out[w] = (typeof e === 'number') ? e
        : (e && Number.isFinite(e.mid)) ? e.mid
        : (e && Number.isFinite(e.start_bp) && Number.isFinite(e.end_bp)) ? (e.start_bp + e.end_bp) / 2
        : (e && Number.isFinite(e.start) && Number.isFinite(e.end)) ? (e.start + e.end) / 2
        : w;
    }
    return out;
  }
  for (let w = 0; w < W; w++) out[w] = w;
  return out;
}

function _quantileSorted(sorted, q) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = q * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
