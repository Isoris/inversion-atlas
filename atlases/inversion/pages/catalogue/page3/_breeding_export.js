// pages/catalogue/page3/_breeding_export.js
//
// Bulk breeding-card export sub-module for page3 (chat 36 round 5 step 3,
// 2026-05-07). Implements the Turn-146 export pipeline that the
// catalogue toolbar's #catExportBreedingHTML / #catExportBreedingJSON
// buttons trigger.
//
// 17 helpers extracted byte-verbatim from legacy/Inversion_atlas.html
// (call closure starting from _wireCatalogueBreedingExportBtns at
// legacy line 23668). Bodies that read bare `state` get the page1
// round-4 shim pattern: `const state = _pageState;` injected as the
// first statement.
//
// Cross-shell: the wire reads localStorage for the tier dropdown's
// last value (key `pca_scrubber_v3.breeding_export_tier`) and uses
// _breedingExportTrigger to download blobs via an anchor click.
//
// State reads: state.candidateList, state.cohortDiversity, state.data,
// state.k. No mutations.
//
// What is NOT here:
//   - The catalogue table renderer (`renderCatalogue` / `_buildCatalogueRows`
//     / `_filterCatalogueRows` / `_sortCatalogueRows`). These are referenced
//     in legacy via `typeof X === 'function'` guards but never DEFINED. The
//     page3.js shell shows the empty state. See round-5-step-3 audit
//     entry for the full inventory of unimplemented catalogue logic.
//   - The TSV / Markdown / JSON / SVG / PNG / PDF gallery exports.
//     Same issue: referenced in HTML buttons but never defined in legacy.

import { _pageState } from './_state.js';
import { wilcoxonRankSumP } from '../../../shared/wilcoxon.js';

// _BREEDING_EXPORT_TIER_MODES — legacy line 23269. Tier filter dictionary
// for the export dispatchers. Used by _filterCandsForBreedingExport.
const _BREEDING_EXPORT_TIER_MODES = {
  tier_1:        { tiers: new Set(['tier_1']),                              label: 'Tier 1 only' },
  tier_1_2:      { tiers: new Set(['tier_1', 'tier_2']),                    label: 'Tier 1+2 (breeding-ready)' },
  tier_1_2_3:    { tiers: new Set(['tier_1', 'tier_2', 'tier_3']),          label: 'Tier 1+2+3' },
  all:           { tiers: null /* sentinel: include everything */,          label: 'all tiers' },
};


// --- _arrangementMAF — extracted from legacy ---
function _arrangementMAF(counts) {
  if (!counts) return null;
  const n_ref = counts.HOM_REF || 0;
  const n_het = counts.HET || 0;
  const n_inv = counts.HOM_INV || 0;
  const n_alleles = 2 * (n_ref + n_het + n_inv);
  if (n_alleles < 2) return null;
  const ref_alleles = 2 * n_ref + n_het;
  const inv_alleles = 2 * n_inv + n_het;
  const p_ref = ref_alleles / n_alleles;
  const p_inv = inv_alleles / n_alleles;
  const maf = Math.min(p_ref, p_inv);
  let minor_allele;
  if (p_ref < p_inv)      minor_allele = 'REF';
  else if (p_inv < p_ref) minor_allele = 'INV';
  else                    minor_allele = 'tie';
  return { p_ref, p_inv, maf, n_alleles, minor_allele };
}

// --- _brHtmlEsc — extracted from legacy ---
function _brHtmlEsc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- _summarizeFROHGroup — extracted from legacy ---
function _summarizeFROHGroup(values) {
  const finite = [];
  for (const v of values || []) {
    if (typeof v === 'number' && Number.isFinite(v)) finite.push(v);
  }
  const n = finite.length;
  if (n === 0) {
    return { n: 0, mean: NaN, median: NaN, sd: NaN, q1: NaN, q3: NaN, min: NaN, max: NaN };
  }
  // Sort defensive copy for quantiles
  const sorted = finite.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  // Mean
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  // Median
  const mid = n >> 1;
  const median = (n % 2 === 0) ? 0.5 * (sorted[mid - 1] + sorted[mid]) : sorted[mid];
  // SD (sample, n-1 denominator). For n=1 we return 0 rather than NaN
  // because that's the conventional "one observation" answer in the
  // breeding-card context — the manuscript footnote can flag it.
  let ss = 0;
  for (const v of sorted) ss += (v - mean) * (v - mean);
  const sd = (n > 1) ? Math.sqrt(ss / (n - 1)) : 0;
  // Quantiles (Type 7, R default — linear interpolation between order stats)
  function q(p) {
    if (n === 1) return sorted[0];
    const h = p * (n - 1);
    const i = Math.floor(h);
    const frac = h - i;
    return sorted[i] + frac * (sorted[Math.min(i + 1, n - 1)] - sorted[i]);
  }
  return { n, mean, median, sd, q1: q(0.25), q3: q(0.75), min, max };
}

// --- _wilcoxonRankSumP — re-exported from shared/wilcoxon.js ---
// The local copy was inlined verbatim from legacy AND used a
// typeof-guarded normalCDF that was never importable in the cartridge
// (always fell through to NaN). The shared module imports normalCDF
// from shared/contingency.js so p-values actually compute.
const _wilcoxonRankSumP = wilcoxonRankSumP;

