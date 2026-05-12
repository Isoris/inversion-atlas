// shared/haplotype_vocab.js
//
// Per-candidate haplotype vocabulary + auto-classifier. Each candidate
// chooses ONE label vocabulary for its K bands:
//
//   - binary   : AA / AB / BB / RECOMBINANT
//   - standard : HOM_REF / HET / HOM_INV / RECOMBINANT
//   - multi2   : H1/H1 / H1/H2 / H2/H2 / RECOMBINANT
//   - multi3   : H1/H1 / H1/H2 / H1/H3 / H2/H2 / H2/H3 / H3/H3 / RECOMBINANT
//   - free     : (any user-provided string, no closed set)
//
// The classifier inspects per-band statistics (centroid PC1 across the
// candidate's window range + mean per-fish PC1 drift) and emits a
// per-band label suggestion with confidence (none / low / medium / high)
// and a human-readable reason. The het band is identified as the band
// with the highest mean sigma (PC1 drift) — heterozygotes wobble more
// across windows because they straddle two haplotype centroids.
//
// Confidence rules:
//   - n < 5  -> 'low' (or 'RECOMBINANT' for the closed vocabs)
//   - sample_K=3 with clear het bimodal & ordering -> 'high'
//   - irregular / K > 6 / no het signal -> 'low' or 'none'
//
// Legacy origin: lines 61998-62296 of legacy/Inversion_atlas.html.
//
// All entry points take state as their first arg. localStorage access
// is headless-tolerant. Pure-data outputs — no DOM, no HTML strings.

// =====================================================================
// Constants
// =====================================================================

/** localStorage key. Stores a {`${chrom}::${id}`: vocab} dict. */
export const HAP_VOCAB_LS_KEY = 'inversion_atlas.hap_vocabs';

/** The five vocabularies. 'free' = empty closed set. */
export const HAP_VOCAB_OPTIONS = Object.freeze({
  binary:   Object.freeze(['AA', 'AB', 'BB', 'RECOMBINANT']),
  standard: Object.freeze(['HOM_REF', 'HET', 'HOM_INV', 'RECOMBINANT']),
  multi2:   Object.freeze(['H1/H1', 'H1/H2', 'H2/H2', 'RECOMBINANT']),
  multi3:   Object.freeze(['H1/H1', 'H1/H2', 'H1/H3',
                           'H2/H2', 'H2/H3', 'H3/H3', 'RECOMBINANT']),
  free:     Object.freeze([]),
});

/** Het-vs-median ratio threshold for "clear het signal". */
export const HAP_CLEAR_HET_RATIO = 1.4;

/** Minimum band size below which we tag the band as RECOMBINANT-ish. */
export const HAP_RECOMBINANT_MIN_N = 5;

// =====================================================================
// Headless-tolerant localStorage helpers
// =====================================================================

function _hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage;
}

function _candKey(c) {
  return `${c.chrom || '?'}::${c.id}`;
}

// =====================================================================
// Vocabulary picker (persistence + auto-select)
// =====================================================================

/**
 * Heuristic auto-pick of the vocabulary for a candidate based on its
 * K value:
 *   K ≤ 3 → 'standard'    (HOM_REF / HET / HOM_INV)
 *   K = 4 or 5 → 'multi2' (single biallelic split + recombinants)
 *   K = 6 → 'multi3'      (three haplotypes, six diploid combos)
 *   otherwise → 'free'
 *
 * @param {Object} c   candidate ({K} or {K_used} read)
 * @returns {string}   vocabulary id
 */
export function autoSelectVocabForCandidate(c) {
  if (!c) return 'standard';
  const K = c.K || c.K_used || 0;
  if (K <= 3) return 'standard';
  if (K === 6) return 'multi3';
  if (K === 4 || K === 5) return 'multi2';
  return 'free';
}

/**
 * Resolve the active vocabulary for a candidate. Precedence:
 *   1. Explicit user pick (state.haplotypeVocabs[`${chrom}::${id}`])
 *   2. autoSelectVocabForCandidate(c)
 *
 * On first read, also rehydrates state.haplotypeVocabs from localStorage
 * (a single JSON blob keyed by HAP_VOCAB_LS_KEY). All subsequent reads
 * hit the in-memory dict.
 *
 * @param {Object} state
 * @param {Object} c
 * @returns {string}   vocabulary id
 */
export function getHaplotypeVocab(state, c) {
  if (!c) return 'standard';
  if (!state) return autoSelectVocabForCandidate(c);
  if (!state.haplotypeVocabs) {
    state.haplotypeVocabs = {};
    if (_hasLocalStorage()) {
      try {
        const raw = localStorage.getItem(HAP_VOCAB_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') state.haplotypeVocabs = parsed;
        }
      } catch (_) { /* fail-soft */ }
    }
  }
  return state.haplotypeVocabs[_candKey(c)] || autoSelectVocabForCandidate(c);
}

/**
 * Set + persist the vocabulary for a candidate. Auto-initializes
 * state.haplotypeVocabs, auto-persists.
 *
 * @param {Object} state
 * @param {Object} c
 * @param {string} vocab
 * @returns {boolean}
 */
