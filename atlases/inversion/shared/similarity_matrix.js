// shared/similarity_matrix.js
//
// HANDOFF 10 — per-window Pearson similarity matrix primitives for
// the scrubbable similarity-matrix panel (specs_todo/
// pages_similarity_panel/_to_do/HANDOFF_10_atlas_similarity.md
// Stages 3-4). Pure JS; no DOM, no fetch.
//
// Data contract (HANDOFF 10 §Stage 1):
//   dosage  Uint8Array of length n_samples × n_markers, row-major.
//           Encoded byte v: v ∈ [0, 254] → dosage = v / 127 ∈ [0, 2.0],
//                          v === 255 → missing.
//   positions  Uint32Array of length n_markers (sorted ascending bp).
//
// The three primitives:
//   1. binarySearchFirstGE(positions, target)
//        Locate the first marker index whose position ≥ target.
//   2. computeFlipVector(dosage, n_markers, refPosSamples, refNegSamples)
//        Build the polarity-correction Uint8Array (1 = flip, 0 = keep).
//   3. pearsonSimilarityMatrix(...)
//        Compute the symmetric N×N similarity (Pearson on dosage,
//        respects flip vector, drops markers with NA on either sample).
//
// All three accept Float64Array dosages too (legacy heatmap markers
// shape). Set `opts.decode` to skip the /127 normalisation when input
// is already in [0, 2] floats.

/** Bytes encoding the "missing" sentinel per spec §Stage 1. */
export const DOSAGE_MISSING_BYTE = 255;

/** Decode factor: byte → dosage in [0, 2]. */
export const DOSAGE_DECODE_FACTOR = 1 / 127;

/** Minimum markers required to call a similarity reliable. */
export const SIMILARITY_MIN_MARKERS = 20;

/**
 * Binary search: index of the first element ≥ target. Returns
 * `arr.length` when every element is below target.
 *
 * @param {Uint32Array|Float64Array|Array<number>} arr  ascending
 * @param {number} target
 * @returns {number}
 */