// --- _perArrangementFROH — extracted from legacy ---
function _perArrangementFROH(candidate, opts) {
  const _opts = opts || {};
  const _state = _pageState;
  if (!candidate) return { available: false, reason: 'no_candidate' };
  const karyo = _breedingCardKaryotypePerSample(candidate);
  if (!karyo) {
    return { available: false, reason: 'no_h_classification', karyotype_summary: null };
  }
  if (!_state || !_state.cohortDiversity || !_state.cohortDiversity.byCGA ||
      typeof _state.cohortDiversity.byCGA.get !== 'function') {
    return {
      available: false,
      reason: 'no_cohort_diversity',
      karyotype_summary: { ...karyo.counts },
    };
  }
  if (!_state.data || !Array.isArray(_state.data.samples)) {
    return {
      available: false,
      reason: 'no_chrom_data',
      karyotype_summary: { ...karyo.counts },
    };
  }

  const samples = _state.data.samples;
  const byCGA = _state.cohortDiversity.byCGA;
  const buckets = {
    HOM_REF: [], HET: [], HOM_INV: [], HOM_MID: [], HOM: [],
  };
  let n_resolved = 0;
  let n_unresolved = 0;
  for (let si = 0; si < karyo.karyotype.length; si++) {
    const k = karyo.karyotype[si];
    if (k == null) continue;     // AMBIGUOUS / NO_DOSAGE / out-of-range
    const samp = samples[si];
    if (!samp) {
      n_unresolved++;
      continue;
    }
    const cga = (typeof samp.cga === 'string' && samp.cga) ? samp.cga.toUpperCase() : null;
    if (!cga) {
      n_unresolved++;
      continue;
    }
    const row = byCGA.get(cga);
    if (!row || !Number.isFinite(row.f_roh)) {
      n_unresolved++;
      continue;
    }
    buckets[k].push(row.f_roh);
    n_resolved++;
  }

  const groups = {
    HOM_REF:  _summarizeFROHGroup(buckets.HOM_REF),
    HET:      _summarizeFROHGroup(buckets.HET),
    HOM_INV:  _summarizeFROHGroup(buckets.HOM_INV),
    HOM_MID:  _summarizeFROHGroup(buckets.HOM_MID),
  };
  // attach the raw values when caller asks (default off — keeps output
  // small, the renderer rarely needs them).
  if (_opts.include_values) {
    groups.HOM_REF.values = buckets.HOM_REF;
    groups.HET.values = buckets.HET;
    groups.HOM_INV.values = buckets.HOM_INV;
    groups.HOM_MID.values = buckets.HOM_MID;
  }

  // "all carriers" pool = HET ∪ HOM_INV ∪ HOM_MID
  const allCarriers = buckets.HET.concat(buckets.HOM_INV).concat(buckets.HOM_MID);
  const all_carriers = _summarizeFROHGroup(allCarriers);
  if (_opts.include_values) all_carriers.values = allCarriers;

  // Wilcoxon REF vs INV: requires both groups non-empty
  const wilcoxon_ref_vs_inv = (buckets.HOM_REF.length > 0 && buckets.HOM_INV.length > 0)
    ? _wilcoxonRankSumP(buckets.HOM_REF, buckets.HOM_INV)
    : null;
  // Wilcoxon REF vs all carriers: useful when no clean HOM_INV (n=0 or
  // ambiguous-role)
  const wilcoxon_ref_vs_carriers = (buckets.HOM_REF.length > 0 && allCarriers.length > 0)
    ? _wilcoxonRankSumP(buckets.HOM_REF, allCarriers)
    : null;

  const delta_mean_inv_minus_ref = (Number.isFinite(groups.HOM_INV.mean) &&
                                    Number.isFinite(groups.HOM_REF.mean))
    ? groups.HOM_INV.mean - groups.HOM_REF.mean
    : NaN;

  return {
    available: true,
    reason: null,
    karyotype_summary: { ...karyo.counts },
    multi_haplotype: karyo.multi_haplotype,
    ambiguous_role: karyo.ambiguous_role,
    groups,
    all_carriers,
    n_resolved,
    n_unresolved,
    wilcoxon_ref_vs_inv,
    wilcoxon_ref_vs_carriers,
    delta_mean_inv_minus_ref,
  };
}

