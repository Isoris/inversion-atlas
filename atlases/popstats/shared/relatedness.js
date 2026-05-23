// shared/relatedness.js
//
// Pure accessors for the per-chrom `relatedness` layer (the
// `cohort_relatedness` JSON shape). Used by inheritance + sibling
// detection panels.
//
// state.data.relatedness shape (from export_relatedness_to_json_v1.R
// / aggregate_relatedness.py):
//   {
//     n_samples, samples,                  // sample order
//     thresholds: { t1, t2, t3 },          // theta cutoffs
//     hub_id_1st, hub_id_2nd, hub_id_3rd,  // Int arrays length n_samples
//     n_hubs: { n1, n2, n3 },              // hub count per degree
//     pair_count: { total, kept, n1, n2, n3 },
//     pairs: { a, b, theta },              // top-N pairs by theta
//   }
//
// hub_id_1st[i] gives the connected-component id at θ ≥ 0.177 for
// sample i, where i is the position in the relatedness JSON's
// samples[] (NOT necessarily the same order as state.data.samples).
// The relSampleMap helper bridges scrubber-sample-index to
// relatedness-sample-index by matching CGA / sample id strings.
//
// Legacy origin: lines 52621-52671 of legacy/Inversion_atlas.html
// (getRelatedness, _relSampleMap, getHubIdAt, getNumHubsAt).
//
// State-as-first-arg, no globals.

// =====================================================================
// Constants
// =====================================================================

/** Degrees the relatedness layer indexes. */
export const RELATEDNESS_DEGREES = Object.freeze([1, 2, 3]);

/**
 * Hub-id sentinel for "sample not in the relatedness layer" / "no
 * relatedness loaded".
 */
export const RELATEDNESS_NO_HUB = -1;

// =====================================================================
// Accessors
// =====================================================================

/**
 * Pull the relatedness layer off state.data, or null when missing.
 */
export function getRelatedness(state) {
  return (state && state.data && state.data.relatedness) || null;
}

/**
 * Build a Map<scrubberSampleIdx, relatednessSampleIdx>. Cached on
 * the relatedness object itself (state.data.relatedness.__scrubber_idx_map)
 * so subsequent calls are O(1).
 *
 * Matches on `cga`, then `ind`, then `sample_id`, as string. The
 * relatedness JSON may have been generated against a slightly
 * different sample list than the scrubber loaded (e.g. a different
 * cohort version), so samples missing from one side just don't get
 * an entry — they return -1 from getHubIdAt.
 *
 * Returns null when relatedness or state.data.samples is missing.
 *
 * @param {Object} state
 * @returns {Map<number,number>|null}
 */
export function relSampleMap(state) {
  const rel = getRelatedness(state);
  if (!rel || !state.data || !Array.isArray(state.data.samples)) return null;
  if (rel.__scrubber_idx_map instanceof Map) return rel.__scrubber_idx_map;
  if (!Array.isArray(rel.samples)) return null;
  const nameToRelIdx = new Map();
  for (let i = 0; i < rel.samples.length; i++) {
    nameToRelIdx.set(String(rel.samples[i]), i);
  }
  const m = new Map();
  for (let i = 0; i < state.data.samples.length; i++) {
    const s = state.data.samples[i];
    const cga = s && (s.cga || s.ind || s.sample_id);
    if (cga != null && nameToRelIdx.has(String(cga))) {
      m.set(i, nameToRelIdx.get(String(cga)));
    }
  }
  rel.__scrubber_idx_map = m;
  return m;
}

/**
 * Hub id for scrubber-sample-index `si` at the requested degree
 * (1, 2, or 3 — invalid degrees coerce to 1). Returns
 * RELATEDNESS_NO_HUB (-1) when relatedness isn't loaded or the
 * sample isn't in the relatedness JSON. Singletons get their own
 * non-negative hub id (per the producer's convention).
 *
 * @param {Object} state
 * @param {number} si       scrubber sample index
 * @param {1|2|3} [degree]  default 1
 * @returns {number}
 */
export function getHubIdAt(state, si, degree) {
  const rel = getRelatedness(state);
  if (!rel) return RELATEDNESS_NO_HUB;
  const map = relSampleMap(state);
  if (!map) return RELATEDNESS_NO_HUB;
  const relIdx = map.get(si);
  if (relIdx == null) return RELATEDNESS_NO_HUB;
  const arr = (degree === 2) ? rel.hub_id_2nd
            : (degree === 3) ? rel.hub_id_3rd
            : rel.hub_id_1st;
  return Array.isArray(arr) && arr[relIdx] != null ? arr[relIdx] : RELATEDNESS_NO_HUB;
}

/**
 * Total distinct hubs at the requested degree (1, 2, or 3 — invalid
 * degrees coerce to 1). Returns 0 when the layer / n_hubs counter
 * isn't present.
 */
export function getNumHubsAt(state, degree) {
  const rel = getRelatedness(state);
  if (!rel || !rel.n_hubs) return 0;
  if (degree === 2) return rel.n_hubs.n2 || 0;
  if (degree === 3) return rel.n_hubs.n3 || 0;
  return rel.n_hubs.n1 || 0;
}
