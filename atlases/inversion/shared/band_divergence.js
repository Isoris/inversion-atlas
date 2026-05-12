// shared/band_divergence.js
//
// Per-band heterozygosity classification (legacy lines 37448-37650).
// Given a candidate's per-sample band labels + a per-sample
// heterozygosity vector, classifies each sample (low/mid/high
// divergence → hom-like / ambiguous / het-like state) and each band
// (majority interpretation + bimodality check).
//
// All compute is pure. The legacy het-proxy (from PC residuals) is
// not ported — caller supplies per_sample_het explicitly, or supplies
// an opts.hetProxy callback that takes (candidate) → Float32Array.

/** het < this → "low divergence" (hom-like signal). */
export const DBD_LOW_HET_THRESHOLD  = 0.40;
/** het ≥ this → "high divergence" (het-like signal). */
export const DBD_HIGH_HET_THRESHOLD = 0.50;
/** Bimodal gap must exceed this many pooled σ. */
export const DBD_MULTIMODAL_GAP_Z   = 2.0;
/** Bimodal gap must also exceed this absolute het units. */
export const DBD_MULTIMODAL_GAP_MIN = 0.15;
/** Each mode needs ≥ this many samples to count. */
export const DBD_MIN_MODE_SAMPLES   = 3;

// =====================================================================
// Per-sample classifiers
// =====================================================================

/** Classify a sample's heterozygosity into 'low' | 'mid' | 'high'. */
export function dbdDivergenceClass(het) {
  if (!Number.isFinite(het)) return 'mid';
  if (het < DBD_LOW_HET_THRESHOLD)  return 'low';
  if (het >= DBD_HIGH_HET_THRESHOLD) return 'high';
  return 'mid';
}

/** Map a divergence class to a possible diploid state label. */
export function dbdPossibleState(divClass) {
  if (divClass === 'low')  return 'hom-like';
  if (divClass === 'high') return 'het-like';
  return 'ambiguous';
}

// =====================================================================
// Mode detection (K=2 1D K-means + bimodality test)
// =====================================================================

