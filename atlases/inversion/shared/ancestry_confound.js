// shared/ancestry_confound.js
//
// Ancestry-confound diagnostic for candidate inversions. Answers:
// "is the K-means band assignment for this candidate tracking
// ancestry (Q-vectors from NGSadmix) rather than real local biology?"
//
// Three orthogonal tests:
//   T1 — genome-wide Q vs locked_labels (Cramér's V + max |corr|)
//   T2 — focal-chrom Q vs locked_labels (same metrics)
//   T3 — per-SNP support coherence (does the SNP-level Q match the
//        band-level Q the sample-tests recovered?)
//
// And a combined verdict that distinguishes patterns:
//   ALL_THREE_SUSPECT  — strong ancestry-artifact signal
//   GENOME_ONLY        — bands track genome-wide Q but not focal-chrom Q
//   FOCAL_ONLY         — bands track focal-chrom Q but not genome-wide
//                        (most interesting case: real local segregation)
//   SAMPLE_INDEPENDENT — both sample-tests come back INDEPENDENT
//   PARTIAL            — mixed signals
//   EMPTY              — no Q layers loaded
//
// Pure math + pure layer accessors + alignment helper + sample-test
// runner. The DOM-side `candidateAncestryConfoundHtml(c)` HTML builder
// stays in legacy — it's a presentation concern that drops out once
// the page-side panel adopts these primitives.
//
// Legacy origin: lines 58068-58289 of legacy/Inversion_atlas.html.

// =====================================================================
// Constants
// =====================================================================

/** Default thresholds for the sample-level (Test 1 / Test 2) verdict. */
export const ANCESTRY_SAMPLE_VERDICT_DEFAULTS = Object.freeze({
  suspect_v:    0.6,   // Cramér's V ≥ this → BAND_TRACKS_ANCESTRY
  suspect_corr: 0.7,   // max |r| ≥ this   → BAND_TRACKS_ANCESTRY
  indep_v:      0.3,   // BOTH below these → BAND_INDEPENDENT_OF_ANCESTRY
  indep_corr:   0.4,
});

/** Default thresholds for the SNP-level (Test 3) verdict. */
export const ANCESTRY_SNP_VERDICT_DEFAULTS = Object.freeze({
  coherent: 0.65,   // dominant Q fraction ≥ this → Q_COHERENT
  mixed:    0.40,   // dominant Q fraction < this → Q_MIXED
                    // otherwise → Q_PARTIAL
});

/** Min sample overlap required to run a sample-level test. */
export const ANCESTRY_MIN_OVERLAP = 10;

/** Min SNPs in span required for Test 3. */
export const ANCESTRY_MIN_SNPS = 5;

/** Sample-level verdict values. */
export const ANCESTRY_SAMPLE_VERDICTS = Object.freeze([
  'BAND_TRACKS_ANCESTRY',
  'BAND_INDEPENDENT_OF_ANCESTRY',
  'INCONCLUSIVE',
]);

/** SNP-level verdict values. */
export const ANCESTRY_SNP_VERDICTS = Object.freeze([
  'Q_COHERENT', 'Q_MIXED', 'Q_PARTIAL', 'INCONCLUSIVE',
]);

/** Combined verdict values. */
export const ANCESTRY_COMBINED_VERDICTS = Object.freeze([
  'ALL_THREE_SUSPECT', 'GENOME_ONLY', 'FOCAL_ONLY',
  'SAMPLE_INDEPENDENT', 'PARTIAL', 'EMPTY',
]);

// =====================================================================
// Pure-math helpers
// =====================================================================

/**
 * Cramér's V for two equal-length integer-label arrays. Returns
 *   { v, chi2, n, rA, rB, ok, why }
 * Bounds: V ∈ [0, 1]. ok=false on shape errors or one-class inputs.
 */
