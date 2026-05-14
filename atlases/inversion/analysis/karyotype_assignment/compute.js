// analysis/karyotype_assignment/compute.js
// =====================================================================
// Pure JSON-in / JSON-out karyotype-assignment compute.
//
//   compute(input_json) → output_json
//
// No DOM. No fetch. No registry. No state. No `state.X` reach-ins.
// Same JSON runs in browser, Node, batch CLI, or a future Python
// harness via `node --experimental-vm-modules`.
//
// Wraps the already-shipped pure primitives:
//   - shared/band_divergence.js     → classifyDetailedCandidate
//   - shared/band_haplotype_assign.js → assignBandHaplotypes
//   - the K=3 coarse-group mapper is added here so ngsPedigree +
//     stripe_quality have a clean `coarse_group` array to consume.
//
// Schemas: ./schema_in.json + ./schema_out.json. Both are validated
// at the adapter boundary (adapter_atlas.js); compute itself trusts
// the input shape.
//
// =====================================================================

import {
  classifyDetailedCandidate,
  DBD_LOW_HET_THRESHOLD,
  DBD_HIGH_HET_THRESHOLD,
  DBD_MULTIMODAL_GAP_Z,
  DBD_MULTIMODAL_GAP_MIN,
  DBD_MIN_MODE_SAMPLES,
} from '../../shared/band_divergence.js';
import { assignBandHaplotypes } from '../../shared/band_haplotype_assign.js';

// =====================================================================
// 1. Public entry — compute(input_json) → output_json
// =====================================================================

/**
 * @param {Object} input    must conform to ./schema_in.json
 * @returns {Object}        conforms to ./schema_out.json
 */
export function compute(input) {
  const out = _emptyResult();
  if (!input || !input.candidate) return out;
  const cand = input.candidate;
  if (!Array.isArray(cand.labels) || cand.labels.length === 0) return out;
  const params = _resolveParams(input.params);
  out.params_used = params;
  out.input_layer_ids = Array.isArray(input.input_layer_ids)
    ? input.input_layer_ids.slice() : [];
  out.candidate_id = cand.id || null;

  const n_samples = cand.labels.length;
  const K = cand.K | 0;
  if (K < 1) return out;

  // Step 1. Detailed band-divergence classifier.
  //
  // band_divergence.js accepts a candidate-like object; we wrap our
  // schema-in shape onto its expectations: locked_labels, K, samplePC1,
  // per_sample_het. The classifier itself is registry-agnostic.
  const bdInput = {
    K,
    locked_labels:   _asIntArray(cand.labels),
    samplePC1:       Array.isArray(cand.pc1) ? cand.pc1 : null,
    per_sample_het:  Array.isArray(cand.per_sample_het) ? cand.per_sample_het : null,
  };
  const bdOpts = {
    LOW_HET_THRESHOLD:   params.low_het_threshold,
    HIGH_HET_THRESHOLD:  params.high_het_threshold,
    MULTIMODAL_GAP_Z:    params.multimodal_gap_z,
    MULTIMODAL_GAP_MIN:  params.multimodal_gap_min,
    MIN_MODE_SAMPLES:    params.min_mode_samples,
    allow_pc_residual_proxy: !!params.allow_pc_residual_proxy,
  };
  const bd = classifyDetailedCandidate(bdInput, bdOpts);
  if (!bd || !Array.isArray(bd.per_sample) || !Array.isArray(bd.per_band)) {
    // Insufficient data path — return an empty but well-formed result.
    out.source     = 'insufficient';
    out.n_samples  = n_samples;
    out.n_bands    = K;
    return out;
  }

  // Step 2. H-system haplotype assignment.
  const kary = assignBandHaplotypes(bd.per_band, {
    pc1:    bdInput.samplePC1,
    labels: bdInput.locked_labels,
  }) || [];

  // Step 3. Cohort-side coarse_group mapping (K=3 → HOMO_1 / HET / HOMO_2).
  //
  // The rule (matches the legacy `coarse_group_refined`):
  //   - For K=3, the unique hom-like band with the smallest median PC1
  //     is HOMO_1, the other hom-like band is HOMO_2, the het-like band
  //     is HET. Anything else falls to 'unknown'.
  //   - For K ≠ 3, every sample is 'unknown' (downstream tools that
  //     consume coarse_group are K=3-specific).
  const bandToCoarse = _buildBandToCoarseGroup(bd.per_band, kary, K);

  // Step 4. Build per_sample rows enriched with sample id + coarse_group.
  const per_sample = bd.per_sample.map((row) => {
    const coarse = bandToCoarse[row.band] || 'unknown';
    return {
      si:                row.si,
      sample:            Array.isArray(cand.samples) ? (cand.samples[row.si] || null) : null,
      band:              row.band,
      het:               Number.isFinite(row.het) ? row.het : null,
      divergence_class:  row.divergence_class || 'unknown',
      possible_state:    row.possible_state    || 'ambiguous',
      sub_band:          (row.sub_band == null ? null : row.sub_band),
      coarse_group:      coarse,
    };
  });

  // Step 5. Flatten the coarse_group array (one entry per sample, by si).
  const coarse_group = new Array(n_samples).fill('unknown');
  for (const row of per_sample) coarse_group[row.si] = row.coarse_group;

  out.per_sample = per_sample;
  out.per_band   = bd.per_band;
  out.karyotype_assignment = kary;
  out.coarse_group = coarse_group;
  out.source     = bd.het_source || bd.source || 'insufficient';
  out.n_samples  = n_samples;
  out.n_bands    = K;
  return out;
}