// --- _carrierByK8Table — extracted from legacy ---
function _carrierByK8Table(candidate) {
  const _state = _pageState;
  if (!candidate) return { available: false, reason: 'no_candidate' };
  const karyo = _breedingCardKaryotypePerSample(candidate);
  if (!karyo) return { available: false, reason: 'no_h_classification' };
  if (!_state || !_state.cohortDiversity || !_state.cohortDiversity.byCGA ||
      typeof _state.cohortDiversity.byCGA.get !== 'function') {
    return { available: false, reason: 'no_cohort_diversity' };
  }
  if (!_state.data || !Array.isArray(_state.data.samples)) {
    return { available: false, reason: 'no_chrom_data' };
  }

  const samples = _state.data.samples;
  const byCGA = _state.cohortDiversity.byCGA;

  // Decide column set based on what karyotypes actually appear. Always
  // include HOM_REF, HET, HOM_INV; add HOM_MID iff multi-haplotype;
  // add HOM iff ambiguous_role (single-HOM case).
  const cols = ['HOM_REF', 'HET', 'HOM_INV'];
  if (karyo.multi_haplotype) cols.push('HOM_MID');
  if (karyo.ambiguous_role)  cols.push('HOM');

  // Walk samples; build per-K8 buckets
  const k8Buckets = new Map();   // k8 string -> { HOM_REF, HET, HOM_INV, HOM_MID, HOM, total }
  let n_resolved = 0, n_unresolved = 0;
  for (let si = 0; si < karyo.karyotype.length; si++) {
    const k = karyo.karyotype[si];
    if (k == null) continue;       // unclassified band
    const samp = samples[si];
    if (!samp) { n_unresolved++; continue; }
    const cga = (typeof samp.cga === 'string' && samp.cga) ? samp.cga.toUpperCase() : null;
    if (!cga) { n_unresolved++; continue; }
    const row = byCGA.get(cga);
    if (!row || row.k8 == null) { n_unresolved++; continue; }
    const k8 = row.k8;
    if (!k8Buckets.has(k8)) {
      const seed = { total: 0, total_classified: 0 };
      for (const c of cols) seed[c] = 0;
      k8Buckets.set(k8, seed);
    }
    const bucket = k8Buckets.get(k8);
    if (k in bucket) {
      bucket[k]++;
      bucket.total++;
      bucket.total_classified++;
      n_resolved++;
    } else {
      // Karyotype outside our column set (shouldn't happen, but defensive).
      bucket.total++;
      n_resolved++;
    }
  }

  // Sort cluster keys alphanumerically (K1, K2, ..., K10, K11, ...)
  const k8_clusters = Array.from(k8Buckets.keys()).sort((a, b) => {
    // Strip leading 'K' if present, compare numerically; fall back to
    // lexicographic for non-K prefixed values.
    const an = parseInt(String(a).replace(/^K/i, ''), 10);
    const bn = parseInt(String(b).replace(/^K/i, ''), 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return String(a).localeCompare(String(b));
  });

  // Build rows + totals
  const totals = { total: 0, total_classified: 0 };
  for (const c of cols) totals[c] = 0;
  const rows = [];
  for (const k8 of k8_clusters) {
    const bucket = k8Buckets.get(k8);
    const frac = {};
    for (const c of cols) {
      frac[c] = bucket.total_classified > 0 ? bucket[c] / bucket.total_classified : NaN;
      totals[c] += bucket[c];
    }
    totals.total += bucket.total;
    totals.total_classified += bucket.total_classified;
    rows.push({
      k8: k8,
      counts: (() => { const c = {}; for (const cc of cols) c[cc] = bucket[cc]; return c; })(),
      total: bucket.total,
      total_classified: bucket.total_classified,
      frac: frac,
    });
  }

  return {
    available: true,
    reason: null,
    k8_clusters,
    karyotypes: cols,
    rows,
    totals,
    n_resolved,
    n_unresolved,
  };
}

// --- _breedingCardKaryotypePerSample — extracted from legacy ---
function _breedingCardKaryotypePerSample(candidate) {
  if (!candidate || !candidate.locked_labels) return null;
  // Trigger / reuse the h_classification compute. _classifyHLabelBands
  // caches on candidate.h_classification; we don't force.
  const hc = (typeof _classifyHLabelBands === 'function')
    ? _classifyHLabelBands(candidate)
    : (candidate.h_classification || null);
  if (!hc || !Array.isArray(hc.bands) || hc.bands.length === 0) return null;

  const K = hc.K || (candidate.K || 3);
  const bands = hc.bands;

  // Find HOM bands and sort by median_pc1 ascending. Bands missing
  // median_pc1 (no members or no PC1 data) are put at the end and don't
  // get REF/INV roles.
  const homBands = [];
  for (const b of bands) {
    if (b.classification === 'HOM') homBands.push(b);
  }
  homBands.sort((a, b) => {
    const aPc = (a.median_pc1 != null && Number.isFinite(a.median_pc1)) ? a.median_pc1 :  Infinity;
    const bPc = (b.median_pc1 != null && Number.isFinite(b.median_pc1)) ? b.median_pc1 :  Infinity;
    return aPc - bPc;
  });

  // Assign roles. SPEC choice: REF = leftmost-PC1 HOM, INV = rightmost-PC1
  // HOM. Middle HOM bands (K=4+ multi-haplotype) are HOM_MID.
  let refBandIdx = null, invBandIdx = null;
  const midBandIdxs = [];
  if (homBands.length === 1) {
    // Single HOM: ambiguous role. We don't pick — neither REF nor INV.
    // The sample-level karyotype reports 'HOM' (no direction); the SPEC
    // §2 pairing advice flags this as ambiguous_role.
    // refBandIdx / invBandIdx stay null.
  } else if (homBands.length >= 2) {
    refBandIdx = homBands[0].band_idx;
    invBandIdx = homBands[homBands.length - 1].band_idx;
    for (let i = 1; i < homBands.length - 1; i++) {
      midBandIdxs.push(homBands[i].band_idx);
    }
  }

  const ambiguous_role = (homBands.length === 1);
  const multi_haplotype = (homBands.length > 2);

  // Per-sample assignment
  const labels = candidate.locked_labels;
  const n = labels.length;
  const karyotype = new Array(n).fill(null);
  const counts = {
    HOM_REF: 0, HET: 0, HOM_INV: 0, HOM_MID: 0,
    HOM_AMBIGUOUS_ROLE: 0,        // single-HOM case: counted here, not REF/INV
    AMBIGUOUS: 0, NO_DOSAGE: 0,
    n_classified: 0,              // REF + HET + INV + MID
    n_unclassified: 0,            // ambig + no_dosage + bad-label
  };
  for (let si = 0; si < n; si++) {
    const lab = labels[si];
    if (!Number.isInteger(lab) || lab < 0 || lab >= K) {
      counts.n_unclassified++;
      continue;
    }
    const b = bands[lab];
    if (!b) {
      counts.n_unclassified++;
      continue;
    }
    if (b.classification === 'HET') {
      karyotype[si] = 'HET';
      counts.HET++;
      counts.n_classified++;
    } else if (b.classification === 'HOM') {
      if (ambiguous_role) {
        // Single HOM band — direction unknown. Don't fold into REF/INV
        // counts; record under HOM_AMBIGUOUS_ROLE.
        karyotype[si] = 'HOM';
        counts.HOM_AMBIGUOUS_ROLE++;
        counts.n_classified++;
      } else if (lab === refBandIdx) {
        karyotype[si] = 'HOM_REF';
        counts.HOM_REF++;
        counts.n_classified++;
      } else if (lab === invBandIdx) {
        karyotype[si] = 'HOM_INV';
        counts.HOM_INV++;
        counts.n_classified++;
      } else {
        karyotype[si] = 'HOM_MID';
        counts.HOM_MID++;
        counts.n_classified++;
      }
    } else if (b.classification === 'AMBIGUOUS') {
      counts.AMBIGUOUS++;
      counts.n_unclassified++;
    } else {
      // NO_DOSAGE
      counts.NO_DOSAGE++;
      counts.n_unclassified++;
    }
  }

  return {
    n_samples: n,
    karyotype: karyotype,
    counts: counts,
    hom_band_idx_by_role: {
      REF: refBandIdx,
      INV: invBandIdx,
      MID: midBandIdxs,
    },
    k_used: K,
    classification_summary: 'K=' + K + ' · ' + hc.band_counts.n_hom + 'H+' +
                            hc.band_counts.n_het + 'T' +
                            (hc.band_counts.n_ambiguous > 0 ? '+' + hc.band_counts.n_ambiguous + 'A' : '') +
                            (hc.band_counts.n_no_dosage > 0 ? '+' + hc.band_counts.n_no_dosage + 'N' : ''),
    consistency: (hc.implied_regime && hc.implied_regime.consistency) || 'unknown',
    multi_haplotype: multi_haplotype,
    ambiguous_role: ambiguous_role,
  };
}

// --- _generatePairingAdvice — extracted from legacy ---
function _generatePairingAdvice(card, opts) {
  const _opts = opts || {};
  const p_thresh   = (typeof _opts.froh_p_threshold === 'number')
                      ? _opts.froh_p_threshold : _BREEDING_FROH_P_THRESHOLD;
  const maf_thresh = (typeof _opts.maf_imbalance_threshold === 'number')
                      ? _opts.maf_imbalance_threshold : _BREEDING_MAF_IMBALANCE_THRESH;

  const out = [];
  const burden = card && card.burden;

  // Rule 5/6: caveats first (so they appear before the actionable
  // advice — the user knows the framing under which the rest applies)
  if (burden && burden.ambiguous_role) {
    out.push({
      kind: 'ambiguous_role_caveat',
      severity: 'info',
      text: 'Only one homozygous arrangement observed in this cohort. ' +
            'REF vs INV designation cannot be assigned without a reference ' +
            'arrangement. Pairing advice below treats observed HOM as one ' +
            'arrangement and HET as the heterozygous cross.',
      evidence: null,
    });
  }
  if (burden && burden.multi_haplotype) {
    out.push({
      kind: 'multi_haplotype_caveat',
      severity: 'info',
      text: 'Multi-haplotype regime detected (>2 homozygous bands). ' +
            'REF / INV labels apply to the leftmost-PC1 and rightmost-PC1 ' +
            'bands respectively; intermediate HOM_MID samples are reported ' +
            'separately and do not enter the REF–vs–INV Wilcoxon test.',
      evidence: null,
    });
  }

  // Rule 1: F_ROH asymmetric
  let frohRuleFired = false;
  if (burden && burden.available && burden.wilcoxon_ref_vs_inv) {
    const w = burden.wilcoxon_ref_vs_inv;
    const delta = burden.delta_mean_inv_minus_ref;
    if (Number.isFinite(w.p_two_sided) && w.p_two_sided < p_thresh &&
        Number.isFinite(delta) && delta > 0) {
      // INV-mean is significantly higher than REF-mean
      const deltaPct = (delta * 100).toFixed(1);
      const pStr = (w.p_two_sided < 1e-3)
                    ? w.p_two_sided.toExponential(2)
                    : w.p_two_sided.toFixed(3);
      out.push({
        kind: 'froh_asymmetric',
        severity: 'strong',
        text: 'Avoid HOM_INV × HOM_INV pairings. INV-arrangement carriers ' +
              'show elevated F_ROH (mean Δ = +' + deltaPct +
              ' percentage points relative to HOM_REF; Wilcoxon p = ' + pStr +
              '). Cross HOM_INV with HOM_REF or HET to break ROH.',
        evidence: {
          p_value: w.p_two_sided,
          delta_mean_inv_minus_ref: delta,
          n_ref: w.n_a,
          n_inv: w.n_b,
        },
      });
      frohRuleFired = true;
    } else if (Number.isFinite(w.p_two_sided) && w.p_two_sided < p_thresh &&
               Number.isFinite(delta) && delta < 0) {
      // INV-mean is significantly LOWER — surface as info, not actionable
      // pairing advice (atypical and worth flagging for manuscript).
      const deltaPct = Math.abs(delta * 100).toFixed(1);
      const pStr = (w.p_two_sided < 1e-3)
                    ? w.p_two_sided.toExponential(2)
                    : w.p_two_sided.toFixed(3);
      out.push({
        kind: 'froh_inverted_asymmetry',
        severity: 'info',
        text: 'F_ROH is significantly LOWER in HOM_INV than HOM_REF ' +
              '(Δ = −' + deltaPct + ' pp; p = ' + pStr + '). Atypical: ' +
              'standard pairing advice does not apply directly. Inspect ' +
              'whether the polymorphism is recent or under balancing selection.',
        evidence: {
          p_value: w.p_two_sided,
          delta_mean_inv_minus_ref: delta,
          n_ref: w.n_a,
          n_inv: w.n_b,
        },
      });
      frohRuleFired = true;
    }
  }

  // Rule 2: damaging-load asymmetric — not implementable yet
  out.push({
    kind: 'data_pending',
    severity: 'info',
    text: 'Damaging-load asymmetry test pending: requires ' +
          'MODULE_CONSERVATION (per-sample VESM/SIFT4G) layer.',
    evidence: { needs: 'damaging_load_v1' },
  });

  // Rule 3: MAF imbalanced
  let mafRuleFired = false;
  if (burden && burden.available && burden.karyotype_summary) {
    const maf = _arrangementMAF(burden.karyotype_summary);
    if (maf && Number.isFinite(maf.maf) && maf.maf < maf_thresh) {
      out.push({
        kind: 'maf_imbalanced',
        severity: 'warn',
        text: 'Arrangement frequencies skewed: minor allele = ' +
              maf.minor_allele + ' at p = ' + maf.maf.toFixed(3) +
              ' (' + (maf.maf * 100).toFixed(1) + '%). Consider expanding ' +
              'broodstock from sources carrying the minor arrangement to ' +
              'preserve diversity.',
        evidence: { maf: maf.maf, minor_allele: maf.minor_allele,
                    p_ref: maf.p_ref, p_inv: maf.p_inv },
      });
      mafRuleFired = true;
    }
  }

  // Rule 4: recombinant fraction — not implementable yet
  out.push({
    kind: 'data_pending',
    severity: 'info',
    text: 'Recombinant-fraction analysis pending: requires per-carrier ' +
          'dosage changepoint detector (separate spec).',
    evidence: { needs: 'recombinant_dosage_changepoint_detector' },
  });

  // Rule 5: default (only when no actionable rules fired)
  if (!frohRuleFired && !mafRuleFired) {
    out.push({
      kind: 'default',
      severity: 'info',
      text: 'No specific pairing constraint indicated by the available ' +
            'data. Standard MAF-balanced pairing applies. (Damaging-load ' +
            'and recombinant-fraction tests are pending — see above; ' +
            'either may surface additional constraints when data lands.)',
      evidence: null,
    });
  }

  return out;
}

// --- _buildBreedingCard — extracted from legacy ---
function _buildBreedingCard(candidate, opts) {
  const _opts = opts || {};
  const _state = _pageState;
  if (!candidate) return null;

  // 1. Candidate identity
  const span_bp = (Number.isFinite(candidate.start_bp) && Number.isFinite(candidate.end_bp))
                  ? Math.max(0, candidate.end_bp - candidate.start_bp)
                  : NaN;
  const candIdent = {
    id:          candidate.id || null,
    chrom:       candidate.chrom || (_state && _state.data && _state.data.chrom) || null,
    start_bp:    Number.isFinite(candidate.start_bp) ? candidate.start_bp : null,
    end_bp:      Number.isFinite(candidate.end_bp)   ? candidate.end_bp   : null,
    span_bp:     Number.isFinite(span_bp) ? span_bp : null,
    span_mb:     Number.isFinite(span_bp) ? +(span_bp / 1e6).toFixed(3) : null,
    K:           candidate.K || (_state && _state.k) || null,
    tier:        candidate.tier || null,
    confidence:  candidate.confidence || null,
    notes:       candidate.notes || null,
  };

  // 2. Karyotype derivation summary
  const karyo = _breedingCardKaryotypePerSample(candidate);
  const karyotypeSection = karyo ? {
    summary:                karyo.counts,
    multi_haplotype:        karyo.multi_haplotype,
    ambiguous_role:         karyo.ambiguous_role,
    classification_summary: karyo.classification_summary,
    consistency:            karyo.consistency,
    hom_band_idx_by_role:   karyo.hom_band_idx_by_role,
    k_used:                 karyo.k_used,
  } : { available: false, reason: 'no_h_classification' };

  // 3. F_ROH burden
  const burden = _perArrangementFROH(candidate, { include_values: !!_opts.include_values });

  // 4. Ancestry table
  const ancestry = _carrierByK8Table(candidate);

  // 5. MAF
  const maf = (karyo && karyo.counts) ? _arrangementMAF(karyo.counts) : null;

  // 6. Coverage diagnostic
  const coverage = (typeof _cohortDiversityCoverageOnCurrentChrom === 'function')
    ? _cohortDiversityCoverageOnCurrentChrom() : null;

  // 7. Pairing advice
  const advice = _generatePairingAdvice({
    burden,
    karyotype: karyotypeSection,
  }, { /* default thresholds */ });

  // 8. Atlas reviewer URL — best-effort. We construct a relative #cand=<id>
  // anchor; the atlas's catalogue handler resolves these. If document is
  // not available (vm sandbox), atlas_url stays null.
  let atlas_url = null;
  if (candIdent.id && typeof document !== 'undefined' && document.location) {
    try {
      atlas_url = document.location.origin + document.location.pathname +
                  '#cand=' + encodeURIComponent(candIdent.id);
    } catch (_) { atlas_url = null; }
  }

  return {
    schema:      'breeding_readiness_card_v1',
    generated_at: new Date().toISOString(),
    candidate:   candIdent,
    karyotype:   karyotypeSection,
    burden:      burden,
    ancestry:    ancestry,
    maf:         maf,
    coverage:    coverage,
    advice:      advice,
    atlas_url:   atlas_url,
  };
}

// --- _filterCandsForBreedingExport — extracted from legacy ---
function _filterCandsForBreedingExport(cands, tierMode) {
  const out = { kept: [], dropped_no_tier: 0, dropped_off_tier: 0,
                mode: null, accepted_tiers: null };
  if (!Array.isArray(cands)) return out;
  let accepted;
  if (Array.isArray(tierMode)) {
    accepted = tierMode.slice();
    out.mode = 'custom';
  } else {
    const key = (typeof tierMode === 'string' && tierMode in _BREEDING_EXPORT_TIER_MODES)
                ? tierMode : 'tier_1_2';
    accepted = _BREEDING_EXPORT_TIER_MODES[key];   // may be null = include all
    out.mode = key;
  }
  out.accepted_tiers = accepted ? accepted.slice() : null;
  for (const c of cands) {
    if (!c) continue;
    const t = c.tier;
    if (accepted == null) {
      // 'all' mode — include every candidate, even untiered
      out.kept.push(c);
      continue;
    }
    if (t == null || typeof t !== 'string' || t === '') {
      out.dropped_no_tier++;
      continue;
    }
    if (accepted.indexOf(t) < 0) {
      out.dropped_off_tier++;
      continue;
    }
    out.kept.push(c);
  }
  return out;
}

// --- _buildBreedingCardsCombinedHTML — extracted from legacy ---
function _buildBreedingCardsCombinedHTML(cards, opts) {
  const _opts = opts || {};
  const autoPrint = _opts.auto_print === true;     // default OFF — no surprise
  const showHint  = _opts.show_hint  !== false;
  const arr       = Array.isArray(cards) ? cards : [];

  // Title
  const chrom = _opts.chrom ||
                (arr.length > 0 && arr[0] && arr[0].candidate && arr[0].candidate.chrom)
                || '';
  const docTitle = (chrom ? chrom + ' — ' : '') +
                   'breeding-readiness cards (n=' + arr.length + ')';

  // CSS — reuse the per-card stylesheet, plus a small print-page wrapper.
  const baseCss = (typeof _breedingCardPrintCSS === 'function')
                    ? _breedingCardPrintCSS() : '';
  const combinedCss = baseCss + '\n' +
    /* Combined-doc additions */
    '@page { size: A4; margin: 14mm; }\n' +
    '.brc-print-page { page-break-after: always; break-after: page; ' +
      'padding: 0 0 8mm; }\n' +
    '.brc-print-page:last-child { page-break-after: auto; break-after: auto; }\n' +
    '.brc-bundle-toc { max-width: 180mm; margin: 0 auto 8mm; ' +
      'padding: 8mm 6mm; border: 1px solid #ccc; border-radius: 3px; ' +
      'background: #fafbfc; page-break-after: always; break-after: page; }\n' +
    '.brc-bundle-toc h2 { margin: 0 0 4mm; font-size: 14pt; }\n' +
    '.brc-bundle-toc-meta { font-size: 9.5pt; color: #555; ' +
      'margin: 0 0 4mm; line-height: 1.5; }\n' +
    '.brc-bundle-toc table { width: 100%; border-collapse: collapse; ' +
      'font-size: 10pt; }\n' +
    '.brc-bundle-toc table th { background: #f4f4f4; font-weight: 600; ' +
      'text-align: left; padding: 1.5mm 2mm; ' +
      'border-bottom: 1px solid #888; }\n' +
    '.brc-bundle-toc table td { padding: 1.2mm 2mm; ' +
      'border-bottom: 1px solid #e2e2e2; }\n' +
    '.brc-bundle-toc table tr:hover { background: #eef3fa; }\n' +
    '.brc-bundle-toc table a { color: #1a1a1a; text-decoration: none; }\n' +
    '.brc-bundle-toc table a:hover { text-decoration: underline; }\n' +
    '@media print { .brc-bundle-toc table tr:hover { background: transparent; } }\n';

  // Header: TOC + filter meta
  let headerHtml = '<div class="brc-bundle-toc">' +
                   '<h2>Breeding-readiness card bundle</h2>';
  if (chrom) {
    headerHtml += '<div class="brc-bundle-toc-meta"><b>Chromosome:</b> ' +
                  _brHtmlEsc(String(chrom)) + '</div>';
  }
  // Filter meta block
  if (_opts.filter_meta) {
    const fm = _opts.filter_meta;
    const bits = [];
    if (fm.mode) bits.push('<b>Filter:</b> ' + _brHtmlEsc(String(fm.mode)));
    if (fm.accepted_tiers) {
      bits.push('<b>Tiers included:</b> ' +
                fm.accepted_tiers.map(t => _brHtmlEsc(String(t))).join(', '));
    } else if (fm.mode === 'all') {
      bits.push('<b>Tiers:</b> all (no tier filter)');
    }
    if (Number.isFinite(fm.n_total)) bits.push('<b>Total candidates:</b> ' + fm.n_total);
    bits.push('<b>In bundle:</b> ' + arr.length);
    if (Number.isFinite(fm.dropped_no_tier) && fm.dropped_no_tier > 0) {
      bits.push('<b>Dropped (untiered):</b> ' + fm.dropped_no_tier);
    }
    if (Number.isFinite(fm.dropped_off_tier) && fm.dropped_off_tier > 0) {
      bits.push('<b>Dropped (off-tier):</b> ' + fm.dropped_off_tier);
    }
    headerHtml += '<div class="brc-bundle-toc-meta">' + bits.join(' · ') + '</div>';
  }
  headerHtml += '<div class="brc-bundle-toc-meta">' +
                '<b>Generated:</b> ' + _brHtmlEsc(new Date().toISOString()) +
                '</div>';

  // TOC rows
  if (arr.length > 0) {
    headerHtml += '<table>';
    headerHtml += '<thead><tr>' +
                  '<th>#</th><th>candidate</th><th>coords (Mb)</th>' +
                  '<th>span</th><th>tier</th><th>confidence</th></tr></thead><tbody>';
    arr.forEach((card, idx) => {
      const c = (card && card.candidate) || {};
      const anchor = 'brc-card-' + (idx + 1);
      const idStr = c.id || ('candidate_' + (idx + 1));
      const startMb = (Number.isFinite(c.start_bp)) ? (c.start_bp / 1e6).toFixed(2) : '—';
      const endMb   = (Number.isFinite(c.end_bp))   ? (c.end_bp   / 1e6).toFixed(2) : '—';
      const spanMb  = (Number.isFinite(c.span_mb))  ? c.span_mb.toFixed(2) + ' Mb' : '—';
      const tier    = c.tier || '—';
      const conf    = c.confidence || '—';
      headerHtml += '<tr>' +
                    '<td>' + (idx + 1) + '</td>' +
                    '<td><a href="#' + _brHtmlEsc(anchor) + '">' +
                       _brHtmlEsc(String(idStr)) + '</a></td>' +
                    '<td>' + _brHtmlEsc(startMb) + '–' + _brHtmlEsc(endMb) + '</td>' +
                    '<td>' + _brHtmlEsc(spanMb) + '</td>' +
                    '<td>' + _brHtmlEsc(String(tier)) + '</td>' +
                    '<td>' + _brHtmlEsc(String(conf)) + '</td>' +
                    '</tr>';
    });
    headerHtml += '</tbody></table>';
  } else {
    headerHtml += '<div class="brc-bundle-toc-meta" style="color:#a32b2b;">' +
                  '<b>No candidates matched the active filter.</b> ' +
                  'Adjust the tier dropdown and try again.</div>';
  }
  headerHtml += '</div>';

  // Hint banner (dismissable for print)
  const hintHtml = showHint ?
    ('<div class="brc-print-hint brc-no-print">' +
     '<b>Save as PDF:</b> press <code>Ctrl/Cmd+P</code>' +
     (autoPrint ? ' (or wait for the print dialog to open automatically)' : '') +
     ', then choose <b>Save as PDF</b> as the destination. ' +
     'This message will not appear in the saved PDF. ' +
     'One card per page; first page is the table of contents.</div>') : '';

  // Body — one section per card
  let body = '';
  arr.forEach((card, idx) => {
    const anchor = 'brc-card-' + (idx + 1);
    body += '<section class="brc-print-page" id="' + _brHtmlEsc(anchor) + '">';
    if (typeof _renderBreedingCardHTML === 'function') {
      body += _renderBreedingCardHTML(card);
    } else {
      // Defensive: render a placeholder if Turn C renderer isn't present
      body += '<div class="brc-card brc-empty"><div class="brc-header">' +
              '<div class="brc-title">Renderer unavailable</div></div></section>';
    }
    body += '</section>';
  });

  const autoScript = autoPrint ?
    ('<script>\n' +
     'window.addEventListener("load", function () {\n' +
     '  setTimeout(function () { try { window.print(); } catch (_) {} }, 250);\n' +
     '});\n' +
     '</' + 'script>') : '';

  return '<!doctype html>\n' +
         '<html lang="en"><head>\n' +
         '<meta charset="utf-8"/>\n' +
         '<title>' + _brHtmlEsc(docTitle) + '</title>\n' +
         '<style>\n' + combinedCss + '\n</style>\n' +
         '</head><body>\n' +
         hintHtml +
         headerHtml +
         body + '\n' +
         autoScript + '\n' +
         '</body></html>';
}

// --- _buildBreedingCardsJSONBundle — extracted from legacy ---
function _buildBreedingCardsJSONBundle(cards, opts) {
  const _opts = opts || {};
  const arr = Array.isArray(cards) ? cards : [];
  const chrom = _opts.chrom ||
                (arr.length > 0 && arr[0] && arr[0].candidate && arr[0].candidate.chrom)
                || null;
  return {
    schema:        'breeding_readiness_card_bundle_v1',
    generated_at:  new Date().toISOString(),
    chrom:         chrom,
    n_cards:       arr.length,
    filter:        _opts.filter_meta || null,
    cards:         arr,
  };
}

// --- _breedingExportTrigger — extracted from legacy ---
function _breedingExportTrigger(blob, filename) {
  if (typeof document === 'undefined') return false;
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 200);
    return true;
  } catch (e) {
    if (typeof alert === 'function') {
      alert('Export failed: ' + e.message);
    }
    return false;
  }
}