export function ancCramersV(labelsA, labelsB) {
  if (!Array.isArray(labelsA) || !Array.isArray(labelsB)) {
    return { v: NaN, ok: false, why: 'inputs not arrays' };
  }
  if (labelsA.length !== labelsB.length) {
    return { v: NaN, ok: false, why: 'length mismatch' };
  }
  const n = labelsA.length;
  if (n < 2) return { v: NaN, ok: false, why: 'n<2' };
  const valsA = Array.from(new Set(labelsA)).sort((x, y) => x - y);
  const valsB = Array.from(new Set(labelsB)).sort((x, y) => x - y);
  const rA = valsA.length, rB = valsB.length;
  if (rA < 2 || rB < 2) return { v: 0, ok: false, why: 'one-class' };
  const idxA = new Map(valsA.map((v, i) => [v, i]));
  const idxB = new Map(valsB.map((v, i) => [v, i]));
  const obs = Array.from({ length: rA }, () => new Array(rB).fill(0));
  for (let i = 0; i < n; i++) obs[idxA.get(labelsA[i])][idxB.get(labelsB[i])]++;
  const rowSum = obs.map(r => r.reduce((s, v) => s + v, 0));
  const colSum = new Array(rB).fill(0);
  for (let i = 0; i < rA; i++) for (let j = 0; j < rB; j++) colSum[j] += obs[i][j];
  let chi2 = 0;
  for (let i = 0; i < rA; i++) {
    for (let j = 0; j < rB; j++) {
      const exp = (rowSum[i] * colSum[j]) / n;
      if (exp > 0) { const d = obs[i][j] - exp; chi2 += (d * d) / exp; }
    }
  }
  const v = Math.sqrt(chi2 / (n * Math.min(rA - 1, rB - 1)));
  return { v, chi2, n, rA, rB, ok: true, why: '' };
}

/**
 * Pearson correlation r ∈ [-1, 1]. Returns NaN when n < 2; 0 when
 * either side has zero variance.
 */