export function setHaplotypeVocab(state, c, vocab) {
  if (!state || !c) return false;
  if (!state.haplotypeVocabs) state.haplotypeVocabs = {};
  state.haplotypeVocabs[_candKey(c)] = vocab;
  if (_hasLocalStorage()) {
    try {
      localStorage.setItem(HAP_VOCAB_LS_KEY, JSON.stringify(state.haplotypeVocabs));
    } catch (_) { /* fail-soft */ }
  }
  return true;
}

// =====================================================================
// Per-band statistics (pure compute)
// =====================================================================

/**
 * Per-band stats for a candidate over [start_w, end_w]:
 *   [{ k, n, centroid_pc1, mean_sigma }, ...]
 *
 * - centroid_pc1: mean per-window mean(PC1) for fish in band k, averaged
 *   across windows in the candidate range.
 * - mean_sigma:   mean per-fish |PC1 - centroid_pc1| averaged across
 *   windows, then across fish in the band. Higher = more het-like
 *   (fish wobble around the centroid because they straddle two
 *   underlying haplotypes).
 *
 * Returns null when the candidate has no locked_labels, no K, or
 * state.data.windows is missing.
 *
 * @param {Object} state
 * @param {Object} c
 * @returns {Array<{k:number,n:number,centroid_pc1:number,mean_sigma:number}>|null}
 */
export function candPerBandStats(state, c) {
  if (!c || !c.locked_labels) return null;
  if (!state || !state.data || !Array.isArray(state.data.windows)) return null;
  const K = c.K || c.K_used || 0;
  if (!K) return null;

  const d = state.data;
  const labels = c.locked_labels;
  const startW = (typeof c.start_w === 'number') ? c.start_w : 0;
  const endW   = (typeof c.end_w   === 'number') ? c.end_w   : (d.windows.length - 1);

  // Per-band sample membership
  const bandSamples = Array.from({ length: K }, () => []);
  for (let s = 0; s < labels.length; s++) {
    const k = labels[s];
    if (k >= 0 && k < K) bandSamples[k].push(s);
  }

  // First pass: window-aggregated centroid per band
  const centroids = new Array(K).fill(0);
  const sumWindows = new Array(K).fill(0);
  for (let w = startW; w <= endW; w++) {
    const win = d.windows[w];
    if (!win || !win.pca || !win.pca.pc1) continue;
    const pc1 = win.pca.pc1;
    for (let k = 0; k < K; k++) {
      let sum = 0, n = 0;
      for (const s of bandSamples[k]) {
        const v = pc1[s];
        if (isFinite(v)) { sum += v; n++; }
      }
      if (n > 0) {
        centroids[k] += sum / n;
        sumWindows[k]++;
      }
    }
  }
  for (let k = 0; k < K; k++) {
    if (sumWindows[k] > 0) centroids[k] /= sumWindows[k];
  }

  // Second pass: mean per-fish drift around band centroid
  const meanSigmas = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    let totalDrift = 0, samplesCounted = 0;
    for (const s of bandSamples[k]) {
      let sumDev = 0, countWin = 0;
      for (let w = startW; w <= endW; w++) {
        const win = d.windows[w];
        if (!win || !win.pca || !win.pca.pc1) continue;
        const v = win.pca.pc1[s];
        if (isFinite(v)) {
          sumDev += Math.abs(v - centroids[k]);
          countWin++;
        }
      }
      if (countWin > 0) {
        totalDrift += sumDev / countWin;
        samplesCounted++;
      }
    }
    meanSigmas[k] = samplesCounted > 0 ? totalDrift / samplesCounted : 0;
  }

  const out = [];
  for (let k = 0; k < K; k++) {
    out.push({
      k,
      n: bandSamples[k].length,
      centroid_pc1: centroids[k],
      mean_sigma: meanSigmas[k],
    });
  }
  return out;
}

// =====================================================================
// Per-band label classifier
// =====================================================================

function _isClosedVocab(vocab) {
  return vocab === 'standard' || vocab === 'binary'
      || vocab === 'multi2'   || vocab === 'multi3';
}

/**
 * Auto-classify a candidate's bands into the active vocabulary's labels.
 * Always returns an object for any non-empty candidate; the caller
 * decides whether to apply suggestions based on each band's confidence.
 *
 * Shape:
 *   { vocab,
 *     per_band: [
 *       { k, label, confidence: 'none'|'low'|'medium'|'high',
 *         reason, n, mean_sigma, centroid_pc1 }, ...
 *     ] }
 *
 * Returns null when c has no K. Returns per_band: [...empty stubs...]
 * when per-window data is missing.
 *
 * @param {Object} state
 * @param {Object} c
 * @returns {Object|null}
 */