// --- _gatherBreedingCardsFromState — extracted from legacy ---
function _gatherBreedingCardsFromState(opts) {
  const _opts = opts || {};
  const _state = _pageState;
  const allCands = (_state && Array.isArray(_state.candidateList))
                     ? _state.candidateList.slice() : [];
  const tierMode = _opts.tierMode || 'tier_1_2';

  const fr = _filterCandsForBreedingExport(allCands, tierMode);
  if (fr.kept.length === 0) {
    const reason = (allCands.length === 0)
      ? 'No saved candidates on this chromosome. Promote at least one candidate first.'
      : 'No candidates matched the active tier filter (' + fr.mode + '). ' +
        'Saved: ' + allCands.length + '. ' +
        'Try changing the tier dropdown to "all" or "tier_1_2_3".';
    if (typeof alert === 'function') alert(reason);
    return null;
  }

  // Build cards. _buildBreedingCard tolerates missing prereqs (returns
  // a card with subsystem .available=false fields), so this won't throw
  // even when cohort_diversity_v1 / h_classification aren't loaded.
  const cards = [];
  for (const c of fr.kept) {
    let card = null;
    try { card = _buildBreedingCard(c, { include_values: false }); } catch (_) {}
    if (card) cards.push(card);
  }

  const chrom = (_state && _state.data && _state.data.chrom) || null;

  return {
    cards,
    chrom,
    n_input: allCands.length,
    filter_meta: {
      mode:              fr.mode,
      accepted_tiers:    fr.accepted_tiers,
      dropped_no_tier:   fr.dropped_no_tier,
      dropped_off_tier:  fr.dropped_off_tier,
      n_total:           allCands.length,
    },
  };
}

