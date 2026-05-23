// shared/cohort_export.js
//
// Cohort-level sample metadata helpers (legacy lines 61038-61108).
// Used by the atlas export bundle + per-candidate export records to
// resolve stable sample ids, build per-haplotype sample groups, and
// emit the cohort-samples block that downstream phase-7 readers
// consume.
//
// All compute is pure — caller passes the samples array explicitly
// (legacy reached state.data.samples).

/**
 * Resolve a stable export sample id at index `idx`. Uses samples[idx].id
 * when present (truthy), else falls back to a zero-padded synthetic id
 * `sample_NNN` so the output is always 1:1 with sample-index.
 *
 * @param {number} idx
 * @param {Array<{id?:string|number}>} samples
 * @returns {string}
 */
export function exportSampleId(idx, samples) {
  if (Array.isArray(samples) && samples[idx] && samples[idx].id != null) {
    return String(samples[idx].id);
  }
  return 'sample_' + String(idx).padStart(3, '0');
}

/**
 * Group sample ids by their user-facing haplotype label. labels is the
 * candidate's locked_labels (Int8Array or regular array); hapLabels
 * is the per-band label map ({ "0": "H1/H1", ... }); samples is the
 * cohort samples list.
 *
 * Samples with label < 0 (NA sentinel) are dropped.
 *
 * Group keys are the user's haplotype labels verbatim (not
 * canonicalised) — the pipeline reader handles any vocabulary
 * translation downstream. Bands without a label fall back to
 * `band_<k>`.
 *
 * @param {ArrayLike<number>?} labels
 * @param {Object<string|number, string>?} hapLabels
 * @param {Array<Object>?} samples
 * @returns {Object<string, Array<string>>}
 */
export function buildSampleGroupsFromLabels(labels, hapLabels, samples) {
  const groups = {};
  if (!labels || !labels.length) return groups;
  for (let i = 0; i < labels.length; i++) {
    const k = labels[i];
    if (k < 0) continue;
    const groupName = (hapLabels && hapLabels[k] != null)
      ? String(hapLabels[k]) : ('band_' + k);
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(exportSampleId(i, samples));
  }
  return groups;
}

/**
 * Build the cohort sample metadata block for the atlas export bundle.
 * Returns Array<{ idx, id, family_id, ancestry }>.
 *
 *   - idx: original sample index (matches locked_labels alignment)
 *   - id:  exportSampleId result (stable string)
 *   - family_id: stringified family_id when present and not the -1
 *     sentinel; null otherwise
 *   - ancestry: stringified ancestry when present; null otherwise
 *
 * @param {Array<Object>?} samples
 * @returns {Array<Object>}
 */
export function buildCohortSamplesBlock(samples) {
  if (!Array.isArray(samples)) return [];
  return samples.map((s, idx) => ({
    idx,
    id: (s && s.id != null) ? String(s.id)
                            : 'sample_' + String(idx).padStart(3, '0'),
    family_id: (s && s.family_id != null && s.family_id !== -1)
                 ? String(s.family_id) : null,
    ancestry: (s && s.ancestry != null) ? String(s.ancestry) : null,
  }));
}

/**
 * Safe-call wrapper used by the legacy export pipeline to invoke
 * optional helpers without crashing the bundle on a missing dep.
 * Pure: doesn't touch state.
 *
 * @param {Function?} fn
 * @param {*} arg
 * @returns {*}  fn's return value, or null on throw / non-function
 */
export function safeCall(fn, arg) {
  if (typeof fn !== 'function') return null;
  try { return fn(arg); } catch (_) { return null; }
}