export function autoClassifyCandidate(state, c) {
  if (!c) return null;
  const K = c.K || c.K_used || 0;
  if (!K) return null;

  const vocab = getHaplotypeVocab(state, c);
  const stats = candPerBandStats(state, c);
  if (!stats) {
    return {
      vocab,
      per_band: Array.from({ length: K }, (_, k) => ({
        k, label: '', confidence: 'none',
        reason: 'no per-window data',
        n: 0, mean_sigma: NaN, centroid_pc1: NaN,
      })),
    };
  }

  // Sort band indices by centroid PC1 (low → high)
  const order = stats.map((_, i) => i)
    .sort((a, b) => stats[a].centroid_pc1 - stats[b].centroid_pc1);

  // Identify the band with the highest mean_sigma (likely het, since
  // heterozygotes wobble most between haplotype centroids).
  let hetBand = -1;
  let maxSigma = -Infinity;
  for (let k = 0; k < K; k++) {
    if (stats[k].n >= HAP_RECOMBINANT_MIN_N && stats[k].mean_sigma > maxSigma) {
      maxSigma = stats[k].mean_sigma;
      hetBand = k;
    }
  }
  const sortedSigmas = [...stats.map(s => s.mean_sigma)].sort((a, b) => a - b);
  const medianSigma = sortedSigmas[Math.floor(sortedSigmas.length / 2)] || 0;
  const hetRatio = (medianSigma > 0 && maxSigma > 0) ? maxSigma / medianSigma : 1;
  const hasClearHet = hetRatio > HAP_CLEAR_HET_RATIO;

  const per_band = stats.map((s, k) => {
    const out = {
      k,
      label: '',
      confidence: 'none',
      reason: '',
      n: s.n,
      mean_sigma: s.mean_sigma,
      centroid_pc1: s.centroid_pc1,
    };

    if (s.n < HAP_RECOMBINANT_MIN_N) {
      out.label = _isClosedVocab(vocab) ? 'RECOMBINANT' : '';
      out.confidence = 'medium';
      out.reason = `only ${s.n} samples — likely recombinants`;
      return out;
    }

    if (vocab === 'standard') {
      const posInOrder = order.indexOf(k);
      if (k === hetBand && hasClearHet) {
        out.label = 'HET';
        out.confidence = 'high';
        out.reason = `highest sigma (${s.mean_sigma.toFixed(3)}, ${(hetRatio).toFixed(1)}× median)`;
      } else if (posInOrder === 0) {
        out.label = 'HOM_REF';
        out.confidence = hasClearHet ? 'high' : 'medium';
        out.reason = `leftmost on PC1 (centroid ${s.centroid_pc1.toFixed(2)})`;
      } else if (posInOrder === order.length - 1) {
        out.label = 'HOM_INV';
        out.confidence = hasClearHet ? 'high' : 'medium';
        out.reason = `rightmost on PC1 (centroid ${s.centroid_pc1.toFixed(2)})`;
      } else {
        out.label = 'HET';
        out.confidence = 'low';
        out.reason = `middle PC1 band but het signal weak (ratio ${hetRatio.toFixed(2)})`;
      }
      return out;
    }

    if (vocab === 'binary') {
      const posInOrder = order.indexOf(k);
      if (posInOrder === 0) {
        out.label = 'AA';
        out.confidence = 'medium';
        out.reason = 'leftmost on PC1';
      } else if (posInOrder === order.length - 1) {
        out.label = 'BB';
        out.confidence = 'medium';
        out.reason = 'rightmost on PC1';
      } else {
        out.label = 'AB';
        out.confidence = (k === hetBand && hasClearHet) ? 'high' : 'low';
        out.reason = (k === hetBand && hasClearHet)
          ? 'middle band, highest sigma (likely heterozygote)'
          : 'middle band, het signal unclear';
      }
      return out;
    }

    if (vocab === 'multi2') {
      const posInOrder = order.indexOf(k);
      const fraction = posInOrder / Math.max(1, order.length - 1);
      if (k === hetBand && hasClearHet) {
        out.label = 'H1/H2';
        out.confidence = 'medium';
        out.reason = 'highest sigma, likely heterozygote H1/H2';
      } else if (fraction < 0.34) {
        out.label = 'H1/H1';
        out.confidence = 'low';
        out.reason = 'left side of PC1 ordering';
      } else if (fraction > 0.66) {
        out.label = 'H2/H2';
        out.confidence = 'low';
        out.reason = 'right side of PC1 ordering';
      } else {
        out.label = 'H1/H2';
        out.confidence = 'low';
        out.reason = 'middle of PC1 ordering, het signal unclear';
      }
      return out;
    }

    if (vocab === 'multi3') {
      const posInOrder = order.indexOf(k);
      const fraction = posInOrder / Math.max(1, order.length - 1);
      const candidateLabels = ['H1/H1', 'H1/H2', 'H1/H3', 'H2/H2', 'H2/H3', 'H3/H3'];
      const guessIdx = Math.min(candidateLabels.length - 1,
        Math.floor(fraction * candidateLabels.length));
      out.label = candidateLabels[guessIdx];
      out.confidence = 'low';
      out.reason = `K=6 PC1 position ${posInOrder + 1}/${order.length}; multi-haplotype assignment is ambiguous, please review`;
      return out;
    }

    // free vocab: no suggestion
    out.label = '';
    out.confidence = 'none';
    out.reason = 'free vocabulary, type your own label';
    return out;
  });

  return { vocab, per_band };
}