// --- _exportBreedingCardsHTML — extracted from legacy ---
export function _exportBreedingCardsHTML(opts) {
  const gathered = _gatherBreedingCardsFromState(opts);
  if (!gathered) return false;

  const html = _buildBreedingCardsCombinedHTML(gathered.cards, {
    chrom:       gathered.chrom,
    filter_meta: gathered.filter_meta,
    auto_print:  false,
    show_hint:   true,
  });

  const fname = (gathered.chrom || 'cohort') +
                '_breeding_cards_' +
                (gathered.filter_meta.mode || 'all') + '.html';
  const blob = new Blob([html], { type: 'text/html' });
  return _breedingExportTrigger(blob, fname);
}

// --- _exportBreedingCardsJSON — extracted from legacy ---
export function _exportBreedingCardsJSON(opts) {
  const gathered = _gatherBreedingCardsFromState(opts);
  if (!gathered) return false;

  const bundle = _buildBreedingCardsJSONBundle(gathered.cards, {
    chrom:       gathered.chrom,
    filter_meta: gathered.filter_meta,
  });

  const fname = (gathered.chrom || 'cohort') +
                '_breeding_cards_' +
                (gathered.filter_meta.mode || 'all') + '.json';
  const blob = new Blob([JSON.stringify(bundle, null, 2)],
                        { type: 'application/json' });
  return _breedingExportTrigger(blob, fname);
}