function _mean(arr) {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/**
 * Detect 1 or 2 modes in a 1D het distribution. Returns:
 *   { n_modes, mode_centers, mode_assignments }
 *
 * Algorithm: K-means K=2 (init at 25th/75th percentile), check that
 * the gap exceeds DBD_MULTIMODAL_GAP_Z × pooled-σ AND
 * DBD_MULTIMODAL_GAP_MIN absolute units AND each mode has ≥
 * DBD_MIN_MODE_SAMPLES support. If any fails, fall back to n_modes=1.
 *
 * Modes are returned ordered so mode_centers[0] ≤ mode_centers[1].
 *
 * @param {ArrayLike<number>} het
 * @returns {{n_modes:number, mode_centers:Array<number>, mode_assignments:Int8Array}}
 */
export function dbdDetectModes(het) {
  if (!het || het.length < (2 * DBD_MIN_MODE_SAMPLES)) {
    return {
      n_modes: 1,
      mode_centers: [_mean(het)],
      mode_assignments: new Int8Array(het ? het.length : 0),
    };
  }
  const sorted = Array.from(het).sort((a, b) => a - b);
  let c0 = sorted[Math.floor(sorted.length * 0.25)];
  let c1 = sorted[Math.floor(sorted.length * 0.75)];
  if (c1 - c0 < 1e-6) {
    return {
      n_modes: 1,
      mode_centers: [_mean(het)],
      mode_assignments: new Int8Array(het.length),
    };
  }
  const labels = new Int8Array(het.length);
  for (let it = 0; it < 12; it++) {
    let changed = false;
    for (let i = 0; i < het.length; i++) {
      const d0 = Math.abs(het[i] - c0);
      const d1 = Math.abs(het[i] - c1);
      const lab = d0 <= d1 ? 0 : 1;
      if (labels[i] !== lab) { labels[i] = lab; changed = true; }
    }
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (let i = 0; i < het.length; i++) {
      if (labels[i] === 0) { s0 += het[i]; n0++; }
      else                  { s1 += het[i]; n1++; }
    }
    if (n0 > 0) c0 = s0 / n0;
    if (n1 > 0) c1 = s1 / n1;
    if (!changed) break;
  }
  let v0 = 0, n0 = 0, v1 = 0, n1 = 0;
  for (let i = 0; i < het.length; i++) {
    if (labels[i] === 0) { v0 += (het[i] - c0) ** 2; n0++; }
    else                  { v1 += (het[i] - c1) ** 2; n1++; }
  }
  const pooledVar = (v0 + v1) / Math.max(1, het.length - 2);
  const pooledSd = Math.sqrt(Math.max(pooledVar, 1e-12));
  const gap = Math.abs(c1 - c0);
  const gapZ = gap / pooledSd;
  if (n0 < DBD_MIN_MODE_SAMPLES || n1 < DBD_MIN_MODE_SAMPLES
      || gapZ < DBD_MULTIMODAL_GAP_Z || gap < DBD_MULTIMODAL_GAP_MIN) {
    return {
      n_modes: 1,
      mode_centers: [_mean(het)],
      mode_assignments: new Int8Array(het.length),
    };
  }
  if (c0 > c1) {
    const tmp = c0; c0 = c1; c1 = tmp;
    for (let i = 0; i < labels.length; i++) labels[i] = 1 - labels[i];
  }
  return { n_modes: 2, mode_centers: [c0, c1], mode_assignments: labels };
}

// =====================================================================
// Band-level interpretation
// =====================================================================

/**
 * Interpret a band from its sample-level divergence fractions +
 * detected mode count. Returns one of:
 *   'mixed' | 'hom-like' | 'het-like' | 'ambiguous'
 */
export function dbdBandInterpretation(lowFrac, midFrac, highFrac, nModes) {
  if (nModes >= 2) return 'mixed';
  if (lowFrac  >= 0.7) return 'hom-like';
  if (highFrac >= 0.7) return 'het-like';
  if (midFrac  >= 0.5) return 'ambiguous';
  return 'ambiguous';
}

// =====================================================================
// Full per-candidate classifier
// =====================================================================

/**
 * Classify a candidate's per-band heterozygosity. Returns:
 *   {
 *     het_source: 'precomp_het' | 'atlas_proxy',
 *     per_sample: [{ si, band, het, divergence_class, possible_state, sub_band }],
 *     per_band: [{ band, n, n_low, n_mid, n_high,
 *                  lowhet_fraction, midhet_fraction, highhet_fraction,
 *                  is_mixed, n_modes, mode_centers, interpretation }]
 *   }
 *
 * `per_sample_het` priority:
 *   1. explicit `opts.per_sample_het`
 *   2. `candidate.per_sample_het`
 *   3. `opts.hetProxy(candidate)` (caller-supplied fallback)
 *
 * Returns null if none of the above yields a usable het vector.
 *
 * @param {Object} candidate
 * @param {{per_sample_het?:ArrayLike<number>, hetProxy?:Function}} opts
 * @returns {Object|null}
 */
export function classifyDetailedCandidate(candidate, opts) {
  if (!candidate || !candidate.locked_labels) return null;
  const labels = candidate.locked_labels;
  const nS = labels.length;
  let K = Number.isFinite(candidate.K) ? candidate.K : null;
  if (K == null) {
    let maxK = -1;
    for (let i = 0; i < labels.length; i++) {
      const v = labels[i];
      if (Number.isInteger(v) && v > maxK) maxK = v;
    }
    K = maxK + 1;
  }
  if (K < 1) return null;

  const o = opts || {};
  let per_sample_het = o.per_sample_het;
  if (!per_sample_het && candidate.per_sample_het) {
    const v = candidate.per_sample_het;
    if ((Array.isArray(v) || ArrayBuffer.isView(v)) && v.length > 0) {
      per_sample_het = v;
    }
  }
  let het_source = per_sample_het ? 'precomp_het' : 'atlas_proxy';
  let het = per_sample_het;
  if (!het) {
    if (typeof o.hetProxy === 'function') {
      try { het = o.hetProxy(candidate); }
      catch (_) { het = null; }
    }
  }
  if (!het) return null;

  // Per-sample
  const per_sample = [];
  for (let si = 0; si < nS; si++) {
    const band = labels[si];
    const h = het[si];
    const divClass = dbdDivergenceClass(h);
    per_sample.push({
      si,
      band,
      het: h,
      divergence_class: divClass,
      possible_state:   dbdPossibleState(divClass),
      sub_band: null,
    });
  }

  // Per-band aggregation
  const per_band = [];
  for (let b = 0; b < K; b++) {
    const bandHet = [];
    const bandSi = [];
    for (let si = 0; si < nS; si++) {
      if (labels[si] === b) { bandHet.push(het[si]); bandSi.push(si); }
    }
    if (bandHet.length === 0) {
      per_band.push({
        band: b, n: 0, n_low: 0, n_mid: 0, n_high: 0,
        lowhet_fraction: 0, midhet_fraction: 0, highhet_fraction: 0,
        is_mixed: false, n_modes: 0, mode_centers: [],
        interpretation: 'ambiguous',
      });
      continue;
    }
    let nLow = 0, nMid = 0, nHigh = 0;
    for (const h of bandHet) {
      const c = dbdDivergenceClass(h);
      if (c === 'low')       nLow++;
      else if (c === 'mid')  nMid++;
      else                   nHigh++;
    }
    const modes = dbdDetectModes(Float64Array.from(bandHet));
    const lowFrac = nLow / bandHet.length;
    const midFrac = nMid / bandHet.length;
    const highFrac = nHigh / bandHet.length;
    const interp = dbdBandInterpretation(lowFrac, midFrac, highFrac, modes.n_modes);
    per_band.push({
      band: b,
      n: bandHet.length,
      n_low: nLow, n_mid: nMid, n_high: nHigh,
      lowhet_fraction: lowFrac, midhet_fraction: midFrac, highhet_fraction: highFrac,
      is_mixed: modes.n_modes >= 2,
      n_modes: modes.n_modes,
      mode_centers: Array.from(modes.mode_centers),
      interpretation: interp,
    });
    if (modes.n_modes >= 2) {
      for (let i = 0; i < bandSi.length; i++) {
        const si = bandSi[i];
        per_sample[si].sub_band = modes.mode_assignments[i];
      }
    }
  }

  return { het_source, per_sample, per_band };
}
