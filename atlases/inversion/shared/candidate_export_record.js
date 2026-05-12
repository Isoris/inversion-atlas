// shared/candidate_export_record.js
//
// Per-candidate export record builder (legacy lines 61176-61362
// buildCandidateExportRecord). Composes every diagnostic + provenance
// helper in shared/ into the canonical record shape that the phase-7
// reader consumes.
//
// This pairs with shared/atlas_export.js — pass this function as
// opts.buildRecord to buildAtlasCandidateExport to assemble the full
// bundle.
//
// All compute is pure: caller passes state explicitly. Every
// diagnostic helper is invoked via safeCall so an individual missing
// piece can't tank the whole record — phase-7 readers gracefully
// degrade with null fields.

import { exportSampleId, buildSampleGroupsFromLabels, safeCall } from './cohort_export.js';
import { bandSampleCounts, candidateBandComposition } from './band_composition.js';
import { loadHaplotypeLabels } from './haplotype_labels.js';
import { getHaplotypeVocab, autoClassifyCandidate, candPerBandStats } from './haplotype_vocab.js';
import { summarizeDiamonds } from './diamond_detection.js';
import { sigmaProfileCandidate } from './sigma_profile.js';

/**
 * Build the canonical per-candidate export record. Mirrors the legacy
 * buildCandidateExportRecord field set verbatim.
 *
 * Layout: see legacy lines 61327-61362. Top-level fields:
 *   - candidate_id, chrom, start_w, end_w, start_bp, end_bp, K_used,
 *     source, parent_l2, confirmed
 *   - atlas_band_assignments: { per_sample, band_counts }
 *   - haplotype_labels (legacy v1 surface)
 *   - annotator_notes
 *   - diamond_detection (summary subset)
 *   - sigma_profile (summary subset; null when sampleSpreadRange fails)
 *   - inheritance (group_id_per_band + cohort metadata)
 *   - sample_groups (label → [sample_id])
 *   - haplotype_vocab + classifier_output + per_band_stats
 *     + band_composition + diamonds_full (v2 additions)
 *   - locked_labels_raw, candidate_runtime
 *
 * Optional `opts.windows` provides the window grid for diamond detection
 * + sigma profile. When absent, those fields fall back to null but the
 * rest of the record assembles fine.
 *
 * @param {Object} state
 * @param {Object} cand
 * @param {{windows?:Array<Object>}} opts
 * @returns {Object|null}
 */
