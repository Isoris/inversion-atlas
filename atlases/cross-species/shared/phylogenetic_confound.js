// shared/phylogenetic_confound.js
// =====================================================================
// PHYLOGENETIC-CONFOUND STRESS TEST FOR KARYOTYPE CALLS.
//
// Scientific problem (the user's pushback): the "3 bands" we see in
// local PCA at a candidate inversion can be EITHER
//
//   (a) genuine karyotype signal (AA / AB / BB) — the inversion
//       genuinely creates 3 genetic states in the cohort, OR
//
//   (b) phylogenetic-lineage leakage — three lineages happen to
//       have different allele frequencies at the locus, creating 3
//       PC1 modes that LOOK like karyotype bands but are actually
//       population/lineage divisions.
//
// Our atlas approach (K-means on local PCA → 3 clusters → karyotype
// labels) cannot tell these two apart on its own. To rule out (b)
// we need to compare the K-means labels with phylogenetic clade
// assignments from an INDEPENDENT phylogenetic tree (e.g., whole-
// genome ML phylogeny or a non-inversion-region tree). If the
// karyotype labels are largely orthogonal to the clade labels →
// the karyotype call is real biology. If they track each other →
// the call is a phylogenetic-structure artefact.
//
// Mirrors the structure of shared/ancestry_confound.js (which does
// the same thing for ancestry Q-vectors). Both modules consume
// pre-computed labels per sample; this module does NOT parse trees
// itself — the caller supplies the clade-per-sample mapping.
//
// Stress test summary (one call, three statistics):
//   - ARI (adjusted Rand index)
//   - NMI (normalized mutual information)
//   - Cramér's V on the K×L contingency
// + a 4-state verdict + a permutation-style χ² p-value.
//
// =====================================================================
// RECOMMENDED INPUT: which tree?
// =====================================================================
// For this confound check you do NOT need a perfect species phylogeny.
// You need a BACKGROUND SAMPLE-RELATIONSHIP TREE that tells you which
// individuals cluster genome-wide. Ranked in order of suitability:
//
//   1. PCAngsd cov.tree from genome-wide neutral/callable SNPs
//      — topology / clustering matters; branch lengths don't here.
//      This is the recommended first option.
//
//   2. iqtree2 ML tree using monomorphic + polymorphic GLs
//      (heteromorphic treated as missing). More correct for branch
//      lengths but unnecessary for the band-vs-clade check.
//
//   3. Genome-wide distance tree from neutral callable sites.
//
//   AVOID for this purpose: singleton/SFS-based trees — too noisy at
//   ~9× WGS, sensitive to sequencing / mapping / batch artefacts.
//
// WHEN THIS IS / ISN'T CIRCULAR
//
//   It is NOT circular when:
//     - background tree: built from genome-wide SNPs / GLs that
//       EXCLUDE the candidate POD intervals (or all high-LD blocks)
//     - POD bands: defined from the local candidate interval only
//     - question: do POD bands follow the BACKGROUND structure?
//   This is comparing a local signal against an independent global
//   reference frame — perfectly valid.
//
//   It IS circular when:
//     - the same data feeds both sides of the comparison (e.g. the
//       tree was built from data that includes the POD interval, OR
//       both the tree and the bands come from the same interval).
//   In that case you're confirming a signal with itself.
//
// The framing to use atlas-side: this module asks "do POD bands
// follow background sample structure?" The cov.tree is a
// background-relatedness frame, not a true species phylogeny —
// that's fine because we're not asking about evolutionary history,
// just whether the bands ARE the global structure.
//
// The opt `tree_excludes_candidate` is a SOFT flag — the caller
// records whether they followed the recommendation. When false or
// missing, the result carries `circularity_advisory: true` (advice,
// not a hard error).
// =====================================================================

// 2026-05-23 Phase 1c: phylogenetic_confound moved here from inversion/shared/.
// contingency stays in inversion/shared/ as an L3 primitive used by every
// atlas (per migration plan §1.1 + atlas-core-proposals SPEC_workflows_v1).
import { computeARI, computeNMI, cramersV, chiSquare, chiSqSurvival }
  from '../../inversion/shared/contingency.js';

// =====================================================================
// Vocab + defaults
// =====================================================================

