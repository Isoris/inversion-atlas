// pages/discovery/dosage_heatmap/dosage_detect.js
// =====================================================================
// In-page band / cluster detection + dosage-only confidence for the
// dosage heatmap. Lets the heatmap render haplotype-regime groupings
// WITHOUT an upstream pipeline run: it derives per-sample groups from
// the loaded dosage chunk itself, calls each sample's karyotype tier
// from its mean polarised dosage, and scores how confident those calls
// are using two complementary schemes (margin-to-boundary and 1-D
// silhouette).
//
// Two detection modes (the "2 modes" the design calls for):
//
//   'bands'    — 1-D K-means on each sample's MEAN dosage. Recovers the
//                ordered homA / het / homB tier banding of a single
//                biallelic inversion (band 0 = lowest dosage).
//   'clusters' — 2-D K-means on (mean dosage, het fraction) per sample.
//                Separates samples that share a mean dosage but differ
//                in heterozygosity (e.g. recombinants / compound
//                arrangements) that the 1-D banding collapses together.
//
// Either mode can pick K automatically (silhouette-maximising over a
// small range) or use a fixed K. Both return the same shape so the
// renderer / page treat them identically.
//
// The dosage tiers match shared/mgl_regime_consistency.js
// MGL_REGIME_CONSISTENCY_DEFAULTS so an in-page call and an upstream
// regime call use the same cut-points.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================

import { kmeans1D, kmeans2D } from '../../../shared/kmeans.js';

// Dosage tier cut-points (polarised dosage in [0,2]).
export const DOSAGE_TIERS = Object.freeze({
  HOM_A_MAX: 0.4,
  HET_LO:    0.6,
  HET_HI:    1.4,
  HOM_B_MIN: 1.6,
});

// Karyotype-call decision boundaries (gap centres between tiers): a
// sample is homA below 0.5, het in (0.5,1.5], homB above 1.5. The
// margin confidence below measures distance to the nearer of these.
const CALL_BOUNDARY_LO = 0.5;
const CALL_BOUNDARY_HI = 1.5;

/**
 * Per-sample mean polarised dosage + het fraction over the displayed
 * markers. NA cells (cellValue → null) are skipped.
 *
 * @param {Object} canonical  adaptMglHeatmapJson / adaptLegacyChunk output
 * @param {Int32Array} [markerOrder]  restrict + order the markers used
 *   (e.g. a variance-selected subset); defaults to all markers 0..nM-1.
 * @returns {{ mean:Float64Array, het:Float64Array, n:Int32Array }}
 *   mean[s] = mean dosage; het[s] = fraction of het-ish cells (0.5,1.5];
 *   n[s]    = count of non-NA cells used. NaN mean when n=0.
 */
export function computeSampleDosageFeatures(canonical, markerOrder) {
  const nS = (canonical && canonical.n_samples | 0) || 0;
  const nM = (canonical && canonical.n_markers | 0) || 0;
  const mean = new Float64Array(nS);
  const het  = new Float64Array(nS);
  const n    = new Int32Array(nS);
  if (!canonical || typeof canonical.cellValue !== 'function' || nS <= 0 || nM <= 0) {
    mean.fill(NaN);
    return { mean, het, n };
  }
  const cols = (markerOrder instanceof Int32Array && markerOrder.length > 0)
    ? markerOrder : null;
  const lim = cols ? cols.length : nM;
  const cellValue = canonical.cellValue;
  for (let s = 0; s < nS; s++) {
    let sum = 0, cnt = 0, hetc = 0;
    for (let c = 0; c < lim; c++) {
      const m = cols ? cols[c] : c;
      const v = cellValue(m, s);
      if (v == null || !Number.isFinite(v)) continue;
      sum += v; cnt++;
      if (v > 0.5 && v <= 1.5) hetc++;
    }
    n[s]    = cnt;
    mean[s] = cnt > 0 ? sum / cnt : NaN;
    het[s]  = cnt > 0 ? hetc / cnt : NaN;
  }
  return { mean, het, n };
}

/**
 * Karyotype-tier call from a sample's mean dosage.
 * @param {number} m  mean dosage
 * @returns {'homA_like'|'het_like'|'homB_like'|'uncertain'}
 */
export function regimeCallFromMean(m) {
  if (!Number.isFinite(m)) return 'uncertain';
  if (m <= DOSAGE_TIERS.HOM_A_MAX) return 'homA_like';
  if (m >= DOSAGE_TIERS.HET_LO && m <= DOSAGE_TIERS.HET_HI) return 'het_like';
  if (m >= DOSAGE_TIERS.HOM_B_MIN) return 'homB_like';
  return 'uncertain';
}

/**
 * Per-sample regime (karyotype-tier) calls from mean dosage.
 * @param {Float64Array|number[]} meanArr
 * @returns {string[]}  homA_like / het_like / homB_like / uncertain
 */
