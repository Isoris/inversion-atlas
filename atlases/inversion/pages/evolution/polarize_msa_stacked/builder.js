// pages/evolution/polarize_msa_stacked/builder.js
// =====================================================================
// Build the consensus-row stack that feeds the existing
// dosage-heatmap renderer. Rows:
//
//   row 0     outgroup consensus    (optional; built if outgroup_idx given)
//   row 1     INV founder-like consensus
//   row 2..K  INV subgroup consensus  (from doubleton SFS clustering)
//   row K+1   STD consensus
//
// All rows are dosage-rows in [0..2] (with NaN for low-confidence
// / missing sites) so the dosage_heatmap renderer paints them as
// "samples" via the same canonical {n_samples, n_markers, cellValue}
// shape.
//
// Pure compute. No DOM.
// =====================================================================

import {
  computeFounderConsensus,
  consensusToDosageRow,
} from '../../../shared/mgl_founder_consensus.js';
import {
  clusterInvByDoubletonSharing,
  perClusterMeanDosage,
} from '../../../shared/mgl_doubleton_sfs_clusters.js';

// =====================================================================
// Row-tag enum
// =====================================================================

export const ROW_TAG = Object.freeze({
  OUTGROUP:   'outgroup',
  INV_FOUNDER:'inv_founder',
  INV_GROUP:  'inv_group',
  STD:        'std',
});

// =====================================================================
// Builder
// =====================================================================

/**
 * Build the consensus-row stack + tier-mask + row metadata.
 *
 * @param {Object} args
 * @param {Float64Array|Array<Float64Array|number[]>} args.dosage
 * @param {number} args.n_markers
 * @param {number} args.n_samples
 * @param {number[]} args.inv_idx        INV-class samples
 * @param {number[]} [args.std_idx]      STD-class samples
 * @param {number[]} [args.outgroup_idx] outgroup samples
 * @param {string[]} [args.marker_labels]
 * @param {string} [args.consensus_mode] 'present' (default) | 'mrca'
 * @param {Object} [args.opts]
 *   K_target?:            number   doubleton k-target (default 2)
 *   K_max?:               number   max clusters (default 3)
 *   min_group_size?:      number   default 2
 * @returns {{
 *   rows:Array<{
 *     tag:string, label:string,
 *     dosage_row:Float64Array,
 *     n_called:number, source_count:number,
 *     subgroup_id?:number,
 *   }>,
 *   tier_mask:Int8Array|null,        from the INV founder consensus
 *   consensus_summary:Object|null,   tier counts etc.
 *   subgroup_labels:Int32Array|null, per inv_idx position
 *   K_actual:number,
 * }}
 */