/** 4-state confound verdict. CONFOUNDED means our karyotype calls
 *  are almost certainly tracking background sample structure rather
 *  than a local inversion signal. INDEPENDENT means the karyotype
 *  call is orthogonal to background → safer to interpret as a real
 *  arrangement. */
export const PHYLO_CONFOUND_VERDICTS = Object.freeze({
  CONFOUNDED:           'confounded',
  PARTIALLY_CONFOUNDED: 'partially_confounded',
  INDEPENDENT:          'independent',
  INSUFFICIENT_DATA:    'insufficient_data',
});

/** 4-label biological interpretation table, combining the confound
 *  verdict with optional auxiliary evidence (breakpoint support,
 *  family-clustering signal). The page renders this as the
 *  one-word interpretation chip per candidate. */
export const PHYLO_CONFOUND_INTERPRETATIONS = Object.freeze({
  ANCESTRY_LIKE:           'ancestry_like',
  LOCAL_HAPLOTYPE_REGIME:  'local_haplotype_regime',
  INVERSION_SUPPORTED:     'inversion_supported',
  FAMILY_LD_SUSPECT:       'family_ld_suspect',
  UNKNOWN:                 'unknown',
});

/** Default thresholds, matched conservatively against
 *  ancestry_confound.js's sample-level thresholds. */
export const PHYLO_CONFOUND_DEFAULTS = Object.freeze({
  /** Cramér's V ≥ this → CONFOUNDED. */
  confounded_v_above:        0.60,
  /** Cramér's V ≤ this → INDEPENDENT (other tests willing). */
  independent_v_below:       0.30,
  /** ARI ≥ this is also evidence of confounding (cluster-cluster
   *  agreement beyond chance). */
  confounded_ari_above:      0.40,
  /** NMI ≥ this → at least PARTIALLY_CONFOUNDED. */
  partially_confounded_nmi:  0.15,
  /** Minimum overlapping samples to fire the test at all. */
  min_n_overlap:             20,
  /** Significance level for the χ² of independence. */
  alpha:                     0.05,
});

// =====================================================================
// 1. Label normalisation
// =====================================================================

/**
 * Coerce karyotype labels to canonical integer encoding
 *   0 = AA / STD/STD / 'AA'
 *   1 = AB / HET     / 'AB'
 *   2 = BB / INV/INV / 'BB'
 *  -1 = missing (string null / undefined / -1)
 *
 * Returns Int8Array of the same length as the input.
 */
export function normaliseKaryotypeLabels(labels) {
  const out = new Int8Array(labels ? labels.length : 0);
  if (!labels) return out;
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i];
    if (v == null) { out[i] = -1; continue; }
    if (typeof v === 'number') {
      out[i] = (v === 0 || v === 1 || v === 2) ? v : -1;
      continue;
    }
    const s = String(v);
    if (s === 'AA' || s === 'STD/STD' || s === '0')         out[i] = 0;
    else if (s === 'AB' || s === 'HET' || s === '1')        out[i] = 1;
    else if (s === 'BB' || s === 'INV/INV' || s === '2')    out[i] = 2;
    else                                                    out[i] = -1;
  }
  return out;
}

// =====================================================================
// 2. Stress test — karyotype K-means clusters vs phylogenetic clades
// =====================================================================

/**
 * Run the karyotype-vs-clade confound test on a sample list.
 *
 * @param {Int8Array|Array<number|string>} karyotype_per_sample
 *   per-sample K-means karyotype call (encoding per
 *   normaliseKaryotypeLabels)
 * @param {Array<string|number|null>} clade_per_sample
 *   per-sample phylogenetic clade label (any hashable). Null /
 *   undefined samples are dropped from the overlap.
 * @param {Object} [opts]
 * @returns {{
 *   n_overlap:    int,
 *   n_karyotypes: int,                // distinct non-missing karyotype calls
 *   n_clades:     int,                // distinct non-missing clades
 *   ari:          number,
 *   nmi:          number,
 *   cramers_v:    number,
 *   chi2:         number, df: int, p_value: number,
 *   table:        number[][],         // K × L contingency
 *   verdict:      string,             // one of PHYLO_CONFOUND_VERDICTS
 * }}
 */
