// pages/discovery/dosage_heatmap/regime_registry_overlay.js
// =====================================================================
// Map the cross-atlas regime registry (atlasState.shared.registered-
// Candidates, written by the haplotype_regimes pipeline) onto the
// dosage heatmap's markers + samples, so the heatmap can display EVERY
// regime overlapping the loaded window — not just the single active
// candidate.
//
// A registry record carries (run_pipeline._registerCandidatesIntoSharedState):
//   { candidate_id, chrom, start_bp, end_bp, span_bp,
//     regime_class, confidence,
//     regime_groups: { 'H1/H1':[sid…], 'H1/H2':[sid…], 'H2/H2':[sid…],
//                      'uncertain':[sid…] }, … }
//
// From those, for the displayed bp window we produce:
//   - regime_spans:  one {lo,hi} marker-index band per overlapping regime
//                    (for the on-matrix span overlay), with class + conf.
//   - sample_group / regime_call: per-sample labels from the PRIMARY
//     overlapping regime (largest marker overlap, ties → confidence),
//     so the group track / ordering / legend reflect the catalogue call.
//
// Pure compute. No DOM, no state mutation.
// =====================================================================

// Catalogue server karyotype label → regime_call vocabulary (inverse of
// run_pipeline._REGIME_CALL_TO_SERVER). Bands beyond the biallelic
// collapse keep their own label and map to 'uncertain' for the call.
const SERVER_TO_CALL = Object.freeze({
  'H1/H1': 'homA_like',
  'H1/H2': 'het_like',
  'H2/H2': 'homB_like',
  'uncertain': 'uncertain',
});

/**
 * @param {Object} canonical    adapter output; needs marker_pos_bp (bp per
 *                              marker) + sample_labels (sample id strings).
 * @param {Array<Object>} registered  atlasState.shared.registeredCandidates
 * @param {Object} [opts]
 *   chrom?: string   restrict to records on this chromosome (recommended;
 *                    bp ranges can collide across chroms).
 * @returns {{
 *   chrom: string|null,
 *   n_regimes: number,
 *   spans: Array<{ candidate_id, lo, hi, regime_class, confidence, label }>,
 *   primary_id: string|null,
 *   sample_group: Array<string|null>,   // per canonical sample idx
 *   regime_call:  Array<string|null>,
 * } | null}
 */
export function buildRegistryOverlay(canonical, registered, opts) {
  const o = opts || {};
  if (!canonical || !Array.isArray(registered) || registered.length === 0) return null;
  const mb = canonical.marker_pos_bp;
  const nM = canonical.n_markers | 0;
  const nS = canonical.n_samples | 0;
  if (!mb || nM <= 0 || nS <= 0) return null;

  // Displayed bp window (finite marker positions only).
  let bpMin = Infinity, bpMax = -Infinity;
  for (let i = 0; i < nM; i++) {
    const v = mb[i];
    if (!Number.isFinite(v)) continue;
    if (v < bpMin) bpMin = v;
    if (v > bpMax) bpMax = v;
  }
  if (!Number.isFinite(bpMin) || !Number.isFinite(bpMax)) return null;

  // Overlapping records on the requested chrom (when given).
  const recs = registered.filter(r =>
    r && (o.chrom == null || r.chrom === o.chrom)
    && Number.isFinite(r.start_bp) && Number.isFinite(r.end_bp)
    && r.end_bp >= bpMin && r.start_bp <= bpMax);
  if (recs.length === 0) {
    return { chrom: o.chrom || null, n_regimes: 0, spans: [],
             primary_id: null, sample_group: new Array(nS).fill(null),
             regime_call: new Array(nS).fill(null) };
  }

  // Marker-index span [lo,hi] per record (canonical marker indices).
  const spans = [];
  for (const r of recs) {
    let lo = -1, hi = -1;
    for (let i = 0; i < nM; i++) {
      const v = mb[i];
      if (!Number.isFinite(v)) continue;
      if (v >= r.start_bp && v <= r.end_bp) { if (lo < 0) lo = i; hi = i; }
    }
    if (lo < 0) continue;   // no displayed marker falls inside it
    spans.push({
      candidate_id: r.candidate_id || null,
      lo, hi,
      regime_class: r.regime_class || null,
      confidence: Number.isFinite(r.confidence) ? r.confidence : null,
      label: r.candidate_id || r.regime_class || 'regime',
    });
  }
  if (spans.length === 0) {
    return { chrom: o.chrom || null, n_regimes: 0, spans: [],
             primary_id: null, sample_group: new Array(nS).fill(null),
             regime_call: new Array(nS).fill(null) };
  }
  spans.sort((a, b) => a.lo - b.lo);

  // Primary regime. A caller-supplied primary_id (regime focus / click)
  // wins when it overlaps the window; otherwise widest marker overlap,
  // ties broken by confidence.
  let primary = null, primaryRec = null;
  if (o.primary_id != null) {
    primary = spans.find(s => s.candidate_id === o.primary_id) || null;
  }
  if (!primary) {
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const width = s.hi - s.lo;
      const conf = Number.isFinite(s.confidence) ? s.confidence : 0;
      if (!primary
          || width > (primary.hi - primary.lo)
          || (width === (primary.hi - primary.lo) && conf > (Number.isFinite(primary.confidence) ? primary.confidence : 0))) {
        primary = s;
      }
    }
  }
  if (primary) {
    primaryRec = recs.find(r => (r.candidate_id || null) === primary.candidate_id) || null;
  }

  // Per-sample labels from the primary regime's groups.
  const sample_group = new Array(nS).fill(null);
  const regime_call  = new Array(nS).fill(null);
  if (primaryRec && primaryRec.regime_groups && Array.isArray(canonical.sample_labels)) {
    const idxOf = new Map();
    for (let i = 0; i < canonical.sample_labels.length; i++) {
      idxOf.set(String(canonical.sample_labels[i]), i);
    }
    for (const serverLabel of Object.keys(primaryRec.regime_groups)) {
      const ids = primaryRec.regime_groups[serverLabel] || [];
      const call = SERVER_TO_CALL[serverLabel] || 'uncertain';
      for (const sid of ids) {
        const si = idxOf.get(String(sid));
        if (si != null) { sample_group[si] = serverLabel; regime_call[si] = call; }
      }
    }
  }

  return {
    chrom: o.chrom || (primaryRec && primaryRec.chrom) || null,
    n_regimes: spans.length,
    spans,
    primary_id: primary ? primary.candidate_id : null,
    sample_group,
    regime_call,
  };
}