export function regimeCallsFromDosage(meanArr) {
  const out = new Array(meanArr ? meanArr.length : 0);
  for (let s = 0; s < out.length; s++) out[s] = regimeCallFromMean(meanArr[s]);
  return out;
}

// ---------------------------------------------------------------------
// Confidence — scheme A: margin to the nearest call boundary
// ---------------------------------------------------------------------

/**
 * Per-sample margin confidence in [0,1]: distance from the sample's
 * mean dosage to the nearer karyotype decision boundary (0.5 / 1.5),
 * normalised by 0.5 (the half-width of a tier) and clamped. A sample
 * sitting on a boundary scores 0; a clean homozygote / mid-het scores 1.
 *
 * @param {Float64Array|number[]} meanArr
 * @returns {Float64Array}
 */
export function marginConfidence(meanArr) {
  const nS = meanArr ? meanArr.length : 0;
  const out = new Float64Array(nS);
  for (let s = 0; s < nS; s++) {
    const m = meanArr[s];
    if (!Number.isFinite(m)) { out[s] = NaN; continue; }
    const d = Math.min(Math.abs(m - CALL_BOUNDARY_LO), Math.abs(m - CALL_BOUNDARY_HI));
    out[s] = Math.max(0, Math.min(1, d / 0.5));
  }
  return out;
}

// ---------------------------------------------------------------------
// Confidence — scheme B: per-sample 1-D silhouette within the bands
// ---------------------------------------------------------------------

/**
 * Per-sample 1-D silhouette on a scalar feature given integer labels.
 * s_i = (b_i - a_i) / max(a_i, b_i), where a_i is mean distance to
 * same-label samples and b_i the min mean distance to another label.
 * Samples whose cluster has <2 members (or with non-finite feature)
 * get NaN.
 *
 * @param {Float64Array|number[]} values
 * @param {Int32Array|number[]} labels
 * @param {number} k
 * @returns {Float64Array}  per-sample silhouette in [-1,1] (NaN where undefined)
 */
export function silhouettePerSample1D(values, labels, k) {
  const n = values ? values.length : 0;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (n < 2 || k < 2) return out;
  const byK = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(values[i]) && labels[i] >= 0 && labels[i] < k) byK[labels[i]].push(i);
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(values[i])) continue;
    const my = labels[i];
    if (my < 0 || my >= k) continue;
    const mine = byK[my];
    if (mine.length < 2) { out[i] = 0; continue; }
    let aSum = 0, aCnt = 0;
    for (const j of mine) { if (j === i) continue; aSum += Math.abs(values[i] - values[j]); aCnt++; }
    const a = aCnt > 0 ? aSum / aCnt : 0;
    let bMin = Infinity;
    for (let other = 0; other < k; other++) {
      if (other === my) continue;
      const arr = byK[other];
      if (arr.length === 0) continue;
      let bSum = 0;
      for (const j of arr) bSum += Math.abs(values[i] - values[j]);
      const b = bSum / arr.length;
      if (b < bMin) bMin = b;
    }
    if (!Number.isFinite(bMin)) { out[i] = 0; continue; }
    out[i] = (bMin - a) / Math.max(a, bMin, 1e-12);
  }
  return out;
}

// ---------------------------------------------------------------------
// Group summary (per-group confidence: mean margin, separation, silhouette)
// ---------------------------------------------------------------------

/**
 * Summarise detected groups: per-group size, centre, mean dosage,
 * mean margin confidence, mean silhouette, and the separation from the
 * adjacent group (gap between centres / pooled SD). Returns one record
 * per label 0..k-1 in label order.
 *
 * @param {Object} args
 *   labels:Int32Array, mean:Float64Array, centers:Float64Array|number[],
 *   margin:Float64Array, sil:Float64Array, k:number
 * @returns {Array<{ label:number, n:number, center:number,
 *   mean_dosage:number, sd_dosage:number, mean_margin:number,
 *   mean_silhouette:number, separation:number, confidence:number,
 *   call:string }>}
 */