// --- _wireCatalogueBreedingExportBtns — extracted from legacy ---
export function _wireCatalogueBreedingExportBtns() {
  if (typeof document === 'undefined') return;
  const tierSel = document.getElementById('catBreedingTierSel');
  const htmlBtn = document.getElementById('catExportBreedingHTML');
  const jsonBtn = document.getElementById('catExportBreedingJSON');

  // Restore tier choice from localStorage if present
  if (tierSel && !tierSel.dataset._wired) {
    tierSel.dataset._wired = '1';
    try {
      const saved = localStorage.getItem('pca_scrubber_v3.breeding_export_tier');
      if (saved && (saved in _BREEDING_EXPORT_TIER_MODES)) tierSel.value = saved;
    } catch (_) {}
    tierSel.addEventListener('change', () => {
      try {
        localStorage.setItem('pca_scrubber_v3.breeding_export_tier',
                             tierSel.value || 'tier_1_2');
      } catch (_) {}
    });
  }

  const _currentTier = () => (tierSel && tierSel.value) || 'tier_1_2';

  if (htmlBtn && !htmlBtn.dataset._wired) {
    htmlBtn.dataset._wired = '1';
    htmlBtn.addEventListener('click', () => {
      _exportBreedingCardsHTML({ tierMode: _currentTier() });
    });
  }
  if (jsonBtn && !jsonBtn.dataset._wired) {
    jsonBtn.dataset._wired = '1';
    jsonBtn.addEventListener('click', () => {
      _exportBreedingCardsJSON({ tierMode: _currentTier() });
    });
  }
}