export function buildCandidateExportRecord(state, cand, opts) {
  if (!cand) return null;
  const o = opts || {};
  const samples = (state && state.data && state.data.samples) || [];
  const windows = o.windows || (state && state.data && state.data.windows) || null;
  const K = cand.K || cand.K_used || 0;
  const hapLabels = loadHaplotypeLabels(cand) || {};

  // Per-sample primary band
  const per_sample = {};
  if (cand.locked_labels && cand.locked_labels.length) {
    for (let i = 0; i < cand.locked_labels.length; i++) {
      const sid = exportSampleId(i, samples);
      const k = cand.locked_labels[i];
      per_sample[sid] = {
        primary_band: (k >= 0) ? k : null,
        primary_band_label: (k >= 0 && hapLabels[k] != null) ? hapLabels[k] : null,
      };
    }
  }
  const band_counts = bandSampleCounts(cand.locked_labels, K);

  // Diamond detection (summary + full list)
  let diamondSummary = null;
  let diamondsFull = null;
  if (windows) {
    const ds = safeCall(() => summarizeDiamonds(cand, windows));
    if (ds) {
      diamondSummary = {
        n_diamonds:  ds.n_diamonds,
        n_strict:    ds.n_strict,
        n_strict2:   ds.n_strict2,
        has_loose:   ds.has_loose,
        has_strict:  ds.has_strict,
        has_strict2: ds.has_strict2,
      };
      if (Array.isArray(ds.diamonds)) {
        diamondsFull = ds.diamonds.map(d => ({
          splitting_band:  d.splitting_band,
          diamond_start_w: d.diamond_start_w,
          diamond_end_w:   d.diamond_end_w,
          stable_bands:    Array.from(d.stable_bands || []),
          slanting_bands:  Array.from(d.slanting_bands || []),
          strict:          !!d.strict,
          strict2:         !!d.strict2,
          baseline_spread: d.baseline_spread,
          peak_spread:     d.peak_spread,
          peak_spread_ratio: d.peak_spread_ratio,
        }));
      }
    }
  }

  // σ profile
  let sigmaSummary = null;
  const sp = safeCall(() => sigmaProfileCandidate(state, cand));
  if (sp) {
    sigmaSummary = {
      verdict:   sp.verdict,
      reason:    sp.reason,
      q50:       sp.q50,
      q90:       sp.q90,
      q95:       sp.q95,
      ratio_high: sp.ratio_high,
      bimodality_coef: sp.bimodality_coef,
      is_bimodal:      sp.is_bimodal,
      top_high: Array.isArray(sp.top_high) ? sp.top_high.map(t => ({
        sample_id: exportSampleId(t.si, samples),
        sigma:     t.sigma,
      })) : [],
    };
  }

  // Per-band stats (centroid + mean σ per band — same shape candPerBandStats emits)
  let perBandStats = null;
  const stats = safeCall(() => candPerBandStats(state, cand));
  if (Array.isArray(stats)) {
    perBandStats = stats.map(s => ({
      k: s.k, n: s.n,
      centroid_pc1: s.centroid_pc1,
      mean_sigma:   s.mean_sigma,
    }));
  }

  // Classifier output
  let classifierOutput = null;
  const vocab = safeCall(() => getHaplotypeVocab(state, cand)) || 'standard';
  const cl = safeCall(() => autoClassifyCandidate(state, cand));
  if (cl) {
    classifierOutput = {
      vocab: cl.vocab,
      per_band: cl.per_band.map(pb => ({
        k: pb.k,
        label:      pb.label,
        confidence: pb.confidence,
        reason:     pb.reason,
        n:          pb.n,
        mean_sigma: pb.mean_sigma,
        centroid_pc1: pb.centroid_pc1,
      })),
    };
  }

  // Inheritance group lookup (cohort-aware)
  let inheritance = null;
  const r = state && state.inheritanceResult;
  if (r && Array.isArray(r.items_meta)) {
    const idx = r.items_meta.findIndex(m => m && String(m.id) === String(cand.id));
    if (idx >= 0) {
      const group_id_per_band = {};
      if (r.band_index && r.cut && r.cut.group_id_per_band) {
        for (let n = 0; n < r.band_index.length; n++) {
          const bi = r.band_index[n];
          if (bi && bi.item_idx === idx) {
            group_id_per_band[bi.band] = r.cut.group_id_per_band[n];
          }
        }
      }
      inheritance = {
        item_idx_in_cohort: idx,
        seq_num: r.items_meta[idx].seq_num,
        n_inheritance_groups: (r.rtab && r.rtab.per_item_n_groups)
          ? r.rtab.per_item_n_groups[idx] : null,
        group_id_per_band,
        total_groups_in_cohort: (r.cut && r.cut.n_groups != null)
          ? r.cut.n_groups : null,
      };
    }
  }

  // Band composition (family + ancestry per band)
  let bandComposition = null;
  const bc = safeCall(() => candidateBandComposition(cand, samples));
  if (Array.isArray(bc)) {
    bandComposition = bc.map(b => ({
      k: b.k,
      n: b.n,
      member_indices: Array.from(b.members || []),
      member_ids: Array.from(b.members || []).map(idx => exportSampleId(idx, samples)),
      families: (b.families || []).map(f => ({
        family_id: f.family_id, n: f.n, frac: f.frac,
      })),
      ancestries: (b.ancestries || []).map(a => ({
        label: a.label, n: a.n, frac: a.frac,
      })),
    }));
  }

  return {
    candidate_id: String(cand.id),
    chrom: cand.chrom || (state && state.data && state.data.chrom) || null,
    start_w: cand.start_w,
    end_w:   cand.end_w,
    start_bp: cand.start_bp,
    end_bp:   cand.end_bp,
    K_used: K,
    source:  cand.source    || null,
    parent_l2: Number.isFinite(cand.parent_l2) ? cand.parent_l2 : null,
    confirmed: !!cand.confirmed,
    // v1 surface
    atlas_band_assignments: { per_sample, band_counts },
    haplotype_labels: Object.assign({}, hapLabels),
    annotator_notes: cand.notes || '',
    diamond_detection: diamondSummary,
    sigma_profile:     sigmaSummary,
    inheritance,
    sample_groups: buildSampleGroupsFromLabels(cand.locked_labels, hapLabels, samples),
    // v2 additions
    haplotype_vocab:    vocab,
    classifier_output:  classifierOutput,
    per_band_stats:     perBandStats,
    band_composition:   bandComposition,
    diamonds_full:      diamondsFull,
    locked_labels_raw:  cand.locked_labels ? Array.from(cand.locked_labels) : null,
    candidate_runtime: {
      ref_l2:     Number.isFinite(cand.ref_l2)     ? cand.ref_l2     : null,
      ref_window: Number.isFinite(cand.ref_window) ? cand.ref_window : null,
      l2_indices: Array.isArray(cand.l2_indices) ? Array.from(cand.l2_indices) : null,
      resolution: cand.resolution || null,
      _system:    cand._system    || null,
    },
  };
}