export function summariseGroups(args) {
  const { labels, mean, centers, margin, sil, k } = args || {};
  const K = k | 0;
  const recs = [];
  if (!labels || !mean || K <= 0) return recs;
  const n   = labels.length;
  const cnt = new Array(K).fill(0);
  const sum = new Float64Array(K);
  const sq  = new Float64Array(K);
  const mSum = new Float64Array(K), mCnt = new Int32Array(K);
  const sSum = new Float64Array(K), sCnt = new Int32Array(K);
  for (let i = 0; i < n; i++) {
    const g = labels[i];
    if (g < 0 || g >= K) continue;
    cnt[g]++;
    if (Number.isFinite(mean[i])) { sum[g] += mean[i]; sq[g] += mean[i] * mean[i]; }
    if (margin && Number.isFinite(margin[i])) { mSum[g] += margin[i]; mCnt[g]++; }
    if (sil && Number.isFinite(sil[i]))       { sSum[g] += sil[i];    sCnt[g]++; }
  }
  const meanDose = new Float64Array(K), sdDose = new Float64Array(K);
  for (let g = 0; g < K; g++) {
    const c = cnt[g];
    meanDose[g] = c > 0 ? sum[g] / c : NaN;
    const varG = c > 0 ? Math.max(0, sq[g] / c - meanDose[g] * meanDose[g]) : NaN;
    sdDose[g] = Number.isFinite(varG) ? Math.sqrt(varG) : NaN;
  }
  for (let g = 0; g < K; g++) {
    // Separation: smallest centre-gap / pooled-SD against adjacent groups.
    let sep = Infinity;
    for (let h = 0; h < K; h++) {
      if (h === g || cnt[h] === 0) continue;
      const gap = Math.abs(meanDose[g] - meanDose[h]);
      const pooled = Math.sqrt(((sdDose[g] || 0) ** 2 + (sdDose[h] || 0) ** 2) / 2) || 1e-9;
      const s = gap / pooled;
      if (s < sep) sep = s;
    }
    if (!Number.isFinite(sep)) sep = 0;
    const meanMargin = mCnt[g] > 0 ? mSum[g] / mCnt[g] : NaN;
    const meanSil    = sCnt[g] > 0 ? sSum[g] / sCnt[g] : NaN;
    // Combined confidence: margin gated by a soft separation factor.
    const sepFactor = 1 - Math.exp(-sep / 1.5);   // 0 at sep=0 → ~0.49 at 1, →0.95 at 4.5
    const base = Number.isFinite(meanMargin) ? meanMargin : 0;
    const confidence = Math.max(0, Math.min(1, base * (0.5 + 0.5 * sepFactor)));
    recs.push({
      label: g,
      n: cnt[g],
      center: (centers && Number.isFinite(centers[g])) ? centers[g] : meanDose[g],
      mean_dosage: meanDose[g],
      sd_dosage: sdDose[g],
      mean_margin: meanMargin,
      mean_silhouette: meanSil,
      separation: sep,
      confidence,
      call: regimeCallFromMean(meanDose[g]),
    });
  }
  return recs;
}

// ---------------------------------------------------------------------
// Auto-K helpers (silhouette-maximising over a small range)
// ---------------------------------------------------------------------

function _meanSilhouette(values, labels, k) {
  const per = silhouettePerSample1D(values, labels, k);
  let sum = 0, cnt = 0;
  for (let i = 0; i < per.length; i++) if (Number.isFinite(per[i])) { sum += per[i]; cnt++; }
  return cnt > 0 ? sum / cnt : NaN;
}

// ---------------------------------------------------------------------
// Top-level detection
// ---------------------------------------------------------------------

/**
 * Detect per-sample groups from a canonical heatmap's dosage.
 *
 * @param {Object} canonical
 * @param {Object} [opts]
 *   mode?:        'bands' | 'clusters'   default 'bands'
 *   k?:           number | 'auto'        default 'auto'
 *   kMin?:        number                 default 2
 *   kMax?:        number                 default 4
 *   minNGroup?:   number                 default 4
 *   markerOrder?: Int32Array             restrict markers (variance views)
 * @returns {{
 *   mode:string, k:number,
 *   labels:Int32Array,                    per-sample group id (0..k-1, -1 = no data)
 *   sample_group:Array<string>,           readable group label per sample (for the renderer)
 *   regime_call:Array<string>,            homA/het/homB/uncertain per sample
 *   mean:Float64Array, het:Float64Array,  per-sample features
 *   margin:Float64Array,                  per-sample margin confidence [0,1]
 *   silhouette:Float64Array,              per-sample silhouette [-1,1]
 *   overall_silhouette:number,
 *   groups:Array<Object>,                 summariseGroups() output
 * } | null}
 */