export function classifyPhylogeneticConfound(karyotype_per_sample, clade_per_sample, opts) {
  const o = opts || {};
  const D = PHYLO_CONFOUND_DEFAULTS;
  const vConf  = Number.isFinite(o.confounded_v_above)       ? o.confounded_v_above       : D.confounded_v_above;
  const vIndep = Number.isFinite(o.independent_v_below)      ? o.independent_v_below      : D.independent_v_below;
  const ariConf = Number.isFinite(o.confounded_ari_above)    ? o.confounded_ari_above     : D.confounded_ari_above;
  const nmiPart = Number.isFinite(o.partially_confounded_nmi)? o.partially_confounded_nmi : D.partially_confounded_nmi;
  const minN   = Number.isFinite(o.min_n_overlap)            ? o.min_n_overlap            : D.min_n_overlap;
  const alpha  = Number.isFinite(o.alpha)                    ? o.alpha                    : D.alpha;

  const ky = normaliseKaryotypeLabels(karyotype_per_sample);
  const cl = clade_per_sample || [];
  const N = Math.min(ky.length, cl.length);

  // Overlap: samples with both a non-missing karyotype AND non-null clade.
  const usedKy = [];
  const usedCl = [];
  for (let i = 0; i < N; i++) {
    if (ky[i] < 0) continue;
    const c = cl[i];
    if (c == null) continue;
    usedKy.push(ky[i]);
    usedCl.push(String(c));
  }
  const n_overlap = usedKy.length;

  // Distinct counts
  const setKy = new Set(usedKy);
  const setCl = new Set(usedCl);
  const n_karyotypes = setKy.size;
  const n_clades     = setCl.size;

  if (n_overlap < minN || n_karyotypes < 2 || n_clades < 2) {
    return {
      n_overlap, n_karyotypes, n_clades,
      ari: NaN, nmi: NaN, cramers_v: NaN,
      chi2: NaN, df: NaN, p_value: NaN,
      table: [],
      verdict: PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA,
    };
  }

  // K × L contingency
  const kyIdx = new Map();
  const clIdx = new Map();
  for (const k of setKy) if (!kyIdx.has(k)) kyIdx.set(k, kyIdx.size);
  for (const c of setCl) if (!clIdx.has(c)) clIdx.set(c, clIdx.size);
  const K = kyIdx.size, L = clIdx.size;
  const table = new Array(K);
  for (let r = 0; r < K; r++) {
    table[r] = new Array(L).fill(0);
  }
  for (let i = 0; i < n_overlap; i++) {
    const r = kyIdx.get(usedKy[i]);
    const c = clIdx.get(usedCl[i]);
    table[r][c]++;
  }
  // cramersV expects flat row-major; chiSquare wants the K×K shape
  // but tolerates rectangular if we pass max(K,L) as the dimension
  // — to be safe, embed into max-dim square if needed.
  const dim = Math.max(K, L);
  const square = new Array(dim);
  for (let r = 0; r < dim; r++) {
    square[r] = new Array(dim).fill(0);
    if (r < K) {
      for (let c = 0; c < L; c++) square[r][c] = table[r][c];
    }
  }
  const cs = chiSquare(square, dim);
  const p_value = chiSqSurvival(cs.chi2, (K - 1) * (L - 1));
  const flat = new Int32Array(K * L);
  for (let r = 0; r < K; r++) {
    for (let c = 0; c < L; c++) flat[r * L + c] = table[r][c];
  }
  const v = cramersV(flat, K, L);
  const ari = computeARI(usedKy, usedCl);
  const nmi = computeNMI(usedKy, usedCl);

  // Verdict logic — multiple lines of evidence:
  //   CONFOUNDED:        V ≥ 0.60 OR ARI ≥ 0.40 (both with p < alpha)
  //   PARTIALLY:         (V ≥ 0.30 OR NMI ≥ 0.15) AND p < alpha
  //   INDEPENDENT:       V < 0.30 OR p ≥ alpha
  //   else fall through to PARTIALLY (conservative).
  let verdict;
  const significant = Number.isFinite(p_value) && p_value < alpha;
  if (significant && (v >= vConf || ari >= ariConf)) {
    verdict = PHYLO_CONFOUND_VERDICTS.CONFOUNDED;
  } else if (significant && (v >= vIndep || nmi >= nmiPart)) {
    verdict = PHYLO_CONFOUND_VERDICTS.PARTIALLY_CONFOUNDED;
  } else if (!significant || v < vIndep) {
    verdict = PHYLO_CONFOUND_VERDICTS.INDEPENDENT;
  } else {
    verdict = PHYLO_CONFOUND_VERDICTS.PARTIALLY_CONFOUNDED;
  }

  return {
    n_overlap, n_karyotypes, n_clades,
    ari, nmi, cramers_v: v,
    chi2: cs.chi2, df: (K - 1) * (L - 1), p_value,
    table,
    verdict,
  };
}