export function buildPolarizeMsaRows(args) {
  const a = args || {};
  if (!a.dosage || !(a.n_markers > 0) || !(a.n_samples > 0)
      || !Array.isArray(a.inv_idx) || a.inv_idx.length === 0) {
    return { rows: [], tier_mask: null, consensus_summary: null,
             subgroup_labels: null, K_actual: 0 };
  }
  const o = a.opts || {};
  const consensusMode = (a.consensus_mode === 'mrca') ? 'mrca_like' : 'present_consensus';

  const rows = [];

  // 1. Outgroup row.
  if (Array.isArray(a.outgroup_idx) && a.outgroup_idx.length > 0) {
    const og = computeFounderConsensus({
      dosage: a.dosage, n_markers: a.n_markers, n_samples: a.n_samples,
      inv_idx: a.outgroup_idx,
      marker_labels: a.marker_labels,
      opts: o,
    });
    const { dosage_row } = consensusToDosageRow(og, consensusMode);
    rows.push({
      tag:           ROW_TAG.OUTGROUP,
      label:         `outgroup (n=${a.outgroup_idx.length})`,
      dosage_row,
      n_called:      og.sites.reduce((s, x) => s + (x.n_called_inv > 0 ? 1 : 0), 0),
      source_count:  a.outgroup_idx.length,
    });
  }

  // 2. INV founder-like row.
  const inv = computeFounderConsensus({
    dosage: a.dosage, n_markers: a.n_markers, n_samples: a.n_samples,
    inv_idx: a.inv_idx,
    std_idx: Array.isArray(a.std_idx) ? a.std_idx : null,
    marker_labels: a.marker_labels,
    opts: o,
  });
  const founderDosage = consensusToDosageRow(inv, consensusMode);
  rows.push({
    tag:           ROW_TAG.INV_FOUNDER,
    label:         `INV founder-like (n=${a.inv_idx.length})`,
    dosage_row:    founderDosage.dosage_row,
    n_called:      inv.sites.reduce((s, x) => s + (x.n_called_inv > 0 ? 1 : 0), 0),
    source_count:  a.inv_idx.length,
  });

  // 3. INV subgroup consensus rows.
  const clustered = clusterInvByDoubletonSharing({
    dosage: a.dosage, n_markers: a.n_markers, n_samples: a.n_samples,
    inv_idx: a.inv_idx,
    opts: {
      K_max:           Number.isFinite(o.K_max) ? o.K_max : 3,
      min_group_size:  Number.isFinite(o.min_group_size) ? o.min_group_size : 2,
      k_target:        Number.isFinite(o.K_target) ? o.K_target : 2,
    },
  });
  const meanRows = perClusterMeanDosage({
    dosage: a.dosage, n_markers: a.n_markers, n_samples: a.n_samples,
    inv_idx: a.inv_idx,
    labels: clustered.labels,
    K_actual: clustered.K_actual,
  });
  for (let k = 0; k < meanRows.length; k++) {
    let nMembers = 0;
    for (let i = 0; i < clustered.labels.length; i++) {
      if (clustered.labels[i] === k) nMembers++;
    }
    rows.push({
      tag:           ROW_TAG.INV_GROUP,
      label:         `INV group ${k} (n=${nMembers})`,
      dosage_row:    meanRows[k],
      n_called:      meanRows[k].length,
      source_count:  nMembers,
      subgroup_id:   k,
    });
  }

  // 4. STD consensus row.
  if (Array.isArray(a.std_idx) && a.std_idx.length > 0) {
    const std = computeFounderConsensus({
      dosage: a.dosage, n_markers: a.n_markers, n_samples: a.n_samples,
      inv_idx: a.std_idx,
      marker_labels: a.marker_labels,
      opts: o,
    });
    const { dosage_row } = consensusToDosageRow(std, consensusMode);
    rows.push({
      tag:           ROW_TAG.STD,
      label:         `STD consensus (n=${a.std_idx.length})`,
      dosage_row,
      n_called:      std.sites.reduce((s, x) => s + (x.n_called_inv > 0 ? 1 : 0), 0),
      source_count:  a.std_idx.length,
    });
  }

  return {
    rows,
    tier_mask:         founderDosage.mask_row,
    consensus_summary: {
      n_high:        inv.n_high,
      n_medium:      inv.n_medium,
      n_low:         inv.n_low,
      n_ambiguous:   inv.n_ambiguous,
      n_suspicious:  inv.n_suspicious,
      n_total:       inv.sites.length,
    },
    subgroup_labels: clustered.labels,
    K_actual:        clustered.K_actual,
  };
}

// =====================================================================
// Verdict
// =====================================================================

/**
 * Heuristic polarization verdict based on outgroup-vs-INV-vs-STD
 * consensus agreement. If the outgroup matches STD more often than
 * INV, INV is likely derived. If outgroup matches INV more often
 * than STD, STD is likely derived. Equal-ish → unpolarized.
 *
 * Only "high"-tier sites count, to avoid noise.
 *
 * @param {{rows:Array}} stack             output of buildPolarizeMsaRows
 * @returns {{verdict:string, n_evaluated:number,
 *            inv_matches_outgroup:number, std_matches_outgroup:number}}
 */
export function polarizationVerdict(stack) {
  const out = { verdict: 'unpolarized', n_evaluated: 0,
                inv_matches_outgroup: 0, std_matches_outgroup: 0 };
  if (!stack || !Array.isArray(stack.rows)) return out;
  const og  = stack.rows.find(r => r.tag === ROW_TAG.OUTGROUP);
  const inv = stack.rows.find(r => r.tag === ROW_TAG.INV_FOUNDER);
  const std = stack.rows.find(r => r.tag === ROW_TAG.STD);
  if (!og || !inv || !std) return out;
  const n = Math.min(og.dosage_row.length, inv.dosage_row.length, std.dosage_row.length);
  let invHits = 0, stdHits = 0, both = 0, evaluated = 0;
  for (let mi = 0; mi < n; mi++) {
    const o = og.dosage_row[mi];
    const i = inv.dosage_row[mi];
    const s = std.dosage_row[mi];
    if (!Number.isFinite(o) || !Number.isFinite(i) || !Number.isFinite(s)) continue;
    evaluated++;
    const matchInv = (o === i);
    const matchStd = (o === s);
    if (matchInv && matchStd) both++;
    if (matchInv) invHits++;
    if (matchStd) stdHits++;
  }
  out.n_evaluated = evaluated;
  out.inv_matches_outgroup = invHits;
  out.std_matches_outgroup = stdHits;
  if (evaluated < 5) { out.verdict = 'insufficient_data'; return out; }
  const diff = invHits - stdHits;
  const thr = Math.max(2, Math.floor(0.10 * evaluated));
  if (diff <= -thr)        out.verdict = 'derived_inv';  // STD is ancestral-like
  else if (diff >= thr)    out.verdict = 'derived_std';  // INV is ancestral-like
  else                     out.verdict = 'unpolarized';
  return out;
}