export function detectGroups(canonical, opts) {
  const o = opts || {};
  const mode = (o.mode === 'clusters') ? 'clusters' : 'bands';
  const kMin = Number.isFinite(o.kMin) ? (o.kMin | 0) : 2;
  const kMax = Number.isFinite(o.kMax) ? (o.kMax | 0) : 4;
  const minNGroup = Number.isFinite(o.minNGroup) ? (o.minNGroup | 0) : 4;
  const feats = computeSampleDosageFeatures(canonical, o.markerOrder);
  const nS = feats.mean.length;
  if (nS === 0) return null;

  // Only cluster samples with data; map back to full-length arrays after.
  const idx = [];
  for (let s = 0; s < nS; s++) if (Number.isFinite(feats.mean[s])) idx.push(s);
  if (idx.length < kMin) return null;

  const meanSub = Float64Array.from(idx, (s) => feats.mean[s]);
  const hetSub  = Float64Array.from(idx, (s) => feats.het[s]);

  // Choose K.
  const wantAuto = (o.k == null || o.k === 'auto' || !Number.isFinite(o.k));
  const tryKs = wantAuto
    ? Array.from({ length: Math.max(1, kMax - kMin + 1) }, (_, i) => kMin + i)
    : [Math.max(1, o.k | 0)];

  let best = null;
  for (const k of tryKs) {
    if (k < 1 || k > idx.length) continue;
    let labelsSub, centers;
    if (mode === 'clusters') {
      const r = kmeans2D(meanSub, hetSub, k);
      labelsSub = r.labels;
      centers = r.cx;        // order/label by mean-dosage centre below
    } else {
      const r = kmeans1D(meanSub, k);
      labelsSub = r.labels;
      centers = r.centers;   // already ascending
    }
    // Reject K whose smallest group < minNGroup (only when auto + k>1).
    const counts = new Array(k).fill(0);
    for (let i = 0; i < labelsSub.length; i++) counts[labelsSub[i]]++;
    const minCount = Math.min(...counts);
    if (wantAuto && k > 1 && minCount < minNGroup) continue;
    const sil = (k >= 2) ? _meanSilhouette(meanSub, labelsSub, k) : 0;
    const score = Number.isFinite(sil) ? sil : -Infinity;
    if (!best || score > best.score) {
      best = { k, labelsSub, centers, score };
    }
  }
  if (!best) {
    // Fallback: single group.
    best = { k: 1, labelsSub: new Int8Array(idx.length), centers: Float64Array.from([_mean(meanSub)]), score: 0 };
  }

  // For clusters mode, relabel ascending by mean-dosage centre so band 0
  // is the lowest-dosage cluster (matches bands-mode ordering).
  let labelsSub = best.labelsSub, centers = best.centers, K = best.k;
  if (mode === 'clusters' && K > 1) {
    const cMean = new Float64Array(K);
    const cCnt  = new Int32Array(K);
    for (let i = 0; i < labelsSub.length; i++) { cMean[labelsSub[i]] += meanSub[i]; cCnt[labelsSub[i]]++; }
    for (let g = 0; g < K; g++) cMean[g] = cCnt[g] > 0 ? cMean[g] / cCnt[g] : Infinity;
    const order = Array.from({ length: K }, (_, i) => i).sort((a, b) => cMean[a] - cMean[b]);
    const remap = new Int32Array(K);
    for (let i = 0; i < K; i++) remap[order[i]] = i;
    const relab = new Int32Array(labelsSub.length);
    for (let i = 0; i < labelsSub.length; i++) relab[i] = remap[labelsSub[i]];
    labelsSub = relab;
    const newCenters = new Float64Array(K);
    for (let g = 0; g < K; g++) newCenters[g] = cMean[order[g]];
    centers = newCenters;
  }

  // Scatter back to full length.
  const labels = new Int32Array(nS).fill(-1);
  for (let i = 0; i < idx.length; i++) labels[idx[i]] = labelsSub[i];

  const margin = marginConfidence(feats.mean);
  const silhouette = silhouettePerSample1D(feats.mean, labels, Math.max(K, 1));
  const regime_call = regimeCallsFromDosage(feats.mean);

  // Readable per-sample group labels. Bands mode names by tier; clusters
  // mode names generically (the tier may not be 1:1 with a cluster).
  const sample_group = new Array(nS);
  const groupSummary = summariseGroups({ labels, mean: feats.mean, centers, margin, sil: silhouette, k: Math.max(K, 1) });
  const labelName = new Array(Math.max(K, 1));
  for (let g = 0; g < labelName.length; g++) {
    const rec = groupSummary[g];
    if (mode === 'bands') {
      labelName[g] = rec ? `${rec.call.replace('_like', '')} (band ${g})` : `band ${g}`;
    } else {
      labelName[g] = `cluster ${g}`;
    }
  }
  for (let s = 0; s < nS; s++) {
    sample_group[s] = labels[s] >= 0 ? labelName[labels[s]] : null;
  }

  let overall = 0, oc = 0;
  for (let i = 0; i < silhouette.length; i++) if (Number.isFinite(silhouette[i])) { overall += silhouette[i]; oc++; }

  return {
    mode, k: K,
    labels,
    sample_group,
    regime_call,
    mean: feats.mean, het: feats.het,
    margin, silhouette,
    overall_silhouette: oc > 0 ? overall / oc : NaN,
    groups: groupSummary,
  };
}

function _mean(arr) {
  let s = 0, c = 0;
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) { s += arr[i]; c++; }
  return c > 0 ? s / c : NaN;
}