export function binarySearchFirstGE(arr, target) {
  if (!arr || typeof arr.length !== 'number') return 0;
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Decode one cell of the dosage matrix. Returns null when missing.
 * `flipVector` may be null. `decode=false` skips the /127 step (for
 * Float dosage already in [0,2]).
 */
function _readDosage(dosage, sampleIdx, markerIdx, nMarkers,
                     flipVector, decode) {
  const v = dosage[sampleIdx * nMarkers + markerIdx];
  if (v === DOSAGE_MISSING_BYTE && decode) return null;
  if (!Number.isFinite(v) && !decode) return null;
  const d = decode ? v * DOSAGE_DECODE_FACTOR : v;
  if (flipVector && flipVector[markerIdx]) return 2 - d;
  return d;
}

/**
 * Compute per-marker flip indicators for outer polarity correction
 * (HANDOFF 10 §Stage 4 — `computeFlipVectorOuter`).
 *
 * For each marker, compare mean dosage in `refPosSamples` vs
 * `refNegSamples`. If pos < neg, mark the marker `1` (flip), so the
 * post-flip read aligns the "positive" group with the higher value.
 *
 * @param {Uint8Array|Array<number>} dosage  per-sample × per-marker
 * @param {number} nMarkers
 * @param {Iterable<number>} refPosSamples  positive-reference sample indices
 * @param {Iterable<number>} refNegSamples  negative-reference sample indices
 * @param {{decode?:boolean}} opts          decode=true (default) divides by 127
 * @returns {Uint8Array}  length nMarkers; 0 = keep, 1 = flip
 */
export function computeFlipVector(dosage, nMarkers,
                                  refPosSamples, refNegSamples, opts) {
  const o = opts || {};
  const decode = o.decode !== false;
  const out = new Uint8Array(nMarkers);
  if (!dosage || !nMarkers) return out;
  const pos = Array.from(refPosSamples || []);
  const neg = Array.from(refNegSamples || []);
  if (pos.length === 0 || neg.length === 0) return out;
  for (let m = 0; m < nMarkers; m++) {
    let posSum = 0, posCount = 0, negSum = 0, negCount = 0;
    for (const si of pos) {
      const d = _readDosage(dosage, si, m, nMarkers, null, decode);
      if (d == null) continue;
      posSum += d; posCount++;
    }
    for (const si of neg) {
      const d = _readDosage(dosage, si, m, nMarkers, null, decode);
      if (d == null) continue;
      negSum += d; negCount++;
    }
    if (posCount === 0 || negCount === 0) continue;
    const contrast = (posSum / posCount) - (negSum / negCount);
    out[m] = contrast < 0 ? 1 : 0;
  }
  return out;
}

/**
 * Compute the per-window Pearson similarity matrix for a sample
 * subset. Returns:
 *
 *   {
 *     ok: true,
 *     matrix: Float32Array(N × N) row-major,
 *     nSamples: number,
 *     nMarkersInWindow: number,
 *     sampleIndices: Array<number>,  // echoed sampleSubset
 *   }
 *
 * Or `{ ok: false, reason: 'insufficient_markers' | 'invalid_inputs',
 * nMarkersInWindow }` when the window is too sparse.
 *
 * Pair-wise NA handling: any marker missing for EITHER sample of a
 * pair is skipped for that pair (pairwise-deletion).  Diagonal is
 * forced to 1.0 by construction. Cells where the SD of either sample
 * collapses to 0 (or the pair has no shared markers) come back as 0
 * (the visually-neutral midpoint of the diverging colormap).
 *
 * `opts.flipVector` (optional Uint8Array of length nMarkers) flips
 * the sign of selected markers per spec §Stage 4 polarity correction.
 *
 * @param {Object} args
 * @param {Uint8Array|Array<number>} args.dosage
 * @param {number} args.nMarkers
 * @param {Array<number>} args.sampleSubset
 * @param {number} args.startIdx   first marker index (inclusive)
 * @param {number} args.endIdx     last marker index (exclusive)
 * @param {{flipVector?:Uint8Array, decode?:boolean, absoluteValue?:boolean,
 *          minMarkers?:number}} [opts]
 * @returns {Object}
 */
export function pearsonSimilarityMatrix(args, opts) {
  const o = opts || {};
  const decode = o.decode !== false;
  const flip = o.flipVector || null;
  const absoluteValue = !!o.absoluteValue;
  const minMarkers = Number.isFinite(o.minMarkers)
    ? o.minMarkers : SIMILARITY_MIN_MARKERS;
  if (!args || !args.dosage || !Array.isArray(args.sampleSubset)
      || !Number.isFinite(args.nMarkers) || !Number.isFinite(args.startIdx)
      || !Number.isFinite(args.endIdx)) {
    return { ok: false, reason: 'invalid_inputs', nMarkersInWindow: 0 };
  }
  const { dosage, nMarkers, sampleSubset, startIdx, endIdx } = args;
  const nMarkersInWindow = Math.max(0, endIdx - startIdx);
  if (nMarkersInWindow < minMarkers) {
    return { ok: false, reason: 'insufficient_markers', nMarkersInWindow };
  }
  const N = sampleSubset.length;
  if (N === 0) {
    return { ok: false, reason: 'invalid_inputs', nMarkersInWindow };
  }

  // Per-sample mean/SD over markers in window.
  const means = new Float64Array(N);
  const sds = new Float64Array(N);
  const counts = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    const si = sampleSubset[s];
    let sum = 0, sumSq = 0, n = 0;
    for (let m = startIdx; m < endIdx; m++) {
      const d = _readDosage(dosage, si, m, nMarkers, flip, decode);
      if (d == null) continue;
      sum += d; sumSq += d * d; n++;
    }
    if (n > 0) {
      means[s] = sum / n;
      const v = sumSq / n - means[s] * means[s];
      sds[s] = Math.sqrt(Math.max(v, 0));
    }
    counts[s] = n;
  }

  const matrix = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    matrix[i * N + i] = 1.0;
    const ii = sampleSubset[i];
    const mi = means[i], sdi = sds[i];
    if (counts[i] === 0 || sdi === 0) {
      for (let j = i + 1; j < N; j++) {
        matrix[i * N + j] = 0;
        matrix[j * N + i] = 0;
      }
      continue;
    }
    for (let j = i + 1; j < N; j++) {
      const jj = sampleSubset[j];
      const mj = means[j], sdj = sds[j];
      if (counts[j] === 0 || sdj === 0) {
        matrix[i * N + j] = 0;
        matrix[j * N + i] = 0;
        continue;
      }
      let cov = 0, n = 0;
      for (let m = startIdx; m < endIdx; m++) {
        const di = _readDosage(dosage, ii, m, nMarkers, flip, decode);
        if (di == null) continue;
        const dj = _readDosage(dosage, jj, m, nMarkers, flip, decode);
        if (dj == null) continue;
        cov += (di - mi) * (dj - mj);
        n++;
      }
      let corr = 0;
      if (n > 0) {
        cov /= n;
        corr = cov / (sdi * sdj);
        if (!Number.isFinite(corr)) corr = 0;
        if (corr > 1) corr = 1;
        else if (corr < -1) corr = -1;
        if (absoluteValue) corr = Math.abs(corr);
      }
      matrix[i * N + j] = corr;
      matrix[j * N + i] = corr;
    }
  }

  return {
    ok: true,
    matrix,
    nSamples: N,
    nMarkersInWindow,
    sampleIndices: sampleSubset.slice(),
  };
}

/**
 * Build the canonical cache key for a (chrom, windowStart, windowEnd,
 * sampleSubset, polarityMode) tuple. The subset is hashed by sorted
 * concatenation so reordering doesn't bust the cache.
 *
 * @param {Object} parts
 * @returns {string}
 */
export function similarityCacheKey(parts) {
  const p = parts || {};
  const subset = Array.isArray(p.sampleSubset)
    ? p.sampleSubset.slice().sort((a, b) => a - b).join(',')
    : '';
  return [
    p.chrom || '',
    p.windowStart | 0,
    p.windowEnd | 0,
    p.polarityMode || 'raw_scan',
    subset,
  ].join('|');
}