export function ancPearson(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

/**
 * For each unique band label, find the Q column (0..K-1) with the
 * highest |Pearson r| against the band's indicator vector. Returns
 * the maximum across all bands plus a per-band map.
 *
 *   { maxAbs, byBand: { [band]: { Qk, r } }, ok, why }
 */
export function ancMaxAbsBandQCorr(labels, Q) {
  if (!Array.isArray(labels) || !Array.isArray(Q)) {
    return { maxAbs: NaN, byBand: {}, ok: false, why: 'inputs not arrays' };
  }
  const n = labels.length;
  if (n < 2 || Q.length !== n) {
    return { maxAbs: NaN, byBand: {}, ok: false, why: 'length mismatch or n<2' };
  }
  const K = Q[0] && Q[0].length;
  if (!K || K < 1) return { maxAbs: NaN, byBand: {}, ok: false, why: 'no Q columns' };
  const bands = Array.from(new Set(labels)).sort((a, b) => a - b);
  let maxAbs = 0;
  const byBand = {};
  for (const b of bands) {
    const indicator = labels.map(L => (L === b ? 1 : 0));
    let bestK = -1, bestR = 0, bestAbs = 0;
    for (let k = 0; k < K; k++) {
      const col = new Array(n);
      for (let i = 0; i < n; i++) col[i] = Q[i][k];
      const r = ancPearson(indicator, col);
      const ar = Math.abs(r);
      if (ar > bestAbs) { bestAbs = ar; bestR = r; bestK = k; }
    }
    byBand[b] = { Qk: bestK, r: bestR };
    if (bestAbs > maxAbs) maxAbs = bestAbs;
  }
  return { maxAbs, byBand, ok: true, why: '' };
}

// =====================================================================
// Verdicts
// =====================================================================

/**
 * Convert Cramér's V + max|r| to a sample-level verdict:
 *   BAND_TRACKS_ANCESTRY         either metric ≥ suspect threshold
 *   BAND_INDEPENDENT_OF_ANCESTRY both metrics < indep threshold
 *   INCONCLUSIVE                 mixed / non-finite
 */
export function ancVerdictSampleLevel(v, maxAbs, opts) {
  const t = Object.assign({}, ANCESTRY_SAMPLE_VERDICT_DEFAULTS, opts || {});
  if (!Number.isFinite(v) || !Number.isFinite(maxAbs)) return 'INCONCLUSIVE';
  if (v >= t.suspect_v || maxAbs >= t.suspect_corr) return 'BAND_TRACKS_ANCESTRY';
  if (v < t.indep_v && maxAbs < t.indep_corr)       return 'BAND_INDEPENDENT_OF_ANCESTRY';
  return 'INCONCLUSIVE';
}

/**
 * Compute SNP-level coherence: fraction of SNPs whose dominant Q
 * matches the modal best_Q across the candidate span.
 *
 * Input: snps[] each with { pos, best_Q (1..K), support: [K] }
 * Returns:
 *   { coherence: dominantFrac, dominantQ, dominantFrac, entropy, n, ok, why }
 *
 * Returns ok=false when fewer than ANCESTRY_MIN_SNPS in span or no
 * best_Q values present.
 */
export function ancSnpCoherence(snps) {
  if (!Array.isArray(snps)) return { ok: false, why: 'no snps array' };
  const n = snps.length;
  if (n < ANCESTRY_MIN_SNPS) {
    return { ok: false, why: `n<${ANCESTRY_MIN_SNPS} (got ${n})`, n };
  }
  const counts = new Map();
  let total = 0;
  for (const s of snps) {
    if (!s || s.best_Q == null) continue;
    counts.set(s.best_Q, (counts.get(s.best_Q) || 0) + 1);
    total++;
  }
  if (total === 0) return { ok: false, why: 'no best_Q values', n };
  let dominantQ = -1, dominantN = 0;
  for (const [k, c] of counts) if (c > dominantN) { dominantN = c; dominantQ = k; }
  const dominantFrac = dominantN / total;
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return {
    coherence: dominantFrac, dominantQ, dominantFrac, entropy,
    n: total, ok: true, why: '',
  };
}

/**
 * Convert an ancSnpCoherence result to a SNP-level verdict
 * (Q_COHERENT / Q_MIXED / Q_PARTIAL / INCONCLUSIVE).
 */
export function ancVerdictSnpLevel(coh, opts) {
  const t = Object.assign({}, ANCESTRY_SNP_VERDICT_DEFAULTS, opts || {});
  if (!coh || !coh.ok) return 'INCONCLUSIVE';
  if (coh.coherence >= t.coherent) return 'Q_COHERENT';
  if (coh.coherence  < t.mixed)    return 'Q_MIXED';
  return 'Q_PARTIAL';
}

/**
 * Synthesize the three per-test verdicts into one combined verdict.
 * See module header for the pattern-matching semantics.
 */
export function ancCombinedVerdict(t1, t2, t3) {
  const have1 = t1 && t1.ok, have2 = t2 && t2.ok, have3 = t3 && t3.ok;
  if (!have1 && !have2 && !have3) return 'EMPTY';
  const v1 = have1 ? t1.verdict : null;
  const v2 = have2 ? t2.verdict : null;
  const v3 = have3 ? t3.verdict : null;
  const susp1 = v1 === 'BAND_TRACKS_ANCESTRY';
  const susp2 = v2 === 'BAND_TRACKS_ANCESTRY';
  const indep1 = v1 === 'BAND_INDEPENDENT_OF_ANCESTRY';
  const indep2 = v2 === 'BAND_INDEPENDENT_OF_ANCESTRY';
  const coherent = v3 === 'Q_COHERENT';
  if (have1 && have2 && susp1 && susp2 && coherent) return 'ALL_THREE_SUSPECT';
  if (have1 && have2 && susp1 && !susp2)            return 'GENOME_ONLY';
  if (have1 && have2 && !susp1 && susp2)            return 'FOCAL_ONLY';
  if (have1 && have2 && indep1 && indep2)           return 'SAMPLE_INDEPENDENT';
  if ((susp1 || susp2) && !coherent && have3)       return 'PARTIAL';
  return 'PARTIAL';
}

// =====================================================================
// Layer accessors (state-as-arg)
// =====================================================================

/**
 * Pull state.data.ancestry_q_global. Returns
 *   { K, samples, q, source }
 * or null when the layer is missing / malformed.
 */
export function ancGetGlobalQ(stateData) {
  const L = stateData && stateData.ancestry_q_global;
  if (!L || !Array.isArray(L.samples) || !Array.isArray(L.q)) return null;
  return {
    K: L.K, samples: L.samples, q: L.q,
    source: 'q_global.tsv (genome-wide, all chroms)',
  };
}

/**
 * Pull state.data.ancestry_q_chrom. Returns the same shape plus
 * `chrom` from the layer.
 */
export function ancGetChromQ(stateData) {
  const L = stateData && stateData.ancestry_q_chrom;
  if (!L || !Array.isArray(L.samples) || !Array.isArray(L.q)) return null;
  return {
    K: L.K, samples: L.samples, q: L.q, chrom: L.chrom,
    source: 'q_chromosome.tsv (focal chrom: ' + (L.chrom || '?') + ')',
  };
}

/**
 * Pull state.data.snp_q_support and filter to SNPs inside
 * [startBp, endBp] inclusive. Returns
 *   { K, snps, total_in_layer, source }
 * or null when the layer is missing / malformed.
 */
export function ancGetSnpSupport(stateData, startBp, endBp) {
  const L = stateData && stateData.snp_q_support;
  if (!L || !Array.isArray(L.snps)) return null;
  const inSpan = L.snps.filter(s => s && s.pos >= startBp && s.pos <= endBp);
  return {
    K: L.K, snps: inSpan, total_in_layer: L.snps.length,
    source: 'q_support_per_snp.tsv (n=' + inSpan.length + ' SNPs in candidate span)',
  };
}

// =====================================================================
// Label alignment + sample-test runner
// =====================================================================

/**
 * Align a candidate's locked_labels to a Q layer's sample order.
 * The two layers may have been generated against different sample
 * lists; this walks the Q layer's `samples` array, looks each name
 * up in state.data.samples by cga/ind, and builds parallel
 * `labels[]` / `Q[]` arrays restricted to the overlap.
 *
 * Returns:
 *   { labels, Q, n, n_missing }
 * or null when prereqs are missing.
 *
 * Samples in Q but not in state.data.samples increment n_missing;
 * samples with locked_labels[di] < 0 or null are silently dropped.
 *
 * @param {Object} state                  reads state.data.samples
 * @param {{locked_labels:number[]}} c
 * @param {{samples:string[], q:number[][]}} qLayer
 */
export function ancAlignLabels(state, c, qLayer) {
  if (!c || !c.locked_labels || !qLayer || !qLayer.samples) return null;
  const dataSamples = state && state.data && state.data.samples;
  if (!dataSamples) return null;
  const nameToIdx = new Map();
  for (let i = 0; i < dataSamples.length; i++) {
    const s = dataSamples[i];
    const nm = s && (s.cga || s.ind);
    if (nm) nameToIdx.set(String(nm), i);
  }
  const labels = [];
  const Q = [];
  let nMissing = 0;
  for (let qi = 0; qi < qLayer.samples.length; qi++) {
    const nm = String(qLayer.samples[qi]);
    const di = nameToIdx.get(nm);
    if (di == null) { nMissing++; continue; }
    const lbl = c.locked_labels[di];
    if (lbl == null || lbl < 0) continue;
    labels.push(lbl);
    Q.push(qLayer.q[qi]);
  }
  return { labels, Q, n: labels.length, n_missing: nMissing };
}

/**
 * Run a single sample-level test (Test 1 OR Test 2). Returns:
 *   { ok, n, n_missing, cramersV, maxAbsCorr, byBand, verdict, source, K }
 * or { ok: false, why } when the test can't run (no layer, insufficient
 * overlap < ANCESTRY_MIN_OVERLAP, etc.).
 *
 * @param {Object} state
 * @param {{locked_labels:number[]}} c
 * @param {{samples:string[], q:number[][], source:string, K:number}|null} qLayer
 */
export function ancRunSampleTest(state, c, qLayer) {
  if (!qLayer) return { ok: false, why: 'layer absent' };
  const aligned = ancAlignLabels(state, c, qLayer);
  if (!aligned || aligned.n < ANCESTRY_MIN_OVERLAP) {
    return { ok: false, why: 'insufficient overlap (n=' + (aligned ? aligned.n : 0) + ')' };
  }
  const argmaxQ = aligned.Q.map(qVec => {
    let bestK = 0, bestV = -Infinity;
    for (let k = 0; k < qVec.length; k++) if (qVec[k] > bestV) { bestV = qVec[k]; bestK = k; }
    return bestK;
  });
  const cv = ancCramersV(aligned.labels, argmaxQ);
  const corr = ancMaxAbsBandQCorr(aligned.labels, aligned.Q);
  const verdict = ancVerdictSampleLevel(cv.v, corr.maxAbs);
  return {
    ok: true,
    n: aligned.n,
    n_missing: aligned.n_missing,
    cramersV: cv.v,
    maxAbsCorr: corr.maxAbs,
    byBand: corr.byBand,
    verdict,
    source: qLayer.source,
    K: qLayer.K,
  };
}
