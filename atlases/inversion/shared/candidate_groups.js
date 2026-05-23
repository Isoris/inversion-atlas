// shared/candidate_groups.js
// =============================================================================
// Derive `atlasState.shared.activeGroups` from a promoted candidate's locked
// label vector. The output dict is the canonical shape every per-group
// analysis (popstats live server, ancestry, breeding panel) consumes:
//
//   { 'H1/H1': ['CGA_0023', 'CGA_0041', …],
//     'H1/H2': [...],
//     'H2/H2': [...] }
//
// Where `candidate.locked_labels` comes from
// ------------------------------------------
// A candidate enters the atlas via PROMOTION from one of:
//   - the catalogue page (browse + promote interval → candidate)
//   - the haplotype_regimes page (promote a long-range regime band)
//   - the local_pca_dosage page (lock K-means colors → promote)
// Each producer attaches a `locked_labels` Int8Array (length = n_samples)
// to the candidate. The labels are *what they are* — this helper doesn't
// care how the partition was derived; it just maps label indices to
// sample-id buckets. The same code path serves K-means-derived candidates
// and regime-band-derived candidates identically.
//
// Sample id convention: data.samples[i].cga is the canonical id used by
// the VCF / BAM lists + popstats server. We fall back to .ind / .sample_id
// when cga is absent (e.g. legacy precomp).
//
// Server group-size floor: popstats_server defaults to min_group_n=10 (see
// atlas_server.py). Groups below the floor would be rejected; we still
// emit them and the popstats page checks n_per_group before firing.
// =============================================================================

import {
  KARYO_DETAILED_LABELS,
  KARYO_LEGACY_LABELS_K3,
} from '../pages/review/karyotype_tier/karyo_labels.js';

const SERVER_LABELS_K3 = ['H1/H1', 'H1/H2', 'H2/H2'];

/**
 * Build the `{groupName: [sample_ids]}` dict from a candidate's locked
 * K-means labels.
 *
 * @param {object} candidate   atlas-side candidate; reads .locked_labels + .K
 * @param {object} data        scrubber_main precomp; reads .samples[*].cga / .ind
 * @param {object} [opts]
 * @param {'server'|'detailed'|'legacy'|'numeric'} [opts.labelStyle='server']
 *        — 'server': H1/H1 H1/H2 H2/H2 (K=3) — for POST /api/popstats/groupwise
 *        — 'detailed': same H-system labels for K=3..6 (matches karyo_labels.js)
 *        — 'legacy':   'band 1 (lo)' / 'band 2 (mid)' / 'band 3 (hi)'
 *        — 'numeric':  'g0' / 'g1' / 'g2' / …
 * @returns {{ groups: object, n_per_group: object, dropped_unknown: number } | null}
 *          null when locked_labels is missing or no resolvable sample ids
 */
export function candidateGroupsFromLabels(candidate, data, opts) {
  if (!candidate || !candidate.locked_labels || !data || !Array.isArray(data.samples)) {
    return null;
  }
  const labels = candidate.locked_labels;
  const K = candidate.K
    || (labels.length > 0 ? (Math.max.apply(null, Array.from(labels)) + 1) : 0);
  if (K < 1) return null;

  const style = (opts && opts.labelStyle) || 'server';
  const names = _labelNamesFor(K, style);
  const groups = {};
  const n_per_group = {};
  for (let k = 0; k < K; k++) {
    groups[names[k]] = [];
    n_per_group[names[k]] = 0;
  }

  let dropped_unknown = 0;
  const n = Math.min(labels.length, data.samples.length);
  for (let si = 0; si < n; si++) {
    const k = labels[si];
    if (!(k >= 0 && k < K)) { dropped_unknown++; continue; }
    const s = data.samples[si];
    const id = s && (s.cga || s.sample_id || s.ind);
    if (!id) { dropped_unknown++; continue; }
    groups[names[k]].push(String(id));
    n_per_group[names[k]] += 1;
  }
  return { groups, n_per_group, dropped_unknown };
}

function _labelNamesFor(K, style) {
  if (style === 'server' && K === 3)   return SERVER_LABELS_K3.slice();
  if (style === 'detailed' && KARYO_DETAILED_LABELS[K]) {
    return Array.from(KARYO_DETAILED_LABELS[K]);
  }
  if (style === 'legacy' && K === 3)   return Array.from(KARYO_LEGACY_LABELS_K3);
  if (style === 'numeric')             return Array.from({ length: K }, (_, k) => `g${k}`);
  // server-style fallback for K≠3, plus fall-through for unrecognised styles
  return Array.from({ length: K }, (_, k) => `g${k}`);
}

/**
 * Same shape as `candidateGroupsFromLabels` but built from a per-window
 * regime-band label assignment instead of a single candidate's K-means.
 *
 * @param {Array<number>} bandPerSample  band index per sample (length = n_samples)
 * @param {object} data                   reads data.samples[*].cga / .ind
 * @param {object} [opts]                 same as above
 * @returns {{ groups, n_per_group, dropped_unknown } | null}
 */
export function regimeGroupsFromBands(bandPerSample, data, opts) {
  if (!Array.isArray(bandPerSample) || !data || !Array.isArray(data.samples)) {
    return null;
  }
  return candidateGroupsFromLabels(
    { locked_labels: bandPerSample,
      K: (Math.max.apply(null, bandPerSample.filter(b => b >= 0)) + 1) || 0 },
    data,
    opts,
  );
}