// =====================================================================
// 2. Helpers
// =====================================================================

function _emptyResult() {
  return {
    candidate_id: null,
    per_sample:   [],
    per_band:     [],
    karyotype_assignment: [],
    coarse_group: [],
    source:       'insufficient',
    n_samples:    0,
    n_bands:      0,
    input_layer_ids: [],
    params_used:  null,
  };
}

function _resolveParams(p) {
  const q = (p && typeof p === 'object') ? p : {};
  return {
    allow_pc_residual_proxy: !!q.allow_pc_residual_proxy,
    low_het_threshold:       Number.isFinite(q.low_het_threshold)   ? q.low_het_threshold   : DBD_LOW_HET_THRESHOLD,
    high_het_threshold:      Number.isFinite(q.high_het_threshold)  ? q.high_het_threshold  : DBD_HIGH_HET_THRESHOLD,
    multimodal_gap_z:        Number.isFinite(q.multimodal_gap_z)    ? q.multimodal_gap_z    : DBD_MULTIMODAL_GAP_Z,
    multimodal_gap_min:      Number.isFinite(q.multimodal_gap_min)  ? q.multimodal_gap_min  : DBD_MULTIMODAL_GAP_MIN,
    min_mode_samples:        Number.isFinite(q.min_mode_samples)    ? q.min_mode_samples    : DBD_MIN_MODE_SAMPLES,
  };
}

function _asIntArray(v) {
  if (v instanceof Int8Array || v instanceof Int16Array || v instanceof Int32Array) return v;
  const out = new Int32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    out[i] = Number.isFinite(x) ? (x | 0) : -1;
  }
  return out;
}

/**
 * For K=3, pick the two hom-like bands and the one het-like band, then
 * map them to HOMO_1 / HOMO_2 / HET based on the haplotype assignment
 * from assignBandHaplotypes (H1/H1 → HOMO_1, H2/H2 → HOMO_2,
 * H1/H2 → HET).
 *
 * For K ≠ 3, returns an all-'unknown' map.
 */
function _buildBandToCoarseGroup(per_band, kary, K) {
  const out = Object.create(null);
  if (K !== 3 || !Array.isArray(per_band) || !Array.isArray(kary)) return out;
  for (const a of kary) {
    if (!a || typeof a.band !== 'number') continue;
    const hc = a.haplotype_class || '';
    if (hc === 'H1/H1')       out[a.band] = 'HOMO_1';
    else if (hc === 'H2/H2')  out[a.band] = 'HOMO_2';
    else if (hc === 'H1/H2' || hc === 'H2/H1') out[a.band] = 'HET';
    else                      out[a.band] = 'unknown';
  }
  return out;
}