// =====================================================================
// 3. Convenience: flag for a single candidate
// =====================================================================

/**
 * Map (verdict, breakpoint_supported, family_clustering) into the
 * biological-interpretation table you'd render as a one-word chip:
 *
 *   verdict=confounded   + family_clustering=true  → family_ld_suspect
 *   verdict=confounded   else                       → ancestry_like
 *   verdict=independent  + breakpoint_supported=true → inversion_supported
 *   verdict=independent  else                       → local_haplotype_regime
 *   verdict=partial      → ancestry_like (conservative)
 *   verdict=insufficient → unknown
 *
 * @param {string} verdict             one of PHYLO_CONFOUND_VERDICTS values
 * @param {{breakpoint_supported?:boolean, family_clustering?:boolean}} [aux]
 * @returns {string}                   one of PHYLO_CONFOUND_INTERPRETATIONS values
 */
export function interpretConfoundResult(verdict, aux) {
  const a = aux || {};
  if (verdict === PHYLO_CONFOUND_VERDICTS.INSUFFICIENT_DATA) {
    return PHYLO_CONFOUND_INTERPRETATIONS.UNKNOWN;
  }
  if (verdict === PHYLO_CONFOUND_VERDICTS.CONFOUNDED) {
    return a.family_clustering
      ? PHYLO_CONFOUND_INTERPRETATIONS.FAMILY_LD_SUSPECT
      : PHYLO_CONFOUND_INTERPRETATIONS.ANCESTRY_LIKE;
  }
  if (verdict === PHYLO_CONFOUND_VERDICTS.INDEPENDENT) {
    return a.breakpoint_supported
      ? PHYLO_CONFOUND_INTERPRETATIONS.INVERSION_SUPPORTED
      : PHYLO_CONFOUND_INTERPRETATIONS.LOCAL_HAPLOTYPE_REGIME;
  }
  // PARTIALLY_CONFOUNDED — conservative: lean ancestry-like
  return PHYLO_CONFOUND_INTERPRETATIONS.ANCESTRY_LIKE;
}

/**
 * Wrap classifyPhylogeneticConfound and return only the headline
 * verdict + key statistics + the biological interpretation label.
 * Returns null when both inputs are missing.
 *
 * Page-side use: surfaces this as a per-candidate QC chip — show
 * the warning alongside the candidate row when the interpretation
 * is 'ancestry_like' or 'family_ld_suspect'.
 *
 * `opts.tree_excludes_candidate` (boolean, default true) — set
 * false when the background tree includes the candidate's SNPs to
 * surface a `circularity_advisory: true` flag on the output.
 *
 * `opts.breakpoint_supported` / `opts.family_clustering` — auxiliary
 * evidence consumed by interpretConfoundResult.
 *
 * @returns {{verdict:string, interpretation:string, cramers_v:number,
 *            ari:number, p_value:number, n_overlap:number,
 *            circularity_advisory:boolean}|null}
 */
export function summariseConfoundForCandidate(
  karyotype_per_sample, clade_per_sample, opts,
) {
  if (!karyotype_per_sample && !clade_per_sample) return null;
  const o = opts || {};
  const r = classifyPhylogeneticConfound(karyotype_per_sample, clade_per_sample, opts);
  const interpretation = interpretConfoundResult(r.verdict, {
    breakpoint_supported: o.breakpoint_supported,
    family_clustering:    o.family_clustering,
  });
  const circularity_advisory = o.tree_excludes_candidate === false;
  return {
    verdict:               r.verdict,
    interpretation,
    cramers_v:             r.cramers_v,
    ari:                   r.ari,
    p_value:               r.p_value,
    n_overlap:             r.n_overlap,
    circularity_advisory,
  };
}
